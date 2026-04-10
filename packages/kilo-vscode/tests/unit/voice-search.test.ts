import { describe, test, expect } from "bun:test"
import {
	fuzzySearchVoices,
	applyFilters,
	combinedSearch,
	getFilterCounts,
	getAutocompleteResults,
} from "../../webview-ui/src/utils/voice-search"
import type { VoiceEntry, FilterState } from "../../webview-ui/src/types/voice"
import { DEFAULT_FILTERS } from "../../webview-ui/src/types/voice"

const MOCK_VOICES: VoiceEntry[] = [
	{
		id: "rvc:lunar-studio",
		provider: "rvc",
		name: "Lunar Studio",
		description: "High-fidelity neutral female studio voice",
		gender: "female",
		accent: "en-US",
		accentLabel: "American English",
		style: "natural",
		quality: 5,
		sampleRate: 48000,
		fileSize: 209715200,
		tags: ["warm", "studio", "hifi"],
		installed: true,
		favorite: true,
	},
	{
		id: "azure:en-US-AriaNeural",
		provider: "azure",
		name: "Aria Neural",
		description: "Expressive American female",
		gender: "female",
		accent: "en-US",
		accentLabel: "American English",
		style: "expressive",
		quality: 5,
		sampleRate: 24000,
		fileSize: 0,
		tags: ["expressive", "versatile"],
		installed: true,
		favorite: false,
	},
	{
		id: "rvc:elvis-presley",
		provider: "rvc",
		name: "Elvis Presley",
		description: "Iconic American crooner",
		gender: "male",
		accent: "en-US",
		accentLabel: "American English",
		style: "singing",
		quality: 4,
		sampleRate: 40000,
		fileSize: 58720256,
		tags: ["classic", "crooner", "deep"],
		installed: true,
		favorite: false,
	},
	{
		id: "piper:en-GB-alba",
		provider: "piper",
		name: "Alba",
		description: "British English female",
		gender: "female",
		accent: "en-GB",
		accentLabel: "British English",
		style: "natural",
		quality: 4,
		sampleRate: 22050,
		fileSize: 47185920,
		tags: ["british", "clear"],
		installed: true,
		favorite: false,
	},
	{
		id: "rvc:dectalk",
		provider: "rvc",
		name: "DecTalk",
		description: "Classic robotic synthesizer voice",
		gender: "neutral",
		accent: "en-US",
		accentLabel: "American English",
		style: "broadcast",
		quality: 2,
		sampleRate: 16000,
		fileSize: 22937600,
		tags: ["robotic", "retro", "synth"],
		installed: false,
		favorite: false,
	},
]

describe("fuzzySearchVoices", () => {
	test("empty query returns all voices", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "")
		expect(result).toHaveLength(MOCK_VOICES.length)
	})

	test("whitespace-only query returns all voices", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "   ")
		expect(result).toHaveLength(MOCK_VOICES.length)
	})

	test("name match ranks highest", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "Lunar")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("tag match returns relevant voices", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "warm")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("description match returns relevant voices", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "crooner")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Elvis Presley")
	})

	test("accent label match returns relevant voices", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "British")
		expect(result.length).toBeGreaterThan(0)
		// Alba has "British English" accent label and "british" tag
		expect(result[0].name).toBe("Alba")
	})

	test("case insensitive matching", () => {
		const result1 = fuzzySearchVoices(MOCK_VOICES, "ELVIS")
		const result2 = fuzzySearchVoices(MOCK_VOICES, "elvis")
		const result3 = fuzzySearchVoices(MOCK_VOICES, "Elvis")
		expect(result1.length).toBeGreaterThan(0)
		expect(result2.length).toBeGreaterThan(0)
		expect(result3.length).toBeGreaterThan(0)
		expect(result1[0].id).toBe(result2[0].id)
		expect(result2[0].id).toBe(result3[0].id)
	})

	test("multi-word query scores each term", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "Lunar studio")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("no matches returns empty array", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "zzzznonexistent")
		expect(result).toHaveLength(0)
	})

	test("provider match works", () => {
		const result = fuzzySearchVoices(MOCK_VOICES, "piper")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Alba")
	})
})

describe("applyFilters", () => {
	test("default filters return all voices", () => {
		const result = applyFilters(MOCK_VOICES, DEFAULT_FILTERS)
		expect(result).toHaveLength(MOCK_VOICES.length)
	})

	test("gender filter", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female" }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result.every((v) => v.gender === "female")).toBe(true)
		expect(result).toHaveLength(3) // Lunar Studio, Aria Neural, Alba
	})

	test("gender filter male", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, gender: "male" }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe("Elvis Presley")
	})

	test("single accent filter (OR within)", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, accents: ["en-GB"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe("Alba")
	})

	test("multiple accents filter (OR within)", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, accents: ["en-US", "en-GB"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(5) // all voices have en-US or en-GB
	})

	test("provider filter", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, providers: ["rvc"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(3) // Lunar Studio, Elvis, DecTalk
		expect(result.every((v) => v.provider === "rvc")).toBe(true)
	})

	test("style filter", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, styles: ["natural"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(2) // Lunar Studio, Alba
		expect(result.every((v) => v.style === "natural")).toBe(true)
	})

	test("favorites only", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, favoritesOnly: true }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("installed only", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, installedOnly: true }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(4) // all except DecTalk
		expect(result.every((v) => v.installed)).toBe(true)
	})

	test("combined AND filters: gender + provider", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female", providers: ["rvc"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe("Lunar Studio")
	})

	test("combined AND filters: installed + accent", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, installedOnly: true, accents: ["en-GB"] }
		const result = applyFilters(MOCK_VOICES, filters)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe("Alba")
	})
})

describe("combinedSearch", () => {
	test("search + filters work together", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female" }
		const result = combinedSearch(MOCK_VOICES, "studio", filters)
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("Lunar Studio")
		expect(result.every((v) => v.gender === "female")).toBe(true)
	})

	test("mood filter: robotic", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, moods: ["robotic"] }
		const result = combinedSearch(MOCK_VOICES, "", filters)
		// DecTalk has style "broadcast" (in robotic styles) and tags "robotic", "synth" (in robotic tags)
		expect(result.length).toBeGreaterThan(0)
		expect(result.some((v) => v.name === "DecTalk")).toBe(true)
	})

	test("mood filter: warm", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, moods: ["warm"] }
		const result = combinedSearch(MOCK_VOICES, "", filters)
		// Lunar Studio has style "natural" (in warm styles) and tag "warm" (in warm tags)
		expect(result.some((v) => v.name === "Lunar Studio")).toBe(true)
	})

	test("mood filter: deep requires male gender", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, moods: ["deep"] }
		const result = combinedSearch(MOCK_VOICES, "", filters)
		// Elvis has tag "deep" and is male
		expect(result.some((v) => v.name === "Elvis Presley")).toBe(true)
		// Females/neutrals should not match even if they have matching style
		expect(result.every((v) => v.gender === "male")).toBe(true)
	})

	test("mood filter: professional requires minQuality 4", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, moods: ["professional"] }
		const result = combinedSearch(MOCK_VOICES, "", filters)
		// Lunar Studio has style "natural", tag "studio", quality 5
		expect(result.some((v) => v.name === "Lunar Studio")).toBe(true)
		// DecTalk has quality 2, should not match even though it might have style match
		expect(result.every((v) => v.quality >= 4)).toBe(true)
	})

	test("empty search + default filters returns all", () => {
		const result = combinedSearch(MOCK_VOICES, "", DEFAULT_FILTERS)
		expect(result).toHaveLength(MOCK_VOICES.length)
	})
})

describe("getFilterCounts", () => {
	test("returns counts for gender", () => {
		const counts = getFilterCounts(MOCK_VOICES, "", DEFAULT_FILTERS)
		expect(counts["gender:female"]).toBe(3)
		expect(counts["gender:male"]).toBe(1)
		expect(counts["gender:neutral"]).toBe(1)
	})

	test("returns counts for providers", () => {
		const counts = getFilterCounts(MOCK_VOICES, "", DEFAULT_FILTERS)
		expect(counts["provider:rvc"]).toBe(3)
		expect(counts["provider:azure"]).toBe(1)
		expect(counts["provider:piper"]).toBe(1)
	})

	test("returns counts for accents", () => {
		const counts = getFilterCounts(MOCK_VOICES, "", DEFAULT_FILTERS)
		expect(counts["accent:en-US"]).toBe(4)
		expect(counts["accent:en-GB"]).toBe(1)
	})

	test("returns installed and favorites counts", () => {
		const counts = getFilterCounts(MOCK_VOICES, "", DEFAULT_FILTERS)
		expect(counts["installed:true"]).toBe(4)
		expect(counts["favorites:true"]).toBe(1)
	})

	test("counts update with search query", () => {
		const counts = getFilterCounts(MOCK_VOICES, "Elvis", DEFAULT_FILTERS)
		expect(counts["gender:male"]).toBe(1)
		expect(counts["gender:female"]).toBe(0)
	})

	test("counts update with active filters", () => {
		const filters: FilterState = { ...DEFAULT_FILTERS, gender: "female" }
		const counts = getFilterCounts(MOCK_VOICES, "", filters)
		// Provider counts should reflect the gender filter
		expect(counts["provider:rvc"]).toBe(1) // only Lunar Studio is female + rvc
	})
})

describe("getAutocompleteResults", () => {
	test("empty query returns recent searches", () => {
		const recent = ["warm voices", "deep male"]
		const result = getAutocompleteResults(MOCK_VOICES, "", recent)
		expect(result.recent).toEqual(["warm voices", "deep male"])
		expect(result.voices).toHaveLength(0)
		expect(result.accentSuggestion).toBeNull()
	})

	test("query returns matching voices", () => {
		const result = getAutocompleteResults(MOCK_VOICES, "lunar", [])
		expect(result.voices.length).toBeGreaterThan(0)
		expect(result.voices[0].name).toBe("Lunar Studio")
	})

	test("query returns matching recent searches", () => {
		const recent = ["warm studio", "deep male", "british accent"]
		const result = getAutocompleteResults(MOCK_VOICES, "warm", recent)
		expect(result.recent).toContain("warm studio")
		expect(result.recent).not.toContain("deep male")
	})

	test("accent query returns accent suggestion", () => {
		const result = getAutocompleteResults(MOCK_VOICES, "british", [])
		expect(result.accentSuggestion).toBe("British English")
	})

	test("limits voices to 5", () => {
		const result = getAutocompleteResults(MOCK_VOICES, "en", [])
		expect(result.voices.length).toBeLessThanOrEqual(5)
	})

	test("limits recent to 5 for empty query", () => {
		const recent = ["a", "b", "c", "d", "e", "f", "g"]
		const result = getAutocompleteResults(MOCK_VOICES, "", recent)
		expect(result.recent).toHaveLength(5)
	})
})
