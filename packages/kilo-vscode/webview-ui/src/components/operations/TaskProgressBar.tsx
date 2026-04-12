/**
 * TaskProgressBar — Animated progress bar with determinate and indeterminate modes.
 *
 * Determinate: filled bar from 0-100% with percentage label.
 * Indeterminate: pulsing animation for unknown-duration tasks.
 * Color coded by status: blue=active, green=complete, red=failed, amber=warning.
 */
import { Component } from "solid-js"

interface TaskProgressBarProps {
  /** 0-100 for determinate, undefined for indeterminate */
  percent?: number
  /** Visual status */
  status?: "active" | "completed" | "failed" | "warning"
  /** Show percentage text */
  showLabel?: boolean
  /** Height in px */
  height?: number
  class?: string
  style?: Record<string, string>
}

const STATUS_COLORS: Record<string, string> = {
  active: "var(--vscode-progressBar-background, #0078d4)",
  completed: "var(--vscode-testing-iconPassed, #4a4)",
  failed: "var(--vscode-testing-iconFailed, #f44)",
  warning: "var(--vscode-editorWarning-foreground, #fa0)",
}

export const TaskProgressBar: Component<TaskProgressBarProps> = (props) => {
  const height = () => props.height ?? 4
  const status = () => props.status ?? "active"
  const color = () => STATUS_COLORS[status()] ?? STATUS_COLORS.active
  const isDeterminate = () => props.percent !== undefined

  return (
    <div
      class={props.class}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        width: "100%",
        ...props.style,
      }}
    >
      <div
        style={{
          flex: "1",
          height: `${height()}px`,
          background: "var(--vscode-editorWidget-background, rgba(128,128,128,0.15))",
          "border-radius": `${height()}px`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {isDeterminate() ? (
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, props.percent!))}%`,
              background: color(),
              "border-radius": `${height()}px`,
              transition: "width 0.3s ease-out",
            }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              width: "40%",
              background: color(),
              "border-radius": `${height()}px`,
              animation: "kiloProgressPulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
      {props.showLabel && isDeterminate() && (
        <span
          style={{
            "font-size": "11px",
            "font-family": "var(--vscode-editor-font-family, monospace)",
            color: "var(--vscode-descriptionForeground)",
            "min-width": "36px",
            "text-align": "right",
          }}
        >
          {Math.round(props.percent!)}%
        </span>
      )}
    </div>
  )
}

export default TaskProgressBar
