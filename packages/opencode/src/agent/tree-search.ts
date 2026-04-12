// kilocode_change — LATS: Language Agent Tree Search engine
// Monte Carlo Tree Search for agent decision-making

import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "tree-search" }) // kilocode_change

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

  // kilocode_change — UCT formula: V(s) + w * sqrt(ln N(parent) / N(s))
  // Unvisited nodes get +Infinity so they are always selected first.
  export function uctScore(node: SearchNode, parent: SearchNode, explorationWeight: number): number {
    if (node.visits === 0) {
      return Infinity
    }
    if (parent.visits === 0) {
      return node.score
    }
    const exploitation = node.score
    const exploration = explorationWeight * Math.sqrt(Math.log(parent.visits) / node.visits)
    return exploitation + exploration
  }

  // kilocode_change — Selection: traverse from root using UCT to find the most promising leaf node
  export function select(tree: SearchTree): SearchNode {
    const root = tree.nodes[tree.rootNodeID]
    if (!root) {
      throw new Error("Root node not found in tree")
    }

    let current = root

    while (current.children.length > 0) {
      // If any child is unvisited, pick it immediately
      let bestChild: SearchNode | undefined
      let bestUCT = -Infinity

      for (const childID of current.children) {
        const child = tree.nodes[childID]
        if (!child) continue

        // Skip terminal nodes (failed/succeeded) — they cannot be explored further
        if (child.status === "failed" || child.status === "succeeded") continue

        const uct = uctScore(child, current, tree.config.explorationWeight)
        if (uct > bestUCT) {
          bestUCT = uct
          bestChild = child
        }
      }

      // If no explorable children found, return current (all children are terminal)
      if (!bestChild) {
        return current
      }

      // If the best child is unvisited (UCT = Infinity), return it as the leaf to explore
      if (bestChild.visits === 0) {
        return bestChild
      }

      current = bestChild
    }

    // Reached a leaf node (no children)
    return current
  }

  // kilocode_change — Expansion: create child nodes for a given node
  // `approaches` contains descriptions of different strategies to try.
  // Returns the newly created child nodes (caller must merge into tree).
  export function expand(
    tree: SearchTree,
    nodeID: string,
    approaches: string[],
  ): { tree: SearchTree; children: SearchNode[] } {
    const parent = tree.nodes[nodeID]
    if (!parent) {
      throw new Error(`Node ${nodeID} not found in tree`)
    }

    const effectiveBranches = Math.min(approaches.length, tree.config.maxBranches)
    const selectedApproaches = approaches.slice(0, effectiveBranches)

    const newChildren: SearchNode[] = []
    const newNodes = { ...tree.nodes }
    const updatedParent: SearchNode = {
      ...parent,
      children: [...parent.children],
    }

    for (const approach of selectedApproaches) {
      const childID = crypto.randomUUID()
      const child: SearchNode = {
        id: childID,
        parentID: nodeID,
        approach,
        score: 0,
        visits: 0,
        children: [],
        status: "exploring",
        depth: parent.depth + 1,
      }
      newChildren.push(child)
      newNodes[childID] = child
      updatedParent.children.push(childID)
    }

    newNodes[nodeID] = updatedParent

    log.info("expanded node", {
      nodeID,
      childCount: newChildren.length,
      depth: parent.depth + 1,
    })

    return {
      tree: {
        ...tree,
        nodes: newNodes,
      },
      children: newChildren,
    }
  }

  // kilocode_change — Evaluation: dual-component value function
  // Weighted: 0.4 * compile + 0.4 * tests + 0.2 * convention
  export function evaluate(results: {
    compiles: boolean
    testsPass: boolean
    conventionScore: number
  }): number {
    const compileScore = results.compiles ? 1.0 : 0.0
    const testScore = results.testsPass ? 1.0 : 0.0
    const conventionClamped = Math.max(0, Math.min(1, results.conventionScore))
    return 0.4 * compileScore + 0.4 * testScore + 0.2 * conventionClamped
  }

  // kilocode_change — Backpropagation: update V(s) and N(s) along the path from leaf to root
  // V(si) = [V(si) * N(si) + reward] / (N(si) + 1)
  export function backpropagate(tree: SearchTree, leafNodeID: string, reward: number): SearchTree {
    const newNodes = { ...tree.nodes }
    let currentID: string | null = leafNodeID

    while (currentID !== null) {
      const node = newNodes[currentID]
      if (!node) break

      const newVisits = node.visits + 1
      const newScore = (node.score * node.visits + reward) / newVisits

      newNodes[currentID] = {
        ...node,
        score: newScore,
        visits: newVisits,
        metadata: {
          ...node.metadata,
        },
      }

      currentID = node.parentID
    }

    log.info("backpropagated reward", {
      leafNodeID,
      reward,
    })

    return {
      ...tree,
      nodes: newNodes,
    }
  }

  // kilocode_change — Reflection: attach failure analysis text to a node
  export function addReflection(tree: SearchTree, nodeID: string, reflection: string): SearchTree {
    const node = tree.nodes[nodeID]
    if (!node) {
      throw new Error(`Node ${nodeID} not found in tree`)
    }

    const newNodes = { ...tree.nodes }
    newNodes[nodeID] = {
      ...node,
      reflection,
      status: "failed",
    }

    log.info("added reflection to failed node", { nodeID })

    return {
      ...tree,
      nodes: newNodes,
    }
  }

  // kilocode_change — Create a new search tree for a task
  export function create(
    sessionID: string,
    taskDescription: string,
    config?: Partial<SearchTree["config"]>,
  ): SearchTree {
    const rootID = crypto.randomUUID()
    const root: SearchNode = {
      id: rootID,
      parentID: null,
      approach: taskDescription,
      score: 0,
      visits: 0,
      children: [],
      status: "exploring",
      depth: 0,
    }

    const effectiveConfig = {
      maxBranches: Math.min(config?.maxBranches ?? 3, 5),
      maxDepth: config?.maxDepth ?? 3,
      explorationWeight: config?.explorationWeight ?? Math.SQRT2,
    }

    log.info("created search tree", {
      sessionID,
      rootID,
      config: effectiveConfig,
    })

    return {
      id: crypto.randomUUID(),
      sessionID,
      rootNodeID: rootID,
      nodes: { [rootID]: root },
      config: effectiveConfig,
      status: "searching",
      timestamp: Date.now(),
    }
  }

  // kilocode_change — Get the best solution path: walk from root to the highest-scoring leaf
  export function bestPath(tree: SearchTree): SearchNode[] {
    const root = tree.nodes[tree.rootNodeID]
    if (!root) return []

    const path: SearchNode[] = [root]
    let current = root

    while (current.children.length > 0) {
      let bestChild: SearchNode | undefined
      let bestScore = -Infinity

      for (const childID of current.children) {
        const child = tree.nodes[childID]
        if (!child) continue

        // Prefer succeeded nodes; among those, pick highest score.
        // Among non-succeeded, also pick highest score but succeeded always wins.
        const effectiveScore = child.status === "succeeded" ? child.score + 10 : child.score
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore
          bestChild = child
        }
      }

      if (!bestChild) break

      path.push(bestChild)
      current = bestChild
    }

    return path
  }

  // kilocode_change — Prune low-value subtrees to save resources
  // Removes subtrees where the root has score below threshold AND has been visited enough (N > 3)
  export function prune(tree: SearchTree, minScore: number): SearchTree {
    const newNodes = { ...tree.nodes }

    function collectSubtree(nodeID: string): string[] {
      const node = newNodes[nodeID]
      if (!node) return []
      const ids = [nodeID]
      for (const childID of node.children) {
        ids.push(...collectSubtree(childID))
      }
      return ids
    }

    // Find nodes eligible for pruning: not the root, visited enough, score too low
    const nodesToPrune: string[] = []
    for (const [nodeID, node] of Object.entries(newNodes)) {
      if (nodeID === tree.rootNodeID) continue
      if (node.visits <= 3) continue
      if (node.score >= minScore) continue
      if (node.status === "succeeded") continue
      nodesToPrune.push(nodeID)
    }

    // Prune each eligible node and its entire subtree
    for (const nodeID of nodesToPrune) {
      const node = newNodes[nodeID]
      if (!node) continue

      // Remove from parent's children list
      if (node.parentID) {
        const parent = newNodes[node.parentID]
        if (parent) {
          newNodes[node.parentID] = {
            ...parent,
            children: parent.children.filter((id) => id !== nodeID),
          }
        }
      }

      // Delete the entire subtree
      const subtreeIDs = collectSubtree(nodeID)
      for (const id of subtreeIDs) {
        delete newNodes[id]
      }
    }

    if (nodesToPrune.length > 0) {
      log.info("pruned low-value subtrees", {
        pruned: nodesToPrune.length,
        remaining: Object.keys(newNodes).length,
      })
    }

    return {
      ...tree,
      nodes: newNodes,
    }
  }

  // kilocode_change — Summary statistics for the search tree
  export function stats(tree: SearchTree): {
    totalNodes: number
    exploredNodes: number
    failedNodes: number
    succeededNodes: number
    maxDepthReached: number
    bestScore: number
  } {
    const nodes = Object.values(tree.nodes)
    let exploredNodes = 0
    let failedNodes = 0
    let succeededNodes = 0
    let maxDepthReached = 0
    let bestScore = -Infinity

    for (const node of nodes) {
      if (node.visits > 0) exploredNodes++
      if (node.status === "failed") failedNodes++
      if (node.status === "succeeded") succeededNodes++
      if (node.depth > maxDepthReached) maxDepthReached = node.depth
      if (node.score > bestScore) bestScore = node.score
    }

    return {
      totalNodes: nodes.length,
      exploredNodes,
      failedNodes,
      succeededNodes,
      maxDepthReached,
      bestScore: bestScore === -Infinity ? 0 : bestScore,
    }
  }

  // kilocode_change — Mark a node as succeeded and update tree status
  export function markSucceeded(tree: SearchTree, nodeID: string): SearchTree {
    const node = tree.nodes[nodeID]
    if (!node) {
      throw new Error(`Node ${nodeID} not found in tree`)
    }

    const newNodes = { ...tree.nodes }
    newNodes[nodeID] = {
      ...node,
      status: "succeeded",
    }

    // Rebuild the best path
    const updatedTree: SearchTree = {
      ...tree,
      nodes: newNodes,
      status: "found",
    }

    const path = bestPath(updatedTree)
    updatedTree.bestPath = path.map((n) => n.id)

    log.info("node marked as succeeded", { nodeID })

    return updatedTree
  }

  // kilocode_change — Check if the tree search is exhausted (all leaves are terminal)
  export function isExhausted(tree: SearchTree): boolean {
    for (const node of Object.values(tree.nodes)) {
      // A node is explorable if it's a leaf (no children) and not terminal
      if (
        node.children.length === 0 &&
        node.status !== "failed" &&
        node.status !== "succeeded" &&
        node.depth < tree.config.maxDepth
      ) {
        return false
      }
    }
    return true
  }

  // kilocode_change — Update node metadata after evaluation
  export function updateMetadata(
    tree: SearchTree,
    nodeID: string,
    metadata: NonNullable<SearchNode["metadata"]>,
  ): SearchTree {
    const node = tree.nodes[nodeID]
    if (!node) {
      throw new Error(`Node ${nodeID} not found in tree`)
    }

    const newNodes = { ...tree.nodes }
    newNodes[nodeID] = {
      ...node,
      metadata: {
        ...node.metadata,
        ...metadata,
      },
    }

    return {
      ...tree,
      nodes: newNodes,
    }
  }
}
