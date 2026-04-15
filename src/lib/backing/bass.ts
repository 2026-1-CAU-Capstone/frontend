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

export function walkChord(
  current: Chord,
  next: Chord | null,
  beats: number,
): WalkingBassBeat[] {
  if (beats <= 0) return [];

  const rootPc = current.bass ?? current.root;
  const rootMidi = bassNote(rootPc);
  const fifthMidi = bassNote((current.root + 7) % 12);
  const thirdMidi = bassNote((current.root + thirdInterval(current.quality)) % 12);
  const approachMidi = bassNote(approachPc(current, next));

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

/** Place a pitch class in the bass range (E2..E3, MIDI 40..52). */
function bassNote(pc: PitchClass): MidiNote {
  const normalized = ((pc % 12) + 12) % 12;
  let n = 36 + normalized; // C2 = 36 .. B2 = 47
  if (n < 40) n += 12;     // below low E → bump up an octave
  return n;
}

/** Chromatic approach from a half step below the next chord's root. */
function approachPc(current: Chord, next: Chord | null): PitchClass {
  if (!next) return current.bass ?? current.root;
  const targetPc = next.bass ?? next.root;
  return ((targetPc - 1) % 12 + 12) % 12;
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
