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
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type SpeechProvider = "browser" | "azure" | "rvc"
export type PlaybackSource = "preview" | "auto-speak" | "voice-studio"

export interface SpeechConfig {
  provider: SpeechProvider
  volume: number // 0-100
  rvc: { voiceId: string; dockerPort: number; edgeVoice: string; pitchShift: number }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
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
}

type ErrorCallback = (provider: SpeechProvider, error: string, fallbackUsed?: SpeechProvider) => void
type StopCallback = () => void

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

/** Get the fallback chain for a given provider */
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

async function synthesizeRvc(
  text: string,
  config: SpeechConfig,
  signal?: AbortSignal,
): Promise<Blob> {
  // Pre-flight health check
  try {
    const health = await fetch(`http://localhost:${config.rvc.dockerPort}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!health.ok) throw new Error("RVC container health check failed")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("abort")) throw e
    throw new Error(`RVC Docker container not reachable on port ${config.rvc.dockerPort} — is it running?`)
  }

  const resp = await fetch(`http://localhost:${config.rvc.dockerPort}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice_id: config.rvc.voiceId,
      edge_voice: config.rvc.edgeVoice || "en-US-AriaNeural",
      pitch_shift: config.rvc.pitchShift || 0,
    }),
    signal,
  })
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`Voice model '${config.rvc.voiceId}' not found in container`)
    throw new Error(`RVC synthesis returned HTTP ${resp.status}`)
  }
  const blob = await resp.blob()
  if (blob.size < 100) throw new Error("RVC returned empty audio")
  return blob
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
   */
  async speak(text: string, config: SpeechConfig, source: PlaybackSource = "auto-speak"): Promise<SpeechResult> {
    // Stop any active playback first
    this.stop()

    const primary = config.provider
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
      try {
        const resp = await fetch(`http://localhost:${config.rvc.dockerPort}/health`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!resp.ok) return { ready: false, reason: "RVC container returned unhealthy status" }
        return { ready: true }
      } catch {
        return { ready: false, reason: `RVC container not reachable on port ${config.rvc.dockerPort}` }
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

      try {
        console.log(`[Speech] Falling back from ${failedProvider} → ${fallback}`)
        await this.synthesizeAndPlay(text, config, fallback, source)
        this.notifyError(failedProvider, failedReason, fallback)
        return { provider: fallback, usedFallback: true, fallbackReason: failedReason }
      } catch (e: unknown) {
        if (this.isAbortError(e)) {
          return { provider: fallback, usedFallback: true, error: "Cancelled" }
        }
        const errMsg = e instanceof Error ? e.message : String(e)
        console.warn(`[Speech] Fallback ${fallback} also failed: ${errMsg}`)
        continue
      }
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

    switch (provider) {
      case "browser":
        return this.playBrowserInternal(text, vol, config.browser.rate, config.browser.pitch, config.browser.voiceURI, source)

      case "azure": {
        const blob = await synthesizeAzure(text, config, abortController.signal)
        // Check we haven't been stopped during the fetch
        if (abortController.signal.aborted) return
        return this.playBlobInternal(blob, vol, "azure", source)
      }

      case "rvc": {
        const blob = await synthesizeRvc(text, config, abortController.signal)
        if (abortController.signal.aborted) return
        return this.playBlobInternal(blob, vol, "rvc", source)
      }
    }
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
