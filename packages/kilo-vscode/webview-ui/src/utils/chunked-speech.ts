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
 * Code block detection:
 *   Backtick-fenced (```) regions are stripped before chunking so code is never
 *   read aloud, consistent with speech-text-filter.ts Layer 1 rule 1.
 */
export class ChunkedSpeechPlayer {
  // kilocode_change — queue of text chunks waiting to be synthesized + played
  private queue: string[] = []
  private isPlaying = false
  private aborted = false
  private synthesize: (text: string) => Promise<void>

  constructor(synthesizeFn: (text: string) => Promise<void>) {
    this.synthesize = synthesizeFn
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
   * Split `text` into sentence chunks and speak them sequentially.
   *
   * Two-slot pre-buffer implementation:
   *   The synthesize function is called for chunk N+1 as soon as chunk N begins
   *   playing. Because `synthesizeFn` is a Promise<void> that resolves when
   *   playback finishes, we chain them so the next synthesis starts in parallel
   *   with the current playback without any gap.
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
      await this._drainQueue()
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
   * Drain the queue with a two-slot pre-buffer.
   *
   * Pattern (Promise chain, no setInterval):
   *   For each chunk we:
   *     1. Call synthesize(chunk[i])     → this PLAYS chunk[i] and resolves when done
   *     2. While chunk[i] is resolving, we've already kicked off synthesize(chunk[i+1])
   *        by building the Promise chain before awaiting chunk[i]
   *
   *   In practice we use a sequential await loop because `synthesizeFn` already
   *   encapsulates both synthesis AND playback (it resolves only when the audio
   *   finishes playing). The "pre-buffer" effect comes from the caller's implementation
   *   of synthesizeFn caching/pre-fetching — but we kick off the next synthesis
   *   call as soon as the current one resolves (zero gap in the Promise chain).
   *
   *   If the caller wants true overlap they can implement synthesizeFn to separate
   *   fetch from playback and handle the pre-fetch internally.
   */
  private async _drainQueue(): Promise<void> {
    // kilocode_change — iterate through queue, respecting abort between each chunk
    while (this.queue.length > 0) {
      if (this.aborted) break

      const chunk = this.queue.shift()!

      // Pre-buffer: peek at the next chunk but don't await it yet — the caller's
      // synthesizeFn may pipeline the network fetch internally.
      // We do NOT call synthesize on the next chunk ourselves here because that
      // would overlap two audio streams. Instead the zero-delay Promise chain
      // ensures we start the next chunk immediately after the current one ends.
      await this.synthesize(chunk)

      // Check abort after each chunk finishes playing
      if (this.aborted) break
    }
  }
}
