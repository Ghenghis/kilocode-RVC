"""
KiloCode Edge-TTS Server for VPS deployment.
Provides text-to-speech via Microsoft Edge neural voices and serves RVC model files.
Runs on CPU only -- no GPU required.
"""

import asyncio
import io
import json
import os
from pathlib import Path
from typing import Optional

import edge_tts
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
PORT = int(os.environ.get("PORT", 5050))

# Voice catalog and preview directories
RVC_BASE = Path(os.environ.get("RVC_BASE", "/opt/rvc-models"))
CATALOG_FILE = RVC_BASE / "catalog.json"
PREVIEWS_DIR = RVC_BASE / "previews"

# Disk quota
MAX_DISK_BYTES = 100 * 1024 * 1024 * 1024  # 100 GB
MODEL_EXTENSIONS = {".pth", ".onnx", ".safetensors", ".pt", ".ckpt"}

app = FastAPI(title="KiloCode Edge-TTS Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Cache for edge-tts voice list -- fetched once and reused
# ---------------------------------------------------------------------------
_voices_cache: Optional[list] = None
_voices_cache_lock = asyncio.Lock()


async def _get_voices() -> list:
    global _voices_cache
    async with _voices_cache_lock:
        if _voices_cache is None:
            _voices_cache = await edge_tts.list_voices()
        return _voices_cache


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    """Health check endpoint."""
    model_count = 0
    if MODELS_DIR.exists():
        model_count = len([f for f in MODELS_DIR.glob("*.pth")])
    return {
        "status": "ok",
        "models_dir": str(MODELS_DIR),
        "model_count": model_count,
    }


@app.get("/voices")
async def list_voices():
    """Return all available edge-tts voices (cached after first call)."""
    voices = await _get_voices()
    return voices


@app.post("/synthesize")
async def synthesize(
    text: str = Query(..., description="Text to synthesize"),
    voice: str = Query("en-GB-MaisieNeural", description="Edge-TTS voice name"),
    rate: str = Query("+0%", description="Speech rate adjustment, e.g. +20% or -10%"),
    pitch: str = Query("+0Hz", description="Pitch adjustment, e.g. +50Hz or -20Hz"),
):
    """Synthesize text to speech using edge-tts. Returns audio/mpeg."""
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")

    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Text exceeds 5000 character limit")

    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio_buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])
        audio_buffer.seek(0)

        if audio_buffer.getbuffer().nbytes == 0:
            raise HTTPException(status_code=500, detail="Edge-TTS returned empty audio")

        return Response(
            content=audio_buffer.read(),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": 'inline; filename="speech.mp3"',
            },
        )
    except edge_tts.exceptions.NoAudioReceived:
        raise HTTPException(
            status_code=502,
            detail=f"No audio received from edge-tts for voice '{voice}'",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/models")
async def list_models():
    """List available RVC model .pth files in the models directory."""
    if not MODELS_DIR.exists():
        return []

    models = []
    for pth_file in sorted(MODELS_DIR.rglob("*.pth")):
        rel_path = pth_file.relative_to(MODELS_DIR)
        stat = pth_file.stat()
        models.append({
            "name": pth_file.stem,
            "filename": str(rel_path),
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
        })
    return models


@app.get("/models/{name:path}")
async def download_model(name: str):
    """Download a specific model file by name (with or without .pth extension).

    Search order:
    1. MODELS_DIR/{name}.pth          — flat .pth files in the Docker /models dir
    2. RVC_BASE/models/rvc-voices/{name}/ — voice directory with .pth inside
    3. RVC_BASE/models/{name}/        — top-level voice directory
    4. MODELS_DIR/{name}              — exact filename (may include extension)
    """
    # Prevent path traversal
    clean = name.replace("\\", "/")
    if ".." in clean or clean.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid model name")

    base_name = clean.rstrip(".pth") if clean.endswith(".pth") else clean

    # --- Search order for the model file ---
    candidates: list[Path] = []

    # 1. Flat .pth in MODELS_DIR
    candidates.append(MODELS_DIR / f"{base_name}.pth")

    # 2. RVC voice directory (rvc-voices/{name}/*.pth)
    rvc_dir = RVC_BASE / "models" / "rvc-voices" / base_name
    if rvc_dir.exists() and rvc_dir.is_dir():
        pth_files = sorted(rvc_dir.glob("*.pth"), key=lambda p: p.stat().st_size, reverse=True)
        candidates.extend(pth_files)

    # 3. Top-level voice directory
    top_dir = RVC_BASE / "models" / base_name
    if top_dir.exists() and top_dir.is_dir():
        pth_files = sorted(top_dir.glob("*.pth"), key=lambda p: p.stat().st_size, reverse=True)
        candidates.extend(pth_files)

    # 4. Exact filename in MODELS_DIR
    candidates.append(MODELS_DIR / clean)
    if not clean.endswith(".pth"):
        candidates.append(MODELS_DIR / f"{clean}.pth")

    # Allowed base directories for path-traversal verification
    allowed_bases = [MODELS_DIR.resolve(), (RVC_BASE / "models").resolve()]

    model_path: Path | None = None
    for cand in candidates:
        if not cand.exists() or not cand.is_file():
            continue
        resolved = cand.resolve()
        if any(str(resolved).startswith(str(base)) for base in allowed_bases):
            model_path = cand
            break

    if model_path is None:
        raise HTTPException(status_code=404, detail=f"Model '{name}' not found")

    def file_iterator():
        with open(model_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        file_iterator(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{model_path.name}"',
            "Content-Length": str(model_path.stat().st_size),
        },
    )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class PreviewRequest(BaseModel):
    modelId: str
    text: str


# ---------------------------------------------------------------------------
# Catalog endpoints
# ---------------------------------------------------------------------------


@app.get("/catalog")
async def get_catalog(
    page: Optional[int] = Query(None, description="Page number (1-based)"),
    limit: Optional[int] = Query(None, description="Items per page"),
):
    """Return the voice catalog with optional pagination."""
    if not CATALOG_FILE.exists():
        raise HTTPException(status_code=404, detail="catalog.json not found")

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    # catalog may be a dict with a "voices" key, or a plain list
    if isinstance(catalog, dict):
        voices = catalog.get("voices", [])
    else:
        voices = catalog

    total = len(voices)

    if limit is not None and limit > 0:
        p = max(1, page if page is not None else 1)
        start = (p - 1) * limit
        end = start + limit
        voices_page = voices[start:end]
        return {
            "voices": voices_page,
            "total": total,
            "page": p,
            "limit": limit,
        }

    return {"voices": voices, "total": total}


@app.get("/catalog/search")
async def search_catalog(
    q: Optional[str] = Query(None, description="Search query"),
):
    """Fuzzy search the voice catalog. Scores: name 10x, tag 5x, description 2x, other 1x."""
    if not CATALOG_FILE.exists():
        raise HTTPException(status_code=404, detail="catalog.json not found")

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    if isinstance(catalog, dict):
        voices = catalog.get("voices", [])
    else:
        voices = catalog

    if not q or not q.strip():
        return {"voices": voices, "total": len(voices)}

    terms = q.lower().split()
    scored: list[tuple[int, dict]] = []

    for voice in voices:
        score = 0
        name = str(voice.get("name", "")).lower()
        tags = " ".join(str(t) for t in voice.get("tags", [])).lower() if isinstance(voice.get("tags"), list) else str(voice.get("tags", "")).lower()
        description = str(voice.get("description", "")).lower()

        # Collect all other string fields for 1x scoring
        other_parts: list[str] = []
        for key, val in voice.items():
            if key in ("name", "tags", "description"):
                continue
            if isinstance(val, str):
                other_parts.append(val.lower())
            elif isinstance(val, list):
                other_parts.extend(str(v).lower() for v in val)
        other_text = " ".join(other_parts)

        for term in terms:
            if term in name:
                score += 10
            if term in tags:
                score += 5
            if term in description:
                score += 2
            if term in other_text:
                score += 1

        if score > 0:
            scored.append((score, voice))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [v for _, v in scored]
    return {"voices": results, "total": len(results)}


# ---------------------------------------------------------------------------
# Preview endpoints
# ---------------------------------------------------------------------------


@app.get("/preview/{filename:path}")
async def get_preview(filename: str):
    """Serve a pre-generated preview MP3 file."""
    # Path traversal protection
    if ".." in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    preview_path = PREVIEWS_DIR / filename

    # Verify resolved path stays inside PREVIEWS_DIR
    try:
        preview_path.resolve().relative_to(PREVIEWS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not preview_path.exists() or not preview_path.is_file():
        raise HTTPException(status_code=404, detail=f"Preview '{filename}' not found")

    return Response(
        content=preview_path.read_bytes(),
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f'inline; filename="{preview_path.name}"',
        },
    )


@app.post("/preview")
async def synthesize_preview(req: PreviewRequest):
    """On-demand preview synthesis using edge-tts. Returns audio/mpeg."""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")

    if len(req.text) > 500:
        raise HTTPException(status_code=400, detail="Text exceeds 500 character limit")

    if not req.modelId or not req.modelId.strip():
        raise HTTPException(status_code=400, detail="modelId must not be empty")

    try:
        communicate = edge_tts.Communicate(req.text, "en-US-AriaNeural")
        audio_buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])
        audio_buffer.seek(0)

        if audio_buffer.getbuffer().nbytes == 0:
            raise HTTPException(status_code=500, detail="Edge-TTS returned empty audio")

        return Response(
            content=audio_buffer.read(),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": f'inline; filename="preview-{req.modelId}.mp3"',
            },
        )
    except edge_tts.exceptions.NoAudioReceived:
        raise HTTPException(
            status_code=502,
            detail="No audio received from edge-tts",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Disk usage endpoint
# ---------------------------------------------------------------------------


@app.post("/catalog/rebuild")
async def rebuild_catalog():
    """Re-scan models directory and regenerate catalog.json.

    Runs build-catalog.py if present, otherwise performs a lightweight
    scan of the models directory and writes a fresh catalog.json.
    """
    import subprocess
    import time

    models_base = RVC_BASE / "models"
    metadata_file = RVC_BASE / "catalog" / "model-metadata.json"

    # Scan for voice directories — check both top-level and rvc-voices/ subdirectory
    voice_dirs: list[Path] = []
    rvc_voices_dir = models_base / "rvc-voices"
    if rvc_voices_dir.exists() and rvc_voices_dir.is_dir():
        voice_dirs = [d for d in sorted(rvc_voices_dir.iterdir()) if d.is_dir()]
    if not voice_dirs and models_base.exists():
        voice_dirs = [d for d in sorted(models_base.iterdir()) if d.is_dir()]

    if not voice_dirs:
        raise HTTPException(status_code=404, detail="No voice directories found")

    metadata_overrides: dict = {}
    if metadata_file.exists():
        try:
            with open(metadata_file, "r", encoding="utf-8") as mf:
                metadata_overrides = json.load(mf)
        except Exception:
            pass

    voices = []

    # Also scan for loose model files in models_base
    if models_base.exists():
        for entry in sorted(models_base.iterdir()):
            if not entry.is_dir() and entry.suffix.lower() in MODEL_EXTENSIONS:
                voice_id = entry.stem
                override = metadata_overrides.get(voice_id, {})
                voices.append({
                    "id": voice_id,
                    "name": override.get("name", voice_id.replace("-", " ").replace("_", " ").title()),
                    "description": override.get("description", ""),
                    "gender": override.get("gender", "neutral"),
                    "accent": override.get("accent", "en-US"),
                    "accentLabel": override.get("accentLabel", "American English"),
                    "style": override.get("style", "natural"),
                    "quality": override.get("quality", 3),
                    "sampleRate": override.get("sampleRate", 40000),
                    "fileSize": entry.stat().st_size,
                    "tags": override.get("tags", []),
                    "downloadUrl": f"/models/{entry.name}",
                    "heroClipUrl": None,
                    "category": "uncategorized",
                    "addedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(entry.stat().st_mtime)),
                })

    # Scan voice directories (from rvc-voices/ or top-level)
    for entry in voice_dirs:
        voice_id = entry.name
        model_files = [f for f in entry.rglob("*") if f.suffix.lower() in MODEL_EXTENSIONS]
        if not model_files:
            continue

        total_size = sum(f.stat().st_size for f in model_files)
        override = metadata_overrides.get(voice_id, {})

        # Check for preview clip
        preview_file = PREVIEWS_DIR / f"{voice_id}.mp3"
        hero_url = f"/preview/{voice_id}.mp3" if preview_file.exists() else None

        voices.append({
            "id": voice_id,
            "name": override.get("name", voice_id.replace("-", " ").replace("_", " ").title()),
            "description": override.get("description", ""),
            "gender": override.get("gender", "neutral"),
            "accent": override.get("accent", "en-US"),
            "accentLabel": override.get("accentLabel", "American English"),
            "style": override.get("style", "natural"),
            "quality": override.get("quality", 3),
            "sampleRate": override.get("sampleRate", 40000),
            "fileSize": total_size,
            "tags": override.get("tags", []),
            "downloadUrl": f"/models/{voice_id}",
            "heroClipUrl": hero_url,
            "category": override.get("category", "uncategorized"),
            "addedAt": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime(max(f.stat().st_mtime for f in model_files)),
            ),
        })

    catalog = {
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalModels": len(voices),
        "totalSizeBytes": sum(v["fileSize"] for v in voices),
        "voices": voices,
    }

    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)

    # Read back the generated catalog
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    voice_count = len(catalog.get("voices", [])) if isinstance(catalog, dict) else len(catalog)
    return {
        "success": True,
        "voiceCount": voice_count,
        "generatedAt": catalog.get("generatedAt", "") if isinstance(catalog, dict) else "",
    }


@app.get("/disk")
async def disk_usage():
    """Return disk usage for the RVC models directory."""
    models_dir = RVC_BASE / "models"
    used_bytes = 0
    model_count = 0

    if models_dir.exists():
        for root, _dirs, files in os.walk(models_dir):
            for filename in files:
                filepath = Path(root) / filename
                try:
                    size = filepath.stat().st_size
                except OSError:
                    size = 0
                used_bytes += size
                if filepath.suffix.lower() in MODEL_EXTENSIONS:
                    model_count += 1

    return {
        "usedBytes": used_bytes,
        "maxBytes": MAX_DISK_BYTES,
        "modelCount": model_count,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
