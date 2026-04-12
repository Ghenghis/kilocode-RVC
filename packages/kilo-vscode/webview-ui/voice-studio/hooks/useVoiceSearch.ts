import { createSignal, onCleanup, type Accessor } from "solid-js"
import type {} from "./speech-recognition.d.ts"

/**
 * SolidJS hook for one-shot voice search using the Web Speech API.
 *
 * Returns reactive signals for listening state, transcript, errors,
 * and start/stop controls. Falls back gracefully when the browser
 * does not support SpeechRecognition.
 */
export function useVoiceSearch(): {
  isListening: Accessor<boolean>
  transcript: Accessor<string>
  isSupported: boolean
  startListening: () => void
  stopListening: () => void
  error: Accessor<string | null>
} {
  const [isListening, setIsListening] = createSignal(false)
  const [transcript, setTranscript] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)

  // Detect browser support
  const SpeechRecognitionCtor: SpeechRecognitionConstructor | undefined =
    typeof window !== "undefined"
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined

  const isSupported = !!SpeechRecognitionCtor

  let recognition: SpeechRecognition | null = null

  function createRecognition(): SpeechRecognition | null {
    if (!SpeechRecognitionCtor) return null

    const rec = new SpeechRecognitionCtor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = "en-US"

    rec.onresult = (event: SpeechRecognitionEvent) => {
      // Collect the latest transcript from all results.
      // With interimResults=true we get interim + final results.
      let fullTranscript = ""
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript
      }
      setTranscript(fullTranscript)
    }

    rec.onend = () => {
      setIsListening(false)
    }

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" fires when we call stop() manually — not a real error
      if (event.error !== "aborted") {
        const messages: Record<string, string> = {
          "no-speech": "No speech detected. Please try again.",
          "audio-capture": "No microphone found. Check your audio settings.",
          "not-allowed": "Microphone access denied. Allow mic access and try again.",
          "network": "Network error during speech recognition.",
          "service-not-available": "Speech recognition service is unavailable.",
          "bad-grammar": "Speech grammar error.",
          "language-not-supported": "Language not supported for speech recognition.",
        }
        setError(messages[event.error] ?? `Speech recognition error: ${event.error}`)
      }
      setIsListening(false)
    }

    return rec
  }

  function startListening() {
    if (!SpeechRecognitionCtor) {
      setError("Speech recognition is not supported in this browser.")
      return
    }

    // Stop any existing session
    if (recognition) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
    }

    setError(null)
    setTranscript("")

    recognition = createRecognition()
    if (!recognition) return

    try {
      recognition.start()
      setIsListening(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Failed to start speech recognition: ${msg}`)
      setIsListening(false)
    }
  }

  function stopListening() {
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // ignore — may already be stopped
      }
    }
    setIsListening(false)
  }

  // Cleanup on unmount
  onCleanup(() => {
    if (recognition) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      recognition = null
    }
  })

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    error,
  }
}
