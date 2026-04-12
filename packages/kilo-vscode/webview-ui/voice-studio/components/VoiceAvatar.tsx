import { Component } from "solid-js"
import type { VoiceProvider, VoiceGender } from "../../src/types/voice"

export interface VoiceAvatarProps {
  provider: VoiceProvider | string
  gender: VoiceGender
  small?: boolean
}

const GENDER_ICONS: Record<VoiceGender, string> = {
  male: "\u2642",
  female: "\u2640",
  neutral: "\u26A7",
}

const PROVIDER_LETTERS: Record<string, string> = {
  rvc: "R",
  azure: "A",
  browser: "B",
  kokoro: "K",
  piper: "P",
  xtts: "X",
  f5tts: "F",
  bark: "B",
  chatterbox: "C",
}

export const VoiceAvatar: Component<VoiceAvatarProps> = (props) => {
  const providerClass = () => {
    const p = props.provider as string
    return `vs-avatar--${p}`
  }

  const letter = () => PROVIDER_LETTERS[props.provider] ?? props.provider.charAt(0).toUpperCase()
  const genderIcon = () => GENDER_ICONS[props.gender] ?? ""

  return (
    <div
      class={`vs-avatar ${providerClass()}${props.small ? " vs-avatar--small" : ""}`}
      title={`${props.provider} / ${props.gender}`}
    >
      <span>{letter()}{genderIcon()}</span>
    </div>
  )
}
