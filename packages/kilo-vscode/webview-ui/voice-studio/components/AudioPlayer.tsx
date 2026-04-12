import { Component } from "solid-js"

export interface AudioPlayerProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onStop: () => void
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export const AudioPlayer: Component<AudioPlayerProps> = (props) => {
  const progressPct = () => {
    if (props.duration <= 0) return 0
    return Math.min(100, (props.currentTime / props.duration) * 100)
  }

  return (
    <div class="vs-player">
      <button
        class="vs-icon-btn"
        onClick={props.onPlayPause}
        type="button"
        title={props.isPlaying ? "Pause" : "Play"}
        aria-label={props.isPlaying ? "Pause" : "Play"}
      >
        {props.isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2" width="4" height="12" rx="1" />
            <rect x="9" y="2" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2 L14 8 L4 14 Z" />
          </svg>
        )}
      </button>

      <button
        class="vs-icon-btn"
        onClick={props.onStop}
        type="button"
        title="Stop"
        aria-label="Stop"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      </button>

      <div class="vs-player-progress">
        <div
          class="vs-player-progress-fill"
          style={{ width: `${progressPct()}%` }}
        />
      </div>

      <span class="vs-player-time">
        {formatTime(props.currentTime)} / {formatTime(props.duration)}
      </span>
    </div>
  )
}
