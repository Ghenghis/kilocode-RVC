#!/usr/bin/env bash
# generate-previews.sh — Synthesize hero preview clips for every voice in the catalog.
#
# Uses edge-tts CLI to generate a short MP3 clip for each voice ID found in
# catalog.json.  Existing previews (>1000 bytes) are skipped.
#
# Usage:
#   ./generate-previews.sh [catalog.json] [previews_dir]
#
# Defaults:
#   catalog.json  → same directory as this script / catalog.json
#   previews_dir  → /opt/rvc-models/previews

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG_FILE="${1:-${SCRIPT_DIR}/catalog.json}"
PREVIEWS_DIR="${2:-/opt/rvc-models/previews}"
EDGE_TTS_VOICE="en-US-AriaNeural"
PREVIEW_TEXT="Hello, I'm your voice assistant. How can I help you today?"

# ---------- helpers ----------

log()  { printf "[previews] %s\n" "$*"; }
fail() { printf "[previews] ERROR: %s\n" "$*" >&2; exit 1; }

# ---------- preflight ----------

# Ensure edge-tts is available; install if missing
if ! command -v edge-tts &>/dev/null; then
    log "edge-tts not found — installing via pip..."
    pip3 install edge-tts || pip install edge-tts || fail "Could not install edge-tts"
    # Verify it's now available
    command -v edge-tts &>/dev/null || fail "edge-tts installed but not on PATH"
    log "edge-tts installed successfully."
fi

# Ensure jq is available (needed to parse catalog.json)
if ! command -v jq &>/dev/null; then
    fail "jq is required but not installed. Install it with: apt-get install -y jq"
fi

# Validate catalog file
if [[ ! -f "$CATALOG_FILE" ]]; then
    fail "Catalog file not found: $CATALOG_FILE"
fi

# Create previews directory
mkdir -p "$PREVIEWS_DIR"

# ---------- main ----------

# Extract voice IDs from catalog
VOICE_IDS=()
while IFS= read -r vid; do
    VOICE_IDS+=("$vid")
done < <(jq -r '.voices[].id' "$CATALOG_FILE")

TOTAL=${#VOICE_IDS[@]}
if [[ "$TOTAL" -eq 0 ]]; then
    fail "No voices found in $CATALOG_FILE"
fi

log "Found $TOTAL voices in catalog."
log "Previews directory: $PREVIEWS_DIR"
log "TTS voice: $EDGE_TTS_VOICE"
log ""

GENERATED=0
SKIPPED=0
FAILED=0

for i in "${!VOICE_IDS[@]}"; do
    vid="${VOICE_IDS[$i]}"
    num=$((i + 1))
    outfile="${PREVIEWS_DIR}/${vid}.mp3"

    # Skip if preview already exists and is large enough
    if [[ -f "$outfile" ]] && [[ "$(stat -c%s "$outfile" 2>/dev/null || stat -f%z "$outfile" 2>/dev/null || echo 0)" -gt 1000 ]]; then
        log "[$num/$TOTAL] SKIP  $vid (preview exists)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    log "[$num/$TOTAL] GEN   $vid"

    if edge-tts --voice "$EDGE_TTS_VOICE" --text "$PREVIEW_TEXT" --write-media "$outfile" 2>/dev/null; then
        # Verify the output is usable
        fsize="$(stat -c%s "$outfile" 2>/dev/null || stat -f%z "$outfile" 2>/dev/null || echo 0)"
        if [[ "$fsize" -gt 1000 ]]; then
            GENERATED=$((GENERATED + 1))
        else
            log "  WARNING: output too small (${fsize} bytes), removing"
            rm -f "$outfile"
            FAILED=$((FAILED + 1))
        fi
    else
        log "  WARNING: edge-tts failed for $vid"
        rm -f "$outfile"
        FAILED=$((FAILED + 1))
    fi
done

# ---------- summary ----------

log ""
log "===== Preview Generation Summary ====="
log "  Total voices:  $TOTAL"
log "  Generated:     $GENERATED"
log "  Skipped:       $SKIPPED"
log "  Failed:        $FAILED"
log "  Directory:     $PREVIEWS_DIR"
log "======================================="

if [[ "$FAILED" -gt 0 ]]; then
    log "Some previews failed. Re-run to retry."
    exit 1
fi

exit 0
