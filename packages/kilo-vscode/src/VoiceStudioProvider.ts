import * as vscode from "vscode"
import * as crypto from "crypto"
import * as https from "https"
import { DebugCollector } from "./services/debug/DebugCollector"
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
          region: speech.get<string>("azure.region", "eastus"),
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
  }

  // -- Handler: fetchVoiceLibrary -------------------------------------------

  private async handleFetchVoiceLibrary(): Promise<void> {
    this.log.info("[Library] Fetching voice library from Docker container")
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
    } catch (err) {
      this.log.error(`[Library] Failed to fetch voices from Docker: ${err}`)
      // Fall back to listing models via docker exec
      try {
        const output = await this.execAsync('docker exec edge-tts-server ls /models/ 2>/dev/null || echo ""')
        const files = output
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.endsWith(".pth"))
        voices = files.map((f) => ({
          id: f.replace(".pth", ""),
          name: f.replace(".pth", ""),
          filename: f,
          source: "local",
        }))
        this.log.info(`[Library] Fallback: found ${voices.length} model files via docker exec`)
      } catch (execErr) {
        this.log.error(`[Library] Docker exec fallback failed: ${execErr}`)
      }
    }

    // Merge favorite/history flags
    const merged = (voices as Array<Record<string, unknown>>).map((v) => ({
      ...v,
      isFavorite: favorites.includes(v.id as string),
      lastUsed: history.find((h) => h.id === (v.id as string))?.timestamp,
    }))

    this.post({ type: "voiceLibraryLoaded", voices: merged })
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
    const text = msg.text ?? "Hello, this is a voice preview."

    this.log.info(`[Store] Previewing voice ${msg.modelId}`)

    try {
      const raw = await this.httpPost(
        `${modelServerUrl}/api/preview`,
        JSON.stringify({ modelId: msg.modelId, text }),
      )
      const result = JSON.parse(raw) as { audio?: string; format?: string }
      this.log.info(`[Store] Preview audio received for ${msg.modelId}`)
      this.post({
        type: "previewAudioReady",
        modelId: msg.modelId,
        audioBase64: result.audio ?? "",
        format: result.format ?? "wav",
      })
    } catch (err) {
      this.log.error(`[Store] Preview failed for ${msg.modelId}: ${err}`)
      this.post({ type: "previewAudioReady", modelId: msg.modelId, audioBase64: "", error: String(err) })
    }
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

        this.post({
          type: "downloadProgress",
          modelId,
          received,
          total,
          percent: pct,
        })
      })

      this.log.info(`[Download] ${name}: file downloaded, copying to Docker container`)

      // Install into Docker container
      await this.execAsync(`docker cp "${tmpFile}" edge-tts-server:/models/${name}.pth`)
      this.log.info(`[Download] ${name}: installed to Docker container`)

      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // ignore
      }

      this.downloads.delete(modelId)

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
        this.post({ type: "downloadComplete", modelId, success: false, error: "cancelled" })
      } else {
        this.log.error(`[Download] ${name}: failed: ${err}`)
        this.post({ type: "downloadComplete", modelId, success: false, error: String(err) })
      }
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

    try {
      await this.execAsync(`docker exec edge-tts-server rm -rf "/models/${safeName}.pth"`)
      this.log.info(`[Library] Model ${msg.name} deleted from Docker container`)

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
      this.post({ type: "modelDeleted", modelId: msg.modelId, success: false, error: String(err) })
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

    this.panel?.dispose()
    this.panel = undefined
    this.log.dispose()

    if (VoiceStudioProvider.instance === this) {
      VoiceStudioProvider.instance = undefined
    }
  }
}
