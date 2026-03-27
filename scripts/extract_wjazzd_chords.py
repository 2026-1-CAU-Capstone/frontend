#!/usr/bin/env python3
"""
Extract chord annotations from WJazzD SQLite database.

Produces one JSON file per solo matching the omnibook chord format:
  { title, composer, key, timeSignature, tempo, chords: [{measure, beat, symbol}] }

Prerequisites:
  Download wjazzd.db from https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db

Usage:
  scripts/.venv/bin/python3 scripts/extract_wjazzd_chords.py [path/to/wjazzd.db]

Output: data/wjazzd/chords/
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHORD_DIR = ROOT / 'data' / 'wjazzd' / 'chords'
DEFAULT_DB = Path('/tmp/wjazzd.db')


def extract(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    CHORD_DIR.mkdir(parents=True, exist_ok=True)

    # Get all solos with metadata
    cur.execute("""
        SELECT s.melid, s.performer, s.title, s.titleaddon, s.solopart,
               s.instrument, s.style, s.avgtempo, s.tempoclass,
               s.rhythmfeel, s.key, s.signature, s.chord_changes,
               c.composer, c.form, c.tonalitytype, c.genre,
               t.filename_sv
        FROM solo_info s
        JOIN composition_info c ON s.compid = c.compid
        LEFT JOIN transcription_info t ON s.melid = t.melid
    """)
    solos = cur.fetchall()

    count = 0
    for solo in solos:
        melid = solo['melid']
        performer = solo['performer']
        title = solo['title']
        composer = solo['composer']
        key_sig = solo['key'] or 'C'
        time_sig = solo['signature'] or '4/4'
        tempo = solo['avgtempo']

        # Get chord sections for this solo
        cur.execute("""
            SELECT start, end, value
            FROM sections
            WHERE melid = ? AND type = 'CHORD'
            ORDER BY start
        """, (melid,))
        chord_rows = cur.fetchall()

        chords = []
        for row in chord_rows:
            bar_start = row['start']
            symbol = row['value']
            # WJazzD bars are 0-indexed, convert to 1-indexed
            chords.append({
                'measure': bar_start + 1,
                'beat': 1.0,
                'symbol': symbol,
            })

        # Build filename from the MIDI filename pattern
        # e.g., "ArtPepper_Anthropology_FINAL.sv" → "ArtPepper_Anthropology_FINAL"
        filename_sv = solo['filename_sv'] or ''
        base = filename_sv.replace('.sv', '') if filename_sv else f"{performer}_{title}".replace(' ', '')

        annotation = {
            'title': title,
            'composer': composer,
            'performer': performer,
            'key': key_sig,
            'timeSignature': time_sig,
            'tempo': round(tempo) if tempo else None,
            'style': solo['style'],
            'rhythmfeel': solo['rhythmfeel'],
            'instrument': solo['instrument'],
            'form': solo['form'],
            'genre': solo['genre'],
            'chords': chords,
        }

        out_path = CHORD_DIR / f'{base}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(annotation, f, indent=2, ensure_ascii=False)
        count += 1

        if count <= 5 or count % 50 == 0:
            print(f'  [{count:3d}/{len(solos)}] {base:<45s} key={key_sig:<6s} chords={len(chords)}')

    conn.close()
    print(f'\nDone: {count} chord annotation files → {CHORD_DIR}')


def main():
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    if not db_path.exists():
        print(f'ERROR: Database not found: {db_path}')
        print(f'Download from: https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db')
        sys.exit(1)

    print(f'Reading: {db_path}')
    print(f'Output:  {CHORD_DIR}\n')
    extract(db_path)


if __name__ == '__main__':
    main()
