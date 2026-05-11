"""Find Omnibook XML files matching a target JSON melodic snippet.

Reports:
- Best interval-window match score per file (transposition-invariant)
- All positions in Warming_Up_A_Riff with perfect interval match
- Pitch-absolute matches (window where first pitch == b4/Bb4) as a separate diagnostic
"""

import json
from pathlib import Path
import xml.etree.ElementTree as ET

OMNIBOOK_DIR = Path(r"c:/Users/CAU/Documents/jazzify/data/omnibook/Omnibook xml")

TARGET = {
    "key": "F",
    "chords": ["G-7", "C7", "F△7"],
    "intervals": [2, 2, 3, -2, -1, -2, 3, -3, -4, -1, -1, 8, 0, -2, -1, -1, -2, -1,
                  3, 4, 3, -3, 1, 2, 2, 5, -2],
    # First pitch of the snippet: c/5 (after a rest). Midi = 72 if interpreted as C5.
    # But the very first key in JSON is b/4 which is a quarter-REST in vexflow notation.
    # The first SOUNDING note is c/5 = MIDI 72.
    "first_pitch_midi": 72,
}

STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def parse_xml(path):
    tree = ET.parse(path)
    root = tree.getroot()
    notes = []
    measure_chords = {}
    for measure in root.iter("measure"):
        m_num = int(measure.get("number", "0"))
        current_chord = measure_chords.get(m_num)
        for child in measure:
            if child.tag == "harmony":
                rs = child.find("root/root-step")
                ra = child.find("root/root-alter")
                k = child.find("kind")
                if rs is not None and k is not None:
                    label = rs.text or ""
                    if ra is not None and ra.text:
                        a = int(ra.text)
                        label += "#" if a == 1 else ("b" if a == -1 else "")
                    kind_map = {
                        "major": "△", "minor": "-", "dominant": "7",
                        "major-seventh": "△7", "minor-seventh": "-7",
                        "dominant-seventh": "7", "half-diminished": "m7b5",
                        "diminished": "dim", "diminished-seventh": "dim7",
                    }
                    current_chord = label + kind_map.get((k.text or "").lower(), k.text or "")
                    if m_num not in measure_chords:
                        measure_chords[m_num] = current_chord
            elif child.tag == "note":
                if child.find("chord") is not None:
                    continue
                if child.find("rest") is not None:
                    notes.append({"midi": None, "measure": m_num, "chord": current_chord})
                    continue
                p = child.find("pitch")
                if p is None:
                    continue
                step = p.findtext("step")
                octv = int(p.findtext("octave", "4"))
                alt = int(p.findtext("alter") or 0)
                if step not in STEP_TO_SEMITONE:
                    continue
                midi = (octv + 1) * 12 + STEP_TO_SEMITONE[step] + alt
                notes.append({"midi": midi, "measure": m_num, "chord": current_chord})
    return notes


def intervals_of(notes):
    p = [n for n in notes if n["midi"] is not None]
    iv = [p[i + 1]["midi"] - p[i]["midi"] for i in range(len(p) - 1)]
    return p, iv


def find_all_matches(target, iv, min_score):
    n = len(target)
    hits = []
    for i in range(len(iv) - n + 1):
        s = sum(1 for k in range(n) if iv[i + k] == target[k])
        if s >= min_score:
            hits.append((i, s))
    return hits


def main():
    target_iv = TARGET["intervals"]

    # ---- 1. Per-file best score (transposition-invariant) ----
    print("=" * 70)
    print("PER-FILE BEST INTERVAL MATCH (transposition-invariant)")
    print("=" * 70)
    results = []
    for xml_path in sorted(OMNIBOOK_DIR.glob("*.xml")):
        try:
            notes = parse_xml(xml_path)
        except ET.ParseError:
            continue
        pitched, iv = intervals_of(notes)
        if len(iv) < len(target_iv):
            continue
        best = -1
        best_i = -1
        for i in range(len(iv) - len(target_iv) + 1):
            s = sum(1 for k in range(len(target_iv)) if iv[i + k] == target_iv[k])
            if s > best:
                best, best_i = s, i
        results.append((best, best_i, xml_path.name, pitched))
    results.sort(key=lambda r: (-r[0], r[2]))
    print(f"{'score':>5}/27  {'startIv':>8}  file")
    for score, idx, name, _ in results[:10]:
        pct = 100 * score / len(target_iv)
        print(f"{score:>5}    {idx:>8}  {name}  ({pct:.0f}%)")

    # ---- 2. All near-perfect matches across all files ----
    print()
    print("=" * 70)
    print("ALL >=24/27 MATCHES (file, intervalIdx, score, startMeasure, startChord, startPitch)")
    print("=" * 70)
    PITCH_NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]
    def name(m):
        return f"{PITCH_NAMES[m % 12]}{m // 12 - 1}"
    for score, idx, fname, pitched in results:
        if score < 24:
            break
        # find ALL near-perfect windows in this file
        path = OMNIBOOK_DIR / fname
        notes = parse_xml(path)
        p, iv = intervals_of(notes)
        for i, s in find_all_matches(target_iv, iv, 24):
            start = p[i]
            print(f"  {fname:35}  iv@{i:>4}  score={s:>2}/27  m{start['measure']:>3}  "
                  f"chord={str(start['chord']):<8}  pitch={name(start['midi'])}")


if __name__ == "__main__":
    main()
