// kilocode_change — Phase 3.2: Chunked speech player with two-slot pre-buffer
// Architecture: VoXtream/ElevenLabs pattern — synthesize N+1 while playing N
// Target: <200ms time-to-first-audio via sentence-level chunking

/**
 * ChunkedSpeechPlayer — splits text into sentence-level chunks and plays them
 * sequentially while pre-buffering the next chunk during playback.
 *
 * Two-slot pre-buffer:
 *   Slot A — currently being played (synthesize Promise resolved, audio in flight)
 *   Slot B — being synthesized in parallel while Slot A plays
 *
 * This overlaps network/synthesis latency with playback so each subsequent
 * chunk starts immediately after the previous one ends.
 *
 * Split-synthesis mode (true pre-buffering):
 *   Pass `{ prefetchFn, playFn }` to the constructor.  `prefetchFn` fetches the
 *   audio Blob (network-bound), `playFn` plays it.  Slot B's network fetch runs
 *   concurrently while Slot A's audio is playing — the VoXtream pattern.
 *
 * Combined mode (backward-compat):
 *   Pass a single `(text: string) => Promise<void>`.  Chunks play sequentially
 *   with zero inter-chunk gap.  True overlap is not possible because the function
 *   encapsulates both synthesis and playback.
 *
 * Code block detection:
 *   Backtick-fenced (```) regions are stripped before chunking so code is never
 *   read aloud, consistent with speech-text-filter.ts Layer 1 rule 1.
 */

// kilocode_change — split-synthesis options for true two-slot pre-buffering
export interface ChunkedSpeechOptions {
  /** Combined synthesize-and-play function (single-mode, backward-compat). */
  synthesizeFn?: (text: string) => Promise<void>
  /** Synthesis-only: fetch audio and return a Blob (split-mode). */
  prefetchFn?: (text: string) => Promise<Blob>
  /** Playback-only: play a pre-fetched Blob (split-mode). */
  playFn?: (blob: Blob) => Promise<void>
}

export class ChunkedSpeechPlayer {
  // kilocode_change — queue of text chunks waiting to be synthesized + played
  private queue: string[] = []
  private isPlaying = false
  private aborted = false

  // kilocode_change — combined mode: single fn; split mode: prefetch + play fns
  private readonly synthesizeFn: ((text: string) => Promise<void>) | null
  private readonly prefetchFn: ((text: string) => Promise<Blob>) | null
  private readonly playFn: ((blob: Blob) => Promise<void>) | null

  /**
   * @param synthesizeFnOrOptions
   *   - A `(text: string) => Promise<void>` for combined synthesis+playback (backward-compat).
   *   - A `ChunkedSpeechOptions` with `prefetchFn` + `playFn` for true two-slot pre-buffering.
   */
  constructor(synthesizeFnOrOptions: ((text: string) => Promise<void>) | ChunkedSpeechOptions) {
    if (typeof synthesizeFnOrOptions === "function") {
      // kilocode_change — backward-compat: single combined synthesize+play function
      this.synthesizeFn = synthesizeFnOrOptions
      this.prefetchFn = null
      this.playFn = null
    } else {
      const opts = synthesizeFnOrOptions
      this.synthesizeFn = opts.synthesizeFn ?? null
      this.prefetchFn = opts.prefetchFn ?? null
      this.playFn = opts.playFn ?? null
    }
  }

  // ── Static helpers ──────────────────────────────────────────────────────────

  /**
   * Split text into sentence-level chunks.
   *
   * Rules:
   *   - Strip content between ``` fences first (code blocks skipped entirely)
   *   - Split on `[.!?]+\s+` EXCEPT when:
   *       1. Preceded by a single uppercase letter  → abbreviation (Mr., Dr., U.S.)
   *       2. Preceded by a digit                   → decimal (3.14, v2.0)
   *       3. The word following starts lowercase   → continuation sentence
   *   - If a chunk exceeds 200 chars, hard-split at the last space before limit
   *   - Filter empty / whitespace-only chunks
   */
  static splitText(text: string): string[] {
    // kilocode_change — strip fenced code blocks before any sentence splitting
    const stripped = ChunkedSpeechPlayer._stripCodeFences(text)

    const chunks: string[] = []

    // We walk through the text character by character using a regex that finds
    // potential sentence boundaries, then decides whether to honour each one.
    //
    // Pattern: one-or-more sentence-ending punctuation, followed by whitespace
    const boundaryRe = /([.!?]+)(\s+)/g

    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = boundaryRe.exec(stripped)) !== null) {
      const punctEnd = match.index + match[1].length  // index just after the punctuation
      const afterSpace = match.index + match[0].length // index of first char after whitespace

      // Character immediately before the punctuation
      const charBefore = stripped[match.index - 1] ?? ""

      // First character of the next word (after the whitespace gap)
      const charAfter = stripped[afterSpace] ?? ""

      // Guard 1: single uppercase letter before punctuation → abbreviation ("Mr.", "Dr.", "U.S.")
      // We check that it's isolated — not preceded by another letter (to avoid "ABBR.")
      const isSingleUppercase =
        /[A-Z]/.test(charBefore) && !/[A-Za-z]/.test(stripped[match.index - 2] ?? "")

      // Guard 2: digit before punctuation → decimal number ("3.14", "v2.0")
      const isDecimal = /[0-9]/.test(charBefore)

      // Guard 3: next word starts lowercase → not a real sentence boundary
      const nextIsLowercase = /[a-z]/.test(charAfter)

      const shouldSplit = !isSingleUppercase && !isDecimal && !nextIsLowercase

      if (shouldSplit) {
        const chunk = stripped.slice(lastIndex, punctEnd).trim()
        if (chunk) chunks.push(chunk)
        lastIndex = afterSpace
        // Reset lastIndex in the regex to avoid double-matching
        boundaryRe.lastIndex = afterSpace
      }
    }

    // Remainder after last split
    const tail = stripped.slice(lastIndex).trim()
    if (tail) chunks.push(tail)

    // kilocode_change — hard-split any chunk exceeding 200 chars at last word boundary
    const MAX_CHUNK = 200
    const result: string[] = []
    for (const chunk of chunks) {
      if (chunk.length <= MAX_CHUNK) {
        result.push(chunk)
      } else {
        let remaining = chunk
        while (remaining.length > MAX_CHUNK) {
          // Find the last space at or before the limit
          let splitAt = remaining.lastIndexOf(" ", MAX_CHUNK)
          if (splitAt <= 0) splitAt = MAX_CHUNK  // no space found — hard cut
          result.push(remaining.slice(0, splitAt).trim())
          remaining = remaining.slice(splitAt).trim()
        }
        if (remaining) result.push(remaining)
      }
    }

    // Filter out empty / whitespace-only entries
    return result.filter((c) => c.trim().length > 0)
  }

  /**
   * Remove content between ``` fences.
   * Handles nested-ish cases by toggling a boolean fence state.
   * kilocode_change — matches Layer 1 rule 1 of speech-text-filter.ts
   */
  private static _stripCodeFences(text: string): string {
    const lines = text.split("\n")
    const kept: string[] = []
    let inFence = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("```")) {
        inFence = !inFence
        // Don't push the fence line itself — it would produce "(code block omitted)"
        // We skip it silently here since ChunkedSpeechPlayer receives pre-filtered text
        continue
      }
      if (!inFence) {
        kept.push(line)
      }
    }

    return kept.join("\n")
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Split `text` into sentence chunks and speak them with two-slot pre-buffering.
   *
   * In split-synthesis mode: Slot B's prefetch starts as soon as Slot A begins
   * playing, hiding network latency behind playback time (true VoXtream pattern).
   *
   * In combined mode: chunks play sequentially with zero inter-chunk gap.
   *
   * Returns a promise that resolves when every chunk has been spoken
   * (or when interrupted via interrupt()).
   */
  async speak(text: string): Promise<void> {
    // kilocode_change — reset state for a fresh utterance
    this.aborted = false
    this.isPlaying = true
    this.queue = ChunkedSpeechPlayer.splitText(text)

    if (this.queue.length === 0) {
      this.isPlaying = false
      return
    }

    try {
      if (this.prefetchFn && this.playFn) {
        // kilocode_change — split mode: true two-slot pre-buffer (fetch overlaps playback)
        await this._drainQueueSplit(this.prefetchFn, this.playFn)
      } else if (this.synthesizeFn) {
        // kilocode_change — combined mode: sequential, zero inter-chunk gap
        await this._drainQueueCombined(this.synthesizeFn)
      }
    } finally {
      this.isPlaying = false
      this.queue = []
    }
  }

  /** Whether the player is currently speaking. */
  get playing(): boolean {
    return this.isPlaying
  }

  /**
   * Interrupt all queued chunks immediately.
   * The currently-running synthesize Promise may still run to completion
   * (we cannot cancel an in-flight fetch from here), but no further chunks
   * will be started once `aborted` is set.
   * kilocode_change — callers should also call SpeechEngine.stop() in tandem
   */
  interrupt(): void {
    this.aborted = true
    this.isPlaying = false
    this.queue = []
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /**
   * True two-slot pre-buffer drain using split prefetch + play functions.
   *
   * kilocode_change — concurrent Slot A play + Slot B prefetch (VoXtream pattern):
   *
   *   Timeline (horizontal = time):
   *     [prefetch 0]──┐
   *                   [play 0]──┐
   *     [prefetch 1]──┘         [play 1]──┐
   *     [prefetch 2]────────────┘         [play 2]
   *
   * Algorithm:
   *   1. prefetchFn(chunk[0]) → slotAFetch          (Slot A)
   *   2. prefetchFn(chunk[1]) → slotBFetch          (Slot B, starts immediately in parallel)
   *   3. await slotAFetch → blobA
   *   4. playFn(blobA) → playPromise               (playing Slot A; Slot B still fetching)
   *   5. slotBFetch becomes new slotAFetch; start prefetchFn(chunk[2]) as new slotBFetch
   *   6. await playPromise                          (Slot A done; Slot B likely arrived)
   *   7. Loop: go to step 3 with the new Slot A.
   */
  private async _drainQueueSplit(
    prefetchFn: (text: string) => Promise<Blob>,
    playFn: (blob: Blob) => Promise<void>,
  ): Promise<void> {
    if (this.queue.length === 0 || this.aborted) return

    // kilocode_change — Slot A: start prefetch for first chunk
    let slotAFetch: Promise<Blob> = prefetchFn(this.queue.shift()!)

    // kilocode_change — Slot B: immediately start prefetch for second chunk in parallel
    let slotBFetch: Promise<Blob> | null =
      this.queue.length > 0 && !this.aborted ? prefetchFn(this.queue.shift()!) : null

    while (true) {
      if (this.aborted) break

      // Await Slot A fetch result
      const blobA = await slotAFetch

      if (this.aborted) break

      // Start playing Slot A (non-blocking) — Slot B is already pre-fetching
      const playPromise = playFn(blobA)

      // kilocode_change — advance: Slot B becomes new Slot A; start new Slot B
      if (slotBFetch !== null) {
        slotAFetch = slotBFetch
        slotBFetch =
          this.queue.length > 0 && !this.aborted ? prefetchFn(this.queue.shift()!) : null
      } else {
        // No more chunks — await the final play and exit
        await playPromise
        break
      }

      // Await Slot A playback (during this time, new Slot B is pre-fetching)
      await playPromise

      if (this.aborted) break

      // If slotBFetch went null after advancing, we have one last chunk in slotAFetch
      if (slotBFetch === null && this.queue.length === 0) {
        // Play the last pre-fetched chunk (the ex-slotB that is now slotAFetch)
        if (!this.aborted) {
          const blobLast = await slotAFetch
          if (!this.aborted) await playFn(blobLast)
        }
        break
      }
    }
  }

  /**
   * Combined-mode drain: sequential synthesize+play with zero inter-chunk gap.
   * kilocode_change — each chunk starts immediately after the previous resolves;
   * no true overlap is possible since synthesizeFn encapsulates both fetch and play.
   */
  private async _drainQueueCombined(synthesizeFn: (text: string) => Promise<void>): Promise<void> {
    while (this.queue.length > 0) {
      if (this.aborted) break
      const chunk = this.queue.shift()!
      await synthesizeFn(chunk)
      if (this.aborted) break
    }
  }
}
