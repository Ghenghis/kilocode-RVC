import { describe, it, expect } from "bun:test"
import { DEFAULT_FILTERS, MOOD_MAPPINGS, ACCENT_LABELS } from "../../webview-ui/src/types/voice"

describe("Voice Types", () => {
	it("DEFAULT_FILTERS has all fields null/empty", () => {
		expect(DEFAULT_FILTERS.gender).toBeNull()
		expect(DEFAULT_FILTERS.accents).toEqual([])
		expect(DEFAULT_FILTERS.styles).toEqual([])
		expect(DEFAULT_FILTERS.providers).toEqual([])
		expect(DEFAULT_FILTERS.moods).toEqual([])
		expect(DEFAULT_FILTERS.installedOnly).toBe(false)
		expect(DEFAULT_FILTERS.favoritesOnly).toBe(false)
	})

	it("MOOD_MAPPINGS covers all 6 moods", () => {
		const moods = Object.keys(MOOD_MAPPINGS)
		expect(moods).toContain("warm")
		expect(moods).toContain("calm")
		expect(moods).toContain("bright")
		expect(moods).toContain("deep")
		expect(moods).toContain("robotic")
		expect(moods).toContain("professional")
		expect(moods.length).toBe(6)
	})

	it("ACCENT_LABELS maps all English variants", () => {
		expect(ACCENT_LABELS["en-US"]).toBe("American English")
		expect(ACCENT_LABELS["en-GB"]).toBe("British English")
		expect(ACCENT_LABELS["en-AU"]).toBe("Australian English")
	})

	it("each MOOD_MAPPING has required fields", () => {
		for (const [mood, mapping] of Object.entries(MOOD_MAPPINGS)) {
			expect(mapping.styles.length).toBeGreaterThan(0)
			expect(mapping.tags.length).toBeGreaterThan(0)
		}
	})
})
