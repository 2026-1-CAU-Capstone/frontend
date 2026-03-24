"""Layer 2-8: Chromatic Approach Detector.

Detects non-diatonic chords that approach the next chord by half step.
"""

from models.chord import ParsedChord


def detect(chords: list[ParsedChord]) -> list[ParsedChord]:
    """Detect chromatic approach chords.

    A chromatic approach is a non-diatonic chord whose root is one semitone
    above or below the next chord, AND that is not already explained as
    a secondary dominant or tritone substitution.

    Args:
        chords: List of ParsedChord

    Returns:
        Updated chords with chromatic_approach field.
    """
    n = len(chords)
    for i in range(n - 1):
        chord = chords[i]
        next_chord = chords[i + 1]

        # Skip diatonic chords
        if chord.is_diatonic:
            continue

        # Skip if already explained by other analyzers
        if chord.secondary_dominant is not None:
            continue
        if any('tritone' in str(f.get('note', '')) for f in chord.functions):
            continue

        interval = (next_chord.root - chord.root) % 12

        direction = None
        if interval == 1:
            direction = 'below'  # chord is one semitone below target
        elif interval == 11:
            direction = 'above'  # chord is one semitone above target

        if direction is None:
            continue

        # Check quality match (higher confidence if same quality)
        nq = chord.normalized_quality or chord.quality
        next_nq = next_chord.normalized_quality or next_chord.quality
        quality_match = (nq == next_nq)

        chord.chromatic_approach = {
            'target': next_chord.original_symbol,
            'target_bar': next_chord.bar,
            'target_beat': next_chord.beat,
            'direction': direction,
            'quality_match': quality_match,
        }

        # Update functions
        if not chord.functions:
            chord.functions = [{
                'function': 'chromatic_approach',
                'confidence': 0.7 if quality_match else 0.5,
                'note': f'Chromatic approach from {direction} to {next_chord.original_symbol}',
            }]

    return chords
