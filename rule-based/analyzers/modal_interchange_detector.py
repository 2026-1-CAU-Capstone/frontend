"""Layer 3-11: Modal Interchange Detector.

Detects chords borrowed from parallel modes (e.g., bVII from mixolydian/aeolian).
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name
from config_data import MODAL_INTERCHANGE


def _load_modal_interchange() -> dict:
    return MODAL_INTERCHANGE


def detect(chords: list[ParsedChord], key: str) -> list[ParsedChord]:
    """Detect modal interchange chords.

    For each non-diatonic chord, check if it belongs to a parallel mode's
    diatonic set. If so, tag it as modal interchange.

    Args:
        chords: List of ParsedChord
        key: Song key

    Returns:
        Updated chords with modal_interchange field.
    """
    key_root, mode = parse_key(key)

    # Only detect modal interchange for major keys
    # (minor keys borrowing from major is less common to label this way)
    if mode != 'major':
        return chords

    mi_config = _load_modal_interchange()

    for chord in chords:
        if chord.is_diatonic:
            continue

        # Skip chords already fully explained
        if chord.secondary_dominant is not None:
            continue

        nq = chord.normalized_quality or chord.quality
        chord_interval = (chord.root - key_root) % 12

        # Check each mode
        matches = []
        for mode_name, mode_data in mi_config.items():
            for degree_info in mode_data.get('available_degrees', []):
                if degree_info['interval'] == chord_interval and degree_info['quality'] == nq:
                    # Check if it's a common borrow
                    is_common = False
                    degree_label = degree_info['degree_label']
                    for cb in mode_data.get('common_borrows', []):
                        if cb['degree_label'] == degree_label:
                            is_common = True
                            break
                    matches.append({
                        'source_mode': mode_name,
                        'borrowed_degree': degree_label,
                        'is_common_borrow': is_common,
                    })

        if matches:
            # Pick the most likely (prefer common borrows, then aeolian)
            best = None
            for m in matches:
                if m['is_common_borrow']:
                    best = m
                    break
            if best is None:
                best = matches[0]

            chord.modal_interchange = {
                'source_mode': best['source_mode'],
                'borrowed_degree': best['borrowed_degree'],
                'is_common_borrow': best['is_common_borrow'],
                'all_possible_sources': matches,
            }

            # Update functions if empty
            if not chord.functions:
                chord.functions = [{
                    'function': 'modal_interchange',
                    'confidence': 0.7 if best['is_common_borrow'] else 0.5,
                    'note': f"Borrowed from {best['source_mode']} mode ({best['borrowed_degree']})",
                }]

    return chords
