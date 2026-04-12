export type VoiceProvider = "rvc" | "azure" | "browser" | "kokoro" | "piper" | "xtts" | "f5tts" | "bark" | "chatterbox"
export type VoiceGender = "male" | "female" | "neutral"
export type VoiceStyle = "natural" | "expressive" | "whisper" | "broadcast" | "singing" | "character"
export type VoiceQuality = 1 | 2 | 3 | 4 | 5
export type InteractionMode = "silent" | "assist" | "handsfree"
export type DownloadStatus = "queued" | "downloading" | "extracting" | "installing" | "done" | "failed"

export interface VoiceEntry {
	id: string
	provider: VoiceProvider
	name: string
	description: string
	gender: VoiceGender
	accent: string
	accentLabel: string
	style: VoiceStyle
	quality: VoiceQuality
	sampleRate: number
	fileSize: number
	epochs?: number
	tags: string[]
	installed: boolean
	favorite: boolean
	lastUsed?: number
	heroClipUrl?: string
	downloadUrl?: string
	localPath?: string
}

export interface StoreVoiceEntry {
	id: string
	name: string
	description: string
	gender: VoiceGender
	accent: string
	accentLabel: string
	style: VoiceStyle
	quality: VoiceQuality
	sampleRate: number
	fileSize: number
	epochs?: number
	tags: string[]
	downloadUrl: string
	heroClipUrl: string | null
	category: string
	addedAt: string
}

export interface VoiceCatalogResponse {
	version: number
	generatedAt: string
	totalModels: number
	totalSizeBytes: number
	voices: StoreVoiceEntry[]
}

export interface DiskUsageResponse {
	usedBytes: number
	maxBytes: number
	modelCount: number
}

export interface DownloadJob {
	id: string
	modelId: string
	name: string
	url: string
	totalBytes: number
	receivedBytes: number
	status: DownloadStatus
	error?: string
}

export interface FilterState {
	gender: VoiceGender | null
	accents: string[]
	styles: VoiceStyle[]
	providers: VoiceProvider[]
	moods: string[]
	installedOnly: boolean
	favoritesOnly: boolean
}

export interface SavedSearch {
	name: string
	query: string
	filters: FilterState
	createdAt: number
}

export const DEFAULT_FILTERS: FilterState = {
	gender: null,
	accents: [],
	styles: [],
	providers: [],
	moods: [],
	installedOnly: false,
	favoritesOnly: false,
}

export const MOOD_MAPPINGS: Record<string, { styles: VoiceStyle[]; tags: string[]; gender?: VoiceGender; minQuality?: VoiceQuality }> = {
	warm: { styles: ["natural"], tags: ["warm", "soft"] },
	calm: { styles: ["natural", "whisper"], tags: ["calm", "gentle"] },
	bright: { styles: ["expressive"], tags: ["bright", "clear", "crisp"] },
	deep: { styles: ["natural"], tags: ["deep", "bass", "low"], gender: "male" },
	robotic: { styles: ["broadcast"], tags: ["robotic", "synth", "mechanical"] },
	professional: { styles: ["natural"], tags: ["studio", "neutral", "professional"], minQuality: 4 },
}

export const ACCENT_LABELS: Record<string, string> = {
	"en-US": "American English",
	"en-GB": "British English",
	"en-AU": "Australian English",
	"en-CA": "Canadian English",
	"en-IN": "Indian English",
	"en-IE": "Irish English",
	"en-NZ": "New Zealand English",
	"en-ZA": "South African English",
	"en-SC": "Scottish English",
	"ja-JP": "Japanese",
	"zh-CN": "Chinese (Mandarin)",
	"ko-KR": "Korean",
	"fr-FR": "French",
	"es-ES": "Spanish",
	"de-DE": "German",
}
