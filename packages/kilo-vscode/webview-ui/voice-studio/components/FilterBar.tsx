import { Component, Show, For, createMemo } from "solid-js"
import type { FilterState, VoiceEntry, VoiceGender, VoiceStyle, VoiceProvider } from "../../src/types/voice"
import { DEFAULT_FILTERS, ACCENT_LABELS, MOOD_MAPPINGS } from "../../src/types/voice"
import { getFilterCounts } from "../../src/utils/voice-search"
import { TagChip } from "./TagChip"

export interface FilterBarProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  voices: VoiceEntry[]
  searchQuery: string
}

const GENDERS: { value: VoiceGender | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "neutral", label: "Neutral" },
]

const STYLES: VoiceStyle[] = ["natural", "expressive", "whisper", "broadcast", "singing", "character"]
const PROVIDERS: VoiceProvider[] = ["rvc", "azure", "browser", "kokoro", "piper", "xtts", "f5tts", "bark", "chatterbox"]
const MOODS = Object.keys(MOOD_MAPPINGS)

const ACCENT_CODES = Object.keys(ACCENT_LABELS)

export const FilterBar: Component<FilterBarProps> = (props) => {
  const counts = createMemo(() => getFilterCounts(props.voices, props.searchQuery, props.filters))

  const hasActiveFilters = createMemo(() => {
    const f = props.filters
    return (
      f.gender !== null ||
      f.accents.length > 0 ||
      f.styles.length > 0 ||
      f.providers.length > 0 ||
      f.moods.length > 0 ||
      f.installedOnly ||
      f.favoritesOnly
    )
  })

  const activeFilterLabels = createMemo(() => {
    const labels: { key: string; label: string }[] = []
    const f = props.filters
    if (f.gender) labels.push({ key: `gender:${f.gender}`, label: `Gender: ${f.gender}` })
    for (const a of f.accents) labels.push({ key: `accent:${a}`, label: ACCENT_LABELS[a] ?? a })
    for (const s of f.styles) labels.push({ key: `style:${s}`, label: `Style: ${s}` })
    for (const p of f.providers) labels.push({ key: `provider:${p}`, label: `Provider: ${p}` })
    for (const m of f.moods) labels.push({ key: `mood:${m}`, label: `Mood: ${m}` })
    if (f.installedOnly) labels.push({ key: "installed", label: "Installed only" })
    if (f.favoritesOnly) labels.push({ key: "favorites", label: "Favorites only" })
    return labels
  })

  const setGender = (g: VoiceGender | null) => {
    props.onFiltersChange({ ...props.filters, gender: g })
  }

  const toggleAccent = (code: string) => {
    const current = props.filters.accents
    const next = current.includes(code) ? current.filter((a) => a !== code) : [...current, code]
    props.onFiltersChange({ ...props.filters, accents: next })
  }

  const toggleStyle = (s: VoiceStyle) => {
    const current = props.filters.styles
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s]
    props.onFiltersChange({ ...props.filters, styles: next })
  }

  const toggleProvider = (p: VoiceProvider) => {
    const current = props.filters.providers
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p]
    props.onFiltersChange({ ...props.filters, providers: next })
  }

  const toggleMood = (m: string) => {
    const current = props.filters.moods
    const next = current.includes(m) ? current.filter((x) => x !== m) : [...current, m]
    props.onFiltersChange({ ...props.filters, moods: next })
  }

  const removeFilter = (key: string) => {
    const f = { ...props.filters }
    if (key.startsWith("gender:")) {
      f.gender = null
    } else if (key.startsWith("accent:")) {
      const val = key.slice(7)
      f.accents = f.accents.filter((a) => a !== val)
    } else if (key.startsWith("style:")) {
      const val = key.slice(6) as VoiceStyle
      f.styles = f.styles.filter((s) => s !== val)
    } else if (key.startsWith("provider:")) {
      const val = key.slice(9) as VoiceProvider
      f.providers = f.providers.filter((p) => p !== val)
    } else if (key.startsWith("mood:")) {
      const val = key.slice(5)
      f.moods = f.moods.filter((m) => m !== val)
    } else if (key === "installed") {
      f.installedOnly = false
    } else if (key === "favorites") {
      f.favoritesOnly = false
    }
    props.onFiltersChange(f)
  }

  const clearAll = () => {
    props.onFiltersChange({ ...DEFAULT_FILTERS })
  }

  // Only show accents/styles/providers that exist in current voice set
  const availableAccents = createMemo(() => {
    const accentSet = new Set(props.voices.map((v) => v.accent))
    return ACCENT_CODES.filter((a) => accentSet.has(a))
  })

  const availableStyles = createMemo(() => {
    const styleSet = new Set(props.voices.map((v) => v.style))
    return STYLES.filter((s) => styleSet.has(s))
  })

  const availableProviders = createMemo(() => {
    const providerSet = new Set(props.voices.map((v) => v.provider))
    return PROVIDERS.filter((p) => providerSet.has(p))
  })

  return (
    <div class="vs-filters">
      {/* Gender */}
      <div class="vs-filter-group">
        <span class="vs-filter-group-label">Gender</span>
        <For each={GENDERS}>
          {(g) => (
            <TagChip
              label={g.label}
              active={props.filters.gender === g.value}
              count={g.value ? counts()[`gender:${g.value}`] : undefined}
              onToggle={() => setGender(props.filters.gender === g.value ? null : g.value)}
            />
          )}
        </For>
      </div>

      {/* Accents */}
      <Show when={availableAccents().length > 0}>
        <div class="vs-filter-group">
          <span class="vs-filter-group-label">Accent</span>
          <For each={availableAccents()}>
            {(code) => (
              <TagChip
                label={ACCENT_LABELS[code] ?? code}
                active={props.filters.accents.includes(code)}
                count={counts()[`accent:${code}`]}
                onToggle={() => toggleAccent(code)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Styles */}
      <Show when={availableStyles().length > 0}>
        <div class="vs-filter-group">
          <span class="vs-filter-group-label">Style</span>
          <For each={availableStyles()}>
            {(s) => (
              <TagChip
                label={s}
                active={props.filters.styles.includes(s)}
                count={counts()[`style:${s}`]}
                onToggle={() => toggleStyle(s)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Providers */}
      <Show when={availableProviders().length > 0}>
        <div class="vs-filter-group">
          <span class="vs-filter-group-label">Provider</span>
          <For each={availableProviders()}>
            {(p) => (
              <TagChip
                label={p}
                active={props.filters.providers.includes(p)}
                count={counts()[`provider:${p}`]}
                onToggle={() => toggleProvider(p)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Moods */}
      <div class="vs-filter-group">
        <span class="vs-filter-group-label">Mood</span>
        <For each={MOODS}>
          {(m) => (
            <TagChip
              label={m}
              active={props.filters.moods.includes(m)}
              count={counts()[`mood:${m}`]}
              onToggle={() => toggleMood(m)}
            />
          )}
        </For>
      </div>

      {/* Active filters summary */}
      <Show when={hasActiveFilters()}>
        <div class="vs-active-filters">
          <For each={activeFilterLabels()}>
            {(item) => (
              <TagChip
                label={item.label}
                active
                dismissible
                onDismiss={() => removeFilter(item.key)}
                onToggle={() => removeFilter(item.key)}
              />
            )}
          </For>
          <button class="vs-clear-all" onClick={clearAll} type="button">
            Clear all
          </button>
        </div>
      </Show>
    </div>
  )
}
