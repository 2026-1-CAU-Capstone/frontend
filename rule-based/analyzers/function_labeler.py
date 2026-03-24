"""Layer 1-2: Function Labeler.

Assigns T (Tonic), SD (Subdominant), D (Dominant) functions to each chord
based on its scale degree. Supports ambiguous multiple-function assignment.

v2 improvements:
- Broader chromatic degree coverage (II, III, VI, VII, bii, bvii, etc.)
- Post-hoc contextual pass: chords in ii-V-I groups get role-based functions
  (ii→SD, V→D, I→T) even when the degree lookup is empty.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key
from config_data import FUNCTION_MAP


def _load_function_map() -> dict:
    """Load function mapping from Python config."""
    return FUNCTION_MAP


# Degree normalization: strip diminished/augmented markers for lookup
def _normalize_degree_for_lookup(degree: str) -> str:
    """Normalize degree label for function map lookup.

    Removes trailing ° and + markers, keeps case and accidentals.
    """
    if degree is None:
        return ''
    return degree.rstrip('°+')


def label(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Assign harmonic functions to chords based on their degrees.

    Args:
        chords: List of ParsedChord with degree and is_diatonic already set
        key: Key string

    Returns:
        Same list with functions field populated.
    """
    func_map = _load_function_map()
    _, mode = parse_key(key)

    key_section = 'major_key' if mode == 'major' else 'minor_key'
    degree_map = func_map.get(key_section, {})
    chromatic_map = func_map.get('chromatic_degrees', {})

    for chord in chords:
        if chord.degree is None:
            continue

        lookup = _normalize_degree_for_lookup(chord.degree)

        if chord.is_diatonic:
            # Look up in the appropriate key's function map
            funcs = degree_map.get(lookup, [])
            if funcs:
                chord.functions = [dict(f) for f in funcs]
            else:
                # Try case-insensitive match
                for deg_key, deg_funcs in degree_map.items():
                    if deg_key.lower() == lookup.lower():
                        chord.functions = [dict(f) for f in deg_funcs]
                        break
        else:
            # Non-diatonic: check chromatic degree map first (exact match)
            funcs = chromatic_map.get(lookup, [])
            if funcs:
                chord.functions = [dict(f) for f in funcs]
            else:
                # Try case-insensitive match in chromatic map
                for deg_key, deg_funcs in chromatic_map.items():
                    if deg_key.lower() == lookup.lower():
                        chord.functions = [dict(f) for f in deg_funcs]
                        break

            # If still empty, also try the diatonic map (some chords like
            # a dom7 on degree V in minor key might have a degree label
            # that matches the diatonic map)
            if not chord.functions:
                funcs = degree_map.get(lookup, [])
                if funcs:
                    chord.functions = [dict(f) for f in funcs]

            # Last resort: add ambiguity flag
            if not chord.functions:
                chord.ambiguity_flags.append({
                    'aspect': 'function',
                    'interpretations': ['unknown - awaiting contextual analysis'],
                    'context_needed': True
                })

    return chords


def label_from_groups(chords: list[ParsedChord]) -> list[ParsedChord]:
    """Post-hoc pass: assign functions based on ii-V-I group membership.

    Chords that still have empty functions but belong to a ii-V-I group
    get their function from their role in the group.
    """
    ROLE_FUNCTIONS = {
        'ii': [{'function': 'SD', 'confidence': 0.9, 'note': 'ii role in ii-V-I group'}],
        'iv (backdoor)': [{'function': 'SD', 'confidence': 0.8, 'note': 'iv role in backdoor ii-V-I'}],
        'V': [{'function': 'D', 'confidence': 1.0, 'note': 'V role in ii-V-I group'}],
        'V (tritone sub bII7)': [{'function': 'D', 'confidence': 0.9, 'note': 'Tritone sub V in ii-V-I'}],
        'V (backdoor bVII7)': [{'function': 'D', 'confidence': 0.8, 'note': 'Backdoor V in ii-V-I'}],
        'V (resolved from sus4)': [{'function': 'D', 'confidence': 1.0, 'note': 'V (sus resolved) in ii-V-I'}],
        'I': [{'function': 'T', 'confidence': 1.0, 'note': 'I role in ii-V-I group'}],
        'I (iii substitute)': [{'function': 'T', 'confidence': 0.7, 'note': 'iii substitute for I in ii-V-I'}],
    }

    for chord in chords:
        if chord.functions:
            continue
        for gm in chord.group_memberships:
            if gm.get('group_type') == 'ii-V-I':
                role = gm.get('role', '')
                funcs = ROLE_FUNCTIONS.get(role)
                if funcs:
                    chord.functions = [dict(f) for f in funcs]
                    # Remove the ambiguity flag if we just resolved it
                    chord.ambiguity_flags = [
                        a for a in chord.ambiguity_flags
                        if a.get('aspect') != 'function'
                    ]
                    break

    return chords
