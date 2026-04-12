// kilocode_change — Phase 8.4: Shared Cross-Agent Memory System
import fs from "fs/promises"
import path from "path"
import { ulid } from "ulid"
import z from "zod"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { MemoryFragment } from "./fragment"

const log = Log.create({ service: "shared-memory" })

export namespace SharedMemory {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const TIER_LIMITS: Record<MemoryFragment.Tier, number> = {
    L1: 100,
    L2: 1000,
    L3: 5000,
  }

  const DEFAULT_RELEVANCE_THRESHOLD = 0.3 // kilocode_change Bug 3: was 0.85 — unreachably high, making retrieve() effectively inert

  // ---------------------------------------------------------------------------
  // Retrieve options schema
  // ---------------------------------------------------------------------------

  export const RetrieveOptions = z
    .object({
      type: MemoryFragment.Type.optional().describe("Filter by fragment type"),
      tags: z.array(z.string()).optional().describe("Tags to match against"),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum relevance score (default 0.30)"), // kilocode_change Bug 3: updated from 0.85
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of results"),
      tiers: z
        .array(MemoryFragment.Tier)
        .optional()
        .describe("Tiers to search (defaults to all)"),
    })
    .meta({ ref: "SharedMemoryRetrieveOptions" })
  export type RetrieveOptions = z.infer<typeof RetrieveOptions>

  // ---------------------------------------------------------------------------
  // Scored result
  // ---------------------------------------------------------------------------

  export interface ScoredFragment {
    fragment: MemoryFragment.Info
    score: number
    tier: MemoryFragment.Tier
  }

  // ---------------------------------------------------------------------------
  // L1 — Agent-Local (in-memory, session-scoped)
  // ---------------------------------------------------------------------------

  // kilocode_change Bug 1: was module-level (shared across all project instances); now instance-scoped via Instance.state()
  const l1Store = Instance.state(() => new Map<string, MemoryFragment.Info>())

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  function l2Path(): string {
    return path.join(Instance.directory, ".kilo", "memory", "shared.jsonl")
  }

  function l3Path(): string {
    return path.join(Global.Path.data, "memory", "global.jsonl")
  }

  function pathForTier(tier: MemoryFragment.Tier): string | null {
    switch (tier) {
      case "L1":
        return null // in-memory only
      case "L2":
        return l2Path()
      case "L3":
        return l3Path()
    }
  }

  // ---------------------------------------------------------------------------
  // JSONL persistence helpers
  // ---------------------------------------------------------------------------

  /**
   * Append a single fragment as a JSON line to a JSONL file.
   * Creates parent directories if they do not exist.
   * Uses append mode so concurrent writers don't clobber the file.
   */
  async function appendToFile(
    filepath: string,
    fragment: MemoryFragment.Info,
  ): Promise<void> {
    const dir = path.dirname(filepath)
    await fs.mkdir(dir, { recursive: true })
    const line = JSON.stringify(fragment) + "\n"
    await fs.appendFile(filepath, line, "utf-8")
  }

  /**
   * Read all fragments from a JSONL file.
   * Returns an empty array if the file does not exist.
   * Silently skips malformed lines so a single corrupt entry never breaks reads.
   */
  async function readFile(
    filepath: string,
  ): Promise<MemoryFragment.Info[]> {
    let raw: string
    try {
      raw = await fs.readFile(filepath, "utf-8")
    } catch (err: any) {
      if (err?.code === "ENOENT") return []
      throw err
    }

    const fragments: MemoryFragment.Info[] = []
    const lines = raw.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const parsed = JSON.parse(trimmed)
        const result = MemoryFragment.Info.safeParse(parsed)
        if (result.success) {
          fragments.push(result.data)
        } else {
          log.warn("skipping malformed memory fragment line", {
            error: result.error.message,
          })
        }
      } catch {
        log.warn("skipping unparseable JSONL line", {
          linePreview: trimmed.slice(0, 80),
        })
      }
    }
    return fragments
  }

  /**
   * Atomically rewrite a JSONL file with the given fragments.
   * Writes to a temporary file first, then renames for crash safety.
   */
  async function rewriteFile(
    filepath: string,
    fragments: MemoryFragment.Info[],
  ): Promise<void> {
    const dir = path.dirname(filepath)
    await fs.mkdir(dir, { recursive: true })

    const tmpPath = filepath + ".tmp." + ulid()
    const content = fragments.map((f) => JSON.stringify(f)).join("\n") + "\n"
    await fs.writeFile(tmpPath, content, "utf-8")
    await fs.rename(tmpPath, filepath)
  }

  // ---------------------------------------------------------------------------
  // Relevance scoring
  // ---------------------------------------------------------------------------

  /**
   * Compute a relevance score for a fragment against a query + options.
   *
   * Scoring breakdown (all components normalized to 0-1):
   *   - Tag match:       0.50 weight — fraction of query tags found in fragment tags
   *   - Content match:   0.25 weight — 1.0 if query substring found, else 0.0
   *   - Recency:         0.15 weight — exponential decay over 7 days
   *   - Access frequency: 0.10 weight — log-scaled access count (cap 100)
   */
  function scoreFragment(
    fragment: MemoryFragment.Info,
    query: string,
    queryTags: string[],
  ): number {
    // Tag matching — case-insensitive exact match
    let tagScore = 0
    if (queryTags.length > 0) {
      const fragmentTagsLower = fragment.tags.map((t) => t.toLowerCase())
      let matched = 0
      for (const qt of queryTags) {
        if (fragmentTagsLower.includes(qt.toLowerCase())) {
          matched++
        }
      }
      tagScore = matched / queryTags.length
    }

    // Content matching — case-insensitive substring
    let contentScore = 0
    if (query.length > 0) {
      const queryLower = query.toLowerCase()
      const contentLower = fragment.content.toLowerCase()
      const tagsJoined = fragment.tags.join(" ").toLowerCase()

      if (contentLower.includes(queryLower)) {
        contentScore = 1.0
      } else if (tagsJoined.includes(queryLower)) {
        contentScore = 0.7
      } else {
        // Partial word matching: check if individual query words appear
        const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2)
        if (queryWords.length > 0) {
          let wordHits = 0
          for (const word of queryWords) {
            if (contentLower.includes(word) || tagsJoined.includes(word)) {
              wordHits++
            }
          }
          contentScore = wordHits / queryWords.length * 0.8
        }
      }
    }

    // Recency — exponential decay with 7-day half-life
    const ageMs = Date.now() - fragment.provenance.timestamp
    const halfLifeMs = 7 * 24 * 60 * 60 * 1000
    const recencyScore = Math.exp((-Math.LN2 * ageMs) / halfLifeMs)

    // Access frequency — log-scaled, capped at 100
    const clampedAccess = Math.min(fragment.accessCount, 100)
    const frequencyScore =
      clampedAccess > 0 ? Math.log(1 + clampedAccess) / Math.log(101) : 0

    // Weighted combination
    const score =
      tagScore * 0.5 +
      contentScore * 0.25 +
      recencyScore * 0.15 +
      frequencyScore * 0.1

    return score
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Store a memory fragment in the specified tier.
   * Defaults to L1 (agent-local / session-scoped).
   *
   * Automatically runs eviction if the tier exceeds its size limit after insertion.
   */
  export async function store(
    fragment: MemoryFragment.Info,
    tier: MemoryFragment.Tier = "L1",
  ): Promise<void> {
    log.info("storing memory fragment", {
      id: fragment.id,
      type: fragment.type,
      tier,
    })

    switch (tier) {
      case "L1":
        l1Store().set(fragment.id, fragment)
        if (l1Store().size > TIER_LIMITS.L1) {
          await evict("L1")
        }
        break
      case "L2":
        await appendToFile(l2Path(), fragment)
        // kilocode_change Bug 2: was missing eviction check for L2
        if ((await readFile(l2Path())).length > TIER_LIMITS.L2) {
          await evict("L2")
        }
        break
      case "L3":
        await appendToFile(l3Path(), fragment)
        // kilocode_change Bug 2: was missing eviction check for L3
        if ((await readFile(l3Path())).length > TIER_LIMITS.L3) {
          await evict("L3")
        }
        break
    }
  }

  /**
   * Retrieve memory fragments matching a query across tiers.
   *
   * Searches all requested tiers (default: L1 + L2 + L3), scores each fragment,
   * filters by threshold, and returns results sorted by descending relevance.
   *
   * Expired fragments (past TTL) are automatically excluded.
   * Retrieved fragments have their accessCount and lastAccessed updated.
   */
  export async function retrieve(
    query: string,
    options?: RetrieveOptions,
  ): Promise<ScoredFragment[]> {
    const threshold = options?.threshold ?? DEFAULT_RELEVANCE_THRESHOLD
    const limit = options?.limit
    const tiers = options?.tiers ?? (["L1", "L2", "L3"] as MemoryFragment.Tier[])
    const queryTags = options?.tags ?? []

    const results: ScoredFragment[] = []

    for (const tier of tiers) {
      const fragments = await fragmentsForTier(tier)
      for (const fragment of fragments) {
        // Skip expired fragments
        if (MemoryFragment.isExpired(fragment)) continue

        // Type filter
        if (options?.type && fragment.type !== options.type) continue

        const score = scoreFragment(fragment, query, queryTags)
        if (score >= threshold) {
          results.push({ fragment, score, tier })
        }
      }
    }

    // Sort by relevance descending
    results.sort((a, b) => b.score - a.score)

    // kilocode_change Bug 4: was updating access counts for ALL results before slicing,
    // inflating counts for fragments never returned to the caller.
    // Apply limit FIRST, then update access metadata only for actually returned fragments.
    const limited = limit !== undefined ? results.slice(0, limit) : results

    // Update access metadata only for actually returned fragments
    const now = Date.now()
    const accessUpdates = new Map<string, { accessCount: number; lastAccessed: number }>()
    for (const result of limited) {
      result.fragment.accessCount++
      result.fragment.lastAccessed = now
      if (result.tier !== "L1") {
        accessUpdates.set(result.fragment.id, {
          accessCount: result.fragment.accessCount,
          lastAccessed: result.fragment.lastAccessed,
        })
      }
      // For L1, the Map reference is already updated in-place.
    }

    // Flush access-count updates for persistent tiers (only if needed)
    const l2Dirty = limited.some((r) => r.tier === "L2")
    const l3Dirty = limited.some((r) => r.tier === "L3")
    if (l2Dirty) {
      await flushTier("L2", accessUpdates)
    }
    if (l3Dirty) {
      await flushTier("L3", accessUpdates)
    }

    return limited
  }

  /**
   * Promote a fragment from its current tier to the next higher tier.
   * L1 -> L2 -> L3. Fragments already at L3 cannot be promoted further.
   *
   * The fragment is removed from its current tier and stored in the next.
   */
  export async function promote(fragmentID: string): Promise<boolean> {
    // Check L1 first
    const l1Fragment = l1Store().get(fragmentID)
    if (l1Fragment) {
      l1Store().delete(fragmentID)
      await store(l1Fragment, "L2")
      log.info("promoted fragment L1 -> L2", { id: fragmentID })
      return true
    }

    // Check L2
    const l2Fragments = await readFile(l2Path())
    const l2Index = l2Fragments.findIndex((f) => f.id === fragmentID)
    if (l2Index >= 0) {
      const fragment = l2Fragments[l2Index]
      l2Fragments.splice(l2Index, 1)
      await rewriteFile(l2Path(), l2Fragments)
      await store(fragment, "L3")
      log.info("promoted fragment L2 -> L3", { id: fragmentID })
      return true
    }

    // Already L3 or not found
    const l3Fragments = await readFile(l3Path())
    const inL3 = l3Fragments.some((f) => f.id === fragmentID)
    if (inL3) {
      log.warn("fragment already at highest tier L3", { id: fragmentID })
      return false
    }

    log.warn("fragment not found for promotion", { id: fragmentID })
    return false
  }

  /**
   * Evict least-recently-used fragments from a tier to bring it within its size limit.
   *
   * Eviction order: expired first, then by lastAccessed ascending (oldest access first).
   */
  export async function evict(
    tier: MemoryFragment.Tier,
    maxSize?: number,
  ): Promise<number> {
    const limit = maxSize ?? TIER_LIMITS[tier]

    if (tier === "L1") {
      return evictL1(limit)
    }

    const filepath = pathForTier(tier)!
    const fragments = await readFile(filepath)

    if (fragments.length <= limit) return 0

    // Separate expired and non-expired
    const expired: MemoryFragment.Info[] = []
    const valid: MemoryFragment.Info[] = []
    for (const f of fragments) {
      if (MemoryFragment.isExpired(f)) {
        expired.push(f)
      } else {
        valid.push(f)
      }
    }

    // If removing expired alone brings us under limit, just do that
    if (valid.length <= limit) {
      await rewriteFile(filepath, valid)
      log.info("evicted expired fragments", {
        tier,
        evicted: expired.length,
      })
      return expired.length
    }

    // Sort valid fragments by lastAccessed ascending (LRU order)
    valid.sort((a, b) => a.lastAccessed - b.lastAccessed)

    // Keep only the most recently accessed up to the limit
    const toKeep = valid.slice(valid.length - limit)
    const evictedCount = fragments.length - toKeep.length

    await rewriteFile(filepath, toKeep)
    log.info("evicted fragments via LRU", {
      tier,
      evicted: evictedCount,
      remaining: toKeep.length,
    })
    return evictedCount
  }

  /**
   * Clear a specific tier, or all tiers if none specified.
   */
  export async function clear(tier?: MemoryFragment.Tier): Promise<void> {
    if (!tier || tier === "L1") {
      l1Store().clear()
      log.info("cleared L1 memory")
    }

    if (!tier || tier === "L2") {
      try {
        await fs.unlink(l2Path())
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err
      }
      log.info("cleared L2 memory")
    }

    if (!tier || tier === "L3") {
      try {
        await fs.unlink(l3Path())
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err
      }
      log.info("cleared L3 memory")
    }
  }

  /**
   * Get the current size (fragment count) of a tier.
   */
  export async function size(tier: MemoryFragment.Tier): Promise<number> {
    const fragments = await fragmentsForTier(tier)
    return fragments.length
  }

  /**
   * Create a new fragment with a generated ID and store it.
   * Convenience wrapper combining MemoryFragment.create + SharedMemory.store.
   */
  export async function remember(input: {
    type: MemoryFragment.Type
    content: string
    tags: string[]
    agentName: string
    sessionID: string
    confidence: number
    tier?: MemoryFragment.Tier
    ttl?: number
  }): Promise<MemoryFragment.Info> {
    const fragment = MemoryFragment.create({
      id: ulid(),
      type: input.type,
      content: input.content,
      tags: input.tags,
      agentName: input.agentName,
      sessionID: input.sessionID,
      confidence: input.confidence,
      ttl: input.ttl,
    })
    await store(fragment, input.tier ?? "L1")
    return fragment
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Load all fragments for a tier.
   */
  async function fragmentsForTier(
    tier: MemoryFragment.Tier,
  ): Promise<MemoryFragment.Info[]> {
    switch (tier) {
      case "L1":
        return Array.from(l1Store().values())
      case "L2":
        return readFile(l2Path())
      case "L3":
        return readFile(l3Path())
    }
  }

  /**
   * Flush access-count updates for a persistent tier back to disk.
   * Reads the current file, applies the pending updates, then rewrites.
   */ // kilocode_change — fixed: previously re-read from disk without applying updates
  async function flushTier(
    tier: "L2" | "L3",
    updates: Map<string, { accessCount: number; lastAccessed: number }>,
  ): Promise<void> {
    const filepath = pathForTier(tier)!
    const fragments = await readFile(filepath)
    if (fragments.length === 0) return
    for (const f of fragments) {
      const upd = updates.get(f.id)
      if (upd) {
        f.accessCount = upd.accessCount
        f.lastAccessed = upd.lastAccessed
      }
    }
    await rewriteFile(filepath, fragments)
  }

  /**
   * LRU eviction for the L1 in-memory tier.
   */
  function evictL1(limit: number): number {
    if (l1Store().size <= limit) return 0

    // Convert to array and sort by lastAccessed ascending
    const entries = Array.from(l1Store().entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed,
    )

    // Remove expired first
    const expiredIds: string[] = []
    for (const [id, fragment] of entries) {
      if (MemoryFragment.isExpired(fragment)) {
        expiredIds.push(id)
      }
    }
    for (const id of expiredIds) {
      l1Store().delete(id)
    }

    if (l1Store().size <= limit) {
      log.info("evicted expired fragments from L1", {
        evicted: expiredIds.length,
      })
      return expiredIds.length
    }

    // Still over limit — evict by LRU
    const remaining = Array.from(l1Store().entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed,
    )
    const toEvict = remaining.length - limit
    let evicted = 0
    for (let i = 0; i < toEvict; i++) {
      l1Store().delete(remaining[i][0])
      evicted++
    }

    const total = expiredIds.length + evicted
    log.info("evicted fragments from L1 via LRU", {
      evicted: total,
      remaining: l1Store().size,
    })
    return total
  }
}
