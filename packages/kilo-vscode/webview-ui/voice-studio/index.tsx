import { render } from "solid-js/web"

function App() {
	const vscode = (window as any).acquireVsCodeApi?.()

	// Request initial state on mount
	if (vscode) {
		vscode.postMessage({ type: "requestVoiceStudioState" })
	}

	return (
		<div
			style={{
				padding: "20px",
				color: "var(--vscode-foreground)",
				"font-family": "var(--vscode-font-family)",
			}}>
			<h1 style={{ "font-size": "24px", "font-weight": "600", "margin-bottom": "16px" }}>Voice Studio</h1>
			<p style={{ color: "var(--vscode-descriptionForeground)" }}>Loading...</p>
		</div>
	)
}

const root = document.getElementById("root")
if (root) {
	render(() => <App />, root)
}
