"""Cloud Storage service for whiteboard snapshot uploads.

Includes a circuit breaker: after consecutive upload failures the service is
temporarily disabled to avoid spamming a broken GCS endpoint.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class StorageService:
    """Wrapper around Cloud Storage with circuit-breaker resilience.

    Uses sync client with run_in_executor for async compatibility.
    """

    _MAX_CONSECUTIVE_FAILURES = 3
    _CIRCUIT_COOLDOWN_S = 300  # 5 minutes

    def __init__(self, bucket_name: str, project_id: str = "") -> None:
        self._bucket = None
        self._bucket_name = bucket_name
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

        if not bucket_name:
            logger.info("Cloud Storage disabled: GCS_BUCKET_NAME not set")
            return
        try:
            from google.auth import default as _default_credentials
            from google.auth.transport.requests import Request as _AuthRequest

            credentials, _ = _default_credentials(
                scopes=["https://www.googleapis.com/auth/devstorage.read_write"],
            )
            credentials.refresh(_AuthRequest())

            from google.cloud.storage import Client

            client = Client(project=project_id or None, credentials=credentials)
            bucket = client.bucket(bucket_name)

            if not bucket.exists():
                logger.warning(
                    "Cloud Storage bucket '%s' does not exist — uploads disabled. "
                    "Create the bucket or update GCS_BUCKET_NAME.",
                    bucket_name,
                )
                return

            self._bucket = bucket
            logger.info("Storage client initialized (bucket=%s)", bucket_name)
        except Exception as exc:
            logger.warning(
                "Cloud Storage unavailable - snapshots will not be uploaded: %s",
                exc,
            )

    # ------------------------------------------------------------------
    # Circuit breaker
    # ------------------------------------------------------------------

    @property
    def available(self) -> bool:
        if self._bucket is None:
            return False
        if time.monotonic() < self._circuit_open_until:
            return False
        return True

    def _on_success(self) -> None:
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

    def _on_failure(self, exc: Exception) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._MAX_CONSECUTIVE_FAILURES:
            self._circuit_open_until = time.monotonic() + self._CIRCUIT_COOLDOWN_S
            logger.warning(
                "GCS circuit breaker opened for %ds after %d consecutive failures: %s",
                self._CIRCUIT_COOLDOWN_S,
                self._consecutive_failures,
                exc,
            )

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def upload_snapshot(
        self,
        session_id: str,
        snapshot_id: str,
        image_data: bytes,
        content_type: str = "image/jpeg",
    ) -> str:
        """Upload a snapshot image. Returns GCS URI or empty string on failure."""
        if not self.available:
            return ""

        blob_path = f"{session_id}/snapshots/{snapshot_id}.jpg"

        def _upload() -> str:
            blob = self._bucket.blob(blob_path)
            blob.upload_from_string(image_data, content_type=content_type)
            return f"gs://{self._bucket_name}/{blob_path}"

        try:
            loop = asyncio.get_running_loop()
            url = await loop.run_in_executor(None, _upload)
            self._on_success()
            logger.info("Uploaded snapshot to GCS: %s", url)
            return url
        except Exception as exc:
            self._on_failure(exc)
            logger.warning("GCS upload failed for %s: %s", snapshot_id, exc)
            return ""

    async def upload_session_summary(
        self,
        session_id: str,
        summary_data: dict[str, Any],
    ) -> str:
        """Upload a JSON session summary. Returns GCS URI or empty string."""
        if not self.available:
            return ""

        import json

        blob_path = f"{session_id}/summary.json"
        payload = json.dumps(summary_data, indent=2, default=str).encode()

        def _upload() -> str:
            blob = self._bucket.blob(blob_path)
            blob.upload_from_string(payload, content_type="application/json")
            return f"gs://{self._bucket_name}/{blob_path}"

        try:
            loop = asyncio.get_running_loop()
            url = await loop.run_in_executor(None, _upload)
            self._on_success()
            logger.info("Uploaded session summary: %s", url)
            return url
        except Exception as exc:
            self._on_failure(exc)
            logger.warning("GCS summary upload failed for %s: %s", session_id, exc)
            return ""

    # ------------------------------------------------------------------
    # Generic blob helpers (used by diagrams etc.)
    # ------------------------------------------------------------------

    async def upload_blob(
        self,
        blob_path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload arbitrary bytes to a GCS path. Returns GCS URI or empty string."""
        if not self.available:
            return ""

        def _upload() -> str:
            blob = self._bucket.blob(blob_path)
            blob.upload_from_string(data, content_type=content_type)
            return f"gs://{self._bucket_name}/{blob_path}"

        try:
            loop = asyncio.get_running_loop()
            url = await loop.run_in_executor(None, _upload)
            self._on_success()
            logger.info("Uploaded blob to GCS: %s", url)
            return url
        except Exception as exc:
            self._on_failure(exc)
            logger.warning("GCS upload failed for %s: %s", blob_path, exc)
            return ""

    async def download_blob(self, blob_path: str) -> bytes | None:
        """Download arbitrary bytes from a GCS path. Returns bytes or None."""
        if not self.available:
            return None

        def _download() -> bytes:
            blob = self._bucket.blob(blob_path)
            return blob.download_as_bytes()

        try:
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(None, _download)
            self._on_success()
            return data
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Download (for serving endpoint — GCS fallback when local cache miss)
    # ------------------------------------------------------------------

    async def delete_snapshot(self, session_id: str, snapshot_id: str) -> bool:
        """Delete a snapshot from GCS. Returns True on success."""
        if not self.available:
            return False

        blob_path = f"{session_id}/snapshots/{snapshot_id}.jpg"

        def _delete() -> None:
            blob = self._bucket.blob(blob_path)
            blob.delete()

        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _delete)
            self._on_success()
            logger.info("Deleted snapshot from GCS: %s", blob_path)
            return True
        except Exception as exc:
            logger.warning("GCS delete failed for %s: %s", blob_path, exc)
            return False

    async def download_snapshot(
        self, session_id: str, snapshot_id: str
    ) -> bytes | None:
        """Download a snapshot from GCS. Returns bytes or None."""
        if not self.available:
            return None

        blob_path = f"{session_id}/snapshots/{snapshot_id}.jpg"

        def _download() -> bytes:
            blob = self._bucket.blob(blob_path)
            return blob.download_as_bytes()

        try:
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(None, _download)
            self._on_success()
            return data
        except Exception:
            return None
