"""Layer 2-5: Tritone Substitution Detector.

Detects tritone substitutions: dom7 chords resolving down by semitone.
Works both independently and in conjunction with the ii-V-I detector.
"""

from models.chord import ParsedChord
from parsers.text_parser import pc_to_note_name


def _is_dom7(q: str) -> bool:
    return q in ('dom7', 'dom7sus4', 'aug7')


def detect(chords: list[ParsedChord], groups: list[dict]) -> list[ParsedChord]:
    """Detect tritone substitutions.

    A dom7 chord resolving down by semitone (1 semitone) to the next chord
    is a tritone sub candidate.

    Args:
        chords: List of ParsedChord
        groups: Existing ii-V-I groups (to avoid double-tagging)

    Returns:
        Updated chords with tritone sub info in functions/ambiguity_flags.
    """
    # Collect chord indices already tagged as tritone sub in ii-V-I groups
    already_tagged = set()
    for group in groups:
        if 'tritone_sub' in group.get('variant', ''):
            for member in group.get('members', []):
                if 'tritone' in member.get('role', '').lower():
                    already_tagged.add((member.get('bar'), member.get('beat')))

    n = len(chords)
    for i in range(n - 1):
        chord = chords[i]
        next_chord = chords[i + 1]
        nq = chord.normalized_quality or chord.quality

        if not _is_dom7(nq):
            continue

        # Check if already tagged
        if (chord.bar, chord.beat) in already_tagged:
            continue

        # Check resolution: down by semitone
        interval = (next_chord.root - chord.root) % 12
        if interval == 11:  # down by 1 semitone = up by 11
            # This is a tritone sub
            original_v_root = (chord.root + 6) % 12
            original_v_name = pc_to_note_name(original_v_root)

            # Add to functions if not already present
            has_d_sub = any(f.get('function') == 'D_substitute' for f in chord.functions)
            if not has_d_sub:
                chord.functions.append({
                    'function': 'D_substitute',
                    'confidence': 0.8,
                    'note': f'Tritone sub of {original_v_name}7',
                })

            # Add ambiguity
            chord.ambiguity_flags.append({
                'aspect': 'tritone_substitution',
                'interpretations': [
                    f'bII7 tritone sub of {original_v_name}7',
                    f'Could be Phrygian bII or chromatic approach if no preceding ii',
                ],
                'context_needed': False,
            })

    return chords
