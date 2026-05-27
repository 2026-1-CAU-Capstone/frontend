"""Audio-only pre-download: pulls every channel video's bestaudio m4a so the
transcription step (which depends on the slower Whisper model download) can
run on cached files without waiting on network. Idempotent — skips files that
already exist. Safe to run alongside / before ingest_youtube.py.

Usage:  source .venv/bin/activate && python _audio_only.py [--channel easyonejazz] [--limit N]
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
DATA_ROOT = THIS_DIR.parent / "data" / "youtube"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--channel", default="easyonejazz")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--min-duration", type=float, default=0.0,
                   help="skip videos shorter than this (seconds). Use 120 to drop Shorts.")
    args = p.parse_args()

    audio_dir = DATA_ROOT / args.channel / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://www.youtube.com/@{args.channel}/videos"

    print(f"enumerating @{args.channel}...", flush=True)
    # When filtering by duration we need each entry's duration too. Tab-separated
    # output keeps the parse robust against titles containing pipes.
    fmt = "%(id)s\t%(duration)s" if args.min_duration > 0 else "%(id)s"
    out = subprocess.check_output(
        ["yt-dlp", "--flat-playlist", "--print", fmt, url],
        text=True,
    )
    if args.min_duration > 0:
        ids = []
        dropped = 0
        for line in out.splitlines():
            parts = line.strip().split("\t")
            if len(parts) != 2: continue
            vid, dur = parts
            try: d = float(dur) if dur and dur != "NA" else 0.0
            except ValueError: d = 0.0
            if d < args.min_duration:
                dropped += 1
                continue
            ids.append(vid)
        print(f"  enumerated, filtered out {dropped} short(<{args.min_duration:.0f}s) videos", flush=True)
    else:
        ids = [l.strip() for l in out.splitlines() if l.strip()]
    if args.limit:
        ids = ids[: args.limit]
    print(f"  {len(ids)} videos", flush=True)

    done = skipped = failed = 0
    t0 = time.time()
    for i, vid in enumerate(ids, 1):
        out_path = audio_dir / f"{vid}.m4a"
        if out_path.exists() and out_path.stat().st_size > 0:
            skipped += 1
            continue
        print(f"  [{i:3d}/{len(ids)}] {vid} ...", flush=True)
        try:
            subprocess.run(
                ["yt-dlp", "-x", "--audio-format", "m4a", "--audio-quality", "0",
                 "-o", str(audio_dir / f"{vid}.%(ext)s"),
                 "--no-progress", "--quiet",
                 f"https://www.youtube.com/watch?v={vid}"],
                check=True,
            )
            done += 1
        except subprocess.CalledProcessError as e:
            failed += 1
            print(f"      FAIL {vid}: {e}", file=sys.stderr, flush=True)

    print(f"\ndone: {done} new, {skipped} skipped, {failed} failed in "
          f"{time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
