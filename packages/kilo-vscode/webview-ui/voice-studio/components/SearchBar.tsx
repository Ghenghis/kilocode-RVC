import { Component, createSignal, onCleanup, Show, For } from "solid-js"
import type { VoiceEntry } from "../../src/types/voice"
import { getAutocompleteResults } from "../../src/utils/voice-search"

export interface SearchBarProps {
  query: string
  onQueryChange: (query: string) => void
  voices: VoiceEntry[]
  recentSearches: string[]
  onSelectVoice?: (voice: VoiceEntry) => void
  onSelectRecent?: (query: string) => void
}

export const SearchBar: Component<SearchBarProps> = (props) => {
  const [focused, setFocused] = createSignal(false)
  const [localQuery, setLocalQuery] = createSignal(props.query)
  const [listening, setListening] = createSignal(false)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let recognitionRef: any = null

  // Check for SpeechRecognition availability
  const hasSpeechRecognition = () => {
    return typeof window !== "undefined" &&
      (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window))
  }

  const handleInput = (value: string) => {
    setLocalQuery(value)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      props.onQueryChange(value)
    }, 150)
  }

  const clearQuery = () => {
    setLocalQuery("")
    props.onQueryChange("")
  }

  const toggleMic = () => {
    if (listening()) {
      recognitionRef?.stop()
      setListening(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = "en-US"

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      handleInput(transcript)
      setListening(false)
    }

    recognition.onerror = () => {
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef = recognition
    recognition.start()
    setListening(true)
  }

  const autocomplete = () => {
    const q = localQuery()
    if (!focused()) return null
    const results = getAutocompleteResults(props.voices, q, props.recentSearches)
    const hasContent = results.recent.length > 0 || results.voices.length > 0 || results.accentSuggestion
    if (!hasContent) return null
    return results
  }

  const selectRecent = (q: string) => {
    setLocalQuery(q)
    props.onQueryChange(q)
    props.onSelectRecent?.(q)
    setFocused(false)
  }

  const selectVoice = (voice: VoiceEntry) => {
    setLocalQuery(voice.name)
    props.onQueryChange(voice.name)
    props.onSelectVoice?.(voice)
    setFocused(false)
  }

  const selectAccent = (accent: string) => {
    setLocalQuery(accent)
    props.onQueryChange(accent)
    setFocused(false)
  }

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    recognitionRef?.stop()
  })

  return (
    <div class="vs-search">
      <div class="vs-search-input-wrap">
        <span class="vs-search-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.7 10.3a6 6 0 1 0-1.4 1.4l3.5 3.5a1 1 0 0 0 1.4-1.4l-3.5-3.5zM7 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
          </svg>
        </span>
        <input
          class="vs-search-input"
          type="text"
          placeholder="Search voices..."
          value={localQuery()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay to allow click on autocomplete items
            setTimeout(() => setFocused(false), 200)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFocused(false)
              e.currentTarget.blur()
            }
          }}
        />
        <Show when={localQuery().length > 0}>
          <button
            class="vs-search-clear"
            onClick={clearQuery}
            type="button"
            title="Clear search"
            aria-label="Clear search"
          >
            &#x2715;
          </button>
        </Show>
        <Show when={hasSpeechRecognition()}>
          <button
            class={`vs-search-mic${listening() ? " vs-search-mic--active" : ""}`}
            onClick={toggleMic}
            type="button"
            title={listening() ? "Stop listening" : "Voice search"}
            aria-label={listening() ? "Stop listening" : "Voice search"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
              <path d="M4 6a1 1 0 0 0-2 0 6 6 0 0 0 5 5.91V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-2.09A6 6 0 0 0 14 6a1 1 0 0 0-2 0 4 4 0 0 1-8 0z" />
            </svg>
          </button>
        </Show>
      </div>

      <Show when={autocomplete()}>
        {(ac) => (
          <div class="vs-autocomplete">
            <Show when={ac().recent.length > 0}>
              <div class="vs-autocomplete-section">
                <div class="vs-autocomplete-label">Recent</div>
                <For each={ac().recent}>
                  {(q) => (
                    <div class="vs-autocomplete-item" onMouseDown={() => selectRecent(q)}>
                      <span class="vs-autocomplete-item-icon">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 0 11zM8.5 4H7v5l4 2.5.75-1.23L9 8.5V4z" />
                        </svg>
                      </span>
                      <span>{q}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={ac().voices.length > 0}>
              <div class="vs-autocomplete-section">
                <div class="vs-autocomplete-label">Voices</div>
                <For each={ac().voices}>
                  {(voice) => (
                    <div class="vs-autocomplete-item" onMouseDown={() => selectVoice(voice)}>
                      <span class="vs-autocomplete-item-icon">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
                          <path d="M4 6a1 1 0 0 0-2 0 6 6 0 0 0 5 5.91V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-2.09A6 6 0 0 0 14 6a1 1 0 0 0-2 0 4 4 0 0 1-8 0z" />
                        </svg>
                      </span>
                      <span>{voice.name}</span>
                      <span style={{ "margin-left": "auto", "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
                        {voice.provider}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={ac().accentSuggestion}>
              {(accent) => (
                <div class="vs-autocomplete-section">
                  <div class="vs-autocomplete-label">Accent</div>
                  <div class="vs-autocomplete-item" onMouseDown={() => selectAccent(accent())}>
                    <span class="vs-autocomplete-item-icon">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13zM7 4h2v5H7V4zm0 6h2v2H7v-2z" />
                      </svg>
                    </span>
                    <span>Filter by accent: {accent()}</span>
                  </div>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
