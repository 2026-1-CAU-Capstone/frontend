/**
 * Verify that `normalizeChord()` matches (or improves) the legacy
 * normalizeChord/normalizeSingleChord behaviour found in LickInputPage and
 * SoloGeneratorPage.
 *
 * Legacy mapping target:
 *   minor    : m, min, mi → "-"
 *   major7   : maj, M, Maj → "△"
 *   diminished: dim, ° → "°"   (dim7 → "°7")
 *   half-dim : m7b5, min7b5 → "ø7"
 *   augmented: aug, + → "+"
 *   tensions : b9, #5, #11 etc. — preserved as ASCII
 *   unknown  : returned as-is
 */
import { normalizeChord, isValidChord } from '../jazz-notation';

type Case = [input: string, expected: string];

const cases: Case[] = [
  // Basic
  ['C',          'C'],
  ['Cm',         'C-'],
  ['Cmin',       'C-'],
  ['Cmi',        'C-'],
  ['C-',         'C-'],
  // Major 7
  ['Cmaj7',      'C△7'],
  ['CM7',        'C△7'],
  ['CMaj7',      'C△7'],
  ['Cma7',       'C△7'],
  ['CMaj9',      'C△9'],
  ['Cmaj13',     'C△13'],
  ['Cmaj7#11',   'C△7#11'],
  // Minor 7
  ['Cm7',        'C-7'],
  ['Cmin7',      'C-7'],
  ['Cmi7',       'C-7'],
  ['C-7',        'C-7'],
  ['Cm9',        'C-9'],
  ['Cm11',       'C-11'],
  ['Cm13',       'C-13'],
  ['Cm6',        'C-6'],
  // Dominant 7 + alterations
  ['C7',         'C7'],
  ['C9',         'C9'],
  ['C13',        'C13'],
  ['C7b9',       'C7b9'],
  ['C7#9',       'C7#9'],
  ['C7b5',       'C7b5'],
  ['C7#5',       'C7#5'],
  ['C7alt',      'C7#9#5'],  // alt resolves to canonical 7#9#5
  ['C7#11',      'C7#11'],
  ['C13b9',      'C13b9'],
  // Diminished
  ['Cdim',       'C°'],
  ['C°',         'C°'],
  ['Co',         'C°'],
  ['Cdim7',      'C°7'],
  ['Co7',        'C°7'],
  // Half-diminished
  ['Cm7b5',      'Cø7'],
  ['Cmin7b5',    'Cø7'],
  ['C-7b5',      'Cø7'],
  ['Cm9b5',      'Cø9'],
  // Augmented / sus
  ['Caug',       'C+'],
  ['C+',         'C+'],
  ['C7+5',       'C7#5'],
  ['Csus',       'Csus'],
  ['Csus4',      'Csus'],
  ['Csus2',      'C2'],         // sus2 canonical is "2", so output is "C" + "2"
  // Roots
  ['Bbm7',       'Bb-7'],
  ['F#m7',       'F#-7'],
  ['Ebmaj7',     'Eb△7'],
  ['F#m7b5',     'F#ø7'],
  // Lowercase / mixed case
  ['cm7',        'C-7'],
  ['ebmaj7',     'Eb△7'],
  ['bb7',        'Bb7'],
  // Slash chords
  ['C/E',        'C/E'],
  ['Cm7/G',      'C-7/G'],
  ['Bb7/D',      'Bb7/D'],
  ['F#m7/B',     'F#-7/B'],
  // Multi-chord (space-separated)
  ['D-7 G7',     'D-7  G7'],
  ['Dm7 G7 Cmaj7', 'D-7  G7  C△7'],
  // Enharmonic
  ['Cb',         'B'],
  ['B#',         'C'],
  // Already normalised — idempotent
  ['C-7',        'C-7'],
  ['C△7',        'C△7'],
  ['Cø7',        'Cø7'],
  // Unknown gracefully passes through
  ['Xxxxx',      'Xxxxx'],
  ['',           ''],
];

let pass = 0, fail = 0;
const failures: string[] = [];
for (const [input, expected] of cases) {
  const got = normalizeChord(input);
  if (got === expected) pass++;
  else { fail++; failures.push(`  ✗ normalizeChord("${input}") → "${got}", expected "${expected}"`); }
}

console.log(`\n=== normalize-chord test ===`);
console.log(`${pass} pass / ${fail} fail (${cases.length} total)\n`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
} else {
  console.log('✓ All tests passed');
}

// Sanity: isValidChord
console.log(`\nisValidChord smoke check:`);
console.log(`  "Cm7" → ${isValidChord('Cm7')}`);
console.log(`  "Xxx" → ${isValidChord('Xxx')}`);

process.exit(fail > 0 ? 1 : 0);
