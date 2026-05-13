/**
 * ChordType — port of JJazzLab's ChordType.java.
 *
 * Represents a chord quality (e.g. "m7", "7b9", "maj7#11") with its
 * base/extension split, family, and the list of Degrees it contains.
 * Immutable.
 *
 * Source: model/Harmony/src/main/java/org/jjazz/harmony/api/ChordType.java
 */
import { Degrees, getDegreeByNaturalAlt, degreeToShortString } from './degree';
import type { Degree, NaturalKey } from './degree';

export type Family = 'MAJOR' | 'SEVENTH' | 'MINOR' | 'DIMINISHED' | 'SUS';

/** Sentinel meaning "this degree is not present in the chord type". */
export const NOT_PRESENT = 9;

/** Ordered "slot" the chord type occupies — root, third/fourth, fifth, etc. */
export type DegreeIndex =
  | 'ROOT' | 'THIRD_OR_FOURTH' | 'FIFTH' | 'SIXTH_OR_SEVENTH'
  | 'EXTENSION1' | 'EXTENSION2' | 'EXTENSION3';

const DEGREE_INDEX_ORDER: DegreeIndex[] = [
  'ROOT', 'THIRD_OR_FOURTH', 'FIFTH', 'SIXTH_OR_SEVENTH',
  'EXTENSION1', 'EXTENSION2', 'EXTENSION3',
];

export class ChordType {
  readonly base: string;
  readonly extension: string;
  readonly family: Family;
  /** Ordered list of degrees making up this chord type. */
  readonly degrees: Degree[];

  constructor(
    base: string,
    extension: string,
    family: Family,
    i9: number, i3: number, i11: number, i5: number, i13: number, i7: number,
  ) {
    this.base = base;
    this.extension = extension;
    this.family = family;

    // Build the ordered degree list — same logic as JJazzLab ChordType constructor.
    const degs: Degree[] = [Degrees.ROOT];

    // THIRD (always present unless NOT_PRESENT)
    if (i3 !== NOT_PRESENT) {
      const d = getDegreeByNaturalAlt('THIRD', i3);
      if (d) degs.push(d);
    }

    // FOURTH = natural eleventh slot when there's NO third (sus chords)
    if (i11 === 0 && i3 === NOT_PRESENT) {
      degs.push(Degrees.FOURTH_OR_ELEVENTH);
    }

    // FIFTH
    if (i5 !== NOT_PRESENT) {
      const d = getDegreeByNaturalAlt('FIFTH', i5);
      if (d) degs.push(d);
    }

    // SIXTH (when natural 13 present AND no seventh)
    if (i13 === 0 && i7 === NOT_PRESENT) {
      degs.push(Degrees.SIXTH_OR_THIRTEENTH);
    }

    // SEVENTH
    if (i7 !== NOT_PRESENT) {
      const d = getDegreeByNaturalAlt('SEVENTH', i7);
      if (d) degs.push(d);
    }

    // NINTH
    if (i9 !== NOT_PRESENT) {
      const d = getDegreeByNaturalAlt('NINTH', i9);
      if (d) degs.push(d);
    }

    // ELEVENTH (only if not the sus case already handled above)
    if (i11 !== NOT_PRESENT && !(i11 === 0 && i3 === NOT_PRESENT)) {
      const d = getDegreeByNaturalAlt('ELEVENTH', i11);
      if (d) degs.push(d);
    }

    // THIRTEENTH (only if seventh present)
    if (i13 !== NOT_PRESENT && !(i13 === 0 && i7 === NOT_PRESENT)) {
      const d = getDegreeByNaturalAlt('SIXTH', i13);
      if (d) degs.push(d);
    }

    this.degrees = degs;
  }

  /** "m7", "maj7#11", etc. */
  get name(): string { return this.base + this.extension; }

  toString(): string { return this.name; }

  /** "[1 3b 5 7b 9]" form. */
  toDegreeString(): string {
    return '[' + this.degrees.map(degreeToShortString).join(' ') + ']';
  }

  /** Find the degree matching a relative pitch (0..11), or null. */
  getDegreeByPitch(relPitch: number): Degree | null {
    return this.degrees.find((d) => d.pitch === relPitch) ?? null;
  }

  /** Find a degree by its Natural type. */
  getDegreeByNatural(n: NaturalKey): Degree | null {
    return this.degrees.find((d) => d.natural === n) ?? null;
  }

  /** Special chord "2" has no third/fourth, no 6/7, just root+9+5. */
  isSpecial2Chord(): boolean { return this.name === '2'; }

  isMajor(): boolean { return this.getDegreeByNatural('THIRD')?.name === 'THIRD'; }
  isMinor(): boolean { return this.getDegreeByNatural('THIRD')?.name === 'THIRD_FLAT'; }
  isSus(): boolean { return this.family === 'SUS'; }
  isSeventh(): boolean { return this.getDegreeByNatural('SEVENTH') != null; }
  isSeventhMinor(): boolean { return this.getDegreeByNatural('SEVENTH')?.name === 'SEVENTH_FLAT'; }
  isSeventhMajor(): boolean { return this.getDegreeByNatural('SEVENTH')?.name === 'SEVENTH'; }
  isFifthNatural(): boolean { return this.getDegreeByNatural('FIFTH')?.name === 'FIFTH'; }
  isFifthSharp(): boolean { return this.getDegreeByNatural('FIFTH')?.name === 'FIFTH_SHARP'; }
  isFifthFlat(): boolean { return this.getDegreeByNatural('FIFTH')?.name === 'FIFTH_FLAT'; }
  isSixth(): boolean {
    return this.getDegreeByNatural('SEVENTH') == null
      && this.getDegreeByNatural('SIXTH')?.name === 'SIXTH_OR_THIRTEENTH';
  }
  isThirteenth(): boolean {
    return this.getDegreeByNatural('SEVENTH') != null
      && this.getDegreeByNatural('SIXTH')?.name === 'SIXTH_OR_THIRTEENTH';
  }
  isNinth(): boolean { return this.getDegreeByNatural('NINTH') != null; }
}

export { DEGREE_INDEX_ORDER };
