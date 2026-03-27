"""Ambiguity Scorer.

Computes a per-chord ambiguity_score in [0.0, 1.0] that quantifies how
uncertain the rule engine is about its analysis.

    0.0 = fully determined (single interpretation, high confidence)
    1.0 = maximally ambiguous (multiple conflicting interpretations, no context)

The score is a weighted combination of several ambiguity sources:

    1. Function ambiguity     (weight 0.30)
       Multiple function labels with close confidence, or no function at all.

    2. Diatonic status        (weight 0.15)
       Non-diatonic chords are inherently more ambiguous than diatonic ones.

    3. Group membership       (weight 0.20)
       Chords in a ii-V-I group are well-explained; ungrouped non-diatonic
       chords are less certain.

    4. Competing interpretations (weight 0.20)
       Modal interchange AND secondary dominant on the same chord, or
       multiple tonicization candidates.

    5. Existing ambiguity_flags (weight 0.15)
       Flags placed by earlier analyzers that explicitly mark uncertainty.

The final score is clamped to [0.0, 1.0].
"""

from models.chord import ParsedChord


# ── Weights ──
W_FUNCTION   = 0.30
W_DIATONIC   = 0.15
W_GROUP      = 0.20
W_COMPETING  = 0.20
W_FLAGS      = 0.15


def _function_ambiguity(chord: ParsedChord) -> float:
    """Score function interpretation ambiguity (0=clear, 1=ambiguous)."""
    funcs = chord.functions
    if not funcs:
        # No function assigned at all — maximally ambiguous
        return 1.0
    if len(funcs) == 1:
        conf = funcs[0].get('confidence', 1.0)
        # Single interpretation: ambiguity is inverse of confidence
        # conf=1.0 → 0.0, conf=0.5 → 0.5
        return max(0.0, 1.0 - conf)

    # Multiple interpretations: ambiguity increases when confidences are close
    confs = sorted([f.get('confidence', 0.5) for f in funcs], reverse=True)
    top = confs[0]
    second = confs[1] if len(confs) > 1 else 0.0

    if top <= 0:
        return 1.0

    # Ratio of second-best to best. Closer to 1.0 = more ambiguous
    ratio = second / top
    # Also penalize low absolute confidence
    low_conf_penalty = max(0.0, 1.0 - top) * 0.3

    return min(1.0, ratio * 0.7 + low_conf_penalty)


def _diatonic_ambiguity(chord: ParsedChord) -> float:
    """Non-diatonic chords have inherent ambiguity."""
    if chord.is_diatonic is True:
        return 0.0
    if chord.is_diatonic is False:
        return 0.6  # baseline ambiguity for chromatic chords
    return 0.5  # unknown


def _group_ambiguity(chord: ParsedChord) -> float:
    """Chords in ii-V-I groups are well-explained; ungrouped chromatic chords are not."""
    has_group = bool(chord.group_memberships)
    has_secdom = chord.secondary_dominant is not None
    has_modal = chord.modal_interchange is not None
    has_dim = chord.diminished_function is not None
    has_chromatic = chord.chromatic_approach is not None
    has_deceptive = chord.deceptive_resolution is not None
    has_pedal = chord.pedal_info is not None

    explained = has_group or has_secdom or has_modal or has_dim or has_chromatic or has_deceptive or has_pedal

    if chord.is_diatonic:
        # Diatonic chords are always somewhat explained by the key
        return 0.0
    elif explained:
        # Non-diatonic but explained by a pattern
        return 0.1
    else:
        # Non-diatonic and unexplained — high ambiguity
        return 0.9


def _competing_interpretations(chord: ParsedChord) -> float:
    """Multiple overlapping analysis layers on the same chord create ambiguity."""
    layers = 0
    if chord.secondary_dominant:
        layers += 1
    if chord.modal_interchange:
        layers += 1
    if chord.tonicization:
        layers += 1
    if chord.chromatic_approach:
        layers += 1
    if chord.deceptive_resolution:
        layers += 1

    if layers <= 1:
        return 0.0
    elif layers == 2:
        return 0.4  # two explanations compete
    else:
        return 0.7  # three or more — genuinely ambiguous


def _flag_ambiguity(chord: ParsedChord) -> float:
    """Existing ambiguity_flags from earlier analyzers."""
    if not chord.ambiguity_flags:
        return 0.0
    # Each flag contributes. Most chords have 0-1 flags.
    n = len(chord.ambiguity_flags)
    context_needed = sum(1 for f in chord.ambiguity_flags if f.get('context_needed'))
    return min(1.0, 0.5 * n + 0.3 * context_needed)


def score(chords: list[ParsedChord]) -> list[ParsedChord]:
    """Compute ambiguity_score for each chord and store it.

    The score is stored in chord.ambiguity_score (added dynamically)
    and also appended to ambiguity_flags for JSON serialization.

    Args:
        chords: Fully analyzed ParsedChord list.

    Returns:
        Same list with ambiguity_score set on each chord.
    """
    for chord in chords:
        func_amb = _function_ambiguity(chord)
        dia_amb = _diatonic_ambiguity(chord)
        grp_amb = _group_ambiguity(chord)
        comp_amb = _competing_interpretations(chord)
        flag_amb = _flag_ambiguity(chord)

        raw = (W_FUNCTION * func_amb
               + W_DIATONIC * dia_amb
               + W_GROUP * grp_amb
               + W_COMPETING * comp_amb
               + W_FLAGS * flag_amb)

        # Clamp to [0, 1]
        final = round(max(0.0, min(1.0, raw)), 3)

        # Store on the object (dynamic attribute)
        chord.ambiguity_score = final  # type: ignore[attr-defined]

    return chords
