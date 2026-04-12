/**
 * Build the Content-Security-Policy connect-src directive value.
 * Always allows any localhost port (for SDK server + RVC Docker on any port)
 * plus HTTPS (for Azure TTS and other cloud APIs).
 * If a specific port is given, also adds explicit ws:// entries for that port.
 */
export function buildConnectSrc(port?: number): string {
  // Always allow all localhost ports (RVC Docker may run on 5050, 5051, etc.)
  // and HTTPS for Azure TTS (https://*.tts.speech.microsoft.com)
  const base = "http://127.0.0.1:* http://localhost:* https:"
  if (port) {
    return `${base} ws://127.0.0.1:${port} ws://localhost:${port}`
  }
  return `${base} ws://127.0.0.1:* ws://localhost:*`
}

/**
 * Join an array of CSP directives into a policy string.
 */
function joinCspDirectives(directives: string[]): string {
  return directives.join("; ")
}

/**
 * Build the full CSP policy string for a webview.
 */
export function buildCspString(cspSource: string, nonce: string, port?: number): string {
  const connectSrc = buildConnectSrc(port)
  const directives = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${cspSource}`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource} ${connectSrc}`,
    `img-src ${cspSource} data: https:`,
    `media-src blob: data: ${cspSource}`,
  ]
  return joinCspDirectives(directives)
}
