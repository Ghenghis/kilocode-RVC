/**
 * ElapsedTimer — Live-updating MM:SS or HH:MM:SS clock.
 * Shows elapsed time since `startedAt` timestamp.
 * Updates every second. Stops when `stopped` is true.
 */
import { Component, createSignal, onCleanup, onMount, createEffect } from "solid-js"

interface ElapsedTimerProps {
  startedAt: number           // Date.now() timestamp
  stopped?: boolean           // Freeze the timer
  stoppedAt?: number          // Final timestamp (shows total instead of live)
  class?: string
  style?: Record<string, string>
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

export const ElapsedTimer: Component<ElapsedTimerProps> = (props) => {
  const [display, setDisplay] = createSignal("00:00")
  let intervalId: ReturnType<typeof setInterval> | undefined

  const update = () => {
    if (props.stopped && props.stoppedAt) {
      setDisplay(formatDuration(props.stoppedAt - props.startedAt))
      return
    }
    if (props.stopped) return
    setDisplay(formatDuration(Date.now() - props.startedAt))
  }

  onMount(() => {
    update()
    intervalId = setInterval(update, 1000)
  })

  createEffect(() => {
    if (props.stopped && intervalId) {
      clearInterval(intervalId)
      intervalId = undefined
      update() // one final update
    }
  })

  onCleanup(() => {
    if (intervalId) clearInterval(intervalId)
  })

  return (
    <span
      class={props.class}
      style={{
        "font-family": "var(--vscode-editor-font-family, monospace)",
        "font-size": "11px",
        color: "var(--vscode-descriptionForeground)",
        "letter-spacing": "0.5px",
        ...props.style,
      }}
    >
      {display()}
    </span>
  )
}

export { formatDuration }
export default ElapsedTimer
