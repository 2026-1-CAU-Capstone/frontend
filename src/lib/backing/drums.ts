import type { DrumEvent, DrumPiece, FeelId } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Drum pattern generators.
 *
 * Phase 0: classic medium-swing "spang-a-lang" ride pattern.
 *   ride on beats 1,2,3,4 (quarters)
 *   ride swung 8th "a" between beats 2&3 and 4&1 (triplet 3rd of beats 2 and 4)
 *   hi-hat foot chick on beats 2 and 4 (backbeat)
 *
 * Phase 1:  latin family (bossa, samba, afro-cuban 6/8, songo)
 * Phase 1.5: feel modifiers (half-time / double-time / straight-8)
 * Phase 2:   figure rendering (bar-scoped band hits)
 * ──────────────────────────────────────────────────────────────────────── */

export interface DrumBarOptions {
  /** Seconds per beat (60 / bpm). */
  secPerBeat: number;
  /** Absolute bar start time in seconds. */
  barStart: number;
  /** Beats per bar (time signature numerator). */
  beatsInBar: number;
  /** Feel override (defaults to the parent style's swing feel). */
  feel?: FeelId;
  /** Flat bar index across the chart, for event tagging. */
  barIndex: number;
}

/** Swung 8th lands at 2/3 through the beat (triplet 3rd). */
const SWING_OFFSET = 2 / 3;

export function swingBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;

  // Phase 0 only supports 4/4. Other meters get silence until their pattern exists.
  if (beatsInBar !== 4) return [];

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beat * secPerBeat,
      velocity,
      bar: barIndex,
    });
  };

  // Ride: quarter notes on every beat, alternating slightly louder on 1 & 3
  push(0, "ride", 0.72);
  push(1, "ride", 0.62);
  push(2, "ride", 0.70);
  push(3, "ride", 0.62);

  // Ride swung 8ths — the "a" of 2 and 4 (at +2/3 of those beats)
  push(1 + SWING_OFFSET, "ride", 0.48);
  push(3 + SWING_OFFSET, "ride", 0.48);

  // Hi-hat foot chick on beats 2 and 4 (backbeat) — pushed louder so it
  // cuts through the ride pattern and is clearly audible
  push(1, "hihat-foot", 0.95);
  push(3, "hihat-foot", 0.95);

  // Feathered kick drum on every beat — classic bebop "four on the floor"
  // playing very softly so it's felt more than heard against the ride
  push(0, "kick", 0.45);
  push(1, "kick", 0.38);
  push(2, "kick", 0.45);
  push(3, "kick", 0.38);

  // Snare comping — jazz drummers drop snare accents on various "and" beats
  // to converse with the band. Velocities are pushed high so the snare
  // cuts through ride + piano after the drums-volume scaling is applied.
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    push(offset, "snare", vel);
  }

  // Stronger accent at section boundaries (every 8 bars)
  if (barIndex % 8 === 7) {
    push(3 + SWING_OFFSET, "snare", 0.95);
  }

  return events;
}

/**
 * Rotating snare comping patterns (offset in beats → velocity).
 * Velocities are intentionally strong (0.7-0.85) so they sit clearly in
 * the mix after the drums volume multiplier (~0.9) is applied.
 */
const SNARE_PATTERNS: Array<Array<[number, number]>> = [
  [[2.0 + SWING_OFFSET, 0.72]],                              // "and of 3"
  [[3.0 + SWING_OFFSET, 0.78]],                              // "and of 4"
  [[0.0 + SWING_OFFSET, 0.68], [2.0 + SWING_OFFSET, 0.75]], // "and of 1" + "and of 3"
  [[1.0 + SWING_OFFSET, 0.74]],                              // "and of 2"
  [[3.0, 0.72]],                                             // downbeat of 4
  [[1.0 + SWING_OFFSET, 0.7], [3.0 + SWING_OFFSET, 0.82]],  // "and of 2" + "and of 4"
];

/**
 * Bossa Nova drum pattern.
 *
 * Closed hi-hat on every 8th note (straight, NOT swung) — the relentless
 * "tick-tick-tick" that gives bossa its forward motion. Kick plays the
 * surdo-style pattern (1, "and of 2", 3, "and of 4"), and the rim cross-
 * stick plays a two-bar clave/comp pattern.
 */
export function bossaBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beat * secPerBeat,
      velocity,
      bar: barIndex,
    });
  };

  // Closed hi-hat on every straight 8th
  for (let i = 0; i < 8; i++) {
    const beat = i * 0.5;
    const onDownbeat = i % 2 === 0;
    push(beat, "hihat-closed", onDownbeat ? 0.58 : 0.42);
  }

  // Kick: surdo-style — 1, "and of 2", 3, "and of 4"
  push(0,   "kick", 0.78);
  push(1.5, "kick", 0.62);
  push(2,   "kick", 0.78);
  push(3.5, "kick", 0.62);

  // Rim cross-stick — two-bar clave-like comping. Bars alternate.
  const evenBar = barIndex % 2 === 0;
  if (evenBar) {
    // Bar A: 1, "and of 2", "and of 3"
    push(0,   "rim", 0.7);
    push(1.5, "rim", 0.72);
    push(2.5, "rim", 0.72);
  } else {
    // Bar B: 1, 2, "and of 3", 4
    push(0,   "rim", 0.7);
    push(1,   "rim", 0.68);
    push(2.5, "rim", 0.72);
    push(3,   "rim", 0.68);
  }

  return events;
}
