export interface RvcVoiceModel {
  id: string
  sizeMB: number
}

export async function listRvcVoices(port: number): Promise<RvcVoiceModel[]> {
  try {
    const resp = await fetch(`http://localhost:${port}/voices`, { signal: AbortSignal.timeout(3000) })
    if (!resp.ok) return []
    return resp.json() as Promise<RvcVoiceModel[]>
  } catch {
    return []
  }
}

export async function synthesizeRvc(
  text: string,
  opts: { voiceId: string; port: number; volume: number },
): Promise<Blob> {
  if (!opts.voiceId) throw new Error("No RVC voice selected")
  const resp = await fetch(`http://localhost:${opts.port}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: opts.voiceId }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText)
    throw new Error(`RVC error ${resp.status}: ${msg}`)
  }
  return resp.blob()
}

export async function checkRvcHealth(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) })
    return resp.ok
  } catch {
    return false
  }
}
