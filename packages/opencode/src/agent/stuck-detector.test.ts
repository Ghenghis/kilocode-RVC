// kilocode_change — tests for StuckDetector and ReflectionEngine
import { afterEach, describe, expect, test } from "bun:test"
import { StuckDetector } from "./stuck-detector"
import { ReflectionEngine } from "./reflection-engine"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolMsg(
  toolName: string,
  toolInput: unknown,
  toolOutput: string,
  isError = false,
): StuckDetector.Message {
  return { role: "tool", toolName, toolInput, toolOutput, isError }
}

function assistantMsg(content: string): StuckDetector.Message {
  return { role: "assistant", content }
}

function userMsg(content: string): StuckDetector.Message {
  return { role: "user", content }
}

function errorToolMsg(toolName: string, toolInput: unknown, errorText: string): StuckDetector.Message {
  return toolMsg(toolName, toolInput, errorText, true)
}

// ---------------------------------------------------------------------------
// StuckDetector — Pattern 1: Repeating Action-Observation
// ---------------------------------------------------------------------------

describe("StuckDetector", () => {
  describe("repeating action-observation", () => {
    test("detects 4+ identical tool call / output pairs", () => {
      const messages = Array.from({ length: 4 }, () =>
        toolMsg("read_file", { path: "/src/main.ts" }, "export default {}"),
      )
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("repeating-action-observation")
      expect(result.confidence).toBeGreaterThanOrEqual(0.6)
    })

    test("does not trigger below threshold", () => {
      const messages = Array.from({ length: 3 }, () =>
        toolMsg("read_file", { path: "/src/main.ts" }, "export default {}"),
      )
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("does not trigger when outputs differ", () => {
      const messages = Array.from({ length: 5 }, (_, i) =>
        toolMsg("read_file", { path: "/src/main.ts" }, `content version ${i}`),
      )
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("resets counter when a different tool call appears", () => {
      const messages = [
        toolMsg("read_file", { path: "/a.ts" }, "aaa"),
        toolMsg("read_file", { path: "/a.ts" }, "aaa"),
        toolMsg("grep", { query: "hello" }, "found"),
        toolMsg("read_file", { path: "/a.ts" }, "aaa"),
        toolMsg("read_file", { path: "/a.ts" }, "aaa"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("respects custom threshold", () => {
      const messages = Array.from({ length: 6 }, () =>
        toolMsg("read_file", { path: "/src/main.ts" }, "export default {}"),
      )
      const result = StuckDetector.check(messages, { repeatingActionObservation: 6 })
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("repeating-action-observation")
    })
  })

  // ---------------------------------------------------------------------------
  // Pattern 2: Repeating Action-Error
  // ---------------------------------------------------------------------------

  describe("repeating action-error", () => {
    test("detects 3+ consecutive errors from same tool", () => {
      const messages = Array.from({ length: 3 }, () =>
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
      )
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("repeating-action-error")
      expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    })

    test("does not trigger below threshold", () => {
      const messages = Array.from({ length: 2 }, () =>
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
      )
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("resets when a successful call intervenes", () => {
      const messages = [
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
        toolMsg("bash", { cmd: "npm test" }, "All tests passed"),
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("resets when a different tool errors", () => {
      const messages = [
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
        errorToolMsg("read_file", { path: "/missing" }, "File not found"),
        errorToolMsg("bash", { cmd: "npm test" }, "Error: ENOENT"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Pattern 3: Agent Monologue
  // ---------------------------------------------------------------------------

  describe("agent monologue", () => {
    test("detects 3+ consecutive assistant messages (from tail)", () => {
      const messages = [
        userMsg("help me"),
        assistantMsg("Sure, let me think..."),
        assistantMsg("Actually, let me reconsider..."),
        assistantMsg("On second thought..."),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("agent-monologue")
    })

    test("does not trigger when user intervenes", () => {
      const messages = [
        assistantMsg("Thinking..."),
        assistantMsg("More thinking..."),
        userMsg("What's happening?"),
        assistantMsg("Here is the answer."),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("tool messages do not break the monologue count", () => {
      const messages = [
        userMsg("help"),
        assistantMsg("Let me check..."),
        toolMsg("read_file", { path: "/a.ts" }, "content"),
        assistantMsg("Now let me try..."),
        toolMsg("bash", { cmd: "ls" }, "output"),
        assistantMsg("And another thing..."),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("agent-monologue")
    })
  })

  // ---------------------------------------------------------------------------
  // Pattern 4: Alternating Patterns
  // ---------------------------------------------------------------------------

  describe("alternating pattern", () => {
    test("detects A-B-A-B-A-B cycling (6+ alternations)", () => {
      const messages: StuckDetector.Message[] = []
      for (let i = 0; i < 6; i++) {
        messages.push(
          i % 2 === 0
            ? toolMsg("read_file", { path: "/a.ts" }, "content-a")
            : toolMsg("write_file", { path: "/a.ts" }, "ok"),
        )
      }
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("alternating-pattern")
    })

    test("does not trigger with fewer than threshold alternations", () => {
      const messages = [
        toolMsg("read_file", { path: "/a.ts" }, "content-a"),
        toolMsg("write_file", { path: "/a.ts" }, "ok"),
        toolMsg("read_file", { path: "/a.ts" }, "content-a"),
        toolMsg("write_file", { path: "/a.ts" }, "ok"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })

    test("does not trigger when three distinct tools alternate", () => {
      const messages = [
        toolMsg("read_file", { path: "/a.ts" }, "a"),
        toolMsg("write_file", { path: "/a.ts" }, "ok"),
        toolMsg("grep", { query: "test" }, "line 1"),
        toolMsg("read_file", { path: "/a.ts" }, "a"),
        toolMsg("write_file", { path: "/a.ts" }, "ok"),
        toolMsg("grep", { query: "test" }, "line 1"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Pattern 5: Context Window Errors
  // ---------------------------------------------------------------------------

  describe("context window errors", () => {
    test("detects 2+ consecutive context length errors", () => {
      const messages = [
        { role: "assistant" as const, content: "trying again..." },
        {
          role: "tool" as const,
          toolName: "bash",
          content: "Error: context length exceeded, maximum context length is 128000 tokens",
          isError: true,
        },
        {
          role: "tool" as const,
          toolName: "bash",
          content: "Error: maximum context length exceeded",
          isError: true,
        },
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("context-window-error")
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    })

    test("detects token limit phrasing", () => {
      const messages = [
        { role: "tool" as const, toolName: "api", content: "token limit reached", isError: true },
        { role: "tool" as const, toolName: "api", content: "too many tokens in request", isError: true },
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("context-window-error")
    })

    test("does not trigger on a single context error", () => {
      const messages = [
        { role: "tool" as const, toolName: "api", content: "context length exceeded", isError: true },
        toolMsg("read_file", { path: "/a.ts" }, "ok"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Priority ordering
  // ---------------------------------------------------------------------------

  describe("priority ordering", () => {
    test("context window errors take precedence over action errors", () => {
      const messages = [
        errorToolMsg("bash", { cmd: "run" }, "context length exceeded"),
        errorToolMsg("bash", { cmd: "run" }, "context length exceeded"),
        errorToolMsg("bash", { cmd: "run" }, "context length exceeded"),
      ]
      const result = StuckDetector.check(messages)
      // Should detect as context-window-error (higher priority) rather than
      // repeating-action-error
      expect(result.stuck).toBe(true)
      expect(result.pattern).toBe("context-window-error")
    })
  })

  // ---------------------------------------------------------------------------
  // Empty / no-stuck cases
  // ---------------------------------------------------------------------------

  describe("no stuck", () => {
    test("returns stuck=false for empty messages", () => {
      const result = StuckDetector.check([])
      expect(result.stuck).toBe(false)
      expect(result.pattern).toBe("none")
    })

    test("returns stuck=false for normal conversation", () => {
      const messages: StuckDetector.Message[] = [
        userMsg("Read the file"),
        assistantMsg("Let me read it."),
        toolMsg("read_file", { path: "/a.ts" }, "const x = 1"),
        assistantMsg("The file contains `const x = 1`."),
        userMsg("Thanks!"),
      ]
      const result = StuckDetector.check(messages)
      expect(result.stuck).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Debug options (higher thresholds)
  // ---------------------------------------------------------------------------

  describe("debug options", () => {
    test("debug thresholds are more lenient", () => {
      // 4 repeating action-observations would trigger with defaults but not debug
      const messages = Array.from({ length: 4 }, () =>
        toolMsg("read_file", { path: "/src/main.ts" }, "export default {}"),
      )

      const defaultResult = StuckDetector.check(messages)
      expect(defaultResult.stuck).toBe(true)

      const debugResult = StuckDetector.check(messages, StuckDetector.DEBUG_OPTIONS)
      expect(debugResult.stuck).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// ReflectionEngine
// ---------------------------------------------------------------------------

describe("ReflectionEngine", () => {
  afterEach(() => {
    ReflectionEngine._reset()
  })

  describe("reflect", () => {
    test("generates a reflection prompt from a stuck result", () => {
      const stuckResult: StuckDetector.Result = {
        stuck: true,
        pattern: "repeating-action-error",
        suggestion: "Try something else",
        confidence: 0.8,
      }

      const prompt = ReflectionEngine.reflect(stuckResult, { sessionID: "sess-1" })

      expect(prompt.detectedPattern).toBe("repeating-action-error")
      expect(prompt.whatWentWrong).toContain("keeps failing")
      expect(prompt.suggestedAlternatives).toContain("root cause")
      expect(prompt.fullPrompt).toContain("SELF-REFLECTION")
      expect(prompt.fullPrompt).toContain("Reflection #1 of 3")
    })

    test("stores reflections in session history", () => {
      const stuckResult: StuckDetector.Result = {
        stuck: true,
        pattern: "agent-monologue",
        suggestion: "ask user",
        confidence: 0.6,
      }

      ReflectionEngine.reflect(stuckResult, { sessionID: "sess-2" })
      ReflectionEngine.reflect(stuckResult, { sessionID: "sess-2" })

      const history = ReflectionEngine.getHistory("sess-2")
      expect(history).toHaveLength(2)
      expect(history[0].pattern).toBe("agent-monologue")
      expect(history[1].pattern).toBe("agent-monologue")
      expect(history[0].id).not.toBe(history[1].id)
    })

    test("includes task summary in prompt when provided", () => {
      const stuckResult: StuckDetector.Result = {
        stuck: true,
        pattern: "repeating-action-observation",
        suggestion: "change approach",
        confidence: 0.7,
      }

      const prompt = ReflectionEngine.reflect(stuckResult, {
        sessionID: "sess-3",
        taskSummary: "Refactor the auth module",
      })

      expect(prompt.fullPrompt).toContain("Refactor the auth module")
    })

    test("warns on final reflection attempt", () => {
      const stuckResult: StuckDetector.Result = {
        stuck: true,
        pattern: "alternating-pattern",
        suggestion: "break the cycle",
        confidence: 0.7,
      }

      ReflectionEngine.reflect(stuckResult, { sessionID: "sess-4" })
      ReflectionEngine.reflect(stuckResult, { sessionID: "sess-4" })
      const final = ReflectionEngine.reflect(stuckResult, { sessionID: "sess-4" })

      expect(final.fullPrompt).toContain("final self-correction attempt")
      expect(final.fullPrompt).toContain("escalate to the user")
    })

    test("handles unknown pattern with fallback guidance", () => {
      const stuckResult: StuckDetector.Result = {
        stuck: true,
        pattern: "unknown-future-pattern",
        suggestion: "something",
        confidence: 0.5,
      }

      const prompt = ReflectionEngine.reflect(stuckResult, { sessionID: "sess-5" })
      expect(prompt.whatWentWrong).toContain("unrecognised")
      expect(prompt.suggestedAlternatives).toContain("different approach")
    })
  })

  describe("getHistory", () => {
    test("returns empty array for unknown session", () => {
      expect(ReflectionEngine.getHistory("nonexistent")).toEqual([])
    })

    test("isolates history across sessions", () => {
      const result: StuckDetector.Result = {
        stuck: true,
        pattern: "repeating-action-error",
        suggestion: "fix it",
        confidence: 0.8,
      }

      ReflectionEngine.reflect(result, { sessionID: "A" })
      ReflectionEngine.reflect(result, { sessionID: "B" })
      ReflectionEngine.reflect(result, { sessionID: "A" })

      expect(ReflectionEngine.getHistory("A")).toHaveLength(2)
      expect(ReflectionEngine.getHistory("B")).toHaveLength(1)
    })
  })

  describe("shouldEscalate", () => {
    test("returns false when under the limit", () => {
      const result: StuckDetector.Result = {
        stuck: true,
        pattern: "agent-monologue",
        suggestion: "ask user",
        confidence: 0.6,
      }

      ReflectionEngine.reflect(result, { sessionID: "esc-1" })

      const status = ReflectionEngine.shouldEscalate("esc-1")
      expect(status.shouldEscalate).toBe(false)
      expect(status.reflectionCount).toBe(1)
      expect(status.maxReflections).toBe(3)
    })

    test("returns true after 3 reflections", () => {
      const result: StuckDetector.Result = {
        stuck: true,
        pattern: "repeating-action-observation",
        suggestion: "change approach",
        confidence: 0.7,
      }

      for (let i = 0; i < 3; i++) {
        ReflectionEngine.reflect(result, { sessionID: "esc-2" })
      }

      const status = ReflectionEngine.shouldEscalate("esc-2")
      expect(status.shouldEscalate).toBe(true)
      expect(status.reflectionCount).toBe(3)
      expect(status.reason).toContain("maximum")
    })

    test("returns false for unknown session", () => {
      const status = ReflectionEngine.shouldEscalate("no-such-session")
      expect(status.shouldEscalate).toBe(false)
      expect(status.reflectionCount).toBe(0)
    })
  })

  describe("clearHistory", () => {
    test("removes all reflections for a session", () => {
      const result: StuckDetector.Result = {
        stuck: true,
        pattern: "repeating-action-error",
        suggestion: "fix it",
        confidence: 0.8,
      }

      ReflectionEngine.reflect(result, { sessionID: "clear-1" })
      ReflectionEngine.reflect(result, { sessionID: "clear-1" })
      expect(ReflectionEngine.getHistory("clear-1")).toHaveLength(2)

      ReflectionEngine.clearHistory("clear-1")
      expect(ReflectionEngine.getHistory("clear-1")).toEqual([])
      expect(ReflectionEngine.shouldEscalate("clear-1").shouldEscalate).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Integration: StuckDetector -> ReflectionEngine
  // ---------------------------------------------------------------------------

  describe("end-to-end integration", () => {
    test("detect stuck then reflect then escalate", () => {
      const messages = Array.from({ length: 4 }, () =>
        toolMsg("read_file", { path: "/src/main.ts" }, "export default {}"),
      )

      // Step 1: detect
      const detection = StuckDetector.check(messages)
      expect(detection.stuck).toBe(true)

      // Step 2: reflect (3 times to hit escalation)
      for (let i = 0; i < 3; i++) {
        const prompt = ReflectionEngine.reflect(detection, { sessionID: "e2e" })
        expect(prompt.detectedPattern).toBe("repeating-action-observation")
      }

      // Step 3: escalation check
      const escalation = ReflectionEngine.shouldEscalate("e2e")
      expect(escalation.shouldEscalate).toBe(true)
      expect(escalation.reflectionCount).toBe(3)
    })
  })
})
