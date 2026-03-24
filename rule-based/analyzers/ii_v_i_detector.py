"""Layer 2-4: ii-V-I Detector.

Detects ii-V-I progressions and their variants in chord sequences.
"""

from models.chord import ParsedChord
from parsers.text_parser import parse_key, pc_to_note_name

# Major / minor scales for diatonic target check
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

# Dominant quality chords (can serve as V)
DOMINANT_QUALITIES = {'dom7', 'dom7sus4', 'aug7'}

# ii qualities (minor family)
II_MINOR_QUALITIES = {'min7', 'min', 'min6'}
II_HALFDIM_QUALITIES = {'min7b5', 'dim'}

# I qualities (tonic)
I_MAJOR_QUALITIES = {'maj7', 'maj', 'maj6', 'maj'}
I_MINOR_QUALITIES = {'min7', 'min', 'minmaj7', 'min6'}


def _interval(a: int, b: int) -> int:
    """Calculate ascending interval from a to b in semitones (mod 12)."""
    return (b - a) % 12


def _is_dominant_quality(q: str) -> bool:
    """Check if quality is dominant family."""
    return q in DOMINANT_QUALITIES or q == 'dom7'


def detect(chords: list[ParsedChord], key: str) -> tuple[list[ParsedChord], list[dict]]:
    """Detect ii-V-I progressions in the chord sequence.

    Args:
        chords: List of ParsedChord (with quality already set)
        key: Song key string

    Returns:
        (chords with group_memberships updated, list of group dicts)
    """
    key_root, key_mode = parse_key(key)
    groups = []
    group_id = 0
    used_indices = set()  # Track which chord indices are already in a group

    n = len(chords)

    # First pass: find V7 chords and look for ii before and I after
    for v_idx in range(n):
        v_chord = chords[v_idx]
        nq = v_chord.normalized_quality or v_chord.quality

        if not _is_dominant_quality(nq):
            continue

        v_root = v_chord.root
        # Expected I target: P5 below V (= P4 above = 5 semitones below)
        target_root = (v_root - 7) % 12  # V down P5 = target I

        # Check for sus4 delay: V7sus4 -> V7 pattern
        sus_delay = False
        actual_v_idx = v_idx
        if nq == 'dom7sus4' and v_idx + 1 < n:
            next_chord = chords[v_idx + 1]
            next_nq = next_chord.normalized_quality or next_chord.quality
            if next_nq == 'dom7' and next_chord.root == v_root:
                sus_delay = True
                actual_v_idx = v_idx + 1

        # Look for I after V (or after V7 if sus delay)
        i_idx = actual_v_idx + 1
        i_chord = None
        i_role = "I"
        variant = "standard"
        has_i = False

        if i_idx < n:
            i_chord = chords[i_idx]
            i_nq = i_chord.normalized_quality or i_chord.quality
            i_root = i_chord.root

            if i_root == target_root:
                if i_nq in I_MAJOR_QUALITIES:
                    has_i = True
                    variant = "standard"
                elif i_nq in I_MINOR_QUALITIES:
                    has_i = True
                    variant = "minor"
            elif _interval(target_root, i_root) == 4:
                # iii as I substitute (e.g., Em7 instead of Cmaj7)
                if i_nq in II_MINOR_QUALITIES:
                    has_i = True
                    i_role = "I (iii substitute)"
                    variant = "standard"

        # Look for ii before V
        ii_idx = v_idx - 1
        ii_chord = None
        ii_role = "ii"
        has_ii = False

        if ii_idx >= 0:
            ii_chord = chords[ii_idx]
            ii_nq = ii_chord.normalized_quality or ii_chord.quality
            ii_root = ii_chord.root

            expected_ii_root = (v_root - 7) % 12  # same as target, which is correct:
            # Actually ii is a P5 above the target I, which is same as V's target
            # No: ii is a whole step below V. V root - 2 semitones? No.
            # ii root should be a P4 below V (= 5 semitones below V)
            # In C: ii=D(2), V=G(7). D to G = 5 semitones. G to D = 7 semitones.
            # So ii_root = (v_root - 5) % 12? No. (7-5)=2=D. But target_root = (7-7)%12 = 0 = C
            # ii is a M2 above I. So ii_root = (target_root + 2) % 12
            expected_ii_root = (target_root + 2) % 12

            if ii_root == expected_ii_root:
                if ii_nq in II_MINOR_QUALITIES:
                    has_ii = True
                    variant = "standard" if variant == "standard" else variant
                elif ii_nq in II_HALFDIM_QUALITIES:
                    has_ii = True
                    variant = "minor"

        # Check for tritone sub on V position
        # Tritone sub: instead of V7, we have bII7 (root is tritone from V, i.e., 1 semitone above target)
        is_tritone_sub_v = False
        if not has_i and i_idx < n:
            # Check if V chord is actually a tritone sub resolving down by semitone
            i_chord_check = chords[i_idx]
            if _interval(v_root, i_chord_check.root) == 11:  # down by semitone = up by 11
                # V resolves down by semitone -> this is bII7 resolving to I
                actual_target = i_chord_check.root
                i_nq = i_chord_check.normalized_quality or i_chord_check.quality
                if i_nq in I_MAJOR_QUALITIES or i_nq in I_MINOR_QUALITIES:
                    has_i = True
                    is_tritone_sub_v = True
                    target_root = actual_target
                    variant = "tritone_sub_V"
                    # Re-check ii
                    expected_ii_root_tt = (actual_target + 2) % 12
                    if has_ii and ii_chord.root == expected_ii_root_tt:
                        pass  # ii is still valid
                    elif ii_idx >= 0:
                        ii_chord = chords[ii_idx]
                        ii_nq = ii_chord.normalized_quality or ii_chord.quality
                        if ii_chord.root == expected_ii_root_tt and ii_nq in II_MINOR_QUALITIES:
                            has_ii = True

        # Also check: V chord resolves normally but there's a tritone sub ii
        if has_i and not is_tritone_sub_v and has_ii is False and ii_idx >= 0:
            ii_chord = chords[ii_idx]
            ii_nq = ii_chord.normalized_quality or ii_chord.quality
            # Tritone sub of ii: the ii is replaced by bvi (minor chord a tritone away)
            expected_sub_ii_root = (expected_ii_root + 6) % 12
            if ii_chord.root == expected_sub_ii_root and ii_nq in II_MINOR_QUALITIES:
                has_ii = True
                ii_role = "ii (tritone sub)"
                variant = "tritone_sub_ii_V"

        # Check for backdoor: iv -> bVII7 -> I
        # Backdoor: bVII7 resolves UP by whole step to I (not down P5)
        # Skip if this is the diatonic V7 — that's a deceptive resolution, not backdoor
        is_diatonic_v = (v_chord.is_diatonic and
                         _interval(key_root, v_root) == 7 and
                         _is_dominant_quality(nq))
        if not has_i and not is_diatonic_v and i_idx < n:
            i_chord_bd = chords[i_idx]
            i_nq = i_chord_bd.normalized_quality or i_chord_bd.quality
            bd_target = (v_root + 2) % 12
            if i_chord_bd.root == bd_target and (i_nq in I_MAJOR_QUALITIES or i_nq in I_MINOR_QUALITIES):
                target_root = bd_target
                has_i = True
                has_ii = False  # Reset ii — previous ii was for a different target
                ii_role = "ii"
                # Check for iv before bVII7
                if ii_idx >= 0:
                    ii_chord = chords[ii_idx]
                    ii_nq = ii_chord.normalized_quality or ii_chord.quality
                    expected_iv = (bd_target + 5) % 12  # iv is P4 above I
                    if ii_chord.root == expected_iv and ii_nq in II_MINOR_QUALITIES:
                        has_ii = True
                        ii_role = "iv (backdoor)"
                variant = "backdoor"

        # Build group if we have at least V-I
        if not has_i and not has_ii:
            continue

        if has_i or has_ii:
            # Need at least V + one other chord
            if not has_i and not has_ii:
                continue

            group_id += 1
            target_key_name = pc_to_note_name(target_root)
            # A target is "diatonic" if its root is a scale degree of the home key
            scale = NATURAL_MINOR_SCALE if key_mode == 'minor' else MAJOR_SCALE
            scale_pcs = {(key_root + s) % 12 for s in scale}
            is_diatonic_target = (target_root in scale_pcs)

            # Determine if incomplete
            if not has_i:
                variant = "incomplete"

            if sus_delay:
                variant = variant + "_with_sus_delay" if variant != "standard" else "standard_with_sus_delay"

            members = []

            if has_ii and ii_chord is not None:
                members.append({
                    'bar': ii_chord.bar,
                    'beat': ii_chord.beat,
                    'symbol': ii_chord.original_symbol,
                    'role': ii_role,
                    'is_diatonic': ii_chord.is_diatonic,
                })
                if ii_idx not in used_indices:
                    ii_chord.group_memberships.append({
                        'group_id': group_id,
                        'group_type': 'ii-V-I',
                        'role': ii_role,
                        'variant': variant,
                    })
                    used_indices.add(ii_idx)

            # V chord
            v_role = "V"
            if is_tritone_sub_v:
                v_role = "V (tritone sub bII7)"
            elif variant == "backdoor":
                v_role = "V (backdoor bVII7)"
            members.append({
                'bar': v_chord.bar,
                'beat': v_chord.beat,
                'symbol': v_chord.original_symbol,
                'role': v_role,
                'is_diatonic': v_chord.is_diatonic,
            })
            if v_idx not in used_indices:
                v_chord.group_memberships.append({
                    'group_id': group_id,
                    'group_type': 'ii-V-I',
                    'role': v_role,
                    'variant': variant,
                })
                used_indices.add(v_idx)

            # Sus delay chord
            if sus_delay:
                sus_chord = chords[actual_v_idx]
                members.append({
                    'bar': sus_chord.bar,
                    'beat': sus_chord.beat,
                    'symbol': sus_chord.original_symbol,
                    'role': 'V (resolved from sus4)',
                    'is_diatonic': sus_chord.is_diatonic,
                })
                sus_chord.group_memberships.append({
                    'group_id': group_id,
                    'group_type': 'ii-V-I',
                    'role': 'V (resolved from sus4)',
                    'variant': variant,
                })

            if has_i and i_chord is not None:
                members.append({
                    'bar': i_chord.bar,
                    'beat': i_chord.beat,
                    'symbol': i_chord.original_symbol,
                    'role': i_role,
                    'is_diatonic': i_chord.is_diatonic,
                })
                if i_idx not in used_indices:
                    i_chord.group_memberships.append({
                        'group_id': group_id,
                        'group_type': 'ii-V-I',
                        'role': i_role,
                        'variant': variant,
                    })
                    used_indices.add(i_idx)

            # Build notes
            notes_parts = []
            if is_diatonic_target:
                notes_parts.append(f"Diatonic ii-V-I in {target_key_name}")
            else:
                notes_parts.append(f"ii-V-I targeting {target_key_name}")
            if is_tritone_sub_v:
                notes_parts.append(f"{v_chord.original_symbol} is tritone sub of {pc_to_note_name((v_root + 6) % 12)}7")
            if variant == "backdoor":
                notes_parts.append("Backdoor progression (iv-bVII7-I)")

            group = {
                'group_id': group_id,
                'group_type': 'ii-V-I',
                'variant': variant,
                'target_key': target_key_name,
                'is_diatonic_target': is_diatonic_target,
                'members': members,
                'notes': '. '.join(notes_parts),
            }
            groups.append(group)

    return chords, groups
