/**
 * DebugCollector — E2E KiloCode Debugger
 *
 * Singleton service that intercepts all message buses, CLI I/O, and SSE events.
 * When enabled it writes structured JSONL logs to ~/.kilo-debug/ so AI agents
 * and developers can read them with any file tool.
 *
 * Key output files:
 *   ~/.kilo-debug/session-<timestamp>.jsonl  — full append-only log for this session
 *   ~/.kilo-debug/latest.json               — rolling snapshot of last 100 entries
 *   ~/.kilo-debug/index.json                — list of all sessions
 */

import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import * as vscode from "vscode"

export type DebugSource =
  | "webview->ext" // webview sent a message to the extension
  | "ext->webview" // extension sent a message to a webview
  | "cli-stdout" // CLI process standard output
  | "cli-stderr" // CLI process standard error
  | "sse-event" // SSE event pushed from CLI backend
  | "console" // webview console.log bridge
  | "error" // unhandled error caught by a handler
  | "lifecycle" // provider / connection lifecycle events

export interface DebugEntry {
  id: string
  ts: number
  isoTime: string
  source: DebugSource
  provider: string
  type?: string
  sessionId?: string
  data: unknown
}

export class DebugCollector {
  private static _instance: DebugCollector | null = null

  private enabled = false
  private entries: DebugEntry[] = []
  private readonly MAX_ENTRIES = 2000
  private outputChannel: vscode.OutputChannel | null = null
  private logFile = ""
  private snapshotFile = ""
  private snapshotPending = false
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------------------
  // Singleton access
  // ---------------------------------------------------------------------------

  static getInstance(): DebugCollector {
    if (!this._instance) this._instance = new DebugCollector()
    return this._instance
  }

  private constructor() {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  enable(context: vscode.ExtensionContext): void {
    if (this.enabled) return
    this.enabled = true

    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("KiloCode Debug")
      context.subscriptions.push(this.outputChannel)
    }

    // Prepare output directory
    const debugDir = path.join(os.homedir(), ".kilo-debug")
    try {
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
    } catch {
      // Ignore — recording will simply skip file writes
    }

    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-").slice(0, 19)
    this.logFile = path.join(debugDir, `session-${ts}.jsonl`)
    this.snapshotFile = path.join(debugDir, "latest.json")

    this._updateIndex(debugDir)

    this.record({
      source: "lifecycle",
      provider: "DebugCollector",
      type: "started",
      data: { logFile: this.logFile, snapshotFile: this.snapshotFile },
    })

    this.outputChannel.appendLine(`[KiloCode Debug] ✅ Started`)
    this.outputChannel.appendLine(`[KiloCode Debug] 📄 Log: ${this.logFile}`)
    this.outputChannel.appendLine(`[KiloCode Debug] 📄 Snapshot: ${this.snapshotFile}`)
    this.outputChannel.show(true)
  }

  disable(): void {
    if (!this.enabled) return
    this.record({ source: "lifecycle", provider: "DebugCollector", type: "stopped", data: {} })
    this.enabled = false
    this.outputChannel?.appendLine("[KiloCode Debug] 🔴 Stopped")
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /** Path to the current JSONL log — useful for AI agents to read with the Read tool. */
  getLogFile(): string {
    return this.logFile
  }

  /** Path to the rolling snapshot JSON — always contains the last 100 entries. */
  getSnapshotFile(): string {
    return this.snapshotFile
  }

  // ---------------------------------------------------------------------------
  // Core recording
  // ---------------------------------------------------------------------------

  record(entry: Omit<DebugEntry, "id" | "ts" | "isoTime">): void {
    // Always allow lifecycle events even when disabled (enable/disable itself)
    if (!this.enabled && entry.source !== "lifecycle") return

    const now = Date.now()
    const full: DebugEntry = {
      id: crypto.randomBytes(4).toString("hex"),
      ts: now,
      isoTime: new Date(now).toISOString(),
      ...entry,
    }

    this.entries.push(full)
    if (this.entries.length > this.MAX_ENTRIES) this.entries.shift()

    // Output channel — brief human-readable line
    if (this.outputChannel) {
      const time = full.isoTime.slice(11, 23)
      const src = full.source.padEnd(12)
      const prov = (full.provider ?? "?").padEnd(20)
      const typ = full.type ? `  ${full.type}` : ""
      let detail = ""
      if (full.source === "cli-stdout" || full.source === "cli-stderr") {
        const text = String(full.data ?? "").replace(/\n/g, "↵").slice(0, 120)
        detail = `  ${text}`
      } else if (full.source === "error") {
        const d = full.data as Record<string, unknown>
        detail = `  ${String(d?.error ?? "").slice(0, 120)}`
      }
      this.outputChannel.appendLine(`[${time}] ${src} ${prov}${typ}${detail}`)
    }

    // Append to JSONL file
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, JSON.stringify(full) + "\n")
      } catch {
        // Ignore disk errors — don't crash the extension
      }
    }

    // Debounced snapshot
    this._scheduleSnapshot()
  }

  // ---------------------------------------------------------------------------
  // Typed helpers used by providers / ServerManager
  // ---------------------------------------------------------------------------

  /** Log an incoming webview message (webview → extension). */
  recordIncoming(provider: string, msg: Record<string, unknown>): void {
    this.record({
      source: "webview->ext",
      provider,
      type: typeof msg.type === "string" ? msg.type : undefined,
      data: this._sanitize(msg),
    })
  }

  /** Log an outgoing extension message (extension → webview). */
  recordOutgoing(provider: string, msg: unknown): void {
    const type =
      typeof msg === "object" &&
      msg !== null &&
      "type" in msg &&
      typeof (msg as { type?: unknown }).type === "string"
        ? (msg as { type: string }).type
        : undefined
    this.record({
      source: "ext->webview",
      provider,
      type,
      data: this._sanitize(msg),
    })
  }

  /** Log CLI stdout/stderr. */
  recordCli(source: "cli-stdout" | "cli-stderr", data: string): void {
    this.record({ source, provider: "ServerManager", data: data.trimEnd() })
  }

  /** Log an SSE event from the CLI backend. */
  recordSSE(eventType: string, data: unknown): void {
    this.record({ source: "sse-event", provider: "SdkSSEAdapter", type: eventType, data: this._sanitize(data) })
  }

  /** Log a webview console message (bridged via kiloDebugConsole message). */
  recordConsole(provider: string, level: string, args: unknown[]): void {
    this.record({ source: "console", provider, type: level, data: args })
  }

  /** Log an error caught in a handler. */
  recordError(provider: string, error: unknown, context?: string): void {
    this.record({
      source: "error",
      provider,
      type: context,
      data: {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Hook factory — attach to KiloProvider
  // ---------------------------------------------------------------------------

  /**
   * Returns an object with in/out hooks suitable for a provider's debug hook.
   *
   * Usage in extension.ts:
   *   provider.setDebugHook(DebugCollector.getInstance().makeProviderHook("KiloProvider"))
   */
  makeProviderHook(providerName: string): {
    in: (msg: Record<string, unknown>) => void
    out: (msg: unknown) => void
  } {
    return {
      in: (msg) => this.recordIncoming(providerName, msg),
      out: (msg) => this.recordOutgoing(providerName, msg),
    }
  }

  // ---------------------------------------------------------------------------
  // Query helpers (for AI-readable output)
  // ---------------------------------------------------------------------------

  /** Return the last N entries as a JSON string. */
  dumpLastN(n = 100): string {
    return JSON.stringify(this.entries.slice(-n), null, 2)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _scheduleSnapshot(): void {
    if (this.snapshotPending) return
    this.snapshotPending = true
    this.snapshotTimer = setTimeout(() => {
      this.snapshotPending = false
      this.snapshotTimer = null
      this._writeSnapshot()
    }, 500)
  }

  private _writeSnapshot(): void {
    if (!this.snapshotFile) return
    try {
      const snapshot = {
        generatedAt: new Date().toISOString(),
        logFile: this.logFile,
        totalEntriesSinceStart: this.entries.length,
        entries: this.entries.slice(-100),
      }
      fs.writeFileSync(this.snapshotFile, JSON.stringify(snapshot, null, 2))
    } catch {
      // Ignore
    }
  }

  private _updateIndex(debugDir: string): void {
    const indexFile = path.join(debugDir, "index.json")
    let sessions: string[] = []
    try {
      const existing = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { sessions?: string[] }
      sessions = existing.sessions ?? []
    } catch {
      // Fresh start
    }
    sessions.push(path.basename(this.logFile))
    if (sessions.length > 20) sessions = sessions.slice(-20)
    try {
      fs.writeFileSync(
        indexFile,
        JSON.stringify(
          {
            sessions,
            latest: path.basename(this.logFile),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      )
    } catch {
      // Ignore
    }
  }

  /** Redact sensitive fields before logging. */
  private _sanitize(value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value
    const obj = value as Record<string, unknown>
    const SENSITIVE = new Set(["password", "token", "secret", "apiKey", "KILO_SERVER_PASSWORD"])
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE.has(k) ? "[REDACTED]" : this._sanitize(v)
    }
    return out
  }
}
