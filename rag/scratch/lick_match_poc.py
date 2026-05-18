"""
Stage 0 PoC — match known licks against full YouTube audio.

Pipeline:
  1. yt-dlp           → cached .mp3
  2. basic-pitch      → transcribed [(onset, pitch, duration), ...]
  3. sliding window   → interval + IOI-ratio distance vs lick query
  4. compare top-3 candidate start times to ground truth (lickVideos.ts)

Run from repo root:
    rag/venv/bin/python rag/scratch/lick_match_poc.py
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
LICKS_JSON = REPO_ROOT / "public" / "data" / "licks" / "licks.json"
CACHE_DIR = Path(__file__).resolve().parent / "cache"
AUDIO_DIR = CACHE_DIR / "audio"
STEM_DIR = CACHE_DIR / "stems"
TRANSCRIPT_DIR = CACHE_DIR / "transcripts"

USE_DEMUCS = True  # set False to skip source separation

# Ground truth — hardcoded from src/data/lickVideos.ts
GOLDEN = [
    {"id": 2,  "videoId": "MV8wWjVqCng", "startSec": 137.0,  "endSec": None},
    {"id": 63, "videoId": "g3tETxZY7Vo", "startSec": 50.604, "endSec": 55.108},
    {"id": 64, "videoId": "HSeiIvBdAis", "startSec": 52.319, "endSec": 55.522},
]

HIT_TOLERANCE_S = 2.0  # how close to ground truth counts as a hit


def load_lick(lick_id: int) -> dict:
    with open(LICKS_JSON) as f:
        licks = json.load(f)
    for l in licks:
        if l.get("id") == lick_id:
            return l
    raise KeyError(f"lick id={lick_id} not found")


def separate_solo_stem(audio_path: Path) -> Path:
    """Demucs --two-stems=vocals separates vocals from rest; for jazz solos we
    want the 'other' stem (sax/clarinet end up there, not vocals). We use the
    4-stem htdemucs and keep only `other.wav`.
    """
    STEM_DIR.mkdir(parents=True, exist_ok=True)
    out = STEM_DIR / f"{audio_path.stem}_other.wav"
    if out.exists():
        return out

    work = STEM_DIR / "demucs_out"
    work.mkdir(parents=True, exist_ok=True)
    print(f"    demucs: separating stems for {audio_path.name}")
    subprocess.run(
        [
            sys.executable, "-m", "demucs",
            "-n", "htdemucs",
            "-o", str(work),
            str(audio_path),
        ],
        check=True,
    )
    src = work / "htdemucs" / audio_path.stem / "other.wav"
    if not src.exists():
        raise FileNotFoundError(f"demucs output missing: {src}")
    src.rename(out)
    return out


def fetch_audio(video_id: str) -> Path:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out = AUDIO_DIR / f"{video_id}.mp3"
    if out.exists():
        return out
    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"    yt-dlp: downloading {url}")
    subprocess.run(
        [
            "yt-dlp",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", str(AUDIO_DIR / f"{video_id}.%(ext)s"),
            url,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    return out


# basic-pitch options that bias toward solo/melody lines:
#  - min/max frequency cuts bass (<C3) and noise (>F#6)
#  - higher onset_threshold drops weak detections (chord backing, drum bleed)
#  - longer minimum_note_length drops percussive/transient blips
BP_OPTS = dict(
    minimum_frequency=130.0,   # C3 — excludes bass & low piano
    maximum_frequency=1500.0,  # ~F#6 — excludes high overtone artifacts
    onset_threshold=0.6,
    minimum_note_length=120.0,
)


def transcribe(audio_path: Path) -> list[dict]:
    """Return notes [{onset, pitch, duration}, ...] sorted by onset."""
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    cache = TRANSCRIPT_DIR / f"{audio_path.stem}.json"
    if cache.exists():
        return json.loads(cache.read_text())

    print(f"    basic-pitch: transcribing {audio_path.name} (range {BP_OPTS['minimum_frequency']:.0f}-{BP_OPTS['maximum_frequency']:.0f}Hz)")
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH

    _, _, note_events = predict(str(audio_path), ICASSP_2022_MODEL_PATH, **BP_OPTS)
    notes = [
        {"onset": float(start), "pitch": int(pitch), "duration": float(end - start)}
        for (start, end, pitch, *_rest) in note_events
    ]
    notes.sort(key=lambda n: n["onset"])
    cache.write_text(json.dumps(notes))
    return notes


def to_features(pitches: list[int], onsets: list[float]) -> np.ndarray:
    """2-D feature seq: [interval_semitones, log2_ioi_ratio_vs_median]. Length = len(pitches)-1."""
    if len(pitches) < 2:
        return np.zeros((0, 2))
    intervals = np.array([pitches[i + 1] - pitches[i] for i in range(len(pitches) - 1)], dtype=float)
    iois = np.array([onsets[i + 1] - onsets[i] for i in range(len(onsets) - 1)], dtype=float)
    med = float(np.median(iois)) if len(iois) > 0 and np.median(iois) > 0 else 1.0
    log_ioi = np.log2(np.clip(iois / med, 1e-3, None))
    return np.stack([intervals, log_ioi], axis=1)  # (Q-1, 2)


# Distance: octave-invariant interval cost + IOI cost.
INTERVAL_OCTAVE_INV = True
IOI_WEIGHT = 1.5


def _step_cost(q_row: np.ndarray, r_row: np.ndarray) -> float:
    di = q_row[0] - r_row[0]
    if INTERVAL_OCTAVE_INV:
        di = abs(((di + 6) % 12) - 6)
    else:
        di = abs(di)
    do = abs(q_row[1] - r_row[1])
    return float(di + IOI_WEIGHT * do)


def subseq_dtw_topk(query: np.ndarray, ref: np.ndarray, top_k: int = 10):
    """Subsequence DTW. Returns [(start_idx, end_idx, normalized_cost), ...] sorted by cost."""
    Q, R = len(query), len(ref)
    if Q == 0 or R < Q:
        return []

    INF = float("inf")
    D = np.full((Q + 1, R + 1), INF)
    D[0, :] = 0.0
    start_of = np.zeros((Q + 1, R + 1), dtype=np.int32)
    for j in range(R + 1):
        start_of[0, j] = j

    for i in range(1, Q + 1):
        for j in range(1, R + 1):
            c = _step_cost(query[i - 1], ref[j - 1])
            # three predecessors: diagonal (match), up (insertion in ref), left (deletion in ref)
            choices = (D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
            starts = (start_of[i - 1, j - 1], start_of[i - 1, j], start_of[i, j - 1])
            k = int(np.argmin(choices))
            D[i, j] = choices[k] + c
            start_of[i, j] = starts[k]

    end_costs = D[Q, 1:]  # cost when ending at ref index j-1 (0-indexed)
    starts = start_of[Q, 1:]
    # Non-max suppression: keep local minima within ±Q/2 window
    half = max(1, Q // 2)
    matches = []
    for j in range(R):
        if not np.isfinite(end_costs[j]):
            continue
        lo, hi = max(0, j - half), min(R, j + half + 1)
        if end_costs[j] <= end_costs[lo:hi].min() + 1e-9:
            # normalize cost by path length so longer paths aren't penalized
            path_len = (j - starts[j]) + Q
            matches.append((int(starts[j]), j + 1, float(end_costs[j] / max(1, path_len))))
    # dedupe near-duplicates by start position
    matches.sort(key=lambda m: m[2])
    deduped = []
    for s, e, c in matches:
        if any(abs(s - ds) < half for ds, _, _ in deduped):
            continue
        deduped.append((s, e, c))
        if len(deduped) >= top_k:
            break
    return deduped


def match_lick(lick_pitch, lick_onset, transcript_notes, top_k=10):
    q_feat = to_features(lick_pitch, lick_onset)
    if len(q_feat) == 0:
        return []
    ref_pitch = [n["pitch"] for n in transcript_notes]
    ref_onset = [n["onset"] for n in transcript_notes]
    r_feat = to_features(ref_pitch, ref_onset)
    matches = subseq_dtw_topk(q_feat, r_feat, top_k=top_k)
    return [
        {
            "startSec": ref_onset[s],
            "endSec": ref_onset[min(e, len(ref_onset) - 1)] + transcript_notes[min(e, len(transcript_notes) - 1)]["duration"],
            "score": cost,
        }
        for (s, e, cost) in matches
    ]


def main():
    print(f"PoC: matching {len(GOLDEN)} golden licks against full audio\n")
    rows = []
    for g in GOLDEN:
        print(f"=== lick id={g['id']}  videoId={g['videoId']}  ground_truth_start={g['startSec']}s ===")
        lick = load_lick(g["id"])
        print(f"    {lick.get('performer')} — {lick.get('title')}  ({lick.get('instrument')}, n_events={lick.get('n_events')})")
        audio = fetch_audio(g["videoId"])
        if USE_DEMUCS:
            audio = separate_solo_stem(audio)
        notes = transcribe(audio)
        if notes:
            print(f"    transcript: {len(notes)} notes over {notes[-1]['onset']:.1f}s")
        cands = match_lick(lick["pitch"], lick["onset"], notes, top_k=10)
        gt_rank = None
        for j, c in enumerate(cands, 1):
            err = abs(c["startSec"] - g["startSec"])
            mark = "HIT" if err < HIT_TOLERANCE_S else "   "
            if err < HIT_TOLERANCE_S and gt_rank is None:
                gt_rank = j
            print(f"    {mark} #{j:2d}  start={c['startSec']:7.2f}s  score={c['score']:.3f}  err={err:6.2f}s")
        top3_hit = gt_rank is not None and gt_rank <= 3
        top10_hit = gt_rank is not None
        top1_err = abs(cands[0]["startSec"] - g["startSec"]) if cands else None
        rows.append({"id": g["id"], "top3_hit": top3_hit, "top10_hit": top10_hit, "gt_rank": gt_rank, "top1_err": top1_err})
        print()

    print("=" * 60)
    print("SUMMARY")
    h3 = sum(1 for r in rows if r["top3_hit"])
    h10 = sum(1 for r in rows if r["top10_hit"])
    print(f"  Top-3  hit rate (within {HIT_TOLERANCE_S}s): {h3}/{len(rows)}")
    print(f"  Top-10 hit rate (within {HIT_TOLERANCE_S}s): {h10}/{len(rows)}")
    for r in rows:
        err_str = f"{r['top1_err']:.2f}s" if r["top1_err"] is not None else "n/a"
        rank_str = f"#{r['gt_rank']}" if r["gt_rank"] is not None else "miss"
        print(f"  id={r['id']:<3}  gt_rank={rank_str:<5}  top1_err={err_str}")


if __name__ == "__main__":
    main()
