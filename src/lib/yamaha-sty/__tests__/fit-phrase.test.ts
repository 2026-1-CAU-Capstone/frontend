/**
 * Tests for fit-phrase transposition.
 *
 * Acceptance: reproduce the worked example from the Java JavaDoc and
 * verify voice-leading (closest-octave snapping).
 */
import { ChordSymbol } from '../../jazz-harmony';
import {
  getClosestPitch, fitMelodyPhraseToChord, fitBassPhraseToChord, fitChordPhraseToChord,
} from '../fit-phrase';
import type { SourcePhrase, SourceNoteEvent } from '../style-part';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

function phrase(pitches: number[]): SourcePhrase {
  return {
    channel: 0,
    notes: pitches.map((p, i) => ({
      channel: 0, pitch: p, velocity: 80, tick: i * 480, durationTicks: 480,
    })),
  };
}

function pitches(notes: SourceNoteEvent[]): number[] {
  return notes.map((n) => n.pitch);
}

/* ─── getClosestPitch ────────────────────────────────────────────────── */
assert(getClosestPitch(56, 0) === 60, 'Ab3(56) → C → C4(60)');   // up wins
assert(getClosestPitch(67, 4) === 64, 'G4(67) → E → E4(64)');     // down wins
assert(getClosestPitch(60, 0) === 60, 'C4 → C → same (60)');
assert(getClosestPitch(66, 0) === 72, 'F#4(66) → C → C5(72) (tie breaks up)');
try { getClosestPitch(60, 12); fail++; fails.push('  ✗ relPitch=12 should throw'); }
catch { pass++; }

/* ─── fitMelodyPhrase ────────────────────────────────────────────────── */

// JavaDoc example: pSrc=[C3,G3,B3,E4] ecsSrc=C7M ecsDest=F7b5 → [F3,B3,Eb4,Ab4]
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const ct7b5 = ChordSymbol.parse('C7b5').chordType;

  // Java example uses C3=48, G3=55, B3=59, E4=64
  const src = phrase([48, 55, 59, 64]);
  const out = fitMelodyPhraseToChord(src, /*srcRoot=*/ 0, ctM7, /*destRoot=*/ 5, ct7b5);

  // Expected pitch classes after transform: F(5), B(11), Eb(3), Ab(8)
  // The actual MIDI pitches depend on closest-octave snapping.
  const relPitches = pitches(out).map((p) => ((p % 12) + 12) % 12);
  assert(relPitches[0] === 5, `note0 → F (pc 5, got ${relPitches[0]})`);
  assert(relPitches[1] === 11, `note1 → B (pc 11, got ${relPitches[1]})`);
  assert(relPitches[2] === 3, `note2 → Eb (pc 3, got ${relPitches[2]})`);
  // NOTE: JavaDoc claims Ab here but that's wrong — F7b5's THIRD is A natural
  // (pc 9), because 7b5 is "dominant 7 with flat 5" (natural 3rd). The Java
  // implementation also returns A; only the JavaDoc text is misleading.
  assert(relPitches[3] === 9, `note3 → A (pc 9, got ${relPitches[3]})`);
}

// Same chord type, just transposed: CM7 → DbM7 with [C, E, G, B] → [Db, F, Ab, C]
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const src = phrase([60, 64, 67, 71]); // C4 E4 G4 B4
  const out = fitMelodyPhraseToChord(src, 0, ctM7, 1, ctM7); // root C → Db (delta 1)
  const relPitches = pitches(out).map((p) => ((p % 12) + 12) % 12);
  assert(relPitches[0] === 1, `Db (pc 1, got ${relPitches[0]})`);
  assert(relPitches[1] === 5, `F (pc 5, got ${relPitches[1]})`);
  assert(relPitches[2] === 8, `Ab (pc 8, got ${relPitches[2]})`);
  assert(relPitches[3] === 0, `C (pc 0, got ${relPitches[3]})`);
}

// Empty phrase → empty result
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const out = fitMelodyPhraseToChord({ channel: 0, notes: [] }, 0, ctM7, 0, ctM7);
  assert(out.length === 0, 'empty phrase → empty result');
}

// Channel + tick + velocity propagation
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const src: SourcePhrase = {
    channel: 5,
    notes: [{ channel: 5, pitch: 60, velocity: 99, tick: 1234, durationTicks: 567 }],
  };
  const out = fitMelodyPhraseToChord(src, 0, ctM7, 2, ctM7);
  assert(out[0].channel === 5, 'channel propagated');
  assert(out[0].velocity === 99, 'velocity propagated');
  assert(out[0].tick === 1234, 'tick propagated');
  assert(out[0].durationTicks === 567, 'duration propagated');
}

/* ─── fitBassPhrase ──────────────────────────────────────────────────── */

// Plain bass: CM7 → Fm9 with root C → root F → use F (5) for ROOT degree
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const ctm9 = ChordSymbol.parse('Cm9').chordType;
  const src = phrase([36, 43, 48]); // C2 G2 C3 — bass walking
  const out = fitBassPhraseToChord(src, 0, ctM7, 5, ctm9);
  const relPitches = pitches(out).map((p) => ((p % 12) + 12) % 12);
  // C → ROOT → F (5)
  assert(relPitches[0] === 5, `C → F (got ${relPitches[0]})`);
  // G → FIFTH → C (pitch class 0 for Fm9: 5+7=12→0)
  assert(relPitches[1] === 0, `G → C (got ${relPitches[1]})`);
  // C → ROOT → F (5)
  assert(relPitches[2] === 5, `C → F (got ${relPitches[2]})`);
}

// Slash chord: dest = F/A → ROOT-degree notes should be A (pc 9), not F (pc 5)
{
  const ctM = ChordSymbol.parse('CM7').chordType;
  const src = phrase([36, 43]); // C2 G2
  const out = fitBassPhraseToChord(src, 0, ctM, /*destRoot=*/ 5, ctM, /*destBass=*/ 9);
  const relPitches = pitches(out).map((p) => ((p % 12) + 12) % 12);
  // C → ROOT → bass A (9), not root F (5)
  assert(relPitches[0] === 9, `slash: C → A (got ${relPitches[0]})`);
  // G → FIFTH → C (5+7=0 mod 12) — not affected by bass override
  assert(relPitches[1] === 0, `slash: G → C (got ${relPitches[1]})`);
}

// Pedal bass: ALL notes route through bass, regardless of degree
{
  const ctM = ChordSymbol.parse('CM7').chordType;
  const src = phrase([36, 43, 48]); // C2 G2 C3
  const out = fitBassPhraseToChord(src, 0, ctM, 5, ctM, 9, /*pedalBass=*/ true);
  const relPitches = pitches(out).map((p) => ((p % 12) + 12) % 12);
  assert(relPitches.every((p) => p === 9), `pedal bass: all notes → A (got ${relPitches})`);
}

/* ─── fitChordPhrase ─────────────────────────────────────────────────── */

// Same-type transpose: CM7 [C, E, G, B] → DbM7
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const src = phrase([60, 64, 67, 71]); // C4 E4 G4 B4
  
  const out = fitChordPhraseToChord(src, 0, ctM7, 1, ctM7); // root C → Db
  const relPitches = pitches(out).map((p: number) => ((p % 12) + 12) % 12);
  // All 4 src degrees should map to corresponding DbM7 degrees:
  // C(ROOT) → Db(1), E(THIRD) → F(5), G(FIFTH) → Ab(8), B(SEVENTH) → C(0)
  const set = new Set(relPitches);
  assert(set.has(1) && set.has(5) && set.has(8) && set.has(0),
    `DbM7 voicing pcs include {Db, F, Ab, C} (got ${relPitches})`);
}

// Major → minor: CM [C, E, G] → Am [A, C, E]
// All 3 src degrees map: C(ROOT)→A(9), E(THIRD)→C(0), G(FIFTH)→E(4)
{
  const ctM = ChordSymbol.parse('CM').chordType;
  const ctm = ChordSymbol.parse('Cm').chordType;
  const src = phrase([60, 64, 67]); // C4 E4 G4
  
  const out = fitChordPhraseToChord(src, 0, ctM, 9, ctm); // root C → A, type M→m
  const relPitches = pitches(out).map((p: number) => ((p % 12) + 12) % 12);
  const set = new Set(relPitches);
  assert(set.has(9) && set.has(0) && set.has(4),
    `Am voicing pcs include {A, C, E} (got ${relPitches})`);
}

// Empty phrase → empty result
{
  const ctM = ChordSymbol.parse('CM').chordType;
  
  const out = fitChordPhraseToChord({ channel: 0, notes: [] }, 0, ctM, 0, ctM);
  assert(out.length === 0, 'chord-mode empty → empty');
}

// Voice leading: notes stay near their original octave
{
  const ctM = ChordSymbol.parse('CM').chordType;
  const src = phrase([60, 64, 67]); // C4 area
  
  const out = fitChordPhraseToChord(src, 0, ctM, 2, ctM); // → D major
  const ps = pitches(out);
  for (const p of ps) {
    assert(Math.abs(p - 64) < 12, `note ${p} within 1 octave of source center 64`);
  }
}

console.log(`\n=== fit-phrase test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
