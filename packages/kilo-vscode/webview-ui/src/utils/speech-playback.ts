/**
 * SpeechEngine — unified speech synthesis + playback with provider switching,
 * readiness validation, automatic fallback, and retry logic.
 *
 * Replaces the previous SpeechPlaybackManager with a full engine that handles
 * both synthesis (fetch to Azure/RVC) and playback (Audio/SpeechSynthesis).
 *
 * Fallback chain: RVC → Azure → Browser (if configured)
 * Azure → Browser
 * Browser → (always available)
 *
 * kilocode_change: Phase 3.2 (ChunkedSpeechPlayer), Phase 6.3 (VAD pause),
 *   Phase 7.1 (exponential backoff + providerStats), Phase 7.3 (AudioCritic cache)
 */

// kilocode_change: Phase 3.2 — ChunkedSpeechPlayer import
import { ChunkedSpeechPlayer } from "./chunked-speech"
// kilocode_change: Phase 7.3 — AudioCritic + SynthesisCache imports
import { AudioCritic, SynthesisCache } from "./audio-critic"

// ── Types ────────────────────────────────────────────────────────────────────
export type SpeechProvider = "browser" | "azure" | "rvc"
export type PlaybackSource = "preview" | "auto-speak" | "voice-studio"

export interface SpeechConfig {
  provider: SpeechProvider
  volume: number // 0-100
  rvc: { voiceId: string; dockerPort: number; edgeVoice: string; pitchShift: number }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
  // kilocode_change: Phase 3.2 — stream speech flag (default false)
  streamSpeech?: boolean
  // kilocode_change: Phase 6.3 — VAD pause flag (default false)
  vadEnabled?: boolean
}

export interface SpeechResult {
  provider: SpeechProvider
  usedFallback: boolean
  fallbackReason?: string
  error?: string
}

interface ActivePlayback {
  source: PlaybackSource
  provider: SpeechProvider
  audio?: HTMLAudioElement
  blobUrl?: string
  utterance?: SpeechSynthesisUtterance
  abortController?: AbortController
  // kilocode_change: Phase 3.2 — track chunked player so we can interrupt it
  chunkedPlayer?: ChunkedSpeechPlayer
}

type ErrorCallback = (provider: SpeechProvider, error: string, fallbackUsed?: SpeechProvider) => void
type StopCallback = () => void

// ── kilocode_change: Phase 7.1 — module-level provider stats ─────────────────
/**
 * Track per-provider success/failure counts so that the fallback chain can be
 * sorted with the most-reliable provider first.
 */
const providerStats = new Map<string, { successes: number; failures: number }>()

function recordProviderSuccess(provider: SpeechProvider): void {
  const stats = providerStats.get(provider) ?? { successes: 0, failures: 0 }
  stats.successes++
  providerStats.set(provider, stats)
}

function recordProviderFailure(provider: SpeechProvider): void {
  const stats = providerStats.get(provider) ?? { successes: 0, failures: 0 }
  stats.failures++
  providerStats.set(provider, stats)
}

/** Success rate in [0, 1].  Unknown providers start at 0.5 (neutral). */
function successRate(provider: SpeechProvider): number {
  const stats = providerStats.get(provider)
  if (!stats) return 0.5
  const total = stats.successes + stats.failures
  if (total === 0) return 0.5
  return stats.successes / total
}

// ── kilocode_change: Phase 7.1 — exponential backoff helper ──────────────────
const BACKOFF_BASE_DELAY = 500   // ms
const BACKOFF_MAX_DELAY  = 10000 // ms
const BACKOFF_JITTER     = 500   // ms
const BACKOFF_MAX_ATTEMPTS = 3

function backoffDelay(attempt: number): number {
  const raw = BACKOFF_BASE_DELAY * Math.pow(2, attempt) + Math.random() * BACKOFF_JITTER
  return Math.min(raw, BACKOFF_MAX_DELAY)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Readiness checks ─────────────────────────────────────────────────────────

/** Validate that a provider's config is sufficient to attempt synthesis */
function checkReady(provider: SpeechProvider, config: SpeechConfig): { ready: boolean; reason?: string } {
  switch (provider) {
    case "browser":
      return { ready: true }

    case "azure":
      if (!config.azure.apiKey || config.azure.apiKey.trim() === "") {
        return { ready: false, reason: "Azure API key is not set" }
      }
      if (!config.azure.region || config.azure.region.trim() === "") {
        return { ready: false, reason: "Azure region is not set" }
      }
      if (!config.azure.voiceId || config.azure.voiceId.trim() === "") {
        return { ready: false, reason: "Azure voice is not selected" }
      }
      return { ready: true }

    case "rvc":
      if (!config.rvc.voiceId || config.rvc.voiceId.trim() === "") {
        return { ready: false, reason: "No RVC voice model selected" }
      }
      if (!config.rvc.dockerPort) {
        return { ready: false, reason: "RVC Docker port not configured" }
      }
      return { ready: true }

    default:
      return { ready: false, reason: `Unknown provider: ${provider}` }
  }
}

/** Get the fallback chain for a given provider, sorted by success rate (highest first) */
function getFallbackChain(primary: SpeechProvider, config: SpeechConfig): SpeechProvider[] {
  const chain: SpeechProvider[] = []
  if (primary === "rvc") {
    // RVC → Azure (if configured) → Browser
    if (checkReady("azure", config).ready) chain.push("azure")
    chain.push("browser")
  } else if (primary === "azure") {
    // Azure → Browser
    chain.push("browser")
  }
  // Browser has no fallback — it always works

  // kilocode_change: Phase 7.1 — sort fallback chain by success rate (best first)
  chain.sort((a, b) => successRate(b) - successRate(a))

  return chain
}

// ── XML escaping ─────────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// ── Synthesis functions (fetch audio data) ───────────────────────────────────

async function synthesizeAzure(
  text: string,
  config: SpeechConfig,
  signal?: AbortSignal,
): Promise<Blob> {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${config.azure.voiceId}">${escapeXml(text)}</voice></speak>`
  const resp = await fetch(
    `https://${config.azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": config.azure.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      body: ssml,
      signal,
    },
  )
  if (!resp.ok) {
    const status = resp.status
    if (status === 401) throw new Error("Azure API key is invalid or expired")
    if (status === 403) throw new Error("Azure API key does not have TTS permissions")
    if (status === 429) throw new Error("Azure rate limit exceeded — try again in a moment")
    throw new Error(`Azure TTS returned HTTP ${status}`)
  }
  const blob = await resp.blob()
  if (blob.size < 100) throw new Error("Azure returned empty audio — check voice ID and region")
  return blob
}

// kilocode_change: RVC synthesis goes through KiloProvider message passing.
// VS Code webviews cannot call http://localhost directly (CORS — Docker containers
// don't set Access-Control-Allow-Origin). KiloProvider runs in Node.js (no CORS)
// and is always active. The bridge is registered by SpeechTab on mount.
async function synthesizeRvc(
  text: string,
  config: SpeechConfig,
  signal?: AbortSignal,
): Promise<Blob> {
  const bridge = getRvcBridge()
  if (!bridge) {
    throw new Error("RVC bridge not ready — open Speech settings once to initialize")
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const id = Math.random().toString(36).slice(2)
  const result = await bridge({
    type: "rvcSynthesize",
    id,
    text,
    voiceId: config.rvc.voiceId,
    edgeVoice: config.rvc.edgeVoice || "en-US-AriaNeural",
    pitchShift: config.rvc.pitchShift || 0,
  }) as { ok: boolean; audioBase64?: string; error?: string }

  if (!result.ok || !result.audioBase64) {
    const errMsg = result.error ?? "RVC synthesis failed"
    if (errMsg.includes("not found")) throw new Error(`Voice model '${config.rvc.voiceId}' not found in container`)
    throw new Error(errMsg)
  }

  // Decode base64 → Blob
  const binary = atob(result.audioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: "audio/wav" })
  if (blob.size < 100) throw new Error("RVC returned empty audio")
  return blob
}

// ── kilocode_change: Phase 7.3 — decode blob to AudioBuffer for critic ───────
async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    await ctx.close()
    return audioBuffer
  } catch {
    return null
  }
}

// ── kilocode_change: Phase 6.3 — VAD (Voice Activity Detection) helper ───────
interface VadHandle {
  stream: MediaStream
  analyser: AnalyserNode
  context: AudioContext
  source: MediaStreamAudioSourceNode
  stop: () => void
}

async function startVad(): Promise<VadHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const stop = () => {
      try {
        source.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        void context.close()
      } catch { /* swallow */ }
    }
    return { stream, analyser, context, source, stop }
  } catch {
    // Permission denied or device not available — fall through to normal behavior
    return null
  }
}

function getMicRms(analyser: AnalyserNode): number {
  const data = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(data)
  let sum = 0
  for (const s of data) sum += s * s
  return Math.sqrt(sum / data.length)
}

// ── Engine ────────────────────────────────────────────────────────────────────

class SpeechEngine {
  private active: ActivePlayback | null = null
  private onErrorCallbacks: ErrorCallback[] = []
  private onStopCallbacks: StopCallback[] = []

  // ── Public API ──────────────────────────────────────────────────────────

  /** Stop whatever is currently playing or being fetched */
  stop(): void {
    if (!this.active) return

    // Abort any in-flight fetch
    if (this.active.abortController) {
      this.active.abortController.abort()
    }
    // kilocode_change: Phase 3.2 — interrupt chunked player if active
    if (this.active.chunkedPlayer) {
      this.active.chunkedPlayer.interrupt()
    }
    // Stop audio element
    if (this.active.audio) {
      this.active.audio.pause()
      this.active.audio.currentTime = 0
      this.active.audio.src = ""
    }
    // Revoke blob URL
    if (this.active.blobUrl) {
      URL.revokeObjectURL(this.active.blobUrl)
    }
    // Cancel browser speech
    if (this.active.utterance || this.active.provider === "browser") {
      speechSynthesis.cancel()
    }

    this.active = null
    this.notifyStop()
  }

  /** Whether something is actively playing or being fetched */
  isPlaying(): boolean {
    return this.active !== null
  }

  /** Register an error callback */
  onError(cb: ErrorCallback): () => void {
    this.onErrorCallbacks.push(cb)
    return () => { this.onErrorCallbacks = this.onErrorCallbacks.filter((c) => c !== cb) }
  }

  /** Register a stop callback */
  onStop(cb: StopCallback): () => void {
    this.onStopCallbacks.push(cb)
    return () => { this.onStopCallbacks = this.onStopCallbacks.filter((c) => c !== cb) }
  }

  /**
   * Main entry point: speak text using the configured provider.
   * Validates readiness, attempts synthesis, falls back if primary fails.
   *
   * kilocode_change: Phase 3.2 — delegates to ChunkedSpeechPlayer for long text
   *   or when streamSpeech is enabled.
   * kilocode_change: Phase 6.3 — pauses/resumes TTS when VAD detects mic activity.
   */
  async speak(text: string, config: SpeechConfig, source: PlaybackSource = "auto-speak"): Promise<SpeechResult> {
    // Stop any active playback first
    this.stop()

    const primary = config.provider

    // kilocode_change: Phase 3.2 — use ChunkedSpeechPlayer for long text or stream mode
    const useChunked = (config.streamSpeech === true) || (text.length > 200 && primary !== "browser")
    if (useChunked && primary !== "browser") {
      return this.speakChunked(text, config, source)
    }

    const readiness = checkReady(primary, config)

    // If primary isn't even configured, skip straight to fallback
    if (!readiness.ready) {
      console.warn(`[Speech] ${primary} not ready: ${readiness.reason}`)
      return this.tryFallbackChain(text, config, source, primary, readiness.reason!)
    }

    // Try the primary provider
    try {
      await this.synthesizeAndPlay(text, config, primary, source)
      return { provider: primary, usedFallback: false }
    } catch (e: unknown) {
      if (this.isAbortError(e)) {
        return { provider: primary, usedFallback: false, error: "Cancelled" }
      }
      const errMsg = e instanceof Error ? e.message : String(e)
      console.warn(`[Speech] ${primary} failed: ${errMsg}`)
      return this.tryFallbackChain(text, config, source, primary, errMsg)
    }
  }

  /**
   * Check if a provider is ready to synthesize (without attempting it).
   * For RVC, also does a health ping.
   */
  async checkProviderHealth(provider: SpeechProvider, config: SpeechConfig): Promise<{ ready: boolean; reason?: string }> {
    const basic = checkReady(provider, config)
    if (!basic.ready) return basic

    if (provider === "rvc") {
      // kilocode_change: use KiloProvider message bridge — always active, no CORS issues
      const bridge = getRvcBridge()
      if (!bridge) return { ready: false, reason: "RVC bridge not ready — open Speech settings once" }
      try {
        const id = Math.random().toString(36).slice(2)
        const result = await bridge({ type: "rvcHealth", id }) as { ok: boolean; port?: number; error?: string }
        if (!result.ok) return { ready: false, reason: result.error ?? "RVC container not found on ports 5050–5059" }
        return { ready: true }
      } catch (e: unknown) {
        return { ready: false, reason: e instanceof Error ? e.message : "RVC health check failed" }
      }
    }

    return { ready: true }
  }

  // ── Backward compat (used by playBrowser/playBlob calls that still exist) ──

  playBrowser(
    text: string,
    opts: { volume: number; rate: number; pitch: number; voiceURI?: string },
    source: PlaybackSource = "auto-speak",
  ): Promise<void> {
    this.stop()
    return this.playBrowserInternal(text, opts.volume, opts.rate, opts.pitch, opts.voiceURI, source)
  }

  playBlob(blob: Blob, volume: number, provider: "azure" | "rvc", source: PlaybackSource = "auto-speak"): Promise<void> {
    this.stop()
    return this.playBlobInternal(blob, volume, provider, source)
  }

  // ── Internal ────────────────────────────────────────────────────────────

  // kilocode_change: Phase 3.2 — chunked speak path ─────────────────────────
  private async speakChunked(
    text: string,
    config: SpeechConfig,
    source: PlaybackSource,
  ): Promise<SpeechResult> {
    const provider = config.provider
    const abortController = new AbortController()

    // Build a synthesizeFn that synthesizes AND plays each chunk (returns void)
    const vol = config.volume / 100
    const synthesizeFn = async (chunk: string): Promise<void> => {
      let blob: Blob
      if (provider === "azure") {
        blob = await synthesizeAzure(chunk, config, abortController.signal)
      } else if (provider === "rvc") {
        blob = await synthesizeRvc(chunk, config, abortController.signal)
      } else {
        throw new Error(`Chunked mode not supported for provider: ${provider}`)
      }
      await this.playBlobInternal(blob, vol, provider as "azure" | "rvc", source)
    }

    const player = new ChunkedSpeechPlayer(synthesizeFn)
    this.active = { source, provider, abortController, chunkedPlayer: player }

    // kilocode_change: Phase 6.3 — VAD integration for chunked playback
    let vad: VadHandle | null = null
    if (config.vadEnabled) {
      vad = await startVad()
      if (vad) {
        this.attachVadToPlayer(vad, player)
      }
    }

    try {
      await player.speak(text)
      recordProviderSuccess(provider) // kilocode_change: Phase 7.1
      return { provider, usedFallback: false }
    } catch (e: unknown) {
      if (this.isAbortError(e)) {
        return { provider, usedFallback: false, error: "Cancelled" }
      }
      const errMsg = e instanceof Error ? e.message : String(e)
      console.warn(`[Speech] Chunked ${provider} failed: ${errMsg}`)
      recordProviderFailure(provider) // kilocode_change: Phase 7.1
      return this.tryFallbackChain(text, config, source, provider, errMsg)
    } finally {
      if (vad) vad.stop()
      if (this.active?.chunkedPlayer === player) {
        this.active = null
        this.notifyStop()
      }
    }
  }

  // kilocode_change: Phase 6.3 — attach VAD watcher to a ChunkedSpeechPlayer ─
  private attachVadToPlayer(vad: VadHandle, player: ChunkedSpeechPlayer): void {
    const VAD_THRESHOLD = 0.01 // RMS energy threshold for "user is speaking"
    const CHECK_INTERVAL_MS = 150

    let paused = false
    const intervalId = setInterval(() => {
      // Stop polling if the player is no longer the active one
      if (!this.active || this.active.chunkedPlayer !== player) {
        clearInterval(intervalId)
        return
      }

      const rms = getMicRms(vad.analyser)
      if (rms > VAD_THRESHOLD && !paused) {
        paused = true
        player.interrupt()
        console.log("[Speech VAD] Mic activity detected — interrupting TTS")
      } else if (rms <= VAD_THRESHOLD && paused) {
        paused = false
        // player resumes naturally when next chunk queued; no explicit resume needed
        console.log("[Speech VAD] Mic quiet — resuming TTS")
      }
    }, CHECK_INTERVAL_MS)
  }

  private async tryFallbackChain(
    text: string,
    config: SpeechConfig,
    source: PlaybackSource,
    failedProvider: SpeechProvider,
    failedReason: string,
  ): Promise<SpeechResult> {
    const chain = getFallbackChain(failedProvider, config)

    for (const fallback of chain) {
      const fbReady = checkReady(fallback, config)
      if (!fbReady.ready) continue

      // kilocode_change: Phase 7.1 — retry with exponential backoff (up to BACKOFF_MAX_ATTEMPTS)
      let lastErr = ""
      for (let attempt = 0; attempt < BACKOFF_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          const delay = backoffDelay(attempt - 1)
          console.log(`[Speech] Retry ${attempt}/${BACKOFF_MAX_ATTEMPTS - 1} for ${fallback} after ${delay.toFixed(0)}ms`)
          await sleep(delay)
        }

        try {
          console.log(`[Speech] Falling back from ${failedProvider} → ${fallback} (attempt ${attempt + 1})`)
          await this.synthesizeAndPlay(text, config, fallback, source)
          recordProviderSuccess(fallback) // kilocode_change: Phase 7.1
          this.notifyError(failedProvider, failedReason, fallback)
          return { provider: fallback, usedFallback: true, fallbackReason: failedReason }
        } catch (e: unknown) {
          if (this.isAbortError(e)) {
            return { provider: fallback, usedFallback: true, error: "Cancelled" }
          }
          lastErr = e instanceof Error ? e.message : String(e)
          console.warn(`[Speech] Fallback ${fallback} attempt ${attempt + 1} failed: ${lastErr}`)
        }
      }

      // All attempts for this fallback exhausted
      recordProviderFailure(fallback) // kilocode_change: Phase 7.1
      console.warn(`[Speech] Fallback ${fallback} exhausted all ${BACKOFF_MAX_ATTEMPTS} attempts`)
    }

    // All providers failed
    const errorMsg = `All speech providers failed. ${failedProvider}: ${failedReason}`
    this.notifyError(failedProvider, errorMsg)
    return { provider: failedProvider, usedFallback: false, error: errorMsg }
  }

  private async synthesizeAndPlay(
    text: string,
    config: SpeechConfig,
    provider: SpeechProvider,
    source: PlaybackSource,
  ): Promise<void> {
    const vol = config.volume / 100
    const abortController = new AbortController()

    // Register active state so stop() can abort in-flight fetches
    this.active = { source, provider, abortController }

    // kilocode_change: Phase 6.3 — VAD for single-shot (non-chunked) path
    let vad: VadHandle | null = null
    if (config.vadEnabled && provider !== "browser") {
      vad = await startVad()
    }

    try {
      switch (provider) {
        case "browser":
          return this.playBrowserInternal(text, vol, config.browser.rate, config.browser.pitch, config.browser.voiceURI, source)

        case "azure": {
          // kilocode_change: Phase 7.3 — check synthesis cache first
          const azureCacheKey = { text, voiceId: config.azure.voiceId, provider: "azure" as const }
          const cachedBlob = SynthesisCache.get(azureCacheKey)
          let blob: Blob
          if (cachedBlob) {
            console.log("[Speech] Cache hit for Azure synthesis")
            blob = cachedBlob
          } else {
            blob = await synthesizeAzure(text, config, abortController.signal)
            // kilocode_change: Phase 7.3 — validate with AudioCritic before caching/playing
            const audioBuffer = await blobToAudioBuffer(blob)
            if (audioBuffer) {
              const criticResult = await AudioCritic.analyze(audioBuffer, text.length)
              if (!criticResult.pass) {
                console.warn("[Speech] AudioCritic rejected Azure synthesis:", criticResult.issues)
                throw new Error(`AudioCritic: ${criticResult.issues?.join(", ") ?? "audio quality check failed"}`)
              }
            }
            SynthesisCache.set(azureCacheKey, blob)
          }
          if (abortController.signal.aborted) return
          if (vad) {
            return this.playBlobWithVad(blob, vol, "azure", source, vad)
          }
          return this.playBlobInternal(blob, vol, "azure", source)
        }

        case "rvc": {
          // kilocode_change: Phase 7.3 — check synthesis cache first
          const rvcCacheKey = { text, voiceId: config.rvc.voiceId, provider: "rvc" as const }
          const cachedBlob = SynthesisCache.get(rvcCacheKey)
          let blob: Blob
          if (cachedBlob) {
            console.log("[Speech] Cache hit for RVC synthesis")
            blob = cachedBlob
          } else {
            blob = await synthesizeRvc(text, config, abortController.signal)
            // kilocode_change: Phase 7.3 — validate with AudioCritic before caching/playing
            const audioBuffer = await blobToAudioBuffer(blob)
            if (audioBuffer) {
              const criticResult = await AudioCritic.analyze(audioBuffer, text.length)
              if (!criticResult.pass) {
                console.warn("[Speech] AudioCritic rejected RVC synthesis:", criticResult.issues)
                throw new Error(`AudioCritic: ${criticResult.issues?.join(", ") ?? "audio quality check failed"}`)
              }
            }
            SynthesisCache.set(rvcCacheKey, blob)
          }
          if (abortController.signal.aborted) return
          if (vad) {
            return this.playBlobWithVad(blob, vol, "rvc", source, vad)
          }
          return this.playBlobInternal(blob, vol, "rvc", source)
        }
      }
    } finally {
      if (vad) vad.stop()
    }
  }

  // kilocode_change: Phase 6.3 — blob playback with VAD pause/resume ──────────
  private playBlobWithVad(
    blob: Blob,
    volume: number,
    provider: "azure" | "rvc",
    source: PlaybackSource,
    vad: VadHandle,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const blobUrl = URL.createObjectURL(blob)
      const audio = new Audio(blobUrl)
      audio.volume = volume

      const existing = this.active
      this.active = { source, provider, audio, blobUrl, abortController: existing?.abortController }

      const VAD_THRESHOLD = 0.01
      const CHECK_INTERVAL_MS = 150
      let paused = false

      const intervalId = setInterval(() => {
        if (!this.active || this.active.audio !== audio) {
          clearInterval(intervalId)
          return
        }
        const rms = getMicRms(vad.analyser)
        if (rms > VAD_THRESHOLD && !paused) {
          paused = true
          audio.pause()
          console.log("[Speech VAD] Mic activity — pausing blob playback")
        } else if (rms <= VAD_THRESHOLD && paused) {
          paused = false
          audio.play().catch(() => { /* ignore resume errors */ })
          console.log("[Speech VAD] Mic quiet — resuming blob playback")
        }
      }, CHECK_INTERVAL_MS)

      audio.onended = () => {
        clearInterval(intervalId)
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        resolve()
      }
      audio.onerror = (e) => {
        clearInterval(intervalId)
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        reject(e)
      }

      audio.play().catch((e) => {
        clearInterval(intervalId)
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        reject(e)
      })
    })
  }

  private playBrowserInternal(
    text: string,
    volume: number,
    rate: number,
    pitch: number,
    voiceURI: string | undefined,
    source: PlaybackSource,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.volume = volume
      utterance.rate = rate
      utterance.pitch = pitch
      if (voiceURI) {
        const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
        if (voice) utterance.voice = voice
      }

      this.active = { source, provider: "browser", utterance }

      utterance.onend = () => {
        this.active = null
        this.notifyStop()
        resolve()
      }
      utterance.onerror = (e) => {
        this.active = null
        this.notifyStop()
        reject(e)
      }

      speechSynthesis.speak(utterance)
    })
  }

  private playBlobInternal(blob: Blob, volume: number, provider: "azure" | "rvc", source: PlaybackSource): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const blobUrl = URL.createObjectURL(blob)
      const audio = new Audio(blobUrl)
      audio.volume = volume

      // Preserve abort controller from synthesis phase if present
      const existing = this.active
      this.active = { source, provider, audio, blobUrl, abortController: existing?.abortController }

      audio.onended = () => {
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        resolve()
      }
      audio.onerror = (e) => {
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        reject(e)
      }

      audio.play().catch((e) => {
        URL.revokeObjectURL(blobUrl)
        this.active = null
        this.notifyStop()
        reject(e)
      })
    })
  }

  private isAbortError(e: unknown): boolean {
    if (e instanceof DOMException && e.name === "AbortError") return true
    if (e instanceof Error && e.message.includes("abort")) return true
    return false
  }

  private notifyError(provider: SpeechProvider, error: string, fallbackUsed?: SpeechProvider) {
    for (const cb of this.onErrorCallbacks) {
      try { cb(provider, error, fallbackUsed) } catch { /* swallow */ }
    }
  }

  private notifyStop() {
    for (const cb of this.onStopCallbacks) {
      try { cb() } catch { /* swallow */ }
    }
  }
}

/** Global singleton — imported by App.tsx, SpeechTab.tsx, etc. */
export const speechPlayback = new SpeechEngine()

// kilocode_change: RVC message bridge — set by SpeechTab on mount so synthesizeRvc
// can route through KiloProvider (always active) instead of direct localhost fetch
// (blocked by CORS in VS Code webviews) or the VoiceStudioProvider proxy (only
// starts when the Voice Studio panel is opened).
type RvcBridgeFn = (msg: Record<string, unknown>) => Promise<unknown>
let _rvcBridge: RvcBridgeFn | undefined

export function setRvcBridge(fn: RvcBridgeFn): void {
  _rvcBridge = fn
}

export function getRvcBridge(): RvcBridgeFn | undefined {
  return _rvcBridge
}
