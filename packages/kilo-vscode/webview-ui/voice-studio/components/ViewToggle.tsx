import { Component } from "solid-js"

export interface ViewToggleProps {
  mode: "grid" | "list"
  onChange: (mode: "grid" | "list") => void
}

export const ViewToggle: Component<ViewToggleProps> = (props) => {
  return (
    <div class="vs-view-toggle">
      <button
        class={`vs-view-btn${props.mode === "grid" ? " vs-view-btn--active" : ""}`}
        onClick={() => props.onChange("grid")}
        type="button"
        title="Grid view"
        aria-label="Grid view"
      >
        {/* Grid icon: 4 squares */}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      </button>
      <button
        class={`vs-view-btn${props.mode === "list" ? " vs-view-btn--active" : ""}`}
        onClick={() => props.onChange("list")}
        type="button"
        title="List view"
        aria-label="List view"
      >
        {/* List icon: 3 horizontal lines */}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="2" rx="1" />
          <rect x="1" y="7" width="14" height="2" rx="1" />
          <rect x="1" y="12" width="14" height="2" rx="1" />
        </svg>
      </button>
    </div>
  )
}
