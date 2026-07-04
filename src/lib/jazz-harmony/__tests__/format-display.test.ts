/**
 * Tests for formatChordDisplay() — the unified string-level Unicode
 * substitution that replaces formatChord() in NoteSheet/LickCard/Lick12KeyPage.
 *
 * Acceptance: covers the union of cases the original 3 formatChord
 * implementations handled, plus a few extra that they missed.
 */
import { formatChordDisplay } from '../jazz-notation';

type Case = [input: string, expected: string];

const cases: Case[] = [
  // Major-7 prefix variants → △
  ['CMaj7',     'C△7'],
  ['Cmaj7',     'C△7'],
  ['CMa9',      'C△9'],
  ['Cma13',     'C△13'],
  ['CM7',       'C△7'],
  ['Cj7',       'C△7'],
  ['CM13',      'C△13'],
  // Bare "maj"/"M" alone (no digit) — stays as triad (per existing behaviour)
  ['CMaj',      'CMaj'],
  ['CM',        'CM'],
  // Half-diminished
  ['Cm7b5',     'Cø7'],
  ['Cmin7b5',   'Cø7'],
  ['Cmi7b5',    'Cø7'],
  ['C-7b5',     'Cø7'],
  ['C-7(b5)',   'Cø7'],
  ['Cm7(b5)',   'Cø7'],
  ['Ch7',       'Cø7'],
  ['Ch',        'Cø7'],  // 파서(h → m7b5 → ø7)와 일치 — 타이핑 프리뷰/blur 결과 동일하게
  // Diminished
  ['Cdim',      'C°'],
  ['Cdim7',     'C°7'],
  ['Cdim7M',    'C°△7'],
  ['Co',        'C°'],
  ['Co7',       'C°7'],
  // Minor — "mi" or "min" after root → "-"
  ['Cm7',       'C-7'],
  ['Cmin7',     'C-7'],
  ['Cmi7',      'C-7'],
  ['Cm',        'C-'],
  ['Cm9',       'C-9'],
  ['Cmin',      'C-'],
  ['Cmi',       'C-'],
  // "maj" must NOT trigger "ma" minor prefix
  ['Cmaj',      'Cmaj'],  // bare maj stays (triad)
  // Root flat → ♭
  ['Bb',        'B♭'],
  ['Bbm7',      'B♭-7'],
  ['Ebmaj7',    'E♭△7'],
  // Root sharp stays as # (no conversion to ♯ for root)
  ['F#',        'F#'],
  ['F#m7',      'F#-7'],
  // Tension accidentals → ♭/♯
  ['C7b9',      'C7♭9'],
  ['C7#9',      'C7♯9'],
  ['C13b5',     'C13♭5'],
  ['C9#11',     'C9♯11'],
  // Slash chords
  ['Cm7/G',     'C-7/G'],
  ['Bb7/D',     'B♭7/D'],
  ['F#m7b5/B',  'F#ø7/B'],
  // Idempotent on already-Unicode glyphs
  ['C△7',       'C△7'],
  ['C°',        'C°'],
  ['Cø7',       'Cø7'],
  ['C-7',       'C-7'],
  // Mixed: input has some Unicode and some ASCII
  ['C△7b9',     'C△7♭9'],
  ['Cø7#9',     'Cø7♯9'],
  // Empty / no-op
  ['',          ''],
];

let pass = 0, fail = 0;
const failures: string[] = [];
for (const [input, expected] of cases) {
  const got = formatChordDisplay(input);
  if (got === expected) pass++;
  else { fail++; failures.push(`  ✗ formatChordDisplay("${input}") → "${got}", expected "${expected}"`); }
}

console.log(`\n=== formatChordDisplay test ===`);
console.log(`${pass} pass / ${fail} fail (${cases.length} total)\n`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
} else {
  console.log('✓ All tests passed');
}

process.exit(fail > 0 ? 1 : 0);
