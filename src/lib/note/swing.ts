/**
 * Shared swing-feel helpers — used by every melody-playback path in the app so
 * the 8th-note long-short feel is uniform.
 *
 * Mental model: a beat is split into two halves at 0.5. With ratio R, the
 * on-beat 8th occupies [0, R) and the off-beat 8th occupies [R, 1). Quarters
 * and larger durations land on integer beat boundaries and are unaffected.
 */

import { getPlayerSettings } from './playerSettings';

/** Compile-time default swing ratio. Live value is read from playerSettings
 *  by `swungBeats()` so the user's mixer choice (incl. straight 0.5) applies
 *  uniformly across every playback path. */
export const SWING_RATIO = 0.62;

/** Map a straight beat position to its swung version. Reads the current ratio
 *  from playerSettings unless `ratio` is supplied (tests / pinned contexts).
 *
 *  Straight 8ths land at 0, 0.5, 1.0, 1.5, ...
 *  Swung 8ths (ratio = 0.62) land at 0, 0.62, 1.0, 1.62, ...
 *
 *  Pass `ratio = 0.5` for straight (no-swing) projection. */
export function swungBeats(beats: number, ratio?: number): number {
  const r = ratio ?? getPlayerSettings().swingRatio;
  if (r === 0.5) return beats;
  const whole = Math.floor(beats);
  const frac = beats - whole;
  if (frac < 0.5) return whole + frac * (r / 0.5);
  return whole + r + (frac - 0.5) * ((1 - r) / 0.5);
}
