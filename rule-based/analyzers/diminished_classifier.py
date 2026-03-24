"""Layer 2-7: Diminished Chord Classifier.

Classifies dim7 chords as: passing, auxiliary, or dominant function.
"""

from models.chord import ParsedChord
from parsers.text_parser import pc_to_note_name


def detect(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Classify diminished chords by function.

    - Passing: root is chromatic step between adjacent chord roots
    - Auxiliary: same root (or semitone above) as surrounding chord, returns to it
    - Dominant function: acts as rootless V7b9 (root + semitone = target root)

    Args:
        chords: List of ParsedChord
        key: Song key

    Returns:
        Updated chords with diminished_function and possibly secondary_dominant.
    """
    n = len(chords)
    for i in range(n):
        chord = chords[i]
        nq = chord.normalized_quality or chord.quality
        if nq not in ('dim7', 'dim'):
            continue

        prev_chord = chords[i - 1] if i > 0 else None
        next_chord = chords[i + 1] if i + 1 < n else None

        classified = False

        # Check auxiliary: prev and next are the same chord, dim root = same or semitone above
        if prev_chord and next_chord:
            if prev_chord.root == next_chord.root:
                root_diff = (chord.root - prev_chord.root) % 12
                if root_diff in (0, 1):
                    chord.diminished_function = 'auxiliary'
                    classified = True

        # Check passing: root is between prev and next roots chromatically
        if not classified and prev_chord and next_chord:
            prev_root = prev_chord.root
            next_root = next_chord.root
            chord_root = chord.root

            # Ascending: prev -> dim -> next, each a semitone apart
            asc = ((chord_root - prev_root) % 12 == 1 and
                   (next_root - chord_root) % 12 == 1)
            # Descending: prev -> dim -> next, each a semitone down
            desc = ((prev_root - chord_root) % 12 == 1 and
                    (chord_root - next_root) % 12 == 1)
            if asc or desc:
                chord.diminished_function = 'passing'
                classified = True

        # Check dominant function: dim7 root + semitone = target root (acts as V7b9)
        if not classified and next_chord:
            if (chord.root + 1) % 12 == next_chord.root:
                # This dim7 is enharmonically a rootless V7b9 of the next chord
                # The implied dominant root is a major 3rd below the dim root
                # Actually: if C#dim7 -> Dm7, implied dominant = A7b9
                # A = (C# - 4) = (1 - 4) % 12 = 9 = A. Yes.
                implied_dom_root = (chord.root - 4) % 12
                implied_dom_name = pc_to_note_name(implied_dom_root)

                chord.diminished_function = 'dominant_function'
                classified = True

                # Also mark as secondary dominant
                from parsers.text_parser import parse_key
                key_root, mode = parse_key(key)
                target_interval = (next_chord.root - key_root) % 12
                target_degrees = {
                    0: 'I', 2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi', 11: 'vii'
                }
                target_deg = target_degrees.get(target_interval, f'({pc_to_note_name(next_chord.root)})')

                chord.secondary_dominant = {
                    'type': f'V/{target_deg} (as dim7)',
                    'implied_dominant': f'{implied_dom_name}7b9',
                    'target_degree': target_deg,
                    'target_chord': next_chord.original_symbol,
                    'resolved': True,
                    'origin_position': {'bar': chord.bar, 'beat': chord.beat},
                }

                chord.functions = [{
                    'function': 'D',
                    'confidence': 0.8,
                    'note': f'Diminished chord functioning as {implied_dom_name}7b9 (V/{target_deg})',
                }]

        # If still not classified but is a dim7
        if not classified:
            chord.diminished_function = 'unknown'
            chord.ambiguity_flags.append({
                'aspect': 'diminished_function',
                'interpretations': ['passing', 'auxiliary', 'dominant_function'],
                'context_needed': True,
            })

    return chords
