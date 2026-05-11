"""Match every 도로시 lick against the 50-file Charlie Parker Omnibook corpus.

For each lick, find the best interval-window match in each Omnibook XML
(transposition-invariant). Reports the top match per lick with:
  - source song (XML file)
  - measure number where the match starts
  - chord context at the match start
  - implied transposition from the lick's stored key (F) to the matched key
  - score (n_matched / n_intervals, %)
"""

import json
import os
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(r"c:/Users/CAU/Documents/jazzify")
OMNIBOOK_DIR = REPO / "data" / "omnibook" / "Omnibook xml"
LICKS_JSON = Path(os.environ["LOCALAPPDATA"]) / "Temp" / "dorothy_licks.json"

STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def parse_xml(path):
    """Return list of {midi, measure, chord} for sounding notes, in order."""
    tree = ET.parse(path)
    root = tree.getroot()
    notes = []
    for measure in root.iter("measure"):
        m_num = int(measure.get("number", "0"))
        current_chord = None
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
            elif child.tag == "note":
                if child.find("chord") is not None:
                    continue
                if child.find("rest") is not None:
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
    return [notes[i + 1]["midi"] - notes[i]["midi"] for i in range(len(notes) - 1)]


def best_window(target_iv, corpus_iv):
    """Return (best_score, best_start_idx) over a single corpus interval array."""
    n = len(target_iv)
    if len(corpus_iv) < n:
        return -1, -1
    best, best_i = -1, -1
    for i in range(len(corpus_iv) - n + 1):
        s = sum(1 for k in range(n) if corpus_iv[i + k] == target_iv[k])
        if s > best:
            best, best_i = s, i
    return best, best_i


def midi_name(m):
    return f"{PITCH_NAMES[m % 12]}{m // 12 - 1}"


def main():
    # Pre-parse all omnibook files once
    print("parsing omnibook corpus...", flush=True)
    corpus = []
    for xp in sorted(OMNIBOOK_DIR.glob("*.xml")):
        try:
            notes = parse_xml(xp)
        except ET.ParseError:
            continue
        iv = intervals_of(notes)
        corpus.append({"name": xp.stem, "notes": notes, "iv": iv})
    print(f"  {len(corpus)} files parsed\n", flush=True)

    licks = json.load(open(LICKS_JSON, encoding="utf-8"))

    # ---- Summary table ----
    print("=" * 110)
    print(f"{'lick':<10} {'nIv':>4}  {'best song':<32} {'score':>8}  {'meas':>4} {'chord':<8}  {'pitch':<6} {'Δsemi':>5}")
    print("=" * 110)

    detailed = []
    for lick in licks:
        target_iv = lick["intervals"]
        first_pitch = lick["first_pitch_midi"]
        n = len(target_iv)

        results = []
        for f in corpus:
            score, idx = best_window(target_iv, f["iv"])
            if score < 0:
                continue
            results.append((score, idx, f))
        results.sort(key=lambda r: -r[0])

        top = results[0] if results else None
        if not top:
            print(f"{lick['title']:<10} {n:>4}  (no match)")
            continue

        score, idx, f = top
        start_note = f["notes"][idx]
        pct = 100 * score / n
        # transposition offset: corpus-start - lick-first
        delta = start_note["midi"] - first_pitch
        print(f"{lick['title']:<10} {n:>4}  {f['name']:<32} {score:>3}/{n:<3} ({pct:>3.0f}%) "
              f"m{start_note['measure']:>3} {str(start_note['chord'] or '?'):<8}  "
              f"{midi_name(start_note['midi']):<6} {delta:>+5}")

        # store top 3 per lick for detail
        detailed.append((lick, results[:3]))

    # ---- Top 3 detail per lick ----
    print()
    print("=" * 110)
    print("TOP 3 PER LICK")
    print("=" * 110)
    for lick, top3 in detailed:
        n = len(lick["intervals"])
        print(f"\n[{lick['title']}]  nIv={n}  key={lick['key']}  chords={lick['chords']}  first_midi={midi_name(lick['first_pitch_midi'])}")
        for rank, (score, idx, f) in enumerate(top3, 1):
            start = f["notes"][idx]
            pct = 100 * score / n
            end_idx = min(idx + n, len(f["notes"]) - 1)
            end_meas = f["notes"][end_idx]["measure"] if end_idx < len(f["notes"]) else start["measure"]
            delta = start["midi"] - lick["first_pitch_midi"]
            print(f"   #{rank}: {f['name']:<32} score={score}/{n} ({pct:.0f}%)  "
                  f"m{start['measure']}-{end_meas}  chord={start['chord']}  "
                  f"start={midi_name(start['midi'])} (Δ={delta:+}st)")


if __name__ == "__main__":
    main()
