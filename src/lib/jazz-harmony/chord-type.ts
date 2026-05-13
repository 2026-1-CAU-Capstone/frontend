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

  /**
   * Pick the most probable Degree for a given relative-pitch-class (0-11).
   *
   * First tries an exact pitch match in this chord type. If none, falls back
   * to musically-reasonable defaults: e.g. b3 on a major chord becomes #9,
   * b3 on any other chord stays as THIRD_FLAT. Port of
   * ChordType.getDegreeMostProbable (LGPL v2.1).
   *
   * @throws if relPitch is outside 0-11
   */
  getDegreeMostProbable(relPitch: number): Degree {
    if (relPitch < 0 || relPitch > 11) {
      throw new RangeError(`relPitch=${relPitch}`);
    }
    const found = this.getDegreeByPitch(relPitch);
    if (found !== null) return found;

    switch (relPitch) {
      case 0:  return Degrees.ROOT;
      case 1:  return Degrees.NINTH_FLAT;
      case 2:  return Degrees.NINTH;
      case 3:  return this.isMajor() ? Degrees.NINTH_SHARP : Degrees.THIRD_FLAT;
      case 4:  return Degrees.THIRD;
      case 5:  return Degrees.FOURTH_OR_ELEVENTH;
      case 6:  return Degrees.ELEVENTH_SHARP;
      case 7:  return Degrees.FIFTH;
      case 8:  return Degrees.THIRTEENTH_FLAT;
      case 9:  return Degrees.SIXTH_OR_THIRTEENTH;
      case 10: return Degrees.SEVENTH_FLAT;
      case 11: return Degrees.SEVENTH;
      default: throw new RangeError(`relPitch=${relPitch}`);
    }
  }

  /**
   * Fit harmonically degree `d` to this chord type.
   *
   * Port of ChordType.fitDegree(Degree) from JJazzLab (LGPL v2.1). Used by
   * SourcePhrase.getDestDegrees to map a source-phrase degree onto the
   * nearest chord tone of the destination chord. Returns null if no fit.
   *
   * Examples:
   *   d=ELEVENTH_SHARP, this="m7b5" → FIFTH_FLAT  (same pitch class)
   *   d=ELEVENTH_SHARP, this="M7"   → null
   *   d=SEVENTH, this="6"           → SIXTH_OR_THIRTEENTH (special)
   *   d=SIXTH_OR_THIRTEENTH, this="M7" → SEVENTH (special)
   */
  fitDegree(d: Degree): Degree | null {
    // Try natural degree match
    let destDegree = this.getDegreeByNatural(d.natural);

    if (destDegree === null) {
      // Same pitch class via a different natural (e.g. b5 vs #11)
      destDegree = this.getDegreeByPitch(d.pitch);
    } else if (this.extension.includes('6') && d.natural === 'SEVENTH') {
      // "6" chord receiving a 7th source → use 6th
      destDegree = Degrees.SIXTH_OR_THIRTEENTH;
    } else if (this.getDegreeByNatural('SEVENTH') !== null && d.natural === 'SIXTH') {
      // Chord has a 7th, source sent 6th → use 7th
      destDegree = this.getDegreeByNatural('SEVENTH');
    }

    return destDegree;
  }
}

export { DEGREE_INDEX_ORDER };
