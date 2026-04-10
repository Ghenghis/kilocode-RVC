#!/usr/bin/env bash
#
# Comprehensive RVC Voice Model Collector
# Downloads free/open-source voice models from HuggingFace
# Target: ~100GB of voice models for KiloCode users
#
# Usage: ./collect-voice-models.sh [target_dir]
#   target_dir defaults to ../models

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-${SCRIPT_DIR}/../models}"
mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

LOG_FILE="${TARGET_DIR}/../collection-progress.log"
MAX_SIZE_GB=100

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Check if we've hit the 100GB cap
check_disk_limit() {
    local used_kb
    used_kb=$(du -sk "$TARGET_DIR" 2>/dev/null | cut -f1)
    local used_gb=$((used_kb / 1048576))
    if [[ $used_gb -ge $MAX_SIZE_GB ]]; then
        log ""
        log "============================================"
        log "  LIMIT REACHED: ${used_gb}GB >= ${MAX_SIZE_GB}GB cap"
        log "  Stopping collection."
        log "============================================"
        log ""
        du -sh "$TARGET_DIR"/* 2>/dev/null | sort -h | tee -a "$LOG_FILE"
        log "Total: $(du -sh "$TARGET_DIR" | cut -f1)"
        log "Disk remaining: $(df -h "$TARGET_DIR" | tail -1 | awk '{print $4}')"
        exit 0
    fi
}

# Download helper with resume support
download_file() {
    local url="$1"
    local dest="$2"
    local desc="${3:-$(basename "$dest")}"

    check_disk_limit

    if [[ -f "$dest" ]] && [[ $(stat -c%s "$dest" 2>/dev/null || echo 0) -gt 100 ]]; then
        log "[SKIP] $desc (already exists, $(du -h "$dest" | cut -f1))"
        return 0
    fi

    mkdir -p "$(dirname "$dest")"
    log "[DOWN] $desc"
    log "       <- $url"

    if curl -L -C - --retry 3 --retry-delay 5 -o "$dest" --progress-bar "$url" 2>&1; then
        local size
        size=$(du -h "$dest" | cut -f1)
        log "[DONE] $desc ($size)"
    else
        log "[FAIL] $desc"
        rm -f "$dest"
        return 1
    fi
}

# Download all .pth files from a HuggingFace repo directory
download_hf_dir() {
    local repo="$1"
    local hf_path="${2:-.}"
    local local_dir="$3"
    local pattern="${4:-*.pth}"

    log "--- Scanning $repo/$hf_path for $pattern ---"
    mkdir -p "$TARGET_DIR/$local_dir"

    # Use HF API to list files
    local api_url="https://huggingface.co/api/models/${repo}/tree/main/${hf_path}"
    local files
    files=$(curl -sf "$api_url" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for f in data:
        if f.get('type') == 'file' and f['path'].endswith('.pth'):
            print(f['path'] + '|' + str(f.get('size', 0)))
except: pass
" 2>/dev/null) || true

    if [[ -z "$files" ]]; then
        log "[WARN] No .pth files found in $repo/$hf_path"
        return 0
    fi

    while IFS='|' read -r filepath size; do
        local filename
        filename=$(basename "$filepath")
        local size_mb=$((size / 1048576))
        download_file \
            "https://huggingface.co/${repo}/resolve/main/${filepath}" \
            "$TARGET_DIR/$local_dir/$filename" \
            "$local_dir/$filename (${size_mb}MB)"
    done <<< "$files"
}

log "============================================"
log "  KiloCode RVC Voice Model Collector"
log "  Target: $TARGET_DIR"
log "  Available space: $(df -h "$TARGET_DIR" | tail -1 | awk '{print $4}')"
log "============================================"
log ""

# =====================================================================
# SECTION 1: Core RVC Infrastructure Models (~1GB)
# Already downloaded by download-models.sh, but verify
# =====================================================================
log "=== Section 1: Core RVC Infrastructure ==="

download_file \
    "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt" \
    "$TARGET_DIR/hubert_base.pt" \
    "hubert_base.pt (feature extraction)"

download_file \
    "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt" \
    "$TARGET_DIR/rmvpe.pt" \
    "rmvpe.pt (pitch extraction)"

# =====================================================================
# SECTION 2: RVC v2 Pretrained Base Models (~1.5GB)
# =====================================================================
log ""
log "=== Section 2: RVC v2 Pretrained Base Models ==="

for sr in 48k 40k 32k; do
    for type in G D; do
        download_file \
            "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/pretrained_v2/f0${type}${sr}.pth" \
            "$TARGET_DIR/pretrained_v2/f0${type}${sr}.pth" \
            "pretrained_v2/f0${type}${sr}.pth"
    done
done

# =====================================================================
# SECTION 3: Kokoro TTS Models (~2GB)
# High-quality open-source TTS that works great with RVC
# =====================================================================
log ""
log "=== Section 3: Kokoro TTS Voice Models ==="

download_file \
    "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx" \
    "$TARGET_DIR/kokoro/kokoro-v1.0.onnx" \
    "Kokoro 82M ONNX model"

download_file \
    "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.pth" \
    "$TARGET_DIR/kokoro/kokoro-v1.0.pth" \
    "Kokoro 82M PyTorch model"

# Kokoro voice packs
for voice in af_heart af_bella af_nicole af_sarah af_sky am_adam am_michael bf_emma bf_isabella bm_george bm_lewis; do
    download_file \
        "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices/${voice}.pt" \
        "$TARGET_DIR/kokoro/voices/${voice}.pt" \
        "Kokoro voice: $voice"
done

# =====================================================================
# SECTION 4: OpenVoice v2 Models (~500MB)
# Zero-shot voice cloning
# =====================================================================
log ""
log "=== Section 4: OpenVoice v2 ==="

download_file \
    "https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/checkpoint.pth" \
    "$TARGET_DIR/openvoice-v2/converter/checkpoint.pth" \
    "OpenVoice v2 converter"

for lang in EN ZH JP KR FR ES; do
    download_file \
        "https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/base_speakers/ses/${lang}.pth" \
        "$TARGET_DIR/openvoice-v2/base_speakers/${lang}.pth" \
        "OpenVoice v2 base speaker: $lang"
done

# =====================================================================
# SECTION 5: GPT-SoVITS Pretrained (~2GB)
# Popular Chinese+English TTS with voice cloning
# =====================================================================
log ""
log "=== Section 5: GPT-SoVITS Pretrained Models ==="

download_file \
    "https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch%3D12-step%3D369668.ckpt" \
    "$TARGET_DIR/gpt-sovits/s1bert25hz-longer.ckpt" \
    "GPT-SoVITS s1 BERT model"

download_file \
    "https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/gsv-v2final-pretrained/s2G2333k.pth" \
    "$TARGET_DIR/gpt-sovits/s2G2333k.pth" \
    "GPT-SoVITS s2 Generator"

download_file \
    "https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/gsv-v2final-pretrained/s2D2333k.pth" \
    "$TARGET_DIR/gpt-sovits/s2D2333k.pth" \
    "GPT-SoVITS s2 Discriminator"

# =====================================================================
# SECTION 6: Piper TTS Voice Models (~5GB)
# Lightweight offline TTS - 900+ voices, 47 languages
# =====================================================================
log ""
log "=== Section 6: Piper TTS English Voices ==="

PIPER_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US"

# High quality English voices
for voice in amy/high joe/high kusal/high lessac/high libritts/high libritts_r/medium ljspeech/high ryan/high; do
    name=$(echo "$voice" | tr '/' '-')
    download_file \
        "${PIPER_BASE}/${voice}/en_US-${name}.onnx" \
        "$TARGET_DIR/piper/en_US-${name}.onnx" \
        "Piper EN-US: $name"
    download_file \
        "${PIPER_BASE}/${voice}/en_US-${name}.onnx.json" \
        "$TARGET_DIR/piper/en_US-${name}.onnx.json" \
        "Piper EN-US config: $name"
done

# British English voices
PIPER_GB="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB"
for voice in alan/medium alba/medium aru/medium cori/high jenny_dioco/medium northern_english_male/medium semaine/medium southern_english_female/low vctk/medium; do
    name=$(echo "$voice" | tr '/' '-')
    download_file \
        "${PIPER_GB}/${voice}/en_GB-${name}.onnx" \
        "$TARGET_DIR/piper/en_GB-${name}.onnx" \
        "Piper EN-GB: $name"
    download_file \
        "${PIPER_GB}/${voice}/en_GB-${name}.onnx.json" \
        "$TARGET_DIR/piper/en_GB-${name}.onnx.json" \
        "Piper EN-GB config: $name"
done

# =====================================================================
# SECTION 7: StyleTTS2 Models (~1GB)
# State-of-the-art expressive TTS
# =====================================================================
log ""
log "=== Section 7: StyleTTS2 Models ==="

download_file \
    "https://huggingface.co/yl4579/StyleTTS2-LibriTTS/resolve/main/Models/LibriTTS/epochs_2nd_00020.pth" \
    "$TARGET_DIR/styletts2/epochs_2nd_00020.pth" \
    "StyleTTS2 LibriTTS model"

# =====================================================================
# SECTION 8: XTTS v2 / Coqui Models (~3GB)
# Multi-language voice cloning TTS
# =====================================================================
log ""
log "=== Section 8: XTTS v2 Models ==="

download_file \
    "https://huggingface.co/coqui/XTTS-v2/resolve/main/model.pth" \
    "$TARGET_DIR/xtts-v2/model.pth" \
    "XTTS v2 main model"

download_file \
    "https://huggingface.co/coqui/XTTS-v2/resolve/main/config.json" \
    "$TARGET_DIR/xtts-v2/config.json" \
    "XTTS v2 config"

download_file \
    "https://huggingface.co/coqui/XTTS-v2/resolve/main/vocab.json" \
    "$TARGET_DIR/xtts-v2/vocab.json" \
    "XTTS v2 vocab"

download_file \
    "https://huggingface.co/coqui/XTTS-v2/resolve/main/dvae.pth" \
    "$TARGET_DIR/xtts-v2/dvae.pth" \
    "XTTS v2 DVAE"

download_file \
    "https://huggingface.co/coqui/XTTS-v2/resolve/main/mel_stats.pth" \
    "$TARGET_DIR/xtts-v2/mel_stats.pth" \
    "XTTS v2 mel stats"

# =====================================================================
# SECTION 9: F5-TTS Models (~1.5GB)
# Fast, high-quality TTS with voice cloning
# =====================================================================
log ""
log "=== Section 9: F5-TTS Models ==="

download_file \
    "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_v1_Base/model_1250000.safetensors" \
    "$TARGET_DIR/f5-tts/model_1250000.safetensors" \
    "F5-TTS Base model"

download_file \
    "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_v1_Base/vocab.txt" \
    "$TARGET_DIR/f5-tts/vocab.txt" \
    "F5-TTS vocab"

# =====================================================================
# SECTION 10: Chatterbox TTS (~2GB)
# Resemble AI's open-source expressive TTS
# =====================================================================
log ""
log "=== Section 10: Chatterbox TTS ==="

download_file \
    "https://huggingface.co/ResembleAI/chatterbox/resolve/main/chatterbox_decoder.safetensors" \
    "$TARGET_DIR/chatterbox/chatterbox_decoder.safetensors" \
    "Chatterbox decoder"

download_file \
    "https://huggingface.co/ResembleAI/chatterbox/resolve/main/chatterbox_tokenizer.safetensors" \
    "$TARGET_DIR/chatterbox/chatterbox_tokenizer.safetensors" \
    "Chatterbox tokenizer"

download_file \
    "https://huggingface.co/ResembleAI/chatterbox/resolve/main/chatterbox_s3gen.safetensors" \
    "$TARGET_DIR/chatterbox/chatterbox_s3gen.safetensors" \
    "Chatterbox s3gen"

download_file \
    "https://huggingface.co/ResembleAI/chatterbox/resolve/main/chatterbox_ve.safetensors" \
    "$TARGET_DIR/chatterbox/chatterbox_ve.safetensors" \
    "Chatterbox voice encoder"

# =====================================================================
# SECTION 11: Fish Speech v1.5 (~2GB)
# Open-source multilingual TTS with voice cloning
# =====================================================================
log ""
log "=== Section 11: Fish Speech ==="

download_file \
    "https://huggingface.co/fishaudio/fish-speech-1.5/resolve/main/model.pth" \
    "$TARGET_DIR/fish-speech/model.pth" \
    "Fish Speech 1.5 model"

download_file \
    "https://huggingface.co/fishaudio/fish-speech-1.5/resolve/main/firefly-gan-vq-fsq-8x1024-21hz-generator.pth" \
    "$TARGET_DIR/fish-speech/firefly-gan-vq-generator.pth" \
    "Fish Speech vocoder"

# =====================================================================
# SECTION 12: Bark TTS Models (~5GB)
# Suno's text-to-audio model with voice cloning
# =====================================================================
log ""
log "=== Section 12: Bark TTS ==="

download_file \
    "https://huggingface.co/suno/bark/resolve/main/text_2.pt" \
    "$TARGET_DIR/bark/text_2.pt" \
    "Bark text model"

download_file \
    "https://huggingface.co/suno/bark/resolve/main/coarse_2.pt" \
    "$TARGET_DIR/bark/coarse_2.pt" \
    "Bark coarse model"

download_file \
    "https://huggingface.co/suno/bark/resolve/main/fine_2.pt" \
    "$TARGET_DIR/bark/fine_2.pt" \
    "Bark fine model"

# =====================================================================
# SECTION 13: Seed-VC Voice Conversion (~500MB)
# Zero-shot voice conversion without training
# =====================================================================
log ""
log "=== Section 13: Seed-VC ==="

download_file \
    "https://huggingface.co/Plachta/Seed-VC/resolve/main/DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth" \
    "$TARGET_DIR/seed-vc/DiT_seed_v2.pth" \
    "Seed-VC v2 model"

# =====================================================================
# SECTION 14: Curated RVC Voice Models (~2GB)
# High-quality English RVC v2 voices from HuggingFace
# =====================================================================
log ""
log "=== Section 14: Curated RVC Voice Models ==="

# Helper: download zip, extract .pth and .index files
download_rvc_zip() {
    local url="$1"
    local name="$2"
    local dest_dir="$TARGET_DIR/rvc-voices/$name"

    check_disk_limit

    if [[ -d "$dest_dir" ]] && ls "$dest_dir"/*.pth 1>/dev/null 2>&1; then
        log "[SKIP] RVC voice: $name (already extracted)"
        return 0
    fi

    mkdir -p "$dest_dir"
    local tmp_zip="/tmp/rvc_${name}.zip"

    log "[DOWN] RVC voice: $name"
    if curl -L -C - --retry 3 --retry-delay 5 -o "$tmp_zip" --progress-bar "$url" 2>&1; then
        # Extract only .pth and .index files
        if unzip -o -j "$tmp_zip" '*.pth' -d "$dest_dir" 2>/dev/null; then
            log "[DONE] Extracted .pth for $name"
        fi
        unzip -o -j "$tmp_zip" '*.index' -d "$dest_dir" 2>/dev/null || true
        rm -f "$tmp_zip"
        local size
        size=$(du -sh "$dest_dir" | cut -f1)
        log "[DONE] RVC voice: $name ($size)"
    else
        log "[FAIL] RVC voice: $name"
        rm -f "$tmp_zip"
        return 1
    fi
}

# --- Sailor Moon English Dub voices ---
download_rvc_zip \
    "https://huggingface.co/MusicBox27/SailorMoon/resolve/main/Ami_Mizuno_e300_s4200.zip?download=true" \
    "ami-mizuno"

download_rvc_zip \
    "https://huggingface.co/MusicBox27/SailorMoon/resolve/main/Makoto_Kino_e300_s4500.zip?download=true" \
    "makoto-kino"

# --- Pop / Music voices ---
download_rvc_zip \
    "https://huggingface.co/ariscult/arianagrande2010s/resolve/main/arianagrande2010s.zip?download=true" \
    "ariana-grande-2010s"

download_rvc_zip \
    "https://huggingface.co/Nasssss/YeCUCK/resolve/main/OFFICIAL%20KANYE%20WEST%20MODEL%20-%20Weights%20Model.zip?download=true" \
    "kanye-west"

download_rvc_zip \
    "https://huggingface.co/Roscall/elvis_model/resolve/main/Elvis_model.zip?download=true" \
    "elvis-presley"

# --- Game / Animation voices ---
download_rvc_zip \
    "https://huggingface.co/KingSGD915/Asuka_Kazama_English/resolve/main/Asuka%20Kazama%20-%20Weights%20Model.zip?download=true" \
    "asuka-kazama"

download_rvc_zip \
    "https://huggingface.co/LeonTheEngSpanGuy/FernBFDIE/resolve/main/Fern.zip?download=true" \
    "fern-bfdie"

download_rvc_zip \
    "https://huggingface.co/LeonTheEngSpanGuy/RoseBFDIE/resolve/main/Rose.zip?download=true" \
    "rose-bfdie"

# --- KATSEYE group ---
download_rvc_zip \
    "https://huggingface.co/lukee1079/KATSEYE_by_zaeka_yt/resolve/main/Manon_luke1079.zip?download=true" \
    "katseye-manon"

download_rvc_zip \
    "https://huggingface.co/lukee1079/KATSEYE_by_zaeka_yt2/resolve/main/Danielaluke1079.zip?download=true" \
    "katseye-daniela"

# --- Studio / Neutral voices ---
download_file \
    "https://huggingface.co/IssacMosesD/Lunar-RVC-Model/resolve/main/Lunar-RVC.pth" \
    "$TARGET_DIR/rvc-voices/lunar-studio/Lunar-RVC.pth" \
    "Lunar Female Studio Voice (48kHz)"

download_rvc_zip \
    "https://huggingface.co/PhoenixStormJr/RVC-V2-default-voice/resolve/main/default.zip" \
    "phoenixstorm-default"

# =====================================================================
# SECTION 15: Research-Sourced RVC Voice Models (~3GB)
# High-quality English voices from HuggingFace research scan
# Direct .pth downloads — ideal for coding assistant TTS
# =====================================================================
log ""
log "=== Section 15: Research-Sourced RVC Voices ==="

# --- Neural TTS AI voice (direct .pth, no zip) ---
download_file \
    "https://huggingface.co/TheOriginalBox/NTTS-AI-Voice-RVC/resolve/main/NttsAI.pth" \
    "$TARGET_DIR/rvc-voices/ntts-ai/NttsAI.pth" \
    "NTTS AI Voice (neural TTS)"

download_file \
    "https://huggingface.co/TheOriginalBox/NTTS-AI-Voice-RVC/resolve/main/added_IVF1269_Flat_nprobe_1.index" \
    "$TARGET_DIR/rvc-voices/ntts-ai/added_IVF1269_Flat_nprobe_1.index" \
    "NTTS AI Voice index"

# --- PhoenixStorm direct .pth (backup if zip failed) ---
download_file \
    "https://huggingface.co/PhoenixStormJr/RVC-V2-default-voice/resolve/main/default.pth" \
    "$TARGET_DIR/rvc-voices/phoenixstorm-default/default.pth" \
    "PhoenixStorm Default v2 .pth"

download_file \
    "https://huggingface.co/PhoenixStormJr/RVC-V2-default-voice/resolve/main/added_IVF511_Flat_nprobe_1_default_v2.index" \
    "$TARGET_DIR/rvc-voices/phoenixstorm-default/added_IVF511_Flat_nprobe_1_default_v2.index" \
    "PhoenixStorm Default v2 index"

# --- iatop65 curated voice collection ---
# Google Assistant voice
download_rvc_zip \
    "https://huggingface.co/iatop65/RVC_Voices/resolve/main/Google%20Assistant.zip" \
    "google-assistant"

# Google Gemini voice
download_rvc_zip \
    "https://huggingface.co/iatop65/RVC_Voices/resolve/main/Google%20Gemini.zip" \
    "google-gemini"

# NOAA Weather Radio (clear broadcast voice)
download_rvc_zip \
    "https://huggingface.co/iatop65/RVC_Voices/resolve/main/NOAA%20Radio.zip" \
    "noaa-radio"

# DecTalk classic synth voice
download_rvc_zip \
    "https://huggingface.co/iatop65/RVC_Voices/resolve/main/DecTalk.zip" \
    "dectalk"

# Liberty Prime
download_rvc_zip \
    "https://huggingface.co/iatop65/RVC_Voices/resolve/main/Liberty%20Prime.zip" \
    "liberty-prime"

# --- r0seyyyd33p collection (large, selective download) ---
download_file \
    "https://huggingface.co/r0seyyyd33p/RVC-voices/resolve/main/Female%20Whisper%20TTS%20Voice%20model.zip" \
    "/tmp/rvc_female-whisper.zip" \
    "Female Whisper TTS (downloading zip)"

if [[ -f "/tmp/rvc_female-whisper.zip" ]]; then
    mkdir -p "$TARGET_DIR/rvc-voices/female-whisper-tts"
    unzip -o -j "/tmp/rvc_female-whisper.zip" '*.pth' -d "$TARGET_DIR/rvc-voices/female-whisper-tts" 2>/dev/null || true
    unzip -o -j "/tmp/rvc_female-whisper.zip" '*.index' -d "$TARGET_DIR/rvc-voices/female-whisper-tts" 2>/dev/null || true
    rm -f "/tmp/rvc_female-whisper.zip"
    log "[DONE] Female Whisper TTS extracted"
fi

# --- Alternative pretrained base from ddPn08 ---
download_file \
    "https://huggingface.co/ddPn08/rvc_pretrained/resolve/main/hubert_base.pt" \
    "$TARGET_DIR/pretrained-alt/hubert_base.pt" \
    "ddPn08 hubert_base.pt (alt feature extractor)"

# --- JLabDX69 voices ---
download_hf_dir "JLabDX69/RVCVoiceModels" "." "rvc-voices/jlabdx69" "*.pth"

# --- Applio community models ---
download_hf_dir "DarkWeBareBears69/My-RVC-Voice-Models" "." "rvc-voices/darkwebearebears" "*.pth"

# =====================================================================
# SECTION 16: Curated HuggingFace RVC Collections (~10GB)
# Community repos with multiple English voice models
# =====================================================================
log ""
log "=== Section 16: HuggingFace RVC Collections ==="

# BlazBlue Noel Vermillion English
download_rvc_zip \
    "https://huggingface.co/Nick088/BlazBlue_Noel_Vermillion_English/resolve/main/model.zip" \
    "blazblue-noel-english"

# VCTK multi-speaker English sample
download_hf_dir "Nekochu/RVC-VCTK_Voice-sample" "." "rvc-voices/vctk-sample" "*.pth"

# 0x3e9 curated RVC models (direct .pth files)
download_hf_dir "0x3e9/0x3e9_RVC_models" "." "rvc-voices/0x3e9" "*.pth"

# sxndypz RVC v2 models
download_hf_dir "sxndypz/rvc-v2-models" "." "rvc-voices/sxndypz" "*.pth"

# juuxn RVC Models
download_hf_dir "juuxn/RVCModels" "." "rvc-voices/juuxn" "*.pth"

# EvanTheToonGuy40 RVC Models
download_hf_dir "EvanTheToonGuy40/RVC_Models" "." "rvc-voices/evan-toonguy" "*.pth"

# AIHeaven RVC models
download_hf_dir "AIHeaven/rvc-models" "." "rvc-voices/aiheaven" "*.pth"

# Politrees RVC resources
download_hf_dir "Politrees/RVC_resources" "." "rvc-voices/politrees" "*.pth"

# =====================================================================
# SECTION 17: Japanese RVC Voices (~2GB sample)
# From curated Japanese voice collections
# =====================================================================
log ""
log "=== Section 17: Japanese RVC Voices (sample) ==="

download_hf_dir "Elesis/RVC_Models" "." "rvc-voices-jp/elesis" "*.pth"

# =====================================================================
# Final Summary
# =====================================================================
log ""
log "============================================"
log "  Collection Complete!"
log "  Models directory: $TARGET_DIR"
log "============================================"
log ""
du -sh "$TARGET_DIR"/* 2>/dev/null | sort -h | tee -a "$LOG_FILE"
log ""
log "Total:"
du -sh "$TARGET_DIR" | tee -a "$LOG_FILE"
log ""
log "Disk remaining: $(df -h "$TARGET_DIR" | tail -1 | awk '{print $4}')"
