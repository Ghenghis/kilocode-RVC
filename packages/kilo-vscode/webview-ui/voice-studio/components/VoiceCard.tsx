import { Component, Show, For } from "solid-js"
import type { VoiceEntry, StoreVoiceEntry, VoiceProvider, VoiceGender } from "../../src/types/voice"
import { VoiceAvatar } from "./VoiceAvatar"

export interface VoiceCardProps {
  voice: VoiceEntry | StoreVoiceEntry
  onPreview: () => void
  onFavorite?: () => void
  onSetActive?: () => void
  onDownload?: () => void
  isPlaying: boolean
  isDownloading: boolean
  downloadProgress: number
  isFavorite?: boolean
}

function isInstalled(voice: VoiceEntry | StoreVoiceEntry): voice is VoiceEntry {
  return "installed" in voice
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getProvider(voice: VoiceEntry | StoreVoiceEntry): VoiceProvider | string {
  if ("provider" in voice) return (voice as VoiceEntry).provider
  return "rvc"
}

function getGender(voice: VoiceEntry | StoreVoiceEntry): VoiceGender {
  return voice.gender
}

function getIsFavorite(voice: VoiceEntry | StoreVoiceEntry, propFav?: boolean): boolean {
  if (propFav !== undefined) return propFav
  if ("favorite" in voice) return (voice as VoiceEntry).favorite
  return false
}

export const VoiceCard: Component<VoiceCardProps> = (props) => {
  const provider = () => getProvider(props.voice)
  const gender = () => getGender(props.voice)
  const favorite = () => getIsFavorite(props.voice, props.isFavorite)
  const tags = () => props.voice.tags.slice(0, 3)
  const installed = () => isInstalled(props.voice) && props.voice.installed

  return (
    <div class="vs-card">
      <div class="vs-card-header">
        <VoiceAvatar provider={provider()} gender={gender()} />
        <span class="vs-card-name" title={props.voice.name}>{props.voice.name}</span>
      </div>

      <div class="vs-card-meta">
        <span class="vs-card-meta-item">
          {gender() === "male" ? "\u2642" : gender() === "female" ? "\u2640" : "\u26A7"}
          {" "}{props.voice.accentLabel || props.voice.accent}
        </span>
        <span class="vs-card-meta-item">{props.voice.style}</span>
      </div>

      {/* Quality stars */}
      <div class="vs-stars">
        <For each={[1, 2, 3, 4, 5]}>
          {(n) => (
            <span class={n <= props.voice.quality ? "vs-star--filled" : "vs-star--empty"}>
              {n <= props.voice.quality ? "\u2605" : "\u2606"}
            </span>
          )}
        </For>
      </div>

      {/* Tags */}
      <Show when={tags().length > 0}>
        <div class="vs-card-tags">
          <For each={tags()}>
            {(tag) => <span class="vs-card-tag">{tag}</span>}
          </For>
        </div>
      </Show>

      {/* Footer: size + provider badge */}
      <div class="vs-card-footer">
        <span class="vs-card-size">{formatFileSize(props.voice.fileSize)}</span>
        <span class="vs-card-provider">{provider()}</span>
      </div>

      {/* Download progress bar */}
      <Show when={props.isDownloading}>
        <div class="vs-dl-bar">
          <div class="vs-dl-bar-fill" style={{ width: `${props.downloadProgress}%` }} />
        </div>
      </Show>

      {/* Actions */}
      <div class="vs-card-actions">
        {/* Preview */}
        <button
          class={`vs-icon-btn${props.isPlaying ? " vs-icon-btn--primary" : ""}`}
          onClick={(e) => { e.stopPropagation(); props.onPreview() }}
          type="button"
          title={props.isPlaying ? "Stop preview" : "Preview voice"}
          aria-label={props.isPlaying ? "Stop preview" : "Preview voice"}
        >
          {props.isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2 L14 8 L4 14 Z" />
            </svg>
          )}
        </button>

        {/* Favorite */}
        <Show when={props.onFavorite}>
          <button
            class={`vs-icon-btn${favorite() ? " vs-icon-btn--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); props.onFavorite?.() }}
            type="button"
            title={favorite() ? "Remove from favorites" : "Add to favorites"}
            aria-label={favorite() ? "Remove from favorites" : "Add to favorites"}
          >
            {favorite() ? "\u2605" : "\u2606"}
          </button>
        </Show>

        {/* Set active or Download */}
        <Show when={installed() && props.onSetActive}>
          <button
            class="vs-icon-btn vs-icon-btn--primary"
            onClick={(e) => { e.stopPropagation(); props.onSetActive?.() }}
            type="button"
            title="Set as active voice"
            aria-label="Set as active voice"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.5 12.5l-4-4 1.4-1.4L6.5 9.7l5.6-5.6 1.4 1.4z" />
            </svg>
          </button>
        </Show>

        <Show when={!installed() && props.onDownload && !props.isDownloading}>
          <button
            class="vs-icon-btn vs-icon-btn--primary"
            onClick={(e) => { e.stopPropagation(); props.onDownload?.() }}
            type="button"
            title="Download voice"
            aria-label="Download voice"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1v9.5l-3-3-1.4 1.4L8 13.3l4.4-4.4L11 7.5 8 10.5V1zM2 14h12v1H2z" />
            </svg>
          </button>
        </Show>
      </div>
    </div>
  )
}
