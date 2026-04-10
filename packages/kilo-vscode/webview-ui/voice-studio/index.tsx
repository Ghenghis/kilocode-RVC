import { render } from "solid-js/web"
import { App } from "./App"
import "./voice-studio.css"

const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage: (msg: unknown) => console.log("[VoiceStudio] Mock postMessage:", msg),
  getState: () => undefined,
  setState: () => {},
}

const root = document.getElementById("root")
if (root) {
  render(() => <App vscode={vscode} />, root)
}
