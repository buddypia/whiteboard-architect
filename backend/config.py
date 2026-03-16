"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025"
_DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash-native-audio-preview-12-2025"]


def _parse_csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return default.copy()
    values = [item.strip() for item in raw.split(",")]
    return [item for item in values if item]


@dataclass(frozen=True)
class Config:
    # Google Cloud
    project_id: str = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    region: str = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_REGION", "us-central1"))
    api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY", ""))

    # Gemini Model
    # Live API の latest エイリアスは中身が切り替わるため、
    # 既定値は検証済みの固定バージョンを使う。
    model_name: str = field(
        default_factory=lambda: os.getenv(
            "GEMINI_MODEL_NAME", _DEFAULT_GEMINI_MODEL
        )
    )
    fallback_model_names: list[str] = field(
        default_factory=lambda: _parse_csv_env(
            "GEMINI_FALLBACK_MODEL_NAMES",
            _DEFAULT_GEMINI_FALLBACK_MODELS,
        )
    )

    # Audio settings
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000

    # Video settings
    video_fps: int = 1

    # Firestore
    firestore_database: str = field(default_factory=lambda: os.getenv("FIRESTORE_DATABASE", "(default)"))

    # Cloud Storage
    gcs_bucket_name: str = field(default_factory=lambda: os.getenv("GCS_BUCKET_NAME", ""))

    # Server
    host: str = field(default_factory=lambda: os.getenv("BACKEND_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("BACKEND_PORT", "8080")))

    # Background whiteboard analysis (Perception Layer)
    analysis_enabled: bool = field(
        default_factory=lambda: os.getenv("ANALYSIS_ENABLED", "true").lower() == "true"
    )
    analysis_interval_s: float = field(
        default_factory=lambda: float(os.getenv("ANALYSIS_INTERVAL_S", "10.0"))
    )
    analysis_model_name: str = field(
        default_factory=lambda: os.getenv("ANALYSIS_MODEL_NAME", "gemini-3.1-flash-lite-preview")
    )
    # thinking_budget と thinking_level は排他（API制約）。
    # budget > 0 なら budget を使用、budget == 0 かつ level が設定されていれば level を使用。
    analysis_thinking_level: str = field(
        default_factory=lambda: os.getenv("ANALYSIS_THINKING_LEVEL", "")
    )
    analysis_thinking_budget: int = field(
        default_factory=lambda: int(os.getenv("ANALYSIS_THINKING_BUDGET", "512"))
    )
    analysis_media_resolution: str = field(
        default_factory=lambda: os.getenv("ANALYSIS_MEDIA_RESOLUTION", "medium")
    )

    # CORS
    cors_origins: list[str] = field(default_factory=lambda: os.getenv("CORS_ORIGINS", "*").split(","))

    @property
    def model_candidates(self) -> list[str]:
        ordered = [self.model_name, *self.fallback_model_names]
        deduped: list[str] = []
        for model_name in ordered:
            if model_name and model_name not in deduped:
                deduped.append(model_name)
        return deduped


config = Config()
