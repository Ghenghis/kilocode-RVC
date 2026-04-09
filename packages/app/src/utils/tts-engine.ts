import { synthesizeAzure } from "./tts-azure"
import { synthesizeBrowser, stopBrowser } from "./tts-browser"
import { synthesizeRvc } from "./tts-rvc"
import { playTTS, stopTTS } from "./tts"

export type SpeechOpts = {
  provider: "rvc" | "azure" | "browser"
  volume: number
  rvc: { voiceId: string; dockerPort: number }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
}

let busy = false

export function isSpeaking(): boolean {
  return busy
}

export function cancelSpeech(): void {
  stopTTS()
  stopBrowser()
  busy = false
}

export async function speak(text: string, opts: SpeechOpts): Promise<void> {
  if (!text.trim()) return
  cancelSpeech()
  busy = true
  try {
    if (opts.provider === "azure") {
      const blob = await synthesizeAzure(text, opts.azure)
      playTTS(blob, opts.volume)
    } else if (opts.provider === "rvc") {
      const blob = await synthesizeRvc(text, {
        voiceId: opts.rvc.voiceId,
        port: opts.rvc.dockerPort,
        volume: opts.volume,
      })
      playTTS(blob, opts.volume)
    } else {
      await synthesizeBrowser(text, { ...opts.browser, volume: opts.volume })
    }
  } catch (err) {
    console.warn("[TTS]", err)
  } finally {
    busy = false
  }
}
