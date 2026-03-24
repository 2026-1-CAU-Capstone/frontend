"""Chord data class definitions for internal representation."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ParsedChord:
    """Parsed chord internal representation."""
    original_symbol: str              # original (e.g., "Dm7(11)")
    root: int                         # pitch class (C=0, C#=1, ..., B=11)
    quality: str                      # core quality: "maj7", "min7", "dom7", etc.
    tensions: list[str] = field(default_factory=list)  # e.g., ["9", "b9", "#11"]
    bass: Optional[int] = None        # slash chord bass note (pitch class), None if absent
    bar: int = 0
    beat: float = 1.0
    duration_beats: float = 0.0

    # Analysis results (filled in by analyzers)
    degree: Optional[str] = None                    # "I", "ii", "bVII", etc.
    is_diatonic: Optional[bool] = None
    functions: list[dict] = field(default_factory=list)
    # e.g., [{"function": "T", "confidence": 0.7}, {"function": "D_substitute", "confidence": 0.3}]

    secondary_dominant: Optional[dict] = None
    # e.g., {"target_degree": "ii", "target_chord": "Dm7", "type": "V/ii"}

    group_memberships: list[dict] = field(default_factory=list)
    # e.g., [{"group_type": "ii-V-I", "group_id": 1, "role": "V", "variant": "tritone_sub"}]

    diminished_function: Optional[str] = None       # "passing", "auxiliary", "dominant_function"
    chromatic_approach: Optional[dict] = None        # {"target": "Dm7", "direction": "above"}
    deceptive_resolution: Optional[dict] = None      # {"expected": "Cmaj7", "actual": "Am7"}
    pedal_info: Optional[dict] = None                # {"pedal_note": 7, "is_over_pedal": true}
    modal_interchange: Optional[dict] = None         # {"source_mode": "aeolian", "borrowed_degree": "bVII"}
    mode_segment: Optional[str] = None               # "dorian", "lydian", etc.
    tonicization: Optional[dict] = None              # {"temporary_key": "F", "type": "tonicization"|"modulation"}

    ambiguity_flags: list[dict] = field(default_factory=list)
    # e.g., [{"aspect": "function", "interpretations": [...], "context_needed": true}]

    # Normalized quality (set by chord_normalizer)
    normalized_quality: Optional[str] = None

    # Ambiguity score (0.0 = certain, 1.0 = maximally ambiguous)
    # Set by analyzers.ambiguity_scorer
    ambiguity_score: float = 0.0
