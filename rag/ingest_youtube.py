"""
YouTube channel ingest: enumerate → download audio → mlx-whisper transcribe → JSON.

The channel owner (user) has authorized download/transcription of @easyonejazz.

Resumable: each video produces a single JSON; if it already exists we skip both
the audio download and the Whisper pass. Safe to re-run after interruption.

Output layout (relative to repo root):

    frontend/data/youtube/<channel>/audio/<video_id>.m4a       (cached input)
    frontend/data/youtube/<channel>/transcripts/<video_id>.json
    frontend/data/youtube/<channel>/_index.json                (run summary)

Transcript JSON shape:
{
  "video_id":  "0GCxcRkaCcw",
  "title":     "...",
  "channel":   "easyonejazz",
  "url":       "https://www.youtube.com/watch?v=...",
  "duration":  508.0,
  "language":  "ko",                       # whisper-detected
  "segments":  [{"start": 0.0, "end": 4.2, "text": "..."}, ...],
  "text":      "...full transcript joined..."
}

Run:  source .venv/bin/activate && python ingest_youtube.py
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Resolve frontend/data/youtube/<channel>/ relative to this script's location
# so the path is stable regardless of cwd.
THIS_DIR = Path(__file__).resolve().parent
DATA_ROOT = THIS_DIR.parent / "data" / "youtube"

# Whisper backend.
#
# Originally targeted mlx-whisper (GPU on Apple Silicon, large-v3) but the
# HF Hub throttles unauthenticated multi-GB downloads to the point of stalling.
# faster-whisper-small ships pre-cached on this machine (~460MB) and is good
# enough for jazz pedagogy RAG — embeddings tolerate transcription noise well
# as long as concept words land. To upgrade: set HF_TOKEN and switch to
# "Systran/faster-whisper-large-v3" (the model fetch will be fast enough).
WHISPER_MODEL = "Systran/faster-whisper-small"
# CPU is reliable everywhere; flip to "auto" if you have a working MLX/CUDA.
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"  # fast on CPU, modest quality hit


def list_channel_videos(channel_url: str) -> list[dict]:
    """yt-dlp flat-playlist enumeration. Returns [{id, title, duration}]."""
    out = subprocess.check_output(
        ["yt-dlp", "--flat-playlist",
         "--print", "%(id)s\t%(duration)s\t%(title)s",
         channel_url],
        text=True,
    )
    videos = []
    for line in out.strip().splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        vid, dur, title = parts
        try:
            duration = float(dur) if dur and dur != "NA" else 0.0
        except ValueError:
            duration = 0.0
        videos.append({"id": vid, "title": title, "duration": duration})
    return videos


def download_audio(video_id: str, out_path: Path) -> bool:
    """Download bestaudio as m4a. Returns True on success."""
    if out_path.exists() and out_path.stat().st_size > 0:
        return True
    out_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        subprocess.run(
            ["yt-dlp",
             "-x", "--audio-format", "m4a", "--audio-quality", "0",
             "-o", str(out_path.with_suffix(".%(ext)s")),
             "--no-progress", "--quiet",
             url],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"  ✗ download failed ({video_id}): {e}", file=sys.stderr)
        return False
    return out_path.exists()


def load_whisper_model():
    """Load WhisperModel once for the whole batch. Imported lazily so --list
    works without the heavy dep being available."""
    from faster_whisper import WhisperModel
    return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE,
                        compute_type=WHISPER_COMPUTE_TYPE)


def transcribe(model, audio_path: Path) -> dict | None:
    """faster-whisper transcription. Returns {language, segments, text}."""
    try:
        segments_gen, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            word_timestamps=False,  # segment-level is enough for deep-links
            language=None,           # auto-detect (channel mixes KR/EN)
            vad_filter=True,         # drop long silences — fewer hallucinations
        )
        # Materialize the generator (faster-whisper streams lazily).
        segments = [{"start": float(s.start), "end": float(s.end),
                     "text": s.text} for s in segments_gen]
    except Exception as e:
        print(f"  ✗ transcribe failed ({audio_path.name}): {e}", file=sys.stderr)
        return None
    return {
        "language": info.language,
        "segments": segments,
        "text": " ".join(s["text"].strip() for s in segments),
    }


def save_transcript(*, video: dict, channel: str, result: dict, path: Path) -> None:
    """Normalize mlx-whisper output to our canonical schema."""
    segments = [
        {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
        for s in result.get("segments", [])
    ]
    payload = {
        "video_id":  video["id"],
        "title":     video["title"],
        "channel":   channel,
        "url":       f"https://www.youtube.com/watch?v={video['id']}",
        "duration":  video.get("duration", 0.0),
        "language":  result.get("language", ""),
        "segments":  segments,
        "text":      (result.get("text") or "").strip(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main():
    p = argparse.ArgumentParser(description="Ingest a YouTube channel into local transcripts.")
    p.add_argument("--channel", default="easyonejazz",
                   help="channel handle without leading @ (default: easyonejazz)")
    p.add_argument("--limit", type=int, default=0,
                   help="process only the first N videos (0 = all)")
    p.add_argument("--min-duration", type=float, default=0.0,
                   help="skip videos shorter than this (seconds). Use 120 to drop Shorts.")
    p.add_argument("--keep-audio", action="store_true",
                   help="don't delete the cached m4a after transcription")
    p.add_argument("--list", action="store_true",
                   help="enumerate videos and exit (no download/transcribe)")
    args = p.parse_args()

    channel = args.channel
    channel_url = f"https://www.youtube.com/@{channel}/videos"
    audio_dir = DATA_ROOT / channel / "audio"
    transcript_dir = DATA_ROOT / channel / "transcripts"
    index_path = DATA_ROOT / channel / "_index.json"

    print(f"channel: @{channel}")
    print(f"output:  {transcript_dir}")

    print("\n[1/2] enumerating videos…")
    videos = list_channel_videos(channel_url)
    print(f"      {len(videos)} videos")
    if args.min_duration > 0:
        before = len(videos)
        videos = [v for v in videos if v.get("duration", 0) >= args.min_duration]
        print(f"      filtered Shorts (<{args.min_duration:.0f}s): {before} → {len(videos)}")
    if args.limit:
        videos = videos[: args.limit]
        print(f"      limited to first {len(videos)}")

    if args.list:
        for v in videos:
            print(f"  {v['id']}  {int(v['duration']):4d}s  {v['title']}")
        return

    print(f"\n[2/2] downloading + transcribing (model: {WHISPER_MODEL})")
    print("      loading whisper model (one-time)…", flush=True)
    model = load_whisper_model()
    print("      model ready.", flush=True)

    done = 0
    skipped = 0
    failed: list[str] = []
    started_at = time.time()

    for i, v in enumerate(videos, 1):
        vid = v["id"]
        title = v["title"]
        tpath = transcript_dir / f"{vid}.json"
        apath = audio_dir / f"{vid}.m4a"

        prefix = f"  [{i:3d}/{len(videos)}] {vid}"
        if tpath.exists():
            skipped += 1
            print(f"{prefix}  ✓ already transcribed — skip", flush=True)
            continue

        print(f"{prefix}  → download…", flush=True)
        if not download_audio(vid, apath):
            failed.append(vid)
            continue

        print(f"{prefix}  → transcribe ({int(v['duration'])}s audio)…", flush=True)
        t0 = time.time()
        result = transcribe(model, apath)
        if result is None:
            failed.append(vid)
            continue
        elapsed = time.time() - t0

        save_transcript(video=v, channel=channel, result=result, path=tpath)
        if not args.keep_audio:
            try: apath.unlink()
            except OSError: pass

        done += 1
        print(f"{prefix}  ✓ {len(result.get('segments', []))} segments, "
              f"{elapsed:.1f}s  ({title[:60]})", flush=True)

    # Run summary — also written to _index.json for downstream tooling.
    summary = {
        "channel":   channel,
        "videos":    len(videos),
        "done":      done,
        "skipped":   skipped,
        "failed":    failed,
        "elapsed_s": round(time.time() - started_at, 1),
    }
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\nsummary: {summary}")


if __name__ == "__main__":
    main()
