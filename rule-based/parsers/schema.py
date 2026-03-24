"""Unified Chord Annotation JSON schema definition."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ChordEntry:
    """Single chord entry from input."""
    bar: int                          # bar number (1-indexed)
    beat: float                       # beat position (1.0, 2.0, 2.5, etc.)
    symbol: str                       # original chord symbol (e.g., "Dm7(11)", "G7alt", "Db/C")
    duration_beats: float             # duration in beats


@dataclass
class SongInput:
    """Full song input."""
    title: str
    key: str                          # e.g., "C", "Bb", "F#m"
    time_signature: str               # e.g., "4/4", "3/4"
    chords: list[ChordEntry] = field(default_factory=list)
    tempo: Optional[int] = None
