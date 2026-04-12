import type { VoiceEntry, FilterState, VoiceGender, VoiceStyle, VoiceQuality } from "../types/voice"
import { MOOD_MAPPINGS } from "../types/voice"
// kilocode_change — Phase 5.3/5.4: Smart Search + Index Management
import { AcousticModelIndex } from "./acoustic-model-index"
import type { ModelIndex, ModelMetadata } from "./acoustic-model-index"

// kilocode_change — expose SortOrder so callers don't import acoustic-model-index directly
export type SortOrder = "recentlyUsed" | "mostUsed" | "alphabetical" | "size" | "quality"

/**
 * Compute a fuzzy match score for a single query term against a string.
 * Returns 0 for no match. Higher scores for earlier/better matches.
 */
function termScore(text: string, term: string): number {
	if (!text || !term) {
		return 0
	}
	const lowerText = text.toLowerCase()
	const lowerTerm = term.toLowerCase()

	// Exact full match
	if (lowerText === lowerTerm) {
		return 3
	}

	// Starts with
	if (lowerText.startsWith(lowerTerm)) {
		return 2.5
	}

	// Contains as substring
	const idx = lowerText.indexOf(lowerTerm)
	if (idx >= 0) {
		// Earlier matches score higher
		return 2 - idx * 0.01
	}

	// Word-boundary match (term matches start of any word)
	const words = lowerText.split(/\s+/)
	for (const word of words) {
		if (word.startsWith(lowerTerm)) {
			return 1.5
		}
	}

	return 0
}

/**
 * Score a single query term against all fields of a voice entry with weighting.
 */
function scoreTermAgainstVoice(voice: VoiceEntry, term: string): number {
	let score = 0

	// Name: 10x weight
	score += termScore(voice.name, term) * 10

	// Tags: 5x weight (check each tag)
	for (const tag of voice.tags) {
		score += termScore(tag, term) * 5
	}

	// Description: 2x weight
	score += termScore(voice.description, term) * 2

	// Other fields: 1x weight
	score += termScore(voice.accent, term)
	score += termScore(voice.accentLabel, term)
	score += termScore(voice.style, term)
	score += termScore(voice.gender, term)
	score += termScore(voice.provider, term)
	score += termScore(voice.id, term)

	return score
}

/**
 * Fuzzy search voices with weighted field matching.
 * Multi-word queries score each term independently and sum scores.
 * Empty query returns all voices.
 */
export function fuzzySearchVoices(voices: VoiceEntry[], query: string): VoiceEntry[] {
	const trimmed = query.trim()
	if (!trimmed) {
		return voices
	}

	const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean)

	const scored = voices
		.map((voice) => {
			let totalScore = 0
			for (const term of terms) {
				const s = scoreTermAgainstVoice(voice, term)
				if (s === 0) {
					// If any term has zero match, still allow partial matches
					// but penalize heavily
					totalScore -= 1
				} else {
					totalScore += s
				}
			}
			return { voice, score: totalScore }
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)

	return scored.map((entry) => entry.voice)
}

/**
 * Apply mood-based filtering using MOOD_MAPPINGS.
 * A voice matches a mood if it matches any of the mood's styles OR tags,
 * plus optional gender and minQuality constraints.
 */
function applyMoodFilters(voices: VoiceEntry[], moods: string[]): VoiceEntry[] {
	if (moods.length === 0) {
		return voices
	}

	return voices.filter((voice) => {
		// Voice must match ALL selected moods (AND between moods)
		return moods.every((mood) => {
			const mapping = MOOD_MAPPINGS[mood]
			if (!mapping) {
				return true
			}

			// Must match at least one style OR one tag
			const styleMatch = mapping.styles.some((s) => voice.style === s)
			const tagMatch = mapping.tags.some((t) => voice.tags.includes(t))

			if (!styleMatch && !tagMatch) {
				return false
			}

			// Optional gender constraint
			if (mapping.gender && voice.gender !== mapping.gender) {
				return false
			}

			// Optional minQuality constraint
			if (mapping.minQuality && voice.quality < mapping.minQuality) {
				return false
			}

			return true
		})
	})
}

/**
 * Apply filter state to a list of voices.
 * AND between categories, OR within same category.
 */
export function applyFilters(voices: VoiceEntry[], filters: FilterState): VoiceEntry[] {
	let result = voices

	// Gender filter (single value)
	if (filters.gender) {
		result = result.filter((v) => v.gender === filters.gender)
	}

	// Accents filter (OR within)
	if (filters.accents.length > 0) {
		result = result.filter((v) => filters.accents.includes(v.accent))
	}

	// Styles filter (OR within)
	if (filters.styles.length > 0) {
		result = result.filter((v) => filters.styles.includes(v.style))
	}

	// Providers filter (OR within)
	if (filters.providers.length > 0) {
		result = result.filter((v) => filters.providers.includes(v.provider))
	}

	// Installed only
	if (filters.installedOnly) {
		result = result.filter((v) => v.installed)
	}

	// Favorites only
	if (filters.favoritesOnly) {
		result = result.filter((v) => v.favorite)
	}

	return result
}

/**
 * Combined search: fuzzy search, then filters, then mood filters.
 */
export function combinedSearch(voices: VoiceEntry[], query: string, filters: FilterState): VoiceEntry[] {
	let result = fuzzySearchVoices(voices, query)
	result = applyFilters(result, filters)
	result = applyMoodFilters(result, filters.moods)
	return result
}

/**
 * Get filter counts for live display.
 * For each possible filter value, returns how many voices would match
 * if that filter value were toggled on (with current search query and other filters applied).
 * Keys are formatted as "category:value", e.g. "gender:female" => 23.
 */
export function getFilterCounts(
	voices: VoiceEntry[],
	query: string,
	currentFilters: FilterState,
): Record<string, number> {
	// Apply search query. If search returns nothing (dead-end query), fall back to
	// the full catalog so filter counts reflect what's actually available — this
	// prevents the "All (0) / Male (0) / Female (0)" collapse that traps users.
	const searched = fuzzySearchVoices(voices, query)
	const searchResults = searched.length > 0 || query === "" ? searched : voices

	const counts: Record<string, number> = {}

	// Gender counts: apply all filters EXCEPT gender
	const filtersNoGender = { ...currentFilters, gender: null }
	const baseForGender = applyFilters(searchResults, filtersNoGender)
	const genders: VoiceGender[] = ["male", "female", "neutral"]
	for (const g of genders) {
		counts[`gender:${g}`] = baseForGender.filter((v) => v.gender === g).length
	}

	// Accent counts: apply all filters EXCEPT accents
	const filtersNoAccent = { ...currentFilters, accents: [] }
	const baseForAccent = applyFilters(searchResults, filtersNoAccent)
	const allAccents = new Set(voices.map((v) => v.accent))
	for (const accent of allAccents) {
		counts[`accent:${accent}`] = baseForAccent.filter((v) => v.accent === accent).length
	}

	// Style counts: apply all filters EXCEPT styles
	const filtersNoStyle = { ...currentFilters, styles: [] as VoiceStyle[] }
	const baseForStyle = applyFilters(searchResults, filtersNoStyle)
	const allStyles = new Set(voices.map((v) => v.style))
	for (const style of allStyles) {
		counts[`style:${style}`] = baseForStyle.filter((v) => v.style === style).length
	}

	// Provider counts: apply all filters EXCEPT providers
	const filtersNoProvider = { ...currentFilters, providers: [] }
	const baseForProvider = applyFilters(searchResults, filtersNoProvider)
	const allProviders = new Set(voices.map((v) => v.provider))
	for (const provider of allProviders) {
		counts[`provider:${provider}`] = baseForProvider.filter((v) => v.provider === provider).length
	}

	// Mood counts: apply all filters EXCEPT moods
	const filtersNoMood = { ...currentFilters, moods: [] }
	const baseForMood = applyFilters(searchResults, filtersNoMood)
	for (const mood of Object.keys(MOOD_MAPPINGS)) {
		counts[`mood:${mood}`] = applyMoodFilters(baseForMood, [mood]).length
	}

	// Installed count
	const filtersNoInstalled = { ...currentFilters, installedOnly: false }
	const baseForInstalled = applyFilters(searchResults, filtersNoInstalled)
	counts["installed:true"] = baseForInstalled.filter((v) => v.installed).length

	// Favorites count
	const filtersNoFavorites = { ...currentFilters, favoritesOnly: false }
	const baseForFavorites = applyFilters(searchResults, filtersNoFavorites)
	counts["favorites:true"] = baseForFavorites.filter((v) => v.favorite).length

	return counts
}

/**
 * Get autocomplete suggestions for the search input.
 */
export function getAutocompleteResults(
	voices: VoiceEntry[],
	query: string,
	recentSearches: string[],
): { recent: string[]; voices: VoiceEntry[]; accentSuggestion: string | null } {
	const trimmed = query.trim().toLowerCase()

	if (!trimmed) {
		return {
			recent: recentSearches.slice(0, 5),
			voices: [],
			accentSuggestion: null,
		}
	}

	// Filter recent searches that match the query
	const matchingRecent = recentSearches.filter((s) => s.toLowerCase().includes(trimmed)).slice(0, 3)

	// Find matching voices (top 5)
	const matchingVoices = fuzzySearchVoices(voices, trimmed).slice(0, 5)

	// Find accent suggestion: check if query matches any accent label
	let accentSuggestion: string | null = null
	for (const voice of voices) {
		if (voice.accentLabel.toLowerCase().includes(trimmed) || voice.accent.toLowerCase().includes(trimmed)) {
			accentSuggestion = voice.accentLabel
			break
		}
	}

	return {
		recent: matchingRecent,
		voices: matchingVoices,
		accentSuggestion,
	}
}

// ─── Phase 5.3/5.4: Smart Search + Index Management ──────────────────────────

/**
 * kilocode_change — Similarity search over the acoustic model index.
 * Delegates to AcousticModelIndex.search() and returns scored results.
 * Useful for "find voices similar to David Bowie" style queries.
 */
export function similaritySearch(
	query: string,
	index: ModelIndex,
	options?: { gender?: string; maxResults?: number },
): Array<{ model: ModelMetadata; score: number; reason: string }> {
	// kilocode_change
	return AcousticModelIndex.search(index, query, options)
}

/**
 * kilocode_change — Filter a list of ModelMetadata by one or more tags.
 * A model matches if it has ALL of the requested tags (AND semantics).
 * Pass a single-element array for OR-style behaviour by chaining calls.
 */
export function filterByTags(models: ModelMetadata[], tags: string[]): ModelMetadata[] {
	// kilocode_change
	if (tags.length === 0) {
		return models
	}
	const lowerTags = tags.map((t) => t.toLowerCase())
	return models.filter((model) => {
		const modelTagsLower = model.tags.map((t) => t.toLowerCase())
		return lowerTags.every((tag) => modelTagsLower.includes(tag))
	})
}

/**
 * kilocode_change — Sort a list of ModelMetadata using AcousticModelIndex.sort().
 * Accepts the same SortOrder values: "recentlyUsed" | "mostUsed" |
 * "alphabetical" | "size" | "quality".
 */
export function sortModels(models: ModelMetadata[], by: SortOrder): ModelMetadata[] {
	// kilocode_change
	return AcousticModelIndex.sort(models, by)
}
