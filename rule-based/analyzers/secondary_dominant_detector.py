"""Layer 2-6: Secondary Dominant Detector.

Detects non-diatonic dominant 7th chords that function as V of a diatonic degree.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name


# Degree labels for secondary dominant targets (in major key)
MAJOR_DEGREE_ROOTS = {
    0: 'I', 2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi', 11: 'vii'
}

MINOR_DEGREE_ROOTS = {
    0: 'i', 2: 'ii', 3: 'bIII', 5: 'iv', 7: 'V', 8: 'bVI', 10: 'bVII'
}


def _is_dom7(q: str) -> bool:
    return q in ('dom7', 'dom7sus4', 'aug7')


def detect(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Detect secondary dominants in the chord sequence.

    A secondary dominant is a non-diatonic dom7 chord that resolves
    (or could resolve) down a P5 to a diatonic chord.

    Args:
        chords: List of ParsedChord
        key: Song key string

    Returns:
        Updated chords with secondary_dominant field populated.
    """
    key_root, mode = parse_key(key)
    degree_map = MAJOR_DEGREE_ROOTS if mode == 'major' else MINOR_DEGREE_ROOTS

    n = len(chords)
    for i in range(n):
        chord = chords[i]
        nq = chord.normalized_quality or chord.quality

        if not _is_dom7(nq):
            continue

        # Skip if it's the diatonic V
        if chord.is_diatonic and chord.degree in ('V', 'v'):
            continue

        # If it's diatonic dom7 on a non-V degree (like V7 being the I chord in a blues),
        # still check for secondary dominant function
        # The target would be the chord a P5 below this chord's root
        target_root = (chord.root + 5) % 12  # P5 below = P4 above = +5 semitones? No.
        # P5 below: chord.root - 7 semitones. But going down P5 = (root - 7) % 12
        # Actually V resolves to I which is P5 below: (root + 5) % 12 = P4 up = same as P5 down
        # Wait: G(7) -> C(0). (7+5)%12 = 0. Yes, +5 is correct.
        target_root = (chord.root + 5) % 12

        # Determine target degree
        target_interval = (target_root - key_root) % 12
        target_degree = degree_map.get(target_interval)

        if target_degree is None:
            # Target is not a standard diatonic degree
            # Could still be secondary dominant of a chromatic degree
            target_degree = f'({pc_to_note_name(target_root)})'

        # Check if it actually resolves to the target
        resolved = False
        target_chord_symbol = None
        if i + 1 < n:
            next_chord = chords[i + 1]
            if next_chord.root == target_root:
                resolved = True
                target_chord_symbol = next_chord.original_symbol

        sec_dom_type = f'V/{target_degree}'

        chord.secondary_dominant = {
            'type': sec_dom_type,
            'target_degree': target_degree,
            'target_chord': target_chord_symbol or pc_to_note_name(target_root),
            'resolved': resolved,
            'origin_position': {'bar': chord.bar, 'beat': chord.beat},
        }

        # Also update functions
        chord.functions = [
            {
                'function': 'D',
                'confidence': 0.9 if resolved else 0.6,
                'note': f'Secondary dominant {sec_dom_type}' +
                        (' (resolved)' if resolved else ' (unresolved)'),
            }
        ]

    return chords
