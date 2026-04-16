import type { Chord, ChordQuality, MidiNote } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Piano comping voicings.
 *
 * Upgraded from Phase 0 shells:
 *   - Richer interval sets (9ths / 13ths / alterations on dominants)
 *   - Multiple candidates per quality for voice-leading selection
 *   - voiceChord() picks the candidate closest to the previous voicing to
 *     minimize total motion, biasing toward common tones and stepwise moves
 *
 * All voicings live in a fixed target register and are built by placing
 * the root's pitch class against a base octave then folding any note that
 * escapes the register back in via octave transposition.
 * ──────────────────────────────────────────────────────────────────────── */

type Intervals = number[];

const BASE_OCTAVE_MIDI = 48; // C3
const REGISTER_LOW = 54;     // F#3
const REGISTER_HIGH = 73;    // C#5

/**
 * Candidate interval sets per quality. Ordered roughly by richness — the
 * voice-leading selector picks whichever is closest to the previous
 * voicing so the ordering is only a stylistic nudge when no history.
 */
const VOICING_LIBRARY: Record<ChordQuality, Intervals[]> = {
  // Major family
  maj:  [[4, 11, 14], [4, 7, 11], [0, 4, 7, 11]],
  maj6: [[4, 9, 14], [4, 7, 9], [0, 4, 9, 14]],
  maj7: [[4, 11, 14], [4, 7, 11], [11, 14, 16], [4, 11, 16]],
  maj9: [[4, 11, 14, 16], [4, 11, 14], [11, 14, 16]],

  // Minor family
  min:     [[3, 10, 14], [3, 7, 10], [3, 10, 17]],
  min6:    [[3, 9, 14], [3, 7, 9], [3, 9, 17]],
  min7:    [[3, 10, 14], [3, 7, 10], [10, 14, 17], [3, 10, 17]],
  min9:    [[3, 10, 14, 17], [3, 10, 14]],
  min11:   [[3, 10, 14, 17], [3, 10, 17]],
  minmaj7: [[3, 11, 14], [3, 7, 11]],

  // Dominant family
  dom7:    [[4, 10, 14], [4, 10], [10, 14, 16], [4, 10, 16], [4, 10, 13], [4, 10, 15]],
  dom9:    [[4, 10, 14, 16], [4, 10, 14]],
  dom13:   [[4, 10, 14, 21], [4, 10, 21], [10, 14, 21]],
  "7sus4": [[5, 10, 14], [5, 10], [10, 14, 17]],
  "7alt":  [[4, 10, 13], [4, 10, 15], [3, 10, 13, 15]], // b9/#9 colors
  "7#9":   [[4, 10, 15], [4, 10, 15, 17]],
  "7b9":   [[4, 10, 13], [4, 10, 13, 16]],
  "7#11":  [[4, 10, 18], [4, 10, 14, 18]],
  "7b13":  [[4, 10, 20], [4, 10, 14, 20]],

  // Half-dim / dim
  min7b5: [[3, 10, 14], [3, 6, 10], [6, 10, 14]],
  dim:    [[3, 6, 9], [3, 6, 12]],
  dim7:   [[3, 9, 14], [3, 6, 9]],

  // Aug
  aug:  [[4, 8, 12], [4, 8]],
  aug7: [[4, 10, 14], [4, 8, 10]],

  // Sus
  sus2: [[2, 7, 14], [2, 7]],
  sus4: [[5, 7, 14], [5, 7]],

  // Power
  "5": [[7, 12]],
};

/**
 * Place a set of intervals against a root pitch class, folding notes into
 * the comping register by octave transposition.
 */
function buildCandidate(rootPc: number, intervals: Intervals): MidiNote[] {
  const pc = ((rootPc % 12) + 12) % 12;
  const base = BASE_OCTAVE_MIDI + pc; // C3 + root → root in octave 3
  const notes: MidiNote[] = [];
  for (const iv of intervals) {
    let n = base + iv;
    while (n > REGISTER_HIGH) n -= 12;
    while (n < REGISTER_LOW) n += 12;
    notes.push(n);
  }
  // Remove duplicates (some registrations collapse into the same pitch)
  return Array.from(new Set(notes)).sort((a, b) => a - b);
}

/** Total pitch-space distance between two note sets (sum of min-distance pairs). */
function motionCost(prev: MidiNote[], next: MidiNote[]): number {
  if (prev.length === 0) return 0;
  let cost = 0;
  for (const n of next) {
    let best = Infinity;
    for (const p of prev) {
      const d = Math.abs(n - p);
      if (d < best) best = d;
    }
    cost += best;
  }
  return cost;
}

/**
 * Voice a chord, optionally minimizing motion from the previous voicing.
 * When no previous voicing is given, picks the first (richest) candidate.
 */
export function voiceChord(chord: Chord, previous?: MidiNote[]): MidiNote[] {
  const lib = VOICING_LIBRARY[chord.quality] ?? VOICING_LIBRARY.maj;
  if (lib.length === 0) return [];

  const candidates = lib.map((iv) => buildCandidate(chord.root, iv));
  if (!previous || previous.length === 0) return candidates[0];

  let bestIdx = 0;
  let bestCost = motionCost(previous, candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    const c = motionCost(previous, candidates[i]);
    if (c < bestCost) {
      bestCost = c;
      bestIdx = i;
    }
  }
  return candidates[bestIdx];
}

/**
 * Drop the second-highest note down an octave (classic drop-2 voicing).
 * Returns a new array; input is not mutated.
 */
export function dropTwo(voicing: MidiNote[]): MidiNote[] {
  if (voicing.length < 2) return voicing.slice();
  const sorted = [...voicing].sort((a, b) => b - a); // descending
  sorted[1] -= 12;
  return sorted.sort((a, b) => a - b);
}
