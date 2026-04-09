# KiloCode RVC TTS Docker Container

Local high-quality TTS using RVC (Retrieval-based Voice Conversion).

## Quick Start

```bash
docker build -t kilocode-rvc-tts .
docker run --rm -p 7860:7860 -v ~/.kilocode/voices/rvc:/models kilocode-rvc-tts
```

## Adding Voice Models

Place RVC `.pth` files in subfolders under `~/.kilocode/voices/rvc/`:

```
~/.kilocode/voices/rvc/
  en-female-aria/
    model.pth
    model.index   (optional)
  en-male-ryan/
    model.pth
```

The folder name becomes the voice ID. Naming convention: `{locale}-{gender}-{name}`

## API

- `GET /health` — health check
- `GET /voices` — list loaded voice models
- `POST /synthesize` — synthesize speech
  ```json
  { "text": "Hello world", "voice_id": "en-female-aria" }
  ```
  Returns: `audio/wav`
