// kilocode_change — new file
// Self-evolving agent strategies: records task outcomes, computes success rates,
// and provides guidance to agents based on historical performance data.

import z from "zod"
import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { Log } from "../util/log"
import { Global } from "../global"

const log = Log.create({ service: "strategy" })

export namespace Strategy {
  export const Fragment = z
    .object({
      id: z.string(),
      taskType: z.string(), // "debug-typescript", "refactor-react", "deploy-docker"
      approach: z.string(), // Description of what was done
      toolSequence: z.array(z.string()), // ["grep", "read", "edit", "bash:npm test"]
      outcome: z.enum(["success", "failure", "partial"]),
      duration: z.number(), // ms
      tokenCost: z.number(), // Total tokens used
      reflection: z.string().optional(), // Why it worked/failed
      projectContext: z.object({
        language: z.string(), // "typescript", "python", etc.
        framework: z.string().optional(), // "react", "express", etc.
        projectSize: z.enum(["small", "medium", "large"]),
      }),
      timestamp: z.number(),
    })
    .meta({ ref: "StrategyFragment" })

  export type Fragment = z.infer<typeof Fragment>

  function storagePath(): string {
    return path.join(Global.Path.data, "strategies.jsonl")
  }

  /**
   * Read all strategy fragments from disk. Returns an empty array if the
   * file does not exist or is empty.
   */
  async function readAll(): Promise<Fragment[]> {
    const filepath = storagePath()
    let text: string
    try {
      text = await fs.readFile(filepath, "utf-8")
    } catch {
      return []
    }
    const fragments: Fragment[] = []
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        const parsed = Fragment.parse(JSON.parse(line))
        fragments.push(parsed)
      } catch {
        log.warn("skipping corrupt strategy fragment line")
      }
    }
    return fragments
  }

  /**
   * Append a single fragment as a JSON line to the strategies file.
   */
  async function appendLine(fragment: Fragment): Promise<void> {
    const filepath = storagePath()
    const dir = path.dirname(filepath)
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(filepath, JSON.stringify(fragment) + "\n")
  }

  /**
   * Store a completed strategy fragment. Assigns an id and timestamp
   * automatically, then appends to the JSONL file.
   */
  export async function record(fragment: Omit<Fragment, "id" | "timestamp">): Promise<Fragment> {
    const full: Fragment = {
      ...fragment,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }
    // Validate before persisting
    Fragment.parse(full)
    await appendLine(full)
    log.info("recorded strategy fragment", {
      id: full.id,
      taskType: full.taskType,
      outcome: full.outcome,
    })
    return full
  }

  /**
   * Compute a relevance score for a fragment against a set of filter criteria.
   * Higher score = more relevant. Used to sort query results.
   */
  function relevanceScore(
    fragment: Fragment,
    options: {
      taskType?: string
      language?: string
      framework?: string
    },
  ): number {
    let score = 0
    // Exact task type match is the strongest signal
    if (options.taskType && fragment.taskType === options.taskType) {
      score += 10
    }
    // Partial task type match (substring) is a weaker signal
    if (options.taskType && fragment.taskType !== options.taskType && fragment.taskType.includes(options.taskType)) {
      score += 3
    }
    // Language match
    if (options.language && fragment.projectContext.language === options.language) {
      score += 5
    }
    // Framework match
    if (options.framework && fragment.projectContext.framework === options.framework) {
      score += 4
    }
    // Recency bonus: fragments from the last 24h get a small boost
    const ageHours = (Date.now() - fragment.timestamp) / (1000 * 60 * 60)
    if (ageHours < 24) {
      score += 2
    } else if (ageHours < 168) {
      // Within the last week
      score += 1
    }
    return score
  }

  /**
   * Query strategies matching a task context. Results are sorted by relevance
   * (matching context + recency), then limited.
   */
  export async function query(options: {
    taskType?: string
    language?: string
    framework?: string
    outcome?: "success" | "failure" | "partial"
    limit?: number // default 5
  }): Promise<Fragment[]> {
    const limit = options.limit ?? 5
    const all = await readAll()

    const filtered = all.filter((f) => {
      if (options.outcome && f.outcome !== options.outcome) return false
      // At least one of the context filters must match for inclusion
      const hasContextFilter = options.taskType || options.language || options.framework
      if (hasContextFilter) {
        const matchesAny =
          (options.taskType && f.taskType.includes(options.taskType)) ||
          (options.language && f.projectContext.language === options.language) ||
          (options.framework && f.projectContext.framework === options.framework)
        if (!matchesAny) return false
      }
      return true
    })

    // Score and sort by relevance descending, then by recency as tiebreaker
    const scored = filtered.map((f) => ({
      fragment: f,
      score: relevanceScore(f, options),
    }))
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.fragment.timestamp - a.fragment.timestamp
    })

    return scored.slice(0, limit).map((s) => s.fragment)
  }

  /**
   * Get success rate for a task type. The `agentName` parameter is reserved
   * for future per-agent tracking; currently all fragments for the task type
   * are considered.
   *
   * Trend is computed by comparing the success rate of the last 10 completed
   * fragments against the 10 before those. A difference of more than 10
   * percentage points triggers "improving" or "declining".
   */
  export async function successRate(
    _agentName: string,
    taskType: string,
  ): Promise<{
    rate: number
    sampleCount: number
    trend: "improving" | "declining" | "stable"
  }> {
    const all = await readAll()
    const matching = all
      .filter((f) => f.taskType === taskType)
      .sort((a, b) => a.timestamp - b.timestamp)

    if (matching.length === 0) {
      return { rate: 0, sampleCount: 0, trend: "stable" }
    }

    const successCount = matching.filter((f) => f.outcome === "success").length
    const rate = successCount / matching.length

    // Compute trend from last 10 vs previous 10
    const recent = matching.slice(-10)
    const previous = matching.slice(-20, -10)
    const trend = computeTrend(recent, previous)

    return {
      rate: Math.round(rate * 100) / 100,
      sampleCount: matching.length,
      trend,
    }
  }

  /**
   * Compute trend direction from two sample windows.
   */
  function computeTrend(
    recent: Fragment[],
    previous: Fragment[],
  ): "improving" | "declining" | "stable" {
    if (recent.length < 2 || previous.length < 2) {
      return "stable"
    }
    const recentRate = recent.filter((f) => f.outcome === "success").length / recent.length
    const previousRate = previous.filter((f) => f.outcome === "success").length / previous.length
    const diff = recentRate - previousRate

    if (diff > 0.1) return "improving"
    if (diff < -0.1) return "declining"
    return "stable"
  }

  /**
   * Generate context injection for an agent starting a task. Analyzes past
   * successes and failures to produce actionable guidance.
   */
  export async function getGuidance(
    taskType: string,
    context: {
      language: string
      framework?: string
    },
  ): Promise<{
    successfulApproaches: string[]
    failedApproaches: string[]
    recommendedTools: string[]
  }> {
    const all = await readAll()

    // Filter to relevant fragments: same task type or same language+framework combo
    const relevant = all.filter((f) => {
      if (f.taskType === taskType) return true
      if (
        f.projectContext.language === context.language &&
        context.framework &&
        f.projectContext.framework === context.framework
      ) {
        return true
      }
      return false
    })

    // Separate successes and failures
    const successes = relevant.filter((f) => f.outcome === "success")
    const failures = relevant.filter((f) => f.outcome === "failure")

    // Extract unique approaches — deduplicate by approach text
    const successfulApproaches = deduplicateStrings(
      successes
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
        .map((f) => f.approach),
    ).slice(0, 5)

    const failedApproaches = deduplicateStrings(
      failures
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
        .map((f) => f.approach),
    ).slice(0, 5)

    // Recommend tools based on frequency in successful fragments
    const toolCounts = new Map<string, number>()
    for (const frag of successes) {
      for (const tool of frag.toolSequence) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1)
      }
    }
    // Penalize tools that appear frequently in failures
    for (const frag of failures) {
      for (const tool of frag.toolSequence) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) - 0.5)
      }
    }
    const recommendedTools = [...toolCounts.entries()]
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool]) => tool)

    return {
      successfulApproaches,
      failedApproaches,
      recommendedTools,
    }
  }

  /**
   * Remove duplicate strings while preserving order.
   */
  function deduplicateStrings(arr: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of arr) {
      const normalized = item.trim().toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push(item)
      }
    }
    return result
  }
}
