/**
 * OperationsDashboard — Floating collapsible panel showing all active operations.
 *
 * Renders at the bottom of Voice Studio or Speech Settings, showing:
 * - All active tasks with live progress bars and timers
 * - Completed tasks (fade after 5s)
 * - Failed tasks (persist with error + retry option)
 * - Minimized mode: just a badge with active task count
 */
import { Component, createSignal, For, Show, onCleanup, createEffect } from "solid-js"
import { ElapsedTimer, formatDuration } from "./ElapsedTimer"
import { ETADisplay, formatBytes, formatSpeed } from "./ETADisplay"
import { TaskProgressBar } from "./TaskProgressBar"
import { TaskChainView } from "./TaskChainView"

// ── Types (matches extension-side OperationMessage) ──────────────────────────

interface TaskStep {
  label: string
  status: "pending" | "active" | "completed" | "failed"
  startedAt?: number
  completedAt?: number
  detail?: string
}

export interface OperationState {
  id: string
  taskType: string
  label: string
  status: "active" | "completed" | "failed"
  startedAt: number
  completedAt?: number
  percent?: number
  receivedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  elapsedMs?: number
  estimatedMs?: number
  durationMs?: number
  steps?: TaskStep[]
  currentStep?: number
  detail?: string
  error?: string
  retryable?: boolean
}

interface OperationsDashboardProps {
  operations: OperationState[]
  onRetry?: (id: string) => void
  onDismiss?: (id: string) => void
  class?: string
}

// ── Sub-components ───────────────────────────────────────────────────────────

const TaskTypeIcon: Component<{ type: string }> = (props) => {
  const icons: Record<string, string> = {
    "docker-pull": "📦",
    "docker-build": "🔨",
    "docker-start": "🚀",
    "docker-restart": "🔄",
    "health-check": "💓",
    "model-download": "⬇️",
    "model-install": "📥",
    "model-delete": "🗑️",
    "catalog-fetch": "📋",
    "library-fetch": "📚",
    "voice-preview": "🔊",
    "azure-validate": "🔑",
    "store-fetch": "🏪",
    "container-exec": "⚙️",
  }
  return <span style={{ "font-size": "14px" }}>{icons[props.type] ?? "⏳"}</span>
}

const OperationCard: Component<{
  op: OperationState
  onRetry?: () => void
  onDismiss?: () => void
}> = (props) => {
  const op = () => props.op
  const hasSteps = () => op().steps && op().steps!.length > 0
  const hasProgress = () => op().percent !== undefined || op().receivedBytes !== undefined

  return (
    <div
      style={{
        background: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        border: `1px solid ${
          op().status === "failed"
            ? "var(--vscode-testing-iconFailed, #f44)"
            : op().status === "completed"
            ? "var(--vscode-testing-iconPassed, #4a4)"
            : "var(--vscode-panel-border, #444)"
        }`,
        "border-radius": "6px",
        padding: "10px 12px",
        "margin-bottom": "6px",
        opacity: op().status === "completed" ? "0.7" : "1",
        transition: "opacity 0.5s ease-out",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": hasSteps() || hasProgress() ? "8px" : "0",
        }}
      >
        <TaskTypeIcon type={op().taskType} />
        <span
          style={{
            flex: "1",
            "font-size": "12px",
            "font-weight": "600",
            color: "var(--vscode-foreground)",
          }}
        >
          {op().label}
        </span>

        {/* Live timer or final duration */}
        <Show when={op().status === "active"}>
          <ElapsedTimer startedAt={op().startedAt} />
        </Show>
        <Show when={op().status !== "active" && op().durationMs}>
          <span
            style={{
              "font-size": "11px",
              "font-family": "var(--vscode-editor-font-family, monospace)",
              color: op().status === "completed"
                ? "var(--vscode-testing-iconPassed, #4a4)"
                : "var(--vscode-testing-iconFailed, #f44)",
            }}
          >
            {formatDuration(op().durationMs!)}
          </span>
        </Show>

        {/* Status badge */}
        <span
          style={{
            "font-size": "10px",
            "font-weight": "600",
            "text-transform": "uppercase",
            padding: "2px 6px",
            "border-radius": "3px",
            background:
              op().status === "completed"
                ? "rgba(68,170,68,0.15)"
                : op().status === "failed"
                ? "rgba(255,68,68,0.15)"
                : "rgba(0,120,212,0.15)",
            color:
              op().status === "completed"
                ? "var(--vscode-testing-iconPassed, #4a4)"
                : op().status === "failed"
                ? "var(--vscode-testing-iconFailed, #f44)"
                : "var(--vscode-progressBar-background, #0078d4)",
          }}
        >
          {op().status}
        </span>
      </div>

      {/* Progress bar (for downloads, etc.) */}
      <Show when={hasProgress() && op().status === "active"}>
        <div style={{ "margin-bottom": "4px" }}>
          <TaskProgressBar
            percent={op().percent}
            status={op().status === "failed" ? "failed" : "active"}
            showLabel={op().percent !== undefined}
            height={6}
          />
        </div>
        <ETADisplay
          elapsedMs={op().elapsedMs ?? (Date.now() - op().startedAt)}
          estimatedMs={op().estimatedMs}
          receivedBytes={op().receivedBytes}
          totalBytes={op().totalBytes}
          bytesPerSecond={op().bytesPerSecond}
        />
      </Show>

      {/* Step chain (for multi-step operations) */}
      <Show when={hasSteps()}>
        <TaskChainView steps={op().steps!} currentStep={op().currentStep} />
      </Show>

      {/* Detail text */}
      <Show when={op().detail && !hasSteps()}>
        <div
          style={{
            "font-size": "11px",
            color: "var(--vscode-descriptionForeground)",
            "margin-top": "4px",
          }}
        >
          {op().detail}
        </div>
      </Show>

      {/* Error + retry */}
      <Show when={op().status === "failed" && op().error}>
        <div
          style={{
            "font-size": "11px",
            color: "var(--vscode-testing-iconFailed, #f44)",
            "margin-top": "6px",
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}
        >
          <span style={{ flex: "1", "word-break": "break-word" }}>
            {op().error}
          </span>
          <Show when={op().retryable && props.onRetry}>
            <button
              onClick={props.onRetry}
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                "border-radius": "3px",
                padding: "3px 10px",
                cursor: "pointer",
                "font-size": "11px",
                "flex-shrink": "0",
              }}
            >
              Retry
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export const OperationsDashboard: Component<OperationsDashboardProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(false)

  const activeCount = () => props.operations.filter((o) => o.status === "active").length
  const hasOperations = () => props.operations.length > 0

  return (
    <Show when={hasOperations()}>
      <div
        class={props.class}
        style={{
          "margin-top": "8px",
          "border-top": "1px solid var(--vscode-panel-border, #444)",
          "padding-top": "8px",
        }}
      >
        {/* Dashboard header */}
        <button
          onClick={() => setCollapsed(!collapsed())}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            width: "100%",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
            "font-family": "inherit",
            color: "var(--vscode-foreground)",
          }}
        >
          <span style={{ "font-size": "12px", "font-weight": "600" }}>
            {collapsed() ? "▸" : "▾"} Operations
          </span>
          <Show when={activeCount() > 0}>
            <span
              style={{
                background: "var(--vscode-progressBar-background, #0078d4)",
                color: "#fff",
                "font-size": "10px",
                "font-weight": "bold",
                padding: "1px 6px",
                "border-radius": "10px",
                "min-width": "16px",
                "text-align": "center",
              }}
            >
              {activeCount()}
            </span>
          </Show>
          <span
            style={{
              "font-size": "11px",
              color: "var(--vscode-descriptionForeground)",
              "margin-left": "auto",
            }}
          >
            {props.operations.length} task{props.operations.length !== 1 ? "s" : ""}
          </span>
        </button>

        {/* Task list */}
        <Show when={!collapsed()}>
          <div style={{ "margin-top": "6px" }}>
            <For each={props.operations}>
              {(op) => (
                <OperationCard
                  op={op}
                  onRetry={props.onRetry ? () => props.onRetry!(op.id) : undefined}
                  onDismiss={props.onDismiss ? () => props.onDismiss!(op.id) : undefined}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export default OperationsDashboard
