"""
KiloCode RVC TTS Server
Converts text to speech using edge-tts + RVC voice conversion.

Voice models placed in /models/{voice_id}/ as:
  /models/{voice_id}/model.pth   (required)
  /models/{voice_id}/model.index (optional)
"""
import asyncio
import io
import os
import tempfile
from pathlib import Path
from typing import Optional

import edge_tts
import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
DEFAULT_EDGE_VOICE = "en-US-AriaNeural"

app = FastAPI(title="KiloCode RVC TTS", version="1.0.0")


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str
    edge_voice: Optional[str] = DEFAULT_EDGE_VOICE
    pitch_shift: int = 0


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/voices")
async def list_voices():
    if not MODELS_DIR.exists():
        return []
    voices = []
    for model_dir in sorted(MODELS_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        pth_files = list(model_dir.glob("*.pth"))
        if not pth_files:
            continue
        size_mb = sum(f.stat().st_size for f in model_dir.iterdir() if f.is_file()) // (1024 * 1024)
        voices.append({"id": model_dir.name, "sizeMB": size_mb})
    return voices


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    model_dir = MODELS_DIR / req.voice_id
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Voice model '{req.voice_id}' not found")

    pth_files = list(model_dir.glob("*.pth"))
    if not pth_files:
        raise HTTPException(status_code=404, detail=f"No .pth model file in '{req.voice_id}'")

    model_path = str(pth_files[0])
    index_files = list(model_dir.glob("*.index"))
    index_path = str(index_files[0]) if index_files else ""

    baseline_wav = await _edge_tts_to_wav(req.text, req.edge_voice or DEFAULT_EDGE_VOICE)

    output_wav = await asyncio.get_event_loop().run_in_executor(
        None, _rvc_convert, baseline_wav, model_path, index_path, req.pitch_shift
    )

    return Response(content=output_wav, media_type="audio/wav")


async def _edge_tts_to_wav(text: str, voice: str) -> bytes:
    communicate = edge_tts.Communicate(text, voice)
    mp3_bytes = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_bytes.write(chunk["data"])
    mp3_bytes.seek(0)

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(mp3_bytes.read())
        tmp_path = tmp.name

    try:
        audio, sr = sf.read(tmp_path)
        wav_bytes = io.BytesIO()
        sf.write(wav_bytes, audio, sr, format="WAV")
        return wav_bytes.getvalue()
    finally:
        os.unlink(tmp_path)


def _rvc_convert(input_wav: bytes, model_path: str, index_path: str, pitch_shift: int) -> bytes:
    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        return input_wav

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as inp:
        inp.write(input_wav)
        inp_path = inp.name

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out:
        out_path = out.name

    try:
        rvc = RVCInference(device="cpu")
        rvc.load_model(model_path, index_path if index_path else None)
        rvc.infer_file(inp_path, out_path, f0_up_key=pitch_shift)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(inp_path)
        try:
            os.unlink(out_path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    uvicorn.run(app, host="0.0.0.0", port=port)
