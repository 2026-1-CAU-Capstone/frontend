import type { TimedNote } from './notesToNoteSheet';

/* ─────────────────────────────────────────────────────────────────────────
 * Minimal Type-0 MIDI writer for the AMT bass transcription. Self-contained
 * (no Buffer / midi-writer dependency) so it works in the browser bundle.
 * One track: tempo + GM Acoustic Bass program, then note on/off events.
 * ──────────────────────────────────────────────────────────────────────── */

const TPQ = 480;              // ticks per quarter note
const GM_ACOUSTIC_BASS = 32;  // 0-indexed GM program
const VELOCITY = 90;

function varLen(value: number): number[] {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return bytes;
}

function str(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function notesToMidi(notes: TimedNote[], bpm: number): Uint8Array {
  const ticksPerSec = (bpm / 60) * TPQ;

  // Flatten to absolute-tick on/off events, then sort.
  type Ev = { tick: number; on: boolean; midi: number };
  const evs: Ev[] = [];
  for (const n of notes) {
    const start = Math.round(n.startTimeSeconds * ticksPerSec);
    const end = Math.max(start + 1, Math.round((n.startTimeSeconds + n.durationSeconds) * ticksPerSec));
    const midi = Math.max(0, Math.min(127, Math.round(n.pitchMidi)));
    evs.push({ tick: start, on: true, midi });
    evs.push({ tick: end, on: false, midi });
  }
  // Note-offs before note-ons at the same tick to avoid clipped retriggers.
  evs.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));

  const track: number[] = [];
  // Tempo meta (microseconds per quarter).
  const uspq = Math.round(60_000_000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff);
  // Program change (channel 0).
  track.push(0x00, 0xc0, GM_ACOUSTIC_BASS);

  let prevTick = 0;
  for (const ev of evs) {
    const delta = Math.max(0, ev.tick - prevTick);
    prevTick = ev.tick;
    track.push(...varLen(delta));
    track.push(ev.on ? 0x90 : 0x80, ev.midi, ev.on ? VELOCITY : 0x00);
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const header = [...str('MThd'), ...u32(6), 0x00, 0x00, 0x00, 0x01, (TPQ >> 8) & 0xff, TPQ & 0xff];
  const trackChunk = [...str('MTrk'), ...u32(track.length), ...track];
  return new Uint8Array([...header, ...trackChunk]);
}
