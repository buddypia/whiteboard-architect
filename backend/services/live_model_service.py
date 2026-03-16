"""Runtime selection for Gemini Live models that work with this ADK workflow."""

from __future__ import annotations

import asyncio
import io
import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from PIL import Image
from google.adk.agents import Agent
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.models.google_llm import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent import build_speech_config

logger = logging.getLogger(__name__)

_PROBE_APP_NAME = "whiteboard-architect-live-probe"
_PROBE_TIMEOUT_S = 25.0
_KNOWN_UNSUPPORTED_MODELS: dict[str, str] = {
    # This preview currently trips a 1008 policy violation during tool use in
    # the app's ADK live workflow. Keep it out of rotation until Google fixes it.
    "gemini-2.5-flash-native-audio-preview-12-2025": (
        "Known incompatible Live API preview for ADK tool-calling workflow."
    ),
}


def _build_probe_image_jpeg() -> bytes:
    image = Image.new("RGB", (8, 8), color=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def probe_live_capability(note: str) -> dict[str, str]:
    """No-op tool used to verify Live API tool calling support."""
    return {"status": "ok", "note": note}


@dataclass(frozen=True)
class ModelProbeResult:
    status: Literal["supported", "unsupported", "unknown"]
    detail: str = ""
    error_code: str | None = None


def _extract_error_code(exc: Exception) -> str:
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if code is not None:
        return str(code)
    exc_str = str(exc)
    for candidate in ("1006", "1007", "1008", "1011", "1012", "1013", "429", "500", "503"):
        if candidate in exc_str:
            return candidate
    return "UNKNOWN"


def _is_capability_error(exc: Exception) -> bool:
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


class LiveModelService:
    """Filters model candidates down to those that support the current live workflow."""

    def __init__(self, model_candidates: list[str]):
        self._configured_candidates = [candidate for candidate in model_candidates if candidate]
        self._effective_candidates = self._configured_candidates.copy()
        self._probe_results: dict[str, ModelProbeResult] = {}
        self._initialized = False
        self._lock = asyncio.Lock()

    @property
    def configured_candidates(self) -> list[str]:
        return self._configured_candidates.copy()

    @property
    def model_candidates(self) -> list[str]:
        if self._effective_candidates:
            return self._effective_candidates.copy()
        return self._configured_candidates.copy()

    @property
    def active_model(self) -> str:
        candidates = self.model_candidates
        return candidates[0] if candidates else ""

    @property
    def probe_results(self) -> dict[str, dict[str, str | None]]:
        return {
            model_name: {
                "status": result.status,
                "detail": result.detail,
                "error_code": result.error_code,
            }
            for model_name, result in self._probe_results.items()
        }

    async def initialize(self) -> None:
        async with self._lock:
            if self._initialized or not self._configured_candidates:
                self._initialized = True
                return

            effective_candidates = self._configured_candidates.copy()
            for index, model_name in enumerate(self._configured_candidates):
                if model_name in _KNOWN_UNSUPPORTED_MODELS:
                    self._probe_results[model_name] = ModelProbeResult(
                        status="unsupported",
                        detail=_KNOWN_UNSUPPORTED_MODELS[model_name],
                    )
                    effective_candidates = [
                        candidate
                        for candidate in effective_candidates
                        if candidate != model_name
                    ]
                    continue

                result = await self._probe_candidate(model_name)
                self._probe_results[model_name] = result
                if result.status == "unsupported":
                    effective_candidates = [
                        candidate
                        for candidate in effective_candidates
                        if candidate != model_name
                    ]
                    continue

                # Once we find the first candidate that is usable in practice,
                # keep it as the primary model and leave later fallbacks intact.
                self._effective_candidates = [
                    model_name,
                    *[
                        candidate
                        for candidate in self._configured_candidates[index + 1:]
                        if candidate != model_name and candidate not in _KNOWN_UNSUPPORTED_MODELS
                    ],
                ]
                for candidate in self._configured_candidates[index + 1:]:
                    if candidate in _KNOWN_UNSUPPORTED_MODELS:
                        self._probe_results[candidate] = ModelProbeResult(
                            status="unsupported",
                            detail=_KNOWN_UNSUPPORTED_MODELS[candidate],
                        )
                self._initialized = True
                logger.info(
                    "Gemini live model candidates resolved: configured=%s effective=%s",
                    self._configured_candidates,
                    self._effective_candidates,
                )
                return

            if effective_candidates:
                self._effective_candidates = effective_candidates

            self._initialized = True
            logger.info(
                "Gemini live model candidates resolved: configured=%s effective=%s",
                self._configured_candidates,
                self._effective_candidates,
            )

    async def mark_model_unsupported(self, model_name: str, exc: Exception) -> None:
        async with self._lock:
            self._probe_results[model_name] = ModelProbeResult(
                status="unsupported",
                detail=str(exc),
                error_code=_extract_error_code(exc),
            )
            self._effective_candidates = [
                candidate
                for candidate in self._effective_candidates
                if candidate != model_name
            ]
            if not self._effective_candidates:
                self._effective_candidates = [
                    candidate
                    for candidate in self._configured_candidates
                    if candidate != model_name
                ]

    async def _probe_candidate(self, model_name: str) -> ModelProbeResult:
        session_service = InMemorySessionService()
        session_id = f"probe-{uuid.uuid4()}"
        user_id = "system"
        runner = Runner(
            app_name=_PROBE_APP_NAME,
            agent=self._build_probe_agent(model_name),
            session_service=session_service,
        )
        live_request_queue = LiveRequestQueue()
        saw_tool_response = False
        saw_model_event = False
        consumer_task: asyncio.Task[None] | None = None

        try:
            await session_service.create_session(
                app_name=_PROBE_APP_NAME,
                user_id=user_id,
                session_id=session_id,
            )

            async def consume_events() -> None:
                nonlocal saw_tool_response, saw_model_event
                run_config = RunConfig(
                    streaming_mode=StreamingMode.BIDI,
                    response_modalities=["AUDIO"],
                    output_audio_transcription=types.AudioTranscriptionConfig(),
                    input_audio_transcription=types.AudioTranscriptionConfig(),
                )
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session_id,
                    live_request_queue=live_request_queue,
                    run_config=run_config,
                ):
                    if not event.content or not event.content.parts:
                        continue
                    saw_model_event = True
                    for part in event.content.parts:
                        if (
                            part.function_response
                            and part.function_response.name == "probe_live_capability"
                        ):
                            saw_tool_response = True
                            return

            consumer_task = asyncio.create_task(consume_events())
            await asyncio.sleep(1.0)
            live_request_queue.send_realtime(
                types.Blob(data=_build_probe_image_jpeg(), mime_type="image/jpeg")
            )
            live_request_queue.send_content(
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=(
                            "接続検証です。最初に必ず probe_live_capability ツールを 1 回だけ呼び、"
                            "note には ok を設定してください。その後は『完了』とだけ返答してください。"
                        ))
                    ],
                )
            )
            await asyncio.wait_for(consumer_task, timeout=_PROBE_TIMEOUT_S)

            if saw_tool_response:
                return ModelProbeResult(status="supported")
            if saw_model_event:
                return ModelProbeResult(
                    status="unknown",
                    detail="Probe completed without a tool response.",
                )
            return ModelProbeResult(
                status="unknown",
                detail="Probe timed out before receiving a model event.",
            )
        except asyncio.TimeoutError:
            if saw_tool_response:
                return ModelProbeResult(status="supported")
            detail = "Probe timed out before tool execution completed."
            if saw_model_event:
                return ModelProbeResult(status="unknown", detail=detail)
            return ModelProbeResult(status="unknown", detail="Probe timed out before model output.")
        except Exception as exc:
            if _is_capability_error(exc):
                logger.warning(
                    "Gemini live model marked unsupported during probe: model=%s error=%s",
                    model_name,
                    exc,
                )
                return ModelProbeResult(
                    status="unsupported",
                    detail=str(exc),
                    error_code=_extract_error_code(exc),
                )
            logger.warning(
                "Gemini live model probe was inconclusive: model=%s error=%s",
                model_name,
                exc,
            )
            return ModelProbeResult(
                status="unknown",
                detail=str(exc),
                error_code=_extract_error_code(exc),
            )
        finally:
            live_request_queue.close()
            if consumer_task and not consumer_task.done():
                consumer_task.cancel()
                try:
                    await consumer_task
                except asyncio.CancelledError:
                    pass

    def _build_probe_agent(self, model_name: str) -> Agent:
        return Agent(
            name="live_probe",
            model=Gemini(
                model=model_name,
                speech_config=build_speech_config(model_name),
            ),
            instruction=(
                "あなたは接続検証用エージェントです。"
                "ユーザーが probe_live_capability の実行を求めたら、必ず最初に 1 回だけ実行し、"
                "その後は短く完了を伝えてください。"
            ),
            description="Gemini Live capability probe agent.",
            tools=[probe_live_capability],
        )
