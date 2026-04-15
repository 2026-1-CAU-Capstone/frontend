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

  // Hi-hat foot chick on beats 2 and 4 (backbeat)
  push(1, "hihat-foot", 0.58);
  push(3, "hihat-foot", 0.58);

  return events;
}
