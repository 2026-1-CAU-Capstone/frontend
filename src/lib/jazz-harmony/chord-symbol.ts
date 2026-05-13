/**
 * ChordSymbol — port of JJazzLab's ChordSymbol.java string parser.
 *
 * Parses jazz chord symbols like "Cm7", "F7b9", "Dbalt", "Amaj7/F#" into:
 *   - root note (relative pitch + accidental)
 *   - bass note (defaults to root)
 *   - chord type (looked up via ChordTypeDatabase by quality string)
 *
 * Source: model/Harmony/src/main/java/org/jjazz/harmony/api/ChordSymbol.java
 */
import { Note } from './note';
import type { Accidental } from './note';
import { ChordType } from './chord-type';
import { getChordTypeDatabase, ChordTypeDatabase } from './chord-type-database';

export class ChordSymbol {
  /** The note string the user typed (case-normalised). */
  readonly originalName: string;
  /** The canonical name JJazzLab uses (root + chordType.name + optional /bass). */
  readonly name: string;
  /** Root note, standardised to pitch range [0..11] with chosen accidental. */
  readonly rootNote: Note;
  /** Bass note (= rootNote if not specified separately). */
  readonly bassNote: Note;
  readonly chordType: ChordType;

  constructor(rootNote: Note, bassNote: Note | null, chordType: ChordType, originalName?: string) {
    this.rootNote = stdRoot(rootNote);
    const bn = bassNote ?? rootNote;
    this.bassNote = stdRoot(bn);
    this.chordType = chordType;
    this.name = ChordSymbol.computeName(this.rootNote, this.bassNote, chordType);
    this.originalName = originalName ?? this.name;
  }

  /** Whether bass differs from root (slash chord). */
  isSlashChord(): boolean {
    return !this.bassNote.equalsRelativePitch(this.rootNote);
  }

  toString(): string { return this.name; }

  static computeName(root: Note, bass: Note, ct: ChordType): string {
    const rootStr = root.toRelativeString();
    const bassStr = bass.toRelativeString();
    return rootStr + ct.name + (root.equalsRelativePitch(bass) ? '' : `/${bassStr}`);
  }

  /**
   * Parse a chord symbol string.
   *
   * Mirrors JJazzLab's ChordSymbol(String) constructor:
   *   1. Normalise unusual notes: Cb→B, B#→C, E#→F, Fb→E (case-insensitive)
   *   2. Find optional slash ("/Bb" suffix) → bass note
   *   3. Extract root note (1 or 2 chars: letter + optional b/#)
   *   4. Remainder is the chord-type quality string → DB lookup
   */
  static parse(str: string, db: ChordTypeDatabase = getChordTypeDatabase()): ChordSymbol {
    if (!str || !str.trim()) throw new Error('Empty chord symbol');

    // Step 1: enharmonic remap (Cb→B, B#→C, E#→F, Fb→E) — case-insensitive
    let s = str
      .replace(/[Cc]b/g, 'B')
      .replace(/[Bb]#/g, 'C')
      .replace(/[Ee]#/g, 'F')
      .replace(/[Ff]b/g, 'E')
      .trim();

    // Step 2: split off optional bass note after '/'
    const slashIdx = s.lastIndexOf('/');
    let bodyPart: string;
    let bassPart: string | null = null;
    if (slashIdx !== -1) {
      bassPart = s.substring(slashIdx + 1);
      if (
        bassPart.length === 0 || bassPart.length > 2
        || (bassPart.length === 2 && bassPart[1] !== 'b' && bassPart[1] !== '#')
      ) {
        throw new Error(`Invalid chord symbol: "${str}" (bad bass part)`);
      }
      bodyPart = s.substring(0, slashIdx);
    } else {
      bodyPart = s;
    }

    // Step 3: parse root note from the body prefix (Note parser is lenient —
    // it ignores trailing chars, returning how many it consumed).
    let rootInfo;
    try {
      rootInfo = Note.parseString(bodyPart);
    } catch (e) {
      throw new Error(`Invalid chord symbol: "${str}" — ${(e as Error).message}`);
    }
    const nRoot = new Note(rootInfo.relativePitch, rootInfo.accidental);

    // Step 4: quality string is whatever comes after the consumed root chars
    const quality = bodyPart.substring(rootInfo.consumed);

    // Step 5: parse bass note (if present), else default to root
    let nBass: Note;
    if (bassPart !== null) {
      let bassInfo;
      try {
        bassInfo = Note.parseString(bassPart);
      } catch (e) {
        throw new Error(`Invalid chord symbol: "${str}" — bad bass: ${(e as Error).message}`);
      }
      nBass = new Note(bassInfo.relativePitch, bassInfo.accidental);
    } else {
      nBass = nRoot;
    }

    // Step 6: chord-type DB lookup
    const ct = db.getChordType(quality);
    if (!ct) {
      throw new Error(`Unknown chord quality "${quality}" in "${str}"`);
    }

    // Build originalName preserving user-typed style (but with capital root letter)
    // and dropping "/bass" if bass turns out identical to root.
    let originalName: string;
    if (bassPart !== null && !nBass.equalsRelativePitch(nRoot)) {
      originalName =
        bodyPart.substring(0, 1).toUpperCase() + bodyPart.substring(1)
        + '/' + bassPart.substring(0, 1).toUpperCase() + bassPart.substring(1);
    } else {
      originalName = bodyPart.substring(0, 1).toUpperCase() + bodyPart.substring(1);
    }

    return new ChordSymbol(nRoot, nBass, ct, originalName);
  }
}

/** Standardise a Note to relative-pitch range [0..11] keeping accidental. */
function stdRoot(n: Note): Note {
  const rp = n.relativePitch;
  // JJazzLab uses pitch=relPitch (so octave=0). We replicate.
  return new Note(rp, n.accidental as Accidental);
}
