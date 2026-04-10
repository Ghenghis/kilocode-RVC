import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js"
import type {} from "./speech-recognition.d.ts"

/**
 * Command patterns matched against the final transcript (case-insensitive).
 * Order matters — first match wins.
 */
const COMMAND_PATTERNS: Array<{ pattern: RegExp; command: string }> = [
  { pattern: /\bhands[\s-]?free\s+off\b/i, command: "handsFreeOff" },
  { pattern: /\bswitch\s+to\s+(.+)/i, command: "switchVoice" },
  { pattern: /\bread\s+that\s+again\b/i, command: "repeat" },
  { pattern: /\brepeat\b/i, command: "repeat" },
  { pattern: /\bstop\s+speaking\b/i, command: "stop" },
  { pattern: /\bstop\b/i, command: "stop" },
  { pattern: /\bquiet\b/i, command: "stop" },
  { pattern: /\bslower\b/i, command: "slower" },
  { pattern: /\bfaster\b/i, command: "faster" },
  { pattern: /\blouder\b/i, command: "louder" },
  { pattern: /\bsofter\b/i, command: "softer" },
  { pattern: /\bquieter\b/i, command: "softer" },
]

/**
 * SolidJS hook for hands-free continuous voice command recognition.
 *
 * Activates only when `interactionMode()` is `"handsfree"`. Continuously
 * listens for spoken commands and fires `onCommand` when a known pattern
 * is matched. Non-matching speech is silently ignored.
 *
 * The recognition session auto-restarts on `onend` to maintain continuous
 * listening (the Web Speech API stops after each utterance even in
 * continuous mode on some browsers).
 */
export function useVoiceCommands(
  interactionMode: Accessor<string>,
  onCommand: (command: string, transcript: string) => void,
): {
  isListening: Accessor<boolean>
  lastCommand: Accessor<string>
  lastTranscript: Accessor<string>
} {
  const [isListening, setIsListening] = createSignal(false)
  const [lastCommand, setLastCommand] = createSignal("")
  const [lastTranscript, setLastTranscript] = createSignal("")

  const SpeechRecognitionCtor: SpeechRecognitionConstructor | undefined =
    typeof window !== "undefined"
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined

  let recognition: SpeechRecognition | null = null
  let shouldBeListening = false
  // Guard against rapid restart loops when recognition repeatedly fails
  let restartAttempts = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined

  function matchCommand(text: string): { command: string; transcript: string } | null {
    const trimmed = text.trim().toLowerCase()
    for (const { pattern, command } of COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { command, transcript: trimmed }
      }
    }
    return null
  }

  function createRecognition(): SpeechRecognition | null {
    if (!SpeechRecognitionCtor) return null

    const rec = new SpeechRecognitionCtor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = "en-US"

    rec.onresult = (event: SpeechRecognitionEvent) => {
      // Process only final results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result.isFinal) continue

        const transcript = result[0].transcript
        const match = matchCommand(transcript)
        if (match) {
          setLastCommand(match.command)
          setLastTranscript(match.transcript)
          onCommand(match.command, match.transcript)
        }
      }
    }

    rec.onend = () => {
      setIsListening(false)
      // Auto-restart if we should still be listening (hands-free mode)
      if (shouldBeListening) {
        restartAttempts++
        // Back off if we're restarting too frequently (e.g. persistent error)
        if (restartAttempts > 10) {
          // Give up after 10 rapid failures — user probably has a mic issue
          shouldBeListening = false
          return
        }
        // Small delay to avoid hammering the API
        const delay = Math.min(restartAttempts * 200, 2000)
        restartTimer = setTimeout(() => {
          if (shouldBeListening) {
            startRecognition()
          }
        }, delay)
      }
    }

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" is normal in continuous mode — just keep going
      if (event.error === "no-speech" || event.error === "aborted") {
        return
      }

      // For permission/hardware errors, stop trying
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        shouldBeListening = false
        setIsListening(false)
        return
      }

      // Other errors — let onend handle the restart
    }

    rec.onstart = () => {
      // Reset restart counter on successful start
      restartAttempts = 0
    }

    return rec
  }

  function startRecognition() {
    if (!SpeechRecognitionCtor) return

    // Clean up any existing instance
    if (recognition) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      recognition = null
    }

    recognition = createRecognition()
    if (!recognition) return

    try {
      recognition.start()
      setIsListening(true)
      shouldBeListening = true
    } catch {
      // start() can throw if called too quickly after stop()
      // Let the restart logic in onend handle it
      setIsListening(false)
    }
  }

  function stopRecognition() {
    shouldBeListening = false
    if (restartTimer !== undefined) {
      clearTimeout(restartTimer)
      restartTimer = undefined
    }
    if (recognition) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      recognition = null
    }
    setIsListening(false)
  }

  // Reactive effect: start/stop based on interactionMode
  createEffect(() => {
    const mode = interactionMode()
    if (mode === "handsfree") {
      if (!shouldBeListening) {
        restartAttempts = 0
        startRecognition()
      }
    } else {
      if (shouldBeListening || recognition) {
        stopRecognition()
      }
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    stopRecognition()
  })

  return {
    isListening,
    lastCommand,
    lastTranscript,
  }
}
