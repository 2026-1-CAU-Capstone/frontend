"""Re-run the PoC pipeline (using all caches) and dump top-10 candidates as
mock JSON for the frontend UI to consume.

Output: src/data/mockOnsetSuggestions.json
  Keyed by videoId; each value has label + ground-truth + top-10 candidates.
"""
import json
from pathlib import Path

from lick_match_poc import (
    USE_DEMUCS,
    build_golden,
    fetch_audio,
    load_lick,
    match_lick,
    separate_solo_stem,
    transcribe,
)

OUT_PATH = Path(__file__).resolve().parents[2] / "src" / "data" / "mockOnsetSuggestions.json"


def main():
    golden = build_golden()
    out = {}
    for g in golden:
        audio = fetch_audio(g["videoId"])
        if USE_DEMUCS:
            audio = separate_solo_stem(audio)
        notes = transcribe(audio)
        if "pitches" in g:
            lick_pitch, lick_onset = g["pitches"], g["onsets"]
        else:
            raw = load_lick(g["raw_id"])
            lick_pitch, lick_onset = raw["pitch"], raw["onset"]
        cands = match_lick(lick_pitch, lick_onset, notes, top_k=10)
        # If multiple licks share a videoId, append by appending suffix.
        key = g["videoId"]
        if key in out:
            key = f"{g['videoId']}#{g.get('raw_id', g['label'])}"
        out[key] = {
            "label": g["label"],
            "gtStartSec": g["startSec"],
            "gtEndSec": g.get("endSec"),
            "nEvents": len(lick_pitch),
            "candidates": [
                {"startSec": round(c["startSec"], 3), "endSec": round(c["endSec"], 3), "score": round(c["score"], 4)}
                for c in cands
            ],
        }
        print(f"  {key}: {len(out[key]['candidates'])} candidates  (label: {g['label']})")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\nwrote {OUT_PATH}")


if __name__ == "__main__":
    main()
