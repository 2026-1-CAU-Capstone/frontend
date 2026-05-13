/**
 * TypeScript port of JJazzLab's CtabChannelSettings.java (LGPL v2.1).
 *
 * One full CTAB record = the transposition rules for a single source channel
 * within one Sdec section group (Main A + …). Contains 1-3 Ctb2 sub-parts
 * (single 'main' for SFF1, low/main/high for SFF2) plus the muted-note /
 * muted-chord bitfields and the source-chord baseline.
 *
 * Byte layout (20 + 6×N + 1 = 27 bytes for SFF1, 28+ for SFF2):
 *
 *   +0   srcChannel       (0-15)
 *   +1   name[8]          ASCII, space-padded
 *   +9   destChannel      (8-15) → AccType
 *   +10  editable flag    (1 byte)
 *   +11  mutedNotes b1    bitfield: pitch 11/10/9/8 (low nibble)
 *   +12  mutedNotes b2    bitfield: pitch 7..0
 *   +13  mutedChords b1   bitfield: bit2=autoStart, bit1=chord 0, bit0=chord 1
 *   +14  mutedChords b2   chords 2..9
 *   +15  mutedChords b3   chords 10..17
 *   +16  mutedChords b4   chords 18..25
 *   +17  mutedChords b5   chords 26..33
 *   +18  sourceChordNote  (0-11, pitch class)
 *   +19  sourceChordType  (0-0x22, Yamaha wire-format byte → inverted index)
 *   +20  Ctb2 main subpart (6 bytes)
 *   [+26 SFF1 specialFeature flag]
 *   [SFF2: +20 middleLow/+21 middleHigh + 3×6-byte Ctb2 + 7 unknown]
 */

import {
  type Ctb2ChannelSettings,
  type SFFType,
} from './ctb2-channel-settings';
import { type AccType, accTypeFromChannel } from './acc-type';
import { type ChordType } from '../jazz-harmony';
import { chordTypeFromSourceByte, YAM_CHORD_NAMES, yamIndexFromSourceByte } from './yam-chord';

export interface CtabChannelSettings {
  /** 0-15, the MIDI channel whose source phrase this CTAB transforms. */
  channel: number;
  /** 8-char ASCII name, trimmed. e.g. "pno norm". */
  name: string;
  /** Yamaha part role (8-15 channel → enum). */
  accType: AccType;
  /** True if the user is allowed to edit this channel (cosmetic, unused). */
  editable: boolean;

  /** Pitch classes (0-11) that are *not* allowed to sound. */
  mutedNotes: number[];
  /** YAM_CHORD_NAMES indices that are not allowed. */
  mutedChords: number[];
  /** True if Yamaha "auto start" flag was set in muted-chord bit 2. */
  autoStart: boolean;

  /** Pitch class (0-11) of the chord this CTAB's pattern was recorded against. */
  sourceChordNote: number;
  /** Index into YAM_CHORD_NAMES of the source chord type (after inversion). */
  sourceChordTypeIndex: number;
  /** Resolved ChordType, looked up via the inverted byte. */
  sourceChordType: ChordType;

  /** SFF1: only `main` is set. SFF2: low/main/high all set when applicable. */
  ctb2Main: Ctb2ChannelSettings;
  ctb2Low: Ctb2ChannelSettings | null;
  ctb2High: Ctb2ChannelSettings | null;
  /** SFF2 only: pitch (0-127) below which ctb2Low applies. */
  ctb2MiddleLowPitch: number;
  /** SFF2 only: pitch (0-127) above which ctb2High applies. */
  ctb2MiddleHighPitch: number;
}

/* ─── bitfield decoders ─────────────────────────────────────────────── */

/**
 * Decode the 2 mutedNotes bytes into a list of muted pitch classes (0-11).
 *
 * Yamaha encoding: a bit value of **0** means "muted". The 12 pitch-class
 * bits map onto b1's low 4 bits (11, 10, 9, 8) and b2's 8 bits (7..0).
 */
export function decodeMutedNotes(b1: number, b2: number): number[] {
  const muted: number[] = [];
  if ((b1 & 0x08) === 0) muted.push(11);
  if ((b1 & 0x04) === 0) muted.push(10);
  if ((b1 & 0x02) === 0) muted.push(9);
  if ((b1 & 0x01) === 0) muted.push(8);
  if ((b2 & 0x80) === 0) muted.push(7);
  if ((b2 & 0x40) === 0) muted.push(6);
  if ((b2 & 0x20) === 0) muted.push(5);
  if ((b2 & 0x10) === 0) muted.push(4);
  if ((b2 & 0x08) === 0) muted.push(3);
  if ((b2 & 0x04) === 0) muted.push(2);
  if ((b2 & 0x02) === 0) muted.push(1);
  if ((b2 & 0x01) === 0) muted.push(0);
  return muted;
}

/**
 * Decode the 5 mutedChords bytes into a list of muted YAM_CHORD_NAMES indices
 * plus the autoStart flag.
 *
 * Yamaha encoding: bit value 0 = muted.
 *   b1.bit2 = autoStart, b1.bit1 = chord 0, b1.bit0 = chord 1
 *   b2..b5 each cover 8 chords (MSB-first): 2..9, 10..17, 18..25, 26..33.
 */
export function decodeMutedChords(
  b1: number, b2: number, b3: number, b4: number, b5: number,
): { mutedChords: number[]; autoStart: boolean } {
  const mutedChords: number[] = [];
  const autoStart = (b1 & 0x04) === 0x04;

  if ((b1 & 0x02) === 0) mutedChords.push(0);
  if ((b1 & 0x01) === 0) mutedChords.push(1);

  for (let i = 0; i < 8; i++) {
    const bit = 0x80 >> i;
    if ((b2 & bit) === 0) mutedChords.push(2 + i);
    if ((b3 & bit) === 0) mutedChords.push(10 + i);
    if ((b4 & bit) === 0) mutedChords.push(18 + i);
    if ((b5 & bit) === 0) mutedChords.push(26 + i);
  }
  return { mutedChords, autoStart };
}

/* ─── construction ──────────────────────────────────────────────────── */

/**
 * Assemble a CtabChannelSettings record from the 20-byte common-first-part
 * fields plus an already-decoded ctb2Main subpart.
 *
 * Pass `sff` to control the SFF1 / SFF2 byte-layout differences (currently
 * only affects the optional ctb2Low / ctb2High fields, which the caller
 * fills in for SFF2). For SFF1 callers, leave them null.
 */
export interface CommonFirstPartFields {
  srcChannel: number;
  name: string;
  destChannel: number;
  editable: boolean;
  mutedNotesBytes: [number, number];
  mutedChordsBytes: [number, number, number, number, number];
  sourceChordNote: number;
  sourceChordTypeByte: number;
}

export function createCtab(
  cf: CommonFirstPartFields,
  ctb2Main: Ctb2ChannelSettings,
  options: {
    sff: SFFType;
    ctb2Low?: Ctb2ChannelSettings | null;
    ctb2High?: Ctb2ChannelSettings | null;
    ctb2MiddleLowPitch?: number;
    ctb2MiddleHighPitch?: number;
  },
): CtabChannelSettings {
  if (cf.srcChannel < 0 || cf.srcChannel > 15) {
    throw new RangeError(`srcChannel out of range: ${cf.srcChannel}`);
  }
  if (cf.destChannel < 8 || cf.destChannel > 15) {
    throw new RangeError(`destChannel out of range: ${cf.destChannel}`);
  }
  if (cf.sourceChordNote < 0 || cf.sourceChordNote > 11) {
    throw new RangeError(`sourceChordNote out of range: ${cf.sourceChordNote}`);
  }

  const accType = accTypeFromChannel(cf.destChannel);
  if (accType === null) {
    throw new Error(`No AccType for destChannel ${cf.destChannel}`);
  }

  const mutedNotes = decodeMutedNotes(cf.mutedNotesBytes[0], cf.mutedNotesBytes[1]);
  const { mutedChords, autoStart } = decodeMutedChords(...cf.mutedChordsBytes);

  const sourceChordTypeIndex = yamIndexFromSourceByte(cf.sourceChordTypeByte);
  const sourceChordType = chordTypeFromSourceByte(cf.sourceChordTypeByte);

  void YAM_CHORD_NAMES; // ensure export stays alive for downstream tooling
  void options.sff;

  return {
    channel: cf.srcChannel,
    name: cf.name,
    accType,
    editable: cf.editable,
    mutedNotes,
    mutedChords,
    autoStart,
    sourceChordNote: cf.sourceChordNote,
    sourceChordTypeIndex,
    sourceChordType,
    ctb2Main,
    ctb2Low: options.ctb2Low ?? null,
    ctb2High: options.ctb2High ?? null,
    ctb2MiddleLowPitch: options.ctb2MiddleLowPitch ?? 0,
    ctb2MiddleHighPitch: options.ctb2MiddleHighPitch ?? 127,
  };
}

/** True if the given pitch class is in the muted list. */
export function isNoteMuted(c: CtabChannelSettings, pitch: number): boolean {
  return c.mutedNotes.includes(((pitch % 12) + 12) % 12);
}

/** True if the given YAM chord index is in the muted list. */
export function isChordMuted(c: CtabChannelSettings, yamIndex: number): boolean {
  return c.mutedChords.includes(yamIndex);
}

/** True for SFF1 records (no low/high subparts). */
export function isSingleCtb2(c: CtabChannelSettings): boolean {
  return c.ctb2Low === null && c.ctb2High === null;
}
