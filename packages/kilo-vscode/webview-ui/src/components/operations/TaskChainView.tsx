/**
 * TaskChainView — Sequential task pipeline visualization.
 *
 * Shows numbered steps with:
 * - Completed steps: ✓ with elapsed time (green)
 * - Current step: live progress indicator + elapsed timer (blue)
 * - Failed step: ✗ with error message (red)
 * - Future steps: dimmed with estimated time
 */
import { Component, For, Show } from "solid-js"
import { ElapsedTimer, formatDuration } from "./ElapsedTimer"

interface StepData {
  label: string
  status: "pending" | "active" | "completed" | "failed"
  startedAt?: number
  completedAt?: number
  detail?: string
}

interface TaskChainViewProps {
  steps: StepData[]
  currentStep?: number
  class?: string
  style?: Record<string, string>
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: "○", color: "var(--vscode-disabledForeground, #888)" },
  active: { icon: "◉", color: "var(--vscode-progressBar-background, #0078d4)" },
  completed: { icon: "✓", color: "var(--vscode-testing-iconPassed, #4a4)" },
  failed: { icon: "✗", color: "var(--vscode-testing-iconFailed, #f44)" },
}

export const TaskChainView: Component<TaskChainViewProps> = (props) => {
  return (
    <div
      class={props.class}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0",
        "font-size": "12px",
        ...props.style,
      }}
    >
      <For each={props.steps}>
        {(step, index) => {
          const iconInfo = () => STATUS_ICONS[step.status] ?? STATUS_ICONS.pending
          const isLast = () => index() === props.steps.length - 1

          return (
            <div
              style={{
                display: "flex",
                "align-items": "flex-start",
                gap: "8px",
                padding: "4px 0",
                position: "relative",
              }}
            >
              {/* Vertical connector line */}
              <div
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  width: "16px",
                  "flex-shrink": "0",
                }}
              >
                <span
                  style={{
                    color: iconInfo().color,
                    "font-size": step.status === "active" ? "14px" : "12px",
                    "font-weight": step.status === "active" ? "bold" : "normal",
                    "line-height": "1",
                  }}
                >
                  {iconInfo().icon}
                </span>
                <Show when={!isLast()}>
                  <div
                    style={{
                      width: "1px",
                      height: "12px",
                      background: step.status === "completed"
                        ? "var(--vscode-testing-iconPassed, #4a4)"
                        : "var(--vscode-panel-border, #444)",
                      "margin-top": "2px",
                    }}
                  />
                </Show>
              </div>

              {/* Step content */}
              <div style={{ flex: "1", "min-width": "0" }}>
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    "flex-wrap": "wrap",
                  }}
                >
                  <span
                    style={{
                      color: step.status === "pending"
                        ? "var(--vscode-disabledForeground, #888)"
                        : step.status === "failed"
                        ? "var(--vscode-testing-iconFailed, #f44)"
                        : "var(--vscode-foreground)",
                      "font-weight": step.status === "active" ? "600" : "normal",
                    }}
                  >
                    {step.label}
                  </span>

                  {/* Live timer for active step */}
                  <Show when={step.status === "active" && step.startedAt}>
                    <ElapsedTimer
                      startedAt={step.startedAt!}
                      style={{ color: "var(--vscode-progressBar-background, #0078d4)" }}
                    />
                  </Show>

                  {/* Elapsed time for completed step */}
                  <Show when={step.status === "completed" && step.startedAt && step.completedAt}>
                    <span
                      style={{
                        "font-size": "11px",
                        "font-family": "var(--vscode-editor-font-family, monospace)",
                        color: "var(--vscode-testing-iconPassed, #4a4)",
                      }}
                    >
                      {formatDuration(step.completedAt! - step.startedAt!)}
                    </span>
                  </Show>
                </div>

                {/* Detail text */}
                <Show when={step.detail}>
                  <div
                    style={{
                      "font-size": "11px",
                      color: step.status === "failed"
                        ? "var(--vscode-testing-iconFailed, #f44)"
                        : "var(--vscode-descriptionForeground)",
                      "margin-top": "2px",
                      "word-break": "break-word",
                    }}
                  >
                    {step.detail}
                  </div>
                </Show>

                {/* Animated progress line for active step */}
                <Show when={step.status === "active"}>
                  <div
                    style={{
                      height: "2px",
                      background: "var(--vscode-editorWidget-background, rgba(128,128,128,0.15))",
                      "border-radius": "2px",
                      overflow: "hidden",
                      "margin-top": "4px",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: "40%",
                        background: "var(--vscode-progressBar-background, #0078d4)",
                        "border-radius": "2px",
                        animation: "kiloProgressPulse 1.5s ease-in-out infinite",
                      }}
                    />
                  </div>
                </Show>
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}

export default TaskChainView
