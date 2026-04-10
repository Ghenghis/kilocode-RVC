# Voice Catalog — Complete Model Inventory

> Full inventory of all voice models available in the KiloCode Voice Studio system.

## Catalog Overview

| Metric | Value |
|--------|-------|
| Total models | 24 curated + auto-detected |
| Total disk usage | ~22 GB / 100 GB cap |
| Model formats | .pth, .onnx, .safetensors, .pt, .ckpt |
| Preview clips | 29 pre-generated MP3 hero clips |
| Catalog file | `/opt/rvc-models/catalog.json` |
| Metadata overrides | `/opt/rvc-models/catalog/model-metadata.json` |

## How the Catalog Works

```
Model files on disk          model-metadata.json
       │                            │
       ▼                            ▼
  ┌─────────────────────────────────────┐
  │         build-catalog.py            │
  │  • Scans model directories          │
  │  • Auto-detects name, gender, size  │
  │  • Merges metadata overrides        │
  │  • Checks for preview clips         │
  └──────────────┬──────────────────────┘
                 │
                 ▼
          catalog.json
                 │
                 ▼
     GET /api/catalog endpoint
                 │
                 ▼
     Voice Studio Store tab
```

### Auto-Refresh

When new models are added to the VPS, click the **Refresh** button in the Store tab header. This sends `POST /api/catalog/rebuild` which re-scans all model directories and regenerates `catalog.json`.

## Voice Models — Full Inventory

### RVC Voices (Retrieval-Based Voice Conversion)

| Model | Gender | Style | Quality | Sample Rate | Tags | Description |
|-------|--------|-------|---------|-------------|------|-------------|
| **Lunar Studio** | Female | Natural | ★★★★★ | 48 kHz | warm, studio, hifi, assistant | High-fidelity female studio voice with warm, natural tone ideal for assistant use |
| **NTTS AI** | Neutral | Natural | ★★★★ | 40 kHz | neural, tts, clean | Clean neural TTS voice with balanced, neutral delivery |
| **Google Assistant** | Neutral | Natural | ★★★★ | 24 kHz | assistant, modern, familiar | Familiar modern assistant voice with clear, approachable delivery |
| **Google Gemini** | Neutral | Natural | ★★★★ | 24 kHz | ai, modern, assistant | Modern AI assistant voice with clean, contemporary tone |
| **NOAA Radio** | Neutral | Broadcast | ★★★ | 22 kHz | broadcast, clear, robotic | Broadcast-style weather radio voice with measured, robotic cadence |
| **DECTalk** | Neutral | Broadcast | ★★ | 16 kHz | robotic, retro, synth, classic | Classic retro synthesized voice reminiscent of early text-to-speech systems |
| **Liberty Prime** | Male | Character | ★★★ | 24 kHz | character, deep, robotic, game | Deep, commanding robotic character voice inspired by Fallout's Liberty Prime |
| **Ami Mizuno** | Female | Natural | ★★★★ | 24 kHz | anime, clear, crisp | Clear, crisp female anime voice with gentle and intelligent tone |
| **Makoto Kino** | Female | Expressive | ★★★★ | 24 kHz | anime, energetic, bright | Energetic, bright female anime voice with expressive delivery |
| **Ariana Grande (2010s)** | Female | Singing | ★★★★ | 24 kHz | pop, expressive, singing | Expressive female pop singing voice modeled after 2010s-era vocals |
| **Kanye West** | Male | Expressive | ★★★ | 24 kHz | rap, deep, expressive | Deep, expressive male voice with bold, assertive delivery |
| **Elvis Presley** | Male | Singing | ★★★★ | 24 kHz | classic, crooner, deep, warm | Warm, deep classic crooner voice with rich baritone character |
| **Asuka Kazama** | Female | Character | ★★★ | 24 kHz | game, action, strong | Strong, action-oriented female game character voice |
| **Fern (BFDI/E)** | Neutral | Character | ★★★ | 24 kHz | animated, clean | Clean, neutral animated character voice from Battle for Dream Island |
| **Rose (BFDI/E)** | Female | Character | ★★★ | 24 kHz | animated, gentle | Gentle, soft female animated character voice from Battle for Dream Island |
| **KATSEYE Manon** | Female | Natural | ★★★★ | 24 kHz | pop, modern, clear | Clear, modern female pop voice with natural, polished delivery |
| **KATSEYE Daniela** | Female | Natural | ★★★ | 24 kHz | pop, bilingual, clear | Clear female pop voice with bilingual versatility |
| **PhoenixStorm Default** | Neutral | Natural | ★★★ | 24 kHz | default, generic, test | Generic default voice useful for testing and baseline comparisons |
| **Female Whisper TTS** | Female | Whisper | ★★★ | 24 kHz | whisper, soft, asmr, gentle | Soft, whispery female voice ideal for ASMR and gentle narration |
| **BlazBlue Noel (English)** | Female | Character | ★★★ | 24 kHz | game, anime, gentle | Gentle female game character voice from BlazBlue's English dub |

### TTS Engine Models

| Model | Gender | Style | Quality | Sample Rate | Tags | Description |
|-------|--------|-------|---------|-------------|------|-------------|
| **Kokoro v1.0** | Neutral | Natural | ★★★★★ | 24 kHz | tts, natural, multilingual | High-quality natural TTS engine with multilingual support |
| **XTTS v2** | Neutral | Natural | ★★★★★ | 24 kHz | cloning, multilingual, expressive | Top-tier voice cloning model with multilingual and expressive capabilities |
| **F5-TTS** | Neutral | Natural | ★★★★ | 24 kHz | fast, cloning, natural | Fast voice cloning model with natural-sounding output |
| **StyleTTS 2** | Neutral | Expressive | ★★★★★ | 24 kHz | expressive, style, prosody | Expressive TTS model with fine-grained style and prosody control |

### Auto-Detected Models (No Metadata Override)

Models found during catalog scan that do not have entries in `model-metadata.json` are auto-detected with:
- **Name**: Derived from directory name (hyphens/underscores → title case)
- **Gender**: Inferred from keywords in the name (female/male/neutral)
- **Style**: Defaults to "natural"
- **Quality**: Defaults to 3
- **Sample Rate**: Defaults to 40000
- **Tags**: Empty

These include additional model framework directories like `bark`, `chatterbox`, `fish-speech`, `gpt-sovits`, `matcha-tts`, `metavoice`, `openvoice-v2`, `piper`, `parler-tts`, `tortoise-tts`, `vall-e-x`, and `vits`.

## Voice Categories

### By Gender

| Gender | Count | Examples |
|--------|-------|----------|
| Female | 11 | Lunar Studio, Ami Mizuno, Ariana Grande, Female Whisper TTS |
| Male | 3 | Liberty Prime, Kanye West, Elvis Presley |
| Neutral | 10 | NTTS AI, Google Assistant, Kokoro, XTTS v2, DECTalk |

### By Style

| Style | Count | Examples |
|-------|-------|----------|
| Natural | 11 | Lunar Studio, NTTS AI, Google Assistant, Kokoro |
| Character | 5 | Liberty Prime, Asuka Kazama, Fern, Rose, BlazBlue Noel |
| Expressive | 4 | Makoto Kino, Kanye West, StyleTTS 2 |
| Singing | 2 | Ariana Grande, Elvis Presley |
| Broadcast | 2 | NOAA Radio, DECTalk |
| Whisper | 1 | Female Whisper TTS |

### By Quality

| Quality | Count | Examples |
|---------|-------|----------|
| ★★★★★ (5) | 4 | Lunar Studio, Kokoro, XTTS v2, StyleTTS 2 |
| ★★★★ (4) | 9 | NTTS AI, Google Assistant, Ami Mizuno, F5-TTS |
| ★★★ (3) | 10 | NOAA Radio, Liberty Prime, Kanye West, PhoenixStorm |
| ★★ (2) | 1 | DECTalk |

## Mood Mappings

The Voice Studio search system includes mood quick filters that map to voice attributes:

| Mood | Matching Criteria | Example Matches |
|------|-------------------|-----------------|
| **Warm** | style: natural, tags contain "warm" or "soft", quality ≥ 3 | Lunar Studio, Elvis Presley |
| **Calm** | style: natural or whisper, tags contain "calm" or "gentle" | Female Whisper TTS, Rose (BFDI/E) |
| **Bright** | style: expressive, tags contain "bright", "clear", or "crisp" | Makoto Kino, Ami Mizuno |
| **Deep** | gender: male, tags contain "deep", "bass", or "low" | Liberty Prime, Kanye West, Elvis Presley |
| **Robotic** | style: broadcast, provider: piper or dectalk | DECTalk, NOAA Radio |
| **Professional** | style: natural, quality ≥ 4, tags contain "studio" or "neutral" | Lunar Studio, NTTS AI |

## Adding New Models

1. **Place model files** on VPS at `/opt/rvc-models/models/<model-name>/`
2. **Optionally add metadata** in `/opt/rvc-models/catalog/model-metadata.json`:
   ```json
   {
     "model-name": {
       "name": "Display Name",
       "gender": "female",
       "accent": "en-US",
       "accentLabel": "American English",
       "style": "natural",
       "quality": 4,
       "sampleRate": 24000,
       "tags": ["tag1", "tag2"],
       "description": "Short description of the voice."
     }
   }
   ```
3. **Generate preview clip** by running `generate-previews.sh`
4. **Rebuild catalog** — click Refresh in Voice Studio Store tab, or `POST /api/catalog/rebuild`
5. New model appears in Store tab immediately

## Catalog JSON Schema

```json
{
  "version": 1,
  "generatedAt": "2026-04-10T15:37:09Z",
  "totalModels": 30,
  "totalSizeBytes": 23695694128,
  "voices": [
    {
      "id": "rvc-voices/lunar-studio",
      "name": "Lunar Studio",
      "description": "High-fidelity female studio voice...",
      "gender": "female",
      "accent": "en-US",
      "accentLabel": "American English",
      "style": "natural",
      "quality": 5,
      "sampleRate": 48000,
      "fileSize": 145678901,
      "tags": ["warm", "studio", "hifi", "assistant"],
      "downloadUrl": "/models/rvc-voices/lunar-studio",
      "heroClipUrl": "/preview/rvc-voices-lunar-studio.mp3",
      "category": "rvc",
      "addedAt": "2026-04-10T12:00:00Z"
    }
  ]
}
```
