# Speech System (TTS + RVC + Azure) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete text-to-speech system to KiloCode that speaks assistant replies using RVC (local Docker), Azure Neural TTS, or the browser's built-in voices — switchable via a new Speech settings tab.

**Architecture:** Frontend-only engine living in `packages/app/src/`. A SpeechEngine singleton dispatches to the active provider. A reactive `createEffect` in the session view watches `session_status` and auto-speaks completed assistant replies. Settings persisted in `settings.v3` exactly like the existing sounds system.

**Tech Stack:** SolidJS, TypeScript, Web Audio API, Docker (for RVC), Azure Cognitive Services REST API, Web Speech API (browser fallback). No new backend packages required.

---

## Branch Setup

```bash
git checkout -b feature/speech-system
```

---

## Task 1: Settings Types + Defaults

**Files:**
- Modify: `packages/app/src/context/settings.tsx`

This is the foundation. Everything else reads from these types.

**Step 1: Add the SpeechSettings interface and extend Settings**

In `packages/app/src/context/settings.tsx`, after the `SoundSettings` interface (line 18), add:

```typescript
export type SpeechProvider = "rvc" | "azure" | "browser"

export interface SpeechSettings {
  enabled: boolean
  autoSpeak: boolean
  provider: SpeechProvider
  volume: number
  rvc: {
    voiceId: string
    dockerPort: number
  }
  azure: {
    region: string
    apiKey: string
    voiceId: string
  }
  browser: {
    voiceURI: string
    rate: number
    pitch: number
  }
}
```

**Step 2: Add `speech` to the `Settings` interface**

Extend the `Settings` interface (after the `sounds` field, line 41):

```typescript
speech: SpeechSettings
```

**Step 3: Add defaults to `defaultSettings`**

After the `sounds` block in `defaultSettings`:

```typescript
speech: {
  enabled: false,
  autoSpeak: false,
  provider: "rvc",
  volume: 80,
  rvc: {
    voiceId: "",
    dockerPort: 7860,
  },
  azure: {
    region: "",
    apiKey: "",
    voiceId: "en-US-AvaNeural",
  },
  browser: {
    voiceURI: "",
    rate: 1.0,
    pitch: 1.0,
  },
},
```

**Step 4: Add getters/setters to the context init function**

After the `sounds` section in the `init` return (after line 232):

```typescript
speech: {
  enabled: withFallback(() => store.speech?.enabled, defaultSettings.speech.enabled),
  setEnabled(value: boolean) { setStore("speech", "enabled", value) },
  autoSpeak: withFallback(() => store.speech?.autoSpeak, defaultSettings.speech.autoSpeak),
  setAutoSpeak(value: boolean) { setStore("speech", "autoSpeak", value) },
  provider: withFallback(() => store.speech?.provider, defaultSettings.speech.provider),
  setProvider(value: SpeechProvider) { setStore("speech", "provider", value) },
  volume: withFallback(() => store.speech?.volume, defaultSettings.speech.volume),
  setVolume(value: number) { setStore("speech", "volume", value) },
  rvc: {
    voiceId: withFallback(() => store.speech?.rvc?.voiceId, defaultSettings.speech.rvc.voiceId),
    setVoiceId(value: string) { setStore("speech", "rvc", "voiceId", value) },
    dockerPort: withFallback(() => store.speech?.rvc?.dockerPort, defaultSettings.speech.rvc.dockerPort),
    setDockerPort(value: number) { setStore("speech", "rvc", "dockerPort", value) },
  },
  azure: {
    region: withFallback(() => store.speech?.azure?.region, defaultSettings.speech.azure.region),
    setRegion(value: string) { setStore("speech", "azure", "region", value) },
    apiKey: withFallback(() => store.speech?.azure?.apiKey, defaultSettings.speech.azure.apiKey),
    setApiKey(value: string) { setStore("speech", "azure", "apiKey", value) },
    voiceId: withFallback(() => store.speech?.azure?.voiceId, defaultSettings.speech.azure.voiceId),
    setVoiceId(value: string) { setStore("speech", "azure", "voiceId", value) },
  },
  browser: {
    voiceURI: withFallback(() => store.speech?.browser?.voiceURI, defaultSettings.speech.browser.voiceURI),
    setVoiceURI(value: string) { setStore("speech", "browser", "voiceURI", value) },
    rate: withFallback(() => store.speech?.browser?.rate, defaultSettings.speech.browser.rate),
    setRate(value: number) { setStore("speech", "browser", "rate", value) },
    pitch: withFallback(() => store.speech?.browser?.pitch, defaultSettings.speech.browser.pitch),
    setPitch(value: number) { setStore("speech", "browser", "pitch", value) },
  },
},
```

**Step 5: Commit**

```bash
git add packages/app/src/context/settings.tsx
git commit -m "feat(speech): add SpeechSettings types and defaults to settings context"
```

---

## Task 2: TTS Playback Utility

**Files:**
- Create: `packages/app/src/utils/tts.ts`

Mirrors the pattern of `utils/sound.ts` exactly. Plays an audio Blob via Web Audio API with volume control.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/tts.ts

let currentAudio: HTMLAudioElement | undefined

export function playTTS(blob: Blob, volume: number): () => void {
  if (typeof Audio === "undefined") return () => undefined
  stopTTS()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.volume = Math.max(0, Math.min(1, volume / 100))
  currentAudio = audio
  audio.play().catch(() => undefined)
  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(url)
    currentAudio = undefined
  })
  return () => {
    audio.pause()
    audio.currentTime = 0
    URL.revokeObjectURL(url)
    currentAudio = undefined
  }
}

export function stopTTS() {
  if (!currentAudio) return
  currentAudio.pause()
  currentAudio.currentTime = 0
  currentAudio = undefined
}

export function isTTSPlaying(): boolean {
  return currentAudio !== undefined && !currentAudio.paused
}
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/tts.ts
git commit -m "feat(speech): add TTS playback utility"
```

---

## Task 3: Azure English Voices Data

**Files:**
- Create: `packages/app/src/data/azure-voices.ts`

Full list of Azure Neural English voices. No API call needed — these are the static voice IDs published in Azure docs.

**Step 1: Create the directory and file**

```typescript
// packages/app/src/data/azure-voices.ts

export interface AzureVoice {
  id: string        // ShortName used in SSML, e.g. "en-US-AvaNeural"
  locale: string    // e.g. "en-US"
  name: string      // Display name, e.g. "Ava"
  gender: "Female" | "Male"
  style?: string    // Optional: "cheerful", "sad", etc.
}

export const AZURE_VOICES: AzureVoice[] = [
  // en-US
  { id: "en-US-AvaNeural",         locale: "en-US", name: "Ava (US)",          gender: "Female" },
  { id: "en-US-AndrewNeural",      locale: "en-US", name: "Andrew (US)",       gender: "Male" },
  { id: "en-US-EmmaNeural",        locale: "en-US", name: "Emma (US)",         gender: "Female" },
  { id: "en-US-BrianNeural",       locale: "en-US", name: "Brian (US)",        gender: "Male" },
  { id: "en-US-JennyNeural",       locale: "en-US", name: "Jenny (US)",        gender: "Female" },
  { id: "en-US-GuyNeural",         locale: "en-US", name: "Guy (US)",          gender: "Male" },
  { id: "en-US-AriaNeural",        locale: "en-US", name: "Aria (US)",         gender: "Female" },
  { id: "en-US-DavisNeural",       locale: "en-US", name: "Davis (US)",        gender: "Male" },
  { id: "en-US-AmberNeural",       locale: "en-US", name: "Amber (US)",        gender: "Female" },
  { id: "en-US-AnaNeural",         locale: "en-US", name: "Ana (US)",          gender: "Female" },
  { id: "en-US-AshleyNeural",      locale: "en-US", name: "Ashley (US)",       gender: "Female" },
  { id: "en-US-BrandonNeural",     locale: "en-US", name: "Brandon (US)",      gender: "Male" },
  { id: "en-US-ChristopherNeural", locale: "en-US", name: "Christopher (US)",  gender: "Male" },
  { id: "en-US-CoraNeural",        locale: "en-US", name: "Cora (US)",         gender: "Female" },
  { id: "en-US-ElizabethNeural",   locale: "en-US", name: "Elizabeth (US)",    gender: "Female" },
  { id: "en-US-EricNeural",        locale: "en-US", name: "Eric (US)",         gender: "Male" },
  { id: "en-US-JacobNeural",       locale: "en-US", name: "Jacob (US)",        gender: "Male" },
  { id: "en-US-JaneNeural",        locale: "en-US", name: "Jane (US)",         gender: "Female" },
  { id: "en-US-JasonNeural",       locale: "en-US", name: "Jason (US)",        gender: "Male" },
  { id: "en-US-MichelleNeural",    locale: "en-US", name: "Michelle (US)",     gender: "Female" },
  { id: "en-US-MonicaNeural",      locale: "en-US", name: "Monica (US)",       gender: "Female" },
  { id: "en-US-NancyNeural",       locale: "en-US", name: "Nancy (US)",        gender: "Female" },
  { id: "en-US-RogerNeural",       locale: "en-US", name: "Roger (US)",        gender: "Male" },
  { id: "en-US-RyanNeural",        locale: "en-US", name: "Ryan (US)",         gender: "Male" },
  { id: "en-US-SaraNeural",        locale: "en-US", name: "Sara (US)",         gender: "Female" },
  { id: "en-US-SteffanNeural",     locale: "en-US", name: "Steffan (US)",      gender: "Male" },
  { id: "en-US-TonyNeural",        locale: "en-US", name: "Tony (US)",         gender: "Male" },
  // en-GB
  { id: "en-GB-SoniaNeural",       locale: "en-GB", name: "Sonia (UK)",        gender: "Female" },
  { id: "en-GB-RyanNeural",        locale: "en-GB", name: "Ryan (UK)",         gender: "Male" },
  { id: "en-GB-LibbyNeural",       locale: "en-GB", name: "Libby (UK)",        gender: "Female" },
  { id: "en-GB-AbbiNeural",        locale: "en-GB", name: "Abbi (UK)",         gender: "Female" },
  { id: "en-GB-AlfieNeural",       locale: "en-GB", name: "Alfie (UK)",        gender: "Male" },
  { id: "en-GB-BellaNeural",       locale: "en-GB", name: "Bella (UK)",        gender: "Female" },
  { id: "en-GB-ElliotNeural",      locale: "en-GB", name: "Elliot (UK)",       gender: "Male" },
  { id: "en-GB-EthanNeural",       locale: "en-GB", name: "Ethan (UK)",        gender: "Male" },
  { id: "en-GB-HollieNeural",      locale: "en-GB", name: "Hollie (UK)",       gender: "Female" },
  { id: "en-GB-MaisieNeural",      locale: "en-GB", name: "Maisie (UK)",       gender: "Female" },
  { id: "en-GB-NoahNeural",        locale: "en-GB", name: "Noah (UK)",         gender: "Male" },
  { id: "en-GB-OliverNeural",      locale: "en-GB", name: "Oliver (UK)",       gender: "Male" },
  { id: "en-GB-OliviaNeural",      locale: "en-GB", name: "Olivia (UK)",       gender: "Female" },
  { id: "en-GB-ThomasNeural",      locale: "en-GB", name: "Thomas (UK)",       gender: "Male" },
  // en-AU
  { id: "en-AU-NatashaNeural",     locale: "en-AU", name: "Natasha (AU)",      gender: "Female" },
  { id: "en-AU-WilliamNeural",     locale: "en-AU", name: "William (AU)",      gender: "Male" },
  { id: "en-AU-AnnetteNeural",     locale: "en-AU", name: "Annette (AU)",      gender: "Female" },
  { id: "en-AU-CarlyNeural",       locale: "en-AU", name: "Carly (AU)",        gender: "Female" },
  { id: "en-AU-DarrenNeural",      locale: "en-AU", name: "Darren (AU)",       gender: "Male" },
  { id: "en-AU-DuncanNeural",      locale: "en-AU", name: "Duncan (AU)",       gender: "Male" },
  { id: "en-AU-ElsieNeural",       locale: "en-AU", name: "Elsie (AU)",        gender: "Female" },
  { id: "en-AU-FreyaNeural",       locale: "en-AU", name: "Freya (AU)",        gender: "Female" },
  { id: "en-AU-JoanneNeural",      locale: "en-AU", name: "Joanne (AU)",       gender: "Female" },
  { id: "en-AU-KenNeural",         locale: "en-AU", name: "Ken (AU)",          gender: "Male" },
  { id: "en-AU-KimNeural",         locale: "en-AU", name: "Kim (AU)",          gender: "Female" },
  { id: "en-AU-NeilNeural",        locale: "en-AU", name: "Neil (AU)",         gender: "Male" },
  { id: "en-AU-TimNeural",         locale: "en-AU", name: "Tim (AU)",          gender: "Male" },
  { id: "en-AU-TinaNeural",        locale: "en-AU", name: "Tina (AU)",         gender: "Female" },
  // en-CA
  { id: "en-CA-ClaraNeural",       locale: "en-CA", name: "Clara (CA)",        gender: "Female" },
  { id: "en-CA-LiamNeural",        locale: "en-CA", name: "Liam (CA)",         gender: "Male" },
  // en-IE
  { id: "en-IE-ConnorNeural",      locale: "en-IE", name: "Connor (IE)",       gender: "Male" },
  { id: "en-IE-EmilyNeural",       locale: "en-IE", name: "Emily (IE)",        gender: "Female" },
  // en-IN
  { id: "en-IN-NeerjaNeural",      locale: "en-IN", name: "Neerja (IN)",       gender: "Female" },
  { id: "en-IN-PrabhatNeural",     locale: "en-IN", name: "Prabhat (IN)",      gender: "Male" },
  { id: "en-IN-AaravNeural",       locale: "en-IN", name: "Aarav (IN)",        gender: "Male" },
  { id: "en-IN-AashiNeural",       locale: "en-IN", name: "Aashi (IN)",        gender: "Female" },
  { id: "en-IN-AnanyaNeural",      locale: "en-IN", name: "Ananya (IN)",       gender: "Female" },
  { id: "en-IN-KavyaNeural",       locale: "en-IN", name: "Kavya (IN)",        gender: "Female" },
  { id: "en-IN-KunalNeural",       locale: "en-IN", name: "Kunal (IN)",        gender: "Male" },
  { id: "en-IN-RehaanNeural",      locale: "en-IN", name: "Rehaan (IN)",       gender: "Male" },
  // en-NZ
  { id: "en-NZ-MitchellNeural",    locale: "en-NZ", name: "Mitchell (NZ)",     gender: "Male" },
  { id: "en-NZ-MollyNeural",       locale: "en-NZ", name: "Molly (NZ)",        gender: "Female" },
  // en-SG
  { id: "en-SG-LunaNeural",        locale: "en-SG", name: "Luna (SG)",         gender: "Female" },
  { id: "en-SG-WayneNeural",       locale: "en-SG", name: "Wayne (SG)",        gender: "Male" },
  // en-ZA
  { id: "en-ZA-LeahNeural",        locale: "en-ZA", name: "Leah (ZA)",         gender: "Female" },
  { id: "en-ZA-LukeNeural",        locale: "en-ZA", name: "Luke (ZA)",         gender: "Male" },
  // en-HK
  { id: "en-HK-SamNeural",         locale: "en-HK", name: "Sam (HK)",          gender: "Male" },
  { id: "en-HK-YanNeural",         locale: "en-HK", name: "Yan (HK)",          gender: "Female" },
  // en-KE
  { id: "en-KE-AsiliaNeural",      locale: "en-KE", name: "Asilia (KE)",       gender: "Female" },
  { id: "en-KE-ChilembaNeural",    locale: "en-KE", name: "Chilemba (KE)",     gender: "Male" },
  // en-NG
  { id: "en-NG-AbeoNeural",        locale: "en-NG", name: "Abeo (NG)",         gender: "Male" },
  { id: "en-NG-EzinneNeural",      locale: "en-NG", name: "Ezinne (NG)",       gender: "Female" },
  // en-PH
  { id: "en-PH-JamesNeural",       locale: "en-PH", name: "James (PH)",        gender: "Male" },
  { id: "en-PH-RosaNeural",        locale: "en-PH", name: "Rosa (PH)",         gender: "Female" },
  // en-TZ
  { id: "en-TZ-ElimuNeural",       locale: "en-TZ", name: "Elimu (TZ)",        gender: "Male" },
  { id: "en-TZ-ImaniNeural",       locale: "en-TZ", name: "Imani (TZ)",        gender: "Female" },
]

export const AZURE_LOCALES = [...new Set(AZURE_VOICES.map((v) => v.locale))].sort()
```

**Step 2: Commit**

```bash
git add packages/app/src/data/azure-voices.ts
git commit -m "feat(speech): add Azure English neural voices data (80+ voices)"
```

---

## Task 4: Browser TTS Provider

**Files:**
- Create: `packages/app/src/utils/tts-browser.ts`

Uses the Web Speech API `speechSynthesis` — zero config, works everywhere.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/tts-browser.ts

export interface BrowserVoiceOption {
  uri: string
  name: string
  lang: string
}

export function getBrowserVoices(): BrowserVoiceOption[] {
  if (typeof speechSynthesis === "undefined") return []
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("en"))
    .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }))
}

export function synthesizeBrowser(
  text: string,
  opts: { voiceURI: string; rate: number; pitch: number; volume: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") {
      reject(new Error("speechSynthesis not supported"))
      return
    }
    speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = opts.rate
    utt.pitch = opts.pitch
    utt.volume = Math.max(0, Math.min(1, opts.volume / 100))
    if (opts.voiceURI) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI)
      if (voice) utt.voice = voice
    }
    utt.onend = () => resolve()
    utt.onerror = (e) => reject(new Error(e.error))
    speechSynthesis.speak(utt)
  })
}

export function stopBrowser() {
  if (typeof speechSynthesis === "undefined") return
  speechSynthesis.cancel()
}
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/tts-browser.ts
git commit -m "feat(speech): add browser Web Speech API TTS provider"
```

---

## Task 5: Azure TTS Provider

**Files:**
- Create: `packages/app/src/utils/tts-azure.ts`

Calls Azure Cognitive Services REST API. Returns a Blob of audio (MP3). No SDK dependency — raw fetch.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/tts-azure.ts

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

export async function getAzureToken(region: string, apiKey: string): Promise<string> {
  const resp = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    },
  )
  if (!resp.ok) throw new Error(`Azure token error ${resp.status}: ${await resp.text()}`)
  return resp.text()
}

export async function synthesizeAzure(
  text: string,
  opts: { region: string; apiKey: string; voiceId: string; volume: number },
): Promise<Blob> {
  if (!opts.region) throw new Error("Azure region is not configured")
  if (!opts.apiKey) throw new Error("Azure API key is not configured")
  if (!opts.voiceId) throw new Error("Azure voice is not selected")

  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${opts.voiceId}'>${escapeXml(text)}</voice></speak>`

  const resp = await fetch(
    `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": opts.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "KiloCode",
      },
      body: ssml,
    },
  )

  if (!resp.ok) throw new Error(`Azure TTS error ${resp.status}: ${await resp.text()}`)
  return resp.blob()
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/tts-azure.ts
git commit -m "feat(speech): add Azure Cognitive Services TTS provider"
```

---

## Task 6: RVC Docker Provider

**Files:**
- Create: `packages/app/src/utils/tts-rvc.ts`

Calls the local RVC Docker container at `http://localhost:{port}`. The container exposes a simple HTTP API built in Task 13.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/tts-rvc.ts

export interface RvcVoiceModel {
  id: string        // Folder name, e.g. "en-female-aria"
  name: string      // Display name derived from folder name
  sizeMB: number    // Approximate model size
}

export async function listRvcVoices(port: number): Promise<RvcVoiceModel[]> {
  try {
    const resp = await fetch(`http://localhost:${port}/voices`, { signal: AbortSignal.timeout(3000) })
    if (!resp.ok) return []
    return resp.json() as Promise<RvcVoiceModel[]>
  } catch {
    return []
  }
}

export async function synthesizeRvc(
  text: string,
  opts: { voiceId: string; port: number; volume: number },
): Promise<Blob> {
  if (!opts.voiceId) throw new Error("No RVC voice selected")
  const resp = await fetch(`http://localhost:${opts.port}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: opts.voiceId }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText)
    throw new Error(`RVC error ${resp.status}: ${msg}`)
  }
  return resp.blob()
}

export async function checkRvcHealth(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) })
    return resp.ok
  } catch {
    return false
  }
}
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/tts-rvc.ts
git commit -m "feat(speech): add RVC Docker TTS provider"
```

---

## Task 7: TTS Engine — Central Dispatcher

**Files:**
- Create: `packages/app/src/utils/tts-engine.ts`

This is the single public API that all other code calls. It routes `speak(text)` to the active provider based on settings. Cancels current speech before starting new one.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/tts-engine.ts
// Central TTS dispatcher. Call speak() from any component.
// All provider routing logic lives here.

import { synthesizeAzure } from "./tts-azure"
import { synthesizeBrowser, stopBrowser } from "./tts-browser"
import { synthesizeRvc, checkRvcHealth } from "./tts-rvc"
import { playTTS, stopTTS } from "./tts"

export type SpeechOpts = {
  provider: "rvc" | "azure" | "browser"
  volume: number
  rvc: { voiceId: string; dockerPort: number }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
}

let busy = false

export function isSpeaking(): boolean {
  return busy
}

export function cancelSpeech(): void {
  stopTTS()
  stopBrowser()
  busy = false
}

export async function speak(text: string, opts: SpeechOpts): Promise<void> {
  if (!text.trim()) return
  cancelSpeech()
  busy = true
  try {
    if (opts.provider === "azure") {
      const blob = await synthesizeAzure(text, opts.azure)
      playTTS(blob, opts.volume)
    } else if (opts.provider === "rvc") {
      const blob = await synthesizeRvc(text, { ...opts.rvc, volume: opts.volume })
      playTTS(blob, opts.volume)
    } else {
      await synthesizeBrowser(text, { ...opts.browser, volume: opts.volume })
    }
  } catch (err) {
    // Silently swallow errors — speech is non-critical
    console.warn("[TTS]", err)
  } finally {
    busy = false
  }
}

export async function previewVoice(text: string, opts: SpeechOpts): Promise<void> {
  return speak(text, opts)
}

export { checkRvcHealth }
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/tts-engine.ts
git commit -m "feat(speech): add TTS engine dispatcher"
```

---

## Task 8: RVC Voice Manager

**Files:**
- Create: `packages/app/src/utils/rvc-voice-manager.ts`

Handles local RVC voice model files: scan a folder, derive metadata from folder names.

**Step 1: Create the file**

```typescript
// packages/app/src/utils/rvc-voice-manager.ts
// Manages RVC voice model files stored at ~/.kilocode/voices/rvc/
// Each voice is a folder containing a .pth model file and optionally a .index file.

export interface RvcLocalVoice {
  id: string      // Folder name used as voice ID
  name: string    // Formatted display name
  path: string    // Absolute path to folder
}

/**
 * Format folder name to display name.
 * "en-female-aria-v2" → "Aria (Female, EN)"
 * Falls back to capitalizing the raw folder name.
 */
export function formatVoiceName(folderId: string): string {
  const parts = folderId.split(/[-_]/)
  // Try to extract structured parts: locale-gender-name
  if (parts.length >= 3) {
    const locale = parts[0].toUpperCase()
    const gender = parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase()
    const name = parts
      .slice(2)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
      .replace(/\s*[Vv]\d+$/, "") // strip version suffix
    return `${name} (${gender}, ${locale})`
  }
  return folderId
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

/**
 * Parse RVC voice listings returned from the Docker container's /voices endpoint
 * into display-ready objects.
 */
export function enrichVoiceList(raw: { id: string; sizeMB: number }[]): RvcLocalVoice[] {
  return raw.map((v) => ({
    id: v.id,
    name: formatVoiceName(v.id),
    path: v.id,
  }))
}
```

**Step 2: Commit**

```bash
git add packages/app/src/utils/rvc-voice-manager.ts
git commit -m "feat(speech): add RVC voice manager utility"
```

---

## Task 9: i18n Keys

**Files:**
- Modify: `packages/app/src/i18n/en.ts`

All speech-related UI strings. Follow the existing key naming convention exactly.

**Step 1: Add keys to `packages/app/src/i18n/en.ts`**

At the end of the `dict` object (before the closing `}`), add:

```typescript
  // Speech settings
  "settings.tab.speech": "Speech",
  "settings.section.speech": "Speech",
  "settings.speech.title": "Speech",
  "settings.speech.section.provider": "Provider",
  "settings.speech.section.voice": "Voice",
  "settings.speech.section.preview": "Preview",

  "settings.speech.row.enabled.title": "Enable assistant speech",
  "settings.speech.row.enabled.description": "Read assistant replies aloud when they complete",
  "settings.speech.row.autoSpeak.title": "Auto-speak replies",
  "settings.speech.row.autoSpeak.description": "Automatically speak each assistant reply",
  "settings.speech.row.volume.title": "Volume",
  "settings.speech.row.volume.description": "Speech output volume (0–100)",
  "settings.speech.row.provider.title": "Provider",
  "settings.speech.row.provider.description": "TTS engine to use",

  "settings.speech.provider.rvc": "RVC (Local)",
  "settings.speech.provider.azure": "Azure Neural",
  "settings.speech.provider.browser": "Browser (Built-in)",

  "settings.speech.row.rvcVoice.title": "RVC Voice",
  "settings.speech.row.rvcVoice.description": "Select a downloaded RVC voice model",
  "settings.speech.row.rvcPort.title": "Docker Port",
  "settings.speech.row.rvcPort.description": "Port the RVC Docker container listens on",
  "settings.speech.rvc.noVoices": "No voices found — add one below",
  "settings.speech.rvc.dockerOffline": "RVC Docker container is not running",
  "settings.speech.rvc.dockerOnline": "RVC container online",

  "settings.speech.row.azureKey.title": "Azure API Key",
  "settings.speech.row.azureKey.description": "Your Azure Cognitive Services subscription key",
  "settings.speech.row.azureRegion.title": "Azure Region",
  "settings.speech.row.azureRegion.description": "e.g. eastus, westeurope",
  "settings.speech.row.azureVoice.title": "Azure Voice",
  "settings.speech.row.azureVoice.description": "Select an English neural voice",

  "settings.speech.row.browserVoice.title": "Browser Voice",
  "settings.speech.row.browserVoice.description": "Select from voices available in your browser",
  "settings.speech.row.browserRate.title": "Speech Rate",
  "settings.speech.row.browserRate.description": "0.5 (slow) to 2.0 (fast)",
  "settings.speech.row.browserPitch.title": "Pitch",
  "settings.speech.row.browserPitch.description": "0.0 (low) to 2.0 (high)",

  "settings.speech.preview.placeholder": "Type a sentence to preview the selected voice...",
  "settings.speech.preview.play": "Preview",
  "settings.speech.preview.stop": "Stop",
  "settings.speech.preview.save": "Save Preview",
  "settings.speech.preview.saved": "Preview saved",

  "settings.speech.addVoice.button": "Add RVC Voice",
  "settings.speech.addVoice.title": "Add RVC Voice Model",
  "settings.speech.addVoice.urlLabel": "Model Folder Name",
  "settings.speech.addVoice.urlDescription": "Enter the exact folder name to identify this voice (e.g. en-female-aria)",
  "settings.speech.addVoice.confirm": "Add Voice",
  "settings.speech.addVoice.cancel": "Cancel",
```

**Step 2: Commit**

```bash
git add packages/app/src/i18n/en.ts
git commit -m "feat(speech): add i18n keys for Speech settings tab"
```

---

## Task 10: Speech Settings Component

**Files:**
- Create: `packages/app/src/components/settings-speech.tsx`

The full Speech settings tab. Follows the exact same structure as `settings-general.tsx`. Uses the same `SettingsRow` layout pattern with `Switch`, `Select`, and `Button` from `@opencode-ai/ui`.

**Step 1: Create the file**

```typescript
// packages/app/src/components/settings-speech.tsx

import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onMount,
  Show,
} from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Input } from "@opencode-ai/ui/input"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSettings, type SpeechProvider } from "@/context/settings"
import { AZURE_VOICES, AZURE_LOCALES } from "@/data/azure-voices"
import { getBrowserVoices } from "@/utils/tts-browser"
import { listRvcVoices, checkRvcHealth } from "@/utils/tts-rvc"
import { enrichVoiceList } from "@/utils/rvc-voice-manager"
import { speak, cancelSpeech, isSpeaking } from "@/utils/tts-engine"

export const SettingsSpeech: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  const [previewText, setPreviewText] = createSignal("")
  const [previewing, setPreviewing] = createSignal(false)
  const [rvcVoices, setRvcVoices] = createSignal<{ id: string; name: string }[]>([])
  const [rvcOnline, setRvcOnline] = createSignal(false)
  const [browserVoices, setBrowserVoices] = createSignal<{ uri: string; name: string; lang: string }[]>([])
  const [azureLocaleFilter, setAzureLocaleFilter] = createSignal("en-US")

  onMount(() => {
    setBrowserVoices(getBrowserVoices())
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.onvoiceschanged = () => setBrowserVoices(getBrowserVoices())
    }
  })

  const refreshRvcVoices = async () => {
    const port = settings.speech.rvc.dockerPort()
    const online = await checkRvcHealth(port)
    setRvcOnline(online)
    if (online) {
      const raw = await listRvcVoices(port)
      setRvcVoices(enrichVoiceList(raw))
    }
  }

  createEffect(() => {
    if (settings.speech.provider() === "rvc") {
      void refreshRvcVoices()
    }
  })

  const currentSpeechOpts = () => ({
    provider: settings.speech.provider(),
    volume: settings.speech.volume(),
    rvc: {
      voiceId: settings.speech.rvc.voiceId(),
      dockerPort: settings.speech.rvc.dockerPort(),
    },
    azure: {
      region: settings.speech.azure.region(),
      apiKey: settings.speech.azure.apiKey(),
      voiceId: settings.speech.azure.voiceId(),
    },
    browser: {
      voiceURI: settings.speech.browser.voiceURI(),
      rate: settings.speech.browser.rate(),
      pitch: settings.speech.browser.pitch(),
    },
  })

  const handlePreview = async () => {
    const text = previewText().trim()
    if (!text) return
    if (isSpeaking()) {
      cancelSpeech()
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    try {
      await speak(text, currentSpeechOpts())
    } catch (err) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Preview failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPreviewing(false)
    }
  }

  const providerOptions: { value: SpeechProvider; label: string }[] = [
    { value: "rvc",     label: language.t("settings.speech.provider.rvc") },
    { value: "azure",   label: language.t("settings.speech.provider.azure") },
    { value: "browser", label: language.t("settings.speech.provider.browser") },
  ]

  const azureVoicesFiltered = createMemo(() =>
    AZURE_VOICES.filter((v) => v.locale === azureLocaleFilter()),
  )

  const localeOptions = createMemo(() =>
    AZURE_LOCALES.map((l) => ({ value: l, label: l })),
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.speech.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">

        {/* General */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.speech.section.provider")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">

            <SettingsRow
              title={language.t("settings.speech.row.enabled.title")}
              description={language.t("settings.speech.row.enabled.description")}
            >
              <Switch
                checked={settings.speech.enabled()}
                onChange={(v) => settings.speech.setEnabled(v)}
              />
            </SettingsRow>

            <Show when={settings.speech.enabled()}>
              <SettingsRow
                title={language.t("settings.speech.row.autoSpeak.title")}
                description={language.t("settings.speech.row.autoSpeak.description")}
              >
                <Switch
                  checked={settings.speech.autoSpeak()}
                  onChange={(v) => settings.speech.setAutoSpeak(v)}
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.provider.title")}
                description={language.t("settings.speech.row.provider.description")}
              >
                <Select
                  options={providerOptions}
                  current={providerOptions.find((o) => o.value === settings.speech.provider())}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => o && settings.speech.setProvider(o.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.volume.title")}
                description={language.t("settings.speech.row.volume.description")}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.speech.volume()}
                  onInput={(e) => settings.speech.setVolume(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>
            </Show>
          </div>
        </div>

        {/* RVC Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "rvc"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">RVC</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <SettingsRow
                title={language.t("settings.speech.row.rvcPort.title")}
                description={language.t("settings.speech.row.rvcPort.description")}
              >
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={settings.speech.rvc.dockerPort()}
                    onBlur={(e) => {
                      const v = Number(e.currentTarget.value)
                      if (v > 1023 && v < 65536) settings.speech.rvc.setDockerPort(v)
                    }}
                    class="w-24 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong text-right"
                  />
                  <Button size="small" variant="secondary" onClick={() => void refreshRvcVoices()}>
                    <Icon name="refresh" size="small" />
                  </Button>
                  <span class={`text-11-regular ${rvcOnline() ? "text-green-400" : "text-red-400"}`}>
                    {rvcOnline()
                      ? language.t("settings.speech.rvc.dockerOnline")
                      : language.t("settings.speech.rvc.dockerOffline")}
                  </span>
                </div>
              </SettingsRow>

              <Show
                when={rvcVoices().length > 0}
                fallback={
                  <SettingsRow
                    title={language.t("settings.speech.row.rvcVoice.title")}
                    description={language.t("settings.speech.rvc.noVoices")}
                  >
                    <span class="text-12-regular text-text-weak">—</span>
                  </SettingsRow>
                }
              >
                <SettingsRow
                  title={language.t("settings.speech.row.rvcVoice.title")}
                  description={language.t("settings.speech.row.rvcVoice.description")}
                >
                  <Select
                    options={rvcVoices()}
                    current={rvcVoices().find((v) => v.id === settings.speech.rvc.voiceId())}
                    value={(o) => o.id}
                    label={(o) => o.name}
                    onSelect={(o) => o && settings.speech.rvc.setVoiceId(o.id)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              </Show>

            </div>
          </div>
        </Show>

        {/* Azure Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "azure"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">Azure Neural</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <SettingsRow
                title={language.t("settings.speech.row.azureKey.title")}
                description={language.t("settings.speech.row.azureKey.description")}
              >
                <input
                  type="password"
                  value={settings.speech.azure.apiKey()}
                  placeholder="••••••••••••••••"
                  onBlur={(e) => settings.speech.azure.setApiKey(e.currentTarget.value)}
                  class="w-48 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.azureRegion.title")}
                description={language.t("settings.speech.row.azureRegion.description")}
              >
                <input
                  type="text"
                  value={settings.speech.azure.region()}
                  placeholder="eastus"
                  onBlur={(e) => settings.speech.azure.setRegion(e.currentTarget.value.trim())}
                  class="w-36 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong"
                />
              </SettingsRow>

              <SettingsRow
                title="Locale Filter"
                description="Filter voices by English locale"
              >
                <Select
                  options={localeOptions()}
                  current={localeOptions().find((o) => o.value === azureLocaleFilter())}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => o && setAzureLocaleFilter(o.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.azureVoice.title")}
                description={language.t("settings.speech.row.azureVoice.description")}
              >
                <Select
                  options={azureVoicesFiltered()}
                  current={azureVoicesFiltered().find((v) => v.id === settings.speech.azure.voiceId())}
                  value={(o) => o.id}
                  label={(o) => o.name}
                  onSelect={(o) => o && settings.speech.azure.setVoiceId(o.id)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

            </div>
          </div>
        </Show>

        {/* Browser Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "browser"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">Browser (Built-in)</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <Show when={browserVoices().length > 0}>
                <SettingsRow
                  title={language.t("settings.speech.row.browserVoice.title")}
                  description={language.t("settings.speech.row.browserVoice.description")}
                >
                  <Select
                    options={browserVoices()}
                    current={browserVoices().find((v) => v.uri === settings.speech.browser.voiceURI())}
                    value={(o) => o.uri}
                    label={(o) => `${o.name} (${o.lang})`}
                    onSelect={(o) => o && settings.speech.browser.setVoiceURI(o.uri)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              </Show>

              <SettingsRow
                title={language.t("settings.speech.row.browserRate.title")}
                description={language.t("settings.speech.row.browserRate.description")}
              >
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={settings.speech.browser.rate()}
                  onInput={(e) => settings.speech.browser.setRate(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.browserPitch.title")}
                description={language.t("settings.speech.row.browserPitch.description")}
              >
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.1"
                  value={settings.speech.browser.pitch()}
                  onInput={(e) => settings.speech.browser.setPitch(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>

            </div>
          </div>
        </Show>

        {/* Voice Preview Section */}
        <Show when={settings.speech.enabled()}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.speech.section.preview")}</h3>
            <div class="bg-surface-raised-base px-4 py-4 rounded-lg flex flex-col gap-3">
              <textarea
                class="w-full bg-surface-base border border-border-base rounded px-3 py-2 text-13-regular text-text-strong resize-none h-20 placeholder:text-text-weak"
                placeholder={language.t("settings.speech.preview.placeholder")}
                value={previewText()}
                onInput={(e) => setPreviewText(e.currentTarget.value)}
              />
              <div class="flex gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => void handlePreview()}
                  disabled={!previewText().trim()}
                >
                  <Icon name={previewing() ? "square" : "play"} size="small" />
                  {previewing()
                    ? language.t("settings.speech.preview.stop")
                    : language.t("settings.speech.preview.play")}
                </Button>
              </div>
            </div>
          </div>
        </Show>

      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/app/src/components/settings-speech.tsx
git commit -m "feat(speech): add Speech settings tab component"
```

---

## Task 11: Wire Speech Tab into Dialog Settings

**Files:**
- Modify: `packages/app/src/components/dialog-settings.tsx`

Add the Speech tab trigger and content panel in the "Desktop" section (alongside General and Shortcuts).

**Step 1: Add the import at the top of the file (after line 10)**

```typescript
import { SettingsSpeech } from "./settings-speech"
```

**Step 2: Add the tab trigger — in the Desktop section (after the Shortcuts trigger, around line 33)**

```tsx
<Tabs.Trigger value="speech">
  <Icon name="volume-2" />
  {language.t("settings.tab.speech")}
</Tabs.Trigger>
```

**Step 3: Add the tab content — after the shortcuts Tabs.Content block (after line 62)**

```tsx
<Tabs.Content value="speech" class="no-scrollbar">
  <SettingsSpeech />
</Tabs.Content>
```

**Step 4: Commit**

```bash
git add packages/app/src/components/dialog-settings.tsx
git commit -m "feat(speech): add Speech tab to settings dialog"
```

---

## Task 12: Auto-Speak Reply Hook

**Files:**
- Modify: `packages/app/src/pages/session.tsx` (or wherever session messages are rendered — find with: `grep -r "session_status" packages/app/src --include="*.tsx" -l`)

This creates a `createEffect` that watches when a session transitions to `"idle"` status, then grabs the last assistant message's text and speaks it.

**Step 1: Find the correct file**

Run:
```bash
grep -r "session_status" packages/app/src --include="*.tsx" -l
```

Open the result file. Look for where `session_status` is read from the global sync store.

**Step 2: Add the auto-speak effect**

In the component that renders the session (the one watching `session_status`), add these imports at the top:

```typescript
import { speak } from "@/utils/tts-engine"
import { useSettings } from "@/context/settings"
```

Then inside the component function, add this effect. It should be placed after the section that reads `session_status`:

```typescript
const settings = useSettings()

// Auto-speak assistant reply when agent finishes
createEffect(() => {
  const status = sync.data.session_status[sessionID]
  if (status !== "idle") return
  if (!settings.speech.enabled()) return
  if (!settings.speech.autoSpeak()) return

  const messages = sync.data.message[sessionID] ?? []
  // Find the last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return

  const parts = sync.data.part[lastAssistant.id] ?? []
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join(" ")
    .trim()

  if (!text) return

  void speak(text, {
    provider: settings.speech.provider(),
    volume: settings.speech.volume(),
    rvc: {
      voiceId: settings.speech.rvc.voiceId(),
      dockerPort: settings.speech.rvc.dockerPort(),
    },
    azure: {
      region: settings.speech.azure.region(),
      apiKey: settings.speech.azure.apiKey(),
      voiceId: settings.speech.azure.voiceId(),
    },
    browser: {
      voiceURI: settings.speech.browser.voiceURI(),
      rate: settings.speech.browser.rate(),
      pitch: settings.speech.browser.pitch(),
    },
  })
})
```

**Step 3: Commit**

```bash
git add packages/app/src/pages/session.tsx   # (or whatever file you modified)
git commit -m "feat(speech): auto-speak assistant replies on session idle"
```

---

## Task 13: RVC Docker Container

**Files:**
- Create: `docker/rvc/Dockerfile`
- Create: `docker/rvc/server.py`
- Create: `docker/rvc/requirements.txt`
- Create: `docker/rvc/README.md`

The RVC container converts text → speech in two steps:
1. Uses `edge-tts` (free Microsoft Edge TTS) to generate a baseline audio from text
2. Passes that audio through RVC voice conversion to apply the user's chosen voice model

This is the exact approach used by most open-source RVC TTS pipelines and requires no additional paid services.

**Step 1: Create `docker/rvc/requirements.txt`**

```
fastapi==0.111.0
uvicorn==0.29.0
edge-tts==6.1.9
torch==2.2.2
torchaudio==2.2.2
numpy==1.26.4
scipy==1.13.0
librosa==0.10.2
soundfile==0.12.1
faiss-cpu==1.8.0
praat-parselmouth==0.4.3
pyworld==0.3.4
```

**Step 2: Create `docker/rvc/server.py`**

```python
"""
KiloCode RVC TTS Server
Converts text → speech using edge-tts + RVC voice conversion.

Voice models must be placed in /models/{voice_id}/ as:
  /models/{voice_id}/model.pth   (required)
  /models/{voice_id}/model.index (optional, improves quality)
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

    # Step 1: Generate baseline audio via edge-tts
    baseline_wav = await _edge_tts_to_wav(req.text, req.edge_voice or DEFAULT_EDGE_VOICE)

    # Step 2: Apply RVC voice conversion
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
    """
    Run RVC inference using the RVC core pipeline.
    Loads the model, runs VC inference, returns WAV bytes.
    """
    try:
        from rvc_python.infer import RVCInference  # type: ignore
    except ImportError:
        # Fallback: return baseline audio unchanged if RVC library not available
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
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

**Step 3: Create `docker/rvc/Dockerfile`**

```dockerfile
FROM python:3.10-slim

WORKDIR /app

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install rvc-python (lightweight RVC inference wrapper)
RUN pip install --no-cache-dir rvc-python

COPY server.py .

VOLUME ["/models"]

EXPOSE 7860

CMD ["python", "server.py"]
```

**Step 4: Create `docker/rvc/README.md`**

```markdown
# KiloCode RVC TTS Docker Container

Provides local high-quality TTS using RVC (Retrieval-based Voice Conversion).

## Quick Start

```bash
docker run --rm -p 7860:7860 \
  -v ~/.kilocode/voices/rvc:/models \
  ghcr.io/kilocode/rvc-tts:latest
```

## Adding Voice Models

Voice models are RVC `.pth` files. Place them in subfolders under `~/.kilocode/voices/rvc/`:

```
~/.kilocode/voices/rvc/
  en-female-aria/
    model.pth
    model.index   (optional)
  en-male-ryan/
    model.pth
```

The folder name becomes the voice ID. Naming convention for best display:
`{locale}-{gender}-{name}` e.g. `en-us-female-aria`

## Where to Find RVC Models

- Hugging Face: search "RVC voice model" 
- RVC model repositories on GitHub

## API

- `GET /health` — container health check
- `GET /voices` — list loaded voice models
- `POST /synthesize` — synthesize speech
  ```json
  { "text": "Hello world", "voice_id": "en-female-aria" }
  ```
  Returns: `audio/wav`
```

**Step 5: Commit**

```bash
git add docker/rvc/
git commit -m "feat(speech): add RVC Docker container with edge-tts + RVC inference server"
```

---

## Task 14: Save Memory to Disk

Write project and feedback memories to the memory system.

**Files:**
- Create: `C:\Users\Admin\.claude\projects\G--Github-kilocode\memory\MEMORY.md`
- Create: `C:\Users\Admin\.claude\projects\G--Github-kilocode\memory\project_speech_system.md`
- Create: `C:\Users\Admin\.claude\projects\G--Github-kilocode\memory\feedback_kilocode_standards.md`

See memory writing instructions in system prompt for format.

---

## Task 15: Final Wiring Check

Run through each integration point to verify everything is wired:

1. `settings.tsx` exports `SpeechProvider` type — verify it's exported
2. `tts-engine.ts` imports compile cleanly — `tts.ts`, `tts-azure.ts`, `tts-browser.ts`, `tts-rvc.ts` all present
3. `settings-speech.tsx` imports from `@/data/azure-voices` — verify path
4. `dialog-settings.tsx` imports `SettingsSpeech` — verify import path
5. Auto-speak effect in session page — verify `sync.data.part` key shape matches SDK types in `packages/app/src/context/global-sync/types.ts` (the `part` field maps `messageID → Part[]`)
6. `docker/rvc/` directory committed

**Compile check:**

```bash
cd packages/app
npx tsc --noEmit
```

Fix any type errors — the most likely issue is the `Part` type shape from `@kilocode/sdk/v2/client`. Check the Part union type and adjust the text extraction in the auto-speak effect accordingly.

**Step: Commit any fixes**

```bash
git add -A
git commit -m "fix(speech): resolve type errors from tsc check"
```

---

## Task 16: Final Branch Commit + Summary

```bash
git log --oneline feature/speech-system
```

Expected commits (in order):
1. `feat(speech): add SpeechSettings types and defaults to settings context`
2. `feat(speech): add TTS playback utility`
3. `feat(speech): add Azure English neural voices data (80+ voices)`
4. `feat(speech): add browser Web Speech API TTS provider`
5. `feat(speech): add Azure Cognitive Services TTS provider`
6. `feat(speech): add RVC Docker TTS provider`
7. `feat(speech): add TTS engine dispatcher`
8. `feat(speech): add RVC voice manager utility`
9. `feat(speech): add i18n keys for Speech settings tab`
10. `feat(speech): add Speech settings tab component`
11. `feat(speech): add Speech tab to settings dialog`
12. `feat(speech): auto-speak assistant replies on session idle`
13. `feat(speech): add RVC Docker container with edge-tts + RVC inference server`
14. `fix(speech): resolve type errors from tsc check` (if needed)

---

## Architecture Summary

```
packages/app/src/
├── context/
│   └── settings.tsx          MODIFIED — SpeechSettings added
├── data/
│   └── azure-voices.ts       NEW — 80+ Azure Neural English voice IDs
├── utils/
│   ├── tts.ts                NEW — playTTS() / stopTTS() using Audio element
│   ├── tts-browser.ts        NEW — Web Speech API synthesis
│   ├── tts-azure.ts          NEW — Azure REST API synthesis
│   ├── tts-rvc.ts            NEW — RVC Docker HTTP API synthesis
│   ├── tts-engine.ts         NEW — speak() dispatcher, cancelSpeech()
│   └── rvc-voice-manager.ts  NEW — voice folder → display name formatting
├── components/
│   ├── settings-speech.tsx   NEW — full Speech tab UI
│   └── dialog-settings.tsx   MODIFIED — Speech tab wired in
├── i18n/
│   └── en.ts                 MODIFIED — speech.* keys added
└── pages/
    └── session.tsx           MODIFIED — auto-speak createEffect

docker/
└── rvc/
    ├── Dockerfile            NEW
    ├── server.py             NEW — FastAPI + edge-tts + RVC inference
    ├── requirements.txt      NEW
    └── README.md             NEW
```

**Data flow:**
```
Agent reply complete
  → session_status[id] === "idle"
    → createEffect fires
      → extract last assistant message text from sync.data.part
        → speak(text, settingsOpts)
          → tts-engine.ts routes to active provider
            → RVC: fetch http://localhost:7860/synthesize → Blob → playTTS()
            → Azure: fetch Azure REST API → Blob → playTTS()
            → Browser: speechSynthesis.speak()
```
