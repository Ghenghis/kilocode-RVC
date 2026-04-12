// kilocode_change — Phase 2.1: Voice Router service mapping agent IDs to voice configs

import * as vscode from "vscode"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceProvider = "rvc" | "azure" | "browser"

export interface VoiceConfig {
  voiceId: string
  provider: VoiceProvider
  pitch?: number
  rate?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GS_VOICE_AGENT_MAP = "kilocode.voiceAgentMap"

const DEFAULT_MAP: Record<string, VoiceConfig> = {
  code: { voiceId: "default", provider: "browser", rate: 1.0 },
  debug: { voiceId: "default", provider: "browser", rate: 0.95 },
  explore: { voiceId: "default", provider: "browser", rate: 1.05 },
  plan: { voiceId: "default", provider: "browser", rate: 0.9 },
  ask: { voiceId: "default", provider: "browser", rate: 1.0 },
}

// ---------------------------------------------------------------------------
// VoiceRouter
// ---------------------------------------------------------------------------

/**
 * Maps agent names / agent types to voice configurations and persists the
 * mapping in VS Code globalState under `kilocode.voiceAgentMap`.
 */
export class VoiceRouter {
  // In-memory cache of the current agent→voice mapping
  private map: Record<string, VoiceConfig>

  constructor(private readonly context: vscode.ExtensionContext) {
    // Load persisted map from globalState, fall back to defaults
    const stored = context.globalState.get<Record<string, VoiceConfig>>(GS_VOICE_AGENT_MAP)
    this.map = stored ?? { ...DEFAULT_MAP }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Returns the voice config mapped to `agentName`, or `undefined` if no
   * mapping exists for that agent.
   */
  getVoiceForAgent(agentName: string): VoiceConfig | undefined {
    return this.map[agentName]
  }

  /**
   * Assigns `config` to `agentName` and persists the updated map to
   * globalState so it survives VS Code restarts.
   */
  async setVoiceForAgent(agentName: string, config: VoiceConfig): Promise<void> {
    this.map[agentName] = config
    await this.persist()
  }

  /**
   * Deterministically picks a voice from `availableVoices` for an agent that
   * has no explicit mapping.  Uses a simple character-code sum hash so the
   * same agent name always gets the same voice across sessions.
   *
   * Also saves the assignment so future calls return the same config without
   * recomputing.
   */
  autoAssign(agentName: string, availableVoices: string[]): VoiceConfig {
    if (availableVoices.length === 0) {
      // No voices available — return a safe browser default without persisting
      return { voiceId: "default", provider: "browser", rate: 1.0 }
    }

    // Hash: sum of char codes mod voice count → deterministic index
    let hash = 0
    for (let i = 0; i < agentName.length; i++) {
      hash += agentName.charCodeAt(i)
    }
    const index = hash % availableVoices.length
    const voiceId = availableVoices[index]

    const config: VoiceConfig = { voiceId, provider: "browser", rate: 1.0 }

    // Cache the assignment synchronously in memory; persist is fire-and-forget
    this.map[agentName] = config
    void this.persist()

    return config
  }

  /** Returns a shallow copy of the full agent→voice mapping. */
  getAll(): Record<string, VoiceConfig> {
    return { ...this.map }
  }

  /**
   * Resets the mapping to the built-in defaults and persists the reset to
   * globalState, overwriting any customisations.
   */
  async resetToDefaults(): Promise<void> {
    this.map = { ...DEFAULT_MAP }
    await this.persist()
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    await this.context.globalState.update(GS_VOICE_AGENT_MAP, this.map)
  }
}
