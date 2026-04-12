// kilocode_change — Phase 7.4: Acoustic Model Indexing (CocoIndex-inspired)
// Incremental metadata indexing via globalState — no vector DB needed

export interface ModelMetadata {
	id: string // model filename/path
	name: string
	genre?: string // "pop", "rock", "jazz", "classical", etc.
	era?: string // "80s", "90s", "modern", etc.
	gender?: "male" | "female" | "neutral"
	pitchRange?: "low" | "medium" | "high"
	quality?: "low" | "medium" | "high"
	hasIndex: boolean // whether .index file exists
	fileSize: number // bytes of .pth file
	version: "v1" | "v2" | "unknown"
	tags: string[] // user-assigned or auto-detected tags
	installedAt: number // Unix ms
	usageCount: number
}

export interface ModelIndex {
	version: number
	lastUpdated: number
	models: Record<string, ModelMetadata>
}

// ─── Internal lookup tables ───────────────────────────────────────────────────

/**
 * Well-known artist → genre/era/gender hints.
 * Used by search() to expand queries like "David Bowie" into searchable signals.
 */
const ARTIST_HINTS: Record<
	string,
	{ genre?: string; era?: string; gender?: "male" | "female" | "neutral"; tags?: string[] }
> = {
	"david bowie": { genre: "rock", era: "70s", gender: "male", tags: ["glam", "rock", "art-rock"] },
	bowie: { genre: "rock", era: "70s", gender: "male", tags: ["glam", "rock"] },
	"snoop dogg": { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop", "west-coast"] },
	snoop: { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop"] },
	"tupac shakur": { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop", "west-coast"] },
	tupac: { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop"] },
	"notorious big": { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop", "east-coast"] },
	biggie: { genre: "hip-hop", era: "90s", gender: "male", tags: ["rap", "hip-hop"] },
	eminem: { genre: "hip-hop", era: "2000s", gender: "male", tags: ["rap", "hip-hop"] },
	"frank sinatra": { genre: "jazz", era: "50s", gender: "male", tags: ["jazz", "swing", "crooner"] },
	sinatra: { genre: "jazz", era: "50s", gender: "male", tags: ["jazz", "swing"] },
	"michael jackson": { genre: "pop", era: "80s", gender: "male", tags: ["pop", "r&b", "dance"] },
	mj: { genre: "pop", era: "80s", gender: "male", tags: ["pop", "r&b"] },
	madonna: { genre: "pop", era: "80s", gender: "female", tags: ["pop", "dance", "disco"] },
	"whitney houston": { genre: "pop", era: "80s", gender: "female", tags: ["pop", "r&b", "soul"] },
	"aretha franklin": { genre: "soul", era: "60s", gender: "female", tags: ["soul", "gospel", "r&b"] },
	aretha: { genre: "soul", era: "60s", gender: "female", tags: ["soul", "gospel"] },
	"elvis presley": { genre: "rock", era: "50s", gender: "male", tags: ["rock", "rockabilly", "country"] },
	elvis: { genre: "rock", era: "50s", gender: "male", tags: ["rock", "rockabilly"] },
	"freddie mercury": { genre: "rock", era: "70s", gender: "male", tags: ["rock", "opera", "glam"] },
	freddie: { genre: "rock", era: "70s", gender: "male", tags: ["rock", "opera"] },
	"johnny cash": { genre: "country", era: "60s", gender: "male", tags: ["country", "folk", "outlaw"] },
	johnny: { genre: "country", era: "60s", gender: "male", tags: ["country", "folk"] },
	beyonce: { genre: "pop", era: "modern", gender: "female", tags: ["pop", "r&b", "dance"] },
	"taylor swift": { genre: "pop", era: "modern", gender: "female", tags: ["pop", "country", "folk"] },
	adele: { genre: "pop", era: "modern", gender: "female", tags: ["pop", "soul", "ballad"] },
	"ed sheeran": { genre: "pop", era: "modern", gender: "male", tags: ["pop", "folk", "acoustic"] },
	drake: { genre: "hip-hop", era: "modern", gender: "male", tags: ["rap", "hip-hop", "r&b"] },
	"kanye west": { genre: "hip-hop", era: "2000s", gender: "male", tags: ["rap", "hip-hop", "experimental"] },
	kanye: { genre: "hip-hop", era: "2000s", gender: "male", tags: ["rap", "hip-hop"] },
	"lady gaga": { genre: "pop", era: "modern", gender: "female", tags: ["pop", "dance", "electropop"] },
	"kurt cobain": { genre: "rock", era: "90s", gender: "male", tags: ["grunge", "rock", "alternative"] },
	cobain: { genre: "rock", era: "90s", gender: "male", tags: ["grunge", "rock"] },
	nirvana: { genre: "rock", era: "90s", tags: ["grunge", "rock", "alternative"] },
	"jimi hendrix": { genre: "rock", era: "60s", gender: "male", tags: ["rock", "blues", "psychedelic"] },
	hendrix: { genre: "rock", era: "60s", gender: "male", tags: ["rock", "blues"] },
	"bob dylan": { genre: "folk", era: "60s", gender: "male", tags: ["folk", "country", "acoustic"] },
	dylan: { genre: "folk", era: "60s", gender: "male", tags: ["folk", "acoustic"] },
	"jim morrison": { genre: "rock", era: "60s", gender: "male", tags: ["rock", "psychedelic", "blues"] },
	morrison: { genre: "rock", era: "60s", gender: "male", tags: ["rock", "psychedelic"] },
	"mick jagger": { genre: "rock", era: "60s", gender: "male", tags: ["rock", "blues"] },
	jagger: { genre: "rock", era: "60s", gender: "male", tags: ["rock", "blues"] },
}

/** Filename fragment patterns → metadata hints. */
const FILENAME_GENRE_PATTERNS: Array<{ pattern: RegExp; genre: string; tags?: string[] }> = [
	{ pattern: /\b(hip.?hop|hiphop|rap)\b/i, genre: "hip-hop", tags: ["rap", "hip-hop"] },
	{ pattern: /\b(pop)\b/i, genre: "pop", tags: ["pop"] },
	{ pattern: /\b(rock|metal|punk|grunge)\b/i, genre: "rock", tags: ["rock"] },
	{ pattern: /\b(jazz|swing|blues|soul)\b/i, genre: "jazz", tags: ["jazz"] },
	{ pattern: /\b(classical|opera|orchestral)\b/i, genre: "classical", tags: ["classical"] },
	{ pattern: /\b(country|folk|bluegrass)\b/i, genre: "country", tags: ["country"] },
	{ pattern: /\b(rnb|r.?n.?b|soul)\b/i, genre: "r&b", tags: ["r&b", "soul"] },
	{ pattern: /\b(electro|edm|techno|house|trance|dance)\b/i, genre: "electronic", tags: ["electronic", "edm"] },
	{ pattern: /\b(reggae|ska)\b/i, genre: "reggae", tags: ["reggae"] },
	{ pattern: /\b(latin|salsa|bossa)\b/i, genre: "latin", tags: ["latin"] },
]

const FILENAME_ERA_PATTERNS: Array<{ pattern: RegExp; era: string }> = [
	{ pattern: /\b(50s|1950s)\b/i, era: "50s" },
	{ pattern: /\b(60s|1960s)\b/i, era: "60s" },
	{ pattern: /\b(70s|1970s)\b/i, era: "70s" },
	{ pattern: /\b(80s|1980s)\b/i, era: "80s" },
	{ pattern: /\b(90s|1990s)\b/i, era: "90s" },
	{ pattern: /\b(2000s|00s)\b/i, era: "2000s" },
	{ pattern: /\b(2010s|10s|modern|contemporary)\b/i, era: "modern" },
]

const FILENAME_GENDER_PATTERNS: Array<{ pattern: RegExp; gender: "male" | "female" | "neutral" }> = [
	{ pattern: /\b(male|man|guy|mr|sir)\b/i, gender: "male" },
	{ pattern: /\b(female|woman|girl|ms|mrs|lady)\b/i, gender: "female" },
	{ pattern: /\b(neutral|androgynous|unisex)\b/i, gender: "neutral" },
]

// ─── AcousticModelIndex ───────────────────────────────────────────────────────

export class AcousticModelIndex {
	/**
	 * Auto-detect model metadata from file info.
	 * - Detects v1/v2 from file size heuristics (v2 models tend to be larger, >100 MB)
	 * - Extracts genre/era hints from filename patterns (e.g. "snoop-dogg-90s")
	 * - Checks if .index file exists by convention (caller passes hasIndex)
	 */
	static autoTag(filename: string, fileSize: number, hasIndex: boolean): Partial<ModelMetadata> {
		const result: Partial<ModelMetadata> = { hasIndex }

		// ── Version detection ──────────────────────────────────────────────────
		// RVC v2 models are typically larger (>100 MB for full models).
		// This is a heuristic; callers can override after the fact.
		const MB = 1024 * 1024
		if (fileSize > 100 * MB) {
			result.version = "v2"
		} else if (fileSize > 0) {
			result.version = "v1"
		} else {
			result.version = "unknown"
		}

		// ── Quality from file size ─────────────────────────────────────────────
		if (fileSize > 150 * MB) {
			result.quality = "high"
		} else if (fileSize > 30 * MB) {
			result.quality = "medium"
		} else if (fileSize > 0) {
			result.quality = "low"
		}

		// ── Normalise filename for pattern matching ────────────────────────────
		const base = filename
			.replace(/\.(pth|pt|bin|safetensors)$/i, "")
			.replace(/[_\-\.]+/g, " ")
			.toLowerCase()

		const collectedTags: string[] = []

		// ── Artist hint lookup ────────────────────────────────────────────────
		// Try longest matching key first so "david bowie" beats "bowie"
		const sortedKeys = Object.keys(ARTIST_HINTS).sort((a, b) => b.length - a.length)
		for (const key of sortedKeys) {
			if (base.includes(key)) {
				const hint = ARTIST_HINTS[key]
				if (hint.genre && !result.genre) result.genre = hint.genre
				if (hint.era && !result.era) result.era = hint.era
				if (hint.gender && !result.gender) result.gender = hint.gender
				if (hint.tags) collectedTags.push(...hint.tags)
				break // one artist hit is enough
			}
		}

		// ── Genre patterns ────────────────────────────────────────────────────
		if (!result.genre) {
			for (const { pattern, genre, tags } of FILENAME_GENRE_PATTERNS) {
				if (pattern.test(base)) {
					result.genre = genre
					if (tags) collectedTags.push(...tags)
					break
				}
			}
		}

		// ── Era patterns ──────────────────────────────────────────────────────
		if (!result.era) {
			for (const { pattern, era } of FILENAME_ERA_PATTERNS) {
				if (pattern.test(base)) {
					result.era = era
					break
				}
			}
		}

		// ── Gender patterns ───────────────────────────────────────────────────
		if (!result.gender) {
			for (const { pattern, gender } of FILENAME_GENDER_PATTERNS) {
				if (pattern.test(base)) {
					result.gender = gender
					break
				}
			}
		}

		// ── Pitch range from filename keywords ────────────────────────────────
		if (/\b(bass|baritone|low|deep)\b/i.test(base)) {
			result.pitchRange = "low"
		} else if (/\b(tenor|alto|medium|mid)\b/i.test(base)) {
			result.pitchRange = "medium"
		} else if (/\b(soprano|high|falsetto|treble)\b/i.test(base)) {
			result.pitchRange = "high"
		}

		// Deduplicate tags
		result.tags = [...new Set(collectedTags)]

		return result
	}

	/**
	 * Similarity search: find models similar to a query.
	 * "find voices similar to David Bowie" → match by genre, era, tags.
	 * Returns scored results sorted by descending relevance.
	 */
	static search(
		index: ModelIndex,
		query: string,
		options?: { gender?: string; maxResults?: number },
	): Array<{ model: ModelMetadata; score: number; reason: string }> {
		const maxResults = options?.maxResults ?? 10
		const genderFilter = options?.gender?.toLowerCase()

		const trimmed = query.trim().toLowerCase()
		if (!trimmed) {
			// Return all models up to maxResults, unscored
			return Object.values(index.models)
				.slice(0, maxResults)
				.map((model) => ({ model, score: 1, reason: "no query — showing all" }))
		}

		const keywords = trimmed.split(/\s+/).filter(Boolean)

		// ── Expand artist hints ────────────────────────────────────────────────
		const expandedGenres = new Set<string>()
		const expandedEras = new Set<string>()
		const expandedTags = new Set<string>()

		const sortedKeys = Object.keys(ARTIST_HINTS).sort((a, b) => b.length - a.length)
		for (const key of sortedKeys) {
			if (trimmed.includes(key)) {
				const hint = ARTIST_HINTS[key]
				if (hint.genre) expandedGenres.add(hint.genre)
				if (hint.era) expandedEras.add(hint.era)
				if (hint.tags) hint.tags.forEach((t) => expandedTags.add(t))
			}
		}

		const results: Array<{ model: ModelMetadata; score: number; reason: string }> = []

		for (const model of Object.values(index.models)) {
			// ── Gender filter ──────────────────────────────────────────────────
			if (genderFilter && model.gender && model.gender !== genderFilter) {
				continue
			}

			let score = 0
			const reasons: string[] = []

			// ── Tag matches (0.5 weight) ───────────────────────────────────────
			for (const tag of model.tags) {
				const tagLower = tag.toLowerCase()
				// Direct keyword hit in tags
				for (const kw of keywords) {
					if (tagLower === kw || tagLower.includes(kw)) {
						score += 0.5
						reasons.push(`tag:${tag}`)
						break
					}
				}
				// Expanded artist tags
				if (expandedTags.has(tagLower)) {
					score += 0.5
					reasons.push(`artist-tag:${tag}`)
				}
			}

			// ── Name similarity (0.3 weight) ───────────────────────────────────
			const nameLower = model.name.toLowerCase()
			for (const kw of keywords) {
				if (nameLower === kw) {
					score += 0.3 * 3 // exact
					reasons.push(`name-exact:${model.name}`)
				} else if (nameLower.startsWith(kw)) {
					score += 0.3 * 2.5
					reasons.push(`name-starts:${model.name}`)
				} else if (nameLower.includes(kw)) {
					score += 0.3 * 2
					reasons.push(`name-contains:${model.name}`)
				}
			}

			// ── Genre/era match (0.2 weight) ───────────────────────────────────
			if (model.genre) {
				const genreLower = model.genre.toLowerCase()
				// Direct keyword hit
				for (const kw of keywords) {
					if (genreLower === kw || genreLower.includes(kw)) {
						score += 0.2 * 2
						reasons.push(`genre:${model.genre}`)
						break
					}
				}
				// Expanded artist genre
				if (expandedGenres.has(genreLower)) {
					score += 0.2 * 2
					reasons.push(`artist-genre:${model.genre}`)
				}
			}

			if (model.era) {
				const eraLower = model.era.toLowerCase()
				for (const kw of keywords) {
					if (eraLower === kw || eraLower.includes(kw)) {
						score += 0.2
						reasons.push(`era:${model.era}`)
						break
					}
				}
				if (expandedEras.has(eraLower)) {
					score += 0.2
					reasons.push(`artist-era:${model.era}`)
				}
			}

			// ── ID/path keyword match ──────────────────────────────────────────
			const idLower = model.id.toLowerCase()
			for (const kw of keywords) {
				if (idLower.includes(kw)) {
					score += 0.1
					reasons.push(`id:${model.id}`)
					break
				}
			}

			if (score > 0) {
				results.push({
					model,
					score,
					reason: [...new Set(reasons)].slice(0, 3).join(", "),
				})
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, maxResults)
	}

	/**
	 * Merge a new model entry into the index.
	 * Incremental — only re-indexes changed entries; preserves existing
	 * usageCount and installedAt when upserting an already-known model.
	 */
	static upsert(index: ModelIndex, metadata: ModelMetadata): ModelIndex {
		const existing = index.models[metadata.id]
		const merged: ModelMetadata = existing
			? {
					...metadata,
					// Preserve accumulated stats
					usageCount: Math.max(existing.usageCount, metadata.usageCount),
					installedAt: existing.installedAt || metadata.installedAt,
					// Merge tags (union of both sets)
					tags: [...new Set([...existing.tags, ...metadata.tags])],
				}
			: metadata

		return {
			...index,
			lastUpdated: Date.now(),
			models: {
				...index.models,
				[metadata.id]: merged,
			},
		}
	}

	/**
	 * Remove a model from the index by its id.
	 * Returns a new ModelIndex with the entry removed.
	 */
	static remove(index: ModelIndex, modelId: string): ModelIndex {
		const { [modelId]: _removed, ...rest } = index.models
		return {
			...index,
			lastUpdated: Date.now(),
			models: rest,
		}
	}

	/**
	 * Return all models that are missing their companion .index file.
	 * These models can still be used for voice conversion but with degraded
	 * speaker similarity — useful for surfacing in a UI warning.
	 */
	static missingIndex(index: ModelIndex): ModelMetadata[] {
		return Object.values(index.models).filter((m) => !m.hasIndex)
	}

	/**
	 * Sort a list of ModelMetadata by the given criterion.
	 */
	static sort(
		models: ModelMetadata[],
		by: "recentlyUsed" | "mostUsed" | "alphabetical" | "size" | "quality",
	): ModelMetadata[] {
		const copy = [...models]

		const qualityRank: Record<string, number> = { high: 3, medium: 2, low: 1 }

		switch (by) {
			case "recentlyUsed":
				// kilocode_change — sort by most recently installed among used models;
				// ModelMetadata has no lastUsedAt field, so installedAt is the best
				// available recency proxy.  Models with usageCount > 0 sort above unused ones.
				return copy.sort((a, b) => {
					// Primary: used > unused
					const aUsed = a.usageCount > 0 ? 1 : 0
					const bUsed = b.usageCount > 0 ? 1 : 0
					if (bUsed !== aUsed) return bUsed - aUsed
					// Secondary: more recently installed (larger timestamp first)
					return b.installedAt - a.installedAt
				})

			case "mostUsed":
				return copy.sort((a, b) => b.usageCount - a.usageCount)

			case "alphabetical":
				return copy.sort((a, b) => a.name.localeCompare(b.name))

			case "size":
				return copy.sort((a, b) => b.fileSize - a.fileSize)

			case "quality":
				return copy.sort((a, b) => {
					const aRank = qualityRank[a.quality ?? "low"] ?? 0
					const bRank = qualityRank[b.quality ?? "low"] ?? 0
					return bRank - aRank
				})

			default:
				return copy
		}
	}
}
