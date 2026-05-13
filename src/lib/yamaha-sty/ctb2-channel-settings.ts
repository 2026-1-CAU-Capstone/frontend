/**
 * TypeScript port of JJazzLab's Ctb2ChannelSettings.java (LGPL v2.1).
 *
 * One Ctb2 sub-section holds the transposition rules for a channel within a
 * single pitch range (Ctab/SFF1 has a single sub-section; Ctb2/SFF2 has up
 * to 3: low / main / high).
 *
 * Byte layout (6 bytes, parsed in CASMDataReader.parseCtb2Subpart):
 *
 *   +0  NTR        (0=ROOT_TRANSPOSITION, 1=ROOT_FIXED, 2=GUITAR)
 *   +1  NTT byte   (bit7=bassOn, bit0-6=table index — see SFF1→SFF2 remap below)
 *   +2  chordRootUpperLimit  (0..127)
 *   +3  noteLowLimit         (0..127)
 *   +4  noteHighLimit        (0..127)
 *   +5  retriggerRule        (0..5)
 *
 * NTT index handling:
 *   - For GUITAR NTR, index ∈ {0,1,2} → ALL_PURPOSE, STROKE, ARPEGGIO
 *     (stored at end of NTT enum so they don't collide with the harmony tables).
 *   - For SFF1 files, the historical NTT set had only 6 values (BYPASS, MELODY,
 *     CHORD, BASS, MELODIC_MINOR, HARMONIC_MINOR). They are remapped to the SFF2
 *     enum as follows:
 *       SFF1 index 3 (BASS) → bassOn=true, NTT becomes MELODY (SFF2 index 1)
 *       SFF1 index 4 (MELODIC_MINOR) → MELODIC_MINOR (SFF2 index 3)
 *       Other SFF1 indices match SFF2 1:1.
 */

export type NoteTranspositionRule =
  | 'ROOT_TRANSPOSITION'
  | 'ROOT_FIXED'
  | 'GUITAR';

export const NTR_BY_INDEX: readonly NoteTranspositionRule[] = [
  'ROOT_TRANSPOSITION',
  'ROOT_FIXED',
  'GUITAR',
];

export type NoteTranspositionTable =
  | 'BYPASS' | 'MELODY' | 'CHORD'
  | 'MELODIC_MINOR' | 'MELODIC_MINOR_5'
  | 'HARMONIC_MINOR' | 'HARMONIC_MINOR_5'
  | 'NATURAL_MINOR' | 'NATURAL_MINOR_5'
  | 'DORIAN' | 'DORIAN_5'
  | 'ALL_PURPOSE' | 'STROKE' | 'ARPEGGIO';

/** SFF2 NTT index → name. 0..10 are harmony tables, 11..13 are GUITAR-only. */
export const NTT_BY_INDEX: readonly NoteTranspositionTable[] = [
  'BYPASS',           //  0
  'MELODY',           //  1
  'CHORD',            //  2
  'MELODIC_MINOR',    //  3
  'MELODIC_MINOR_5',  //  4
  'HARMONIC_MINOR',   //  5
  'HARMONIC_MINOR_5', //  6
  'NATURAL_MINOR',    //  7
  'NATURAL_MINOR_5',  //  8
  'DORIAN',           //  9
  'DORIAN_5',         // 10
  'ALL_PURPOSE',      // 11 - GUITAR NTR only
  'STROKE',           // 12 - GUITAR NTR only
  'ARPEGGIO',         // 13 - GUITAR NTR only
];

export type RetriggerRule =
  | 'STOP'
  | 'PITCH_SHIFT'
  | 'PITCH_SHIFT_TO_ROOT'
  | 'RETRIGGER'
  | 'RETRIGGER_TO_ROOT'
  | 'NOTE_GENERATOR';

export const RTR_BY_INDEX: readonly RetriggerRule[] = [
  'STOP',
  'PITCH_SHIFT',
  'PITCH_SHIFT_TO_ROOT',
  'RETRIGGER',
  'RETRIGGER_TO_ROOT',
  'NOTE_GENERATOR',
];

/** Whether the file is SFF1 (single Ctb2) or SFF2 (low/main/high). */
export type SFFType = 'SFF1' | 'SFF2';

export interface Ctb2ChannelSettings {
  ntr: NoteTranspositionRule;
  ntt: NoteTranspositionTable;
  /** True if MELODY behaves as BASS handling (set when SFF1 index 3 is remapped). */
  bassOn: boolean;
  /** Relative pitch (0-127) of the upper limit for chord-root displacement. */
  chordRootUpperLimit: number;
  /** Absolute MIDI note (0-127) below which notes are clipped. */
  noteLowLimit: number;
  /** Absolute MIDI note (0-127) above which notes are clipped. */
  noteHighLimit: number;
  rtr: RetriggerRule;
}

/* ─── factory helpers (mirror Java setters) ───────────────────────────── */

export function ntrFromByte(b: number): NoteTranspositionRule {
  if (b < 0 || b > 2) throw new RangeError(`NTR byte out of range: ${b}`);
  return NTR_BY_INDEX[b];
}

/**
 * Resolve the NTT enum from the .sty Ctb2 byte at +1.
 *
 * The high bit is the bassOn flag, the low 7 bits are the table index.
 * For GUITAR NTR, indices 0..2 map onto the 3 guitar-only NTTs (which we
 * stored at the end of the enum, indices 11..13 here).
 * For SFF1 files, the index space is remapped to SFF2.
 *
 * Returns the resolved NTT *and* the bassOn boolean (which can mutate when
 * SFF1 index 3 BASS is encountered).
 */
export function nttFromByte(
  byte: number,
  ntr: NoteTranspositionRule,
  sff: SFFType,
): { ntt: NoteTranspositionTable; bassOn: boolean } {
  let bassOn = (byte & 0x80) !== 0;
  let index = byte & 0x7F;

  if (ntr === 'GUITAR') {
    if (index >= 3) {
      throw new Error(`Invalid NTT index for GUITAR NTR: ${index}`);
    }
    index += 11; // shift to the guitar-only block at the tail of NTT_BY_INDEX
  } else {
    if (index >= 11) {
      throw new Error(`Invalid NTT index: ${index} (ntr=${ntr})`);
    }
    if (sff === 'SFF1') {
      if (index === 3) {
        // SFF1 BASS → bassOn=true + MELODY (SFF2 index 1)
        bassOn = true;
        index = 1;
      } else if (index === 4) {
        // SFF1 MELODIC_MINOR was at 4, SFF2 puts it at 3
        index = 3;
      }
      // Other indices match 1:1
    }
  }
  return { ntt: NTT_BY_INDEX[index], bassOn };
}

export function rtrFromByte(b: number): RetriggerRule {
  if (b < 0 || b > 5) throw new RangeError(`RTR byte out of range: ${b}`);
  return RTR_BY_INDEX[b];
}
