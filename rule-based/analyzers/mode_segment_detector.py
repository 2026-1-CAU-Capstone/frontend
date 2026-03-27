"""Layer 3-12: Mode Segment Detector.

Uses ii-V-I group context and local key centers to assign mode segments,
rather than relying purely on pitch class overlap with a fixed key root.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key

# Mode definitions: name -> scale intervals from root
MODE_SCALES = {
    'ionian':     [0, 2, 4, 5, 7, 9, 11],
    'dorian':     [0, 2, 3, 5, 7, 9, 10],
    'phrygian':   [0, 1, 3, 5, 7, 8, 10],
    'lydian':     [0, 2, 4, 6, 7, 9, 11],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'aeolian':    [0, 2, 3, 5, 7, 8, 10],
    'locrian':    [0, 1, 3, 5, 6, 8, 10],
}


def _get_pitch_classes(chord: ParsedChord) -> set[int]:
    """Get the pitch classes used by a chord (root + core tones)."""
    from analyzers.diatonic_classifier import QUALITY_INTERVALS
    intervals = QUALITY_INTERVALS.get(
        chord.normalized_quality or chord.quality, [0, 4, 7]
    )
    return {(chord.root + i) % 12 for i in intervals}


def _score_mode(pitch_classes: set[int], root: int, mode_name: str,
                scale: list[int]) -> float:
    """Score how well a set of pitch classes fits a mode rooted at `root`."""
    if not pitch_classes:
        return 0.0
    scale_pcs = {(root + s) % 12 for s in scale}
    overlap = len(pitch_classes & scale_pcs)
    outside = len(pitch_classes - scale_pcs)
    # Penalize notes outside the scale more heavily
    return (overlap - outside * 2.0) / max(len(pitch_classes), 1)


def _determine_local_key_root(chords_in_window: list[ParsedChord],
                               song_key_root: int,
                               song_mode: str) -> int:
    """Determine the effective key root for a window of chords.

    Uses ii-V-I group target info if available; otherwise falls back to
    the song key.
    """
    # Check if any chord in this window belongs to a ii-V-I group
    # and use the target key of the most recent group
    for chord in reversed(chords_in_window):
        if chord.tonicization:
            tk = chord.tonicization.get('temporary_key', '')
            if tk:
                from parsers.text_parser import parse_note_name
                pc = parse_note_name(tk)
                if pc is not None:
                    return pc
        for gm in chord.group_memberships:
            if gm.get('group_type') == 'ii-V-I' and gm.get('role') in ('I', 'I (iii substitute)'):
                # This chord is the resolution target — its root is the local key
                return chord.root

    return song_key_root


def detect(chords: list[ParsedChord], key: str,
           window_bars: int = 4, threshold: float = 0.55) -> list[ParsedChord]:
    """Detect mode segments using local key context and pitch class analysis.

    Args:
        chords: List of ParsedChord
        key: Song key
        window_bars: Window size in bars
        threshold: Minimum score to assign a mode

    Returns:
        Updated chords with mode_segment field.
    """
    if not chords:
        return chords

    key_root, key_mode = parse_key(key)
    default_mode = 'aeolian' if key_mode == 'minor' else 'ionian'

    # Group chords by bar
    max_bar = max(c.bar for c in chords)
    bar_chords: dict[int, list[int]] = {}
    for idx, c in enumerate(chords):
        bar_chords.setdefault(c.bar, []).append(idx)

    # Sliding window with local key awareness
    for start_bar in range(1, max_bar + 1):
        end_bar = min(start_bar + window_bars - 1, max_bar)

        # Collect all pitch classes and chords in this window
        window_pcs = set()
        window_indices = []
        window_chords = []
        for bar in range(start_bar, end_bar + 1):
            for idx in bar_chords.get(bar, []):
                window_pcs |= _get_pitch_classes(chords[idx])
                window_indices.append(idx)
                window_chords.append(chords[idx])

        if not window_pcs:
            continue

        # Determine local key root from ii-V-I context
        local_root = _determine_local_key_root(window_chords, key_root, key_mode)

        # Score each mode against the LOCAL key root
        best_mode = None
        best_score = -999.0

        for mode_name, scale in MODE_SCALES.items():
            score = _score_mode(window_pcs, local_root, mode_name, scale)
            if score > best_score:
                best_score = score
                best_mode = mode_name

        # Also score against the song key root if different
        if local_root != key_root:
            for mode_name, scale in MODE_SCALES.items():
                score = _score_mode(window_pcs, key_root, mode_name, scale)
                if score > best_score:
                    best_score = score
                    best_mode = mode_name

        if best_mode and best_score >= threshold:
            for idx in window_indices:
                if chords[idx].mode_segment is None:
                    chords[idx].mode_segment = best_mode

    # Fill remaining with appropriate default based on song key mode
    for chord in chords:
        if chord.mode_segment is None:
            chord.mode_segment = default_mode

    return chords
