"""Search Charlie Parker Omnibook XML for 도로시 3 lick.

Target intervals (sounding notes only, rests skipped):
[1, 3, 2, 1, 1, 1, -1, -1, -7, 1, 3, 2, 1, 1, 1, -1, -1, -1, -2, -2, -1,
 3, 3, 3, -6, 2, 1, 2, -2, -1, -2, -2]

ii-V-I in F major (G-7 / C7 / F△7).
"""

from pathlib import Path
import xml.etree.ElementTree as ET

OMNIBOOK_DIR = Path(r"c:/Users/CAU/Documents/jazzify/data/omnibook/Omnibook xml")

TARGET_IV = [1, 3, 2, 1, 1, 1, -1, -1, -7, 1, 3, 2, 1, 1, 1, -1, -1, -1,
             -2, -2, -1, 3, 3, 3, -6, 2, 1, 2, -2, -1, -2, -2]

STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def parse_xml(path):
    tree = ET.parse(path)
    root = tree.getroot()
    notes = []
    last_chord = None
    for measure in root.iter("measure"):
        m_num = int(measure.get("number", "0"))
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
                    last_chord = label + kind_map.get((k.text or "").lower(), k.text or "")
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
                notes.append({"midi": midi, "measure": m_num, "chord": last_chord})
    return notes


def intervals_of(notes):
    return [notes[i + 1]["midi"] - notes[i]["midi"] for i in range(len(notes) - 1)]


def find_matches(target, iv, min_score):
    n = len(target)
    hits = []
    for i in range(len(iv) - n + 1):
        s = sum(1 for k in range(n) if iv[i + k] == target[k])
        if s >= min_score:
            hits.append((i, s))
    return hits


def name(m):
    return f"{PITCH_NAMES[m % 12]}{m // 12 - 1}"


def main():
    print("=" * 76)
    print(f"Target intervals (n={len(TARGET_IV)}): {TARGET_IV}")
    print("=" * 76)
    print()

    results = []
    for xml_path in sorted(OMNIBOOK_DIR.glob("*.xml")):
        try:
            notes = parse_xml(xml_path)
        except ET.ParseError:
            continue
        iv = intervals_of(notes)
        if len(iv) < len(TARGET_IV):
            continue
        best = -1
        best_i = -1
        for i in range(len(iv) - len(TARGET_IV) + 1):
            s = sum(1 for k in range(len(TARGET_IV)) if iv[i + k] == TARGET_IV[k])
            if s > best:
                best, best_i = s, i
        results.append((best, best_i, xml_path.name, notes))

    results.sort(key=lambda r: -r[0])

    print("TOP 10 FILES BY BEST INTERVAL-WINDOW MATCH")
    print(f"{'score':>5}/{len(TARGET_IV):<2}  {'idx':>5}  file")
    print("-" * 76)
    for score, idx, fname, _ in results[:10]:
        pct = 100 * score / len(TARGET_IV)
        print(f"{score:>5}     {idx:>5}  {fname}  ({pct:.0f}%)")

    print()
    print("=" * 76)
    threshold = max(int(len(TARGET_IV) * 0.7), len(TARGET_IV) - 5)
    print(f"ALL >= {threshold}/{len(TARGET_IV)} MATCHES")
    print("=" * 76)
    for score, idx, fname, notes in results:
        if score < threshold:
            break
        iv = intervals_of(notes)
        for i, s in find_matches(TARGET_IV, iv, threshold):
            start = notes[i]
            end = notes[min(i + len(TARGET_IV), len(notes) - 1)]
            print(f"  {fname:35}  iv@{i:>4}  score={s:>2}/{len(TARGET_IV)}  "
                  f"m{start['measure']:>3}-{end['measure']:>3}  "
                  f"chord={str(start['chord']):<8}  startPitch={name(start['midi'])}")


if __name__ == "__main__":
    main()
