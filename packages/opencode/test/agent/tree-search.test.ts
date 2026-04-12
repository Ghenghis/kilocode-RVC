// kilocode_change — Tests for LATS: Language Agent Tree Search engine
import { test, expect, describe } from "bun:test"
import { TreeSearch } from "../../src/agent/tree-search"

// kilocode_change — Helper to build a tree with a known structure for testing
function makeTestTree(): TreeSearch.SearchTree {
  const tree = TreeSearch.create("test-session", "Fix the bug in parser")

  // Expand the root with 3 approaches
  const expanded = TreeSearch.expand(tree, tree.rootNodeID, [
    "Rewrite the tokenizer",
    "Add error recovery",
    "Fix the regex pattern",
  ])

  return expanded.tree
}

// kilocode_change — Helper to build a deeper tree with scores already backpropagated
function makeDeepTree(): TreeSearch.SearchTree {
  let tree = TreeSearch.create("deep-session", "Refactor module", {
    maxBranches: 3,
    maxDepth: 4,
    explorationWeight: Math.SQRT2,
  })

  // Expand root
  const { tree: t1 } = TreeSearch.expand(tree, tree.rootNodeID, [
    "Approach A",
    "Approach B",
    "Approach C",
  ])
  tree = t1

  const root = tree.nodes[tree.rootNodeID]!
  const childA = tree.nodes[root.children[0]!]!
  const childB = tree.nodes[root.children[1]!]!

  // Backpropagate some rewards to give children different scores
  tree = TreeSearch.backpropagate(tree, childA.id, 0.8)
  tree = TreeSearch.backpropagate(tree, childB.id, 0.3)
  tree = TreeSearch.backpropagate(tree, childA.id, 0.9)

  // Expand child A further
  const { tree: t2 } = TreeSearch.expand(tree, childA.id, [
    "Sub-approach A1",
    "Sub-approach A2",
  ])
  tree = t2

  return tree
}

describe("TreeSearch", () => {
  // kilocode_change — schema tests
  describe("schemas", () => {
    test("SearchNode schema validates a correct node", () => {
      const node: TreeSearch.SearchNode = {
        id: "node-1",
        parentID: null,
        approach: "Test approach",
        score: 0.5,
        visits: 3,
        children: ["child-1"],
        status: "exploring",
        depth: 0,
      }
      const result = TreeSearch.SearchNode.safeParse(node)
      expect(result.success).toBe(true)
    })

    test("SearchNode schema accepts optional metadata", () => {
      const node: TreeSearch.SearchNode = {
        id: "node-1",
        parentID: "parent-1",
        approach: "Test",
        score: 0.8,
        visits: 5,
        children: [],
        status: "succeeded",
        depth: 2,
        metadata: {
          toolsUsed: ["bash", "edit"],
          testsPass: true,
          compiles: true,
          tokenCost: 1500,
        },
      }
      const result = TreeSearch.SearchNode.safeParse(node)
      expect(result.success).toBe(true)
    })

    test("SearchNode schema rejects invalid status", () => {
      const node = {
        id: "node-1",
        parentID: null,
        approach: "Test",
        score: 0,
        visits: 0,
        children: [],
        status: "invalid_status",
        depth: 0,
      }
      const result = TreeSearch.SearchNode.safeParse(node)
      expect(result.success).toBe(false)
    })

    test("SearchTree schema validates a correct tree", () => {
      const tree = TreeSearch.create("session-1", "Some task")
      const result = TreeSearch.SearchTree.safeParse(tree)
      expect(result.success).toBe(true)
    })
  })

  // kilocode_change — UCT score tests
  describe("uctScore", () => {
    test("returns Infinity for unvisited node", () => {
      const parent: TreeSearch.SearchNode = {
        id: "p",
        parentID: null,
        approach: "parent",
        score: 0.5,
        visits: 10,
        children: ["c"],
        status: "exploring",
        depth: 0,
      }
      const child: TreeSearch.SearchNode = {
        id: "c",
        parentID: "p",
        approach: "child",
        score: 0,
        visits: 0,
        children: [],
        status: "exploring",
        depth: 1,
      }
      expect(TreeSearch.uctScore(child, parent, Math.SQRT2)).toBe(Infinity)
    })

    test("calculates correct UCT for visited nodes", () => {
      const parent: TreeSearch.SearchNode = {
        id: "p",
        parentID: null,
        approach: "parent",
        score: 0.6,
        visits: 10,
        children: ["c"],
        status: "exploring",
        depth: 0,
      }
      const child: TreeSearch.SearchNode = {
        id: "c",
        parentID: "p",
        approach: "child",
        score: 0.7,
        visits: 3,
        children: [],
        status: "exploring",
        depth: 1,
      }
      const w = Math.SQRT2
      // UCT = V(s) + w * sqrt(ln(N_parent) / N_child)
      // = 0.7 + sqrt(2) * sqrt(ln(10) / 3)
      const expected = 0.7 + w * Math.sqrt(Math.log(10) / 3)
      const actual = TreeSearch.uctScore(child, parent, w)
      expect(Math.abs(actual - expected)).toBeLessThan(1e-10)
    })

    test("higher exploration weight increases exploration term", () => {
      const parent: TreeSearch.SearchNode = {
        id: "p",
        parentID: null,
        approach: "parent",
        score: 0.5,
        visits: 20,
        children: ["c"],
        status: "exploring",
        depth: 0,
      }
      const child: TreeSearch.SearchNode = {
        id: "c",
        parentID: "p",
        approach: "child",
        score: 0.4,
        visits: 5,
        children: [],
        status: "exploring",
        depth: 1,
      }
      const low = TreeSearch.uctScore(child, parent, 0.5)
      const high = TreeSearch.uctScore(child, parent, 2.0)
      expect(high).toBeGreaterThan(low)
    })

    test("returns node score when parent has zero visits", () => {
      const parent: TreeSearch.SearchNode = {
        id: "p",
        parentID: null,
        approach: "parent",
        score: 0,
        visits: 0,
        children: ["c"],
        status: "exploring",
        depth: 0,
      }
      const child: TreeSearch.SearchNode = {
        id: "c",
        parentID: "p",
        approach: "child",
        score: 0.6,
        visits: 2,
        children: [],
        status: "exploring",
        depth: 1,
      }
      expect(TreeSearch.uctScore(child, parent, Math.SQRT2)).toBe(0.6)
    })
  })

  // kilocode_change — selection tests
  describe("select", () => {
    test("selects root when tree has no children", () => {
      const tree = TreeSearch.create("s1", "task")
      const selected = TreeSearch.select(tree)
      expect(selected.id).toBe(tree.rootNodeID)
    })

    test("selects unvisited child first", () => {
      const tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!

      // All children are unvisited (visits = 0), so any unvisited child is valid
      const selected = TreeSearch.select(tree)
      expect(root.children).toContain(selected.id)
      expect(selected.visits).toBe(0)
    })

    test("selects child with highest UCT score", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      // Visit all children so none are Infinity
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.2)
      tree = TreeSearch.backpropagate(tree, childIDs[2]!, 0.5)

      const selected = TreeSearch.select(tree)
      // The node with score 0.9 should have the best UCT
      // (highest exploitation with same visit count)
      expect(selected.id).toBe(childIDs[0])
    })

    test("skips failed and succeeded nodes during selection", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      // Mark first child as failed, second as succeeded
      tree = TreeSearch.addReflection(tree, childIDs[0]!, "Compilation error")
      tree = TreeSearch.markSucceeded(tree, childIDs[1]!)

      // Backpropagate the third to make it visited
      tree = TreeSearch.backpropagate(tree, childIDs[2]!, 0.5)

      const selected = TreeSearch.select(tree)
      // Should select the third child (only explorable one)
      expect(selected.id).toBe(childIDs[2])
    })

    test("returns current node when all children are terminal", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      tree = TreeSearch.addReflection(tree, childIDs[0]!, "failed 1")
      tree = TreeSearch.addReflection(tree, childIDs[1]!, "failed 2")
      tree = TreeSearch.addReflection(tree, childIDs[2]!, "failed 3")

      const selected = TreeSearch.select(tree)
      // Should return the root since all children are terminal
      expect(selected.id).toBe(tree.rootNodeID)
    })
  })

  // kilocode_change — expansion tests
  describe("expand", () => {
    test("creates child nodes with correct parent references", () => {
      const tree = TreeSearch.create("s1", "task")
      const { tree: expanded, children } = TreeSearch.expand(tree, tree.rootNodeID, [
        "Approach 1",
        "Approach 2",
      ])

      expect(children.length).toBe(2)
      for (const child of children) {
        expect(child.parentID).toBe(tree.rootNodeID)
        expect(child.depth).toBe(1)
        expect(child.visits).toBe(0)
        expect(child.score).toBe(0)
        expect(child.status).toBe("exploring")
        expect(expanded.nodes[child.id]).toBeDefined()
      }

      const root = expanded.nodes[tree.rootNodeID]!
      expect(root.children.length).toBe(2)
      expect(root.children).toContain(children[0]!.id)
      expect(root.children).toContain(children[1]!.id)
    })

    test("respects maxBranches limit", () => {
      const tree = TreeSearch.create("s1", "task", { maxBranches: 2 })
      const { children } = TreeSearch.expand(tree, tree.rootNodeID, [
        "A",
        "B",
        "C",
        "D",
        "E",
      ])
      expect(children.length).toBe(2)
    })

    test("config maxBranches is capped at 5", () => {
      const tree = TreeSearch.create("s1", "task", { maxBranches: 10 })
      expect(tree.config.maxBranches).toBe(5)
    })

    test("throws when expanding a non-existent node", () => {
      const tree = TreeSearch.create("s1", "task")
      expect(() => TreeSearch.expand(tree, "nonexistent", ["A"])).toThrow("not found")
    })

    test("preserves existing children when expanding", () => {
      let tree = TreeSearch.create("s1", "task")
      const { tree: t1 } = TreeSearch.expand(tree, tree.rootNodeID, ["First"])
      const firstRoot = t1.nodes[tree.rootNodeID]!
      expect(firstRoot.children.length).toBe(1)

      const { tree: t2 } = TreeSearch.expand(t1, tree.rootNodeID, ["Second"])
      const secondRoot = t2.nodes[tree.rootNodeID]!
      expect(secondRoot.children.length).toBe(2)
    })
  })

  // kilocode_change — evaluation tests
  describe("evaluate", () => {
    test("returns 1.0 when everything passes", () => {
      const score = TreeSearch.evaluate({
        compiles: true,
        testsPass: true,
        conventionScore: 1.0,
      })
      expect(score).toBeCloseTo(1.0)
    })

    test("returns 0.0 when everything fails", () => {
      const score = TreeSearch.evaluate({
        compiles: false,
        testsPass: false,
        conventionScore: 0.0,
      })
      expect(score).toBeCloseTo(0.0)
    })

    test("correctly weights compile (0.4), tests (0.4), convention (0.2)", () => {
      // Only compile passes
      const compileOnly = TreeSearch.evaluate({
        compiles: true,
        testsPass: false,
        conventionScore: 0.0,
      })
      expect(compileOnly).toBeCloseTo(0.4)

      // Only tests pass
      const testsOnly = TreeSearch.evaluate({
        compiles: false,
        testsPass: true,
        conventionScore: 0.0,
      })
      expect(testsOnly).toBeCloseTo(0.4)

      // Only convention is perfect
      const conventionOnly = TreeSearch.evaluate({
        compiles: false,
        testsPass: false,
        conventionScore: 1.0,
      })
      expect(conventionOnly).toBeCloseTo(0.2)
    })

    test("clamps convention score to [0, 1]", () => {
      const over = TreeSearch.evaluate({
        compiles: false,
        testsPass: false,
        conventionScore: 5.0,
      })
      expect(over).toBeCloseTo(0.2) // clamped to 1.0 * 0.2

      const under = TreeSearch.evaluate({
        compiles: false,
        testsPass: false,
        conventionScore: -2.0,
      })
      expect(under).toBeCloseTo(0.0) // clamped to 0.0 * 0.2
    })
  })

  // kilocode_change — backpropagation tests
  describe("backpropagate", () => {
    test("updates leaf node score and visits", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      tree = TreeSearch.backpropagate(tree, childID, 0.8)

      const child = tree.nodes[childID]!
      expect(child.visits).toBe(1)
      expect(child.score).toBeCloseTo(0.8)
    })

    test("updates all ancestors along the path", () => {
      let tree = makeDeepTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childA = tree.nodes[root.children[0]!]!
      const subChildID = childA.children[0]!

      // Backpropagate from the deepest node
      tree = TreeSearch.backpropagate(tree, subChildID, 1.0)

      const updatedSubChild = tree.nodes[subChildID]!
      const updatedChildA = tree.nodes[childA.id]!
      const updatedRoot = tree.nodes[tree.rootNodeID]!

      // Sub-child: was (0, 0), now (1.0, 1)
      expect(updatedSubChild.visits).toBe(1)
      expect(updatedSubChild.score).toBeCloseTo(1.0)

      // Child A: was (0.85, 2) from previous backprop, now (0.85*2+1.0)/3
      expect(updatedChildA.visits).toBe(3)
      expect(updatedChildA.score).toBeCloseTo((0.85 * 2 + 1.0) / 3, 5)

      // Root: was visited 3 times (two for A, one for B), now +1
      expect(updatedRoot.visits).toBe(4)
    })

    test("running average converges correctly with multiple rewards", () => {
      let tree = TreeSearch.create("s1", "task")
      const { tree: expanded } = TreeSearch.expand(tree, tree.rootNodeID, ["A"])
      tree = expanded

      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      // Send rewards: 0.6, 0.8, 1.0
      tree = TreeSearch.backpropagate(tree, childID, 0.6)
      tree = TreeSearch.backpropagate(tree, childID, 0.8)
      tree = TreeSearch.backpropagate(tree, childID, 1.0)

      const child = tree.nodes[childID]!
      expect(child.visits).toBe(3)
      // (0 + 0.6) / 1 = 0.6
      // (0.6 + 0.8) / 2 = 0.7
      // (0.7 * 2 + 1.0) / 3 = 0.8
      expect(child.score).toBeCloseTo(0.8)
    })

    test("does not mutate the original tree", () => {
      const tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      const originalVisits = tree.nodes[childID]!.visits
      const updatedTree = TreeSearch.backpropagate(tree, childID, 1.0)

      expect(tree.nodes[childID]!.visits).toBe(originalVisits)
      expect(updatedTree.nodes[childID]!.visits).toBe(originalVisits + 1)
    })
  })

  // kilocode_change — reflection tests
  describe("addReflection", () => {
    test("attaches reflection text and sets status to failed", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      tree = TreeSearch.addReflection(tree, childID, "Type error in line 42")

      const child = tree.nodes[childID]!
      expect(child.reflection).toBe("Type error in line 42")
      expect(child.status).toBe("failed")
    })

    test("throws for non-existent node", () => {
      const tree = TreeSearch.create("s1", "task")
      expect(() => TreeSearch.addReflection(tree, "fake-id", "reason")).toThrow("not found")
    })
  })

  // kilocode_change — create tests
  describe("create", () => {
    test("creates a tree with default config", () => {
      const tree = TreeSearch.create("session-1", "Fix the parser bug")

      expect(tree.sessionID).toBe("session-1")
      expect(tree.status).toBe("searching")
      expect(tree.config.maxBranches).toBe(3)
      expect(tree.config.maxDepth).toBe(3)
      expect(tree.config.explorationWeight).toBeCloseTo(Math.SQRT2)
      expect(Object.keys(tree.nodes).length).toBe(1)

      const root = tree.nodes[tree.rootNodeID]!
      expect(root.parentID).toBeNull()
      expect(root.approach).toBe("Fix the parser bug")
      expect(root.depth).toBe(0)
      expect(root.visits).toBe(0)
    })

    test("accepts custom config with clamping", () => {
      const tree = TreeSearch.create("s1", "task", {
        maxBranches: 10,
        maxDepth: 5,
        explorationWeight: 2.5,
      })

      expect(tree.config.maxBranches).toBe(5) // clamped
      expect(tree.config.maxDepth).toBe(5)
      expect(tree.config.explorationWeight).toBe(2.5)
    })

    test("generates unique IDs", () => {
      const tree1 = TreeSearch.create("s1", "task 1")
      const tree2 = TreeSearch.create("s2", "task 2")

      expect(tree1.id).not.toBe(tree2.id)
      expect(tree1.rootNodeID).not.toBe(tree2.rootNodeID)
    })
  })

  // kilocode_change — bestPath tests
  describe("bestPath", () => {
    test("returns only root for a single-node tree", () => {
      const tree = TreeSearch.create("s1", "task")
      const path = TreeSearch.bestPath(tree)
      expect(path.length).toBe(1)
      expect(path[0]!.id).toBe(tree.rootNodeID)
    })

    test("follows highest-scoring children", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.3)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[2]!, 0.5)

      const path = TreeSearch.bestPath(tree)
      expect(path.length).toBe(2) // root + best child
      expect(path[1]!.id).toBe(childIDs[1]) // child with score 0.9
    })

    test("prefers succeeded nodes over higher-scoring exploring nodes", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.5)
      tree = TreeSearch.markSucceeded(tree, childIDs[1]!)

      const path = TreeSearch.bestPath(tree)
      expect(path.length).toBe(2)
      expect(path[1]!.id).toBe(childIDs[1]) // succeeded node is preferred
    })
  })

  // kilocode_change — prune tests
  describe("prune", () => {
    test("removes subtrees with low scores and enough visits", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      // Give child 0 many low-score visits (N > 3)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)

      // Give child 1 high-score visits
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.9)

      const nodeCountBefore = Object.keys(tree.nodes).length
      tree = TreeSearch.prune(tree, 0.5) // prune nodes with score < 0.5

      // child 0 should be pruned (score ~0.1, visits = 4 > 3)
      expect(tree.nodes[childIDs[0]!]).toBeUndefined()
      // child 1 should remain (score ~0.9)
      expect(tree.nodes[childIDs[1]!]).toBeDefined()
      expect(Object.keys(tree.nodes).length).toBeLessThan(nodeCountBefore)
    })

    test("does not prune nodes with insufficient visits", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      // Give child 0 only 2 visits (below threshold of 3)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.1)

      tree = TreeSearch.prune(tree, 0.5)

      // Should NOT be pruned because visits <= 3
      expect(tree.nodes[childIDs[0]!]).toBeDefined()
    })

    test("never prunes the root node", () => {
      let tree = TreeSearch.create("s1", "task")
      // Root has 0 visits and 0 score — would be eligible if not protected
      tree = TreeSearch.prune(tree, 0.5)
      expect(tree.nodes[tree.rootNodeID]).toBeDefined()
    })

    test("never prunes succeeded nodes", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      // Give it low score with enough visits
      tree = TreeSearch.backpropagate(tree, childID, 0.1)
      tree = TreeSearch.backpropagate(tree, childID, 0.1)
      tree = TreeSearch.backpropagate(tree, childID, 0.1)
      tree = TreeSearch.backpropagate(tree, childID, 0.1)

      // Mark as succeeded
      tree = TreeSearch.markSucceeded(tree, childID)

      tree = TreeSearch.prune(tree, 0.5)

      // Should NOT be pruned despite low score
      expect(tree.nodes[childID]).toBeDefined()
    })

    test("removes entire subtree when parent is pruned", () => {
      let tree = makeDeepTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childBID = root.children[1]!

      // Expand child B
      const { tree: t1 } = TreeSearch.expand(tree, childBID, ["B-sub-1", "B-sub-2"])
      tree = t1
      const childB = tree.nodes[childBID]!
      const subChildIDs = childB.children

      // Give child B enough low-score visits to be prunable
      tree = TreeSearch.backpropagate(tree, childBID, 0.1)
      tree = TreeSearch.backpropagate(tree, childBID, 0.1)
      tree = TreeSearch.backpropagate(tree, childBID, 0.1)

      // Note: childB already had 1 visit from makeDeepTree, so now visits=4

      tree = TreeSearch.prune(tree, 0.5)

      // Both child B and its sub-children should be gone
      expect(tree.nodes[childBID]).toBeUndefined()
      for (const subID of subChildIDs) {
        expect(tree.nodes[subID]).toBeUndefined()
      }
    })
  })

  // kilocode_change — stats tests
  describe("stats", () => {
    test("returns correct stats for an empty tree", () => {
      const tree = TreeSearch.create("s1", "task")
      const s = TreeSearch.stats(tree)

      expect(s.totalNodes).toBe(1)
      expect(s.exploredNodes).toBe(0)
      expect(s.failedNodes).toBe(0)
      expect(s.succeededNodes).toBe(0)
      expect(s.maxDepthReached).toBe(0)
      expect(s.bestScore).toBe(0) // 0 instead of -Infinity
    })

    test("tracks explored, failed, succeeded counts", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.9)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.3)
      tree = TreeSearch.addReflection(tree, childIDs[2]!, "compile error")
      tree = TreeSearch.markSucceeded(tree, childIDs[0]!)

      const s = TreeSearch.stats(tree)

      expect(s.totalNodes).toBe(4) // root + 3 children
      expect(s.exploredNodes).toBe(3) // root (2 backprops touch it) + child0 + child1
      expect(s.failedNodes).toBe(1)
      expect(s.succeededNodes).toBe(1)
      expect(s.maxDepthReached).toBe(1)
    })

    test("reports correct best score", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children

      tree = TreeSearch.backpropagate(tree, childIDs[0]!, 0.3)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, 0.7)
      tree = TreeSearch.backpropagate(tree, childIDs[2]!, 0.5)

      const s = TreeSearch.stats(tree)
      expect(s.bestScore).toBeCloseTo(0.7)
    })

    test("reports correct max depth", () => {
      const tree = makeDeepTree()
      const s = TreeSearch.stats(tree)
      expect(s.maxDepthReached).toBe(2) // root(0) -> childA(1) -> subChild(2)
    })
  })

  // kilocode_change — markSucceeded tests
  describe("markSucceeded", () => {
    test("sets node status to succeeded and tree status to found", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      tree = TreeSearch.markSucceeded(tree, childID)

      expect(tree.nodes[childID]!.status).toBe("succeeded")
      expect(tree.status).toBe("found")
      expect(tree.bestPath).toBeDefined()
    })

    test("throws for non-existent node", () => {
      const tree = TreeSearch.create("s1", "task")
      expect(() => TreeSearch.markSucceeded(tree, "fake-id")).toThrow("not found")
    })
  })

  // kilocode_change — isExhausted tests
  describe("isExhausted", () => {
    test("returns false for a fresh tree", () => {
      const tree = TreeSearch.create("s1", "task")
      expect(TreeSearch.isExhausted(tree)).toBe(false)
    })

    test("returns true when all leaves are terminal", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!

      tree = TreeSearch.addReflection(tree, root.children[0]!, "fail 1")
      tree = TreeSearch.addReflection(tree, root.children[1]!, "fail 2")
      tree = TreeSearch.markSucceeded(tree, root.children[2]!)

      expect(TreeSearch.isExhausted(tree)).toBe(true)
    })

    test("returns false when an explorable leaf exists", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!

      tree = TreeSearch.addReflection(tree, root.children[0]!, "fail")
      // children[1] and [2] are still exploring

      expect(TreeSearch.isExhausted(tree)).toBe(false)
    })
  })

  // kilocode_change — updateMetadata tests
  describe("updateMetadata", () => {
    test("merges metadata into node", () => {
      let tree = makeTestTree()
      const root = tree.nodes[tree.rootNodeID]!
      const childID = root.children[0]!

      tree = TreeSearch.updateMetadata(tree, childID, {
        compiles: true,
        testsPass: false,
        toolsUsed: ["bash", "edit"],
        tokenCost: 500,
      })

      const child = tree.nodes[childID]!
      expect(child.metadata?.compiles).toBe(true)
      expect(child.metadata?.testsPass).toBe(false)
      expect(child.metadata?.toolsUsed).toEqual(["bash", "edit"])
      expect(child.metadata?.tokenCost).toBe(500)
    })

    test("throws for non-existent node", () => {
      const tree = TreeSearch.create("s1", "task")
      expect(() => TreeSearch.updateMetadata(tree, "fake-id", { compiles: true })).toThrow("not found")
    })
  })

  // kilocode_change — full search cycle integration test
  describe("full search cycle", () => {
    test("create → expand → evaluate → backpropagate → select → reflect", () => {
      // Step 1: Create
      let tree = TreeSearch.create("integration-session", "Fix the login form validation")

      // Step 2: Expand root with 3 approaches
      const { tree: t1 } = TreeSearch.expand(tree, tree.rootNodeID, [
        "Add client-side validation with Zod",
        "Use HTML5 built-in validation",
        "Add server-side validation middleware",
      ])
      tree = t1

      const root = tree.nodes[tree.rootNodeID]!
      const childIDs = root.children
      expect(childIDs.length).toBe(3)

      // Step 3: Evaluate each approach
      const score1 = TreeSearch.evaluate({ compiles: true, testsPass: true, conventionScore: 0.8 })
      expect(score1).toBeCloseTo(0.96)

      const score2 = TreeSearch.evaluate({ compiles: true, testsPass: false, conventionScore: 0.5 })
      expect(score2).toBeCloseTo(0.5)

      const score3 = TreeSearch.evaluate({ compiles: false, testsPass: false, conventionScore: 0.3 })
      expect(score3).toBeCloseTo(0.06)

      // Step 4: Backpropagate rewards
      tree = TreeSearch.backpropagate(tree, childIDs[0]!, score1)
      tree = TreeSearch.backpropagate(tree, childIDs[1]!, score2)
      tree = TreeSearch.backpropagate(tree, childIDs[2]!, score3)

      // Verify scores were stored
      expect(tree.nodes[childIDs[0]!]!.score).toBeCloseTo(score1)
      expect(tree.nodes[childIDs[1]!]!.score).toBeCloseTo(score2)
      expect(tree.nodes[childIDs[2]!]!.score).toBeCloseTo(score3)

      // Step 5: Select next node to explore (should be child with highest UCT)
      const selected = TreeSearch.select(tree)
      // Child 0 has highest score, same visits, so highest UCT
      expect(selected.id).toBe(childIDs[0])

      // Step 6: Add reflection to the failed approach
      tree = TreeSearch.addReflection(tree, childIDs[2]!, "Server-side only approach does not compile without middleware package")
      expect(tree.nodes[childIDs[2]!]!.status).toBe("failed")
      expect(tree.nodes[childIDs[2]!]!.reflection).toBeDefined()

      // Step 7: Mark the best approach as succeeded
      tree = TreeSearch.markSucceeded(tree, childIDs[0]!)
      expect(tree.status).toBe("found")

      // Step 8: Verify best path leads to the succeeded node
      const path = TreeSearch.bestPath(tree)
      expect(path.length).toBe(2)
      expect(path[0]!.id).toBe(tree.rootNodeID)
      expect(path[1]!.id).toBe(childIDs[0])

      // Step 9: Verify stats
      const s = TreeSearch.stats(tree)
      expect(s.totalNodes).toBe(4)
      expect(s.exploredNodes).toBe(4) // all nodes visited via backprop
      expect(s.failedNodes).toBe(1)
      expect(s.succeededNodes).toBe(1)
      expect(s.bestScore).toBeCloseTo(score1)
    })

    test("multi-level search with pruning", () => {
      // Create tree
      let tree = TreeSearch.create("prune-session", "Optimize database queries", {
        maxBranches: 3,
        maxDepth: 3,
      })

      // Level 1: expand root
      const { tree: t1 } = TreeSearch.expand(tree, tree.rootNodeID, [
        "Add indexes",
        "Rewrite ORM queries",
        "Cache layer",
      ])
      tree = t1
      const root = tree.nodes[tree.rootNodeID]!
      const level1IDs = root.children

      // Simulate: "Rewrite ORM queries" is a bad approach
      tree = TreeSearch.backpropagate(tree, level1IDs[1]!, 0.1)
      tree = TreeSearch.backpropagate(tree, level1IDs[1]!, 0.15)
      tree = TreeSearch.backpropagate(tree, level1IDs[1]!, 0.1)
      tree = TreeSearch.backpropagate(tree, level1IDs[1]!, 0.12)

      // "Add indexes" is promising
      tree = TreeSearch.backpropagate(tree, level1IDs[0]!, 0.8)
      tree = TreeSearch.backpropagate(tree, level1IDs[0]!, 0.85)

      // Level 2: expand "Add indexes"
      const { tree: t2 } = TreeSearch.expand(tree, level1IDs[0]!, [
        "Composite index on user_id + created_at",
        "Partial index on active = true",
      ])
      tree = t2

      // Prune bad approaches
      tree = TreeSearch.prune(tree, 0.4)

      // "Rewrite ORM queries" should be pruned (score ~0.12, visits=4 > 3)
      expect(tree.nodes[level1IDs[1]!]).toBeUndefined()

      // "Add indexes" and its children should still exist
      expect(tree.nodes[level1IDs[0]!]).toBeDefined()
      const addIndexes = tree.nodes[level1IDs[0]!]!
      expect(addIndexes.children.length).toBe(2)

      // Tree is not exhausted — there are still explorable leaves
      expect(TreeSearch.isExhausted(tree)).toBe(false)
    })
  })
})
