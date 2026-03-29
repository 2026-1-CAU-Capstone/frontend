#!/usr/bin/env python3
"""
Extract melodies from EsAC SQLite database into licks.json format.

Produces a single JSON array matching the RawLick interface used by
the frontend (same shape as public/data/licks/licks.json from WJazzD).

Usage:
  python3 scripts/extract_esac.py [path/to/esac.db]

Output: public/data/esac/esac_licks.json
"""

import json
import math
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "esac.db"
OUT_DIR = ROOT / "public" / "data" / "esac"

# ── key normalisation ────────────────────────────────────────────────────────

# EsAC sections KEY values use "A# maj" etc.  Convert to wjazzd format "Bb-maj".
ENHARMONIC = {
    "A#": "Bb", "D#": "Eb", "G#": "Ab", "C#": "Db", "F#": "F#",
    "Cb": "B",  "Fb": "E",
}


def normalise_key(raw: str) -> str:
    """'G min' → 'G-min', 'A# maj' → 'Bb-maj'"""
    parts = raw.strip().split()
    if len(parts) != 2:
        return "C-maj"
    root, mode = parts
    root = ENHARMONIC.get(root, root)
    return f"{root}-{mode}"


# ── feature computation ──────────────────────────────────────────────────────

def fuzzy(iv: int) -> int:
    a = abs(iv)
    s = 1 if iv > 0 else (-1 if iv < 0 else 0)
    if a == 0:
        return 0
    if a <= 2:
        return s
    if a <= 4:
        return 2 * s
    if a <= 7:
        return 3 * s
    return 4 * s


def dur_class(beats: float) -> int:
    if beats >= 2:
        return 2
    if beats >= 1:
        return 1
    if beats >= 0.5:
        return 0
    if beats >= 0.25:
        return -1
    return -2


# ── main extraction ─────────────────────────────────────────────────────────

def extract(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── load metadata ────────────────────────────────────────────────────────
    cur = conn.cursor()
    cur.execute("""
        SELECT e.melid, e.collection, e.title, e.esacid, e.key,
               e.signature, e.region, e.function, e.tunefamily
        FROM esac_info e
        ORDER BY e.melid
    """)
    infos = {row["melid"]: dict(row) for row in cur.fetchall()}

    # ── load KEY sections ────────────────────────────────────────────────────
    cur.execute("SELECT melid, value FROM sections WHERE type = 'KEY'")
    key_map = {row["melid"]: row["value"] for row in cur.fetchall()}

    # ── load all melody events (sorted) ──────────────────────────────────────
    cur.execute("""
        SELECT melid, onset, pitch, duration, bar, beat, tatum, beatdur
        FROM melody
        ORDER BY melid, onset
    """)
    # group by melid
    from collections import defaultdict
    mel_events: dict[int, list] = defaultdict(list)
    for row in cur.fetchall():
        mel_events[row["melid"]].append(dict(row))

    conn.close()

    # ── build lick entries ───────────────────────────────────────────────────
    licks = []
    skipped = 0

    for melid, info in infos.items():
        events = mel_events.get(melid, [])
        if len(events) < 4:
            skipped += 1
            continue

        key_raw = key_map.get(melid, f"{info['key']} maj")
        key_norm = normalise_key(key_raw)

        pitches = [int(e["pitch"]) for e in events]
        onsets  = [e["onset"] for e in events]
        durs    = [e["duration"] for e in events]
        bars    = [e["bar"] for e in events]
        beats   = [e["beat"] for e in events]
        tatums  = [e["tatum"] for e in events]
        beatdur = events[0]["beatdur"] or 0.5

        # tempo from beatdur (beats per minute)
        tempo = round(60.0 / beatdur) if beatdur > 0 else None

        # intervals
        intervals = [pitches[i] - pitches[i - 1] for i in range(1, len(pitches))]
        parsons   = [1 if iv > 0 else (-1 if iv < 0 else 0) for iv in intervals]
        fuzzy_ivs = [fuzzy(iv) for iv in intervals]
        pcs       = [p % 12 for p in pitches]
        dur_cls   = [dur_class(d / beatdur) for d in durs]

        sig = info["signature"] or "4/4"
        # normalise FREE → 4/4 for display
        if sig == "FREE" or "/" not in sig:
            sig = "4/4"
        # handle compound sigs like "4/2 6/2" → take first
        if " " in sig:
            sig = sig.split()[0]

        collection = info["collection"] or ""
        title = info["title"] or info["esacid"] or ""
        region = info["region"] or ""
        tag = info["tunefamily"] or collection

        lick = {
            "id": len(licks),
            "melid": melid,
            "start_idx": 0,
            "end_idx": len(events) - 1,
            "n_events": len(events),
            "tag": tag,
            "base_tag": collection,
            "performer": collection,
            "title": title,
            "instrument": "voice",
            "style": collection,
            "tempo": tempo,
            "key": key_norm,
            "rhythmfeel": "",
            "signature": sig,
            "region": region,
            "chords": [],
            "chords_per_event": [None] * len(events),
            "pitch": pitches,
            "onset": onsets,
            "duration": durs,
            "bar": bars,
            "beat": beats,
            "tatum": tatums,
            "interval": intervals,
            "parsons": parsons,
            "fuzzy_interval": fuzzy_ivs,
            "pitch_class": pcs,
            "chordal_pc": [None] * len(events),
            "chordal_diatonic_pc": [None] * len(events),
            "duration_class": dur_cls,
        }
        licks.append(lick)

    out_path = OUT_DIR / "esac_licks.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(licks, f, ensure_ascii=False)

    print(f"Extracted {len(licks)} melodies ({skipped} skipped < 4 notes)")
    print(f"Output: {out_path} ({out_path.stat().st_size / 1024 / 1024:.1f} MB)")


def main():
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    if not db_path.exists():
        print(f"ERROR: Database not found: {db_path}")
        sys.exit(1)

    print(f"Reading: {db_path}")
    extract(db_path)


if __name__ == "__main__":
    main()
