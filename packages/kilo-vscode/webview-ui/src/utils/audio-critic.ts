// kilocode_change — Phase 7.3: AudioCritic — 5-check audio quality validation
// Uses Web Audio API AnalyserNode — no ML, real-time, all checks in single pass

/**
 * AudioCritic — validates synthesized audio blobs for quality before playback.
 *
 * All 5 checks run in a single AnalyserNode pass (<50ms on typical hardware):
 *   1. RMS Energy      — silence / low-volume detection
 *   2. Peak Amplitude  — clipping / distortion detection
 *   3. Zero-Crossing   — static / white-noise detection
 *   4. Duration        — truncated audio detection (≈100ms per 10 chars)
 *   5. Spectral Flatness — noise vs speech tonal content
 *
 * Scoring: each passing check contributes 20 points (5 × 20 = 100 max).
 * `pass` is true when score >= 60 (3 of 5 checks pass).
 */

// ── Result type ───────────────────────────────────────────────────────────────

export interface AudioCriticResult {
  /** Overall pass/fail — true when score >= 60 */
  pass: boolean
  /** 0-100 quality score (20 points per passing check) */
  score: number
  /** Human-readable descriptions of any failed checks */
  issues: string[]
}

// ── AudioCritic ───────────────────────────────────────────────────────────────

export class AudioCritic {
  /**
   * Analyze an AudioBuffer against all 5 quality checks.
   *
   * Creates a single offline AudioContext + AnalyserNode to gather both
   * time-domain and frequency-domain data in one decode pass.
   *
   * @param audioBuffer        Decoded audio data (from AudioContext.decodeAudioData)
   * @param expectedTextLength Number of characters in the original TTS input text
   */
  static async analyze(audioBuffer: AudioBuffer, expectedTextLength: number): Promise<AudioCriticResult> {
    // kilocode_change — single OfflineAudioContext pass for all checks
    const sampleRate = audioBuffer.sampleRate
    const length = audioBuffer.length

    // Build an OfflineAudioContext to run the analyser node
    const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      length,
      sampleRate,
    )

    const source = offlineCtx.createBufferSource()
    source.buffer = audioBuffer

    const analyser = offlineCtx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0

    source.connect(analyser)
    analyser.connect(offlineCtx.destination)
    source.start(0)

    // Render the full buffer through the analyser
    await offlineCtx.startRendering()

    // ── Gather time-domain data (byte, 0-255, centre=128) ──────────────────
    const timeDomainData = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(timeDomainData)

    // ── Run checks 1-4 using time-domain data ──────────────────────────────
    const rmsCheck  = AudioCritic.checkRmsEnergy(timeDomainData)
    const peakCheck = AudioCritic.checkPeakAmplitude(timeDomainData)
    const zcrCheck  = AudioCritic.checkZeroCrossingRate(timeDomainData)
    const durCheck  = AudioCritic.checkDuration(audioBuffer, expectedTextLength)

    // ── Check 5: spectral flatness requires frequency-domain data ──────────
    const specCheck = AudioCritic.checkSpectralFlatness(analyser)

    // ── Aggregate results ──────────────────────────────────────────────────
    const checks = [rmsCheck, peakCheck, zcrCheck, durCheck, specCheck]
    const issues: string[] = []
    let score = 0

    for (const check of checks) {
      if (check.pass) {
        score += 20
      } else if (check.issue) {
        issues.push(check.issue)
      }
    }

    return {
      pass: score >= 60,
      score,
      issues,
    }
  }

  // ── Check 1: RMS Energy ───────────────────────────────────────────────────

  /**
   * Detect silence or near-silence by computing the RMS of the time-domain signal.
   *
   * AnalyserNode byte domain: samples are in [0, 255] centred at 128.
   * Normalise: v = (sample - 128) / 128  ∈ [-1, 1]
   * RMS < 0.01 (1% of full scale) → silence.
   */
  private static checkRmsEnergy(data: Uint8Array): { pass: boolean; issue?: string } {
    // kilocode_change — RMS energy check; byte domain, centre = 128
    let sumSq = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / data.length)

    if (rms < 0.01) {
      return { pass: false, issue: `Audio is silent or near-silent (RMS=${rms.toFixed(4)})` }
    }
    return { pass: true }
  }

  // ── Check 2: Peak Amplitude ───────────────────────────────────────────────

  /**
   * Detect clipping/distortion by looking for samples at or near the byte
   * domain extremes (0 or 255 correspond to normalised ±1.0).
   *
   * Threshold: if more than 0.5% of samples clip → distortion warning.
   */
  private static checkPeakAmplitude(data: Uint8Array): { pass: boolean; issue?: string } {
    // kilocode_change — clipping check; byte values 0 and 255 = ±1.0 normalised
    const CLIP_LOW  = 2    // ≤ 2/128 ≈ -0.984 (near -1.0)
    const CLIP_HIGH = 253  // ≥ 253/128 ≈ +0.977 (near +1.0)
    const CLIP_THRESHOLD = 0.005  // 0.5% of samples

    let clipCount = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] <= CLIP_LOW || data[i] >= CLIP_HIGH) clipCount++
    }

    const clipRatio = clipCount / data.length
    if (clipRatio > CLIP_THRESHOLD) {
      return {
        pass: false,
        issue: `Audio clipping detected (${(clipRatio * 100).toFixed(2)}% of samples at peak)`,
      }
    }
    return { pass: true }
  }

  // ── Check 3: Zero-Crossing Rate ────────────────────────────────────────────

  /**
   * Detect broadband noise / static by counting sign changes.
   *
   * A clean speech signal has a ZCR of ~3,000-10,000 crossings/second.
   * White noise is near Nyquist: ZCR ≈ sampleRate / 2.
   *
   * We use a conservative threshold: ZCR > 40% of the maximum possible rate
   * (normalised to the analyser buffer length) signals pathological noise.
   */
  private static checkZeroCrossingRate(data: Uint8Array): { pass: boolean; issue?: string } {
    // kilocode_change — zero-crossing rate check for static/noise detection
    let crossings = 0
    for (let i = 1; i < data.length; i++) {
      // Centre at 128; sign change when one side is above and the other below
      const prev = data[i - 1] - 128
      const curr = data[i] - 128
      if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
        crossings++
      }
    }

    // Normalise: maximum possible crossings ≈ data.length - 1 (alternating +/-1)
    const zcrRatio = crossings / (data.length - 1)

    if (zcrRatio > 0.4) {
      return {
        pass: false,
        issue: `High zero-crossing rate detected (${(zcrRatio * 100).toFixed(1)}%) — possible noise or static`,
      }
    }
    return { pass: true }
  }

  // ── Check 4: Duration ─────────────────────────────────────────────────────

  /**
   * Detect truncated audio by comparing actual duration with an estimate.
   *
   * Heuristic: average TTS speed ≈ 130 words/min ≈ 5 chars/word → 26 chars/sec
   * → 1 char ≈ 38ms.  We use 100ms per 10 chars (10ms/char) as a generous lower bound
   * to avoid false positives on fast voices.
   *
   * If actual duration is less than 30% of the expected minimum → truncated.
   */
  private static checkDuration(
    buffer: AudioBuffer,
    expectedTextLength: number,
  ): { pass: boolean; issue?: string } {
    // kilocode_change — duration check; 100ms per 10 chars (per spec)
    const actualDurationMs = (buffer.length / buffer.sampleRate) * 1000
    const expectedMinMs    = (expectedTextLength / 10) * 100  // 100ms per 10 chars

    // For very short texts (< 10 chars) skip this check — the estimate is unreliable
    if (expectedTextLength < 10) return { pass: true }

    const ratio = actualDurationMs / expectedMinMs
    if (ratio < 0.3) {
      return {
        pass: false,
        issue: `Audio likely truncated — expected ~${expectedMinMs.toFixed(0)}ms, got ${actualDurationMs.toFixed(0)}ms`,
      }
    }
    return { pass: true }
  }

  // ── Check 5: Spectral Flatness ────────────────────────────────────────────

  /**
   * Detect noise vs speech using spectral flatness (Wiener entropy).
   *
   * Formula: flatness = geometric_mean(power) / arithmetic_mean(power)
   *   → 0 = pure tone (speech-like), 1 = white noise
   *
   * We use frequency-domain magnitude from getFloatFrequencyData() (dB scale).
   * Convert dB → linear power: p = 10^(dB/10)
   * Flatness > 0.85 → noise dominates.
   *
   * getFloatFrequencyData() fills the buffer with the current frame;
   * after startRendering() the analyser holds the last rendered frame.
   */
  private static checkSpectralFlatness(analyser: AnalyserNode): { pass: boolean; issue?: string } {
    // kilocode_change — spectral flatness check; high flatness = noise
    const freqData = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(freqData)

    // Convert dB to linear power, ignore -Infinity bins (silence in bin)
    const powers: number[] = []
    for (let i = 0; i < freqData.length; i++) {
      const db = freqData[i]
      if (isFinite(db) && db > -140) {
        powers.push(Math.pow(10, db / 10))
      }
    }

    if (powers.length < 4) {
      // Not enough spectral data — treat as passing (very short buffer edge case)
      return { pass: true }
    }

    // Arithmetic mean
    const arithmeticMean = powers.reduce((a, b) => a + b, 0) / powers.length

    // Geometric mean via log-sum trick to avoid underflow
    const logSum = powers.reduce((acc, p) => acc + Math.log(p), 0)
    const geometricMean = Math.exp(logSum / powers.length)

    const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0

    if (flatness > 0.85) {
      return {
        pass: false,
        issue: `Spectral flatness too high (${flatness.toFixed(3)}) — audio resembles noise rather than speech`,
      }
    }
    return { pass: true }
  }
}

// ── SynthesisCache ────────────────────────────────────────────────────────────

// kilocode_change — Phase 7.3: Skyvern LRU pattern for synthesis blob caching
// Same text + same voice + same provider → serve from cache, skip network round-trip

interface CacheKey {
  text: string
  voiceId: string
  provider: string
}

interface CacheEntry {
  blob: Blob
  lastUsed: number
}

/**
 * LRU cache for synthesized audio blobs.
 *
 * Capacity: 32 entries (MAX_SIZE).
 * Eviction: when at capacity, evicts the entry with the smallest `lastUsed` timestamp.
 * Thread-safety: all operations are synchronous — no race conditions in a
 * single-threaded JS environment.
 *
 * kilocode_change — Skyvern LRU pattern: same text + voice + provider = cache hit
 */
export class SynthesisCache {
  private static readonly MAX_SIZE = 32
  // Map key → entry; Map preserves insertion order for O(n) LRU eviction
  private static cache = new Map<string, CacheEntry>()

  /**
   * Produce a stable string key from a CacheKey triple.
   * Uses a simple djb2-style hash on the concatenated key parts.
   */
  static hash(key: CacheKey): string {
    // kilocode_change — simple deterministic hash; no crypto dependency needed
    const raw = `${key.provider}:${key.voiceId}:${key.text}`
    let h = 5381
    for (let i = 0; i < raw.length; i++) {
      // djb2: h = h * 33 ^ char
      h = ((h << 5) + h) ^ raw.charCodeAt(i)
      h = h >>> 0  // keep unsigned 32-bit
    }
    // Prefix with a short text fingerprint so collisions stay distinguishable in logs
    const prefix = raw.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "_")
    return `${prefix}_${h.toString(16)}`
  }

  /**
   * Look up a cached blob.  Updates `lastUsed` on cache hit (LRU touch).
   * Returns `undefined` on miss.
   */
  static get(key: CacheKey): Blob | undefined {
    const k = SynthesisCache.hash(key)
    const entry = SynthesisCache.cache.get(k)
    if (!entry) return undefined

    // Touch — update recency
    entry.lastUsed = Date.now()
    return entry.blob
  }

  /**
   * Store a synthesized blob.  Evicts the LRU entry if at MAX_SIZE.
   * kilocode_change — eviction by min lastUsed timestamp
   */
  static set(key: CacheKey, blob: Blob): void {
    const k = SynthesisCache.hash(key)

    // If key already exists, just update it (no size change)
    if (SynthesisCache.cache.has(k)) {
      SynthesisCache.cache.set(k, { blob, lastUsed: Date.now() })
      return
    }

    // Evict LRU entry when at capacity
    if (SynthesisCache.cache.size >= SynthesisCache.MAX_SIZE) {
      let lruKey: string | undefined
      let lruTime = Infinity

      for (const [entryKey, entryVal] of SynthesisCache.cache.entries()) {
        if (entryVal.lastUsed < lruTime) {
          lruTime = entryVal.lastUsed
          lruKey  = entryKey
        }
      }

      if (lruKey !== undefined) {
        SynthesisCache.cache.delete(lruKey)
      }
    }

    SynthesisCache.cache.set(k, { blob, lastUsed: Date.now() })
  }

  /** Purge the entire cache (e.g., on voice change or settings reset). */
  static clear(): void {
    SynthesisCache.cache.clear()
  }
}
