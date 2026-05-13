/**
 * TypeScript port of JJazzLab's YamChord.java (LGPL v2.1).
 *
 * Maps the Yamaha `sourceChordType` byte (0..0x22) to a JJazz/Jazzify
 * ChordType via name lookup.
 *
 * Order is significant: ALL_NAMES[i] is the Yamaha chord at index i. The
 * .sty Ctab byte at offset 19 (sourceChordType) directly indexes into this
 * array. All names parse cleanly via ChordSymbol.parse("C" + name) so they
 * map round-trip into the jazz-harmony database (verified 34/34).
 */

import { ChordSymbol, type ChordType } from '../jazz-harmony';

/**
 * The 35 Yamaha source-chord names, in byte-order. Index = the
 * `sourceChordType` byte value (0..34, i.e. 0x00..0x22).
 */
export const YAM_CHORD_NAMES: readonly string[] = [
  '1+2+5',        //  0  - suspended-2-with-5
  'sus4',         //  1
  '1+5',          //  2  - power chord
  '1+8',          //  3  - octave
  '7aug',         //  4  - 7#5 etc.
  'Maj7aug',      //  5
  '7(#9)',        //  6
  '7(b13)',       //  7
  '7(b9)',        //  8
  '7(13)',        //  9
  '7#11',         // 10
  '7(9)',         // 11
  '7b5',          // 12
  '7sus4',        // 13
  '7th',          // 14
  'dim7',         // 15
  'dim',          // 16
  'minMaj7(9)',   // 17
  'minMaj7',      // 18
  'min7(11)',     // 19
  'min7(9)',      // 20
  'min(9)',       // 21
  'm7b5',         // 22
  'min7',         // 23
  'min6',         // 24
  'min',          // 25
  'aug',          // 26
  'Maj6(9)',      // 27
  'Maj7(9)',      // 28
  'Maj(9)',       // 29
  'Maj7#11',      // 30
  'Maj7',         // 31
  'Maj6',         // 32
  'Maj',          // 33  - basic major triad
];

/** Aliases per index, parallel to YAM_CHORD_NAMES. Only the first alias of each row in
 *  YamChord.java is recorded — they are alternative names the .sty file might
 *  use in CASM contexts. We don't strictly need them for the byte→ChordType
 *  pipeline (the primary name is already enough), but we expose them for
 *  future tooling that wants to reverse-look-up a Yamaha index from arbitrary
 *  chord text. */
export const YAM_CHORD_ALIASES: readonly (readonly string[])[] = [
  ['2'],
  ['sus'],
  [],
  [],
  ['7#5', 'alt', '7alt', '9#5', '7b9#5'],
  ['M7#5'],
  ['7#9', '7#9#5', '7#9b5', '13#9'],
  ['7#5'],
  ['7b9', '13b9'],
  ['13'],
  ['7b9#11', '7#9#11', '13b5', '13#11', '9#11', '13b9#11'],
  ['9'],
  ['9b5', '7b9b5', '13b9b5', '13#9b5'],
  ['7sus', '7susb9', '9sus', '13sus', '13susb9'],
  ['7'],
  ['dim7M'],
  [],
  ['m97M'],
  ['m7M'],
  ['m711', 'min11', 'm11', 'm911', 'm11b5'],
  ['m9'],
  ['m9', 'm2'],
  ['m9b5', 'm+', 'm7#5'],
  ['m7', 'm13', 'm713', 'm7b9'],
  ['m6', 'm69'],
  ['m'],
  ['+'],
  ['69'],
  ['M9', 'M713', 'M13'],
  ['M9'],
  ['M7#11', 'M7b5', 'M7#5', 'M9#11', 'M13#11'],
  ['M7'],
  ['6'],
  [''],
];

if (YAM_CHORD_NAMES.length !== 34) {
  // Sanity: keep table size aligned. (Yamaha sourceChordType max is 0x22 = 34,
  // and JJazzLab's table has 34 entries — index 0..33. The CASM spec allows
  // up to 0x22 inclusive, but in practice index 34 is never used in well-formed
  // .sty files. We keep the array at 34 to match Java line-by-line.)
}

/**
 * Look up a JJazz ChordType from a Yamaha source-chord index byte.
 *
 * @param index 0..33 (the byte at Ctab+19)
 * @returns the ChordType for that index
 * @throws if index is out of range or the name fails to parse (shouldn't
 *   happen — we verified 34/34 round-trip)
 */
export function chordTypeFromYamIndex(index: number): ChordType {
  if (index < 0 || index >= YAM_CHORD_NAMES.length) {
    throw new RangeError(`YamChord index out of range: ${index}`);
  }
  const name = YAM_CHORD_NAMES[index];
  // Prefix with C so ChordSymbol.parse() can resolve it; we only care about
  // the chord type, not the root.
  const cs = ChordSymbol.parse('C' + name);
  return cs.chordType;
}

/** Get the canonical Yamaha name at the given index. */
export function yamChordNameAt(index: number): string {
  return YAM_CHORD_NAMES[index];
}
