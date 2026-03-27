#!/usr/bin/env python3
"""
Extract licks from wjazzd.db → licks.json

Reads the Weimar Jazz Database (read-only) and extracts all sections
tagged as lick-related IDEAs, enriches each with:
  - raw melody events (pitch, onset, duration, bar, beat, tatum)
  - chord context per event
  - solo metadata (performer, title, instrument, style, tempo, key)
  - computed transformations: interval, parsons, fuzzy, pc, cpc, cdpc, durclass

Output: licks.json — array of lick objects
"""

import sqlite3
import json
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'wjazzd.db')
OUT_PATH = os.path.join(os.path.dirname(__file__), 'licks.json')

# ─── Transformation helpers ──────────────────────────────────────────

def intervals(pitches):
    """Semitone intervals between consecutive pitches."""
    return [int(pitches[i+1] - pitches[i]) for i in range(len(pitches)-1)]

def parsons(ivs):
    """Direction only: -1 (down), 0 (same), +1 (up)."""
    return [(-1 if v < 0 else 1 if v > 0 else 0) for v in ivs]

def fuzzy_intervals(ivs):
    """9-level contour classification."""
    def classify(v):
        if v < -7: return -4
        if v <= -5: return -3
        if v <= -3: return -2
        if v <= -1: return -1
        if v == 0:  return 0
        if v <= 2:  return 1
        if v <= 4:  return 2
        if v <= 7:  return 3
        return 4
    return [classify(v) for v in ivs]

def pitch_classes(pitches):
    """Absolute pitch class mod 12."""
    return [int(p) % 12 for p in pitches]

def chordal_pitch_classes(pitches, chord_roots):
    """Pitch class relative to chord root. None if no chord."""
    result = []
    for p, r in zip(pitches, chord_roots):
        if r is not None:
            result.append((int(p) % 12 - r + 12) % 12)
        else:
            result.append(None)
    return result

CDPC_MAP = {
    0: '1',   # root
    1: '\\',  # minor 2nd
    2: '2',   # major 2nd
    3: '3',   # minor 3rd (default)
    4: '3',   # major 3rd (default)
    5: '4',   # perfect 4th
    6: 'T',   # tritone
    7: '5',   # perfect 5th
    8: '%',   # minor 6th
    9: '6',   # major 6th
    10: '7',  # minor 7th (default)
    11: '7',  # major 7th (default)
}

def chordal_diatonic_pcs(cpc_list):
    """Map chordal pitch class to diatonic name."""
    return [CDPC_MAP.get(c, '?') if c is not None else None for c in cpc_list]

def duration_classes(durations, beat_durs):
    """5-level duration classification relative to beat duration."""
    result = []
    for d, bd in zip(durations, beat_durs):
        if bd is None or bd <= 0:
            result.append(0)
            continue
        ratio = d / bd
        if ratio < 0.35:   result.append(-2)  # very short
        elif ratio < 0.70: result.append(-1)  # short
        elif ratio < 1.40: result.append(0)   # medium
        elif ratio < 2.80: result.append(1)   # long
        else:              result.append(2)    # very long
    return result

# ─── Chord parsing ──────────────────────────────────────────────────

NOTE_TO_PC = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
}

def chord_root_pc(chord_str):
    """Parse chord symbol root → pitch class. Returns None for 'NC' or empty."""
    if not chord_str or chord_str.strip() in ('', 'NC'):
        return None
    s = chord_str.strip()
    if not s or s[0] not in NOTE_TO_PC:
        return None
    pc = NOTE_TO_PC[s[0]]
    rest = s[1:]
    if rest.startswith('b'):
        pc = (pc - 1) % 12
    elif rest.startswith('#'):
        pc = (pc + 1) % 12
    return pc

# ─── Main extraction ────────────────────────────────────────────────

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1. Get all lick-related sections
    cur.execute("""
        SELECT melid, start, end, value
        FROM sections
        WHERE type = 'IDEA' AND value LIKE '%lick%'
        ORDER BY melid, start
    """)
    lick_sections = cur.fetchall()
    print(f"Found {len(lick_sections)} lick sections")

    # 2. Cache solo metadata
    cur.execute("SELECT * FROM solo_info")
    solo_meta = {row['melid']: dict(row) for row in cur.fetchall()}

    # 3. Cache all melody events per solo (ordered by eventid)
    cur.execute("""
        SELECT melid, eventid, onset, pitch, duration, bar, beat, tatum,
               num, denom, beatdur
        FROM melody ORDER BY melid, eventid
    """)
    melody_by_solo = {}
    for row in cur:
        mid = row['melid']
        if mid not in melody_by_solo:
            melody_by_solo[mid] = []
        melody_by_solo[mid].append(dict(row))

    # 4. Cache beat/chord grid per solo
    cur.execute("""
        SELECT melid, bar, beat, chord
        FROM beats ORDER BY melid, bar, beat
    """)
    chord_grid = {}  # (melid, bar, beat) → chord
    for row in cur:
        chord_grid[(row['melid'], row['bar'], row['beat'])] = row['chord']

    conn.close()

    # 5. Extract each lick
    licks = []
    lick_id = 0

    for sec in lick_sections:
        melid = sec['melid']
        start_idx = sec['start']  # 0-based inclusive
        end_idx = sec['end']      # 0-based inclusive

        events = melody_by_solo.get(melid)
        if not events:
            continue

        # Bounds check
        if start_idx < 0 or end_idx >= len(events) or start_idx > end_idx:
            continue

        lick_events = events[start_idx:end_idx + 1]  # inclusive
        n = len(lick_events)
        if n < 2:
            continue  # need at least 2 notes for interval

        # Raw arrays
        pitches   = [e['pitch'] for e in lick_events]
        onsets    = [round(e['onset'], 4) for e in lick_events]
        durs      = [round(e['duration'], 4) for e in lick_events]
        bars      = [e['bar'] for e in lick_events]
        beats     = [e['beat'] for e in lick_events]
        tatums    = [e['tatum'] for e in lick_events]
        beat_durs = [e['beatdur'] for e in lick_events]

        # Chord context per event
        chords_per_event = []
        chord_roots = []
        for e in lick_events:
            ch = chord_grid.get((melid, e['bar'], e['beat']), '')
            if not ch:
                # Try beat 1 of same bar as fallback
                ch = chord_grid.get((melid, e['bar'], 1), '')
            chords_per_event.append(ch if ch else None)
            chord_roots.append(chord_root_pc(ch))

        # Compute transformations
        ivs = intervals(pitches)
        pars = parsons(ivs)
        fuzz = fuzzy_intervals(ivs)
        pcs = pitch_classes(pitches)
        cpcs = chordal_pitch_classes(pitches, chord_roots)
        cdpcs = chordal_diatonic_pcs(cpcs)
        durclss = duration_classes(durs, beat_durs)

        # Solo metadata
        meta = solo_meta.get(melid, {})

        # Determine base lick tag (strip prefixes like #, ~, ##, etc.)
        raw_tag = sec['value']
        base_tag = raw_tag.lstrip('#~+-0123456789')
        if not base_tag:
            base_tag = raw_tag

        # Unique chord progression for the lick
        seen = []
        for c in chords_per_event:
            if c and (not seen or seen[-1] != c):
                seen.append(c)

        lick_obj = {
            'id': lick_id,
            'melid': melid,
            'start_idx': start_idx,
            'end_idx': end_idx,
            'n_events': n,
            'tag': raw_tag,
            'base_tag': base_tag,

            # Solo context
            'performer': meta.get('performer', ''),
            'title': meta.get('title', ''),
            'instrument': meta.get('instrument', ''),
            'style': meta.get('style', ''),
            'tempo': meta.get('avgtempo'),
            'key': meta.get('key', ''),
            'rhythmfeel': meta.get('rhythmfeel', ''),

            # Chord progression
            'chords': seen,
            'chords_per_event': chords_per_event,

            # Raw melody
            'pitch': [int(p) for p in pitches],
            'onset': onsets,
            'duration': durs,
            'bar': bars,
            'beat': beats,
            'tatum': tatums,

            # Transformations
            'interval': ivs,
            'parsons': pars,
            'fuzzy_interval': fuzz,
            'pitch_class': pcs,
            'chordal_pc': cpcs,
            'chordal_diatonic_pc': cdpcs,
            'duration_class': durclss,
        }

        licks.append(lick_obj)
        lick_id += 1

    # 6. Write output
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(licks, f, ensure_ascii=False, separators=(',', ':'))

    print(f"Extracted {len(licks)} licks → {OUT_PATH}")
    print(f"File size: {os.path.getsize(OUT_PATH) / 1024 / 1024:.1f} MB")

    # Stats
    performers = set(l['performer'] for l in licks)
    styles = {}
    for l in licks:
        s = l['style']
        styles[s] = styles.get(s, 0) + 1
    tags = {}
    for l in licks:
        t = l['base_tag']
        tags[t] = tags.get(t, 0) + 1

    print(f"\nStats:")
    print(f"  Performers: {len(performers)}")
    print(f"  Avg notes per lick: {sum(l['n_events'] for l in licks) / len(licks):.1f}")
    print(f"  Style distribution:")
    for s, c in sorted(styles.items(), key=lambda x: -x[1]):
        print(f"    {s}: {c}")
    print(f"  Top tags:")
    for t, c in sorted(tags.items(), key=lambda x: -x[1])[:10]:
        print(f"    {t}: {c}")


if __name__ == '__main__':
    main()
