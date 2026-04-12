// kilocode_change — Phase 8.4: Shared Cross-Agent Memory System
import z from "zod"

export namespace MemoryFragment {
  export const Type = z
    .enum([
      "codebase_understanding",
      "fix_strategy",
      "convention",
      "dependency_map",
      "error_pattern",
    ])
    .meta({ ref: "MemoryFragmentType" })
  export type Type = z.infer<typeof Type>

  export const Provenance = z
    .object({
      agentName: z.string().describe("The agent that contributed this fragment"),
      sessionID: z.string().describe("The session in which this fragment was created"),
      timestamp: z.number().describe("Unix timestamp (ms) when the fragment was created"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Confidence score from 0.0 to 1.0"),
    })
    .meta({ ref: "MemoryProvenance" })
  export type Provenance = z.infer<typeof Provenance>

  export const Tier = z
    .enum(["L1", "L2", "L3"])
    .meta({ ref: "MemoryTier" })
  export type Tier = z.infer<typeof Tier>

  export const Info = z
    .object({
      id: z.string().describe("Unique identifier for the fragment"),
      type: Type.describe("Category of knowledge stored"),
      content: z.string().describe("The knowledge content"),
      tags: z.array(z.string()).describe("Semantic tags for retrieval"),
      provenance: Provenance.describe("Origin metadata"),
      accessCount: z
        .number()
        .int()
        .min(0)
        .describe("How often this fragment has been retrieved"),
      lastAccessed: z
        .number()
        .describe("Unix timestamp (ms) of last retrieval"),
      ttl: z
        .number()
        .optional()
        .describe("Optional time-to-live in milliseconds"),
    })
    .meta({ ref: "MemoryFragment" })
  export type Info = z.infer<typeof Info>

  /**
   * Create a new MemoryFragment with sensible defaults.
   */
  export function create(input: {
    id: string
    type: Type
    content: string
    tags: string[]
    agentName: string
    sessionID: string
    confidence: number
    ttl?: number
  }): Info {
    const now = Date.now()
    return {
      id: input.id,
      type: input.type,
      content: input.content,
      tags: input.tags,
      provenance: {
        agentName: input.agentName,
        sessionID: input.sessionID,
        timestamp: now,
        confidence: input.confidence,
      },
      accessCount: 0,
      lastAccessed: now,
      ttl: input.ttl,
    }
  }

  /**
   * Check whether a fragment has expired based on its TTL.
   */
  export function isExpired(fragment: Info): boolean {
    if (fragment.ttl === undefined) return false
    return Date.now() - fragment.provenance.timestamp > fragment.ttl
  }
}
