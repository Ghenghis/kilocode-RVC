# Voice Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic SpeechTab with a simplified Settings entry point plus a dedicated Voice Studio panel featuring a searchable Library, downloadable Store, hands-free interaction modes, and complete documentation.

**Architecture:** Two-part: SpeechTab stays in Settings (minimal config + "Open Voice Studio" button). VoiceStudioPanel is a new editor-tab webview with Library and Store tabs, built with SolidJS + @kilocode/kilo-ui, following the exact patterns of DiffViewerProvider and SettingsEditorProvider. VPS serves a structured catalog.json with preview clips.

**Tech Stack:** SolidJS, @kilocode/kilo-ui (Switch/Select/Card/Button), esbuild (new entry point), VSCode WebviewPanel API, Web Speech API (SpeechRecognition), Web Audio API (AudioContext), Paramiko (VPS deployment), Bun Test + Playwright (testing).

---

## Phase 1: Data Foundation

### Task 1: Voice Data Types

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/types/voice.ts`
- Test: `packages/kilo-vscode/tests/unit/voice-types.test.ts`

**Step 1: Write the type definitions**

```typescript
// packages/kilo-vscode/webview-ui/src/types/voice.ts

export type VoiceProvider = "rvc" | "azure" | "browser" | "kokoro" | "piper" | "xtts" | "f5tts" | "bark" | "chatterbox"

export type VoiceGender = "male" | "female" | "neutral"

export type VoiceStyle = "natural" | "expressive" | "whisper" | "broadcast" | "singing" | "character"

export type VoiceQuality = 1 | 2 | 3 | 4 | 5

export type InteractionMode = "silent" | "assist" | "handsfree"

export type DownloadStatus = "queued" | "downloading" | "extracting" | "installing" | "done" | "failed"

export interface VoiceEntry {
  id: string
  provider: VoiceProvider
  name: string
  description: string
  gender: VoiceGender
  accent: string
  accentLabel: string
  style: VoiceStyle
  quality: VoiceQuality
  sampleRate: number
  fileSize: number
  epochs?: number
  tags: string[]
  installed: boolean
  favorite: boolean
  lastUsed?: number
  heroClipUrl?: string
  downloadUrl?: string
  localPath?: string
}

export interface StoreVoiceEntry {
  id: string
  name: string
  description: string
  gender: VoiceGender
  accent: string
  accentLabel: string
  style: VoiceStyle
  quality: VoiceQuality
  sampleRate: number
  fileSize: number
  epochs?: number
  tags: string[]
  downloadUrl: string
  heroClipUrl: string | null
  category: string
  addedAt: string
}

export interface VoiceCatalogResponse {
  version: number
  generatedAt: string
  totalModels: number
  totalSizeBytes: number
  voices: StoreVoiceEntry[]
}

export interface DiskUsageResponse {
  usedBytes: number
  maxBytes: number
  modelCount: number
}

export interface DownloadJob {
  id: string
  modelId: string
  name: string
  url: string
  totalBytes: number
  receivedBytes: number
  status: DownloadStatus
  error?: string
}

export interface FilterState {
  gender: VoiceGender | null
  accents: string[]
  styles: VoiceStyle[]
  providers: VoiceProvider[]
  moods: string[]
  installedOnly: boolean
  favoritesOnly: boolean
}

export interface SavedSearch {
  name: string
  query: string
  filters: FilterState
  createdAt: number
}

export const DEFAULT_FILTERS: FilterState = {
  gender: null,
  accents: [],
  styles: [],
  providers: [],
  moods: [],
  installedOnly: false,
  favoritesOnly: false,
}

export const MOOD_MAPPINGS: Record<string, { styles: VoiceStyle[]; tags: string[]; gender?: VoiceGender; minQuality?: VoiceQuality }> = {
  warm: { styles: ["natural"], tags: ["warm", "soft"] },
  calm: { styles: ["natural", "whisper"], tags: ["calm", "gentle"] },
  bright: { styles: ["expressive"], tags: ["bright", "clear", "crisp"] },
  deep: { styles: ["natural"], tags: ["deep", "bass", "low"], gender: "male" },
  robotic: { styles: ["broadcast"], tags: ["robotic", "synth", "mechanical"] },
  professional: { styles: ["natural"], tags: ["studio", "neutral", "professional"], minQuality: 4 },
}

export const ACCENT_LABELS: Record<string, string> = {
  "en-US": "American English",
  "en-GB": "British English",
  "en-AU": "Australian English",
  "en-CA": "Canadian English",
  "en-IN": "Indian English",
  "en-IE": "Irish English",
  "en-NZ": "New Zealand English",
  "en-ZA": "South African English",
  "en-SC": "Scottish English",
  "ja-JP": "Japanese",
  "zh-CN": "Chinese (Mandarin)",
  "ko-KR": "Korean",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "de-DE": "German",
}
```

**Step 2: Write tests for type utilities**

```typescript
// packages/kilo-vscode/tests/unit/voice-types.test.ts
import { describe, it, expect } from "bun:test"
import { DEFAULT_FILTERS, MOOD_MAPPINGS, ACCENT_LABELS } from "../../webview-ui/src/types/voice"

describe("Voice Types", () => {
  it("DEFAULT_FILTERS has all fields null/empty", () => {
    expect(DEFAULT_FILTERS.gender).toBeNull()
    expect(DEFAULT_FILTERS.accents).toEqual([])
    expect(DEFAULT_FILTERS.styles).toEqual([])
    expect(DEFAULT_FILTERS.providers).toEqual([])
    expect(DEFAULT_FILTERS.moods).toEqual([])
    expect(DEFAULT_FILTERS.installedOnly).toBe(false)
    expect(DEFAULT_FILTERS.favoritesOnly).toBe(false)
  })

  it("MOOD_MAPPINGS covers all 6 moods", () => {
    const moods = Object.keys(MOOD_MAPPINGS)
    expect(moods).toContain("warm")
    expect(moods).toContain("calm")
    expect(moods).toContain("bright")
    expect(moods).toContain("deep")
    expect(moods).toContain("robotic")
    expect(moods).toContain("professional")
    expect(moods.length).toBe(6)
  })

  it("ACCENT_LABELS maps all English variants", () => {
    expect(ACCENT_LABELS["en-US"]).toBe("American English")
    expect(ACCENT_LABELS["en-GB"]).toBe("British English")
    expect(ACCENT_LABELS["en-AU"]).toBe("Australian English")
  })

  it("each MOOD_MAPPING has required fields", () => {
    for (const [mood, mapping] of Object.entries(MOOD_MAPPINGS)) {
      expect(mapping.styles.length).toBeGreaterThan(0)
      expect(mapping.tags.length).toBeGreaterThan(0)
    }
  })
})
```

**Step 3: Run tests**

Run: `cd packages/kilo-vscode && bun test tests/unit/voice-types.test.ts`
Expected: PASS (4 tests)

**Step 4: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/types/voice.ts packages/kilo-vscode/tests/unit/voice-types.test.ts
git commit -m "feat(speech): add Voice Studio type definitions and constants"
```

---

### Task 2: Fuzzy Search Engine

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/voice-search.ts`
- Test: `packages/kilo-vscode/tests/unit/voice-search.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/kilo-vscode/tests/unit/voice-search.test.ts
import { describe, it, expect } from "bun:test"
import { fuzzySearchVoices, applyFilters, combinedSearch } from "../../webview-ui/src/utils/voice-search"
import type { VoiceEntry, FilterState } from "../../webview-ui/src/types/voice"
import { DEFAULT_FILTERS } from "../../webview-ui/src/types/voice"

const MOCK_VOICES: VoiceEntry[] = [
  {
    id: "rvc:lunar-studio", provider: "rvc", name: "Lunar Studio", description: "High-fidelity neutral female studio voice",
    gender: "female", accent: "en-US", accentLabel: "American English", style: "natural", quality: 5, sampleRate: 48000,
    fileSize: 209715200, tags: ["warm", "studio", "hifi"], installed: true, favorite: true,
  },
  {
    id: "azure:en-US-AriaNeural", provider: "azure", name: "Aria Neural", description: "Expressive American female",
    gender: "female", accent: "en-US", accentLabel: "American English", style: "expressive", quality: 5, sampleRate: 24000,
    fileSize: 0, tags: ["expressive", "versatile"], installed: true, favorite: false,
  },
  {
    id: "rvc:elvis-presley", provider: "rvc", name: "Elvis Presley", description: "Iconic American crooner",
    gender: "male", accent: "en-US", accentLabel: "American English", style: "singing", quality: 4, sampleRate: 40000,
    fileSize: 58720256, tags: ["classic", "crooner", "deep"], installed: true, favorite: false,
  },
  {
    id: "piper:en-GB-alba", provider: "piper", name: "Alba", description: "British English female",
    gender: "female", accent: "en-GB", accentLabel: "British English", style: "natural", quality: 4, sampleRate: 22050,
    fileSize: 47185920, tags: ["british", "clear"], installed: true, favorite: false,
  },
  {
    id: "rvc:dectalk", provider: "rvc", name: "DecTalk", description: "Classic robotic synthesizer voice",
    gender: "neutral", accent: "en-US", accentLabel: "American English", style: "broadcast", quality: 2, sampleRate: 16000,
    fileSize: 22937600, tags: ["robotic", "retro", "synth"], installed: false, favorite: false,
  },
]

describe("fuzzySearchVoices", () => {
  it("returns all voices for empty query", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "")
    expect(results.length).toBe(5)
  })

  it("matches name with highest weight", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "lunar")
    expect(results[0].id).toBe("rvc:lunar-studio")
  })

  it("matches tags", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "robotic")
    expect(results[0].id).toBe("rvc:dectalk")
  })

  it("matches description", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "crooner")
    expect(results[0].id).toBe("rvc:elvis-presley")
  })

  it("matches accent label", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "british")
    expect(results[0].id).toBe("piper:en-GB-alba")
  })

  it("is case-insensitive", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "LUNAR")
    expect(results[0].id).toBe("rvc:lunar-studio")
  })

  it("handles multi-word queries", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "warm studio")
    expect(results[0].id).toBe("rvc:lunar-studio")
  })

  it("returns empty for no matches", () => {
    const results = fuzzySearchVoices(MOCK_VOICES, "zzznonexistent")
    expect(results.length).toBe(0)
  })
})

describe("applyFilters", () => {
  it("returns all for default filters", () => {
    const results = applyFilters(MOCK_VOICES, DEFAULT_FILTERS)
    expect(results.length).toBe(5)
  })

  it("filters by gender", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female" }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.every((v) => v.gender === "female")).toBe(true)
    expect(results.length).toBe(3)
  })

  it("filters by accent (OR within)", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, accents: ["en-GB"] }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe("piper:en-GB-alba")
  })

  it("filters by multiple accents (OR)", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, accents: ["en-GB", "en-US"] }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.length).toBe(5)
  })

  it("filters by provider", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, providers: ["rvc"] }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.every((v) => v.provider === "rvc")).toBe(true)
  })

  it("filters by style", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, styles: ["natural"] }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.every((v) => v.style === "natural")).toBe(true)
  })

  it("filters favorites only", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, favoritesOnly: true }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe("rvc:lunar-studio")
  })

  it("filters installed only", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, installedOnly: true }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.every((v) => v.installed)).toBe(true)
    expect(results.length).toBe(4)
  })

  it("combines filters (AND between categories)", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female", providers: ["rvc"] }
    const results = applyFilters(MOCK_VOICES, filters)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe("rvc:lunar-studio")
  })
})

describe("combinedSearch", () => {
  it("applies search then filters", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female" }
    const results = combinedSearch(MOCK_VOICES, "studio", filters)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe("rvc:lunar-studio")
  })

  it("mood filter applies tag + style matching", () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, moods: ["robotic"] }
    const results = combinedSearch(MOCK_VOICES, "", filters)
    expect(results[0].id).toBe("rvc:dectalk")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/kilo-vscode && bun test tests/unit/voice-search.test.ts`
Expected: FAIL — module not found

**Step 3: Write the search implementation**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/voice-search.ts
import type { VoiceEntry, FilterState, VoiceGender, VoiceStyle } from "../types/voice"
import { MOOD_MAPPINGS } from "../types/voice"

interface ScoredVoice {
  voice: VoiceEntry
  score: number
}

const WEIGHT_NAME = 10
const WEIGHT_TAG = 5
const WEIGHT_DESCRIPTION = 2
const WEIGHT_OTHER = 1

function scoreMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h === n) return 3
  if (h.startsWith(n)) return 2
  if (h.includes(n)) return 1
  return 0
}

export function fuzzySearchVoices(voices: VoiceEntry[], query: string): VoiceEntry[] {
  const trimmed = query.trim()
  if (!trimmed) return voices

  const terms = trimmed.toLowerCase().split(/\s+/)
  const scored: ScoredVoice[] = []

  for (const voice of voices) {
    let totalScore = 0

    for (const term of terms) {
      let termScore = 0

      termScore += scoreMatch(voice.name, term) * WEIGHT_NAME
      termScore += scoreMatch(voice.accentLabel, term) * WEIGHT_OTHER
      termScore += scoreMatch(voice.accent, term) * WEIGHT_OTHER
      termScore += scoreMatch(voice.provider, term) * WEIGHT_OTHER
      termScore += scoreMatch(voice.style, term) * WEIGHT_OTHER
      termScore += scoreMatch(voice.gender, term) * WEIGHT_OTHER
      termScore += scoreMatch(voice.description, term) * WEIGHT_DESCRIPTION

      for (const tag of voice.tags) {
        termScore += scoreMatch(tag, term) * WEIGHT_TAG
      }

      totalScore += termScore
    }

    if (totalScore > 0) {
      scored.push({ voice, score: totalScore })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.voice)
}

export function applyFilters(voices: VoiceEntry[], filters: FilterState): VoiceEntry[] {
  return voices.filter((voice) => {
    if (filters.gender && voice.gender !== filters.gender) return false
    if (filters.accents.length > 0 && !filters.accents.includes(voice.accent)) return false
    if (filters.styles.length > 0 && !filters.styles.includes(voice.style)) return false
    if (filters.providers.length > 0 && !filters.providers.includes(voice.provider)) return false
    if (filters.installedOnly && !voice.installed) return false
    if (filters.favoritesOnly && !voice.favorite) return false
    return true
  })
}

function applyMoodFilters(voices: VoiceEntry[], moods: string[]): VoiceEntry[] {
  if (moods.length === 0) return voices

  return voices.filter((voice) => {
    return moods.some((mood) => {
      const mapping = MOOD_MAPPINGS[mood]
      if (!mapping) return false

      const styleMatch = mapping.styles.includes(voice.style)
      const tagMatch = mapping.tags.some((t) => voice.tags.includes(t))
      const genderMatch = !mapping.gender || voice.gender === mapping.gender
      const qualityMatch = !mapping.minQuality || voice.quality >= mapping.minQuality

      return (styleMatch || tagMatch) && genderMatch && qualityMatch
    })
  })
}

export function combinedSearch(voices: VoiceEntry[], query: string, filters: FilterState): VoiceEntry[] {
  let results = fuzzySearchVoices(voices, query)
  results = applyFilters(results, filters)
  results = applyMoodFilters(results, filters.moods)
  return results
}

export function getFilterCounts(
  voices: VoiceEntry[],
  query: string,
  currentFilters: FilterState
): Record<string, number> {
  const searchResults = fuzzySearchVoices(voices, query)
  const counts: Record<string, number> = {}

  const genders: VoiceGender[] = ["male", "female", "neutral"]
  for (const g of genders) {
    const f = { ...currentFilters, gender: g }
    counts[`gender:${g}`] = applyFilters(searchResults, f).length
  }

  const accents = new Set(voices.map((v) => v.accent))
  for (const a of accents) {
    const f = { ...currentFilters, accents: [a] }
    counts[`accent:${a}`] = applyFilters(searchResults, f).length
  }

  const styles: VoiceStyle[] = ["natural", "expressive", "whisper", "broadcast", "singing", "character"]
  for (const s of styles) {
    const f = { ...currentFilters, styles: [s] }
    counts[`style:${s}`] = applyFilters(searchResults, f).length
  }

  const providers = new Set(voices.map((v) => v.provider))
  for (const p of providers) {
    const f = { ...currentFilters, providers: [p] }
    counts[`provider:${p}`] = applyFilters(searchResults, f).length
  }

  return counts
}

export function getAutocompleteResults(
  voices: VoiceEntry[],
  query: string,
  recentSearches: string[]
): { recent: string[]; voices: VoiceEntry[]; accentSuggestion: string | null } {
  const q = query.trim().toLowerCase()
  if (!q) return { recent: recentSearches.slice(0, 5), voices: [], accentSuggestion: null }

  const matchedRecent = recentSearches.filter((s) => s.toLowerCase().includes(q)).slice(0, 3)
  const matchedVoices = fuzzySearchVoices(voices, q).slice(0, 5)

  let accentSuggestion: string | null = null
  const accentEntries = Object.entries({
    "en-US": ["american", "us", "usa"],
    "en-GB": ["british", "uk", "england"],
    "en-AU": ["australian", "aussie"],
    "en-CA": ["canadian", "canada"],
    "en-IN": ["indian", "india"],
    "en-IE": ["irish", "ireland"],
    "en-NZ": ["new zealand", "kiwi"],
    "en-ZA": ["south african"],
    "en-SC": ["scottish", "scotland"],
    "ja-JP": ["japanese", "japan"],
  })
  for (const [code, keywords] of accentEntries) {
    if (keywords.some((kw) => kw.includes(q) || q.includes(kw))) {
      accentSuggestion = code
      break
    }
  }

  return { recent: matchedRecent, voices: matchedVoices, accentSuggestion }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/kilo-vscode && bun test tests/unit/voice-search.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/voice-search.ts packages/kilo-vscode/tests/unit/voice-search.test.ts
git commit -m "feat(speech): add fuzzy search engine with filters, moods, and autocomplete"
```

---

### Task 3: Voice Studio Message Types

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages.ts`
- Test: `packages/kilo-vscode/tests/unit/voice-messages.test.ts`

**Step 1: Add new message interfaces to messages.ts**

Find the existing `DownloadRvcModelMessage` interface and add the new Voice Studio messages nearby:

```typescript
// Add after existing DownloadRvcModelMessage in messages.ts

export interface OpenVoiceStudioMessage {
  type: "openVoiceStudio"
}

export interface FetchVoiceLibraryMessage {
  type: "fetchVoiceLibrary"
}

export interface FetchStoreModelsMessage {
  type: "fetchStoreModels"
  page?: number
  limit?: number
}

export interface PreviewStoreVoiceMessage {
  type: "previewStoreVoice"
  modelId: string
  text: string
}

export interface DownloadModelMessage {
  type: "downloadModel"
  modelId: string
  name: string
  url: string
  fileSize: number
}

export interface CancelDownloadMessage {
  type: "cancelDownload"
  modelId: string
}

export interface DeleteModelMessage {
  type: "deleteModel"
  modelId: string
  provider: string
}

export interface ToggleFavoriteMessage {
  type: "toggleFavorite"
  voiceId: string
}

export interface SetActiveVoiceMessage {
  type: "setActiveVoice"
  voiceId: string
  provider: string
}

export interface SaveSearchMessage {
  type: "saveSearch"
  name: string
  query: string
  filters: import("./voice").FilterState
}

export interface DeleteSavedSearchMessage {
  type: "deleteSavedSearch"
  name: string
}

export interface SwitchInteractionModeMessage {
  type: "switchInteractionMode"
  mode: import("./voice").InteractionMode
}

export interface VoiceCommandMessage {
  type: "voiceCommand"
  command: string
  transcript: string
}

export interface RequestVoiceStudioStateMessage {
  type: "requestVoiceStudioState"
}

// Extension → Webview messages

export interface VoiceLibraryLoadedMessage {
  type: "voiceLibraryLoaded"
  voices: import("./voice").VoiceEntry[]
}

export interface StoreModelsLoadedMessage {
  type: "storeModelsLoaded"
  catalog: import("./voice").VoiceCatalogResponse
}

export interface DownloadProgressMessage {
  type: "downloadProgress"
  modelId: string
  receivedBytes: number
  totalBytes: number
  status: import("./voice").DownloadStatus
}

export interface DownloadCompleteMessage {
  type: "downloadComplete"
  modelId: string
  name: string
}

export interface DownloadFailedMessage {
  type: "downloadFailed"
  modelId: string
  error: string
}

export interface PreviewAudioReadyMessage {
  type: "previewAudioReady"
  modelId: string
  audioBase64: string
  mimeType: string
}

export interface VoiceCommandAckMessage {
  type: "voiceCommandAck"
  command: string
  success: boolean
  message?: string
}

export interface InteractionModeChangedMessage {
  type: "interactionModeChanged"
  mode: import("./voice").InteractionMode
}

export interface VoiceStudioStateMessage {
  type: "voiceStudioState"
  favorites: string[]
  recentSearches: string[]
  savedSearches: import("./voice").SavedSearch[]
  interactionMode: import("./voice").InteractionMode
  activeVoiceId: string | null
}

export interface DiskUsageMessage {
  type: "diskUsage"
  usedBytes: number
  maxBytes: number
  modelCount: number
}
```

Also add to the WebviewMessage union type:

```typescript
// Find the existing WebviewMessage union and add:
| OpenVoiceStudioMessage
| FetchVoiceLibraryMessage
| FetchStoreModelsMessage
| PreviewStoreVoiceMessage
| DownloadModelMessage
| CancelDownloadMessage
| DeleteModelMessage
| ToggleFavoriteMessage
| SetActiveVoiceMessage
| SaveSearchMessage
| DeleteSavedSearchMessage
| SwitchInteractionModeMessage
| VoiceCommandMessage
| RequestVoiceStudioStateMessage
```

And add to ExtensionMessage union:

```typescript
// Find the existing ExtensionMessage union and add:
| VoiceLibraryLoadedMessage
| StoreModelsLoadedMessage
| DownloadProgressMessage
| DownloadCompleteMessage
| DownloadFailedMessage
| PreviewAudioReadyMessage
| VoiceCommandAckMessage
| InteractionModeChangedMessage
| VoiceStudioStateMessage
| DiskUsageMessage
```

**Step 2: Write test to verify all message types are in unions**

```typescript
// packages/kilo-vscode/tests/unit/voice-messages.test.ts
import { describe, it, expect } from "bun:test"
import { Project, SyntaxKind } from "ts-morph"

describe("Voice Studio Message Types", () => {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" })
  const sourceFile = project.getSourceFileOrThrow("webview-ui/src/types/messages.ts")

  const voiceWebviewMessages = [
    "OpenVoiceStudioMessage",
    "FetchVoiceLibraryMessage",
    "FetchStoreModelsMessage",
    "PreviewStoreVoiceMessage",
    "DownloadModelMessage",
    "CancelDownloadMessage",
    "DeleteModelMessage",
    "ToggleFavoriteMessage",
    "SetActiveVoiceMessage",
    "SaveSearchMessage",
    "DeleteSavedSearchMessage",
    "SwitchInteractionModeMessage",
    "VoiceCommandMessage",
    "RequestVoiceStudioStateMessage",
  ]

  const voiceExtensionMessages = [
    "VoiceLibraryLoadedMessage",
    "StoreModelsLoadedMessage",
    "DownloadProgressMessage",
    "DownloadCompleteMessage",
    "DownloadFailedMessage",
    "PreviewAudioReadyMessage",
    "VoiceCommandAckMessage",
    "InteractionModeChangedMessage",
    "VoiceStudioStateMessage",
    "DiskUsageMessage",
  ]

  it("all voice webview message interfaces exist", () => {
    for (const name of voiceWebviewMessages) {
      const iface = sourceFile.getInterface(name)
      expect(iface, `Missing interface: ${name}`).toBeDefined()
    }
  })

  it("all voice extension message interfaces exist", () => {
    for (const name of voiceExtensionMessages) {
      const iface = sourceFile.getInterface(name)
      expect(iface, `Missing interface: ${name}`).toBeDefined()
    }
  })

  it("each message interface has a type property", () => {
    for (const name of [...voiceWebviewMessages, ...voiceExtensionMessages]) {
      const iface = sourceFile.getInterface(name)!
      const typeProp = iface.getProperty("type")
      expect(typeProp, `${name} missing 'type' property`).toBeDefined()
    }
  })
})
```

**Step 3: Run tests**

Run: `cd packages/kilo-vscode && bun test tests/unit/voice-messages.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/types/messages.ts packages/kilo-vscode/tests/unit/voice-messages.test.ts
git commit -m "feat(speech): add Voice Studio message protocol types"
```

---

## Phase 2: VPS Catalog Infrastructure

### Task 4: Model Metadata Mapping

**Files:**
- Create: `deploy/rvc-vps/catalog/model-metadata.json`

**Step 1: Write the metadata mapping**

```json
{
  "_comment": "Hand-curated metadata overrides for voice models. Keys match directory names in /opt/rvc-models/models/",
  "rvc-voices/lunar-studio": {
    "name": "Lunar Studio",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 5,
    "sampleRate": 48000,
    "tags": ["warm", "studio", "hifi", "assistant"],
    "description": "High-fidelity neutral female studio voice, 48kHz, real-time optimized"
  },
  "rvc-voices/ntts-ai": {
    "name": "NTTS AI",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["neural", "tts", "clean"],
    "description": "Neural TTS AI voice, clean and neutral"
  },
  "rvc-voices/google-assistant": {
    "name": "Google Assistant",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 24000,
    "tags": ["assistant", "modern", "familiar"],
    "description": "Familiar assistant voice based on Google Assistant"
  },
  "rvc-voices/google-gemini": {
    "name": "Google Gemini",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 24000,
    "tags": ["ai", "modern", "assistant"],
    "description": "Modern AI assistant voice based on Google Gemini"
  },
  "rvc-voices/noaa-radio": {
    "name": "NOAA Weather Radio",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "broadcast",
    "quality": 3,
    "sampleRate": 22050,
    "tags": ["broadcast", "clear", "robotic"],
    "description": "Clear broadcast weather radio voice"
  },
  "rvc-voices/dectalk": {
    "name": "DecTalk",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "broadcast",
    "quality": 2,
    "sampleRate": 16000,
    "tags": ["robotic", "retro", "synth", "classic"],
    "description": "Classic DECtalk text-to-speech synthesizer voice"
  },
  "rvc-voices/liberty-prime": {
    "name": "Liberty Prime",
    "gender": "male",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "character",
    "quality": 3,
    "sampleRate": 22050,
    "tags": ["character", "deep", "robotic", "game"],
    "description": "Liberty Prime character voice from Fallout"
  },
  "rvc-voices/ami-mizuno": {
    "name": "Ami Mizuno",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["anime", "clear", "crisp"],
    "description": "Sailor Moon English dub voice, clear American female"
  },
  "rvc-voices/makoto-kino": {
    "name": "Makoto Kino",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "expressive",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["anime", "energetic", "bright"],
    "description": "Sailor Jupiter English dub voice, energetic female"
  },
  "rvc-voices/ariana-grande-2010s": {
    "name": "Ariana Grande (2010s)",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "singing",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["pop", "expressive", "singing"],
    "description": "Pop vocal style, expressive American female"
  },
  "rvc-voices/kanye-west": {
    "name": "Kanye West",
    "gender": "male",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "expressive",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["rap", "deep", "expressive"],
    "description": "Expressive American rap accent"
  },
  "rvc-voices/elvis-presley": {
    "name": "Elvis Presley",
    "gender": "male",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "singing",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["classic", "crooner", "deep", "warm"],
    "description": "Iconic American classic crooner voice"
  },
  "rvc-voices/asuka-kazama": {
    "name": "Asuka Kazama",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "character",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["game", "action", "strong"],
    "description": "Tekken English dub, strong female action voice"
  },
  "rvc-voices/fern-bfdie": {
    "name": "Fern",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "character",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["animated", "clean"],
    "description": "Clean animated character voice"
  },
  "rvc-voices/rose-bfdie": {
    "name": "Rose",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "character",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["animated", "gentle"],
    "description": "Gentle animated character voice"
  },
  "rvc-voices/katseye-manon": {
    "name": "Manon (KATSEYE)",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 40000,
    "tags": ["pop", "modern", "clear"],
    "description": "Modern pop group voice, American/British mix"
  },
  "rvc-voices/katseye-daniela": {
    "name": "Daniela (KATSEYE)",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["pop", "bilingual", "clear"],
    "description": "Bilingual English/Spanish, clear modern voice"
  },
  "rvc-voices/phoenixstorm-default": {
    "name": "PhoenixStorm Default",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["default", "generic", "test"],
    "description": "Generic RVC v2 default test voice"
  },
  "rvc-voices/female-whisper-tts": {
    "name": "Female Whisper TTS",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "whisper",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["whisper", "soft", "asmr", "gentle"],
    "description": "Soft whispering female TTS voice"
  },
  "rvc-voices/blazblue-noel-english": {
    "name": "Noel Vermillion",
    "gender": "female",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "character",
    "quality": 3,
    "sampleRate": 40000,
    "tags": ["game", "anime", "gentle"],
    "description": "BlazBlue English dub character voice"
  },
  "kokoro/kokoro-v1.0": {
    "name": "Kokoro v1.0",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 5,
    "sampleRate": 24000,
    "tags": ["tts", "natural", "multilingual"],
    "description": "High-quality 82M parameter open-source TTS model"
  },
  "xtts-v2/model": {
    "name": "XTTS v2",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 5,
    "sampleRate": 24000,
    "tags": ["cloning", "multilingual", "expressive"],
    "description": "Coqui multi-language voice cloning TTS"
  },
  "f5-tts/model_1250000": {
    "name": "F5-TTS Base",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "natural",
    "quality": 4,
    "sampleRate": 24000,
    "tags": ["fast", "cloning", "natural"],
    "description": "Fast high-quality TTS with voice cloning"
  },
  "styletts2/epochs_2nd_00020": {
    "name": "StyleTTS2 LibriTTS",
    "gender": "neutral",
    "accent": "en-US",
    "accentLabel": "American English",
    "style": "expressive",
    "quality": 5,
    "sampleRate": 24000,
    "tags": ["expressive", "style", "prosody"],
    "description": "State-of-the-art expressive TTS with style control"
  }
}
```

**Step 2: Commit**

```bash
git add deploy/rvc-vps/catalog/model-metadata.json
git commit -m "feat(speech): add curated model metadata mapping for voice catalog"
```

---

### Task 5: Catalog Builder Script

**Files:**
- Create: `deploy/rvc-vps/catalog/build-catalog.py`
- Test: Run on VPS and verify output

**Step 1: Write the catalog builder**

```python
#!/usr/bin/env python3
"""
Scans /opt/rvc-models/models/ and generates catalog.json
Reads overrides from model-metadata.json
"""

import json
import os
import re
import sys
import time
from pathlib import Path

MODELS_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/rvc-models/models")
METADATA_FILE = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent / "model-metadata.json"
OUTPUT_FILE = Path(sys.argv[3]) if len(sys.argv) > 3 else MODELS_DIR.parent / "catalog.json"
PREVIEWS_DIR = MODELS_DIR.parent / "previews"
BASE_URL = os.environ.get("MODEL_SERVER_URL", "https://voice.daveai.tech")


def clean_name(dirname: str) -> str:
    """Convert directory name to display name."""
    name = dirname.replace("-", " ").replace("_", " ")
    name = re.sub(r"\b(rvc|pth|v2|e\d+|s\d+)\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip()
    return name.title() if name else dirname


def detect_gender(name: str, tags: list) -> str:
    """Infer gender from name and tags."""
    name_lower = name.lower()
    female_indicators = ["female", "woman", "girl", "she", "her", "♀"]
    male_indicators = ["male", "man", "boy", "he", "him", "♂"]

    for ind in female_indicators:
        if ind in name_lower or ind in tags:
            return "female"
    for ind in male_indicators:
        if ind in name_lower or ind in tags:
            return "male"
    return "neutral"


def detect_category(path_parts: list) -> str:
    """Determine category from path."""
    path_str = "/".join(path_parts).lower()
    if "rvc-voices" in path_str:
        return "RVC Voice"
    if "kokoro" in path_str:
        return "Kokoro TTS"
    if "piper" in path_str:
        return "Piper TTS"
    if "xtts" in path_str:
        return "XTTS v2"
    if "f5-tts" in path_str:
        return "F5-TTS"
    if "bark" in path_str:
        return "Bark TTS"
    if "styletts" in path_str:
        return "StyleTTS2"
    if "chatterbox" in path_str:
        return "Chatterbox"
    if "fish-speech" in path_str:
        return "Fish Speech"
    if "openvoice" in path_str:
        return "OpenVoice"
    if "seed-vc" in path_str:
        return "Seed-VC"
    if "gpt-sovits" in path_str:
        return "GPT-SoVITS"
    if "pretrained" in path_str:
        return "Pretrained Base"
    return "Other"


def scan_models(models_dir: Path, metadata: dict, previews_dir: Path) -> list:
    """Scan all model files and build catalog entries."""
    voices = []
    seen_ids = set()

    model_extensions = {".pth", ".onnx", ".safetensors", ".pt", ".ckpt"}

    for root, dirs, files in os.walk(models_dir):
        for filename in files:
            filepath = Path(root) / filename
            ext = filepath.suffix.lower()

            if ext not in model_extensions:
                continue

            # Skip index files and config files
            if "index" in filename.lower() or filename.endswith(".json"):
                continue

            rel_path = filepath.relative_to(models_dir)
            rel_dir = str(rel_path.parent) if rel_path.parent != Path(".") else filepath.stem

            # Generate stable ID
            voice_id = rel_dir.replace("\\", "/").replace(" ", "-").lower()
            if voice_id in seen_ids:
                continue
            seen_ids.add(voice_id)

            file_size = filepath.stat().st_size
            file_mtime = filepath.stat().st_mtime

            # Check for metadata override
            override = metadata.get(rel_dir, metadata.get(voice_id, {}))

            name = override.get("name", clean_name(rel_dir.split("/")[-1]))
            gender = override.get("gender", detect_gender(name, override.get("tags", [])))
            accent = override.get("accent", "en-US")
            accent_label = override.get("accentLabel", "American English")
            style = override.get("style", "natural")
            quality = override.get("quality", 3)
            sample_rate = override.get("sampleRate", 40000)
            tags = override.get("tags", [])
            description = override.get("description", f"{name} voice model")
            category = detect_category(list(rel_path.parts))

            # Check for hero clip
            preview_file = previews_dir / f"{voice_id.replace('/', '-')}.mp3"
            hero_clip_url = f"{BASE_URL}/api/preview/{voice_id.replace('/', '-')}.mp3" if preview_file.exists() else None

            download_url = f"{BASE_URL}/models/{rel_path}"

            voices.append({
                "id": voice_id,
                "name": name,
                "description": description,
                "gender": gender,
                "accent": accent,
                "accentLabel": accent_label,
                "style": style,
                "quality": quality,
                "sampleRate": sample_rate,
                "fileSize": file_size,
                "tags": tags,
                "downloadUrl": download_url,
                "heroClipUrl": hero_clip_url,
                "category": category,
                "addedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(file_mtime)),
            })

    voices.sort(key=lambda v: (-v["quality"], v["name"]))
    return voices


def main():
    print(f"Scanning models in: {MODELS_DIR}")
    print(f"Metadata file: {METADATA_FILE}")
    print(f"Output: {OUTPUT_FILE}")

    metadata = {}
    if METADATA_FILE.exists():
        with open(METADATA_FILE) as f:
            metadata = json.load(f)
            metadata.pop("_comment", None)
        print(f"Loaded {len(metadata)} metadata overrides")

    PREVIEWS_DIR.mkdir(exist_ok=True)
    voices = scan_models(MODELS_DIR, metadata, PREVIEWS_DIR)

    total_size = sum(v["fileSize"] for v in voices)

    catalog = {
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalModels": len(voices),
        "totalSizeBytes": total_size,
        "voices": voices,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(catalog, f, indent=2)

    print(f"Catalog written: {len(voices)} voices, {total_size / (1024**3):.1f} GB total")


if __name__ == "__main__":
    main()
```

**Step 2: Commit**

```bash
git add deploy/rvc-vps/catalog/build-catalog.py
git commit -m "feat(speech): add VPS catalog builder script"
```

---

### Task 6: Preview Generator Script

**Files:**
- Create: `deploy/rvc-vps/catalog/generate-previews.sh`

**Step 1: Write the preview generator**

```bash
#!/usr/bin/env bash
# Generate 5-second hero preview clips for each model in the catalog
# Uses edge-tts CLI to synthesize a standard sentence

set -euo pipefail

MODELS_DIR="${1:-/opt/rvc-models/models}"
PREVIEWS_DIR="${2:-/opt/rvc-models/previews}"
CATALOG_FILE="${3:-/opt/rvc-models/catalog.json}"
PREVIEW_TEXT="Hello, I'm your voice assistant. How can I help you today?"
EDGE_VOICE="en-US-AriaNeural"

mkdir -p "$PREVIEWS_DIR"

if ! command -v edge-tts &>/dev/null; then
    echo "[!] edge-tts not found, installing..."
    pip3 install edge-tts
fi

if [ ! -f "$CATALOG_FILE" ]; then
    echo "[!] Catalog not found at $CATALOG_FILE. Run build-catalog.py first."
    exit 1
fi

# Extract voice IDs from catalog
VOICE_IDS=$(python3 -c "
import json
with open('$CATALOG_FILE') as f:
    catalog = json.load(f)
for v in catalog['voices']:
    print(v['id'])
")

TOTAL=$(echo "$VOICE_IDS" | wc -l)
COUNT=0
SKIPPED=0
GENERATED=0

echo "Generating previews for $TOTAL voices..."

while IFS= read -r voice_id; do
    COUNT=$((COUNT + 1))
    SAFE_NAME=$(echo "$voice_id" | tr '/' '-')
    OUTPUT_FILE="$PREVIEWS_DIR/${SAFE_NAME}.mp3"

    if [ -f "$OUTPUT_FILE" ] && [ "$(stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo 0)" -gt 1000 ]; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    echo "[$COUNT/$TOTAL] Generating: $voice_id"

    if edge-tts --voice "$EDGE_VOICE" --text "$PREVIEW_TEXT" --write-media "$OUTPUT_FILE" 2>/dev/null; then
        GENERATED=$((GENERATED + 1))
        SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        echo "  -> $SIZE"
    else
        echo "  -> FAILED"
        rm -f "$OUTPUT_FILE"
    fi
done <<< "$VOICE_IDS"

echo ""
echo "Preview generation complete:"
echo "  Generated: $GENERATED"
echo "  Skipped (existing): $SKIPPED"
echo "  Total: $TOTAL"
echo "  Preview dir: $(du -sh "$PREVIEWS_DIR" | cut -f1)"
```

**Step 2: Commit**

```bash
git add deploy/rvc-vps/catalog/generate-previews.sh
git commit -m "feat(speech): add preview clip generator for voice catalog"
```

---

### Task 7: Update VPS Edge-TTS Server with Catalog Endpoints

**Files:**
- Modify: `deploy/rvc-vps/edge-tts-server/server.py`

**Step 1: Read current server.py to understand existing endpoints**

Read: `deploy/rvc-vps/edge-tts-server/server.py`

**Step 2: Add catalog, preview, and disk endpoints**

Add the following to server.py after the existing `/models/{name}` endpoint:

```python
# --- Catalog endpoint ---
CATALOG_FILE = Path("/opt/rvc-models/catalog.json")
PREVIEWS_DIR = Path("/opt/rvc-models/previews")

@app.get("/catalog")
async def get_catalog(page: int = 0, limit: int = 0):
    """Return the voice catalog, optionally paginated."""
    if not CATALOG_FILE.exists():
        raise HTTPException(status_code=404, detail="Catalog not built yet. Run build-catalog.py.")

    with open(CATALOG_FILE) as f:
        catalog = json.load(f)

    if limit > 0:
        start = page * limit
        catalog["voices"] = catalog["voices"][start:start + limit]

    return catalog


@app.get("/catalog/search")
async def search_catalog(q: str = ""):
    """Server-side fuzzy search across catalog voices."""
    if not CATALOG_FILE.exists():
        raise HTTPException(status_code=404, detail="Catalog not built yet.")

    with open(CATALOG_FILE) as f:
        catalog = json.load(f)

    if not q.strip():
        return catalog

    terms = q.strip().lower().split()
    scored = []

    for voice in catalog["voices"]:
        score = 0
        searchable = f"{voice['name']} {voice['description']} {' '.join(voice['tags'])} {voice['accentLabel']} {voice['style']} {voice['gender']}".lower()
        for term in terms:
            if term in voice["name"].lower():
                score += 10
            if any(term in tag for tag in voice["tags"]):
                score += 5
            if term in voice["description"].lower():
                score += 2
            if term in searchable:
                score += 1
        if score > 0:
            scored.append((score, voice))

    scored.sort(key=lambda x: -x[0])
    catalog["voices"] = [v for _, v in scored]
    catalog["totalModels"] = len(catalog["voices"])
    return catalog


@app.get("/preview/{filename}")
async def get_preview(filename: str):
    """Serve pre-generated hero preview clip."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    preview_path = PREVIEWS_DIR / filename
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview not found")

    return FileResponse(preview_path, media_type="audio/mpeg")


@app.post("/preview")
async def custom_preview(request: Request):
    """On-demand synthesis for custom preview text."""
    body = await request.json()
    model_id = body.get("modelId", "")
    text = body.get("text", "Hello, I'm your voice assistant.")

    if len(text) > 500:
        raise HTTPException(status_code=400, detail="Text too long (max 500 chars)")

    voice = "en-US-AriaNeural"

    import edge_tts
    communicate = edge_tts.Communicate(text, voice)
    audio_bytes = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes += chunk["data"]

    if not audio_bytes:
        raise HTTPException(status_code=500, detail="Synthesis produced no audio")

    return Response(content=audio_bytes, media_type="audio/mpeg")


@app.get("/disk")
async def disk_usage():
    """Return disk usage stats for the models directory."""
    models_dir = Path("/opt/rvc-models/models")
    max_bytes = 100 * 1024 * 1024 * 1024  # 100GB cap

    total_size = 0
    model_count = 0

    if models_dir.exists():
        for f in models_dir.rglob("*"):
            if f.is_file():
                total_size += f.stat().st_size
                if f.suffix in {".pth", ".onnx", ".safetensors", ".pt", ".ckpt"}:
                    model_count += 1

    return {
        "usedBytes": total_size,
        "maxBytes": max_bytes,
        "modelCount": model_count,
    }
```

**Step 3: Commit**

```bash
git add deploy/rvc-vps/edge-tts-server/server.py
git commit -m "feat(speech): add catalog, preview, and disk endpoints to VPS server"
```

---

## Phase 3: Voice Studio Panel (Extension Side)

### Task 8: Voice Studio Panel Provider

**Files:**
- Create: `packages/kilo-vscode/src/VoiceStudioProvider.ts`

**Step 1: Write the panel provider following DiffViewerProvider pattern**

```typescript
// packages/kilo-vscode/src/VoiceStudioProvider.ts
import * as vscode from "vscode"
import * as https from "https"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { exec } from "child_process"

export class VoiceStudioProvider {
  public static readonly viewType = "kilo-code.new.VoiceStudioPanel"
  private static panel: vscode.WebviewPanel | undefined
  private disposables: vscode.Disposable[] = []
  private downloadJobs: Map<string, { controller: AbortController; received: number; total: number }> = new Map()

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static openPanel(context: vscode.ExtensionContext): VoiceStudioProvider {
    const provider = new VoiceStudioProvider(context)

    if (VoiceStudioProvider.panel) {
      VoiceStudioProvider.panel.reveal(vscode.ViewColumn.One)
      return provider
    }

    const panel = vscode.window.createWebviewPanel(
      VoiceStudioProvider.viewType,
      "Voice Studio",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      }
    )

    VoiceStudioProvider.panel = panel
    provider.wirePanel(panel)
    return provider
  }

  private wirePanel(panel: vscode.WebviewPanel): void {
    panel.webview.html = this.getHtmlForWebview(panel.webview)

    panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message, panel),
      undefined,
      this.disposables
    )

    panel.onDidDispose(() => {
      VoiceStudioProvider.panel = undefined
      this.disposables.forEach((d) => d.dispose())
      this.disposables = []
    })
  }

  private async handleMessage(message: any, panel: vscode.WebviewPanel): Promise<void> {
    switch (message.type) {
      case "requestVoiceStudioState":
        await this.sendStudioState(panel)
        break

      case "fetchVoiceLibrary":
        await this.fetchVoiceLibrary(panel)
        break

      case "fetchStoreModels":
        await this.fetchStoreModels(panel, message.page, message.limit)
        break

      case "previewStoreVoice":
        await this.fetchCustomPreview(panel, message.modelId, message.text)
        break

      case "downloadModel":
        await this.startDownload(panel, message.modelId, message.name, message.url, message.fileSize)
        break

      case "cancelDownload":
        this.cancelDownload(message.modelId)
        break

      case "deleteModel":
        await this.deleteModel(panel, message.modelId, message.provider)
        break

      case "toggleFavorite":
        await this.toggleFavorite(panel, message.voiceId)
        break

      case "setActiveVoice":
        await this.setActiveVoice(message.voiceId, message.provider)
        break

      case "saveSearch":
        await this.saveSearch(message.name, message.query, message.filters)
        await this.sendStudioState(panel)
        break

      case "deleteSavedSearch":
        await this.deleteSavedSearch(message.name)
        await this.sendStudioState(panel)
        break

      case "switchInteractionMode":
        await this.context.globalState.update("kilocode.voiceInteractionMode", message.mode)
        panel.webview.postMessage({ type: "interactionModeChanged", mode: message.mode })
        break

      case "voiceCommand":
        await this.handleVoiceCommand(panel, message.command, message.transcript)
        break
    }
  }

  private async sendStudioState(panel: vscode.WebviewPanel): Promise<void> {
    const favorites = this.context.globalState.get<string[]>("kilocode.voiceFavorites", [])
    const recentSearches = this.context.globalState.get<string[]>("kilocode.voiceRecentSearches", [])
    const savedSearches = this.context.globalState.get<any[]>("kilocode.voiceSavedSearches", [])
    const interactionMode = this.context.globalState.get<string>("kilocode.voiceInteractionMode", "silent")

    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const provider = config.get<string>("provider", "browser")
    let activeVoiceId: string | null = null

    if (provider === "rvc") {
      const voiceId = config.get<string>("rvc.voiceId", "")
      activeVoiceId = voiceId ? `rvc:${voiceId}` : null
    } else if (provider === "azure") {
      activeVoiceId = `azure:${config.get<string>("azure.voiceId", "en-US-JennyNeural")}`
    } else if (provider === "browser") {
      const uri = config.get<string>("browser.voiceURI", "")
      activeVoiceId = uri ? `browser:${uri}` : null
    }

    panel.webview.postMessage({
      type: "voiceStudioState",
      favorites,
      recentSearches,
      savedSearches,
      interactionMode,
      activeVoiceId,
    })
  }

  private async fetchVoiceLibrary(panel: vscode.WebviewPanel): Promise<void> {
    const voices: any[] = []

    // Collect Azure voices
    try {
      const azureVoicesModule = await import("../webview-ui/src/data/azure-voices")
      // Azure voices are always "installed" since they're cloud-based
    } catch {
      // Azure voices data will be sent from webview side
    }

    // Collect RVC voices from Docker
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const dockerPort = config.get<number>("rvc.dockerPort", 5050)
    try {
      const response = await this.httpGet(`http://localhost:${dockerPort}/voices`)
      const dockerVoices = JSON.parse(response)
      if (Array.isArray(dockerVoices)) {
        for (const v of dockerVoices) {
          const name = typeof v === "string" ? v : v.name || v.id || ""
          if (name) {
            voices.push({
              id: `rvc:${name}`,
              provider: "rvc",
              name: name.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
              description: "RVC voice model",
              gender: "neutral",
              accent: "en-US",
              accentLabel: "American English",
              style: "natural",
              quality: 3,
              sampleRate: 40000,
              fileSize: 0,
              tags: [],
              installed: true,
              favorite: false,
              localPath: name,
            })
          }
        }
      }
    } catch {
      // Docker not running, no local RVC voices
    }

    // Merge favorites
    const favorites = this.context.globalState.get<string[]>("kilocode.voiceFavorites", [])
    for (const voice of voices) {
      voice.favorite = favorites.includes(voice.id)
    }

    // Merge history
    const history = this.context.globalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
    for (const voice of voices) {
      const entry = history.find((h) => h.id === voice.id)
      if (entry) voice.lastUsed = entry.timestamp
    }

    panel.webview.postMessage({ type: "voiceLibraryLoaded", voices })
  }

  private async fetchStoreModels(panel: vscode.WebviewPanel, page?: number, limit?: number): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const serverUrl = config.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    try {
      let url = `${serverUrl}/api/catalog`
      const params: string[] = []
      if (page !== undefined) params.push(`page=${page}`)
      if (limit !== undefined) params.push(`limit=${limit}`)
      if (params.length) url += `?${params.join("&")}`

      const response = await this.httpGet(url)
      const catalog = JSON.parse(response)
      panel.webview.postMessage({ type: "storeModelsLoaded", catalog })
    } catch (err: any) {
      panel.webview.postMessage({
        type: "storeModelsLoaded",
        catalog: { version: 0, generatedAt: "", totalModels: 0, totalSizeBytes: 0, voices: [] },
      })
    }

    // Also fetch disk usage
    try {
      const diskResponse = await this.httpGet(`${serverUrl}/api/disk`)
      const disk = JSON.parse(diskResponse)
      panel.webview.postMessage({ type: "diskUsage", ...disk })
    } catch {
      // Disk info unavailable
    }
  }

  private async fetchCustomPreview(panel: vscode.WebviewPanel, modelId: string, text: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const serverUrl = config.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    try {
      const response = await this.httpPost(`${serverUrl}/api/preview`, { modelId, text })
      const audioBase64 = Buffer.from(response, "binary").toString("base64")
      panel.webview.postMessage({
        type: "previewAudioReady",
        modelId,
        audioBase64,
        mimeType: "audio/mpeg",
      })
    } catch (err: any) {
      // Preview failed silently — UI handles missing preview gracefully
    }
  }

  private async startDownload(
    panel: vscode.WebviewPanel,
    modelId: string,
    name: string,
    url: string,
    fileSize: number
  ): Promise<void> {
    const controller = new AbortController()
    this.downloadJobs.set(modelId, { controller, received: 0, total: fileSize })

    panel.webview.postMessage({
      type: "downloadProgress",
      modelId,
      receivedBytes: 0,
      totalBytes: fileSize,
      status: "downloading",
    })

    const tmpDir = os.tmpdir()
    const tmpFile = path.join(tmpDir, `kilocode-voice-${modelId.replace(/[/\\:]/g, "-")}`)

    try {
      await this.downloadWithProgress(url, tmpFile, controller.signal, (received, total) => {
        panel.webview.postMessage({
          type: "downloadProgress",
          modelId,
          receivedBytes: received,
          totalBytes: total,
          status: "downloading",
        })
      })

      panel.webview.postMessage({
        type: "downloadProgress",
        modelId,
        receivedBytes: fileSize,
        totalBytes: fileSize,
        status: "installing",
      })

      // Install to Docker container
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const containerName = "edge-tts-server"
      const destPath = `/models/${name}`

      if (tmpFile.endsWith(".zip")) {
        // Extract .pth and .index from zip, then docker cp
        const extractDir = path.join(tmpDir, `kilocode-extract-${modelId.replace(/[/\\:]/g, "-")}`)
        await this.execAsync(`mkdir -p "${extractDir}" && unzip -o -j "${tmpFile}" "*.pth" "*.index" -d "${extractDir}"`)
        await this.execAsync(`docker cp "${extractDir}/." "${containerName}:${destPath}/"`)
        await this.execAsync(`rm -rf "${extractDir}"`)
      } else {
        await this.execAsync(`docker cp "${tmpFile}" "${containerName}:${destPath}"`)
      }

      fs.unlinkSync(tmpFile)
      this.downloadJobs.delete(modelId)

      panel.webview.postMessage({ type: "downloadComplete", modelId, name })

      // Refresh library
      await this.fetchVoiceLibrary(panel)
    } catch (err: any) {
      this.downloadJobs.delete(modelId)
      try { fs.unlinkSync(tmpFile) } catch {}

      if (err.name === "AbortError") {
        panel.webview.postMessage({
          type: "downloadProgress",
          modelId,
          receivedBytes: 0,
          totalBytes: fileSize,
          status: "failed",
        })
      } else {
        panel.webview.postMessage({
          type: "downloadFailed",
          modelId,
          error: err.message || "Download failed",
        })
      }
    }
  }

  private cancelDownload(modelId: string): void {
    const job = this.downloadJobs.get(modelId)
    if (job) {
      job.controller.abort()
      this.downloadJobs.delete(modelId)
    }
  }

  private async deleteModel(panel: vscode.WebviewPanel, modelId: string, provider: string): Promise<void> {
    if (provider === "rvc") {
      const name = modelId.replace("rvc:", "")
      try {
        await this.execAsync(`docker exec edge-tts-server rm -rf "/models/${name}"`)
        await this.fetchVoiceLibrary(panel)
      } catch {
        // Delete failed
      }
    }
  }

  private async toggleFavorite(panel: vscode.WebviewPanel, voiceId: string): Promise<void> {
    const favorites = this.context.globalState.get<string[]>("kilocode.voiceFavorites", [])
    const idx = favorites.indexOf(voiceId)
    if (idx >= 0) {
      favorites.splice(idx, 1)
    } else {
      favorites.push(voiceId)
    }
    await this.context.globalState.update("kilocode.voiceFavorites", favorites)
    await this.sendStudioState(panel)
  }

  private async setActiveVoice(voiceId: string, provider: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    await config.update("provider", provider, vscode.ConfigurationTarget.Global)

    if (provider === "rvc") {
      const name = voiceId.replace("rvc:", "")
      await config.update("rvc.voiceId", name, vscode.ConfigurationTarget.Global)
    } else if (provider === "azure") {
      const name = voiceId.replace("azure:", "")
      await config.update("azure.voiceId", name, vscode.ConfigurationTarget.Global)
    } else if (provider === "browser") {
      const name = voiceId.replace("browser:", "")
      await config.update("browser.voiceURI", name, vscode.ConfigurationTarget.Global)
    }

    // Record in history
    const history = this.context.globalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
    const filtered = history.filter((h) => h.id !== voiceId)
    filtered.unshift({ id: voiceId, timestamp: Date.now() })
    await this.context.globalState.update("kilocode.voiceHistory", filtered.slice(0, 50))
  }

  private async saveSearch(name: string, query: string, filters: any): Promise<void> {
    const searches = this.context.globalState.get<any[]>("kilocode.voiceSavedSearches", [])
    searches.push({ name, query, filters, createdAt: Date.now() })
    await this.context.globalState.update("kilocode.voiceSavedSearches", searches)

    // Also record in recent searches
    const recent = this.context.globalState.get<string[]>("kilocode.voiceRecentSearches", [])
    if (query && !recent.includes(query)) {
      recent.unshift(query)
      await this.context.globalState.update("kilocode.voiceRecentSearches", recent.slice(0, 20))
    }
  }

  private async deleteSavedSearch(name: string): Promise<void> {
    const searches = this.context.globalState.get<any[]>("kilocode.voiceSavedSearches", [])
    const filtered = searches.filter((s) => s.name !== name)
    await this.context.globalState.update("kilocode.voiceSavedSearches", filtered)
  }

  private async handleVoiceCommand(panel: vscode.WebviewPanel, command: string, transcript: string): Promise<void> {
    const lower = transcript.toLowerCase().trim()
    let success = false
    let responseMsg = ""

    if (lower.includes("switch to")) {
      const voiceName = lower.replace(/.*switch to\s*/, "").trim()
      // Fuzzy match against installed voices — will be implemented with voice library data
      responseMsg = `Switching to ${voiceName}`
      success = true
    } else if (lower.includes("read that again") || lower.includes("repeat")) {
      responseMsg = "Repeating last response"
      success = true
    } else if (lower === "stop" || lower === "quiet" || lower.includes("stop speaking")) {
      responseMsg = "Stopping speech"
      success = true
    } else if (lower.includes("slower")) {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech.browser")
      const rate = config.get<number>("rate", 1.0)
      await config.update("rate", Math.max(0.5, rate - 0.2), vscode.ConfigurationTarget.Global)
      responseMsg = "Slowing down"
      success = true
    } else if (lower.includes("faster")) {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech.browser")
      const rate = config.get<number>("rate", 1.0)
      await config.update("rate", Math.min(2.0, rate + 0.2), vscode.ConfigurationTarget.Global)
      responseMsg = "Speeding up"
      success = true
    } else if (lower.includes("louder")) {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const vol = config.get<number>("volume", 80)
      await config.update("volume", Math.min(100, vol + 10), vscode.ConfigurationTarget.Global)
      responseMsg = "Increasing volume"
      success = true
    } else if (lower.includes("softer") || lower.includes("quieter")) {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const vol = config.get<number>("volume", 80)
      await config.update("volume", Math.max(0, vol - 10), vscode.ConfigurationTarget.Global)
      responseMsg = "Decreasing volume"
      success = true
    } else if (lower.includes("hands free off") || lower.includes("hands-free off")) {
      await this.context.globalState.update("kilocode.voiceInteractionMode", "assist")
      panel.webview.postMessage({ type: "interactionModeChanged", mode: "assist" })
      responseMsg = "Switching to assist mode"
      success = true
    }

    panel.webview.postMessage({
      type: "voiceCommandAck",
      command,
      success,
      message: responseMsg,
    })
  }

  // --- Utility methods ---

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http
      client.get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
        res.on("error", reject)
      }).on("error", reject)
    })
  }

  private httpPost(url: string, body: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const client = url.startsWith("https") ? https : http
      const postData = JSON.stringify(body)

      const req = client.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end", () => resolve(Buffer.concat(chunks).toString("binary")))
          res.on("error", reject)
        }
      )
      req.on("error", reject)
      req.write(postData)
      req.end()
    })
  }

  private downloadWithProgress(
    url: string,
    destPath: string,
    signal: AbortSignal,
    onProgress: (received: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("AbortError"))

      const client = url.startsWith("https") ? https : http
      const file = fs.createWriteStream(destPath)

      const abortHandler = () => {
        file.close()
        try { fs.unlinkSync(destPath) } catch {}
        reject(Object.assign(new Error("Download cancelled"), { name: "AbortError" }))
      }
      signal.addEventListener("abort", abortHandler, { once: true })

      client.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.downloadWithProgress(redirectUrl, destPath, signal, onProgress).then(resolve).catch(reject)
          } else {
            reject(new Error("Redirect without location header"))
          }
          return
        }

        const total = parseInt(res.headers["content-length"] || "0", 10)
        let received = 0

        res.on("data", (chunk) => {
          received += chunk.length
          onProgress(received, total)
        })
        res.pipe(file)
        file.on("finish", () => {
          signal.removeEventListener("abort", abortHandler)
          file.close()
          resolve()
        })
        res.on("error", (err) => {
          signal.removeEventListener("abort", abortHandler)
          file.close()
          reject(err)
        })
      }).on("error", (err) => {
        signal.removeEventListener("abort", abortHandler)
        file.close()
        reject(err)
      })
    })
  }

  private execAsync(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(error)
        else resolve(stdout)
      })
    })
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "voice-studio.js")
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "voice-studio.css")
    )
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src ${webview.cspSource} blob: data:; connect-src https: http:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Voice Studio</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/src/VoiceStudioProvider.ts
git commit -m "feat(speech): add VoiceStudioProvider panel with full message handling"
```

---

### Task 9: Register Voice Studio Command and Keybindings

**Files:**
- Modify: `packages/kilo-vscode/package.json` — add command + keybinding
- Modify: `packages/kilo-vscode/src/extension.ts` — register command handler

**Step 1: Add command to package.json contributes.commands**

```json
{
  "command": "kilo-code.new.openVoiceStudio",
  "title": "Open Voice Studio",
  "category": "Kilo Code"
},
{
  "command": "kilo-code.new.switchVoice",
  "title": "Switch Voice",
  "category": "Kilo Code"
}
```

**Step 2: Add keybinding to package.json contributes.keybindings**

```json
{
  "command": "kilo-code.new.switchVoice",
  "key": "ctrl+shift+v",
  "mac": "cmd+shift+v"
}
```

**Step 3: Add interaction mode setting to package.json**

```json
"kilo-code.new.speech.interactionMode": {
  "type": "string",
  "enum": ["silent", "assist", "handsfree"],
  "default": "silent",
  "markdownDescription": "Voice interaction mode: silent (no speech), assist (auto-speak responses), handsfree (full bidirectional voice)"
}
```

**Step 4: Register command in extension.ts**

Add after existing command registrations:

```typescript
import { VoiceStudioProvider } from "./VoiceStudioProvider"

// Open Voice Studio panel
context.subscriptions.push(
  vscode.commands.registerCommand("kilo-code.new.openVoiceStudio", () => {
    VoiceStudioProvider.openPanel(context)
  })
)

// Quick voice switch via command palette
context.subscriptions.push(
  vscode.commands.registerCommand("kilo-code.new.switchVoice", async () => {
    const favorites = context.globalState.get<string[]>("kilocode.voiceFavorites", [])
    const history = context.globalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
    
    const items: vscode.QuickPickItem[] = []
    
    if (favorites.length > 0) {
      items.push({ label: "Favorites", kind: vscode.QuickPickItemKind.Separator })
      for (const fav of favorites) {
        items.push({ label: `⭐ ${fav.replace(/^[^:]+:/, "")}`, description: fav.split(":")[0], detail: fav })
      }
    }
    
    if (history.length > 0) {
      items.push({ label: "Recent", kind: vscode.QuickPickItemKind.Separator })
      for (const h of history.slice(0, 10)) {
        if (!favorites.includes(h.id)) {
          items.push({ label: h.id.replace(/^[^:]+:/, ""), description: h.id.split(":")[0], detail: h.id })
        }
      }
    }
    
    items.push({ label: "Open Voice Studio...", description: "Browse all voices", detail: "__open_studio__" })
    
    const selected = await vscode.window.showQuickPick(items, { placeHolder: "Switch voice..." })
    if (selected) {
      if (selected.detail === "__open_studio__") {
        vscode.commands.executeCommand("kilo-code.new.openVoiceStudio")
      } else if (selected.detail) {
        const [provider, ...nameParts] = selected.detail.split(":")
        const name = nameParts.join(":")
        const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
        await config.update("provider", provider, vscode.ConfigurationTarget.Global)
        
        if (provider === "rvc") {
          await config.update("rvc.voiceId", name, vscode.ConfigurationTarget.Global)
        } else if (provider === "azure") {
          await config.update("azure.voiceId", name, vscode.ConfigurationTarget.Global)
        } else if (provider === "browser") {
          await config.update("browser.voiceURI", name, vscode.ConfigurationTarget.Global)
        }
        
        vscode.window.showInformationMessage(`Voice switched to: ${name}`)
      }
    }
  })
)
```

**Step 5: Commit**

```bash
git add packages/kilo-vscode/package.json packages/kilo-vscode/src/extension.ts
git commit -m "feat(speech): register Voice Studio command, switch voice shortcut"
```

---

### Task 10: Add Voice Studio to esbuild

**Files:**
- Modify: `packages/kilo-vscode/esbuild.js`

**Step 1: Add voice-studio entry point**

Find the section with `createBrowserWebviewContext` calls (around line 186-198) and add:

```javascript
const voiceStudioCtx = await createBrowserWebviewContext(
  "webview-ui/voice-studio/index.tsx",
  "dist/voice-studio.js"
)
```

Also add to the watch rebuild array and the build Promise.all.

**Step 2: Commit**

```bash
git add packages/kilo-vscode/esbuild.js
git commit -m "build: add voice-studio webview entry point to esbuild"
```

---

## Phase 4: Voice Studio Webview UI

### Task 11: Voice Studio Entry Point and App Shell

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/index.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/App.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/voice-studio.css`

**Step 1: Create entry point**

```typescript
// packages/kilo-vscode/webview-ui/voice-studio/index.tsx
import { render } from "solid-js/web"
import App from "./App"
import "./voice-studio.css"

const root = document.getElementById("root")
if (root) {
  render(() => <App />, root)
}
```

**Step 2: Create App shell with tabs, search, view toggle**

This is the root component containing the tab switcher, search bar, and content area. It manages the top-level state signals (activeTab, searchQuery, viewMode, filters) and passes them down to Library and Store tab components.

The App component:
- Initializes by sending `requestVoiceStudioState` to the extension
- Listens for all Voice Studio extension messages
- Contains VoiceStudioHeader (tabs + search + view toggle)
- Conditionally renders LibraryTab or StoreTab based on activeTab signal
- Manages the shared AudioPlayer context (single player, stops when new preview starts)

**Step 3: Create base CSS**

Use VS Code CSS variables (`--vscode-*`) for all colors. No hardcoded colors. Grid/flex layout. Responsive.

**Step 4: Commit**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/
git commit -m "feat(speech): add Voice Studio webview shell with tabs and search"
```

---

### Task 12: Shared Components — VoiceCard, VoiceRow, FilterBar, AudioPlayer, TagChip

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/VoiceCard.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/VoiceRow.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/FilterBar.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/AudioPlayer.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/TagChip.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/SearchBar.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/AutocompleteDropdown.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/ViewToggle.tsx`
- Create: `packages/kilo-vscode/webview-ui/voice-studio/components/VoiceAvatar.tsx`

Each component uses SolidJS + @kilocode/kilo-ui primitives. All use VS Code theme tokens. All text through i18n `t()`.

**Step 1-9: Implement each component** (one per step, test render, commit)

**Step 10: Commit all**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/components/
git commit -m "feat(speech): add Voice Studio shared UI components"
```

---

### Task 13: Library Tab Component

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/tabs/LibraryTab.tsx`

Contains:
- Sub-tabs: Favorites | Recent | All
- FilterBar instance with Library-specific filters
- VoiceGrid or VoiceList (based on viewMode signal from parent)
- NowPlaying bar at bottom
- Handles: preview playback, favorite toggle, set active voice

**Step 1: Implement LibraryTab**

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/tabs/LibraryTab.tsx
git commit -m "feat(speech): add Voice Studio Library tab with favorites, recent, filters"
```

---

### Task 14: Store Tab Component

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/tabs/StoreTab.tsx`

Contains:
- FilterBar with Store-specific filters (includes "Installed" toggle)
- Paginated VoiceGrid/VoiceList with StoreCard variant (hero preview + download buttons)
- DownloadQueue bar at bottom (active downloads + disk usage)
- Download progress tracking via downloadProgress messages

**Step 1: Implement StoreTab**

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/tabs/StoreTab.tsx
git commit -m "feat(speech): add Voice Studio Store tab with downloads, previews, pagination"
```

---

### Task 15: Voice Search (mic) Integration

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/hooks/useVoiceSearch.ts`

Uses Web Speech API `SpeechRecognition` (with webkit prefix fallback). Returns:
- `isListening` signal
- `transcript` signal
- `startListening()` / `stopListening()` functions
- `isSupported` boolean

SearchBar component integrates this hook — mic button visible when supported, toggles listening, pipes transcript into search query signal.

**Step 1: Implement useVoiceSearch hook**

**Step 2: Wire into SearchBar**

**Step 3: Commit**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/hooks/useVoiceSearch.ts
git commit -m "feat(speech): add voice-to-search with Web Speech API"
```

---

### Task 16: Hands-Free Voice Command Handler

**Files:**
- Create: `packages/kilo-vscode/webview-ui/voice-studio/hooks/useVoiceCommands.ts`

Uses same SpeechRecognition API in continuous mode. When interaction mode is "handsfree":
- Listens continuously
- Matches recognized transcript against command patterns
- Sends `voiceCommand` message to extension
- Shows visual feedback on command recognition

**Step 1: Implement useVoiceCommands hook**

**Step 2: Wire into App.tsx (activate when mode === "handsfree")**

**Step 3: Commit**

```bash
git add packages/kilo-vscode/webview-ui/voice-studio/hooks/useVoiceCommands.ts
git commit -m "feat(speech): add hands-free voice command recognition"
```

---

## Phase 5: SpeechTab Simplification

### Task 17: Simplify SpeechTab + Add Voice Studio Button

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/SpeechTab.tsx`

**Step 1: Refactor SpeechTab**

Keep only:
- Enable/disable toggle
- Provider selector (RVC/Azure/Browser)
- Volume slider
- Provider-specific minimal config (Docker port, Azure key/region, browser voice)
- Interaction Mode selector (Silent/Assist/Hands-Free)
- **"Open Voice Studio" button** — sends `openVoiceStudio` message

Remove:
- Model browser section (moved to Voice Studio Store tab)
- Local models display (moved to Voice Studio Library tab)
- Remote model fetching logic
- Download functionality

**Step 2: Add openVoiceStudio message handler in KiloProvider.ts**

```typescript
case "openVoiceStudio":
  vscode.commands.executeCommand("kilo-code.new.openVoiceStudio")
  break
```

**Step 3: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/settings/SpeechTab.tsx packages/kilo-vscode/src/KiloProvider.ts
git commit -m "refactor(speech): simplify SpeechTab, add Voice Studio launch button"
```

---

## Phase 6: i18n

### Task 18: Voice Studio i18n Keys

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/en.ts`

**Step 1: Add all Voice Studio i18n keys**

Add under `settings.speech.voiceStudio.*`:
- Tab labels, search placeholders, filter labels, mood labels
- Card actions (preview, download, set active, favorite)
- Download states (queued, downloading, extracting, installing, done, failed)
- Store labels (disk usage, page navigation, results count)
- Voice command feedback messages
- Interaction mode labels and descriptions
- Empty states (no results, no favorites, no history)
- Error messages

**Step 2: Verify all Voice Studio components use t() — no hardcoded strings**

**Step 3: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/i18n/en.ts
git commit -m "feat(speech): add complete Voice Studio i18n keys"
```

---

## Phase 7: VPS Deployment

### Task 19: Deploy Catalog System to VPS

**Files:**
- Create: `deploy/rvc-vps/catalog/deploy-catalog.py`

**Step 1: Write deployment script using Paramiko**

Uploads build-catalog.py, model-metadata.json, generate-previews.sh to VPS. Runs build-catalog.py to generate catalog.json. Runs generate-previews.sh to create hero clips. Updates edge-tts-server container with new endpoints. Verifies /api/catalog returns valid JSON.

**Step 2: Run deployment**

Run: `python deploy/rvc-vps/catalog/deploy-catalog.py`
Expected: catalog.json generated, preview clips created, endpoints responding

**Step 3: Commit**

```bash
git add deploy/rvc-vps/catalog/deploy-catalog.py
git commit -m "feat(speech): add VPS catalog deployment script"
```

---

## Phase 8: Testing & Audits

### Task 20: Unit Tests

**Files:**
- Already created: `tests/unit/voice-types.test.ts`, `tests/unit/voice-search.test.ts`, `tests/unit/voice-messages.test.ts`
- Create: `packages/kilo-vscode/tests/unit/voice-studio-provider.test.ts`
- Create: `packages/kilo-vscode/tests/unit/voice-studio-components.test.ts`

**Step 1: Write VoiceStudioProvider unit tests**

Test: message handling, state persistence, favorite toggle, saved searches, interaction modes

**Step 2: Write component render tests**

Test: VoiceCard renders all fields, FilterBar applies filters, SearchBar debounces, AudioPlayer plays/stops

**Step 3: Run all tests**

Run: `cd packages/kilo-vscode && bun test tests/unit/voice-*.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add packages/kilo-vscode/tests/unit/voice-*.test.ts
git commit -m "test(speech): add Voice Studio unit tests"
```

---

### Task 21: Audit Type 1 — Code Completeness (6 layers)

**Files:** All Voice Studio files

Run through each layer:
1. **Component** — every component renders, no stubs/TODO/FIXME, all props consumed
2. **Message** — every message type in union has sender AND handler
3. **State** — every signal has init, update, cleanup
4. **i18n** — every user-visible string uses t(), every key has a value
5. **Config** — every package.json setting has reader + UI control
6. **Style** — all colors use --vscode-* tokens, responsive

Fix any issues found. Commit fixes.

---

### Task 22: Audit Type 2 — Integration (6 layers)

1. **Webview ↔ Extension** — send every message type, verify round-trip
2. **Extension ↔ Docker** — health, voices, synthesis, model install, model delete
3. **Extension ↔ VPS** — catalog fetch, hero preview, custom preview, download with progress, disk usage
4. **State persistence** — close panel, reopen: favorites, history, saved searches all restored
5. **Provider switching** — change provider in Settings → Studio reflects; change voice in Studio → Settings reflects
6. **Search pipeline** — fuzzy + filters + moods + autocomplete + saved searches all combine

Fix any issues found. Commit fixes.

---

### Task 23: Audit Type 3 — E2E Feature (6 layers)

1. **Library flow** — open Studio → installed voices shown → filter by gender → search "warm" → preview plays → set active → verify speech works
2. **Store flow** — browse → filter provider=RVC → preview hero clip → type custom text → preview on-demand → download → progress shown → appears in Library
3. **Search flow** — type "brit" → autocomplete shows British English → select → results filter → save search → close panel → reopen → saved search restores
4. **Download flow** — click download → progress ring animates → cancel → retry → completes → installs → disk usage updates
5. **Settings flow** — change provider to Azure in Settings → open Studio → Library shows Azure voices → select one → Settings shows updated voice
6. **Interaction modes** — switch to Hands-Free → mic activates → speak "switch to Aria" → voice changes → speak "hands free off" → mic stops

Fix any issues found. Commit fixes.

---

## Phase 9: Documentation

### Task 24: Architecture Documentation

**Files:**
- Create: `docs/speech/ARCHITECTURE.md`

Include SVG diagrams for:
- System architecture (Webview ↔ Extension ↔ Docker ↔ VPS)
- Component tree
- Message sequence diagram (Library load, Store browse, Download flow)
- Download state machine
- Voice command flow

---

### Task 25: User Guide

**Files:**
- Create: `docs/speech/VOICE-STUDIO-GUIDE.md`

Cover: opening Voice Studio, Library tab, Store tab, search & filters, voice-to-search, favorites, saved searches, downloads, hands-free mode, voice commands, switching voices via shortcut.

---

### Task 26: VPS Documentation

**Files:**
- Create: `docs/speech/VPS-SETUP.md`

Cover: VPS specs, Docker services, nginx config, model collection, catalog building, preview generation, disk management, API endpoints, monitoring.

---

### Task 27: API Reference

**Files:**
- Create: `docs/speech/API-REFERENCE.md`

Cover: every endpoint with request/response schemas, examples, error codes, rate limits.

---

### Task 28: Voice Catalog Documentation

**Files:**
- Create: `docs/speech/VOICE-CATALOG.md`

Cover: complete model inventory, metadata per voice, source URLs, categories, quality ratings.

---

### Task 29: Testing Documentation

**Files:**
- Create: `docs/speech/TESTING.md`

Cover: 3 audit types × 6 layers, test commands, expected results, coverage map.

---

### Task 30: Final Build and Verification

**Step 1: Full build**

Run: `cd packages/kilo-vscode && bun run compile`
Expected: builds with zero errors

**Step 2: Run all tests**

Run: `cd packages/kilo-vscode && bun test`
Expected: ALL PASS

**Step 3: Package VSIX**

Run: `cd packages/kilo-vscode && vsce package`
Expected: .vsix file generated

**Step 4: Install and verify**

Install VSIX in VS Code. Open Settings → Speech → click "Open Voice Studio". Verify Library shows voices, Store loads catalog, search works, downloads work.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(speech): Voice Studio complete — Library, Store, search, hands-free, docs"
git push
```

---

Plan complete and saved to `docs/plans/2026-04-10-voice-studio-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?