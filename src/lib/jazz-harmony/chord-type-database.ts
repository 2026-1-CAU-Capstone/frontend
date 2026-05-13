/**
 * ChordTypeDatabase — ported from JJazzLab ChordTypeDatabaseImpl.
 *
 * Holds the 62 recognised chord types with their alias strings. The parser
 * uses this to recognise quality strings like "m7", "min7", "-7", "mi7"
 * (all four → minor 7).
 *
 * Source: model/Harmony/src/main/java/org/jjazz/harmony/ChordTypeDatabaseImpl.java
 */
import { ChordType, NOT_PRESENT, type Family } from './chord-type';

const NP = NOT_PRESENT;
const MAJ: Family = 'MAJOR';
const SEV: Family = 'SEVENTH';
const MIN: Family = 'MINOR';
const DIM: Family = 'DIMINISHED';
const SUS: Family = 'SUS';

/** Tuple: [base, extension, family, aliases (colon-separated), i9, i3, i11, i5, i13, i7]
 *  — exact port of JJazzLab's addBuiltin() call list. */
const BUILTINS: Array<[string, string, Family, string, number, number, number, number, number, number]> = [
  // MAJOR
  ['',   '',     MAJ, ':M:maj:MAJ:Maj:bass:Bass:BASS:1+8:1+5:5:', NP, 0, NP, 0, NP, NP],
  ['+',  '',     MAJ, ':maj#5:maj+5:M#5:ma#5:ma+5:aug:', NP, 0, NP, 1, NP, NP],
  ['6',  '',     MAJ, ':maj6:MAJ6:Maj6:M6:', NP, 0, NP, 0, 0, NP],
  ['6',  '9',    MAJ, ':M69:ma69:maj69:MAJ69:Maj6(9):', 0, 0, NP, 0, 0, NP],
  ['M7', '',     MAJ, ':7M:maj7:ma7:MAJ7:Maj7:', NP, 0, NP, 0, NP, 0],
  ['M7', '13',   MAJ, ':maj713:ma713:MAJ713:M7add13:', NP, 0, NP, 0, 0, 0],
  ['M9', '',     MAJ, ':9M:maj79:maj9:ma79:MAJ79:Maj9:Maj(9):Maj7(9):Maj9(no3):', 0, 0, NP, 0, NP, 0],
  ['M13','',     MAJ, ':ma13:maj13:MAJ13:13M:Maj13:', 0, 0, NP, 0, 0, 0],
  ['M7', 'b5',   MAJ, ':maj7b5:maj-5:Mb5:7M-5:7Mb5:ma7b5:ma-5:b5:Maj7b5:', NP, 0, NP, -1, NP, 0],
  ['M7', '#5',   MAJ, ':maj7#5:7M+5:7M#5:ma7#5:Maj7aug:Maj7#5:', NP, 0, NP, 1, NP, 0],
  ['M7', '#11',  MAJ, ':maj7#11:7M#11:Maj7#11:ma7#11:', NP, 0, 1, 0, NP, 0],
  ['M9', '#11',  MAJ, ':maj9#11:9M#11:ma9#11:Maj9#11:Lyd:lyd:Maj7Lyd:7Mlyd:M7lyd:', 0, 0, 1, 0, NP, 0],
  ['M13','#11',  MAJ, ':maj13#11:13M#11:ma13#11:Maj13#11:', 0, 0, 1, 0, 0, 0],

  // SEVENTH (dominant)
  ['7',  '',     SEV, ':7th:', NP, 0, NP, 0, NP, -1],
  ['9',  '',     SEV, ':79:7(9):', 0, 0, NP, 0, NP, -1],
  ['13', '',     SEV, ':713:7(13):7add6:7add13:67:', NP, 0, NP, 0, 0, -1],
  ['7',  'b5',   SEV, ':7-5:', NP, 0, NP, -1, NP, -1],
  ['9',  'b5',   SEV, ':9-5:79b5:79-5:', 0, 0, NP, -1, NP, -1],
  ['7',  '#5',   SEV, ':7+5:+7:7+:7(b13):7aug:aug7:7b13:', NP, 0, NP, 1, NP, -1],
  ['9',  '#5',   SEV, ':9+5:79#5:9+:', 0, 0, NP, 1, NP, -1],
  ['7',  'b9',   SEV, ':7-9:7(b9):', -1, 0, NP, 0, NP, -1],
  ['7',  '#9',   SEV, ':7+9:7(#9):', 1, 0, NP, 0, NP, -1],
  ['7',  '#9#5', SEV, ':7+5+9:7#5#9:7alt:', 1, 0, NP, 1, NP, -1],
  ['7',  'b9#5', SEV, ':7+5-9:7#5b9:7b9b13:', -1, 0, NP, 1, NP, -1],
  ['7',  'b9b5', SEV, ':7-5-9:7b5b9:', -1, 0, NP, -1, NP, -1],
  ['7',  '#9b5', SEV, ':7-5+9:7b5#9:', 1, 0, NP, -1, NP, -1],
  ['7',  '#11',  SEV, ':7+11:', NP, 0, 1, 0, NP, -1],
  ['9',  '#11',  SEV, ':9+11:', 0, 0, 1, 0, NP, -1],
  ['7',  'b9#11',SEV, ':7-9+11:', -1, 0, 1, 0, NP, -1],
  ['7',  '#9#11',SEV, ':7+9+11:', 1, 0, 1, 0, NP, -1],
  ['13', 'b5',   SEV, ':13-5:713b5:713-5:', NP, 0, NP, -1, 0, -1],
  ['13', 'b9',   SEV, ':13-9:713b9:713-9:', -1, 0, NP, 0, 0, -1],
  ['13', 'b9b5', SEV, ':13-9-5:13b5b9:', -1, 0, NP, -1, 0, -1],
  ['13', '#9',   SEV, ':13+9:713#9:713+9:', 1, 0, NP, 0, 0, -1],
  ['13', '#9b5', SEV, ':13+9-5:13b5#9:', 1, 0, NP, -1, 0, -1],
  ['13', '#11',  SEV, ':13+11:713#11:713+11:', 0, 0, 1, 0, 0, -1],
  ['13', 'b9#11',SEV, ':13-9+11:', -1, 0, 1, 0, 0, -1],

  // MINOR
  ['m',  '',     MIN, ':min:mi:-:', NP, -1, NP, 0, NP, NP],
  ['m2', '',     MIN, ':min2:mi2:-2:madd2:madd9:', 0, -1, NP, 0, NP, NP],
  ['m+', '',     MIN, ':m#5:mi#5:m+5:mi+:-#5:maug:', NP, -1, NP, 1, NP, NP],
  ['m6', '',     MIN, ':min6:mi6:-6:', NP, -1, NP, 0, 0, NP],
  ['m6', '9',    MIN, ':min69:mi69:-69:', 0, -1, NP, 0, 0, NP],
  ['m7', '',     MIN, ':mi7:min7:-7:', NP, -1, NP, 0, NP, -1],
  ['m7', 'b9',   MIN, ':mi7b9:min7b9:-7b9:', -1, -1, NP, 0, NP, -1],
  ['m7', '13',   MIN, ':mi713:min713:-713:m7add13:', NP, -1, NP, 0, 0, -1],
  ['m7', '#5',   MIN, ':mi7#5:min7#5:-7#5:', NP, -1, NP, 1, NP, -1],
  ['m9', '',     MIN, ':mi9:min9:min(9):min7(9):-9:', 0, -1, NP, 0, NP, -1],
  ['m9', '11',   MIN, ':m9(11):mi911:min911:-9(11):-911:', 0, -1, 0, 0, NP, -1],
  ['m11','',     MIN, ':m711:mi711:min711:-11:-711:min7(11):m7add11:m7add4:madd4:', NP, -1, 0, 0, NP, -1],
  ['m13','',     MIN, ':mi13:min13:-13:m913:m9add13:', 0, -1, NP, 0, 0, -1],
  ['m',  '7M',   MIN, ':-maj7:min7M:minMaj7:-7M:mM7:mMaj7:', NP, -1, NP, 0, NP, 0],
  ['m9', '7M',   MIN, ':mi9M:min9M:minMaj7(9):-9M:mM9:m7M9', 0, -1, NP, 0, NP, 0],

  // DIMINISHED
  ['',   'dim',  DIM, ':°:o:h:mb5:dim5:', NP, -1, NP, -1, NP, NP],
  ['',   'dim7', DIM, ':°7:o7:7dim:h7:', NP, -1, NP, -1, 0, NP],
  ['',   'dim7M',DIM, ':°7M:o7M:oM7:7dim7M:dimM7:', NP, -1, NP, -1, NP, 0],
  ['m7', 'b5',   DIM, ':m7-5:mi7b5:mi7-5:min7b5:min7-5:-7b5:', NP, -1, NP, -1, NP, -1],
  ['m9', 'b5',   DIM, ':m9-5:mi9b5:mi9-5:min9b5:min9-5:-9b5:', 0, -1, NP, -1, NP, -1],
  ['m11','b5',   DIM, ':m11(b5):min11(b5):-11b5:-11(b5):', NP, -1, 0, -1, NP, -1],

  // SUS
  ['2',  '',     SUS, ':add9:1+2+5:sus2:add2:', 0, NP, NP, 0, NP, NP],
  ['',   'sus',  SUS, ':sus4:4:', NP, NP, 0, 0, NP, NP],
  ['7',  'sus',  SUS, ':sus7:7sus4:74:11:', NP, NP, 0, 0, NP, -1],
  ['9',  'sus',  SUS, ':79sus:sus79:sus9:9sus4:94:', 0, NP, 0, 0, NP, -1],
  ['13', 'sus',  SUS, ':713sus:sus713:sus13:13sus4:134:', 0, NP, 0, 0, 0, -1],
  ['7',  'susb9',SUS, ':7sus-9:7sus4b9:sus7b9:sus7-9:7b9sus:7b9sus4:', -1, NP, 0, 0, NP, -1],
  ['13', 'susb9',SUS, ':13sus-9:sus13b9:sus13-9:', -1, NP, 0, 0, 0, -1],
];

export class ChordTypeDatabase {
  private readonly chordTypes: ChordType[] = [];
  /** Alias-string → ChordType. The canonical name is also included as an alias. */
  private readonly byAlias: Map<string, ChordType> = new Map();

  constructor() {
    for (const [base, ext, family, aliasStr, i9, i3, i11, i5, i13, i7] of BUILTINS) {
      const ct = new ChordType(base, ext, family, i9, i3, i11, i5, i13, i7);
      this.chordTypes.push(ct);
      // Register the canonical name (e.g. "m7" or "" for plain major) too.
      const canonicalName = base + ext;
      // For plain major "" we want lookup("") → return major.
      if (!this.byAlias.has(canonicalName)) this.byAlias.set(canonicalName, ct);
      // Parse the alias string. Format ":alias1:alias2:..."
      for (const a of aliasStr.split(':')) {
        if (!a) continue;
        if (!this.byAlias.has(a)) this.byAlias.set(a, ct);
      }
    }
  }

  /** Look up a chord type by quality string (or its alias). Returns null if unknown. */
  getChordType(s: string): ChordType | null {
    return this.byAlias.get(s) ?? null;
  }

  /** Get chord type by index in the registration order. */
  getChordTypeAt(i: number): ChordType | null {
    return this.chordTypes[i] ?? null;
  }

  /** Get all chord types in registration order. */
  getAllChordTypes(): ChordType[] { return [...this.chordTypes]; }

  /** All aliases registered. Useful for debug. */
  getAllAliases(): string[] { return [...this.byAlias.keys()]; }

  get size(): number { return this.chordTypes.length; }
}

/** Singleton accessor. */
let _instance: ChordTypeDatabase | null = null;
export function getChordTypeDatabase(): ChordTypeDatabase {
  if (!_instance) _instance = new ChordTypeDatabase();
  return _instance;
}
