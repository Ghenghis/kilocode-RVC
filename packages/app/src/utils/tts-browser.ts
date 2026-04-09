export interface BrowserVoiceOption {
  uri: string
  name: string
  lang: string
}

export function getBrowserVoices(): BrowserVoiceOption[] {
  if (typeof speechSynthesis === "undefined") return []
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("en"))
    .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }))
}

export function synthesizeBrowser(
  text: string,
  opts: { voiceURI: string; rate: number; pitch: number; volume: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") {
      reject(new Error("speechSynthesis not supported"))
      return
    }
    speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = opts.rate
    utt.pitch = opts.pitch
    utt.volume = Math.max(0, Math.min(1, opts.volume / 100))
    if (opts.voiceURI) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI)
      if (voice) utt.voice = voice
    }
    utt.onend = () => resolve()
    utt.onerror = (e) => reject(new Error(e.error))
    speechSynthesis.speak(utt)
  })
}

export function stopBrowser() {
  if (typeof speechSynthesis === "undefined") return
  speechSynthesis.cancel()
}
