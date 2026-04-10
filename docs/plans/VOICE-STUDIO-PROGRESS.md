# Voice Studio Implementation Progress

> **Resume Point:** If session restarts, read this file first to know exactly where to pick up.

## Quick Status

| Phase | Status | Tasks | Notes |
|-------|--------|-------|-------|
| Phase 1: Data Foundation | NOT STARTED | 1-3 | Types, search engine, messages |
| Phase 2: VPS Catalog | NOT STARTED | 4-7 | Metadata, catalog builder, previews, server endpoints |
| Phase 3: Extension Panel | NOT STARTED | 8-10 | VoiceStudioProvider, commands, esbuild |
| Phase 4: Webview UI | NOT STARTED | 11-16 | App shell, components, Library, Store, voice search, hands-free |
| Phase 5: SpeechTab Simplify | NOT STARTED | 17 | Slim down, add Studio button |
| Phase 6: i18n | NOT STARTED | 18 | All Voice Studio keys |
| Phase 7: VPS Deploy | NOT STARTED | 19 | Catalog + previews to VPS |
| Phase 8: Testing & Audits | NOT STARTED | 20-23 | Unit tests, 3 audits x 6 layers |
| Phase 9: Documentation | NOT STARTED | 24-30 | 6 docs + final build |

## Current Task

**Task:** None started yet
**Branch:** speech-clean
**Last Commit:** d305c7c

## Key File Paths

### Source Files (to create/modify)
- `packages/kilo-vscode/webview-ui/src/types/voice.ts` — voice data types
- `packages/kilo-vscode/webview-ui/src/utils/voice-search.ts` — search engine
- `packages/kilo-vscode/webview-ui/src/types/messages.ts` — add studio messages
- `packages/kilo-vscode/src/VoiceStudioProvider.ts` — panel provider
- `packages/kilo-vscode/src/extension.ts` — register commands
- `packages/kilo-vscode/esbuild.js` — add entry point
- `packages/kilo-vscode/webview-ui/voice-studio/` — entire webview UI
- `packages/kilo-vscode/webview-ui/src/components/settings/SpeechTab.tsx` — simplify
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` — add keys
- `packages/kilo-vscode/package.json` — commands, keybindings, settings
- `deploy/rvc-vps/catalog/` — catalog builder, metadata, previews
- `deploy/rvc-vps/edge-tts-server/server.py` — add endpoints

### Test Files
- `packages/kilo-vscode/tests/unit/voice-types.test.ts`
- `packages/kilo-vscode/tests/unit/voice-search.test.ts`
- `packages/kilo-vscode/tests/unit/voice-messages.test.ts`
- `packages/kilo-vscode/tests/unit/voice-studio-provider.test.ts`
- `packages/kilo-vscode/tests/unit/voice-studio-components.test.ts`

### Documentation
- `docs/speech/ARCHITECTURE.md`
- `docs/speech/VOICE-STUDIO-GUIDE.md`
- `docs/speech/VPS-SETUP.md`
- `docs/speech/API-REFERENCE.md`
- `docs/speech/VOICE-CATALOG.md`
- `docs/speech/TESTING.md`

### VPS State
- SSH: root@187.77.30.206 (password in C:\Users\Admin\Downloads\VPS\env\.env.ssh)
- Models collecting at /opt/rvc-models/models/ (100GB cap, ~18GB so far)
- Edge-TTS server running on port 5050
- Model server on port 8080
- Nginx proxying voice.daveai.tech
- 165GB total disk, collecting to 100GB limit

## Design Docs
- `docs/plans/2026-04-10-voice-studio-design.md` — approved design
- `docs/plans/2026-04-10-voice-studio-gap.md` — 58 features across 10 gap categories
- `docs/plans/2026-04-10-voice-studio-plan.md` — 30-task implementation plan

## Wiring Checklist (E2E Verification)

After each phase, verify these connections:

### Phase 1 Complete Wiring Check
- [ ] voice.ts types importable from both webview and tests
- [ ] voice-search.ts functions all tested with real data shapes
- [ ] All new message interfaces added to WebviewMessage AND ExtensionMessage unions

### Phase 2 Complete Wiring Check
- [ ] model-metadata.json keys match actual directory names on VPS
- [ ] build-catalog.py produces valid JSON matching VoiceCatalogResponse type
- [ ] generate-previews.sh creates .mp3 files catalog references
- [ ] server.py /api/catalog returns data matching StoreVoiceEntry[] shape
- [ ] server.py /api/preview/{id}.mp3 streams audio
- [ ] server.py /api/preview POST synthesizes custom text
- [ ] server.py /api/disk returns usedBytes/maxBytes/modelCount

### Phase 3 Complete Wiring Check
- [ ] VoiceStudioProvider.ts handles ALL message types from Task 3
- [ ] extension.ts registers openVoiceStudio and switchVoice commands
- [ ] package.json has both commands in contributes.commands
- [ ] package.json has Ctrl+Shift+V keybinding
- [ ] package.json has interactionMode setting
- [ ] esbuild.js has voice-studio entry point
- [ ] VoiceStudioProvider.getHtmlForWebview references dist/voice-studio.js

### Phase 4 Complete Wiring Check
- [ ] voice-studio/index.tsx renders App into #root
- [ ] App.tsx sends requestVoiceStudioState on mount
- [ ] App.tsx handles all extension→webview message types
- [ ] SearchBar integrates useVoiceSearch hook
- [ ] FilterBar applies filters via combinedSearch from voice-search.ts
- [ ] VoiceCard/VoiceRow render all VoiceEntry fields
- [ ] LibraryTab sends fetchVoiceLibrary, receives voiceLibraryLoaded
- [ ] StoreTab sends fetchStoreModels, receives storeModelsLoaded
- [ ] Download button sends downloadModel, progress ring shows downloadProgress
- [ ] AudioPlayer plays from blob/base64, single-instance enforcement
- [ ] useVoiceCommands sends voiceCommand messages in handsfree mode

### Phase 5 Complete Wiring Check
- [ ] SpeechTab "Open Voice Studio" button sends openVoiceStudio
- [ ] KiloProvider handles openVoiceStudio → executes command
- [ ] Removed model browser code from SpeechTab (no dead code)

### Phase 6 Complete Wiring Check
- [ ] Every user-visible string in voice-studio/ uses t()
- [ ] Every t() key has entry in en.ts
- [ ] No hardcoded English text in any component

### Phase 7 Complete Wiring Check
- [ ] catalog.json generated on VPS with real model data
- [ ] Preview clips exist for models with heroClipUrl in catalog
- [ ] /api/catalog endpoint returns the generated catalog
- [ ] Voice Studio Store tab loads and displays catalog data

### Phase 8 Complete Wiring Check
- [ ] All unit tests pass
- [ ] Audit Type 1: 6/6 layers clean
- [ ] Audit Type 2: 6/6 layers clean
- [ ] Audit Type 3: 6/6 layers clean

### Phase 9 Complete Wiring Check
- [ ] All 6 docs written with SVG diagrams
- [ ] Full build succeeds with zero errors
- [ ] All tests pass
- [ ] VSIX packages successfully
- [ ] Installed VSIX opens Voice Studio correctly

## Task Completion Log

| Task | Description | Started | Completed | Verified | Commit |
|------|-------------|---------|-----------|----------|--------|
| 1 | Voice Data Types | | | | |
| 2 | Fuzzy Search Engine | | | | |
| 3 | Voice Studio Message Types | | | | |
| 4 | Model Metadata Mapping | | | | |
| 5 | Catalog Builder Script | | | | |
| 6 | Preview Generator Script | | | | |
| 7 | VPS Server Endpoints | | | | |
| 8 | VoiceStudioProvider | | | | |
| 9 | Commands & Keybindings | | | | |
| 10 | esbuild Entry Point | | | | |
| 11 | App Shell & Entry | | | | |
| 12 | Shared Components | | | | |
| 13 | Library Tab | | | | |
| 14 | Store Tab | | | | |
| 15 | Voice Search | | | | |
| 16 | Hands-Free Commands | | | | |
| 17 | Simplify SpeechTab | | | | |
| 18 | i18n Keys | | | | |
| 19 | VPS Catalog Deploy | | | | |
| 20 | Unit Tests | | | | |
| 21 | Audit Type 1 | | | | |
| 22 | Audit Type 2 | | | | |
| 23 | Audit Type 3 | | | | |
| 24 | ARCHITECTURE.md | | | | |
| 25 | VOICE-STUDIO-GUIDE.md | | | | |
| 26 | VPS-SETUP.md | | | | |
| 27 | API-REFERENCE.md | | | | |
| 28 | VOICE-CATALOG.md | | | | |
| 29 | TESTING.md | | | | |
| 30 | Final Build & Verify | | | | |
