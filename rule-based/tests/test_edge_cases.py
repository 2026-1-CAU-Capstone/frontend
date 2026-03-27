"""Edge case tests for the rule-based harmonic analysis engine."""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from main import analyze
from parsers.text_parser import parse_chord_symbol, parse_note_name


# ---- Parser Tests ----

class TestChordParser:

    def test_basic_major(self):
        c = parse_chord_symbol("C")
        assert c.root == 0
        assert c.quality == 'maj'

    def test_minor7(self):
        c = parse_chord_symbol("Dm7")
        assert c.root == 2
        assert c.quality == 'min7'

    def test_dominant7(self):
        c = parse_chord_symbol("G7")
        assert c.root == 7
        assert c.quality == 'dom7'

    def test_maj7(self):
        c = parse_chord_symbol("Cmaj7")
        assert c.root == 0
        assert c.quality == 'maj7'

    def test_min7b5(self):
        c = parse_chord_symbol("Bm7b5")
        assert c.root == 11
        assert c.quality == 'min7b5'

    def test_dim7(self):
        c = parse_chord_symbol("Cdim7")
        assert c.root == 0
        assert c.quality == 'dim7'

    def test_aug(self):
        c = parse_chord_symbol("Caug")
        assert c.root == 0
        assert c.quality == 'aug'

    def test_sus4(self):
        c = parse_chord_symbol("Gsus4")
        assert c.root == 7
        assert c.quality == 'sus4'

    def test_7sus4(self):
        c = parse_chord_symbol("G7sus4")
        assert c.root == 7
        assert c.quality == 'dom7sus4'

    def test_tension_parenthesis(self):
        c = parse_chord_symbol("G7(b9)")
        assert c.root == 7
        assert c.quality == 'dom7'
        assert 'b9' in c.tensions

    def test_multi_tension(self):
        c = parse_chord_symbol("G7(b9,#11,b13)")
        assert c.quality == 'dom7'
        assert 'b9' in c.tensions
        assert '#11' in c.tensions
        assert 'b13' in c.tensions

    def test_alt(self):
        c = parse_chord_symbol("G7alt")
        assert c.quality == 'dom7'
        assert 'b9' in c.tensions
        assert '#9' in c.tensions

    def test_slash_chord(self):
        c = parse_chord_symbol("Dm7/G")
        assert c.root == 2
        assert c.quality == 'min7'
        assert c.bass == 7  # G

    def test_slash_chord_flat(self):
        c = parse_chord_symbol("Db/C")
        assert c.root == 1  # Db
        assert c.bass == 0  # C

    def test_6th(self):
        c = parse_chord_symbol("C6")
        assert c.quality == 'maj6'

    def test_min6(self):
        c = parse_chord_symbol("Cm6")
        assert c.quality == 'min6'

    def test_minmaj7(self):
        c = parse_chord_symbol("CmM7")
        assert c.quality == 'minmaj7'

    def test_minmaj7_paren(self):
        c = parse_chord_symbol("Cm(maj7)")
        assert c.quality == 'minmaj7'

    def test_dm9(self):
        c = parse_chord_symbol("Dm9")
        assert c.quality == 'min7'
        assert '9' in c.tensions

    def test_g13(self):
        c = parse_chord_symbol("G13")
        assert c.quality == 'dom7'
        assert '13' in c.tensions

    def test_add9(self):
        c = parse_chord_symbol("Cadd9")
        assert c.quality == 'maj'
        assert '9' in c.tensions

    def test_flat_root(self):
        c = parse_chord_symbol("Bbm7")
        assert c.root == 10  # Bb

    def test_sharp_root(self):
        c = parse_chord_symbol("F#m7")
        assert c.root == 6  # F#

    def test_nc_returns_none(self):
        c = parse_chord_symbol("N.C.")
        assert c is None

    def test_note_name_parsing(self):
        assert parse_note_name("C") == 0
        assert parse_note_name("D") == 2
        assert parse_note_name("Bb") == 10
        assert parse_note_name("F#") == 6
        assert parse_note_name("Ab") == 8


# ---- Edge Case Progressions ----

class TestChromaticApproach:

    def test_chromatic_approach_from_above(self):
        """Ebm7 -> Dm7: chromatic approach from above."""
        result = analyze("Ebm7 | Dm7 | G7 | Cmaj7", key="C")
        chords = result['chords']
        ebm7 = chords[0]
        assert ebm7['analysis']['chromatic_approach'] is not None or \
               ebm7['analysis']['is_diatonic'] is False


class TestPedalPoint:

    def test_dominant_pedal(self):
        """Dm7/G -> G7sus4 -> G7 -> Cmaj7: G pedal."""
        result = analyze("Dm7/G | G7sus4 | G7 | Cmaj7", key="C")
        chords = result['chords']
        # At least some chords should detect pedal on G
        pedal_chords = [c for c in chords if c['analysis']['pedal_info'] is not None]
        # The first 3 chords all have G as bass
        assert len(pedal_chords) >= 2, "Should detect G pedal point"


class TestBackdoor:

    def test_backdoor_progression(self):
        """Fm7 -> Bb7 -> Cmaj7: backdoor ii-V-I."""
        result = analyze("Fm7 | Bb7 | Cmaj7", key="C")
        groups = result.get('groups', [])
        # Should detect this as backdoor
        backdoor_groups = [g for g in groups if 'backdoor' in g.get('variant', '')]
        assert len(backdoor_groups) >= 1, "Should detect backdoor progression"


class TestTritoneSub:

    def test_tritone_sub_chain(self):
        """Dm7 -> Db7 -> Cmaj7: Db7 is tritone sub of G7."""
        result = analyze("Dm7 | Db7 | Cmaj7", key="C")
        chords = result['chords']
        db7 = [c for c in chords if c['symbol'] == 'Db7'][0]
        # Should be detected as tritone sub or have D_substitute function
        analysis = db7['analysis']
        has_tritone = (
            any('tritone' in str(f) for f in analysis['functions']) or
            any('tritone' in str(g.get('variant', '')) for g in analysis['group_memberships']) or
            any('tritone' in str(a) for a in analysis['ambiguity_flags'])
        )
        assert has_tritone, "Db7 should be detected as tritone substitution"


class TestDeceptiveResolution:

    def test_deceptive_to_vi(self):
        """Dm7 -> G7 -> Am7: deceptive resolution V -> vi."""
        result = analyze("Dm7 | G7 | Am7", key="C")
        chords = result['chords']
        g7 = [c for c in chords if c['symbol'] == 'G7'][0]
        assert g7['analysis']['deceptive_resolution'] is not None
        assert g7['analysis']['deceptive_resolution']['actual_degree'] == 'vi'


class TestDiminishedPassing:

    def test_passing_diminished(self):
        """Cmaj7 -> C#dim7 -> Dm7 -> G7: C#dim7 is passing."""
        result = analyze("Cmaj7 | C#dim7 | Dm7 | G7", key="C")
        chords = result['chords']
        csdim = [c for c in chords if 'dim' in c['symbol'].lower()][0]
        dim_func = csdim['analysis']['diminished_function']
        assert dim_func is not None, "C#dim7 should have diminished function"
        # Should be passing or dominant_function (both are valid interpretations)
        assert dim_func in ('passing', 'dominant_function'), \
            f"C#dim7 should be passing or dominant_function, got {dim_func}"


class TestModalInterchange:

    def test_output_has_all_fields(self):
        """Verify output JSON structure completeness."""
        result = analyze("Dm7 | G7 | Cmaj7", key="C")
        assert 'song' in result
        assert 'chords' in result
        assert 'groups' in result
        assert 'sections' in result
        assert 'engine_version' in result
        assert 'coverage' in result

        chord = result['chords'][0]
        assert 'analysis' in chord
        analysis = chord['analysis']
        expected_fields = [
            'root', 'quality', 'degree', 'is_diatonic', 'functions',
            'secondary_dominant', 'group_memberships', 'diminished_function',
            'chromatic_approach', 'deceptive_resolution', 'pedal_info',
            'modal_interchange', 'mode_segment', 'tonicization', 'ambiguity_flags',
        ]
        for field in expected_fields:
            assert field in analysis, f"Missing field: {field}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
