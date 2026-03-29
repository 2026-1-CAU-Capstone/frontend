#!/usr/bin/env python3
"""
Export EsAC melodies from SQLite to individual MIDI files.

Usage:
  /tmp/esac_venv/bin/python3 scripts/export_esac_midi.py [path/to/esac.db]

Output: data/esac/*.mid
"""

import sqlite3
import sys
import re
from pathlib import Path
from midiutil import MIDIFile

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "esac.db"
OUT_DIR = ROOT / "data" / "esac"

# Map section KEY values like "G min" → MIDI key signature params
KEY_ROOT_MAP = {
    "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
    "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7,
    "A#": -2, "D#": -3, "G#": -4,
}


def safe_filename(s: str) -> str:
    """Remove or replace characters unsafe for filenames."""
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', s)
    s = s.replace(' ', '_')
    return s[:80]


def export(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load metadata
    cur.execute("""
        SELECT melid, collection, title, esacid, key, signature
        FROM esac_info
        ORDER BY melid
    """)
    infos = {row["melid"]: dict(row) for row in cur.fetchall()}

    # Load KEY sections
    cur.execute("SELECT melid, value FROM sections WHERE type = 'KEY'")
    key_map = {row["melid"]: row["value"] for row in cur.fetchall()}

    # Load all melody events
    cur.execute("""
        SELECT melid, onset, pitch, duration, beatdur
        FROM melody
        ORDER BY melid, onset
    """)

    from collections import defaultdict
    mel_events: dict[int, list] = defaultdict(list)
    for row in cur.fetchall():
        mel_events[row["melid"]].append(dict(row))

    conn.close()

    count = 0
    for melid, info in infos.items():
        events = mel_events.get(melid, [])
        if len(events) < 4:
            continue

        beatdur = events[0]["beatdur"] or 0.5
        bpm = 60.0 / beatdur

        # Parse time signature
        sig = info["signature"] or "4/4"
        if sig == "FREE" or "/" not in sig:
            sig = "4/4"
        if " " in sig:
            sig = sig.split()[0]

        try:
            num, denom = map(int, sig.split("/"))
        except ValueError:
            num, denom = 4, 4

        # Parse key
        key_raw = key_map.get(melid, f"{info['key']} maj")
        key_parts = key_raw.strip().split()
        key_root = key_parts[0] if key_parts else "C"
        key_mode = key_parts[1] if len(key_parts) > 1 else "maj"

        # Create MIDI
        midi = MIDIFile(1, deinterleave=False)
        midi.addTempo(0, 0, bpm)
        midi.addTimeSignature(0, 0, num, int.bit_length(denom) - 1, 24, 8)

        # Key signature
        sf = KEY_ROOT_MAP.get(key_root, 0)
        mi = 1 if key_mode == "min" else 0
        # addKeySignature(track, time, accidentals, accidental_type, mode)
        # accidental_type: 0=flats, 1=sharps
        n_acc = abs(sf)
        acc_type = 0 if sf < 0 else 1
        midi.addKeySignature(0, 0, n_acc, acc_type, mi)

        for ev in events:
            onset_beats = ev["onset"]
            dur_beats = max(ev["duration"], 0.1)
            pitch = int(ev["pitch"])
            midi.addNote(0, 0, pitch, onset_beats, dur_beats, 80)

        # Filename: Collection_Title_esacid.mid
        collection = safe_filename(info["collection"] or "unknown")
        title = safe_filename(info["title"] or info["esacid"] or str(melid))
        esacid = info["esacid"] or ""
        fn = f"{collection}_{title}_{esacid}.mid"

        out_path = OUT_DIR / fn
        with open(out_path, "wb") as f:
            midi.writeFile(f)
        count += 1

        if count <= 5 or count % 500 == 0:
            print(f"  [{count:5d}/{len(infos)}] {fn}")

    print(f"\nDone: {count} MIDI files → {OUT_DIR}")


def main():
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    if not db_path.exists():
        print(f"ERROR: Database not found: {db_path}")
        sys.exit(1)

    print(f"Reading: {db_path}")
    export(db_path)


if __name__ == "__main__":
    main()
