import { Component, createSignal, createMemo, Show, For } from "solid-js"
import type { VoiceEntry, FilterState } from "../../src/types/voice"
import { combinedSearch } from "../../src/utils/voice-search"
import { VoiceCard } from "../components/VoiceCard"
import { VoiceRow } from "../components/VoiceRow"

type SubTab = "all" | "favorites" | "recent"

export interface LibraryTabProps {
  voices: VoiceEntry[]
  searchQuery: string
  filters: FilterState
  viewMode: "grid" | "list"
  favorites: string[]
  activeVoiceId: string | null
  playingVoiceId: string | null
  isDownloading: (id: string) => boolean
  getDownloadProgress: (id: string) => number
  onPreview: (voiceId: string) => void
  onFavorite: (voiceId: string) => void
  onSetActive: (voiceId: string, provider: string) => void
}

export const LibraryTab: Component<LibraryTabProps> = (props) => {
  const [subTab, setSubTab] = createSignal<SubTab>("all")

  const subTabFiltered = createMemo(() => {
    const tab = subTab()
    const allVoices = props.voices

    if (tab === "favorites") {
      return allVoices.filter((v) => v.favorite || props.favorites.includes(v.id))
    }

    if (tab === "recent") {
      return allVoices
        .filter((v) => v.lastUsed !== null && v.lastUsed !== undefined)
        .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
    }

    return allVoices
  })

  const filtered = createMemo(() => {
    return combinedSearch(subTabFiltered(), props.searchQuery, props.filters)
  })

  const totalCount = createMemo(() => subTabFiltered().length)

  const activeVoice = createMemo(() => {
    if (!props.activeVoiceId) return null
    return props.voices.find((v) => v.id === props.activeVoiceId) ?? null
  })

  const emptyMessage = createMemo(() => {
    const tab = subTab()
    const hasSearch = props.searchQuery || props.filters.gender || props.filters.accents.length > 0

    if (tab === "favorites") {
      return hasSearch ? "No favorites match your search" : "No favorites yet"
    }
    if (tab === "recent") {
      return hasSearch ? "No recent voices match your search" : "No recent voices"
    }
    return hasSearch ? "No voices match your search" : "No voices installed -- visit the Store tab"
  })

  return (
    <div class="vs-library-tab">
      {/* Sub-tab bar */}
      <div class="vs-subtabs">
        <button
          class={`vs-subtab${subTab() === "all" ? " vs-subtab--active" : ""}`}
          onClick={() => setSubTab("all")}
          type="button"
        >
          All
        </button>
        <button
          class={`vs-subtab${subTab() === "favorites" ? " vs-subtab--active" : ""}`}
          onClick={() => setSubTab("favorites")}
          type="button"
        >
          Favorites
        </button>
        <button
          class={`vs-subtab${subTab() === "recent" ? " vs-subtab--active" : ""}`}
          onClick={() => setSubTab("recent")}
          type="button"
        >
          Recent
        </button>
      </div>

      {/* Result count */}
      <Show when={filtered().length > 0 || totalCount() > 0}>
        <div
          style={{
            "font-size": "11px",
            color: "var(--vscode-descriptionForeground)",
            "margin-bottom": "8px",
          }}
        >
          Showing {filtered().length} of {totalCount()} voices
        </div>
      </Show>

      {/* Empty state */}
      <Show when={filtered().length === 0}>
        <div class="vs-empty">
          <div class="vs-empty-icon">
            <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
              <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
              <path d="M4 6a1 1 0 0 0-2 0 6 6 0 0 0 5 5.91V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-2.09A6 6 0 0 0 14 6a1 1 0 0 0-2 0 4 4 0 0 1-8 0z" />
            </svg>
          </div>
          <div class="vs-empty-title">
            {subTab() === "favorites"
              ? "No favorites"
              : subTab() === "recent"
                ? "No recent voices"
                : "No voices found"}
          </div>
          <div class="vs-empty-desc">{emptyMessage()}</div>
        </div>
      </Show>

      {/* Voice grid / list */}
      <Show when={filtered().length > 0}>
        <Show
          when={props.viewMode === "grid"}
          fallback={
            <div class="vs-list">
              <For each={filtered()}>
                {(voice) => (
                  <VoiceRow
                    voice={voice}
                    onPreview={() => props.onPreview(voice.id)}
                    onFavorite={() => props.onFavorite(voice.id)}
                    onSetActive={() => props.onSetActive(voice.id, voice.provider)}
                    isPlaying={props.playingVoiceId === voice.id}
                    isDownloading={props.isDownloading(voice.id)}
                    downloadProgress={props.getDownloadProgress(voice.id)}
                    isFavorite={props.favorites.includes(voice.id)}
                  />
                )}
              </For>
            </div>
          }
        >
          <div class="vs-grid">
            <For each={filtered()}>
              {(voice) => (
                <VoiceCard
                  voice={voice}
                  onPreview={() => props.onPreview(voice.id)}
                  onFavorite={() => props.onFavorite(voice.id)}
                  onSetActive={() => props.onSetActive(voice.id, voice.provider)}
                  isPlaying={props.playingVoiceId === voice.id}
                  isDownloading={props.isDownloading(voice.id)}
                  downloadProgress={props.getDownloadProgress(voice.id)}
                  isFavorite={props.favorites.includes(voice.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Now Playing bar */}
      <Show when={activeVoice()}>
        {(voice) => (
          <div class="vs-now-playing">
            <span class="vs-now-playing-label">Now Playing:</span>
            <span class="vs-now-playing-name">{voice().name}</span>
            <span class="vs-now-playing-provider">{voice().provider}</span>
          </div>
        )}
      </Show>
    </div>
  )
}
