#!/usr/bin/env python3
"""
build-catalog.py — Scans model directories on the VPS and generates a public
catalog.json consumed by the KiloCode Voice Studio frontend.

Usage:
    python3 build-catalog.py [--models-dir DIR] [--metadata FILE] [--output FILE]

Environment:
    MODEL_SERVER_URL  Base URL for download/preview links (default: https://voice.daveai.tech)
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

MODEL_EXTENSIONS = {".pth", ".onnx", ".safetensors", ".pt", ".ckpt"}

DEFAULT_MODELS_DIR = "/opt/rvc-models/models"
DEFAULT_METADATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-metadata.json")
DEFAULT_OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog.json")
DEFAULT_PREVIEWS_DIR = "/opt/rvc-models/previews"

FEMALE_KEYWORDS = {"female", "girl", "woman", "she", "her", "luna", "rose", "ariana", "manon", "daniela", "ami", "makoto", "asuka", "noel", "whisper"}
MALE_KEYWORDS = {"male", "man", "boy", "he", "him", "kanye", "elvis", "liberty"}


def slugify(text: str) -> str:
    """Convert a string to a URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def detect_gender(dir_name: str) -> str:
    """Guess gender from directory name keywords."""
    lower = dir_name.lower().replace("-", " ").replace("_", " ")
    tokens = set(lower.split())
    if tokens & FEMALE_KEYWORDS:
        return "female"
    if tokens & MALE_KEYWORDS:
        return "male"
    return "neutral"


def detect_category(rel_path: str) -> str:
    """Derive a category from the top-level directory in the relative path."""
    parts = rel_path.replace("\\", "/").split("/")
    if len(parts) >= 1:
        first = parts[0].lower()
        if "rvc" in first:
            return "rvc"
        if "kokoro" in first:
            return "kokoro"
        if "xtts" in first:
            return "xtts"
        if "f5" in first:
            return "f5-tts"
        if "style" in first:
            return "styletts2"
    return "other"


def humanize_name(dir_name: str) -> str:
    """Turn a directory name like 'ariana-grande-2010s' into 'Ariana Grande 2010s'."""
    name = dir_name.replace("-", " ").replace("_", " ")
    return " ".join(word.capitalize() if not word[0].isdigit() else word for word in name.split())


def find_model_files(directory: Path) -> list[Path]:
    """Recursively find all model files by extension."""
    files = []
    if not directory.is_dir():
        return files
    for item in directory.rglob("*"):
        if item.is_file() and item.suffix.lower() in MODEL_EXTENSIONS:
            files.append(item)
    return files


def get_total_size(files: list[Path]) -> int:
    """Sum file sizes in bytes."""
    return sum(f.stat().st_size for f in files)


def get_added_at(files: list[Path]) -> str:
    """Return the earliest modification time among files as ISO-8601."""
    if not files:
        return datetime.now(timezone.utc).isoformat()
    earliest = min(f.stat().st_mtime for f in files)
    return datetime.fromtimestamp(earliest, tz=timezone.utc).isoformat()


def build_catalog(models_dir: str, metadata_file: str, output_file: str) -> None:
    base_url = os.environ.get("MODEL_SERVER_URL", "https://voice.daveai.tech").rstrip("/")
    models_path = Path(models_dir)
    previews_path = Path(DEFAULT_PREVIEWS_DIR)

    # Load metadata overrides
    metadata: dict = {}
    if os.path.isfile(metadata_file):
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        # Remove the comment key
        metadata.pop("_comment", None)
        print(f"Loaded {len(metadata)} metadata overrides from {metadata_file}")
    else:
        print(f"Warning: metadata file not found at {metadata_file}, using auto-detection only")

    if not models_path.is_dir():
        print(f"Error: models directory does not exist: {models_dir}", file=sys.stderr)
        sys.exit(1)

    # Discover all model directories (leaf dirs containing model files)
    # Walk all subdirectories, group model files by their parent relative to models_dir
    all_model_files: dict[str, list[Path]] = {}
    for model_file in find_model_files(models_path):
        rel = model_file.parent.relative_to(models_path)
        rel_str = str(rel).replace("\\", "/")
        if rel_str not in all_model_files:
            all_model_files[rel_str] = []
        all_model_files[rel_str].append(model_file)

    # Also include metadata keys that may point to directories we haven't scanned
    # (useful when models are organized with deeper nesting)
    for meta_key in metadata:
        meta_path = models_path / meta_key
        if meta_path.is_dir() and meta_key not in all_model_files:
            files = find_model_files(meta_path)
            if files:
                all_model_files[meta_key] = files

    voices: list[dict] = []
    total_size = 0

    for rel_path, files in all_model_files.items():
        dir_name = rel_path.split("/")[-1]
        voice_id = slugify(rel_path.replace("/", "-"))
        file_size = get_total_size(files)
        total_size += file_size

        # Start with auto-detected defaults
        voice: dict = {
            "id": voice_id,
            "name": humanize_name(dir_name),
            "description": f"Auto-detected voice model from {rel_path}",
            "gender": detect_gender(dir_name),
            "accent": "en-US",
            "accentLabel": "American English",
            "style": "natural",
            "quality": 3,
            "sampleRate": 24000,
            "fileSize": file_size,
            "tags": [],
            "downloadUrl": f"{base_url}/models/{rel_path}",
            "heroClipUrl": None,
            "category": detect_category(rel_path),
            "addedAt": get_added_at(files),
        }

        # Apply metadata overrides
        overrides = metadata.get(rel_path, {})
        for key, value in overrides.items():
            voice[key] = value

        # Ensure the id stays consistent (don't let metadata override it)
        voice["id"] = voice_id

        # Check for preview clip
        preview_file = previews_path / f"{voice_id}.mp3"
        if preview_file.is_file() and preview_file.stat().st_size > 1000:
            voice["heroClipUrl"] = f"{base_url}/previews/{voice_id}.mp3"

        voices.append(voice)

    # Sort by quality descending, then name ascending
    voices.sort(key=lambda v: (-v["quality"], v["name"].lower()))

    catalog = {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalModels": len(voices),
        "totalSizeBytes": total_size,
        "voices": voices,
    }

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"Catalog written to {output_file}")
    print(f"  Total voices: {len(voices)}")
    print(f"  Total size:   {total_size / (1024 * 1024):.1f} MB")
    print(f"  Categories:   {', '.join(sorted(set(v['category'] for v in voices)))}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a voice catalog JSON from model directories and metadata overrides."
    )
    parser.add_argument(
        "--models-dir",
        default=DEFAULT_MODELS_DIR,
        help=f"Path to models directory (default: {DEFAULT_MODELS_DIR})",
    )
    parser.add_argument(
        "--metadata",
        default=DEFAULT_METADATA_FILE,
        help=f"Path to model-metadata.json (default: {DEFAULT_METADATA_FILE})",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_FILE,
        help=f"Path to output catalog.json (default: {DEFAULT_OUTPUT_FILE})",
    )
    args = parser.parse_args()
    build_catalog(args.models_dir, args.metadata, args.output)


if __name__ == "__main__":
    main()
