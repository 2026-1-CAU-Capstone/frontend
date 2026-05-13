/**
 * YamChord byte → ChordType mapping test.
 *
 * Acceptance: every Yamaha sourceChordType index (0..33) produces a valid
 * ChordType via our jazz-harmony database, and the round-trip name matches
 * what we'd expect for that musical category (Maj/min/dim/sus/etc.).
 */
import { YAM_CHORD_NAMES, chordTypeFromYamIndex, yamChordNameAt } from '../yam-chord';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

// All 34 indices produce a ChordType
for (let i = 0; i < YAM_CHORD_NAMES.length; i++) {
  try {
    const ct = chordTypeFromYamIndex(i);
    assert(ct !== null && ct !== undefined, `index ${i} (${YAM_CHORD_NAMES[i]}) returns ChordType`);
  } catch (e) {
    fail++;
    fails.push(`  ✗ index ${i} (${YAM_CHORD_NAMES[i]}) threw: ${(e as Error).message}`);
  }
}

// Spot-check known categories
const major = chordTypeFromYamIndex(33);     // "Maj" → triad
assert(major.family === 'MAJOR', 'index 33 = MAJOR family');

const minor = chordTypeFromYamIndex(25);     // "min"
assert(minor.family === 'MINOR', 'index 25 = MINOR family');

const dim = chordTypeFromYamIndex(16);       // "dim"
assert(dim.family === 'DIMINISHED', 'index 16 = DIMINISHED family');

const sus = chordTypeFromYamIndex(1);        // "sus4"
assert(sus.family === 'SUS', 'index 1 = SUS family');

const seventh = chordTypeFromYamIndex(14);   // "7th" → dom7
assert(seventh.family === 'SEVENTH', 'index 14 = SEVENTH family');

// Verify name accessor
assert(yamChordNameAt(0) === '1+2+5', 'index 0 name');
assert(yamChordNameAt(33) === 'Maj', 'index 33 name');

// Out-of-range
try { chordTypeFromYamIndex(-1); fail++; fails.push('  ✗ expected throw on -1'); }
catch { pass++; }
try { chordTypeFromYamIndex(34); fail++; fails.push('  ✗ expected throw on 34'); }
catch { pass++; }

console.log(`\n=== YamChord test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
