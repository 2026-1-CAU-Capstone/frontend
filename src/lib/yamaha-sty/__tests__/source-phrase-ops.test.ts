/**
 * Tests for SourcePhrase helpers (sourceUsedDegrees + destDegreesMelody).
 * Matches the worked example from PhraseUtilities.fitMelodyPhrase2ChordSymbol's
 * JavaDoc: pSrc=C3,G3,B3,E4 with ecsSrc=C7M → degrees [ROOT, THIRD, FIFTH, SEVENTH].
 */
import { ChordSymbol, Degrees } from '../../jazz-harmony';
import { sourceUsedDegrees, destDegreesMelody } from '../source-phrase-ops';
import type { SourcePhrase } from '../style-part';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

function makePhrase(midiPitches: number[]): SourcePhrase {
  return {
    channel: 0,
    notes: midiPitches.map((p) => ({
      channel: 0, pitch: p, velocity: 80, tick: 0, durationTicks: 480,
    })),
  };
}

// JJazzLab worked example: C7M source phrase = [C3, G3, B3, E4]
// → used degrees = [ROOT, THIRD, FIFTH, SEVENTH]
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const phrase = makePhrase([60, 67, 71, 76]); // C4 G4 B4 E5 (any octave OK)
  const degs = sourceUsedDegrees(phrase, 0, ctM7); // C root = pitch class 0
  const names = degs.map((d) => d.name).sort();
  assert(names.length === 4, `4 distinct degrees (got ${names.length})`);
  assert(names.includes('ROOT'), 'ROOT in used');
  assert(names.includes('THIRD'), 'THIRD in used');
  assert(names.includes('FIFTH'), 'FIFTH in used');
  assert(names.includes('SEVENTH'), 'SEVENTH in used');
}

// Duplicates collapse: phrase has 4 C's at different octaves → degrees = [ROOT]
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const phrase = makePhrase([48, 60, 72, 84]); // 4 C's
  const degs = sourceUsedDegrees(phrase, 0, ctM7);
  assert(degs.length === 1 && degs[0].name === 'ROOT', 'single ROOT despite 4 notes');
}

// Sort order: lower-pitch degrees come first
{
  const ctM7 = ChordSymbol.parse('CM7').chordType;
  const phrase = makePhrase([71, 67, 60, 76]); // shuffled order
  const degs = sourceUsedDegrees(phrase, 0, ctM7);
  assert(degs[0].name === 'ROOT' && degs[3].name === 'SEVENTH', 'sorted by pitch');
}

// destDegreesMelody: PhraseUtilities doc example "C7M → F7b5"
// → map[ROOT→ROOT, THIRD→THIRD, FIFTH→FIFTH_FLAT (b5), SEVENTH→SEVENTH_FLAT (b7)]
{
  const ctDest = ChordSymbol.parse('C7b5').chordType;
  const src = [Degrees.ROOT, Degrees.THIRD, Degrees.FIFTH, Degrees.SEVENTH];
  const map = destDegreesMelody(src, ctDest);
  assert(map.get(Degrees.ROOT)?.name === 'ROOT', 'ROOT → ROOT');
  assert(map.get(Degrees.THIRD)?.name === 'THIRD', 'THIRD → THIRD');
  assert(map.get(Degrees.FIFTH)?.name === 'FIFTH_FLAT', `FIFTH → FIFTH_FLAT (got ${map.get(Degrees.FIFTH)?.name})`);
  assert(map.get(Degrees.SEVENTH)?.name === 'SEVENTH_FLAT', `SEVENTH → SEVENTH_FLAT (got ${map.get(Degrees.SEVENTH)?.name})`);
}

// destDegreesMelody: C → Am (major → minor): THIRD → THIRD_FLAT
{
  const ctDest = ChordSymbol.parse('Cm').chordType;
  const src = [Degrees.ROOT, Degrees.THIRD, Degrees.FIFTH];
  const map = destDegreesMelody(src, ctDest);
  assert(map.get(Degrees.THIRD)?.name === 'THIRD_FLAT', 'major 3rd → minor 3rd');
  assert(map.get(Degrees.ROOT)?.name === 'ROOT', 'ROOT preserved');
  assert(map.get(Degrees.FIFTH)?.name === 'FIFTH', 'FIFTH preserved');
}

console.log(`\n=== source-phrase-ops test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
