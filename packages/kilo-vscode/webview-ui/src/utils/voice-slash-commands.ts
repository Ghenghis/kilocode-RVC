// kilocode_change — Phase 6.1: Voice slash commands handler
// Parses and dispatches /voice commands entered in chat or command palette.
// Supported: /voice [name], /voice auto, /voice compare, /voice status

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceCommandResult {
  handled: boolean
  message?: string   // User-facing feedback
  action?: string    // What was done
}

export type VoiceCommandDispatcher = {
  switchVoice: (voiceId: string) => Promise<void>
  enableAutoRoute: () => void
  compareVoices: (text: string) => Promise<void>
  getStatus: () => { voiceId: string; provider: string; healthy: boolean }
}

// ── Parsed command shape ───────────────────────────────────────────────────────

export interface ParsedVoiceCommand {
  command: string
  args: string
}

// ── Tracking last spoken text for /voice compare ──────────────────────────────
// Populated externally by calling setLastSpokenText() after each speak() call.

let _lastSpokenText = ""

/**
 * Update the stored "last spoken" text so that `/voice compare` can replay
 * the most recent output across all installed voices.
 * Call this from your speak/TTS path after each successful synthesis.
 */
export function setLastSpokenText(text: string): void {
  if (text && text.trim().length > 0) {
    _lastSpokenText = text.trim()
  }
}

/** Returns the last text that was spoken, or a sensible fallback. */
export function getLastSpokenText(): string {
  return _lastSpokenText || "Hello, this is a voice comparison sample."
}

// ── parseVoiceCommand ─────────────────────────────────────────────────────────

/**
 * Parse a raw input string and extract the /voice sub-command and its args.
 *
 * Returns null if the input is not a /voice command.
 *
 * Mapping:
 *   "/voice auto"           → { command: "auto",    args: "" }
 *   "/voice compare"        → { command: "compare", args: "" }
 *   "/voice status"         → { command: "status",  args: "" }
 *   "/voice snoop-dogg"     → { command: "switch",  args: "snoop-dogg" }
 *   "/voice Aria Neural"    → { command: "switch",  args: "Aria Neural" }
 */
export function parseVoiceCommand(input: string): ParsedVoiceCommand | null {
  if (!input) return null

  // Must begin with /voice (case-insensitive), optionally followed by whitespace and args
  const match = input.match(/^\/voice(?:\s+(.*))?$/i)
  if (!match) return null

  const rest = (match[1] ?? "").trim()

  if (rest === "") {
    // Bare "/voice" — treat as status
    return { command: "status", args: "" }
  }

  const lower = rest.toLowerCase()

  if (lower === "auto") {
    return { command: "auto", args: "" }
  }

  if (lower === "compare") {
    return { command: "compare", args: "" }
  }

  if (lower === "status") {
    return { command: "status", args: "" }
  }

  // Everything else is treated as a voice name to switch to
  return { command: "switch", args: rest }
}

// ── handleVoiceCommand ────────────────────────────────────────────────────────

/**
 * Handle a /voice slash command end-to-end.
 *
 * 1. Parses the input string.
 * 2. Dispatches the appropriate action via the dispatcher.
 * 3. Returns a VoiceCommandResult with a user-facing message.
 *
 * Returns `{ handled: false }` if the input is not a /voice command.
 */
export async function handleVoiceCommand(
  input: string,
  dispatcher: VoiceCommandDispatcher,
): Promise<VoiceCommandResult> {
  const parsed = parseVoiceCommand(input)

  if (!parsed) {
    return { handled: false }
  }

  switch (parsed.command) {
    case "switch": {
      const voiceName = parsed.args
      if (!voiceName) {
        return {
          handled: true,
          action: "switch",
          message: "Please specify a voice name. Example: /voice snoop-dogg",
        }
      }
      try {
        await dispatcher.switchVoice(voiceName)
        return {
          handled: true,
          action: "switch",
          message: `Switched to ${voiceName}`,
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err)
        return {
          handled: true,
          action: "switch",
          message: `Failed to switch voice: ${reason}`,
        }
      }
    }

    case "auto": {
      try {
        dispatcher.enableAutoRoute()
        return {
          handled: true,
          action: "auto",
          message: "Context-aware routing enabled",
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err)
        return {
          handled: true,
          action: "auto",
          message: `Failed to enable auto-routing: ${reason}`,
        }
      }
    }

    case "compare": {
      const text = getLastSpokenText()
      try {
        await dispatcher.compareVoices(text)
        return {
          handled: true,
          action: "compare",
          message: "Playing in all installed voices",
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err)
        return {
          handled: true,
          action: "compare",
          message: `Voice comparison failed: ${reason}`,
        }
      }
    }

    case "status": {
      try {
        const status = dispatcher.getStatus()
        const healthLabel = status.healthy ? "healthy" : "unavailable"
        const message = [
          `Active voice: ${status.voiceId || "(none)"}`,
          `Provider: ${status.provider || "(none)"}`,
          `Provider status: ${healthLabel}`,
        ].join(" | ")
        return {
          handled: true,
          action: "status",
          message,
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err)
        return {
          handled: true,
          action: "status",
          message: `Failed to retrieve status: ${reason}`,
        }
      }
    }

    default:
      return {
        handled: false,
        message: `Unknown /voice sub-command: ${parsed.command}`,
      }
  }
}
