import { Component, createSignal, onMount, onCleanup, Show, For, createMemo } from "solid-js"
import type {
  VoiceEntry,
  StoreVoiceEntry,
  FilterState,
  DiskUsageResponse,
  DownloadJob,
  SavedSearch,
  InteractionMode,
} from "../src/types/voice"
import { DEFAULT_FILTERS } from "../src/types/voice"
import { combinedSearch } from "../src/utils/voice-search"
import { SearchBar } from "./components/SearchBar"
import { useVoiceCommands } from "./hooks/useVoiceCommands"
import { FilterBar } from "./components/FilterBar"
import { ViewToggle } from "./components/ViewToggle"
import { VoiceCard } from "./components/VoiceCard"
import { VoiceRow } from "./components/VoiceRow"
import { AudioPlayer } from "./components/AudioPlayer"

interface VscodeApi {
  postMessage(msg: Record<string, unknown>): void
  getState(): any
  setState(state: any): void
}

export const App: Component<{ vscode: VscodeApi }> = (props) => {
  // ── Signals ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = createSignal<"library" | "store">("library")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid")
  const [filters, setFilters] = createSignal<FilterState>({ ...DEFAULT_FILTERS })
  const [voices, setVoices] = createSignal<VoiceEntry[]>([])
  const [storeVoices, setStoreVoices] = createSignal<StoreVoiceEntry[]>([])
  const [diskUsage, setDiskUsage] = createSignal<DiskUsageResponse | null>(null)
  const [downloadJobs, setDownloadJobs] = createSignal<Map<string, DownloadJob>>(new Map())
  const [favorites, setFavorites] = createSignal<string[]>([])
  const [recentSearches, setRecentSearches] = createSignal<string[]>([])
  const [savedSearches, setSavedSearches] = createSignal<SavedSearch[]>([])
  const [interactionMode, setInteractionMode] = createSignal<InteractionMode>("silent")
  const [activeVoiceId, setActiveVoiceId] = createSignal<string | null>(null)

  // Loading / error states
  const [libraryLoading, setLibraryLoading] = createSignal(true)
  const [storeLoading, setStoreLoading] = createSignal(true)
  const [libraryError, setLibraryError] = createSignal<string | null>(null)
  const [storeError, setStoreError] = createSignal<string | null>(null)

  // Audio management — single player at a time
  const [playingVoiceId, setPlayingVoiceId] = createSignal<string | null>(null)
  const [playerTime, setPlayerTime] = createSignal(0)
  const [playerDuration, setPlayerDuration] = createSignal(0)
  let audioRef: HTMLAudioElement | null = null
  let audioTimerRef: ReturnType<typeof setInterval> | undefined

  // ── Audio helpers ───────────────────────────────────────────────────────

  function stopAudio() {
    if (audioRef) {
      audioRef.pause()
      audioRef.src = ""
      audioRef = null
    }
    if (audioTimerRef) {
      clearInterval(audioTimerRef)
      audioTimerRef = undefined
    }
    setPlayingVoiceId(null)
    setPlayerTime(0)
    setPlayerDuration(0)
  }

  function playAudioFromBase64(voiceId: string, base64: string, format: string) {
    stopAudio()
    const mimeMap: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" }
    const mime = mimeMap[format] ?? "audio/wav"
    const audio = new Audio(`data:${mime};base64,${base64}`)
    audioRef = audio
    setPlayingVoiceId(voiceId)

    audio.onloadedmetadata = () => {
      setPlayerDuration(audio.duration)
    }

    audio.onended = () => {
      stopAudio()
    }

    audio.onerror = () => {
      stopAudio()
    }

    audioTimerRef = setInterval(() => {
      if (audioRef) {
        setPlayerTime(audioRef.currentTime)
      }
    }, 100)

    audio.play().catch(() => stopAudio())
  }

  function togglePlayPause() {
    if (!audioRef) return
    if (audioRef.paused) {
      audioRef.play().catch(() => stopAudio())
    } else {
      audioRef.pause()
    }
  }

  // ── Message sending ─────────────────────────────────────────────────────

  function send(msg: Record<string, unknown>) {
    props.vscode.postMessage(msg)
  }

  // ── Hands-free voice commands ───────────────────────────────────────────

  useVoiceCommands(interactionMode, (command, transcript) => {
    send({ type: "voiceCommand", command, transcript })
  })

  // ── Message handler ─────────────────────────────────────────────────────

  function onMessage(event: MessageEvent) {
    const msg = event.data
    if (!msg || !msg.type) return

    switch (msg.type) {
      case "voiceStudioState": {
        setFavorites(msg.favorites ?? [])
        setRecentSearches(msg.recentSearches ?? [])
        setSavedSearches(msg.savedSearches ?? [])
        setInteractionMode(msg.interactionMode ?? "silent")
        if (msg.speechSettings) {
          const ss = msg.speechSettings
          // Determine active voice based on current provider
          if (ss.provider === "rvc" && ss.rvc?.voiceId) setActiveVoiceId(ss.rvc.voiceId)
          else if (ss.provider === "azure" && ss.azure?.voiceId) setActiveVoiceId(ss.azure.voiceId)
          else if (ss.provider === "browser" && ss.browser?.voiceURI) setActiveVoiceId(ss.browser.voiceURI)
        }
        break
      }

      case "voiceLibraryLoaded": {
        setLibraryLoading(false)
        if (msg.error) {
          setLibraryError(String(msg.error))
        } else {
          setLibraryError(null)
          const rawVoices = msg.voices as any[]
          const mapped: VoiceEntry[] = rawVoices.map((v: any) => ({
            id: v.id ?? "",
            provider: v.provider ?? "rvc",
            name: v.name ?? v.id ?? "Unknown",
            description: v.description ?? "",
            gender: v.gender ?? "neutral",
            accent: v.accent ?? "en-US",
            accentLabel: v.accentLabel ?? "",
            style: v.style ?? "natural",
            quality: v.quality ?? 3,
            sampleRate: v.sampleRate ?? 0,
            fileSize: v.fileSize ?? 0,
            epochs: v.epochs,
            tags: v.tags ?? [],
            installed: v.installed !== false,
            favorite: v.isFavorite ?? favorites().includes(v.id),
            lastUsed: v.lastUsed,
            heroClipUrl: v.heroClipUrl,
            downloadUrl: v.downloadUrl,
            localPath: v.localPath,
          }))
          setVoices(mapped)
        }
        break
      }

      case "storeModelsLoaded": {
        setStoreLoading(false)
        if (msg.error) {
          setStoreError(String(msg.error))
        } else {
          setStoreError(null)
          const models = (msg.models ?? []) as any[]
          const mapped: StoreVoiceEntry[] = models.map((m: any) => ({
            id: m.id ?? "",
            name: m.name ?? m.id ?? "Unknown",
            description: m.description ?? "",
            gender: m.gender ?? "neutral",
            accent: m.accent ?? "en-US",
            accentLabel: m.accentLabel ?? "",
            style: m.style ?? "natural",
            quality: m.quality ?? 3,
            sampleRate: m.sampleRate ?? 0,
            fileSize: m.fileSize ?? 0,
            epochs: m.epochs,
            tags: m.tags ?? [],
            downloadUrl: m.downloadUrl ?? "",
            heroClipUrl: m.heroClipUrl ?? null,
            category: m.category ?? "",
            addedAt: m.addedAt ?? "",
          }))
          setStoreVoices(mapped)
        }
        if (msg.diskUsage) {
          setDiskUsage(msg.diskUsage as DiskUsageResponse)
        }
        break
      }

      case "downloadProgress": {
        const jobs = new Map(downloadJobs())
        const existing = jobs.get(msg.modelId as string)
        if (existing) {
          existing.receivedBytes = msg.received as number
          existing.totalBytes = msg.total as number
          existing.status = "downloading"
        } else {
          jobs.set(msg.modelId as string, {
            id: msg.modelId as string,
            modelId: msg.modelId as string,
            name: "",
            url: "",
            totalBytes: msg.total as number,
            receivedBytes: msg.received as number,
            status: "downloading",
          })
        }
        setDownloadJobs(jobs)
        break
      }

      case "downloadComplete": {
        const jobs = new Map(downloadJobs())
        jobs.delete(msg.modelId as string)
        setDownloadJobs(jobs)
        if (msg.success) {
          // Refresh library
          send({ type: "fetchVoiceLibrary" })
        }
        break
      }

      case "downloadFailed": {
        const jobs = new Map(downloadJobs())
        const existing = jobs.get(msg.modelId as string)
        if (existing) {
          existing.status = "failed"
          existing.error = msg.error as string
        }
        setDownloadJobs(jobs)
        break
      }

      case "previewAudioReady": {
        if (msg.error) {
          stopAudio()
        } else if (msg.audioBase64) {
          playAudioFromBase64(msg.modelId as string, msg.audioBase64 as string, (msg.format as string) ?? "wav")
        }
        break
      }

      case "voiceCommandAck": {
        // Could display feedback; for now just acknowledge
        break
      }

      case "interactionModeChanged": {
        setInteractionMode(msg.mode as InteractionMode)
        break
      }

      case "diskUsage": {
        setDiskUsage(msg as unknown as DiskUsageResponse)
        break
      }

      case "favoritesUpdated": {
        setFavorites(msg.favorites as string[])
        // Update voice entries to reflect favorite status
        setVoices((prev) =>
          prev.map((v) => ({
            ...v,
            favorite: (msg.favorites as string[]).includes(v.id),
          })),
        )
        break
      }

      case "activeVoiceSet": {
        setActiveVoiceId(msg.voiceId as string)
        break
      }

      case "savedSearchesUpdated": {
        setSavedSearches(msg.savedSearches as SavedSearch[])
        break
      }

      case "modelDeleted": {
        if (msg.success) {
          send({ type: "fetchVoiceLibrary" })
        }
        break
      }
    }
  }

  // ── On mount ────────────────────────────────────────────────────────────

  onMount(() => {
    window.addEventListener("message", onMessage)
    send({ type: "requestVoiceStudioState" })
    send({ type: "fetchVoiceLibrary" })
    send({ type: "fetchStoreModels" })
  })

  onCleanup(() => {
    window.removeEventListener("message", onMessage)
    stopAudio()
  })

  // ── Computed: filtered voices ───────────────────────────────────────────

  const filteredLibrary = createMemo(() => {
    return combinedSearch(voices(), searchQuery(), filters())
  })

  const filteredStore = createMemo(() => {
    // Store voices use same structure minus installed/favorite fields.
    // For filtering, we cast them into VoiceEntry shape temporarily.
    const asEntries: VoiceEntry[] = storeVoices().map((sv) => ({
      ...sv,
      provider: "rvc" as const,
      installed: false,
      favorite: favorites().includes(sv.id),
    }))
    return combinedSearch(asEntries, searchQuery(), filters())
  })

  // ── Action handlers ─────────────────────────────────────────────────────

  function handlePreview(voiceId: string) {
    if (playingVoiceId() === voiceId) {
      stopAudio()
      return
    }
    stopAudio()
    send({ type: "previewStoreVoice", modelId: voiceId })
  }

  function handleFavorite(voiceId: string) {
    const isFav = favorites().includes(voiceId)
    send({ type: "toggleFavorite", voiceId, action: isFav ? "remove" : "add" })
  }

  function handleSetActive(voiceId: string, provider: string) {
    send({ type: "setActiveVoice", voiceId, provider })
  }

  function handleDownload(modelId: string, url: string, name: string) {
    const jobs = new Map(downloadJobs())
    jobs.set(modelId, {
      id: modelId,
      modelId,
      name,
      url,
      totalBytes: 0,
      receivedBytes: 0,
      status: "queued",
    })
    setDownloadJobs(jobs)
    send({ type: "downloadModel", modelId, url, name })
  }

  function getDownloadProgress(modelId: string): number {
    const job = downloadJobs().get(modelId)
    if (!job || job.totalBytes <= 0) return 0
    return Math.round((job.receivedBytes / job.totalBytes) * 100)
  }

  function isDownloading(modelId: string): boolean {
    return downloadJobs().has(modelId)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div class="vs-root">
      {/* Header */}
      <div class="vs-header">
        <div class="vs-header-top">
          <h1 class="vs-header-title">Voice Studio</h1>
          <div class="vs-header-tabs">
            <button
              class={`vs-tab${activeTab() === "library" ? " vs-tab--active" : ""}`}
              onClick={() => setActiveTab("library")}
              type="button"
            >
              Library
            </button>
            <button
              class={`vs-tab${activeTab() === "store" ? " vs-tab--active" : ""}`}
              onClick={() => setActiveTab("store")}
              type="button"
            >
              Store
            </button>
          </div>
          <div class="vs-header-actions">
            <ViewToggle mode={viewMode()} onChange={setViewMode} />
          </div>
        </div>
        <div class="vs-header-bottom">
          <SearchBar
            query={searchQuery()}
            onQueryChange={setSearchQuery}
            voices={voices()}
            recentSearches={recentSearches()}
            onSelectVoice={(v) => setSearchQuery(v.name)}
            onSelectRecent={(q) => setSearchQuery(q)}
          />
        </div>
      </div>

      {/* Content */}
      <div class="vs-content">
        {/* Filter bar (uses library voices for counts) */}
        <FilterBar
          filters={filters()}
          onFiltersChange={setFilters}
          voices={voices()}
          searchQuery={searchQuery()}
        />

        {/* Library tab */}
        <Show when={activeTab() === "library"}>
          <Show when={libraryError()}>
            {(err) => <div class="vs-error">{err()}</div>}
          </Show>

          <Show when={libraryLoading() && !libraryError()}>
            <div class="vs-loading">
              <div class="vs-spinner" />
              <span>Loading voice library...</span>
            </div>
          </Show>

          <Show when={!libraryLoading() && !libraryError() && filteredLibrary().length === 0}>
            <div class="vs-empty">
              <div class="vs-empty-icon">
                <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                  <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
                  <path d="M4 6a1 1 0 0 0-2 0 6 6 0 0 0 5 5.91V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-2.09A6 6 0 0 0 14 6a1 1 0 0 0-2 0 4 4 0 0 1-8 0z" />
                </svg>
              </div>
              <div class="vs-empty-title">No voices found</div>
              <div class="vs-empty-desc">
                {searchQuery() || filters().gender || filters().accents.length
                  ? "Try adjusting your search or filters."
                  : "Your voice library is empty. Visit the Store tab to download voices."}
              </div>
            </div>
          </Show>

          <Show when={!libraryLoading() && !libraryError() && filteredLibrary().length > 0}>
            <Show when={viewMode() === "grid"} fallback={
              <div class="vs-list">
                <For each={filteredLibrary()}>
                  {(voice) => (
                    <VoiceRow
                      voice={voice}
                      onPreview={() => handlePreview(voice.id)}
                      onFavorite={() => handleFavorite(voice.id)}
                      onSetActive={() => handleSetActive(voice.id, voice.provider)}
                      isPlaying={playingVoiceId() === voice.id}
                      isDownloading={isDownloading(voice.id)}
                      downloadProgress={getDownloadProgress(voice.id)}
                      isFavorite={favorites().includes(voice.id)}
                    />
                  )}
                </For>
              </div>
            }>
              <div class="vs-grid">
                <For each={filteredLibrary()}>
                  {(voice) => (
                    <VoiceCard
                      voice={voice}
                      onPreview={() => handlePreview(voice.id)}
                      onFavorite={() => handleFavorite(voice.id)}
                      onSetActive={() => handleSetActive(voice.id, voice.provider)}
                      isPlaying={playingVoiceId() === voice.id}
                      isDownloading={isDownloading(voice.id)}
                      downloadProgress={getDownloadProgress(voice.id)}
                      isFavorite={favorites().includes(voice.id)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>

        {/* Store tab */}
        <Show when={activeTab() === "store"}>
          <Show when={storeError()}>
            {(err) => <div class="vs-error">{err()}</div>}
          </Show>

          <Show when={storeLoading() && !storeError()}>
            <div class="vs-loading">
              <div class="vs-spinner" />
              <span>Loading voice store...</span>
            </div>
          </Show>

          <Show when={!storeLoading() && !storeError() && filteredStore().length === 0}>
            <div class="vs-empty">
              <div class="vs-empty-icon">
                <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                  <path d="M8 1v9.5l-3-3-1.4 1.4L8 13.3l4.4-4.4L11 7.5 8 10.5V1zM2 14h12v1H2z" />
                </svg>
              </div>
              <div class="vs-empty-title">No voices available</div>
              <div class="vs-empty-desc">
                {searchQuery() || filters().gender || filters().accents.length
                  ? "Try adjusting your search or filters."
                  : "The voice store is currently empty or unreachable. Check your connection to the model server."}
              </div>
            </div>
          </Show>

          <Show when={!storeLoading() && !storeError() && filteredStore().length > 0}>
            {/* Disk usage summary */}
            <Show when={diskUsage()}>
              {(du) => (
                <div style={{
                  "font-size": "11px",
                  color: "var(--vscode-descriptionForeground)",
                  "margin-bottom": "8px",
                }}>
                  {du().modelCount} models installed
                  {" \u2022 "}
                  {(du().usedBytes / (1024 * 1024)).toFixed(1)} MB / {(du().maxBytes / (1024 * 1024)).toFixed(0)} MB used
                </div>
              )}
            </Show>

            <Show when={viewMode() === "grid"} fallback={
              <div class="vs-list">
                <For each={filteredStore()}>
                  {(voice) => (
                    <VoiceRow
                      voice={voice}
                      onPreview={() => handlePreview(voice.id)}
                      onDownload={() => {
                        const sv = storeVoices().find((s) => s.id === voice.id)
                        if (sv) handleDownload(sv.id, sv.downloadUrl, sv.name)
                      }}
                      isPlaying={playingVoiceId() === voice.id}
                      isDownloading={isDownloading(voice.id)}
                      downloadProgress={getDownloadProgress(voice.id)}
                      isFavorite={favorites().includes(voice.id)}
                    />
                  )}
                </For>
              </div>
            }>
              <div class="vs-grid">
                <For each={filteredStore()}>
                  {(voice) => (
                    <VoiceCard
                      voice={voice}
                      onPreview={() => handlePreview(voice.id)}
                      onDownload={() => {
                        const sv = storeVoices().find((s) => s.id === voice.id)
                        if (sv) handleDownload(sv.id, sv.downloadUrl, sv.name)
                      }}
                      isPlaying={playingVoiceId() === voice.id}
                      isDownloading={isDownloading(voice.id)}
                      downloadProgress={getDownloadProgress(voice.id)}
                      isFavorite={favorites().includes(voice.id)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      {/* Audio player bar — shown when something is playing */}
      <Show when={playingVoiceId()}>
        <AudioPlayer
          isPlaying={!!(audioRef && !audioRef.paused)}
          currentTime={playerTime()}
          duration={playerDuration()}
          onPlayPause={togglePlayPause}
          onStop={stopAudio}
        />
      </Show>
    </div>
  )
}
