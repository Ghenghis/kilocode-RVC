# KiloCode Edge-TTS Server -- API Reference

## Overview

The KiloCode Edge-TTS Server provides text-to-speech synthesis via Microsoft Edge neural voices and serves RVC (Retrieval-based Voice Conversion) model files. It runs on CPU only and requires no GPU.

| Property | Value |
|---|---|
| **Production URL** | `https://voice.daveai.tech` |
| **Development URL** | `http://localhost:5050` |
| **Authentication** | None (internal use only) |
| **CORS** | All origins allowed (`*`) |
| **Allowed Methods** | `GET`, `POST`, `OPTIONS` |
| **Content Types** | `application/json` for data, `audio/mpeg` for audio, `application/octet-stream` for model downloads |
| **Rate Limits** | None enforced at the application level |

---

## Endpoints

### 1. `GET /health`

Service health check. Reports server status and the number of `.pth` model files in the models directory.

#### Parameters

None.

#### Response

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"ok"` |
| `models_dir` | string | Absolute path to the models directory on the server |
| `model_count` | integer | Number of `.pth` files found in the top-level models directory |

#### Example Response

```json
{
  "status": "ok",
  "models_dir": "/models",
  "model_count": 12
}
```

#### Error Codes

None. This endpoint always returns `200 OK`.

---

### 2. `GET /voices`

List all available Microsoft Edge neural TTS voices. The voice list is fetched from the Edge TTS service on the first call and cached in memory for all subsequent requests.

#### Parameters

None.

#### Response

Returns a JSON array of voice objects. Each object contains the fields provided by the `edge-tts` library (e.g., `Name`, `ShortName`, `Gender`, `Locale`, `SuggestedCodec`, `FriendlyName`, `Status`, `VoiceTag`).

#### Example Response

```json
[
  {
    "Name": "Microsoft Server Speech Text to Speech Voice (en-GB, MaisieNeural)",
    "ShortName": "en-GB-MaisieNeural",
    "Gender": "Female",
    "Locale": "en-GB",
    "SuggestedCodec": "audio-24khz-48kbitrate-mono-mp3",
    "FriendlyName": "Microsoft Maisie Online (Natural) - English (United Kingdom)",
    "Status": "GA",
    "VoiceTag": {
      "ContentCategories": ["General"],
      "VoicePersonalities": ["Friendly", "Positive"]
    }
  }
]
```

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `500` | *(varies)* | Edge TTS service unreachable or returned an error |

---

### 3. `POST /synthesize`

Synthesize text to speech using an Edge TTS neural voice. Returns raw MP3 audio.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | Yes | -- | The text to synthesize. Maximum 5000 characters. Must not be empty or whitespace-only. |
| `voice` | string | No | `en-GB-MaisieNeural` | Edge TTS voice short name (e.g., `en-US-AriaNeural`). |
| `rate` | string | No | `+0%` | Speech rate adjustment. Examples: `+20%`, `-10%`, `+0%`. |
| `pitch` | string | No | `+0Hz` | Pitch adjustment. Examples: `+50Hz`, `-20Hz`, `+0Hz`. |

#### Response

| Header | Value |
|---|---|
| `Content-Type` | `audio/mpeg` |
| `Content-Disposition` | `inline; filename="speech.mp3"` |

Returns the raw MP3 audio bytes in the response body.

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `400` | `Text must not be empty` | The `text` parameter is missing, empty, or whitespace-only |
| `400` | `Text exceeds 5000 character limit` | The `text` parameter exceeds 5000 characters |
| `500` | `Edge-TTS returned empty audio` | Synthesis completed but produced zero bytes of audio |
| `502` | `No audio received from edge-tts for voice '{voice}'` | The Edge TTS service returned no audio for the specified voice |
| `500` | *(varies)* | Any other unexpected error during synthesis |

---

### 4. `GET /models`

List all installed RVC model `.pth` files found recursively in the models directory.

#### Parameters

None.

#### Response

Returns a JSON array of model objects.

| Field | Type | Description |
|---|---|---|
| `name` | string | Model filename without the `.pth` extension |
| `filename` | string | Relative path from the models directory (e.g., `voice/model.pth`) |
| `size_bytes` | integer | File size in bytes |
| `size_mb` | number | File size in megabytes, rounded to 2 decimal places |

#### Example Response

```json
[
  {
    "name": "aria-v2",
    "filename": "aria-v2.pth",
    "size_bytes": 56893440,
    "size_mb": 54.26
  },
  {
    "name": "deep-male",
    "filename": "deep-male.pth",
    "size_bytes": 42100736,
    "size_mb": 40.15
  }
]
```

Returns an empty array `[]` if the models directory does not exist.

#### Error Codes

None. Returns `200 OK` with an empty array if no models are found.

---

### 5. `GET /models/{name}`

Download a specific RVC model file by name. The `.pth` extension is appended automatically if not provided. The file is streamed in 8 KB chunks.

#### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Model name or relative path, with or without `.pth` extension. Supports nested paths (e.g., `subdir/model`). |

#### Response

| Header | Value |
|---|---|
| `Content-Type` | `application/octet-stream` |
| `Content-Disposition` | `attachment; filename="{filename}.pth"` |
| `Content-Length` | File size in bytes |

Returns the raw model file bytes as a streamed response.

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `400` | `Invalid model name` | The name contains `..` or starts with `/` (path traversal attempt) |
| `400` | `Invalid model path` | The resolved path escapes the models directory |
| `404` | `Model '{name}' not found` | No file exists at the specified path |

---

### 6. `GET /catalog`

Return the voice catalog with optional pagination. Reads from the `catalog.json` file on disk.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer | No | `1` | Page number (1-based). Only used when `limit` is also provided. Values less than 1 are clamped to 1. |
| `limit` | integer | No | `null` | Number of items per page. When omitted or `0`, all voices are returned without pagination. |

#### Response (unpaginated)

| Field | Type | Description |
|---|---|---|
| `voices` | array | Array of voice catalog entries |
| `total` | integer | Total number of voices in the catalog |

#### Response (paginated -- when `limit` is provided and > 0)

| Field | Type | Description |
|---|---|---|
| `voices` | array | Array of voice entries for the requested page |
| `total` | integer | Total number of voices in the catalog |
| `page` | integer | Current page number |
| `limit` | integer | Items per page |

#### Example Response (paginated)

```json
{
  "voices": [
    {
      "id": "aria-v2",
      "name": "Aria V2",
      "description": "Warm female narrator voice",
      "gender": "female",
      "accent": "en-US",
      "accentLabel": "American English",
      "style": "natural",
      "quality": 4,
      "sampleRate": 40000,
      "fileSize": 56893440,
      "tags": ["narrator", "warm"],
      "downloadUrl": "/models/aria-v2",
      "heroClipUrl": "/preview/aria-v2.mp3",
      "category": "narrator",
      "addedAt": "2025-11-20T14:30:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 10
}
```

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `404` | `catalog.json not found` | The catalog file does not exist on disk |

---

### 7. `GET /catalog/search`

Fuzzy search the voice catalog using weighted field scoring.

#### Scoring Weights

| Field | Weight | Description |
|---|---|---|
| `name` | 10x | Voice name matches are scored highest |
| `tags` | 5x | Tag matches |
| `description` | 2x | Description matches |
| All other string fields | 1x | Any other string or list-of-string fields |

Each search term is matched independently against each field using substring matching (case-insensitive). Scores are summed across all terms and fields. Results are sorted by total score in descending order.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | No | `null` | Search query. Multiple terms are space-separated. When empty or omitted, all voices are returned. |

#### Response

| Field | Type | Description |
|---|---|---|
| `voices` | array | Array of matching voice catalog entries, sorted by relevance score |
| `total` | integer | Number of matching voices |

#### Example Request

```
GET /catalog/search?q=female warm
```

#### Example Response

```json
{
  "voices": [
    {
      "id": "aria-v2",
      "name": "Aria V2",
      "description": "Warm female narrator voice",
      "gender": "female",
      "accent": "en-US",
      "tags": ["narrator", "warm"],
      "downloadUrl": "/models/aria-v2",
      "heroClipUrl": "/preview/aria-v2.mp3"
    }
  ],
  "total": 1
}
```

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `404` | `catalog.json not found` | The catalog file does not exist on disk |

---

### 8. `POST /catalog/rebuild`

Re-scan the models directory and regenerate `catalog.json`. If a `build-catalog.py` script exists at `{RVC_BASE}/catalog/build-catalog.py`, it is executed as a subprocess. Otherwise, a lightweight scan is performed directly.

#### Request Body

None.

#### Lightweight Scan Behavior

When no builder script is found, the server scans `{RVC_BASE}/models/` for:

- **Loose model files** with extensions: `.pth`, `.onnx`, `.safetensors`, `.pt`, `.ckpt`
- **Directory-based models** containing one or more model files in subdirectories

Metadata overrides are loaded from `{RVC_BASE}/catalog/model-metadata.json` if it exists.

Each discovered voice entry contains: `id`, `name`, `description`, `gender`, `accent`, `accentLabel`, `style`, `quality`, `sampleRate`, `fileSize`, `tags`, `downloadUrl`, `heroClipUrl`, `category`, `addedAt`.

#### Response

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success |
| `voiceCount` | integer | Number of voices in the rebuilt catalog |
| `generatedAt` | string | ISO 8601 timestamp of when the catalog was generated |

#### Example Response

```json
{
  "success": true,
  "voiceCount": 45,
  "generatedAt": "2025-11-20T14:30:00Z"
}
```

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `404` | `Models directory not found` | The `{RVC_BASE}/models/` directory does not exist (lightweight scan only) |
| `500` | `Catalog build failed: {stderr}` | The `build-catalog.py` script exited with a non-zero return code. Up to 500 characters of stderr are included. |
| `504` | `Catalog build timed out` | The `build-catalog.py` script did not complete within 120 seconds |

---

### 9. `GET /preview/{filename}`

Serve a pre-generated preview MP3 file from the previews directory.

#### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filename` | string | Yes | Preview filename or relative path (e.g., `aria-v2.mp3`). Must not contain `..` or backslashes. |

#### Response

| Header | Value |
|---|---|
| `Content-Type` | `audio/mpeg` |
| `Content-Disposition` | `inline; filename="{filename}"` |

Returns the raw MP3 audio bytes in the response body.

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `400` | `Invalid filename` | The filename contains `..` or `\` (path traversal attempt) |
| `400` | `Invalid file path` | The resolved path escapes the previews directory |
| `404` | `Preview '{filename}' not found` | The file does not exist or is not a regular file |

---

### 10. `POST /preview`

On-demand preview synthesis. Generates a short audio preview using Edge TTS with the `en-US-AriaNeural` voice. The `modelId` is used only for the response filename; no RVC conversion is applied by this endpoint.

#### Request Body (`application/json`)

| Field | Type | Required | Description |
|---|---|---|---|
| `modelId` | string | Yes | Identifier for the voice model. Used in the response filename. Must not be empty or whitespace-only. |
| `text` | string | Yes | Text to synthesize. Maximum 500 characters. Must not be empty or whitespace-only. |

#### Example Request

```json
{
  "modelId": "aria-v2",
  "text": "Hello, this is a preview of the Aria voice."
}
```

#### Response

| Header | Value |
|---|---|
| `Content-Type` | `audio/mpeg` |
| `Content-Disposition` | `inline; filename="preview-{modelId}.mp3"` |

Returns the raw MP3 audio bytes in the response body.

#### Error Codes

| Code | Detail | Cause |
|---|---|---|
| `400` | `Text must not be empty` | The `text` field is missing, empty, or whitespace-only |
| `400` | `Text exceeds 500 character limit` | The `text` field exceeds 500 characters |
| `400` | `modelId must not be empty` | The `modelId` field is missing, empty, or whitespace-only |
| `500` | `Edge-TTS returned empty audio` | Synthesis completed but produced zero bytes of audio |
| `502` | `No audio received from edge-tts` | The Edge TTS service returned no audio |
| `500` | *(varies)* | Any other unexpected error during synthesis |

---

### 11. `GET /disk`

Return disk usage statistics for the RVC models directory. Walks the entire `{RVC_BASE}/models/` directory tree, counting all files for total size and model files (by extension) for the model count.

#### Parameters

None.

#### Recognized Model Extensions

`.pth`, `.onnx`, `.safetensors`, `.pt`, `.ckpt`

#### Response

| Field | Type | Description |
|---|---|---|
| `usedBytes` | integer | Total bytes consumed by all files in the models directory |
| `maxBytes` | integer | Disk quota limit. Fixed at `107374182400` (100 GB) |
| `modelCount` | integer | Number of files with recognized model extensions |

#### Example Response

```json
{
  "usedBytes": 2415919104,
  "maxBytes": 107374182400,
  "modelCount": 18
}
```

#### Error Codes

None. Returns `200 OK` with zeroed values if the models directory does not exist.

---

## Environment Variables

The server reads the following environment variables at startup:

| Variable | Default | Description |
|---|---|---|
| `MODELS_DIR` | `/models` | Path to the directory containing `.pth` model files served by `/models` and `/models/{name}` |
| `PORT` | `5050` | Port the HTTP server listens on |
| `RVC_BASE` | `/opt/rvc-models` | Base path for RVC resources. `catalog.json` is read from `{RVC_BASE}/catalog.json`, previews from `{RVC_BASE}/previews/`, and the catalog rebuild scans `{RVC_BASE}/models/` |

## Catalog File Format

The `catalog.json` file (generated by `/catalog/rebuild`) uses this structure:

```json
{
  "version": 1,
  "generatedAt": "2025-11-20T14:30:00Z",
  "totalModels": 45,
  "totalSizeBytes": 2415919104,
  "voices": [
    {
      "id": "aria-v2",
      "name": "Aria V2",
      "description": "Warm female narrator voice",
      "gender": "female",
      "accent": "en-US",
      "accentLabel": "American English",
      "style": "natural",
      "quality": 3,
      "sampleRate": 40000,
      "fileSize": 56893440,
      "tags": ["narrator", "warm"],
      "downloadUrl": "/models/aria-v2",
      "heroClipUrl": "/preview/aria-v2.mp3",
      "category": "narrator",
      "addedAt": "2025-11-20T14:30:00Z"
    }
  ]
}
```

The server also accepts a plain array of voice objects (legacy format). The `/catalog` and `/catalog/search` endpoints handle both formats transparently.
