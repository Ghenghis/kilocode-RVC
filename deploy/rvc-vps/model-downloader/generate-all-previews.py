#!/usr/bin/env python3
"""
Generate edge-tts preview clips for all voices that don't have one yet.
Uses varied preview phrases per voice category for natural-sounding demos.
"""
import asyncio
import os
import json
import time

PREVIEWS_DIR = "/opt/rvc-models/previews"
CATALOG_FILE = "/opt/rvc-models/catalog.json"

# Varied preview phrases by detected category
PHRASES = {
    "character": "Hello there! I'm ready to assist you with your code. Let me take a look at what we have here.",
    "narrator": "In the vast landscape of software development, every line of code tells a story of human ingenuity.",
    "singer": "Welcome to the studio! Let me show you what this voice can do for your project.",
    "gaming": "Player one, ready! Let's dive into this codebase and find what we're looking for.",
    "accent": "Good day! I'd be delighted to help you navigate through your project today.",
    "default": "Hey there! I'm your coding assistant. Let me help you build something amazing today.",
}

# Edge-TTS voices to cycle through for variety
EDGE_VOICES = [
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
    "en-US-JennyNeural",
    "en-US-DavisNeural",
    "en-IN-NeerjaNeural",
    "en-US-AndrewNeural",
    "en-US-EmmaNeural",
]

def get_phrase(voice_entry):
    """Pick a preview phrase based on voice category/tags."""
    tags = " ".join(voice_entry.get("tags", [])).lower()
    cat = voice_entry.get("category", "").lower()
    name = voice_entry.get("name", "").lower()

    if any(k in tags or k in cat or k in name for k in ["cartoon", "character", "anime", "villain"]):
        return PHRASES["character"]
    if any(k in tags or k in cat or k in name for k in ["narrator", "morgan", "attenborough"]):
        return PHRASES["narrator"]
    if any(k in tags or k in cat or k in name for k in ["singer", "pop", "rap", "hip-hop"]):
        return PHRASES["singer"]
    if any(k in tags or k in cat or k in name for k in ["game", "gaming", "glados", "sonic", "mario"]):
        return PHRASES["gaming"]
    if any(k in tags or k in cat or k in name for k in ["accent", "british", "australian", "indian"]):
        return PHRASES["accent"]
    return PHRASES["default"]


async def generate_preview(voice_id, phrase, edge_voice, sem):
    """Generate a single preview clip."""
    async with sem:
        import edge_tts
        output_path = os.path.join(PREVIEWS_DIR, f"{voice_id}.mp3")
        if os.path.exists(output_path):
            return voice_id, "skip"

        try:
            communicate = edge_tts.Communicate(phrase, edge_voice)
            await communicate.save(output_path)
            size = os.path.getsize(output_path)
            if size < 1000:
                os.remove(output_path)
                return voice_id, "too_small"
            return voice_id, "ok"
        except Exception as e:
            return voice_id, f"fail: {e}"


async def main():
    os.makedirs(PREVIEWS_DIR, exist_ok=True)

    if not os.path.exists(CATALOG_FILE):
        print("No catalog.json found!")
        return

    with open(CATALOG_FILE, "r") as f:
        catalog = json.load(f)

    voices = catalog.get("voices", [])
    existing = set(os.listdir(PREVIEWS_DIR))

    to_generate = [v for v in voices if f"{v['id']}.mp3" not in existing]
    print(f"Total voices: {len(voices)}, existing previews: {len(existing)}, to generate: {len(to_generate)}")

    if not to_generate:
        print("All previews already exist!")
        return

    sem = asyncio.Semaphore(10)  # 10 concurrent edge-tts calls
    tasks = []
    for i, voice in enumerate(to_generate):
        edge_voice = EDGE_VOICES[i % len(EDGE_VOICES)]
        # Use gender to pick voice
        gender = voice.get("gender", "neutral")
        if gender == "female":
            edge_voice = EDGE_VOICES[i % 5 * 2]  # even indices are female
        elif gender == "male":
            edge_voice = EDGE_VOICES[i % 5 * 2 + 1] if i % 5 * 2 + 1 < len(EDGE_VOICES) else EDGE_VOICES[1]

        phrase = get_phrase(voice)
        tasks.append(generate_preview(voice["id"], phrase, edge_voice, sem))

    ok = 0
    fail = 0
    skip = 0
    start = time.time()

    results = await asyncio.gather(*tasks)
    for voice_id, status in results:
        if status == "ok":
            ok += 1
            if ok % 20 == 0:
                elapsed = time.time() - start
                print(f"  [{ok}/{len(to_generate)}] generated ({elapsed:.0f}s elapsed)")
        elif status == "skip":
            skip += 1
        else:
            fail += 1
            print(f"  FAIL {voice_id}: {status}")

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.0f}s: {ok} generated, {skip} skipped, {fail} failed")
    print(f"Total previews now: {len(os.listdir(PREVIEWS_DIR))}")


if __name__ == "__main__":
    asyncio.run(main())
