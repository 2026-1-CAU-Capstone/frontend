/**
 * Standalone test suite for ChordSymbol parser. Run with: npx tsx <path>
 *
 * Verifies that ~70 jazz chord symbols parse to the expected canonical
 * (root, chordType.name, optional bass). Pattern: each row is
 * [input_string, expected_root, expected_chord_type_name, expected_bass_or_null].
 */
import { ChordSymbol } from '../chord-symbol';
import { getChordTypeDatabase } from '../chord-type-database';

type Case = [
  input: string,
  expectedRoot: string | null,
  expectedChordTypeName: string | null,
  expectedBass: string | null,
];

const cases: Case[] = [
  // ── Basic majors ────────────────────────────────────────────────
  ['C',       'C',  '',     null],
  ['G',       'G',  '',     null],
  ['F',       'F',  '',     null],
  ['Bb',      'Bb', '',     null],
  ['F#',      'F#', '',     null],
  // Aliases for major
  ['CMaj',    'C',  '',     null],
  ['Fmaj',    'F',  '',     null],

  // ── 6 / 6/9 ─────────────────────────────────────────────────────
  ['C6',      'C',  '6',    null],
  ['Bb6',     'Bb', '6',    null],
  ['F69',     'F',  '69',   null],  // 6/9 alias canonical = "69"
  ['CMaj6',   'C',  '6',    null],

  // ── Major 7 + extensions ────────────────────────────────────────
  ['Cmaj7',   'C',  'M7',   null],
  ['CM7',     'C',  'M7',   null],
  ['F^7',     null, null,   null], // ^7 is NOT in our DB — should throw (skip = handled below)
  ['Bbmaj7',  'Bb', 'M7',   null],
  ['CMaj9',   'C',  'M9',   null],
  ['Cmaj13',  'C',  'M13',  null],
  ['Cmaj7#11','C',  'M7#11', null],
  ['Cmaj9#11','C',  'M9#11', null],

  // ── Minor / minor 7 ────────────────────────────────────────────
  ['Cm',      'C',  'm',    null],
  ['Cmin',    'C',  'm',    null],
  ['C-',      'C',  'm',    null],
  ['Cm7',     'C',  'm7',   null],
  ['Cmin7',   'C',  'm7',   null],
  ['C-7',     'C',  'm7',   null],
  ['Cm9',     'C',  'm9',   null],
  ['C-9',     'C',  'm9',   null],
  ['Cm11',    'C',  'm11',  null],
  ['Cm13',    'C',  'm13',  null],
  ['Cm6',     'C',  'm6',   null],
  ['Cm-maj7', null, null,   null], // weird syntax — should throw
  ['CmMaj7',  'C',  'm7M',  null],
  ['Cm7M',    'C',  'm7M',  null],

  // ── Dominant 7 + alterations ────────────────────────────────────
  ['C7',      'C',  '7',    null],
  ['G7',      'G',  '7',    null],
  ['F7',      'F',  '7',    null],
  ['Bb7',     'Bb', '7',    null],
  ['C9',      'C',  '9',    null],
  ['C13',     'C',  '13',   null],
  ['C7b9',    'C',  '7b9',  null],
  ['C7#9',    'C',  '7#9',  null],
  ['C7b5',    'C',  '7b5',  null],
  ['C7#5',    'C',  '7#5',  null],
  ['C7b9b5',  'C',  '7b9b5', null],
  ['C7alt',   'C',  '7#9#5', null],  // alt → 7#9#5 alias
  ['C7#11',   'C',  '7#11', null],
  ['C13b9',   'C',  '13b9', null],

  // ── Half-diminished / diminished ────────────────────────────────
  ['Cm7b5',   'C',  'm7b5', null],
  ['C°',      'C',  'dim',  null],
  ['Co',      'C',  'dim',  null],
  ['Cdim',    'C',  'dim',  null],
  ['Cdim7',   'C',  'dim7', null],
  ['Co7',     'C',  'dim7', null],

  // ── Sus chords ──────────────────────────────────────────────────
  ['Csus',    'C',  'sus',  null],
  ['Csus4',   'C',  'sus',  null],
  ['Csus2',   'C',  '2',    null],
  ['C7sus',   'C',  '7sus', null],
  ['C7sus4',  'C',  '7sus', null],
  ['C9sus',   'C',  '9sus', null],
  ['C13sus',  'C',  '13sus', null],
  ['Cadd9',   'C',  '2',    null],   // add9 → 2 alias

  // ── Augmented ───────────────────────────────────────────────────
  ['Caug',    'C',  '+',    null],
  ['C+',      'C',  '+',    null],
  ['C+7',     'C',  '7#5',  null],
  ['C7+5',    'C',  '7#5',  null],

  // ── Slash chords ────────────────────────────────────────────────
  ['C/E',     'C',  '',     'E'],
  ['G/B',     'G',  '',     'B'],
  ['Cm7/G',   'C',  'm7',   'G'],
  ['Dm7/G',   'D',  'm7',   'G'],
  ['F/G',     'F',  '',     'G'],
  ['Bb7/D',   'Bb', '7',    'D'],
  ['Am/E',    'A',  'm',    'E'],

  // ── Enharmonic / weird notes ────────────────────────────────────
  ['Cb',      'B',  '',     null],
  ['B#',      'C',  '',     null],
  ['E#7',     'F',  '7',    null],
  ['Fbm',     'E',  'm',    null],

  // ── Case insensitivity ──────────────────────────────────────────
  ['cm7',     'C',  'm7',   null],
  ['EMIN7',   null, null,   null], // EMIN7 isn't a valid quality alias — should throw OR match?
  ['ebmaj7',  'Eb', 'M7',   null],
  ['ab7',     'Ab', '7',    null],

  // ── Real jazz standards — Real Book typical chord symbols ───────
  // Autumn Leaves
  ['Am7b5',   'A',  'm7b5', null],
  ['D7b9',    'D',  '7b9',  null],
  ['Gm7',     'G',  'm7',   null],
  ['Cm7',     'C',  'm7',   null],
  // All The Things You Are
  ['Fm7',     'F',  'm7',   null],
  ['Bbm7',    'Bb', 'm7',   null],
  ['Eb7',     'Eb', '7',    null],
  ['AbM7',    'Ab', 'M7',   null],
  ['DbM7',    'Db', 'M7',   null],
  ['Dm7b5',   'D',  'm7b5', null],
  ['G7b9',    'G',  '7b9',  null],
  // Giant Steps
  ['BM7',     'B',  'M7',   null],
  ['EbM7',    'Eb', 'M7',   null],
  // Body and Soul
  ['Cm6',     'C',  'm6',   null],
  ['Dm7',     'D',  'm7',   null],
  ['Em7',     'E',  'm7',   null],
  ['A7',      'A',  '7',    null],
  ['G7sus4',  'G',  '7sus', null],
  // ECM / modal
  ['CMaj7',   'C',  'M7',   null],
  ['Em9',     'E',  'm9',   null],
  ['Am11',    'A',  'm11',  null],
  // Latin / bossa
  ['Cmaj7#11','C',  'M7#11', null],
  ['F#m7b5',  'F#', 'm7b5', null],
  ['B7alt',   'B',  '7#9#5', null],
  // Complex tension chords
  ['C13#11',  'C',  '13#11', null],
  ['C13b9b5', 'C',  '13b9b5', null],
  ['Dbm9',    'Db', 'm9',   null],
  ['F#m11',   'F#', 'm11',  null],
  // Slash with flat bass
  ['Cm7/Bb',  'C',  'm7',   'Bb'],
  ['F#m7/B',  'F#', 'm7',   'B'],
  ['Dm7b5/Ab','D',  'm7b5', 'Ab'],
  // Minor key cadences
  ['Bm7b5',   'B',  'm7b5', null],
  ['E7b9',    'E',  '7b9',  null],
  ['Am7',     'A',  'm7',   null],
  ['Am6',     'A',  'm6',   null],
  // 6/9 voicing
  ['C69',     'C',  '69',   null],
  ['Eb69',    'Eb', '69',   null],
  ['G6/9',    null, null,   null], // typed as "6/9" with slash — slash means bass, this is ambiguous. Should fail or parse as G6 over 9? — current impl: 9 isn't a note → fail
  // m9 variants
  ['Cm9b5',   'C',  'm9b5', null],
  ['Cm11b5',  'C',  'm11b5', null],
  // 7M variants
  ['Cm7M',    'C',  'm7M',  null],
  ['CmMaj7',  'C',  'm7M',  null],
];

/* ───────────────── runner ───────────────── */

interface Result { input: string; ok: boolean; err?: string; got?: string; }

function runTests(): { results: Result[]; pass: number; fail: number } {
  const results: Result[] = [];
  let pass = 0, fail = 0;
  for (const [input, expRoot, expCtName, expBass] of cases) {
    // null root means "expected to fail"
    try {
      const cs = ChordSymbol.parse(input);
      if (expRoot == null) {
        // Was expected to fail but didn't
        results.push({
          input, ok: false,
          err: `expected parse failure, but got root=${cs.rootNote.toRelativeString()} ct=${cs.chordType.name}`,
          got: `${cs.rootNote.toRelativeString()}${cs.chordType.name}${cs.isSlashChord() ? '/' + cs.bassNote.toRelativeString() : ''}`,
        });
        fail++;
        continue;
      }
      const gotRoot = cs.rootNote.toRelativeString();
      const gotCt = cs.chordType.name;
      const gotBass = cs.isSlashChord() ? cs.bassNote.toRelativeString() : null;
      const ok = gotRoot === expRoot && gotCt === expCtName && gotBass === expBass;
      if (ok) {
        pass++;
        results.push({ input, ok: true, got: `${gotRoot}${gotCt}${gotBass ? '/' + gotBass : ''}` });
      } else {
        fail++;
        results.push({
          input, ok: false,
          err: `expected ${expRoot}${expCtName}${expBass ? '/' + expBass : ''}, got ${gotRoot}${gotCt}${gotBass ? '/' + gotBass : ''}`,
          got: `${gotRoot}${gotCt}${gotBass ? '/' + gotBass : ''}`,
        });
      }
    } catch (e) {
      if (expRoot == null) {
        pass++;
        results.push({ input, ok: true, got: `(threw as expected: ${(e as Error).message})` });
      } else {
        fail++;
        results.push({ input, ok: false, err: `threw: ${(e as Error).message}` });
      }
    }
  }
  return { results, pass, fail };
}

const { results, pass, fail } = runTests();
const db = getChordTypeDatabase();

console.log(`\n=== ChordSymbol parser test ===`);
console.log(`Database has ${db.size} chord types, ${db.getAllAliases().length} aliases.`);
console.log(`\n${pass} pass / ${fail} fail (${cases.length} total)\n`);

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('FAILURES:');
  for (const r of failed) {
    console.log(`  ✗ "${r.input}" → ${r.err}`);
  }
} else {
  console.log('✓ All tests passed');
}

if (process.argv.includes('--verbose')) {
  console.log('\nALL RESULTS:');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} "${r.input}" → ${r.got ?? r.err}`);
  }
}

process.exit(fail > 0 ? 1 : 0);
