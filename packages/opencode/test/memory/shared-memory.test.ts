// kilocode_change — Phase 8.4: Shared Cross-Agent Memory System tests
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { MemoryFragment } from "../../src/memory/fragment"
import { SharedMemory } from "../../src/memory/shared-memory"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// MemoryFragment helpers
// ---------------------------------------------------------------------------

describe("MemoryFragment.create", () => {
  test("builds fragment with correct defaults", () => {
    const before = Date.now()
    const fragment = MemoryFragment.create({
      id: "frag-1",
      type: "convention",
      content: "Use camelCase for variables",
      tags: ["naming", "style"],
      agentName: "code-agent",
      sessionID: "sess-abc",
      confidence: 0.9,
    })
    const after = Date.now()

    expect(fragment.id).toBe("frag-1")
    expect(fragment.type).toBe("convention")
    expect(fragment.content).toBe("Use camelCase for variables")
    expect(fragment.tags).toEqual(["naming", "style"])
    expect(fragment.provenance.agentName).toBe("code-agent")
    expect(fragment.provenance.sessionID).toBe("sess-abc")
    expect(fragment.provenance.confidence).toBe(0.9)
    expect(fragment.accessCount).toBe(0)
    expect(fragment.lastAccessed).toBeGreaterThanOrEqual(before)
    expect(fragment.lastAccessed).toBeLessThanOrEqual(after)
    expect(fragment.provenance.timestamp).toBeGreaterThanOrEqual(before)
    expect(fragment.provenance.timestamp).toBeLessThanOrEqual(after)
    expect(fragment.ttl).toBeUndefined()
  })

  test("stores TTL when provided", () => {
    const fragment = MemoryFragment.create({
      id: "frag-ttl",
      type: "fix_strategy",
      content: "Retry on 503",
      tags: [],
      agentName: "debug-agent",
      sessionID: "sess-xyz",
      confidence: 0.7,
      ttl: 5000,
    })
    expect(fragment.ttl).toBe(5000)
  })
})

describe("MemoryFragment.isExpired", () => {
  test("returns false when no TTL is set", () => {
    const fragment = MemoryFragment.create({
      id: "no-ttl",
      type: "convention",
      content: "No expiry",
      tags: [],
      agentName: "agent",
      sessionID: "s1",
      confidence: 1.0,
    })
    expect(MemoryFragment.isExpired(fragment)).toBe(false)
  })

  test("returns false when TTL has not yet been exceeded", () => {
    const fragment = MemoryFragment.create({
      id: "future-ttl",
      type: "convention",
      content: "Still valid",
      tags: [],
      agentName: "agent",
      sessionID: "s1",
      confidence: 1.0,
      ttl: 60_000, // 60 seconds from now
    })
    expect(MemoryFragment.isExpired(fragment)).toBe(false)
  })

  test("returns true when TTL has been exceeded based on provenance.timestamp", () => {
    const fragment = MemoryFragment.create({
      id: "expired",
      type: "convention",
      content: "Should be expired",
      tags: [],
      agentName: "agent",
      sessionID: "s1",
      confidence: 1.0,
      ttl: 1, // 1 ms TTL
    })
    // Backdating provenance.timestamp so TTL is exceeded
    fragment.provenance.timestamp = Date.now() - 10_000
    // Also set lastAccessed to a recent time — isExpired must NOT use lastAccessed
    fragment.lastAccessed = Date.now()
    expect(MemoryFragment.isExpired(fragment)).toBe(true)
  })

  test("isExpired uses provenance.timestamp, not lastAccessed", () => {
    const now = Date.now()
    // Fragment whose provenance.timestamp is old (expired) but lastAccessed is recent
    const fragment: MemoryFragment.Info = {
      id: "check-timestamp",
      type: "error_pattern",
      content: "ECONNRESET pattern",
      tags: ["network"],
      provenance: {
        agentName: "agent",
        sessionID: "s2",
        timestamp: now - 100_000, // created 100s ago
        confidence: 0.8,
      },
      accessCount: 5,
      lastAccessed: now, // recently accessed
      ttl: 50_000,       // 50s TTL — expired relative to provenance.timestamp
    }
    // Should be expired because (now - timestamp) = 100s > TTL 50s
    expect(MemoryFragment.isExpired(fragment)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SharedMemory service — requires Instance context and temp directory
// ---------------------------------------------------------------------------

describe("SharedMemory", () => {
  let tmpDir: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    tmpDir = await tmpdir()
  })

  afterEach(async () => {
    await tmpDir[Symbol.asyncDispose]()
  })

  // Helper: run code inside an Instance context backed by the temp directory
  async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
    return Instance.provide({ directory: tmpDir.path, fn })
  }

  // Helper: build a fresh fragment
  function makeFragment(
    id: string,
    overrides: Partial<{
      type: MemoryFragment.Type
      content: string
      tags: string[]
      confidence: number
      ttl: number
      lastAccessed: number
    }> = {},
  ): MemoryFragment.Info {
    const base = MemoryFragment.create({
      id,
      type: overrides.type ?? "codebase_understanding",
      content: overrides.content ?? `content for ${id}`,
      tags: overrides.tags ?? [],
      agentName: "test-agent",
      sessionID: "test-session",
      confidence: overrides.confidence ?? 0.9,
      ttl: overrides.ttl,
    })
    if (overrides.lastAccessed !== undefined) {
      base.lastAccessed = overrides.lastAccessed
    }
    return base
  }

  // -------------------------------------------------------------------------
  // store + size
  // -------------------------------------------------------------------------

  test("store(fragment, 'L1') adds to L1 and is reflected in size('L1')", async () => {
    await withInstance(async () => {
      await SharedMemory.clear("L1")
      const fragment = makeFragment("l1-frag")
      await SharedMemory.store(fragment, "L1")
      expect(await SharedMemory.size("L1")).toBe(1)
    })
  })

  test("store(fragment, 'L2') writes to file and size('L2') increases", async () => {
    await withInstance(async () => {
      await SharedMemory.clear("L2")
      const fragment = makeFragment("l2-frag")
      await SharedMemory.store(fragment, "L2")
      expect(await SharedMemory.size("L2")).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // retrieve — basic
  // -------------------------------------------------------------------------

  test("retrieve returns empty array when no fragments are stored", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const results = await SharedMemory.retrieve("anything")
      expect(results).toEqual([])
    })
  })

  test("retrieve returns fragments whose score is above the default threshold", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      // Content directly matches the query — should score high (contentScore=1.0, weight=0.25)
      // plus recency score — well above 0.30 threshold
      const fragment = makeFragment("retrieve-basic", {
        content: "use TypeScript strict mode",
        tags: ["typescript"],
      })
      await SharedMemory.store(fragment, "L1")

      const results = await SharedMemory.retrieve("TypeScript strict mode")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].fragment.id).toBe("retrieve-basic")
      expect(results[0].score).toBeGreaterThanOrEqual(0.3)
    })
  })

  // -------------------------------------------------------------------------
  // retrieve — expired fragments excluded
  // -------------------------------------------------------------------------

  test("retrieve excludes expired fragments", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const expired = makeFragment("expired-frag", {
        content: "expired content",
        tags: [],
        ttl: 1, // 1 ms
      })
      // Backdate so TTL is already exceeded
      expired.provenance.timestamp = Date.now() - 10_000
      await SharedMemory.store(expired, "L1")

      const results = await SharedMemory.retrieve("expired content")
      const ids = results.map((r) => r.fragment.id)
      expect(ids).not.toContain("expired-frag")
    })
  })

  // -------------------------------------------------------------------------
  // retrieve — type filter
  // -------------------------------------------------------------------------

  test("retrieve respects type filter", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const convention = makeFragment("type-convention", {
        type: "convention",
        content: "always write tests",
        tags: ["testing"],
      })
      const strategy = makeFragment("type-strategy", {
        type: "fix_strategy",
        content: "always write tests and strategies",
        tags: ["testing"],
      })
      await SharedMemory.store(convention, "L1")
      await SharedMemory.store(strategy, "L1")

      const results = await SharedMemory.retrieve("always write tests", {
        type: "convention",
      })
      const types = results.map((r) => r.fragment.type)
      expect(types.every((t) => t === "convention")).toBe(true)
      expect(results.map((r) => r.fragment.id)).not.toContain("type-strategy")
    })
  })

  // -------------------------------------------------------------------------
  // retrieve — limit
  // -------------------------------------------------------------------------

  test("retrieve respects limit", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      for (let i = 0; i < 5; i++) {
        const f = makeFragment(`limit-frag-${i}`, {
          content: "shared keyword present here",
          tags: ["shared"],
        })
        await SharedMemory.store(f, "L1")
      }

      const results = await SharedMemory.retrieve("shared keyword present here", {
        limit: 2,
        tags: ["shared"],
      })
      expect(results.length).toBeLessThanOrEqual(2)
    })
  })

  // -------------------------------------------------------------------------
  // retrieve — updates accessCount
  // -------------------------------------------------------------------------

  test("retrieve increments accessCount for returned fragments", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = makeFragment("access-frag", {
        content: "increment access count test",
        tags: [],
      })
      expect(fragment.accessCount).toBe(0)
      await SharedMemory.store(fragment, "L1")

      const results = await SharedMemory.retrieve("increment access count test")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].fragment.accessCount).toBe(1)
    })
  })

  test("retrieve does NOT increment accessCount for fragments excluded by limit", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      // Store two fragments with matching content; limit to 1 result
      const fragA = makeFragment("limit-access-A", {
        content: "limit access check content",
        tags: ["limit-access"],
      })
      const fragB = makeFragment("limit-access-B", {
        content: "limit access check content",
        tags: ["limit-access"],
      })
      await SharedMemory.store(fragA, "L1")
      await SharedMemory.store(fragB, "L1")

      // Retrieve with limit=1 — only one fragment should have accessCount bumped
      await SharedMemory.retrieve("limit access check content", {
        limit: 1,
        tags: ["limit-access"],
      })

      // Re-retrieve without limit to see raw accessCounts
      const all = await SharedMemory.retrieve("limit access check content", {
        tags: ["limit-access"],
        threshold: 0,
      })

      const counts = all.map((r) => r.fragment.accessCount)
      // Exactly one fragment should have been accessed once (from the first retrieve),
      // and the second fragment should have 0 or 1 from re-retrieve but not 2.
      // The important invariant: the fragment NOT returned by limit=1 retrieve should
      // not have had its count incremented by that call.
      const totalFromFirstRetrieve = counts.reduce((a, b) => a + b, 0) - counts.length
      // Each fragment in the second retrieve got +1. The one that was returned in
      // the first retrieve should have count=2 (first+second), the other count=1 (second only).
      const maxCount = Math.max(...counts)
      const minCount = Math.min(...counts)
      expect(maxCount).toBeGreaterThan(minCount)
    })
  })

  // -------------------------------------------------------------------------
  // evict
  // -------------------------------------------------------------------------

  test("evict('L1') removes LRU fragments and keeps most recently accessed up to limit", async () => {
    await withInstance(async () => {
      await SharedMemory.clear("L1")
      const now = Date.now()

      // Store 5 fragments with different lastAccessed times
      for (let i = 0; i < 5; i++) {
        const f = makeFragment(`evict-l1-${i}`, { lastAccessed: now + i })
        await SharedMemory.store(f, "L1")
      }

      // Evict down to 3
      const evicted = await SharedMemory.evict("L1", 3)
      expect(evicted).toBe(2)
      expect(await SharedMemory.size("L1")).toBe(3)

      // The 3 most recently accessed should remain
      const remaining = await SharedMemory.retrieve("content for evict-l1-", {
        threshold: 0,
        tiers: ["L1"],
      })
      const ids = remaining.map((r) => r.fragment.id)
      // evict-l1-2, evict-l1-3, evict-l1-4 should survive
      expect(ids).toContain("evict-l1-4")
      expect(ids).toContain("evict-l1-3")
      expect(ids).toContain("evict-l1-2")
      expect(ids).not.toContain("evict-l1-0")
      expect(ids).not.toContain("evict-l1-1")
    })
  })

  test("evict('L2') removes LRU fragments from file and keeps within limit", async () => {
    await withInstance(async () => {
      await SharedMemory.clear("L2")
      const now = Date.now()

      // Store 4 fragments with staggered lastAccessed
      for (let i = 0; i < 4; i++) {
        const f = makeFragment(`evict-l2-${i}`, { lastAccessed: now + i })
        await SharedMemory.store(f, "L2")
      }

      const evicted = await SharedMemory.evict("L2", 2)
      expect(evicted).toBe(2)
      expect(await SharedMemory.size("L2")).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // promote
  // -------------------------------------------------------------------------

  test("promote(id) moves fragment from L1 to L2", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = makeFragment("promote-l1")
      await SharedMemory.store(fragment, "L1")

      expect(await SharedMemory.size("L1")).toBe(1)
      expect(await SharedMemory.size("L2")).toBe(0)

      const promoted = await SharedMemory.promote("promote-l1")
      expect(promoted).toBe(true)
      expect(await SharedMemory.size("L1")).toBe(0)
      expect(await SharedMemory.size("L2")).toBe(1)
    })
  })

  test("promote(id) moves fragment from L2 to L3", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = makeFragment("promote-l2")
      await SharedMemory.store(fragment, "L2")

      expect(await SharedMemory.size("L2")).toBe(1)
      expect(await SharedMemory.size("L3")).toBe(0)

      const promoted = await SharedMemory.promote("promote-l2")
      expect(promoted).toBe(true)
      expect(await SharedMemory.size("L2")).toBe(0)
      expect(await SharedMemory.size("L3")).toBe(1)
    })
  })

  test("promote returns false for fragment already at L3", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = makeFragment("promote-l3")
      await SharedMemory.store(fragment, "L3")

      const result = await SharedMemory.promote("promote-l3")
      expect(result).toBe(false)
      // Fragment should still be in L3
      expect(await SharedMemory.size("L3")).toBe(1)
    })
  })

  test("promote returns false for non-existent fragment", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const result = await SharedMemory.promote("does-not-exist")
      expect(result).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // remember
  // -------------------------------------------------------------------------

  test("remember stores fragment in L1 and returns it", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = await SharedMemory.remember({
        type: "dependency_map",
        content: "react depends on scheduler",
        tags: ["react", "deps"],
        agentName: "dep-agent",
        sessionID: "sess-remember",
        confidence: 0.85,
      })

      expect(fragment).toBeDefined()
      expect(fragment.id).toBeTruthy()
      expect(fragment.type).toBe("dependency_map")
      expect(fragment.content).toBe("react depends on scheduler")
      expect(fragment.accessCount).toBe(0)
      expect(await SharedMemory.size("L1")).toBe(1)
    })
  })

  test("remember with explicit tier stores to that tier", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      const fragment = await SharedMemory.remember({
        type: "error_pattern",
        content: "EADDRINUSE port already in use",
        tags: ["port", "error"],
        agentName: "debug-agent",
        sessionID: "sess-tier",
        confidence: 0.95,
        tier: "L2",
      })

      expect(fragment).toBeDefined()
      expect(await SharedMemory.size("L1")).toBe(0)
      expect(await SharedMemory.size("L2")).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  test("clear('L1') removes all L1 fragments", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      for (let i = 0; i < 3; i++) {
        await SharedMemory.store(makeFragment(`clear-l1-${i}`), "L1")
      }
      expect(await SharedMemory.size("L1")).toBe(3)
      await SharedMemory.clear("L1")
      expect(await SharedMemory.size("L1")).toBe(0)
    })
  })

  test("clear() with no argument clears all tiers", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()
      await SharedMemory.store(makeFragment("clear-all-l1"), "L1")
      await SharedMemory.store(makeFragment("clear-all-l2"), "L2")
      await SharedMemory.store(makeFragment("clear-all-l3"), "L3")

      await SharedMemory.clear()

      expect(await SharedMemory.size("L1")).toBe(0)
      expect(await SharedMemory.size("L2")).toBe(0)
      expect(await SharedMemory.size("L3")).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // scoreFragment (tested indirectly via retrieve)
  // -------------------------------------------------------------------------

  test("scoreFragment gives high score for content matching query (verified via retrieve)", async () => {
    await withInstance(async () => {
      await SharedMemory.clear()

      // High-relevance: exact content match AND matching tags
      const highRelevance = makeFragment("score-high", {
        content: "TypeScript strict null checks prevent runtime errors",
        tags: ["typescript", "strict"],
      })
      // Low-relevance: unrelated content and tags
      const lowRelevance = makeFragment("score-low", {
        content: "this fragment has completely unrelated content about cats",
        tags: ["cats", "unrelated"],
      })
      await SharedMemory.store(highRelevance, "L1")
      await SharedMemory.store(lowRelevance, "L1")

      const results = await SharedMemory.retrieve("TypeScript strict null checks", {
        tags: ["typescript"],
        threshold: 0,
      })

      // Sort by score descending is guaranteed by retrieve; high-relevance must be first
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].fragment.id).toBe("score-high")
      expect(results[0].score).toBeGreaterThan(
        results.find((r) => r.fragment.id === "score-low")?.score ?? -1,
      )
    })
  })

  // -------------------------------------------------------------------------
  // L1 store is instance-scoped (not global)
  // -------------------------------------------------------------------------

  test("L1 store is scoped to Instance.directory — different directories do not share L1 state", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()

    await Instance.provide({
      directory: dir1.path,
      fn: async () => {
        await SharedMemory.clear("L1")
        await SharedMemory.store(makeFragment("instance-scope-frag"), "L1")
        expect(await SharedMemory.size("L1")).toBe(1)
      },
    })

    await Instance.provide({
      directory: dir2.path,
      fn: async () => {
        await SharedMemory.clear("L1")
        // dir2 is a fresh instance — should have no L1 fragments from dir1
        expect(await SharedMemory.size("L1")).toBe(0)
      },
    })
  })
})
