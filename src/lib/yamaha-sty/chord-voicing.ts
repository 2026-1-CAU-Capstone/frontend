/**
 * chord-voicing: chord-shaped voicing utilities for fitChordPhrase.
 * Port of Chord.java methods + Utilities.heapPermutation + the
 * computeChordMatchingScore function from PhraseUtilities (LGPL v2.1).
 *
 * "Chord" here is a *sorted ascending list of absolute MIDI pitches*. The
 * source/destination Chord both represent the unique pitches in the source
 * phrase mapped to the destination chord's voicing.
 */

import type { ChordType } from '../jazz-harmony';

export type ChordPitches = number[];

/* ─── heapPermutation ────────────────────────────────────────────────── */

/**
 * Generate all permutations of `arr` (size <= 9). Returns a fresh list of
 * arrays. Caller must not mutate `arr` during iteration.
 *
 * Port of Utilities.heapPermutation. Throws if size > 9 (factorial blowup).
 */
export function heapPermutation<T>(arr: T[]): T[][] {
  if (arr.length > 9) throw new RangeError(`array.length=${arr.length} > 9`);
  const result: T[][] = [];
  const a = arr.slice();
  function recurse(n: number): void {
    if (n === 1) {
      result.push(a.slice());
      return;
    }
    recurse(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const j = (n % 2 === 1) ? 0 : i;
      const tmp = a[j]; a[j] = a[n - 1]; a[n - 1] = tmp;
      recurse(n - 1);
    }
  }
  recurse(a.length);
  return result;
}

/* ─── note-pitch helpers ─────────────────────────────────────────────── */

/** Return the lowest pitch ≥ `pitch` (resp. <=) whose pitch-class is targetRelPitch. */
export function upperPitch(pitch: number, targetRelPitch: number, inclusive = true): number {
  for (let p = pitch; p <= 127; p++) {
    if (((p % 12) + 12) % 12 === targetRelPitch) {
      if (p === pitch && !inclusive) continue;
      return p;
    }
  }
  return pitch; // shouldn't happen
}
export function lowerPitch(pitch: number, targetRelPitch: number, inclusive = true): number {
  for (let p = pitch; p >= 0; p--) {
    if (((p % 12) + 12) % 12 === targetRelPitch) {
      if (p === pitch && !inclusive) continue;
      return p;
    }
  }
  return pitch;
}

/* ─── Chord helpers ──────────────────────────────────────────────────── */

/** Build a "Chord" (sorted unique pitch list) from any pitch list. */
export function chordFromPitches(pitches: number[]): ChordPitches {
  const set = new Set(pitches);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Sum of |a[i] - b[i]| across the two chords. Both must be same size.
 * (Chord.computeDistance)
 */
export function chordDistance(a: ChordPitches, b: ChordPitches): number {
  if (a.length !== b.length) throw new Error(`size mismatch: ${a.length} vs ${b.length}`);
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

/**
 * Build a "parallel" destination chord whose note count + voice spacing
 * roughly mirror `srcChord`, but whose pitch classes follow `destRelPitches`.
 *
 * Port of Chord.computeParallelChord:
 *   - Map each unique pitch-class of srcChord to one destRelPitch.
 *   - Find the first dest pitch either >= or <= srcChord's first note
 *     depending on `startBelow`.
 *   - For each subsequent unique pitch in srcChord, walk up by the same
 *     "skip octaves" interval; if a pitch-class repeats, reuse its
 *     previously-assigned dest pitch class.
 *
 * `destRelPitches` must have exactly as many entries as srcChord has
 * unique pitch-classes.
 */
export function computeParallelChord(
  srcChord: ChordPitches,
  destRelPitches: number[],
  startBelow: boolean,
): ChordPitches {
  if (srcChord.length === 0) return [];

  // Unique src pitch-classes preserving order of first appearance
  const seen = new Set<number>();
  const uniquePcOrder: number[] = [];
  const pcToFirstIndex = new Map<number, number>();
  for (let i = 0; i < srcChord.length; i++) {
    const pc = ((srcChord[i] % 12) + 12) % 12;
    if (!seen.has(pc)) {
      seen.add(pc);
      uniquePcOrder.push(pc);
      pcToFirstIndex.set(pc, i);
    }
  }
  if (destRelPitches.length !== uniquePcOrder.length) {
    throw new Error(`destRelPitches size ${destRelPitches.length} != unique src pcs ${uniquePcOrder.length}`);
  }

  // Map src pitch class → destination pitch class
  const pcMap = new Map<number, number>();
  for (let i = 0; i < uniquePcOrder.length; i++) {
    pcMap.set(uniquePcOrder[i], destRelPitches[i]);
  }

  const result: ChordPitches = [];
  const firstSrc = srcChord[0];
  const firstDestRel = pcMap.get(((firstSrc % 12) + 12) % 12)!;
  const firstDest = startBelow ? lowerPitch(firstSrc, firstDestRel) : upperPitch(firstSrc, firstDestRel);
  result.push(firstDest);

  for (let i = 1; i < srcChord.length; i++) {
    const srcPc = ((srcChord[i] % 12) + 12) % 12;
    const targetPc = pcMap.get(srcPc)!;
    // skip octaves = floor((srcChord[i] - srcChord[i-1]) / 12)
    const skipOctaves = Math.max(0, Math.floor((srcChord[i] - srcChord[i - 1]) / 12));
    let next = upperPitch(result[result.length - 1], targetPc, false);
    for (let j = 0; j < skipOctaves; j++) next = upperPitch(next, targetPc, false);
    if (next > 127) next = 127;
    result.push(next);
  }
  return result;
}

/* ─── matching score ─────────────────────────────────────────────────── */

/**
 * Score how well `dest` voices `src` for the destination chord type.
 *
 * Lower is better. Port of PhraseUtilities.computeChordMatchingScore:
 *   - base = chordDistance(src, dest)
 *   - + 3 * |topPitch diff| + |bottomPitch diff|  (top-weighted voice leading)
 *   - penalties:
 *       13-chord but voicing < octave wide (encourages quartal voicing)
 *       top two notes a semitone apart (avoid top dissonance)
 *       9♭ interval (avoid harsh extension)
 *       interval ≥6th between first 2 notes && first note isn't the root
 *
 * If src.size != dest.size returns 10000 (incompatible).
 */
export function chordMatchingScore(
  src: ChordPitches,
  dest: ChordPitches,
  destChordType: ChordType,
  destRootRelPitch: number,
): number {
  if (src.length !== dest.length) return 10000;
  let score = chordDistance(src, dest);

  const srcMax = src[src.length - 1];
  const srcMin = src[0];
  const destMax = dest[dest.length - 1];
  const destMin = dest[0];
  score += 3 * Math.abs(srcMax - destMax);
  score += Math.abs(srcMin - destMin);

  const size = dest.length;
  if (size > 2) {
    if (destChordType.extension.includes('13')) {
      if (destMax - destMin < 11) score += 4 * size;
    }
    if (dest[size - 2] === destMax - 1) score += 3 * size;
    if (destMax - destMin === 13) score += 4 * size;
    const minPc = ((destMin % 12) + 12) % 12;
    if (dest[1] - destMin >= 9 && minPc !== destRootRelPitch) score += 2 * size;
  }
  return score;
}

/**
 * Apply the destination chord type's relative pitches to a set of degrees.
 * Used by computeParallelChord callers.
 */
export function relativePitchesForDegrees(
  destRootRelPitch: number,
  degrees: { pitch: number }[],
): number[] {
  return degrees.map((d) => ((destRootRelPitch + d.pitch) % 12 + 12) % 12);
}
