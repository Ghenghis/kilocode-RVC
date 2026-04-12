// kilocode_change — new file
// Prompt evolution engine: detects when agents are underperforming,
// generates targeted prompt mutations from failure analysis, and tracks
// mutation lifecycle (active → validated / reverted).

import z from "zod"
import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { Log } from "../util/log"
import { Global } from "../global"
import { Strategy } from "./strategy"

const log = Log.create({ service: "evolution" })

/** Success rate threshold below which evolution is triggered */
const EVOLUTION_THRESHOLD = 0.7
/** Minimum number of fragments needed before evolution can trigger */
const MIN_SAMPLES = 5

export namespace PromptEvolution {
  export const Mutation = z
    .object({
      id: z.string(),
      agentName: z.string(),
      timestamp: z.number(),
      trigger: z.string(), // What caused this mutation
      addition: z.string(), // Text added to agent prompt
      taskType: z.string(), // Which task type this targets
      performanceBefore: z.number(), // Success rate before mutation
      performanceAfter: z.number().optional(), // Measured after N tasks
      status: z.enum(["active", "reverted", "validated"]),
    })
    .meta({ ref: "PromptMutation" })

  export type Mutation = z.infer<typeof Mutation>

  function storagePath(): string {
    return path.join(Global.Path.data, "evolution", "prompt-mutations.jsonl")
  }

  /**
   * Read all mutations from disk. Returns an empty array if the file does
   * not exist or is empty.
   */
  async function readAll(): Promise<Mutation[]> {
    const filepath = storagePath()
    let text: string
    try {
      text = await fs.readFile(filepath, "utf-8")
    } catch {
      return []
    }
    const mutations: Mutation[] = []
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        const parsed = Mutation.parse(JSON.parse(line))
        mutations.push(parsed)
      } catch {
        log.warn("skipping corrupt mutation line")
      }
    }
    return mutations
  }

  /**
   * Append a single mutation as a JSON line to the mutations file.
   */
  async function appendLine(mutation: Mutation): Promise<void> {
    const filepath = storagePath()
    const dir = path.dirname(filepath)
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(filepath, JSON.stringify(mutation) + "\n")
  }

  /**
   * Rewrite the entire mutations file. Used when we need to update a single
   * entry's status (e.g. revert or validate).
   */
  async function rewriteAll(mutations: Mutation[]): Promise<void> {
    const filepath = storagePath()
    const dir = path.dirname(filepath)
    await fs.mkdir(dir, { recursive: true })
    const content = mutations.map((m) => JSON.stringify(m)).join("\n") + "\n"
    await fs.writeFile(filepath, content)
  }

  /**
   * Check if an agent needs prompt evolution. Looks at the Strategy success
   * rates for the agent across all recorded task types. If any task type
   * with at least MIN_SAMPLES fragments has a success rate below
   * EVOLUTION_THRESHOLD, evolution is needed.
   */
  export async function check(agentName: string): Promise<{
    needsEvolution: boolean
    taskType?: string
    currentRate?: number
    threshold: number
  }> {
    // Collect all distinct task types from stored strategies
    const allFragments = await Strategy.query({ limit: 1000 })
    const taskTypes = new Set<string>()
    for (const f of allFragments) {
      taskTypes.add(f.taskType)
    }

    // Check each task type for underperformance
    for (const taskType of taskTypes) {
      const stats = await Strategy.successRate(agentName, taskType)
      if (stats.sampleCount >= MIN_SAMPLES && stats.rate < EVOLUTION_THRESHOLD) {
        log.info("evolution needed", {
          agentName,
          taskType,
          rate: stats.rate,
          sampleCount: stats.sampleCount,
        })
        return {
          needsEvolution: true,
          taskType,
          currentRate: stats.rate,
          threshold: EVOLUTION_THRESHOLD,
        }
      }
    }

    return {
      needsEvolution: false,
      threshold: EVOLUTION_THRESHOLD,
    }
  }

  /**
   * Analyze a set of failure fragments and extract common failure patterns.
   * Returns a structured summary of what went wrong.
   */
  function analyzeFailures(failures: Strategy.Fragment[]): {
    commonTools: string[]
    commonPatterns: string[]
    avgDuration: number
    avgTokenCost: number
  } {
    // Find tools that appear in more than half the failures
    const toolCounts = new Map<string, number>()
    for (const f of failures) {
      for (const tool of f.toolSequence) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1)
      }
    }
    const threshold = Math.max(1, Math.floor(failures.length / 2))
    const commonTools = [...toolCounts.entries()]
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([tool]) => tool)

    // Extract common patterns from reflections
    const reflections = failures
      .map((f) => f.reflection)
      .filter((r): r is string => !!r && r.trim().length > 0)

    const commonPatterns = extractPatterns(reflections)

    // Compute averages
    const avgDuration = failures.reduce((sum, f) => sum + f.duration, 0) / failures.length
    const avgTokenCost = failures.reduce((sum, f) => sum + f.tokenCost, 0) / failures.length

    return { commonTools, commonPatterns, avgDuration, avgTokenCost }
  }

  /**
   * Extract recurring themes from reflection strings. Looks for repeated
   * words/phrases across multiple reflections.
   */
  function extractPatterns(reflections: string[]): string[] {
    if (reflections.length === 0) return []

    // Tokenize reflections into meaningful phrases (3+ char words)
    const wordFrequency = new Map<string, number>()
    for (const text of reflections) {
      const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 3)

      // Count unique words per reflection to avoid one verbose reflection dominating
      const unique = new Set(words)
      for (const word of unique) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
      }
    }

    // Words appearing in more than half the reflections are "common patterns"
    const minAppearances = Math.max(2, Math.ceil(reflections.length / 2))
    const commonWords = [...wordFrequency.entries()]
      .filter(([_, count]) => count >= minAppearances)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word)

    if (commonWords.length === 0 && reflections.length > 0) {
      // Fallback: return the most common single reflection as a pattern hint
      return [reflections[0].slice(0, 120)]
    }

    return commonWords
  }

  /**
   * Generate a prompt mutation based on failure analysis. The generated
   * guidance is a concrete, actionable instruction string — not a generic
   * platitude.
   */
  export async function generateMutation(
    agentName: string,
    taskType: string,
    failures: Strategy.Fragment[],
  ): Promise<Mutation> {
    const stats = await Strategy.successRate(agentName, taskType)
    const analysis = analyzeFailures(failures)
    const guidance = await Strategy.getGuidance(taskType, {
      language: failures[0]?.projectContext.language ?? "unknown",
      framework: failures[0]?.projectContext.framework,
    })

    // Build a concrete guidance string from the analysis
    const parts: string[] = []

    parts.push(`[Auto-evolved guidance for "${taskType}" tasks]`)

    if (analysis.commonTools.length > 0) {
      parts.push(
        `When tools ${analysis.commonTools.join(", ")} are used together for ${taskType}, ` +
          `failures have been observed ${failures.length} times. ` +
          `Consider alternative tool sequences or verify intermediate results before proceeding.`,
      )
    }

    if (guidance.successfulApproaches.length > 0) {
      parts.push(
        `Previously successful approaches: ${guidance.successfulApproaches.slice(0, 3).join("; ")}.`,
      )
    }

    if (guidance.failedApproaches.length > 0) {
      parts.push(
        `Avoid these patterns which have failed: ${guidance.failedApproaches.slice(0, 3).join("; ")}.`,
      )
    }

    if (guidance.recommendedTools.length > 0) {
      parts.push(
        `Recommended tool sequence for this task type: ${guidance.recommendedTools.join(" -> ")}.`,
      )
    }

    if (analysis.commonPatterns.length > 0) {
      parts.push(
        `Common failure indicators: ${analysis.commonPatterns.join(", ")}. ` +
          `If you notice these patterns, stop and reconsider your approach.`,
      )
    }

    // Add performance context
    if (analysis.avgDuration > 60_000) {
      parts.push(
        `Past failures averaged ${Math.round(analysis.avgDuration / 1000)}s. ` +
          `If you exceed ${Math.round(analysis.avgDuration / 500)}s without progress, try a different strategy.`,
      )
    }

    const addition = parts.join("\n")

    const mutation: Mutation = {
      id: crypto.randomUUID(),
      agentName,
      timestamp: Date.now(),
      trigger: `Success rate ${Math.round(stats.rate * 100)}% < ${Math.round(EVOLUTION_THRESHOLD * 100)}% threshold for "${taskType}" (${failures.length} failures analyzed)`,
      addition,
      taskType,
      performanceBefore: stats.rate,
      status: "active",
    }

    Mutation.parse(mutation)

    log.info("generated prompt mutation", {
      id: mutation.id,
      agentName,
      taskType,
      performanceBefore: mutation.performanceBefore,
    })

    return mutation
  }

  /**
   * Apply a mutation by saving it to the JSONL file and marking it active.
   * The caller is responsible for injecting mutation.addition into the
   * agent's context at prompt assembly time.
   */
  export async function apply(mutation: Mutation): Promise<void> {
    const applied: Mutation = {
      ...mutation,
      status: "active",
    }
    await appendLine(applied)
    log.info("applied prompt mutation", {
      id: applied.id,
      agentName: applied.agentName,
      taskType: applied.taskType,
    })
  }

  /**
   * Revert a mutation that degraded performance. Updates the status field
   * in the JSONL file from "active" to "reverted".
   */
  export async function revert(mutationID: string): Promise<void> {
    const all = await readAll()
    let found = false
    const updated = all.map((m) => {
      if (m.id === mutationID) {
        found = true
        return { ...m, status: "reverted" as const }
      }
      return m
    })

    if (!found) {
      log.warn("mutation not found for revert", { mutationID })
      return
    }

    await rewriteAll(updated)
    log.info("reverted prompt mutation", { mutationID })
  }

  /**
   * Validate a mutation after confirming it improved performance. Updates
   * the status from "active" to "validated" and records the post-mutation
   * success rate.
   */
  export async function validate(mutationID: string, performanceAfter: number): Promise<void> {
    const all = await readAll()
    let found = false
    const updated = all.map((m) => {
      if (m.id === mutationID) {
        found = true
        return { ...m, status: "validated" as const, performanceAfter }
      }
      return m
    })

    if (!found) {
      log.warn("mutation not found for validation", { mutationID })
      return
    }

    await rewriteAll(updated)
    log.info("validated prompt mutation", { mutationID, performanceAfter })
  }

  /**
   * List all mutations for an agent, sorted by timestamp descending
   * (most recent first).
   */
  export async function history(agentName: string): Promise<Mutation[]> {
    const all = await readAll()
    return all
      .filter((m) => m.agentName === agentName)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get all active mutations for an agent. Used at prompt assembly time
   * to inject evolved guidance into the agent's system prompt.
   */
  export async function activeMutations(agentName: string): Promise<Mutation[]> {
    const all = await readAll()
    return all.filter((m) => m.agentName === agentName && m.status === "active")
  }
}
