"""Layer 2-9: Deceptive Resolution Detector.

Detects dominant chords that resolve to unexpected targets (not the expected I).
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name

# Common deceptive resolution targets (interval from expected I root)
COMMON_DECEPTIVE = {
    9: ('vi', True),    # V -> vi (most common)
    8: ('bVI', True),   # V -> bVI
    5: ('IV', True),    # V -> IV
    4: ('iii', True),   # V -> iii
    10: ('bVII', True), # V -> bVII
    3: ('bIII', False), # V -> bIII (less common)
}


def detect(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Detect deceptive resolutions.

    A deceptive resolution occurs when a dom7 chord resolves to a chord
    other than its expected I (root a P5 below).

    Args:
        chords: List of ParsedChord
        key: Song key

    Returns:
        Updated chords with deceptive_resolution field.
    """
    key_root, mode = parse_key(key)
    n = len(chords)

    for i in range(n - 1):
        chord = chords[i]
        nq = chord.normalized_quality or chord.quality

        if nq not in ('dom7', 'dom7sus4', 'aug7'):
            continue

        next_chord = chords[i + 1]
        expected_root = (chord.root + 5) % 12  # P5 below = expected I

        # If it resolves as expected, no deceptive resolution
        if next_chord.root == expected_root:
            continue

        # Check if this V7 is already tagged as something else (e.g., backdoor)
        # that explains the non-standard resolution
        if any('backdoor' in gm.get('variant', '') for gm in chord.group_memberships):
            continue

        # It's a deceptive resolution
        actual_root = next_chord.root
        interval_from_expected = (actual_root - expected_root) % 12

        expected_name = pc_to_note_name(expected_root)

        # Determine the degree of actual resolution relative to expected key
        actual_degree_info = COMMON_DECEPTIVE.get(interval_from_expected)
        if actual_degree_info:
            actual_degree, common = actual_degree_info
        else:
            actual_degree = f'({pc_to_note_name(actual_root)})'
            common = False

        chord.deceptive_resolution = {
            'dominant_chord': chord.original_symbol,
            'expected_resolution': f'{expected_name}maj7',
            'actual_resolution': next_chord.original_symbol,
            'actual_degree': actual_degree,
            'common_pattern': common,
        }

    return chords
