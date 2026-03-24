"""Main pipeline entry point for the Jazzify chord2text rule-based engine.

Usage:
    python main.py --input chords.txt --key Ab --title "All The Things You Are"
    python main.py --input chords.txt --key C --output output.json
"""

import argparse
import json
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

from parsers.text_parser import parse_progression_text
from analyzers.chord_normalizer import normalize
from analyzers.diatonic_classifier import classify
from analyzers.function_labeler import label, label_from_groups
from analyzers.ii_v_i_detector import detect as detect_ii_v_i
from analyzers.tritone_sub_detector import detect as detect_tritone_sub
from analyzers.secondary_dominant_detector import detect as detect_secondary_dominant
from analyzers.diminished_classifier import detect as detect_diminished
from analyzers.chromatic_approach_detector import detect as detect_chromatic_approach
from analyzers.deceptive_resolution_detector import detect as detect_deceptive_resolution
from analyzers.pedal_point_detector import detect as detect_pedal_point
from analyzers.modal_interchange_detector import detect as detect_modal_interchange
from analyzers.mode_segment_detector import detect as detect_mode_segment
from analyzers.tonicization_modulation_detector import detect as detect_tonicization
from analyzers.section_boundary_detector import detect as detect_sections
from analyzers.ambiguity_scorer import score as score_ambiguity
from aggregator import aggregate, to_json
from version_tracker import write_version_md


def analyze(text: str, key: str = "C", title: str = "Untitled",
            time_signature: str = "4/4") -> dict:
    """Run the full analysis pipeline on a chord progression text.

    Args:
        text: Plain text chord progression (bars separated by |)
        key: Song key (e.g., "C", "Bb", "F#m")
        title: Song title
        time_signature: Time signature (e.g., "4/4")

    Returns:
        Complete analysis output dictionary.
    """
    # Phase 1: Parse
    song, chords = parse_progression_text(text, title=title, key=key,
                                          time_signature=time_signature)

    if not chords:
        return {'error': 'No chords parsed from input'}

    # Phase 2: Layer 1 - Individual chord analysis
    chords = normalize(chords)
    chords = classify(chords, key)
    chords = label(chords, key)

    # Phase 3: Layer 2 - Contextual pattern detection
    chords, groups = detect_ii_v_i(chords, key)
    chords = label_from_groups(chords)  # resolve functions from group roles
    chords = detect_tritone_sub(chords, groups)
    chords = detect_secondary_dominant(chords, key)
    chords = detect_diminished(chords, key)
    chords = detect_chromatic_approach(chords)
    chords = detect_deceptive_resolution(chords, key)
    chords = detect_pedal_point(chords, key)

    # Phase 4: Layer 3 - Structural analysis
    chords = detect_modal_interchange(chords, key)
    chords = detect_mode_segment(chords, key)
    chords = detect_tonicization(chords, key, groups)
    sections = detect_sections(chords, key)

    # Phase 5: Ambiguity scoring
    chords = score_ambiguity(chords)

    # Phase 6: Aggregate
    output = aggregate(title, key, time_signature, chords, groups, sections)

    return output


def main():
    parser = argparse.ArgumentParser(
        description='Jazzify chord2text Rule-Based Harmonic Analysis Engine'
    )
    parser.add_argument('--input', '-i', type=str,
                        help='Input file path (plain text chord progression)')
    parser.add_argument('--text', '-t', type=str,
                        help='Direct chord progression text')
    parser.add_argument('--key', '-k', type=str, default='C',
                        help='Song key (default: C)')
    parser.add_argument('--title', type=str, default='Untitled',
                        help='Song title')
    parser.add_argument('--time-signature', type=str, default='4/4',
                        help='Time signature (default: 4/4)')
    parser.add_argument('--output', '-o', type=str,
                        help='Output JSON file path')
    parser.add_argument('--update-version', action='store_true',
                        help='Update VERSION.md')

    args = parser.parse_args()

    # Update VERSION.md if requested
    if args.update_version:
        path = write_version_md()
        print(f"Updated: {path}")
        if not args.input and not args.text:
            return

    # Get input text
    if args.input:
        with open(args.input, 'r') as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        parser.print_help()
        return

    # Run analysis
    output = analyze(text, key=args.key, title=args.title,
                     time_signature=args.time_signature)

    # Output
    json_str = to_json(output)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(json_str)
        print(f"Output written to: {args.output}")
    else:
        print(json_str)


if __name__ == '__main__':
    main()
