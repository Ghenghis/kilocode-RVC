// kilocode_change — event-sourced agent state: append-only event stream with replay
import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AgentEvent } from "./event"

export namespace EventStream {
  const log = Log.create({ service: "event-stream" })

  // ── Bus events ──────────────────────────────────────────────────────
  export const Event = {
    Appended: BusEvent.define(
      "event-stream.appended",
      AgentEvent.Info,
    ),
  }

  // kilocode_change — monotonic timestamp counter: guarantees that two appends
  // within the same millisecond receive distinct, strictly-increasing timestamps
  // so that lexicographic filename sort always reflects insertion order.
  let _lastTs = 0

  function monotonicNow(): number {
    const now = Date.now()
    _lastTs = now > _lastTs ? now : _lastTs + 1
    return _lastTs
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function eventsDir(sessionID: string): string {
    return path.join(Instance.directory, ".kilo", "events", sessionID) // kilocode_change: use Instance.directory, not Instance.worktree
  }

  function eventFilename(event: AgentEvent.Info): string {
    // Zero-pad timestamp so lexicographic sort == chronological sort
    const ts = String(event.timestamp).padStart(15, "0")
    return `${ts}_${event.id}.json`
  }

  async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  // ── Core operations ─────────────────────────────────────────────────

  /**
   * Append a new event to the session's append-only log.
   * Writes one JSON file per event into `.kilo/events/{sessionID}/`.
   * Publishes on the bus so subscribers receive real-time notifications.
   */
  export async function append(
    input: Omit<AgentEvent.Info, "id" | "timestamp">,
  ): Promise<AgentEvent.Info> {
    const event: AgentEvent.Info = AgentEvent.Info.parse({
      ...input,
      id: randomUUID(),
      timestamp: monotonicNow(), // kilocode_change: monotonic to preserve insertion order within same ms
    })

    const dir = eventsDir(event.sessionID)
    await ensureDir(dir)

    const filePath = path.join(dir, eventFilename(event))
    const data = JSON.stringify(event, null, 2)
    await fs.writeFile(filePath, data, "utf-8")

    log.info("event appended", {
      id: event.id,
      sessionID: event.sessionID,
      type: event.type,
      agent: event.agentName,
    })

    await Bus.publish(Event.Appended, event)

    return event
  }

  /**
   * Replay all events for a session in chronological order.
   * Reads every JSON file from `.kilo/events/{sessionID}/`, parses
   * and returns them sorted by timestamp (the filename prefix guarantees
   * lexicographic == chronological).
   */
  export async function replay(sessionID: string): Promise<AgentEvent.Info[]> {
    const dir = eventsDir(sessionID)

    const files = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []
      throw err
    })

    if (files.length === 0) return []

    // Lexicographic sort on the zero-padded timestamp filenames
    const sorted = files.filter((f) => f.endsWith(".json")).sort()

    const events: AgentEvent.Info[] = []
    for (const file of sorted) {
      const raw = await fs.readFile(path.join(dir, file), "utf-8")
      try { // kilocode_change: wrap in try/catch so SyntaxError from JSON.parse doesn't propagate
        const parsed = AgentEvent.Info.safeParse(JSON.parse(raw))
        if (parsed.success) {
          events.push(parsed.data)
        } else {
          log.warn("skipping malformed event file", { file, sessionID, error: parsed.error.message })
        }
      } catch {
        log.warn("skipping unparseable event file", { file, sessionID })
      }
    }

    return events
  }

  /**
   * Subscribe to real-time event notifications.
   * Returns an unsubscribe function.
   */
  export function subscribe(
    callback: (event: AgentEvent.Info) => void,
  ): () => void {
    return Bus.subscribe(Event.Appended, (busEvent) => {
      callback(busEvent.properties)
    })
  }

  /**
   * Fork a session's event stream at a given event.
   * Creates a new session directory containing copies of all events
   * up to and including `fromEventID`. Returns the new session ID.
   */
  export async function fork(
    sessionID: string,
    fromEventID: string,
  ): Promise<string> {
    const events = await replay(sessionID)

    const cutoffIndex = events.findIndex((e) => e.id === fromEventID)
    if (cutoffIndex === -1) {
      throw new Error(
        `event "${fromEventID}" not found in session "${sessionID}"`,
      )
    }

    const forkedEvents = events.slice(0, cutoffIndex + 1)
    const newSessionID = randomUUID()
    const newDir = eventsDir(newSessionID)
    await ensureDir(newDir)

    for (const original of forkedEvents) {
      const forked: AgentEvent.Info = {
        ...original,
        sessionID: newSessionID,
      }
      const filePath = path.join(newDir, eventFilename(forked))
      await fs.writeFile(filePath, JSON.stringify(forked, null, 2), "utf-8")
    }

    log.info("session forked", {
      sourceSessionID: sessionID,
      fromEventID,
      newSessionID,
      eventCount: forkedEvents.length,
    })

    return newSessionID
  }

  /**
   * Query events within a session, filtered by type, agent, or time range.
   */
  export async function query(
    sessionID: string,
    filter: AgentEvent.Filter,
  ): Promise<AgentEvent.Info[]> {
    const events = await replay(sessionID)

    return events.filter((event) => {
      if (filter.type !== undefined && event.type !== filter.type) return false
      if (filter.agentName !== undefined && event.agentName !== filter.agentName) return false
      if (filter.afterTimestamp !== undefined && event.timestamp <= filter.afterTimestamp) return false
      if (filter.beforeTimestamp !== undefined && event.timestamp >= filter.beforeTimestamp) return false
      if (filter.parentEventID !== undefined && event.parentEventID !== filter.parentEventID) return false
      return true
    })
  }

  /**
   * Count events in a session, optionally filtered.
   */
  export async function count(
    sessionID: string,
    filter?: AgentEvent.Filter,
  ): Promise<number> {
    if (!filter) {
      const dir = eventsDir(sessionID)
      const files = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return []
        throw err
      })
      return files.filter((f) => f.endsWith(".json")).length
    }
    const results = await query(sessionID, filter)
    return results.length
  }

  /**
   * List all session IDs that have recorded events.
   */
  export async function sessions(): Promise<string[]> {
    const base = path.join(Instance.directory, ".kilo", "events") // kilocode_change: use Instance.directory, not Instance.worktree
    const entries = await fs.readdir(base, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []
      throw err
    })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  }

  /**
   * Remove all events for a session from disk.
   */
  export async function clear(sessionID: string): Promise<void> {
    const dir = eventsDir(sessionID)
    await fs.rm(dir, { recursive: true, force: true })
    log.info("session events cleared", { sessionID })
  }
}
