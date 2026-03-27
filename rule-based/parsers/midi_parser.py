"""MIDI chord annotation parser (stub).

Extracts chord symbols from MIDI text events.
"""

from parsers.schema import SongInput, ChordEntry
from models.chord import ParsedChord
from parsers.text_parser import parse_chord_symbol


def parse_midi(filepath: str, title: str = "Untitled") -> tuple[SongInput, list[ParsedChord]]:
    """Parse chord annotations from MIDI text events.

    Requires music21 for MIDI parsing. Chord analysis logic is NOT delegated
    to music21 — only file I/O.

    Args:
        filepath: Path to MIDI file
        title: Song title

    Returns:
        (SongInput, list[ParsedChord])
    """
    try:
        from music21 import converter, midi
    except ImportError:
        raise ImportError(
            "music21 is required for MIDI parsing. Install with: pip install music21"
        )

    score = converter.parse(filepath)

    # Extract text events that look like chord symbols
    chord_entries = []
    parsed_chords = []

    for element in score.recurse():
        if hasattr(element, 'lyric') and element.lyric:
            symbol = element.lyric.strip()
            bar = int(element.measureNumber) if hasattr(element, 'measureNumber') else 0
            beat = float(element.beat) if hasattr(element, 'beat') else 1.0

            try:
                pc = parse_chord_symbol(symbol, bar=bar, beat=beat)
                if pc is not None:
                    entry = ChordEntry(bar=bar, beat=beat, symbol=symbol, duration_beats=1.0)
                    chord_entries.append(entry)
                    parsed_chords.append(pc)
            except ValueError:
                continue

    # Try to detect key from MIDI
    key_sig = score.analyze('key') if score else None
    key_str = str(key_sig) if key_sig else "C"
    # Normalize music21 key format
    key_str = key_str.replace(' major', '').replace(' minor', 'm')

    ts = score.getTimeSignatures()[0] if score.getTimeSignatures() else None
    time_sig = f"{ts.numerator}/{ts.denominator}" if ts else "4/4"

    song = SongInput(
        title=title,
        key=key_str,
        time_signature=time_sig,
        chords=chord_entries,
    )

    return song, parsed_chords
