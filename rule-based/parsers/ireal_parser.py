"""iReal Pro export parser (stub).

Parses iReal Pro exported chord charts into the unified schema.
"""

from parsers.schema import SongInput, ChordEntry
from models.chord import ParsedChord
from parsers.text_parser import parse_chord_symbol


def parse_ireal(data: str, title: str = "Untitled") -> tuple[SongInput, list[ParsedChord]]:
    """Parse iReal Pro export format.

    This is a basic implementation that handles the simplified iReal text format.
    Full iReal Pro URL decoding can be added later.

    Args:
        data: iReal Pro export string
        title: Song title

    Returns:
        (SongInput, list[ParsedChord])
    """
    # iReal Pro uses a specific URL encoding format
    # For now, delegate to text parser for simple cases
    raise NotImplementedError(
        "Full iReal Pro parser not yet implemented. "
        "Use text_parser for plain text chord progressions."
    )
