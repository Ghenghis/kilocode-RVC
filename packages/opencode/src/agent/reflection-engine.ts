// kilocode_change — reflexion self-correction engine for stuck agents
import z from "zod"
import { Log } from "../util/log"
import { StuckDetector } from "./stuck-detector"

export namespace ReflectionEngine {
  const log = Log.create({ service: "reflection-engine" })

  // ---------------------------------------------------------------------------
  // Schemas
  // ---------------------------------------------------------------------------

  export const Reflection = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      timestamp: z.number(),
      pattern: z.string(),
      reflectionText: z.string(),
      suggestedApproach: z.string(),
    })
    .meta({ ref: "Reflection" })
  export type Reflection = z.infer<typeof Reflection>

  export const ReflectionPrompt = z
    .object({
      detectedPattern: z.string(),
      whatWentWrong: z.string(),
      suggestedAlternatives: z.string(),
      fullPrompt: z.string(),
    })
    .meta({ ref: "ReflectionPrompt" })
  export type ReflectionPrompt = z.infer<typeof ReflectionPrompt>

  export const EscalationStatus = z
    .object({
      shouldEscalate: z.boolean(),
      reflectionCount: z.number(),
      maxReflections: z.number(),
      reason: z.string(),
    })
    .meta({ ref: "EscalationStatus" })
  export type EscalationStatus = z.infer<typeof EscalationStatus>

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const MAX_REFLECTIONS_PER_SESSION = 3

  // ---------------------------------------------------------------------------
  // In-memory storage
  // ---------------------------------------------------------------------------

  const reflectionsBySession = new Map<string, Reflection[]>()

  // ---------------------------------------------------------------------------
  // Pattern-specific guidance
  // ---------------------------------------------------------------------------

  const PATTERN_GUIDANCE: Record<string, { whatWentWrong: string; alternatives: string }> = {
    "repeating-action-observation": {
      whatWentWrong:
        "You are executing the same tool call repeatedly and getting the same result each " +
        "time. This indicates a loop where you expect a different outcome but nothing is " +
        "changing between attempts.",
      alternatives:
        "1. Re-read the output carefully — it may already contain the answer you need.\n" +
        "2. Modify the tool arguments (different file path, different search query, etc.).\n" +
        "3. Switch to a different tool that can achieve the same goal.\n" +
        "4. Ask the user whether your current approach is correct.",
    },
    "repeating-action-error": {
      whatWentWrong:
        "The same tool call keeps failing with an error. Retrying the identical action " +
        "will not fix the underlying problem.",
      alternatives:
        "1. Read the error message carefully and address the root cause.\n" +
        "2. Check file paths, permissions, or argument formats.\n" +
        "3. Try a simpler version of the command first to isolate the issue.\n" +
        "4. If the tool is unavailable or misconfigured, use an alternative tool.",
    },
    "agent-monologue": {
      whatWentWrong:
        "You have been generating messages without any user interaction. This may mean " +
        "you are overthinking, going in circles, or working on the wrong problem.",
      alternatives:
        "1. Summarise your progress and present findings to the user.\n" +
        "2. Ask a specific clarifying question.\n" +
        "3. If you have a working solution, present it instead of continuing to iterate.\n" +
        "4. If you are stuck, explicitly state what is blocking you.",
    },
    "alternating-pattern": {
      whatWentWrong:
        "You are alternating between two actions in a cycle (A -> B -> A -> B -> ...) " +
        "without making forward progress. Each action likely undoes or invalidates the other.",
      alternatives:
        "1. Step back and rethink the overall approach.\n" +
        "2. Combine both actions into a single step if possible.\n" +
        "3. Choose one path and commit to it.\n" +
        "4. Ask the user which direction to take.",
    },
    "context-window-error": {
      whatWentWrong:
        "The conversation has exceeded the model's context window or memory limits. " +
        "Continuing to add messages will keep failing.",
      alternatives:
        "1. Compact the conversation by summarising earlier context.\n" +
        "2. Start a new session with only the essential information.\n" +
        "3. Break the task into smaller, independent sub-tasks.\n" +
        "4. Remove large tool outputs that are no longer relevant.",
    },
  }

  const FALLBACK_GUIDANCE = {
    whatWentWrong: "An unrecognised stuck pattern was detected.",
    alternatives: "Review your recent actions and try a fundamentally different approach.",
  }

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  let reflectionCounter = 0

  function nextID(): string {
    reflectionCounter++
    return `ref_${Date.now()}_${reflectionCounter}`
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Generate a structured reflection prompt from a stuck-detection result.
   *
   * The returned `ReflectionPrompt` contains both machine-parseable fields and
   * a `fullPrompt` string that can be injected directly into the agent's
   * conversation as a system-level nudge.
   */
  export function reflect(
    stuckResult: StuckDetector.Result,
    context: { sessionID: string; taskSummary?: string },
  ): ReflectionPrompt {
    const guidance = PATTERN_GUIDANCE[stuckResult.pattern] ?? FALLBACK_GUIDANCE
    const reflectionCount = (reflectionsBySession.get(context.sessionID) ?? []).length

    const whatWentWrong = guidance.whatWentWrong
    const suggestedAlternatives = guidance.alternatives

    const fullPrompt =
      `[SELF-REFLECTION — Stuck Pattern Detected]\n\n` +
      `Pattern: ${stuckResult.pattern}\n` +
      `Confidence: ${(stuckResult.confidence * 100).toFixed(0)}%\n` +
      `Reflection #${reflectionCount + 1} of ${MAX_REFLECTIONS_PER_SESSION}\n\n` +
      `What went wrong:\n${whatWentWrong}\n\n` +
      `Suggested alternatives:\n${suggestedAlternatives}\n\n` +
      (context.taskSummary
        ? `Original task context: ${context.taskSummary}\n\n`
        : "") +
      `IMPORTANT: Do NOT repeat the action that triggered this reflection. ` +
      `Choose a genuinely different approach from the alternatives above.` +
      (reflectionCount + 1 >= MAX_REFLECTIONS_PER_SESSION
        ? `\n\nWARNING: This is your final self-correction attempt. If you cannot ` +
          `make progress, escalate to the user with a clear summary of what you ` +
          `tried and where you are stuck.`
        : "")

    // Store the reflection
    const reflection: Reflection = {
      id: nextID(),
      sessionID: context.sessionID,
      timestamp: Date.now(),
      pattern: stuckResult.pattern,
      reflectionText: whatWentWrong,
      suggestedApproach: suggestedAlternatives,
    }

    const existing = reflectionsBySession.get(context.sessionID) ?? []
    existing.push(reflection)
    reflectionsBySession.set(context.sessionID, existing)

    log.info("reflection generated", {
      sessionID: context.sessionID,
      pattern: stuckResult.pattern,
      reflectionNumber: existing.length,
    })

    return {
      detectedPattern: stuckResult.pattern,
      whatWentWrong,
      suggestedAlternatives,
      fullPrompt,
    }
  }

  /**
   * Return past reflections for a given session (episodic memory).
   */
  export function getHistory(sessionID: string): Reflection[] {
    return reflectionsBySession.get(sessionID) ?? []
  }

  /**
   * Check whether the maximum number of self-correction attempts has been
   * reached for a session. When `true`, the agent should stop retrying and
   * escalate to the user.
   */
  export function shouldEscalate(sessionID: string): EscalationStatus {
    const history = reflectionsBySession.get(sessionID) ?? []
    const count = history.length
    const shouldEsc = count >= MAX_REFLECTIONS_PER_SESSION

    if (shouldEsc) {
      log.warn("escalation threshold reached", {
        sessionID,
        reflectionCount: count,
      })
    }

    return {
      shouldEscalate: shouldEsc,
      reflectionCount: count,
      maxReflections: MAX_REFLECTIONS_PER_SESSION,
      reason: shouldEsc
        ? `Reached maximum of ${MAX_REFLECTIONS_PER_SESSION} self-correction attempts. ` +
          `The agent should ask the user for help.`
        : `${count} of ${MAX_REFLECTIONS_PER_SESSION} reflections used. ` +
          `The agent may continue self-correcting.`,
    }
  }

  /**
   * Clear reflection history for a session. Useful when a session is
   * restarted or compacted.
   */
  export function clearHistory(sessionID: string): void {
    reflectionsBySession.delete(sessionID)
    log.info("reflection history cleared", { sessionID })
  }

  /**
   * Reset all internal state. Intended for tests only.
   */
  export function _reset(): void {
    reflectionsBySession.clear()
    reflectionCounter = 0
  }
}
