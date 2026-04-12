// kilocode_change — comprehensive tests for AgentEvent schemas and EventStream operations
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { AgentEvent } from "../../src/event/event"
import { EventStream } from "../../src/event/stream"
import { tmpdir } from "../fixture/fixture"

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid action payload input (no id/timestamp — those come from append) */
function makeActionInput(overrides?: Partial<Omit<AgentEvent.Info, "id" | "timestamp">>): Omit<AgentEvent.Info, "id" | "timestamp"> {
  return {
    sessionID: "sess-test",
    agentName: "code",
    type: "action",
    payload: {
      type: "action",
      data: { tool: "bash", input: { command: "echo hello" } },
    },
    ...overrides,
  }
}

function makeObservationInput(overrides?: Partial<Omit<AgentEvent.Info, "id" | "timestamp">>): Omit<AgentEvent.Info, "id" | "timestamp"> {
  return {
    sessionID: "sess-test",
    agentName: "code",
    type: "observation",
    payload: {
      type: "observation",
      data: { tool: "bash", output: "hello", success: true, durationMs: 120 },
    },
    ...overrides,
  }
}

function makeReflectionInput(overrides?: Partial<Omit<AgentEvent.Info, "id" | "timestamp">>): Omit<AgentEvent.Info, "id" | "timestamp"> {
  return {
    sessionID: "sess-test",
    agentName: "code",
    type: "reflection",
    payload: {
      type: "reflection",
      data: {
        summary: "Tried bash, got output",
        learnings: ["bash works for simple commands"],
        failedApproach: undefined,
      },
    },
    ...overrides,
  }
}

function makeStateChangeInput(overrides?: Partial<Omit<AgentEvent.Info, "id" | "timestamp">>): Omit<AgentEvent.Info, "id" | "timestamp"> {
  return {
    sessionID: "sess-test",
    agentName: "code",
    type: "state_change",
    payload: {
      type: "state_change",
      data: { from: "idle", to: "running", reason: "task started" },
    },
    ...overrides,
  }
}

// ── AgentEvent schema tests ────────────────────────────────────────────────

describe("AgentEvent schemas", () => {
  // ── ActionPayload ──────────────────────────────────────────────────────

  describe("ActionPayload", () => {
    test("valid action payload parses correctly with all required fields", () => {
      const result = AgentEvent.ActionPayload.safeParse({
        tool: "edit",
        input: { filePath: "/tmp/foo.ts", content: "const x = 1" },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.tool).toBe("edit")
      expect(result.data.input).toEqual({ filePath: "/tmp/foo.ts", content: "const x = 1" })
    })

    test("action payload with empty input record is valid", () => {
      const result = AgentEvent.ActionPayload.safeParse({ tool: "noop", input: {} })
      expect(result.success).toBe(true)
    })

    test("action payload rejects missing tool field", () => {
      const result = AgentEvent.ActionPayload.safeParse({ input: { x: 1 } })
      expect(result.success).toBe(false)
    })

    test("action payload rejects missing input field", () => {
      const result = AgentEvent.ActionPayload.safeParse({ tool: "bash" })
      expect(result.success).toBe(false)
    })
  })

  // ── ObservationPayload ─────────────────────────────────────────────────

  describe("ObservationPayload", () => {
    test("valid observation payload parses correctly with all required fields", () => {
      const result = AgentEvent.ObservationPayload.safeParse({
        tool: "bash",
        output: "hello world",
        success: true,
        durationMs: 250,
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.tool).toBe("bash")
      expect(result.data.output).toBe("hello world")
      expect(result.data.success).toBe(true)
      expect(result.data.durationMs).toBe(250)
    })

    test("observation payload rejects missing success field", () => {
      const result = AgentEvent.ObservationPayload.safeParse({
        tool: "bash",
        output: "hello",
        durationMs: 100,
      })
      expect(result.success).toBe(false)
    })

    test("observation payload rejects non-boolean success", () => {
      const result = AgentEvent.ObservationPayload.safeParse({
        tool: "bash",
        output: "hello",
        success: "yes", // wrong type
        durationMs: 100,
      })
      expect(result.success).toBe(false)
    })
  })

  // ── ReflectionPayload ──────────────────────────────────────────────────

  describe("ReflectionPayload", () => {
    test("valid reflection payload parses correctly", () => {
      const result = AgentEvent.ReflectionPayload.safeParse({
        summary: "Task complete",
        learnings: ["check imports first", "run tests after edit"],
        failedApproach: "editing blindly",
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.summary).toBe("Task complete")
      expect(result.data.learnings).toHaveLength(2)
      expect(result.data.failedApproach).toBe("editing blindly")
    })

    test("reflection payload parses without optional failedApproach", () => {
      const result = AgentEvent.ReflectionPayload.safeParse({
        summary: "All good",
        learnings: [],
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.failedApproach).toBeUndefined()
    })

    test("reflection payload rejects missing summary", () => {
      const result = AgentEvent.ReflectionPayload.safeParse({
        learnings: ["something"],
      })
      expect(result.success).toBe(false)
    })
  })

  // ── AgentEvent.Info ────────────────────────────────────────────────────

  describe("AgentEvent.Info", () => {
    test("valid full event info parses correctly with action type", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-001",
        sessionID: "sess-abc",
        agentName: "code",
        timestamp: 1700000000000,
        type: "action",
        payload: {
          type: "action",
          data: { tool: "bash", input: { command: "ls" } },
        },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.id).toBe("evt-001")
      expect(result.data.sessionID).toBe("sess-abc")
      expect(result.data.agentName).toBe("code")
      expect(result.data.type).toBe("action")
    })

    test("valid event info parses correctly with observation type", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-002",
        sessionID: "sess-abc",
        agentName: "explore",
        timestamp: 1700000001000,
        type: "observation",
        payload: {
          type: "observation",
          data: { tool: "bash", output: "output text", success: false, durationMs: 500 },
        },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.type).toBe("observation")
    })

    test("valid event info parses correctly with reflection type", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-003",
        sessionID: "sess-abc",
        agentName: "code",
        timestamp: 1700000002000,
        type: "reflection",
        payload: {
          type: "reflection",
          data: { summary: "done", learnings: ["learned X"] },
        },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.type).toBe("reflection")
    })

    test("event info parses with optional parentEventID", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-child",
        sessionID: "sess-abc",
        agentName: "code",
        timestamp: 1700000003000,
        type: "action",
        parentEventID: "evt-parent",
        payload: {
          type: "action",
          data: { tool: "read", input: { path: "/tmp/x.ts" } },
        },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.parentEventID).toBe("evt-parent")
    })

    test("invalid payload type is rejected by Zod discriminated union", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-bad",
        sessionID: "sess-abc",
        agentName: "code",
        timestamp: 1700000000000,
        type: "action",
        payload: {
          type: "unknown_type", // not in the enum
          data: {},
        },
      })
      expect(result.success).toBe(false)
    })

    test("missing required fields are caught — id missing", () => {
      const result = AgentEvent.Info.safeParse({
        sessionID: "sess-abc",
        agentName: "code",
        timestamp: 1700000000000,
        type: "action",
        payload: { type: "action", data: { tool: "bash", input: {} } },
      })
      expect(result.success).toBe(false)
    })

    test("missing required fields are caught — sessionID missing", () => {
      const result = AgentEvent.Info.safeParse({
        id: "evt-001",
        agentName: "code",
        timestamp: 1700000000000,
        type: "action",
        payload: { type: "action", data: { tool: "bash", input: {} } },
      })
      expect(result.success).toBe(false)
    })

    test("EventType rejects unknown type string", () => {
      const result = AgentEvent.EventType.safeParse("unknown_event")
      expect(result.success).toBe(false)
    })

    test("EventType accepts all valid values", () => {
      for (const t of ["action", "observation", "reflection", "state_change"] as const) {
        expect(AgentEvent.EventType.safeParse(t).success).toBe(true)
      }
    })
  })
})

// ── EventStream operation tests ────────────────────────────────────────────

describe("EventStream", () => {
  // ── append ─────────────────────────────────────────────────────────────

  describe("append()", () => {
    test("creates event with auto-generated id and timestamp, returns it", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = makeActionInput({ sessionID: "sess-append-1" })
          const event = await EventStream.append(input)

          expect(event.id).toBeDefined()
          expect(typeof event.id).toBe("string")
          expect(event.id.length).toBeGreaterThan(0)
          expect(event.timestamp).toBeGreaterThan(0)
          expect(event.sessionID).toBe("sess-append-1")
          expect(event.agentName).toBe("code")
          expect(event.type).toBe("action")
        },
      })
    })

    test("each append call generates a unique id", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = makeActionInput({ sessionID: "sess-uniq" })
          const a = await EventStream.append(input)
          const b = await EventStream.append(input)
          expect(a.id).not.toBe(b.id)
        },
      })
    })

    test("append writes a JSON file to .kilo/events/{sessionID}/", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const event = await EventStream.append(makeActionInput({ sessionID: "sess-write" }))

          const dir = path.join(tmp.path, ".kilo", "events", "sess-write")
          const files = await fs.readdir(dir)
          expect(files).toHaveLength(1)
          expect(files[0]).toEndWith(".json")

          const raw = await fs.readFile(path.join(dir, files[0]!), "utf-8")
          const parsed = JSON.parse(raw)
          expect(parsed.id).toBe(event.id)
          expect(parsed.type).toBe("action")
        },
      })
    })

    test("append for observation type works correctly", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const event = await EventStream.append(makeObservationInput({ sessionID: "sess-obs" }))
          expect(event.type).toBe("observation")
          const payload = event.payload as AgentEvent.Payload & { type: "observation" }
          expect(payload.data.tool).toBe("bash")
          expect(payload.data.success).toBe(true)
        },
      })
    })

    test("append for reflection type works correctly", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const event = await EventStream.append(makeReflectionInput({ sessionID: "sess-ref" }))
          expect(event.type).toBe("reflection")
          const payload = event.payload as AgentEvent.Payload & { type: "reflection" }
          expect(payload.data.summary).toBe("Tried bash, got output")
          expect(payload.data.learnings).toContain("bash works for simple commands")
        },
      })
    })

    test("append for state_change type works correctly", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const event = await EventStream.append(makeStateChangeInput({ sessionID: "sess-sc" }))
          expect(event.type).toBe("state_change")
          const payload = event.payload as AgentEvent.Payload & { type: "state_change" }
          expect(payload.data.from).toBe("idle")
          expect(payload.data.to).toBe("running")
        },
      })
    })

    test("append preserves optional parentEventID field", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const event = await EventStream.append(
            makeActionInput({ sessionID: "sess-parent", parentEventID: "parent-xyz" }),
          )
          expect(event.parentEventID).toBe("parent-xyz")
        },
      })
    })
  })

  // ── replay ─────────────────────────────────────────────────────────────

  describe("replay()", () => {
    test("returns events in chronological order for 3 appended events", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-replay-order"
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid, agentName: "agent-1" }))
          const e2 = await EventStream.append(makeObservationInput({ sessionID: sid, agentName: "agent-2" }))
          const e3 = await EventStream.append(makeReflectionInput({ sessionID: sid, agentName: "agent-3" }))

          const events = await EventStream.replay(sid)
          expect(events).toHaveLength(3)
          // Chronological: timestamps must be non-decreasing
          expect(events[0]!.timestamp).toBeLessThanOrEqual(events[1]!.timestamp)
          expect(events[1]!.timestamp).toBeLessThanOrEqual(events[2]!.timestamp)
          // IDs match appended order by file sort
          const ids = events.map((e) => e.id)
          expect(ids).toContain(e1.id)
          expect(ids).toContain(e2.id)
          expect(ids).toContain(e3.id)
        },
      })
    })

    test("returns empty array for nonexistent session (ENOENT)", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const events = await EventStream.replay("nonexistent-session-id")
          expect(events).toEqual([])
        },
      })
    })

    test("skips malformed JSON files gracefully and still returns valid events", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-corrupt"

          // Append two valid events
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid, agentName: "first" }))
          const e2 = await EventStream.append(makeObservationInput({ sessionID: sid, agentName: "third" }))

          // Write a corrupt file with a timestamp between the two valid ones
          // so it appears in the sorted order between them
          const midTs = String(e1.timestamp + 1).padStart(15, "0")
          const corruptFile = path.join(tmp.path, ".kilo", "events", sid, `${midTs}_corrupt-id.json`)
          await fs.writeFile(corruptFile, "{{{not valid json}}", "utf-8")

          const events = await EventStream.replay(sid)
          // The corrupt file should be skipped; we should get the 2 valid events
          expect(events).toHaveLength(2)
          const ids = events.map((e) => e.id)
          expect(ids).toContain(e1.id)
          expect(ids).toContain(e2.id)
        },
      })
    })

    test("skips files with valid JSON but invalid AgentEvent schema", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-bad-schema"
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid }))

          // Write a valid JSON file that doesn't match AgentEvent.Info schema
          const ts = String(e1.timestamp + 1).padStart(15, "0")
          const badFile = path.join(tmp.path, ".kilo", "events", sid, `${ts}_bad-schema.json`)
          await fs.writeFile(badFile, JSON.stringify({ id: "bad", notAValidEvent: true }), "utf-8")

          const events = await EventStream.replay(sid)
          expect(events).toHaveLength(1)
          expect(events[0]!.id).toBe(e1.id)
        },
      })
    })
  })

  // ── fork ───────────────────────────────────────────────────────────────

  describe("fork()", () => {
    test("creates new session with events up to and including cutoffEvent", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-fork-src"
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid }))
          const e2 = await EventStream.append(makeObservationInput({ sessionID: sid }))
          const e3 = await EventStream.append(makeReflectionInput({ sessionID: sid }))

          // Fork at e2 — new session should contain e1 and e2, not e3
          const newSID = await EventStream.fork(sid, e2.id)
          expect(typeof newSID).toBe("string")
          expect(newSID).not.toBe(sid)

          const forkedEvents = await EventStream.replay(newSID)
          expect(forkedEvents).toHaveLength(2)

          const forkedIDs = forkedEvents.map((e) => e.id)
          expect(forkedIDs).toContain(e1.id)
          expect(forkedIDs).toContain(e2.id)
          // e3 must NOT be in the fork
          expect(forkedIDs).not.toContain(e3.id)
        },
      })
    })

    test("forked events have the new sessionID, not the original", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-fork-sesid"
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid }))

          const newSID = await EventStream.fork(sid, e1.id)
          const forkedEvents = await EventStream.replay(newSID)
          expect(forkedEvents).toHaveLength(1)
          expect(forkedEvents[0]!.sessionID).toBe(newSID)
          expect(forkedEvents[0]!.sessionID).not.toBe(sid)
        },
      })
    })

    test("fork including all events gives complete copy", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-fork-all"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))
          const e3 = await EventStream.append(makeReflectionInput({ sessionID: sid }))

          const newSID = await EventStream.fork(sid, e3.id)
          const forkedEvents = await EventStream.replay(newSID)
          expect(forkedEvents).toHaveLength(3)
        },
      })
    })

    test("fork throws for unknown eventID", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-fork-bad"
          await EventStream.append(makeActionInput({ sessionID: sid }))

          await expect(EventStream.fork(sid, "nonexistent-event-id")).rejects.toThrow(
            /nonexistent-event-id/,
          )
        },
      })
    })
  })

  // ── query ──────────────────────────────────────────────────────────────

  describe("query()", () => {
    test("returns all events when filter is empty", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-all"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))
          await EventStream.append(makeReflectionInput({ sessionID: sid }))

          const results = await EventStream.query(sid, {})
          expect(results).toHaveLength(3)
        },
      })
    })

    test("filters by type correctly — only returns matching type", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-type"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeReflectionInput({ sessionID: sid }))

          const actions = await EventStream.query(sid, { type: "action" })
          expect(actions).toHaveLength(2)
          expect(actions.every((e) => e.type === "action")).toBe(true)

          const observations = await EventStream.query(sid, { type: "observation" })
          expect(observations).toHaveLength(1)
          expect(observations[0]!.type).toBe("observation")
        },
      })
    })

    test("filters by agentName correctly", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-agent"
          await EventStream.append(makeActionInput({ sessionID: sid, agentName: "alpha" }))
          await EventStream.append(makeActionInput({ sessionID: sid, agentName: "beta" }))
          await EventStream.append(makeObservationInput({ sessionID: sid, agentName: "alpha" }))

          const alphaEvents = await EventStream.query(sid, { agentName: "alpha" })
          expect(alphaEvents).toHaveLength(2)
          expect(alphaEvents.every((e) => e.agentName === "alpha")).toBe(true)

          const betaEvents = await EventStream.query(sid, { agentName: "beta" })
          expect(betaEvents).toHaveLength(1)
          expect(betaEvents[0]!.agentName).toBe("beta")
        },
      })
    })

    test("filters by afterTimestamp — excludes events at or before the cutoff", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-after"
          const e1 = await EventStream.append(makeActionInput({ sessionID: sid }))
          const e2 = await EventStream.append(makeObservationInput({ sessionID: sid }))
          const e3 = await EventStream.append(makeReflectionInput({ sessionID: sid }))

          // Only events strictly AFTER e1.timestamp
          const results = await EventStream.query(sid, { afterTimestamp: e1.timestamp })
          // e1 itself is excluded (strictly after), e2 and e3 included if timestamps differ
          // In fast tests, timestamps could be equal — so filter the returned IDs instead
          for (const r of results) {
            expect(r.timestamp).toBeGreaterThan(e1.timestamp)
          }
          // All returned events should not include e1
          expect(results.map((e) => e.id)).not.toContain(e1.id)

          void e2; void e3 // used implicitly
        },
      })
    })

    test("filters by beforeTimestamp — excludes events at or after the cutoff", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-before"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          const e2 = await EventStream.append(makeObservationInput({ sessionID: sid }))

          // Only events strictly BEFORE e2.timestamp
          const results = await EventStream.query(sid, { beforeTimestamp: e2.timestamp })
          for (const r of results) {
            expect(r.timestamp).toBeLessThan(e2.timestamp)
          }
          expect(results.map((e) => e.id)).not.toContain(e2.id)
        },
      })
    })

    test("filters by parentEventID", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-parent"
          const root = await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid, parentEventID: root.id }))
          await EventStream.append(makeReflectionInput({ sessionID: sid, parentEventID: root.id }))
          await EventStream.append(makeActionInput({ sessionID: sid })) // no parentEventID

          const children = await EventStream.query(sid, { parentEventID: root.id })
          expect(children).toHaveLength(2)
          expect(children.every((e) => e.parentEventID === root.id)).toBe(true)
        },
      })
    })

    test("combined type + agentName filter returns intersection", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-combined"
          await EventStream.append(makeActionInput({ sessionID: sid, agentName: "alpha" }))
          await EventStream.append(makeActionInput({ sessionID: sid, agentName: "beta" }))
          await EventStream.append(makeObservationInput({ sessionID: sid, agentName: "alpha" }))

          const results = await EventStream.query(sid, { type: "action", agentName: "alpha" })
          expect(results).toHaveLength(1)
          expect(results[0]!.type).toBe("action")
          expect(results[0]!.agentName).toBe("alpha")
        },
      })
    })

    test("returns empty array when no events match the filter", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-query-nomatch"
          await EventStream.append(makeActionInput({ sessionID: sid }))

          const results = await EventStream.query(sid, { type: "reflection" })
          expect(results).toEqual([])
        },
      })
    })
  })

  // ── count ──────────────────────────────────────────────────────────────

  describe("count()", () => {
    test("returns correct count with no filter (counts all JSON files)", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-count-all"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))
          await EventStream.append(makeReflectionInput({ sessionID: sid }))

          const total = await EventStream.count(sid)
          expect(total).toBe(3)
        },
      })
    })

    test("returns 0 for nonexistent session", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const total = await EventStream.count("nonexistent-for-count")
          expect(total).toBe(0)
        },
      })
    })

    test("returns filtered count when filter is provided", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-count-filtered"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))

          const actionCount = await EventStream.count(sid, { type: "action" })
          expect(actionCount).toBe(2)

          const obsCount = await EventStream.count(sid, { type: "observation" })
          expect(obsCount).toBe(1)

          const reflectCount = await EventStream.count(sid, { type: "reflection" })
          expect(reflectCount).toBe(0)
        },
      })
    })
  })

  // ── clear ──────────────────────────────────────────────────────────────

  describe("clear()", () => {
    test("removes all session events from disk", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-clear"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))

          // Confirm events exist
          const before = await EventStream.count(sid)
          expect(before).toBe(2)

          await EventStream.clear(sid)

          // After clear, replay should return empty array (dir is gone)
          const events = await EventStream.replay(sid)
          expect(events).toEqual([])
        },
      })
    })

    test("clear is idempotent — calling twice does not throw", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-clear-idem"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.clear(sid)
          // Second clear should not throw even though dir is gone
          await expect(EventStream.clear(sid)).resolves.toBeUndefined()
        },
      })
    })

    test("count returns 0 after clear", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "sess-count-after-clear"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))
          await EventStream.clear(sid)
          const total = await EventStream.count(sid)
          expect(total).toBe(0)
        },
      })
    })
  })

  // ── sessions ───────────────────────────────────────────────────────────

  describe("sessions()", () => {
    test("lists all session IDs that have recorded events", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await EventStream.append(makeActionInput({ sessionID: "sess-a" }))
          await EventStream.append(makeActionInput({ sessionID: "sess-b" }))
          await EventStream.append(makeActionInput({ sessionID: "sess-c" }))

          const sids = await EventStream.sessions()
          expect(sids).toContain("sess-a")
          expect(sids).toContain("sess-b")
          expect(sids).toContain("sess-c")
        },
      })
    })

    test("returns empty array when no events have been recorded", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sids = await EventStream.sessions()
          expect(sids).toEqual([])
        },
      })
    })

    test("cleared sessions are no longer listed", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await EventStream.append(makeActionInput({ sessionID: "keep-me" }))
          await EventStream.append(makeActionInput({ sessionID: "delete-me" }))

          await EventStream.clear("delete-me")

          const sids = await EventStream.sessions()
          expect(sids).toContain("keep-me")
          expect(sids).not.toContain("delete-me")
        },
      })
    })
  })

  // ── subscribe ──────────────────────────────────────────────────────────

  describe("subscribe()", () => {
    test("receives real-time notification when event is appended", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const received: AgentEvent.Info[] = []
          const unsub = EventStream.subscribe((event) => {
            received.push(event)
          })

          const sid = "sess-subscribe"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await EventStream.append(makeObservationInput({ sessionID: sid }))

          // Allow async bus callbacks to flush
          await new Promise((r) => setTimeout(r, 10))

          expect(received).toHaveLength(2)
          expect(received[0]!.type).toBe("action")
          expect(received[1]!.type).toBe("observation")

          unsub()
        },
      })
    })

    test("unsubscribe stops receiving notifications", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const received: AgentEvent.Info[] = []
          const unsub = EventStream.subscribe((event) => {
            received.push(event)
          })

          const sid = "sess-unsub"
          await EventStream.append(makeActionInput({ sessionID: sid }))
          await new Promise((r) => setTimeout(r, 10))

          unsub()

          await EventStream.append(makeObservationInput({ sessionID: sid }))
          await new Promise((r) => setTimeout(r, 10))

          // Should only have the first event
          expect(received).toHaveLength(1)
          expect(received[0]!.type).toBe("action")
        },
      })
    })
  })
})
