/**
 * Unit tests for VoiceStudioProvider.
 *
 * Tests the singleton pattern, message routing, favorites, history,
 * saved searches, interaction modes, voice commands, download cancel,
 * and catalog refresh.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import * as vscode from "vscode"
import { VoiceStudioProvider } from "../../src/VoiceStudioProvider"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Messages posted from provider to webview are collected here. */
let postedMessages: Record<string, unknown>[] = []

/** Captured onDidReceiveMessage listener so we can simulate webview -> ext */
let messageListener: ((msg: Record<string, unknown>) => void) | undefined

/** Captured onDidDispose listener */
let disposeListener: (() => void) | undefined

function createMockWebviewPanel(): vscode.WebviewPanel {
	postedMessages = []
	messageListener = undefined
	disposeListener = undefined

	return {
		viewType: VoiceStudioProvider.viewType,
		title: "Voice Studio",
		webview: {
			html: "",
			options: {},
			cspSource: "vscode-resource://test",
			asWebviewUri: (uri: any) => uri,
			onDidReceiveMessage: (listener: any) => {
				messageListener = listener
				return { dispose: () => {} }
			},
			postMessage: async (msg: any) => {
				postedMessages.push(msg as Record<string, unknown>)
				return true
			},
		},
		options: {},
		viewColumn: vscode.ViewColumn.One,
		active: true,
		visible: true,
		iconPath: undefined,
		onDidChangeViewState: () => ({ dispose: () => {} }),
		onDidDispose: (listener: any) => {
			disposeListener = listener
			return { dispose: () => {} }
		},
		reveal: () => {},
		dispose: () => {
			if (disposeListener) disposeListener()
		},
	} as unknown as vscode.WebviewPanel
}

/** globalState store backed by a plain Map */
function createMockGlobalState(): vscode.Memento & { setKeysForSync(): void } {
	const store = new Map<string, unknown>()
	return {
		keys: () => [...store.keys()],
		get<T>(key: string, defaultValue?: T): T {
			return (store.has(key) ? store.get(key) : defaultValue) as T
		},
		async update(key: string, value: unknown): Promise<void> {
			store.set(key, value)
		},
		setKeysForSync() {},
	}
}

/** Configuration store backed by a plain Map, matching workspace.getConfiguration */
function createMockConfiguration(initial: Record<string, unknown> = {}): any {
	const store = new Map<string, unknown>(Object.entries(initial))
	return {
		get<T>(key: string, defaultValue?: T): T {
			return (store.has(key) ? store.get(key) : defaultValue) as T
		},
		async update(key: string, value: unknown, _target?: unknown): Promise<void> {
			store.set(key, value)
		},
		has(key: string): boolean {
			return store.has(key)
		},
		inspect() {
			return undefined
		},
	}
}

/** Default speech config values used across tests */
const DEFAULT_SPEECH: Record<string, unknown> = {
	"enabled": false,
	"autoSpeak": false,
	"provider": "browser",
	"volume": 80,
	"rvc.voiceId": "",
	"rvc.dockerPort": 5050,
	"rvc.edgeVoice": "en-US-AriaNeural",
	"rvc.pitchShift": 0,
	"rvc.modelServerUrl": "https://voice.daveai.tech",
	"azure.region": "westus",
	"azure.apiKey": "",
	"azure.voiceId": "en-US-JennyNeural",
	"browser.voiceURI": "",
	"browser.rate": 1.0,
	"browser.pitch": 1.0,
}

let mockConfig: ReturnType<typeof createMockConfiguration>
let mockGlobalState: ReturnType<typeof createMockGlobalState>

function createMockContext(): vscode.ExtensionContext {
	mockGlobalState = createMockGlobalState()

	return {
		subscriptions: [],
		extensionPath: "/ext",
		extensionUri: vscode.Uri.file("/ext"),
		globalState: mockGlobalState,
		workspaceState: createMockGlobalState(),
		secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose: () => {} }) } as any,
		storageUri: vscode.Uri.file("/storage"),
		globalStorageUri: vscode.Uri.file("/global-storage"),
		logUri: vscode.Uri.file("/log"),
		extensionMode: 3 as any,
		environmentVariableCollection: {} as any,
		storagePath: "/storage",
		globalStoragePath: "/global-storage",
		logPath: "/log",
		asAbsolutePath: (p: string) => p,
		extension: {} as any,
		languageModelAccessInformation: {} as any,
	} as unknown as vscode.ExtensionContext
}

// Patch vscode.window.createOutputChannel for the provider's log channel
const origCreateOutputChannel = (vscode.window as any).createOutputChannel;
(vscode.window as any).createOutputChannel = (_name: string, _opts?: any) => ({
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	append: () => {},
	appendLine: () => {},
	clear: () => {},
	show: () => {},
	hide: () => {},
	dispose: () => {},
	name: _name,
})

// Patch vscode.window.createWebviewPanel for openPanel tests
const createdPanels: vscode.WebviewPanel[] = [];
(vscode.window as any).createWebviewPanel = (
	_viewType: string,
	_title: string,
	_showOptions: any,
	_options?: any,
): vscode.WebviewPanel => {
	const p = createMockWebviewPanel()
	createdPanels.push(p)
	return p
}

// Patch workspace.getConfiguration to return per-section mocks
const origGetConfiguration = vscode.workspace.getConfiguration;
(vscode.workspace as any).getConfiguration = (section?: string) => {
	if (section === "kilo-code.new.speech") {
		return mockConfig
	}
	return origGetConfiguration()
}

// Patch workspace.onDidChangeConfiguration so wirePanel doesn't crash in tests
;(vscode.workspace as any).onDidChangeConfiguration = (_listener: any) => ({ dispose: () => {} })

// ---------------------------------------------------------------------------
// Provider factory — create an instance and wire up a mock panel
// ---------------------------------------------------------------------------

let provider: VoiceStudioProvider
let panel: vscode.WebviewPanel

function setup() {
	// Reset singleton
	;(VoiceStudioProvider as any).instance = undefined

	mockConfig = createMockConfiguration(DEFAULT_SPEECH)
	const ctx = createMockContext()
	const extUri = vscode.Uri.file("/ext")
	provider = new VoiceStudioProvider(extUri, ctx)
	panel = createMockWebviewPanel()
	provider.deserializePanel(panel)

	// Stub out network and exec methods so tests don't make real calls
	;(provider as any).httpGet = async (_url: string): Promise<string> => {
		throw new Error("mock: no network")
	}
	;(provider as any).httpPost = async (_url: string, _body: string): Promise<string> => {
		throw new Error("mock: no network")
	}
	;(provider as any).execAsync = async (_cmd: string): Promise<string> => {
		throw new Error("mock: no docker")
	}
}

/** Send a message from the webview side and wait for async handlers to settle. */
async function sendMessage(msg: Record<string, unknown>): Promise<void> {
	if (!messageListener) throw new Error("No message listener registered — did wirePanel run?")
	await (messageListener(msg) as any)
	// Allow microtasks to flush
	await new Promise<void>((r) => setTimeout(r, 10))
}

/** Return the last message posted to the webview. */
function lastPost(): Record<string, unknown> {
	return postedMessages[postedMessages.length - 1]
}

/** Return all posted messages of a given type. */
function postsOfType(type: string): Record<string, unknown>[] {
	return postedMessages.filter((m) => m.type === type)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceStudioProvider", () => {
	beforeEach(() => {
		setup()
		createdPanels.length = 0
	})

	afterEach(() => {
		provider.dispose()
	})

	// -----------------------------------------------------------------------
	// 1. Singleton pattern
	// -----------------------------------------------------------------------

	describe("Singleton pattern", () => {
		it("openPanel creates only one panel on repeated calls", () => {
			;(VoiceStudioProvider as any).instance = undefined
			const ctx = createMockContext()
			const extUri = vscode.Uri.file("/ext")

			VoiceStudioProvider.openPanel(ctx, extUri)
			const firstCount = createdPanels.length
			expect(firstCount).toBe(1)

			// Second call should reveal, not create
			VoiceStudioProvider.openPanel(ctx, extUri)
			expect(createdPanels.length).toBe(firstCount)

			// Cleanup
			;(VoiceStudioProvider as any).instance?.dispose()
		})

		it("openPanel creates a new panel after previous panel is disposed", () => {
			;(VoiceStudioProvider as any).instance = undefined
			const ctx = createMockContext()
			const extUri = vscode.Uri.file("/ext")

			VoiceStudioProvider.openPanel(ctx, extUri)
			expect(createdPanels.length).toBe(1)

			// Dispose the panel
			createdPanels[0].dispose()

			// Now a new panel should be created
			VoiceStudioProvider.openPanel(ctx, extUri)
			expect(createdPanels.length).toBe(2)

			;(VoiceStudioProvider as any).instance?.dispose()
		})
	})

	// -----------------------------------------------------------------------
	// 2. Message routing — unknown type is silently handled
	// -----------------------------------------------------------------------

	describe("Message routing", () => {
		it("unknown message type does not crash and posts nothing", async () => {
			const before = postedMessages.length
			await sendMessage({ type: "nonExistentMessageType" })
			expect(postedMessages.length).toBe(before)
		})

		it("routes requestVoiceStudioState and replies with voiceStudioState", async () => {
			await sendMessage({ type: "requestVoiceStudioState" })
			const msg = lastPost()
			expect(msg.type).toBe("voiceStudioState")
			expect(msg.favorites).toEqual([])
			expect(msg.history).toEqual([])
			expect(msg.interactionMode).toBe("manual")
			expect(msg.speechSettings).toBeDefined()
		})
	})

	// -----------------------------------------------------------------------
	// 3. Favorites management
	// -----------------------------------------------------------------------

	describe("Favorites management", () => {
		it("adds a favorite", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-a", action: "add" })
			const msg = lastPost()
			expect(msg.type).toBe("favoritesUpdated")
			expect(msg.favorites).toEqual(["voice-a"])
		})

		it("does not duplicate a favorite on second add", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-a", action: "add" })
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-a", action: "add" })
			const msg = lastPost()
			expect((msg.favorites as string[]).filter((f) => f === "voice-a").length).toBe(1)
		})

		it("removes a favorite", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-a", action: "add" })
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-b", action: "add" })
			await sendMessage({ type: "toggleFavorite", voiceId: "voice-a", action: "remove" })
			const msg = lastPost()
			expect(msg.favorites).toEqual(["voice-b"])
		})

		it("remove on empty favorites is a no-op", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "nonexistent", action: "remove" })
			const msg = lastPost()
			expect(msg.type).toBe("favoritesUpdated")
			expect(msg.favorites).toEqual([])
		})

		it("persists favorites to globalState", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "v1", action: "add" })
			await sendMessage({ type: "toggleFavorite", voiceId: "v2", action: "add" })
			const stored = mockGlobalState.get<string[]>("kilocode.voiceFavorites", [])
			expect(stored).toEqual(["v1", "v2"])
		})
	})

	// -----------------------------------------------------------------------
	// 4. History management
	// -----------------------------------------------------------------------

	describe("History management", () => {
		it("adds to history when setActiveVoice is called", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-1", provider: "rvc" })
			const msg = postsOfType("activeVoiceSet")[0]
			expect(msg.voiceId).toBe("voice-1")

			const history = mockGlobalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
			expect(history.length).toBe(1)
			expect(history[0].id).toBe("voice-1")
		})

		it("deduplicates history entries for the same voice", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-1", provider: "rvc" })
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-1", provider: "rvc" })

			const history = mockGlobalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
			expect(history.length).toBe(1)
		})

		it("moves re-used voice to front of history", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-1", provider: "rvc" })
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-2", provider: "rvc" })
			await sendMessage({ type: "setActiveVoice", voiceId: "voice-1", provider: "rvc" })

			const history = mockGlobalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
			expect(history.length).toBe(2)
			expect(history[0].id).toBe("voice-1")
			expect(history[1].id).toBe("voice-2")
		})

		it("caps history at 50 entries", async () => {
			for (let i = 0; i < 55; i++) {
				await sendMessage({ type: "setActiveVoice", voiceId: `v-${i}`, provider: "browser" })
			}

			const history = mockGlobalState.get<{ id: string; timestamp: number }[]>("kilocode.voiceHistory", [])
			expect(history.length).toBe(50)
			// Most recent should be first
			expect(history[0].id).toBe("v-54")
		})

		it("sets rvc.voiceId config for rvc provider", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "my-rvc-voice", provider: "rvc" })
			expect(mockConfig.get("rvc.voiceId")).toBe("my-rvc-voice")
		})

		it("sets azure.voiceId config for azure provider", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "en-US-GuyNeural", provider: "azure" })
			expect(mockConfig.get("azure.voiceId")).toBe("en-US-GuyNeural")
		})

		it("sets browser.voiceURI config for browser provider", async () => {
			await sendMessage({ type: "setActiveVoice", voiceId: "Google US English", provider: "browser" })
			expect(mockConfig.get("browser.voiceURI")).toBe("Google US English")
		})
	})

	// -----------------------------------------------------------------------
	// 5. Saved searches
	// -----------------------------------------------------------------------

	describe("Saved searches", () => {
		const search1 = {
			id: "s1",
			label: "Deep voices",
			query: "bass",
			filters: { gender: "male" },
			createdAt: 1000,
		}
		const search2 = {
			id: "s2",
			label: "Female pop",
			query: "pop",
			filters: { gender: "female" },
			createdAt: 2000,
		}

		it("saves a search and posts update", async () => {
			await sendMessage({ type: "saveSearch", search: search1 })
			const msg = lastPost()
			expect(msg.type).toBe("savedSearchesUpdated")
			expect((msg.savedSearches as any[]).length).toBe(1)
			expect((msg.savedSearches as any[])[0].id).toBe("s1")
		})

		it("accumulates multiple saved searches", async () => {
			await sendMessage({ type: "saveSearch", search: search1 })
			await sendMessage({ type: "saveSearch", search: search2 })
			const msg = lastPost()
			expect((msg.savedSearches as any[]).length).toBe(2)
		})

		it("deletes a saved search by id", async () => {
			await sendMessage({ type: "saveSearch", search: search1 })
			await sendMessage({ type: "saveSearch", search: search2 })
			await sendMessage({ type: "deleteSavedSearch", searchId: "s1" })
			const msg = lastPost()
			expect(msg.type).toBe("savedSearchesUpdated")
			expect((msg.savedSearches as any[]).length).toBe(1)
			expect((msg.savedSearches as any[])[0].id).toBe("s2")
		})

		it("delete of non-existent search is harmless", async () => {
			await sendMessage({ type: "deleteSavedSearch", searchId: "no-such-id" })
			const msg = lastPost()
			expect(msg.type).toBe("savedSearchesUpdated")
			expect((msg.savedSearches as any[]).length).toBe(0)
		})
	})

	// -----------------------------------------------------------------------
	// 6. Interaction mode switching
	// -----------------------------------------------------------------------

	describe("Interaction mode switching", () => {
		it("switches to hands-free mode", async () => {
			await sendMessage({ type: "switchInteractionMode", mode: "hands-free" })
			const msg = lastPost()
			expect(msg.type).toBe("interactionModeChanged")
			expect(msg.mode).toBe("hands-free")
		})

		it("persists mode to globalState", async () => {
			await sendMessage({ type: "switchInteractionMode", mode: "hands-free" })
			const stored = mockGlobalState.get<string>("kilocode.voiceInteractionMode")
			expect(stored).toBe("hands-free")
		})

		it("switches back to manual", async () => {
			await sendMessage({ type: "switchInteractionMode", mode: "hands-free" })
			await sendMessage({ type: "switchInteractionMode", mode: "manual" })
			const msg = lastPost()
			expect(msg.mode).toBe("manual")
		})
	})

	// -----------------------------------------------------------------------
	// 7. Voice command parsing
	// -----------------------------------------------------------------------

	describe("Voice command parsing", () => {
		it("parses 'switch to X' command", async () => {
			await sendMessage({ type: "voiceCommand", transcript: "switch to Morgan Freeman" })
			const msg = lastPost()
			expect(msg.type).toBe("voiceCommandAck")
			expect(msg.action).toBe("switchVoice")
			expect(msg.voiceName).toBe("morgan freeman")
			expect(msg.success).toBe(true)
		})

		it("parses 'stop' command", async () => {
			await sendMessage({ type: "voiceCommand", transcript: "stop" })
			const msg = lastPost()
			expect(msg.action).toBe("stop")
			expect(msg.success).toBe(true)
		})

		it("parses 'slower' command and decreases browser.rate", async () => {
			mockConfig.update("browser.rate", 1.0)
			await sendMessage({ type: "voiceCommand", transcript: "slower" })
			const msg = lastPost()
			expect(msg.action).toBe("slower")
			expect(msg.success).toBe(true)
			const rate = mockConfig.get<number>("browser.rate")!
			expect(rate).toBeCloseTo(0.9, 5)
		})

		it("parses 'faster' command and increases browser.rate", async () => {
			mockConfig.update("browser.rate", 1.0)
			await sendMessage({ type: "voiceCommand", transcript: "faster" })
			const msg = lastPost()
			expect(msg.action).toBe("faster")
			expect(msg.success).toBe(true)
			const rate = mockConfig.get<number>("browser.rate")!
			expect(rate).toBeCloseTo(1.1, 5)
		})

		it("clamps rate at minimum 0.1 for 'slower'", async () => {
			mockConfig.update("browser.rate", 0.1)
			await sendMessage({ type: "voiceCommand", transcript: "slower" })
			const rate = mockConfig.get<number>("browser.rate")!
			expect(rate).toBeCloseTo(0.1, 5)
		})

		it("clamps rate at maximum 3.0 for 'faster'", async () => {
			mockConfig.update("browser.rate", 3.0)
			await sendMessage({ type: "voiceCommand", transcript: "faster" })
			const rate = mockConfig.get<number>("browser.rate")!
			expect(rate).toBeCloseTo(3.0, 5)
		})

		it("parses 'louder' command and increases volume", async () => {
			mockConfig.update("volume", 80)
			await sendMessage({ type: "voiceCommand", transcript: "louder" })
			const msg = lastPost()
			expect(msg.action).toBe("louder")
			expect(msg.success).toBe(true)
			expect(mockConfig.get<number>("volume")).toBe(90)
		})

		it("parses 'softer' command and decreases volume", async () => {
			mockConfig.update("volume", 80)
			await sendMessage({ type: "voiceCommand", transcript: "softer" })
			const msg = lastPost()
			expect(msg.action).toBe("softer")
			expect(msg.success).toBe(true)
			expect(mockConfig.get<number>("volume")).toBe(70)
		})

		it("clamps volume at 100 for 'louder'", async () => {
			mockConfig.update("volume", 95)
			await sendMessage({ type: "voiceCommand", transcript: "louder" })
			expect(mockConfig.get<number>("volume")).toBe(100)
		})

		it("clamps volume at 0 for 'softer'", async () => {
			mockConfig.update("volume", 5)
			await sendMessage({ type: "voiceCommand", transcript: "softer" })
			expect(mockConfig.get<number>("volume")).toBe(0)
		})

		it("parses 'hands free off' and switches to manual", async () => {
			await sendMessage({ type: "switchInteractionMode", mode: "hands-free" })
			await sendMessage({ type: "voiceCommand", transcript: "hands free off" })

			// Should post both interactionModeChanged and voiceCommandAck
			const modeMsg = postsOfType("interactionModeChanged")
			expect(modeMsg.length).toBeGreaterThanOrEqual(2) // one from switch, one from voice cmd
			expect(modeMsg[modeMsg.length - 1].mode).toBe("manual")

			const ackMsg = postsOfType("voiceCommandAck")
			expect(ackMsg[0].action).toBe("handsFreeOff")
			expect(ackMsg[0].success).toBe(true)

			const stored = mockGlobalState.get<string>("kilocode.voiceInteractionMode")
			expect(stored).toBe("manual")
		})

		it("returns unknown action for unrecognized command", async () => {
			await sendMessage({ type: "voiceCommand", transcript: "do a barrel roll" })
			const msg = lastPost()
			expect(msg.type).toBe("voiceCommandAck")
			expect(msg.action).toBe("unknown")
			expect(msg.success).toBe(false)
		})

		it("uses provided commandId when given", async () => {
			await sendMessage({ type: "voiceCommand", transcript: "stop", commandId: "cmd-42" })
			const msg = lastPost()
			expect(msg.commandId).toBe("cmd-42")
		})

		it("handles leading/trailing whitespace and case in transcript", async () => {
			await sendMessage({ type: "voiceCommand", transcript: "  STOP  " })
			const msg = lastPost()
			expect(msg.action).toBe("stop")
			expect(msg.success).toBe(true)
		})
	})

	// -----------------------------------------------------------------------
	// 8. Download cancel
	// -----------------------------------------------------------------------

	describe("Download cancel", () => {
		it("aborts the controller for an in-flight download", async () => {
			// Manually inject a download tracker
			const controller = new AbortController()
			const downloads = (provider as any).downloads as Map<string, { controller: AbortController; received: number; total: number }>
			downloads.set("model-x", { controller, received: 100, total: 1000 })

			expect(controller.signal.aborted).toBe(false)

			await sendMessage({ type: "cancelDownload", modelId: "model-x" })

			expect(controller.signal.aborted).toBe(true)
			expect(downloads.has("model-x")).toBe(false)
		})

		it("cancel for unknown modelId does not throw", async () => {
			// Should not throw
			await sendMessage({ type: "cancelDownload", modelId: "no-such-model" })
			// No crash is the assertion
			expect(true).toBe(true)
		})
	})

	// -----------------------------------------------------------------------
	// 9. refreshStoreCatalog
	// -----------------------------------------------------------------------

	describe("refreshStoreCatalog", () => {
		it("posts storeModelsLoaded after refresh (network errors handled gracefully)", async () => {
			// httpGet and httpPost will fail because there is no real server
			// but the handler catches errors and posts a result with empty models
			await sendMessage({ type: "refreshStoreCatalog" })

			const msgs = postsOfType("storeModelsLoaded")
			expect(msgs.length).toBeGreaterThanOrEqual(1)
			const msg = msgs[msgs.length - 1]
			expect(msg.type).toBe("storeModelsLoaded")
			expect(msg.models).toEqual([])
		})
	})

	// -----------------------------------------------------------------------
	// 10. requestVoiceStudioState — full state shape
	// -----------------------------------------------------------------------

	describe("requestVoiceStudioState", () => {
		it("returns all expected state fields with defaults", async () => {
			await sendMessage({ type: "requestVoiceStudioState" })
			const msg = lastPost()
			expect(msg.type).toBe("voiceStudioState")
			expect(msg.favorites).toEqual([])
			expect(msg.history).toEqual([])
			expect(msg.recentSearches).toEqual([])
			expect(msg.savedSearches).toEqual([])
			expect(msg.interactionMode).toBe("manual")

			const settings = msg.speechSettings as Record<string, unknown>
			expect(settings.enabled).toBe(false)
			expect(settings.autoSpeak).toBe(false)
			expect(settings.provider).toBe("browser")
			expect(settings.volume).toBe(80)

			const rvc = settings.rvc as Record<string, unknown>
			expect(rvc.voiceId).toBe("")
			expect(rvc.dockerPort).toBe(5050)
			expect(rvc.edgeVoice).toBe("en-US-AriaNeural")
			expect(rvc.pitchShift).toBe(0)
			expect(rvc.modelServerUrl).toBe("https://voice.daveai.tech")

			const azure = settings.azure as Record<string, unknown>
			expect(azure.region).toBe("westus")
			expect(azure.apiKey).toBe("")
			expect(azure.voiceId).toBe("en-US-JennyNeural")

			const browser = settings.browser as Record<string, unknown>
			expect(browser.voiceURI).toBe("")
			expect(browser.rate).toBe(1.0)
			expect(browser.pitch).toBe(1.0)
		})

		it("reflects previously saved favorites and mode in state", async () => {
			await sendMessage({ type: "toggleFavorite", voiceId: "fav-1", action: "add" })
			await sendMessage({ type: "switchInteractionMode", mode: "hands-free" })

			await sendMessage({ type: "requestVoiceStudioState" })
			const msg = lastPost()
			expect(msg.favorites).toEqual(["fav-1"])
			expect(msg.interactionMode).toBe("hands-free")
		})
	})

	// -----------------------------------------------------------------------
	// 11. fetchVoiceLibrary — network error path
	// -----------------------------------------------------------------------

	describe("fetchVoiceLibrary", () => {
		it("posts voiceLibraryLoaded even when Docker is unreachable", async () => {
			// Both httpGet and docker exec will fail, handler catches errors
			await sendMessage({ type: "fetchVoiceLibrary" })

			const msgs = postsOfType("voiceLibraryLoaded")
			expect(msgs.length).toBe(1)
			// Should still have voices array (possibly empty)
			expect(Array.isArray(msgs[0].voices)).toBe(true)
		})
	})

	// -----------------------------------------------------------------------
	// 12. fetchStoreModels — network error path
	// -----------------------------------------------------------------------

	describe("fetchStoreModels", () => {
		it("posts storeModelsLoaded with error when server unreachable", async () => {
			await sendMessage({ type: "fetchStoreModels" })

			const msgs = postsOfType("storeModelsLoaded")
			expect(msgs.length).toBe(1)
			expect(msgs[0].models).toEqual([])
			expect(msgs[0].error).toBeDefined()
		})
	})

	// -----------------------------------------------------------------------
	// 13. previewStoreVoice — network error path
	// -----------------------------------------------------------------------

	describe("previewStoreVoice", () => {
		it("posts previewAudioReady with error when server unreachable", async () => {
			await sendMessage({ type: "previewStoreVoice", modelId: "test-model" })

			const msgs = postsOfType("previewAudioReady")
			expect(msgs.length).toBe(1)
			expect(msgs[0].modelId).toBe("test-model")
			expect(msgs[0].audioBase64).toBe("")
			expect(msgs[0].error).toBeDefined()
		})
	})

	// -----------------------------------------------------------------------
	// 14. deleteModel — network error path
	// -----------------------------------------------------------------------

	describe("deleteModel", () => {
		it("posts modelDeleted with error when docker exec fails", async () => {
			await sendMessage({ type: "deleteModel", modelId: "m1", name: "TestModel" })

			const msgs = postsOfType("modelDeleted")
			expect(msgs.length).toBe(1)
			expect(msgs[0].modelId).toBe("m1")
			expect(msgs[0].success).toBe(false)
			expect(msgs[0].error).toBeDefined()
		})
	})

	// -----------------------------------------------------------------------
	// 15. Panel dispose aborts downloads
	// -----------------------------------------------------------------------

	describe("Panel dispose", () => {
		it("aborts all in-flight downloads when panel is disposed", () => {
			const c1 = new AbortController()
			const c2 = new AbortController()
			const downloads = (provider as any).downloads as Map<string, { controller: AbortController; received: number; total: number }>
			downloads.set("d1", { controller: c1, received: 0, total: 100 })
			downloads.set("d2", { controller: c2, received: 0, total: 200 })

			// Dispose panel
			panel.dispose()

			expect(c1.signal.aborted).toBe(true)
			expect(c2.signal.aborted).toBe(true)
			expect(downloads.size).toBe(0)
		})
	})

	// -----------------------------------------------------------------------
	// 16. Post utility — no crash when panel is undefined
	// -----------------------------------------------------------------------

	describe("Post utility", () => {
		it("does not throw when panel is undefined", () => {
			// Dispose the panel so this.panel is undefined
			panel.dispose()

			// Call post via a handler that would normally post
			// switchInteractionMode calls post, so send it after dispose
			// messageListener is gone after dispose, so call directly
			expect(() => {
				;(provider as any).post({ type: "test" })
			}).not.toThrow()
		})
	})
})
