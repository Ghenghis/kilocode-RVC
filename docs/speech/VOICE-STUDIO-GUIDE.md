# Voice Studio User Guide

Voice Studio is KiloCode's dedicated panel for browsing, previewing, downloading, and managing voice models. It provides a unified interface across all speech providers (RVC, Azure, Browser, Kokoro, Piper, XTTS, F5-TTS) with smart search, one-click voice switching, and hands-free voice control.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Library Tab](#2-library-tab)
3. [Store Tab](#3-store-tab)
4. [Search and Filters](#4-search-and-filters)
5. [Voice Preview](#5-voice-preview)
6. [Downloads](#6-downloads)
7. [Favorites and History](#7-favorites-and-history)
8. [Quick Voice Switch](#8-quick-voice-switch)
9. [Interaction Modes](#9-interaction-modes)
10. [Voice Commands](#10-voice-commands)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Getting Started

There are three ways to open Voice Studio:

**From the Settings panel.** Open KiloCode settings, navigate to the Speech tab, and click the **Open Voice Studio** button at the top of the panel.

**From the Command Palette.** Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and type `Kilo Code: Open Voice Studio`. Select it from the list.

**From a keyboard shortcut.** No default shortcut is assigned to opening the panel, but you can bind one via `Preferences: Open Keyboard Shortcuts` by searching for `kilo-code.new.openVoiceStudio`.

Voice Studio opens as a full-width editor tab. It persists its state when hidden behind other tabs (`retainContextWhenHidden` is enabled), so switching away and back does not lose your place.

### Prerequisites

- **RVC voices** require the Docker container (`edge-tts-server`) running on the configured port (default 5050).
- **Azure voices** require a valid Azure Speech API key and region configured in the Speech settings tab.
- **Browser voices** use the Web Speech API built into VS Code's webview and require no additional setup.

---

## 2. Library Tab

The Library tab shows every voice currently installed and available across all providers. This is your personal voice collection.

### Layout

```
+-----------------------------------------------------------------------+
|  Voice Studio     [ Library | Store ]     [search...]  [grid] [list]  |
+-----------------------------------------------------------------------+
|  Sub-tabs:  [ All ]  [ Favorites ]  [ Recent ]                       |
|  Filters:   Gender: [F] [M] [N]   Accent: [US] [GB] ...              |
|             Style: [Natural] [Expressive] ...   Provider: [RVC] ...   |
|             Mood: [Warm] [Calm] [Bright] [Deep] [Robotic] [Prof.]    |
+-----------------------------------------------------------------------+
|                                                                       |
|  +------------+  +------------+  +------------+  +------------+       |
|  | [avatar]   |  | [avatar]   |  | [avatar]   |  | [avatar]   |      |
|  | Voice Name |  | Voice Name |  | Voice Name |  | Voice Name |      |
|  | F, en-US   |  | M, en-GB   |  | F, en-US   |  | N, en-US   |      |
|  | natural    |  | expressive |  | whisper    |  | broadcast  |      |
|  | *****      |  | ****       |  | ***        |  | ****       |      |
|  | [tags...]  |  | [tags...]  |  | [tags...]  |  | [tags...]  |      |
|  | 45 MB  RVC |  | -- AZURE   |  | 38 MB  RVC |  | -- BROWSER |      |
|  | [>] [*] [=]|  | [>] [*] [=]|  | [>] [*] [=]|  | [>] [*] [=]|     |
|  +------------+  +------------+  +------------+  +------------+       |
|                                                                       |
+-----------------------------------------------------------------------+
|  Now Playing:  Aria (Azure, en-US)             [>]  [vol]             |
+-----------------------------------------------------------------------+
```

### Sub-Tabs

- **All** -- Shows every installed voice from every provider.
- **Favorites** -- Shows only voices you have starred. Empty state prompts you to star your first voice.
- **Recent** -- Shows the last 50 voices you have set as active, sorted by most recently used.

### Grid View vs. List View

Toggle between views using the grid/list buttons in the top-right corner of the header.

**Grid view** displays voice cards in a responsive grid (minimum 200px per card, auto-filling columns). Each card shows the voice avatar (color-coded by provider), name, gender, accent, style, quality stars, tags, file size, and provider badge. Action buttons appear at the bottom: play preview, toggle favorite, and set as active voice.

**List view** displays voices in a dense table with columns for play button, avatar, name, gender, accent, style, provider, quality, size, and actions. List view is ideal when you know what you are looking for and want maximum information density. On narrow viewports (under 500px), some columns are hidden automatically.

### Voice Cards

Each voice card displays:

- **Avatar** -- A colored circle with the provider initial (purple for RVC, blue for Azure, green for Browser, orange for Kokoro, teal for Piper, red for XTTS, and so on).
- **Name** -- The display name of the voice.
- **Metadata** -- Gender, accent label (e.g., "American English"), style category.
- **Quality** -- Star rating from 1 to 5, displayed as filled/empty stars.
- **Tags** -- Small pills showing descriptive tags like "warm", "studio", "crisp".
- **Size** -- File size for local models (e.g., "45 MB"). Cloud voices (Azure, Browser) show "--".
- **Provider badge** -- Uppercase label (RVC, AZURE, BROWSER, etc.).

### Card Actions

- **Play button** -- Plays a short preview of the voice. If another preview is already playing, it stops first (single-player enforcement).
- **Favorite button** -- Stars or un-stars the voice. Starred voices appear in the Favorites sub-tab.
- **Set Active button** -- Makes this voice the active voice for its provider. Updates the VS Code configuration (`rvc.voiceId`, `azure.voiceId`, or `browser.voiceURI` depending on provider) and records the voice in your usage history.

### Now Playing Bar

A persistent bar at the bottom of the Library tab shows the currently active voice name, its provider, and mini playback controls. This bar is always visible so you know which voice is selected at a glance.

---

## 3. Store Tab

The Store tab connects to the VPS model server to browse voices available for download. It functions like an app store for voice models.

### Layout

```
+-----------------------------------------------------------------------+
|  Voice Studio     [ Library | Store ]     [search...]  [grid] [list]  |
+-----------------------------------------------------------------------+
|  Filters:   Gender: [F] [M] [N]   Accent: [US] [GB] ...              |
|             Style: [Natural] [Expressive] ...   Installed: [toggle]   |
|             Mood: [Warm] [Calm] [Bright] [Deep] [Robotic] [Prof.]    |
+-----------------------------------------------------------------------+
|                                                                       |
|  +------------+  +------------+  +------------+  +------------+       |
|  | [avatar]   |  | [avatar]   |  | [avatar]   |  | [avatar]   |      |
|  | Model Name |  | Model Name |  | Model Name |  | Model Name |      |
|  | F, en-US   |  | M, en-GB   |  | F, en-US   |  | M, en-US   |      |
|  | natural    |  | expressive |  | character  |  | broadcast  |      |
|  | *****      |  | ****       |  | ***        |  | *****      |      |
|  | [tags...]  |  | [tags...]  |  | [tags...]  |  | [tags...]  |      |
|  | 62 MB      |  | 45 MB [ok] |  | 38 MB      |  | 55 MB      |      |
|  |[hero][txt] |  |[installed] |  |[hero][txt] |  |[hero][txt] |      |
|  |  [DOWNLOAD]|  |            |  |  [DOWNLOAD]|  |  [DOWNLOAD]|      |
|  +------------+  +------------+  +------------+  +------------+       |
|                                                                       |
|  Page: [<] 1 2 3 4 5 [>]                                             |
+-----------------------------------------------------------------------+
|  Downloads: lunar-studio 67%  |  Disk: 18.2 GB / 100 GB   [refresh]  |
+-----------------------------------------------------------------------+
```

### Store Cards

Store cards show the same metadata as Library cards, plus:

- **Size badge** -- The download size of the model file.
- **Installed badge** -- A checkmark overlay on models already downloaded to your Docker container, preventing accidental re-downloads.
- **Hero preview button** -- Plays a pre-generated 5-second sample clip hosted on the VPS. Instant playback, no synthesis delay.
- **Custom preview button** -- Opens a text input where you can type any text. The VPS synthesizes it on-demand using edge-tts and streams back audio for playback.
- **Download button** -- Starts downloading the model. Replaced by a progress ring during download.
- **Quality badge** -- Star rating indicating voice fidelity.

### Pagination

Results are paginated at 24 models per page. Page navigation controls appear at the bottom of the voice grid. The catalog supports hundreds of models without performance degradation.

### Disk Usage Indicator

The download queue bar at the bottom of the Store tab shows current disk usage on the VPS (e.g., "18.2 GB / 100 GB") alongside active downloads. This lets you monitor how much space remains before hitting the 100 GB cap.

### Refresh Button

The refresh button in the download queue bar triggers a catalog rebuild on the VPS server. Use this after manually adding new model files to the VPS to re-scan the `/opt/rvc-models/models/` directory, regenerate metadata, and update the catalog. After rebuild completes, the Store automatically re-fetches the updated catalog.

---

## 4. Search and Filters

Voice Studio provides a three-layer discovery system: fuzzy text search, structured filter chips, and voice-to-search.

### Smart Fuzzy Search

The search bar at the top of the panel performs weighted fuzzy matching across voice metadata:

| Field | Weight | Example |
|-------|--------|---------|
| Name | 10x | Typing "aria" matches "AriaNeural" first |
| Tags | 5x | Typing "warm" matches voices tagged "warm" |
| Description | 2x | Typing "studio" matches description text |
| Other fields | 1x | Gender, accent, style as fallback |

Search is debounced at 150ms, so results update as you type without triggering on every keystroke.

### Autocomplete Dropdown

As you type in the search bar, an autocomplete dropdown appears with four sections:

1. **Recent Searches** -- Your last search queries for quick re-use.
2. **Accent/Category Matches** -- Matching accent labels and style categories.
3. **Voice Name Matches** -- Voices whose names match your input.
4. **Quick Filter Suggestions** -- Suggested filter chip combinations based on your query.

Click any suggestion to apply it immediately.

### Filter Chips

Below the search bar, structured filter chips are organized by category:

- **Gender** -- Female, Male, Neutral
- **Accent** -- American English, British English, Australian English, and other available accents
- **Style** -- Natural, Expressive, Whisper, Broadcast, Singing, Character
- **Provider** -- RVC, Azure, Browser, Kokoro, Piper, XTTS, F5-TTS
- **Mood** -- Warm, Calm, Bright, Deep, Robotic, Professional (see below)

Filters use AND logic between categories and OR logic within a category. For example, selecting Gender: Female AND Accent: British English shows only female British voices. Selecting Style: Natural OR Style: Expressive shows voices matching either style.

### Live Filter Counts

Each filter chip displays a live count of matching voices in parentheses, e.g., "Female (23)". Counts update dynamically as you type in the search bar or toggle other filters, so you always know how many results a filter will produce before clicking it.

### Mood Quick Filters

Mood chips are pre-configured filter combinations for non-technical discovery:

| Mood | What It Selects |
|------|-----------------|
| **Warm** | Style: natural, tags containing "warm" or "soft", quality 3 or higher |
| **Calm** | Style: natural or whisper, tags containing "calm" or "gentle" |
| **Bright** | Style: expressive, tags containing "bright", "clear", or "crisp" |
| **Deep** | Gender: male, tags containing "deep", "bass", or "low" |
| **Robotic** | Style: broadcast, provider: piper or similar synthetic providers |
| **Professional** | Style: natural, quality 4 or higher, tags containing "studio" or "neutral" |

### Combining Search and Filters

Search text and filter chips combine with AND logic. Typing "studio" in the search bar while selecting Gender: Female and Mood: Professional shows only female professional voices whose metadata contains "studio".

An active filters bar appears when any filters are selected, showing dismissible chips for each active filter. A "Clear all" link removes all filters at once.

### Voice-to-Search

Click the microphone icon in the search bar to activate voice-to-search. This uses the Web Speech API's SpeechRecognition to transcribe your spoken query into the search field. Say something like "warm British female" and the transcription populates the search bar, triggering fuzzy search. Click the mic again or wait for silence to stop listening. The mic icon turns red while actively listening.

---

## 5. Voice Preview

Voice Studio offers two preview modes for hearing a voice before selecting or downloading it.

### Hero Clip Preview

Every voice model on the VPS has a pre-generated 5-second MP3 sample. Clicking the hero preview button (speaker icon) on a Store card streams this clip for instant playback. No synthesis delay -- the audio is pre-built and cached on the server.

Hero clips are generated by the VPS using a standard reference sentence synthesized through edge-tts and encoded as 64kbps MP3 files.

### Custom Text Preview

For Store voices, a text input button lets you type any sentence you want to hear. The VPS synthesizes it on-demand using the selected model and streams back the audio. This lets you test a voice with your actual use case (code explanations, error messages, documentation) before committing to a download.

Custom preview requests are sent as POST requests to the VPS `/api/preview` endpoint with your text and the model ID.

### Single-Player Enforcement

Only one audio preview plays at a time. Starting a new preview automatically stops the currently playing one. This prevents overlapping audio from multiple voice samples.

### Mini Audio Player

When audio is playing, a mini player appears showing:

- Play/pause toggle
- Progress bar (clickable to seek)
- Elapsed time / total duration display

---

## 6. Downloads

### Starting a Download

Click the download button on any Store card to begin downloading the model. The button transforms into a progress ring showing download percentage. The model file is downloaded to a temporary location, then copied into the Docker container at `/models/`.

### Download Queue

Multiple downloads can run concurrently. The download queue bar at the bottom of the Store tab shows all active downloads with their names and progress percentages.

### Progress Tracking

Each download reports real-time progress as bytes received vs. total bytes. The Store card shows a progress ring overlay, and the download queue bar shows percentage text. Milestone logging occurs at 25%, 50%, and 75% completion.

### Cancel and Retry

- **Cancel** -- Click the cancel button on an active download to abort it. The partial temporary file is cleaned up automatically.
- **Retry** -- If a download fails (network error, timeout), the download button reappears on the Store card. Click it again to retry.

### Disk Budget

The VPS enforces a 100 GB disk cap for voice models. The disk usage indicator in the download queue bar shows current usage (e.g., "18.2 GB / 100 GB"). Monitor this to avoid exceeding capacity. The disk usage information is fetched from the VPS `/api/disk` endpoint.

### Background Downloads

Downloads continue running in the extension backend even if you close the Voice Studio panel. If you re-open the panel, active downloads will resume reporting progress. If you close VS Code entirely, in-flight downloads are aborted.

---

## 7. Favorites and History

### Starring Voices

Click the star icon on any voice card or row to add it to your favorites. The star turns gold when active. Favorites persist across VS Code sessions via `globalState`.

Favorited voices appear in the **Favorites** sub-tab of the Library for quick access. They also appear first in the quick voice switch picker (see section 8).

Deleting a model automatically removes it from favorites.

### Recent History

Voice Studio tracks the last 50 voices you have set as active, ordered by most recent use. Each entry records the voice ID and timestamp.

The **Recent** sub-tab in the Library shows this history, letting you quickly return to voices you used recently without searching.

### Saved Searches

Save a search query along with all active filter chips as a named preset. Saved searches persist across sessions and can be restored with a single click, re-populating both the search text and all filter selections.

To save a search:
1. Enter your search text and select your filter chips.
2. Click the save icon next to the search bar.
3. Give the search a name (e.g., "British Female Warm").

To restore a saved search, select it from the autocomplete dropdown's "Recent Searches" section, or access it from the saved searches list.

To delete a saved search, click the dismiss button on the saved search chip.

---

## 8. Quick Voice Switch

Voice Studio provides fast voice switching without opening the full panel.

### Command Palette

Press `Ctrl+Shift+P` and type `Kilo Code: Switch Voice`. A quick-pick list appears showing your favorite voices first, followed by all installed voices. Select one to immediately set it as the active voice for its provider.

### Keyboard Shortcut

Press `Ctrl+Shift+Alt+V` (`Cmd+Shift+Alt+V` on macOS) to open the Switch Voice quick-pick directly, without going through the command palette.

### Status Bar Indicator

The VS Code status bar shows the name of the currently active voice. Click the status bar item to open the Switch Voice quick-pick.

---

## 9. Interaction Modes

Voice Studio supports three interaction modes that control how speech input and output behave.

### Silent Mode

| Setting | Value |
|---------|-------|
| Speech output | Off |
| Voice commands | Off |
| Use case | Focused coding with no audio distractions |

In Silent mode, KiloCode does not speak responses and does not listen for voice commands.

### Assist Mode

| Setting | Value |
|---------|-------|
| Speech output | Auto-speak responses |
| Voice commands | Manual trigger only |
| Use case | Hear responses read aloud while typing commands |

In Assist mode, KiloCode automatically speaks its responses using the active voice. Voice commands are not continuously listened for -- you interact via keyboard and mouse as normal.

### Hands-Free Mode

| Setting | Value |
|---------|-------|
| Speech output | Auto-speak responses |
| Voice commands | Always listening |
| Use case | Full bidirectional voice interaction while coding |

In Hands-Free mode, KiloCode speaks responses and continuously listens for voice commands using the Web Speech API's SpeechRecognition in continuous mode. You can code with your hands on the keyboard and control speech playback, voice switching, and volume by speaking commands aloud.

### Switching Modes

Change the interaction mode from the Voice Studio panel header, or programmatically via the `switchInteractionMode` message. The selected mode persists across VS Code sessions.

---

## 10. Voice Commands

Voice commands are available in Hands-Free mode. KiloCode listens continuously and matches recognized speech against the following commands. No wake word is required. Non-command speech is ignored.

| Command | Action |
|---------|--------|
| **"switch to [name]"** | Changes the active voice by fuzzy-matching the spoken name against installed voices. Example: "switch to Aria" sets `en-US-AriaNeural` as active. |
| **"stop"** or **"quiet"** | Immediately stops the currently playing speech output. |
| **"slower"** | Decreases the speech rate by 0.1 (minimum 0.1). |
| **"faster"** | Increases the speech rate by 0.1 (maximum 3.0). |
| **"louder"** | Increases the volume by 10% (maximum 100%). |
| **"softer"** | Decreases the volume by 10% (minimum 0%). |
| **"hands free off"** | Switches from Hands-Free mode back to Assist mode, stopping continuous listening. |

When a command is recognized, KiloCode sends a `voiceCommandAck` message back to the webview confirming the action. Unrecognized speech is silently discarded.

---

## 11. Troubleshooting

### Voice Studio won't open

- Verify that the KiloCode extension is installed and activated. Check the Extensions panel for `kilo-code.new`.
- Run `Kilo Code: Open Voice Studio` from the command palette. If the command is not found, the extension may not be loaded.

### Library shows no voices

- **RVC voices**: Confirm the Docker container `edge-tts-server` is running. Run `docker ps` in a terminal and look for the container. Verify the port in Speech settings matches the container's exposed port (default 5050).
- **Azure voices**: Confirm your Azure Speech API key and region are configured in the Speech settings tab. An invalid or expired key will prevent voice listing.
- **Browser voices**: Browser voices are provided by the Web Speech API and should appear automatically. If none appear, try reloading the VS Code window (`Developer: Reload Window`).

### Store shows no models or fails to load

- Check that the model server URL is correct in Speech settings (`rvc.modelServerUrl`, default `https://voice.daveai.tech`).
- The VPS must be running and accessible from your network. Test by opening the catalog URL in a browser: `https://voice.daveai.tech/api/catalog`.
- If the VPS is behind a firewall or VPN, ensure your network allows HTTPS connections to it.

### Downloads fail or stall

- Check your network connection. Downloads use chunked HTTP transfer and will fail on network interruption.
- Verify the Docker container has write access to `/models/`. The download process uses `docker cp` to copy the model file into the container.
- If a download stalls at 0%, the VPS may be unreachable or the model URL may be broken. Check the OutputChannel logs for the specific HTTP error.
- Partial downloads are cleaned up automatically on failure or cancellation.

### Voice preview produces no audio

- Ensure your system audio output is not muted.
- For hero clips, the VPS must be reachable and the preview MP3 must exist on the server.
- For custom text preview, the VPS must have edge-tts installed and functioning.
- Check the webview's Content Security Policy is not blocking media playback (this is configured automatically by the extension).

### Voice commands are not recognized

- Voice commands only work in **Hands-Free** mode. Check your interaction mode in the Voice Studio header.
- The Web Speech API requires microphone permission. VS Code may prompt for microphone access the first time.
- Voice-to-search and voice commands use the browser's SpeechRecognition API, which requires an internet connection for most browsers' speech recognition backends.
- Speak clearly and use the exact command phrases listed in section 10.

### Checking OutputChannel Logs

Voice Studio logs all operations to a dedicated output channel. To view logs:

1. Open the Output panel (`Ctrl+Shift+U` or `Cmd+Shift+U` on macOS).
2. Select **KiloCode Voice Studio** from the dropdown in the top-right of the Output panel.
3. Look for log entries prefixed with `[Library]`, `[Store]`, `[Download]`, `[Command]`, `[Message]`, or `[Panel]`.

Key log entries to look for:

- `[Library] Fetching voice library from Docker container` -- Confirms the Library is attempting to load voices.
- `[Store] Fetching catalog from ...` -- Shows the Store catalog request URL.
- `[Download] Starting download: ...` -- Confirms a download was initiated with the model name and URL.
- `[Download] ... cancelled by user` -- Confirms a cancel action was processed.
- `[Command] Voice command received: "..."` -- Shows what the speech recognizer transcribed.
- `[Message] Unknown message type: ...` -- Indicates a message protocol mismatch, which may mean an extension/webview version mismatch. Try reloading the window.

### Settings not syncing between Voice Studio and Settings tab

Voice Studio writes directly to VS Code's configuration (`kilo-code.new.speech.*`). If changes made in Voice Studio do not appear in the Settings tab (or vice versa), reload the VS Code window. Both panels read from the same configuration store, but UI refresh may require a reload in edge cases.

---

## UI Layout Diagrams

### Library Tab Layout

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 620" font-family="Segoe UI, sans-serif" font-size="12">
  <defs>
    <style>
      .bg { fill: #1e1e1e; }
      .panel { fill: #252526; stroke: #3c3c3c; stroke-width: 1; }
      .header { fill: #2d2d2d; }
      .text { fill: #cccccc; }
      .text-dim { fill: #808080; }
      .text-bright { fill: #ffffff; }
      .accent { fill: #007acc; }
      .accent-stroke { stroke: #007acc; fill: none; stroke-width: 1.5; }
      .tab-active { fill: #3c3c3c; rx: 4; }
      .tab-inactive { fill: none; }
      .search-bg { fill: #3c3c3c; rx: 4; }
      .chip { fill: none; stroke: #5a5d5e; stroke-width: 1; rx: 10; }
      .chip-active { fill: #007acc; stroke: #007acc; rx: 10; }
      .card { fill: #1e1e1e; stroke: #3c3c3c; stroke-width: 1; rx: 6; }
      .avatar-rvc { fill: #9b59b6; }
      .avatar-azure { fill: #3498db; }
      .avatar-browser { fill: #27ae60; }
      .star-filled { fill: #ffc107; }
      .star-empty { fill: #5a5d5e; }
      .now-playing { fill: #2d2d2d; stroke: #3c3c3c; stroke-width: 1; }
      .btn-primary { fill: #007acc; rx: 4; }
      .label { fill: #808080; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="800" height="620" class="bg"/>

  <!-- Header -->
  <rect x="0" y="0" width="800" height="80" class="header"/>

  <!-- Title -->
  <text x="16" y="28" class="text-bright" font-size="16" font-weight="600">Voice Studio</text>

  <!-- Tab Switcher -->
  <rect x="130" y="10" width="64" height="28" class="tab-active"/>
  <text x="145" y="29" class="text-bright" font-size="12" font-weight="600">Library</text>
  <rect x="198" y="10" width="52" height="28" class="tab-inactive"/>
  <text x="210" y="29" class="text-dim" font-size="12">Store</text>

  <!-- Search Bar -->
  <rect x="16" y="46" width="580" height="28" class="search-bg"/>
  <text x="36" y="64" class="text-dim" font-size="12">Search voices...</text>
  <!-- Mic icon -->
  <circle cx="576" cy="60" r="8" fill="none" stroke="#808080" stroke-width="1"/>
  <text x="572" y="64" class="text-dim" font-size="10">M</text>

  <!-- View Toggle -->
  <rect x="720" y="46" width="28" height="28" class="accent" rx="4"/>
  <text x="727" y="65" class="text-bright" font-size="14">G</text>
  <rect x="752" y="46" width="28" height="28" fill="none" stroke="#3c3c3c" rx="4"/>
  <text x="759" y="65" class="text-dim" font-size="14">L</text>

  <!-- Separator -->
  <line x1="0" y1="80" x2="800" y2="80" stroke="#3c3c3c" stroke-width="1"/>

  <!-- Sub-tabs -->
  <rect x="16" y="88" width="36" height="24" class="chip-active"/>
  <text x="24" y="104" class="text-bright" font-size="11">All</text>
  <rect x="58" y="88" width="68" height="24" class="chip"/>
  <text x="66" y="104" class="text" font-size="11">Favorites</text>
  <rect x="132" y="88" width="56" height="24" class="chip"/>
  <text x="140" y="104" class="text" font-size="11">Recent</text>

  <!-- Filter Row 1: Gender, Accent -->
  <text x="16" y="132" class="label">Gender</text>
  <rect x="70" y="120" width="54" height="20" class="chip"/>
  <text x="78" y="134" class="text" font-size="11">Female</text>
  <rect x="128" y="120" width="42" height="20" class="chip"/>
  <text x="136" y="134" class="text" font-size="11">Male</text>
  <rect x="174" y="120" width="54" height="20" class="chip"/>
  <text x="182" y="134" class="text" font-size="11">Neutral</text>

  <text x="250" y="132" class="label">Accent</text>
  <rect x="296" y="120" width="34" height="20" class="chip"/>
  <text x="304" y="134" class="text" font-size="11">US</text>
  <rect x="334" y="120" width="34" height="20" class="chip"/>
  <text x="342" y="134" class="text" font-size="11">GB</text>
  <rect x="372" y="120" width="34" height="20" class="chip"/>
  <text x="380" y="134" class="text" font-size="11">AU</text>

  <!-- Filter Row 2: Style, Provider -->
  <text x="16" y="158" class="label">Style</text>
  <rect x="70" y="146" width="56" height="20" class="chip"/>
  <text x="78" y="160" class="text" font-size="11">Natural</text>
  <rect x="130" y="146" width="72" height="20" class="chip"/>
  <text x="138" y="160" class="text" font-size="11">Expressive</text>
  <rect x="206" y="146" width="58" height="20" class="chip"/>
  <text x="214" y="160" class="text" font-size="11">Whisper</text>

  <text x="290" y="158" class="label">Provider</text>
  <rect x="344" y="146" width="40" height="20" class="chip"/>
  <text x="352" y="160" class="text" font-size="11">RVC</text>
  <rect x="388" y="146" width="48" height="20" class="chip"/>
  <text x="396" y="160" class="text" font-size="11">Azure</text>
  <rect x="440" y="146" width="60" height="20" class="chip"/>
  <text x="448" y="160" class="text" font-size="11">Browser</text>

  <!-- Filter Row 3: Mood -->
  <text x="16" y="184" class="label">Mood</text>
  <rect x="70" y="172" width="48" height="20" class="chip"/>
  <text x="78" y="186" class="text" font-size="11">Warm</text>
  <rect x="122" y="172" width="44" height="20" class="chip"/>
  <text x="130" y="186" class="text" font-size="11">Calm</text>
  <rect x="170" y="172" width="48" height="20" class="chip"/>
  <text x="178" y="186" class="text" font-size="11">Bright</text>
  <rect x="222" y="172" width="44" height="20" class="chip"/>
  <text x="230" y="186" class="text" font-size="11">Deep</text>
  <rect x="270" y="172" width="58" height="20" class="chip"/>
  <text x="278" y="186" class="text" font-size="11">Robotic</text>
  <rect x="332" y="172" width="82" height="20" class="chip"/>
  <text x="340" y="186" class="text" font-size="11">Professional</text>

  <!-- Separator -->
  <line x1="16" y1="200" x2="784" y2="200" stroke="#3c3c3c" stroke-width="1"/>

  <!-- Voice Cards Row 1 -->
  <!-- Card 1 -->
  <rect x="16" y="210" width="185" height="180" class="card"/>
  <circle cx="40" cy="232" r="14" class="avatar-rvc"/>
  <text x="34" y="236" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="60" y="236" class="text-bright" font-size="13" font-weight="600">Lunar Studio</text>
  <text x="28" y="256" class="text-dim" font-size="11">Female, American English</text>
  <text x="28" y="272" class="text-dim" font-size="11">natural</text>
  <!-- Stars -->
  <text x="28" y="288" class="star-filled" font-size="11">***** </text>
  <!-- Tags -->
  <rect x="28" y="294" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="34" y="305" class="text-bright" font-size="9">warm</text>
  <rect x="68" y="294" width="40" height="16" rx="8" fill="#007acc"/>
  <text x="74" y="305" class="text-bright" font-size="9">studio</text>
  <!-- Footer -->
  <text x="28" y="330" class="text-dim" font-size="10">45 MB</text>
  <rect x="140" y="320" width="32" height="14" rx="3" fill="#9b59b6"/>
  <text x="144" y="331" class="text-bright" font-size="8" font-weight="600">RVC</text>
  <!-- Actions -->
  <rect x="28" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="35" y="360" class="text" font-size="12">></text>
  <rect x="56" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="62" y="361" class="star-filled" font-size="14">*</text>
  <rect x="84" y="344" width="24" height="24" rx="4" class="btn-primary"/>
  <text x="89" y="360" class="text-bright" font-size="10">SET</text>

  <!-- Card 2 -->
  <rect x="211" y="210" width="185" height="180" class="card"/>
  <circle cx="235" cy="232" r="14" class="avatar-azure"/>
  <text x="229" y="236" class="text-bright" font-size="10" font-weight="700">A</text>
  <text x="255" y="236" class="text-bright" font-size="13" font-weight="600">Aria Neural</text>
  <text x="223" y="256" class="text-dim" font-size="11">Female, American English</text>
  <text x="223" y="272" class="text-dim" font-size="11">expressive</text>
  <text x="223" y="288" class="star-filled" font-size="11">**** </text>
  <rect x="223" y="294" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="229" y="305" class="text-bright" font-size="9">clear</text>
  <rect x="263" y="294" width="48" height="16" rx="8" fill="#007acc"/>
  <text x="269" y="305" class="text-bright" font-size="9">versatile</text>
  <text x="223" y="330" class="text-dim" font-size="10">--</text>
  <rect x="335" y="320" width="40" height="14" rx="3" fill="#3498db"/>
  <text x="339" y="331" class="text-bright" font-size="8" font-weight="600">AZURE</text>
  <rect x="223" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="230" y="360" class="text" font-size="12">></text>
  <rect x="251" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="257" y="361" class="text-dim" font-size="14">*</text>
  <rect x="279" y="344" width="24" height="24" rx="4" class="btn-primary"/>
  <text x="284" y="360" class="text-bright" font-size="10">SET</text>

  <!-- Card 3 -->
  <rect x="406" y="210" width="185" height="180" class="card"/>
  <circle cx="430" cy="232" r="14" class="avatar-browser"/>
  <text x="425" y="236" class="text-bright" font-size="10" font-weight="700">B</text>
  <text x="450" y="236" class="text-bright" font-size="13" font-weight="600">Google US</text>
  <text x="418" y="256" class="text-dim" font-size="11">Female, American English</text>
  <text x="418" y="272" class="text-dim" font-size="11">natural</text>
  <text x="418" y="288" class="star-filled" font-size="11">*** </text>
  <rect x="418" y="294" width="42" height="16" rx="8" fill="#007acc"/>
  <text x="424" y="305" class="text-bright" font-size="9">default</text>
  <text x="418" y="330" class="text-dim" font-size="10">--</text>
  <rect x="520" y="320" width="52" height="14" rx="3" fill="#27ae60"/>
  <text x="524" y="331" class="text-bright" font-size="8" font-weight="600">BROWSER</text>
  <rect x="418" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="425" y="360" class="text" font-size="12">></text>
  <rect x="446" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="452" y="361" class="text-dim" font-size="14">*</text>
  <rect x="474" y="344" width="24" height="24" rx="4" class="btn-primary"/>
  <text x="479" y="360" class="text-bright" font-size="10">SET</text>

  <!-- Card 4 -->
  <rect x="601" y="210" width="185" height="180" class="card"/>
  <circle cx="625" cy="232" r="14" class="avatar-rvc"/>
  <text x="619" y="236" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="645" y="236" class="text-bright" font-size="13" font-weight="600">Deep Baritone</text>
  <text x="613" y="256" class="text-dim" font-size="11">Male, British English</text>
  <text x="613" y="272" class="text-dim" font-size="11">broadcast</text>
  <text x="613" y="288" class="star-filled" font-size="11">**** </text>
  <rect x="613" y="294" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="619" y="305" class="text-bright" font-size="9">deep</text>
  <rect x="653" y="294" width="32" height="16" rx="8" fill="#007acc"/>
  <text x="659" y="305" class="text-bright" font-size="9">bass</text>
  <text x="613" y="330" class="text-dim" font-size="10">52 MB</text>
  <rect x="730" y="320" width="32" height="14" rx="3" fill="#9b59b6"/>
  <text x="734" y="331" class="text-bright" font-size="8" font-weight="600">RVC</text>
  <rect x="613" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="620" y="360" class="text" font-size="12">></text>
  <rect x="641" y="344" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="647" y="361" class="star-filled" font-size="14">*</text>
  <rect x="669" y="344" width="24" height="24" rx="4" class="btn-primary"/>
  <text x="674" y="360" class="text-bright" font-size="10">SET</text>

  <!-- Now Playing Bar -->
  <rect x="0" y="580" width="800" height="40" class="now-playing"/>
  <text x="16" y="604" class="text-dim" font-size="11">Now Playing:</text>
  <circle cx="100" cy="600" r="8" class="avatar-azure"/>
  <text x="96" y="604" class="text-bright" font-size="8" font-weight="700">A</text>
  <text x="116" y="604" class="text-bright" font-size="12" font-weight="600">Aria Neural</text>
  <text x="200" y="604" class="text-dim" font-size="11">(Azure, en-US)</text>
  <!-- Mini controls -->
  <rect x="720" y="588" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="727" y="604" class="text" font-size="12">></text>
  <rect x="748" y="588" width="24" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="754" y="604" class="text-dim" font-size="10">vol</text>

  <!-- Legend -->
  <text x="16" y="440" class="text-dim" font-size="10">Legend: [>] Play preview   [*] Toggle favorite   [SET] Set as active voice</text>
  <text x="16" y="455" class="text-dim" font-size="10">Avatar colors:  </text>
  <circle cx="100" cy="452" r="5" class="avatar-rvc"/>
  <text x="108" y="455" class="text-dim" font-size="10">RVC  </text>
  <circle cx="140" cy="452" r="5" class="avatar-azure"/>
  <text x="148" y="455" class="text-dim" font-size="10">Azure  </text>
  <circle cx="186" cy="452" r="5" class="avatar-browser"/>
  <text x="194" y="455" class="text-dim" font-size="10">Browser  </text>
</svg>
```

### Store Tab Layout

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 650" font-family="Segoe UI, sans-serif" font-size="12">
  <defs>
    <style>
      .bg { fill: #1e1e1e; }
      .header { fill: #2d2d2d; }
      .text { fill: #cccccc; }
      .text-dim { fill: #808080; }
      .text-bright { fill: #ffffff; }
      .accent { fill: #007acc; }
      .tab-active { fill: #3c3c3c; }
      .search-bg { fill: #3c3c3c; }
      .chip { fill: none; stroke: #5a5d5e; stroke-width: 1; }
      .chip-active { fill: #007acc; stroke: #007acc; }
      .card { fill: #1e1e1e; stroke: #3c3c3c; stroke-width: 1; rx: 6; }
      .avatar-rvc { fill: #9b59b6; }
      .star-filled { fill: #ffc107; }
      .btn-primary { fill: #007acc; rx: 4; }
      .btn-download { fill: #007acc; rx: 4; }
      .installed-badge { fill: #27ae60; }
      .progress-ring { fill: none; stroke: #007acc; stroke-width: 2; }
      .progress-bg { fill: none; stroke: #3c3c3c; stroke-width: 2; }
      .dl-bar { fill: #2d2d2d; stroke: #3c3c3c; stroke-width: 1; }
      .dl-progress { fill: #007acc; }
      .label { fill: #808080; font-size: 10px; font-weight: 600; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="800" height="650" class="bg"/>

  <!-- Header -->
  <rect x="0" y="0" width="800" height="80" class="header"/>

  <!-- Title -->
  <text x="16" y="28" class="text-bright" font-size="16" font-weight="600">Voice Studio</text>

  <!-- Tab Switcher -->
  <rect x="130" y="10" width="64" height="28" fill="none"/>
  <text x="145" y="29" class="text-dim" font-size="12">Library</text>
  <rect x="198" y="10" width="52" height="28" class="tab-active" rx="4"/>
  <text x="211" y="29" class="text-bright" font-size="12" font-weight="600">Store</text>

  <!-- Search Bar -->
  <rect x="16" y="46" width="580" height="28" class="search-bg" rx="4"/>
  <text x="36" y="64" class="text-dim" font-size="12">Search store models...</text>

  <!-- View Toggle -->
  <rect x="720" y="46" width="28" height="28" class="accent" rx="4"/>
  <text x="727" y="65" class="text-bright" font-size="14">G</text>
  <rect x="752" y="46" width="28" height="28" fill="none" stroke="#3c3c3c" rx="4"/>
  <text x="759" y="65" class="text-dim" font-size="14">L</text>

  <!-- Separator -->
  <line x1="0" y1="80" x2="800" y2="80" stroke="#3c3c3c" stroke-width="1"/>

  <!-- Filter Row 1 -->
  <text x="16" y="104" class="label">Gender</text>
  <rect x="70" y="92" width="54" height="20" class="chip" rx="10"/>
  <text x="78" y="106" class="text" font-size="11">Female</text>
  <rect x="128" y="92" width="42" height="20" class="chip" rx="10"/>
  <text x="136" y="106" class="text" font-size="11">Male</text>

  <text x="200" y="104" class="label">Installed</text>
  <rect x="258" y="92" width="56" height="20" class="chip" rx="10"/>
  <text x="266" y="106" class="text" font-size="11">Hide (8)</text>

  <!-- Filter Row 2: Mood -->
  <text x="16" y="130" class="label">Mood</text>
  <rect x="70" y="118" width="48" height="20" class="chip" rx="10"/>
  <text x="78" y="132" class="text" font-size="11">Warm</text>
  <rect x="122" y="118" width="44" height="20" class="chip" rx="10"/>
  <text x="130" y="132" class="text" font-size="11">Calm</text>
  <rect x="170" y="118" width="48" height="20" class="chip" rx="10"/>
  <text x="178" y="132" class="text" font-size="11">Bright</text>
  <rect x="222" y="118" width="44" height="20" class="chip" rx="10"/>
  <text x="230" y="132" class="text" font-size="11">Deep</text>

  <!-- Separator -->
  <line x1="16" y1="146" x2="784" y2="146" stroke="#3c3c3c" stroke-width="1"/>

  <!-- Store Card 1: Available for download -->
  <rect x="16" y="156" width="185" height="210" class="card"/>
  <circle cx="40" cy="178" r="14" class="avatar-rvc"/>
  <text x="34" y="182" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="60" y="182" class="text-bright" font-size="13" font-weight="600">Crystal Voice</text>
  <text x="28" y="200" class="text-dim" font-size="11">Female, American English</text>
  <text x="28" y="216" class="text-dim" font-size="11">natural</text>
  <text x="28" y="232" class="star-filled" font-size="11">*****</text>
  <rect x="28" y="240" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="34" y="251" class="text-bright" font-size="9">crisp</text>
  <rect x="68" y="240" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="74" y="251" class="text-bright" font-size="9">clear</text>
  <text x="28" y="276" class="text-dim" font-size="10">62 MB</text>
  <!-- Preview buttons -->
  <rect x="28" y="286" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="34" y="300" class="text" font-size="10">Hero</text>
  <rect x="76" y="286" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="82" y="300" class="text" font-size="10">Text</text>
  <!-- Download button -->
  <rect x="28" y="314" width="156" height="26" class="btn-download"/>
  <text x="72" y="331" class="text-bright" font-size="11" font-weight="600">DOWNLOAD</text>

  <!-- Store Card 2: Already installed -->
  <rect x="211" y="156" width="185" height="210" class="card"/>
  <circle cx="235" cy="178" r="14" class="avatar-rvc"/>
  <text x="229" y="182" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="255" y="182" class="text-bright" font-size="13" font-weight="600">Lunar Studio</text>
  <text x="223" y="200" class="text-dim" font-size="11">Female, American English</text>
  <text x="223" y="216" class="text-dim" font-size="11">natural</text>
  <text x="223" y="232" class="star-filled" font-size="11">*****</text>
  <rect x="223" y="240" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="229" y="251" class="text-bright" font-size="9">warm</text>
  <text x="223" y="276" class="text-dim" font-size="10">45 MB</text>
  <!-- Installed badge -->
  <rect x="280" y="268" width="68" height="18" rx="9" class="installed-badge"/>
  <text x="288" y="281" class="text-bright" font-size="10">Installed</text>
  <!-- Preview buttons only (no download) -->
  <rect x="223" y="296" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="229" y="310" class="text" font-size="10">Hero</text>
  <rect x="271" y="296" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="277" y="310" class="text" font-size="10">Text</text>

  <!-- Store Card 3: Downloading (progress ring) -->
  <rect x="406" y="156" width="185" height="210" class="card"/>
  <circle cx="430" cy="178" r="14" class="avatar-rvc"/>
  <text x="424" y="182" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="450" y="182" class="text-bright" font-size="13" font-weight="600">Shadow Bass</text>
  <text x="418" y="200" class="text-dim" font-size="11">Male, British English</text>
  <text x="418" y="216" class="text-dim" font-size="11">broadcast</text>
  <text x="418" y="232" class="star-filled" font-size="11">****</text>
  <rect x="418" y="240" width="36" height="16" rx="8" fill="#007acc"/>
  <text x="424" y="251" class="text-bright" font-size="9">deep</text>
  <text x="418" y="276" class="text-dim" font-size="10">55 MB</text>
  <!-- Download progress bar -->
  <rect x="418" y="290" width="156" height="4" rx="2" fill="#3c3c3c"/>
  <rect x="418" y="290" width="104" height="4" rx="2" class="dl-progress"/>
  <text x="418" y="310" class="accent" font-size="11" font-weight="600">67% downloading...</text>
  <!-- Cancel button -->
  <rect x="418" y="320" width="156" height="26" rx="4" fill="none" stroke="#808080"/>
  <text x="478" y="337" class="text-dim" font-size="11">CANCEL</text>

  <!-- Store Card 4: Available -->
  <rect x="601" y="156" width="185" height="210" class="card"/>
  <circle cx="625" cy="178" r="14" class="avatar-rvc"/>
  <text x="619" y="182" class="text-bright" font-size="10" font-weight="700">R</text>
  <text x="645" y="182" class="text-bright" font-size="13" font-weight="600">Ember Glow</text>
  <text x="613" y="200" class="text-dim" font-size="11">Female, Australian</text>
  <text x="613" y="216" class="text-dim" font-size="11">expressive</text>
  <text x="613" y="232" class="star-filled" font-size="11">****</text>
  <rect x="613" y="240" width="42" height="16" rx="8" fill="#007acc"/>
  <text x="619" y="251" class="text-bright" font-size="9">bright</text>
  <text x="613" y="276" class="text-dim" font-size="10">48 MB</text>
  <rect x="613" y="286" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="619" y="300" class="text" font-size="10">Hero</text>
  <rect x="661" y="286" width="44" height="20" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="667" y="300" class="text" font-size="10">Text</text>
  <rect x="613" y="314" width="156" height="26" class="btn-download"/>
  <text x="657" y="331" class="text-bright" font-size="11" font-weight="600">DOWNLOAD</text>

  <!-- Pagination -->
  <text x="340" y="400" class="text-dim" font-size="11">Page:</text>
  <rect x="370" y="388" width="20" height="20" rx="3" fill="none" stroke="#3c3c3c"/>
  <text x="376" y="402" class="text-dim" font-size="11">&lt;</text>
  <rect x="394" y="388" width="20" height="20" rx="3" class="accent"/>
  <text x="400" y="402" class="text-bright" font-size="11">1</text>
  <rect x="418" y="388" width="20" height="20" rx="3" fill="none" stroke="#3c3c3c"/>
  <text x="424" y="402" class="text" font-size="11">2</text>
  <rect x="442" y="388" width="20" height="20" rx="3" fill="none" stroke="#3c3c3c"/>
  <text x="448" y="402" class="text" font-size="11">3</text>
  <rect x="466" y="388" width="20" height="20" rx="3" fill="none" stroke="#3c3c3c"/>
  <text x="472" y="402" class="text-dim" font-size="11">&gt;</text>

  <!-- Download Queue / Disk Bar -->
  <rect x="0" y="610" width="800" height="40" class="dl-bar"/>
  <!-- Active download -->
  <text x="16" y="634" class="text-dim" font-size="11">Downloads:</text>
  <text x="90" y="634" class="text" font-size="11">shadow-bass</text>
  <rect x="174" y="626" width="60" height="4" rx="2" fill="#3c3c3c"/>
  <rect x="174" y="626" width="40" height="4" rx="2" class="dl-progress"/>
  <text x="240" y="634" class="accent" font-size="11">67%</text>

  <!-- Separator -->
  <line x1="300" y1="618" x2="300" y2="642" stroke="#3c3c3c" stroke-width="1"/>

  <!-- Disk usage -->
  <text x="316" y="634" class="text-dim" font-size="11">Disk:</text>
  <rect x="350" y="626" width="120" height="6" rx="3" fill="#3c3c3c"/>
  <rect x="350" y="626" width="22" height="6" rx="3" fill="#27ae60"/>
  <text x="480" y="634" class="text" font-size="11">18.2 GB / 100 GB</text>

  <!-- Refresh button -->
  <rect x="740" y="620" width="44" height="24" rx="4" fill="none" stroke="#3c3c3c"/>
  <text x="746" y="636" class="text-dim" font-size="10">Refresh</text>

  <!-- Legend -->
  <text x="16" y="430" class="text-dim" font-size="10">Store card states: Available (download button) | Installed (badge, no download) | Downloading (progress bar + cancel)</text>
  <text x="16" y="445" class="text-dim" font-size="10">Preview types: [Hero] Pre-generated 5s clip (instant) | [Text] Custom text synthesis (on-demand)</text>
</svg>
```

---

*This guide covers Voice Studio as implemented in KiloCode's speech system. For VPS deployment and API details, see [VPS-SETUP.md](VPS-SETUP.md) and [API-REFERENCE.md](API-REFERENCE.md). For architecture and data flow diagrams, see [ARCHITECTURE.md](ARCHITECTURE.md).*
