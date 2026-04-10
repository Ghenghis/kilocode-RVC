# KiloCode Voice Studio -- VPS Deployment Guide

Full deployment reference for the KiloCode Voice Studio backend. This server provides Edge-TTS synthesis, an RVC model catalog, preview clips, and model file downloads for the Voice Studio frontend in the VS Code extension.

---

## Table of Contents

1. [Server Details](#server-details)
2. [Prerequisites](#prerequisites)
3. [Directory Structure](#directory-structure)
4. [Docker Setup](#docker-setup)
5. [Volume Mounts](#volume-mounts)
6. [Nginx Configuration](#nginx-configuration)
7. [Model Collection](#model-collection)
8. [Catalog System](#catalog-system)
9. [Preview Generation](#preview-generation)
10. [API Endpoints](#api-endpoints)
11. [Maintenance](#maintenance)
12. [Troubleshooting](#troubleshooting)

---

## Server Details

| Field | Value |
|-------|-------|
| **Host IP** | `187.77.30.206` |
| **Domain** | `voice.daveai.tech` |
| **SSL** | Cloudflare Flexible SSL (Cloudflare terminates TLS; origin serves on port 80) |
| **Deployment dir** | `/opt/kilocode-voice/` |
| **Models dir** | `/opt/rvc-models/` |

Cloudflare sits in front of the VPS and handles SSL termination. The origin nginx listens on port 80 for Flexible mode, and optionally on port 443 with a Cloudflare Origin Certificate for Full (Strict) mode. DNS for `voice.daveai.tech` points to `187.77.30.206` via a Cloudflare-proxied A record.

---

## Prerequisites

Install these on the VPS before deployment:

| Software | Version | Install |
|----------|---------|---------|
| **Docker** | v29.4.0+ | [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) |
| **docker-compose** | v2+ (bundled with Docker) | `docker compose version` to verify |
| **nginx** | 1.18+ | `apt-get install -y nginx` |
| **Python** | 3.10+ | `apt-get install -y python3 python3-pip` |
| **edge-tts** | 6.1.9+ | `pip3 install edge-tts` |
| **jq** | any | `apt-get install -y jq` (needed by preview generation) |
| **curl** | any | Pre-installed on most systems |
| **unzip** | any | `apt-get install -y unzip` (needed by model collector for zip archives) |

Verify Docker is running:

```bash
docker --version          # Docker version 29.4.0
docker compose version    # Docker Compose version v2.x
systemctl status docker   # Active: active (running)
```

---

## Directory Structure

### `/opt/kilocode-voice/` -- Application Code

This is the deployment root. The `deploy.sh` script copies files here from the repo's `deploy/rvc-vps/` directory.

```
/opt/kilocode-voice/
  docker-compose.yml              # Defines both containers
  model-server-nginx.conf         # Config for the model-server container
  edge-tts-server/
    Dockerfile                    # Python 3.10-slim base image
    server.py                     # FastAPI application (all API endpoints)
    requirements.txt              # edge-tts==6.1.9, fastapi==0.111.0, uvicorn==0.29.0
  model-downloader/
    download-models.sh            # Basic model downloader (core infra models)
  models/                         # Local model files (mounted into containers)
```

### `/opt/rvc-models/` -- Model Data and Catalog

This directory holds the full model collection, the generated catalog, and preview audio clips.

```
/opt/rvc-models/
  catalog.json                    # Generated voice catalog (consumed by frontend)
  models/                         # All downloaded voice model files
    hubert_base.pt
    rmvpe.pt
    pretrained_v2/
    kokoro/
    openvoice-v2/
    gpt-sovits/
    piper/
    styletts2/
    xtts-v2/
    f5-tts/
    chatterbox/
    fish-speech/
    bark/
    seed-vc/
    rvc-voices/                   # Curated RVC voice models
      lunar-studio/
      ntts-ai/
      google-assistant/
      ami-mizuno/
      ...
  previews/                       # Pre-generated hero preview clips (MP3)
    lunar-studio.mp3
    ntts-ai.mp3
    ...
  catalog/                        # Catalog tooling
    build-catalog.py              # Scans models, generates catalog.json
    model-metadata.json           # Hand-curated metadata overrides
    generate-previews.sh          # Synthesizes preview clips via edge-tts CLI
```

---

## Docker Setup

The deployment runs two containers on a shared `rvc-net` bridge network.

### Container: `edge-tts-server`

| Setting | Value |
|---------|-------|
| **Image** | Built from `./edge-tts-server/Dockerfile` (Python 3.10-slim) |
| **Port** | `5050:5050` |
| **Restart** | `always` |
| **Health check** | `curl -f http://localhost:5050/health` every 30s |

This is the main API server. It runs a FastAPI application via uvicorn that handles:
- Text-to-speech synthesis via `edge-tts`
- Voice catalog queries and search
- Preview clip serving and on-demand synthesis
- Model file listing and download
- Disk usage reporting
- Catalog rebuild (re-scan models directory)

The Dockerfile installs `curl` (for health checks), copies `requirements.txt` and `server.py`, then runs `python server.py`.

### Container: `model-server`

| Setting | Value |
|---------|-------|
| **Image** | `nginx:1.25-alpine` |
| **Port** | `8080:8080` |
| **Restart** | `always` |

A lightweight nginx instance that serves model files at `/models/` with JSON autoindex enabled. This provides direct file downloads for clients that need to fetch model weights.

The container uses `model-server-nginx.conf`:

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;

    location /models/ {
        autoindex on;
        autoindex_format json;
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type";
    }

    location = /health {
        return 200 '{"status":"ok"}';
        add_header Content-Type application/json;
    }
}
```

### Starting the Containers

```bash
cd /opt/kilocode-voice
docker compose build --no-cache
docker compose up -d
docker compose ps        # Verify both are running
docker compose logs -f   # Watch logs
```

---

## Volume Mounts

### edge-tts-server volumes

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `./models` | `/models` | rw | Local model files for listing/download via API |
| `/opt/rvc-models/catalog.json` | `/opt/rvc-models/catalog.json` | ro | Voice catalog JSON |
| `/opt/rvc-models/previews` | `/opt/rvc-models/previews` | ro | Pre-generated preview MP3 clips |
| `/opt/rvc-models/models` | `/opt/rvc-models/models` | ro | Full model collection for catalog rebuild |

The catalog.json mount is `ro` in docker-compose.yml. When the `/catalog/rebuild` endpoint is triggered, the server writes to the catalog file at `/opt/rvc-models/catalog.json`. If running the rebuild from inside the container, the volume must be writable. The `deploy.sh` script mounts the catalog scripts directory from `/opt/rvc-models/catalog` when the full catalog builder is used.

### model-server volumes

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `./models` | `/usr/share/nginx/html/models` | ro | Static file serving for model downloads |
| `./model-server-nginx.conf` | `/etc/nginx/conf.d/default.conf` | ro | Nginx configuration |

---

## Nginx Configuration

The host nginx (not the container) sits between Cloudflare and the Docker containers. It runs on the VPS itself and proxies requests to the appropriate backend.

### Site Config: `/etc/nginx/sites-available/voice.daveai.tech`

Two server blocks:

1. **Port 80** -- Serves requests from Cloudflare in Flexible SSL mode. Includes the shared location snippet.
2. **Port 443** -- Optional, for Cloudflare Full (Strict) mode. Uses a Cloudflare Origin Certificate stored at:
   - Certificate: `/etc/ssl/cloudflare/voice.daveai.tech.pem`
   - Key: `/etc/ssl/cloudflare/voice.daveai.tech.key`

Both blocks include the same location rules via:
```nginx
include /etc/nginx/snippets/voice-locations.conf;
```

Enable the site:
```bash
ln -sf /etc/nginx/sites-available/voice.daveai.tech /etc/nginx/sites-enabled/voice.daveai.tech
nginx -t && systemctl reload nginx
```

### Location Snippet: `/etc/nginx/snippets/voice-locations.conf`

Rate limiting zones (defined in the site config):

| Zone | Rate | Purpose |
|------|------|---------|
| `synth_limit` | 10 req/s, burst 5 | Protects the `/api/synthesize` endpoint |
| `api_limit` | 30 req/s, burst 10-20 | General API and model download endpoints |

Upstream backends:

| Name | Target |
|------|--------|
| `edge_tts_backend` | `127.0.0.1:5050` (edge-tts-server container) |
| `model_backend` | `127.0.0.1:8080` (model-server container) |

Routing rules:

| Location | Backend | Notes |
|----------|---------|-------|
| `/api/health` | `edge_tts_backend/health` | No rate limit |
| `/api/synthesize` | `edge_tts_backend/synthesize` | `synth_limit`, 60s timeout |
| `/api/voices` | `edge_tts_backend/voices` | `api_limit`, cached 1h |
| `/api/*` | `edge_tts_backend` | Strips `/api` prefix via rewrite |
| `/models/` | `model_backend/models/` | `api_limit`, 300s timeout, no buffering |
| `/` | Returns JSON service info | Static response |

All locations add CORS headers (`Access-Control-Allow-Origin: *`) and handle OPTIONS preflight requests.

---

## Model Collection

The `collect-voice-models.sh` script downloads voice models from HuggingFace and other open-source repositories. It is the comprehensive collection tool that populates `/opt/rvc-models/models/`.

### Running the Collector

```bash
cd /opt/rvc-models/catalog   # or wherever the script lives
./collect-voice-models.sh /opt/rvc-models/models
```

The script logs progress to `/opt/rvc-models/collection-progress.log`.

### 100GB Disk Cap

The `check_disk_limit()` function runs before every download. It measures the target directory with `du -sk` and stops collection if usage reaches 100GB:

```bash
MAX_SIZE_GB=100

check_disk_limit() {
    local used_kb
    used_kb=$(du -sk "$TARGET_DIR" 2>/dev/null | cut -f1)
    local used_gb=$((used_kb / 1048576))
    if [[ $used_gb -ge $MAX_SIZE_GB ]]; then
        log "LIMIT REACHED: ${used_gb}GB >= ${MAX_SIZE_GB}GB cap"
        exit 0
    fi
}
```

### Download Helpers

- **`download_file`** -- Downloads a single file with `curl -L -C -` (resume support), retries 3 times, skips if the file already exists and is >100 bytes.
- **`download_hf_dir`** -- Uses the HuggingFace API (`/api/models/{repo}/tree/main/{path}`) to list `.pth` files in a repo directory and downloads each one.
- **`download_rvc_zip`** -- Downloads a zip archive, extracts only `.pth` and `.index` files, then deletes the zip.

### Model Sources (17 Sections)

The collector downloads from these categories:

| Section | Models | Source |
|---------|--------|--------|
| 1 | Core RVC infrastructure (hubert_base.pt, rmvpe.pt) | lj1995/VoiceConversionWebUI |
| 2 | RVC v2 pretrained base models (G/D for 48k/40k/32k) | lj1995/VoiceConversionWebUI |
| 3 | Kokoro TTS (ONNX + PyTorch + 12 voice packs) | hexgrad/Kokoro-82M |
| 4 | OpenVoice v2 (converter + 6 language speakers) | myshell-ai/OpenVoiceV2 |
| 5 | GPT-SoVITS pretrained (BERT, Generator, Discriminator) | lj1995/GPT-SoVITS |
| 6 | Piper TTS (US + GB English high-quality ONNX voices) | rhasspy/piper-voices |
| 7 | StyleTTS2 LibriTTS | yl4579/StyleTTS2-LibriTTS |
| 8 | XTTS v2 / Coqui (model, DVAE, mel stats, config) | coqui/XTTS-v2 |
| 9 | F5-TTS (safetensors model + vocab) | SWivid/F5-TTS |
| 10 | Chatterbox TTS (decoder, tokenizer, s3gen, voice encoder) | ResembleAI/chatterbox |
| 11 | Fish Speech 1.5 (model + vocoder) | fishaudio/fish-speech-1.5 |
| 12 | Bark TTS (text, coarse, fine models) | suno/bark |
| 13 | Seed-VC (zero-shot voice conversion) | Plachta/Seed-VC |
| 14 | Curated RVC voices (anime, pop, game, studio) | Various HuggingFace repos |
| 15 | Research-sourced RVC voices (NTTS AI, Google, NOAA, DECTalk) | Various HuggingFace repos |
| 16 | HuggingFace RVC collections (community repos) | Various HuggingFace repos |
| 17 | Japanese RVC voices (sample) | Elesis/RVC_Models |

---

## Catalog System

The catalog is a JSON file (`/opt/rvc-models/catalog.json`) that the frontend queries to populate the Voice Store panel. It is generated by scanning the model directories and merging hand-curated metadata overrides.

### build-catalog.py

Location: `/opt/rvc-models/catalog/build-catalog.py`

```bash
python3 /opt/rvc-models/catalog/build-catalog.py \
    --models-dir /opt/rvc-models/models \
    --metadata /opt/rvc-models/catalog/model-metadata.json \
    --output /opt/rvc-models/catalog.json
```

What it does:

1. Recursively finds all model files (`.pth`, `.onnx`, `.safetensors`, `.pt`, `.ckpt`) under `--models-dir`.
2. Groups files by their parent directory relative to the models root.
3. Auto-detects voice properties:
   - **Name**: directory name converted to title case (`ariana-grande-2010s` becomes `Ariana Grande 2010s`).
   - **Gender**: keyword matching against directory name (`female`, `girl`, `luna`, etc. for female; `male`, `man`, `kanye` for male; otherwise neutral).
   - **Category**: derived from top-level directory (`rvc`, `kokoro`, `xtts`, `f5`, `styletts2`, or `other`).
4. Applies overrides from `model-metadata.json` -- any field in the override replaces the auto-detected value (except `id`, which is always the slugified relative path).
5. Checks for a matching preview clip at `/opt/rvc-models/previews/{voice_id}.mp3` and sets `heroClipUrl` if found.
6. Sorts voices by quality descending, then name ascending.
7. Writes the final catalog with version, timestamp, totals, and the voices array.

### model-metadata.json

Location: `/opt/rvc-models/catalog/model-metadata.json`

Keys are directory paths relative to the models root (e.g., `rvc-voices/lunar-studio`). Values are objects with any combination of catalog fields to override:

```json
{
  "rvc-voices/lunar-studio": {
    "name": "Lunar Studio",
    "gender": "female",
    "quality": 5,
    "sampleRate": 48000,
    "tags": ["warm", "studio", "hifi", "assistant"],
    "description": "High-fidelity female studio voice with warm, natural tone."
  }
}
```

Supported override fields: `name`, `description`, `gender`, `accent`, `accentLabel`, `style`, `quality` (1-5), `sampleRate`, `tags` (array), `category`.

### Triggering a Rebuild via API

```bash
curl -X POST https://voice.daveai.tech/api/catalog/rebuild
```

Response:
```json
{
  "success": true,
  "voiceCount": 47,
  "generatedAt": "2026-04-10T12:00:00Z"
}
```

The rebuild endpoint first looks for `build-catalog.py` at `/opt/rvc-models/catalog/build-catalog.py`. If found, it runs the script as a subprocess with a 120-second timeout. If not found, it falls back to a lightweight inline scan that enumerates model files and writes a minimal catalog.

### Catalog JSON Format

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-04-10T12:00:00+00:00",
  "totalModels": 47,
  "totalSizeBytes": 52428800000,
  "voices": [
    {
      "id": "rvc-voices-lunar-studio",
      "name": "Lunar Studio",
      "description": "High-fidelity female studio voice...",
      "gender": "female",
      "accent": "en-US",
      "accentLabel": "American English",
      "style": "natural",
      "quality": 5,
      "sampleRate": 48000,
      "fileSize": 104857600,
      "tags": ["warm", "studio", "hifi", "assistant"],
      "downloadUrl": "https://voice.daveai.tech/models/rvc-voices/lunar-studio",
      "heroClipUrl": "https://voice.daveai.tech/previews/rvc-voices-lunar-studio.mp3",
      "category": "rvc",
      "addedAt": "2026-04-01T00:00:00+00:00"
    }
  ]
}
```

---

## Preview Generation

Hero preview clips are short MP3 files synthesized via the `edge-tts` CLI. Each voice in the catalog gets a 5-second clip so the frontend can play a sample before the user downloads a model.

### generate-previews.sh

Location: `/opt/rvc-models/catalog/generate-previews.sh`

```bash
./generate-previews.sh /opt/rvc-models/catalog.json /opt/rvc-models/previews
```

Defaults (if no arguments): reads `catalog.json` from the script's own directory, writes to `/opt/rvc-models/previews/`.

What it does:

1. Verifies `edge-tts` is installed (auto-installs via pip if missing).
2. Verifies `jq` is installed (required for parsing catalog.json).
3. Extracts all voice IDs from the catalog via `jq -r '.voices[].id'`.
4. For each voice ID, generates a preview clip:
   - Voice: `en-US-AriaNeural` (Microsoft Edge neural voice)
   - Text: `"Hello, I'm your voice assistant. How can I help you today?"`
   - Output: `/opt/rvc-models/previews/{voice_id}.mp3`
5. Skips voices that already have a preview file larger than 1000 bytes.
6. Removes output files smaller than 1000 bytes (corrupt/empty).
7. Prints a summary with generated/skipped/failed counts.

The script exits with code 1 if any previews failed, so re-running it will retry only the missing ones.

---

## API Endpoints

All endpoints are exposed through the host nginx at `https://voice.daveai.tech/api/`. The `/api` prefix is stripped before proxying to the FastAPI server on port 5050.

### Health

```
GET /api/health
```

Response:
```json
{
  "status": "ok",
  "models_dir": "/models",
  "model_count": 12
}
```

### Edge-TTS Voices

```
GET /api/voices
```

Returns the full list of available Microsoft Edge TTS voices (cached after first call). This is the edge-tts voice list, not the RVC model catalog.

### Synthesize

```
POST /api/synthesize?text=Hello+world&voice=en-GB-MaisieNeural&rate=+0%25&pitch=+0Hz
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `text` | (required) | Text to synthesize, max 5000 characters |
| `voice` | `en-GB-MaisieNeural` | Edge-TTS voice name |
| `rate` | `+0%` | Speech rate adjustment (e.g., `+20%`, `-10%`) |
| `pitch` | `+0Hz` | Pitch adjustment (e.g., `+50Hz`, `-20Hz`) |

Returns `audio/mpeg` binary data.

### Catalog

```
GET /api/catalog
GET /api/catalog?page=1&limit=20
```

Returns the voice catalog with optional pagination.

Response:
```json
{
  "voices": [ ... ],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

### Catalog Search

```
GET /api/catalog/search?q=warm+female
```

Fuzzy search across all voice entries. Scoring weights:

| Field | Weight |
|-------|--------|
| `name` | 10x |
| `tags` | 5x |
| `description` | 2x |
| All other string fields | 1x |

Results are sorted by descending score. Returns all voices if `q` is empty.

### Catalog Rebuild

```
POST /api/catalog/rebuild
```

Re-scans the models directory and regenerates `catalog.json`. Runs `build-catalog.py` if present, otherwise performs a lightweight inline scan.

Response:
```json
{
  "success": true,
  "voiceCount": 47,
  "generatedAt": "2026-04-10T12:00:00Z"
}
```

### Preview (Serve Pre-generated)

```
GET /api/preview/{filename}
```

Serves a pre-generated preview MP3 from `/opt/rvc-models/previews/`. Path traversal is blocked.

Example:
```
GET /api/preview/rvc-voices-lunar-studio.mp3
```

### Preview (On-demand Synthesis)

```
POST /api/preview
Content-Type: application/json

{
  "modelId": "rvc-voices-lunar-studio",
  "text": "Testing this voice model."
}
```

Synthesizes a preview clip on the fly using `en-US-AriaNeural`. Text is limited to 500 characters. Returns `audio/mpeg`.

### Disk Usage

```
GET /api/disk
```

Response:
```json
{
  "usedBytes": 52428800000,
  "maxBytes": 107374182400,
  "modelCount": 47
}
```

`maxBytes` is the 100GB cap defined in the server. Walks `/opt/rvc-models/models/` and sums all file sizes. `modelCount` counts only files with model extensions (`.pth`, `.onnx`, `.safetensors`, `.pt`, `.ckpt`).

### Models List

```
GET /api/models
```

Lists `.pth` files in the container's `/models` directory (the local models mount, not the full `/opt/rvc-models/models`).

Response:
```json
[
  {
    "name": "hubert_base",
    "filename": "hubert_base.pth",
    "size_bytes": 189505424,
    "size_mb": 180.73
  }
]
```

### Model Download

```
GET /api/models/{name}
```

Downloads a specific model file by name. The `.pth` extension is appended if not provided. Files are streamed in 8KB chunks. Path traversal is blocked.

Example:
```
GET /api/models/hubert_base
```

Returns the file as `application/octet-stream` with a `Content-Disposition: attachment` header.

### Static Model Files (model-server)

```
GET /models/
GET /models/kokoro/kokoro-v1.0.pth
```

Served by the `model-server` nginx container on port 8080, proxied through the host nginx at `/models/`. Returns a JSON directory listing at `/models/` (autoindex) and raw file downloads for individual files.

---

## Maintenance

### Adding New Models

1. Drop model files into the appropriate subdirectory under `/opt/rvc-models/models/`:
   ```bash
   mkdir -p /opt/rvc-models/models/rvc-voices/new-voice
   cp new-voice.pth /opt/rvc-models/models/rvc-voices/new-voice/
   ```

2. Optionally add a metadata override in `/opt/rvc-models/catalog/model-metadata.json`:
   ```json
   "rvc-voices/new-voice": {
     "name": "New Voice",
     "gender": "female",
     "quality": 4,
     "tags": ["clear", "studio"],
     "description": "A clear studio voice for assistant use."
   }
   ```

3. Rebuild the catalog:
   ```bash
   curl -X POST https://voice.daveai.tech/api/catalog/rebuild
   ```

4. Generate a preview clip:
   ```bash
   cd /opt/rvc-models/catalog
   ./generate-previews.sh /opt/rvc-models/catalog.json /opt/rvc-models/previews
   ```

5. Rebuild again so the catalog picks up the new preview URL:
   ```bash
   curl -X POST https://voice.daveai.tech/api/catalog/rebuild
   ```

### Monitoring Disk Usage

Check current usage via the API:
```bash
curl https://voice.daveai.tech/api/disk
```

Or directly on the VPS:
```bash
du -sh /opt/rvc-models/models/
df -h /opt/rvc-models/
```

The collector script enforces a 100GB cap. The `/api/disk` endpoint reports `usedBytes` and `maxBytes` so the frontend can display a usage bar.

### Viewing Logs

Container logs:
```bash
cd /opt/kilocode-voice
docker compose logs -f                    # Both containers
docker compose logs -f edge-tts-server    # TTS server only
docker compose logs -f model-server       # Model server only
```

Model collection log:
```bash
tail -f /opt/rvc-models/collection-progress.log
```

### Redeploying

From a machine with SSH access to the VPS, run the deploy script:
```bash
cd deploy/rvc-vps
./deploy.sh root
```

This copies updated files, reloads nginx, rebuilds Docker containers, and verifies the health endpoint. The script takes an optional SSH user argument (defaults to `root`).

---

## Troubleshooting

### Container Not Starting

Check container status and logs:
```bash
cd /opt/kilocode-voice
docker compose ps
docker compose logs edge-tts-server --tail 50
```

Force rebuild:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Port 5050 or 8080 Already in Use

Find the conflicting process:
```bash
ss -tlnp | grep :5050
ss -tlnp | grep :8080
```

Kill it or change the port mapping in `docker-compose.yml`.

### Health Check Failing

Test from inside the VPS:
```bash
curl -sf http://localhost:5050/health
```

If the server responds locally but not through nginx, check nginx config:
```bash
nginx -t
systemctl status nginx
cat /var/log/nginx/error.log | tail -20
```

### Catalog Not Found (404)

The `/api/catalog` endpoint returns 404 when `catalog.json` does not exist at `/opt/rvc-models/catalog.json`.

Fix by running a rebuild:
```bash
# From the VPS
python3 /opt/rvc-models/catalog/build-catalog.py \
    --models-dir /opt/rvc-models/models \
    --output /opt/rvc-models/catalog.json

# Or via the API
curl -X POST http://localhost:5050/catalog/rebuild
```

### Catalog Rebuild Fails from Inside Container

If the volume for `catalog.json` is mounted as `ro` (read-only), the inline rebuild cannot write the file. Either:

1. Change the mount to `rw` in `docker-compose.yml`:
   ```yaml
   - /opt/rvc-models/catalog.json:/opt/rvc-models/catalog.json:rw
   ```
   Then `docker compose up -d` to recreate.

2. Or run the rebuild from the host instead of via the API.

### Previews Not Playing

Check that the previews directory is mounted and contains MP3 files:
```bash
ls -la /opt/rvc-models/previews/ | head -20
```

Verify a preview is accessible:
```bash
curl -sf -o /dev/null -w "%{http_code}" http://localhost:5050/preview/rvc-voices-lunar-studio.mp3
```

If previews are missing, regenerate them:
```bash
cd /opt/rvc-models/catalog
./generate-previews.sh /opt/rvc-models/catalog.json /opt/rvc-models/previews
```

### SSL/CORS Errors from Frontend

The server adds `Access-Control-Allow-Origin: *` at both the nginx level and the FastAPI middleware level. If the frontend gets CORS errors:

1. Verify Cloudflare is set to Flexible SSL (or Full if you have origin certs installed).
2. Check that the nginx snippets file is included correctly:
   ```bash
   nginx -t
   ```
3. Ensure the request uses `https://voice.daveai.tech` (not the raw IP).

### Model Downloads Timing Out

Large model files can take minutes to download. The host nginx allows 300s for `/models/` requests with buffering disabled. If downloads still time out:

```bash
# Check the model-server container is responding
curl -sf http://localhost:8080/health
curl -sf http://localhost:8080/models/ | head -5
```

If the container is healthy but transfers are slow, the issue is likely network bandwidth on the VPS.
