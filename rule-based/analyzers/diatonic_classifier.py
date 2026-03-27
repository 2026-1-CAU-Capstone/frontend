"""Layer 1-1: Diatonic Classifier.

Determines whether each chord is diatonic to the song's key,
and assigns a scale degree label.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key

# Major scale intervals
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11]
MELODIC_MINOR_SCALE = [0, 2, 3, 5, 7, 9, 11]

# Quality -> chord tone intervals (from chord root)
QUALITY_INTERVALS = {
    'maj7': [0, 4, 7, 11],
    'maj': [0, 4, 7],
    'min7': [0, 3, 7, 10],
    'min': [0, 3, 7],
    'dom7': [0, 4, 7, 10],
    'min7b5': [0, 3, 6, 10],
    'dim7': [0, 3, 6, 9],
    'dim': [0, 3, 6],
    'aug': [0, 4, 8],
    'aug7': [0, 4, 8, 10],
    'augmaj7': [0, 4, 8, 11],
    'sus4': [0, 5, 7],
    'sus2': [0, 2, 7],
    'dom7sus4': [0, 5, 7, 10],
    'min6': [0, 3, 7, 9],
    'maj6': [0, 4, 7, 9],
    'minmaj7': [0, 3, 7, 11],
    'power': [0, 7],
}

# Scale degree labels for major key
MAJOR_DEGREE_LABELS = {
    0: 'I', 1: 'bII', 2: 'ii', 3: 'bIII',
    4: 'iii', 5: 'IV', 6: '#IV',
    7: 'V', 8: 'bVI', 9: 'vi',
    10: 'bVII', 11: 'vii'
}

# Expected diatonic qualities for each degree in major
MAJOR_DIATONIC = {
    0: ['maj7', 'maj', 'maj6'],           # I
    2: ['min7', 'min'],                    # ii
    4: ['min7', 'min'],                    # iii
    5: ['maj7', 'maj', 'maj6'],            # IV
    7: ['dom7', 'maj'],                    # V
    9: ['min7', 'min', 'min6'],            # vi
    11: ['min7b5', 'dim'],                 # vii
}

# Expected diatonic qualities for natural minor
MINOR_DIATONIC = {
    0: ['min7', 'min', 'min6', 'minmaj7'],  # i
    2: ['min7b5', 'dim'],                    # ii°
    3: ['maj7', 'maj'],                      # bIII
    5: ['min7', 'min'],                      # iv
    7: ['min7', 'min', 'dom7'],              # v (dom7 from harmonic minor)
    8: ['maj7', 'maj'],                      # bVI
    10: ['dom7', 'maj7', 'maj'],             # bVII
}

# Minor key degree labels
MINOR_DEGREE_LABELS = {
    0: 'i', 1: 'bII', 2: 'ii', 3: 'bIII',
    4: 'III', 5: 'iv', 6: '#iv',
    7: 'v', 8: 'bVI', 9: 'vi',
    10: 'bVII', 11: 'vii'
}


def _get_degree_label(interval: int, quality: str, mode: str) -> str:
    """Get the scale degree label for a chord based on interval and quality."""
    if mode == 'minor':
        labels = MINOR_DEGREE_LABELS
    else:
        labels = MAJOR_DEGREE_LABELS

    label = labels.get(interval, f'?{interval}')

    # Adjust label case based on quality
    if quality in ('min7', 'min', 'min6', 'min7b5', 'minmaj7', 'dim', 'dim7'):
        # Should be lowercase
        if label == label.upper() and not label.startswith('b') and not label.startswith('#'):
            label = label.lower()
        elif label.startswith('b') or label.startswith('#'):
            # Keep prefix, lowercase the rest
            label = label[0] + label[1:].lower()
    elif quality in ('maj7', 'maj', 'maj6', 'dom7', 'aug', 'aug7', 'augmaj7', 'sus4', 'sus2', 'dom7sus4'):
        # Should be uppercase
        if label.startswith('b') or label.startswith('#'):
            label = label[0] + label[1:].upper()
        else:
            label = label.upper()

    # Add diminished marker
    if quality in ('dim', 'dim7', 'min7b5'):
        if not label.endswith('o') and not label.endswith('°'):
            label = label + '°'

    return label


def _check_diatonic(chord_root: int, quality: str, key_root: int, scale: list[int]) -> bool:
    """Check if a chord's core tones all belong to the given scale."""
    intervals = QUALITY_INTERVALS.get(quality, [0, 4, 7])
    scale_pcs = set((key_root + s) % 12 for s in scale)

    for interval in intervals:
        pc = (chord_root + interval) % 12
        if pc not in scale_pcs:
            return False
    return True


def classify(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Classify each chord as diatonic or non-diatonic and assign degree labels.

    Args:
        chords: List of ParsedChord objects
        key: Key string (e.g., "C", "Bb", "F#m")

    Returns:
        Same list with is_diatonic and degree fields populated.
    """
    key_root, mode = parse_key(key)

    if mode == 'major':
        primary_scale = MAJOR_SCALE
        diatonic_map = MAJOR_DIATONIC
    else:
        primary_scale = NATURAL_MINOR_SCALE
        diatonic_map = MINOR_DIATONIC

    for chord in chords:
        interval = (chord.root - key_root) % 12

        # Determine degree label
        # Use the normalized quality if available, otherwise use the parsed quality
        q = chord.normalized_quality or chord.quality

        chord.degree = _get_degree_label(interval, q, mode)

        # Check diatonic against primary scale
        is_dia = _check_diatonic(chord.root, q, key_root, primary_scale)

        if not is_dia and mode == 'minor':
            # Also check harmonic and melodic minor
            is_dia = (_check_diatonic(chord.root, q, key_root, HARMONIC_MINOR_SCALE) or
                      _check_diatonic(chord.root, q, key_root, MELODIC_MINOR_SCALE))

        # Special case: check if the quality matches expected diatonic quality
        if is_dia and interval in diatonic_map:
            expected_qualities = diatonic_map[interval]
            if q not in expected_qualities:
                # Core tones fit the scale but quality doesn't match expected
                # Still diatonic if all tones are in scale
                pass

        chord.is_diatonic = is_dia

    return chords
