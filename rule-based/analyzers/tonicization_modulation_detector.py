"""Layer 3-13: Tonicization vs Modulation Detector.

Distinguishes between brief tonicizations and longer modulations
based on cadential evidence (ii-V-I groups targeting non-tonic keys).

Key rules:
- ii-V-I to a diatonic scale degree (IV, vi, ii, etc.) = tonicization by default.
  These are extremely common in jazz and almost never represent real modulations.
- ii-V-I to a non-diatonic target = tonicization for 1 cadence,
  modulation if 2+ cadences span 6+ bars to the SAME non-diatonic target.
- Incomplete ii-V groups (no resolution) = tonicization at most.
- Only the chords that are actual members of the ii-V-I group get tagged.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name


def detect(chords: list[ParsedChord], key: str, groups: list[dict],
           modulation_min_cadences: int = 2,
           modulation_min_bars: int = 6) -> list[ParsedChord]:
    """Detect tonicizations and modulations.

    Args:
        chords: List of ParsedChord
        key: Song key
        groups: ii-V-I groups from the detector
        modulation_min_cadences: Min cadences for modulation (non-diatonic targets only)
        modulation_min_bars: Min bars for modulation (non-diatonic targets only)

    Returns:
        Updated chords with tonicization field.
    """
    key_root, mode = parse_key(key)

    # Collect all ii-V-I groups targeting keys other than the tonic
    non_tonic_groups = []
    for group in groups:
        target_key = group.get('target_key', '')
        from parsers.text_parser import parse_note_name
        tk_pc = parse_note_name(target_key)
        if tk_pc is not None and tk_pc != key_root:
            non_tonic_groups.append(group)

    if not non_tonic_groups:
        return chords

    # Group by target key
    key_events: dict[str, list[dict]] = {}
    for group in non_tonic_groups:
        tk = group.get('target_key', 'unknown')
        key_events.setdefault(tk, []).append(group)

    # For each target key, determine tonicization vs modulation
    for target_key_name, events in key_events.items():
        member_positions: set[tuple[int, float]] = set()
        all_bars: list[int] = []
        any_diatonic_target = any(g.get('is_diatonic_target', False) for g in events)
        any_incomplete = any(g.get('variant', '') == 'incomplete' for g in events)
        n_complete = sum(1 for g in events if g.get('variant', '') != 'incomplete')

        for group in events:
            for member in group.get('members', []):
                member_positions.add((member.get('bar', 0), member.get('beat', 1.0)))
                all_bars.append(member.get('bar', 0))

        if not all_bars:
            continue

        start_bar = min(all_bars)
        end_bar = max(all_bars)
        span = end_bar - start_bar + 1
        n_cadences = len(events)

        # ── Decision logic ──
        if any_diatonic_target:
            # Targets that are diatonic scale degrees are almost always tonicizations
            # in jazz, regardless of how many cadences there are.
            tonic_type = 'tonicization'
            confidence = min(0.8, 0.5 + 0.15 * n_cadences)
        elif any_incomplete and n_complete == 0:
            # Only incomplete ii-V groups (no resolution) = weak tonicization
            tonic_type = 'tonicization'
            confidence = 0.4
        elif (n_complete >= modulation_min_cadences
              and span >= modulation_min_bars):
            # Multiple complete cadences to a non-diatonic target over many bars
            tonic_type = 'modulation'
            confidence = min(0.9, 0.5 + 0.1 * n_complete + 0.03 * span)
        else:
            tonic_type = 'tonicization'
            confidence = min(0.8, 0.4 + 0.2 * n_cadences)

        evidence = []
        for g in events:
            mbars = [m.get('bar', 0) for m in g['members']]
            variant = g.get('variant', '')
            evidence.append(
                f"{g['group_type']}({variant}) to {target_key_name} at bars "
                f"{min(mbars)}-{max(mbars)}"
            )

        # Tag ONLY chords that are members of the relevant ii-V-I groups
        for chord in chords:
            pos = (chord.bar, chord.beat)
            if pos in member_positions:
                chord.tonicization = {
                    'type': tonic_type,
                    'temporary_key': target_key_name,
                    'start_bar': start_bar,
                    'end_bar': end_bar,
                    'evidence': evidence,
                    'confidence': round(confidence, 2),
                }

    return chords
