/**
 * Voice Studio message type tests.
 *
 * Verifies that all Voice Studio message interfaces exist in messages.ts
 * and are included in the correct union types.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const MESSAGES_FILE = path.join(ROOT, "webview-ui/src/types/messages.ts")

function readFile(filePath: string): string {
	return fs.readFileSync(filePath, "utf-8")
}

const WEBVIEW_TO_EXTENSION_MESSAGES = [
	"OpenVoiceStudioMessage",
	"FetchVoiceLibraryMessage",
	"FetchStoreModelsMessage",
	"PreviewStoreVoiceMessage",
	"DownloadModelMessage",
	"CancelDownloadMessage",
	"DeleteModelMessage",
	"ToggleFavoriteVoiceMessage",
	"SetActiveVoiceMessage",
	"SaveSearchMessage",
	"DeleteSavedSearchMessage",
	"SwitchInteractionModeMessage",
	"VoiceCommandMessage",
	"RequestVoiceStudioStateMessage",
]

const EXTENSION_TO_WEBVIEW_MESSAGES = [
	"VoiceLibraryLoadedMessage",
	"StoreModelsLoadedMessage",
	"DownloadProgressMessage",
	"DownloadCompleteMessage",
	"DownloadFailedMessage",
	"PreviewAudioReadyMessage",
	"VoiceCommandAckMessage",
	"InteractionModeChangedMessage",
	"VoiceStudioStateMessage",
	"DiskUsageMessage",
]

describe("Voice Studio message interfaces", () => {
	const content = readFile(MESSAGES_FILE)

	for (const name of [...WEBVIEW_TO_EXTENSION_MESSAGES, ...EXTENSION_TO_WEBVIEW_MESSAGES]) {
		it(`${name} interface exists and has a type property`, () => {
			const interfaceRegex = new RegExp(`export interface ${name}\\s*\\{[^}]*type:\\s*"`)
			expect(interfaceRegex.test(content)).toBe(true)
		})
	}
})

describe("Voice Studio messages in union types", () => {
	const content = readFile(MESSAGES_FILE)

	// Extract WebviewMessage union
	const webviewUnionMatch = content.match(
		/export type WebviewMessage\s*=\s*([\s\S]*?)(?=\n\/\/\s*={3,}|\nexport type|\nexport interface|\nexport function|$)/,
	)
	const webviewUnionBody = webviewUnionMatch?.[1] ?? ""

	for (const name of WEBVIEW_TO_EXTENSION_MESSAGES) {
		it(`${name} is in the WebviewMessage union`, () => {
			expect(webviewUnionBody).toContain(name)
		})
	}

	// Extract ExtensionMessage union
	const extUnionMatch = content.match(
		/export type ExtensionMessage\s*=\s*([\s\S]*?)(?=\n\/\/\s*={3,}|\nexport type|\nexport interface|\nexport function|$)/,
	)
	const extUnionBody = extUnionMatch?.[1] ?? ""

	for (const name of EXTENSION_TO_WEBVIEW_MESSAGES) {
		it(`${name} is in the ExtensionMessage union`, () => {
			expect(extUnionBody).toContain(name)
		})
	}
})
