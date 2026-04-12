// kilocode_change — stuck detection for agent self-correction loops
import z from "zod"
import { createHash } from "crypto"
import { Log } from "../util/log"

export namespace StuckDetector {
  const log = Log.create({ service: "stuck-detector" })

  // ---------------------------------------------------------------------------
  // Schemas
  // ---------------------------------------------------------------------------

  export const Options = z
    .object({
      repeatingActionObservation: z.number().int().positive().default(4),
      repeatingActionError: z.number().int().positive().default(3),
      agentMonologue: z.number().int().positive().default(3),
      alternatingPattern: z.number().int().positive().default(6),
      contextWindowError: z.number().int().positive().default(2),
    })
    .meta({ ref: "StuckDetectorOptions" })
  export type Options = z.infer<typeof Options>

  export const Result = z
    .object({
      stuck: z.boolean(),
      pattern: z.string(),
      suggestion: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .meta({ ref: "StuckDetectorResult" })
  export type Result = z.infer<typeof Result>

  /**
   * Minimal shape we inspect from each message in the conversation history.
   * Callers should map their actual message types to this interface.
   */
  export interface Message {
    role: "user" | "assistant" | "tool" | "system"
    content?: string
    toolName?: string
    toolInput?: unknown
    toolOutput?: string
    isError?: boolean
  }

  // ---------------------------------------------------------------------------
  // Default thresholds (tuned per agent style)
  // ---------------------------------------------------------------------------

  const DEFAULT_OPTIONS: Options = {
    repeatingActionObservation: 4,
    repeatingActionError: 3,
    agentMonologue: 3,
    alternatingPattern: 6,
    contextWindowError: 2,
  }

  /** Debug agents get more patience before being flagged as stuck. */
  export const DEBUG_OPTIONS: Options = {
    repeatingActionObservation: 6,
    repeatingActionError: 5,
    agentMonologue: 5,
    alternatingPattern: 8,
    contextWindowError: 3,
  }

  // ---------------------------------------------------------------------------
  // Content hashing
  // ---------------------------------------------------------------------------

  function hashContent(value: unknown): string {
    const raw = typeof value === "string" ? value : JSON.stringify(value ?? "")
    return createHash("sha256").update(raw).digest("hex").slice(0, 16)
  }

  /**
   * Build a fingerprint for a tool call (name + input hash).
   */
  function toolFingerprint(msg: Message): string {
    return `${msg.toolName ?? "unknown"}:${hashContent(msg.toolInput)}`
  }

  /**
   * Build a fingerprint for a tool call + its output/result.
   * Useful for detecting identical action-observation pairs.
   */
  function actionObservationFingerprint(msg: Message): string {
    return `${toolFingerprint(msg)}=>${hashContent(msg.toolOutput)}`
  }

  // ---------------------------------------------------------------------------
  // Pattern detectors
  // ---------------------------------------------------------------------------

  /**
   * Pattern 1: Same tool + input -> same output, repeated N+ times.
   */
  function detectRepeatingActionObservation(
    messages: Message[],
    threshold: number,
  ): Result | undefined {
    const toolMessages = messages.filter((m) => m.role === "tool" && m.toolName)
    if (toolMessages.length < threshold) return undefined

    let consecutiveCount = 1
    let lastFingerprint = ""

    for (const msg of toolMessages) {
      const fp = actionObservationFingerprint(msg)
      if (fp === lastFingerprint) {
        consecutiveCount++
        if (consecutiveCount >= threshold) {
          const confidence = Math.min(1, 0.6 + (consecutiveCount - threshold) * 0.1)
          log.warn("repeating action-observation detected", {
            tool: msg.toolName,
            count: consecutiveCount,
          })
          return {
            stuck: true,
            pattern: "repeating-action-observation",
            suggestion:
              `The same tool call (${msg.toolName}) has been invoked ${consecutiveCount} times ` +
              `with identical input and output. Try a different approach: change the arguments, ` +
              `use a different tool, or re-evaluate your strategy.`,
            confidence,
          }
        }
      } else {
        consecutiveCount = 1
        lastFingerprint = fp
      }
    }
    return undefined
  }

  /**
   * Pattern 2: Same action keeps generating errors.
   */
  function detectRepeatingActionError(
    messages: Message[],
    threshold: number,
  ): Result | undefined {
    const toolMessages = messages.filter((m) => m.role === "tool" && m.toolName)
    if (toolMessages.length < threshold) return undefined

    let consecutiveErrors = 0
    let lastErrorFingerprint = ""

    for (const msg of toolMessages) {
      if (msg.isError) {
        const fp = toolFingerprint(msg)
        if (fp === lastErrorFingerprint || lastErrorFingerprint === "") {
          lastErrorFingerprint = fp
          consecutiveErrors++
          if (consecutiveErrors >= threshold) {
            const confidence = Math.min(1, 0.7 + (consecutiveErrors - threshold) * 0.1)
            log.warn("repeating action-error detected", {
              tool: msg.toolName,
              count: consecutiveErrors,
            })
            return {
              stuck: true,
              pattern: "repeating-action-error",
              suggestion:
                `The tool "${msg.toolName}" has failed ${consecutiveErrors} times in a row ` +
                `with the same or similar input. Read the error message carefully, fix the ` +
                `underlying issue, or switch to a different strategy entirely.`,
              confidence,
            }
          }
        } else {
          lastErrorFingerprint = fp
          consecutiveErrors = 1
        }
      } else {
        consecutiveErrors = 0
        lastErrorFingerprint = ""
      }
    }
    return undefined
  }

  /**
   * Pattern 3: Agent keeps talking without any user messages in between.
   */
  function detectAgentMonologue(
    messages: Message[],
    threshold: number,
  ): Result | undefined {
    if (messages.length < threshold) return undefined

    let consecutiveAssistant = 0

    // Walk from the end backwards to find the current streak
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant") {
        consecutiveAssistant++
      } else if (msg.role === "user") {
        break
      }
      // tool messages don't break the monologue since they are agent-initiated
    }

    if (consecutiveAssistant >= threshold) {
      const confidence = Math.min(1, 0.5 + (consecutiveAssistant - threshold) * 0.1)
      log.warn("agent monologue detected", { count: consecutiveAssistant })
      return {
        stuck: true,
        pattern: "agent-monologue",
        suggestion:
          `The agent has produced ${consecutiveAssistant} consecutive messages without user ` +
          `input. Pause and ask the user a clarifying question, present your findings so far, ` +
          `or summarise what you have tried and what you plan to do next.`,
        confidence,
      }
    }
    return undefined
  }

  /**
   * Pattern 4: Two distinct action pairs cycling back and forth (ABABAB...).
   */
  function detectAlternatingPattern(
    messages: Message[],
    threshold: number,
  ): Result | undefined {
    const toolMessages = messages.filter((m) => m.role === "tool" && m.toolName)
    if (toolMessages.length < threshold) return undefined

    const fingerprints = toolMessages.map(toolFingerprint)

    // Look for an A-B-A-B pattern starting from the end
    for (let start = fingerprints.length - 1; start >= 3; start--) {
      const a = fingerprints[start]
      const b = fingerprints[start - 1]
      if (a === b) continue // need two distinct fingerprints

      let alternations = 0
      let expectA = true
      for (let j = start; j >= 0; j--) {
        const expected = expectA ? a : b
        if (fingerprints[j] === expected) {
          alternations++
          expectA = !expectA
        } else {
          break
        }
      }

      if (alternations >= threshold) {
        const confidence = Math.min(1, 0.65 + (alternations - threshold) * 0.05)
        log.warn("alternating pattern detected", { alternations })
        return {
          stuck: true,
          pattern: "alternating-pattern",
          suggestion:
            `Detected ${alternations} alternations between two tool calls. The agent is ` +
            `cycling between two actions without making progress. Break the cycle by choosing ` +
            `a completely different approach or asking the user for guidance.`,
          confidence,
        }
      }
    }
    return undefined
  }

  /**
   * Pattern 5: Context window / memory management errors.
   * Heuristic: look for error messages containing known phrases.
   */
  const CONTEXT_ERROR_PHRASES = [
    "context length exceeded",
    "context_length_exceeded",
    "maximum context length",
    "token limit",
    "context window",
    "reduce the length",
    "too many tokens",
    "memory limit",
  ]

  function isContextWindowError(msg: Message): boolean {
    if (!msg.isError && !msg.content) return false
    const text = (msg.content ?? msg.toolOutput ?? "").toLowerCase()
    return CONTEXT_ERROR_PHRASES.some((phrase) => text.includes(phrase))
  }

  function detectContextWindowErrors(
    messages: Message[],
    threshold: number,
  ): Result | undefined {
    let consecutive = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      if (isContextWindowError(messages[i])) {
        consecutive++
        if (consecutive >= threshold) {
          const confidence = Math.min(1, 0.8 + (consecutive - threshold) * 0.1)
          log.warn("context window errors detected", { count: consecutive })
          return {
            stuck: true,
            pattern: "context-window-error",
            suggestion:
              `${consecutive} consecutive context window / memory errors detected. ` +
              `Compact the conversation, summarise earlier context, or start a new session ` +
              `with only the essential information.`,
            confidence,
          }
        }
      } else {
        consecutive = 0
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Run all five pattern detectors against the message history.
   *
   * Returns the **first** (highest-priority) match or a `{ stuck: false }` result.
   * Detectors are ordered by severity — context window errors first, then
   * repeating errors, repeating action-observations, alternating, monologue.
   */
  export function check(messages: Message[], opts?: Partial<Options>): Result {
    const options: Options = { ...DEFAULT_OPTIONS, ...opts }

    // Ordered by descending severity / urgency
    const detectors: (() => Result | undefined)[] = [
      () => detectContextWindowErrors(messages, options.contextWindowError),
      () => detectRepeatingActionError(messages, options.repeatingActionError),
      () => detectRepeatingActionObservation(messages, options.repeatingActionObservation),
      () => detectAlternatingPattern(messages, options.alternatingPattern),
      () => detectAgentMonologue(messages, options.agentMonologue),
    ]

    for (const detect of detectors) {
      const result = detect()
      if (result) {
        log.info("stuck pattern detected", { pattern: result.pattern, confidence: result.confidence })
        return result
      }
    }

    return {
      stuck: false,
      pattern: "none",
      suggestion: "",
      confidence: 0,
    }
  }
}
