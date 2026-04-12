import { Component, Show, For } from "solid-js"
import type { VoiceEntry, StoreVoiceEntry, VoiceProvider, VoiceGender } from "../../src/types/voice"
import { VoiceAvatar } from "./VoiceAvatar"

export interface VoiceRowProps {
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
  if (bytes <= 0) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatSampleRate(rate: number): string {
  if (!rate) return "-"
  return `${(rate / 1000).toFixed(0)}kHz`
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

export const VoiceRow: Component<VoiceRowProps> = (props) => {
  const provider = () => getProvider(props.voice)
  const gender = () => getGender(props.voice)
  const favorite = () => getIsFavorite(props.voice, props.isFavorite)
  const installed = () => isInstalled(props.voice) && props.voice.installed

  return (
    <div class="vs-row">
      {/* Favorite star */}
      <div class="vs-row-cell">
        <Show when={props.onFavorite} fallback={<span />}>
          <button
            class={`vs-icon-btn${favorite() ? " vs-icon-btn--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); props.onFavorite?.() }}
            type="button"
            title={favorite() ? "Remove from favorites" : "Add to favorites"}
            aria-label={favorite() ? "Remove from favorites" : "Add to favorites"}
            style={{ width: "22px", height: "22px", "font-size": "12px" }}
          >
            {favorite() ? "\u2605" : "\u2606"}
          </button>
        </Show>
      </div>

      {/* Avatar */}
      <div class="vs-row-cell">
        <VoiceAvatar provider={provider()} gender={gender()} small />
      </div>

      {/* Name */}
      <div class="vs-row-cell vs-row-name" title={props.voice.name}>
        {props.voice.name}
      </div>

      {/* Gender */}
      <div class="vs-row-cell vs-row-secondary vs-row-hide-narrow">
        {gender() === "male" ? "\u2642 Male" : gender() === "female" ? "\u2640 Female" : "\u26A7 Neutral"}
      </div>

      {/* Accent */}
      <div class="vs-row-cell vs-row-secondary vs-row-hide-narrow" title={props.voice.accentLabel || props.voice.accent}>
        {props.voice.accentLabel || props.voice.accent}
      </div>

      {/* Style */}
      <div class="vs-row-cell vs-row-secondary vs-row-hide-narrow">
        {props.voice.style}
      </div>

      {/* Quality */}
      <div class="vs-row-cell vs-row-hide-narrow">
        <div class="vs-stars">
          <For each={[1, 2, 3, 4, 5]}>
            {(n) => (
              <span class={n <= props.voice.quality ? "vs-star--filled" : "vs-star--empty"}>
                {n <= props.voice.quality ? "\u2605" : "\u2606"}
              </span>
            )}
          </For>
        </div>
      </div>

      {/* Sample rate */}
      <div class="vs-row-cell vs-row-secondary vs-row-hide-narrow">
        {formatSampleRate(props.voice.sampleRate)}
      </div>

      {/* Size */}
      <div class="vs-row-cell vs-row-secondary vs-row-hide-narrow">
        {formatFileSize(props.voice.fileSize)}
      </div>

      {/* Provider */}
      <div class="vs-row-cell vs-row-hide-narrow">
        <span class="vs-card-provider">{provider()}</span>
      </div>

      {/* Actions */}
      <div class="vs-row-actions">
        {/* Preview */}
        <button
          class={`vs-icon-btn${props.isPlaying ? " vs-icon-btn--primary" : ""}`}
          onClick={(e) => { e.stopPropagation(); props.onPreview() }}
          type="button"
          title={props.isPlaying ? "Stop preview" : "Preview voice"}
          aria-label={props.isPlaying ? "Stop preview" : "Preview voice"}
          style={{ width: "22px", height: "22px" }}
        >
          {props.isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2 L14 8 L4 14 Z" />
            </svg>
          )}
        </button>

        {/* Set active */}
        <Show when={installed() && props.onSetActive}>
          <button
            class="vs-icon-btn vs-icon-btn--primary"
            onClick={(e) => { e.stopPropagation(); props.onSetActive?.() }}
            type="button"
            title="Set as active voice"
            aria-label="Set as active voice"
            style={{ width: "22px", height: "22px" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.5 12.5l-4-4 1.4-1.4L6.5 9.7l5.6-5.6 1.4 1.4z" />
            </svg>
          </button>
        </Show>

        {/* Download */}
        <Show when={!installed() && props.onDownload && !props.isDownloading}>
          <button
            class="vs-icon-btn vs-icon-btn--primary"
            onClick={(e) => { e.stopPropagation(); props.onDownload?.() }}
            type="button"
            title="Download voice"
            aria-label="Download voice"
            style={{ width: "22px", height: "22px" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1v9.5l-3-3-1.4 1.4L8 13.3l4.4-4.4L11 7.5 8 10.5V1zM2 14h12v1H2z" />
            </svg>
          </button>
        </Show>

        {/* Download progress inline */}
        <Show when={props.isDownloading}>
          <span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
            {props.downloadProgress}%
          </span>
        </Show>
      </div>
    </div>
  )
}
