import { Component, createSignal, createMemo, Show, For } from "solid-js"
import type { VoiceEntry, StoreVoiceEntry, FilterState, DiskUsageResponse, DownloadJob } from "../../src/types/voice"
import { combinedSearch } from "../../src/utils/voice-search"
import { VoiceCard } from "../components/VoiceCard"
import { VoiceRow } from "../components/VoiceRow"

const ITEMS_PER_PAGE = 24

export interface StoreTabProps {
  storeVoices: StoreVoiceEntry[]
  libraryVoices: VoiceEntry[]
  searchQuery: string
  filters: FilterState
  viewMode: "grid" | "list"
  favorites: string[]
  playingVoiceId: string | null
  downloadJobs: Map<string, DownloadJob>
  diskUsage: DiskUsageResponse | null
  storeLoading: boolean
  storeError: string | null
  onPreview: (voiceId: string) => void
  onPreviewCustom: (voiceId: string, text: string) => void
  onDownload: (modelId: string, url: string, name: string) => void
  onCancelDownload: (modelId: string) => void
  isDownloading: (id: string) => boolean
  getDownloadProgress: (id: string) => number
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export const StoreTab: Component<StoreTabProps> = (props) => {
  const [currentPage, setCurrentPage] = createSignal(1)
  const [customPreviewId, setCustomPreviewId] = createSignal<string | null>(null)
  const [customPreviewText, setCustomPreviewText] = createSignal("")

  const installedIds = createMemo(() => {
    return new Set(props.libraryVoices.map((v) => v.id))
  })

  const asVoiceEntries = createMemo((): VoiceEntry[] => {
    const installed = installedIds()
    return props.storeVoices.map((sv) => ({
      id: sv.id,
      provider: "rvc" as const,
      name: sv.name,
      description: sv.description,
      gender: sv.gender,
      accent: sv.accent,
      accentLabel: sv.accentLabel,
      style: sv.style,
      quality: sv.quality,
      sampleRate: sv.sampleRate,
      fileSize: sv.fileSize,
      epochs: sv.epochs,
      tags: sv.tags,
      installed: installed.has(sv.id),
      favorite: props.favorites.includes(sv.id),
      heroClipUrl: sv.heroClipUrl ?? undefined,
      downloadUrl: sv.downloadUrl,
      lastUsed: undefined,
    }))
  })

  const filtered = createMemo(() => {
    const result = combinedSearch(asVoiceEntries(), props.searchQuery, props.filters)
    // Reset to page 1 whenever results change
    setCurrentPage(1)
    return result
  })

  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / ITEMS_PER_PAGE)))

  const pagedVoices = createMemo(() => {
    const page = currentPage()
    const start = (page - 1) * ITEMS_PER_PAGE
    return filtered().slice(start, start + ITEMS_PER_PAGE)
  })

  const pageNumbers = createMemo(() => {
    const total = totalPages()
    const current = currentPage()
    const pages: number[] = []

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i)
    } else {
      pages.push(1)
      if (current > 3) pages.push(-1) // ellipsis sentinel
      const start = Math.max(2, current - 1)
      const end = Math.min(total - 1, current + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (current < total - 2) pages.push(-1) // ellipsis sentinel
      pages.push(total)
    }

    return pages
  })

  const activeDownloads = createMemo(() => {
    const jobs: DownloadJob[] = []
    props.downloadJobs.forEach((job) => {
      if (job.status === "downloading" || job.status === "queued" || job.status === "extracting" || job.status === "installing") {
        jobs.push(job)
      }
    })
    return jobs
  })

  function getStoreVoice(id: string): StoreVoiceEntry | undefined {
    return props.storeVoices.find((s) => s.id === id)
  }

  function handleHeroPreview(voiceId: string) {
    props.onPreview(voiceId)
  }

  function openCustomPreview(voiceId: string) {
    setCustomPreviewId(voiceId)
    setCustomPreviewText("")
  }

  function submitCustomPreview() {
    const id = customPreviewId()
    const text = customPreviewText().trim()
    if (id && text) {
      props.onPreviewCustom(id, text)
    }
    setCustomPreviewId(null)
    setCustomPreviewText("")
  }

  function cancelCustomPreview() {
    setCustomPreviewId(null)
    setCustomPreviewText("")
  }

  function handleDownload(voiceId: string) {
    const sv = getStoreVoice(voiceId)
    if (sv) {
      props.onDownload(sv.id, sv.downloadUrl, sv.name)
    }
  }

  function downloadProgressPct(job: DownloadJob): number {
    if (job.totalBytes <= 0) return 0
    return Math.round((job.receivedBytes / job.totalBytes) * 100)
  }

  return (
    <div class="vs-store-tab">
      {/* Loading state */}
      <Show when={props.storeLoading && !props.storeError}>
        <div class="vs-loading">
          <div class="vs-spinner" />
          <span>Store loading...</span>
        </div>
      </Show>

      {/* Error state */}
      <Show when={props.storeError}>
        {(err) => <div class="vs-error">{err()}</div>}
      </Show>

      {/* Content */}
      <Show when={!props.storeLoading && !props.storeError}>
        {/* Disk usage indicator */}
        <Show when={props.diskUsage}>
          {(du) => (
            <div class="vs-disk-usage">
              <div class="vs-disk-usage-text">
                {formatBytes(du().usedBytes)} / {formatBytes(du().maxBytes)} used
              </div>
              <div class="vs-disk-usage-bar">
                <div
                  class="vs-disk-usage-bar-fill"
                  style={{
                    width: `${Math.min(100, du().maxBytes > 0 ? (du().usedBytes / du().maxBytes) * 100 : 0)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Show>

        {/* Result count */}
        <Show when={filtered().length > 0}>
          <div
            style={{
              "font-size": "11px",
              color: "var(--vscode-descriptionForeground)",
              "margin-bottom": "8px",
            }}
          >
            Showing {(currentPage() - 1) * ITEMS_PER_PAGE + 1}-
            {Math.min(currentPage() * ITEMS_PER_PAGE, filtered().length)} of {filtered().length} models
          </div>
        </Show>

        {/* Empty state */}
        <Show when={filtered().length === 0 && props.storeVoices.length > 0}>
          <div class="vs-empty">
            <div class="vs-empty-icon">
              <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                <path d="M8 1v9.5l-3-3-1.4 1.4L8 13.3l4.4-4.4L11 7.5 8 10.5V1zM2 14h12v1H2z" />
              </svg>
            </div>
            <div class="vs-empty-title">No models match your search</div>
            <div class="vs-empty-desc">Try adjusting your search or filters.</div>
          </div>
        </Show>

        <Show when={filtered().length === 0 && props.storeVoices.length === 0}>
          <div class="vs-empty">
            <div class="vs-empty-icon">
              <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                <path d="M8 1v9.5l-3-3-1.4 1.4L8 13.3l4.4-4.4L11 7.5 8 10.5V1zM2 14h12v1H2z" />
              </svg>
            </div>
            <div class="vs-empty-title">No models available</div>
            <div class="vs-empty-desc">
              The voice store is currently empty or unreachable. Check your connection to the model server.
            </div>
          </div>
        </Show>

        {/* Custom preview inline input */}
        <Show when={customPreviewId()}>
          <div class="vs-custom-preview">
            <label style={{ "font-size": "12px", color: "var(--vscode-foreground)" }}>
              Custom preview text:
            </label>
            <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
              <input
                type="text"
                class="vs-input"
                value={customPreviewText()}
                onInput={(e) => setCustomPreviewText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCustomPreview()
                  if (e.key === "Escape") cancelCustomPreview()
                }}
                placeholder="Type text to preview..."
                autofocus
                style={{ flex: "1" }}
              />
              <button
                class="vs-btn vs-btn--primary"
                onClick={submitCustomPreview}
                type="button"
                disabled={!customPreviewText().trim()}
              >
                Preview
              </button>
              <button class="vs-btn" onClick={cancelCustomPreview} type="button">
                Cancel
              </button>
            </div>
          </div>
        </Show>

        {/* Voice grid / list */}
        <Show when={pagedVoices().length > 0}>
          <Show
            when={props.viewMode === "grid"}
            fallback={
              <div class="vs-list">
                <For each={pagedVoices()}>
                  {(voice) => (
                    <div class="vs-store-item-wrapper">
                      <VoiceRow
                        voice={voice}
                        onPreview={() => handleHeroPreview(voice.id)}
                        onDownload={() => handleDownload(voice.id)}
                        isPlaying={props.playingVoiceId === voice.id}
                        isDownloading={props.isDownloading(voice.id)}
                        downloadProgress={props.getDownloadProgress(voice.id)}
                        isFavorite={props.favorites.includes(voice.id)}
                      />
                      <div class="vs-store-item-actions">
                        <Show when={voice.heroClipUrl}>
                          <button
                            class={`vs-btn vs-btn--sm${props.playingVoiceId === voice.id ? " vs-btn--primary" : ""}`}
                            onClick={() => handleHeroPreview(voice.id)}
                            type="button"
                          >
                            {props.playingVoiceId === voice.id ? "Stop" : "Hero Clip"}
                          </button>
                        </Show>
                        <button
                          class="vs-btn vs-btn--sm"
                          onClick={() => openCustomPreview(voice.id)}
                          type="button"
                        >
                          Custom Preview
                        </button>
                        <Show when={voice.installed}>
                          <span class="vs-badge vs-badge--installed">Installed</span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <div class="vs-grid">
              <For each={pagedVoices()}>
                {(voice) => (
                  <div class="vs-store-card-wrapper">
                    <VoiceCard
                      voice={voice}
                      onPreview={() => handleHeroPreview(voice.id)}
                      onDownload={() => handleDownload(voice.id)}
                      isPlaying={props.playingVoiceId === voice.id}
                      isDownloading={props.isDownloading(voice.id)}
                      downloadProgress={props.getDownloadProgress(voice.id)}
                      isFavorite={props.favorites.includes(voice.id)}
                    />
                    <div class="vs-store-card-extra">
                      <Show when={voice.heroClipUrl}>
                        <button
                          class={`vs-icon-btn${props.playingVoiceId === voice.id ? " vs-icon-btn--primary" : ""}`}
                          onClick={() => handleHeroPreview(voice.id)}
                          type="button"
                          title={props.playingVoiceId === voice.id ? "Stop hero clip" : "Play hero clip"}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            {props.playingVoiceId === voice.id ? (
                              <rect x="3" y="3" width="10" height="10" rx="1" />
                            ) : (
                              <path d="M4 2 L14 8 L4 14 Z" />
                            )}
                          </svg>
                        </button>
                      </Show>
                      <button
                        class="vs-icon-btn"
                        onClick={() => openCustomPreview(voice.id)}
                        type="button"
                        title="Custom preview"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M14 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h4l2 3 2-3h4a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM4 6h8v1H4V6zM4 4h8v1H4V4z" />
                        </svg>
                      </button>
                      <Show when={voice.installed}>
                        <span class="vs-badge vs-badge--installed">Installed</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* Pagination */}
        <Show when={totalPages() > 1}>
          <div class="vs-pagination">
            <button
              class="vs-btn vs-btn--sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage() === 1}
              type="button"
            >
              Previous
            </button>
            <For each={pageNumbers()}>
              {(page) => (
                <Show
                  when={page > 0}
                  fallback={<span class="vs-pagination-ellipsis">...</span>}
                >
                  <button
                    class={`vs-btn vs-btn--sm${currentPage() === page ? " vs-btn--primary" : ""}`}
                    onClick={() => setCurrentPage(page)}
                    type="button"
                  >
                    {page}
                  </button>
                </Show>
              )}
            </For>
            <button
              class="vs-btn vs-btn--sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages(), p + 1))}
              disabled={currentPage() === totalPages()}
              type="button"
            >
              Next
            </button>
          </div>
        </Show>
      </Show>

      {/* Download Queue bar */}
      <Show when={activeDownloads().length > 0}>
        <div class="vs-download-queue">
          <div class="vs-download-queue-title">
            Downloads ({activeDownloads().length})
          </div>
          <For each={activeDownloads()}>
            {(job) => (
              <div class="vs-download-queue-item">
                <span class="vs-download-queue-name">{job.name || job.modelId}</span>
                <div class="vs-download-queue-progress">
                  <div
                    class="vs-download-queue-progress-fill"
                    style={{ width: `${downloadProgressPct(job)}%` }}
                  />
                </div>
                <span class="vs-download-queue-pct">{downloadProgressPct(job)}%</span>
                <button
                  class="vs-icon-btn"
                  onClick={() => props.onCancelDownload(job.modelId)}
                  type="button"
                  title="Cancel download"
                  aria-label="Cancel download"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 6.586L12.293 2.293l1.414 1.414L9.414 8l4.293 4.293-1.414 1.414L8 9.414l-4.293 4.293-1.414-1.414L6.586 8 2.293 3.707l1.414-1.414z" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
