// kilocode_change - Automatic Agent Router with scoring, selection, and performance learning
import { Log } from "@/util/log"
import { AgentCard } from "./card"
import { Agent } from "./agent"
import { Instance } from "../project/instance"
import { Filesystem } from "@/util/filesystem"
import path from "path"

const log = Log.create({ service: "agent-router" })

/** Cost multipliers per model tier, used to weight cheaper agents higher. */
const COST_FACTOR: Record<string, number> = {
  fast: 0.5,
  standard: 1.0,
  premium: 2.0,
}

/** Default success rate when no performance history exists for a task type. */
const DEFAULT_SUCCESS_RATE = 0.8

/** Minimum score threshold; agents scoring below this are not considered matches. */
const MIN_SCORE_THRESHOLD = 0.01

export namespace AgentRouter {
  export interface RouteResult {
    agent: string
    score: number
    reason: string
    alternatives: Array<{ agent: string; score: number }>
  }

  /**
   * Compute a relevance score (0-1) for a single skill against a user message.
   * Checks regex inputPatterns first, then falls back to fuzzy keyword matching
   * against the skill description and examples.
   */
  function scoreSkill(message: string, skill: AgentCard.Skill): number {
    const lower = message.toLowerCase()
    let patternHits = 0
    let totalPatterns = skill.inputPatterns.length

    // Phase 1: regex pattern matching
    for (const pattern of skill.inputPatterns) {
      try {
        const re = new RegExp(pattern, "i")
        if (re.test(message)) {
          patternHits++
        }
      } catch {
        // Skip invalid regex patterns without crashing the router
        log.warn("invalid regex in skill inputPattern", {
          skillId: skill.id,
          pattern,
        })
        totalPatterns--
      }
    }

    const patternScore = totalPatterns > 0 ? patternHits / totalPatterns : 0

    // Phase 2: fuzzy keyword matching against description + examples
    const descriptionWords = skill.description.toLowerCase().split(/\s+/)
    const exampleWords = skill.examples.flatMap((e) => e.toLowerCase().split(/\s+/))
    const allKeywords = [...new Set([...descriptionWords, ...exampleWords])]

    // Filter out common stop words that would inflate matches
    const stopWords = new Set([
      "a",
      "an",
      "the",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "shall",
      "can",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "and",
      "or",
      "not",
      "no",
      "but",
      "if",
      "then",
      "so",
      "as",
      "it",
      "its",
      "this",
      "that",
      "these",
      "those",
      "i",
      "me",
      "my",
      "we",
      "our",
      "you",
      "your",
    ])
    const meaningfulKeywords = allKeywords.filter((w) => w.length > 2 && !stopWords.has(w))

    let keywordHits = 0
    for (const keyword of meaningfulKeywords) {
      if (lower.includes(keyword)) {
        keywordHits++
      }
    }

    const keywordScore = meaningfulKeywords.length > 0 ? keywordHits / meaningfulKeywords.length : 0

    // Weighted combination: regex patterns are the primary signal, keywords are secondary
    return patternScore * 0.7 + keywordScore * 0.3
  }

  /**
   * Score an agent card against a user message.
   * Final score = relevanceScore * successRate * (1 / costFactor)
   *
   * - relevanceScore: best skill match (0-1) across all skills
   * - successRate: from performance history for the best-matching task type (default 0.8)
   * - costFactor: based on modelTier
   */
  export function scoreAgent(message: string, card: AgentCard.Info): number {
    if (card.skills.length === 0) return 0

    let bestSkillScore = 0
    let bestSkillId = ""

    for (const skill of card.skills) {
      const score = scoreSkill(message, skill)
      if (score > bestSkillScore) {
        bestSkillScore = score
        bestSkillId = skill.id
      }
    }

    // Look up success rate from performance history for the matching skill type
    let successRate = DEFAULT_SUCCESS_RATE
    if (bestSkillId) {
      const record = card.performanceHistory.find((r) => r.taskType === bestSkillId)
      if (record && record.sampleCount > 0) {
        successRate = record.successRate
      }
    }

    const costFactor = COST_FACTOR[card.costProfile.modelTier] ?? 1.0

    return bestSkillScore * successRate * (1 / costFactor)
  }

  /**
   * Select the best agent for a given user message.
   * Scores every registered agent and returns the top pick with alternatives.
   */
  export async function route(message: string): Promise<RouteResult> {
    const cards = AgentCard.defaultCards()
    const performanceData = await loadPerformance()

    // Merge persisted performance history into cards
    for (const [agentName, card] of Object.entries(cards)) {
      const history = performanceData[agentName]
      if (history && history.length > 0) {
        card.performanceHistory = history
      }
    }

    // Filter to only agents that actually exist in the current config
    const agents = await Agent.list()
    const agentNames = new Set(agents.map((a) => a.name))

    const scored: Array<{ agent: string; score: number }> = []

    for (const [agentName, card] of Object.entries(cards)) {
      if (!agentNames.has(agentName)) continue

      const agent = agents.find((a) => a.name === agentName)
      // Skip hidden, subagent-only, and deprecated agents
      if (agent && (agent.hidden || agent.deprecated)) continue
      if (agent && agent.mode === "subagent") continue

      const score = scoreAgent(message, card)
      scored.push({ agent: agentName, score })
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    const top = scored[0]
    if (!top || top.score < MIN_SCORE_THRESHOLD) {
      log.info("no strong agent match, defaulting to code", { message: message.slice(0, 80) })
      return {
        agent: "code",
        score: 0,
        reason: "No agent matched the message; defaulting to code agent.",
        alternatives: scored.filter((s) => s.agent !== "code"),
      }
    }

    // Build reason string explaining why this agent was selected
    const card = cards[top.agent]!
    const bestSkill = findBestSkill(message, card)
    const reason = bestSkill
      ? `Matched skill "${bestSkill.id}" (${bestSkill.description}) on agent "${top.agent}".`
      : `Agent "${top.agent}" scored highest based on keyword relevance.`

    log.info("routed message to agent", {
      agent: top.agent,
      score: top.score,
      reason,
      alternatives: scored.slice(1, 4).length,
    })

    return {
      agent: top.agent,
      score: top.score,
      reason,
      alternatives: scored.slice(1).filter((s) => s.score >= MIN_SCORE_THRESHOLD),
    }
  }

  /** Find the highest-scoring skill in a card for a message. */
  function findBestSkill(message: string, card: AgentCard.Info): AgentCard.Skill | undefined {
    let best: AgentCard.Skill | undefined
    let bestScore = 0
    for (const skill of card.skills) {
      const score = scoreSkill(message, skill)
      if (score > bestScore) {
        bestScore = score
        best = skill
      }
    }
    return bestScore > 0 ? best : undefined
  }

  // ── Performance persistence ──────────────────────────────────────────

  type PerformanceData = Record<string, AgentCard.PerformanceRecord[]>

  function performancePath(): string {
    return path.join(Instance.directory, ".kilo", "agent-performance.json")
  }

  /** Load performance history from disk. Returns empty record on missing/corrupt file. */
  async function loadPerformance(): Promise<PerformanceData> {
    const filePath = performancePath()
    try {
      const data: PerformanceData = await Filesystem.readJson(filePath)
      // Validate structure minimally — each value should be an array
      if (typeof data !== "object" || data === null) return {}
      for (const key of Object.keys(data)) {
        if (!Array.isArray(data[key])) {
          data[key] = []
        }
      }
      return data
    } catch {
      // File missing or corrupt — start fresh
      return {}
    }
  }

  /** Save performance history to disk. Creates the .kilo directory if needed. */
  async function savePerformance(data: PerformanceData): Promise<void> {
    const filePath = performancePath()
    try {
      await Filesystem.writeJson(filePath, data)
    } catch (err) {
      log.warn("failed to save agent performance data", { error: String(err) })
    }
  }

  /**
   * Record the outcome of a completed task to update performance history.
   * Loads persisted data, updates or creates the relevant record, and saves.
   */
  export async function recordOutcome(
    agentName: string,
    taskType: string,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const data = await loadPerformance()
    if (!data[agentName]) {
      data[agentName] = []
    }

    const records = data[agentName]!
    const existing = records.find((r) => r.taskType === taskType)

    if (existing) {
      // Incremental update: weighted running average
      const newCount = existing.sampleCount + 1
      existing.successRate = (existing.successRate * existing.sampleCount + (success ? 1 : 0)) / newCount
      existing.avgDuration = (existing.avgDuration * existing.sampleCount + durationMs) / newCount
      existing.sampleCount = newCount
    } else {
      records.push({
        taskType,
        successRate: success ? 1.0 : 0.0,
        avgDuration: durationMs,
        sampleCount: 1,
      })
    }

    await savePerformance(data)

    log.info("recorded agent outcome", {
      agent: agentName,
      taskType,
      success,
      durationMs,
      sampleCount: existing?.sampleCount ?? 1,
    })
  }
}
