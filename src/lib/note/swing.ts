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
 *  Swing is an **8th-note-grid** feel: each straight 8th slot boundary
 *  (0, 0.5, 1.0, 1.5, …) maps to the swung grid (0, R, 1, 1+R, …). Positions
 *  *inside* a slot (16th notes, triplet-16ths, any finer subdivision) keep
 *  their EVEN spacing within that slot — they are linearly interpolated
 *  between the slot's swung endpoints, not re-folded.
 *
 *    Straight 8ths → 0, 0.5, 1.0, 1.5, …
 *    Swung 8ths (R=0.62) → 0, 0.62, 1.0, 1.62, …
 *    16ths in beat 0 (0, .25, .5, .75) → 0, 0.31, 0.62, 0.81  (even inside
 *      each swung half — NOT the old 0, .354, .708, .854 that squashed the
 *      2nd half of the beat and made fast 16th runs sound smeared/rushed).
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

const EIGHTH_EPS = 1e-6;
/** True when a beat position sits exactly on the 8th-note grid (…0, 0.5, 1…). */
function onEighthGrid(beat: number): boolean {
  const x = beat * 2;
  return Math.abs(x - Math.round(x)) < EIGHTH_EPS;
}

/**
 * Apply jazz swing to a melody the way a HUMAN does: the long-short lilt lives
 * on the **8th-note pulse**, while faster subdivisions (16th runs, etc.) are
 * played EVEN (straight). A stateless position→position map can't do this —
 * it would either stretch/squash the 16ths (old behaviour, "smeared") or cram
 * the last 16th of each beat against the downbeat. So swing is decided
 * per-note, with knowledge of each note's duration:
 *
 *   swing a note's onset  ⇔  it starts on the 8th grid AND is an 8th-or-longer.
 *
 * 16th-or-shorter notes, and notes starting off the 8th grid (syncopated 16th
 * placements), keep their straight onset. Result: 8th lines swing fully; fast
 * 16th runs stay even; mixed figures do the musically-correct thing (the 8th
 * component swings, the 16ths inside a beat stay even).
 *
 * Returns new notes with swung `beatOffset`; `durationBeats` is re-derived from
 * the gap to the next onset so nothing overlaps or inverts (monotonic).
 * Requires `notes` sorted by beatOffset (extractMelody already is).
 */
export function swingMelody<T extends { beatOffset: number; durationBeats: number }>(
  notes: T[],
  ratio: number,
): T[] {
  if (ratio === 0.5 || notes.length === 0) return notes;
  const EIGHTH = 0.5 - 1e-6; // an 8th note is 0.5 beat; guard float drift
  const swings = notes.map((n) => onEighthGrid(n.beatOffset) && n.durationBeats >= EIGHTH);
  const swungOnset = notes.map((n, i) =>
    swings[i] ? swungBeats(n.beatOffset, ratio) : n.beatOffset,
  );
  // Self length after swing: swung notes stretch/compress their own span (the
  // on-beat 8th becomes the "long", the off-beat 8th the "short"); straight
  // notes keep their length. Mapping the END the same way preserves the
  // long-short articulation the old per-endpoint code got right.
  const swungEnd = notes.map((n, i) => {
    const end = n.beatOffset + n.durationBeats;
    return swings[i] ? swungBeats(end, ratio) : end;
  });
  return notes.map((n, i) => {
    const onset = swungOnset[i];
    const selfLen = swungEnd[i] - onset;
    // Cap at the gap to the next onset so nothing overlaps/inverts, but never
    // extend across a rest (self length is shorter there). Floor keeps a fast
    // note audible instead of collapsing to a click.
    const gap = i + 1 < notes.length ? swungOnset[i + 1] - onset : selfLen;
    const dur = Math.max(0.05, Math.min(selfLen, gap));
    return { ...n, beatOffset: onset, durationBeats: dur };
  });
}
