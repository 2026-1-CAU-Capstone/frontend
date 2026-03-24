"""Layer 1-3: Chord Normalizer.

Strips tensions from chords to extract core quality for pattern matching.
"""

from models.chord import ParsedChord


# Mapping from quality to its "core" form (tensions stripped)
# Most qualities are already core; extended chords map to their base
CORE_QUALITY_MAP = {
    'maj7': 'maj7',
    'maj': 'maj',
    'min7': 'min7',
    'min': 'min',
    'dom7': 'dom7',
    'min7b5': 'min7b5',
    'dim7': 'dim7',
    'dim': 'dim',
    'aug': 'aug',
    'aug7': 'aug7',
    'augmaj7': 'augmaj7',
    'sus4': 'sus4',
    'sus2': 'sus2',
    'dom7sus4': 'dom7sus4',
    'min6': 'min6',
    'maj6': 'maj6',
    'minmaj7': 'minmaj7',
    'power': 'power',
}


def normalize(chords: list[ParsedChord]) -> list[ParsedChord]:
    """Normalize each chord's quality by stripping tensions.

    Sets the normalized_quality field on each chord.
    The normalized quality is used for pattern matching in subsequent analyzers.

    Args:
        chords: List of ParsedChord objects

    Returns:
        Same list with normalized_quality field populated.
    """
    for chord in chords:
        chord.normalized_quality = CORE_QUALITY_MAP.get(chord.quality, chord.quality)

    return chords
