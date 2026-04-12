// kilocode_change — Phase 6.4: Session Recording and Replay
// Records TTS outputs as timestamped entries for session replay

/**
 * SessionRecorder — captures every spoken TTS output during a session and
 * allows export in two formats:
 *
 *   JSON  — machine-readable array of RecordingEntry objects for tooling
 *   M3U8  — extended playlist with EXT-X-DISCONTINUITY and timestamp markers
 *            suitable for media player sync or subtitle generation
 *
 * Recording is opt-in: call start() before speaking, stop() when done.
 * The globalRecorder singleton is ready to use without instantiation.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordingEntry {
  /** Unix timestamp (ms) at the moment synthesis was initiated */
  timestamp: number
  /** Chat message ID that triggered this TTS output */
  messageId: string
  /** Filtered text that was actually sent to the speech engine */
  text: string
  /** Voice identifier used for synthesis */
  voiceId: string
  /** Provider that performed synthesis ("browser" | "azure" | "rvc") */
  provider: string
  /** Measured audio duration in milliseconds (set after playback completes) */
  durationMs?: number
}

// ── SessionRecorder ───────────────────────────────────────────────────────────

export class SessionRecorder {
  // kilocode_change — internal log of every TTS entry recorded this session
  private entries: RecordingEntry[] = []
  private recording = false

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Begin recording.  Clears any previous entries first. */
  start(): void {
    this.entries = []
    this.recording = true
  }

  /**
   * Stop recording.  Existing entries are preserved so they can still be
   * exported after calling stop().
   */
  stop(): void {
    this.recording = false
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  /**
   * Append a new entry.  No-ops silently when not recording so callers do not
   * need to check `isRecording` before every speak() call.
   */
  record(entry: RecordingEntry): void {
    if (!this.recording) return
    this.entries.push({ ...entry })
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /** Return a shallow copy of all recorded entries in insertion order. */
  getEntries(): RecordingEntry[] {
    return [...this.entries]
  }

  /** True while recording is active. */
  get isRecording(): boolean {
    return this.recording
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  /**
   * Erase all entries and stop recording.
   * Call before starting a fresh session.
   */
  clear(): void {
    this.entries = []
    this.recording = false
  }

  // ── Export — JSON ──────────────────────────────────────────────────────────

  /**
   * Serialise all entries as a JSON Blob ready for download.
   *
   * Shape:
   *   {
   *     "version": 1,
   *     "exportedAt": "<ISO-8601>",
   *     "entryCount": N,
   *     "entries": [ ...RecordingEntry ]
   *   }
   */
  exportJSON(): Blob {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entryCount: this.entries.length,
      entries: this.entries,
    }
    return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  }

  // ── Export — M3U8 ─────────────────────────────────────────────────────────

  /**
   * Generate an extended M3U8 playlist with per-entry timestamp markers.
   *
   * Each TTS entry becomes one logical segment.  EXT-X-DISCONTINUITY tags
   * separate entries recorded more than 1 s apart.  Custom EXT-X-KILOCODE
   * tags carry the message ID, voice, and provider so downstream tools can
   * correlate playlist segments back to chat messages.
   *
   * Example segment:
   *
   *   #EXT-X-DISCONTINUITY
   *   #EXT-X-KILOCODE:messageId="msg-42",voiceId="en-US-AriaNeural",provider="azure"
   *   #EXTINF:3.500,Hello world
   *   data:audio/mp3;base64,...   ← placeholder; real file paths differ per use-case
   *
   * @param title  Human-readable title embedded in EXT-X-SESSION-DATA.
   */
  exportM3U8(title: string): string {
    const lines: string[] = []

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push("#EXTM3U")
    lines.push("#EXT-X-VERSION:3")
    lines.push(`#EXT-X-SESSION-DATA:DATA-ID="com.kilocode.session-title",VALUE="${this._escapeM3U8(title)}"`)
    lines.push(`#EXT-X-SESSION-DATA:DATA-ID="com.kilocode.exported-at",VALUE="${new Date().toISOString()}"`)
    lines.push(`#EXT-X-SESSION-DATA:DATA-ID="com.kilocode.entry-count",VALUE="${this.entries.length}"`)
    lines.push("")

    if (this.entries.length === 0) {
      lines.push("#EXT-X-ENDLIST")
      return lines.join("\n")
    }

    // ── Segments ─────────────────────────────────────────────────────────────
    const DISCONTINUITY_GAP_MS = 1000

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]
      const prev = this.entries[i - 1]

      // Insert discontinuity marker when gap between entries exceeds threshold
      if (i === 0 || (prev && entry.timestamp - prev.timestamp > DISCONTINUITY_GAP_MS)) {
        lines.push("#EXT-X-DISCONTINUITY")
      }

      // Timestamp comment for human readers
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(entry.timestamp).toISOString()}`)

      // Custom KiloCode tag — carries message correlation metadata
      const kvPairs = [
        `messageId="${this._escapeM3U8(entry.messageId)}"`,
        `voiceId="${this._escapeM3U8(entry.voiceId)}"`,
        `provider="${this._escapeM3U8(entry.provider)}"`,
      ].join(",")
      lines.push(`#EXT-X-KILOCODE:${kvPairs}`)

      // Segment duration in seconds (use durationMs if known, else estimate 1 s/100 chars)
      const durationSec =
        entry.durationMs !== undefined
          ? entry.durationMs / 1000
          : Math.max(0.5, entry.text.length / 100)

      // EXTINF duration + first 60 chars of text as the segment title
      const segTitle = entry.text.slice(0, 60).replace(/,/g, " ").trim()
      lines.push(`#EXTINF:${durationSec.toFixed(3)},${segTitle}`)

      // Segment URI — placeholder; real implementations point to audio file paths
      lines.push(`kilocode-tts-${entry.timestamp}-${i}.mp3`)
      lines.push("")
    }

    lines.push("#EXT-X-ENDLIST")
    return lines.join("\n")
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Escape characters that would break M3U8 attribute values.
   * M3U8 quoted-strings must not contain raw double-quotes or newlines.
   */
  private _escapeM3U8(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, " ")
  }
}

// ── Global singleton ──────────────────────────────────────────────────────────

/**
 * Global SessionRecorder — import and use directly.
 *
 * Usage:
 *   import { globalRecorder } from "./session-recorder"
 *
 *   globalRecorder.start()
 *   // ...after each speak():
 *   globalRecorder.record({ timestamp: Date.now(), messageId, text, voiceId, provider, durationMs })
 *   globalRecorder.stop()
 *
 *   const blob = globalRecorder.exportJSON()
 *   const playlist = globalRecorder.exportM3U8("My Session")
 */
// kilocode_change — singleton exported for use by SpeechEngine and auto-speak hooks
export const globalRecorder = new SessionRecorder()
