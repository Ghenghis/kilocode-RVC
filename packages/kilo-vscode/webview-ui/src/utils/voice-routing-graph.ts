// kilocode_change — Phase 7.5: Graph-Based Voice Routing
// Lightweight TypeScript state machine for voice selection
// Sub-ms routing, zero dependencies

/**
 * VoiceRoutingGraph — a static state machine that routes through the graph:
 *
 *   [Agent Context] → [Sentiment Analysis] → [Time-of-Day Check]
 *         ↓                    ↓                      ↓
 *   [Agent Voice Map]   [Mood Modifier]      [Time Preference]
 *         ↓                    ↓                      ↓
 *         └──────────→ [Voice Selection] ←────────────┘
 *                              ↓
 *                       [Provider Check]
 *                              ↓
 *                       [Synthesis + Critic]
 *
 * Session state persists across calls via the module-level `graphState` map.
 * All routing is synchronous — zero async dependencies, sub-millisecond.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceRoutingInput {
  /** Name of the agent driving this utterance (e.g. "coder", "reviewer") */
  agentName: string
  /** The message text to be spoken (used for sentiment analysis) */
  messageText: string
  /** Current hour in local time (0–23) */
  hour: number
  /** Agent → voice config map populated from Voice Studio settings */
  agentVoiceMap: Record<string, { voiceId: string; provider: string }>
  /** Optional per-time-period voice overrides */
  timePreferences: { morning?: string; afternoon?: string; evening?: string }
  /** Provider health status — true means healthy/reachable */
  providerHealth: Record<string, boolean>
  /** 0–100: how strongly sentiment should modify pitch/rate */
  sentimentIntensity: number
}

export interface VoiceRoutingResult {
  /** The resolved voice identifier */
  voiceId: string
  /** The provider that should synthesize this voice */
  provider: string
  /** Semitone pitch modifier (signed float) */
  pitch: number
  /** Speed multiplier (e.g. 1.05 = 5 % faster) */
  rate: number
  /** Human-readable explanation of routing decisions made */
  reason: string
}

// ── Module-level session state ────────────────────────────────────────────────

/**
 * Persists the last routing result per session ID across calls.
 * Key: session ID string.  Value: last VoiceRoutingResult.
 *
 * Callers may pass a stable session ID (e.g. chat-window UUID) to get
 * continuity-aware routing (future: avoid switching voice mid-sentence).
 */
export const graphState = new Map<string, VoiceRoutingResult>()

// ── Default constants ─────────────────────────────────────────────────────────

/** Voice used when no agent mapping exists and no time preference matches */
const DEFAULT_VOICE_ID = "en-US-AriaNeural"
const DEFAULT_PROVIDER = "browser"

// ── Main routing class ────────────────────────────────────────────────────────

export class VoiceRoutingGraph {
  // ── Public static API ───────────────────────────────────────────────────────

  /**
   * Route through the full graph and return the final voice configuration.
   *
   * Graph traversal order:
   *   1. Agent Context node  — look up agent in agentVoiceMap
   *   2. Time-of-Day node    — optionally override voice via timePreferences
   *   3. Sentiment node      — analyse messageText, compute pitch/rate modifier
   *   4. Voice Selection     — merge all decisions, pick final voiceId + provider
   *   5. Provider Check      — verify provider health, re-route if unhealthy
   */
  static route(input: VoiceRoutingInput): VoiceRoutingResult {
    const reasons: string[] = []

    // ── Node 1: Agent Context ──────────────────────────────────────────────
    const agentEntry = input.agentVoiceMap[input.agentName] ?? null
    let voiceId: string
    let provider: string

    if (agentEntry) {
      voiceId = agentEntry.voiceId
      provider = agentEntry.provider
      reasons.push(`agent "${input.agentName}" → voice "${voiceId}" (${provider})`)
    } else {
      voiceId = DEFAULT_VOICE_ID
      provider = DEFAULT_PROVIDER
      reasons.push(`no agent mapping for "${input.agentName}", using default voice`)
    }

    // ── Node 2: Time-of-Day Check ──────────────────────────────────────────
    const period = VoiceRoutingGraph.timePeriod(input.hour)
    const timeVoice = input.timePreferences[period]
    if (timeVoice) {
      voiceId = timeVoice
      reasons.push(`time preference for ${period} overrides to voice "${timeVoice}"`)
    } else {
      reasons.push(`no time preference for ${period}`)
    }

    // ── Node 3: Sentiment Analysis ─────────────────────────────────────────
    const sentiment = VoiceRoutingGraph.analyzeSentiment(input.messageText)
    const modifier = VoiceRoutingGraph.sentimentModifier(sentiment, input.sentimentIntensity)
    reasons.push(
      `sentiment: ${sentiment} (intensity ${input.sentimentIntensity}) → pitch ${modifier.pitch >= 0 ? "+" : ""}${modifier.pitch.toFixed(2)}, rate ×${modifier.rate.toFixed(3)}`,
    )

    // ── Node 4: Voice Selection — compose result ───────────────────────────
    const preliminary: VoiceRoutingResult = {
      voiceId,
      provider,
      pitch: modifier.pitch,
      rate: modifier.rate,
      reason: reasons.join("; "),
    }

    // ── Node 5: Provider Check — conditional edge ──────────────────────────
    return VoiceRoutingGraph.withFallback(preliminary, input)
  }

  /**
   * Conditional edge: if the selected provider is marked unhealthy in
   * `input.providerHealth`, find the first healthy provider as fallback.
   *
   * Fallback priority: rvc → azure → browser
   * Browser is assumed always healthy if not explicitly marked false.
   */
  static withFallback(result: VoiceRoutingResult, input: VoiceRoutingInput): VoiceRoutingResult {
    const isHealthy = (p: string): boolean => {
      // If health is not tracked for a provider, assume healthy
      if (!(p in input.providerHealth)) return true
      return input.providerHealth[p] === true
    }

    if (isHealthy(result.provider)) {
      return result
    }

    // Provider is unhealthy — find a fallback
    const fallbackPriority = ["rvc", "azure", "browser"]
    for (const candidate of fallbackPriority) {
      if (candidate !== result.provider && isHealthy(candidate)) {
        // Find a voice for this fallback provider from the agent map
        const agentEntry = input.agentVoiceMap[input.agentName]
        let fallbackVoice = result.voiceId
        if (agentEntry && agentEntry.provider === candidate) {
          fallbackVoice = agentEntry.voiceId
        }

        return {
          ...result,
          provider: candidate,
          voiceId: fallbackVoice,
          reason:
            result.reason +
            `; provider "${result.provider}" unhealthy → fell back to "${candidate}"`,
        }
      }
    }

    // All providers unhealthy — return as-is with a warning appended
    return {
      ...result,
      reason:
        result.reason +
        "; WARNING: all providers reported unhealthy, proceeding with original selection",
    }
  }

  /**
   * Keyword-based sentiment analysis — no ML, no network calls.
   *
   * Positive keywords outweigh negative by more than one → "positive"
   * Negative keywords outweigh positive by more than one → "negative"
   * Otherwise → "neutral"
   *
   * Reuses the same word lists as speech-text-filter.ts for consistency.
   */
  static analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
    const lower = text.toLowerCase()

    const positiveWords = [
      "success",
      "complete",
      "completed",
      "done",
      "fixed",
      "working",
      "works",
      "passed",
      "resolved",
      "perfect",
      "excellent",
      "great",
      "good",
      "created",
      "built",
      "finished",
      "ready",
      "approved",
      "merged",
      "deployed",
      "launched",
      "clean",
      "optimized",
      "improved",
    ]

    const negativeWords = [
      "error",
      "failed",
      "failure",
      "crash",
      "bug",
      "broken",
      "issue",
      "problem",
      "exception",
      "timeout",
      "denied",
      "rejected",
      "invalid",
      "missing",
      "cannot",
      "unable",
      "fatal",
      "critical",
      "warning",
      "blocked",
      "conflict",
      "corrupt",
      "leak",
    ]

    let positiveCount = 0
    let negativeCount = 0

    for (const word of positiveWords) {
      if (lower.includes(word)) positiveCount++
    }
    for (const word of negativeWords) {
      if (lower.includes(word)) negativeCount++
    }

    if (positiveCount > negativeCount + 1) return "positive"
    if (negativeCount > positiveCount + 1) return "negative"
    return "neutral"
  }

  /**
   * Map a 24-hour clock value to a named time period.
   *
   *   morning   —  5:00 – 11:59
   *   afternoon — 12:00 – 17:59
   *   evening   — 18:00 –  4:59 (wraps past midnight)
   */
  static timePeriod(hour: number): "morning" | "afternoon" | "evening" {
    if (hour >= 5 && hour < 12) return "morning"
    if (hour >= 12 && hour < 18) return "afternoon"
    return "evening"
  }

  /**
   * Compute pitch and rate modifiers from sentiment + intensity.
   *
   * Scaling: modifiers are proportional to `intensity / 100` so a sentiment
   * intensity of 50 applies half the maximum shift.
   *
   * Maximums:
   *   positive → +1 semitone pitch,  +0.05× rate  (brighter, slightly faster)
   *   negative → -1 semitone pitch,  -0.05× rate  (darker, slightly slower)
   *   neutral  →  0 semitone pitch,  ±0.00× rate
   */
  static sentimentModifier(
    sentiment: "positive" | "negative" | "neutral",
    intensity: number,
  ): { pitch: number; rate: number } {
    // Clamp intensity to [0, 100]
    const clamped = Math.max(0, Math.min(100, intensity))
    const scale = clamped / 100

    switch (sentiment) {
      case "positive":
        return {
          pitch: +(1 * scale).toFixed(4),
          rate: +(1 + 0.05 * scale).toFixed(4),
        }
      case "negative":
        return {
          pitch: +(-1 * scale).toFixed(4),
          rate: +(1 - 0.05 * scale).toFixed(4),
        }
      case "neutral":
      default:
        return { pitch: 0, rate: 1.0 }
    }
  }
}
