// kilocode_change — comprehensive tests for Debate, AgentCard, AgentRouter, PromptEvolution

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Debate } from "../../src/agent/debate"
import { AgentCard } from "../../src/agent/card"
import { AgentRouter } from "../../src/agent/router"
import { PromptEvolution } from "../../src/agent/evolution"

// ── Shared helpers ─────────────────────────────────────────────────────────

function mutationsPath() {
  return path.join(Global.Path.data, "evolution", "prompt-mutations.jsonl")
}

async function cleanMutations() {
  await fs.rm(mutationsPath(), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.data, "evolution"), { recursive: true, force: true }).catch(() => {})
}

function makeMutation(overrides?: Partial<PromptEvolution.Mutation>): PromptEvolution.Mutation {
  return {
    id: `mut-${Math.random().toString(36).slice(2)}`,
    agentName: "code",
    timestamp: Date.now(),
    trigger: "success rate 40% < 70% threshold for \"debug-typescript\" (5 failures analyzed)",
    addition: '[Auto-evolved guidance for "debug-typescript" tasks]\nAlways read error logs before editing.',
    taskType: "debug-typescript",
    performanceBefore: 0.4,
    status: "active",
    ...overrides,
  }
}

function makeVerdict(overrides?: Partial<Debate.CriticVerdict>): Debate.CriticVerdict {
  return {
    criticAgent: "security-reviewer",
    severity: "suggestion",
    confidence: 0.8,
    issue: "Missing input validation",
    location: "src/api/handler.ts:42",
    suggestion: "Add zod schema validation to the request body",
    evidence: "No validation found before database write",
    ...overrides,
  }
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanMutations()
})

afterEach(async () => {
  await cleanMutations()
})

// ════════════════════════════════════════════════════════════════════════════
// Debate
// ════════════════════════════════════════════════════════════════════════════

describe("Debate.selectCritics", () => {
  test("always includes architecture-skeptic and test-advocate", () => {
    const critics = Debate.selectCritics(["src/utils/string.ts"])
    expect(critics).toContain("architecture-skeptic")
    expect(critics).toContain("test-advocate")
  })

  test("includes security-reviewer for auth-related paths", () => {
    const critics = Debate.selectCritics(["src/auth/login.ts"])
    expect(critics).toContain("security-reviewer")
  })

  test("includes security-reviewer for token paths", () => {
    const critics = Debate.selectCritics(["packages/api/token/refresh.ts"])
    expect(critics).toContain("security-reviewer")
  })

  test("includes performance-critic for API handler paths", () => {
    const critics = Debate.selectCritics(["src/api/users.ts"])
    expect(critics).toContain("performance-critic")
  })

  test("includes performance-critic for database paths", () => {
    const critics = Debate.selectCritics(["src/database/queries.ts"])
    expect(critics).toContain("performance-critic")
  })

  test("does not include security-reviewer for plain source files", () => {
    const critics = Debate.selectCritics(["src/utils/format.ts", "src/components/Button.tsx"])
    expect(critics).not.toContain("security-reviewer")
  })

  test("does not include performance-critic for plain source files", () => {
    const critics = Debate.selectCritics(["src/utils/format.ts"])
    expect(critics).not.toContain("performance-critic")
  })

  test("includes both security and performance critics when both patterns match", () => {
    const critics = Debate.selectCritics(["src/auth/handler.ts", "src/api/query.ts"])
    expect(critics).toContain("security-reviewer")
    expect(critics).toContain("performance-critic")
    expect(critics).toHaveLength(4)
  })

  test("normalizes Windows backslash paths", () => {
    const critics = Debate.selectCritics(["src\\auth\\login.ts"])
    expect(critics).toContain("security-reviewer")
  })
})

describe("Debate.shouldAutoDebate", () => {
  test("returns true for auth paths", () => {
    expect(Debate.shouldAutoDebate("src/auth/middleware.ts")).toBe(true)
  })

  test("returns true for security paths", () => {
    expect(Debate.shouldAutoDebate("packages/core/security/validator.ts")).toBe(true)
  })

  test("returns true for payment paths", () => {
    expect(Debate.shouldAutoDebate("src/payment/checkout.ts")).toBe(true)
  })

  test("returns true for billing paths", () => {
    expect(Debate.shouldAutoDebate("services/billing/invoice.ts")).toBe(true)
  })

  test("returns true for stripe integration paths", () => {
    expect(Debate.shouldAutoDebate("lib/stripe/webhook.ts")).toBe(true)
  })

  test("returns false for regular source files", () => {
    expect(Debate.shouldAutoDebate("src/utils/format.ts")).toBe(false)
  })

  test("returns false for test files outside sensitive paths", () => {
    expect(Debate.shouldAutoDebate("src/components/Button.test.ts")).toBe(false)
  })

  test("returns false for config files outside sensitive paths", () => {
    expect(Debate.shouldAutoDebate("tsconfig.json")).toBe(false)
  })
})

describe("Debate.run — buildConsensus logic", () => {
  test("all suggestion verdicts land in consensus.suggestions", async () => {
    const critiques: Debate.CriticVerdict[] = [
      makeVerdict({ severity: "suggestion", confidence: 0.9 }),
      makeVerdict({ severity: "suggestion", criticAgent: "test-advocate", confidence: 0.7 }),
    ]
    const result = await Debate.run({
      sessionID: "sess-1",
      changedFiles: ["src/utils/format.ts"],
      diffContent: "- old\n+ new",
      critiques,
    })
    expect(result.consensus.suggestions).toHaveLength(2)
    expect(result.consensus.critical).toHaveLength(0)
    expect(result.consensus.warnings).toHaveLength(0)
  })

  test("a critical verdict appears in consensus.critical", async () => {
    const critiques: Debate.CriticVerdict[] = [
      makeVerdict({ severity: "critical", confidence: 0.95, issue: "SQL injection risk" }),
      makeVerdict({ severity: "suggestion", confidence: 0.5 }),
    ]
    const result = await Debate.run({
      sessionID: "sess-2",
      changedFiles: ["src/api/query.ts"],
      diffContent: "+ execute(userInput)",
      critiques,
    })
    expect(result.consensus.critical).toHaveLength(1)
    expect(result.consensus.critical[0].issue).toBe("SQL injection risk")
    expect(result.consensus.suggestions).toHaveLength(1)
  })

  test("warnings flagged by multiple critics are elevated to critical", async () => {
    const sharedIssue = "Missing rate limiting"
    const sharedLocation = "src/api/auth.ts:10"
    const critiques: Debate.CriticVerdict[] = [
      makeVerdict({ severity: "warning", criticAgent: "security-reviewer", issue: sharedIssue, location: sharedLocation, confidence: 0.85 }),
      makeVerdict({ severity: "warning", criticAgent: "architecture-skeptic", issue: sharedIssue, location: sharedLocation, confidence: 0.75 }),
    ]
    const result = await Debate.run({
      sessionID: "sess-3",
      changedFiles: ["src/api/auth.ts"],
      diffContent: "+ router.post('/login', handler)",
      critiques,
    })
    // Both verdicts share location+issue so they should be elevated
    expect(result.consensus.critical.length).toBeGreaterThanOrEqual(1)
    expect(result.consensus.warnings).toHaveLength(0)
  })

  test("result contains id, sessionID, timestamp, participants, and rounds", async () => {
    const result = await Debate.run({
      sessionID: "sess-4",
      changedFiles: ["src/utils/helper.ts"],
      diffContent: "+ helper()",
    })
    expect(typeof result.id).toBe("string")
    expect(result.id.length).toBeGreaterThan(0)
    expect(result.sessionID).toBe("sess-4")
    expect(result.timestamp).toBeGreaterThan(0)
    expect(Array.isArray(result.participants)).toBe(true)
    expect(typeof result.rounds).toBe("number")
  })

  test("consensus sorts by confidence descending", async () => {
    const critiques: Debate.CriticVerdict[] = [
      makeVerdict({ severity: "suggestion", confidence: 0.3, issue: "Low confidence" }),
      makeVerdict({ severity: "suggestion", confidence: 0.95, issue: "High confidence" }),
      makeVerdict({ severity: "suggestion", confidence: 0.6, issue: "Mid confidence" }),
    ]
    const result = await Debate.run({
      sessionID: "sess-5",
      changedFiles: ["src/utils/helper.ts"],
      diffContent: "+ foo()",
      critiques,
    })
    const suggestions = result.consensus.suggestions
    expect(suggestions[0].confidence).toBeGreaterThanOrEqual(suggestions[1].confidence)
    expect(suggestions[1].confidence).toBeGreaterThanOrEqual(suggestions[2].confidence)
  })
})

describe("Debate.CriticVerdict schema", () => {
  test("validates a well-formed verdict", () => {
    const result = Debate.CriticVerdict.safeParse({
      criticAgent: "security-reviewer",
      severity: "warning",
      confidence: 0.75,
      issue: "Unvalidated input",
      location: "src/api/route.ts:18",
      suggestion: "Add input sanitization",
      evidence: "Raw req.body passed to query",
    })
    expect(result.success).toBe(true)
  })

  test("rejects confidence outside 0–1 range", () => {
    const result = Debate.CriticVerdict.safeParse({
      criticAgent: "test-advocate",
      severity: "suggestion",
      confidence: 1.5,
      issue: "Missing tests",
      location: "src/util.ts",
      suggestion: "Add unit tests",
      evidence: "No spec file found",
    })
    expect(result.success).toBe(false)
  })

  test("rejects unknown severity value", () => {
    const result = Debate.CriticVerdict.safeParse({
      criticAgent: "performance-critic",
      severity: "info",
      confidence: 0.5,
      issue: "Slow query",
      location: "src/db.ts",
      suggestion: "Add index",
      evidence: "EXPLAIN shows full scan",
    })
    expect(result.success).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// AgentCard
// ════════════════════════════════════════════════════════════════════════════

describe("AgentCard.defaultCards", () => {
  test("defines cards for all six expected agents", () => {
    const cards = AgentCard.defaultCards()
    const names = Object.keys(cards)
    expect(names).toContain("code")
    expect(names).toContain("debug")
    expect(names).toContain("explore")
    expect(names).toContain("ask")
    expect(names).toContain("plan")
    expect(names).toContain("infra")
  })

  test("each card has a non-empty skills array", () => {
    const cards = AgentCard.defaultCards()
    for (const [name, card] of Object.entries(cards)) {
      expect(card.skills.length, `${name} should have at least one skill`).toBeGreaterThan(0)
    }
  })

  test("each skill has inputPatterns array and description", () => {
    const cards = AgentCard.defaultCards()
    for (const card of Object.values(cards)) {
      for (const skill of card.skills) {
        expect(Array.isArray(skill.inputPatterns)).toBe(true)
        expect(skill.inputPatterns.length).toBeGreaterThan(0)
        expect(typeof skill.description).toBe("string")
        expect(skill.description.length).toBeGreaterThan(0)
      }
    }
  })

  test("debug agent has a skill that matches the word 'debug'", () => {
    const { debug } = AgentCard.defaultCards()
    const hasDebugSkill = debug.skills.some((skill) =>
      skill.inputPatterns.some((pattern) => {
        try {
          return new RegExp(pattern, "i").test("debug this error")
        } catch {
          return false
        }
      }),
    )
    expect(hasDebugSkill).toBe(true)
  })

  test("code agent has a skill that matches 'implement'", () => {
    const { code } = AgentCard.defaultCards()
    const hasImplementSkill = code.skills.some((skill) =>
      skill.inputPatterns.some((pattern) => {
        try {
          return new RegExp(pattern, "i").test("implement a new feature")
        } catch {
          return false
        }
      }),
    )
    expect(hasImplementSkill).toBe(true)
  })

  test("each card has a valid costProfile with modelTier", () => {
    const cards = AgentCard.defaultCards()
    const validTiers = ["fast", "standard", "premium"]
    for (const [name, card] of Object.entries(cards)) {
      expect(validTiers, `${name} costProfile.modelTier must be valid`).toContain(card.costProfile.modelTier)
      expect(card.costProfile.avgTokensPerTask).toBeGreaterThan(0)
      expect(card.costProfile.avgLatencyMs).toBeGreaterThan(0)
    }
  })
})

describe("AgentCard.Info schema", () => {
  test("validates a well-formed card object", () => {
    const result = AgentCard.Info.safeParse({
      name: "test-agent",
      skills: [
        {
          id: "do-something",
          description: "Does something useful",
          inputPatterns: ["\\bdo\\b"],
          examples: ["Do the thing"],
        },
      ],
      costProfile: {
        avgTokensPerTask: 2000,
        avgLatencyMs: 5000,
        modelTier: "fast",
      },
      performanceHistory: [],
    })
    expect(result.success).toBe(true)
  })

  test("rejects a card missing the required name field", () => {
    const result = AgentCard.Info.safeParse({
      skills: [],
      costProfile: {
        avgTokensPerTask: 1000,
        avgLatencyMs: 2000,
        modelTier: "fast",
      },
      performanceHistory: [],
    })
    expect(result.success).toBe(false)
  })

  test("rejects a card with an invalid modelTier", () => {
    const result = AgentCard.Info.safeParse({
      name: "bad-agent",
      skills: [],
      costProfile: {
        avgTokensPerTask: 1000,
        avgLatencyMs: 2000,
        modelTier: "ultra",
      },
      performanceHistory: [],
    })
    expect(result.success).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// AgentRouter
// ════════════════════════════════════════════════════════════════════════════

describe("AgentRouter.scoreAgent", () => {
  test("returns a number between 0 and 1 for any message", () => {
    const cards = AgentCard.defaultCards()
    const score = AgentRouter.scoreAgent("implement a new feature", cards.code!)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("code card scores higher for implementation messages than debug card", () => {
    const cards = AgentCard.defaultCards()
    const codeScore = AgentRouter.scoreAgent("implement a login feature", cards.code!)
    const debugScore = AgentRouter.scoreAgent("implement a login feature", cards.debug!)
    expect(codeScore).toBeGreaterThan(debugScore)
  })

  test("debug card scores higher for bug-fix messages than explore card", () => {
    const cards = AgentCard.defaultCards()
    const debugScore = AgentRouter.scoreAgent("fix the null pointer exception in user service", cards.debug!)
    const exploreScore = AgentRouter.scoreAgent("fix the null pointer exception in user service", cards.explore!)
    expect(debugScore).toBeGreaterThan(exploreScore)
  })

  test("explore card scores higher for search messages than code card", () => {
    const cards = AgentCard.defaultCards()
    const exploreScore = AgentRouter.scoreAgent("find where the API_KEY is defined in the codebase", cards.explore!)
    const codeScore = AgentRouter.scoreAgent("find where the API_KEY is defined in the codebase", cards.code!)
    expect(exploreScore).toBeGreaterThan(codeScore)
  })

  test("returns 0 for a card with no skills", () => {
    const emptyCard: AgentCard.Info = {
      name: "empty",
      skills: [],
      costProfile: { avgTokensPerTask: 1000, avgLatencyMs: 3000, modelTier: "fast" },
      performanceHistory: [],
    }
    const score = AgentRouter.scoreAgent("implement something", emptyCard)
    expect(score).toBe(0)
  })

  test("score is reduced by poor performance history", () => {
    const cards = AgentCard.defaultCards()
    const baseScore = AgentRouter.scoreAgent("fix this bug", cards.debug!)

    // Create a card identical to debug but with a bad performance record
    const poorDebugCard: AgentCard.Info = {
      ...cards.debug!,
      performanceHistory: [
        {
          taskType: "fix-bug",
          successRate: 0.1,
          avgDuration: 30000,
          sampleCount: 20,
        },
      ],
    }
    const poorScore = AgentRouter.scoreAgent("fix this bug", poorDebugCard)
    expect(poorScore).toBeLessThan(baseScore)
  })

  test("allCards() — defaultCards returns an object with all agent names", () => {
    // Using AgentCard.defaultCards() as the canonical source the router uses
    const cards = AgentCard.defaultCards()
    expect(typeof cards).toBe("object")
    expect(Object.keys(cards).length).toBeGreaterThanOrEqual(6)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// PromptEvolution
// ════════════════════════════════════════════════════════════════════════════

describe("PromptEvolution.check", () => {
  test("returns needsEvolution=false when no strategies recorded", async () => {
    const result = await PromptEvolution.check("code")
    expect(result.needsEvolution).toBe(false)
    expect(result.threshold).toBe(0.7)
  })
})

describe("PromptEvolution.apply", () => {
  test("writes mutation to the mutations file", async () => {
    const mutation = makeMutation({ id: "apply-test-1" })
    await PromptEvolution.apply(mutation)

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0])
    expect(parsed.id).toBe("apply-test-1")
    expect(parsed.status).toBe("active")
    expect(typeof parsed.addition).toBe("string")
  })

  test("applying multiple mutations appends lines to the file", async () => {
    await PromptEvolution.apply(makeMutation({ id: "m1" }))
    await PromptEvolution.apply(makeMutation({ id: "m2" }))
    await PromptEvolution.apply(makeMutation({ id: "m3" }))

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    expect(lines).toHaveLength(3)
  })
})

describe("PromptEvolution.revert", () => {
  test("changes status from active to reverted", async () => {
    const mutation = makeMutation({ id: "revert-test-1" })
    await PromptEvolution.apply(mutation)
    await PromptEvolution.revert("revert-test-1")

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const parsed = JSON.parse(text.split("\n").filter(Boolean)[0])
    expect(parsed.status).toBe("reverted")
  })

  test("does not throw when mutation id does not exist", async () => {
    // Should complete without throwing
    await PromptEvolution.revert("does-not-exist-id")
  })

  test("only reverts the targeted mutation, leaves others intact", async () => {
    await PromptEvolution.apply(makeMutation({ id: "keep-1" }))
    await PromptEvolution.apply(makeMutation({ id: "revert-me" }))
    await PromptEvolution.apply(makeMutation({ id: "keep-2" }))

    await PromptEvolution.revert("revert-me")

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l))
    const keep1 = lines.find((m) => m.id === "keep-1")
    const revertMe = lines.find((m) => m.id === "revert-me")
    const keep2 = lines.find((m) => m.id === "keep-2")

    expect(keep1?.status).toBe("active")
    expect(revertMe?.status).toBe("reverted")
    expect(keep2?.status).toBe("active")
  })
})

describe("PromptEvolution.validate", () => {
  test("updates status to validated with performanceAfter", async () => {
    const mutation = makeMutation({ id: "validate-test-1" })
    await PromptEvolution.apply(mutation)
    await PromptEvolution.validate("validate-test-1", 0.9)

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const parsed = JSON.parse(text.split("\n").filter(Boolean)[0])
    expect(parsed.status).toBe("validated")
    expect(parsed.performanceAfter).toBe(0.9)
  })

  test("does not throw when mutation id does not exist", async () => {
    await PromptEvolution.validate("no-such-id", 0.9)
  })
})

describe("PromptEvolution.activeMutations", () => {
  test("returns only active mutations for the specified agent", async () => {
    await PromptEvolution.apply(makeMutation({ id: "active-1", agentName: "code" }))
    await PromptEvolution.apply(makeMutation({ id: "active-2", agentName: "code" }))
    await PromptEvolution.apply(makeMutation({ id: "active-3", agentName: "debug" }))

    await PromptEvolution.revert("active-1")

    const active = await PromptEvolution.activeMutations("code")
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe("active-2")
  })

  test("returns empty array when agent has no mutations", async () => {
    const active = await PromptEvolution.activeMutations("nonexistent-agent")
    expect(active).toEqual([])
  })

  test("excludes validated mutations from active list", async () => {
    await PromptEvolution.apply(makeMutation({ id: "valid-1", agentName: "code" }))
    await PromptEvolution.validate("valid-1", 0.88)

    const active = await PromptEvolution.activeMutations("code")
    expect(active).toHaveLength(0)
  })
})

describe("PromptEvolution.history", () => {
  test("returns mutations sorted by timestamp descending (most recent first)", async () => {
    const base = makeMutation({ agentName: "code" })
    await PromptEvolution.apply({ ...base, id: "h-old", timestamp: 1000 })
    await PromptEvolution.apply({ ...base, id: "h-mid", timestamp: 2000 })
    await PromptEvolution.apply({ ...base, id: "h-new", timestamp: 3000 })

    const hist = await PromptEvolution.history("code")
    expect(hist).toHaveLength(3)
    expect(hist[0].id).toBe("h-new")
    expect(hist[1].id).toBe("h-mid")
    expect(hist[2].id).toBe("h-old")
  })

  test("filters to only the requested agent", async () => {
    await PromptEvolution.apply(makeMutation({ id: "code-mut", agentName: "code" }))
    await PromptEvolution.apply(makeMutation({ id: "explore-mut", agentName: "explore" }))

    const codeHist = await PromptEvolution.history("code")
    expect(codeHist.every((m) => m.agentName === "code")).toBe(true)
    expect(codeHist).toHaveLength(1)

    const exploreHist = await PromptEvolution.history("explore")
    expect(exploreHist).toHaveLength(1)
    expect(exploreHist[0].id).toBe("explore-mut")
  })

  test("returns empty array when no mutations file exists", async () => {
    const hist = await PromptEvolution.history("code")
    expect(hist).toEqual([])
  })
})

describe("PromptEvolution Mutation schema", () => {
  test("validates a well-formed mutation object", () => {
    const result = PromptEvolution.Mutation.safeParse({
      id: "schema-test-1",
      agentName: "code",
      timestamp: Date.now(),
      trigger: "low success rate",
      addition: "Always verify file exists before editing.",
      taskType: "edit-file",
      performanceBefore: 0.5,
      status: "active",
    })
    expect(result.success).toBe(true)
  })

  test("validates mutation with optional performanceAfter present", () => {
    const result = PromptEvolution.Mutation.safeParse({
      id: "schema-test-2",
      agentName: "debug",
      timestamp: 12345,
      trigger: "threshold exceeded",
      addition: "Check logs first.",
      taskType: "debug-error",
      performanceBefore: 0.6,
      performanceAfter: 0.85,
      status: "validated",
    })
    expect(result.success).toBe(true)
  })

  test("rejects unknown status values", () => {
    const result = PromptEvolution.Mutation.safeParse({
      id: "schema-bad",
      agentName: "code",
      timestamp: 1000,
      trigger: "test",
      addition: "guidance",
      taskType: "debug-typescript",
      performanceBefore: 0.4,
      status: "pending",
    })
    expect(result.success).toBe(false)
  })
})

describe("PromptEvolution — analyzeFailures div-by-zero guard", () => {
  test("generateMutation handles empty failures array without throwing", async () => {
    // Empty failures — exercises the div-by-zero guard in analyzeFailures
    const mutation = await PromptEvolution.generateMutation("code", "empty-task", [])
    expect(mutation.id).toBeDefined()
    expect(mutation.agentName).toBe("code")
    expect(mutation.taskType).toBe("empty-task")
    expect(typeof mutation.addition).toBe("string")
    expect(mutation.status).toBe("active")
  })
})
