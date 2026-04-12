// kilocode_change — new file
// Tests for Strategy memory and PromptEvolution engine.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Strategy } from "../../src/agent/strategy"
import { PromptEvolution } from "../../src/agent/evolution"

// ── Helpers ────────────────────────────────────────────────────────────────

function strategiesPath() {
  return path.join(Global.Path.data, "strategies.jsonl")
}

function mutationsPath() {
  return path.join(Global.Path.data, "evolution", "prompt-mutations.jsonl")
}

async function cleanup() {
  await fs.rm(strategiesPath(), { force: true }).catch(() => {})
  await fs.rm(mutationsPath(), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.data, "evolution"), { recursive: true, force: true }).catch(() => {})
}

function makeFragment(overrides?: Partial<Omit<Strategy.Fragment, "id" | "timestamp">>): Omit<Strategy.Fragment, "id" | "timestamp"> {
  return {
    taskType: "debug-typescript",
    approach: "Read error logs, trace to source, fix type mismatch",
    toolSequence: ["grep", "read", "edit"],
    outcome: "success",
    duration: 12000,
    tokenCost: 4500,
    projectContext: {
      language: "typescript",
      framework: "react",
      projectSize: "medium",
    },
    ...overrides,
  }
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanup()
})

afterEach(async () => {
  await cleanup()
})

// ── Strategy.record ────────────────────────────────────────────────────────

describe("Strategy.record", () => {
  test("records a fragment and returns it with id and timestamp", async () => {
    const input = makeFragment()
    const result = await Strategy.record(input)

    expect(result.id).toBeDefined()
    expect(typeof result.id).toBe("string")
    expect(result.id.length).toBeGreaterThan(0)
    expect(result.timestamp).toBeGreaterThan(0)
    expect(result.taskType).toBe("debug-typescript")
    expect(result.outcome).toBe("success")
    expect(result.toolSequence).toEqual(["grep", "read", "edit"])
  })

  test("persists fragment to JSONL file on disk", async () => {
    await Strategy.record(makeFragment())
    await Strategy.record(makeFragment({ taskType: "refactor-react" }))

    const text = await fs.readFile(strategiesPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0])
    expect(first.taskType).toBe("debug-typescript")

    const second = JSON.parse(lines[1])
    expect(second.taskType).toBe("refactor-react")
  })

  test("each recorded fragment gets a unique id", async () => {
    const a = await Strategy.record(makeFragment())
    const b = await Strategy.record(makeFragment())
    expect(a.id).not.toBe(b.id)
  })
})

// ── Strategy.query ─────────────────────────────────────────────────────────

describe("Strategy.query", () => {
  test("returns empty array when no fragments exist", async () => {
    const results = await Strategy.query({ taskType: "anything" })
    expect(results).toEqual([])
  })

  test("filters by taskType", async () => {
    await Strategy.record(makeFragment({ taskType: "debug-typescript" }))
    await Strategy.record(makeFragment({ taskType: "refactor-react" }))
    await Strategy.record(makeFragment({ taskType: "deploy-docker" }))

    const results = await Strategy.query({ taskType: "debug-typescript" })
    expect(results.every((f) => f.taskType === "debug-typescript")).toBe(true)
  })

  test("filters by outcome", async () => {
    await Strategy.record(makeFragment({ outcome: "success" }))
    await Strategy.record(makeFragment({ outcome: "failure" }))
    await Strategy.record(makeFragment({ outcome: "partial" }))

    const results = await Strategy.query({ outcome: "failure" })
    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe("failure")
  })

  test("filters by language", async () => {
    await Strategy.record(
      makeFragment({
        projectContext: { language: "typescript", projectSize: "medium" },
      }),
    )
    await Strategy.record(
      makeFragment({
        projectContext: { language: "python", projectSize: "small" },
      }),
    )

    const results = await Strategy.query({ language: "python" })
    expect(results).toHaveLength(1)
    expect(results[0].projectContext.language).toBe("python")
  })

  test("respects limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment())
    }
    const results = await Strategy.query({ taskType: "debug-typescript", limit: 3 })
    expect(results).toHaveLength(3)
  })

  test("default limit is 5", async () => {
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment())
    }
    const results = await Strategy.query({ taskType: "debug-typescript" })
    expect(results).toHaveLength(5)
  })

  test("sorts by relevance — exact taskType match ranks higher", async () => {
    await Strategy.record(
      makeFragment({
        taskType: "debug-typescript-advanced",
        projectContext: { language: "typescript", projectSize: "medium" },
      }),
    )
    await Strategy.record(
      makeFragment({
        taskType: "debug-typescript",
        projectContext: { language: "typescript", projectSize: "medium" },
      }),
    )

    const results = await Strategy.query({ taskType: "debug-typescript" })
    // Exact match "debug-typescript" should be ranked first
    expect(results[0].taskType).toBe("debug-typescript")
  })
})

// ── Strategy.successRate ───────────────────────────────────────────────────

describe("Strategy.successRate", () => {
  test("returns zero rate and stable trend with no data", async () => {
    const stats = await Strategy.successRate("code", "debug-typescript")
    expect(stats.rate).toBe(0)
    expect(stats.sampleCount).toBe(0)
    expect(stats.trend).toBe("stable")
  })

  test("computes correct success rate", async () => {
    await Strategy.record(makeFragment({ outcome: "success" }))
    await Strategy.record(makeFragment({ outcome: "success" }))
    await Strategy.record(makeFragment({ outcome: "failure" }))
    await Strategy.record(makeFragment({ outcome: "success" }))

    const stats = await Strategy.successRate("code", "debug-typescript")
    expect(stats.rate).toBe(0.75)
    expect(stats.sampleCount).toBe(4)
  })

  test("trend is stable when not enough samples", async () => {
    await Strategy.record(makeFragment({ outcome: "success" }))
    await Strategy.record(makeFragment({ outcome: "failure" }))

    const stats = await Strategy.successRate("code", "debug-typescript")
    expect(stats.trend).toBe("stable")
  })

  test("trend detects improvement when recent samples are better", async () => {
    // Previous 10: all failures
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment({ outcome: "failure" }))
    }
    // Recent 10: all successes
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment({ outcome: "success" }))
    }

    const stats = await Strategy.successRate("code", "debug-typescript")
    expect(stats.trend).toBe("improving")
  })

  test("trend detects decline when recent samples are worse", async () => {
    // Previous 10: all successes
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment({ outcome: "success" }))
    }
    // Recent 10: all failures
    for (let i = 0; i < 10; i++) {
      await Strategy.record(makeFragment({ outcome: "failure" }))
    }

    const stats = await Strategy.successRate("code", "debug-typescript")
    expect(stats.trend).toBe("declining")
  })
})

// ── Strategy.getGuidance ───────────────────────────────────────────────────

describe("Strategy.getGuidance", () => {
  test("returns empty guidance when no data exists", async () => {
    const guidance = await Strategy.getGuidance("debug-typescript", { language: "typescript" })
    expect(guidance.successfulApproaches).toEqual([])
    expect(guidance.failedApproaches).toEqual([])
    expect(guidance.recommendedTools).toEqual([])
  })

  test("separates successful and failed approaches", async () => {
    await Strategy.record(
      makeFragment({
        outcome: "success",
        approach: "Used grep to find error source",
        toolSequence: ["grep", "read", "edit"],
      }),
    )
    await Strategy.record(
      makeFragment({
        outcome: "failure",
        approach: "Tried blind edit without reading first",
        toolSequence: ["edit"],
      }),
    )

    const guidance = await Strategy.getGuidance("debug-typescript", {
      language: "typescript",
    })
    expect(guidance.successfulApproaches).toContain("Used grep to find error source")
    expect(guidance.failedApproaches).toContain("Tried blind edit without reading first")
  })

  test("recommends tools based on success frequency", async () => {
    // Record several successes using grep + read + edit
    for (let i = 0; i < 5; i++) {
      await Strategy.record(
        makeFragment({
          outcome: "success",
          toolSequence: ["grep", "read", "edit"],
        }),
      )
    }
    // Record a failure using only bash
    await Strategy.record(
      makeFragment({
        outcome: "failure",
        toolSequence: ["bash:npm test"],
      }),
    )

    const guidance = await Strategy.getGuidance("debug-typescript", {
      language: "typescript",
    })
    expect(guidance.recommendedTools).toContain("grep")
    expect(guidance.recommendedTools).toContain("read")
    expect(guidance.recommendedTools).toContain("edit")
  })

  test("deduplicates identical approaches", async () => {
    for (let i = 0; i < 5; i++) {
      await Strategy.record(
        makeFragment({
          outcome: "success",
          approach: "Same approach repeated",
        }),
      )
    }

    const guidance = await Strategy.getGuidance("debug-typescript", {
      language: "typescript",
    })
    // Should deduplicate — only one instance of the repeated approach
    const matching = guidance.successfulApproaches.filter((a) => a === "Same approach repeated")
    expect(matching).toHaveLength(1)
  })
})

// ── Strategy JSONL resilience ──────────────────────────────────────────────

describe("Strategy JSONL resilience", () => {
  test("handles corrupt lines gracefully", async () => {
    const filepath = strategiesPath()
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    // Write a valid line, a corrupt line, and another valid line
    const valid = makeFragment()
    const full1 = { ...valid, id: "aaa", timestamp: 1000 }
    const full2 = { ...valid, id: "bbb", timestamp: 2000 }
    const content = [JSON.stringify(full1), "{{{corrupt", JSON.stringify(full2)].join("\n") + "\n"
    await fs.writeFile(filepath, content)

    const results = await Strategy.query({ limit: 100 })
    // Should skip the corrupt line and return the two valid ones
    expect(results).toHaveLength(2)
  })

  test("returns empty when file does not exist", async () => {
    const results = await Strategy.query({ limit: 100 })
    expect(results).toEqual([])
  })
})

// ── PromptEvolution.check ──────────────────────────────────────────────────

describe("PromptEvolution.check", () => {
  test("returns needsEvolution=false when no data", async () => {
    const result = await PromptEvolution.check("code")
    expect(result.needsEvolution).toBe(false)
    expect(result.threshold).toBe(0.7)
  })

  test("returns needsEvolution=false when success rate is high", async () => {
    for (let i = 0; i < 8; i++) {
      await Strategy.record(makeFragment({ outcome: "success" }))
    }
    await Strategy.record(makeFragment({ outcome: "failure" }))
    await Strategy.record(makeFragment({ outcome: "failure" }))

    const result = await PromptEvolution.check("code")
    expect(result.needsEvolution).toBe(false)
  })

  test("returns needsEvolution=true when success rate drops below threshold", async () => {
    // 2 successes, 5 failures = 28% success rate
    for (let i = 0; i < 2; i++) {
      await Strategy.record(makeFragment({ outcome: "success" }))
    }
    for (let i = 0; i < 5; i++) {
      await Strategy.record(makeFragment({ outcome: "failure" }))
    }

    const result = await PromptEvolution.check("code")
    expect(result.needsEvolution).toBe(true)
    expect(result.taskType).toBe("debug-typescript")
    expect(result.currentRate).toBeDefined()
    expect(result.currentRate!).toBeLessThan(0.7)
  })

  test("requires minimum sample count before triggering", async () => {
    // Only 3 failures — below the 5-sample minimum
    for (let i = 0; i < 3; i++) {
      await Strategy.record(makeFragment({ outcome: "failure" }))
    }

    const result = await PromptEvolution.check("code")
    expect(result.needsEvolution).toBe(false)
  })
})

// ── PromptEvolution.generateMutation ───────────────────────────────────────

describe("PromptEvolution.generateMutation", () => {
  test("generates a mutation with concrete guidance from failures", async () => {
    const failures: Strategy.Fragment[] = [
      {
        id: "f1",
        taskType: "debug-typescript",
        approach: "Attempted blind fix without reading error",
        toolSequence: ["edit", "bash:npm test"],
        outcome: "failure",
        duration: 30000,
        tokenCost: 8000,
        reflection: "Did not read the error log before attempting fix",
        projectContext: { language: "typescript", framework: "react", projectSize: "medium" },
        timestamp: Date.now() - 3600_000,
      },
      {
        id: "f2",
        taskType: "debug-typescript",
        approach: "Edited wrong file",
        toolSequence: ["edit", "bash:npm test"],
        outcome: "failure",
        duration: 45000,
        tokenCost: 12000,
        reflection: "Did not grep to find the actual source of the error",
        projectContext: { language: "typescript", framework: "react", projectSize: "medium" },
        timestamp: Date.now() - 1800_000,
      },
    ]

    const mutation = await PromptEvolution.generateMutation("code", "debug-typescript", failures)

    expect(mutation.id).toBeDefined()
    expect(mutation.agentName).toBe("code")
    expect(mutation.taskType).toBe("debug-typescript")
    expect(mutation.status).toBe("active")
    expect(mutation.addition).toContain("debug-typescript")
    expect(mutation.trigger).toContain("threshold")
    expect(typeof mutation.performanceBefore).toBe("number")
  })

  test("mutation addition is not empty or generic", async () => {
    const failures: Strategy.Fragment[] = [
      {
        id: "f1",
        taskType: "refactor-react",
        approach: "Moved component without updating imports",
        toolSequence: ["edit", "bash:npm test"],
        outcome: "failure",
        duration: 20000,
        tokenCost: 5000,
        projectContext: { language: "typescript", framework: "react", projectSize: "large" },
        timestamp: Date.now(),
      },
    ]

    const mutation = await PromptEvolution.generateMutation("code", "refactor-react", failures)

    expect(mutation.addition.length).toBeGreaterThan(50)
    // The guidance should mention the task type
    expect(mutation.addition).toContain("refactor-react")
  })
})

// ── PromptEvolution.apply / revert / history ───────────────────────────────

describe("PromptEvolution lifecycle", () => {
  test("apply persists mutation to disk", async () => {
    const mutation: PromptEvolution.Mutation = {
      id: "mut-1",
      agentName: "code",
      timestamp: Date.now(),
      trigger: "low success rate",
      addition: "Always read error logs before editing.",
      taskType: "debug-typescript",
      performanceBefore: 0.4,
      status: "active",
    }

    await PromptEvolution.apply(mutation)

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.id).toBe("mut-1")
    expect(parsed.status).toBe("active")
  })

  test("revert changes mutation status to reverted", async () => {
    const mutation: PromptEvolution.Mutation = {
      id: "mut-2",
      agentName: "code",
      timestamp: Date.now(),
      trigger: "test trigger",
      addition: "Test guidance text",
      taskType: "debug-typescript",
      performanceBefore: 0.3,
      status: "active",
    }

    await PromptEvolution.apply(mutation)
    await PromptEvolution.revert("mut-2")

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.status).toBe("reverted")
  })

  test("revert is safe when mutation id does not exist", async () => {
    // Should not throw
    await PromptEvolution.revert("nonexistent-id")
  })

  test("validate updates status and performanceAfter", async () => {
    const mutation: PromptEvolution.Mutation = {
      id: "mut-3",
      agentName: "code",
      timestamp: Date.now(),
      trigger: "low rate",
      addition: "Check imports after moving files.",
      taskType: "refactor-react",
      performanceBefore: 0.5,
      status: "active",
    }

    await PromptEvolution.apply(mutation)
    await PromptEvolution.validate("mut-3", 0.85)

    const text = await fs.readFile(mutationsPath(), "utf-8")
    const lines = text.split("\n").filter(Boolean)
    const parsed = JSON.parse(lines[0])
    expect(parsed.status).toBe("validated")
    expect(parsed.performanceAfter).toBe(0.85)
  })

  test("history returns mutations for a specific agent sorted by recency", async () => {
    const base: PromptEvolution.Mutation = {
      id: "h1",
      agentName: "code",
      timestamp: 1000,
      trigger: "t1",
      addition: "a1",
      taskType: "debug-typescript",
      performanceBefore: 0.5,
      status: "active",
    }
    await PromptEvolution.apply(base)
    await PromptEvolution.apply({ ...base, id: "h2", timestamp: 2000 })
    await PromptEvolution.apply({ ...base, id: "h3", agentName: "explore", timestamp: 3000 })

    const codeHistory = await PromptEvolution.history("code")
    expect(codeHistory).toHaveLength(2)
    // Most recent first
    expect(codeHistory[0].id).toBe("h2")
    expect(codeHistory[1].id).toBe("h1")

    const exploreHistory = await PromptEvolution.history("explore")
    expect(exploreHistory).toHaveLength(1)
    expect(exploreHistory[0].id).toBe("h3")
  })

  test("activeMutations returns only active mutations for the agent", async () => {
    const base: PromptEvolution.Mutation = {
      id: "a1",
      agentName: "code",
      timestamp: Date.now(),
      trigger: "low rate",
      addition: "guidance 1",
      taskType: "debug-typescript",
      performanceBefore: 0.4,
      status: "active",
    }
    await PromptEvolution.apply(base)
    await PromptEvolution.apply({ ...base, id: "a2", addition: "guidance 2" })
    await PromptEvolution.apply({ ...base, id: "a3", agentName: "explore", addition: "guidance 3" })

    // Revert one
    await PromptEvolution.revert("a1")

    const active = await PromptEvolution.activeMutations("code")
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe("a2")
    expect(active[0].addition).toBe("guidance 2")
  })
})

// ── PromptEvolution JSONL resilience ───────────────────────────────────────

describe("PromptEvolution JSONL resilience", () => {
  test("handles missing file gracefully", async () => {
    const h = await PromptEvolution.history("code")
    expect(h).toEqual([])
  })

  test("handles corrupt lines in mutations file", async () => {
    const filepath = mutationsPath()
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    const valid: PromptEvolution.Mutation = {
      id: "v1",
      agentName: "code",
      timestamp: 1000,
      trigger: "test",
      addition: "guidance",
      taskType: "debug-typescript",
      performanceBefore: 0.5,
      status: "active",
    }
    const content = [JSON.stringify(valid), "not valid json", ""].join("\n")
    await fs.writeFile(filepath, content)

    const h = await PromptEvolution.history("code")
    expect(h).toHaveLength(1)
    expect(h[0].id).toBe("v1")
  })
})

// ── End-to-end: Strategy -> Evolution flow ─────────────────────────────────

describe("end-to-end: strategy data drives evolution", () => {
  test("recording enough failures triggers evolution check", async () => {
    // Record 2 successes and 6 failures for a task type
    for (let i = 0; i < 2; i++) {
      await Strategy.record(makeFragment({ outcome: "success", taskType: "deploy-docker" }))
    }
    for (let i = 0; i < 6; i++) {
      await Strategy.record(
        makeFragment({
          outcome: "failure",
          taskType: "deploy-docker",
          approach: `Failed attempt ${i}`,
          reflection: "Docker build failed due to missing dependency",
          toolSequence: ["bash:docker build", "read"],
        }),
      )
    }

    // Check should detect the low success rate
    const check = await PromptEvolution.check("code")
    expect(check.needsEvolution).toBe(true)
    expect(check.taskType).toBe("deploy-docker")

    // Query the failures
    const failures = await Strategy.query({
      taskType: "deploy-docker",
      outcome: "failure",
      limit: 10,
    })
    expect(failures.length).toBeGreaterThanOrEqual(5)

    // Generate and apply a mutation
    const mutation = await PromptEvolution.generateMutation("code", "deploy-docker", failures)
    expect(mutation.addition.length).toBeGreaterThan(0)
    expect(mutation.taskType).toBe("deploy-docker")

    await PromptEvolution.apply(mutation)

    // Verify the mutation is now active
    const active = await PromptEvolution.activeMutations("code")
    expect(active).toHaveLength(1)
    expect(active[0].taskType).toBe("deploy-docker")
  })
})
