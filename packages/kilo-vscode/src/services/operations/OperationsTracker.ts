/**
 * OperationsTracker — Unified tracking of long-running operations with
 * timing history, ETA estimation, and progress events.
 *
 * Singleton service used by KiloProvider and VoiceStudioProvider to
 * instrument Docker pulls, model downloads, health checks, etc.
 *
 * Emits standardized operation messages that webviews consume to display
 * real-time progress bars, elapsed timers, and ETAs.
 */

import * as vscode from "vscode"

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskType =
  | "docker-pull"
  | "docker-build"
  | "docker-start"
  | "docker-restart"
  | "health-check"
  | "model-download"
  | "model-install"
  | "model-delete"
  | "catalog-fetch"
  | "library-fetch"
  | "voice-preview"
  | "azure-validate"
  | "store-fetch"
  | "container-exec"

export interface TaskStep {
  label: string
  status: "pending" | "active" | "completed" | "failed"
  startedAt?: number
  completedAt?: number
  detail?: string
}

export interface TaskState {
  id: string
  taskType: TaskType
  label: string
  status: "active" | "completed" | "failed" | "cancelled"
  startedAt: number
  completedAt?: number
  // Progress (for determinate tasks like downloads)
  percent?: number
  receivedBytes?: number
  totalBytes?: number
  // Multi-step chains
  steps?: TaskStep[]
  currentStep?: number
  // Speed tracking (for downloads)
  bytesPerSecond?: number
  // Error info
  error?: string
  retryable?: boolean
}

export interface OperationMessage {
  type: "operationStarted" | "operationProgress" | "operationCompleted" | "operationFailed"
  id: string
  taskType?: TaskType
  label?: string
  status?: string
  // Progress
  percent?: number
  receivedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  // Steps
  steps?: TaskStep[]
  currentStep?: number
  stepLabel?: string
  detail?: string
  // Timing
  elapsedMs?: number
  estimatedMs?: number
  durationMs?: number
  // Error
  error?: string
  retryable?: boolean
}

interface TimingHistory {
  taskType: TaskType
  durations: number[] // last 10 durations in ms
  avgDuration: number
  lastUpdated: number
}

// ── Singleton ────────────────────────────────────────────────────────────────

const GS_TIMING_HISTORY = "kilocode.operationTimingHistory"
const MAX_HISTORY_ENTRIES = 10

type MessageCallback = (msg: OperationMessage) => void

export class OperationsTracker {
  private static instance: OperationsTracker | null = null

  private tasks = new Map<string, TaskState>()
  private timingHistory = new Map<TaskType, TimingHistory>()
  private listeners: MessageCallback[] = []
  private context: vscode.ExtensionContext | null = null
  private taskCounter = 0

  static getInstance(): OperationsTracker {
    if (!OperationsTracker.instance) {
      OperationsTracker.instance = new OperationsTracker()
    }
    return OperationsTracker.instance
  }

  /** Initialize with extension context to access globalState for timing history */
  init(context: vscode.ExtensionContext): void {
    this.context = context
    this.loadTimingHistory()
  }

  // ── Listener management ──────────────────────────────────────────────────

  onMessage(cb: MessageCallback): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private emit(msg: OperationMessage): void {
    for (const cb of this.listeners) {
      try {
        cb(msg)
      } catch {
        // swallow listener errors
      }
    }
  }

  // ── Task lifecycle ───────────────────────────────────────────────────────

  /** Start a new tracked operation. Returns the task ID. */
  startTask(taskType: TaskType, label: string, opts?: {
    totalBytes?: number
    steps?: string[]
  }): string {
    const id = `op-${++this.taskCounter}-${Date.now()}`
    const now = Date.now()

    const steps: TaskStep[] | undefined = opts?.steps?.map((s, i) => ({
      label: s,
      status: i === 0 ? "active" : "pending",
      startedAt: i === 0 ? now : undefined,
    }))

    const task: TaskState = {
      id,
      taskType,
      label,
      status: "active",
      startedAt: now,
      totalBytes: opts?.totalBytes,
      steps,
      currentStep: steps ? 0 : undefined,
    }

    this.tasks.set(id, task)

    const estimated = this.getEstimatedDuration(taskType)

    this.emit({
      type: "operationStarted",
      id,
      taskType,
      label,
      totalBytes: opts?.totalBytes,
      steps,
      currentStep: 0,
      estimatedMs: estimated,
    })

    return id
  }

  /** Update progress on an active task */
  updateProgress(id: string, update: {
    percent?: number
    receivedBytes?: number
    totalBytes?: number
    detail?: string
    stepLabel?: string
  }): void {
    const task = this.tasks.get(id)
    if (!task || task.status !== "active") return

    if (update.percent !== undefined) task.percent = update.percent
    if (update.receivedBytes !== undefined) task.receivedBytes = update.receivedBytes
    if (update.totalBytes !== undefined) task.totalBytes = update.totalBytes

    // Calculate speed for downloads
    const elapsed = Date.now() - task.startedAt
    if (task.receivedBytes && elapsed > 0) {
      task.bytesPerSecond = Math.round((task.receivedBytes / elapsed) * 1000)
    }

    const estimatedMs = this.getEstimatedDuration(task.taskType)

    this.emit({
      type: "operationProgress",
      id,
      percent: task.percent,
      receivedBytes: task.receivedBytes,
      totalBytes: task.totalBytes,
      bytesPerSecond: task.bytesPerSecond,
      elapsedMs: elapsed,
      estimatedMs,
      detail: update.detail,
      stepLabel: update.stepLabel,
      steps: task.steps,
      currentStep: task.currentStep,
    })
  }

  /** Advance to the next step in a multi-step chain */
  advanceStep(id: string, detail?: string): void {
    const task = this.tasks.get(id)
    if (!task || !task.steps || task.currentStep === undefined) return

    const now = Date.now()

    // Complete current step
    const current = task.steps[task.currentStep]
    if (current) {
      current.status = "completed"
      current.completedAt = now
    }

    // Advance to next
    task.currentStep++
    if (task.currentStep < task.steps.length) {
      const next = task.steps[task.currentStep]
      if (next) {
        next.status = "active"
        next.startedAt = now
        if (detail) next.detail = detail
      }
    }

    this.emit({
      type: "operationProgress",
      id,
      steps: task.steps,
      currentStep: task.currentStep,
      stepLabel: task.steps[task.currentStep]?.label,
      detail,
      elapsedMs: now - task.startedAt,
    })
  }

  /** Mark a task as completed */
  completeTask(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return

    const now = Date.now()
    task.status = "completed"
    task.completedAt = now
    const durationMs = now - task.startedAt

    // Complete any remaining steps
    if (task.steps) {
      for (const step of task.steps) {
        if (step.status === "active" || step.status === "pending") {
          step.status = "completed"
          step.completedAt = now
        }
      }
    }

    // Record timing for ETA engine
    this.recordDuration(task.taskType, durationMs)

    this.emit({
      type: "operationCompleted",
      id,
      durationMs,
      steps: task.steps,
    })

    // Auto-cleanup after 10 seconds
    setTimeout(() => this.tasks.delete(id), 10_000)
  }

  /** Mark a task as failed */
  failTask(id: string, error: string, retryable = false): void {
    const task = this.tasks.get(id)
    if (!task) return

    task.status = "failed"
    task.error = error
    task.retryable = retryable
    task.completedAt = Date.now()

    // Mark current step as failed
    if (task.steps && task.currentStep !== undefined) {
      const step = task.steps[task.currentStep]
      if (step) {
        step.status = "failed"
        step.detail = error
      }
    }

    this.emit({
      type: "operationFailed",
      id,
      error,
      retryable,
      durationMs: Date.now() - task.startedAt,
      steps: task.steps,
    })

    // Keep failed tasks longer for user to see
    setTimeout(() => this.tasks.delete(id), 30_000)
  }

  /** Cancel a task */
  cancelTask(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = "cancelled"
    task.completedAt = Date.now()
    this.tasks.delete(id)
  }

  /** Get all active tasks */
  getActiveTasks(): TaskState[] {
    return [...this.tasks.values()].filter((t) => t.status === "active")
  }

  /** Get all tasks (active + recently completed/failed) */
  getAllTasks(): TaskState[] {
    return [...this.tasks.values()]
  }

  // ── ETA Engine ───────────────────────────────────────────────────────────

  /** Get estimated duration for a task type based on history */
  getEstimatedDuration(taskType: TaskType): number | undefined {
    const history = this.timingHistory.get(taskType)
    if (!history || history.durations.length === 0) return undefined
    return history.avgDuration
  }

  private recordDuration(taskType: TaskType, durationMs: number): void {
    let history = this.timingHistory.get(taskType)
    if (!history) {
      history = { taskType, durations: [], avgDuration: 0, lastUpdated: Date.now() }
      this.timingHistory.set(taskType, history)
    }

    history.durations.push(durationMs)
    // Keep only last N entries
    if (history.durations.length > MAX_HISTORY_ENTRIES) {
      history.durations = history.durations.slice(-MAX_HISTORY_ENTRIES)
    }
    history.avgDuration = Math.round(
      history.durations.reduce((a, b) => a + b, 0) / history.durations.length,
    )
    history.lastUpdated = Date.now()

    this.saveTimingHistory()
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private loadTimingHistory(): void {
    if (!this.context) return
    const stored = this.context.globalState.get<Record<string, TimingHistory>>(GS_TIMING_HISTORY)
    if (stored) {
      for (const [key, value] of Object.entries(stored)) {
        this.timingHistory.set(key as TaskType, value)
      }
    }
  }

  private saveTimingHistory(): void {
    if (!this.context) return
    const data: Record<string, TimingHistory> = {}
    for (const [key, value] of this.timingHistory) {
      data[key] = value
    }
    void this.context.globalState.update(GS_TIMING_HISTORY, data)
  }
}
