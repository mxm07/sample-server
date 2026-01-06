from __future__ import annotations

import mimetypes
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from sample_server.config import Settings


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_library_root() -> Path:
    settings = get_settings()
    root = settings.library_path.expanduser().resolve()
    if not root.exists():
        raise RuntimeError(f"Library path does not exist: {root}")
    if not root.is_dir():
        raise RuntimeError(f"Library path is not a directory: {root}")
    return root


LIBRARY_ROOT = ensure_library_root()
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CLIENT_DIR = PROJECT_ROOT / "client"


app = FastAPI(title="Sample Server", version="0.1.0")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def normalize_relative_path(raw_path: str | None) -> Path:
    if not raw_path:
        return Path("")
    sanitized = raw_path.strip().lstrip("/").replace("\\", "/")
    pure = PurePosixPath(sanitized)
    return Path(*pure.parts)


def resolve_safe_path(raw_path: str | None) -> Path:
    rel = normalize_relative_path(raw_path)
    candidate = (LIBRARY_ROOT / rel).resolve()
    if not candidate.is_relative_to(LIBRARY_ROOT):
        raise HTTPException(status_code=403, detail="Invalid path")
    return candidate


def to_relative_posix(path: Path) -> str:
    relative = path.relative_to(LIBRARY_ROOT)
    return relative.as_posix()


def directory_audio_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        try:
            if not child.is_file():
                continue
            if child.suffix.lower() not in settings.audio_extensions:
                continue
            total += child.stat().st_size
        except OSError:
            continue
    return total


def entry_info(entry: Path) -> dict[str, Any]:
    stat = entry.stat()
    ext = entry.suffix.lower()
    if entry.is_dir():
        size = directory_audio_size(entry)
    else:
        size = stat.st_size
    return {
        "name": entry.name,
        "path": to_relative_posix(entry),
        "is_dir": entry.is_dir(),
        "size": size,
        "modified": int(stat.st_mtime),
        "is_audio": entry.is_file() and ext in settings.audio_extensions,
    }


def build_audio_zip(target: Path) -> Path:
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_path = Path(temp_file.name)
    temp_file.close()

    file_count = 0
    with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in target.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in settings.audio_extensions:
                continue
            archive_name = path.relative_to(target).as_posix()
            archive.write(path, archive_name)
            file_count += 1

    if file_count == 0:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=404, detail="No audio files found in folder")

    return temp_path


@app.get("/api/list")
def list_directory(path: str | None = Query(default=None)) -> dict[str, Any]:
    target = resolve_safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    entries = []
    for entry in target.iterdir():
        try:
            entries.append(entry_info(entry))
        except OSError:
            continue

    entries.sort(key=lambda item: (not item["is_dir"], item["name"].lower()))
    return {
        "path": to_relative_posix(target) if target != LIBRARY_ROOT else "",
        "entries": entries,
    }


@app.get("/api/file")
def stream_file(path: str = Query(...)) -> FileResponse:
    target = resolve_safe_path(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(target, media_type=media_type or "application/octet-stream")


@app.get("/api/download")
def download_file(path: str = Query(...)) -> FileResponse:
    target = resolve_safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if target.is_dir():
        archive_path = build_audio_zip(target)
        filename = f"{target.name or 'samples'}.zip"
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename=filename,
            background=BackgroundTask(lambda: archive_path.unlink(missing_ok=True)),
        )

    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(
        target,
        media_type=media_type or "application/octet-stream",
        filename=target.name,
    )


@app.get("/")
def index() -> FileResponse:
    index_path = CLIENT_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=500, detail="UI not found")
    return FileResponse(index_path)


@app.get("/config.js")
def ui_config() -> FileResponse:
    config_path = CLIENT_DIR / "config.js"
    return FileResponse(config_path)


@app.get("/app.js")
def ui_app() -> FileResponse:
    app_path = CLIENT_DIR / "app.js"
    return FileResponse(app_path)


@app.get("/styles.css")
def ui_styles() -> FileResponse:
    styles_path = CLIENT_DIR / "styles.css"
    return FileResponse(styles_path)


@app.exception_handler(RuntimeError)
def runtime_error_handler(_, exc: RuntimeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})
