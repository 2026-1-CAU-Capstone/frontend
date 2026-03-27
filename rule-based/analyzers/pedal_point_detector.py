"""Layer 2-10: Pedal Point Detector.

Detects sustained bass notes across multiple bars (pedal points).
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name


def detect(chords: list[ParsedChord], key: str,
           min_duration_bars: int = 2) -> list[ParsedChord]:
    """Detect pedal points (sustained bass notes).

    A pedal point is detected when the effective bass note
    (slash chord bass or root) remains the same across multiple bars.

    Args:
        chords: List of ParsedChord
        key: Song key
        min_duration_bars: Minimum bars for pedal detection (default 2)

    Returns:
        Updated chords with pedal_info field.
    """
    if not chords:
        return chords

    key_root, mode = parse_key(key)

    # Get effective bass for each chord
    def effective_bass(c: ParsedChord) -> int:
        return c.bass if c.bass is not None else c.root

    # Group consecutive chords by their effective bass note
    # Track spans of same bass note
    i = 0
    n = len(chords)

    while i < n:
        bass = effective_bass(chords[i])
        start_idx = i
        start_bar = chords[i].bar
        j = i + 1

        # Find span of same bass
        while j < n and effective_bass(chords[j]) == bass:
            j += 1

        end_idx = j - 1
        end_bar = chords[end_idx].bar
        span_bars = end_bar - start_bar + 1

        if span_bars >= min_duration_bars and (end_idx - start_idx) >= 1:
            # Determine pedal type
            bass_interval = (bass - key_root) % 12
            if bass_interval == 0:
                pedal_type = 'tonic'
            elif bass_interval == 7:
                pedal_type = 'dominant'
            elif bass_interval == 5:
                pedal_type = 'subdominant'
            else:
                pedal_type = f'on {pc_to_note_name(bass)}'

            # Mark all chords in the span
            for k in range(start_idx, end_idx + 1):
                chords[k].pedal_info = {
                    'pedal_note': bass,
                    'pedal_note_name': pc_to_note_name(bass),
                    'pedal_type': pedal_type,
                    'is_over_pedal': True,
                    'pedal_start_bar': start_bar,
                    'pedal_end_bar': end_bar,
                }

        i = j

    return chords
