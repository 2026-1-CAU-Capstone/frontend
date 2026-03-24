"""Tests for priority-based rule reporting."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rule_report import build_report


def _find(report: dict, symbol: str, bar: int | float) -> dict:
    for chord in report["rule_report"]:
        if chord["symbol"] == symbol and chord["bar"] == bar:
            return chord
    raise AssertionError(f"Chord not found: {symbol} @ {bar}")


def test_diatonic_and_secondary_dominant_rules():
    report = build_report("Dm7 | G7 | Cmaj7 | A7 | Dm7", key="C", title="Rule Test")

    dm7 = _find(report, "Dm7", 1)
    g7 = _find(report, "G7", 2)
    cmaj7 = _find(report, "Cmaj7", 3)
    a7 = _find(report, "A7", 4)

    assert dm7["primary_rule"] == "Diatonic"
    assert g7["primary_rule"] == "Diatonic"
    assert cmaj7["primary_rule"] == "Key"
    assert a7["primary_rule"] == "Sec-Dominant"


def test_extended_related_iim7_and_tritone_sub_rules():
    report = build_report("Am7 | D7 | G7 | Db7 | Cmaj7", key="C", title="Rule Test 2")

    am7 = _find(report, "Am7", 1)
    d7 = _find(report, "D7", 2)
    db7 = _find(report, "Db7", 4)

    assert "Related iim7" in am7["matched_rules"]
    assert "Extended Sec-Dominant" in d7["matched_rules"]
    assert "Tritone Sub" in db7["matched_rules"]


def test_modal_interchange_rule():
    report = build_report("Bbmaj7 | Cmaj7", key="C", title="Rule Test 3")

    bbmaj7 = _find(report, "Bbmaj7", 1)
    assert "Modal interchange" in bbmaj7["matched_rules"]
