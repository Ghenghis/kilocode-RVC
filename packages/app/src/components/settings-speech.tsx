import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onMount,
  Show,
} from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSettings, type SpeechProvider } from "@/context/settings"
import { AZURE_VOICES, AZURE_LOCALES } from "@/data/azure-voices"
import { getBrowserVoices } from "@/utils/tts-browser"
import { listRvcVoices, checkRvcHealth } from "@/utils/tts-rvc"
import { enrichVoiceList } from "@/utils/rvc-voice-manager"
import { speak, cancelSpeech, isSpeaking } from "@/utils/tts-engine"

export const SettingsSpeech: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  const [previewText, setPreviewText] = createSignal("")
  const [previewing, setPreviewing] = createSignal(false)
  const [rvcVoices, setRvcVoices] = createSignal<{ id: string; name: string }[]>([])
  const [rvcOnline, setRvcOnline] = createSignal(false)
  const [browserVoices, setBrowserVoices] = createSignal<{ uri: string; name: string; lang: string }[]>([])
  const [azureLocaleFilter, setAzureLocaleFilter] = createSignal("en-US")

  onMount(() => {
    setBrowserVoices(getBrowserVoices())
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.onvoiceschanged = () => setBrowserVoices(getBrowserVoices())
    }
  })

  const refreshRvcVoices = async () => {
    const port = settings.speech.rvc.dockerPort()
    const online = await checkRvcHealth(port)
    setRvcOnline(online)
    if (online) {
      const raw = await listRvcVoices(port)
      setRvcVoices(enrichVoiceList(raw))
    }
  }

  createEffect(() => {
    if (settings.speech.provider() === "rvc") {
      void refreshRvcVoices()
    }
  })

  const currentSpeechOpts = () => ({
    provider: settings.speech.provider(),
    volume: settings.speech.volume(),
    rvc: {
      voiceId: settings.speech.rvc.voiceId(),
      dockerPort: settings.speech.rvc.dockerPort(),
    },
    azure: {
      region: settings.speech.azure.region(),
      apiKey: settings.speech.azure.apiKey(),
      voiceId: settings.speech.azure.voiceId(),
    },
    browser: {
      voiceURI: settings.speech.browser.voiceURI(),
      rate: settings.speech.browser.rate(),
      pitch: settings.speech.browser.pitch(),
    },
  })

  const handlePreview = async () => {
    const text = previewText().trim()
    if (!text) return
    if (isSpeaking()) {
      cancelSpeech()
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    try {
      await speak(text, currentSpeechOpts())
    } catch (err) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: language.t("settings.speech.preview.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPreviewing(false)
    }
  }

  const providerOptions: { value: SpeechProvider; label: string }[] = [
    { value: "rvc",     label: language.t("settings.speech.provider.rvc") },
    { value: "azure",   label: language.t("settings.speech.provider.azure") },
    { value: "browser", label: language.t("settings.speech.provider.browser") },
  ]

  const azureVoicesFiltered = createMemo(() =>
    AZURE_VOICES.filter((v) => v.locale === azureLocaleFilter()),
  )

  const localeOptions = createMemo(() =>
    AZURE_LOCALES.map((l) => ({ value: l, label: l })),
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.speech.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">

        {/* General */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.speech.section.provider")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">

            <SettingsRow
              title={language.t("settings.speech.row.enabled.title")}
              description={language.t("settings.speech.row.enabled.description")}
            >
              <Switch
                checked={settings.speech.enabled()}
                onChange={(v) => settings.speech.setEnabled(v)}
              />
            </SettingsRow>

            <Show when={settings.speech.enabled()}>
              <SettingsRow
                title={language.t("settings.speech.row.autoSpeak.title")}
                description={language.t("settings.speech.row.autoSpeak.description")}
              >
                <Switch
                  checked={settings.speech.autoSpeak()}
                  onChange={(v) => settings.speech.setAutoSpeak(v)}
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.provider.title")}
                description={language.t("settings.speech.row.provider.description")}
              >
                <Select
                  options={providerOptions}
                  current={providerOptions.find((o) => o.value === settings.speech.provider())}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => o && settings.speech.setProvider(o.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.volume.title")}
                description={language.t("settings.speech.row.volume.description")}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.speech.volume()}
                  onInput={(e) => settings.speech.setVolume(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>
            </Show>
          </div>
        </div>

        {/* RVC Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "rvc"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">RVC</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <SettingsRow
                title={language.t("settings.speech.row.rvcPort.title")}
                description={language.t("settings.speech.row.rvcPort.description")}
              >
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={settings.speech.rvc.dockerPort()}
                    onBlur={(e) => {
                      const v = Number(e.currentTarget.value)
                      if (v > 1023 && v < 65536) settings.speech.rvc.setDockerPort(v)
                    }}
                    class="w-24 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong text-right"
                  />
                  <Button size="small" variant="secondary" onClick={() => void refreshRvcVoices()}>
                    <Icon name="history" size="small" />
                  </Button>
                  <span class={`text-11-regular ${rvcOnline() ? "text-green-400" : "text-red-400"}`}>
                    {rvcOnline()
                      ? language.t("settings.speech.rvc.dockerOnline")
                      : language.t("settings.speech.rvc.dockerOffline")}
                  </span>
                </div>
              </SettingsRow>

              <Show
                when={rvcVoices().length > 0}
                fallback={
                  <SettingsRow
                    title={language.t("settings.speech.row.rvcVoice.title")}
                    description={language.t("settings.speech.rvc.noVoices")}
                  >
                    <span class="text-12-regular text-text-weak">{"\u2014"}</span>
                  </SettingsRow>
                }
              >
                <SettingsRow
                  title={language.t("settings.speech.row.rvcVoice.title")}
                  description={language.t("settings.speech.row.rvcVoice.description")}
                >
                  <Select
                    options={rvcVoices()}
                    current={rvcVoices().find((v) => v.id === settings.speech.rvc.voiceId())}
                    value={(o) => o.id}
                    label={(o) => o.name}
                    onSelect={(o) => o && settings.speech.rvc.setVoiceId(o.id)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              </Show>

            </div>
          </div>
        </Show>

        {/* Azure Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "azure"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">Azure Neural</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <SettingsRow
                title={language.t("settings.speech.row.azureKey.title")}
                description={language.t("settings.speech.row.azureKey.description")}
              >
                <input
                  type="password"
                  value={settings.speech.azure.apiKey()}
                  placeholder={"••••••••••••••••"}
                  onBlur={(e) => settings.speech.azure.setApiKey(e.currentTarget.value)}
                  class="w-48 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.azureRegion.title")}
                description={language.t("settings.speech.row.azureRegion.description")}
              >
                <input
                  type="text"
                  value={settings.speech.azure.region()}
                  placeholder="eastus"
                  onBlur={(e) => settings.speech.azure.setRegion(e.currentTarget.value.trim())}
                  class="w-36 bg-surface-base border border-border-base rounded px-2 py-1 text-12-regular text-text-strong"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.azureLocale.title")}
                description={language.t("settings.speech.row.azureLocale.description")}
              >
                <Select
                  options={localeOptions()}
                  current={localeOptions().find((o) => o.value === azureLocaleFilter())}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => o && setAzureLocaleFilter(o.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.azureVoice.title")}
                description={language.t("settings.speech.row.azureVoice.description")}
              >
                <Select
                  options={azureVoicesFiltered()}
                  current={azureVoicesFiltered().find((v) => v.id === settings.speech.azure.voiceId())}
                  value={(o) => o.id}
                  label={(o) => o.name}
                  onSelect={(o) => o && settings.speech.azure.setVoiceId(o.id)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>

            </div>
          </div>
        </Show>

        {/* Browser Section */}
        <Show when={settings.speech.enabled() && settings.speech.provider() === "browser"}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">Browser (Built-in)</h3>
            <div class="bg-surface-raised-base px-4 rounded-lg">

              <Show when={browserVoices().length > 0}>
                <SettingsRow
                  title={language.t("settings.speech.row.browserVoice.title")}
                  description={language.t("settings.speech.row.browserVoice.description")}
                >
                  <Select
                    options={browserVoices()}
                    current={browserVoices().find((v) => v.uri === settings.speech.browser.voiceURI())}
                    value={(o) => o.uri}
                    label={(o) => `${o.name} (${o.lang})`}
                    onSelect={(o) => o && settings.speech.browser.setVoiceURI(o.uri)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </SettingsRow>
              </Show>

              <SettingsRow
                title={language.t("settings.speech.row.browserRate.title")}
                description={language.t("settings.speech.row.browserRate.description")}
              >
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={settings.speech.browser.rate()}
                  onInput={(e) => settings.speech.browser.setRate(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>

              <SettingsRow
                title={language.t("settings.speech.row.browserPitch.title")}
                description={language.t("settings.speech.row.browserPitch.description")}
              >
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.1"
                  value={settings.speech.browser.pitch()}
                  onInput={(e) => settings.speech.browser.setPitch(Number(e.currentTarget.value))}
                  class="w-32 accent-[var(--accent-base)]"
                />
              </SettingsRow>

            </div>
          </div>
        </Show>

        {/* Voice Preview Section */}
        <Show when={settings.speech.enabled()}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.speech.section.preview")}</h3>
            <div class="bg-surface-raised-base px-4 py-4 rounded-lg flex flex-col gap-3">
              <textarea
                class="w-full bg-surface-base border border-border-base rounded px-3 py-2 text-13-regular text-text-strong resize-none h-20 placeholder:text-text-weak"
                placeholder={language.t("settings.speech.preview.placeholder")}
                value={previewText()}
                onInput={(e) => setPreviewText(e.currentTarget.value)}
              />
              <div class="flex gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => void handlePreview()}
                  disabled={!previewText().trim()}
                >
                  <Icon name={previewing() ? "stop" : "enter"} size="small" />
                  {previewing()
                    ? language.t("settings.speech.preview.stop")
                    : language.t("settings.speech.preview.play")}
                </Button>
              </div>
            </div>
          </div>
        </Show>

      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
