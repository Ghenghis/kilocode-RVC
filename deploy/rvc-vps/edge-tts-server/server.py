"""
KiloCode Edge-TTS Server for VPS deployment.
Provides text-to-speech via Microsoft Edge neural voices and serves RVC model files.
Runs on CPU only -- no GPU required.
"""

import asyncio
import io
import os
from pathlib import Path
from typing import Optional

import edge_tts
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
PORT = int(os.environ.get("PORT", 5050))

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
    """Download a specific model file by name (with or without .pth extension)."""
    if not name.endswith(".pth"):
        name = name + ".pth"

    # Prevent path traversal
    if ".." in name or name.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid model name")

    model_path = MODELS_DIR / name
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{name}' not found")

    # Verify the resolved path is still inside MODELS_DIR
    try:
        model_path.resolve().relative_to(MODELS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid model path")

    def file_iterator():
        with open(model_path, "rb") as f:
            while True:
                chunk = f.read(8192)
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


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
