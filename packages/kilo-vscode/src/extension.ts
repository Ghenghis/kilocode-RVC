import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { DiffViewerProvider } from "./DiffViewerProvider"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { SubAgentViewerProvider } from "./SubAgentViewerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { ensureBackendForAutocomplete } from "./services/autocomplete/ensure-backend"
import { AutocompleteServiceManager } from "./services/autocomplete/AutocompleteServiceManager"
import { BrowserAutomationService } from "./services/browser-automation"
import { TelemetryProxy } from "./services/telemetry"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, KiloCodeActionProvider } from "./services/code-actions"
import { registerToggleAutoApprove } from "./commands/toggle-auto-approve"
import { VoiceStudioProvider } from "./VoiceStudioProvider"
import { DebugCollector } from "./services/debug/DebugCollector"

// Activated via "onStartupFinished" (package.json) so that commands, code actions, keybindings,
// autocomplete, commit-message generation, and URI deep links all work immediately — without
// requiring the user to open a Kilo sidebar or panel first. The CLI backend is NOT spawned here;
// it starts lazily when a webview connects or when ensureBackendForAutocomplete() triggers it.
export function activate(context: vscode.ExtensionContext) {
  console.log("Kilo Code extension is now active")

  const telemetry = TelemetryProxy.getInstance()

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // ── E2E Debugger ──────────────────────────────────────────────────────────
  // Enabled via the "kilo-code.debugMode" VS Code setting.
  // Captures all webview ↔ extension messages, CLI I/O, and SSE events.
  // Logs are written to ~/.kilo-debug/ as structured JSONL files.
  const debugCollector = DebugCollector.getInstance()

  function applyDebugMode(): void {
    const enabled = vscode.workspace.getConfiguration().get<boolean>("kilo-code.debugMode", false)
    if (enabled && !debugCollector.isEnabled()) {
      debugCollector.enable(context)
      connectionService.setCliDebugHook((src, data) => debugCollector.recordCli(src, data))
      connectionService.setSseDebugHook((eventType, data) => debugCollector.recordSSE(eventType, data))
    } else if (!enabled && debugCollector.isEnabled()) {
      debugCollector.disable()
      connectionService.setCliDebugHook(null)
      connectionService.setSseDebugHook(null)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Re-register browser automation MCP server on CLI backend reconnect, configure telemetry,
  // and reload autocomplete so it picks up the now-available backend connection.
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
      const config = connectionService.getServerConfig()
      if (config) {
        telemetry.configure(config.baseUrl, config.password)
      }
      AutocompleteServiceManager.getInstance()?.load()
      // Self-healing: re-attach CLI/SSE debug hooks on every backend reconnect so
      // a server restart never silently drops debug capture.
      if (debugCollector.isEnabled()) {
        connectionService.setCliDebugHook((src, data) => debugCollector.recordCli(src, data))
        connectionService.setSseDebugHook((eventType, data) => debugCollector.recordSSE(eventType, data))
      }
    }
  })

  // Track all open tab panel providers so toolbar button commands can target them.
  // NOTE: The editor/title toolbar for tab panels intentionally omits Agent Manager
  // and Marketplace buttons (unlike the sidebar). Too many icons causes VS Code to
  // collapse them into a "..." overflow menu, hiding important buttons like Settings.
  const tabPanels = new Map<vscode.WebviewPanel, KiloProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService, context)

  // Wire debug hook for the sidebar provider (and re-apply when debug mode toggles)
  function attachProviderDebugHook(p: KiloProvider, name: string): void {
    p.setDebugHook(debugCollector.isEnabled() ? debugCollector.makeProviderHook(name) : null)
  }
  attachProviderDebugHook(provider, "KiloProvider[sidebar]")

  // Unified debug mode change handler — one listener does everything: enables/disables
  // the collector, re-attaches CLI/SSE/provider hooks, syncs tab providers and Voice Studio,
  // and forces the webview to re-emit its state so mid-session debug enable captures full coverage.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.debugMode")) {
        applyDebugMode()
        attachProviderDebugHook(provider, "KiloProvider[sidebar]")
        for (const [, p] of tabPanels) {
          p.setDebugHook(debugCollector.isEnabled() ? debugCollector.makeProviderHook("KiloProvider[tab]") : null)
        }
        // Sync VoiceStudioProvider debug hook (if panel is currently open)
        VoiceStudioProvider.getInstance()?.setDebugHook(
          debugCollector.isEnabled() ? debugCollector.makeProviderHook("VoiceStudioProvider") : null,
        )
        // When enabling: force the webview to re-emit its state so the debug log gets
        // full coverage even if debug mode was toggled after the webview had already loaded.
        if (debugCollector.isEnabled()) {
          provider.requestDebugStateSync()
        }
      }
    }),
  )

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Ensure Agent Manager keybindings work when a VS Code terminal has focus.
  // The terminal intercepts all keystrokes unless the command is listed in
  // terminal.integrated.commandsToSkipShell, which only contains built-in
  // commands by default.
  ensureCommandsSkipShell(["kilo-code.new.agentManagerOpen", "kilo-code.new.agentManager.showTerminal"])

  // Create Agent Manager provider for editor panel
  const agentManagerHost = new VscodeHost(context.extensionUri, connectionService, context)
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService)
  context.subscriptions.push(agentManagerProvider)

  // Wire "Continue in Worktree" from sidebar → Agent Manager
  provider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )

  // Register serializer so Agent Manager restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentManagerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const ctx = agentManagerHost.wrapExistingPanel(panel, {
          onBeforeMessage: (msg) => agentManagerProvider.handleMessage(msg),
        })
        agentManagerProvider.deserializePanel(ctx)
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = new KiloProvider(context.extensionUri, connectionService, context)
        tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
          agentManagerProvider.continueFromSidebar(sessionId, progress),
        )
        tabProvider.setDiffVirtualProvider(diffVirtualProvider)
        tabProvider.resolveWebviewPanel(panel)
        tabPanels.set(panel, tabProvider)
        panel.onDidDispose(
          () => {
            console.log("[Kilo New] Tab panel restored from restart disposed")
            tabPanels.delete(panel)
            tabProvider.dispose()
          },
          null,
          context.subscriptions,
        )
        return Promise.resolve()
      },
    }),
  )

  // Create standalone diff viewer provider for the sidebar "Show Changes" action
  const diffViewerProvider = new DiffViewerProvider(context.extensionUri, connectionService)
  diffViewerProvider.setCommentHandler((comments, autoSend) => {
    void provider.appendReviewComments(comments, autoSend)
  })
  context.subscriptions.push(diffViewerProvider)

  // Create diff virtual provider (lightweight single-file diff for permission approval)
  const diffVirtualProvider = new DiffVirtualProvider(context.extensionUri)
  provider.setDiffVirtualProvider(diffVirtualProvider)
  agentManagerHost.setDiffVirtualProvider(diffVirtualProvider)
  context.subscriptions.push(diffVirtualProvider)

  // Create settings/profile editor provider (opens in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(settingsEditorProvider)

  // Create sub-agent viewer provider (read-only editor panel for sub-agent sessions)
  const subAgentViewerProvider = new SubAgentViewerProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(subAgentViewerProvider)

  // Register serializers so settings/diff/sub-agent panels restore on restart
  const settingsViews = ["settingsPanel", "profilePanel", "marketplacePanel"] as const
  for (const suffix of settingsViews) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`kilo-code.new.${suffix}`, {
        deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          settingsEditorProvider.deserializePanel(panel)
          return Promise.resolve()
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DiffViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        diffViewerProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.SubAgentViewerPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        // Sub-agent viewer requires a session ID that can't be recovered
        // after restart, so dispose the stale panel cleanly.
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so Voice Studio panel restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(VoiceStudioProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        VoiceStudioProvider.restorePanel(context, context.extensionUri, panel)
        return Promise.resolve()
      },
    }),
  )

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "plusButtonClicked" })
      else provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", (directory?: string) => {
      settingsEditorProvider.openPanel("marketplace", undefined, directory)
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "historyButtonClicked" })
      else provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cycleAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cycleAgentMode" })
      else provider.postMessage({ type: "action", action: "cycleAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cyclePreviousAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      else provider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", () => {
      settingsEditorProvider.openPanel("profile")
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsButtonClicked", (tab?: string) => {
      settingsEditorProvider.openPanel("settings", tab)
    }),
    // legacy-migration start
    vscode.commands.registerCommand("kilo-code.new.openMigrationWizard", () => {
      provider.postMessage({ type: "migrationState", needed: true })
    }),
    // legacy-migration end
    vscode.commands.registerCommand("kilo-code.new.generateTerminalCommand", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
      await provider.waitForReady()
      provider.postMessage({ type: "triggerTask", text: `Generate a terminal command: ${input}` })
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(context, connectionService, agentManagerProvider, tabPanels, diffVirtualProvider)
    }),
    vscode.commands.registerCommand("kilo-code.new.showChanges", () => {
      diffViewerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.openSubAgentViewer", (sessionID: string, title?: string) => {
      subAgentViewerProvider.openPanel(sessionID, title)
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showTerminal", () => {
      agentManagerProvider.showTerminalForCurrentSession()
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.toggleDiff", () => {
      agentManagerProvider.postMessage({ type: "action", action: "toggleDiff" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showShortcuts", () => {
      agentManagerProvider.postMessage({ type: "action", action: "showShortcuts" })
    }),

    vscode.commands.registerCommand("kilo-code.new.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.openWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.advancedWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "advancedWorktree" })
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      vscode.commands.registerCommand(`kilo-code.new.agentManager.jumpTo${i + 1}`, () => {
        agentManagerProvider.postMessage({ type: "action", action: `jumpTo${i + 1}` })
      }),
    ),
  )

  // Open Voice Studio panel
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.openVoiceStudio", () => {
      VoiceStudioProvider.openPanel(context, context.extensionUri)
    }),
  )

  // Quick voice switch via command palette
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.switchVoice", async () => {
      const favorites = context.globalState.get<string[]>("kilocode.voiceFavorites", [])
      const history = context.globalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])

      const items: vscode.QuickPickItem[] = []

      if (favorites.length > 0) {
        items.push({ label: "Favorites", kind: vscode.QuickPickItemKind.Separator })
        for (const fav of favorites) {
          const [provider, ...rest] = fav.split(":")
          items.push({ label: `⭐ ${rest.join(":")}`, description: provider, detail: fav })
        }
      }

      if (history.length > 0) {
        items.push({ label: "Recent", kind: vscode.QuickPickItemKind.Separator })
        for (const h of history.slice(0, 10)) {
          if (!favorites.includes(h.id)) {
            const [provider, ...rest] = h.id.split(":")
            items.push({ label: rest.join(":"), description: provider, detail: h.id })
          }
        }
      }

      items.push({ label: "Open Voice Studio...", description: "Browse all voices", detail: "__open_studio__" })

      const selected = await vscode.window.showQuickPick(items, { placeHolder: "Switch voice..." })
      if (selected) {
        if (selected.detail === "__open_studio__") {
          vscode.commands.executeCommand("kilo-code.new.openVoiceStudio")
        } else if (selected.detail) {
          const [provider, ...nameParts] = selected.detail.split(":")
          const name = nameParts.join(":")
          const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
          await config.update("provider", provider, vscode.ConfigurationTarget.Global)

          if (provider === "rvc") {
            await config.update("rvc.voiceId", name, vscode.ConfigurationTarget.Global)
          } else if (provider === "azure") {
            await config.update("azure.voiceId", name, vscode.ConfigurationTarget.Global)
          } else if (provider === "browser") {
            await config.update("browser.voiceURI", name, vscode.ConfigurationTarget.Global)
          }

          vscode.window.showInformationMessage(`Voice switched to: ${name}`)
        }
      }
    }),
  )

  // Register URI handler for session imports (vscode://kilocode.kilo-code/kilocode/s/{sessionId})
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        const match = uri.path.match(/^\/kilocode\/s\/([a-zA-Z0-9_-]+)$/)
        if (!match) return
        const sessionId = match[1]
        console.log("[Kilo New] URI handler: opening cloud session:", sessionId)
        await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
        provider.openCloudSession(sessionId)
      },
    }),
  )

  // Register autocomplete provider
  registerAutocompleteProvider(context, connectionService)

  // Start the CLI backend server eagerly so autocomplete works without opening a Kilo tab.
  ensureBackendForAutocomplete(connectionService)

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  // Register toggle auto-approve shortcut (Ctrl+Alt+A / Cmd+Alt+A)
  const defaultDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  registerToggleAutoApprove(
    context,
    connectionService,
    (sessionId) => {
      if (sessionId) {
        const dir =
          provider.getSessionDirectories().get(sessionId) ?? agentManagerProvider.getSessionDirectories().get(sessionId)
        if (dir) return dir
      }
      return defaultDir()
    },
    () => {
      const dirs = new Set([defaultDir()])
      for (const dir of provider.getSessionDirectories().values()) dirs.add(dir)
      for (const dir of agentManagerProvider.getSessionDirectories().values()) dirs.add(dir)
      return [...dirs]
    },
  )

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider)
  registerTerminalActions(context, provider, agentManagerProvider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new KiloCodeActionProvider(),
      KiloCodeActionProvider.metadata,
    ),
  )

  // Register E2E debug log command — opens the JSONL log in a VS Code editor so
  // developers and AI agents can inspect all captured messages.
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.openDebugLog", async () => {
      const logFile = debugCollector.getLogFile()
      if (!logFile) {
        void vscode.window.showWarningMessage(
          "KiloCode Debug: no log file yet. Enable kilo-code.debugMode first.",
        )
        return
      }
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(logFile))
    }),
  )

  // Apply debug mode at startup — always attach provider hook unconditionally.
  // attachProviderDebugHook sets hook to null when disabled, so the conditional is
  // unnecessary and was causing a timing gap when the setting was already true at launch.
  applyDebugMode()
  attachProviderDebugHook(provider, "KiloProvider[sidebar]")

  // Self-healing watchdog: every 30s re-verifies ALL debug hooks are attached.
  // Covers sidebar, all tab panels, Voice Studio, CLI, and SSE — nothing escapes.
  const debugWatchdog = setInterval(() => {
    if (debugCollector.isEnabled()) {
      connectionService.setCliDebugHook((src, data) => debugCollector.recordCli(src, data))
      connectionService.setSseDebugHook((eventType, data) => debugCollector.recordSSE(eventType, data))
      attachProviderDebugHook(provider, "KiloProvider[sidebar]")
      for (const [, p] of tabPanels) {
        p.setDebugHook(debugCollector.makeProviderHook("KiloProvider[tab]"))
      }
      VoiceStudioProvider.getInstance()?.setDebugHook(debugCollector.makeProviderHook("VoiceStudioProvider"))
    }
  }, 30_000)
  context.subscriptions.push({ dispose: () => clearInterval(debugWatchdog) })

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      unsubscribeStateChange()
      browserAutomationService.dispose()
      provider.dispose()
      connectionService.dispose()
    },
  })
}

export function deactivate() {
  TelemetryProxy.getInstance().shutdown()
}

async function openKiloInNewTab(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
  agentManagerProvider: AgentManagerProvider,
  tabPanels: Map<vscode.WebviewPanel, KiloProvider>,
  diffVirtualProvider: DiffVirtualProvider,
) {
  const lastCol = Math.max(...vscode.window.visibleTextEditors.map((e) => e.viewColumn || 0), 0)
  const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

  if (!hasVisibleEditors) {
    await vscode.commands.executeCommand("workbench.action.newGroupRight")
  }

  const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

  const panel = vscode.window.createWebviewPanel("kilo-code.new.TabPanel", EXTENSION_DISPLAY_NAME, targetCol, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-dark.svg"),
  }

  const tabProvider = new KiloProvider(context.extensionUri, connectionService, context)
  tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  tabProvider.setDiffVirtualProvider(diffVirtualProvider)
  // Attach debug hook — always (no conditional; setDebugHook with null is a safe no-op)
  tabProvider.setDebugHook(
    DebugCollector.getInstance().isEnabled()
      ? DebugCollector.getInstance().makeProviderHook("KiloProvider[tab]")
      : null,
  )
  tabProvider.resolveWebviewPanel(panel)
  tabPanels.set(panel, tabProvider)

  // Keep tab provider debug hook in sync when debug mode is toggled while this tab is open
  const unsubTabDebug = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kilo-code.debugMode")) {
      tabProvider.setDebugHook(
        DebugCollector.getInstance().isEnabled()
          ? DebugCollector.getInstance().makeProviderHook("KiloProvider[tab]")
          : null,
      )
    }
  })
  context.subscriptions.push(unsubTabDebug)

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

  panel.onDidDispose(
    () => {
      console.log("[Kilo New] Tab panel disposed")
      tabPanels.delete(panel)
      tabProvider.dispose()
      unsubTabDebug.dispose()
    },
    null,
    context.subscriptions,
  )
}

/**
 * Add extension commands to terminal.integrated.commandsToSkipShell so they
 * work when a VS Code terminal has focus. The setting only ships with built-in
 * commands; extension commands must be added explicitly.
 */
function ensureCommandsSkipShell(commands: string[]): void {
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update whichever scope already carries an override so we don't
  // shadow workspace settings or leak workspace values into global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((cmd) => !existing.includes(cmd))
  if (missing.length === 0) return
  config.update("commandsToSkipShell", [...existing, ...missing], target)
}

function waitForWebviewPanelToBeActive(panel: vscode.WebviewPanel): Promise<void> {
  if (panel.active) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const disposable = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        return
      }
      disposable.dispose()
      resolve()
    })
  })
}
