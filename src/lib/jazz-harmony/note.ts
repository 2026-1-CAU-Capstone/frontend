/**
 * Note — minimal port of JJazzLab's Note.java focused on what chord parsing needs.
 *
 * JJazzLab's Note has 600+ lines (MIDI velocity, beat duration, octave-string
 * conversion, staff-line calc, etc.). For chord parsing we only need:
 *   - parse a string like "C", "Cb", "F#", "A" → relative pitch (0–11) + accidental
 *   - relativePitch + octave
 *   - render back to string with chosen accidental
 *   - relative-pitch comparison
 *
 * Source reference: model/Harmony/src/main/java/org/jjazz/harmony/api/Note.java
 */

export type Accidental = 'FLAT' | 'SHARP';

const NOTES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const PITCH_STD = 60;     // C4
export const OCTAVE_STD = 4;

export class Note {
  readonly pitch: number;            // 0..127 MIDI pitch
  readonly accidental: Accidental;

  constructor(pitch: number, accidental: Accidental = 'FLAT') {
    if (pitch < 0 || pitch > 127) throw new Error(`Note pitch out of range: ${pitch}`);
    this.pitch = pitch;
    this.accidental = accidental;
  }

  /** 0..11 */
  get relativePitch(): number { return ((this.pitch % 12) + 12) % 12; }

  /** Scientific-style octave (C4 = octave 4, but PDF rather: pitch/12 = 0..10). */
  get octave(): number { return Math.floor(this.pitch / 12); }

  /** Same relative pitch (octave-agnostic equality). */
  equalsRelativePitch(other: Note): boolean {
    return this.relativePitch === other.relativePitch;
  }

  /** Render to letter+accidental, e.g. "Bb" / "F#". */
  toRelativeString(acc: Accidental = this.accidental): string {
    return acc === 'FLAT' ? NOTES_FLAT[this.relativePitch] : NOTES_SHARP[this.relativePitch];
  }

  /**
   * Parse a note prefix from a string, silently ignoring trailing content.
   *
   * Examples:
   *   "C"   → { relativePitch: 0,  accidental: FLAT,  octave: null, consumed: 1 }
   *   "F#"  → { relativePitch: 6,  accidental: SHARP, octave: null, consumed: 2 }
   *   "Cm7" → { relativePitch: 0,  accidental: FLAT,  octave: null, consumed: 1 }  ("m7" left over)
   *   "Bb6" → { relativePitch: 10, accidental: FLAT,  octave: null, consumed: 2 }
   *   "C!3" → { relativePitch: 0,  accidental: FLAT,  octave: 3,    consumed: 3 }
   *
   * Enharmonic remap: "Cb"→B, "B#"→C, "E#"→F, "Fb"→E (case-insensitive).
   *
   * Mirrors JJazzLab Note(String) which is lenient — chord-symbol parser relies on this.
   */
  static parseString(s: string): { relativePitch: number; accidental: Accidental; octave: number | null; consumed: number } {
    if (!s || !s.trim()) throw new Error('Empty note string');
    const str = s.trim();
    if (str.length === 0) throw new Error(`Empty note: "${s}"`);

    // Letter is str[0] (case-insensitive), accidental letter is str[1] if 'b'/'#'.
    const letter = str[0].toUpperCase();
    const accChar = str.length > 1 ? str[1].toLowerCase() : '';
    const hasAcc = accChar === 'b' || accChar === '#';
    const noteLen = hasAcc ? 2 : 1;

    // Enharmonic remap (Cb→B, B#→C, E#→F, Fb→E)
    const key = hasAcc ? letter + accChar : letter;
    let relativePitch = -1;
    let accidental: Accidental = 'FLAT';
    if (key === 'Cb') { relativePitch = 11; accidental = 'FLAT'; }
    else if (key === 'B#') { relativePitch = 0;  accidental = 'SHARP'; }
    else if (key === 'E#') { relativePitch = 5;  accidental = 'SHARP'; }
    else if (key === 'Fb') { relativePitch = 4;  accidental = 'FLAT'; }
    else {
      for (let i = 0; i < 12; i++) {
        if (key.toUpperCase() === NOTES_FLAT[i].toUpperCase()) {
          relativePitch = i; accidental = 'FLAT'; break;
        }
        if (key.toUpperCase() === NOTES_SHARP[i].toUpperCase()) {
          relativePitch = i; accidental = 'SHARP'; break;
        }
      }
    }

    if (relativePitch < 0) throw new Error(`Invalid note: "${s}"`);

    // Optional explicit octave after the note: "!3"
    let octave: number | null = null;
    let consumed = noteLen;
    if (str.length > noteLen && str[noteLen] === '!') {
      // Read digits after !
      const tailStart = noteLen + 1;
      let p = tailStart;
      while (p < str.length && /[0-9]/.test(str[p])) p++;
      if (p === tailStart) throw new Error(`Missing octave digit after '!': "${s}"`);
      const n = parseInt(str.substring(tailStart, p), 10);
      if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`Invalid octave in "${s}"`);
      octave = n;
      consumed = p;
    }

    return { relativePitch, accidental, octave, consumed };
  }

  /** Convenience: build Note from string with optional explicit octave (defaults to OCTAVE_STD). */
  static fromString(s: string): Note {
    const { relativePitch, accidental, octave } = Note.parseString(s);
    const oct = octave ?? OCTAVE_STD;
    return new Note(oct * 12 + relativePitch, accidental);
  }

  toString(): string { return this.toRelativeString() + this.octave; }
}
