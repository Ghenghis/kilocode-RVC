// kilocode_change — LATS: Language Agent Tree Search engine
// Monte Carlo Tree Search for agent decision-making

import z from "zod"

export namespace TreeSearch {
  // kilocode_change — SearchNode schema: a single node in the search tree
  export const SearchNode = z
    .object({
      id: z.string(),
      parentID: z.string().nullable(),
      approach: z.string(),
      score: z.number(),
      visits: z.number(),
      children: z.array(z.string()),
      reflection: z.string().optional(),
      status: z.enum(["exploring", "evaluating", "failed", "succeeded"]),
      depth: z.number(),
      metadata: z
        .object({
          toolsUsed: z.array(z.string()).optional(),
          testsPass: z.boolean().optional(),
          compiles: z.boolean().optional(),
          tokenCost: z.number().optional(),
        })
        .optional(),
    })
    .meta({ ref: "SearchNode" })

  export type SearchNode = z.infer<typeof SearchNode>

  // kilocode_change — SearchTree schema: the full tree state
  export const SearchTree = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      rootNodeID: z.string(),
      nodes: z.record(z.string(), SearchNode),
      config: z.object({
        maxBranches: z.number(),
        maxDepth: z.number(),
        explorationWeight: z.number(),
      }),
      status: z.enum(["searching", "found", "exhausted"]),
      bestPath: z.array(z.string()).optional(),
      timestamp: z.number(),
    })
    .meta({ ref: "SearchTree" })

  export type SearchTree = z.infer<typeof SearchTree>
}
