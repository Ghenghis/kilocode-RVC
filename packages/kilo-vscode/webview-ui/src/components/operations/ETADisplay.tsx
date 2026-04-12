/**
 * ETADisplay — Smart "time remaining" estimator.
 *
 * For downloads: calculates from bytes/second throughput.
 * For other tasks: uses historical average passed as `estimatedMs`.
 * First run: shows "timing..." instead of a wrong guess.
 */
import { Component, createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { formatDuration } from "./ElapsedTimer"

interface ETADisplayProps {
  /** Elapsed time in ms */
  elapsedMs: number
  /** Historical average duration (from ETA engine). Undefined = first run. */
  estimatedMs?: number
  /** For download ETA: bytes received so far */
  receivedBytes?: number
  /** For download ETA: total bytes expected */
  totalBytes?: number
  /** For download ETA: current speed in bytes/sec */
  bytesPerSecond?: number
  /** Task completed — show nothing or "done" */
  completed?: boolean
  class?: string
  style?: Record<string, string>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

export const ETADisplay: Component<ETADisplayProps> = (props) => {
  if (props.completed) {
    return null
  }

  const getETA = (): string => {
    // Download ETA: use throughput rate
    if (props.totalBytes && props.receivedBytes && props.bytesPerSecond && props.bytesPerSecond > 0) {
      const remaining = props.totalBytes - props.receivedBytes
      const etaMs = (remaining / props.bytesPerSecond) * 1000
      return `~${formatDuration(etaMs)} remaining · ${formatSpeed(props.bytesPerSecond)}`
    }

    // Historical ETA: use average from past runs
    if (props.estimatedMs && props.estimatedMs > 0) {
      const remaining = Math.max(0, props.estimatedMs - props.elapsedMs)
      if (remaining <= 0) return "finishing..."
      return `~${formatDuration(remaining)} remaining`
    }

    // No history: first run
    return "timing first run..."
  }

  const getTransferInfo = (): string | null => {
    if (props.receivedBytes !== undefined && props.totalBytes) {
      return `${formatBytes(props.receivedBytes)} / ${formatBytes(props.totalBytes)}`
    }
    if (props.receivedBytes !== undefined) {
      return formatBytes(props.receivedBytes)
    }
    return null
  }

  return (
    <span
      class={props.class}
      style={{
        "font-size": "11px",
        color: "var(--vscode-descriptionForeground)",
        ...props.style,
      }}
    >
      {getTransferInfo() ? `${getTransferInfo()} · ` : ""}
      {getETA()}
    </span>
  )
}

export { formatBytes, formatSpeed }
export default ETADisplay
