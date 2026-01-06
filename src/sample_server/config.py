from __future__ import annotations

from pathlib import Path
from typing import Iterable

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_AUDIO_EXTENSIONS = {
    ".wav",
    ".aiff",
    ".aif",
    ".flac",
    ".mp3",
    ".ogg",
    ".m4a",
    ".aac",
    ".opus",
    ".wma",
    ".alac",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SAMPLE_SERVER_", case_sensitive=False)

    library_path: Path = Field(..., description="Root path of the sample library")
    audio_extensions: set[str] = Field(default_factory=lambda: set(DEFAULT_AUDIO_EXTENSIONS))
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    search_cache_seconds: int = Field(default=60, ge=0)
    search_max_results: int = Field(default=120, ge=1)

    @field_validator("library_path", mode="before")
    @classmethod
    def _expand_library_path(cls, value: str | Path) -> Path:
        return Path(value).expanduser()

    @field_validator("audio_extensions", mode="before")
    @classmethod
    def _parse_audio_extensions(cls, value: Iterable[str] | str) -> set[str]:
        if isinstance(value, str):
            items = [item.strip().lower() for item in value.split(",") if item.strip()]
            return {item if item.startswith(".") else f".{item}" for item in items}
        return {item.lower() for item in value}

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Iterable[str] | str) -> list[str]:
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",") if item.strip()]
            return items or ["*"]
        return list(value)
