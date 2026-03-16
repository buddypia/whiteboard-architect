"""Background whiteboard analysis service using Gemini (standard API).

This service implements the Perception Layer of the Perception-Action separation
architecture. It periodically analyses camera frames using the Gemini standard
(non-Live) API and produces structured WhiteboardState objects.

Design pattern: mirrors DiagramService (lazy client, .available, asyncio.wait_for).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TypedDict

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from config import config
from whiteboard_state import WhiteboardState

logger = logging.getLogger(__name__)

_ANALYSIS_TIMEOUT_S = 30

# --- Structured Output Schema ---
# Gemini の response_schema に渡して JSON 出力を API レベルで保証する。


class _ComponentSchema(TypedDict, total=False):
    name: str
    component_type: str
    x: float
    y: float
    confidence: float


class _ConnectionSchema(TypedDict, total=False):
    source: str
    target: str
    label: str
    connection_type: str


class _IssueSchema(TypedDict, total=False):
    category: str
    severity: str
    description: str
    affected_components: list[str]


class _AnalysisResponseSchema(TypedDict, total=False):
    has_meaningful_content: bool
    summary: str
    raw_description: str
    change_summary: str
    components: list[_ComponentSchema]
    connections: list[_ConnectionSchema]
    issues: list[_IssueSchema]


# --- Prompts ---
# JSON フォーマットの指示は response_schema が保証するためプロンプトから除去。

_ANALYSIS_PROMPT = """\
あなたはシニアクラウドアーキテクトです。添付されたホワイトボードの写真を分析してください。

ルール:
- ホワイトボードに何も描かれていない、またはアーキテクチャ図でない場合は has_meaningful_content を false にする。
- コンポーネントの x, y は画像内の位置を 0.0（左上）〜 1.0（右下）の正規化座標で示す。
- component_type は service, database, queue, storage, client, load_balancer, cache, api_gateway, network, other のいずれか。
- connection_type は arrow, bidirectional, dashed のいずれか。
- issue の category は security, scalability, reliability, cost, operations のいずれか。
- issue の severity は critical, warning, info のいずれか。
- 推測でコンポーネントを追加しない。見えるものだけを報告する。
- issues は明確に問題と判断できるもののみ。不確かな場合は含めない。
"""

_DIFF_PROMPT_TEMPLATE = """\
添付のホワイトボード写真を分析してください。

前回の検出コンポーネント: {previous_components}
前回の接続: {previous_connections}

変更点を意識して分析し、change_summary に前回からの変更点を記述してください（なければ空文字列）。

ルール: 見えるものだけ報告。推測禁止。issues は明確な問題のみ。座標は 0.0-1.0 の正規化座標。
"""


def _sanitize_api_error(exc: genai_errors.ClientError) -> str:
    """Map API errors to user-safe messages without leaking credentials or internals."""
    status = getattr(exc, "status", None) or ""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", 0)
    msg = str(exc)

    if code == 400 or "INVALID_ARGUMENT" in msg:
        return "ホワイトボード分析: APIパラメータエラー（設定を確認してください）"
    if code == 401 or "UNAUTHENTICATED" in msg:
        return "ホワイトボード分析: 認証エラー（APIキーを確認してください）"
    if code == 403 or "PERMISSION_DENIED" in msg:
        return "ホワイトボード分析: アクセス権限エラー"
    if code == 429 or "RESOURCE_EXHAUSTED" in msg:
        return "ホワイトボード分析: APIレート制限に達しました。しばらく待ってから再試行します"
    if code == 503 or "UNAVAILABLE" in msg:
        return "ホワイトボード分析: サービスが一時的に利用不可です"
    return f"ホワイトボード分析: APIエラー（コード {code or status or 'unknown'}）"


class WhiteboardAnalyzer:
    """Analyses whiteboard frames using Gemini (standard API).

    This service runs independently of the Live API session, producing structured
    WhiteboardState objects that the live agent can reference.
    """

    def __init__(self) -> None:
        self._client: genai.Client | None = None
        self._available: bool | None = None

    def _get_client(self) -> genai.Client:
        if self._client is None:
            client_kwargs: dict = {
                "http_options": types.HttpOptions(api_version="v1alpha"),
            }
            if config.api_key:
                client_kwargs["api_key"] = config.api_key
            self._client = genai.Client(**client_kwargs)
        return self._client

    @property
    def available(self) -> bool:
        if self._available is None:
            try:
                self._get_client()
                self._available = True
            except Exception:
                self._available = False
        return self._available

    async def analyze(
        self,
        image_data: bytes,
        previous_state: WhiteboardState | None = None,
    ) -> WhiteboardState:
        """Analyse a whiteboard frame and return structured state.

        Args:
            image_data: JPEG bytes of the current camera frame.
            previous_state: The previous analysis result for diff detection.

        Returns:
            A WhiteboardState representing the current whiteboard contents.
        """
        try:
            client = self._get_client()

            if previous_state and previous_state.has_meaningful_content:
                prev_comps = ", ".join(
                    f"{c.name}({c.component_type})" for c in previous_state.components
                ) or "なし"
                prev_conns = ", ".join(
                    f"{c.source}→{c.target}" for c in previous_state.connections
                ) or "なし"
                prompt = _DIFF_PROMPT_TEMPLATE.format(
                    previous_components=prev_comps,
                    previous_connections=prev_conns,
                )
            else:
                prompt = _ANALYSIS_PROMPT

            image_part = types.Part.from_bytes(data=image_data, mime_type="image/jpeg")
            text_part = types.Part.from_text(text=prompt)

            generation_config: dict = {
                "response_mime_type": "application/json",
                "response_schema": _AnalysisResponseSchema,
                "temperature": 0.1,
            }
            # thinking_budget と thinking_level は排他（API制約）。
            # budget > 0 を優先し、budget == 0 かつ level 指定時のみ level を使用。
            if config.analysis_thinking_budget > 0:
                generation_config["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=config.analysis_thinking_budget,
                )
            elif config.analysis_thinking_level:
                generation_config["thinking_config"] = types.ThinkingConfig(
                    thinking_level=config.analysis_thinking_level,
                )
            if config.analysis_media_resolution:
                _resolution_map = {
                    "low": "MEDIA_RESOLUTION_LOW",
                    "medium": "MEDIA_RESOLUTION_MEDIUM",
                    "high": "MEDIA_RESOLUTION_HIGH",
                }
                resolved = _resolution_map.get(
                    config.analysis_media_resolution.lower(),
                    config.analysis_media_resolution,
                )
                generation_config["media_resolution"] = resolved

            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=config.analysis_model_name,
                    contents=types.Content(parts=[image_part, text_part]),
                    config=types.GenerateContentConfig(**generation_config),
                ),
                timeout=_ANALYSIS_TIMEOUT_S,
            )

            if not response.candidates:
                logger.warning("Whiteboard analysis returned no candidates")
                return WhiteboardState.empty()

            response_text = ""
            for part in response.candidates[0].content.parts:
                if part.text and not getattr(part, "thought", False):
                    response_text += part.text

            if not response_text.strip():
                logger.warning("Whiteboard analysis returned empty text")
                return WhiteboardState.empty()

            parsed = json.loads(response_text)
            state = WhiteboardState.from_dict(parsed)
            logger.info(
                "Whiteboard analysis complete: %d components, %d connections, %d issues, meaningful=%s",
                len(state.components),
                len(state.connections),
                len(state.issues),
                state.has_meaningful_content,
            )
            return state

        except asyncio.TimeoutError:
            logger.error("Whiteboard analysis timed out after %ds", _ANALYSIS_TIMEOUT_S)
            return WhiteboardState.empty(
                error=f"ホワイトボード分析がタイムアウトしました（{_ANALYSIS_TIMEOUT_S}秒）"
            )
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse analysis JSON: %s", exc)
            return WhiteboardState.empty(
                error="ホワイトボード分析結果の解析に失敗しました"
            )
        except genai_errors.ClientError as exc:
            logger.error("Whiteboard analysis API error: %s", exc, exc_info=True)
            return WhiteboardState.empty(
                error=_sanitize_api_error(exc),
            )
        except Exception as exc:
            logger.error("Whiteboard analysis failed: %s", exc, exc_info=True)
            return WhiteboardState.empty(
                error="ホワイトボード分析で予期しないエラーが発生しました"
            )
