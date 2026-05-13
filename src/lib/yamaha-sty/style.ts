/**
 * TypeScript port of JJazzLab's Style.java (LGPL v2.1).
 *
 * The top-level container for a parsed Yamaha style file. Holds:
 *   - the file metadata (name, time-signature, ticks-per-quarter, tempo)
 *   - the SFF version (1 = .sty/.sst/.prs/.bcs simple Ctab, 2 = Ctb2 with
 *     low/main/high pitch ranges)
 *   - up to 18 StyleParts keyed by StylePartType
 *   - the parsed SInt section (program changes per channel) which lives in
 *     a separate flat record because it applies globally to all sections
 *
 * Unlike the Java original we omit:
 *   - feel inference (we'll compute swing/straight separately when needed)
 *   - the Division enum (jazz vs. straight-eighth — also derived later)
 */

import { type StylePart } from './style-part';
import { type StylePartType } from './style-part-type';

export type SFFVersion = 'SFF1' | 'SFF2';

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * SInt = "Style INTernal" section. Stores the General-MIDI program (and a
 * few related controllers) that each channel should sound through. Yamaha
 * keyboards apply this as a Program Change at the start of playback so that
 * the user doesn't have to set up the synth manually.
 */
export interface ChannelInstrument {
  /** GM1 program number 0-127. */
  program: number;
  /** MSB controller value (cc#0), 0 if not set. */
  bankMSB: number;
  /** LSB controller value (cc#32), 0 if not set. */
  bankLSB: number;
  /** Optional channel volume (cc#7), 100 if not set. */
  volume: number;
  /** Optional channel pan (cc#10), 64 (centre) if not set. */
  pan: number;
}

export interface Style {
  /** Display name (typically the file stem). */
  name: string;
  /** SMF ticks per quarter note (1920 for psBase.sst). */
  ticksPerQuarter: number;
  /** Beats per minute (rounded). 0 if no Tempo meta event found. */
  tempo: number;
  /** Section time signature (4/4 for psBase.sst). */
  timeSignature: TimeSignature;
  /** SFF version. SFF1 uses Ctab, SFF2 uses Ctb2 with pitch ranges. */
  sff: SFFVersion;
  /** Parsed StyleParts keyed by type. */
  parts: Map<StylePartType, StylePart>;
  /** Per-channel GM program assignments from the SInt section. */
  channelInstruments: Map<number, ChannelInstrument>;
}

/* ─── factory ────────────────────────────────────────────────────────── */

export function createStyle(name: string): Style {
  return {
    name,
    ticksPerQuarter: 0,
    tempo: 0,
    timeSignature: { numerator: 4, denominator: 4 },
    sff: 'SFF1',
    parts: new Map(),
    channelInstruments: new Map(),
  };
}

/* ─── helpers ────────────────────────────────────────────────────────── */

export function addStylePart(s: Style, part: StylePart): void {
  s.parts.set(part.type, part);
}

export function getStylePart(s: Style, t: StylePartType): StylePart | undefined {
  return s.parts.get(t);
}

export function setChannelInstrument(s: Style, channel: number, inst: ChannelInstrument): void {
  if (channel < 0 || channel > 15) {
    throw new RangeError(`channel ${channel}`);
  }
  s.channelInstruments.set(channel, inst);
}

export function getChannelInstrument(s: Style, channel: number): ChannelInstrument | undefined {
  return s.channelInstruments.get(channel);
}

/** All section types present in this Style, in StylePartType enum order. */
export function presentPartTypes(s: Style): StylePartType[] {
  return Array.from(s.parts.keys());
}
