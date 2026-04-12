# Voice Studio Testing Guide

> Complete testing strategy: 3 audit types × 6 layers = 18 audit checkpoints.

## Test Infrastructure

| Tool | Purpose | Command |
|------|---------|---------|
| Vitest | Unit tests | `npx vitest run` from `packages/kilo-vscode` |
| TypeScript | Type checking | `npx tsc --noEmit` |
| esbuild | Build verification | `npm run build` |
| Manual | E2E feature verification | See checklists below |

## Test Files

| File | Covers | Tests |
|------|--------|-------|
| `tests/unit/voice-types.test.ts` | Voice data types, constants, defaults | 4 |
| `tests/unit/voice-search.test.ts` | Fuzzy search, filters, autocomplete | 39 |
| `tests/unit/voice-messages.test.ts` | Message type definitions, unions | 48 |
| `tests/unit/voice-studio-provider.test.ts` | VoiceStudioProvider handlers | 25+ |
| `tests/unit/voice-studio-components.test.ts` | UI components and hooks | 20+ |

### Running Tests

```bash
# All Voice Studio tests
cd packages/kilo-vscode
npx vitest run tests/unit/voice-types.test.ts
npx vitest run tests/unit/voice-search.test.ts
npx vitest run tests/unit/voice-messages.test.ts
npx vitest run tests/unit/voice-studio-provider.test.ts
npx vitest run tests/unit/voice-studio-components.test.ts

# All unit tests at once
npx vitest run tests/unit/voice-*.test.ts

# Watch mode during development
npx vitest watch tests/unit/voice-*.test.ts
```

## Audit Type 1: Code Completeness (6 Layers)

Every file audited for completeness — no stubs, no TODOs, no dead code.

### Layer 1: Component Audit

| Component | File | Checks |
|-----------|------|--------|
| SearchBar | `voice-studio/components/SearchBar.tsx` | Renders without errors, all props used, debounce works, mic button functional |
| FilterBar | `voice-studio/components/FilterBar.tsx` | All filter categories rendered, live counts update, clear works |
| VoiceCard | `voice-studio/components/VoiceCard.tsx` | All VoiceEntry fields displayed, buttons clickable, states correct |
| VoiceRow | `voice-studio/components/VoiceRow.tsx` | Same fields as card, row layout, sortable columns |
| AudioPlayer | `voice-studio/components/AudioPlayer.tsx` | Progress bar, time display, play/pause/stop |
| TagChip | `voice-studio/components/TagChip.tsx` | Label, count, active state, dismiss button |
| ViewToggle | `voice-studio/components/ViewToggle.tsx` | Grid/list icons, active state |
| VoiceAvatar | `voice-studio/components/VoiceAvatar.tsx` | Provider letter, gender color |
| LibraryTab | `voice-studio/tabs/LibraryTab.tsx` | Sub-tabs, combined search, now playing, empty states |
| StoreTab | `voice-studio/tabs/StoreTab.tsx` | Pagination, download queue, disk usage, refresh |
| App | `voice-studio/App.tsx` | All signals initialized, all messages handled, refresh button |

**Pass criteria:** Every component renders without errors, every prop is consumed, no `// TODO` or stub functions.

### Layer 2: Message Audit

| Direction | Count | Verification |
|-----------|-------|-------------|
| Webview → Extension | 15 | Every message type has a handler in VoiceStudioProvider.onMessage() |
| Extension → Webview | 12 | Every message type has a case in App.tsx onMessage() |

**Messages (webview → extension):**

| Message | Handler | Verified |
|---------|---------|----------|
| requestVoiceStudioState | handleRequestState | ✓ |
| fetchVoiceLibrary | handleFetchVoiceLibrary | ✓ |
| fetchStoreModels | handleFetchStoreModels | ✓ |
| previewStoreVoice | handlePreviewStoreVoice | ✓ |
| downloadModel | handleDownloadModel | ✓ |
| cancelDownload | handleCancelDownload | ✓ |
| deleteModel | handleDeleteModel | ✓ |
| toggleFavorite | handleToggleFavorite | ✓ |
| setActiveVoice | handleSetActiveVoice | ✓ |
| saveSearch | handleSaveSearch | ✓ |
| deleteSavedSearch | handleDeleteSavedSearch | ✓ |
| switchInteractionMode | handleSwitchInteractionMode | ✓ |
| voiceCommand | handleVoiceCommand | ✓ |
| refreshStoreCatalog | handleRefreshStoreCatalog | ✓ |
| openVoiceStudio | KiloProvider → vscode.commands | ✓ |

**Messages (extension → webview):**

| Message | Handler in App.tsx | Verified |
|---------|-------------------|----------|
| voiceStudioState | Sets all state signals | ✓ |
| voiceLibraryLoaded | Maps voices, sets loading | ✓ |
| storeModelsLoaded | Maps store voices, disk usage | ✓ |
| downloadProgress | Updates downloadJobs map | ✓ |
| downloadComplete | Removes job, refreshes library | ✓ |
| downloadFailed | Sets job status to failed | ✓ |
| previewAudioReady | Plays audio from base64 | ✓ |
| voiceCommandAck | Acknowledged | ✓ |
| interactionModeChanged | Updates signal | ✓ |
| diskUsage | Updates disk usage signal | ✓ |
| favoritesUpdated | Updates favorites + voice entries | ✓ |
| activeVoiceSet | Updates active voice id | ✓ |
| savedSearchesUpdated | Updates saved searches | ✓ |
| modelDeleted | Refreshes library on success | ✓ |

**Pass criteria:** Every message type has both a sender and a handler. No orphan messages.

### Layer 3: State Audit

| Signal | Initialized | Updated By | Cleaned Up |
|--------|-------------|------------|------------|
| activeTab | "library" | Tab click | N/A |
| searchQuery | "" | SearchBar input | N/A |
| viewMode | "grid" | ViewToggle click | N/A |
| filters | DEFAULT_FILTERS | FilterBar changes | N/A |
| voices | [] | voiceLibraryLoaded | N/A |
| storeVoices | [] | storeModelsLoaded | N/A |
| diskUsage | null | storeModelsLoaded, diskUsage | N/A |
| downloadJobs | new Map() | downloadProgress, downloadComplete, downloadFailed | N/A |
| favorites | [] | voiceStudioState, favoritesUpdated | N/A |
| recentSearches | [] | voiceStudioState | N/A |
| savedSearches | [] | voiceStudioState, savedSearchesUpdated | N/A |
| interactionMode | "silent" | voiceStudioState, interactionModeChanged | N/A |
| activeVoiceId | null | voiceStudioState, activeVoiceSet | N/A |
| refreshing | false | handleRefreshCatalog, storeModelsLoaded | N/A |
| libraryLoading | true | voiceLibraryLoaded | N/A |
| storeLoading | true | storeModelsLoaded | N/A |
| playingVoiceId | null | playAudioFromBase64, stopAudio | onCleanup |
| playerTime | 0 | audioTimer interval | onCleanup |
| playerDuration | 0 | audio.onloadedmetadata | onCleanup |

**Pass criteria:** Every signal has an initializer, at least one updater, and cleanup where needed.

### Layer 4: i18n Audit

| Category | Key Count | Location |
|----------|-----------|----------|
| Tabs | 2 | settings.speech.voiceStudio.tabs.* |
| Library | 8 | settings.speech.voiceStudio.library.* |
| Store | 11 | settings.speech.voiceStudio.store.* |
| Search | 5 | settings.speech.voiceStudio.search.* |
| Filters | 12 | settings.speech.voiceStudio.filters.* |
| Moods | 6 | settings.speech.voiceStudio.moods.* |
| Voice card/row | 10 | settings.speech.voiceStudio.voice.* |
| Downloads | 8 | settings.speech.voiceStudio.downloads.* |
| Interaction modes | 6 | settings.speech.voiceStudio.interaction.* |
| Voice commands | 7 | settings.speech.voiceStudio.commands.* |
| View toggles | 2 | settings.speech.voiceStudio.view.* |
| **Total** | **99** | |

**Pass criteria:** Every user-visible string uses `t()`. Every `t()` key exists in `en.ts`.

### Layer 5: Config Audit

| Setting | Key | Type | Default | UI Control |
|---------|-----|------|---------|------------|
| Interaction Mode | kilo-code.new.speech.interactionMode | enum | "silent" | SpeechTab dropdown |
| Open Voice Studio | command: kilo-code.new.openVoiceStudio | — | — | SpeechTab button, command palette |
| Switch Voice | command: kilo-code.new.switchVoice | — | — | Ctrl+Shift+Alt+V, command palette |

**Pass criteria:** Every package.json setting has both a reader and a UI control.

### Layer 6: Style Audit

**Pass criteria:**
- All colors use `var(--vscode-*)` tokens — no hardcoded hex/rgb values
- Layout is responsive (CSS grid with `auto-fill minmax`)
- All interactive elements have hover/focus states
- Spinner animation uses CSS `@keyframes`
- Font family and size use VS Code variables

## Audit Type 2: Integration (6 Layers)

### Layer 1: Webview ↔ Extension

| Flow | Test |
|------|------|
| Panel opens | requestVoiceStudioState sent, state received |
| Library loads | fetchVoiceLibrary → voiceLibraryLoaded |
| Store loads | fetchStoreModels → storeModelsLoaded |
| Favorite toggle | toggleFavorite → favoritesUpdated → voice cards re-render |
| Set active | setActiveVoice → activeVoiceSet → config updated |
| Save search | saveSearch → savedSearchesUpdated |
| Interaction mode | switchInteractionMode → interactionModeChanged |
| Refresh catalog | refreshStoreCatalog → catalog/rebuild → storeModelsLoaded |

### Layer 2: Extension ↔ Docker

| Flow | Test |
|------|------|
| Voice list | GET http://127.0.0.1:5050/api/voices → voice array |
| Synthesis | POST /synthesize → audio/mpeg blob |
| Model install | docker cp file → /models/ |
| Model delete | docker exec rm → file removed |
| Health check | GET /health → status: ok |

### Layer 3: Extension ↔ VPS

| Flow | Test |
|------|------|
| Catalog fetch | GET https://voice.daveai.tech/api/catalog → catalog JSON |
| Preview fetch | GET /api/preview/{id}.mp3 → audio stream |
| Custom preview | POST /api/preview → synthesized audio |
| Catalog rebuild | POST /api/catalog/rebuild → success + voiceCount |
| Disk usage | GET /api/disk → usedBytes/maxBytes/modelCount |
| Download | GET /models/{name} → chunked transfer with Content-Length |

### Layer 4: State Persistence

| State | Storage | Survives Restart |
|-------|---------|-----------------|
| Favorites | globalState.voiceFavorites | ✓ |
| History | globalState.voiceHistory | ✓ |
| Recent searches | globalState.voiceRecentSearches | ✓ |
| Saved searches | globalState.voiceSavedSearches | ✓ |
| Interaction mode | globalState.voiceInteractionMode | ✓ |
| Active voice | workspace config (per provider) | ✓ |

### Layer 5: Provider Switching

| Scenario | Test |
|----------|------|
| Set RVC voice | Config kilo-code.new.speech.rvc.voiceId updated |
| Set Azure voice | Config kilo-code.new.speech.azure.voiceId updated |
| Set Browser voice | Config kilo-code.new.speech.browser.voiceURI updated |
| Voice appears in history | globalState.voiceHistory updated with timestamp |
| Library reflects active | Active voice indicated in Library tab |

### Layer 6: Search Pipeline

| Stage | Test |
|-------|------|
| Fuzzy search | "luna" matches "Lunar Studio" (name 10x weight) |
| Filter: gender | Female filter → only female voices |
| Filter: accent | en-GB filter → only British voices |
| Filter: mood | "Warm" → natural style + warm/soft tags |
| Combined | Search "studio" + Gender: Female → Lunar Studio only |
| Autocomplete | Typing "ar" shows Ariana Grande in dropdown |
| Saved search | Save "Female natural" → restore filters and query |

## Audit Type 3: E2E Feature (6 Layers)

### Layer 1: Library Flow

```
1. Open Voice Studio (command palette or settings button)
2. Library tab loads → voices displayed in grid
3. Toggle to list view → voices displayed as rows
4. Type "whisper" in search → results narrow
5. Click Gender: Female chip → further narrow
6. Click favorite star on a voice → star fills
7. Click "Favorites" sub-tab → only starred voice shown
8. Click "Set Active" → voice becomes active
9. Verify speech settings updated in VS Code config
```

### Layer 2: Store Flow

```
1. Click Store tab → models load from VPS
2. Disk usage bar shows 22.1 GB / 100 GB
3. Card grid displays model cards
4. Click hero clip button → audio plays
5. Click custom preview → input appears → type text → hear preview
6. Click download → progress ring fills → "Installed" badge appears
7. Click Refresh button → spinner → catalog rebuilds → models refresh
8. Switch to Library tab → downloaded model appears
```

### Layer 3: Search Flow

```
1. Type "warm female" → fuzzy results appear
2. Autocomplete dropdown shows matching voices
3. Select "Lunar Studio" from dropdown → search updates
4. Add filter: Quality ≥ 4 → results narrow
5. Click "Save Search" → name it "My favorites query"
6. Clear search → all voices shown
7. Click saved search → filters and query restored
8. Delete saved search → removed from list
```

### Layer 4: Download Flow

```
1. In Store tab, click Download on a model
2. Download queue bar appears at bottom
3. Progress ring fills with percentage
4. Click Cancel → download stops, queue item removed
5. Download another model → completes → "Installed" badge
6. Switch to Library → new model visible
7. Right-click delete model → removed from library
```

### Layer 5: Settings Flow

```
1. Change provider in SpeechTab → Voice Studio Library updates
2. Click "Open Voice Studio" in SpeechTab → panel opens
3. Change interaction mode in SpeechTab → Studio reflects change
4. Set voice in Studio → SpeechTab config updates
5. Close Studio → reopen → state persisted (favorites, mode)
```

### Layer 6: Interaction Modes

```
1. Select "Silent" → no audio, no listening
2. Select "Assist" → responses auto-speak, manual commands only
3. Select "Hands-Free" → continuous listening active
4. Say "switch to Lunar Studio" → voice changes
5. Say "slower" → speech rate decreases
6. Say "stop" → current speech stops
7. Say "hands free off" → mode switches to Assist
```

## Debugging

### Structured Logging

All Voice Studio operations log to the **KiloCode Voice Studio** output channel with namespaced prefixes:

| Namespace | Covers |
|-----------|--------|
| `[Panel]` | Panel lifecycle (create, dispose) |
| `[Message]` | All incoming messages |
| `[Library]` | Voice library fetch, favorites, history, delete |
| `[Store]` | Catalog fetch, rebuild, refresh |
| `[Download]` | Download start, progress milestones (25/50/75%), complete, cancel, fail |
| `[Search]` | Saved search operations |
| `[Command]` | Voice commands, interaction mode changes |

### Viewing Logs

1. Open VS Code Output panel (`Ctrl+Shift+U`)
2. Select **KiloCode Voice Studio** from the dropdown
3. All operations are timestamped and prefixed

### Common Debug Scenarios

| Issue | What to Check |
|-------|---------------|
| Store shows no models | Check `[Store]` logs for HTTP errors. Verify VPS is reachable |
| Download stuck | Check `[Download]` logs for progress updates. Look for HTTP errors |
| Favorites not persisting | Check `[Library]` logs for globalState update calls |
| Voice command not working | Check `[Command]` logs for transcript. Verify interaction mode is "handsfree" |
| Catalog rebuild fails | Check VPS logs: `docker logs edge-tts-server --tail 50` |
| Preview won't play | Check `[Store]` logs for previewAudioReady. Check CSP allows media-src |
