/**
 * fit-phrase: port of JJazzLab's PhraseUtilities transposition functions
 * (LGPL v2.1), the actual transposition math that adapts a source phrase
 * (recorded against a fixed chord like CMaj7) to a destination chord.
 *
 * This module owns the "general path" for the three modes — fast paths
 * (identical chord types) are an optimisation we'll add when needed.
 *
 *   fitMelodyPhraseToChord  — melody-oriented, per-note degree fit
 *   fitBassPhraseToChord    — same as melody, plus slash-chord / pedal-bass
 *                              handling
 *   fitChordPhraseToChord   — chord-oriented voicing optimisation (deferred)
 *
 * All three return a new array of SourceNoteEvents; the input phrase is
 * not mutated. Velocities, ticks and durations carry over unchanged.
 */

import type { ChordType, Degree } from '../jazz-harmony';
import { sourceUsedDegrees, destDegreesMelody } from './source-phrase-ops';
import type { SourceNoteEvent, SourcePhrase } from './style-part';
import {
  heapPermutation, chordFromPitches, computeParallelChord,
  chordMatchingScore,
} from './chord-voicing';

/**
 * Octave-snap a target pitch class to the octave closest to `currentPitch`.
 *
 * Mirrors Note.getClosestPitch in JJazzLab — the voice-leading helper that
 * keeps notes from jumping octaves when a chord changes (e.g. don't move
 * C5 → E2 just because the destination chord has an E; pick E4 or E5).
 *
 * @param currentPitch any MIDI pitch (0-127)
 * @param targetRelPitch the desired pitch class (0-11)
 * @returns the absolute MIDI pitch in `targetRelPitch`'s pitch-class that's
 *   closest to `currentPitch`. Ties break towards the upper octave (matches
 *   Java's `>` boundary).
 */
export function getClosestPitch(currentPitch: number, targetRelPitch: number): number {
  if (targetRelPitch < 0 || targetRelPitch > 11) {
    throw new RangeError(`targetRelPitch ${targetRelPitch}`);
  }
  const octave = Math.floor(currentPitch / 12);
  let lower = octave * 12 + targetRelPitch;
  if (lower > currentPitch) lower -= 12;
  const upper = lower + 12;
  // Java: if (up - p > p - low) return low; else return up
  return (upper - currentPitch > currentPitch - lower) ? lower : upper;
}

/**
 * Adapt a melody-oriented source phrase to a destination chord.
 *
 * Algorithm (general path, ROOT_TRANSPOSITION + MELODY NTT):
 *   1. rootPitchDelta = (destRoot - srcRoot) mod 12  (parallel transpose)
 *   2. Build the source → destination degree map via destDegreesMelody.
 *   3. For each source note:
 *      a. Compute its source-chord degree (most-probable rel-pitch lookup).
 *      b. Look up the destination degree from the map.
 *      c. destRelPitch = (destRoot + destDegree.pitch) mod 12
 *      d. destPitch = octave-snap (sourcePitch + delta, destRelPitch)
 *      e. Emit a new note with the same channel/velocity/tick/duration.
 *
 * The destination chord's `chordRootUpperLimit` (from CtabChannelSettings)
 * is NOT applied here — apply it in a higher-level transformer.
 *
 * @returns a fresh array of SourceNoteEvents (same length as input phrase)
 */
export function fitMelodyPhraseToChord(
  phrase: SourcePhrase,
  sourceChordRootRelPitch: number,
  sourceChordType: ChordType,
  destChordRootRelPitch: number,
  destChordType: ChordType,
): SourceNoteEvent[] {
  if (phrase.notes.length === 0) return [];

  const rootDelta = mod12(destChordRootRelPitch - sourceChordRootRelPitch);
  const srcDegrees = sourceUsedDegrees(phrase, sourceChordRootRelPitch, sourceChordType);
  const map = destDegreesMelody(srcDegrees, destChordType);

  const out: SourceNoteEvent[] = [];
  for (const ev of phrase.notes) {
    const srcRelToRoot = mod12(ev.pitch - sourceChordRootRelPitch);
    const srcDegree = sourceChordType.getDegreeMostProbable(srcRelToRoot);
    const destDegree = map.get(srcDegree) ?? srcDegree;
    const destRelPitch = mod12(destChordRootRelPitch + destDegree.pitch);
    const destPitch = getClosestPitch(ev.pitch + rootDelta, destRelPitch);
    out.push({
      channel: ev.channel,
      pitch: destPitch,
      velocity: ev.velocity,
      tick: ev.tick,
      durationTicks: ev.durationTicks,
    });
  }
  return out;
}

/**
 * Adapt a bass-oriented source phrase to a destination chord.
 *
 * Same body as fitMelodyPhrase, plus:
 *   - if PEDAL_BASS or the dest degree is ROOT, replace destRelPitch with
 *     the destination chord's bass note (which differs from root for slash
 *     chords like F/C).
 *
 * For now we accept `destBassRelPitch` as a parameter — the caller knows
 * it. If not slash, pass the same value as destChordRootRelPitch.
 *
 * @param destBassRelPitch usually = destChordRootRelPitch; for slash chords
 *   ("F/C") it's the bass-note pitch class (0-11)
 * @param pedalBass if true, ALL notes route through the bass pitch class
 */
export function fitBassPhraseToChord(
  phrase: SourcePhrase,
  sourceChordRootRelPitch: number,
  sourceChordType: ChordType,
  destChordRootRelPitch: number,
  destChordType: ChordType,
  destBassRelPitch: number = destChordRootRelPitch,
  pedalBass: boolean = false,
): SourceNoteEvent[] {
  if (phrase.notes.length === 0) return [];

  const rootDelta = mod12(destChordRootRelPitch - sourceChordRootRelPitch);
  const srcDegrees = sourceUsedDegrees(phrase, sourceChordRootRelPitch, sourceChordType);
  const map = destDegreesMelody(srcDegrees, destChordType);

  const out: SourceNoteEvent[] = [];
  for (const ev of phrase.notes) {
    const srcRelToRoot = mod12(ev.pitch - sourceChordRootRelPitch);
    const srcDegree = sourceChordType.getDegreeMostProbable(srcRelToRoot);
    const destDegree: Degree = map.get(srcDegree) ?? srcDegree;
    let destRelPitch = mod12(destChordRootRelPitch + destDegree.pitch);

    if (pedalBass || destDegree.name === 'ROOT') {
      destRelPitch = destBassRelPitch;
    }

    const destPitch = getClosestPitch(ev.pitch + rootDelta, destRelPitch);
    out.push({
      channel: ev.channel,
      pitch: destPitch,
      velocity: ev.velocity,
      tick: ev.tick,
      durationTicks: ev.durationTicks,
    });
  }
  return out;
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/**
 * Adapt a chord-oriented source phrase to a destination chord — the
 * voicing-optimised path.
 *
 * Port of PhraseUtilities.fitChordPhrase2ChordSymbol (LGPL v2.1).
 *
 * Algorithm:
 *   1. Build srcChord = sorted unique source pitches.
 *   2. Build the src → dest degree map (we use destDegreesMelody for now;
 *      JJazzLab also implements a richer "INVERSION_ALLOWED" variant in
 *      getDestDegreesChordMode that picks the most important dest degrees
 *      — deferred until needed).
 *   3. Enumerate all permutations of the destination degrees (<= 9!).
 *   4. For each permutation, try both `startBelow=true` and `startBelow=false`
 *      via computeParallelChord; score each candidate with
 *      chordMatchingScore; keep the best.
 *   5. For each note in the phrase, find its index in srcChord and copy the
 *      corresponding pitch from bestDestChord. (Same pitch class in the
 *      phrase ⇒ same dest pitch.)
 */
export function fitChordPhraseToChord(
  phrase: SourcePhrase,
  sourceChordRootRelPitch: number,
  sourceChordType: ChordType,
  destChordRootRelPitch: number,
  destChordType: ChordType,
): SourceNoteEvent[] {
  if (phrase.notes.length === 0) return [];

  // Unique src pitches (sorted)
  const srcChord = chordFromPitches(phrase.notes.map((n) => n.pitch));

  // Degree map (src → dest)
  const srcDegrees = sourceUsedDegrees(phrase, sourceChordRootRelPitch, sourceChordType);
  const degMap = destDegreesMelody(srcDegrees, destChordType);

  // computeParallelChord walks srcChord (sorted ascending) and assigns one
  // destRelPitch per *unique pitch class* in src order. So we build the
  // dest-degree list in *that* same order — not in note-event order.
  const seenPc = new Set<number>();
  const destDegreesOrdered: Degree[] = [];
  for (const srcPitch of srcChord) {
    const pc = mod12(srcPitch);
    if (seenPc.has(pc)) continue;
    seenPc.add(pc);
    const relToRoot = mod12(srcPitch - sourceChordRootRelPitch);
    const srcDeg = sourceChordType.getDegreeMostProbable(relToRoot);
    destDegreesOrdered.push(degMap.get(srcDeg) ?? srcDeg);
  }

  // Heap permutation cap: 9 unique pcs. For larger phrases (rare in Yamaha
  // styles), drop the lowest-pitch degrees deterministically.
  const PERMUTATION_MAX = 9;
  let workDegrees = destDegreesOrdered;
  if (workDegrees.length > PERMUTATION_MAX) {
    workDegrees = workDegrees.slice(0, PERMUTATION_MAX);
  }

  // Try every permutation × {startBelow=true, false}, keep best
  const permutations = heapPermutation(workDegrees);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDestChord: number[] | null = null;

  for (const perm of permutations) {
    const relPitches = perm.map((d) => mod12(destChordRootRelPitch + d.pitch));
    // Restrict srcChord to first N unique pitches to match permutation length
    const restrictedSrc = restrictChordToFirstUniquePcs(srcChord, workDegrees.length);

    for (const startBelow of [true, false]) {
      const cand = computeParallelChord(restrictedSrc, relPitches, startBelow);
      if (cand.length !== restrictedSrc.length) continue;
      const score = chordMatchingScore(restrictedSrc, cand, destChordType, destChordRootRelPitch);
      if (score < bestScore) {
        bestScore = score;
        bestDestChord = cand;
      }
    }
  }

  if (bestDestChord === null) {
    // Degenerate: fall back to melody-mode handling (shouldn't happen for
    // non-empty phrases but be safe).
    return fitMelodyPhraseToChord(
      phrase, sourceChordRootRelPitch, sourceChordType,
      destChordRootRelPitch, destChordType,
    );
  }

  // Build a pitch-class → destPitch lookup so notes with the same pc map
  // to the same destination pitch class. (We pick the *first* dest pitch
  // for that pc; subsequent occurrences in the phrase use the same.)
  const pcToDestPitch = new Map<number, number>();
  for (let i = 0; i < bestDestChord.length; i++) {
    const srcPc = mod12(srcChord[i]);
    if (!pcToDestPitch.has(srcPc)) pcToDestPitch.set(srcPc, bestDestChord[i]);
  }

  const rootDelta = mod12(destChordRootRelPitch - sourceChordRootRelPitch);
  const out: SourceNoteEvent[] = [];
  for (const ev of phrase.notes) {
    const srcPc = mod12(ev.pitch);
    let destPitch = pcToDestPitch.get(srcPc);
    if (destPitch === undefined) {
      // Pc not in bestDestChord (got dropped by PERMUTATION_MAX trim).
      // Fall back to melody handling for this single note.
      const relToRoot = mod12(ev.pitch - sourceChordRootRelPitch);
      const srcDeg = sourceChordType.getDegreeMostProbable(relToRoot);
      const destDeg = degMap.get(srcDeg) ?? srcDeg;
      const destRel = mod12(destChordRootRelPitch + destDeg.pitch);
      destPitch = getClosestPitch(ev.pitch + rootDelta, destRel);
    } else {
      // Snap into the source note's octave for voice-leading consistency.
      destPitch = getClosestPitch(ev.pitch + rootDelta, mod12(destPitch));
    }
    out.push({
      channel: ev.channel,
      pitch: destPitch,
      velocity: ev.velocity,
      tick: ev.tick,
      durationTicks: ev.durationTicks,
    });
  }
  return out;
}

/** Restrict a sorted chord to only its first N unique pitch-classes. */
function restrictChordToFirstUniquePcs(chord: number[], n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of chord) {
    const pc = ((p % 12) + 12) % 12;
    if (!seen.has(pc)) {
      seen.add(pc);
      out.push(p);
      if (seen.size >= n) break;
    } else {
      out.push(p);
    }
  }
  return out;
}
