import type { Chord, ChordQuality, MidiNote } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Piano comping voicings.
 *
 * Phase 0: shell voicings — two or three notes per chord (3rd + 7th, + optional
 * color tone). Placed in the C3-C5 range without voice leading logic.
 *
 * Phase 1+:
 *   - Drop-2 voicings
 *   - Rootless A/B voicings (Bill Evans style)
 *   - Voice leading across changes (prefer common tones)
 *   - Upper-structure triads for altered dominants
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Shell intervals from the chord root (semitones).
 * For Phase 0 we emit just enough notes to identify the chord quality
 * (3rd + 7th when available, 3rd + 5th otherwise).
 */
const SHELL: Record<ChordQuality, number[]> = {
  // Major family
  maj:  [4, 7],
  maj6: [4, 9],
  maj7: [4, 11],
  maj9: [4, 11, 14],

  // Minor family
  min:     [3, 7],
  min6:    [3, 9],
  min7:    [3, 10],
  min9:    [3, 10, 14],
  min11:   [3, 10, 14],
  minmaj7: [3, 11],

  // Dominant family
  dom7:  [4, 10],
  dom9:  [4, 10, 14],
  dom13: [4, 10, 14, 21],
  "7sus4": [5, 10],
  "7alt":  [4, 10, 15],   // 3rd, b7, #9
  "7#9":   [4, 10, 15],
  "7b9":   [4, 10, 13],
  "7#11":  [4, 10, 18],
  "7b13":  [4, 10, 20],

  // Half-dim / dim
  min7b5: [3, 10],
  dim:    [3, 6],
  dim7:   [3, 9],

  // Aug
  aug:  [4, 8],
  aug7: [4, 10],

  // Sus
  sus2: [2, 7],
  sus4: [5, 7],

  // Power (rarely seen in jazz but included for completeness)
  "5": [7],
};

/**
 * Voice a chord in the C3-C5 register.
 * Returns an array of MIDI note numbers; empty array if the chord is unknown.
 */
export function voiceChord(chord: Chord): MidiNote[] {
  const intervals = SHELL[chord.quality] ?? [4, 7];
  const base = 48 + (((chord.root % 12) + 12) % 12); // C3 + root pitch class
  const notes = intervals.map((iv) => base + iv);
  // Keep everything within C3..C5 (48..72) for a consistent register.
  return notes.map((n) => {
    let out = n;
    while (out > 72) out -= 12;
    while (out < 48) out += 12;
    return out;
  });
}
