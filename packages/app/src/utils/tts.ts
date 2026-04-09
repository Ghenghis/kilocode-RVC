let currentAudio: HTMLAudioElement | undefined

export function playTTS(blob: Blob, volume: number): () => void {
  if (typeof Audio === "undefined") return () => undefined
  stopTTS()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.volume = Math.max(0, Math.min(1, volume / 100))
  currentAudio = audio
  audio.play().catch(() => undefined)
  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(url)
    currentAudio = undefined
  })
  return () => {
    audio.pause()
    audio.currentTime = 0
    URL.revokeObjectURL(url)
    currentAudio = undefined
  }
}

export function stopTTS() {
  if (!currentAudio) return
  currentAudio.pause()
  currentAudio.currentTime = 0
  currentAudio = undefined
}

export function isTTSPlaying(): boolean {
  return currentAudio !== undefined && !currentAudio.paused
}
