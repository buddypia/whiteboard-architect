"""Diagram generation service — produces SVG from whiteboard photos via Gemini.

Uses a fast text model to generate SVG code (3-7 seconds) instead of image
generation models (30-90 seconds).  The SVG is sanitised to remove script
tags before serving.
"""

from __future__ import annotations

import asyncio
import logging
import re

from google import genai
from google.genai import types

from config import config

logger = logging.getLogger(__name__)

_MODEL_ID = "gemini-2.0-flash"
_GENERATION_TIMEOUT_S = 30

_DIAGRAM_PROMPT = """\
You are a professional architecture diagram designer.

Analyse the attached whiteboard photo and generate a clean SVG diagram that \
faithfully represents the system architecture drawn on it.

Output ONLY valid SVG code — no markdown fences, no explanation.

SVG requirements:
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
- Modern flat design: rounded rectangles with fill colours for components
- Colour palette: #3B82F6 (services), #10B981 (databases/storage), \
#F59E0B (queues/caches), #EF4444 (critical), #6366F1 (external/3rd-party), \
#8B5CF6 (API gateways), #64748B (networks/misc)
- White (#fff) text on coloured backgrounds; dark (#1e293b) text for standalone labels
- Arrows with arrowhead markers (<marker>) for connections
- Connection labels in small grey text along the path
- Keep ALL labels from the whiteboard (preserve Japanese text as-is)
- White background rectangle as first element
- Use <defs> for reusable markers/filters
- font-family: system-ui, sans-serif
"""


def _sanitise_svg(raw: str) -> str | None:
    """Extract and sanitise SVG from model output.

    Strips markdown fences, removes <script> tags, and validates
    basic SVG structure.
    """
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Must contain an <svg element
    if "<svg" not in text:
        return None

    # Extract from <svg...> to </svg>
    match = re.search(r"(<svg[\s\S]*?</svg>)", text, re.IGNORECASE)
    if not match:
        return None
    svg = match.group(1)

    # Security: strip <script> tags
    svg = re.sub(r"<script[\s\S]*?</script>", "", svg, flags=re.IGNORECASE)
    svg = re.sub(r"on\w+\s*=\s*[\"'][^\"']*[\"']", "", svg, flags=re.IGNORECASE)

    # Ensure xmlns is present
    if "xmlns" not in svg:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)

    return svg


class DiagramService:
    """Generates architecture diagram SVGs from whiteboard photos."""

    def __init__(self) -> None:
        self._client: genai.Client | None = None
        self._available: bool | None = None

    def _get_client(self) -> genai.Client:
        if self._client is None:
            client_kwargs: dict = {}
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

    async def generate_diagram(
        self,
        image_data: bytes,
        description: str = "",
    ) -> tuple[bytes | None, str]:
        """Generate an SVG diagram from a whiteboard photo.

        Args:
            image_data: JPEG bytes of the whiteboard photo.
            description: Optional description/context for the diagram.

        Returns:
            Tuple of (svg_bytes, description_text).
            svg_bytes is None if generation failed.
        """
        try:
            client = self._get_client()

            prompt = _DIAGRAM_PROMPT
            if description:
                prompt += f"\n\nAdditional context: {description}"

            image_part = types.Part.from_bytes(data=image_data, mime_type="image/jpeg")
            text_part = types.Part.from_text(text=prompt)

            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=_MODEL_ID,
                    contents=types.Content(parts=[image_part, text_part]),
                    config=types.GenerateContentConfig(
                        response_modalities=["TEXT"],
                        temperature=0.2,
                    ),
                ),
                timeout=_GENERATION_TIMEOUT_S,
            )

            response_text = ""
            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if part.text and not getattr(part, "thought", False):
                        response_text += part.text

            svg = _sanitise_svg(response_text)
            if svg:
                svg_bytes = svg.encode("utf-8")
                logger.info("SVG diagram generated (%d bytes)", len(svg_bytes))
                return svg_bytes, ""

            logger.warning("Diagram generation returned no valid SVG")
            return None, "図解のSVG生成に失敗しました。もう一度お試しください。"

        except asyncio.TimeoutError:
            logger.error("Diagram generation timed out after %ds", _GENERATION_TIMEOUT_S)
            return None, f"図解の生成がタイムアウトしました（{_GENERATION_TIMEOUT_S}秒）。"
        except Exception as exc:
            logger.error("Diagram generation failed: %s", exc, exc_info=True)
            return None, f"図解の生成に失敗しました: {exc}"
