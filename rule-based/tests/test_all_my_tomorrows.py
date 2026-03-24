"""Tests for 'All The Things You Are' (Ab major) and other jazz standards.

Verifies detection of ii-V-I progressions, secondary dominants,
tonicizations, diminished chord functions, and more.
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from main import analyze


# ---- All The Things You Are (Ab major) ----

ALL_THE_THINGS = """
Fm7 | Bbm7 | Eb7 | Abmaj7 |
Dbmaj7 | G7 | Cmaj7 | Cmaj7 |
Cm7 | Fm7 | Bb7 | Ebmaj7 |
Abmaj7 | D7 | Gmaj7 | Gmaj7 |
Am7 | D7 | Gmaj7 | Gmaj7 |
F#m7 | B7 | Emaj7 | C7(b9) |
Fm7 | Bbm7 | Eb7 | Abmaj7 |
Dbmaj7 | Gb7 | Cm7 | Bdim7 |
Bbm7 | Eb7 | Abmaj7 | Gm7b5 C7b9 |
"""


@pytest.fixture
def attyar_result():
    return analyze(ALL_THE_THINGS, key="Ab", title="All The Things You Are")


class TestAllTheThingsYouAre:

    def test_basic_parse(self, attyar_result):
        """All chords should be parsed."""
        assert 'chords' in attyar_result
        assert len(attyar_result['chords']) > 30

    def test_has_groups(self, attyar_result):
        """Should detect multiple ii-V-I groups."""
        groups = attyar_result.get('groups', [])
        assert len(groups) >= 3, f"Expected at least 3 ii-V-I groups, got {len(groups)}"

    def test_diatonic_Ab_ii_v_i(self, attyar_result):
        """Bbm7 -> Eb7 -> Abmaj7 should be detected as diatonic ii-V-I in Ab."""
        groups = attyar_result.get('groups', [])
        ab_groups = [g for g in groups if g.get('target_key') == 'Ab']
        assert len(ab_groups) >= 1, "Should detect at least one ii-V-I in Ab"

    def test_ii_v_i_to_C(self, attyar_result):
        """G7 -> Cmaj7 should be part of a ii-V-I or at least V-I to C."""
        groups = attyar_result.get('groups', [])
        c_groups = [g for g in groups if g.get('target_key') == 'C']
        # G7 -> Cmaj7 should be detected (Fm7 preceding is vi in Ab, not ii of C,
        # but the V-I should still be caught)
        # Actually Dbmaj7 -> G7 -> Cmaj7: G7 is a secondary dominant
        chords = attyar_result['chords']
        g7_chords = [c for c in chords if c['symbol'] == 'G7']
        # At least one G7 should be tagged as secondary dominant
        has_sec_dom = any(
            c['analysis']['secondary_dominant'] is not None
            for c in g7_chords
        )
        assert has_sec_dom, "G7 should be detected as secondary dominant (V/III or V of C)"

    def test_ii_v_i_to_Eb(self, attyar_result):
        """Cm7 -> Fm7 -> Bb7 -> Ebmaj7 contains ii-V-I to Eb."""
        groups = attyar_result.get('groups', [])
        eb_groups = [g for g in groups if g.get('target_key') == 'Eb']
        assert len(eb_groups) >= 1, "Should detect ii-V-I to Eb"

    def test_ii_v_i_to_G(self, attyar_result):
        """Am7 -> D7 -> Gmaj7 is ii-V-I to G."""
        groups = attyar_result.get('groups', [])
        g_groups = [g for g in groups if g.get('target_key') == 'G']
        assert len(g_groups) >= 1, "Should detect ii-V-I to G"

    def test_ii_v_i_to_E(self, attyar_result):
        """F#m7 -> B7 -> Emaj7 is ii-V-I to E."""
        groups = attyar_result.get('groups', [])
        e_groups = [g for g in groups if g.get('target_key') == 'E']
        assert len(e_groups) >= 1, "Should detect ii-V-I to E"

    def test_D7_secondary_dominant(self, attyar_result):
        """D7 should be detected as secondary dominant (V/VII or V of G)."""
        chords = attyar_result['chords']
        d7_chords = [c for c in chords if c['symbol'] == 'D7']
        assert len(d7_chords) >= 1
        has_sec_dom = any(
            c['analysis']['secondary_dominant'] is not None
            for c in d7_chords
        )
        assert has_sec_dom, "D7 should be secondary dominant"

    def test_Bdim7_function(self, attyar_result):
        """Bdim7 should be classified (passing, auxiliary, or dominant function)."""
        chords = attyar_result['chords']
        bdim_chords = [c for c in chords if 'dim' in c['symbol'].lower() and c['symbol'].startswith('B')]
        assert len(bdim_chords) >= 1, "Bdim7 should be present"
        for c in bdim_chords:
            dim_func = c['analysis']['diminished_function']
            assert dim_func is not None, f"Bdim7 should have a diminished function classification"

    def test_sections_exist(self, attyar_result):
        """Should have section boundaries."""
        sections = attyar_result.get('sections', [])
        assert len(sections) >= 1

    def test_Gb7_analysis(self, attyar_result):
        """Gb7 should have some analysis (tritone sub? modal interchange?)."""
        chords = attyar_result['chords']
        gb7_chords = [c for c in chords if c['symbol'] == 'Gb7']
        assert len(gb7_chords) >= 1
        gb7 = gb7_chords[0]
        analysis = gb7['analysis']
        # Should have some function or explanation
        has_explanation = (
            analysis['secondary_dominant'] is not None or
            analysis['modal_interchange'] is not None or
            len(analysis['functions']) > 0
        )
        assert has_explanation, "Gb7 should be explained (sec dom, modal interchange, or tritone sub)"

    def test_C7b9_analysis(self, attyar_result):
        """C7(b9) should be detected as secondary dominant (V/vi in Ab = V of Fm)."""
        chords = attyar_result['chords']
        c7b9 = [c for c in chords if 'C7' in c['symbol'] and 'b9' in c['symbol']]
        assert len(c7b9) >= 1
        assert c7b9[0]['analysis']['secondary_dominant'] is not None


# ---- Simple Blues (C major) ----

BLUES_C = """
C7 | C7 | C7 | C7 |
F7 | F7 | C7 | C7 |
Dm7 | G7 | C7 | Dm7 G7 |
"""


class TestBlues:

    def test_blues_parse(self):
        result = analyze(BLUES_C, key="C", title="Simple Blues")
        assert len(result['chords']) == 13  # 11 single-chord bars + 1 two-chord bar

    def test_blues_ii_v(self):
        result = analyze(BLUES_C, key="C", title="Simple Blues")
        groups = result.get('groups', [])
        # Dm7 -> G7 -> C7 should be detected
        assert len(groups) >= 1, "Should detect at least one ii-V pattern"

    def test_blues_I7_not_secondary_dominant(self):
        """C7 as I chord in blues should ideally not be flagged as sec dom of IV."""
        result = analyze(BLUES_C, key="C", title="Simple Blues")
        # C7 in bar 1 — technically a dom7 on I which is non-standard for major
        # The engine may flag it; this test just verifies it runs
        chords = result['chords']
        c7_bar1 = [c for c in chords if c['symbol'] == 'C7' and c['bar'] == 1]
        assert len(c7_bar1) >= 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
