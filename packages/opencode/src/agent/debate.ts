// kilocode_change - Phase 8.5: Multi-Agent Debate and Verification engine
import z from "zod"
import { Log } from "../util/log"
import { Glob } from "../util/glob"

const log = Log.create({ service: "debate" }) // kilocode_change

export namespace Debate {
  // kilocode_change start - critic verdict schema
  export const CriticVerdict = z
    .object({
      criticAgent: z.string(),
      severity: z.enum(["critical", "warning", "suggestion"]),
      confidence: z.number().min(0).max(1),
      issue: z.string(),
      location: z.string(),
      suggestion: z.string(),
      evidence: z.string(),
    })
    .meta({ ref: "CriticVerdict" })
  export type CriticVerdict = z.infer<typeof CriticVerdict>
  // kilocode_change end

  // kilocode_change start - debate result schema
  export const DebateResult = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      timestamp: z.number(),
      critiques: z.array(CriticVerdict),
      consensus: z.object({
        critical: z.array(CriticVerdict),
        warnings: z.array(CriticVerdict),
        suggestions: z.array(CriticVerdict),
      }),
      rounds: z.number(),
      participants: z.array(z.string()),
    })
    .meta({ ref: "DebateResult" })
  export type DebateResult = z.infer<typeof DebateResult>
  // kilocode_change end

  // kilocode_change start - file patterns that trigger each specialist critic
  const SECURITY_PATTERNS = [
    "**/auth/**",
    "**/security/**",
    "**/password/**",
    "**/token/**",
    "**/crypto/**",
    "**/*.env*",
    "**/login/**",
    "**/oauth/**",
    "**/session/**",
    "**/middleware/auth*",
  ]

  const PERFORMANCE_PATTERNS = [
    "**/api/**",
    "**/query/**",
    "**/database/**",
    "**/db/**",
    "**/*handler*",
    "**/resolver/**",
    "**/loader/**",
    "**/middleware/**",
    "**/*service*",
  ]

  const AUTO_DEBATE_PATTERNS = [
    ...SECURITY_PATTERNS,
    "**/payment/**",
    "**/billing/**",
    "**/checkout/**",
    "**/stripe/**",
    "**/webhook/**",
  ]
  // kilocode_change end

  /**
   * Match a file path against an array of glob patterns.
   * Returns true if the file matches any of the given patterns.
   */
  function matchesAny(filePath: string, patterns: string[]): boolean {
    const normalized = filePath.replace(/\\/g, "/") // kilocode_change - normalize Windows paths
    return patterns.some((pattern) => Glob.match(pattern, normalized))
  }

  /**
   * Determine which critic agents to invoke based on the set of changed files.
   * Architecture-skeptic and test-advocate are always included.
   * Security-reviewer is included when files touch auth/security/crypto paths.
   * Performance-critic is included when files touch API/database/handler paths.
   */
  export function selectCritics(changedFiles: string[]): string[] {
    const critics: string[] = ["architecture-skeptic", "test-advocate"] // kilocode_change - always included

    const needsSecurity = changedFiles.some((f) => matchesAny(f, SECURITY_PATTERNS))
    const needsPerformance = changedFiles.some((f) => matchesAny(f, PERFORMANCE_PATTERNS))

    if (needsSecurity) {
      critics.push("security-reviewer")
    }
    if (needsPerformance) {
      critics.push("performance-critic")
    }

    log.info("selected critics", {
      critics,
      fileCount: changedFiles.length,
      security: needsSecurity,
      performance: needsPerformance,
    })

    return critics
  }

  /**
   * Check if a file should trigger an automatic debate review.
   * Returns true for files matching security, auth, and payment patterns
   * where unreviewed changes carry the highest risk.
   */
  export function shouldAutoDebate(filePath: string): boolean {
    return matchesAny(filePath, AUTO_DEBATE_PATTERNS)
  }

  /**
   * Categorize an array of critic verdicts into critical/warnings/suggestions
   * buckets for the consensus object.
   */
  function buildConsensus(critiques: CriticVerdict[]): DebateResult["consensus"] {
    const critical: CriticVerdict[] = []
    const warnings: CriticVerdict[] = []
    const suggestions: CriticVerdict[] = []

    for (const verdict of critiques) {
      switch (verdict.severity) {
        case "critical":
          critical.push(verdict)
          break
        case "warning":
          warnings.push(verdict)
          break
        case "suggestion":
          suggestions.push(verdict)
          break
      }
    }

    // kilocode_change start - boost issues flagged by multiple critics
    // If the same location+issue is flagged by 2+ critics, elevate its severity
    const locationCounts = new Map<string, number>()
    for (const verdict of critiques) {
      const key = `${verdict.location}::${verdict.issue}`
      locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1)
    }

    // Move warnings to critical if flagged by multiple critics
    for (let i = warnings.length - 1; i >= 0; i--) {
      const verdict = warnings[i]
      const key = `${verdict.location}::${verdict.issue}`
      if ((locationCounts.get(key) ?? 0) >= 2) {
        warnings.splice(i, 1)
        critical.push(verdict)
      }
    }
    // kilocode_change end

    // Sort each tier by confidence descending so highest-confidence issues appear first
    const byConfidence = (a: CriticVerdict, b: CriticVerdict) => b.confidence - a.confidence
    critical.sort(byConfidence)
    warnings.sort(byConfidence)
    suggestions.sort(byConfidence)

    return { critical, warnings, suggestions }
  }

  /**
   * Run a debate: select critics based on changed files, prepare the structured
   * result with categorized verdicts. The actual LLM invocation of critic agents
   * is performed by the session processor — this module builds the data structures
   * and orchestration logic.
   *
   * @param options.sessionID - The session ID to associate the debate with
   * @param options.changedFiles - List of file paths that changed
   * @param options.diffContent - The unified diff content for review
   * @param options.maxRounds - Maximum debate rounds (default 2)
   * @param options.critiques - Pre-collected critic verdicts (from session processor)
   */
  export async function run(options: {
    sessionID: string
    changedFiles: string[]
    diffContent: string
    maxRounds?: number
    critiques?: CriticVerdict[]
  }): Promise<DebateResult> {
    const maxRounds = options.maxRounds ?? 2

    log.info("starting debate", {
      sessionID: options.sessionID,
      fileCount: options.changedFiles.length,
      diffLength: options.diffContent.length,
      maxRounds,
    })

    const participants = selectCritics(options.changedFiles)
    const critiques = options.critiques ?? []

    log.info("debate participants selected", {
      sessionID: options.sessionID,
      participants,
      critiqueCount: critiques.length,
    })

    // Build the consensus from collected critiques
    const consensus = buildConsensus(critiques)

    const result: DebateResult = {
      id: crypto.randomUUID(),
      sessionID: options.sessionID,
      timestamp: Date.now(),
      critiques,
      consensus,
      rounds: Math.min(maxRounds, critiques.length > 0 ? 1 : 0),
      participants,
    }

    log.info("debate complete", {
      id: result.id,
      sessionID: options.sessionID,
      critical: consensus.critical.length,
      warnings: consensus.warnings.length,
      suggestions: consensus.suggestions.length,
    })

    return result
  }
}
