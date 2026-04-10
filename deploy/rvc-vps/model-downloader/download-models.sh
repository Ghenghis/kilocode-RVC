#!/usr/bin/env bash
#
# Download pretrained RVC base models from HuggingFace.
# These are the inference backbone models needed for RVC voice conversion,
# not individual user voice clones.
#
# Usage: ./download-models.sh [target_dir]
#   target_dir defaults to ../models (relative to this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-${SCRIPT_DIR}/../models}"
mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo "============================================"
echo "  RVC Model Downloader"
echo "  Target: $TARGET_DIR"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# Helper: download a file from HuggingFace with resume support
# ---------------------------------------------------------------------------
download_hf_file() {
    local repo="$1"       # e.g. lj1995/VoiceConversionWebUI
    local filepath="$2"   # e.g. pretrained_v2/f0G48k.pth
    local outname="$3"    # local filename to save as
    local subdir="${4:-}" # optional subdirectory under TARGET_DIR

    local dest_dir="$TARGET_DIR"
    if [[ -n "$subdir" ]]; then
        dest_dir="$TARGET_DIR/$subdir"
        mkdir -p "$dest_dir"
    fi

    local dest="$dest_dir/$outname"

    if [[ -f "$dest" ]]; then
        echo "[SKIP] $outname already exists ($(du -h "$dest" | cut -f1))"
        return 0
    fi

    local url="https://huggingface.co/${repo}/resolve/main/${filepath}"
    echo "[DOWN] $outname"
    echo "       <- $url"

    # Use curl with resume support (-C -), follow redirects, show progress
    if curl -L -C - --retry 3 --retry-delay 5 \
        -o "$dest" \
        --progress-bar \
        "$url"; then
        echo "[DONE] $outname ($(du -h "$dest" | cut -f1))"
    else
        echo "[FAIL] $outname -- download failed"
        rm -f "$dest"
        return 1
    fi
    echo ""
}

# ---------------------------------------------------------------------------
# 1. RVC pretrained v2 models from lj1995/VoiceConversionWebUI
#    These are the generator (G) and discriminator (D) base models
#    used during RVC inference for voice conversion.
# ---------------------------------------------------------------------------
echo "--- RVC Pretrained v2 Base Models (lj1995/VoiceConversionWebUI) ---"
echo ""

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0G48k.pth" \
    "f0G48k.pth" \
    "pretrained_v2"

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0D48k.pth" \
    "f0D48k.pth" \
    "pretrained_v2"

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0G40k.pth" \
    "f0G40k.pth" \
    "pretrained_v2"

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0D40k.pth" \
    "f0D40k.pth" \
    "pretrained_v2"

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0G32k.pth" \
    "f0G32k.pth" \
    "pretrained_v2"

download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "pretrained_v2/f0D32k.pth" \
    "f0D32k.pth" \
    "pretrained_v2"

# Hubert base model -- required for feature extraction in RVC inference
download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "hubert_base.pt" \
    "hubert_base.pt" \
    ""

# RMVPE pitch extraction model
download_hf_file \
    "lj1995/VoiceConversionWebUI" \
    "rmvpe.pt" \
    "rmvpe.pt" \
    ""

# ---------------------------------------------------------------------------
# 2. Applio pretrained models from IAHispano/Applio
#    Applio is a popular RVC fork with improved pretrained models.
# ---------------------------------------------------------------------------
echo ""
echo "--- Applio Pretrained Models (IAHispano/Applio) ---"
echo ""

download_hf_file \
    "IAHispano/Applio" \
    "rvc/pretraineds/pretrained_v2/f0G48k.pth" \
    "f0G48k.pth" \
    "applio_pretrained_v2"

download_hf_file \
    "IAHispano/Applio" \
    "rvc/pretraineds/pretrained_v2/f0D48k.pth" \
    "f0D48k.pth" \
    "applio_pretrained_v2"

download_hf_file \
    "IAHispano/Applio" \
    "rvc/pretraineds/pretrained_v2/f0G40k.pth" \
    "f0G40k.pth" \
    "applio_pretrained_v2"

download_hf_file \
    "IAHispano/Applio" \
    "rvc/pretraineds/pretrained_v2/f0D40k.pth" \
    "f0D40k.pth" \
    "applio_pretrained_v2"

echo ""
echo "============================================"
echo "  Download complete!"
echo "  Models directory: $TARGET_DIR"
echo "============================================"
echo ""
du -sh "$TARGET_DIR"/* 2>/dev/null || echo "(no files yet)"
echo ""
echo "Total:"
du -sh "$TARGET_DIR"
