"""Firestore service for session, snapshot, and review note persistence.

Lazy initialization: the Firestore client is created on first use rather than
at import time so that transient metadata-server failures during Cloud Run
cold starts do not permanently disable the service.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_INIT_RETRY_COOLDOWN_S = 30


class FirestoreService:
    """Async wrapper around Cloud Firestore for session data.

    Collection structure:
        sessions/{session_id}
        sessions/{session_id}/snapshots/{snapshot_id}
        sessions/{session_id}/notes/{note_id}
    """

    def __init__(self, project_id: str = "") -> None:
        self._db = None
        self._project_id = project_id
        self._init_retry_after = 0.0

        if not project_id:
            logger.info("Firestore disabled: GOOGLE_CLOUD_PROJECT not set")
            self._init_retry_after = float("inf")
            return

        self._try_initialize()

    def _try_initialize(self) -> bool:
        """Attempt to create the Firestore client. Returns True on success."""
        if self._db is not None:
            return True

        now = time.monotonic()
        if now < self._init_retry_after:
            return False

        try:
            from google.auth import default as _default_credentials
            from google.auth.transport.requests import Request as _AuthRequest

            credentials, _ = _default_credentials(
                scopes=["https://www.googleapis.com/auth/datastore"],
            )
            credentials.refresh(_AuthRequest())

            from google.cloud.firestore import AsyncClient

            self._db = AsyncClient(
                project=self._project_id, credentials=credentials
            )
            self._init_retry_after = 0.0
            logger.info(
                "Firestore client initialized (project=%s)", self._project_id
            )
            return True
        except Exception as exc:
            logger.warning(
                "Firestore init failed (will retry in %ds): %s",
                _INIT_RETRY_COOLDOWN_S,
                exc,
            )
            self._init_retry_after = now + _INIT_RETRY_COOLDOWN_S
            return False

    @property
    def available(self) -> bool:
        if self._db is None:
            self._try_initialize()
        return self._db is not None

    async def create_session_record(self, session_id: str, user_id: str) -> dict[str, Any]:
        """Create a new session document."""
        if not self.available:
            return {"session_id": session_id, "status": "local_only"}

        doc_ref = self._db.collection("sessions").document(session_id)
        data = {
            "session_id": session_id,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "active",
        }
        await doc_ref.set(data)
        logger.info("Created session record: %s", session_id)
        return data

    async def close_session(self, session_id: str) -> None:
        """Mark a session as closed."""
        if not self.available:
            return
        doc_ref = self._db.collection("sessions").document(session_id)
        await doc_ref.update(
            {"status": "closed", "closed_at": datetime.now(timezone.utc).isoformat()}
        )

    async def save_snapshot_metadata(
        self,
        session_id: str,
        snapshot_id: str,
        image_url: str = "",
        description: str = "",
    ) -> dict[str, Any]:
        """Save snapshot metadata under a session."""
        data = {
            "snapshot_id": snapshot_id,
            "image_url": image_url,
            "description": description,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if not self.available:
            logger.info("Snapshot metadata (local): %s", snapshot_id)
            return data

        doc_ref = (
            self._db.collection("sessions")
            .document(session_id)
            .collection("snapshots")
            .document(snapshot_id)
        )
        await doc_ref.set(data)
        logger.info("Saved snapshot metadata: %s/%s", session_id, snapshot_id)
        return data

    async def save_review_note(
        self,
        session_id: str,
        note_id: str,
        category: str,
        finding: str,
        severity: str = "info",
        recommendation: str = "",
    ) -> dict[str, Any]:
        """Save an architecture review note under a session."""
        data = {
            "note_id": note_id,
            "category": category,
            "finding": finding,
            "severity": severity,
            "recommendation": recommendation,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if not self.available:
            logger.info("Review note (local): %s - %s", category, finding)
            return data

        doc_ref = (
            self._db.collection("sessions")
            .document(session_id)
            .collection("notes")
            .document(note_id)
        )
        await doc_ref.set(data)
        logger.info("Saved review note: %s/%s", session_id, note_id)
        return data

    async def get_session_notes(self, session_id: str) -> list[dict[str, Any]]:
        """Retrieve all review notes for a session."""
        if not self.available:
            return []

        notes_ref = (
            self._db.collection("sessions")
            .document(session_id)
            .collection("notes")
        )
        docs = notes_ref.order_by("timestamp").stream()
        return [doc.to_dict() async for doc in docs]

    async def delete_snapshot(self, session_id: str, snapshot_id: str) -> bool:
        """Delete a snapshot document from Firestore."""
        if not self.available:
            return False
        try:
            doc_ref = (
                self._db.collection("sessions")
                .document(session_id)
                .collection("snapshots")
                .document(snapshot_id)
            )
            await doc_ref.delete()
            logger.info("Deleted snapshot from Firestore: %s/%s", session_id, snapshot_id)
            return True
        except Exception as exc:
            logger.error("Failed to delete snapshot from Firestore: %s", exc)
            return False

    async def get_session_snapshots(self, session_id: str) -> list[dict[str, Any]]:
        """Retrieve all snapshots for a session."""
        if not self.available:
            return []

        snaps_ref = (
            self._db.collection("sessions")
            .document(session_id)
            .collection("snapshots")
        )
        docs = snaps_ref.order_by("timestamp").stream()
        return [doc.to_dict() async for doc in docs]
