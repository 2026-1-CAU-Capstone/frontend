"""Aggregator: Combines all analyzer results into the final output JSON."""

import json
from models.chord import ParsedChord
from parsers.text_parser import pc_to_note_name


ENGINE_VERSION = "0.1.0"

COVERAGE = [
    "diatonic_classification",
    "scale_degree_calculation",
    "T_SD_D_function_labeling",
    "chord_normalization",
    "ii-V-I_detection",
    "tritone_substitution_detection",
    "secondary_dominant_detection",
    "diminished_chord_classification",
    "chromatic_approach_detection",
    "deceptive_resolution_detection",
    "pedal_point_detection",
    "modal_interchange_detection",
    "mode_segment_detection",
    "tonicization_modulation_detection",
    "section_boundary_detection",
    "ambiguity_scoring",
]


def _chord_to_dict(chord: ParsedChord) -> dict:
    """Convert a ParsedChord to its output dictionary."""
    analysis = {
        'root': chord.root,
        'root_name': pc_to_note_name(chord.root),
        'quality': chord.quality,
        'normalized_quality': chord.normalized_quality or chord.quality,
        'tensions': chord.tensions if chord.tensions else [],
        'bass': chord.bass,
        'bass_name': pc_to_note_name(chord.bass) if chord.bass is not None else None,
        'degree': chord.degree,
        'is_diatonic': chord.is_diatonic,
        'functions': chord.functions if chord.functions else [],
        'secondary_dominant': chord.secondary_dominant,
        'group_memberships': chord.group_memberships if chord.group_memberships else [],
        'diminished_function': chord.diminished_function,
        'chromatic_approach': chord.chromatic_approach,
        'deceptive_resolution': chord.deceptive_resolution,
        'pedal_info': chord.pedal_info,
        'modal_interchange': chord.modal_interchange,
        'mode_segment': chord.mode_segment,
        'tonicization': chord.tonicization,
        'ambiguity_flags': chord.ambiguity_flags if chord.ambiguity_flags else [],
        'ambiguity_score': chord.ambiguity_score,
    }

    return {
        'bar': chord.bar,
        'beat': chord.beat,
        'symbol': chord.original_symbol,
        'duration_beats': chord.duration_beats,
        'analysis': analysis,
    }


def aggregate(song_title: str, key: str, time_signature: str,
              chords: list[ParsedChord], groups: list[dict],
              sections: list[dict]) -> dict:
    """Aggregate all analysis results into the final output JSON.

    Args:
        song_title: Song title
        key: Song key
        time_signature: Time signature
        chords: Fully analyzed ParsedChord list
        groups: ii-V-I and other group dicts
        sections: Section boundary dicts

    Returns:
        Complete output dictionary.
    """
    chord_dicts = [_chord_to_dict(c) for c in chords]

    # Compute song-level ambiguity statistics
    scores = [c.ambiguity_score for c in chords]
    n = len(scores)
    high_conf = sum(1 for s in scores if s <= 0.1)
    ambiguous = sum(1 for s in scores if s > 0.3)

    output = {
        'song': {
            'title': song_title,
            'key': key,
            'time_signature': time_signature,
        },
        'chords': chord_dicts,
        'groups': groups,
        'sections': sections,
        'ambiguity_stats': {
            'total_chords': n,
            'high_confidence_count': high_conf,
            'high_confidence_pct': round(high_conf / n * 100, 1) if n else 0,
            'ambiguous_count': ambiguous,
            'ambiguous_pct': round(ambiguous / n * 100, 1) if n else 0,
            'mean_score': round(sum(scores) / n, 3) if n else 0,
            'max_score': round(max(scores), 3) if scores else 0,
        },
        'engine_version': ENGINE_VERSION,
        'coverage': COVERAGE,
    }

    return output


def to_json(output: dict, indent: int = 2) -> str:
    """Serialize output to JSON string."""
    return json.dumps(output, indent=indent, ensure_ascii=False)
