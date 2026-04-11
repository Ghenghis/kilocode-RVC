#!/usr/bin/env python3
"""
Mass Voice Model Downloader for KiloCode VPS
Downloads 800+ UNIQUE voices from QuickWick (877) + individual repos.
Auto-deduplicates. Stops at 97GB disk cap.
"""
import os, sys, subprocess, shutil, json, urllib.request, urllib.parse, zipfile, time, traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

TARGET_DIR = "/opt/rvc-models/models/rvc-voices"
TEMP_DIR = "/tmp/voice-downloads"
MAX_SIZE_GB = 120  # User needs 55GB free on 193GB disk; 16GB system = 122GB usable
HF_TOKEN = os.environ.get("HF_TOKEN", "")
LOG_FILE = "/opt/rvc-models/download-progress.log"
MODELS_ROOT = "/opt/rvc-models/models"

PARALLEL_WORKERS = 50  # 50 concurrent downloads, queue refills as each completes

os.makedirs(TARGET_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

log_lock = threading.Lock()
slug_lock = threading.Lock()

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with log_lock:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")

def get_used_gb():
    result = subprocess.run(["du", "-sk", MODELS_ROOT], capture_output=True, text=True)
    kb = int(result.stdout.split()[0])
    return kb / 1048576

def check_limit():
    used = get_used_gb()
    if used >= MAX_SIZE_GB:
        log(f"LIMIT REACHED: {used:.1f}GB >= {MAX_SIZE_GB}GB cap")
        return False
    return True

def voice_exists(slug):
    voice_dir = os.path.join(TARGET_DIR, slug)
    if os.path.exists(voice_dir):
        files = [f for f in os.listdir(voice_dir) if os.path.isfile(os.path.join(voice_dir, f))]
        if any(os.path.getsize(os.path.join(voice_dir, f)) > 10000 for f in files):
            return True
    return False

def make_slug(name):
    """Convert a display name to a filesystem-safe slug."""
    import re
    slug = name.lower().strip()
    # Remove common suffixes like "(RVC) 500 Epoch" etc
    slug = re.sub(r'\s*\(rvc\).*$', '', slug, flags=re.IGNORECASE)
    slug = re.sub(r'\s*\d+k?\s*(epoch|steps|$).*$', '', slug, flags=re.IGNORECASE)
    slug = re.sub(r'\s*v\d+\s*$', '', slug, flags=re.IGNORECASE)
    slug = re.sub(r'\s*\(.*?\)\s*', ' ', slug)
    slug = slug.strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug or name.lower().replace(' ', '-')[:40]

def download_file(url, dest, desc=""):
    if os.path.exists(dest) and os.path.getsize(dest) > 10000:
        return True
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "User-Agent": "KiloCode-VPS/1.0"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=300) as resp:
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(1048576)
                    if not chunk:
                        break
                    f.write(chunk)
            if os.path.getsize(dest) < 10000:
                os.remove(dest)
                return False
            return True
    except Exception as e:
        log(f"  FAIL download: {desc} - {e}")
        if os.path.exists(dest):
            os.remove(dest)
        return False

def extract_zip(zip_path, slug):
    """Extract model files from zip. Robust path handling."""
    voice_dir = os.path.join(TARGET_DIR, slug)
    os.makedirs(voice_dir, exist_ok=True)
    # Use unique extract dir to avoid conflicts
    extract_tmp = os.path.join(TEMP_DIR, f"ex_{slug}")
    if os.path.exists(extract_tmp):
        shutil.rmtree(extract_tmp, ignore_errors=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            # Extract everything to temp dir first
            z.extractall(extract_tmp)

            # Walk the extracted tree and find model files
            extracted = False
            for root, dirs, files in os.walk(extract_tmp):
                for fname in files:
                    lower = fname.lower()
                    full_path = os.path.join(root, fname)
                    fsize = os.path.getsize(full_path)

                    if lower.endswith((".pth", ".index", ".npy")) and fsize > 10000:
                        dst = os.path.join(voice_dir, fname)
                        shutil.copy2(full_path, dst)
                        extracted = True
                    elif not extracted and fsize > 1000000:
                        # Fallback: grab large files
                        dst = os.path.join(voice_dir, fname)
                        shutil.copy2(full_path, dst)
                        extracted = True

            shutil.rmtree(extract_tmp, ignore_errors=True)

            if not extracted:
                shutil.rmtree(voice_dir, ignore_errors=True)
                return False
            return True
    except Exception as e:
        log(f"  FAIL extract: {slug} - {e}")
        shutil.rmtree(extract_tmp, ignore_errors=True)
        shutil.rmtree(voice_dir, ignore_errors=True)
        return False

def download_and_install_zip(url, slug, desc=""):
    """Download zip, extract model files, clean up."""
    if voice_exists(slug):
        return True
    if not check_limit():
        return False

    safe = slug.replace("/", "_")
    zip_path = os.path.join(TEMP_DIR, f"{safe}.zip")

    if download_file(url, zip_path, desc):
        result = extract_zip(zip_path, slug)
        if os.path.exists(zip_path):
            os.remove(zip_path)
        if result:
            log(f"  OK: {slug}")
        return result
    return False

def download_and_install_pth(url, slug, filename, desc=""):
    """Download a single model file."""
    if voice_exists(slug):
        return True
    if not check_limit():
        return False

    voice_dir = os.path.join(TARGET_DIR, slug)
    os.makedirs(voice_dir, exist_ok=True)
    dest = os.path.join(voice_dir, filename)

    if download_file(url, dest, desc):
        log(f"  OK: {slug}")
        return True
    shutil.rmtree(voice_dir, ignore_errors=True)
    return False


# ============================================================
log("=" * 60)
log("KiloCode Mass Voice Download - 800+ Unique English Voices")
log(f"Current usage: {get_used_gb():.1f}GB / {MAX_SIZE_GB}GB cap")
log("=" * 60)

success = 0
failed = 0
skipped = 0
seen_slugs = set()

# Pre-populate seen_slugs with existing voices
for d in os.listdir(TARGET_DIR):
    if os.path.isdir(os.path.join(TARGET_DIR, d)):
        seen_slugs.add(d)
log(f"Already have {len(seen_slugs)} voices: {', '.join(sorted(seen_slugs))}")

# ----- PHASE 1: Individual repos (confirmed high-quality) -----
log("\n--- PHASE 1: Individual Repos ---")

phase1 = [
    # (slug, repo, filename, is_zip)
    ("elvis-presley", "Roscall/elvis_model", "Elvis_model.zip", True),
    ("usagi-tsukino", "MusicBox27/SailorMoon", "Usagi_Tsukino_e300_s12000.zip", True),
    ("rei-hino", "MusicBox27/SailorMoon", "Rei_Hino_e300_s4800.zip", True),
    ("ami-mizuno", "MusicBox27/SailorMoon", "Ami_Mizuno_e300_s4200.zip", True),
    ("makoto-kino", "MusicBox27/SailorMoon", "Makoto_Kino_e300_s4500.zip", True),
    ("minako-aino", "MusicBox27/SailorMoon", "Minako_Aino_e300_s9000.zip", True),
    ("hotaru-tomoe", "MusicBox27/SailorMoon", "Hotaru_Tomoe_e300_s4200.zip", True),
    ("haruka-tenou", "MusicBox27/SailorMoon", "Haruka_Tenou_e300_s4200.zip", True),
    ("michiru-kaioh", "MusicBox27/SailorMoon", "Michiru_Kaioh_e300_s4200.zip", True),
    ("setsuna-meioh", "MusicBox27/SailorMoon", "Setsuna_Meioh_e300_s2700.zip", True),
    ("chibiusa", "MusicBox27/SailorMoon", "Chibiusa_e300_s3000.zip", True),
    ("naru-osaka", "MusicBox27/SailorMoon", "Naru_Osaka_e300_s1500.zip", True),
    ("asuka-kazama", "KingSGD915/Asuka_Kazama_English", "Asuka Kazama - Weights Model.zip", True),
    ("noel-vermillion", "Nick088/BlazBlue_Noel_Vermillion_English", "BlazBlue_Noel_Vermillion_English.zip", True),
    # DarkWeBareBears69
    ("cdi-link", "DarkWeBareBears69/My-RVC-Voice-Models", "CDiLink.zip", True),
    ("bowser", "DarkWeBareBears69/My-RVC-Voice-Models", "hotel-mario-bowser.zip", True),
    ("mario-hotel", "DarkWeBareBears69/My-RVC-Voice-Models", "mario-hotel-mario.zip", True),
    ("luigi", "DarkWeBareBears69/My-RVC-Voice-Models", "luigi-hotel-mario.zip", True),
    ("kidaroo", "DarkWeBareBears69/My-RVC-Voice-Models", "Kidaroo(VoiceForgeAIEnhanced).zip", True),
    ("leonidas-slikk", "DarkWeBareBears69/My-RVC-Voice-Models", "LeonidasSlikk.zip", True),
    ("loquendo-juan", "DarkWeBareBears69/My-RVC-Voice-Models", "LoquendoJuan(AIEnhanced).zip", True),
    ("cerevoice-andy", "DarkWeBareBears69/My-RVC-Voice-Models", "CereVoiceAndy(AIEnhanced).zip", True),
    ("mao-mao", "DarkWeBareBears69/My-RVC-Voice-Models", "Mao-Mao.zip", True),
    ("boyfriend-fnf", "DarkWeBareBears69/My-RVC-Voice-Models", "boyfriendWeek3.zip", True),
    ("tigress", "DarkWeBareBears69/My-RVC-Voice-Models", "Alia-Tigress.zip", True),
    ("arlo", "DarkWeBareBears69/My-RVC-Voice-Models", "ArloTheAlligatorBoy.zip", True),
    ("badgerclops", "DarkWeBareBears69/My-RVC-Voice-Models", "Badgerclops.zip", True),
    ("flain", "DarkWeBareBears69/My-RVC-Voice-Models", "Flain.zip", True),
    ("hoppus", "DarkWeBareBears69/My-RVC-Voice-Models", "Hoppus-v3.zip", True),
    ("oswaldo", "DarkWeBareBears69/My-RVC-Voice-Models", "Oswaldo.zip", True),
    ("riggy", "DarkWeBareBears69/My-RVC-Voice-Models", "riggy.zip", True),
    ("witchy-simone", "DarkWeBareBears69/My-RVC-Voice-Models", "witchy-simone.zip", True),
    ("velma", "DarkWeBareBears69/My-RVC-Voice-Models", "Mindy-Velma.zip", True),
    ("daimer", "DarkWeBareBears69/My-RVC-Voice-Models", "Daimer.zip", True),
    ("barnabas", "DarkWeBareBears69/My-RVC-Voice-Models", "Barnabas.zip", True),
    ("pud-cat", "DarkWeBareBears69/My-RVC-Voice-Models", "pud-cat.zip", True),
    ("christian-redl", "DarkWeBareBears69/My-RVC-Voice-Models", "ChristianRedl.zip", True),
    ("fake-german-kid", "DarkWeBareBears69/My-RVC-Voice-Models", "FakeGermanKid(Adult).zip", True),
    ("rolf-kanies", "DarkWeBareBears69/My-RVC-Voice-Models", "RolfKanies.zip", True),
    ("telekinesis", "DarkWeBareBears69/My-RVC-Voice-Models", "Telekinesis.zip", True),
    ("leopold-slikk", "DarkWeBareBears69/My-RVC-Voice-Models", "leopold-slikk.zip", True),
    # iatop65
    ("brian-griffin", "iatop65/RVC_Voices", "Brian_Griffin_V2.zip", True),
    ("lois-griffin", "iatop65/RVC_Voices", "Lois_Griffin.zip", True),
    ("meg-griffin", "iatop65/RVC_Voices", "Meg_Griffin_Mila_Kunis.zip", True),
    ("jillian-family-guy", "iatop65/RVC_Voices", "Jillian_Wilcox_Family_Guy.zip", True),
    ("liberty-prime", "iatop65/RVC_Voices", "Liberty_Prime.zip", True),
    ("noaa-radio", "iatop65/RVC_Voices", "NOAA_Radio.zip", True),
    ("google-gemini", "iatop65/RVC_Voices", "Google_Gemini.zip", True),
    ("google-assistant", "iatop65/RVC_Voices", "G_Assistant.zip", True),
    ("gameboy-color", "iatop65/RVC_Voices", "Gameboy_Color.zip", True),
    ("erik-voss", "iatop65/RVC_Voices", "Erik_Voss_(NewRockstar).zip", True),
    ("meg-griffin-chabert", "iatop65/RVC_Voices", "Meg_Griffin_Lacey_Chabert.zip", True),
    # chorgle
    ("rosenberg", "chorgle/chorgles-rvc-voices", "rosenberg.zip", True),
    ("benrey", "chorgle/chorgles-rvc-voices", "benrey.zip", True),
    ("tommy-vercetti", "chorgle/chorgles-rvc-voices", "tommyy.zip", True),
    # thebuddyadrian
    ("okabe-rintaro", "thebuddyadrian/RVC_Models", "OkabeRintaro.zip", True),
    ("leah-kazuno", "thebuddyadrian/RVC_Models", "LeahKazuno2.zip", True),
    ("mao-hiiragi", "thebuddyadrian/RVC_Models", "MaoHiiragi.zip", True),
    ("sarah-kazuno", "thebuddyadrian/RVC_Models", "SarahKazuno2.zip", True),
    ("yuna-hijirisawa", "thebuddyadrian/RVC_Models", "YunaHijirisawa.zip", True),
    # AICovers
    ("roger-waters", "AICovers/Voices_RVC_v2", "RogerWaters.zip", True),
    # Elesis pth files
    ("daiwa", "Elesis/RVC_Models", "daiwa30.pth", False),
    ("masayuki", "Elesis/RVC_Models", "masayuki_1.pth", False),
    ("toei", "Elesis/RVC_Models", "test_toei2.pth", False),
]

for slug, repo, filename, is_zip in phase1:
    if slug in seen_slugs:
        skipped += 1
        continue
    if not check_limit():
        break
    seen_slugs.add(slug)
    encoded = urllib.parse.quote(filename)
    url = f"https://huggingface.co/{repo}/resolve/main/{encoded}"
    log(f"[P1] {slug}")
    if is_zip:
        if download_and_install_zip(url, slug, slug):
            success += 1
        else:
            failed += 1
    else:
        if download_and_install_pth(url, slug, os.path.basename(filename), slug):
            success += 1
        else:
            failed += 1

log(f"Phase 1 done. +{success} voices, {failed} failed, {skipped} skipped")
log(f"Usage: {get_used_gb():.1f}GB")

# ----- PHASE 2: ALL QuickWick voices (877 unique) -----
log("\n--- PHASE 2: QuickWick Bulk Download (877 voices) ---")

# Fetch full directory list from API
quickwick_dirs = []
try:
    api_req = urllib.request.Request(
        "https://huggingface.co/api/models/QuickWick/Music-AI-Voices/tree/main",
        headers={"Authorization": f"Bearer {HF_TOKEN}"}
    )
    with urllib.request.urlopen(api_req, timeout=30) as resp:
        data = json.loads(resp.read())
        quickwick_dirs = [item["path"] for item in data if item.get("type") == "directory"]
    log(f"Found {len(quickwick_dirs)} QuickWick directories")
except Exception as e:
    log(f"ERROR fetching QuickWick list: {e}")

qw_success = 0
qw_failed = 0
qw_skipped = 0

def get_quickwick_zip_url(dirname):
    """Look up the actual zip filename in a QuickWick directory."""
    encoded_dir = urllib.parse.quote(dirname)
    guessed_url = f"https://huggingface.co/QuickWick/Music-AI-Voices/resolve/main/{encoded_dir}/{urllib.parse.quote(dirname + '.zip')}"
    try:
        list_req = urllib.request.Request(
            f"https://huggingface.co/api/models/QuickWick/Music-AI-Voices/tree/main/{encoded_dir}",
            headers={"Authorization": f"Bearer {HF_TOKEN}"}
        )
        with urllib.request.urlopen(list_req, timeout=15) as resp:
            items = json.loads(resp.read())
            for item in items:
                if item.get("type") == "file" and item["path"].lower().endswith(".zip"):
                    actual_file = os.path.basename(item["path"])
                    return f"https://huggingface.co/QuickWick/Music-AI-Voices/resolve/main/{encoded_dir}/{urllib.parse.quote(actual_file)}"
    except Exception:
        pass
    return guessed_url

def process_quickwick_entry(dirname):
    """Process a single QuickWick entry. Thread-safe."""
    global qw_success, qw_failed, qw_skipped
    try:
        if not check_limit():
            return "limit"

        slug = make_slug(dirname)
        with slug_lock:
            if slug in seen_slugs:
                qw_skipped += 1
                return "skip"
            seen_slugs.add(slug)

        if voice_exists(slug):
            qw_skipped += 1
            return "skip"

        url = get_quickwick_zip_url(dirname)
        if download_and_install_zip(url, slug, dirname):
            qw_success += 1
            return "ok"
        else:
            qw_failed += 1
            return "fail"
    except Exception as e:
        log(f"  ERROR: {dirname} - {e}")
        qw_failed += 1
        return "fail"

# Filter entries and submit to thread pool
work_items = []
for dirname in quickwick_dirs:
    slug = make_slug(dirname)
    if slug in seen_slugs:
        qw_skipped += 1
        continue
    work_items.append(dirname)

log(f"QuickWick: {len(work_items)} new entries to download ({qw_skipped} already skipped)")
log(f"Using {PARALLEL_WORKERS} parallel download threads")

with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
    futures = {executor.submit(process_quickwick_entry, d): d for d in work_items}
    done_count = 0
    for future in as_completed(futures):
        result = future.result()
        done_count += 1
        if result == "limit":
            log("Disk limit reached, cancelling remaining downloads")
            executor.shutdown(wait=False, cancel_futures=True)
            break
        if done_count % 50 == 0:
            log(f"[QW] {done_count}/{len(work_items)} done | {get_used_gb():.1f}GB | +{qw_success} ok, {qw_failed} fail")

log(f"Phase 2 done. +{qw_success} voices, {qw_failed} failed, {qw_skipped} skipped")
log(f"Usage: {get_used_gb():.1f}GB")

# ----- PHASE 3: r0seyyyd33p/RVC-voices (39 more) -----
log("\n--- PHASE 3: r0seyyyd33p/RVC-voices ---")

try:
    api_req = urllib.request.Request(
        "https://huggingface.co/api/models/r0seyyyd33p/RVC-voices/tree/main",
        headers={"Authorization": f"Bearer {HF_TOKEN}"}
    )
    with urllib.request.urlopen(api_req, timeout=30) as resp:
        data = json.loads(resp.read())
        for item in data:
            if not check_limit():
                break
            if item.get("type") != "file":
                continue
            fname = item["path"]
            if not fname.lower().endswith(".zip"):
                continue
            slug = make_slug(fname.replace(".zip", "").replace(".tar.gz", ""))
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            encoded = urllib.parse.quote(fname)
            url = f"https://huggingface.co/r0seyyyd33p/RVC-voices/resolve/main/{encoded}"
            log(f"[R0] {slug}")
            if download_and_install_zip(url, slug, slug):
                success += 1
            else:
                failed += 1
except Exception as e:
    log(f"Phase 3 error: {e}")

log(f"Usage: {get_used_gb():.1f}GB")

# ============================================================
# FINAL REPORT
# ============================================================
log("\n" + "=" * 60)
log("DOWNLOAD COMPLETE")
log(f"Final usage: {get_used_gb():.1f}GB / {MAX_SIZE_GB}GB")

total_voices = len([d for d in os.listdir(TARGET_DIR)
                    if os.path.isdir(os.path.join(TARGET_DIR, d))])
log(f"Total unique voices: {total_voices}")
log(f"Unique slugs tracked: {len(seen_slugs)}")
log("=" * 60)
