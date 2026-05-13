/**
 * TypeScript port of JJazzLab's AccType.java (LGPL v2.1).
 *
 * Standard Yamaha accompaniment part channels (8-15) and their semantics.
 * The ordinal of the enum corresponds to destChannel - 8 in the .sty Ctab.
 *
 *   ordinal 0 = ch 8  = SubRhythm   (drums, percussion)
 *   ordinal 1 = ch 9  = Rhythm      (drums)
 *   ordinal 2 = ch 10 = Bass
 *   ordinal 3 = ch 11 = Chord 1
 *   ordinal 4 = ch 12 = Chord 2
 *   ordinal 5 = ch 13 = Pad
 *   ordinal 6 = ch 14 = Phrase 1
 *   ordinal 7 = ch 15 = Phrase 2
 *
 * Each AccType has:
 *   - a default GM1 instrument number (null for drums)
 *   - an authorisedDegrees list — the source phrase notes this part is
 *     allowed to play, expressed as chord degrees. null = no restriction.
 */

import { Degrees, type Degree } from '../jazz-harmony';

export type AccType =
  | 'SUBRHYTHM' | 'RHYTHM' | 'BASS' | 'CHORD1'
  | 'CHORD2' | 'PAD' | 'PHRASE1' | 'PHRASE2';

export const ACC_TYPES: readonly AccType[] = [
  'SUBRHYTHM', 'RHYTHM', 'BASS', 'CHORD1', 'CHORD2', 'PAD', 'PHRASE1', 'PHRASE2',
];

export interface AccTypeInfo {
  /** Default General MIDI program number (0-127), null for drums/percussion. */
  defaultGM1Program: number | null;
  /** Authorised source degrees, null = no restriction. */
  authorisedDegrees: Degree[] | null;
  /** Default MIDI channel (8-15). */
  channel: number;
}

const ACC_TYPE_INFOS: Record<AccType, AccTypeInfo> = {
  SUBRHYTHM: {
    defaultGM1Program: null,
    authorisedDegrees: null,
    channel: 8,
  },
  RHYTHM: {
    defaultGM1Program: null,
    authorisedDegrees: null,
    channel: 9,
  },
  BASS: {
    defaultGM1Program: 35, // Fretless Bass (GM1 index 35 == "Electric Bass (pick)" but JJazzLab uses "Fretless Bass" — Yamaha numbering differs by 1 from MIDI standard)
    authorisedDegrees: [
      Degrees.ROOT, Degrees.NINTH, Degrees.THIRD, Degrees.FIFTH,
      Degrees.SIXTH_OR_THIRTEENTH, Degrees.SEVENTH,
    ],
    channel: 10,
  },
  CHORD1: {
    defaultGM1Program: 26, // Electric Guitar (jazz)
    authorisedDegrees: [Degrees.ROOT, Degrees.THIRD, Degrees.FIFTH, Degrees.SEVENTH],
    channel: 11,
  },
  CHORD2: {
    defaultGM1Program: 0, // Acoustic Grand Piano
    authorisedDegrees: [Degrees.ROOT, Degrees.THIRD, Degrees.FIFTH, Degrees.SEVENTH],
    channel: 12,
  },
  PAD: {
    defaultGM1Program: 50, // Synth Strings 1
    authorisedDegrees: [Degrees.ROOT, Degrees.THIRD, Degrees.FIFTH, Degrees.SEVENTH],
    channel: 13,
  },
  PHRASE1: {
    defaultGM1Program: 62, // Synth Brass 1
    authorisedDegrees: [
      Degrees.ROOT, Degrees.NINTH, Degrees.THIRD, Degrees.FIFTH,
      Degrees.SIXTH_OR_THIRTEENTH, Degrees.SEVENTH,
    ],
    channel: 14,
  },
  PHRASE2: {
    defaultGM1Program: 2, // Electric Grand Piano
    authorisedDegrees: [
      Degrees.ROOT, Degrees.NINTH, Degrees.THIRD, Degrees.FIFTH,
      Degrees.SIXTH_OR_THIRTEENTH, Degrees.SEVENTH,
    ],
    channel: 15,
  },
};

export function getAccTypeInfo(t: AccType): AccTypeInfo {
  return ACC_TYPE_INFOS[t];
}

/** "Subrhythm" / "Bass" / "Chord1" — display name. */
export function accTypeToString(t: AccType): string {
  if (t === 'SUBRHYTHM') return 'SubRhythm';
  return t.charAt(0) + t.substring(1).toLowerCase();
}

/** Channel (8-15) → AccType, or null. */
export function accTypeFromChannel(channel: number): AccType | null {
  if (channel < 8 || channel > 15) return null;
  return ACC_TYPES[channel - 8];
}

/** AccType ordinal (0-7). */
export function accTypeOrdinal(t: AccType): number {
  return ACC_TYPES.indexOf(t);
}

/** True for RHYTHM or SUBRHYTHM (drum/percussion channels). */
export function isDrums(t: AccType): boolean {
  return t === 'RHYTHM' || t === 'SUBRHYTHM';
}

/** True if relPitch (0-11) is in the authorised degrees of this AccType. */
export function isAuthorisedNote(t: AccType, relPitch: number): boolean {
  if (relPitch < 0 || relPitch > 11) {
    throw new RangeError(`relPitch=${relPitch}`);
  }
  const info = ACC_TYPE_INFOS[t];
  if (info.authorisedDegrees === null) return true;
  return info.authorisedDegrees.some((d) => d.pitch === relPitch);
}

/** The authorised Degree whose pitch matches relPitch, else null.
 *  For unrestricted AccTypes (null authorisedDegrees), returns null because
 *  the Java version falls back to Degree.getDegrees(relPitch).get(0) which
 *  requires a database that isn't relevant for the SubRhythm/Rhythm cases. */
export function getAuthorisedDegree(t: AccType, relPitch: number): Degree | null {
  if (relPitch < 0 || relPitch > 11) {
    throw new RangeError(`relPitch=${relPitch}`);
  }
  const info = ACC_TYPE_INFOS[t];
  if (info.authorisedDegrees === null) return null;
  return info.authorisedDegrees.find((d) => d.pitch === relPitch) ?? null;
}
