import { Component, createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import { AZURE_VOICES, AZURE_LOCALES, type AzureVoice } from "../../data/azure-voices"

// ── Types ────────────────────────────────────────────────────────────────────
type SpeechProvider = "rvc" | "azure" | "browser"

interface SpeechSettings {
  enabled: boolean
  autoSpeak: boolean
  provider: SpeechProvider
  volume: number
  rvc: { voiceId: string; dockerPort: number }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
}

const DEFAULT_SPEECH: SpeechSettings = {
  enabled: false,
  autoSpeak: false,
  provider: "browser",
  volume: 80,
  rvc: { voiceId: "", dockerPort: 5050 },
  azure: { region: "eastus", apiKey: "", voiceId: "en-US-JennyNeural" },
  browser: { voiceURI: "", rate: 1.0, pitch: 1.0 },
}

interface ProviderOption {
  value: SpeechProvider
  labelKey: string
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "browser", labelKey: "settings.speech.provider.browser" },
  { value: "azure", labelKey: "settings.speech.provider.azure" },
  { value: "rvc", labelKey: "settings.speech.provider.rvc" },
]

// ── TTS playback (browser-only, runs in webview) ──────────────────────────
let currentAudio: HTMLAudioElement | undefined
let currentUtterance: SpeechSynthesisUtterance | undefined

function stopPlayback() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = undefined
  }
  if (currentUtterance) {
    speechSynthesis.cancel()
    currentUtterance = undefined
  }
}

async function playPreview(text: string, settings: SpeechSettings): Promise<void> {
  stopPlayback()
  const vol = settings.volume / 100

  if (settings.provider === "browser") {
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.volume = vol
      utterance.rate = settings.browser.rate
      utterance.pitch = settings.browser.pitch
      if (settings.browser.voiceURI) {
        const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === settings.browser.voiceURI)
        if (voice) utterance.voice = voice
      }
      utterance.onend = () => { currentUtterance = undefined; resolve() }
      utterance.onerror = (e) => { currentUtterance = undefined; reject(e) }
      currentUtterance = utterance
      speechSynthesis.speak(utterance)
    })
  }

  if (settings.provider === "azure") {
    if (!settings.azure.apiKey) throw new Error("Azure API key required")
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${settings.azure.voiceId}">${escapeXml(text)}</voice></speak>`
    const resp = await fetch(
      `https://${settings.azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": settings.azure.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        },
        body: ssml,
      },
    )
    if (!resp.ok) throw new Error(`Azure TTS error: ${resp.status}`)
    const blob = await resp.blob()
    return playBlob(blob, vol)
  }

  if (settings.provider === "rvc") {
    const resp = await fetch(`http://localhost:${settings.rvc.dockerPort}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: settings.rvc.voiceId }),
    })
    if (!resp.ok) throw new Error(`RVC error: ${resp.status}`)
    const blob = await resp.blob()
    return playBlob(blob, vol)
  }
}

function playBlob(blob: Blob, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = volume
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = undefined; resolve() }
    audio.onerror = (e) => { URL.revokeObjectURL(url); currentAudio = undefined; reject(e) }
    currentAudio = audio
    audio.play()
  })
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

// ── Component ─────────────────────────────────────────────────────────────
const SpeechTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [settings, setSettings] = createSignal<SpeechSettings>({ ...DEFAULT_SPEECH })
  const [previewing, setPreviewing] = createSignal(false)
  const [previewText, setPreviewText] = createSignal("Hello! This is a preview of the speech output.")
  const [rvcOnline, setRvcOnline] = createSignal(false)
  const [browserVoices, setBrowserVoices] = createSignal<SpeechSynthesisVoice[]>([])
  const [azureLocale, setAzureLocale] = createSignal("all")

  // Load browser voices
  onMount(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"))
      setBrowserVoices(voices)
    }
    loadVoices()
    speechSynthesis.addEventListener("voiceschanged", loadVoices)
    vscode.postMessage({ type: "requestSpeechSettings" })
  })

  // Listen for settings from extension
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "speechSettingsLoaded") {
      setSettings(message.settings as SpeechSettings)
    }
  })
  onCleanup(() => {
    unsubscribe()
    stopPlayback()
  })

  // Check RVC health when provider is rvc
  createEffect(() => {
    const s = settings()
    if (s.provider === "rvc") {
      fetch(`http://localhost:${s.rvc.dockerPort}/health`)
        .then((r) => setRvcOnline(r.ok))
        .catch(() => setRvcOnline(false))
    }
  })

  const save = (key: string, value: unknown) => {
    vscode.postMessage({ type: "updateSetting", key: `speech.${key}`, value })
  }

  const updateField = <K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    save(key, value)
  }

  const updateNested = (section: "rvc" | "azure" | "browser", key: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }))
    save(`${section}.${key}`, value)
  }

  const filteredAzureVoices = () => {
    if (azureLocale() === "all") return AZURE_VOICES
    return AZURE_VOICES.filter((v) => v.locale === azureLocale())
  }

  const handlePreview = async () => {
    if (previewing()) {
      stopPlayback()
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    try {
      await playPreview(previewText(), settings())
    } catch (e) {
      console.error("Speech preview failed:", e)
    } finally {
      setPreviewing(false)
    }
  }

  const provider = () => settings().provider

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* General Settings */}
      <Card>
        <SettingsRow
          title={language.t("settings.speech.enabled.title")}
          description={language.t("settings.speech.enabled.description")}
        >
          <Switch
            checked={settings().enabled}
            onChange={(checked: boolean) => updateField("enabled", checked)}
            hideLabel
          >
            {language.t("settings.speech.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.speech.autoSpeak.title")}
          description={language.t("settings.speech.autoSpeak.description")}
        >
          <Switch
            checked={settings().autoSpeak}
            onChange={(checked: boolean) => updateField("autoSpeak", checked)}
            hideLabel
          >
            {language.t("settings.speech.autoSpeak.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.speech.provider.title")}
          description={language.t("settings.speech.provider.description")}
        >
          <Select
            options={PROVIDER_OPTIONS}
            current={PROVIDER_OPTIONS.find((o) => o.value === provider())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) updateField("provider", o.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.speech.volume.title")}
          description={language.t("settings.speech.volume.description")}
          last
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <input
              type="range"
              min="0"
              max="100"
              value={settings().volume}
              onInput={(e) => updateField("volume", Number(e.currentTarget.value))}
              style={{ width: "120px" }}
            />
            <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>
              {settings().volume}%
            </span>
          </div>
        </SettingsRow>
      </Card>

      {/* RVC Provider Settings */}
      <Show when={provider() === "rvc"}>
        <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.speech.rvc.title")}</h4>
        <Card>
          <SettingsRow
            title={language.t("settings.speech.rvc.port.title")}
            description={language.t("settings.speech.rvc.port.description")}
          >
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input
                type="number"
                value={settings().rvc.dockerPort}
                onInput={(e) => {
                  const v = Number(e.currentTarget.value)
                  if (v > 1023 && v < 65536) updateNested("rvc", "dockerPort", v)
                }}
                style={{
                  width: "80px",
                  background: "var(--vscode-input-background)",
                  color: "var(--vscode-input-foreground)",
                  border: "1px solid var(--vscode-input-border)",
                  "border-radius": "4px",
                  padding: "4px 8px",
                  "text-align": "right",
                }}
              />
              <span
                style={{
                  "font-size": "11px",
                  color: rvcOnline() ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                }}
              >
                {rvcOnline()
                  ? language.t("settings.speech.rvc.online")
                  : language.t("settings.speech.rvc.offline")}
              </span>
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.rvc.voice.title")}
            description={language.t("settings.speech.rvc.voice.description")}
            last
          >
            <input
              type="text"
              value={settings().rvc.voiceId}
              onInput={(e) => updateNested("rvc", "voiceId", e.currentTarget.value)}
              placeholder="e.g. en-female-aria"
              style={{
                width: "180px",
                background: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                border: "1px solid var(--vscode-input-border)",
                "border-radius": "4px",
                padding: "4px 8px",
              }}
            />
          </SettingsRow>
        </Card>
      </Show>

      {/* Azure Provider Settings */}
      <Show when={provider() === "azure"}>
        <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.speech.azure.title")}</h4>
        <Card>
          <SettingsRow
            title={language.t("settings.speech.azure.apiKey.title")}
            description={language.t("settings.speech.azure.apiKey.description")}
          >
            <input
              type="password"
              value={settings().azure.apiKey}
              onInput={(e) => updateNested("azure", "apiKey", e.currentTarget.value)}
              placeholder="Enter Azure API key"
              style={{
                width: "220px",
                background: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                border: "1px solid var(--vscode-input-border)",
                "border-radius": "4px",
                padding: "4px 8px",
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.azure.region.title")}
            description={language.t("settings.speech.azure.region.description")}
          >
            <input
              type="text"
              value={settings().azure.region}
              onInput={(e) => updateNested("azure", "region", e.currentTarget.value)}
              placeholder="eastus"
              style={{
                width: "120px",
                background: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                border: "1px solid var(--vscode-input-border)",
                "border-radius": "4px",
                padding: "4px 8px",
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.azure.locale.title")}
            description={language.t("settings.speech.azure.locale.description")}
          >
            <Select
              options={[{ value: "all", label: "All Locales" }, ...AZURE_LOCALES.map((l) => ({ value: l, label: l }))]}
              current={
                azureLocale() === "all"
                  ? { value: "all", label: "All Locales" }
                  : { value: azureLocale(), label: azureLocale() }
              }
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => {
                if (o) setAzureLocale(o.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.azure.voice.title")}
            description={language.t("settings.speech.azure.voice.description")}
            last
          >
            <Select
              options={filteredAzureVoices()}
              current={AZURE_VOICES.find((v) => v.id === settings().azure.voiceId)}
              value={(o: AzureVoice) => o.id}
              label={(o: AzureVoice) => `${o.name} (${o.gender})`}
              onSelect={(o: AzureVoice | undefined) => {
                if (o) updateNested("azure", "voiceId", o.id)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </Card>
      </Show>

      {/* Browser Provider Settings */}
      <Show when={provider() === "browser"}>
        <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.speech.browser.title")}</h4>
        <Card>
          <SettingsRow
            title={language.t("settings.speech.browser.voice.title")}
            description={language.t("settings.speech.browser.voice.description")}
          >
            <Select
              options={browserVoices()}
              current={browserVoices().find((v) => v.voiceURI === settings().browser.voiceURI)}
              value={(o: SpeechSynthesisVoice) => o.voiceURI}
              label={(o: SpeechSynthesisVoice) => `${o.name} (${o.lang})`}
              onSelect={(o: SpeechSynthesisVoice | undefined) => {
                if (o) updateNested("browser", "voiceURI", o.voiceURI)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.browser.rate.title")}
            description={language.t("settings.speech.browser.rate.description")}
          >
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings().browser.rate}
                onInput={(e) => updateNested("browser", "rate", Number(e.currentTarget.value))}
                style={{ width: "120px" }}
              />
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>
                {settings().browser.rate.toFixed(1)}x
              </span>
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.speech.browser.pitch.title")}
            description={language.t("settings.speech.browser.pitch.description")}
            last
          >
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings().browser.pitch}
                onInput={(e) => updateNested("browser", "pitch", Number(e.currentTarget.value))}
                style={{ width: "120px" }}
              />
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>
                {settings().browser.pitch.toFixed(1)}
              </span>
            </div>
          </SettingsRow>
        </Card>
      </Show>

      {/* Preview Section */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.speech.preview.title")}</h4>
      <Card>
        <div style={{ padding: "12px" }}>
          <textarea
            value={previewText()}
            onInput={(e) => setPreviewText(e.currentTarget.value)}
            rows={3}
            style={{
              width: "100%",
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              border: "1px solid var(--vscode-input-border)",
              "border-radius": "4px",
              padding: "8px",
              resize: "vertical",
              "font-family": "inherit",
              "font-size": "12px",
              "box-sizing": "border-box",
            }}
            placeholder={language.t("settings.speech.preview.placeholder")}
          />
          <div style={{ "margin-top": "8px" }}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => void handlePreview()}
              disabled={!previewText().trim()}
            >
              {previewing()
                ? language.t("settings.speech.preview.stop")
                : language.t("settings.speech.preview.play")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default SpeechTab
