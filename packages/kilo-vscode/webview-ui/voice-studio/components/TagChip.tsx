import { Component, Show } from "solid-js"

export interface TagChipProps {
  label: string
  active?: boolean
  count?: number
  onToggle?: () => void
  dismissible?: boolean
  onDismiss?: () => void
}

export const TagChip: Component<TagChipProps> = (props) => {
  return (
    <button
      class={`vs-chip${props.active ? " vs-chip--active" : ""}`}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle?.()
      }}
      type="button"
    >
      <span>{props.label}</span>
      <Show when={props.count !== undefined && props.count !== null}>
        <span class="vs-chip-count">({props.count})</span>
      </Show>
      <Show when={props.dismissible}>
        <button
          class="vs-chip-dismiss"
          onClick={(e) => {
            e.stopPropagation()
            props.onDismiss?.()
          }}
          type="button"
          aria-label={`Remove ${props.label}`}
        >
          &#x2715;
        </button>
      </Show>
    </button>
  )
}
