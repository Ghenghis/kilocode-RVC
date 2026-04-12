import * as vscode from "vscode"
import * as crypto from "crypto"
import * as https from "https"
import { DebugCollector } from "./services/debug/DebugCollector"
import { OperationsTracker } from "./services/operations/OperationsTracker"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { exec } from "child_process"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoiceHistoryEntry {
  id: string
  timestamp: number
}

interface SavedSearch {
  id: string
  label: string
  query: string
  filters: Record<string, unknown>
  createdAt: number
}

interface DownloadTracker {
  controller: AbortController
  received: number
  total: number
}

interface StoreModel {
  id: string
  name: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Constants – globalState keys
// ---------------------------------------------------------------------------

const GS_FAVORITES = "kilocode.voiceFavorites"
const GS_HISTORY = "kilocode.voiceHistory"
const GS_RECENT_SEARCHES = "kilocode.voiceRecentSearches"
const GS_SAVED_SEARCHES = "kilocode.voiceSavedSearches"
const GS_INTERACTION_MODE = "kilocode.voiceInteractionMode"

// kilocode_change – Phase 3.4 / 7.2 voice memory globalState keys
const GS_VOICE_MEMORY_PROJECT_MAP = "kilocode.voiceMemory.projectMap"
const GS_VOICE_MEMORY_TIME_PREFS = "kilocode.voiceMemory.timePrefs"
const GS_VOICE_MEMORY_QUALITY_LOG = "kilocode.voiceMemory.qualityLog"
// kilocode_change – Phase 2.1 / 4.1 agent voice routing globalState key
const GS_VOICE_AGENT_MAP = "kilocode.voiceAgentMap"

// ---------------------------------------------------------------------------
// VoiceMemoryService – Phase 3.4
// ---------------------------------------------------------------------------
// Inline service (no separate file) for persisting per-project voice prefs,
// time-of-day preferences, quality logging, and auto-learn associations.
// ---------------------------------------------------------------------------

interface VoiceMemoryQualityEntry {
  provider: string
  latencyMs: number
  success: boolean
  timestamp: number
}

// kilocode_change – Phase 3.4: VoiceMemoryService
class VoiceMemoryService {
  constructor(private readonly gs: vscode.Memento) {}

  /** Returns the remembered voiceId for a project path, if any. */
  getProjectVoice(projectPath: string): string | undefined {
    const map = this.gs.get<Record<string, string>>(GS_VOICE_MEMORY_PROJECT_MAP, {})
    return map[projectPath]
  }

  /** Persists voiceId as the preferred voice for a project path. */
  async setProjectVoice(projectPath: string, voiceId: string): Promise<void> {
    const map = this.gs.get<Record<string, string>>(GS_VOICE_MEMORY_PROJECT_MAP, {})
    map[projectPath] = voiceId
    await this.gs.update(GS_VOICE_MEMORY_PROJECT_MAP, map)
  }

  /**
   * Returns a preferred voiceId for the given hour (0-23), if configured.
   * Time-of-day prefs are stored as: { morning: voiceId, afternoon: voiceId, evening: voiceId }
   * morning   = 05:00–11:59
   * afternoon = 12:00–17:59
   * evening   = 18:00–04:59
   */
  getTimePreference(hour: number): string | undefined {
    const prefs = this.gs.get<Record<string, string>>(GS_VOICE_MEMORY_TIME_PREFS, {})
    if (hour >= 5 && hour < 12) return prefs["morning"]
    if (hour >= 12 && hour < 18) return prefs["afternoon"]
    return prefs["evening"]
  }

  /** Appends a quality entry; keeps only the last 50. */
  async logQuality(entry: { provider: string; latencyMs: number; success: boolean }): Promise<void> {
    const log = this.gs.get<VoiceMemoryQualityEntry[]>(GS_VOICE_MEMORY_QUALITY_LOG, [])
    log.push({ ...entry, timestamp: Date.now() })
    const trimmed = log.slice(-50)
    await this.gs.update(GS_VOICE_MEMORY_QUALITY_LOG, trimmed)
  }

  /**
   * Auto-learn: records a voice use for a project.  After 3+ uses of the same
   * voice in the same project, auto-associate via setProjectVoice.
   * Uses a separate transient counter stored in globalState.
   */
  async recordUse(projectPath: string, voiceId: string): Promise<void> {
    const counterKey = "kilocode.voiceMemory.usageCounters"
    const counters = this.gs.get<Record<string, Record<string, number>>>(counterKey, {})
    if (!counters[projectPath]) counters[projectPath] = {}
    counters[projectPath][voiceId] = (counters[projectPath][voiceId] ?? 0) + 1
    await this.gs.update(counterKey, counters)

    if (counters[projectPath][voiceId] >= 3) {
      const current = this.getProjectVoice(projectPath)
      if (current !== voiceId) {
        await this.setProjectVoice(projectPath, voiceId)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// VoiceStudioProvider
// ---------------------------------------------------------------------------

export class VoiceStudioProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.VoiceStudioPanel"

  private static instance: VoiceStudioProvider | undefined

  private panel: vscode.WebviewPanel | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly downloads = new Map<string, DownloadTracker>()
  private readonly log: vscode.LogOutputChannel

  // kilocode_change – Phase 2.1: VoiceRouter HTTP server on port 7892
  private voiceRouterServer: http.Server | undefined

  // kilocode_change – Phase 3.4: Voice memory service instance
  private voiceMemory!: VoiceMemoryService

  /** E2E debug hooks — set by extension.ts when kilo-code.debugMode is active. */
  private debugHook: { in?: (msg: Record<string, unknown>) => void; out?: (msg: unknown) => void } | null = null

  /** Attach or remove the debug interceptor. Called by extension.ts on debug mode toggle. */
  public setDebugHook(hook: { in?: (msg: Record<string, unknown>) => void; out?: (msg: unknown) => void } | null): void {
    this.debugHook = hook
  }

  /** Returns the singleton instance (if one exists) so extension.ts can attach debug hooks. */
  public static getInstance(): VoiceStudioProvider | undefined {
    return VoiceStudioProvider.instance
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.log = vscode.window.createOutputChannel("KiloCode Voice Studio", { log: true })
    // Initialize OperationsTracker with context for timing history persistence
    OperationsTracker.getInstance().init(context)
    // kilocode_change – Phase 3.4: initialize voice memory service
    this.voiceMemory = new VoiceMemoryService(context.globalState)
    // kilocode_change – Phase 2.1: start the VoiceRouter HTTP server
    this.startVoiceRouterServer()
  }

  // -- Singleton access -----------------------------------------------------

  public static openPanel(context: vscode.ExtensionContext, extensionUri: vscode.Uri): void {
    if (VoiceStudioProvider.instance?.panel) {
      VoiceStudioProvider.instance.panel.reveal(vscode.ViewColumn.One)
      return
    }

    if (!VoiceStudioProvider.instance) {
      VoiceStudioProvider.instance = new VoiceStudioProvider(extensionUri, context)
    }

    const inst = VoiceStudioProvider.instance

    const panel = vscode.window.createWebviewPanel(
      VoiceStudioProvider.viewType,
      "Voice Studio",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    )

    inst.wirePanel(panel)
    // Auto-attach debug hook when panel opens (failsafe — no need to restart VS Code)
    if (DebugCollector.getInstance().isEnabled()) {
      inst.setDebugHook(DebugCollector.getInstance().makeProviderHook("VoiceStudioProvider"))
    }
  }

  /** Called by the panel serializer to restore a panel after VS Code restarts. */
  public static restorePanel(context: vscode.ExtensionContext, extensionUri: vscode.Uri, panel: vscode.WebviewPanel): void {
    if (!VoiceStudioProvider.instance) {
      VoiceStudioProvider.instance = new VoiceStudioProvider(extensionUri, context)
    }
    VoiceStudioProvider.instance.wirePanel(panel)
    // Auto-attach debug hook on panel restore
    if (DebugCollector.getInstance().isEnabled()) {
      VoiceStudioProvider.instance.setDebugHook(DebugCollector.getInstance().makeProviderHook("VoiceStudioProvider"))
    }
  }

  /** Attach this provider instance to an existing webview panel (e.g. for tests or re-hydration). */
  public deserializePanel(panel: vscode.WebviewPanel): void {
    this.wirePanel(panel)
  }

  // -- Panel wiring ---------------------------------------------------------

  private wirePanel(panel: vscode.WebviewPanel): void {
    this.panel = panel

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    panel.webview.html = this.getHtmlForWebview(panel.webview)

    const msgDisposable = panel.webview.onDidReceiveMessage(
      (msg) => void this.onMessage(msg),
      undefined,
      this.disposables,
    )

    // Watch for debugMode config change and push to webview in real time
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.new.speech.debugMode")) {
        const enabled = vscode.workspace.getConfiguration("kilo-code.new.speech").get<boolean>("debugMode", false)
        this.post({ type: "debugModeChanged", enabled })
      }
    })

    panel.onDidDispose(
      () => {
        this.log.info("[Panel] Disposed")
        configWatcher.dispose()
        // Abort all in-flight downloads
        this.downloads.forEach((tracker, id) => {
          tracker.controller.abort()
          this.log.info(`[Download] Aborted in-flight download ${id} on panel dispose`)
        })
        this.downloads.clear()
        this.panel = undefined
        // Dispose message listener
        msgDisposable.dispose()
      },
      undefined,
      this.disposables,
    )
  }

  // -- HTML generation ------------------------------------------------------

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "voice-studio.js"),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "voice-studio.css"),
    )
    const nonce = crypto.randomBytes(16).toString("hex")

    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource} https: http: ws: wss:`,
      `img-src ${webview.cspSource} data: https:`,
      `media-src ${webview.cspSource} blob: data: https: http:`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Voice Studio</title>
  <style>
    html {
      scrollbar-color: auto;
      ::-webkit-scrollbar-thumb {
        border: 3px solid transparent !important;
        background-clip: padding-box !important;
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    body {
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    #root {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">(function(){
  var _en=${vscode.workspace.getConfiguration().get<boolean>("kilo-code.debugMode", false)};
  var _buf=[];
  var _o={log:console.log,warn:console.warn,error:console.error,debug:console.debug,info:console.info};
  ['log','warn','error','debug','info'].forEach(function(l){console[l]=function(){_o[l].apply(console,arguments);if(!_en)return;var a=Array.prototype.slice.call(arguments).map(function(x){try{return typeof x==='string'?x:JSON.stringify(x);}catch(e){return String(x);}});_buf.push({level:l,args:a});};});
  window.__kiloEnableDebugConsole=function(){_en=true;_fl();};
  window.__kiloDisableDebugConsole=function(){_en=false;_buf=[];};
  function _fl(){var api=window.__kiloVsCode;if(api&&_buf.length){var e=_buf.splice(0);e.forEach(function(m){try{api.postMessage({type:'kiloDebugConsole',level:m.level,args:m.args});}catch(_){}});}if(_en){if(!api){setTimeout(_fl,200);}else if(_buf.length){setTimeout(_fl,50);}}}
  if(_en)setTimeout(_fl,200);
})();</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  // -- Message handling -----------------------------------------------------

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    // E2E debug capture — record every incoming webview message
    this.debugHook?.in?.(msg)
    const type = msg.type as string
    this.log.info(`[Message] Received: ${type}`)

    switch (type) {
      case "requestVoiceStudioState":
        await this.handleRequestState()
        break
      case "fetchVoiceLibrary":
        await this.handleFetchVoiceLibrary()
        break
      case "fetchStoreModels":
        await this.handleFetchStoreModels()
        break
      case "previewStoreVoice":
        await this.handlePreviewStoreVoice(msg as { type: string; modelId: string; text?: string })
        break
      case "downloadModel":
        await this.handleDownloadModel(msg as { type: string; modelId: string; url: string; name: string })
        break
      case "cancelDownload":
        this.handleCancelDownload(msg as { type: string; modelId: string })
        break
      case "deleteModel":
        await this.handleDeleteModel(msg as { type: string; modelId: string; name: string })
        break
      case "toggleFavorite":
        await this.handleToggleFavorite(msg as { type: string; voiceId: string; action: "add" | "remove" })
        break
      case "setActiveVoice":
        await this.handleSetActiveVoice(msg as { type: string; voiceId: string; provider: string })
        break
      case "saveSearch":
        await this.handleSaveSearch(msg as { type: string; search: SavedSearch })
        break
      case "deleteSavedSearch":
        await this.handleDeleteSavedSearch(msg as { type: string; searchId: string })
        break
      case "switchInteractionMode":
        await this.handleSwitchInteractionMode(msg as { type: string; mode: string })
        break
      case "voiceCommand":
        await this.handleVoiceCommand(msg as { type: string; transcript: string; commandId?: string })
        break
      case "refreshStoreCatalog":
        await this.handleRefreshStoreCatalog()
        break
      case "kiloDebugConsole": {
        // Console bridge message from the VoiceStudio webview — route to DebugCollector
        const { level, args } = msg as { level?: string; args?: unknown[] }
        const { DebugCollector } = await import("./services/debug/DebugCollector")
        DebugCollector.getInstance().recordConsole("VoiceStudioProvider-webview", level ?? "log", args ?? [])
        break
      }
      // kilocode_change – Phase 4.1: handle voiceSwitch from HTTP hook bridge
      case "voiceSwitch": {
        const { agent_id = "", agent_type = "" } = msg as { agent_id?: string; agent_type?: string }
        const agentMap = this.context.globalState.get<Record<string, string>>(GS_VOICE_AGENT_MAP, {})
        const voiceId = agentMap[agent_id] ?? this.autoAssignVoice(agent_id)
        this.log.info(`[VoiceSwitch] agent=${agent_id} type=${agent_type} → voice=${voiceId}`)
        this.post({
          type: "activeVoiceChanged",
          agent_id,
          agent_type,
          voiceId,
          source: "voiceSwitch",
        })
        break
      }
      default:
        this.log.warn(`[Message] Unknown message type: ${type}`)
    }
  }

  // -- Handler: requestVoiceStudioState -------------------------------------

  private async handleRequestState(): Promise<void> {
    const gs = this.context.globalState
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")

    const state = {
      favorites: gs.get<string[]>(GS_FAVORITES, []),
      history: gs.get<VoiceHistoryEntry[]>(GS_HISTORY, []),
      recentSearches: gs.get<string[]>(GS_RECENT_SEARCHES, []),
      savedSearches: gs.get<SavedSearch[]>(GS_SAVED_SEARCHES, []),
      interactionMode: gs.get<string>(GS_INTERACTION_MODE, "manual"),
      debugMode: speech.get<boolean>("debugMode", false),
      speechSettings: {
        enabled: speech.get<boolean>("enabled", false),
        autoSpeak: speech.get<boolean>("autoSpeak", false),
        provider: speech.get<string>("provider", "browser"),
        volume: speech.get<number>("volume", 80),
        rvc: {
          voiceId: speech.get<string>("rvc.voiceId", ""),
          dockerPort: speech.get<number>("rvc.dockerPort", 5050),
          edgeVoice: speech.get<string>("rvc.edgeVoice", "en-US-AriaNeural"),
          pitchShift: speech.get<number>("rvc.pitchShift", 0),
          modelServerUrl: speech.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech"),
        },
        azure: {
          region: speech.get<string>("azure.region", "westus"),
          apiKey: speech.get<string>("azure.apiKey", ""),
          voiceId: speech.get<string>("azure.voiceId", "en-US-JennyNeural"),
        },
        browser: {
          voiceURI: speech.get<string>("browser.voiceURI", ""),
          rate: speech.get<number>("browser.rate", 1.0),
          pitch: speech.get<number>("browser.pitch", 1.0),
        },
      },
    }

    this.log.info("[Library] Sending voiceStudioState")
    this.post({ type: "voiceStudioState", ...state })

    // kilocode_change – Phase 7.2: session start voice suggestion toast
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (workspacePath) {
      const rememberedVoice = this.voiceMemory.getProjectVoice(workspacePath)
      if (rememberedVoice) {
        this.log.info(`[VoiceMemory] Suggesting remembered voice "${rememberedVoice}" for project ${workspacePath}`)
        this.post({
          type: "voiceSuggestion",
          voiceId: rememberedVoice,
          message: "Using remembered voice for this project",
        })
      }
    }
  }

  // -- Helper: resolve the running RVC Docker container name -----------------
  // The auto-setup creates `kilocode-rvc-{port}`, but legacy installs may
  // use `edge-tts-server`.  This method checks both, caches the result, and
  // never fails — worst case it returns the new-style name so the caller can
  // surface a clear error about the container not being found.

  private resolvedContainerName: string | undefined
  private containerNameResolvedAt = 0

  private async resolveContainerName(): Promise<string> {
    // Cache for 30s — auto-setup may create a new container any time
    if (this.resolvedContainerName && Date.now() - this.containerNameResolvedAt < 30_000) {
      return this.resolvedContainerName
    }

    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const port = speech.get<number>("rvc.dockerPort", 5050)

    const cacheAndReturn = (name: string): string => {
      this.resolvedContainerName = name
      this.containerNameResolvedAt = Date.now()
      return name
    }

    // Priority 1: new-style name (from auto-setup)
    const newName = `kilocode-rvc-${port}`
    try {
      const out = await this.execAsync(`docker inspect --format="{{.State.Status}}" ${newName}`)
      if (out.trim()) return cacheAndReturn(newName)
    } catch { /* not found, try next */ }

    // Priority 2: any kilocode-rvc container
    try {
      const out = await this.execAsync('docker ps --filter "name=kilocode-rvc" --format "{{.Names}}" --no-trunc')
      const first = out.split("\n").map(s => s.trim()).filter(Boolean)[0]
      if (first) return cacheAndReturn(first)
    } catch { /* continue */ }

    // Priority 3: legacy name
    try {
      const out = await this.execAsync('docker inspect --format="{{.State.Status}}" edge-tts-server')
      if (out.trim()) return cacheAndReturn("edge-tts-server")
    } catch { /* not found */ }

    // Fallback: use the new-style name (will give a clear error downstream)
    return cacheAndReturn(newName)
  }

  /** Clear the cached container name (e.g. after auto-setup creates a new one). */
  public clearContainerNameCache(): void {
    this.resolvedContainerName = undefined
    this.containerNameResolvedAt = 0
  }

  // -- Handler: fetchVoiceLibrary -------------------------------------------

  private async handleFetchVoiceLibrary(): Promise<void> {
    this.log.info("[Library] Fetching voice library from Docker container")
    const ops = OperationsTracker.getInstance()
    const opId = ops.startTask("library-fetch", "Fetching voice library", {
      steps: ["Connect to Docker", "Load voice catalog", "Merge metadata"],
    })

    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const port = speech.get<number>("rvc.dockerPort", 5050)
    const favorites = this.context.globalState.get<string[]>(GS_FAVORITES, [])
    const history = this.context.globalState.get<VoiceHistoryEntry[]>(GS_HISTORY, [])

    let voices: unknown[] = []
    try {
      // Query the RVC Docker container catalog — returns installed RVC models with full metadata
      const raw = await this.httpGet(`http://127.0.0.1:${port}/catalog`)
      const parsed = JSON.parse(raw) as { voices?: unknown[]; total?: number }
      voices = parsed.voices ?? []
      this.log.info(`[Library] Received ${voices.length} voices from catalog`)
      ops.advanceStep(opId, `${voices.length} voices from /catalog`)
    } catch (err) {
      this.log.error(`[Library] Failed to fetch catalog from Docker: ${err}`)
      ops.updateProgress(opId, { detail: "Catalog failed, trying /voices..." })
      // Fallback 1: try /voices endpoint (simpler format)
      try {
        const raw = await this.httpGet(`http://127.0.0.1:${port}/voices`)
        const parsed = JSON.parse(raw) as Array<{ id: string; sizeMB?: number }>
        voices = parsed.map((v) => ({
          id: v.id,
          name: v.id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          filename: "model.pth",
          source: "local",
          provider: "rvc",
          sizeMB: v.sizeMB ?? 0,
        }))
        this.log.info(`[Library] Fallback /voices: found ${voices.length} models`)
        ops.advanceStep(opId, `${voices.length} voices from /voices`)
      } catch (fallbackErr) {
        this.log.error(`[Library] Fallback /voices failed: ${fallbackErr}`)
        ops.updateProgress(opId, { detail: "/voices failed, trying docker exec..." })
        // Fallback 2: list model directories via docker exec
        try {
          const cname = await this.resolveContainerName()
          // Models live in subdirectories: /models/{voice_id}/model.pth
          const output = await this.execAsync(`docker exec ${cname} sh -c "ls -d /models/*/ 2>/dev/null || echo ''"`)
          const dirs = output
            .split("\n")
            .map((d) => d.trim().replace(/\/$/, ""))
            .filter(Boolean)
            .map((d) => d.split("/").pop() ?? "")
            .filter(Boolean)
          voices = dirs.map((d) => ({
            id: d,
            name: d.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            filename: "model.pth",
            source: "local",
            provider: "rvc",
          }))
          this.log.info(`[Library] Fallback docker exec: found ${voices.length} model directories`)
          ops.advanceStep(opId, `${voices.length} dirs via docker exec`)
        } catch (execErr) {
          this.log.error(`[Library] Docker exec fallback failed: ${execErr}`)
          ops.failTask(opId, `All fetch methods failed: ${execErr}`, true)
          this.post({ type: "voiceLibraryLoaded", voices: [] })
          return
        }
      }
    }

    ops.advanceStep(opId)

    // Merge favorite/history flags
    const merged = (voices as Array<Record<string, unknown>>).map((v) => ({
      ...v,
      isFavorite: favorites.includes(v.id as string),
      lastUsed: history.find((h) => h.id === (v.id as string))?.timestamp,
    }))

    this.post({ type: "voiceLibraryLoaded", voices: merged })
    ops.completeTask(opId)
  }

  // -- Handler: fetchStoreModels --------------------------------------------

  private async handleFetchStoreModels(): Promise<void> {
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const modelServerUrl = speech.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    this.log.info(`[Store] Fetching catalog from ${modelServerUrl}/api/catalog`)

    try {
      const raw = await this.httpGet(`${modelServerUrl}/api/catalog`)
      // Server returns { voices: StoreModel[], total: number }
      const catalog = JSON.parse(raw) as { voices?: StoreModel[]; total?: number }
      const models = catalog.voices ?? []
      this.log.info(`[Store] Received ${models.length} models from store`)

      // Fetch disk usage separately
      let diskUsage: unknown = null
      try {
        const diskRaw = await this.httpGet(`${modelServerUrl}/api/disk`)
        diskUsage = JSON.parse(diskRaw)
      } catch {
        // disk endpoint is optional — ignore failures
      }

      this.post({
        type: "storeModelsLoaded",
        models,
        diskUsage,
      })
    } catch (err) {
      this.log.error(`[Store] Failed to fetch store catalog: ${err}`)
      this.post({ type: "storeModelsLoaded", models: [], diskUsage: null, error: String(err) })
    }
  }

  // -- Handler: previewStoreVoice -------------------------------------------

  private async handlePreviewStoreVoice(msg: {
    type: string
    modelId: string
    text?: string
  }): Promise<void> {
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const modelServerUrl = speech.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")
    const port = speech.get<number>("rvc.dockerPort", 5050)
    const text = msg.text ?? "Hello, this is a voice preview."

    this.log.info(`[Store] Previewing voice ${msg.modelId}`)

    // Strategy 1: Try VPS preview endpoint
    try {
      const raw = await this.httpPost(
        `${modelServerUrl}/api/preview`,
        JSON.stringify({ modelId: msg.modelId, text }),
      )
      const result = JSON.parse(raw) as { audio?: string; format?: string }
      this.log.info(`[Store] Preview audio received from VPS for ${msg.modelId}`)
      this.post({
        type: "previewAudioReady",
        modelId: msg.modelId,
        audioBase64: result.audio ?? "",
        format: result.format ?? "wav",
      })
      return
    } catch (err) {
      this.log.warn(`[Store] VPS preview failed for ${msg.modelId}: ${err}`)
    }

    // Strategy 2: Try local Docker container /synthesize if the model is installed locally
    let localModelMissing = false
    try {
      const raw = await this.httpPostBinary(
        `http://127.0.0.1:${port}/synthesize`,
        JSON.stringify({
          text,
          voice_id: msg.modelId,
          edge_voice: speech.get<string>("rvc.edgeVoice", "en-US-AriaNeural"),
          pitch_shift: speech.get<number>("rvc.pitchShift", 0),
        }),
      )
      const audioBase64 = raw.toString("base64")
      this.log.info(`[Store] Preview audio received from local Docker for ${msg.modelId}`)
      this.post({
        type: "previewAudioReady",
        modelId: msg.modelId,
        audioBase64,
        format: "wav",
      })
      return
    } catch (localErr) {
      const localErrMsg = String(localErr)
      // kilocode_change – Phase 5.2: detect "not installed" vs other Docker errors
      if (
        localErrMsg.includes("404") ||
        localErrMsg.includes("not found") ||
        localErrMsg.includes("ECONNREFUSED")
      ) {
        localModelMissing = true
      }
      this.log.warn(`[Store] Local Docker preview failed for ${msg.modelId}: ${localErr}`)
    }

    // kilocode_change – Phase 5.2: if model is not installed locally, prompt to install instead of VPS error
    if (localModelMissing) {
      this.log.info(`[Store] Model ${msg.modelId} not installed — showing install prompt`)
      this.post({
        type: "showInstallPrompt",
        modelId: msg.modelId,
        message: `"${msg.modelId}" is not installed. Install it to preview locally.`,
      })
      return
    }

    // Both failed for non-install reasons
    this.post({
      type: "previewAudioReady",
      modelId: msg.modelId,
      audioBase64: "",
      error: "Preview unavailable — VPS server is offline and model is not installed locally.",
    })
  }

  // -- Handler: downloadModel -----------------------------------------------

  private async handleDownloadModel(msg: {
    type: string
    modelId: string
    url: string
    name: string
  }): Promise<void> {
    const { modelId, url } = msg

    // Sanitize name: only allow alphanumeric, hyphens, underscores, dots
    const name = (msg.name ?? "").replace(/[^a-zA-Z0-9_\-.]/g, "_").slice(0, 128)
    if (!name) {
      this.log.error(`[Download] Invalid model name: "${msg.name}"`)
      this.post({ type: "downloadComplete", modelId, success: false, error: "Invalid model name" })
      return
    }

    this.log.info(`[Download] Starting download: ${name} (${modelId}) from ${url}`)

    const ops = OperationsTracker.getInstance()
    const opId = ops.startTask("model-download", `Downloading ${name}`, {
      steps: ["Download model file", "Create model directory", "Install to Docker", "Verify installation"],
    })
    // Forward operation messages to webview
    const unsubOps = ops.onMessage((msg) => this.post(msg as unknown as Record<string, unknown>))

    const controller = new AbortController()
    this.downloads.set(modelId, { controller, received: 0, total: 0 })

    const tmpFile = path.join(os.tmpdir(), `voice-studio-${name}.pth`)

    try {
      await this.downloadWithProgress(url, tmpFile, controller.signal, (received, total) => {
        const tracker = this.downloads.get(modelId)
        if (tracker) {
          tracker.received = received
          tracker.total = total
        }

        const pct = total > 0 ? Math.round((received / total) * 100) : 0
        // Log milestones
        if (pct === 25 || pct === 50 || pct === 75) {
          this.log.info(`[Download] ${name}: ${pct}%`)
        }

        // Update both the legacy download progress AND the operations tracker
        ops.updateProgress(opId, { percent: pct, receivedBytes: received, totalBytes: total })

        this.post({
          type: "downloadProgress",
          modelId,
          received,
          total,
          percent: pct,
        })
      })

      this.log.info(`[Download] ${name}: file downloaded, copying to Docker container`)
      ops.advanceStep(opId, "Download complete")

      // Install into Docker container — models live in subdirectories: /models/{name}/model.pth
      const cname = await this.resolveContainerName()
      ops.advanceStep(opId, `Creating /models/${name}/`)
      await this.execAsync(`docker exec ${cname} sh -c "mkdir -p /models/${name}"`)
      ops.advanceStep(opId, "Copying model to container...")
      await this.execAsync(`docker cp "${tmpFile}" ${cname}:/models/${name}/model.pth`)
      this.log.info(`[Download] ${name}: installed to Docker container at /models/${name}/model.pth`)

      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // ignore
      }

      this.downloads.delete(modelId)
      ops.completeTask(opId)
      unsubOps()

      this.post({ type: "downloadComplete", modelId, success: true })
      this.log.info(`[Download] ${name}: complete`)
    } catch (err) {
      this.downloads.delete(modelId)

      // Clean up temp file on failure too
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // ignore
      }

      if (controller.signal.aborted) {
        this.log.info(`[Download] ${name}: cancelled by user`)
        ops.cancelTask(opId)
        this.post({ type: "downloadComplete", modelId, success: false, error: "cancelled" })
      } else {
        this.log.error(`[Download] ${name}: failed: ${err}`)
        ops.failTask(opId, String(err), true)
        this.post({ type: "downloadComplete", modelId, success: false, error: String(err) })
      }
      unsubOps()
    }
  }

  // -- Handler: cancelDownload ----------------------------------------------

  private handleCancelDownload(msg: { type: string; modelId: string }): void {
    const tracker = this.downloads.get(msg.modelId)
    if (tracker) {
      this.log.info(`[Download] Cancelling download ${msg.modelId}`)
      tracker.controller.abort()
      this.downloads.delete(msg.modelId)
    } else {
      this.log.warn(`[Download] Cancel requested for unknown download ${msg.modelId}`)
    }
  }

  // -- Handler: deleteModel -------------------------------------------------

  private async handleDeleteModel(msg: { type: string; modelId: string; name: string }): Promise<void> {
    // Sanitize name to prevent shell injection
    const safeName = (msg.name ?? "").replace(/[^a-zA-Z0-9_\-.]/g, "_").slice(0, 128)
    this.log.info(`[Library] Deleting model ${safeName} (${msg.modelId})`)

    if (!safeName) {
      this.log.error(`[Library] Invalid model name for deletion: "${msg.name}"`)
      this.post({ type: "modelDeleted", modelId: msg.modelId, success: false, error: "Invalid model name" })
      return
    }

    const ops = OperationsTracker.getInstance()
    const opId = ops.startTask("model-delete", `Deleting ${safeName}`)
    const unsubOps = ops.onMessage((m) => this.post(m as unknown as Record<string, unknown>))

    try {
      const cname = await this.resolveContainerName()
      // Models live in subdirectories: /models/{name}/ — remove entire directory
      // Also handle legacy flat files: /models/{name}.pth
      await this.execAsync(`docker exec ${cname} sh -c "rm -rf /models/${safeName} /models/${safeName}.pth"`)
      this.log.info(`[Library] Model ${msg.name} deleted from Docker container`)
      ops.completeTask(opId)

      // Remove from favorites if present
      const favorites = this.context.globalState.get<string[]>(GS_FAVORITES, [])
      if (favorites.includes(msg.modelId)) {
        const updated = favorites.filter((f) => f !== msg.modelId)
        await this.context.globalState.update(GS_FAVORITES, updated)
        this.log.info(`[Library] Removed ${msg.modelId} from favorites after deletion`)
      }

      this.post({ type: "modelDeleted", modelId: msg.modelId, success: true })
    } catch (err) {
      this.log.error(`[Library] Failed to delete model ${msg.name}: ${err}`)
      ops.failTask(opId, String(err), true)
      this.post({ type: "modelDeleted", modelId: msg.modelId, success: false, error: String(err) })
    } finally {
      unsubOps()
    }
  }

  // -- Handler: toggleFavorite ----------------------------------------------

  private async handleToggleFavorite(msg: {
    type: string
    voiceId: string
    action: "add" | "remove"
  }): Promise<void> {
    const favorites = this.context.globalState.get<string[]>(GS_FAVORITES, [])
    let updated: string[]

    if (msg.action === "add" && !favorites.includes(msg.voiceId)) {
      updated = [...favorites, msg.voiceId]
    } else if (msg.action === "remove") {
      updated = favorites.filter((f) => f !== msg.voiceId)
    } else {
      updated = favorites
    }

    await this.context.globalState.update(GS_FAVORITES, updated)
    this.log.info(`[Library] Favorites updated (${msg.action} ${msg.voiceId}), total: ${updated.length}`)
    this.post({ type: "favoritesUpdated", favorites: updated })
  }

  // -- Handler: setActiveVoice ----------------------------------------------

  private async handleSetActiveVoice(msg: {
    type: string
    voiceId: string
    provider: string
  }): Promise<void> {
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    this.log.info(`[Library] Setting active voice: ${msg.voiceId} for provider ${msg.provider}`)

    try {
      switch (msg.provider) {
        case "rvc":
          await speech.update("rvc.voiceId", msg.voiceId, vscode.ConfigurationTarget.Global)
          break
        case "azure":
          await speech.update("azure.voiceId", msg.voiceId, vscode.ConfigurationTarget.Global)
          break
        case "browser":
          await speech.update("browser.voiceURI", msg.voiceId, vscode.ConfigurationTarget.Global)
          break
        default:
          this.log.warn(`[Library] Unknown provider: ${msg.provider}`)
      }

      // Record in history
      const history = this.context.globalState.get<VoiceHistoryEntry[]>(GS_HISTORY, [])
      const entry: VoiceHistoryEntry = { id: msg.voiceId, timestamp: Date.now() }
      // Remove existing entry for this voice if any, add to front
      const updatedHistory = [entry, ...history.filter((h) => h.id !== msg.voiceId)].slice(0, 50)
      await this.context.globalState.update(GS_HISTORY, updatedHistory)

      // kilocode_change – Phase 3.4: auto-learn voice association for current project
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (workspacePath) {
        await this.voiceMemory.recordUse(workspacePath, msg.voiceId)
      }

      this.log.info(`[Library] Active voice set and history updated`)
      this.post({ type: "activeVoiceSet", voiceId: msg.voiceId, provider: msg.provider })
    } catch (err) {
      this.log.error(`[Library] Failed to set active voice: ${err}`)
    }
  }

  // -- Handler: saveSearch --------------------------------------------------

  private async handleSaveSearch(msg: { type: string; search: SavedSearch }): Promise<void> {
    const searches = this.context.globalState.get<SavedSearch[]>(GS_SAVED_SEARCHES, [])
    const updated = [...searches, msg.search]
    await this.context.globalState.update(GS_SAVED_SEARCHES, updated)
    this.log.info(`[Search] Saved search "${msg.search.label}" (total: ${updated.length})`)
    this.post({ type: "savedSearchesUpdated", savedSearches: updated })
  }

  // -- Handler: deleteSavedSearch -------------------------------------------

  private async handleDeleteSavedSearch(msg: { type: string; searchId: string }): Promise<void> {
    const searches = this.context.globalState.get<SavedSearch[]>(GS_SAVED_SEARCHES, [])
    const updated = searches.filter((s) => s.id !== msg.searchId)
    await this.context.globalState.update(GS_SAVED_SEARCHES, updated)
    this.log.info(`[Search] Deleted saved search ${msg.searchId} (remaining: ${updated.length})`)
    this.post({ type: "savedSearchesUpdated", savedSearches: updated })
  }

  // -- Handler: switchInteractionMode ---------------------------------------

  private async handleSwitchInteractionMode(msg: { type: string; mode: string }): Promise<void> {
    await this.context.globalState.update(GS_INTERACTION_MODE, msg.mode)
    this.log.info(`[Command] Interaction mode changed to "${msg.mode}"`)
    this.post({ type: "interactionModeChanged", mode: msg.mode })
  }

  // -- Handler: voiceCommand ------------------------------------------------

  private async handleVoiceCommand(msg: {
    type: string
    transcript: string
    commandId?: string
  }): Promise<void> {
    const transcript = msg.transcript.toLowerCase().trim()
    const commandId = msg.commandId ?? crypto.randomUUID()
    this.log.info(`[Command] Voice command received: "${transcript}" (id: ${commandId})`)

    let action = "unknown"
    let handled = true

    if (transcript.startsWith("switch to ")) {
      const voiceName = transcript.slice("switch to ".length).trim()
      action = "switchVoice"
      this.log.info(`[Command] Switching to voice: ${voiceName}`)
      // Find matching voice by name and set it active
      const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const provider = speech.get<string>("provider", "browser")
      // Set the voice id directly — the webview will resolve the name to an id
      this.post({
        type: "voiceCommandAck",
        commandId,
        action,
        voiceName,
        provider,
        success: true,
      })
      return
    }

    if (transcript === "stop") {
      action = "stop"
      this.log.info("[Command] Executing: stop")
    } else if (transcript === "slower") {
      action = "slower"
      this.log.info("[Command] Executing: slower")
      const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const currentRate = speech.get<number>("browser.rate", 1.0)
      const newRate = Math.max(0.1, currentRate - 0.1)
      await speech.update("browser.rate", newRate, vscode.ConfigurationTarget.Global)
    } else if (transcript === "faster") {
      action = "faster"
      this.log.info("[Command] Executing: faster")
      const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const currentRate = speech.get<number>("browser.rate", 1.0)
      const newRate = Math.min(3.0, currentRate + 0.1)
      await speech.update("browser.rate", newRate, vscode.ConfigurationTarget.Global)
    } else if (transcript === "louder") {
      action = "louder"
      this.log.info("[Command] Executing: louder")
      const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const currentVol = speech.get<number>("volume", 80)
      const newVol = Math.min(100, currentVol + 10)
      await speech.update("volume", newVol, vscode.ConfigurationTarget.Global)
    } else if (transcript === "softer") {
      action = "softer"
      this.log.info("[Command] Executing: softer")
      const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const currentVol = speech.get<number>("volume", 80)
      const newVol = Math.max(0, currentVol - 10)
      await speech.update("volume", newVol, vscode.ConfigurationTarget.Global)
    } else if (transcript === "hands free off") {
      action = "handsFreeOff"
      this.log.info("[Command] Executing: hands free off")
      await this.context.globalState.update(GS_INTERACTION_MODE, "manual")
      this.post({ type: "interactionModeChanged", mode: "manual" })
    } else {
      handled = false
      this.log.warn(`[Command] Unrecognized voice command: "${transcript}"`)
    }

    this.post({
      type: "voiceCommandAck",
      commandId,
      action,
      success: handled,
      transcript,
    })
  }

  // -- Handler: refreshStoreCatalog ------------------------------------------

  private async handleRefreshStoreCatalog(): Promise<void> {
    const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const modelServerUrl = speech.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    this.log.info("[Store] Refreshing catalog — rebuilding on server")

    try {
      // Trigger rebuild on VPS
      const rebuildRaw = await this.httpPost(`${modelServerUrl}/api/catalog/rebuild`, "{}")
      const rebuildResult = JSON.parse(rebuildRaw) as { success: boolean; voiceCount?: number }
      this.log.info(
        `[Store] Catalog rebuilt: ${rebuildResult.voiceCount ?? "?"} voices`,
      )
    } catch (err) {
      this.log.warn(`[Store] Catalog rebuild request failed (may not be supported): ${err}`)
      // Fall through — still fetch whatever catalog exists
    }

    // Now fetch the (potentially refreshed) catalog
    await this.handleFetchStoreModels()
  }

  // -- Utility: post to webview ---------------------------------------------

  private post(message: Record<string, unknown>): void {
    // E2E debug capture — record every outgoing extension message
    this.debugHook?.out?.(message)
    if (this.panel?.webview) {
      void this.panel.webview.postMessage(message)
    }
  }

  // kilocode_change — Phase 6.5: public entry point so VoiceChatParticipant
  // (and other extension-side services) can push messages to the webview panel
  // without needing access to the private `post` method.
  public postToWebview(message: Record<string, unknown>): void {
    this.post(message)
  }

  // -- Utility: httpGet -----------------------------------------------------

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http
      const req = mod.get(url, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpGet(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for GET ${url}`))
          return
        }
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        res.on("error", reject)
      })
      req.on("error", reject)
      req.setTimeout(30_000, () => {
        req.destroy(new Error(`Timeout for GET ${url}`))
      })
    })
  }

  // -- Utility: httpPost ----------------------------------------------------

  private httpPost(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const mod = parsed.protocol === "https:" ? https : http
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      }

      const req = mod.request(options, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpPost(res.headers.location, body).then(resolve, reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for POST ${url}`))
          return
        }
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        res.on("error", reject)
      })

      req.on("error", reject)
      req.setTimeout(60_000, () => {
        req.destroy(new Error(`Timeout for POST ${url}`))
      })
      req.write(body)
      req.end()
    })
  }

  // -- Utility: httpPostBinary (returns raw Buffer for binary responses) -----

  private httpPostBinary(url: string, body: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const mod = parsed.protocol === "https:" ? https : http
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      }

      const req = mod.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpPostBinary(res.headers.location, body).then(resolve, reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for POST ${url}`))
          return
        }
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve(Buffer.concat(chunks)))
        res.on("error", reject)
      })

      req.on("error", reject)
      req.setTimeout(60_000, () => {
        req.destroy(new Error(`Timeout for POST ${url}`))
      })
      req.write(body)
      req.end()
    })
  }

  // -- Utility: downloadWithProgress ----------------------------------------

  private downloadWithProgress(
    url: string,
    dest: string,
    signal: AbortSignal,
    onProgress: (received: number, total: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Download aborted before start"))
        return
      }

      const mod = url.startsWith("https") ? https : http

      const req = mod.get(url, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.downloadWithProgress(res.headers.location, dest, signal, onProgress).then(resolve, reject)
          return
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`))
          return
        }

        const total = parseInt(res.headers["content-length"] ?? "0", 10)
        let received = 0
        const fileStream = fs.createWriteStream(dest)

        const onAbort = () => {
          res.destroy()
          fileStream.close()
          try {
            fs.unlinkSync(dest)
          } catch {
            // ignore
          }
          reject(new Error("Download aborted"))
        }

        signal.addEventListener("abort", onAbort, { once: true })

        res.on("data", (chunk: Buffer) => {
          received += chunk.length
          onProgress(received, total)
        })

        res.pipe(fileStream)

        fileStream.on("finish", () => {
          signal.removeEventListener("abort", onAbort)
          fileStream.close(() => resolve())
        })

        fileStream.on("error", (err) => {
          signal.removeEventListener("abort", onAbort)
          try {
            fs.unlinkSync(dest)
          } catch {
            // ignore
          }
          reject(err)
        })

        res.on("error", (err) => {
          signal.removeEventListener("abort", onAbort)
          fileStream.close()
          try {
            fs.unlinkSync(dest)
          } catch {
            // ignore
          }
          reject(err)
        })
      })

      req.on("error", reject)

      const onAbortReq = () => {
        req.destroy(new Error("Download aborted"))
      }
      signal.addEventListener("abort", onAbortReq, { once: true })
      req.on("close", () => signal.removeEventListener("abort", onAbortReq))
    })
  }

  // -- Utility: execAsync ---------------------------------------------------

  private execAsync(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`exec failed: ${error.message}\nstderr: ${stderr}`))
        } else {
          resolve(stdout.trim())
        }
      })
    })
  }

  // -- Phase 2.1: VoiceRouter HTTP server -----------------------------------

  // kilocode_change – Phase 2.1: deterministic voice auto-assignment by hashing agent_id
  private autoAssignVoice(agentId: string): string {
    const hash = crypto.createHash("sha256").update(agentId).digest()
    const idx = hash[0] % 8
    // Eight default voice slots — extension can override via voiceAgentMap
    const defaults = [
      "aria-neural", "jenny-neural", "guy-neural", "davis-neural",
      "jane-neural", "jason-neural", "sara-neural", "tony-neural",
    ]
    return defaults[idx]
  }

  // kilocode_change – Phase 2.1: start an HTTP listener on port 7892 for VoiceRouter hook bridge POSTs
  private startVoiceRouterServer(): void {
    try {
      this.voiceRouterServer = http.createServer((req, res) => {
        // kilocode_change – CORS headers on every response so VS Code webview
        // (origin: vscode-webview://...) can call this server without CORS errors.
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type")

        // Preflight
        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }

        // ── /voice-switch ────────────────────────────────────────────────────
        if (req.method === "POST" && req.url === "/voice-switch") {
          const chunks: Buffer[] = []
          req.on("data", (chunk: Buffer) => chunks.push(chunk))
          req.on("end", () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
                agent_id?: string
                agent_type?: string
                sessionId?: string
              }
              const { agent_id = "", agent_type = "", sessionId = "" } = body

              // Look up agent voice from globalState map
              const agentMap = this.context.globalState.get<Record<string, string>>(GS_VOICE_AGENT_MAP, {})
              const voiceId = agentMap[agent_id] ?? this.autoAssignVoice(agent_id)

              this.log.info(`[VoiceRouter] voice-switch: agent=${agent_id} type=${agent_type} voice=${voiceId}`)

              // Push activeVoiceChanged to the webview
              this.post({
                type: "activeVoiceChanged",
                agent_id,
                agent_type,
                sessionId,
                voiceId,
                source: "voiceRouter",
              })

              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: true, voiceId }))
            } catch (parseErr) {
              this.log.warn(`[VoiceRouter] Failed to parse /voice-switch body: ${parseErr}`)
              res.writeHead(400, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }))
            }
          })
          req.on("error", (err) => {
            this.log.warn(`[VoiceRouter] Request error: ${err}`)
            // kilocode_change – guard against writing headers twice if already sent
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: false, error: String(err) }))
            }
          })

        // ── /rvc/health (GET) — proxy RVC Docker health check via extension host
        // kilocode_change: webviews are blocked by CORS from calling http://localhost:PORT
        // directly; this proxy runs in Node.js (no CORS) and relays to the RVC container.
        } else if (req.method === "GET" && req.url === "/rvc/health") {
          const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
          const rvcPort = speech.get<number>("rvc.dockerPort", 5050)
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 3000)
          fetch(`http://127.0.0.1:${rvcPort}/health`, { signal: ctrl.signal })
            .then((r) => {
              clearTimeout(timer)
              res.writeHead(r.ok ? 200 : 502, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: r.ok, status: r.status }))
            })
            .catch((err: unknown) => {
              clearTimeout(timer)
              if (!res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" })
                res.end(JSON.stringify({ ok: false, error: String(err) }))
              }
            })

        // ── /rvc/synthesize (POST) — proxy RVC synthesis via extension host
        } else if (req.method === "POST" && req.url === "/rvc/synthesize") {
          const speech = vscode.workspace.getConfiguration("kilo-code.new.speech")
          const rvcPort = speech.get<number>("rvc.dockerPort", 5050)
          const reqChunks: Buffer[] = []
          req.on("data", (chunk: Buffer) => reqChunks.push(chunk))
          req.on("end", () => {
            const bodyStr = Buffer.concat(reqChunks).toString("utf-8")
            this.httpPostBinary(`http://127.0.0.1:${rvcPort}/synthesize`, bodyStr)
              .then((audioBuf) => {
                if (!res.headersSent) {
                  res.writeHead(200, { "Content-Type": "audio/wav" })
                  res.end(audioBuf)
                }
              })
              .catch((err: unknown) => {
                this.log.warn(`[VoiceRouter] RVC synthesize proxy error: ${err}`)
                if (!res.headersSent) {
                  res.writeHead(502, { "Content-Type": "application/json" })
                  res.end(JSON.stringify({ ok: false, error: String(err) }))
                }
              })
          })
          req.on("error", (err) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ ok: false, error: String(err) }))
            }
          })

        } else {
          res.writeHead(404, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: "Not found" }))
        }
      })

      // kilocode_change – capture local ref so we can close it inside the callback
      // without relying on the possibly-nulled this.voiceRouterServer field
      const serverRef = this.voiceRouterServer
      serverRef.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          this.log.warn("[VoiceRouter] Port 7892 already in use — VoiceRouter HTTP server not started")
        } else {
          this.log.warn(`[VoiceRouter] Server error: ${err}`)
          // Close the server on unexpected errors so it doesn't linger
          serverRef.close()
        }
        if (this.voiceRouterServer === serverRef) {
          this.voiceRouterServer = undefined
        }
      })

      this.voiceRouterServer.listen(7892, "127.0.0.1", () => {
        this.log.info("[VoiceRouter] HTTP server listening on 127.0.0.1:7892")
      })
    } catch (err) {
      this.log.warn(`[VoiceRouter] Failed to start HTTP server: ${err}`)
      this.voiceRouterServer = undefined
    }
  }

  // -- Disposable -----------------------------------------------------------

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0

    // Abort all downloads
    this.downloads.forEach((tracker) => {
      tracker.controller.abort()
    })
    this.downloads.clear()

    // kilocode_change – Phase 2.1: stop VoiceRouter HTTP server
    if (this.voiceRouterServer) {
      this.voiceRouterServer.close(() => {
        this.log.info("[VoiceRouter] HTTP server stopped")
      })
      this.voiceRouterServer = undefined
    }

    this.panel?.dispose()
    this.panel = undefined
    this.log.dispose()

    if (VoiceStudioProvider.instance === this) {
      VoiceStudioProvider.instance = undefined
    }
  }
}
