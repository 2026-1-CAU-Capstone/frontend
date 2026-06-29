"""Batch-match all Charlie Parker licks (from licks.json) against the Omnibook
XML transcriptions and report, per lick, which tune + measures it appears in.

Grounded, NOT guessed: matching is a transposition-invariant interval-window
search over the real Omnibook notation. Each result carries a match ratio so
low-confidence hits (different take, improvised passage) are visible, not hidden.
"""

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
LICKS = ROOT / "public/data/licks/licks.json"
OMNI_ZIP = ROOT / "data/omnibook_xml.zip"

STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# WjazzD lick title -> Omnibook xml filename (without dir / extension).
TITLE_TO_FILE = {
    "Billie's Bounce": "Billies's_Bounce",
    "Blues for Alice": "Blues_For_Alice",
    "Donna Lee": "Donna_Lee",
    "K.C. Blues": "KC_Blues",
    "Ko-Ko": "Ko_Ko",
    "My Little Suede Shoes": "My_Little_Suede_Shoes",
    "Ornithology": "Ornithology",
    "Scrapple from the Apple": "Scrapple_From_The_Apple",
    "Segment": "Segment",
    "Steeplechase": "Steeplechase",
    "Thriving on a Riff": "Thriving_From_A_Riff",
    "Yardbird Suite": "Yardbird_Suite",
}


def parse_xml_bytes(data):
    """Return ordered list of sounding notes [{midi, measure}] (rests/chords skipped)."""
    root = ET.fromstring(data)
    notes = []
    for measure in root.iter("measure"):
        m_num = int(measure.get("number", "0"))
        for child in measure:
            if child.tag != "note":
                continue
            if child.find("chord") is not None:   # stacked chord tone — skip
                continue
            if child.find("rest") is not None:
                continue
            p = child.find("pitch")
            if p is None:
                continue
            step = p.findtext("step", "")
            alter = int(p.findtext("alter", "0") or "0")
            octave = int(p.findtext("octave", "4") or "4")
            midi = 12 * (octave + 1) + STEP_TO_SEMITONE.get(step, 0) + alter
            notes.append({"midi": midi, "measure": m_num})
    return notes


def intervals_of(midis):
    return [midis[i + 1] - midis[i] for i in range(len(midis) - 1)]


def best_window(target_iv, omni_iv):
    """Return (best_ratio, start_idx) of the length-L window of omni_iv that
    matches the most of target_iv. L = len(target_iv)."""
    L = len(target_iv)
    if L == 0 or len(omni_iv) < L:
        return (0.0, -1)
    best_ratio, best_i = 0.0, -1
    for i in range(len(omni_iv) - L + 1):
        m = sum(1 for k in range(L) if omni_iv[i + k] == target_iv[k])
        r = m / L
        if r > best_ratio:
            best_ratio, best_i = r, i
            if r == 1.0:
                break
    return (best_ratio, best_i)


def main():
    # Load Omnibook files we care about (only the 12 tunes Parker licks cover).
    omni = {}
    with zipfile.ZipFile(OMNI_ZIP) as z:
        for name in z.namelist():
            if "__MACOSX" in name or not name.lower().endswith(".xml"):
                continue
            stem = re.sub(r"\.xml$", "", name.split("/")[-1])
            if stem in TITLE_TO_FILE.values():
                notes = parse_xml_bytes(z.read(name))
                omni[stem] = {"notes": notes, "iv": intervals_of([n["midi"] for n in notes])}

    licks = json.loads(LICKS.read_text())
    if not isinstance(licks, list):
        licks = list(licks.values())[0]
    parker = [l for l in licks if re.search(r"parker", (l.get("performer") or ""), re.I)]

    by_tune = defaultdict(list)
    for l in parker:
        by_tune[l.get("title", "?")].append(l)

    matched = unmatched_tune = lowconf = 0
    print(f"# Charlie Parker 릭 → Omnibook 마디 매칭 (총 {len(parker)}개)\n")

    for tune in sorted(by_tune):
        licks_t = by_tune[tune]
        fstem = TITLE_TO_FILE.get(tune)
        if not fstem or fstem not in omni:
            unmatched_tune += len(licks_t)
            print(f"## {tune}  ({len(licks_t)}개)  — ⚠️ Omnibook 미수록 → 매칭 불가\n")
            continue
        odata = omni[fstem]
        print(f"## {tune}  ({len(licks_t)}개)  → Omnibook: {fstem}.xml")
        for l in sorted(licks_t, key=lambda x: x.get("id", 0)):
            pitch = l.get("pitch") or []
            tiv = intervals_of(pitch) if len(pitch) >= 2 else (l.get("interval") or [])
            ratio, idx = best_window(tiv, odata["iv"])
            if idx < 0:
                print(f"   #{l['id']:<5} {len(pitch):>2}음  — 음표 부족")
                continue
            m_start = odata["notes"][idx]["measure"]
            m_end = odata["notes"][min(idx + len(tiv), len(odata["notes"]) - 1)]["measure"]
            span = f"m.{m_start}" if m_start == m_end else f"m.{m_start}–{m_end}"
            flag = "✅정확" if ratio >= 0.999 else ("🟡근접" if ratio >= 0.7 else "🔴낮음")
            if ratio >= 0.999:
                matched += 1
            elif ratio < 0.7:
                lowconf += 1
            print(f"   #{l['id']:<5} {len(pitch):>2}음  {flag} {ratio*100:>3.0f}%  → {span}  (WjazzD bar {l.get('bar',['?'])[0]}~)")
        print()

    print("---")
    print(f"정확(100%): {matched} / 근접 외 낮음(<70%): {lowconf} / Omnibook 미수록: {unmatched_tune} / 합계 {len(parker)}")


if __name__ == "__main__":
    main()
