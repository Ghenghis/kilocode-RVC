// kilocode_change — Phase 5.1: Model Download Manager
// Batch downloads, resume support, size warnings, auto-cleanup, and
// streaming progress tracking via fetch ReadableStream.
//
// Usage:
//   const dm = new DownloadManager({ maxConcurrent: 2, sizeLimitWarningMB: 200, sizeLimitConfirmMB: 500 })
//   const check = DownloadManager.sizeCheck(bytes, config)  // "ok" | "warn" | "confirm"
//   const jobId  = dm.enqueue("my-model", "https://…/model.zip", bytes)
//   dm.addEventListener("progress", (e) => console.log((e as CustomEvent).detail))
//   dm.start()

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DownloadJobStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"

export interface DownloadJob {
  id: string
  modelName: string
  url: string
  totalBytes: number
  downloadedBytes: number
  status: DownloadJobStatus
  startedAt?: number
  completedAt?: number
  error?: string
}

export interface DownloadManagerConfig {
  /** Maximum number of simultaneous downloads. Default: 2. */
  maxConcurrent: number
  /** Show a non-blocking warning when the model exceeds this size (MiB). Default: 200. */
  sizeLimitWarningMB: number
  /** Require explicit confirmation when the model exceeds this size (MiB). Default: 500. */
  sizeLimitConfirmMB: number
}

// ---------------------------------------------------------------------------
// CustomEvent detail shapes (for TypeScript consumers)
// ---------------------------------------------------------------------------

export interface ProgressDetail {
  jobId: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export interface JobStatusDetail {
  jobId: string
  job: DownloadJob
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DownloadManagerConfig = {
  maxConcurrent: 2,
  sizeLimitWarningMB: 200,
  sizeLimitConfirmMB: 500,
}

const MB = 1024 * 1024

// ---------------------------------------------------------------------------
// detectCorruptDownload
// ---------------------------------------------------------------------------

/**
 * Perform a lightweight sanity check on a downloaded Blob.
 *
 * Checks performed:
 *   1. Minimum size — valid model files must be > 1 MiB.
 *   2. Magic bytes — if the blob starts with a known header (zip, gguf, pkl,
 *      tar, gzip, pytorch) the header is validated.  Unknown file formats
 *      are allowed through (the check is advisory, not exhaustive).
 *
 * Returns `true` when the file appears corrupt or truncated, `false` when it
 * looks sane.
 */
export async function detectCorruptDownload(blob: Blob): Promise<boolean> {
  // Rule 1 — minimum size
  if (blob.size <= MB) return true

  // Rule 2 — magic bytes (read the first 8 bytes)
  try {
    const header = await blob.slice(0, 8).arrayBuffer()
    const bytes = new Uint8Array(header)

    // ZIP — PK\x03\x04
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return false // valid ZIP
    }

    // GGUF — "GGUF" ASCII (0x47 0x47 0x55 0x46)
    if (bytes[0] === 0x47 && bytes[1] === 0x47 && bytes[2] === 0x55 && bytes[3] === 0x46) {
      return false // valid GGUF
    }

    // Gzip — \x1f\x8b
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      return false // valid gzip / .tar.gz
    }

    // Tar — "ustar" at offset 257 is authoritative, but that's far in.
    // Approximate: tar magic at bytes[0..4] = 0x75 0x73 0x74 0x61 0x72 when
    // it's a bare tar (rare).  Skip — gzip covers the common tar.gz case.

    // PyTorch pickle — starts with \x80\x02 (pickle protocol 2)
    //                  or \x80\x04 / \x80\x05 (protocol 4/5)
    if (bytes[0] === 0x80 && (bytes[1] === 0x02 || bytes[1] === 0x04 || bytes[1] === 0x05)) {
      return false // valid PyTorch / pickle
    }

    // NumPy .npy — \x93NUMPY
    if (bytes[0] === 0x93 && bytes[1] === 0x4e && bytes[2] === 0x55 && bytes[3] === 0x4d) {
      return false // valid NumPy
    }

    // HDF5 — \x89HDF\r\n\x1a\n
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x48 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return false // valid HDF5
    }

    // Unknown magic — do not flag as corrupt; callers may handle further validation
    return false
  } catch {
    // Could not read header bytes — treat as corrupt
    return true
  }
}

// ---------------------------------------------------------------------------
// Internal job runtime state (not exposed in DownloadJob)
// ---------------------------------------------------------------------------

interface JobRuntime {
  controller: AbortController
  /** Bytes already received before this particular fetch started (for resume). */
  resumeOffset: number
}

// ---------------------------------------------------------------------------
// DownloadManager
// ---------------------------------------------------------------------------

/**
 * Manages a queue of model file downloads with:
 *   - Configurable concurrency
 *   - Streaming progress via fetch ReadableStream
 *   - Pause/resume using AbortController + Range headers
 *   - CustomEvent notifications: "progress" | "started" | "completed" | "failed"
 */
export class DownloadManager extends EventTarget {
  private readonly config: DownloadManagerConfig
  private readonly jobs = new Map<string, DownloadJob>()
  private readonly runtimes = new Map<string, JobRuntime>()
  private running = false

  constructor(config: Partial<DownloadManagerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /**
   * Return whether a file of `bytes` bytes needs a warning or confirmation
   * before downloading.
   *
   *   "ok"      — below sizeLimitWarningMB
   *   "warn"    — between sizeLimitWarningMB and sizeLimitConfirmMB
   *   "confirm" — above sizeLimitConfirmMB
   */
  static sizeCheck(
    bytes: number,
    config: DownloadManagerConfig = DEFAULT_CONFIG,
  ): "ok" | "warn" | "confirm" {
    const mb = bytes / MB
    if (mb >= config.sizeLimitConfirmMB) return "confirm"
    if (mb >= config.sizeLimitWarningMB) return "warn"
    return "ok"
  }

  // ── Enqueue ────────────────────────────────────────────────────────────────

  /**
   * Add a model download to the queue.
   *
   * @returns The generated job ID.  Pass this to pause/resume/cancel.
   */
  enqueue(modelName: string, url: string, totalBytes: number): string {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const job: DownloadJob = {
      id,
      modelName,
      url,
      totalBytes,
      downloadedBytes: 0,
      status: "queued",
    }
    this.jobs.set(id, job)
    // If the manager is already running, kick off the next slot immediately
    if (this.running) this.scheduleNext()
    return id
  }

  // ── Queue control ──────────────────────────────────────────────────────────

  /**
   * Start processing the download queue.
   * Safe to call multiple times — subsequent calls are no-ops while running.
   * kilocode_change — fill all available concurrency slots on start, not just one
   */
  start(): void {
    if (this.running) return
    this.running = true
    this._fillSlots()
  }

  // ── Per-job control ────────────────────────────────────────────────────────

  /** Pause an in-progress download.  The partial download is preserved. */
  pause(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== "downloading") return
    const runtime = this.runtimes.get(jobId)
    if (runtime) runtime.controller.abort()
    // Status is set to "paused" in the download loop's catch block after abort
  }

  /** Resume a paused download from where it left off. */
  resume(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== "paused") return
    job.status = "queued"
    if (this.running) this.scheduleNext()
  }

  /** Cancel a download — removes it from the queue and discards partial progress. */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.status === "downloading") {
      const runtime = this.runtimes.get(jobId)
      if (runtime) runtime.controller.abort()
    }
    job.status = "cancelled"
    job.downloadedBytes = 0
    this.runtimes.delete(jobId)
    this.dispatchJobEvent("cancelled", job)
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getJobs(): DownloadJob[] {
    return Array.from(this.jobs.values())
  }

  getJob(jobId: string): DownloadJob | undefined {
    return this.jobs.get(jobId)
  }

  // ── Internal scheduling ────────────────────────────────────────────────────

  /**
   * Fill all available concurrency slots by starting queued jobs until either
   * maxConcurrent is reached or there are no more queued jobs.
   * kilocode_change — loop to fill all slots (fixes single-slot-only bug)
   */
  private _fillSlots(): void {
    while (true) {
      const active = this.countByStatus("downloading")
      if (active >= this.config.maxConcurrent) break
      const queued = Array.from(this.jobs.values()).find((j) => j.status === "queued")
      if (!queued) break
      void this.runJob(queued)
    }
  }

  /** @deprecated Use _fillSlots() for multi-slot filling. Kept for internal callers. */
  private scheduleNext(): void {
    this._fillSlots()
  }

  private countByStatus(status: DownloadJobStatus): number {
    let count = 0
    for (const j of this.jobs.values()) {
      if (j.status === status) count++
    }
    return count
  }

  // ── Fetch with streaming progress ─────────────────────────────────────────

  private async runJob(job: DownloadJob): Promise<void> {
    job.status = "downloading"
    job.startedAt = Date.now()

    const controller = new AbortController()
    const resumeOffset = job.downloadedBytes // bytes already obtained from a prior attempt
    this.runtimes.set(job.id, { controller, resumeOffset })

    this.dispatchJobEvent("started", job)

    const headers: Record<string, string> = {}
    if (resumeOffset > 0) {
      headers["Range"] = `bytes=${resumeOffset}-`
    }

    try {
      const response = await fetch(job.url, {
        signal: controller.signal,
        headers,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error("Response body is null — streaming not supported by server")
      }

      // When resuming with a Range request, totalBytes reflects the full file
      // size, but contentLength is only the remaining bytes.  We keep the
      // original totalBytes so the progress percentage is computed correctly.
      const contentLength = Number(response.headers.get("content-length") ?? "0")
      if (resumeOffset === 0 && contentLength > 0) {
        job.totalBytes = contentLength
      }

      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        job.downloadedBytes += value.byteLength
        this.dispatchProgressEvent(job)
      }

      // Download complete
      job.status = "completed"
      job.completedAt = Date.now()
      this.runtimes.delete(job.id)
      this.dispatchJobEvent("completed", job)
    } catch (err: unknown) {
      if (this.isAbortError(err)) {
        // Distinguish pause from cancel — cancel() sets status to "cancelled" before aborting
        // Cast to the full union type because cancel() may have mutated status on another code path
        const currentStatus = job.status as DownloadJobStatus
        if (currentStatus !== "cancelled") {
          job.status = "paused"
          // downloadedBytes is preserved so resume can use a Range header
        }
        this.runtimes.delete(job.id)
        return
      }

      job.status = "failed"
      job.error = err instanceof Error ? err.message : String(err)
      this.runtimes.delete(job.id)
      this.dispatchJobEvent("failed", job)
    } finally {
      // Attempt to fill the next concurrency slot regardless of outcome
      if (this.running) this.scheduleNext()
    }
  }

  // ── Event helpers ──────────────────────────────────────────────────────────

  private dispatchProgressEvent(job: DownloadJob): void {
    const total = job.totalBytes > 0 ? job.totalBytes : 1
    const percent = Math.min((job.downloadedBytes / total) * 100, 100)
    const detail: ProgressDetail = {
      jobId: job.id,
      downloadedBytes: job.downloadedBytes,
      totalBytes: job.totalBytes,
      percent,
    }
    this.dispatchEvent(new CustomEvent("progress", { detail }))
  }

  private dispatchJobEvent(
    type: "started" | "completed" | "failed" | "cancelled",
    job: DownloadJob,
  ): void {
    const detail: JobStatusDetail = { jobId: job.id, job: { ...job } }
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true
    if (err instanceof Error && err.message.toLowerCase().includes("abort")) return true
    return false
  }
}
