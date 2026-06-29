/**
 * Shared swing-feel helpers — used by every melody-playback path in the app so
 * the 8th-note long-short feel is uniform.
 *
 * Mental model: a beat is split into two halves at 0.5. With ratio R, the
 * on-beat 8th occupies [0, R) and the off-beat 8th occupies [R, 1). Quarters
 * and larger durations land on integer beat boundaries and are unaffected.
 */

import { getPlayerSettings } from './playerSettings';
import type { FeelId } from '../backing/types';

/** Legacy compile-time default swing ratio. Kept exported for back-compat
 *  with call sites that have not yet been routed through `getSwingRatio()`.
 *  The new tempo-aware default is 0.708 (classic medium swing) — slightly
 *  wider than the old 0.62 because the new BPM model leans into the triplet
 *  feel at moderate tempos. Code that should not change yet still imports
 *  this constant. */
export const SWING_RATIO = 0.708;

/**
 * Resolve the effective 8th-note swing ratio for a given tempo / feel.
 *
 * Ratios are calibrated from sampled iReal Pro performances:
 *   - Even-8ths / latin / bossa / NOLA → 0.5 (straight)
 *   - Ballads or anything < 80 BPM → 0.667 (strong triplet feel)
 *   - Up-tempo (≥220 BPM) → 0.621 (compressed swing — hard to articulate wider)
 *   - Default medium / medium-up swing → 0.708
 *
 * If `style` is omitted, only the BPM bands apply.
 */
export function getSwingRatio(bpm: number, style?: FeelId): number {
  let r: number;
  if (
    style === 'even-8ths' ||
    style === 'bossa' ||
    style === 'latin' ||
    style === 'samba' ||
    style === 'cha-cha' ||
    style === 'afro-cuban' ||
    style === 'funk' ||
    style === 'new-orleans-swing' ||
    style === 'straight-8' ||
    style === 'straight-16'
  ) {
    r = 0.5;
  } else if (style === 'shuffle-blues') {
    // Hard triplet shuffle — the defining "dotted" lilt, wider than medium.
    r = 0.667;
  } else if (style === 'bebop-swing') {
    // Bebop drives the line: tight, near-even swing so fast 8th runs articulate.
    r = 0.6;
  } else if (style === 'ballad-swing' || bpm < 80) {
    r = 0.667;
  } else if (bpm >= 220 || style === 'up-tempo-swing') {
    r = 0.621;
  } else {
    r = 0.708; // medium-swing / medium-up-swing default
  }
  return r;
}

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
