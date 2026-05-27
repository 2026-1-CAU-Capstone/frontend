"""
data/youtube/easyonejazz/transcripts/<id>.json  →  data/이지원재즈/<id>.txt

One .txt per video. Format:

    # <video title>
    <video url>
    <duration>초 · <language>

    <full transcript text — joined from Whisper segments, one line per segment>

Skips videos with empty/no-speech transcripts (Whisper VAD dropped everything).

Run:  source .venv/bin/activate && python transcripts_to_txt.py
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
SRC_DIR = THIS_DIR.parent / "data" / "youtube" / "easyonejazz" / "transcripts"
OUT_DIR = THIS_DIR.parent / "data" / "이지원재즈"


def safe_slug(text: str, limit: int = 40) -> str:
    """Best-effort filesystem-safe slug from a (Korean-heavy) title."""
    # Drop characters that are bad for filenames; keep Hangul + alphanumerics.
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit] if cleaned else "untitled"


def main():
    if not SRC_DIR.is_dir():
        print(f"✗ {SRC_DIR} not found", file=sys.stderr)
        sys.exit(1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    written = 0
    skipped_empty = 0
    src_files = sorted(SRC_DIR.glob("*.json"))
    for path in src_files:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        segments = d.get("segments") or []
        full_text = (d.get("text") or "").strip()
        if not full_text and not segments:
            skipped_empty += 1
            continue

        body = "\n".join(s["text"].strip() for s in segments if s.get("text", "").strip()) \
               or full_text

        title = (d.get("title") or "").strip()
        url = (d.get("url") or "").strip()
        duration = int(d.get("duration") or 0)
        language = d.get("language") or ""

        header = (
            f"# {title}\n"
            f"{url}\n"
            f"{duration}초 · {language}\n"
            "\n"
        )

        # Filename: <slug>__<video_id>.txt — slug for human browsing,
        # video_id for uniqueness and re-linking back to the JSON.
        slug = safe_slug(title)
        out_path = OUT_DIR / f"{slug}__{d['video_id']}.txt"
        out_path.write_text(header + body + "\n", encoding="utf-8")
        written += 1

    print(f"wrote {written} .txt files into {OUT_DIR.relative_to(THIS_DIR.parent)}/")
    if skipped_empty:
        print(f"  ({skipped_empty} empty transcripts skipped — Whisper VAD found no speech)")


if __name__ == "__main__":
    main()
