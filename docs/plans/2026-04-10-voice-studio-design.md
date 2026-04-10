# Voice Studio Design — KiloCode Speech System Overhaul

**Date:** 2026-04-10
**Status:** Approved
**Approach:** Dedicated Voice Panel ("Voice Studio") with Library | Store tabs

## Overview

Replace the monolithic SpeechTab with a two-part architecture:
1. **SpeechTab (simplified)** — Enable/disable, provider, volume, provider config, "Open Voice Studio" button
2. **Voice Studio Panel (new)** — Full-width editor panel with Library and Store tabs, smart search, hybrid card/list views, download management, and hands-free interaction modes

## Architecture

### Entry Points

**SpeechTab** stays in Settings, minimal:
- Enable/disable toggle, provider selector, volume slider
- Provider-specific config (Docker port, Azure key, browser voice)
- "Open Voice Studio" button launches the panel

**VoiceStudioPanel** opens as editor tab:
- Registered as `kilocode.voiceStudio` command
- Own webview, same SolidJS build pipeline
- Two tabs: Library | Store
- Shares message protocol with KiloProvider

### Component Tree

```
VoiceStudioPanel (new webview)
+-- VoiceStudioHeader
|   +-- Tab switcher (Library | Store)
|   +-- SearchBar (fuzzy + voice-to-search mic toggle)
|   +-- ViewToggle (grid/list)
+-- Library tab
|   +-- FilterBar (Gender, Accent, Style, Provider, Mood, Favorites)
|   +-- VoiceGrid / VoiceList (hybrid, toggleable)
|   |   +-- VoiceCard / VoiceRow
|   |       +-- PlayButton, FavoriteButton, SetActiveButton
|   +-- NowPlaying bar (active voice + mini controls)
+-- Store tab
|   +-- FilterBar (same + "Installed" toggle)
|   +-- VoiceGrid / VoiceList
|   |   +-- StoreCard / StoreRow
|   |       +-- HeroPreviewButton, CustomPreviewButton
|   |       +-- DownloadButton (progress ring), SizeBadge, QualityBadge
|   +-- DownloadQueue bar (active downloads + disk usage)
+-- Shared
    +-- AudioPlayer (mini progress bar player)
    +-- VoiceAvatar (provider+gender color icon)
    +-- TagChip (reusable filter chip)
    +-- AutocompleteDropdown
```

## Data Model

### Unified Voice Schema

```typescript
interface VoiceEntry {
  id: string                    // "rvc:lunar-studio" | "azure:en-US-AriaNeural"
  provider: string              // "rvc" | "azure" | "browser" | "kokoro" | "piper" | "xtts" | "f5tts"
  name: string
  description: string
  gender: "male" | "female" | "neutral"
  accent: string                // "en-US" | "en-GB" etc.
  accentLabel: string           // "American English"
  style: string                 // "natural" | "expressive" | "whisper" | "broadcast" | "singing" | "character"
  quality: 1 | 2 | 3 | 4 | 5
  sampleRate: number
  fileSize: number              // bytes, 0 for browser/azure
  epochs?: number
  tags: string[]
  installed: boolean
  favorite: boolean
  lastUsed?: number
  heroClipUrl?: string
  downloadUrl?: string
  localPath?: string
}
```

### VPS Catalog Response

```typescript
interface VoiceCatalogResponse {
  version: number
  generatedAt: string
  totalModels: number
  totalSizeBytes: number
  voices: StoreVoiceEntry[]
}
```

### Persistence (VSCode globalState)

- `kilocode.voiceFavorites: string[]` — favorite voice IDs
- `kilocode.voiceHistory: { id: string, timestamp: number }[]` — last 50 used
- `kilocode.voiceSavedSearches: { name: string, query: string, filters: FilterState }[]`
- `kilocode.voiceInteractionMode: "silent" | "assist" | "handsfree"`

## Search System

### Three Layers

1. **Fuzzy Text Search** — weighted scoring across name (10x), tags (5x), description (2x), other (1x). Debounced 150ms.
2. **Structured Filters** — Gender, Accent, Style, Provider, Mood. AND between categories, OR within. Live counts.
3. **Voice-to-Search** — Browser Web Speech API SpeechRecognition. Mic button toggle. Client-side only.

### Autocomplete Dropdown

Four sections: Recent Searches, Accent/Category Matches, Voice Name Matches, Quick Filter Suggestions.

### Saved Searches

Store search text + active filters as named preset. Sidebar display, click to restore.

### Mood Quick Filters

| Mood | Maps To |
|------|---------|
| Warm | style: natural, tags: warm/soft, quality >= 3 |
| Calm | style: natural/whisper, tags: calm/gentle |
| Bright | style: expressive, tags: bright/clear/crisp |
| Deep | gender: male, tags: deep/bass/low |
| Robotic | style: broadcast, provider: piper/dectalk |
| Professional | style: natural, quality >= 4, tags: studio/neutral |

## Store Features

### Download System

```typescript
interface DownloadJob {
  id: string
  modelId: string
  name: string
  url: string
  totalBytes: number
  receivedBytes: number
  status: "queued" | "downloading" | "extracting" | "installing" | "done" | "failed"
  error?: string
}
```

Chunked transfer with progress messages. Download queue bar shows active downloads + disk usage vs 100GB cap. Downloads continue in extension background when panel is closed.

### Preview System

- **Hero clips**: Pre-generated 5-second MP3 per model on VPS. Instant playback.
- **Custom preview**: POST /api/preview with custom text. On-demand synthesis via edge-tts on VPS.

## Voice Switching & Interaction Modes

### Quick Voice Switch

- Command palette: `KiloCode: Switch Voice` — quick-pick from favorites then all installed
- Keyboard shortcut: `Ctrl+Shift+V` — cycles through favorites
- Status bar item: shows current voice name, click to open quick-pick

### Interaction Modes

| Mode | Speech Out | Voice Commands In | Use Case |
|------|-----------|-------------------|----------|
| Silent | Off | Off | Focused coding, no audio |
| Assist | Auto-speak responses | Manual trigger only | Read responses aloud, type commands |
| Hands-Free | Auto-speak responses | Always listening | Full bidirectional, code while talking |

### Hands-Free Voice Commands

Uses Web Speech API SpeechRecognition (continuous mode):

| Command | Action |
|---------|--------|
| "switch to [voice name]" | Changes active voice by fuzzy name match |
| "read that again" | Re-speaks last response |
| "stop" / "quiet" | Stops current speech |
| "slower" / "faster" | Adjusts speech rate +/- 0.2 |
| "louder" / "softer" | Adjusts volume +/- 10% |
| "hands free off" | Switches to Assist mode |

Wake word not required — commands detected by keyword matching against the recognized transcript. Non-command speech is ignored.

## Message Protocol

### Webview to Extension

```
openVoiceStudio           — launch panel from settings
fetchVoiceLibrary         — get all installed voices across providers
fetchStoreModels          — get catalog from VPS
previewStoreVoice         — on-demand synthesis request
downloadModel             — start download with progress
cancelDownload            — cancel active download
deleteModel               — remove installed model
toggleFavorite            — persist favorite
setActiveVoice            — set as current for provider
saveSearch                — persist search preset
switchInteractionMode     — change silent/assist/handsfree
voiceCommand              — forward recognized voice command
```

### Extension to Webview

```
voiceLibraryLoaded        — installed voices with metadata
storeModelsLoaded         — catalog from VPS
downloadProgress          — progress update (0-100%)
downloadComplete          — model installed successfully
downloadFailed            — error details
previewAudioReady         — base64 audio for playback
voiceCommandAck           — command executed confirmation
interactionModeChanged    — mode switch confirmed
```

## VPS Infrastructure

### Catalog Builder (build-catalog.py)

Scans /opt/rvc-models/models/, extracts metadata per model, reads overrides from model-metadata.json, writes catalog.json.

### Preview Generator (generate-previews.sh)

For each model without a preview: synthesize standard sentence via edge-tts, encode 64kbps MP3, save to /opt/rvc-models/previews/.

### API Endpoints

```
GET  /api/catalog                  — full catalog JSON
GET  /api/catalog?page=N&limit=24  — paginated
GET  /api/catalog/search?q=text    — server-side search
GET  /api/preview/{model-id}.mp3   — hero clip
POST /api/preview                  — on-demand { modelId, text }
GET  /api/disk                     — { usedBytes, maxBytes, modelCount }
GET  /api/health                   — service health
GET  /api/voices                   — edge-tts voice list
POST /api/synthesize               — edge-tts synthesis
```

## Quality Gates

### Audit Type 1: Code Completeness (6 layers)

1. Component — renders without errors, no stubs/TODO, all props used
2. Message — every type has sender AND handler, no orphans
3. State — every signal initialized, updated, cleaned up
4. i18n — every string uses t(), all keys have values
5. Config — every package.json setting has reader + UI control
6. Style — VS Code theme tokens only, responsive

### Audit Type 2: Integration (6 layers)

1. Webview to Extension — all messages round-trip
2. Extension to Docker — health, voices, synthesis, install
3. Extension to VPS — catalog, preview, download with progress
4. State persistence — favorites, history, searches survive restart
5. Provider switching — Library/Store/active voice sync
6. Search pipeline — fuzzy + filters + autocomplete + saved combine

### Audit Type 3: E2E Feature (6 layers)

1. Library flow — open, filter, search, preview, set active, verify speech
2. Store flow — browse, filter, preview hero, custom preview, download, use
3. Search flow — type, autocomplete, select, filter, save, reload, restore
4. Download flow — start, progress, cancel, retry, complete, install, appear
5. Settings flow — change provider syncs Studio, change voice syncs Settings
6. Interaction modes — silent/assist/handsfree switch, voice commands work

## Documentation Deliverables

1. docs/speech/ARCHITECTURE.md — SVG diagrams: data flow, component tree, message protocol
2. docs/speech/VOICE-STUDIO-GUIDE.md — user guide: Library, Store, search, downloads, hands-free
3. docs/speech/VPS-SETUP.md — deployment, Docker, nginx, collection, catalog, previews
4. docs/speech/API-REFERENCE.md — all endpoints, schemas, errors, rate limits
5. docs/speech/VOICE-CATALOG.md — complete model inventory with metadata
6. docs/speech/TESTING.md — 3 audit types, test commands, coverage map
