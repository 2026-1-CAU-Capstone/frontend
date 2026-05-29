import type { Chord, ChordQuality, MidiNote, PitchClass } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Walking bass generator.
 *
 * Phase 0 rules per chord:
 *   1 beat : root
 *   2 beats: root, approach (chromatic below next root)
 *   3 beats: root, 5th, approach
 *   4 beats: root, 3rd, 5th, approach
 *   N>4    : same as 4 then repeat root on extra beats
 *
 * Approach note = chromatic below next chord's root (a staple of the idiom).
 * Falls back to the current root when no next chord exists (end of chart).
 *
 * Phase 1+:
 *   - Target-note planning over 2/4 bar windows
 *   - Chromatic-from-above and half-step-around approaches
 *   - Bebop scale passing tones
 *   - Walking octaves / "two-feel" alternation
 * ──────────────────────────────────────────────────────────────────────── */

export interface WalkingBassBeat {
  /** 0-indexed beat offset from the start of the chord. */
  beatOffset: number;
  midi: MidiNote;
}

/**
 * Approach-tone distribution measured from 18 iReal Pro MIDI samples.
 * Offsets are semitones relative to the next chord's bass target:
 *   -2: 44%, -1: 26%, +1: 13%, +2: 9%, +5: 4%, -7: 4%
 * Encoded as a 100-bucket roulette so a uniform [0,1) draw picks the
 * weighted offset directly via index lookup.
 */
const APPROACH_OFFSETS: number[] = (() => {
  const buckets: number[] = [];
  const weighted: Array<[number, number]> = [
    [-2, 44],
    [-1, 26],
    [+1, 13],
    [+2, 9],
    [+5, 4],
    [-7, 4],
  ];
  for (const [offset, weight] of weighted) {
    for (let i = 0; i < weight; i++) buckets.push(offset);
  }
  return buckets;
})();

/** Deterministic [0,1) PRNG (mulberry32) — repeatable per (bar, chord)
 *  pair so the same chart renders the same approach every time. */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function walkChord(
  current: Chord,
  next: Chord | null,
  beats: number,
  /** Deterministic seed (e.g. hash of bar index + chord index). When omitted,
   *  falls back to seed 0 which still produces a single repeatable choice. */
  seed: number = 0,
): WalkingBassBeat[] {
  if (beats <= 0) return [];

  const rootPc = current.bass ?? current.root;
  const rootMidi = bassNote(rootPc);
  const fifthMidi = bassNote((current.root + 7) % 12);
  const thirdMidi = bassNote((current.root + thirdInterval(current.quality)) % 12);
  const approachMidi = bassNote(approachPc(current, next, mulberry32(seed)));

  if (beats === 1) {
    return [{ beatOffset: 0, midi: rootMidi }];
  }
  if (beats === 2) {
    return [
      { beatOffset: 0, midi: rootMidi },
      { beatOffset: 1, midi: approachMidi },
    ];
  }
  if (beats === 3) {
    return [
      { beatOffset: 0, midi: rootMidi },
      { beatOffset: 1, midi: fifthMidi },
      { beatOffset: 2, midi: approachMidi },
    ];
  }

  // 4 beats: full walking pattern
  const out: WalkingBassBeat[] = [
    { beatOffset: 0, midi: rootMidi },
    { beatOffset: 1, midi: thirdMidi },
    { beatOffset: 2, midi: fifthMidi },
    { beatOffset: 3, midi: approachMidi },
  ];
  // Extra beats beyond 4: repeat root (rare — happens on held chords)
  for (let b = 4; b < beats; b++) {
    out.push({ beatOffset: b, midi: rootMidi });
  }
  return out;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

/** Place a pitch class in the bass range (E2..E3, MIDI 40..52), then clamp
 *  defensively to keep us above E1 (28) and below C4 (60). */
function bassNote(pc: PitchClass): MidiNote {
  const normalized = ((pc % 12) + 12) % 12;
  let n = 36 + normalized; // C2 = 36 .. B2 = 47
  if (n < 40) n += 12;     // below low E → bump up an octave
  return clampBass(n);
}

/**
 * Bass register clamp — E1 (MIDI 28) floor, C4 (MIDI 60) defensive ceiling.
 * Octave-shifts notes into the playable range without changing pitch class.
 */
export function clampBass(n: number): number {
  while (n < 28) n += 12;
  while (n > 60) n -= 12;
  return n;
}

/**
 * Weighted-random approach tone — replaces the prior "always -1 semitone"
 * rule with the empirical distribution measured from iReal Pro samples.
 *
 * `rand` must be a deterministic [0,1) draw so playback is repeatable.
 */
function approachPc(current: Chord, next: Chord | null, rand: number): PitchClass {
  if (!next) return current.bass ?? current.root;
  const targetPc = next.bass ?? next.root;
  const offset = APPROACH_OFFSETS[Math.floor(rand * APPROACH_OFFSETS.length) % APPROACH_OFFSETS.length];
  return (((targetPc + offset) % 12) + 12) % 12;
}

const THIRD_BY_QUALITY: Record<ChordQuality, number> = {
  maj: 4, maj6: 4, maj7: 4, maj9: 4,
  min: 3, min6: 3, min7: 3, min9: 3, min11: 3, minmaj7: 3,
  dom7: 4, dom9: 4, dom13: 4,
  "7sus4": 5, "7alt": 4, "7#9": 4, "7b9": 4, "7#11": 4, "7b13": 4,
  min7b5: 3, dim: 3, dim7: 3,
  aug: 4, aug7: 4,
  sus2: 2, sus4: 5,
  "5": 7,
};

function thirdInterval(q: ChordQuality): number {
  return THIRD_BY_QUALITY[q] ?? 4;
}
