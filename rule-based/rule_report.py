"""Priority-based reporter for the rule-based harmonic analysis engine.

Maps each analyzed chord to the requested ordered rule list:
1. Key
2. Diatonic
3. Sec-Dominant
4. Extended Sec-Dominant
5. Tritone Sub
6. Related iim7
7. Modal interchange
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from main import analyze


RULE_PRIORITY = [
    "Key",
    "Diatonic",
    "Sec-Dominant",
    "Extended Sec-Dominant",
    "Tritone Sub",
    "Related iim7",
    "Modal interchange",
]


def _is_tonic_degree(degree: str | None) -> bool:
    return degree in {"I", "i"}


def _is_tritone_sub(analysis: dict) -> bool:
    for item in analysis.get("functions", []):
        if item.get("function") == "D_substitute":
            return True
        if "tritone" in str(item.get("note", "")).lower():
            return True

    for item in analysis.get("group_memberships", []):
        if "tritone" in str(item.get("role", "")).lower():
            return True

    for item in analysis.get("ambiguity_flags", []):
        if item.get("aspect") == "tritone_substitution":
            return True

    return False


def _is_related_iim7(chords: list[dict], index: int) -> bool:
    if index + 1 >= len(chords):
        return False

    chord = chords[index]
    next_chord = chords[index + 1]
    analysis = chord["analysis"]
    next_analysis = next_chord["analysis"]

    quality = analysis.get("normalized_quality") or analysis.get("quality")
    if quality not in {"min7", "min", "min6", "min7b5", "dim"}:
        return False

    sec_dom = next_analysis.get("secondary_dominant")
    if not sec_dom:
        return False

    root = analysis.get("root")
    next_root = next_analysis.get("root")
    if root is None or next_root is None:
        return False

    # ii -> V is an ascending perfect fourth (+5 semitones mod 12).
    return (next_root - root) % 12 == 5


def _is_extended_secondary_dominant(chords: list[dict], index: int) -> bool:
    analysis = chords[index]["analysis"]
    sec_dom = analysis.get("secondary_dominant")
    if not sec_dom:
        return False

    target_degree = (sec_dom.get("target_degree") or "").strip()
    if target_degree in {"V", "v"}:
        return True

    if index + 1 >= len(chords):
        return False

    next_analysis = chords[index + 1]["analysis"]
    return next_analysis.get("secondary_dominant") is not None


def classify_chord_rules(output: dict) -> list[dict]:
    """Attach requested rule labels to each analyzed chord."""
    chords = output.get("chords", [])
    report = []

    for index, chord in enumerate(chords):
        analysis = chord["analysis"]
        matched_rules = []

        if _is_tonic_degree(analysis.get("degree")):
            matched_rules.append("Key")
        elif analysis.get("is_diatonic"):
            matched_rules.append("Diatonic")

        if analysis.get("secondary_dominant"):
            matched_rules.append("Sec-Dominant")

        if _is_extended_secondary_dominant(chords, index):
            matched_rules.append("Extended Sec-Dominant")

        if _is_tritone_sub(analysis):
            matched_rules.append("Tritone Sub")

        if _is_related_iim7(chords, index):
            matched_rules.append("Related iim7")

        if analysis.get("modal_interchange"):
            matched_rules.append("Modal interchange")

        primary_rule = next((rule for rule in RULE_PRIORITY if rule in matched_rules), "Unclassified")

        report.append(
            {
                "bar": chord["bar"],
                "beat": chord["beat"],
                "symbol": chord["symbol"],
                "degree": analysis.get("degree"),
                "primary_rule": primary_rule,
                "matched_rules": matched_rules,
                "details": {
                    "is_diatonic": analysis.get("is_diatonic"),
                    "secondary_dominant": analysis.get("secondary_dominant"),
                    "modal_interchange": analysis.get("modal_interchange"),
                    "group_memberships": analysis.get("group_memberships"),
                    "functions": analysis.get("functions"),
                },
            }
        )

    return report


def build_report(text: str, key: str, title: str, time_signature: str = "4/4") -> dict:
    output = analyze(text, key=key, title=title, time_signature=time_signature)
    if "error" in output:
        return output

    return {
        "song": output["song"],
        "rule_priority": RULE_PRIORITY,
        "rule_report": classify_chord_rules(output),
        "groups": output.get("groups", []),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump per-chord rule classifications for the requested priority rules."
    )
    parser.add_argument("--input", "-i", type=str, help="Input file path")
    parser.add_argument("--text", "-t", type=str, help="Direct progression text")
    parser.add_argument("--key", "-k", type=str, default="C", help="Song key")
    parser.add_argument("--title", type=str, default="Untitled", help="Song title")
    parser.add_argument("--time-signature", type=str, default="4/4", help="Time signature")
    parser.add_argument("--output", "-o", type=str, help="Output JSON file path")
    args = parser.parse_args()

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        parser.error("Either --input or --text is required.")

    report = build_report(text, key=args.key, title=args.title, time_signature=args.time_signature)
    json_str = json.dumps(report, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json_str)
    else:
        print(json_str)


if __name__ == "__main__":
    main()
