"""Plain text chord progression parser.

Parses chord symbols like "Dm7 | G7 | Cmaj7" into ParsedChord objects.
"""

import re
from typing import Optional
from models.chord import ParsedChord
from parsers.schema import ChordEntry, SongInput


# Pitch class mapping (C=0)
NOTE_TO_PC = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
}

PC_TO_NOTE = {
    0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B'
}

# For sharp keys
PC_TO_NOTE_SHARP = {
    0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F',
    6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B'
}


def parse_note_name(name: str) -> Optional[int]:
    """Parse a note name (e.g., 'C', 'Db', 'F#') to pitch class (0-11)."""
    if not name:
        return None
    base = name[0].upper()
    if base not in NOTE_TO_PC:
        return None
    pc = NOTE_TO_PC[base]
    rest = name[1:]
    for ch in rest:
        if ch == '#' or ch == '\u266f':
            pc = (pc + 1) % 12
        elif ch == 'b' or ch == '\u266d':
            pc = (pc - 1) % 12
        else:
            break
    return pc


def pc_to_note_name(pc: int) -> str:
    """Convert pitch class to note name."""
    return PC_TO_NOTE.get(pc % 12, str(pc))


def parse_key(key_str: str) -> tuple[int, str]:
    """Parse key string like 'C', 'Bb', 'F#m' into (pitch_class, mode).

    Returns:
        (root_pc, mode) where mode is 'major' or 'minor'
    """
    key_str = key_str.strip()
    # Check if minor
    mode = 'major'
    if key_str.endswith('m') and not key_str.endswith('maj'):
        mode = 'minor'
        key_str = key_str[:-1]
    elif key_str.endswith('min'):
        mode = 'minor'
        key_str = key_str[:-3]

    pc = parse_note_name(key_str)
    if pc is None:
        raise ValueError(f"Cannot parse key: {key_str}")
    return pc, mode


# Regex for chord symbol parsing
# Group 1: root note (letter + accidentals)
# Group 2: quality/extension suffix
# Group 3: slash bass note
CHORD_RE = re.compile(
    r'^([A-Ga-g][#b\u266f\u266d]*)'  # root
    r'(.*?)'                           # quality + tensions
    r'(?:/([A-Ga-g][#b\u266f\u266d]*))?$'  # optional slash bass
)

# No chord patterns
NO_CHORD_RE = re.compile(r'^(N\.?C\.?|NC|no\s*chord)$', re.IGNORECASE)


def _parse_quality_and_tensions(suffix: str) -> tuple[str, list[str]]:
    """Parse the quality/extension suffix of a chord symbol.

    Returns:
        (quality, tensions) where quality is normalized string and tensions is list.
    """
    original_suffix = suffix
    tensions = []

    # Handle empty suffix = major triad
    if not suffix:
        return 'maj', []

    # Extract parenthesized tensions first
    paren_tensions = []
    paren_match = re.search(r'\(([^)]+)\)', suffix)
    if paren_match:
        paren_content = paren_match.group(1)
        # Check for (maj7) pattern -> minmaj7
        if paren_content.lower() in ('maj7', 'm7', 'maj9'):
            pass  # handled below
        else:
            # Parse comma-separated tensions: (b9,#11,b13)
            for t in re.split(r'[,\s]+', paren_content):
                t = t.strip()
                if t:
                    paren_tensions.append(t)
            suffix = suffix[:paren_match.start()] + suffix[paren_match.end():]

    # Normalize unicode symbols
    suffix = suffix.replace('\u0394', 'maj7')  # triangle
    suffix = suffix.replace('\u00b0', 'dim')   # degree sign °
    suffix = suffix.replace('\u2205', 'min7b5')  # ø
    suffix = suffix.replace('\u00f8', 'min7b5')  # ø (another encoding)

    s = suffix.strip()

    # --- Determine quality ---
    quality = None

    # minmaj7 patterns (must check before min)
    if re.match(r'^m\s*\(?\s*maj\s*7\s*\)?', s, re.IGNORECASE) or \
       re.match(r'^min\s*\(?\s*maj\s*7\s*\)?', s, re.IGNORECASE) or \
       re.match(r'^-\s*\(?\s*maj\s*7\s*\)?', s, re.IGNORECASE) or \
       re.match(r'^mM7', s) or re.match(r'^mMaj7', s, re.IGNORECASE):
        quality = 'minmaj7'
        s = re.sub(r'^(m|min|-)\s*\(?\s*(maj|M)\s*7\s*\)?', '', s, flags=re.IGNORECASE)

    # add chords: Cadd9, Cmadd9
    elif re.match(r'^m\s*add', s, re.IGNORECASE):
        quality = 'min'
        s = re.sub(r'^m\s*add', '', s, re.IGNORECASE)
        add_match = re.match(r'^(\d+)', s)
        if add_match:
            tensions.append(add_match.group(1))
            s = s[add_match.end():]
    elif re.match(r'^add', s, re.IGNORECASE):
        quality = 'maj'
        s = re.sub(r'^add', '', s, re.IGNORECASE)
        add_match = re.match(r'^(\d+)', s)
        if add_match:
            tensions.append(add_match.group(1))
            s = s[add_match.end():]

    # min7b5 / half-diminished
    elif re.match(r'^(m7b5|min7b5|-7b5|m7\u266d5)', s, re.IGNORECASE):
        quality = 'min7b5'
        s = re.sub(r'^(m7b5|min7b5|-7b5|m7\u266d5)', '', s, flags=re.IGNORECASE)

    # dim7
    elif re.match(r'^(dim7|o7)', s, re.IGNORECASE):
        quality = 'dim7'
        s = re.sub(r'^(dim7|o7)', '', s, flags=re.IGNORECASE)

    # dim (triad)
    elif re.match(r'^(dim|o)(?!7)', s, re.IGNORECASE):
        quality = 'dim'
        s = re.sub(r'^(dim|o)', '', s, flags=re.IGNORECASE)

    # aug maj7
    elif re.match(r'^(aug\s*maj7|\+\s*maj7|maj7#5|M7#5)', s, re.IGNORECASE):
        quality = 'augmaj7'
        s = re.sub(r'^(aug\s*maj7|\+\s*maj7|maj7#5|M7#5)', '', s, flags=re.IGNORECASE)

    # aug7 / 7#5
    elif re.match(r'^(aug7|\+7|7#5|7\+)', s, re.IGNORECASE):
        quality = 'aug7'
        s = re.sub(r'^(aug7|\+7|7#5|7\+)', '', s, flags=re.IGNORECASE)

    # aug (triad)
    elif re.match(r'^(aug|\+)(?![\d])', s, re.IGNORECASE):
        quality = 'aug'
        s = re.sub(r'^(aug|\+)', '', s, flags=re.IGNORECASE)

    # 7sus4 / 7sus
    elif re.match(r'^7sus4?', s, re.IGNORECASE):
        quality = 'dom7sus4'
        s = re.sub(r'^7sus4?', '', s, flags=re.IGNORECASE)

    # sus4
    elif re.match(r'^sus4?(?!2)', s, re.IGNORECASE):
        quality = 'sus4'
        s = re.sub(r'^sus4?', '', s, flags=re.IGNORECASE)

    # sus2
    elif re.match(r'^sus2', s, re.IGNORECASE):
        quality = 'sus2'
        s = re.sub(r'^sus2', '', s, flags=re.IGNORECASE)

    # Extended minor chords: m13, m11, m9
    elif re.match(r'^(m|min|-)13', s, re.IGNORECASE):
        quality = 'min7'
        s = re.sub(r'^(m|min|-)13', '', s, flags=re.IGNORECASE)
        tensions.extend(['9', '11', '13'])

    elif re.match(r'^(m|min|-)11', s, re.IGNORECASE):
        quality = 'min7'
        s = re.sub(r'^(m|min|-)11', '', s, flags=re.IGNORECASE)
        tensions.extend(['9', '11'])

    elif re.match(r'^(m|min|-)9', s, re.IGNORECASE):
        quality = 'min7'
        s = re.sub(r'^(m|min|-)9', '', s, flags=re.IGNORECASE)
        tensions.extend(['9'])

    # min7
    elif re.match(r'^(m7|min7|-7|mi7)', s, re.IGNORECASE):
        quality = 'min7'
        s = re.sub(r'^(m7|min7|-7|mi7)', '', s, flags=re.IGNORECASE)

    # min6
    elif re.match(r'^(m6|min6|-6)', s, re.IGNORECASE):
        quality = 'min6'
        s = re.sub(r'^(m6|min6|-6)', '', s, flags=re.IGNORECASE)

    # min (triad) - must come after m7, m9, etc.
    elif re.match(r'^(m(?!aj)|min|-(?!\d))(?!7|9|11|13|6|M)', s, re.IGNORECASE):
        quality = 'min'
        s = re.sub(r'^(m|min|-)', '', s, count=1, flags=re.IGNORECASE)

    # maj13, maj11, maj9
    elif re.match(r'^(maj13|ma13|M13|Maj13)', s):
        quality = 'maj7'
        s = re.sub(r'^(maj13|ma13|M13|Maj13)', '', s)
        tensions.extend(['9', '11', '13'])

    elif re.match(r'^(maj11|ma11|M11|Maj11)', s):
        quality = 'maj7'
        s = re.sub(r'^(maj11|ma11|M11|Maj11)', '', s)
        tensions.extend(['9', '11'])

    elif re.match(r'^(maj9|ma9|M9|Maj9)', s):
        quality = 'maj7'
        s = re.sub(r'^(maj9|ma9|M9|Maj9)', '', s)
        tensions.extend(['9'])

    # maj7
    elif re.match(r'^(maj7|ma7|M7|Maj7|\^7|\^)', s):
        quality = 'maj7'
        s = re.sub(r'^(maj7|ma7|M7|Maj7|\^7|\^)', '', s)

    # maj6
    elif re.match(r'^(maj6|M6)', s):
        quality = 'maj6'
        s = re.sub(r'^(maj6|M6)', '', s)

    # 6 (major 6th)
    elif re.match(r'^6(?!\/)', s):
        quality = 'maj6'
        s = re.sub(r'^6', '', s)

    # 7alt
    elif re.match(r'^7alt', s, re.IGNORECASE):
        quality = 'dom7'
        s = re.sub(r'^7alt', '', s, flags=re.IGNORECASE)
        tensions.extend(['b9', '#9', '#11', 'b13'])

    # Extended dominant: 13, 11, 9
    elif re.match(r'^13', s):
        quality = 'dom7'
        s = re.sub(r'^13', '', s)
        tensions.extend(['9', '11', '13'])

    elif re.match(r'^11', s):
        quality = 'dom7'
        s = re.sub(r'^11', '', s)
        tensions.extend(['9', '11'])

    elif re.match(r'^9', s):
        quality = 'dom7'
        s = re.sub(r'^9', '', s)
        tensions.extend(['9'])

    # dom7 (plain "7")
    elif re.match(r'^7', s):
        quality = 'dom7'
        s = re.sub(r'^7', '', s)

    # maj (triad explicit)
    elif re.match(r'^(maj|M(?!7))(?!7|9|11|13)', s):
        quality = 'maj'
        s = re.sub(r'^(maj|M)', '', s, count=1)

    # 5 (power chord)
    elif re.match(r'^5$', s):
        quality = 'power'
        s = ''

    # If nothing matched, it's a major triad
    if quality is None:
        quality = 'maj'

    # Parse remaining tensions from leftover suffix
    remaining_tensions = re.findall(r'[#b\u266f\u266d]*\d+', s)
    tensions.extend(remaining_tensions)

    # Add parenthesized tensions
    tensions.extend(paren_tensions)

    # Deduplicate tensions preserving order
    seen = set()
    unique_tensions = []
    for t in tensions:
        if t not in seen:
            seen.add(t)
            unique_tensions.append(t)

    return quality, unique_tensions


def parse_chord_symbol(symbol: str, bar: int = 0, beat: float = 1.0,
                       duration_beats: float = 0.0) -> Optional[ParsedChord]:
    """Parse a single chord symbol string into a ParsedChord.

    Args:
        symbol: Chord symbol string (e.g., "Dm7", "G7(b9)", "Db/C")
        bar: Bar number
        beat: Beat position
        duration_beats: Duration in beats

    Returns:
        ParsedChord object, or None if it's a N.C. marker
    """
    symbol = symbol.strip()
    if not symbol:
        return None

    # Check for no-chord
    if NO_CHORD_RE.match(symbol):
        return None

    match = CHORD_RE.match(symbol)
    if not match:
        raise ValueError(f"Cannot parse chord symbol: '{symbol}'")

    root_str = match.group(1)
    quality_suffix = match.group(2) or ''
    bass_str = match.group(3)

    root = parse_note_name(root_str)
    if root is None:
        raise ValueError(f"Cannot parse root note: '{root_str}'")

    bass = parse_note_name(bass_str) if bass_str else None
    quality, tensions = _parse_quality_and_tensions(quality_suffix)

    return ParsedChord(
        original_symbol=symbol,
        root=root,
        quality=quality,
        tensions=tensions,
        bass=bass,
        bar=bar,
        beat=beat,
        duration_beats=duration_beats,
    )


def parse_progression_text(text: str, title: str = "Untitled",
                           key: str = "C", time_signature: str = "4/4") -> tuple[SongInput, list[ParsedChord]]:
    """Parse a plain text chord progression into SongInput and list of ParsedChord.

    Format: Chords separated by '|' for bar lines. Multiple chords in a bar
    separated by spaces. Lines are concatenated.

    Examples:
        "Dm7 | G7 | Cmaj7"
        "Dm7 G7 | Cmaj7 |"

    Returns:
        (SongInput, list[ParsedChord])
    """
    # Determine beats per bar
    if '/' in time_signature:
        num, denom = time_signature.split('/')
        beats_per_bar = int(num)
    else:
        beats_per_bar = 4

    # Clean and split into bars
    lines = text.strip().split('\n')
    all_bars_text = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        # Split by bar lines
        bars = [b.strip() for b in line.split('|') if b.strip()]
        all_bars_text.extend(bars)

    chord_entries = []
    parsed_chords = []
    bar_num = 0

    for bar_text in all_bars_text:
        bar_num += 1
        # Split chords within bar by whitespace
        symbols = bar_text.split()
        if not symbols:
            continue

        # Filter out N.C. tokens
        valid_symbols = []
        for s in symbols:
            if not NO_CHORD_RE.match(s):
                valid_symbols.append(s)

        if not valid_symbols:
            continue

        n_chords = len(valid_symbols)
        beat_duration = beats_per_bar / n_chords

        for i, sym in enumerate(valid_symbols):
            beat = 1.0 + i * beat_duration

            entry = ChordEntry(
                bar=bar_num,
                beat=beat,
                symbol=sym,
                duration_beats=beat_duration,
            )
            chord_entries.append(entry)

            pc = parse_chord_symbol(sym, bar=bar_num, beat=beat,
                                    duration_beats=beat_duration)
            if pc is not None:
                parsed_chords.append(pc)

    song = SongInput(
        title=title,
        key=key,
        time_signature=time_signature,
        chords=chord_entries,
    )

    return song, parsed_chords
