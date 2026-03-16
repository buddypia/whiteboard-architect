"""Translation service using Gemini 3.1 Flash-Lite Preview."""

from __future__ import annotations

import asyncio
import logging

from google import genai
from google.genai import types

from config import config

logger = logging.getLogger(__name__)

_TRANSLATION_MODEL = "gemini-3.1-flash-lite-preview"
_TRANSLATION_TIMEOUT_S = 15

_TRANSLATE_PROMPT = """\
Translate the following English text into natural Japanese.

Rules:
- Output ONLY the Japanese translation, nothing else.
- PRESERVE all Markdown formatting exactly as-is: **bold**, *italic*, headings (#), lists (- or 1.), code (`...`), etc.
- If the original has **bold section titles**, the translation MUST also wrap the translated title in **bold**.
- Do not add explanations.

Text:
{text}
"""


class TranslationService:
    """Translates text using Gemini 3.1 Flash-Lite Preview."""

    def __init__(self) -> None:
        self._client: genai.Client | None = None

    def _get_client(self) -> genai.Client:
        if self._client is None:
            client_kwargs: dict = {}
            if config.api_key:
                client_kwargs["api_key"] = config.api_key
            self._client = genai.Client(**client_kwargs)
        return self._client

    async def translate(self, text: str, source_lang: str = "en", target_lang: str = "ja") -> str:
        """Translate text from source language to target language.

        Returns the translated text, or the original text on failure.
        """
        if not text.strip():
            return text

        try:
            client = self._get_client()

            if source_lang == "en" and target_lang == "ja":
                prompt = _TRANSLATE_PROMPT.format(text=text)
            else:
                prompt = (
                    f"Translate the following {source_lang} text into {target_lang}. "
                    f"Output ONLY the translation, nothing else.\n\nText:\n{text}"
                )

            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=_TRANSLATION_MODEL,
                    contents=types.Content(
                        parts=[types.Part.from_text(text=prompt)]
                    ),
                    config=types.GenerateContentConfig(
                        response_modalities=["TEXT"],
                        temperature=0.1,
                    ),
                ),
                timeout=_TRANSLATION_TIMEOUT_S,
            )

            if not response.candidates:
                logger.warning("Translation returned no candidates")
                return text

            result = ""
            for part in response.candidates[0].content.parts:
                if part.text:
                    result += part.text

            return result.strip() if result.strip() else text

        except asyncio.TimeoutError:
            logger.warning("Translation timed out after %ss", _TRANSLATION_TIMEOUT_S)
            return text
        except Exception as exc:
            logger.warning("Translation failed: %s", exc)
            return text
