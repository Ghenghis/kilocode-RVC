#!/usr/bin/env python3
"""
Cleanup: extract any remaining zips in voice dirs, delete all archives.
Only keeps .pth, .index, .npy model files.
"""
import os, shutil, zipfile, tarfile, time, subprocess

TARGET_DIR = "/opt/rvc-models/models/rvc-voices"
TEMP_DIR = "/tmp/voice-cleanup"
LOG_FILE = "/opt/rvc-models/cleanup.log"

os.makedirs(TEMP_DIR, exist_ok=True)

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

extracted = 0
deleted = 0

log("Starting archive cleanup...")

for voice_dir_name in sorted(os.listdir(TARGET_DIR)):
    voice_dir = os.path.join(TARGET_DIR, voice_dir_name)
    if not os.path.isdir(voice_dir):
        continue

    for fname in list(os.listdir(voice_dir)):
        fpath = os.path.join(voice_dir, fname)
        if not os.path.isfile(fpath):
            continue

        lower = fname.lower()

        if lower.endswith(".zip"):
            # Try to extract model files before deleting
            extract_tmp = os.path.join(TEMP_DIR, voice_dir_name)
            os.makedirs(extract_tmp, exist_ok=True)
            try:
                with zipfile.ZipFile(fpath, "r") as z:
                    z.extractall(extract_tmp)
                for root, dirs, files in os.walk(extract_tmp):
                    for fn in files:
                        if fn.lower().endswith((".pth", ".index", ".npy")):
                            src = os.path.join(root, fn)
                            dst = os.path.join(voice_dir, fn)
                            if not os.path.exists(dst):
                                shutil.copy2(src, dst)
                                extracted += 1
                shutil.rmtree(extract_tmp, ignore_errors=True)
                log(f"EXTRACTED: {voice_dir_name}/{fname}")
            except Exception as e:
                log(f"SKIP extract (bad zip): {voice_dir_name}/{fname}: {e}")
                shutil.rmtree(extract_tmp, ignore_errors=True)
            os.remove(fpath)
            deleted += 1

        elif lower.endswith((".tar.gz", ".tgz", ".tar", ".rar", ".7z")):
            os.remove(fpath)
            deleted += 1
            log(f"DELETED archive: {voice_dir_name}/{fname}")

    # Remove empty voice dirs
    if not os.listdir(voice_dir):
        shutil.rmtree(voice_dir, ignore_errors=True)
        log(f"REMOVED empty dir: {voice_dir_name}")

# Clean up temp
shutil.rmtree(TEMP_DIR, ignore_errors=True)

result = subprocess.run(["du", "-sh", "/opt/rvc-models/models/"], capture_output=True, text=True)
voices_count = len([d for d in os.listdir(TARGET_DIR) if os.path.isdir(os.path.join(TARGET_DIR, d))])

log(f"DONE: extracted {extracted} model files, deleted {deleted} archives")
log(f"Voice dirs remaining: {voices_count}")
log(f"Final model size: {result.stdout.strip()}")
