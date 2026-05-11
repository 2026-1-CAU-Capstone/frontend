"""Verify the match by printing the matched window context from Warming_Up_A_Riff.xml."""

import sys
sys.path.insert(0, r"c:/Users/CAU/Documents/jazzify/tools")
from match_omnibook import parse_xml, intervals_of, TARGET_JSON
from pathlib import Path

path = Path(r"c:/Users/CAU/Documents/jazzify/data/omnibook/Omnibook xml/Warming_Up_A_Riff.xml")
notes, fifths = parse_xml(path)

# Build pitched-only sequence with measure/chord info preserved
pitched = [n for n in notes if n["midi"] is not None]
iv = intervals_of(notes)

start = 288
n = len(TARGET_JSON["intervals"])

# Note that interval idx i is between pitched[i] and pitched[i+1]
# So matching window covers pitched[start] .. pitched[start+n]
print(f"key fifths: {fifths}")
print(f"window covers pitched notes index {start}..{start+n} (inclusive)")
print(f"target intervals: {TARGET_JSON['intervals']}")
print(f"found intervals : {iv[start:start+n]}")
print()

PITCH_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
def midi_to_name(m):
    return f"{PITCH_NAMES[m % 12]}{m // 12 - 1}"

print("Matched notes (with measure, chord):")
for i in range(start, start + n + 1):
    pn = pitched[i]
    print(f"  pitched#{i:4d}  measure {pn['measure']:>3}  chord {str(pn['chord']):<8}  {midi_to_name(pn['midi'])}")
