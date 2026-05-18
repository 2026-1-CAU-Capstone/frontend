"""
Convert VexFlow-style sheetData → (pitches, onsets, durations) in seconds.

Used to bring backend licks (which only carry pitches + a sheetData score)
into the format expected by the PoC matcher.

Limitations:
  - Ignores key signature; only explicit per-note accidentals are applied.
    Most jazz licks have explicit accidentals so this is acceptable for PoC.
  - Picks keys[0] only (monophonic melody).
  - Tuplet handling assumes the tuplet object exposes {num_notes, notes_occupied}
    or similar — falls back to 2/3 ratio.
"""

from __future__ import annotations
from typing import Optional


_LETTER_TO_SEMITONE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_DUR_TO_BEATS = {"w": 4.0, "h": 2.0, "q": 1.0, "4": 1.0, "8": 0.5, "16": 0.25, "32": 0.125, "64": 0.0625}


def key_to_midi(key_str: str, accidental: Optional[str]) -> int:
    """VexFlow 'b/4' + accidental → MIDI int. C4 = 60."""
    letter, octave_str = key_str.split("/")
    semi = _LETTER_TO_SEMITONE[letter.lower()]
    midi = (int(octave_str) + 1) * 12 + semi
    if accidental == "#":
        midi += 1
    elif accidental == "b":
        midi -= 1
    return midi


def duration_to_beats(dur: str, dotted: bool, tuplet) -> tuple[float, bool]:
    """VexFlow duration code → (beats, is_rest). Unknown codes default to 1 beat."""
    is_rest = dur.endswith("r")
    base = dur[:-1] if is_rest else dur
    beats = _DUR_TO_BEATS.get(base, 1.0)
    if dotted:
        beats *= 1.5
    if tuplet:
        nn = tuplet.get("num_notes") if isinstance(tuplet, dict) else None
        no = tuplet.get("notes_occupied") if isinstance(tuplet, dict) else None
        if nn and no:
            beats *= no / nn
        else:
            beats *= 2.0 / 3.0  # default triplet
    return beats, is_rest


def sheet_to_onsets(sheet_data: dict, default_tempo: float = 120.0):
    """Returns (pitches, onsets_sec, durations_sec) — rests are excluded.
    pitches are computed from VexFlow keys; onsets/durations are in seconds."""
    tempo = float(sheet_data.get("tempo") or default_tempo)
    sec_per_beat = 60.0 / tempo

    pitches: list[int] = []
    onsets: list[float] = []
    durations: list[float] = []
    t = 0.0
    for m in sheet_data.get("measures", []):
        for note in m.get("notes", []):
            beats, is_rest = duration_to_beats(note.get("duration", "q"), bool(note.get("dotted")), note.get("tuplet"))
            dur_sec = beats * sec_per_beat
            if not is_rest:
                keys = note.get("keys") or []
                if keys:
                    key0 = keys[0]
                    acc_list = note.get("accidentals")
                    acc0 = acc_list[0] if isinstance(acc_list, list) and acc_list and acc_list[0] else None
                    try:
                        midi = key_to_midi(key0, acc0)
                        pitches.append(midi)
                        onsets.append(t)
                        durations.append(dur_sec)
                    except (KeyError, ValueError):
                        pass
            t += dur_sec
    return pitches, onsets, durations


if __name__ == "__main__":
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "rag/scratch/backend_licks.json"
    with open(path) as f:
        backend = json.load(f)
    with_v = [l for l in backend if l.get("video") and l["video"].get("videoId") and l["video"].get("startSec") is not None]

    for b in with_v:
        sd = b.get("sheetData") or {}
        pitches, onsets, durs = sheet_to_onsets(sd)
        bp = b.get("pitches") or []
        match = pitches[:len(bp)] == bp[:len(pitches)]
        print(f"{b['performer'][:18]:<18} {b['title'][:28]:<28} "
              f"nE={b['nEvents']:<3} sheetN={len(pitches):<3} "
              f"pitches_match={match}")
        if not match:
            print(f"  sheet pitches: {pitches[:12]}")
            print(f"  backend pitch: {bp[:12]}")
