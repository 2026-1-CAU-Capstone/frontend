/**
 * TypeScript port of JJazzLab's StylePart.java (LGPL v2.1).
 *
 * One section of a Yamaha style (e.g. "Main A"). Holds:
 *   - the CtabChannelSettings for each source MIDI channel (1..16)
 *   - the MIDI note events for that section, partitioned by channel
 *   - the section's size in beats
 *
 * JJazzLab's full StylePart additionally supports per-complexity-level
 * source-phrase *sets* — a feature only meaningful for the .yjz extended
 * format. Plain Yamaha .sty / .sst / .prs / .bcs files always use a single
 * default complexity level, so we model just that until .yjz is needed.
 */

import { type CtabChannelSettings } from './ctab-channel-settings';
import { type StylePartType } from './style-part-type';

/**
 * A single MIDI note event scoped to one source phrase. Times are absolute
 * ticks from the start of the section (not deltas, not from the whole-track
 * origin). Pitch is the *source* MIDI pitch — transposition happens later in
 * the generator, not here.
 */
export interface SourceNoteEvent {
  /** MIDI channel 0-15 (the channel the note was recorded on in the .sty). */
  channel: number;
  /** MIDI note 0-127. */
  pitch: number;
  /** MIDI velocity 1-127. */
  velocity: number;
  /** Absolute tick within the section. */
  tick: number;
  /** Duration in ticks (0 if note-off pairing unknown). */
  durationTicks: number;
}

/**
 * The set of note events belonging to one MIDI channel inside a section.
 * Equivalent to JJazzLab's SourcePhrase (without the runtime
 * `sourceChordSymbol` field — we look that up from CtabChannelSettings on
 * the fly during generation).
 */
export interface SourcePhrase {
  channel: number;
  notes: SourceNoteEvent[];
}

export interface StylePart {
  type: StylePartType;
  /** Map of MIDI channel (0-15) → its CTAB record. */
  ctabByChannel: Map<number, CtabChannelSettings>;
  /** Map of MIDI channel (0-15) → its source phrase (note events). */
  phraseByChannel: Map<number, SourcePhrase>;
  /** Length of the section in beats (must be a whole number). */
  sizeInBeats: number;
}

/* ─── factory ────────────────────────────────────────────────────────── */

export function createStylePart(type: StylePartType): StylePart {
  return {
    type,
    ctabByChannel: new Map(),
    phraseByChannel: new Map(),
    sizeInBeats: 0,
  };
}

/* ─── helpers ────────────────────────────────────────────────────────── */

export function setCtabFor(sp: StylePart, channel: number, ctab: CtabChannelSettings): void {
  if (channel < 0 || channel > 15) {
    throw new RangeError(`channel ${channel}`);
  }
  sp.ctabByChannel.set(channel, ctab);
}

export function getCtabFor(sp: StylePart, channel: number): CtabChannelSettings | undefined {
  return sp.ctabByChannel.get(channel);
}

export function addNoteEvent(sp: StylePart, ev: SourceNoteEvent): void {
  if (ev.channel < 0 || ev.channel > 15) {
    throw new RangeError(`channel ${ev.channel}`);
  }
  let phrase = sp.phraseByChannel.get(ev.channel);
  if (!phrase) {
    phrase = { channel: ev.channel, notes: [] };
    sp.phraseByChannel.set(ev.channel, phrase);
  }
  phrase.notes.push(ev);
}

export function setSizeInBeats(sp: StylePart, beats: number): void {
  if (beats < 0 || beats % 1 !== 0) {
    throw new RangeError(`sizeInBeats must be a non-negative whole number: ${beats}`);
  }
  sp.sizeInBeats = beats;
}

/** All channels that have either CTAB metadata or note events. */
export function activeChannels(sp: StylePart): number[] {
  const set = new Set<number>([
    ...sp.ctabByChannel.keys(),
    ...sp.phraseByChannel.keys(),
  ]);
  return Array.from(set).sort((a, b) => a - b);
}

/** Total note-on count, summed across all phrases. */
export function totalNoteCount(sp: StylePart): number {
  let n = 0;
  for (const phrase of sp.phraseByChannel.values()) n += phrase.notes.length;
  return n;
}
