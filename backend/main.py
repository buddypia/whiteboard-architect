"""FastAPI backend for Whiteboard Architect - real-time architecture review agent."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import shutil
import time
import uuid
import warnings
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent import build_architect_agent
from config import config
from image_context import ImageContext, ImageSource
from services.diagram_service import DiagramService
from services.firestore_service import FirestoreService
from services.live_model_service import LiveModelService
from services.storage_service import StorageService
from services.translation_service import TranslationService
from services.whiteboard_analyzer import WhiteboardAnalyzer
from whiteboard_state import WhiteboardState

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

warnings.filterwarnings(
    "ignore",
    message=r"(?s)Pydantic serializer warnings:.*field_name='response_modalities'.*",
    category=UserWarning,
)

# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

APP_NAME = "whiteboard-architect"

session_service = InMemorySessionService()
live_model_service = LiveModelService(config.model_candidates)

# Cloud services (gracefully degrade if unavailable)
firestore_service = FirestoreService(project_id=config.project_id)
storage_service = StorageService(bucket_name=config.gcs_bucket_name)
diagram_service = DiagramService()
whiteboard_analyzer = WhiteboardAnalyzer()
translation_service = TranslationService()

# Local snapshot storage (always available; ephemeral on Cloud Run)
SNAPSHOT_DIR = Path(__file__).parent / "local_snapshots"
SNAPSHOT_DIR.mkdir(exist_ok=True)
DIAGRAM_DIR = Path(__file__).parent / "local_diagrams"
DIAGRAM_DIR.mkdir(exist_ok=True)
_SNAPSHOT_CACHE_MAX_AGE_H = 24
_MAX_SNAPSHOTS_PER_SESSION = 100
_MAX_DIAGRAMS_PER_SESSION = 20
_snapshot_lock = asyncio.Lock()
_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _cleanup_stale_local_dirs() -> None:
    """Remove local snapshot/diagram directories older than TTL."""
    cutoff = time.time() - _SNAPSHOT_CACHE_MAX_AGE_H * 3600
    for base_dir in (SNAPSHOT_DIR, DIAGRAM_DIR):
        for session_dir in base_dir.iterdir():
            if session_dir.is_dir() and session_dir.stat().st_mtime < cutoff:
                shutil.rmtree(session_dir, ignore_errors=True)
                logger.info("Cleaned up stale cache: %s", session_dir)


async def _periodic_snapshot_cleanup() -> None:
    """Run cleanup every hour in the background."""
    while True:
        await asyncio.sleep(3600)
        try:
            await asyncio.to_thread(_cleanup_stale_local_dirs)
        except Exception as exc:
            logger.error("Periodic snapshot cleanup failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initial cleanup + start periodic background task."""
    try:
        _cleanup_stale_local_dirs()
    except Exception as exc:
        logger.warning("Initial snapshot cleanup failed: %s", exc)
    try:
        await live_model_service.initialize()
    except Exception as exc:
        logger.warning("Gemini live model probe failed during startup: %s", exc)
    asyncio.create_task(_periodic_snapshot_cleanup())
    yield


app = FastAPI(title="Whiteboard Architect", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {
        "status": "healthy",
        "model": live_model_service.active_model or config.model_name,
        "configured_model_candidates": config.model_candidates,
        "model_candidates": live_model_service.model_candidates,
        "model_probe_results": live_model_service.probe_results,
        "firestore": firestore_service.available,
        "storage": storage_service.available,
    }


@app.get("/api/sessions/{session_id}/notes")
async def get_session_notes(session_id: str) -> dict:
    notes = await firestore_service.get_session_notes(session_id)
    return {"session_id": session_id, "notes": notes}


@app.get("/api/sessions/{session_id}/snapshots")
async def get_session_snapshots(session_id: str) -> dict:
    firestore_snaps = await firestore_service.get_session_snapshots(session_id)

    # Normalise all URLs to the stable serve endpoint
    seen_ids: set[str] = set()
    for snap in firestore_snaps:
        sid = snap.get("snapshot_id", "")
        if sid:
            snap["image_url"] = f"/api/snapshots/{session_id}/{sid}.jpg"
            seen_ids.add(sid)

    # Append local-only snapshots not yet in Firestore
    for local_snap in _get_local_snapshots(session_id):
        if local_snap["snapshot_id"] not in seen_ids:
            firestore_snaps.append(local_snap)

    return {"session_id": session_id, "snapshots": firestore_snaps}


@app.delete("/api/snapshots/{session_id}/{snapshot_id}")
async def delete_snapshot(
    session_id: str,
    snapshot_id: str,
    user_id: str = Query(default=""),
) -> dict:
    """Delete a snapshot from local storage, ADK session state, Firestore, and GCS."""
    if not _SAFE_ID_RE.match(session_id) or not _SAFE_ID_RE.match(snapshot_id):
        raise HTTPException(status_code=400, detail="Invalid ID format")

    # Delete local file
    local_path = SNAPSHOT_DIR / session_id / f"{snapshot_id}.jpg"
    if local_path.exists():
        await asyncio.to_thread(local_path.unlink)

    # Remove from local metadata.json
    async with _snapshot_lock:
        metadata_path = SNAPSHOT_DIR / session_id / "metadata.json"
        if metadata_path.exists():
            try:
                raw = await asyncio.to_thread(metadata_path.read_text)
                metadata = json.loads(raw)
                metadata = [m for m in metadata if m.get("snapshot_id") != snapshot_id]
                payload = json.dumps(metadata, indent=2, ensure_ascii=False)
                await asyncio.to_thread(metadata_path.write_text, payload)
            except (json.JSONDecodeError, OSError):
                pass

    # Remove from ADK in-memory session state so the agent sees the updated count
    if user_id:
        try:
            session = await session_service.get_session(
                app_name=APP_NAME, user_id=user_id, session_id=session_id,
            )
            if session:
                state_snaps = session.state.get("snapshots", [])
                session.state["snapshots"] = [
                    s for s in state_snaps if s.get("snapshot_id") != snapshot_id
                ]
        except Exception as exc:
            logger.debug("Could not update ADK session state on delete: %s", exc)

    # Delete from Firestore and GCS (best-effort)
    await firestore_service.delete_snapshot(session_id, snapshot_id)
    await storage_service.delete_snapshot(session_id, snapshot_id)

    logger.info("Deleted snapshot: %s/%s", session_id, snapshot_id)
    return {"status": "deleted", "snapshot_id": snapshot_id}


@app.get("/api/snapshots/{session_id}/{snapshot_id}.jpg")
async def serve_snapshot(session_id: str, snapshot_id: str) -> Response:
    """Serve a snapshot image: local cache -> GCS fallback -> 404."""
    if not _SAFE_ID_RE.match(session_id) or not _SAFE_ID_RE.match(snapshot_id):
        raise HTTPException(status_code=400, detail="Invalid ID format")

    local_path = SNAPSHOT_DIR / session_id / f"{snapshot_id}.jpg"
    if local_path.exists():
        data = await asyncio.to_thread(local_path.read_bytes)
        return Response(content=data, media_type="image/jpeg")

    # GCS fallback — download and cache locally
    data = await storage_service.download_snapshot(session_id, snapshot_id)
    if data:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(local_path.write_bytes, data)
        return Response(content=data, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Snapshot not found")


_UPLOAD_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@app.post("/api/sessions/{session_id}/upload")
async def upload_image(session_id: str, file: UploadFile = File(...)) -> dict:
    """Upload an image to be analysed as a whiteboard snapshot.

    Accepts JPEG, PNG, or WebP. Non-JPEG images are converted to JPEG for
    consistency with the rest of the snapshot pipeline.
    """
    if not _SAFE_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")

    content_type = file.content_type or ""
    if content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(
            status_code=400,
            detail="Unsupported image format. Use JPEG, PNG, or WebP.",
        )

    image_data = await file.read()
    if len(image_data) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    # Convert non-JPEG to JPEG for pipeline consistency
    if content_type != "image/jpeg":
        import io
        from PIL import Image as PILImage

        img = PILImage.open(io.BytesIO(image_data))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        image_data = buf.getvalue()

    upload_id = str(uuid.uuid4())[:8]
    description = "アップロード画像"

    await _save_snapshot_locally(session_id, upload_id, image_data, description, origin="upload")

    # Cloud persistence (best-effort)
    if storage_service.available:
        await storage_service.upload_snapshot(session_id, upload_id, image_data)
    if firestore_service.available:
        await firestore_service.save_snapshot_metadata(
            session_id,
            upload_id,
            f"/api/snapshots/{session_id}/{upload_id}.jpg",
            description,
        )

    return {
        "snapshot_id": upload_id,
        "image_url": f"/api/snapshots/{session_id}/{upload_id}.jpg",
        "origin": "upload",
    }


@app.get("/api/diagrams/{session_id}/{diagram_id}.svg")
async def serve_diagram_svg(session_id: str, diagram_id: str) -> Response:
    """Serve a generated SVG diagram."""
    if not _SAFE_ID_RE.match(session_id) or not _SAFE_ID_RE.match(diagram_id):
        raise HTTPException(status_code=400, detail="Invalid ID format")

    local_path = DIAGRAM_DIR / session_id / f"{diagram_id}.svg"
    if local_path.exists():
        data = await asyncio.to_thread(local_path.read_bytes)
        return Response(content=data, media_type="image/svg+xml")

    raise HTTPException(status_code=404, detail="Diagram not found")


@app.get("/api/diagrams/{session_id}/{diagram_id}.png")
async def serve_diagram_png(session_id: str, diagram_id: str) -> Response:
    """Serve a legacy PNG diagram (backward compat)."""
    if not _SAFE_ID_RE.match(session_id) or not _SAFE_ID_RE.match(diagram_id):
        raise HTTPException(status_code=400, detail="Invalid ID format")

    local_path = DIAGRAM_DIR / session_id / f"{diagram_id}.png"
    if local_path.exists():
        data = await asyncio.to_thread(local_path.read_bytes)
        return Response(content=data, media_type="image/png")

    raise HTTPException(status_code=404, detail="Diagram not found")


from pydantic import BaseModel as _BaseModel


class _TranslateRequest(_BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "ja"


@app.post("/api/translate")
async def translate_text(req: _TranslateRequest) -> dict:
    """Translate text using Gemini 3.1 Flash-Lite Preview."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    translation = await translation_service.translate(
        req.text, source_lang=req.source_lang, target_lang=req.target_lang
    )
    return {"translation": translation}


# ---------------------------------------------------------------------------
# WebSocket streaming endpoint
# ---------------------------------------------------------------------------

def _build_run_config() -> RunConfig:
    """Build RunConfig for bidirectional live streaming."""
    return RunConfig(
        streaming_mode=StreamingMode.BIDI,
        # ADK RunConfig expects strings here; enums trigger noisy Pydantic warnings.
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            automatic_activity_detection=types.AutomaticActivityDetection(
                # LOW sensitivity: Gemini requires louder/clearer speech to
                # trigger barge-in.  Prevents ambient noise, echo, and
                # keyboard sounds from falsely interrupting the agent.
                # All other parameters (end sensitivity, silence duration)
                # are left at defaults — overriding them can prevent the
                # model from responding when the client sends continuous
                # audio frames (including silence/ambient noise).
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
            ),
        ),
    )


def _build_runner(model_name: str) -> Runner:
    """Create a session runner pinned to one Gemini model version."""
    return Runner(
        app_name=APP_NAME,
        agent=build_architect_agent(model_name),
        session_service=session_service,
    )


async def _recreate_adk_session(
    user_id: str,
    session_id: str,
) -> None:
    """Recreate the in-memory ADK session while preserving snapshot metadata."""
    await session_service.delete_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    existing_snaps = _get_local_snapshots(session_id)
    initial_state: dict = {}
    if existing_snaps:
        initial_state["snapshots"] = [
            {
                "snapshot_id": s["snapshot_id"],
                "description": s.get("description", ""),
            }
            for s in existing_snaps
        ]
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
        state=initial_state,
    )


_COMPONENT_TYPE_ICONS: dict[str, str] = {
    "database": "circle",
    "service": "label",
    "queue": "circle",
    "storage": "circle",
    "client": "label",
    "load_balancer": "label",
    "cache": "circle",
    "api_gateway": "label",
    "network": "label",
}

_MAX_AUTO_ANNOTATIONS = 5


def _annotations_from_analysis(state: WhiteboardState) -> list[dict]:
    """Convert WhiteboardState issues and components into annotation messages.

    Issues are prioritised (critical > warning > info). Components are shown
    as informational labels when there is room under the cap.
    """
    annotations: list[dict] = []

    # 1. Issues — map to the affected component's position when possible
    component_pos = {c.name: (c.x, c.y) for c in state.components}
    for issue in state.issues:
        if len(annotations) >= _MAX_AUTO_ANNOTATIONS:
            break
        # Find position from affected components
        x, y = 0.5, 0.5
        for comp_name in issue.affected_components:
            if comp_name in component_pos:
                x, y = component_pos[comp_name]
                break
        ann_type = "rectangle" if issue.severity == "critical" else "circle"
        annotations.append({
            "type": "annotation",
            "id": f"auto-issue-{len(annotations)}",
            "x": x,
            "y": y,
            "label": issue.description[:30],
            "annotationType": ann_type,
            "severity": issue.severity,
            "width": 0.12 if ann_type == "rectangle" else 0,
            "height": 0.08 if ann_type == "rectangle" else 0,
            "isSpeechLinked": False,
        })

    # 2. Components — fill remaining slots with high-confidence detections
    for comp in sorted(state.components, key=lambda c: c.confidence, reverse=True):
        if len(annotations) >= _MAX_AUTO_ANNOTATIONS:
            break
        # Skip if an issue annotation already covers this position (within 5%)
        if any(
            abs(a["x"] - comp.x) < 0.05 and abs(a["y"] - comp.y) < 0.05
            for a in annotations
        ):
            continue
        annotations.append({
            "type": "annotation",
            "id": f"auto-comp-{len(annotations)}",
            "x": comp.x,
            "y": comp.y,
            "label": comp.name,
            "annotationType": _COMPONENT_TYPE_ICONS.get(comp.component_type, "label"),
            "severity": "info",
            "width": 0,
            "height": 0,
            "isSpeechLinked": False,
        })

    return annotations


@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket, user_id: str, session_id: str
) -> None:
    await websocket.accept()
    logger.info("WebSocket connected: user=%s session=%s", user_id, session_id)

    # Ensure ADK session exists — restore persisted snapshot metadata into state
    # so the agent can reference previously saved snapshots via ToolContext.state.
    session = await session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    existing_snaps = _get_local_snapshots(session_id)
    if not session:
        initial_state: dict = {}
        if existing_snaps:
            initial_state["snapshots"] = [
                {
                    "snapshot_id": s["snapshot_id"],
                    "description": s.get("description", ""),
                }
                for s in existing_snaps
            ]
        session = await session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id,
            state=initial_state,
        )
    else:
        # Session already in memory — merge any locally-saved snapshots not yet in state
        state_snaps = session.state.get("snapshots", [])
        state_ids = {s.get("snapshot_id") for s in state_snaps}
        for ls in existing_snaps:
            if ls["snapshot_id"] not in state_ids:
                state_snaps.append({
                    "snapshot_id": ls["snapshot_id"],
                    "description": ls.get("description", ""),
                })
        if state_snaps:
            session.state["snapshots"] = state_snaps

    # Create Firestore session record
    await firestore_service.create_session_record(session_id, user_id)

    model_candidates = live_model_service.model_candidates
    active_model_index = 0
    active_model_name = model_candidates[active_model_index]
    runner = _build_runner(active_model_name)
    run_config = _build_run_config()
    live_request_queue = LiveRequestQueue()

    img_ctx = ImageContext()

    # Diagram generation guard — prevents concurrent generation
    diagram_generating = asyncio.Event()
    diagram_generating.set()  # SET = idle (not generating), CLEAR = generating
    diagram_task: list[asyncio.Task | None] = [None]

    # Response state management — prevents overlapping AI audio.
    # agent_idle is SET when the agent is not responding, CLEARED while responding.
    agent_idle = asyncio.Event()
    agent_idle.set()
    # Cooldown after turn_complete: the frontend may still be playing queued audio,
    # so block perception-layer prompts for a grace period after each turn ends.
    POST_TURN_COOLDOWN_S = 5.0
    last_turn_end_time = [0.0]
    emitted_terminal_turn_keys: list[str] = []
    emitted_terminal_turn_key_set: set[str] = set()

    # Post-interruption recovery: if no new agent turn starts within this
    # window after an interruption, assume it was a false barge-in (echo
    # leakage) and prompt the agent to resume its previous explanation.
    INTERRUPTION_RECOVERY_S = 8.0
    last_interruption_time = [0.0]

    # Diagnostic timestamps — shared across tasks for pipeline health checks
    last_upstream_audio_time = [0.0]   # Last audio frame received from client
    last_downstream_event_time = [0.0] # Last event received from Gemini

    # Audio gate: block ambient noise from reaching Gemini during agent
    # response.  Only open when the frontend signals confirmed barge-in.
    barge_in_override = [False]

    # Perception Layer state — accumulated whiteboard understanding
    current_whiteboard_state: list[WhiteboardState | None] = [None]

    def _event_turn_id(event: object) -> str | None:
        """Return a stable identifier for one model response turn."""
        invocation_id = getattr(event, "invocation_id", "")
        if invocation_id:
            return invocation_id
        interaction_id = getattr(event, "interaction_id", None)
        if interaction_id:
            return interaction_id
        event_id = getattr(event, "id", "")
        return event_id or None

    async def _emit_terminal_turn_signal(
        signal_type: str,
        turn_id: str | None,
        *,
        log_label: str,
    ) -> None:
        """Send/log a terminal turn signal once per turn.

        Gemini/ADK may emit multiple final events for the same turn. We dedupe
        them server-side so the frontend and logs don't get spammed.
        """
        agent_idle.set()
        last_turn_end_time[0] = time.monotonic()
        barge_in_override[0] = False  # Reset audio gate for next turn

        # Track interruptions for false barge-in recovery.
        # On normal turn_complete the timer is cleared; on interrupted it is
        # set so the recovery_task knows when to re-prompt.
        if signal_type == "interrupted":
            last_interruption_time[0] = time.monotonic()
        else:
            last_interruption_time[0] = 0.0

        if turn_id:
            dedupe_key = f"{signal_type}:{turn_id}"
            if dedupe_key in emitted_terminal_turn_key_set:
                return
            emitted_terminal_turn_key_set.add(dedupe_key)
            emitted_terminal_turn_keys.append(dedupe_key)
            if len(emitted_terminal_turn_keys) > 64:
                oldest_key = emitted_terminal_turn_keys.pop(0)
                emitted_terminal_turn_key_set.discard(oldest_key)

        logger.info("%s: turn=%s", log_label, turn_id)
        payload: dict[str, str] = {"type": signal_type}
        if turn_id:
            payload["turnId"] = turn_id
        await _ws_send(websocket, payload)

    async def recovery_task() -> None:
        """Monitor session health and recover from stalled states.

        Handles two failure modes that cause the agent to go silent:

        1. **False barge-in recovery**: When echo leakage triggers a false
           interruption, Gemini waits for user speech that never arrives.
           After ``INTERRUPTION_RECOVERY_S`` seconds of silence, a
           continuation prompt is injected.

        2. **Stuck response detection**: If the agent is marked busy
           (``agent_idle`` is cleared) but no Gemini events arrive for an
           extended period, log a diagnostic warning so the issue can be
           investigated.  The genai SDK's built-in WebSocket keepalive
           handles actual connection drops.
        """
        STUCK_RESPONSE_WARN_S = 30.0
        _last_stuck_warning_time = 0.0

        try:
            while True:
                await asyncio.sleep(2.0)
                now = time.monotonic()
                client_active = (now - last_upstream_audio_time[0]) < 5.0

                # ── False barge-in recovery ──
                if (
                    last_interruption_time[0] > 0
                    and agent_idle.is_set()
                    and now - last_interruption_time[0] > INTERRUPTION_RECOVERY_S
                    and now - last_turn_end_time[0] > INTERRUPTION_RECOVERY_S
                    and client_active
                ):
                    elapsed = now - last_interruption_time[0]
                    last_interruption_time[0] = 0.0
                    agent_idle.clear()
                    logger.info(
                        "Post-interruption recovery: %.1fs silence after "
                        "interruption with active client — sending "
                        "continuation prompt",
                        elapsed,
                    )
                    live_request_queue.send_content(
                        types.Content(
                            parts=[types.Part.from_text(
                                text=(
                                    "[システム通知] ユーザーが割り込みかけましたが、"
                                    "発話が確認できませんでした。"
                                    "先ほどの説明を自然に再開してください。"
                                )
                            )],
                            role="user",
                        )
                    )

                # ── Stuck response detection (diagnostic) ──
                if (
                    not agent_idle.is_set()
                    and last_downstream_event_time[0] > 0
                    and now - last_downstream_event_time[0] > STUCK_RESPONSE_WARN_S
                    and client_active
                    and now - _last_stuck_warning_time > STUCK_RESPONSE_WARN_S
                ):
                    _last_stuck_warning_time = now
                    logger.warning(
                        "Agent may be stuck: agent_idle=False but no Gemini "
                        "event for %.0fs (last_event=%.1fs ago, "
                        "last_audio=%.1fs ago, last_turn_end=%.1fs ago)",
                        STUCK_RESPONSE_WARN_S,
                        now - last_downstream_event_time[0],
                        now - last_upstream_audio_time[0],
                        now - last_turn_end_time[0],
                    )

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Recovery task error: %s", exc, exc_info=True)

    async def perception_task() -> None:
        """Background whiteboard analysis — Perception Layer (unified pipeline).

        Analyses the *active image* regardless of source (camera, snapshot,
        or upload).  The only difference is timing:
        - **Camera (live)**: analyses periodically (``analysis_interval_s``).
        - **Static (snapshot / upload)**: analyses once when the image changes.
        """
        if not config.analysis_enabled or not whiteboard_analyzer.available:
            logger.info("Perception layer disabled or analyser unavailable")
            return

        # Wait for the first image to arrive (camera frame or uploaded image)
        while not img_ctx.active_image:
            await asyncio.sleep(1.0)

        logger.info("Perception layer started (interval=%.0fs)", config.analysis_interval_s)
        consecutive_errors = 0
        first_run = True
        _MAX_BACKOFF_S = 300.0  # 5 minutes
        try:
            while True:
                # ── Timing: static images are analysed on-change; live is periodic ──
                if img_ctx.is_static:
                    if not img_ctx.has_pending_analysis():
                        await asyncio.sleep(1.0)
                        continue
                    target_version = img_ctx.image_version
                else:
                    if first_run:
                        # Skip initial wait — analyse immediately on first frame
                        first_run = False
                    elif consecutive_errors > 0:
                        # Exponential backoff on consecutive errors
                        backoff = min(
                            config.analysis_interval_s * (2 ** consecutive_errors),
                            _MAX_BACKOFF_S,
                        )
                        logger.info(
                            "Analysis backoff: %.0fs (consecutive errors: %d)",
                            backoff, consecutive_errors,
                        )
                        await asyncio.sleep(backoff)
                    else:
                        await asyncio.sleep(config.analysis_interval_s)
                    target_version = 0  # not used for live mode

                frame = img_ctx.active_image
                if not frame:
                    continue

                prev_state = current_whiteboard_state[0]
                new_state = await whiteboard_analyzer.analyze(frame, prev_state)

                # For static images, mark this version as analysed (even if
                # the image changed mid-analysis, this only advances the
                # watermark to the version we captured — newer versions will
                # still trigger another analysis).
                if target_version:
                    img_ctx.mark_version_analyzed(target_version)

                # Analysis error — notify frontend only on first occurrence,
                # then apply exponential backoff silently
                if new_state.error:
                    consecutive_errors += 1
                    if consecutive_errors == 1:
                        await _ws_send(websocket, {
                            "type": "whiteboard_analysis",
                            **new_state.to_dict(),
                        })
                    elif consecutive_errors % 10 == 0:
                        logger.warning(
                            "Analysis still failing after %d consecutive errors: %s",
                            consecutive_errors, new_state.error,
                        )
                    continue

                # Recovery from error streak
                if consecutive_errors > 0:
                    logger.info(
                        "Analysis recovered after %d consecutive errors",
                        consecutive_errors,
                    )
                    consecutive_errors = 0

                if not new_state.has_meaningful_content and (
                    prev_state is None or not prev_state.has_meaningful_content
                ):
                    # Nothing interesting on the board — skip
                    continue

                # Store in session state for the live agent to reference
                current_whiteboard_state[0] = new_state
                try:
                    adk_session = await session_service.get_session(
                        app_name=APP_NAME, user_id=user_id, session_id=session_id,
                    )
                    if adk_session:
                        adk_session.state["whiteboard_analysis"] = new_state.to_dict()
                except Exception as exc:
                    logger.debug("Could not update session state with analysis: %s", exc)

                # Notify frontend with structured analysis
                await _ws_send(websocket, {
                    "type": "whiteboard_analysis",
                    **new_state.to_dict(),
                })

                # Generate annotations from analysis results
                # Only emit on significant changes to avoid spamming the overlay
                if new_state.is_significantly_different(prev_state):
                    auto_annotations = _annotations_from_analysis(new_state)
                    for ann in auto_annotations:
                        await _ws_send(websocket, ann)
                    if auto_annotations:
                        logger.info(
                            "Auto-annotations emitted: %d (issues=%d, components=%d)",
                            len(auto_annotations),
                            len(new_state.issues),
                            len(new_state.components),
                        )

                # Inject context into live agent ONLY on significant changes
                if (
                    new_state.is_significantly_different(prev_state)
                    and agent_idle.is_set()
                    and (time.monotonic() - last_turn_end_time[0]) >= POST_TURN_COOLDOWN_S
                ):
                    context_text = new_state.to_context_summary()
                    change_desc = new_state.change_summary or "ホワイトボードの内容が更新されました"

                    agent_idle.clear()
                    logger.info("Significant whiteboard change detected — injecting context")
                    live_request_queue.send_content(
                        types.Content(
                            parts=[types.Part.from_text(text=(
                                f"[バックグラウンド分析結果] {change_desc}\n\n"
                                f"{context_text}\n\n"
                                "上記の分析結果を踏まえて、変更点や気になるポイントがあれば簡潔にコメントしてください。"
                                "変化が軽微であれば無理にコメントする必要はありません。"
                            ))],
                            role="user",
                        )
                    )

        except asyncio.CancelledError:
            logger.info("Perception task cancelled")
        except Exception as exc:
            logger.error("Perception task error: %s", exc, exc_info=True)

    async def upstream_task() -> None:
        """Read WebSocket messages and forward to LiveRequestQueue."""
        initial_greeting_sent = False

        try:
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "audio":
                    last_upstream_audio_time[0] = time.monotonic()
                    # Gate: drop ambient audio while agent is responding.
                    # Only forward when agent is idle OR frontend confirmed
                    # barge-in (user is actually speaking).
                    if not agent_idle.is_set() and not barge_in_override[0]:
                        continue
                    audio_bytes = base64.b64decode(msg["data"])
                    live_request_queue.send_realtime(
                        blob=types.Blob(
                            data=audio_bytes, mime_type="audio/pcm"
                        )
                    )

                elif msg_type == "video":
                    image_bytes = base64.b64decode(msg["data"])
                    img_ctx.on_camera_frame(image_bytes)
                    live_request_queue.send_realtime(
                        blob=types.Blob(
                            data=image_bytes, mime_type="image/jpeg"
                        )
                    )

                    # Inject initial greeting AFTER the first video frame
                    # reaches Gemini, so the agent has visual context before
                    # speaking and the live connection is confirmed active.
                    if not initial_greeting_sent:
                        initial_greeting_sent = True
                        agent_idle.clear()
                        live_request_queue.send_content(
                            types.Content(
                                parts=[types.Part.from_text(
                                    text=(
                                        "セッションが開始されました。"
                                        "ユーザーに簡潔に挨拶し、"
                                        "ホワイトボードを見せてもらうよう促してください。"
                                    )
                                )],
                                role="user",
                            )
                        )
                        logger.info("Initial greeting injected after first video frame")

                elif msg_type == "text":
                    text = msg.get("text", "")
                    if text:
                        content = types.Content(
                            parts=[types.Part.from_text(text=text)],
                            role="user",
                        )
                        live_request_queue.send_content(content)

                elif msg_type == "control":
                    action = msg.get("action", "")
                    if action == "barge_in":
                        # Frontend VAD confirmed real user speech during
                        # agent response.  Open the audio gate so the
                        # user's voice reaches Gemini for proper barge-in.
                        barge_in_override[0] = True
                        logger.info("Barge-in signal received from frontend")
                    elif action == "save_snapshot":
                        content = types.Content(
                            parts=[
                                types.Part.from_text(
                                    text="Please save a snapshot of the current whiteboard state."
                                )
                            ],
                            role="user",
                        )
                        live_request_queue.send_content(content)

                    elif action == "generate_diagram":
                        if not img_ctx.has_image:
                            await _ws_send(websocket, {
                                "type": "diagram_error",
                                "message": "表示中の画像がありません。カメラを有効にするか、スナップショットを選択してください。",
                            })
                        elif not diagram_generating.is_set():
                            await _ws_send(websocket, {
                                "type": "diagram_error",
                                "message": "図解を生成中です。完了までお待ちください。",
                            })
                        else:
                            diagram_generating.clear()
                            await _ws_send(websocket, {"type": "diagram_generating"})
                            diagram_task[0] = asyncio.create_task(
                                _handle_diagram_generation(
                                    websocket, session_id, img_ctx.active_image,
                                    msg.get("description", ""),
                                    diagram_generating,
                                )
                            )

                    elif action == "review_snapshot":
                        snapshot_id = msg.get("snapshotId", "")
                        source_hint = msg.get("origin", "snapshot")
                        if snapshot_id and _SAFE_ID_RE.match(snapshot_id):
                            local_path = SNAPSHOT_DIR / session_id / f"{snapshot_id}.jpg"
                            image_data = None
                            if local_path.exists():
                                image_data = await asyncio.to_thread(local_path.read_bytes)
                            elif storage_service.available:
                                image_data = await storage_service.download_snapshot(
                                    session_id, snapshot_id
                                )
                            if image_data:
                                img_source = (
                                    ImageSource.UPLOAD
                                    if source_hint == "upload"
                                    else ImageSource.SNAPSHOT
                                )
                                img_ctx.set_static_image(img_source, snapshot_id, image_data)

                                live_request_queue.send_realtime(
                                    blob=types.Blob(
                                        data=image_data, mime_type="image/jpeg"
                                    )
                                )
                                prompt = (
                                    "ユーザーがホワイトボードの画像をアップロードしました。"
                                    if source_hint == "upload"
                                    else "ユーザーが過去に保存したスナップショットを選択して詳しいレビューを依頼しています。"
                                )
                                live_request_queue.send_content(
                                    types.Content(
                                        parts=[types.Part.from_text(text=(
                                            f"{prompt}"
                                            "直前に送信した画像（ホワイトボードのスナップショット）を詳しく分析してください。"
                                            "描かれているアーキテクチャの構成要素、データフロー、強みと弱みを具体的に説明してください。"
                                        ))],
                                        role="user",
                                    )
                                )

                    elif action == "back_to_live":
                        img_ctx.back_to_live()

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected (upstream): user=%s", user_id)
        except Exception as exc:
            logger.error("Upstream error: %s", exc, exc_info=True)

    async def downstream_task() -> None:
        """Read events from runner.run_live() and send to WebSocket."""
        nonlocal live_request_queue, run_config, runner, active_model_index, active_model_name

        async def _gemini_events():
            """Yield events from runner.run_live with auto-retry on transient errors.

            When the Gemini Live API drops (e.g. 1011 Internal Error), this
            generator transparently reconnects using a fresh LiveRequestQueue
            while keeping the client WebSocket alive.
            """
            nonlocal live_request_queue, run_config, runner, active_model_index, active_model_name
            retries = 0
            while True:
                try:
                    async for event in runner.run_live(
                        user_id=user_id,
                        session_id=session_id,
                        live_request_queue=live_request_queue,
                        run_config=run_config,
                    ):
                        retries = 0  # Connection is healthy
                        yield event
                    return  # run_live ended cleanly
                except Exception as exc:
                    exc_str = str(exc)
                    should_switch_model = (
                        _is_gemini_model_capability_error(exc)
                        and active_model_index + 1 < len(model_candidates)
                    )
                    if should_switch_model:
                        previous_model = active_model_name
                        await live_model_service.mark_model_unsupported(previous_model, exc)
                        active_model_index += 1
                        active_model_name = model_candidates[active_model_index]
                        runner = _build_runner(active_model_name)
                        retries = 0
                        logger.warning(
                            "Gemini model fallback: %s -> %s after unsupported operation: %s",
                            previous_model,
                            active_model_name,
                            exc,
                        )
                        agent_idle.set()
                        last_turn_end_time[0] = time.monotonic()
                        last_interruption_time[0] = 0.0
                        await _ws_send(websocket, {"type": "turn_complete"})
                        await _ws_send(
                            websocket,
                            {
                                "type": "error",
                                "code": _extract_gemini_error_code(exc),
                                "message": (
                                    "Gemini Live の未対応エラーを検出したため、"
                                    f"モデルを {previous_model} から {active_model_name} に切り替えて再接続します。"
                                ),
                                "retryable": True,
                            },
                        )
                        old_q = live_request_queue
                        live_request_queue = LiveRequestQueue()
                        try:
                            old_q.close()
                        except Exception:
                            pass
                        run_config = _build_run_config()
                        try:
                            await _recreate_adk_session(user_id, session_id)
                            logger.info(
                                "Recreated ADK session after model fallback to %s",
                                active_model_name,
                            )
                        except Exception as reset_exc:
                            logger.warning(
                                "Failed to recreate session during model fallback: %s",
                                reset_exc,
                            )
                        await asyncio.sleep(0.5)
                        continue
                    if not _is_gemini_retryable(exc) or retries >= _MAX_GEMINI_RETRIES:
                        raise
                    retries += 1
                    delay = min(1.0 * (2 ** (retries - 1)), 8.0)
                    logger.warning(
                        "Gemini connection lost (attempt %d/%d), "
                        "retrying in %.1fs: %s",
                        retries, _MAX_GEMINI_RETRIES, delay, exc,
                    )
                    agent_idle.set()
                    last_turn_end_time[0] = time.monotonic()
                    last_interruption_time[0] = 0.0
                    await _ws_send(websocket, {"type": "turn_complete"})
                    await _ws_send(
                        websocket,
                        {
                            "type": "error",
                            "code": _extract_gemini_error_code(exc),
                            "message": (
                                f"Gemini Live 接続エラーのため再試行します "
                                f"({retries}/{_MAX_GEMINI_RETRIES}, model={active_model_name}): "
                                f"{exc_str[:150]}"
                            ),
                            "retryable": True,
                        },
                    )
                    # Replace queue so stale buffered data is discarded.
                    # upstream_task sees the new queue on its next iteration
                    # (Python closures capture by reference).
                    old_q = live_request_queue
                    live_request_queue = LiveRequestQueue()
                    try:
                        old_q.close()
                    except Exception:
                        pass
                    # Build fresh RunConfig to avoid stale session resumption handles
                    run_config = _build_run_config()
                    # On 1007/1008 errors (possibly corrupted session state),
                    # recreate the ADK session to clear pending tool calls
                    if "1007" in exc_str or "1008" in exc_str:
                        try:
                            await _recreate_adk_session(user_id, session_id)
                            logger.info(
                                "Recreated ADK session after %s error",
                                "1007" if "1007" in exc_str else "1008",
                            )
                        except Exception as reset_exc:
                            logger.warning("Failed to reset session: %s", reset_exc)
                    await asyncio.sleep(delay)

        # Track the current response's turn ID so anonymous events (no
        # invocation_id / interaction_id) still get a consistent turnId
        # on the frontend for proper turn retirement.
        current_response_turn_id: list[str | None] = [None]

        try:
            async for event in _gemini_events():  # noqa: E501
                last_downstream_event_time[0] = time.monotonic()
                turn_id = _event_turn_id(event)
                if turn_id:
                    current_response_turn_id[0] = turn_id
                elif current_response_turn_id[0]:
                    turn_id = current_response_turn_id[0]
                if not event.content or not event.content.parts:
                    # Handle turn-complete or interrupted signals
                    if event.is_final_response():
                        await _emit_terminal_turn_signal(
                            "turn_complete",
                            turn_id,
                            log_label="Live turn complete (empty content)",
                        )
                        current_response_turn_id[0] = None
                    continue

                is_interrupted = event.interrupted is True

                # Send interrupted signal BEFORE processing parts so the
                # frontend can stop playback before any stale audio arrives.
                if is_interrupted:
                    await _emit_terminal_turn_signal(
                        "interrupted",
                        turn_id,
                        log_label="Live turn interrupted",
                    )
                    current_response_turn_id[0] = None

                # Mark agent as busy on ANY content (text, audio, tool call).
                # This closes the race window where the change detector could
                # fire between the model starting to think and emitting audio.
                # Also clear the interruption timer — the agent responded, so
                # recovery_task does not need to fire.
                if not is_interrupted and agent_idle.is_set():
                    agent_idle.clear()
                    last_interruption_time[0] = 0.0

                for part in event.content.parts:
                    # Audio data — skip if interrupted (stale audio from
                    # the cancelled turn should not reach the frontend).
                    if (
                        part.inline_data
                        and part.inline_data.mime_type
                        and part.inline_data.mime_type.startswith("audio/")
                    ):
                        if not is_interrupted:
                            audio_b64 = base64.b64encode(
                                part.inline_data.data
                            ).decode()
                            payload: dict[str, str] = {
                                "type": "audio",
                                "data": audio_b64,
                            }
                            if turn_id:
                                payload["turnId"] = turn_id
                            await _ws_send(websocket, payload)

                    # Model thinking parts — skip sending to client
                    elif part.text and part.thought:
                        pass

                    elif part.text:
                        role = event.author or "agent"
                        await _ws_send(
                            websocket,
                            {
                                "type": "transcript",
                                "role": role,
                                "text": part.text,
                            },
                        )

                    # Function call results (tool calls)
                    elif part.function_response:
                        resp = json.loads(
                            json.dumps(
                                part.function_response.response,
                                default=str,
                            )
                        )
                        await _ws_send(
                            websocket,
                            {
                                "type": "tool_call",
                                "name": part.function_response.name,
                                "result": resp,
                            },
                        )
                        if (
                            part.function_response.name == "save_review_note"
                            and resp.get("status") == "saved"
                        ):
                            severity = resp.get("severity", "info")
                            mood_map = {
                                "critical": "concerned",
                                "warning": "thinking",
                                "info": "neutral",
                                "positive": "impressed",
                            }
                            await _ws_send(
                                websocket,
                                {
                                    "type": "agent_state",
                                    "mood": mood_map.get(severity, "neutral"),
                                    "trigger": "review_note",
                                },
                            )
                        # Generate diagram via Nano Banana 2
                        if (
                            part.function_response.name == "generate_diagram"
                            and resp.get("status") == "generating"
                        ):
                            if not img_ctx.has_image:
                                await _ws_send(websocket, {
                                    "type": "diagram_error",
                                    "message": "表示中の画像がありません。",
                                })
                            elif not diagram_generating.is_set():
                                pass  # Already generating — skip duplicate
                            else:
                                diagram_generating.clear()
                                await _ws_send(websocket, {"type": "diagram_generating"})
                                diagram_task[0] = asyncio.create_task(
                                    _handle_diagram_generation(
                                        websocket, session_id, img_ctx.active_image,
                                        resp.get("description", ""),
                                        diagram_generating,
                                    )
                                )
                        # Save snapshot image locally and notify frontend
                        if (
                            part.function_response.name == "save_whiteboard_snapshot"
                            and resp.get("status") == "saved"
                            and img_ctx.has_image
                        ):
                            snap_id = resp.get("snapshot_id", "")
                            snap_desc = resp.get("description", "")
                            await _save_snapshot_locally(
                                session_id, snap_id, img_ctx.active_image, snap_desc,
                            )
                            await _ws_send(
                                websocket,
                                {
                                    "type": "snapshot_saved",
                                    "id": snap_id,
                                    "url": f"/api/snapshots/{session_id}/{snap_id}.jpg",
                                    "description": snap_desc,
                                },
                            )

                # Persist tool results (function_response events) immediately
                await _persist_session_data(session_id, event, img_ctx)

                # Send turn_complete only if NOT interrupted — avoid sending
                # both signals for the same event (turn_complete would clear
                # the mute window that interrupted just set on the frontend).
                if not is_interrupted and event.is_final_response():
                    current_response_turn_id[0] = None
                    await _emit_terminal_turn_signal(
                        "turn_complete",
                        turn_id,
                        log_label="Live turn complete",
                    )

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected (downstream): user=%s", user_id)
        except Exception as exc:
            logger.error("Downstream error: %s", exc, exc_info=True)
            # Notify the frontend about the error
            exc_str = str(exc)
            await _ws_send(
                websocket,
                {
                    "type": "error",
                    "code": _extract_gemini_error_code(exc),
                    "message": (
                        f"Gemini Live API 接続エラーが発生しました "
                        f"(model={active_model_name}): {exc_str[:200]}"
                    ),
                    "retryable": False,
                },
            )

    up_task = asyncio.create_task(upstream_task())
    down_task = asyncio.create_task(downstream_task())
    percept_task = asyncio.create_task(perception_task())
    recover_task = asyncio.create_task(recovery_task())
    try:
        done, pending = await asyncio.wait(
            [up_task, down_task, percept_task, recover_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        for t in done:
            if not t.cancelled() and t.exception():
                logger.error("Task ended with error: %s", t.exception(), exc_info=t.exception())
    finally:
        live_request_queue.close()
        # Cancel any in-flight diagram generation
        if diagram_task[0] and not diagram_task[0].done():
            diagram_task[0].cancel()
        await firestore_service.close_session(session_id)
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Session cleaned up: user=%s session=%s", user_id, session_id)


async def _ws_send(websocket: WebSocket, data: dict) -> None:
    """Send JSON message to WebSocket, ignoring errors if already closed."""
    try:
        await websocket.send_text(json.dumps(data))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Gemini Live API retry helpers
# ---------------------------------------------------------------------------

_MAX_GEMINI_RETRIES = 5


def _extract_gemini_error_code(exc: Exception) -> str:
    """Extract a concise websocket/API code from Gemini exceptions."""
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if code is not None:
        return str(code)
    exc_str = str(exc)
    for candidate in ("1006", "1007", "1008", "1011", "1012", "1013", "429", "500", "503"):
        if candidate in exc_str:
            return candidate
    return "UNKNOWN"


def _is_gemini_model_capability_error(exc: Exception) -> bool:
    """Return True when the current model likely lacks a requested live feature."""
    exc_str = str(exc).lower()
    return "1008" in exc_str and any(
        keyword in exc_str
        for keyword in (
            "not implemented",
            "not supported",
            "not enabled",
            "operation is not implemented",
            "operation is not implemented, or supported, or enabled",
        )
    )


def _is_gemini_retryable(exc: Exception) -> bool:
    """Return True if the Gemini API exception warrants a retry."""
    exc_name = type(exc).__name__
    # google.genai.errors.APIError (e.g. 1011 Internal Error, 1006 Abnormal Closure)
    if exc_name == "APIError":
        code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        if isinstance(code, int) and code in (
            1006, 1007, 1008, 1011, 1012, 1013, 503, 429, 500,
        ):
            return True
        exc_str = str(exc).lower()
        if any(kw in exc_str for kw in (
            "1006", "1007", "1008", "1011",
            "internal error", "abnormal closure",
            "invalid argument", "not implemented",
            "keepalive", "ping timeout", "service unavailable",
        )):
            return True
    # websockets.exceptions.ConnectionClosedError
    if "connectionclosed" in exc_name.lower():
        return True
    # TimeoutError from websockets keepalive
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return True
    return False


async def _save_snapshot_locally(
    session_id: str,
    snapshot_id: str,
    image_data: bytes,
    description: str = "",
    origin: str = "camera",
) -> bool:
    """Save snapshot JPEG to local storage with metadata. Thread-safe via asyncio.Lock."""
    try:
        session_dir = SNAPSHOT_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        # Atomic write: write to .tmp then rename (prevents serving partial files)
        target = session_dir / f"{snapshot_id}.jpg"
        tmp = target.with_suffix(".tmp")
        await asyncio.to_thread(tmp.write_bytes, image_data)
        await asyncio.to_thread(tmp.rename, target)

        async with _snapshot_lock:
            metadata_path = session_dir / "metadata.json"
            metadata: list[dict] = []
            if metadata_path.exists():
                try:
                    raw = await asyncio.to_thread(metadata_path.read_text)
                    metadata = json.loads(raw)
                except (json.JSONDecodeError, OSError):
                    metadata = []

            # Avoid duplicate entries (e.g. GCS fallback re-caching)
            if not any(m["snapshot_id"] == snapshot_id for m in metadata):
                metadata.append({
                    "snapshot_id": snapshot_id,
                    "description": description,
                    "timestamp": time.time(),
                    "origin": origin,
                })

            # Enforce per-session limit (FIFO eviction)
            if len(metadata) > _MAX_SNAPSHOTS_PER_SESSION:
                evicted = metadata[:-_MAX_SNAPSHOTS_PER_SESSION]
                metadata = metadata[-_MAX_SNAPSHOTS_PER_SESSION:]
                for entry in evicted:
                    old = session_dir / f"{entry['snapshot_id']}.jpg"
                    old.unlink(missing_ok=True)

            payload = json.dumps(metadata, indent=2, ensure_ascii=False)
            await asyncio.to_thread(metadata_path.write_text, payload)

        logger.info("Saved snapshot locally: %s/%s", session_id, snapshot_id)
        return True
    except Exception as exc:
        logger.error("Failed to save snapshot locally: %s", exc)
        return False


def _get_local_snapshots(session_id: str) -> list[dict]:
    """List snapshots from local metadata (falls back to directory scan)."""
    session_dir = SNAPSHOT_DIR / session_id
    if not session_dir.is_dir():
        return []

    metadata_path = session_dir / "metadata.json"
    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text())
            return [
                {
                    "snapshot_id": m["snapshot_id"],
                    "image_url": f"/api/snapshots/{session_id}/{m['snapshot_id']}.jpg",
                    "description": m.get("description", ""),
                    "origin": m.get("origin", "camera"),
                }
                for m in metadata
            ]
        except (json.JSONDecodeError, OSError):
            pass

    # Fallback: directory scan (no descriptions available)
    return [
        {
            "snapshot_id": p.stem,
            "image_url": f"/api/snapshots/{session_id}/{p.stem}.jpg",
            "description": "",
        }
        for p in sorted(session_dir.glob("*.jpg"))
    ]


async def _handle_diagram_generation(
    websocket: WebSocket,
    session_id: str,
    image_data: bytes,
    description: str,
    generating_event: asyncio.Event | None = None,
) -> None:
    """Generate an SVG diagram from whiteboard image and send to client.

    Args:
        generating_event: If provided, SET when generation completes (success or failure)
                          to release the concurrency guard.
    """
    try:
        svg_bytes, error_text = await diagram_service.generate_diagram(
            image_data=image_data,
            description=description,
        )

        if svg_bytes:
            diagram_id = uuid.uuid4().hex[:8]
            await _save_diagram_locally(
                session_id, diagram_id, svg_bytes, ext="svg",
            )
            if storage_service.available:
                await storage_service.upload_blob(
                    f"{session_id}/diagrams/{diagram_id}.svg",
                    svg_bytes,
                    content_type="image/svg+xml",
                )
            await _ws_send(
                websocket,
                {
                    "type": "diagram_generated",
                    "id": diagram_id,
                    "url": f"/api/diagrams/{session_id}/{diagram_id}.svg",
                    "description": description or error_text,
                },
            )
        else:
            await _ws_send(
                websocket,
                {
                    "type": "diagram_error",
                    "message": error_text or "図解の生成に失敗しました。",
                },
            )
    except asyncio.CancelledError:
        logger.info("Diagram generation cancelled (session disconnected)")
    except Exception as exc:
        logger.error("Diagram generation handler failed: %s", exc, exc_info=True)
        await _ws_send(
            websocket,
            {
                "type": "diagram_error",
                "message": f"図解の生成中にエラーが発生しました: {str(exc)[:200]}",
            },
        )
    finally:
        if generating_event is not None:
            generating_event.set()


async def _save_diagram_locally(
    session_id: str, diagram_id: str, data: bytes, ext: str = "png",
) -> None:
    """Save generated diagram to local storage with FIFO eviction."""
    session_dir = DIAGRAM_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    target = session_dir / f"{diagram_id}.{ext}"
    tmp = target.with_suffix(".tmp")
    await asyncio.to_thread(tmp.write_bytes, data)
    await asyncio.to_thread(tmp.rename, target)

    # FIFO eviction: keep only the most recent diagrams per session
    existing = sorted(
        [p for p in session_dir.iterdir() if p.suffix in (".png", ".svg")],
        key=lambda p: p.stat().st_mtime,
    )
    if len(existing) > _MAX_DIAGRAMS_PER_SESSION:
        for old in existing[: len(existing) - _MAX_DIAGRAMS_PER_SESSION]:
            old.unlink(missing_ok=True)
            logger.info("Evicted old diagram: %s", old.name)

    logger.info("Saved diagram locally: %s/%s", session_id, diagram_id)


async def _persist_session_data(
    session_id: str, event, img_ctx: ImageContext
) -> None:
    """Persist tool call results to Firestore after a turn completes."""
    if not event.content or not event.content.parts:
        return

    for part in event.content.parts:
        if not part.function_response:
            continue

        name = part.function_response.name
        result = part.function_response.response or {}

        try:
            if name == "save_whiteboard_snapshot" and result.get("status") == "saved":
                snapshot_id = result.get("snapshot_id", uuid.uuid4().hex[:8])
                # GCS upload (circuit breaker handles failures internally)
                if storage_service.available and img_ctx.has_image:
                    await storage_service.upload_snapshot(
                        session_id=session_id,
                        snapshot_id=snapshot_id,
                        image_data=img_ctx.active_image,
                    )
                # Always store the stable canonical URL
                await firestore_service.save_snapshot_metadata(
                    session_id=session_id,
                    snapshot_id=snapshot_id,
                    image_url=f"/api/snapshots/{session_id}/{snapshot_id}.jpg",
                    description=result.get("description", ""),
                )
            elif name == "save_review_note" and result.get("status") == "saved":
                await firestore_service.save_review_note(
                    session_id=session_id,
                    note_id=result.get("note_id", uuid.uuid4().hex[:8]),
                    category=result.get("category", ""),
                    finding=result.get("finding", ""),
                    severity=result.get("severity", "info"),
                    recommendation=result.get("recommendation", ""),
                )
        except Exception as exc:
            logger.error("Failed to persist %s: %s", name, exc)


# ---------------------------------------------------------------------------
# Entry point for local development
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        ws="auto",
        proxy_headers=True,
        timeout_keep_alive=120,
        reload=True,
    )
