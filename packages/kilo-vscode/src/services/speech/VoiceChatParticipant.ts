// kilocode_change — Phase 6.5: @voice Chat Participant
// Registers a VS Code Chat Participant under the id "kilo.voice".
//
// Instantiate from extension activation:
//   import { VoiceChatParticipant } from "./services/speech/VoiceChatParticipant"
//   // Inside activate():
//   const voiceChatParticipant = new VoiceChatParticipant(context, voiceStudioProvider)
//   context.subscriptions.push(voiceChatParticipant)

import * as vscode from "vscode"
// kilocode_change – value import (not type-only) so getInstance() is callable at runtime
import { VoiceStudioProvider } from "../../VoiceStudioProvider"

// ── Constants ─────────────────────────────────────────────────────────────────

const PARTICIPANT_ID = "kilo.voice"

// globalState key that VoiceStudioProvider uses for the agent→voice map
const GS_VOICE_AGENT_MAP = "kilocode.voiceAgentMap"

// Inline type matching VoiceRouter.VoiceConfig to avoid a circular import
interface AgentVoiceConfig {
  voiceId: string
  provider: string
  pitch?: number
  rate?: number
}

// ── VoiceChatParticipant ──────────────────────────────────────────────────────

/**
 * A VS Code Chat Participant that responds to @voice commands inside the
 * built-in Copilot Chat panel (or any chat extension that supports participants).
 *
 * Supported commands:
 *   @voice /switch [voice]  – switch the active voice and notify VoiceStudioProvider
 *   @voice /cast            – list the current agent→voice assignment table
 *   @voice /compare         – speak the most recent assistant response in all voices
 *   @voice /status          – report the active voice and provider health
 *
 * Each command that produces text includes a "🔊 Speak This" inline button that
 * fires the `kilo.speakResponse` command so the user can hear the reply.
 */
export class VoiceChatParticipant implements vscode.Disposable {
  private readonly participant: vscode.ChatParticipant

  // kilocode_change – voiceStudioProvider is optional; resolved lazily via
  // VoiceStudioProvider.getInstance() so the participant can be registered at
  // extension activation before the panel has been opened for the first time.
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly voiceStudioProviderRef?: VoiceStudioProvider,
  ) {
    this.participant = vscode.chat.createChatParticipant(
      PARTICIPANT_ID,
      (request, ctx, stream, token) => this.handleRequest(request, ctx, stream, token),
    )

    this.participant.iconPath = new vscode.ThemeIcon("unmute")
  }

  /** Returns the live VoiceStudioProvider instance (eager ref or singleton). */
  private get voiceStudioProvider(): VoiceStudioProvider | undefined {
    return this.voiceStudioProviderRef ?? VoiceStudioProvider.getInstance()
  }

  // ── Request handler ────────────────────────────────────────────────────────

  private async handleRequest(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    const command = request.command ?? ""
    const prompt = request.prompt.trim()

    // Route by sub-command
    if (command === "switch" || (!command && prompt.startsWith("/switch"))) {
      return this.handleSwitch(prompt.replace(/^\/switch\s*/i, "").trim() || command, stream)
    }

    if (command === "cast" || (!command && prompt.toLowerCase() === "/cast")) {
      return this.handleCast(stream)
    }

    if (command === "compare" || (!command && prompt.toLowerCase() === "/compare")) {
      return this.handleCompare(stream)
    }

    if (command === "status" || (!command && prompt.toLowerCase() === "/status") || !command) {
      // Bare "@voice" with no sub-command → show status
      return this.handleStatus(stream)
    }

    // Fallback — unknown input
    stream.markdown(
      "Unknown @voice command. Try one of:\n" +
      "- `@voice /switch [voice-name]` — switch active voice\n" +
      "- `@voice /cast` — show agent→voice assignments\n" +
      "- `@voice /compare` — replay last response in all voices\n" +
      "- `@voice /status` — show active voice and provider health\n",
    )
    return {}
  }

  // ── /switch ────────────────────────────────────────────────────────────────

  private async handleSwitch(rawArgs: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    // Arguments may come from: the command name field, or inline in the prompt
    // e.g. @voice /switch snoop-dogg OR @voice switch snoop-dogg
    const voiceName = rawArgs.replace(/^switch\s*/i, "").trim()

    if (!voiceName) {
      stream.markdown("Please provide a voice name. Example: `@voice /switch snoop-dogg`")
      return {}
    }

    const replyText = `Switching to **${voiceName}**...`
    stream.markdown(replyText)

    // kilocode_change – persist the voice switch directly to VS Code configuration
    // (postToVoiceStudio sends TO the webview; to actually save the config we must
    // update it here, then notify the webview of the resulting change).
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const provider = speech.get<string>("provider", "browser")

    try {
      switch (provider) {
        case "rvc":
          await speech.update("rvc.voiceId", voiceName, vscode.ConfigurationTarget.Global)
          break
        case "azure":
          await speech.update("azure.voiceId", voiceName, vscode.ConfigurationTarget.Global)
          break
        case "browser":
        default:
          await speech.update("browser.voiceURI", voiceName, vscode.ConfigurationTarget.Global)
          break
      }
    } catch (configErr) {
      // Non-fatal — webview will still be notified; the user may need to re-save
      console.warn("[VoiceChatParticipant] Failed to persist voice switch:", configErr)
    }

    // Notify the webview panel so the Voice Studio UI reflects the change immediately
    this.postToVoiceStudio({ type: "activeVoiceChanged", voiceId: voiceName, provider, source: "chatParticipant" })

    stream.button({
      title: "🔊 Speak This",
      command: "kilo.speakResponse",
      arguments: [replyText],
    })

    return {}
  }

  // ── /cast ──────────────────────────────────────────────────────────────────

  private async handleCast(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    const agentMap = this.context.globalState.get<Record<string, AgentVoiceConfig>>(
      GS_VOICE_AGENT_MAP,
      {},
    )

    const entries = Object.entries(agentMap)

    if (entries.length === 0) {
      stream.markdown("No agent→voice assignments configured yet. Use `@voice /switch` to assign voices.")
      return {}
    }

    // Render as a markdown table
    const lines: string[] = [
      "| Agent | Voice ID | Provider | Rate | Pitch |",
      "| ----- | -------- | -------- | ---- | ----- |",
    ]

    for (const [agent, cfg] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const rate = cfg.rate !== undefined ? String(cfg.rate) : "—"
      const pitch = cfg.pitch !== undefined ? String(cfg.pitch) : "—"
      lines.push(`| \`${agent}\` | ${cfg.voiceId} | ${cfg.provider} | ${rate} | ${pitch} |`)
    }

    const replyText = lines.join("\n")
    stream.markdown(replyText)

    stream.button({
      title: "🔊 Speak This",
      command: "kilo.speakResponse",
      arguments: [`Agent voice cast has ${entries.length} assignments.`],
    })

    return {}
  }

  // ── /compare ───────────────────────────────────────────────────────────────

  private async handleCompare(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    const replyText = "Speaking in all installed voices sequentially..."
    stream.markdown(replyText)

    // Ask VoiceStudioProvider to run a comparison sweep.
    // The webview handles playing audio in each installed voice for a sample phrase.
    this.postToVoiceStudio({ type: "voiceCompare" })

    stream.button({
      title: "🔊 Speak This",
      command: "kilo.speakResponse",
      arguments: [replyText],
    })

    return {}
  }

  // ── /status ────────────────────────────────────────────────────────────────

  private async handleStatus(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")

    const enabled = speech.get<boolean>("enabled", false)
    const provider = speech.get<string>("provider", "browser")

    // Resolve the active voice ID from whichever provider is active
    let voiceId = "(none)"
    switch (provider) {
      case "rvc":
        voiceId = speech.get<string>("rvc.voiceId", "") || "(none)"
        break
      case "azure":
        voiceId = speech.get<string>("azure.voiceId", "") || "(none)"
        break
      case "browser":
        voiceId = speech.get<string>("browser.voiceURI", "") || "(system default)"
        break
    }

    // Do a quick health probe for the active provider
    const healthy = await this.probeProviderHealth(provider, speech)
    const healthLabel = healthy ? "✅ healthy" : "⚠️ unavailable"

    const lines: string[] = [
      "## Voice Status",
      "",
      `| Property | Value |`,
      `| -------- | ----- |`,
      `| **Active voice** | ${voiceId} |`,
      `| **Provider** | ${provider} |`,
      `| **Provider health** | ${healthLabel} |`,
      `| **Speech enabled** | ${enabled ? "yes" : "no"} |`,
      `| **Auto-speak** | ${speech.get<boolean>("autoSpeak", false) ? "yes" : "no"} |`,
    ]

    const replyText = lines.join("\n")
    stream.markdown(replyText)

    stream.button({
      title: "🔊 Speak This",
      command: "kilo.speakResponse",
      arguments: [
        `Active voice is ${voiceId} using ${provider} provider. Provider is ${healthy ? "healthy" : "unavailable"}.`,
      ],
    })

    return {}
  }

  // ── Provider health probe ──────────────────────────────────────────────────

  /**
   * Quickly determines whether the given provider is reachable.
   * - browser: always healthy (no network call needed)
   * - azure:   healthy if apiKey + region are non-empty
   * - rvc:     healthy if the Docker health endpoint responds 200 within 3 s
   */
  private async probeProviderHealth(
    provider: string,
    speech: vscode.WorkspaceConfiguration,
  ): Promise<boolean> {
    if (provider === "browser") return true

    if (provider === "azure") {
      const key = speech.get<string>("azure.apiKey", "")
      const region = speech.get<string>("azure.region", "")
      return !!(key && region)
    }

    if (provider === "rvc") {
      const port = speech.get<number>("rvc.dockerPort", 5050)
      try {
        const http = await import("http")
        const result = await new Promise<boolean>((resolve) => {
          const req = http.get(
            `http://localhost:${port}/health`,
            { timeout: 3000 },
            (res) => resolve(res.statusCode === 200),
          )
          req.on("error", () => resolve(false))
          req.on("timeout", () => {
            req.destroy()
            resolve(false)
          })
        })
        return result
      } catch {
        return false
      }
    }

    return false
  }

  // ── Internal: post to VoiceStudio webview ─────────────────────────────────

  /**
   * Forward a message to the VoiceStudioProvider panel webview via the public
   * `postToWebview` method added in Phase 6.5.  If the panel is not open the
   * provider silently drops the message; it will re-sync state the next time
   * the panel opens via `requestVoiceStudioState`.
   */
  private postToVoiceStudio(message: Record<string, unknown>): void {
    // kilocode_change – guard: the VoiceStudio panel may not be open yet
    this.voiceStudioProvider?.postToWebview(message)
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose(): void {
    this.participant.dispose()
  }
}
