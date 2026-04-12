// kilocode_change — Phase 7.6: MAESTRO-Inspired Preference Adaptation
// Tracks user voice behavior patterns and surfaces recommendations.
//
// Pattern recognition:
//   - Voices previewed then immediately selected → high confidence recommendation
//   - Voices consistently skipped → suppressed from recommendations
//   - Pitch/rate repeatedly adjusted by same delta → suggest as new default
//   - "isLearning" gate: require minimum event volume before surfacing anything

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UserBehaviorEvent {
  type:
    | "preview_played"
    | "preview_skipped"
    | "voice_selected"
    | "voice_switched"
    | "pitch_adjusted"
    | "rate_adjusted"
  voiceId: string
  timestamp: number
  metadata?: {
    fromVoiceId?: string
    pitchDelta?: number
    rateDelta?: number
    sessionDurationMs?: number
  }
}

export interface VoiceRecommendation {
  voiceId: string
  reason: string
  confidence: number // 0–1
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maximum events kept in the circular buffer. */
const MAX_EVENTS = 200

/**
 * Minimum events before the adapter considers itself to have enough data for
 * meaningful recommendations.  Set deliberately low so early adopters still
 * get value after a light session.
 */
const LEARNING_THRESHOLD = 10

/**
 * Window (ms) within which a "preview_played" followed by "voice_selected"
 * counts as a "preview-then-select" positive signal.  Two minutes is generous
 * enough for someone who listens to the clip, thinks about it, then clicks.
 */
const PREVIEW_TO_SELECT_WINDOW_MS = 2 * 60 * 1000

/**
 * Number of consistent pitch/rate adjustments required before we suggest
 * that delta as a new default.
 */
const OVERRIDE_THRESHOLD = 3

/**
 * Tolerance when grouping "similar" pitch/rate adjustments.  An adjustment of
 * ±0.05 around a reference value is considered the same adjustment.
 */
const ADJUSTMENT_TOLERANCE = 0.05

// ---------------------------------------------------------------------------
// PreferenceAdapter
// ---------------------------------------------------------------------------

export class PreferenceAdapter {
  private events: UserBehaviorEvent[] = []

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Record a user behavior event.  Maintains a circular buffer of the last
   * MAX_EVENTS entries to bound memory usage.
   */
  record(event: UserBehaviorEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) {
      // Trim from the front — oldest events discarded first
      this.events = this.events.slice(this.events.length - MAX_EVENTS)
    }
  }

  // ── Recommendations ───────────────────────────────────────────────────────

  /**
   * Return up to `topN` (default 5) personalized voice recommendations based
   * on recorded behavior, restricted to voices in `installedVoices`.
   *
   * Scoring heuristics (accumulated per voice, then normalized to [0, 1]):
   *   +0.9  — previewed then selected within PREVIEW_TO_SELECT_WINDOW_MS
   *   +0.6  — selected (without a preceding recent preview)
   *   +0.4  — preview played (shows interest but not commitment)
   *   -0.5  — preview skipped (negative signal)
   *   +0.2  — voice_switched *to* this voice (mild positive)
   *   -0.2  — voice_switched *from* this voice (mild negative)
   *
   * Voices with a final score ≤ 0 are omitted.
   */
  getRecommendations(installedVoices: string[], topN: number = 5): VoiceRecommendation[] {
    if (!this.isLearning()) return []

    const installed = new Set(installedVoices)
    const scores = new Map<string, number>()

    // Helper — only accumulate for voices that are installed
    const add = (voiceId: string, delta: number) => {
      if (!installed.has(voiceId)) return
      scores.set(voiceId, (scores.get(voiceId) ?? 0) + delta)
    }

    for (let i = 0; i < this.events.length; i++) {
      const evt = this.events[i]

      switch (evt.type) {
        case "preview_played": {
          // Look ahead for a voice_selected on the same voice within the window
          const selectedSoon = this.events
            .slice(i + 1)
            .find(
              (e) =>
                e.type === "voice_selected" &&
                e.voiceId === evt.voiceId &&
                e.timestamp - evt.timestamp <= PREVIEW_TO_SELECT_WINDOW_MS,
            )
          add(evt.voiceId, selectedSoon ? 0.9 : 0.4)
          break
        }

        case "preview_skipped":
          add(evt.voiceId, -0.5)
          break

        case "voice_selected": {
          // Only count the raw selection if there was no recent preview (avoids
          // double-counting the preview_played → voice_selected case above)
          const hadRecentPreview = this.events
            .slice(0, i)
            .reverse()
            .find(
              (e) =>
                e.type === "preview_played" &&
                e.voiceId === evt.voiceId &&
                evt.timestamp - e.timestamp <= PREVIEW_TO_SELECT_WINDOW_MS,
            )
          if (!hadRecentPreview) add(evt.voiceId, 0.6)
          break
        }

        case "voice_switched":
          // Switched *to* this voice — mild positive
          add(evt.voiceId, 0.2)
          // Switched *from* the previous voice — mild negative for that voice
          if (evt.metadata?.fromVoiceId) {
            add(evt.metadata.fromVoiceId, -0.2)
          }
          break

        // pitch_adjusted / rate_adjusted do not influence per-voice scores
        default:
          break
      }
    }

    // Convert raw scores to recommendations, dropping non-positives
    const recommendations: VoiceRecommendation[] = []

    // Determine max score for normalization
    let maxScore = 0
    for (const s of scores.values()) {
      if (s > maxScore) maxScore = s
    }
    if (maxScore === 0) return []

    for (const [voiceId, rawScore] of scores.entries()) {
      if (rawScore <= 0) continue
      const confidence = Math.min(rawScore / maxScore, 1)
      const reason = this.buildReason(voiceId, rawScore)
      recommendations.push({ voiceId, reason, confidence })
    }

    // Sort by confidence descending, then alphabetically for determinism
    recommendations.sort((a, b) => {
      const diff = b.confidence - a.confidence
      if (Math.abs(diff) > 0.001) return diff
      return a.voiceId.localeCompare(b.voiceId)
    })

    return recommendations.slice(0, topN)
  }

  /**
   * Detect whether the user consistently applies the same pitch or rate
   * adjustment.  If OVERRIDE_THRESHOLD or more adjustments cluster around the
   * same delta value (within ADJUSTMENT_TOLERANCE), the median of those
   * deltas is suggested as the new default.
   *
   * Returns `null` when no pattern is detected.
   */
  detectDefaultOverride(): { pitch?: number; rate?: number } | null {
    const pitchDeltas: number[] = []
    const rateDeltas: number[] = []

    for (const evt of this.events) {
      if (evt.type === "pitch_adjusted" && typeof evt.metadata?.pitchDelta === "number") {
        pitchDeltas.push(evt.metadata.pitchDelta)
      }
      if (evt.type === "rate_adjusted" && typeof evt.metadata?.rateDelta === "number") {
        rateDeltas.push(evt.metadata.rateDelta)
      }
    }

    const result: { pitch?: number; rate?: number } = {}

    const dominant = (deltas: number[]): number | undefined => {
      if (deltas.length < OVERRIDE_THRESHOLD) return undefined

      // Group by proximity — use the first delta seen as a cluster seed,
      // then absorb nearby deltas into the same cluster.
      const clusters: number[][] = []
      for (const d of deltas) {
        const existing = clusters.find((c) => Math.abs(c[0] - d) <= ADJUSTMENT_TOLERANCE)
        if (existing) {
          existing.push(d)
        } else {
          clusters.push([d])
        }
      }

      // Find the largest cluster that meets the threshold
      const largest = clusters.reduce((best, c) => (c.length > best.length ? c : best), [] as number[])
      if (largest.length < OVERRIDE_THRESHOLD) return undefined

      // Return the median of the cluster as the suggested default
      const sorted = [...largest].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    const pitchSuggestion = dominant(pitchDeltas)
    const rateSuggestion = dominant(rateDeltas)

    if (pitchSuggestion !== undefined) result.pitch = pitchSuggestion
    if (rateSuggestion !== undefined) result.rate = rateSuggestion

    return Object.keys(result).length > 0 ? result : null
  }

  /**
   * Returns `true` once enough events have been recorded to generate
   * meaningful adaptations.  Callers can use this to decide whether to show
   * a "learning mode" indicator in the UI.
   */
  isLearning(): boolean {
    return this.events.length >= LEARNING_THRESHOLD
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Serialize the event history for storage in VSCode globalState. */
  export(): UserBehaviorEvent[] {
    return [...this.events]
  }

  /** Reconstruct a PreferenceAdapter from a previously exported event list. */
  static fromEvents(events: UserBehaviorEvent[]): PreferenceAdapter {
    const adapter = new PreferenceAdapter()
    // Respect the circular buffer limit on import
    adapter.events = events.slice(-MAX_EVENTS)
    return adapter
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildReason(voiceId: string, rawScore: number): string {
    // Count how many times the voice was directly selected
    const selections = this.events.filter(
      (e) => e.type === "voice_selected" && e.voiceId === voiceId,
    ).length

    const previews = this.events.filter(
      (e) => e.type === "preview_played" && e.voiceId === voiceId,
    ).length

    if (selections >= 3) return `You've selected this voice ${selections} times`
    if (rawScore >= 0.8) return "You previewed and immediately selected this voice"
    if (previews >= 2) return `You've previewed this voice ${previews} times`
    return "Based on your listening history"
  }
}
