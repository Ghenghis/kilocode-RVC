export interface RvcLocalVoice {
  id: string
  name: string
  path: string
}

export function formatVoiceName(folderId: string): string {
  const parts = folderId.split(/[-_]/)
  if (parts.length >= 3) {
    const locale = parts[0].toUpperCase()
    const gender = parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase()
    const name = parts
      .slice(2)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
      .replace(/\s*[Vv]\d+$/, "")
    return `${name} (${gender}, ${locale})`
  }
  return folderId
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

export function enrichVoiceList(raw: { id: string; sizeMB: number }[]): RvcLocalVoice[] {
  return raw.map((v) => ({
    id: v.id,
    name: formatVoiceName(v.id),
    path: v.id,
  }))
}
