# Voice Studio Architecture

Technical architecture documentation for the KiloCode Voice Studio speech system.

---

## 1. System Overview

The speech system uses a **two-part architecture** that separates basic configuration from advanced voice management.

**SpeechTab** (in Settings) handles enable/disable, provider selection, volume, and provider-specific config (Docker port, Azure API key, browser voice). It contains an "Open Voice Studio" button that launches the full panel.

**Voice Studio Panel** opens as a full-width VS Code editor tab with its own webview. It provides a Library tab for browsing installed voices and a Store tab for discovering and downloading new voice models from the VPS catalog.

Both share the same extension backend (`VoiceStudioProvider`) and communicate via VS Code's `postMessage` / `onDidReceiveMessage` protocol.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 340" style="max-width:800px;font-family:Segoe UI,system-ui,sans-serif;font-size:13px">
  <!-- Background -->
  <rect width="800" height="340" fill="#1e1e1e" rx="8"/>

  <!-- SpeechTab box -->
  <rect x="30" y="30" width="220" height="120" rx="6" fill="#252526" stroke="#3c3c3c" stroke-width="1.5"/>
  <text x="140" y="55" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="14">SpeechTab</text>
  <text x="140" y="75" fill="#858585" text-anchor="middle" font-size="11">(Settings panel)</text>
  <text x="50" y="98" fill="#9cdcfe" font-size="11">Enable / Provider / Volume</text>
  <text x="50" y="115" fill="#9cdcfe" font-size="11">RVC / Azure / Browser config</text>
  <text x="50" y="132" fill="#4ec9b0" font-size="11">"Open Voice Studio" button</text>

  <!-- Arrow from SpeechTab to VoiceStudioPanel -->
  <line x1="250" y1="90" x2="310" y2="90" stroke="#569cd6" stroke-width="2" marker-end="url(#arrowBlue)"/>
  <text x="280" y="82" fill="#569cd6" text-anchor="middle" font-size="10">opens</text>

  <!-- VoiceStudioPanel box -->
  <rect x="310" y="20" width="460" height="140" rx="6" fill="#252526" stroke="#3c3c3c" stroke-width="1.5"/>
  <text x="540" y="45" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="14">VoiceStudioPanel</text>
  <text x="540" y="63" fill="#858585" text-anchor="middle" font-size="11">(Full editor-tab webview)</text>

  <!-- Library sub-box -->
  <rect x="330" y="75" width="200" height="70" rx="4" fill="#2d2d30" stroke="#464646"/>
  <text x="430" y="98" fill="#4ec9b0" text-anchor="middle" font-size="12" font-weight="600">Library Tab</text>
  <text x="430" y="115" fill="#858585" text-anchor="middle" font-size="10">Installed voices, favorites,</text>
  <text x="430" y="128" fill="#858585" text-anchor="middle" font-size="10">history, set-active, preview</text>

  <!-- Store sub-box -->
  <rect x="550" y="75" width="200" height="70" rx="4" fill="#2d2d30" stroke="#464646"/>
  <text x="650" y="98" fill="#ce9178" text-anchor="middle" font-size="12" font-weight="600">Store Tab</text>
  <text x="650" y="115" fill="#858585" text-anchor="middle" font-size="10">VPS catalog, download,</text>
  <text x="650" y="128" fill="#858585" text-anchor="middle" font-size="10">preview, disk usage, pages</text>

  <!-- Extension backend box -->
  <rect x="180" y="200" width="440" height="110" rx="6" fill="#252526" stroke="#3c3c3c" stroke-width="1.5"/>
  <text x="400" y="225" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="14">VoiceStudioProvider</text>
  <text x="400" y="243" fill="#858585" text-anchor="middle" font-size="11">(Extension host, Node.js)</text>
  <text x="210" y="268" fill="#9cdcfe" font-size="10">globalState persistence</text>
  <text x="210" y="283" fill="#9cdcfe" font-size="10">Docker container (RVC)</text>
  <text x="210" y="298" fill="#9cdcfe" font-size="10">VPS model server (catalog)</text>
  <text x="440" y="268" fill="#9cdcfe" font-size="10">Download w/ progress + abort</text>
  <text x="440" y="283" fill="#9cdcfe" font-size="10">Voice commands (rate/vol/switch)</text>
  <text x="440" y="298" fill="#9cdcfe" font-size="10">Settings configuration API</text>

  <!-- Arrow webview to provider -->
  <line x1="540" y1="160" x2="460" y2="200" stroke="#569cd6" stroke-width="1.5" marker-end="url(#arrowBlue)"/>
  <text x="520" y="178" fill="#569cd6" font-size="10">postMessage</text>

  <!-- Arrow provider to webview -->
  <line x1="340" y1="200" x2="420" y2="160" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#arrowGreen)"/>
  <text x="350" y="178" fill="#4ec9b0" font-size="10">postMessage</text>

  <!-- Arrow SpeechTab to provider -->
  <line x1="140" y1="150" x2="280" y2="215" stroke="#569cd6" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#arrowBlue)"/>
  <text x="180" y="190" fill="#858585" font-size="10">requestSpeechSettings</text>

  <!-- Arrowhead definitions -->
  <defs>
    <marker id="arrowBlue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="arrowGreen" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#4ec9b0"/>
    </marker>
  </defs>
</svg>

---

## 2. Component Tree

The Voice Studio webview is a SolidJS application rendered into a VS Code webview panel. The entry point (`index.tsx`) acquires the VS Code API and renders the `App` component.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 700" style="max-width:880px;font-family:Segoe UI,system-ui,sans-serif;font-size:12px">
  <rect width="880" height="700" fill="#1e1e1e" rx="8"/>

  <!-- Root: App -->
  <rect x="350" y="15" width="180" height="36" rx="5" fill="#264f78" stroke="#569cd6" stroke-width="1.5"/>
  <text x="440" y="38" fill="#ffffff" text-anchor="middle" font-weight="600" font-size="14">App</text>

  <!-- Lines from App -->
  <line x1="380" y1="51" x2="170" y2="80" stroke="#464646" stroke-width="1.2"/>
  <line x1="440" y1="51" x2="440" y2="80" stroke="#464646" stroke-width="1.2"/>
  <line x1="500" y1="51" x2="710" y2="80" stroke="#464646" stroke-width="1.2"/>

  <!-- Header -->
  <rect x="320" y="80" width="240" height="32" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="440" y="101" fill="#4ec9b0" text-anchor="middle" font-weight="600">VoiceStudioHeader (inline in App)</text>

  <!-- Header children lines -->
  <line x1="360" y1="112" x2="220" y2="140" stroke="#464646" stroke-width="1"/>
  <line x1="440" y1="112" x2="440" y2="140" stroke="#464646" stroke-width="1"/>
  <line x1="520" y1="112" x2="650" y2="140" stroke="#464646" stroke-width="1"/>

  <!-- Tab Switcher -->
  <rect x="140" y="140" width="160" height="28" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="220" y="159" fill="#9cdcfe" text-anchor="middle">Tab Switcher (Library | Store)</text>

  <!-- SearchBar -->
  <rect x="340" y="140" width="200" height="28" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="440" y="159" fill="#9cdcfe" text-anchor="middle">SearchBar + voice-to-search mic</text>

  <!-- ViewToggle -->
  <rect x="580" y="140" width="140" height="28" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="650" y="159" fill="#9cdcfe" text-anchor="middle">ViewToggle (grid/list)</text>

  <!-- FilterBar (shared) -->
  <rect x="30" y="80" width="260" height="32" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="160" y="101" fill="#dcdcaa" text-anchor="middle" font-weight="600">FilterBar</text>

  <!-- FilterBar children -->
  <line x1="80" y1="112" x2="60" y2="140" stroke="#464646" stroke-width="1"/>
  <line x1="160" y1="112" x2="160" y2="140" stroke="#464646" stroke-width="1"/>
  <line x1="240" y1="112" x2="260" y2="140" stroke="#464646" stroke-width="1"/>

  <rect x="10" y="140" width="100" height="24" rx="3" fill="#333" stroke="#464646"/>
  <text x="60" y="157" fill="#858585" text-anchor="middle" font-size="10">Gender / Accent</text>
  <rect x="115" y="140" width="90" height="24" rx="3" fill="#333" stroke="#464646"/>
  <text x="160" y="157" fill="#858585" text-anchor="middle" font-size="10">Style / Provider</text>
  <rect x="210" y="140" width="90" height="24" rx="3" fill="#333" stroke="#464646"/>
  <text x="255" y="157" fill="#858585" text-anchor="middle" font-size="10">Mood / TagChip</text>

  <!-- === LIBRARY TAB === -->
  <rect x="30" y="200" width="380" height="290" rx="6" fill="#1b1b1b" stroke="#4ec9b0" stroke-width="1.5"/>
  <text x="220" y="222" fill="#4ec9b0" text-anchor="middle" font-weight="700" font-size="13">Library Tab</text>

  <!-- SubTabs -->
  <rect x="50" y="235" width="340" height="26" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="220" y="253" fill="#9cdcfe" text-anchor="middle" font-size="11">SubTabs: All | Favorites | Recent</text>

  <!-- VoiceGrid / VoiceList -->
  <rect x="50" y="270" width="340" height="110" rx="4" fill="#252526" stroke="#3c3c3c"/>
  <text x="220" y="292" fill="#cccccc" text-anchor="middle" font-weight="600">VoiceGrid / VoiceList (toggleable)</text>

  <!-- VoiceCard -->
  <rect x="70" y="300" width="130" height="30" rx="3" fill="#333" stroke="#464646"/>
  <text x="135" y="320" fill="#ce9178" text-anchor="middle" font-size="11">VoiceCard</text>
  <!-- VoiceRow -->
  <rect x="210" y="300" width="130" height="30" rx="3" fill="#333" stroke="#464646"/>
  <text x="275" y="320" fill="#ce9178" text-anchor="middle" font-size="11">VoiceRow</text>

  <!-- Card children -->
  <rect x="60" y="340" width="160" height="22" rx="3" fill="#3c3c3c" stroke="#464646"/>
  <text x="140" y="356" fill="#858585" text-anchor="middle" font-size="9">VoiceAvatar + Play + Fav + SetActive</text>

  <!-- Now Playing bar -->
  <rect x="50" y="395" width="340" height="30" rx="4" fill="#2d2d30" stroke="#4ec9b0"/>
  <text x="220" y="415" fill="#4ec9b0" text-anchor="middle" font-size="11">NowPlaying bar (active voice + provider)</text>

  <!-- AudioPlayer -->
  <rect x="50" y="435" width="340" height="30" rx="4" fill="#2d2d30" stroke="#dcdcaa" stroke-dasharray="4,3"/>
  <text x="220" y="455" fill="#dcdcaa" text-anchor="middle" font-size="11">AudioPlayer (mini progress bar)</text>

  <!-- === STORE TAB === -->
  <rect x="450" y="200" width="400" height="480" rx="6" fill="#1b1b1b" stroke="#ce9178" stroke-width="1.5"/>
  <text x="650" y="222" fill="#ce9178" text-anchor="middle" font-weight="700" font-size="13">Store Tab</text>

  <!-- Disk Usage -->
  <rect x="470" y="235" width="360" height="26" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="650" y="253" fill="#9cdcfe" text-anchor="middle" font-size="11">DiskUsage indicator (used / max + bar)</text>

  <!-- VoiceGrid / VoiceList -->
  <rect x="470" y="270" width="360" height="120" rx="4" fill="#252526" stroke="#3c3c3c"/>
  <text x="650" y="292" fill="#cccccc" text-anchor="middle" font-weight="600">VoiceGrid / VoiceList (paginated, 24/page)</text>

  <rect x="490" y="300" width="130" height="30" rx="3" fill="#333" stroke="#464646"/>
  <text x="555" y="320" fill="#ce9178" text-anchor="middle" font-size="11">VoiceCard</text>
  <rect x="630" y="300" width="130" height="30" rx="3" fill="#333" stroke="#464646"/>
  <text x="695" y="320" fill="#ce9178" text-anchor="middle" font-size="11">VoiceRow</text>

  <!-- Store card extras -->
  <rect x="480" y="340" width="180" height="22" rx="3" fill="#3c3c3c" stroke="#464646"/>
  <text x="570" y="356" fill="#858585" text-anchor="middle" font-size="9">HeroPreview + CustomPreview + InstalledBadge</text>
  <rect x="670" y="340" width="150" height="22" rx="3" fill="#3c3c3c" stroke="#464646"/>
  <text x="745" y="356" fill="#858585" text-anchor="middle" font-size="9">Download + ProgressRing + SizeBadge</text>

  <!-- Custom preview input -->
  <rect x="470" y="400" width="360" height="30" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="650" y="420" fill="#9cdcfe" text-anchor="middle" font-size="11">CustomPreview inline input (text + submit)</text>

  <!-- Pagination -->
  <rect x="470" y="440" width="360" height="26" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="650" y="458" fill="#9cdcfe" text-anchor="middle" font-size="11">Pagination (Previous / 1 2 ... n / Next)</text>

  <!-- Download Queue -->
  <rect x="470" y="480" width="360" height="80" rx="4" fill="#2d2d30" stroke="#ce9178"/>
  <text x="650" y="500" fill="#ce9178" text-anchor="middle" font-weight="600" font-size="12">DownloadQueue bar</text>
  <text x="650" y="518" fill="#858585" text-anchor="middle" font-size="10">Active downloads with progress bars</text>
  <text x="650" y="534" fill="#858585" text-anchor="middle" font-size="10">Per-item cancel button + percentage</text>
  <text x="650" y="550" fill="#858585" text-anchor="middle" font-size="10">Abortable via AbortController</text>

  <!-- Refresh button -->
  <rect x="470" y="570" width="360" height="26" rx="4" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="650" y="588" fill="#9cdcfe" text-anchor="middle" font-size="11">Refresh Catalog (POST rebuild + re-fetch)</text>

  <!-- === SHARED COMPONENTS === -->
  <rect x="30" y="510" width="380" height="170" rx="6" fill="#1b1b1b" stroke="#dcdcaa" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="220" y="532" fill="#dcdcaa" text-anchor="middle" font-weight="700" font-size="13">Shared Components</text>

  <rect x="50" y="545" width="160" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="130" y="562" fill="#9cdcfe" text-anchor="middle" font-size="11">AudioPlayer</text>
  <rect x="220" y="545" width="170" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="305" y="562" fill="#9cdcfe" text-anchor="middle" font-size="11">VoiceAvatar</text>

  <rect x="50" y="578" width="160" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="130" y="595" fill="#9cdcfe" text-anchor="middle" font-size="11">TagChip</text>
  <rect x="220" y="578" width="170" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="305" y="595" fill="#9cdcfe" text-anchor="middle" font-size="11">AutocompleteDropdown</text>

  <rect x="50" y="611" width="160" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="130" y="628" fill="#9cdcfe" text-anchor="middle" font-size="11">ViewToggle</text>
  <rect x="220" y="611" width="170" height="24" rx="3" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="305" y="628" fill="#9cdcfe" text-anchor="middle" font-size="11">VoiceCard / VoiceRow</text>

  <!-- Hooks box -->
  <rect x="50" y="644" width="340" height="24" rx="3" fill="#252526" stroke="#569cd6" stroke-dasharray="3,3"/>
  <text x="220" y="661" fill="#569cd6" text-anchor="middle" font-size="11">Hooks: useVoiceCommands + useVoiceSearch</text>
</svg>

### File Locations

| Component | Path |
|---|---|
| `App` (root) | `webview-ui/voice-studio/App.tsx` |
| `index.tsx` (entry) | `webview-ui/voice-studio/index.tsx` |
| `LibraryTab` | `webview-ui/voice-studio/tabs/LibraryTab.tsx` |
| `StoreTab` | `webview-ui/voice-studio/tabs/StoreTab.tsx` |
| `SearchBar` | `webview-ui/voice-studio/components/SearchBar.tsx` |
| `FilterBar` | `webview-ui/voice-studio/components/FilterBar.tsx` |
| `VoiceCard` | `webview-ui/voice-studio/components/VoiceCard.tsx` |
| `VoiceRow` | `webview-ui/voice-studio/components/VoiceRow.tsx` |
| `AudioPlayer` | `webview-ui/voice-studio/components/AudioPlayer.tsx` |
| `VoiceAvatar` | `webview-ui/voice-studio/components/VoiceAvatar.tsx` |
| `TagChip` | `webview-ui/voice-studio/components/TagChip.tsx` |
| `ViewToggle` | `webview-ui/voice-studio/components/ViewToggle.tsx` |
| `useVoiceCommands` | `webview-ui/voice-studio/hooks/useVoiceCommands.ts` |
| `useVoiceSearch` | `webview-ui/voice-studio/hooks/useVoiceSearch.ts` |
| `VoiceStudioProvider` | `src/VoiceStudioProvider.ts` |
| `SpeechTab` | `webview-ui/src/components/settings/SpeechTab.tsx` |
| Types | `webview-ui/src/types/voice.ts` |
| Search utils | `webview-ui/src/utils/voice-search.ts` |

All paths are relative to `packages/kilo-vscode/`.

---

## 3. Data Flow

User interactions in the webview trigger `postMessage` calls to the extension host. The `VoiceStudioProvider` processes each message, interacts with external services (Docker container, VPS model server, VS Code globalState/configuration), and posts response messages back to the webview. SolidJS signals in the `App` component reactively update the UI.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 420" style="max-width:900px;font-family:Segoe UI,system-ui,sans-serif;font-size:12px">
  <rect width="900" height="420" fill="#1e1e1e" rx="8"/>

  <!-- Defs -->
  <defs>
    <marker id="dfArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="dfArrowGreen" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#4ec9b0"/>
    </marker>
    <marker id="dfArrowOrange" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#ce9178"/>
    </marker>
    <marker id="dfArrowYellow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#dcdcaa"/>
    </marker>
  </defs>

  <!-- Step 1: User Action -->
  <rect x="30" y="50" width="140" height="50" rx="20" fill="#264f78" stroke="#569cd6" stroke-width="1.5"/>
  <text x="100" y="72" fill="#ffffff" text-anchor="middle" font-weight="600">User Action</text>
  <text x="100" y="88" fill="#9cdcfe" text-anchor="middle" font-size="10">click / type / speak</text>

  <!-- Arrow 1 -->
  <line x1="170" y1="75" x2="220" y2="75" stroke="#569cd6" stroke-width="2" marker-end="url(#dfArrow)"/>

  <!-- Step 2: Webview -->
  <rect x="220" y="40" width="150" height="70" rx="6" fill="#252526" stroke="#3c3c3c" stroke-width="1.5"/>
  <text x="295" y="62" fill="#4ec9b0" text-anchor="middle" font-weight="600">Webview</text>
  <text x="295" y="78" fill="#9cdcfe" text-anchor="middle" font-size="10">SolidJS App</text>
  <text x="295" y="92" fill="#858585" text-anchor="middle" font-size="10">vscode.postMessage()</text>

  <!-- Arrow 2: postMessage -->
  <line x1="370" y1="75" x2="430" y2="75" stroke="#569cd6" stroke-width="2" marker-end="url(#dfArrow)"/>
  <text x="400" y="66" fill="#569cd6" text-anchor="middle" font-size="10" font-weight="600">postMessage</text>

  <!-- Step 3: VoiceStudioProvider -->
  <rect x="430" y="25" width="200" height="100" rx="6" fill="#252526" stroke="#569cd6" stroke-width="1.5"/>
  <text x="530" y="50" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="13">VoiceStudioProvider</text>
  <text x="530" y="68" fill="#858585" text-anchor="middle" font-size="10">onMessage() switch/case</text>
  <text x="530" y="84" fill="#9cdcfe" text-anchor="middle" font-size="10">httpGet / httpPost</text>
  <text x="530" y="100" fill="#9cdcfe" text-anchor="middle" font-size="10">execAsync (docker)</text>
  <text x="530" y="116" fill="#9cdcfe" text-anchor="middle" font-size="10">globalState / config</text>

  <!-- External services -->
  <!-- Docker -->
  <rect x="700" y="30" width="170" height="40" rx="4" fill="#2d2d30" stroke="#ce9178"/>
  <text x="785" y="50" fill="#ce9178" text-anchor="middle" font-size="11">Docker: edge-tts-server</text>
  <text x="785" y="63" fill="#858585" text-anchor="middle" font-size="9">localhost:5050</text>
  <line x1="630" y1="55" x2="700" y2="50" stroke="#ce9178" stroke-width="1.5" marker-end="url(#dfArrowOrange)"/>

  <!-- VPS -->
  <rect x="700" y="85" width="170" height="40" rx="4" fill="#2d2d30" stroke="#dcdcaa"/>
  <text x="785" y="105" fill="#dcdcaa" text-anchor="middle" font-size="11">VPS: model-server</text>
  <text x="785" y="118" fill="#858585" text-anchor="middle" font-size="9">voice.daveai.tech</text>
  <line x1="630" y1="85" x2="700" y2="100" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#dfArrowYellow)"/>

  <!-- globalState -->
  <rect x="700" y="145" width="170" height="35" rx="4" fill="#2d2d30" stroke="#4ec9b0"/>
  <text x="785" y="167" fill="#4ec9b0" text-anchor="middle" font-size="11">VS Code globalState</text>
  <line x1="610" y1="125" x2="700" y2="155" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#dfArrowGreen)"/>

  <!-- Return path -->
  <!-- Arrow: Provider back to webview -->
  <path d="M530,125 L530,200 L295,200" fill="none" stroke="#4ec9b0" stroke-width="2" marker-end="url(#dfArrowGreen)"/>
  <text x="415" y="193" fill="#4ec9b0" text-anchor="middle" font-size="10" font-weight="600">postMessage (response)</text>

  <!-- Step 5: Signal update -->
  <rect x="220" y="220" width="150" height="50" rx="6" fill="#252526" stroke="#4ec9b0" stroke-width="1.5"/>
  <text x="295" y="242" fill="#4ec9b0" text-anchor="middle" font-weight="600">Signal Update</text>
  <text x="295" y="258" fill="#858585" text-anchor="middle" font-size="10">setVoices(), setFavorites()...</text>

  <!-- Arrow 5 -->
  <line x1="295" y1="200" x2="295" y2="220" stroke="#4ec9b0" stroke-width="2" marker-end="url(#dfArrowGreen)"/>

  <!-- Step 6: Re-render -->
  <rect x="220" y="290" width="150" height="40" rx="6" fill="#264f78" stroke="#569cd6" stroke-width="1.5"/>
  <text x="295" y="315" fill="#ffffff" text-anchor="middle" font-weight="600">Re-render</text>
  <line x1="295" y1="270" x2="295" y2="290" stroke="#4ec9b0" stroke-width="2" marker-end="url(#dfArrowGreen)"/>

  <!-- Summary box -->
  <rect x="30" y="350" width="840" height="50" rx="6" fill="#252526" stroke="#464646"/>
  <text x="450" y="372" fill="#cccccc" text-anchor="middle" font-size="12">
    User click/type/speak  -->  vscode.postMessage({type, ...})  -->  VoiceStudioProvider.onMessage()
  </text>
  <text x="450" y="390" fill="#cccccc" text-anchor="middle" font-size="12">
    --> Docker/VPS/globalState  -->  webview.postMessage(response)  -->  signal update  -->  SolidJS re-render
  </text>
</svg>

### Data flow for each action

| User Action | Outgoing Message | Provider Action | Incoming Message |
|---|---|---|---|
| Opens panel | `requestVoiceStudioState` | Read globalState + config | `voiceStudioState` |
| Panel mount | `fetchVoiceLibrary` | HTTP GET Docker `/api/voices` | `voiceLibraryLoaded` |
| Panel mount | `fetchStoreModels` | HTTP GET VPS `/api/catalog` | `storeModelsLoaded` |
| Click preview | `previewStoreVoice` | HTTP POST VPS `/api/preview` | `previewAudioReady` |
| Click download | `downloadModel` | HTTP GET model URL with progress | `downloadProgress` (many), `downloadComplete` |
| Click cancel | `cancelDownload` | `AbortController.abort()` | `downloadComplete` (cancelled) |
| Click favorite | `toggleFavorite` | Update globalState | `favoritesUpdated` |
| Click set active | `setActiveVoice` | Update config + history | `activeVoiceSet` |
| Save search | `saveSearch` | Update globalState | `savedSearchesUpdated` |
| Voice command | `voiceCommand` | Parse + execute | `voiceCommandAck` + mode/config changes |
| Refresh catalog | `refreshStoreCatalog` | POST `/api/catalog/rebuild` + re-fetch | `storeModelsLoaded` |

---

## 4. Message Protocol

### Sequence Diagram: Panel Open

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 380" style="max-width:800px;font-family:Segoe UI,system-ui,sans-serif;font-size:11px">
  <rect width="800" height="380" fill="#1e1e1e" rx="8"/>

  <defs>
    <marker id="seqArrowR" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="seqArrowL" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#4ec9b0"/>
    </marker>
    <marker id="seqArrowR2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#ce9178"/>
    </marker>
    <marker id="seqArrowL2" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#dcdcaa"/>
    </marker>
  </defs>

  <!-- Lifeline headers -->
  <rect x="60" y="15" width="120" height="30" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="120" y="35" fill="#ffffff" text-anchor="middle" font-weight="600">Webview (App)</text>

  <rect x="320" y="15" width="160" height="30" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="400" y="35" fill="#ffffff" text-anchor="middle" font-weight="600">VoiceStudioProvider</text>

  <rect x="600" y="15" width="140" height="30" rx="4" fill="#2d2d30" stroke="#ce9178"/>
  <text x="670" y="35" fill="#ce9178" text-anchor="middle" font-weight="600">Docker / VPS</text>

  <!-- Lifelines -->
  <line x1="120" y1="45" x2="120" y2="360" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="400" y1="45" x2="400" y2="360" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="670" y1="45" x2="670" y2="360" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>

  <!-- 1. requestVoiceStudioState -->
  <line x1="125" y1="75" x2="395" y2="75" stroke="#569cd6" stroke-width="1.5" marker-end="url(#seqArrowR)"/>
  <text x="260" y="70" fill="#569cd6" text-anchor="middle">requestVoiceStudioState</text>

  <!-- 1r. voiceStudioState -->
  <line x1="395" y1="100" x2="125" y2="100" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#seqArrowL)"/>
  <text x="260" y="95" fill="#4ec9b0" text-anchor="middle">voiceStudioState (favorites, history, settings)</text>
  <rect x="400" y="78" width="80" height="18" rx="2" fill="#333" stroke="#464646"/>
  <text x="440" y="91" fill="#858585" text-anchor="middle" font-size="9">globalState</text>

  <!-- 2. fetchVoiceLibrary -->
  <line x1="125" y1="140" x2="395" y2="140" stroke="#569cd6" stroke-width="1.5" marker-end="url(#seqArrowR)"/>
  <text x="260" y="135" fill="#569cd6" text-anchor="middle">fetchVoiceLibrary</text>

  <!-- 2a. Provider to Docker -->
  <line x1="405" y1="160" x2="665" y2="160" stroke="#ce9178" stroke-width="1.5" marker-end="url(#seqArrowR2)"/>
  <text x="535" y="155" fill="#ce9178" text-anchor="middle">GET /api/voices (Docker :5050)</text>

  <!-- 2b. Docker response -->
  <line x1="665" y1="180" x2="405" y2="180" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#seqArrowL2)"/>
  <text x="535" y="175" fill="#dcdcaa" text-anchor="middle">{ voices: [...] }</text>

  <!-- 2r. voiceLibraryLoaded -->
  <line x1="395" y1="200" x2="125" y2="200" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#seqArrowL)"/>
  <text x="260" y="195" fill="#4ec9b0" text-anchor="middle">voiceLibraryLoaded (merged with fav/history)</text>

  <!-- 3. fetchStoreModels -->
  <line x1="125" y1="240" x2="395" y2="240" stroke="#569cd6" stroke-width="1.5" marker-end="url(#seqArrowR)"/>
  <text x="260" y="235" fill="#569cd6" text-anchor="middle">fetchStoreModels</text>

  <!-- 3a. Provider to VPS -->
  <line x1="405" y1="260" x2="665" y2="260" stroke="#ce9178" stroke-width="1.5" marker-end="url(#seqArrowR2)"/>
  <text x="535" y="255" fill="#ce9178" text-anchor="middle">GET /api/catalog (VPS)</text>

  <!-- 3b. VPS response -->
  <line x1="665" y1="280" x2="405" y2="280" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#seqArrowL2)"/>
  <text x="535" y="275" fill="#dcdcaa" text-anchor="middle">{ models: [...], diskUsage }</text>

  <!-- 3r. storeModelsLoaded -->
  <line x1="395" y1="300" x2="125" y2="300" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#seqArrowL)"/>
  <text x="260" y="295" fill="#4ec9b0" text-anchor="middle">storeModelsLoaded</text>

  <!-- Note: parallel -->
  <rect x="20" y="120" width="95" height="22" rx="3" fill="#333" stroke="#569cd6" stroke-dasharray="3,2"/>
  <text x="67" y="136" fill="#569cd6" text-anchor="middle" font-size="9">onMount (parallel)</text>
</svg>

### Sequence Diagram: Download Flow

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 380" style="max-width:800px;font-family:Segoe UI,system-ui,sans-serif;font-size:11px">
  <rect width="800" height="380" fill="#1e1e1e" rx="8"/>

  <defs>
    <marker id="dlR" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="dlL" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#4ec9b0"/>
    </marker>
    <marker id="dlR2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#ce9178"/>
    </marker>
    <marker id="dlL2" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#dcdcaa"/>
    </marker>
  </defs>

  <!-- Headers -->
  <rect x="60" y="15" width="120" height="30" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="120" y="35" fill="#ffffff" text-anchor="middle" font-weight="600">Webview</text>

  <rect x="320" y="15" width="160" height="30" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="400" y="35" fill="#ffffff" text-anchor="middle" font-weight="600">Provider</text>

  <rect x="580" y="15" width="100" height="30" rx="4" fill="#2d2d30" stroke="#ce9178"/>
  <text x="630" y="35" fill="#ce9178" text-anchor="middle" font-weight="600">VPS / URL</text>

  <rect x="710" y="15" width="70" height="30" rx="4" fill="#2d2d30" stroke="#dcdcaa"/>
  <text x="745" y="35" fill="#dcdcaa" text-anchor="middle" font-weight="600">Docker</text>

  <!-- Lifelines -->
  <line x1="120" y1="45" x2="120" y2="365" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="400" y1="45" x2="400" y2="365" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="630" y1="45" x2="630" y2="365" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="745" y1="45" x2="745" y2="365" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>

  <!-- 1. downloadModel -->
  <line x1="125" y1="75" x2="395" y2="75" stroke="#569cd6" stroke-width="1.5" marker-end="url(#dlR)"/>
  <text x="260" y="70" fill="#569cd6" text-anchor="middle">downloadModel { modelId, url, name }</text>

  <!-- 2. Provider creates AbortController, starts HTTP GET -->
  <rect x="380" y="82" width="130" height="16" rx="2" fill="#333" stroke="#464646"/>
  <text x="445" y="94" fill="#858585" text-anchor="middle" font-size="9">new AbortController()</text>

  <line x1="405" y1="105" x2="625" y2="105" stroke="#ce9178" stroke-width="1.5" marker-end="url(#dlR2)"/>
  <text x="515" y="100" fill="#ce9178" text-anchor="middle">HTTP GET model .pth file (streaming)</text>

  <!-- 3. Progress events -->
  <rect x="396" y="120" width="240" height="80" rx="4" fill="none" stroke="#dcdcaa" stroke-dasharray="4,3"/>
  <text x="516" y="138" fill="#dcdcaa" text-anchor="middle" font-size="10" font-style="italic">chunked data events (repeating)</text>

  <line x1="625" y1="150" x2="405" y2="150" stroke="#dcdcaa" stroke-width="1" marker-end="url(#dlL2)"/>
  <text x="515" y="146" fill="#858585" text-anchor="middle" font-size="9">data chunk</text>

  <line x1="395" y1="165" x2="125" y2="165" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#dlL)"/>
  <text x="260" y="160" fill="#4ec9b0" text-anchor="middle">downloadProgress { modelId, received, total, percent }</text>

  <line x1="625" y1="185" x2="405" y2="185" stroke="#dcdcaa" stroke-width="1" marker-end="url(#dlL2)"/>
  <text x="515" y="181" fill="#858585" text-anchor="middle" font-size="9">data chunk ...</text>

  <!-- 4. File complete, docker cp -->
  <rect x="380" y="205" width="130" height="16" rx="2" fill="#333" stroke="#464646"/>
  <text x="445" y="217" fill="#858585" text-anchor="middle" font-size="9">write to tmpFile</text>

  <line x1="405" y1="230" x2="740" y2="230" stroke="#ce9178" stroke-width="1.5" marker-end="url(#dlR2)"/>
  <text x="572" y="225" fill="#ce9178" text-anchor="middle">docker cp tmpFile edge-tts-server:/models/</text>

  <line x1="740" y1="248" x2="405" y2="248" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#dlL2)"/>
  <text x="572" y="244" fill="#dcdcaa" text-anchor="middle">success</text>

  <!-- 5. downloadComplete -->
  <line x1="395" y1="270" x2="125" y2="270" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#dlL)"/>
  <text x="260" y="265" fill="#4ec9b0" text-anchor="middle">downloadComplete { modelId, success: true }</text>

  <!-- 6. Auto-refresh library -->
  <rect x="100" y="280" width="130" height="16" rx="2" fill="#333" stroke="#4ec9b0" stroke-dasharray="3,2"/>
  <text x="165" y="292" fill="#4ec9b0" text-anchor="middle" font-size="9">auto fetchVoiceLibrary</text>

  <line x1="125" y1="305" x2="395" y2="305" stroke="#569cd6" stroke-width="1.5" marker-end="url(#dlR)"/>
  <text x="260" y="300" fill="#569cd6" text-anchor="middle">fetchVoiceLibrary</text>

  <line x1="395" y1="325" x2="125" y2="325" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#dlL)"/>
  <text x="260" y="320" fill="#4ec9b0" text-anchor="middle">voiceLibraryLoaded (now includes new model)</text>

  <!-- Cancel note -->
  <rect x="20" y="340" width="760" height="28" rx="4" fill="#252526" stroke="#464646"/>
  <text x="400" y="358" fill="#858585" text-anchor="middle" font-size="11">
    Cancel: webview sends cancelDownload --> provider calls AbortController.abort() --> downloadComplete { success: false, error: "cancelled" }
  </text>
</svg>

### Sequence Diagram: Preview and Refresh

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 340" style="max-width:800px;font-family:Segoe UI,system-ui,sans-serif;font-size:11px">
  <rect width="800" height="340" fill="#1e1e1e" rx="8"/>

  <defs>
    <marker id="pvR" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="pvL" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#4ec9b0"/>
    </marker>
    <marker id="pvR2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#ce9178"/>
    </marker>
    <marker id="pvL2" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#dcdcaa"/>
    </marker>
  </defs>

  <!-- Headers -->
  <rect x="60" y="10" width="120" height="28" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="120" y="30" fill="#ffffff" text-anchor="middle" font-weight="600">Webview</text>

  <rect x="320" y="10" width="150" height="28" rx="4" fill="#264f78" stroke="#569cd6"/>
  <text x="395" y="30" fill="#ffffff" text-anchor="middle" font-weight="600">Provider</text>

  <rect x="600" y="10" width="130" height="28" rx="4" fill="#2d2d30" stroke="#ce9178"/>
  <text x="665" y="30" fill="#ce9178" text-anchor="middle" font-weight="600">VPS</text>

  <!-- Lifelines -->
  <line x1="120" y1="38" x2="120" y2="330" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="395" y1="38" x2="395" y2="330" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="665" y1="38" x2="665" y2="330" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>

  <!-- PREVIEW FLOW -->
  <rect x="15" y="50" width="75" height="16" rx="2" fill="#333" stroke="#569cd6"/>
  <text x="52" y="62" fill="#569cd6" text-anchor="middle" font-size="9">Preview</text>

  <line x1="125" y1="72" x2="390" y2="72" stroke="#569cd6" stroke-width="1.5" marker-end="url(#pvR)"/>
  <text x="257" y="67" fill="#569cd6" text-anchor="middle">previewStoreVoice { modelId, text? }</text>

  <line x1="400" y1="92" x2="660" y2="92" stroke="#ce9178" stroke-width="1.5" marker-end="url(#pvR2)"/>
  <text x="530" y="87" fill="#ce9178" text-anchor="middle">POST /api/preview { modelId, text }</text>

  <line x1="660" y1="112" x2="400" y2="112" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#pvL2)"/>
  <text x="530" y="107" fill="#dcdcaa" text-anchor="middle">{ audio: base64, format: "wav" }</text>

  <line x1="390" y1="132" x2="125" y2="132" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#pvL)"/>
  <text x="257" y="127" fill="#4ec9b0" text-anchor="middle">previewAudioReady { modelId, audioBase64, format }</text>

  <rect x="100" y="140" width="130" height="16" rx="2" fill="#333" stroke="#4ec9b0" stroke-dasharray="3,2"/>
  <text x="165" y="152" fill="#4ec9b0" text-anchor="middle" font-size="9">playAudioFromBase64()</text>

  <!-- Divider -->
  <line x1="20" y1="170" x2="780" y2="170" stroke="#464646" stroke-width="0.5" stroke-dasharray="8,4"/>

  <!-- REFRESH FLOW -->
  <rect x="15" y="180" width="75" height="16" rx="2" fill="#333" stroke="#ce9178"/>
  <text x="52" y="192" fill="#ce9178" text-anchor="middle" font-size="9">Refresh</text>

  <line x1="125" y1="205" x2="390" y2="205" stroke="#569cd6" stroke-width="1.5" marker-end="url(#pvR)"/>
  <text x="257" y="200" fill="#569cd6" text-anchor="middle">refreshStoreCatalog</text>

  <line x1="400" y1="225" x2="660" y2="225" stroke="#ce9178" stroke-width="1.5" marker-end="url(#pvR2)"/>
  <text x="530" y="220" fill="#ce9178" text-anchor="middle">POST /api/catalog/rebuild { }</text>

  <line x1="660" y1="245" x2="400" y2="245" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#pvL2)"/>
  <text x="530" y="240" fill="#dcdcaa" text-anchor="middle">{ success, voiceCount }</text>

  <!-- Then re-fetch -->
  <rect x="378" y="252" width="110" height="16" rx="2" fill="#333" stroke="#464646"/>
  <text x="433" y="264" fill="#858585" text-anchor="middle" font-size="9">handleFetchStoreModels()</text>

  <line x1="400" y1="275" x2="660" y2="275" stroke="#ce9178" stroke-width="1.5" marker-end="url(#pvR2)"/>
  <text x="530" y="270" fill="#ce9178" text-anchor="middle">GET /api/catalog</text>

  <line x1="660" y1="295" x2="400" y2="295" stroke="#dcdcaa" stroke-width="1.5" marker-end="url(#pvL2)"/>
  <text x="530" y="290" fill="#dcdcaa" text-anchor="middle">{ models, diskUsage }</text>

  <line x1="390" y1="315" x2="125" y2="315" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#pvL)"/>
  <text x="257" y="310" fill="#4ec9b0" text-anchor="middle">storeModelsLoaded</text>
</svg>

### Complete Message Type Reference

**Webview --> Extension:**

| Message Type | Key Payload Fields | Handler |
|---|---|---|
| `requestVoiceStudioState` | -- | `handleRequestState` |
| `fetchVoiceLibrary` | -- | `handleFetchVoiceLibrary` |
| `fetchStoreModels` | -- | `handleFetchStoreModels` |
| `previewStoreVoice` | `modelId`, `text?` | `handlePreviewStoreVoice` |
| `downloadModel` | `modelId`, `url`, `name` | `handleDownloadModel` |
| `cancelDownload` | `modelId` | `handleCancelDownload` |
| `deleteModel` | `modelId`, `name` | `handleDeleteModel` |
| `toggleFavorite` | `voiceId`, `action` ("add"/"remove") | `handleToggleFavorite` |
| `setActiveVoice` | `voiceId`, `provider` | `handleSetActiveVoice` |
| `saveSearch` | `search` (SavedSearch object) | `handleSaveSearch` |
| `deleteSavedSearch` | `searchId` | `handleDeleteSavedSearch` |
| `switchInteractionMode` | `mode` | `handleSwitchInteractionMode` |
| `voiceCommand` | `transcript`, `commandId?` | `handleVoiceCommand` |
| `refreshStoreCatalog` | -- | `handleRefreshStoreCatalog` |

**Extension --> Webview:**

| Message Type | Key Payload Fields |
|---|---|
| `voiceStudioState` | `favorites`, `history`, `recentSearches`, `savedSearches`, `interactionMode`, `speechSettings` |
| `voiceLibraryLoaded` | `voices` (with `isFavorite`, `lastUsed` merged) |
| `storeModelsLoaded` | `models`, `diskUsage`, `error?` |
| `previewAudioReady` | `modelId`, `audioBase64`, `format`, `error?` |
| `downloadProgress` | `modelId`, `received`, `total`, `percent` |
| `downloadComplete` | `modelId`, `success`, `error?` |
| `modelDeleted` | `modelId`, `success`, `error?` |
| `favoritesUpdated` | `favorites` (string[]) |
| `activeVoiceSet` | `voiceId`, `provider` |
| `savedSearchesUpdated` | `savedSearches` |
| `interactionModeChanged` | `mode` |
| `voiceCommandAck` | `commandId`, `action`, `success`, `transcript?`, `voiceName?`, `provider?` |

---

## 5. State Management

### SolidJS Signals (Webview)

All UI state in the Voice Studio panel is managed by SolidJS `createSignal` and `createMemo` primitives in `App.tsx`. There is no external state management library.

| Signal | Type | Source | Update Trigger |
|---|---|---|---|
| `activeTab` | `"library" \| "store"` | User click | Tab button |
| `searchQuery` | `string` | User input | SearchBar (debounced 150ms) |
| `viewMode` | `"grid" \| "list"` | User click | ViewToggle |
| `filters` | `FilterState` | User click | FilterBar chips |
| `voices` | `VoiceEntry[]` | Extension | `voiceLibraryLoaded` message |
| `storeVoices` | `StoreVoiceEntry[]` | Extension | `storeModelsLoaded` message |
| `diskUsage` | `DiskUsageResponse \| null` | Extension | `storeModelsLoaded` message |
| `downloadJobs` | `Map<string, DownloadJob>` | Extension | `downloadProgress` / `downloadComplete` |
| `favorites` | `string[]` | Extension | `favoritesUpdated` / `voiceStudioState` |
| `recentSearches` | `string[]` | Extension | `voiceStudioState` |
| `savedSearches` | `SavedSearch[]` | Extension | `savedSearchesUpdated` |
| `interactionMode` | `InteractionMode` | Extension | `interactionModeChanged` |
| `activeVoiceId` | `string \| null` | Extension | `activeVoiceSet` / `voiceStudioState` |
| `playingVoiceId` | `string \| null` | Local audio | Play/stop audio |
| `playerTime` | `number` | Local timer | 100ms interval while playing |
| `playerDuration` | `number` | Audio metadata | `onloadedmetadata` |
| `libraryLoading` | `boolean` | Local | Set false on `voiceLibraryLoaded` |
| `storeLoading` | `boolean` | Local | Set false on `storeModelsLoaded` |

### Computed Values (createMemo)

| Memo | Depends On | Purpose |
|---|---|---|
| `filteredLibrary` | `voices`, `searchQuery`, `filters` | Fuzzy search + filter pipeline |
| `filteredStore` | `storeVoices`, `searchQuery`, `filters`, `favorites` | Same pipeline for store models |

### GlobalState Persistence (Extension Host)

The `VoiceStudioProvider` persists user preferences to VS Code's `globalState`, which survives extension restarts and workspace changes.

| Key | Type | Purpose |
|---|---|---|
| `kilocode.voiceFavorites` | `string[]` | Favorited voice IDs |
| `kilocode.voiceHistory` | `{ id, timestamp }[]` | Last 50 used voices (MRU order) |
| `kilocode.voiceRecentSearches` | `string[]` | Recent search queries |
| `kilocode.voiceSavedSearches` | `SavedSearch[]` | Named search+filter presets |
| `kilocode.voiceInteractionMode` | `string` | `"silent"` / `"assist"` / `"handsfree"` |

### Configuration Persistence

Voice provider settings use VS Code's workspace configuration (`kilo-code.new.speech.*`). The `setActiveVoice` handler writes to the appropriate config key based on the provider:

- `rvc` provider --> `rvc.voiceId`
- `azure` provider --> `azure.voiceId`
- `browser` provider --> `browser.voiceURI`

Voice commands (`slower`, `faster`, `louder`, `softer`) directly modify `browser.rate` and `volume` configuration values with clamping (rate: 0.1--3.0, volume: 0--100).

---

## 6. Search Architecture

The search system has three layers that compose together in a pipeline defined in `voice-search.ts`.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" style="max-width:800px;font-family:Segoe UI,system-ui,sans-serif;font-size:12px">
  <rect width="800" height="400" fill="#1e1e1e" rx="8"/>

  <defs>
    <marker id="srR" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
  </defs>

  <!-- Title -->
  <text x="400" y="30" fill="#cccccc" text-anchor="middle" font-weight="700" font-size="15">Search Pipeline: combinedSearch()</text>

  <!-- Layer 1: Fuzzy text search -->
  <rect x="30" y="50" width="230" height="140" rx="6" fill="#252526" stroke="#569cd6" stroke-width="1.5"/>
  <text x="145" y="72" fill="#569cd6" text-anchor="middle" font-weight="700" font-size="13">Layer 1: Fuzzy Text</text>
  <text x="145" y="92" fill="#cccccc" text-anchor="middle" font-size="11">fuzzySearchVoices()</text>

  <text x="50" y="115" fill="#9cdcfe" font-size="10">name:       10x weight</text>
  <text x="50" y="130" fill="#9cdcfe" font-size="10">tags:        5x weight (each)</text>
  <text x="50" y="145" fill="#9cdcfe" font-size="10">description: 2x weight</text>
  <text x="50" y="160" fill="#9cdcfe" font-size="10">other fields: 1x weight</text>
  <text x="50" y="178" fill="#858585" font-size="10">Multi-word: sum per-term scores</text>

  <!-- Arrow 1->2 -->
  <line x1="260" y1="120" x2="290" y2="120" stroke="#569cd6" stroke-width="2" marker-end="url(#srR)"/>

  <!-- Layer 2: Structured filters -->
  <rect x="290" y="50" width="230" height="140" rx="6" fill="#252526" stroke="#4ec9b0" stroke-width="1.5"/>
  <text x="405" y="72" fill="#4ec9b0" text-anchor="middle" font-weight="700" font-size="13">Layer 2: Filters</text>
  <text x="405" y="92" fill="#cccccc" text-anchor="middle" font-size="11">applyFilters()</text>

  <text x="310" y="115" fill="#9cdcfe" font-size="10">Gender (single select)</text>
  <text x="310" y="130" fill="#9cdcfe" font-size="10">Accents (OR within)</text>
  <text x="310" y="145" fill="#9cdcfe" font-size="10">Styles (OR within)</text>
  <text x="310" y="160" fill="#9cdcfe" font-size="10">Providers (OR within)</text>
  <text x="310" y="178" fill="#858585" font-size="10">AND between categories</text>

  <!-- Arrow 2->3 -->
  <line x1="520" y1="120" x2="550" y2="120" stroke="#4ec9b0" stroke-width="2" marker-end="url(#srR)"/>

  <!-- Layer 3: Mood filters -->
  <rect x="550" y="50" width="220" height="140" rx="6" fill="#252526" stroke="#ce9178" stroke-width="1.5"/>
  <text x="660" y="72" fill="#ce9178" text-anchor="middle" font-weight="700" font-size="13">Layer 3: Mood</text>
  <text x="660" y="92" fill="#cccccc" text-anchor="middle" font-size="11">applyMoodFilters()</text>

  <text x="570" y="115" fill="#9cdcfe" font-size="10">Warm: natural + warm/soft</text>
  <text x="570" y="130" fill="#9cdcfe" font-size="10">Calm: natural|whisper + calm</text>
  <text x="570" y="145" fill="#9cdcfe" font-size="10">Bright: expressive + bright</text>
  <text x="570" y="160" fill="#9cdcfe" font-size="10">Deep: male + deep/bass</text>
  <text x="570" y="178" fill="#858585" font-size="10">AND between selected moods</text>

  <!-- Scoring detail box -->
  <rect x="30" y="210" width="740" height="80" rx="6" fill="#252526" stroke="#3c3c3c"/>
  <text x="400" y="232" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="13">Fuzzy Scoring Algorithm (termScore)</text>
  <text x="50" y="255" fill="#9cdcfe" font-size="11">Exact match: 3.0   |   Starts with: 2.5   |   Contains (position-weighted): 2.0 - 0.01*idx   |   Word-start: 1.5   |   No match: 0</text>
  <text x="50" y="275" fill="#858585" font-size="10">Any term with zero score incurs a -1 penalty. Entries with total score less-than-or-equal-to 0 are excluded. Results sorted descending by score.</text>

  <!-- Voice-to-search box -->
  <rect x="30" y="310" width="360" height="75" rx="6" fill="#252526" stroke="#dcdcaa" stroke-width="1.5"/>
  <text x="210" y="332" fill="#dcdcaa" text-anchor="middle" font-weight="700" font-size="13">Voice-to-Search (SearchBar)</text>
  <text x="50" y="352" fill="#9cdcfe" font-size="10">Browser Web Speech API (SpeechRecognition)</text>
  <text x="50" y="367" fill="#9cdcfe" font-size="10">Mic toggle in SearchBar, one-shot mode</text>
  <text x="50" y="382" fill="#858585" font-size="10">Transcript feeds into fuzzy search pipeline</text>

  <!-- Autocomplete box -->
  <rect x="410" y="310" width="360" height="75" rx="6" fill="#252526" stroke="#dcdcaa" stroke-width="1.5"/>
  <text x="590" y="332" fill="#dcdcaa" text-anchor="middle" font-weight="700" font-size="13">Autocomplete Dropdown</text>
  <text x="430" y="352" fill="#9cdcfe" font-size="10">Section 1: Recent searches (top 3 matching)</text>
  <text x="430" y="367" fill="#9cdcfe" font-size="10">Section 2: Voice name matches (top 5)</text>
  <text x="430" y="382" fill="#9cdcfe" font-size="10">Section 3: Accent suggestion</text>
</svg>

### Filter Counts

The `getFilterCounts()` function computes live counts for each filter value. For each category, it applies all other current filters except the one being counted, then counts how many voices match each value. This powers the "(23)" badges on filter chips.

### Saved Searches

Users can save the current search query + active filter state as a named preset. These are persisted in globalState (`kilocode.voiceSavedSearches`) and can be restored or deleted from the UI.

---

## 7. VPS Infrastructure

The Voice Studio's Store tab relies on a VPS running Docker containers that serve the voice model catalog and preview system.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 500" style="max-width:860px;font-family:Segoe UI,system-ui,sans-serif;font-size:12px">
  <rect width="860" height="500" fill="#1e1e1e" rx="8"/>

  <defs>
    <marker id="vpR" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6" fill="#569cd6"/>
    </marker>
    <marker id="vpL" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M8,0 L0,3 L8,6" fill="#4ec9b0"/>
    </marker>
  </defs>

  <text x="430" y="28" fill="#cccccc" text-anchor="middle" font-weight="700" font-size="16">VPS Architecture (voice.daveai.tech)</text>

  <!-- Internet / Client -->
  <rect x="30" y="55" width="180" height="80" rx="6" fill="#264f78" stroke="#569cd6" stroke-width="1.5"/>
  <text x="120" y="78" fill="#ffffff" text-anchor="middle" font-weight="600" font-size="13">VS Code Extension</text>
  <text x="120" y="98" fill="#9cdcfe" text-anchor="middle" font-size="10">VoiceStudioProvider</text>
  <text x="120" y="115" fill="#858585" text-anchor="middle" font-size="10">httpGet / httpPost</text>

  <!-- Arrow to nginx -->
  <line x1="210" y1="95" x2="280" y2="95" stroke="#569cd6" stroke-width="2" marker-end="url(#vpR)"/>
  <text x="245" y="88" fill="#569cd6" text-anchor="middle" font-size="9">HTTPS</text>

  <!-- Nginx -->
  <rect x="280" y="55" width="150" height="80" rx="6" fill="#252526" stroke="#4ec9b0" stroke-width="1.5"/>
  <text x="355" y="78" fill="#4ec9b0" text-anchor="middle" font-weight="600" font-size="13">nginx</text>
  <text x="355" y="96" fill="#9cdcfe" text-anchor="middle" font-size="10">TLS termination</text>
  <text x="355" y="112" fill="#9cdcfe" text-anchor="middle" font-size="10">Reverse proxy</text>
  <text x="355" y="126" fill="#858585" text-anchor="middle" font-size="9">voice.daveai.tech:443</text>

  <!-- Docker host box -->
  <rect x="470" y="42" width="370" height="440" rx="8" fill="#1b1b1b" stroke="#3c3c3c" stroke-width="1.5"/>
  <text x="655" y="65" fill="#858585" text-anchor="middle" font-size="11">Docker Host</text>

  <!-- Container 1: edge-tts-server -->
  <rect x="490" y="80" width="330" height="130" rx="6" fill="#252526" stroke="#ce9178" stroke-width="1.5"/>
  <text x="655" y="102" fill="#ce9178" text-anchor="middle" font-weight="600" font-size="13">edge-tts-server container</text>
  <text x="655" y="120" fill="#858585" text-anchor="middle" font-size="10">ghcr.io/ghenghis/kilocode-rvc:latest</text>

  <text x="510" y="142" fill="#9cdcfe" font-size="10">GET  /health         --> container health</text>
  <text x="510" y="157" fill="#9cdcfe" font-size="10">GET  /api/voices     --> installed voice list</text>
  <text x="510" y="172" fill="#9cdcfe" font-size="10">POST /synthesize     --> RVC + edge-tts synthesis</text>
  <text x="510" y="187" fill="#9cdcfe" font-size="10">Volume: /models/*.pth (voice model files)</text>

  <!-- Arrow nginx to edge-tts -->
  <line x1="430" y1="85" x2="490" y2="120" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#vpR)"/>
  <text x="445" y="95" fill="#858585" font-size="9">:5050</text>

  <!-- Container 2: model-server -->
  <rect x="490" y="230" width="330" height="130" rx="6" fill="#252526" stroke="#dcdcaa" stroke-width="1.5"/>
  <text x="655" y="252" fill="#dcdcaa" text-anchor="middle" font-weight="600" font-size="13">model-server (catalog API)</text>

  <text x="510" y="275" fill="#9cdcfe" font-size="10">GET  /api/catalog        --> full catalog JSON</text>
  <text x="510" y="290" fill="#9cdcfe" font-size="10">POST /api/preview        --> on-demand synthesis</text>
  <text x="510" y="305" fill="#9cdcfe" font-size="10">POST /api/catalog/rebuild --> regenerate catalog</text>
  <text x="510" y="320" fill="#9cdcfe" font-size="10">GET  /api/disk           --> usage stats</text>
  <text x="510" y="340" fill="#858585" font-size="10">Volume: /opt/rvc-models/ (models + previews)</text>

  <!-- Arrow nginx to model-server -->
  <line x1="430" y1="105" x2="490" y2="280" stroke="#4ec9b0" stroke-width="1.5" marker-end="url(#vpR)"/>
  <text x="445" y="195" fill="#858585" font-size="9">/api/*</text>

  <!-- Catalog system box -->
  <rect x="490" y="380" width="330" height="85" rx="6" fill="#2d2d30" stroke="#3c3c3c"/>
  <text x="655" y="400" fill="#cccccc" text-anchor="middle" font-weight="600" font-size="12">Catalog System</text>
  <text x="510" y="420" fill="#9cdcfe" font-size="10">build-catalog.py: scans /opt/rvc-models/models/</text>
  <text x="510" y="435" fill="#9cdcfe" font-size="10">  reads model-metadata.json overrides</text>
  <text x="510" y="450" fill="#9cdcfe" font-size="10">  writes catalog.json with full voice metadata</text>

  <!-- Connection from catalog to model-server -->
  <line x1="655" y1="380" x2="655" y2="360" stroke="#464646" stroke-width="1" stroke-dasharray="4,3"/>

  <!-- Preview generation box -->
  <rect x="30" y="200" width="220" height="90" rx="6" fill="#252526" stroke="#ce9178"/>
  <text x="140" y="222" fill="#ce9178" text-anchor="middle" font-weight="600" font-size="12">Preview Generation</text>
  <text x="50" y="242" fill="#9cdcfe" font-size="10">generate-previews.sh</text>
  <text x="50" y="258" fill="#858585" font-size="10">Per model: edge-tts --> 64kbps MP3</text>
  <text x="50" y="274" fill="#858585" font-size="10">Output: /opt/rvc-models/previews/</text>

  <!-- Disk budget box -->
  <rect x="30" y="310" width="220" height="70" rx="6" fill="#252526" stroke="#dcdcaa"/>
  <text x="140" y="332" fill="#dcdcaa" text-anchor="middle" font-weight="600" font-size="12">Disk Budget</text>
  <text x="50" y="352" fill="#9cdcfe" font-size="10">100 GB cap enforced by VPS</text>
  <text x="50" y="368" fill="#9cdcfe" font-size="10">DiskUsage: { usedBytes, maxBytes, modelCount }</text>

  <!-- Download flow note -->
  <rect x="30" y="400" width="420" height="70" rx="6" fill="#252526" stroke="#569cd6"/>
  <text x="240" y="420" fill="#569cd6" text-anchor="middle" font-weight="600" font-size="12">Download Flow (Extension-side)</text>
  <text x="50" y="440" fill="#9cdcfe" font-size="10">1. HTTP GET model URL --> stream to temp file with progress callbacks</text>
  <text x="50" y="455" fill="#9cdcfe" font-size="10">2. docker cp tmpFile edge-tts-server:/models/name.pth</text>
  <text x="50" y="468" fill="#858585" font-size="10">AbortController allows cancel at any point. Temp file cleaned up on complete/fail.</text>
</svg>

### API Endpoints Summary

| Endpoint | Method | Source | Purpose |
|---|---|---|---|
| `/health` | GET | Docker :5050 | Container health check |
| `/api/voices` | GET | Docker :5050 | List installed RVC voice models |
| `/synthesize` | POST | Docker :5050 | Edge-TTS + RVC synthesis |
| `/api/catalog` | GET | VPS model-server | Full voice catalog with metadata |
| `/api/preview` | POST | VPS model-server | On-demand voice preview synthesis |
| `/api/catalog/rebuild` | POST | VPS model-server | Trigger catalog regeneration |
| `/api/disk` | GET | VPS model-server | Disk usage statistics |

### Catalog Schema

The catalog JSON response follows the `VoiceCatalogResponse` interface:

```typescript
interface VoiceCatalogResponse {
  version: number
  generatedAt: string
  totalModels: number
  totalSizeBytes: number
  voices: StoreVoiceEntry[]  // each with id, name, gender, accent, style, quality, tags, downloadUrl, heroClipUrl, etc.
}
```

### Download Lifecycle

1. Webview sends `downloadModel { modelId, url, name }`
2. Provider creates `AbortController`, stores in `downloads` Map
3. Provider streams HTTP GET to temp file, fires `downloadProgress` messages on each chunk
4. On completion: `docker cp` temp file to `edge-tts-server:/models/name.pth`
5. Provider sends `downloadComplete { modelId, success: true }`
6. Webview automatically sends `fetchVoiceLibrary` to refresh the Library tab
7. On panel dispose: all in-flight downloads are aborted via their AbortControllers
