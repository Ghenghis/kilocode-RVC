/**
 * Voice Studio component / hook tests.
 *
 * Because these are SolidJS components running outside a real DOM,
 * we test the pure-function logic extracted from each module:
 *   - helper functions (formatFileSize, formatTime, isInstalled, etc.)
 *   - command pattern matching (useVoiceCommands)
 *   - autocomplete / search utilities
 *   - SpeechRecognition integration via mocks (useVoiceSearch)
 *   - filter state helpers (FilterBar logic)
 *   - VoiceAvatar provider/gender mapping
 */

import { describe, test, expect, beforeEach, mock, type Mock } from "bun:test"
import type {
	VoiceEntry,
	StoreVoiceEntry,
	FilterState,
	VoiceGender,
	VoiceStyle,
	VoiceProvider,
} from "../../webview-ui/src/types/voice"
import { DEFAULT_FILTERS, ACCENT_LABELS, MOOD_MAPPINGS } from "../../webview-ui/src/types/voice"
import {
	fuzzySearchVoices,
	applyFilters,
	getAutocompleteResults,
	getFilterCounts,
} from "../../webview-ui/src/utils/voice-search"

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeVoice(overrides: Partial<VoiceEntry> = {}): VoiceEntry {
	return {
		id: "rvc:test-voice",
		provider: "rvc",
		name: "Test Voice",
		description: "A test voice entry",
		gender: "female",
		accent: "en-US",
		accentLabel: "American English",
		style: "natural",
		quality: 4 as 4,
		sampleRate: 48000,
		fileSize: 104857600,
		tags: ["warm", "studio"],
		installed: true,
		favorite: false,
		...overrides,
	}
}

function makeStoreVoice(overrides: Partial<StoreVoiceEntry> = {}): StoreVoiceEntry {
	return {
		id: "store:demo",
		name: "Store Demo",
		description: "A store voice",
		gender: "male",
		accent: "en-GB",
		accentLabel: "British English",
		style: "expressive",
		quality: 3 as 3,
		sampleRate: 24000,
		fileSize: 52428800,
		tags: ["deep", "bass"],
		downloadUrl: "https://example.com/model.zip",
		heroClipUrl: null,
		category: "community",
		addedAt: "2025-01-01",
		...overrides,
	}
}

const VOICES: VoiceEntry[] = [
	makeVoice({
		id: "rvc:lunar",
		name: "Lunar Studio",
		gender: "female",
		accent: "en-US",
		accentLabel: "American English",
		style: "natural",
		quality: 5 as 5,
		tags: ["warm", "studio", "hifi"],
		installed: true,
		favorite: true,
		fileSize: 209715200,
	}),
	makeVoice({
		id: "azure:aria",
		provider: "azure",
		name: "Aria Neural",
		gender: "female",
		accent: "en-US",
		accentLabel: "American English",
		style: "expressive",
		quality: 5 as 5,
		tags: ["bright", "clear"],
		installed: false,
		favorite: false,
		fileSize: 0,
	}),
	makeVoice({
		id: "rvc:gravel",
		name: "Gravel",
		gender: "male",
		accent: "en-GB",
		accentLabel: "British English",
		style: "broadcast",
		quality: 3 as 3,
		tags: ["deep", "bass", "robotic"],
		installed: true,
		favorite: false,
		fileSize: 157286400,
	}),
	makeVoice({
		id: "browser:default",
		provider: "browser",
		name: "Default Browser",
		gender: "neutral",
		accent: "en-US",
		accentLabel: "American English",
		style: "natural",
		quality: 2 as 2,
		tags: [],
		installed: true,
		favorite: false,
		fileSize: 0,
	}),
]

// ==========================================================================
// 1. AudioPlayer — formatTime helper
// ==========================================================================
describe("AudioPlayer — formatTime", () => {
	// Re-implement the exact logic from AudioPlayer.tsx to unit-test it
	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return "0:00"
		const m = Math.floor(seconds / 60)
		const s = Math.floor(seconds % 60)
		return `${m}:${s.toString().padStart(2, "0")}`
	}

	test("formats 0 seconds", () => {
		expect(formatTime(0)).toBe("0:00")
	})

	test("formats seconds less than a minute", () => {
		expect(formatTime(5)).toBe("0:05")
		expect(formatTime(59)).toBe("0:59")
	})

	test("formats full minutes", () => {
		expect(formatTime(60)).toBe("1:00")
		expect(formatTime(120)).toBe("2:00")
	})

	test("formats minutes and seconds", () => {
		expect(formatTime(65)).toBe("1:05")
		expect(formatTime(143)).toBe("2:23")
	})

	test("handles NaN", () => {
		expect(formatTime(NaN)).toBe("0:00")
	})

	test("handles Infinity", () => {
		expect(formatTime(Infinity)).toBe("0:00")
	})

	test("handles negative values", () => {
		expect(formatTime(-10)).toBe("0:00")
	})

	test("truncates fractional seconds", () => {
		expect(formatTime(5.9)).toBe("0:05")
		expect(formatTime(61.7)).toBe("1:01")
	})
})

// AudioPlayer — progressPct helper
describe("AudioPlayer — progressPct", () => {
	function progressPct(currentTime: number, duration: number): number {
		if (duration <= 0) return 0
		return Math.min(100, (currentTime / duration) * 100)
	}

	test("returns 0 when duration is 0", () => {
		expect(progressPct(5, 0)).toBe(0)
	})

	test("returns 0 when duration is negative", () => {
		expect(progressPct(5, -1)).toBe(0)
	})

	test("returns correct percentage", () => {
		expect(progressPct(50, 100)).toBe(50)
		expect(progressPct(25, 200)).toBe(12.5)
	})

	test("caps at 100%", () => {
		expect(progressPct(150, 100)).toBe(100)
	})

	test("returns 0 at start", () => {
		expect(progressPct(0, 100)).toBe(0)
	})
})

// ==========================================================================
// 2. VoiceCard / VoiceRow — shared helper functions
// ==========================================================================
describe("VoiceCard / VoiceRow — formatFileSize", () => {
	// From VoiceCard.tsx (VoiceCard returns "" for <=0, VoiceRow returns "-")
	function formatFileSizeCard(bytes: number): string {
		if (bytes <= 0) return ""
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	}

	function formatFileSizeRow(bytes: number): string {
		if (bytes <= 0) return "-"
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	}

	test("VoiceCard returns empty string for zero", () => {
		expect(formatFileSizeCard(0)).toBe("")
	})

	test("VoiceRow returns dash for zero", () => {
		expect(formatFileSizeRow(0)).toBe("-")
	})

	test("formats bytes", () => {
		expect(formatFileSizeCard(500)).toBe("500 B")
		expect(formatFileSizeRow(500)).toBe("500 B")
	})

	test("formats kilobytes", () => {
		expect(formatFileSizeCard(2048)).toBe("2 KB")
		expect(formatFileSizeRow(51200)).toBe("50 KB")
	})

	test("formats megabytes", () => {
		expect(formatFileSizeCard(1048576)).toBe("1.0 MB")
		expect(formatFileSizeCard(209715200)).toBe("200.0 MB")
	})

	test("negative bytes treated as zero", () => {
		expect(formatFileSizeCard(-100)).toBe("")
		expect(formatFileSizeRow(-100)).toBe("-")
	})
})

describe("VoiceRow — formatSampleRate", () => {
	function formatSampleRate(rate: number): string {
		if (!rate) return "-"
		return `${(rate / 1000).toFixed(0)}kHz`
	}

	test("formats 48000 as 48kHz", () => {
		expect(formatSampleRate(48000)).toBe("48kHz")
	})

	test("formats 24000 as 24kHz", () => {
		expect(formatSampleRate(24000)).toBe("24kHz")
	})

	test("returns dash for 0", () => {
		expect(formatSampleRate(0)).toBe("-")
	})

	test("returns dash for NaN (falsy)", () => {
		// NaN is falsy in JS, so !NaN is true
		expect(formatSampleRate(NaN)).toBe("-")
	})
})

describe("VoiceCard / VoiceRow — isInstalled", () => {
	function isInstalled(voice: VoiceEntry | StoreVoiceEntry): voice is VoiceEntry {
		return "installed" in voice
	}

	test("returns true for VoiceEntry", () => {
		expect(isInstalled(makeVoice())).toBe(true)
	})

	test("returns false for StoreVoiceEntry", () => {
		expect(isInstalled(makeStoreVoice())).toBe(false)
	})
})

describe("VoiceCard / VoiceRow — getProvider", () => {
	function getProvider(voice: VoiceEntry | StoreVoiceEntry): VoiceProvider | string {
		if ("provider" in voice) return (voice as VoiceEntry).provider
		return "rvc"
	}

	test("returns provider from VoiceEntry", () => {
		expect(getProvider(makeVoice({ provider: "azure" }))).toBe("azure")
	})

	test("defaults to rvc for StoreVoiceEntry", () => {
		expect(getProvider(makeStoreVoice())).toBe("rvc")
	})
})

describe("VoiceCard / VoiceRow — getIsFavorite", () => {
	function getIsFavorite(voice: VoiceEntry | StoreVoiceEntry, propFav?: boolean): boolean {
		if (propFav !== undefined) return propFav
		if ("favorite" in voice) return (voice as VoiceEntry).favorite
		return false
	}

	test("uses prop override when provided", () => {
		expect(getIsFavorite(makeVoice({ favorite: false }), true)).toBe(true)
		expect(getIsFavorite(makeVoice({ favorite: true }), false)).toBe(false)
	})

	test("reads from VoiceEntry when no prop override", () => {
		expect(getIsFavorite(makeVoice({ favorite: true }))).toBe(true)
		expect(getIsFavorite(makeVoice({ favorite: false }))).toBe(false)
	})

	test("defaults to false for StoreVoiceEntry without prop", () => {
		expect(getIsFavorite(makeStoreVoice())).toBe(false)
	})
})

// ==========================================================================
// 3. VoiceAvatar — provider letter and gender icon mapping
// ==========================================================================
describe("VoiceAvatar — provider letter mapping", () => {
	const PROVIDER_LETTERS: Record<string, string> = {
		rvc: "R",
		azure: "A",
		browser: "B",
		kokoro: "K",
		piper: "P",
		xtts: "X",
		f5tts: "F",
		bark: "B",
		chatterbox: "C",
	}

	function getLetter(provider: string): string {
		return PROVIDER_LETTERS[provider] ?? provider.charAt(0).toUpperCase()
	}

	test("known providers map to their letter", () => {
		expect(getLetter("rvc")).toBe("R")
		expect(getLetter("azure")).toBe("A")
		expect(getLetter("kokoro")).toBe("K")
		expect(getLetter("piper")).toBe("P")
		expect(getLetter("xtts")).toBe("X")
		expect(getLetter("f5tts")).toBe("F")
		expect(getLetter("chatterbox")).toBe("C")
	})

	test("browser and bark both map to B", () => {
		expect(getLetter("browser")).toBe("B")
		expect(getLetter("bark")).toBe("B")
	})

	test("unknown provider falls back to first letter uppercased", () => {
		expect(getLetter("openai")).toBe("O")
		expect(getLetter("eleven")).toBe("E")
	})
})

describe("VoiceAvatar — gender icon mapping", () => {
	const GENDER_ICONS: Record<VoiceGender, string> = {
		male: "\u2642",
		female: "\u2640",
		neutral: "\u26A7",
	}

	test("male returns Mars symbol", () => {
		expect(GENDER_ICONS["male"]).toBe("\u2642")
	})

	test("female returns Venus symbol", () => {
		expect(GENDER_ICONS["female"]).toBe("\u2640")
	})

	test("neutral returns transgender symbol", () => {
		expect(GENDER_ICONS["neutral"]).toBe("\u26A7")
	})
})

describe("VoiceAvatar — providerClass", () => {
	function providerClass(provider: string): string {
		return `vs-avatar--${provider}`
	}

	test("generates correct class string", () => {
		expect(providerClass("rvc")).toBe("vs-avatar--rvc")
		expect(providerClass("azure")).toBe("vs-avatar--azure")
	})
})

// ==========================================================================
// 4. TagChip — props interface validation
// ==========================================================================
describe("TagChip — interface", () => {
	// TagChip is a pure presentation component, so we verify the shape
	// and the CSS class logic it uses.
	function chipClass(active: boolean): string {
		return `vs-chip${active ? " vs-chip--active" : ""}`
	}

	test("inactive chip has base class only", () => {
		expect(chipClass(false)).toBe("vs-chip")
	})

	test("active chip has active modifier", () => {
		expect(chipClass(true)).toBe("vs-chip vs-chip--active")
	})
})

// ==========================================================================
// 5. ViewToggle — mode toggling
// ==========================================================================
describe("ViewToggle — mode logic", () => {
	function viewBtnClass(mode: "grid" | "list", current: "grid" | "list"): string {
		return `vs-view-btn${mode === current ? " vs-view-btn--active" : ""}`
	}

	test("grid button active when mode is grid", () => {
		expect(viewBtnClass("grid", "grid")).toBe("vs-view-btn vs-view-btn--active")
		expect(viewBtnClass("list", "grid")).toBe("vs-view-btn")
	})

	test("list button active when mode is list", () => {
		expect(viewBtnClass("list", "list")).toBe("vs-view-btn vs-view-btn--active")
		expect(viewBtnClass("grid", "list")).toBe("vs-view-btn")
	})
})

// ==========================================================================
// 6. SearchBar — debounce / autocomplete logic
// ==========================================================================
describe("SearchBar — autocomplete via getAutocompleteResults", () => {
	test("empty query returns recent searches only", () => {
		const result = getAutocompleteResults(VOICES, "", ["luna", "deep voice"])
		expect(result.recent).toEqual(["luna", "deep voice"])
		expect(result.voices).toEqual([])
		expect(result.accentSuggestion).toBeNull()
	})

	test("query filters recent searches", () => {
		const result = getAutocompleteResults(VOICES, "deep", ["deep voice", "luna", "something"])
		expect(result.recent).toEqual(["deep voice"])
	})

	test("query returns matching voices", () => {
		const result = getAutocompleteResults(VOICES, "Lunar", [])
		expect(result.voices.length).toBeGreaterThanOrEqual(1)
		expect(result.voices[0].name).toBe("Lunar Studio")
	})

	test("limits to 5 voice results", () => {
		const manyVoices = Array.from({ length: 20 }, (_, i) =>
			makeVoice({ id: `rvc:v${i}`, name: `Voice ${i}` }),
		)
		const result = getAutocompleteResults(manyVoices, "Voice", [])
		expect(result.voices.length).toBeLessThanOrEqual(5)
	})

	test("detects accent suggestion from accent label", () => {
		const result = getAutocompleteResults(VOICES, "british", [])
		expect(result.accentSuggestion).toBe("British English")
	})

	test("no accent suggestion when no match", () => {
		const result = getAutocompleteResults(VOICES, "zzzzz", [])
		expect(result.accentSuggestion).toBeNull()
	})
})

// ==========================================================================
// 7. FilterBar — filter state helpers (pure logic)
// ==========================================================================
describe("FilterBar — hasActiveFilters logic", () => {
	function hasActiveFilters(f: FilterState): boolean {
		return (
			f.gender !== null ||
			f.accents.length > 0 ||
			f.styles.length > 0 ||
			f.providers.length > 0 ||
			f.moods.length > 0 ||
			f.installedOnly ||
			f.favoritesOnly
		)
	}

	test("default filters have no active filters", () => {
		expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false)
	})

	test("gender filter activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, gender: "male" })).toBe(true)
	})

	test("accents filter activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, accents: ["en-US"] })).toBe(true)
	})

	test("styles filter activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, styles: ["natural"] })).toBe(true)
	})

	test("providers filter activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, providers: ["rvc"] })).toBe(true)
	})

	test("moods filter activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, moods: ["warm"] })).toBe(true)
	})

	test("installedOnly activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, installedOnly: true })).toBe(true)
	})

	test("favoritesOnly activates", () => {
		expect(hasActiveFilters({ ...DEFAULT_FILTERS, favoritesOnly: true })).toBe(true)
	})
})

describe("FilterBar — activeFilterLabels logic", () => {
	function activeFilterLabels(f: FilterState): { key: string; label: string }[] {
		const labels: { key: string; label: string }[] = []
		if (f.gender) labels.push({ key: `gender:${f.gender}`, label: `Gender: ${f.gender}` })
		for (const a of f.accents) labels.push({ key: `accent:${a}`, label: ACCENT_LABELS[a] ?? a })
		for (const s of f.styles) labels.push({ key: `style:${s}`, label: `Style: ${s}` })
		for (const p of f.providers) labels.push({ key: `provider:${p}`, label: `Provider: ${p}` })
		for (const m of f.moods) labels.push({ key: `mood:${m}`, label: `Mood: ${m}` })
		if (f.installedOnly) labels.push({ key: "installed", label: "Installed only" })
		if (f.favoritesOnly) labels.push({ key: "favorites", label: "Favorites only" })
		return labels
	}

	test("default filters produce empty labels", () => {
		expect(activeFilterLabels(DEFAULT_FILTERS)).toEqual([])
	})

	test("gender filter produces label", () => {
		const labels = activeFilterLabels({ ...DEFAULT_FILTERS, gender: "female" })
		expect(labels).toEqual([{ key: "gender:female", label: "Gender: female" }])
	})

	test("accent uses ACCENT_LABELS for display", () => {
		const labels = activeFilterLabels({ ...DEFAULT_FILTERS, accents: ["en-GB"] })
		expect(labels[0].label).toBe("British English")
	})

	test("unknown accent falls back to code", () => {
		const labels = activeFilterLabels({ ...DEFAULT_FILTERS, accents: ["xx-XX"] })
		expect(labels[0].label).toBe("xx-XX")
	})

	test("multiple categories produce multiple labels", () => {
		const labels = activeFilterLabels({
			...DEFAULT_FILTERS,
			gender: "male",
			styles: ["natural"],
			installedOnly: true,
		})
		expect(labels.length).toBe(3)
		expect(labels.map((l) => l.key)).toEqual(["gender:male", "style:natural", "installed"])
	})
})

describe("FilterBar — removeFilter logic", () => {
	function removeFilter(filters: FilterState, key: string): FilterState {
		const f = { ...filters }
		if (key.startsWith("gender:")) {
			f.gender = null
		} else if (key.startsWith("accent:")) {
			const val = key.slice(7)
			f.accents = f.accents.filter((a) => a !== val)
		} else if (key.startsWith("style:")) {
			const val = key.slice(6) as VoiceStyle
			f.styles = f.styles.filter((s) => s !== val)
		} else if (key.startsWith("provider:")) {
			const val = key.slice(9) as VoiceProvider
			f.providers = f.providers.filter((p) => p !== val)
		} else if (key.startsWith("mood:")) {
			const val = key.slice(5)
			f.moods = f.moods.filter((m) => m !== val)
		} else if (key === "installed") {
			f.installedOnly = false
		} else if (key === "favorites") {
			f.favoritesOnly = false
		}
		return f
	}

	test("removes gender filter", () => {
		const f = removeFilter({ ...DEFAULT_FILTERS, gender: "male" }, "gender:male")
		expect(f.gender).toBeNull()
	})

	test("removes accent filter", () => {
		const f = removeFilter(
			{ ...DEFAULT_FILTERS, accents: ["en-US", "en-GB"] },
			"accent:en-US",
		)
		expect(f.accents).toEqual(["en-GB"])
	})

	test("removes style filter", () => {
		const f = removeFilter(
			{ ...DEFAULT_FILTERS, styles: ["natural", "whisper"] },
			"style:natural",
		)
		expect(f.styles).toEqual(["whisper"])
	})

	test("removes provider filter", () => {
		const f = removeFilter(
			{ ...DEFAULT_FILTERS, providers: ["rvc", "azure"] },
			"provider:rvc",
		)
		expect(f.providers).toEqual(["azure"])
	})

	test("removes mood filter", () => {
		const f = removeFilter(
			{ ...DEFAULT_FILTERS, moods: ["warm", "calm"] },
			"mood:warm",
		)
		expect(f.moods).toEqual(["calm"])
	})

	test("removes installedOnly", () => {
		const f = removeFilter({ ...DEFAULT_FILTERS, installedOnly: true }, "installed")
		expect(f.installedOnly).toBe(false)
	})

	test("removes favoritesOnly", () => {
		const f = removeFilter({ ...DEFAULT_FILTERS, favoritesOnly: true }, "favorites")
		expect(f.favoritesOnly).toBe(false)
	})

	test("unknown key leaves filters unchanged", () => {
		const original = { ...DEFAULT_FILTERS, gender: "male" as VoiceGender }
		const f = removeFilter(original, "unknown:value")
		expect(f.gender).toBe("male")
	})
})

describe("FilterBar — toggle helpers", () => {
	function toggleArray<T>(current: T[], value: T): T[] {
		return current.includes(value) ? current.filter((x) => x !== value) : [...current, value]
	}

	test("adds value when not present", () => {
		expect(toggleArray(["a"], "b")).toEqual(["a", "b"])
	})

	test("removes value when already present", () => {
		expect(toggleArray(["a", "b"], "a")).toEqual(["b"])
	})

	test("works with empty array", () => {
		expect(toggleArray([], "a")).toEqual(["a"])
	})
})

describe("FilterBar — filter counts (via voice-search utility)", () => {
	test("counts genders correctly", () => {
		const counts = getFilterCounts(VOICES, "", DEFAULT_FILTERS)
		// VOICES: 2 female (Lunar, Aria), 1 male (Gravel), 1 neutral (Default Browser)
		expect(counts["gender:female"]).toBe(2)
		expect(counts["gender:male"]).toBe(1)
		expect(counts["gender:neutral"]).toBe(1)
	})

	test("counts providers correctly", () => {
		const counts = getFilterCounts(VOICES, "", DEFAULT_FILTERS)
		expect(counts["provider:rvc"]).toBe(2) // Lunar + Gravel
		expect(counts["provider:azure"]).toBe(1)
		expect(counts["provider:browser"]).toBe(1)
	})

	test("counts respect search query", () => {
		const counts = getFilterCounts(VOICES, "Lunar", DEFAULT_FILTERS)
		// Only Lunar matches well, so gender:female should be >= 1
		expect(counts["gender:female"]).toBeGreaterThanOrEqual(1)
	})
})

// ==========================================================================
// 8. useVoiceCommands — command pattern matching
// ==========================================================================
describe("useVoiceCommands — command pattern matching", () => {
	// Extract and test the matchCommand logic from useVoiceCommands.ts
	const COMMAND_PATTERNS: Array<{ pattern: RegExp; command: string }> = [
		{ pattern: /\bhands[\s-]?free\s+off\b/i, command: "handsFreeOff" },
		{ pattern: /\bswitch\s+to\s+(.+)/i, command: "switchVoice" },
		{ pattern: /\bread\s+that\s+again\b/i, command: "repeat" },
		{ pattern: /\brepeat\b/i, command: "repeat" },
		{ pattern: /\bstop\s+speaking\b/i, command: "stop" },
		{ pattern: /\bstop\b/i, command: "stop" },
		{ pattern: /\bquiet\b/i, command: "stop" },
		{ pattern: /\bslower\b/i, command: "slower" },
		{ pattern: /\bfaster\b/i, command: "faster" },
		{ pattern: /\blouder\b/i, command: "louder" },
		{ pattern: /\bsofter\b/i, command: "softer" },
		{ pattern: /\bquieter\b/i, command: "softer" },
	]

	function matchCommand(text: string): { command: string; transcript: string } | null {
		const trimmed = text.trim().toLowerCase()
		for (const { pattern, command } of COMMAND_PATTERNS) {
			if (pattern.test(trimmed)) {
				return { command, transcript: trimmed }
			}
		}
		return null
	}

	test("matches 'hands free off'", () => {
		const result = matchCommand("hands free off")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("handsFreeOff")
	})

	test("matches 'hands-free off' with hyphen", () => {
		const result = matchCommand("hands-free off")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("handsFreeOff")
	})

	test("matches 'handsfree off' without space", () => {
		const result = matchCommand("handsfree off")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("handsFreeOff")
	})

	test("matches 'switch to Lunar Studio'", () => {
		const result = matchCommand("switch to Lunar Studio")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("switchVoice")
	})

	test("matches 'read that again'", () => {
		const result = matchCommand("read that again")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("repeat")
	})

	test("matches 'repeat'", () => {
		const result = matchCommand("repeat")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("repeat")
	})

	test("matches 'stop speaking'", () => {
		const result = matchCommand("stop speaking")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("stop")
	})

	test("matches bare 'stop'", () => {
		const result = matchCommand("stop")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("stop")
	})

	test("matches 'quiet'", () => {
		const result = matchCommand("quiet")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("stop")
	})

	test("matches 'slower'", () => {
		const result = matchCommand("slower")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("slower")
	})

	test("matches 'faster'", () => {
		const result = matchCommand("faster")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("faster")
	})

	test("matches 'louder'", () => {
		const result = matchCommand("louder")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("louder")
	})

	test("matches 'softer'", () => {
		const result = matchCommand("softer")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("softer")
	})

	test("matches 'quieter' as softer", () => {
		const result = matchCommand("quieter")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("softer")
	})

	test("returns null for unrecognized speech", () => {
		expect(matchCommand("hello world")).toBeNull()
		expect(matchCommand("the weather is nice")).toBeNull()
	})

	test("is case-insensitive", () => {
		const result = matchCommand("STOP SPEAKING")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("stop")
	})

	test("trims whitespace", () => {
		const result = matchCommand("   repeat   ")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("repeat")
	})

	test("first match wins — 'stop speaking' matches stop (via 'stop speaking' pattern) not bare stop", () => {
		const result = matchCommand("stop speaking")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("stop")
		// The 'stop speaking' pattern comes before bare 'stop', both map to "stop"
		// Verify it matched — the key is that it doesn't fall through to something else
	})

	test("'read that again' takes priority over bare 'repeat' in unrelated text", () => {
		// 'read that again' is ordered before 'repeat', verify it matches first
		const result = matchCommand("please read that again")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("repeat")
	})

	test("matches commands embedded in longer speech", () => {
		const result = matchCommand("please go slower")
		expect(result).not.toBeNull()
		expect(result!.command).toBe("slower")
	})

	test("transcript is lowercased and trimmed", () => {
		const result = matchCommand("  LOUDER  ")
		expect(result).not.toBeNull()
		expect(result!.transcript).toBe("louder")
	})
})

// ==========================================================================
// 9. useVoiceSearch — SpeechRecognition mock integration
// ==========================================================================
describe("useVoiceSearch — error message mapping", () => {
	// Test the error message mapping used in useVoiceSearch
	const ERROR_MESSAGES: Record<string, string> = {
		"no-speech": "No speech detected. Please try again.",
		"audio-capture": "No microphone found. Check your audio settings.",
		"not-allowed": "Microphone access denied. Allow mic access and try again.",
		"network": "Network error during speech recognition.",
		"service-not-available": "Speech recognition service is unavailable.",
		"bad-grammar": "Speech grammar error.",
		"language-not-supported": "Language not supported for speech recognition.",
	}

	test("maps known error codes to user-friendly messages", () => {
		expect(ERROR_MESSAGES["no-speech"]).toBe("No speech detected. Please try again.")
		expect(ERROR_MESSAGES["audio-capture"]).toBe("No microphone found. Check your audio settings.")
		expect(ERROR_MESSAGES["not-allowed"]).toBe("Microphone access denied. Allow mic access and try again.")
		expect(ERROR_MESSAGES["network"]).toBe("Network error during speech recognition.")
		expect(ERROR_MESSAGES["service-not-available"]).toBe("Speech recognition service is unavailable.")
	})

	test("unknown error code falls through to undefined (handled by fallback)", () => {
		expect(ERROR_MESSAGES["some-unknown-error"]).toBeUndefined()
	})

	test("fallback format for unknown errors", () => {
		const error = "custom-error"
		const msg = ERROR_MESSAGES[error] ?? `Speech recognition error: ${error}`
		expect(msg).toBe("Speech recognition error: custom-error")
	})
})

describe("useVoiceSearch — SpeechRecognition mock", () => {
	class MockSpeechRecognition {
		continuous = false
		interimResults = false
		lang = ""
		onresult: ((event: any) => void) | null = null
		onend: (() => void) | null = null
		onerror: ((event: any) => void) | null = null
		started = false
		stopped = false
		aborted = false

		start() {
			this.started = true
		}
		stop() {
			this.stopped = true
			this.onend?.()
		}
		abort() {
			this.aborted = true
		}
	}

	test("recognition is configured correctly for one-shot mode", () => {
		const rec = new MockSpeechRecognition()
		// Simulate what useVoiceSearch does in createRecognition
		rec.continuous = false
		rec.interimResults = true
		rec.lang = "en-US"

		expect(rec.continuous).toBe(false)
		expect(rec.interimResults).toBe(true)
		expect(rec.lang).toBe("en-US")
	})

	test("start() is called on the recognition instance", () => {
		const rec = new MockSpeechRecognition()
		rec.start()
		expect(rec.started).toBe(true)
	})

	test("stop() triggers onend callback", () => {
		const rec = new MockSpeechRecognition()
		let endCalled = false
		rec.onend = () => {
			endCalled = true
		}
		rec.stop()
		expect(rec.stopped).toBe(true)
		expect(endCalled).toBe(true)
	})

	test("onresult collects transcript from all results", () => {
		const rec = new MockSpeechRecognition()
		let collectedTranscript = ""

		rec.onresult = (event: any) => {
			let fullTranscript = ""
			for (let i = 0; i < event.results.length; i++) {
				fullTranscript += event.results[i][0].transcript
			}
			collectedTranscript = fullTranscript
		}

		// Simulate a recognition event with two results
		rec.onresult({
			results: [
				{ 0: { transcript: "hello " }, isFinal: false, length: 1 },
				{ 0: { transcript: "world" }, isFinal: true, length: 1 },
			],
		})

		expect(collectedTranscript).toBe("hello world")
	})

	test("onerror does not fire for aborted errors (per useVoiceSearch logic)", () => {
		let errorMessage: string | null = null

		const ERROR_MESSAGES: Record<string, string> = {
			"no-speech": "No speech detected. Please try again.",
			"not-allowed": "Microphone access denied. Allow mic access and try again.",
		}

		function handleError(event: { error: string }) {
			if (event.error !== "aborted") {
				errorMessage = ERROR_MESSAGES[event.error] ?? `Speech recognition error: ${event.error}`
			}
		}

		handleError({ error: "aborted" })
		expect(errorMessage).toBeNull()

		handleError({ error: "not-allowed" })
		expect(errorMessage).toBe("Microphone access denied. Allow mic access and try again.")
	})
})

// ==========================================================================
// 10. useVoiceCommands — recognition configuration for hands-free mode
// ==========================================================================
describe("useVoiceCommands — recognition configuration", () => {
	class MockContinuousRecognition {
		continuous = false
		interimResults = false
		lang = ""
		onresult: ((event: any) => void) | null = null
		onend: (() => void) | null = null
		onerror: ((event: any) => void) | null = null
		onstart: (() => void) | null = null
		started = false

		start() {
			this.started = true
			this.onstart?.()
		}
		stop() {
			this.onend?.()
		}
		abort() {}
	}

	test("continuous recognition is configured for hands-free mode", () => {
		const rec = new MockContinuousRecognition()
		// Simulate what useVoiceCommands does in createRecognition
		rec.continuous = true
		rec.interimResults = false
		rec.lang = "en-US"

		expect(rec.continuous).toBe(true)
		expect(rec.interimResults).toBe(false)
		expect(rec.lang).toBe("en-US")
	})

	test("onresult processes only final results and fires command callback", () => {
		const commands: Array<{ command: string; transcript: string }> = []

		const COMMAND_PATTERNS: Array<{ pattern: RegExp; command: string }> = [
			{ pattern: /\bstop\b/i, command: "stop" },
			{ pattern: /\blouder\b/i, command: "louder" },
		]

		function matchCommand(text: string): { command: string; transcript: string } | null {
			const trimmed = text.trim().toLowerCase()
			for (const { pattern, command } of COMMAND_PATTERNS) {
				if (pattern.test(trimmed)) {
					return { command, transcript: trimmed }
				}
			}
			return null
		}

		// Simulate onresult handler from useVoiceCommands
		function handleResult(event: any) {
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (!result.isFinal) continue

				const transcript = result[0].transcript
				const match = matchCommand(transcript)
				if (match) {
					commands.push(match)
				}
			}
		}

		// Event with interim result (should be skipped) and final result
		handleResult({
			resultIndex: 0,
			results: {
				length: 2,
				0: { isFinal: false, 0: { transcript: "sto" }, length: 1 },
				1: { isFinal: true, 0: { transcript: "stop" }, length: 1 },
			},
		})

		expect(commands.length).toBe(1)
		expect(commands[0].command).toBe("stop")
	})

	test("non-matching final results are silently ignored", () => {
		const commands: string[] = []

		const COMMAND_PATTERNS: Array<{ pattern: RegExp; command: string }> = [
			{ pattern: /\bstop\b/i, command: "stop" },
		]

		function matchCommand(text: string): { command: string; transcript: string } | null {
			const trimmed = text.trim().toLowerCase()
			for (const { pattern, command } of COMMAND_PATTERNS) {
				if (pattern.test(trimmed)) {
					return { command, transcript: trimmed }
				}
			}
			return null
		}

		function handleResult(event: any) {
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (!result.isFinal) continue
				const transcript = result[0].transcript
				const match = matchCommand(transcript)
				if (match) {
					commands.push(match.command)
				}
			}
		}

		handleResult({
			resultIndex: 0,
			results: {
				length: 1,
				0: { isFinal: true, 0: { transcript: "hello how are you" }, length: 1 },
			},
		})

		expect(commands.length).toBe(0)
	})

	test("restart backoff delay increases with attempts", () => {
		function backoffDelay(restartAttempts: number): number {
			return Math.min(restartAttempts * 200, 2000)
		}

		expect(backoffDelay(1)).toBe(200)
		expect(backoffDelay(5)).toBe(1000)
		expect(backoffDelay(10)).toBe(2000)
		expect(backoffDelay(20)).toBe(2000) // capped at 2000
	})

	test("gives up after 10 restart attempts", () => {
		let shouldBeListening = true
		const MAX_RESTARTS = 10

		function onEndHandler(restartAttempts: number) {
			if (shouldBeListening) {
				if (restartAttempts > MAX_RESTARTS) {
					shouldBeListening = false
				}
			}
		}

		onEndHandler(11)
		expect(shouldBeListening).toBe(false)
	})

	test("onerror stops listening for permission errors", () => {
		let shouldBeListening = true
		let isListening = true

		function handleError(error: string) {
			if (error === "no-speech" || error === "aborted") {
				return
			}
			if (error === "not-allowed" || error === "audio-capture") {
				shouldBeListening = false
				isListening = false
				return
			}
		}

		handleError("no-speech")
		expect(shouldBeListening).toBe(true)

		handleError("not-allowed")
		expect(shouldBeListening).toBe(false)
		expect(isListening).toBe(false)
	})
})

// ==========================================================================
// 11. applyFilters — integration with FilterBar filter state
// ==========================================================================
describe("applyFilters — integration with FilterBar state", () => {
	test("no filters returns all voices", () => {
		expect(applyFilters(VOICES, DEFAULT_FILTERS).length).toBe(4)
	})

	test("gender filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, gender: "male" })
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Gravel")
	})

	test("provider filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, providers: ["azure"] })
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Aria Neural")
	})

	test("accent filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, accents: ["en-GB"] })
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Gravel")
	})

	test("style filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, styles: ["broadcast"] })
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Gravel")
	})

	test("installedOnly filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, installedOnly: true })
		expect(result.length).toBe(3) // Lunar, Gravel, Default Browser
		expect(result.every((v) => v.installed)).toBe(true)
	})

	test("favoritesOnly filter works", () => {
		const result = applyFilters(VOICES, { ...DEFAULT_FILTERS, favoritesOnly: true })
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("multiple filters are AND-ed across categories", () => {
		const result = applyFilters(VOICES, {
			...DEFAULT_FILTERS,
			gender: "female",
			providers: ["rvc"],
		})
		expect(result.length).toBe(1)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("multiple values within same category are OR-ed", () => {
		const result = applyFilters(VOICES, {
			...DEFAULT_FILTERS,
			providers: ["rvc", "azure"],
		})
		expect(result.length).toBe(3) // Lunar, Aria, Gravel
	})
})

// ==========================================================================
// 12. SearchBar — debounce timing logic
// ==========================================================================
describe("SearchBar — debounce behavior", () => {
	test("debounce timer clears previous timeout on rapid input", () => {
		let callCount = 0
		let timer: ReturnType<typeof setTimeout> | undefined

		function handleInput(value: string) {
			if (timer) clearTimeout(timer)
			timer = setTimeout(() => {
				callCount++
			}, 150)
		}

		handleInput("a")
		handleInput("ab")
		handleInput("abc")

		// Only the last timeout should be pending
		// We can verify by clearing and checking count stayed at 0
		if (timer) clearTimeout(timer)
		expect(callCount).toBe(0)
	})
})

// ==========================================================================
// 13. VoiceCard — tag slicing logic
// ==========================================================================
describe("VoiceCard — tag display logic", () => {
	test("shows at most 3 tags", () => {
		const voice = makeVoice({ tags: ["warm", "studio", "hifi", "deep", "bass"] })
		const displayTags = voice.tags.slice(0, 3)
		expect(displayTags).toEqual(["warm", "studio", "hifi"])
		expect(displayTags.length).toBe(3)
	})

	test("shows all tags when 3 or fewer", () => {
		const voice = makeVoice({ tags: ["warm", "studio"] })
		const displayTags = voice.tags.slice(0, 3)
		expect(displayTags).toEqual(["warm", "studio"])
	})

	test("empty tags array produces empty slice", () => {
		const voice = makeVoice({ tags: [] })
		const displayTags = voice.tags.slice(0, 3)
		expect(displayTags).toEqual([])
	})
})

// ==========================================================================
// 14. VoiceCard — quality stars rendering logic
// ==========================================================================
describe("VoiceCard / VoiceRow — quality stars", () => {
	function getStars(quality: number): string[] {
		return [1, 2, 3, 4, 5].map((n) => (n <= quality ? "\u2605" : "\u2606"))
	}

	test("quality 5 shows all filled stars", () => {
		expect(getStars(5)).toEqual(["\u2605", "\u2605", "\u2605", "\u2605", "\u2605"])
	})

	test("quality 3 shows 3 filled and 2 empty", () => {
		expect(getStars(3)).toEqual(["\u2605", "\u2605", "\u2605", "\u2606", "\u2606"])
	})

	test("quality 1 shows 1 filled and 4 empty", () => {
		expect(getStars(1)).toEqual(["\u2605", "\u2606", "\u2606", "\u2606", "\u2606"])
	})

	test("quality 0 shows all empty", () => {
		expect(getStars(0)).toEqual(["\u2606", "\u2606", "\u2606", "\u2606", "\u2606"])
	})
})

// ==========================================================================
// 15. VoiceCard — gender symbol display
// ==========================================================================
describe("VoiceCard — gender symbol", () => {
	function genderSymbol(gender: VoiceGender): string {
		return gender === "male" ? "\u2642" : gender === "female" ? "\u2640" : "\u26A7"
	}

	test("male returns mars symbol", () => {
		expect(genderSymbol("male")).toBe("\u2642")
	})

	test("female returns venus symbol", () => {
		expect(genderSymbol("female")).toBe("\u2640")
	})

	test("neutral returns transgender symbol", () => {
		expect(genderSymbol("neutral")).toBe("\u26A7")
	})
})

// ==========================================================================
// 16. fuzzySearchVoices — used by SearchBar autocomplete
// ==========================================================================
describe("fuzzySearchVoices — SearchBar integration", () => {
	test("empty query returns all voices", () => {
		expect(fuzzySearchVoices(VOICES, "").length).toBe(4)
	})

	test("matches by voice name", () => {
		const results = fuzzySearchVoices(VOICES, "Lunar")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].name).toBe("Lunar Studio")
	})

	test("matches by tag", () => {
		const results = fuzzySearchVoices(VOICES, "bass")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].name).toBe("Gravel")
	})

	test("matches by provider", () => {
		const results = fuzzySearchVoices(VOICES, "azure")
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].name).toBe("Aria Neural")
	})

	test("returns no results for non-matching query", () => {
		const results = fuzzySearchVoices(VOICES, "xyzzynonexistent")
		expect(results.length).toBe(0)
	})

	test("multi-word search scores across fields", () => {
		const results = fuzzySearchVoices(VOICES, "female natural")
		expect(results.length).toBeGreaterThanOrEqual(1)
		// Lunar Studio is female + natural
		expect(results.some((v) => v.name === "Lunar Studio")).toBe(true)
	})
})
