"""Layer 3-14: Section Boundary Detector.

Detects section boundaries based on key changes evidenced by ii-V-I group
targets, tonicization/modulation markers, and returns to the home key.

v3 improvements:
- Tonicizations do NOT create section breaks (they are temporary by definition).
- Only modulations create new sections.
- Mode is reported per section as the predominant mode over the section span.
- Short orphan sections (1-2 bars) are absorbed into neighbours.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name, parse_note_name


def detect(chords: list[ParsedChord], key: str) -> list[dict]:
    """Detect section boundaries.

    Args:
        chords: List of ParsedChord (fully analyzed)
        key: Song key

    Returns:
        List of section dicts with start_bar, end_bar, key, mode, type.
    """
    if not chords:
        return []

    key_root, key_mode = parse_key(key)
    default_mode = 'aeolian' if key_mode == 'minor' else 'ionian'
    max_bar = max(c.bar for c in chords)

    # ── Step 1: Build bar → effective key map ──
    # Only MODULATIONS change the section key. Tonicizations are transparent.
    bar_key: dict[int, str] = {b: key for b in range(1, max_bar + 1)}
    bar_type: dict[int, str] = {b: 'original_key' for b in range(1, max_bar + 1)}

    for chord in chords:
        if chord.tonicization and chord.tonicization.get('type') == 'modulation':
            tk = chord.tonicization.get('temporary_key', key)
            bar_key[chord.bar] = tk
            bar_type[chord.bar] = 'modulation'

    # ── Step 2: Determine predominant mode per bar ──
    bar_mode: dict[int, str] = {}
    bar_chords: dict[int, list[ParsedChord]] = {}
    for c in chords:
        bar_chords.setdefault(c.bar, []).append(c)

    for b in range(1, max_bar + 1):
        modes = [c.mode_segment for c in bar_chords.get(b, []) if c.mode_segment]
        if modes:
            bar_mode[b] = max(set(modes), key=modes.count)
        else:
            bar_mode[b] = default_mode

    # ── Step 3: Build sections from contiguous key regions ──
    sections = []
    current_start = 1
    current_key = bar_key[1]
    current_type = bar_type[1]

    for b in range(2, max_bar + 1):
        if bar_key[b] != current_key:
            # Determine predominant mode for the closing section
            section_modes = [bar_mode[bb] for bb in range(current_start, b)]
            section_mode = max(set(section_modes), key=section_modes.count) if section_modes else default_mode

            sections.append({
                'start_bar': current_start,
                'end_bar': b - 1,
                'key': current_key,
                'mode': section_mode,
                'type': current_type,
            })
            current_start = b
            current_key = bar_key[b]
            current_type = bar_type[b]

    # Close final section
    final_modes = [bar_mode[bb] for bb in range(current_start, max_bar + 1)]
    final_mode = max(set(final_modes), key=final_modes.count) if final_modes else default_mode
    sections.append({
        'start_bar': current_start,
        'end_bar': max_bar,
        'key': current_key,
        'mode': final_mode,
        'type': current_type,
    })

    # ── Step 4: Merge adjacent sections with same key ──
    merged = []
    for s in sections:
        if merged and s['key'] == merged[-1]['key']:
            merged[-1]['end_bar'] = s['end_bar']
            # Re-evaluate mode over the merged span
            span_modes = [bar_mode[bb] for bb in range(merged[-1]['start_bar'], s['end_bar'] + 1)]
            merged[-1]['mode'] = max(set(span_modes), key=span_modes.count) if span_modes else default_mode
        else:
            merged.append(dict(s))

    # ── Step 5: Absorb short sections (≤2 bars) into the nearest neighbour
    #            with the home key, if possible ──
    if len(merged) > 1:
        cleaned = []
        for s in merged:
            span = s['end_bar'] - s['start_bar'] + 1
            if span <= 2 and cleaned and cleaned[-1]['key'] == key:
                # Absorb into previous home-key section
                cleaned[-1]['end_bar'] = s['end_bar']
            elif span <= 2 and cleaned:
                # Absorb into previous section regardless
                cleaned[-1]['end_bar'] = s['end_bar']
            else:
                cleaned.append(s)
        merged = cleaned

    # ── Step 6: Enrich with tonicization annotations ──
    # For each section, collect any tonicization events that happen within it
    # (these don't break sections but are informative)
    for s in merged:
        tonics_in_section = set()
        for c in chords:
            if s['start_bar'] <= c.bar <= s['end_bar'] and c.tonicization:
                t = c.tonicization
                if t.get('type') == 'tonicization':
                    tonics_in_section.add(t['temporary_key'])
        if tonics_in_section:
            s['tonicizations'] = sorted(tonics_in_section)

    return merged
