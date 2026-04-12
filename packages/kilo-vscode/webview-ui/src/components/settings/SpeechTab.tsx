import { Component, createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import { AZURE_VOICES, AZURE_LOCALES, type AzureVoice } from "../../data/azure-voices"
import { speechPlayback, type SpeechConfig } from "../../utils/speech-playback"

// ── Types ────────────────────────────────────────────────────────────────────
type SpeechProvider = "rvc" | "azure" | "browser"

interface SpeechSettings {
  enabled: boolean
  autoSpeak: boolean
  provider: SpeechProvider
  volume: number
  interactionMode: "silent" | "assist" | "handsfree"
  rvc: { voiceId: string; dockerPort: number; edgeVoice: string; pitchShift: number; modelServerUrl: string }
  azure: { region: string; apiKey: string; voiceId: string }
  browser: { voiceURI: string; rate: number; pitch: number }
  debugMode: boolean
  kiloDebugMode: boolean
  // kilocode_change — Phase 2.3: sentiment intensity
  sentimentIntensity: number
  // kilocode_change — Phase 3.1: interrupt on type
  interruptOnType: boolean
  // kilocode_change — Phase 4.2: multi-voice dialogue mode
  multiVoiceMode: boolean
}

const DEFAULT_SPEECH: SpeechSettings = {
  enabled: false,
  autoSpeak: false,
  provider: "browser",
  volume: 80,
  interactionMode: "silent",
  rvc: { voiceId: "", dockerPort: 5050, edgeVoice: "en-US-AriaNeural", pitchShift: 0, modelServerUrl: "https://voice.daveai.tech" },
  azure: { region: "westus", apiKey: "", voiceId: "en-US-JennyNeural" },
  browser: { voiceURI: "", rate: 1.0, pitch: 1.0 },
  debugMode: false,
  kiloDebugMode: false,
  // kilocode_change — Phase 2.3 / 3.1 / 4.2 new fields
  sentimentIntensity: 70,
  interruptOnType: true,
  multiVoiceMode: false,
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

// ── RVC voice name formatter ──────────────────────────────────────────────
function formatRvcName(folderId: string): string {
  return folderId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── TTS playback — routes through SpeechEngine with validation + fallback ──
function stopPlayback() {
  speechPlayback.stop()
}

/** Convert SpeechSettings to the SpeechConfig shape the engine expects */
function toEngineConfig(settings: SpeechSettings): SpeechConfig {
  return {
    provider: settings.provider,
    volume: settings.volume,
    rvc: settings.rvc,
    azure: settings.azure,
    browser: settings.browser,
  }
}

// ── Component ─────────────────────────────────────────────────────────────
const SpeechTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [settings, setSettings] = createSignal<SpeechSettings>({ ...DEFAULT_SPEECH })
  const [previewing, setPreviewing] = createSignal(false)
  const [previewText, setPreviewText] = createSignal(language.t("settings.speech.preview.defaultText"))
  const [rvcOnline, setRvcOnline] = createSignal(false)
  const [rvcVoices, setRvcVoices] = createSignal<Array<{ id: string; sizeMB: number }>>([])
  const [rvcLoading, setRvcLoading] = createSignal(false)
  const [browserVoices, setBrowserVoices] = createSignal<SpeechSynthesisVoice[]>([])
  const [azureLocale, setAzureLocale] = createSignal("all")

  // Auto-setup state
  const [autoSetupRunning, setAutoSetupRunning] = createSignal(false)
  const [autoSetupSteps, setAutoSetupSteps] = createSignal<Array<{ step: string; detail?: string; error?: string }>>([])
  const [autoSetupDone, setAutoSetupDone] = createSignal(false)

  // Azure key validation
  const [azureKeyStatus, setAzureKeyStatus] = createSignal<"idle" | "checking" | "valid" | "invalid">("idle")
  const [azureKeyError, setAzureKeyError] = createSignal("")

  // Speech log (last 5 spoken items)
  const [speechLog, setSpeechLog] = createSignal<Array<{ time: string; provider: string; text: string; status: string }>>([])

  // ── Azure API Key Validation ─────────────────────────────────────────────
  const validateAzureKey = async () => {
    const s = settings()
    if (!s.azure.apiKey || !s.azure.region) {
      setAzureKeyStatus("invalid")
      setAzureKeyError("API key and region required")
      return
    }
    setAzureKeyStatus("checking")
    setAzureKeyError("")
    try {
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${s.azure.voiceId || "en-US-JennyNeural"}">test</voice></speak>`
      const resp = await fetch(
        `https://${s.azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": s.azure.apiKey,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          },
          body: ssml,
        },
      )
      if (resp.ok) {
        setAzureKeyStatus("valid")
        setAzureKeyError("")
      } else if (resp.status === 401) {
        setAzureKeyStatus("invalid")
        setAzureKeyError("Invalid API key")
      } else if (resp.status === 403) {
        setAzureKeyStatus("invalid")
        setAzureKeyError("Key lacks TTS permissions")
      } else {
        setAzureKeyStatus("invalid")
        setAzureKeyError(`HTTP ${resp.status}`)
      }
    } catch {
      setAzureKeyStatus("invalid")
      setAzureKeyError("Network error — check region")
    }
  }

  // ── Refresh All Providers ────────────────────────────────────────────────
  const refreshAll = async () => {
    // Refresh browser voices
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"))
    setBrowserVoices(voices)
    // Refresh RVC
    await refreshRvc()
    // Re-validate Azure if key is present
    if (settings().azure.apiKey) {
      await validateAzureKey()
    }
    // Re-request settings from extension
    vscode.postMessage({ type: "requestSpeechSettings" })
  }

  // ── Log a speech event ───────────────────────────────────────────────────
  const logSpeech = (provider: string, text: string, status: string) => {
    const now = new Date()
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setSpeechLog((prev) => [{ time, provider, text: text.slice(0, 60), status }, ...prev].slice(0, 5))
  }

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
      setSettings(message.settings as unknown as SpeechSettings)
    }
    if (message.type === "rvcSetupProgress") {
      setAutoSetupSteps((prev) => [...prev, { step: message.step, detail: message.detail, error: message.error }])
      if (message.done) {
        setAutoSetupRunning(false)
        setAutoSetupDone(true)
        if (message.voices && message.voices.length > 0) {
          setRvcVoices(message.voices)
          setRvcOnline(true)
          if (message.port) {
            setSettings((prev) => ({ ...prev, rvc: { ...prev.rvc, dockerPort: message.port! } }))
          }
          // Auto-select first voice if none selected
          if (!settings().rvc.voiceId && message.voices![0]) {
            const firstVoice = message.voices![0].id
            updateNested("rvc", "voiceId", firstVoice)
          }
        }
      }
      if (message.error && !message.done) {
        setAutoSetupRunning(false)
      }
    }
  })
  onCleanup(() => {
    unsubscribe()
    stopPlayback()
  })

  // Check RVC health + fetch voices when provider is rvc
  const refreshRvc = async () => {
    const port = settings().rvc.dockerPort
    setRvcLoading(true)
    try {
      const healthResp = await fetch(`http://localhost:${port}/health`)
      setRvcOnline(healthResp.ok)
      if (healthResp.ok) {
        const voicesResp = await fetch(`http://localhost:${port}/voices`)
        if (voicesResp.ok) {
          const voices = await voicesResp.json()
          setRvcVoices(Array.isArray(voices) ? voices : [])
        }
      }
    } catch {
      setRvcOnline(false)
      setRvcVoices([])
    } finally {
      setRvcLoading(false)
    }
  }

  createEffect(() => {
    const s = settings()
    if (s.provider === "rvc") {
      void refreshRvc()
    }
  })

  const save = (key: string, value: unknown) => {
    vscode.postMessage({ type: "updateSetting", key: `speech.${key}`, value })
  }

  const updateField = <K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]) => {
    // Stop any active playback when switching provider — prevents bleed-through
    if (key === "provider") {
      speechPlayback.stop()
      setPreviewing(false)
    }
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

  // Preview status: shows errors and fallback notices
  const [previewStatus, setPreviewStatus] = createSignal<{ type: "error" | "fallback" | "ok"; message: string } | null>(null)

  const handlePreview = async () => {
    if (previewing()) {
      stopPlayback()
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    setPreviewStatus(null)
    try {
      const result = await speechPlayback.speak(previewText(), toEngineConfig(settings()), "preview")
      if (result.error && result.error !== "Cancelled") {
        setPreviewStatus({ type: "error", message: result.error })
        logSpeech(result.provider, previewText(), `Error: ${result.error}`)
      } else if (result.usedFallback) {
        setPreviewStatus({
          type: "fallback",
          message: `${settings().provider.toUpperCase()} failed (${result.fallbackReason}). Used ${result.provider} instead.`,
        })
        logSpeech(result.provider, previewText(), `Fallback from ${settings().provider}`)
      } else {
        logSpeech(result.provider, previewText(), "OK")
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[Speech] Preview failed:", msg)
      setPreviewStatus({ type: "error", message: msg })
      logSpeech(settings().provider, previewText(), `Error: ${msg}`)
    } finally {
      setPreviewing(false)
    }
  }

  // ── Voice Comparison: play same text across all ready providers ──────────
  const [comparing, setComparing] = createSignal(false)
  const handleVoiceCompare = async () => {
    if (comparing()) return
    setComparing(true)
    const text = previewText() || "Hello, this is a voice comparison test."
    const config = toEngineConfig(settings())
    const providers: SpeechProvider[] = ["browser", "azure", "rvc"]
    for (const p of providers) {
      const health = await speechPlayback.checkProviderHealth(p, config)
      if (!health.ready) {
        logSpeech(p, text, `Skipped: ${health.reason}`)
        continue
      }
      logSpeech(p, text, "Playing...")
      try {
        await speechPlayback.speak(text, { ...config, provider: p }, "preview")
        logSpeech(p, text, "OK")
      } catch {
        logSpeech(p, text, "Failed")
      }
      // Brief pause between providers
      await new Promise((r) => setTimeout(r, 500))
    }
    setComparing(false)
  }

  const provider = () => settings().provider

  // Shared input style
  const inputStyle = {
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border)",
    "border-radius": "4px",
    padding: "4px 8px",
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>

      {/* ── Voice Studio + Refresh ─────────────────────────────────────── */}
      <Card>
        <SettingsRow
          title={language.t("settings.speech.voiceStudio.title")}
          description={language.t("settings.speech.voiceStudio.openDescription")}
          last
        >
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="primary" size="small" onClick={() => vscode.postMessage({ type: "openVoiceStudio" })}>
              {language.t("settings.speech.voiceStudio.openButton")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => void refreshAll()}>
              Refresh All
            </Button>
          </div>
        </SettingsRow>
      </Card>

      {/* ── Provider Health Dashboard ──────────────────────────────────── */}
      <div style={{
        display: "flex", gap: "8px", padding: "8px 0",
        "font-size": "11px", color: "var(--vscode-descriptionForeground)",
      }}>
        <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", "border-radius": "50%", background: browserVoices().length > 0 ? "#4a4" : "#888", display: "inline-block" }} />
          Browser ({browserVoices().length} voices)
        </span>
        <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", "border-radius": "50%", background: azureKeyStatus() === "valid" ? "#4a4" : settings().azure.apiKey ? "#fa0" : "#888", display: "inline-block" }} />
          Azure {azureKeyStatus() === "valid" ? "" : azureKeyStatus() === "invalid" ? "(key invalid)" : settings().azure.apiKey ? "(unchecked)" : "(no key)"}
        </span>
        <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <span style={{ width: "8px", height: "8px", "border-radius": "50%", background: rvcOnline() ? "#4a4" : "#f44", display: "inline-block" }} />
          RVC {rvcOnline() ? `(${rvcVoices().length} models)` : "(offline)"}
        </span>
      </div>

      {/* ── Global Controls ────────────────────────────────────────────── */}
      <Card>
        <SettingsRow title={language.t("settings.speech.enabled.title")} description={language.t("settings.speech.enabled.description")}>
          <Switch checked={settings().enabled} onChange={(c: boolean) => updateField("enabled", c)} hideLabel>
            {language.t("settings.speech.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow title={language.t("settings.speech.autoSpeak.title")} description={language.t("settings.speech.autoSpeak.description")}>
          <Switch checked={settings().autoSpeak} onChange={(c: boolean) => updateField("autoSpeak", c)} hideLabel>
            {language.t("settings.speech.autoSpeak.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow title={language.t("settings.speech.interactionMode.title")} description={language.t("settings.speech.interactionMode.description")}>
          <Select
            options={[
              { value: "silent", label: language.t("settings.speech.voiceStudio.interaction.silent") },
              { value: "assist", label: language.t("settings.speech.voiceStudio.interaction.assist") },
              { value: "handsfree", label: language.t("settings.speech.voiceStudio.interaction.handsfree") },
            ]}
            current={{ value: settings().interactionMode || "silent", label: language.t(`settings.speech.voiceStudio.interaction.${settings().interactionMode || "silent"}`) }}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => { if (o) updateField("interactionMode", o.value as "silent" | "assist" | "handsfree") }}
            variant="secondary" size="small" triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow title={language.t("settings.speech.volume.title")} description={language.t("settings.speech.volume.description")} last>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <input type="range" min="0" max="100" value={settings().volume}
              onInput={(e) => updateField("volume", Number(e.currentTarget.value))} style={{ width: "120px" }} />
            <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>{settings().volume}%</span>
          </div>
        </SettingsRow>
      </Card>

      {/* ── Provider Selector (Tab-style) ──────────────────────────────── */}
      <div style={{ display: "flex", gap: "0", "border-bottom": "2px solid var(--vscode-panel-border)" }}>
        {(["browser", "azure", "rvc"] as SpeechProvider[]).map((p) => (
          <button
            onClick={() => updateField("provider", p)}
            style={{
              flex: "1",
              padding: "8px 12px",
              background: provider() === p ? "var(--vscode-tab-activeBackground, var(--vscode-editor-background))" : "transparent",
              color: provider() === p ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
              border: "none",
              "border-bottom": provider() === p ? "2px solid var(--vscode-focusBorder)" : "2px solid transparent",
              cursor: "pointer",
              "font-size": "12px",
              "font-weight": provider() === p ? "600" : "400",
              "font-family": "inherit",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "6px",
              "margin-bottom": "-2px",
            }}
          >
            <span style={{
              width: "6px", height: "6px", "border-radius": "50%", display: "inline-block",
              background: p === "browser" ? "#4a4"
                : p === "azure" ? (azureKeyStatus() === "valid" ? "#4a4" : settings().azure.apiKey ? "#fa0" : "#888")
                : rvcOnline() ? "#4a4" : "#f44",
            }} />
            {p === "browser" ? "Browser" : p === "azure" ? "Azure TTS" : "RVC Docker"}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          BROWSER PROVIDER PANEL
         ══════════════════════════════════════════════════════════════════ */}
      <Show when={provider() === "browser"}>
        <Card>
          <SettingsRow title={language.t("settings.speech.browser.voice.title")} description={language.t("settings.speech.browser.voice.description")}>
            <Select options={browserVoices()} current={browserVoices().find((v) => v.voiceURI === settings().browser.voiceURI)}
              value={(o: SpeechSynthesisVoice) => o.voiceURI} label={(o: SpeechSynthesisVoice) => `${o.name} (${o.lang})`}
              onSelect={(o: SpeechSynthesisVoice | undefined) => { if (o) updateNested("browser", "voiceURI", o.voiceURI) }}
              variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.browser.rate.title")} description={language.t("settings.speech.browser.rate.description")}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input type="range" min="0.5" max="2" step="0.1" value={settings().browser.rate}
                onInput={(e) => updateNested("browser", "rate", Number(e.currentTarget.value))} style={{ width: "120px" }} />
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>{settings().browser.rate.toFixed(1)}x</span>
            </div>
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.browser.pitch.title")} description={language.t("settings.speech.browser.pitch.description")} last>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input type="range" min="0.5" max="2" step="0.1" value={settings().browser.pitch}
                onInput={(e) => updateNested("browser", "pitch", Number(e.currentTarget.value))} style={{ width: "120px" }} />
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "32px" }}>{settings().browser.pitch.toFixed(1)}</span>
            </div>
          </SettingsRow>
        </Card>
      </Show>

      {/* ══════════════════════════════════════════════════════════════════
          AZURE TTS PROVIDER PANEL
         ══════════════════════════════════════════════════════════════════ */}
      <Show when={provider() === "azure"}>
        <Card>
          <SettingsRow title={language.t("settings.speech.azure.apiKey.title")} description={language.t("settings.speech.azure.apiKey.description")}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input type="password" value={settings().azure.apiKey}
                onInput={(e) => { updateNested("azure", "apiKey", e.currentTarget.value); setAzureKeyStatus("idle") }}
                placeholder={language.t("settings.speech.azure.apiKey.placeholder")}
                style={{ ...inputStyle, width: "200px" }} />
              <Button variant="secondary" size="small" onClick={() => void validateAzureKey()}
                disabled={azureKeyStatus() === "checking" || !settings().azure.apiKey}>
                {azureKeyStatus() === "checking" ? "..." : "Validate"}
              </Button>
              <span style={{
                "font-size": "14px", "font-weight": "bold",
                color: azureKeyStatus() === "valid" ? "#4a4" : azureKeyStatus() === "invalid" ? "#f44" : "transparent",
              }}>
                {azureKeyStatus() === "valid" ? "✓" : azureKeyStatus() === "invalid" ? "✗" : "·"}
              </span>
            </div>
            <Show when={azureKeyError()}>
              <div style={{ "font-size": "11px", color: "var(--vscode-errorForeground, #f44)", "margin-top": "4px" }}>{azureKeyError()}</div>
            </Show>
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.azure.region.title")} description={language.t("settings.speech.azure.region.description")}>
            <input type="text" value={settings().azure.region}
              onInput={(e) => { updateNested("azure", "region", e.currentTarget.value); setAzureKeyStatus("idle") }}
              placeholder="westus" style={{ ...inputStyle, width: "120px" }} />
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.azure.locale.title")} description={language.t("settings.speech.azure.locale.description")}>
            <Select
              options={[{ value: "all", label: language.t("settings.speech.azure.locale.all") }, ...AZURE_LOCALES.map((l) => ({ value: l, label: l }))]}
              current={azureLocale() === "all" ? { value: "all", label: language.t("settings.speech.azure.locale.all") } : { value: azureLocale(), label: azureLocale() }}
              value={(o) => o.value} label={(o) => o.label}
              onSelect={(o) => { if (o) setAzureLocale(o.value) }}
              variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.azure.voice.title")} description={language.t("settings.speech.azure.voice.description")} last>
            <Select options={filteredAzureVoices()} current={AZURE_VOICES.find((v) => v.id === settings().azure.voiceId)}
              value={(o: AzureVoice) => o.id} label={(o: AzureVoice) => `${o.name} (${o.gender})`}
              onSelect={(o: AzureVoice | undefined) => { if (o) updateNested("azure", "voiceId", o.id) }}
              variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>
        </Card>
      </Show>

      {/* ══════════════════════════════════════════════════════════════════
          RVC DOCKER PROVIDER PANEL
         ══════════════════════════════════════════════════════════════════ */}
      <Show when={provider() === "rvc"}>
        {/* Auto Setup */}
        <div style={{
          background: "var(--vscode-textBlockQuote-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px", padding: "12px 16px", "margin-bottom": "12px",
        }}>
          <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 8px 0", "font-weight": "600" }}>
            {language.t("settings.speech.rvc.setup.title")}
          </p>
          <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 10px 0", "line-height": "1.5" }}>
            {language.t("settings.speech.rvc.setup.autoDesc")}
          </p>
          <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": autoSetupSteps().length > 0 ? "12px" : "0" }}>
            <Button variant="primary" size="small" disabled={autoSetupRunning()} onClick={() => {
              setAutoSetupSteps([]); setAutoSetupDone(false); setAutoSetupRunning(true)
              vscode.postMessage({ type: "autoSetupRvc" })
            }}>
              {autoSetupRunning() ? language.t("settings.speech.rvc.setup.running")
                : autoSetupDone() ? language.t("settings.speech.rvc.setup.rerun") : language.t("settings.speech.rvc.setup.autoButton")}
            </Button>
            <Show when={autoSetupDone() && rvcOnline()}>
              <span style={{ "font-size": "11px", color: "var(--vscode-testing-iconPassed)" }}>
                ✓ {language.t("settings.speech.rvc.online")}
              </span>
            </Show>
          </div>
          <Show when={autoSetupSteps().length > 0}>
            <div style={{ "font-size": "11px", "line-height": "1.6" }}>
              {autoSetupSteps().map((s) => (
                <div style={{ display: "flex", gap: "6px", "align-items": "flex-start", padding: "1px 0" }}>
                  <span style={{ color: s.error ? "var(--vscode-testing-iconFailed)" : "var(--vscode-testing-iconPassed)", "flex-shrink": "0" }}>
                    {s.error ? "✗" : "✓"}
                  </span>
                  <span style={{ color: s.error ? "var(--vscode-testing-iconFailed)" : "var(--vscode-foreground)" }}>
                    {s.step}{s.detail ? <span style={{ color: "var(--vscode-descriptionForeground)" }}> — {s.detail}</span> : null}
                  </span>
                </div>
              ))}
              <Show when={autoSetupRunning()}>
                <div style={{ display: "flex", gap: "6px", padding: "1px 0", color: "var(--vscode-descriptionForeground)" }}>
                  <span>⏳</span><span>{language.t("settings.speech.rvc.setup.working")}</span>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <Card>
          <SettingsRow title={language.t("settings.speech.rvc.port.title")} description={language.t("settings.speech.rvc.port.description")}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input type="number" value={settings().rvc.dockerPort}
                onInput={(e) => { const v = Number(e.currentTarget.value); if (v > 1023 && v < 65536) updateNested("rvc", "dockerPort", v) }}
                style={{ ...inputStyle, width: "80px", "text-align": "right" }} />
              <Button variant="secondary" size="small" onClick={() => void refreshRvc()} disabled={rvcLoading()}>
                {rvcLoading() ? language.t("settings.speech.rvc.checking") : language.t("settings.speech.rvc.refresh")}
              </Button>
              <span style={{ "font-size": "11px", color: rvcOnline() ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)" }}>
                {rvcOnline() ? language.t("settings.speech.rvc.online") : language.t("settings.speech.rvc.offline")}
              </span>
            </div>
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.rvc.voice.title")} description={language.t("settings.speech.rvc.voice.description")}>
            <Show when={rvcOnline() && rvcVoices().length > 0}
              fallback={
                <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                  <input type="text" value={settings().rvc.voiceId}
                    onInput={(e) => updateNested("rvc", "voiceId", e.currentTarget.value)}
                    placeholder={language.t("settings.speech.rvc.voice.placeholder")} style={{ ...inputStyle, width: "180px" }} />
                  <Show when={!rvcOnline()}>
                    <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                      {language.t("settings.speech.rvc.voice.startDocker")}
                    </span>
                  </Show>
                </div>
              }>
              <Select options={rvcVoices()} current={rvcVoices().find((v) => v.id === settings().rvc.voiceId)}
                value={(o: { id: string; sizeMB: number }) => o.id}
                label={(o: { id: string; sizeMB: number }) => `${formatRvcName(o.id)} (${o.sizeMB} MB)`}
                onSelect={(o: { id: string; sizeMB: number } | undefined) => { if (o) updateNested("rvc", "voiceId", o.id) }}
                variant="secondary" size="small" triggerVariant="settings" />
            </Show>
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.rvc.edgeVoice.title")} description={language.t("settings.speech.rvc.edgeVoice.description")}>
            <Select options={AZURE_VOICES.filter((v) => v.locale === "en-US")}
              current={AZURE_VOICES.find((v) => v.id === (settings().rvc.edgeVoice || "en-US-AriaNeural"))}
              value={(o: AzureVoice) => o.id} label={(o: AzureVoice) => `${o.name} (${o.gender})`}
              onSelect={(o: AzureVoice | undefined) => { if (o) updateNested("rvc", "edgeVoice", o.id) }}
              variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>
          <SettingsRow title={language.t("settings.speech.rvc.pitchShift.title")} description={language.t("settings.speech.rvc.pitchShift.description")} last>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <input type="range" min="-12" max="12" step="1" value={settings().rvc.pitchShift || 0}
                onInput={(e) => updateNested("rvc", "pitchShift", Number(e.currentTarget.value))} style={{ width: "120px" }} />
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "40px" }}>
                {(settings().rvc.pitchShift || 0) > 0 ? "+" : ""}{settings().rvc.pitchShift || 0} st
              </span>
            </div>
          </SettingsRow>
        </Card>
      </Show>

      {/* ── Preview (always visible, uses active provider) ─────────────── */}
      <Card>
        <div style={{ padding: "12px" }}>
          <div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "8px" }}>
            Preview — {provider() === "browser" ? "Browser" : provider() === "azure" ? "Azure TTS" : "RVC Docker"}
          </div>
          <textarea value={previewText()} onInput={(e) => setPreviewText(e.currentTarget.value)} rows={2}
            style={{ ...inputStyle, width: "100%", resize: "vertical", "font-family": "inherit", "font-size": "12px", "box-sizing": "border-box", padding: "8px" }}
            placeholder={language.t("settings.speech.preview.placeholder")} />
          <div style={{ "margin-top": "8px", display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap" }}>
            <Button variant="secondary" size="small" onClick={() => void handlePreview()} disabled={!previewText().trim()}>
              {previewing() ? language.t("settings.speech.preview.stop") : language.t("settings.speech.preview.play")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => void handleVoiceCompare()} disabled={comparing() || !previewText().trim()}>
              {comparing() ? "Comparing..." : "Compare All"}
            </Button>
            <Show when={previewStatus()}>
              {(status) => (
                <span style={{
                  "font-size": "11px", "max-width": "300px", "word-break": "break-word",
                  color: status().type === "error" ? "var(--vscode-errorForeground, #f44)"
                    : status().type === "fallback" ? "var(--vscode-editorWarning-foreground, #fa0)"
                    : "var(--vscode-testing-iconPassed, #4a4)",
                }}>
                  {status().type === "fallback" ? "⚠ " : status().type === "error" ? "✗ " : ""}{status().message}
                </span>
              )}
            </Show>
          </div>
        </div>
      </Card>

      {/* ── Speech Activity Log ────────────────────────────────────────── */}
      <Show when={speechLog().length > 0}>
        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
          <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>Speech Log</div>
          {speechLog().map((entry) => (
            <div style={{ display: "flex", gap: "8px", padding: "2px 0", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
              <span style={{ color: "var(--vscode-descriptionForeground)", "flex-shrink": "0" }}>{entry.time}</span>
              <span style={{
                "font-weight": "500", "flex-shrink": "0",
                color: entry.status === "OK" ? "var(--vscode-testing-iconPassed)" : entry.status.startsWith("Error") ? "var(--vscode-errorForeground, #f44)" : "var(--vscode-foreground)",
              }}>
                {entry.provider}
              </span>
              <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{entry.text}</span>
              <span style={{
                "margin-left": "auto", "flex-shrink": "0",
                color: entry.status === "OK" ? "var(--vscode-testing-iconPassed)" : "var(--vscode-errorForeground, #f44)",
              }}>
                {entry.status === "OK" ? "✓" : entry.status}
              </span>
            </div>
          ))}
        </div>
      </Show>

      {/* ── Debug Mode ─────────────────────────────────────────────────── */}
      <Card>
        <SettingsRow title="Speech Debug Mode" description="Show verbose speech engine logs in the developer console." last>
          <Switch checked={settings().debugMode} onChange={(c: boolean) => updateField("debugMode", c)} hideLabel>
            Speech Debug
          </Switch>
        </SettingsRow>
      </Card>

      {/* ── kilocode_change: Phase 2.3 — Sentiment Intensity + Interrupt on Type ── */}
      <Card>
        <SettingsRow
          title="Sentiment Intensity"
          description="How strongly the TTS engine modulates pitch and rate to reflect emotional tone in responses."
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <input
              type="range" min="0" max="100" step="1"
              value={settings().sentimentIntensity}
              onInput={(e) => updateField("sentimentIntensity", Number(e.currentTarget.value))}
              style={{ width: "120px" }}
            />
            <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "min-width": "40px" }}>
              {settings().sentimentIntensity}%
            </span>
          </div>
        </SettingsRow>

        {/* kilocode_change: Phase 3.1 — Interrupt on type */}
        <SettingsRow
          title="Stop speech when typing"
          description="Automatically interrupt ongoing speech playback as soon as you start typing a new message."
          last
        >
          <Switch checked={settings().interruptOnType} onChange={(c: boolean) => updateField("interruptOnType", c)} hideLabel>
            Stop speech when typing
          </Switch>
        </SettingsRow>
      </Card>

      {/* ── kilocode_change: Phase 2.3 — Voice Profiles (task-type heuristics) ── */}
      <Card>
        <div style={{ padding: "12px 12px 4px 12px" }}>
          <div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }}>Voice Profiles</div>
          <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "10px" }}>
            Applied automatically based on content detection. Intensity is scaled by the Sentiment Intensity setting above.
          </div>
          <table style={{
            width: "100%", "border-collapse": "collapse",
            "font-size": "11px", color: "var(--vscode-foreground)",
          }}>
            <thead>
              <tr style={{ "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                <th style={{ "text-align": "left", padding: "4px 8px 4px 0", color: "var(--vscode-descriptionForeground)", "font-weight": "600" }}>Content type</th>
                <th style={{ "text-align": "left", padding: "4px 8px 4px 0", color: "var(--vscode-descriptionForeground)", "font-weight": "600" }}>Profile</th>
                <th style={{ "text-align": "left", padding: "4px 0", color: "var(--vscode-descriptionForeground)", "font-weight": "600" }}>Modifiers</th>
              </tr>
            </thead>
            <tbody>
              {([
                { type: "Error / stack trace", profile: "serious", modifiers: "Pitch −1 st · Rate 0.95×" },
                { type: "Success / completion", profile: "upbeat", modifiers: "Pitch ±0 · Rate 1.0×" },
                { type: "Code explanation", profile: "teaching", modifiers: "Pitch ±0 · Rate 0.9×" },
                { type: "Quick confirmation", profile: "casual", modifiers: "Pitch +0.5 st · Rate 1.1×" },
              ] as const).map((row, i, arr) => (
                <tr style={{ "border-bottom": i < arr.length - 1 ? "1px solid var(--vscode-panel-border)" : "none" }}>
                  <td style={{ padding: "5px 8px 5px 0" }}>{row.type}</td>
                  <td style={{ padding: "5px 8px 5px 0" }}>
                    <span style={{
                      display: "inline-block", padding: "1px 6px", "border-radius": "10px",
                      background: "var(--vscode-badge-background)", color: "var(--vscode-badge-foreground)",
                      "font-size": "10px", "font-weight": "500",
                    }}>{row.profile}</span>
                  </td>
                  <td style={{ padding: "5px 0", color: "var(--vscode-descriptionForeground)" }}>{row.modifiers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ height: "8px" }} />
      </Card>

      {/* ── kilocode_change: Phase 4.2 — Multi-Agent Voice ─────────────── */}
      <Card>
        <SettingsRow
          title="Multi-Voice Dialogue Mode"
          description="Each AI agent speaks in a distinct voice when multiple agents are active in a conversation."
          last
        >
          <Switch checked={settings().multiVoiceMode} onChange={(c: boolean) => updateField("multiVoiceMode", c)} hideLabel>
            Multi-Voice Dialogue Mode
          </Switch>
        </SettingsRow>
      </Card>

      {/* ── Fallback Info ──────────────────────────────────────────────── */}
      <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", padding: "4px 0" }}>
        Fallback chain: <strong>RVC</strong> → <strong>Azure</strong> → <strong>Browser</strong> &nbsp;|&nbsp;
        If the selected provider fails, speech automatically falls back to the next available provider.
      </div>

      {/* ── kilocode_change: Phase 6.1 — Voice slash-command reference ─── */}
      <div style={{
        background: "var(--vscode-textBlockQuote-background)",
        border: "1px solid var(--vscode-panel-border)",
        "border-radius": "4px", padding: "10px 14px",
      }}>
        <div style={{ "font-size": "11px", "font-weight": "600", "margin-bottom": "6px", color: "var(--vscode-foreground)" }}>
          Voice Commands
        </div>
        <div style={{ "font-size": "11px", "line-height": "1.8", color: "var(--vscode-descriptionForeground)" }}>
          <div><code style={{ color: "var(--vscode-textPreformat-foreground)" }}>/voice snoop-dogg</code> — switch voice mid-conversation</div>
          <div><code style={{ color: "var(--vscode-textPreformat-foreground)" }}>/voice auto</code> — enable context-aware voice routing</div>
          <div><code style={{ color: "var(--vscode-textPreformat-foreground)" }}>/voice compare</code> — speak response in all installed voices</div>
          <div><code style={{ color: "var(--vscode-textPreformat-foreground)" }}>/voice status</code> — show active voice and health</div>
        </div>
      </div>
    </div>
  )
}

export default SpeechTab
