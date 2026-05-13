/**
 * Helpers operating on SourcePhrase data.
 *
 * Port of JJazzLab's SourcePhrase methods that aren't pure data
 * (getUsedDegrees + getDestDegrees), separated from style-part.ts so the
 * data model stays a plain interface and these algorithm helpers can be
 * tree-shaken when only parsing is needed.
 *
 * Currently implements:
 *   - sourceUsedDegrees(): list every distinct Degree the phrase touches
 *     relative to the source chord
 *   - destDegreesMelody(): the simpler "MELODY mode" path of
 *     SourcePhrase.getDestDegrees — maps each used degree to a destination
 *     chord degree via ChordType.fitDegree (without inversion / scale
 *     reasoning).
 *
 * The CHORD-mode path (getDestDegreesChordMode) which optimises chord
 * voicings is deferred to the next round — that's the meat of
 * fitChordPhrase2ChordSymbol.
 */

import { Degrees, type Degree, type ChordType } from '../jazz-harmony';
import type { SourcePhrase } from './style-part';

/**
 * Compute the unique source-chord Degrees that appear in the phrase.
 *
 * Each note's MIDI pitch is reduced to a pitch class relative to the source
 * chord root, then mapped to the most probable Degree of the source chord.
 *
 * @param phrase the source phrase
 * @param sourceChordRootRelPitch root pitch class of the source chord (0-11)
 * @param sourceChordType the chord type the phrase was recorded against
 * @returns ordered list (by degree pitch) of unique degrees
 */
export function sourceUsedDegrees(
  phrase: SourcePhrase,
  sourceChordRootRelPitch: number,
  sourceChordType: ChordType,
): Degree[] {
  const seen = new Set<string>();
  const result: Degree[] = [];

  for (const ev of phrase.notes) {
    const rel = mod12(ev.pitch - sourceChordRootRelPitch);
    const d = sourceChordType.getDegreeMostProbable(rel);
    if (!seen.has(d.name)) {
      seen.add(d.name);
      result.push(d);
    }
  }

  result.sort((a, b) => a.pitch - b.pitch);
  return result;
}

/**
 * Map each used source Degree to a destination chord Degree using the
 * MELODY-mode rules of JJazzLab.SourcePhrase.getDestDegrees.
 *
 * For each source degree:
 *   1. Try `destChordType.fitDegree(srcDegree)` — direct/enharmonic match.
 *   2. If null, currently fall back to the source degree itself (we omit
 *      fitDegreeAdvanced + scale reasoning until needed).
 *
 * @returns Map of source degree → destination degree
 */
export function destDegreesMelody(
  srcDegrees: Degree[],
  destChordType: ChordType,
): Map<Degree, Degree> {
  const result = new Map<Degree, Degree>();
  for (const sd of srcDegrees) {
    const dd = destChordType.fitDegree(sd);
    result.set(sd, dd ?? sd);
  }
  return result;
}

/** Convenience: pitch reduced to 0-11. */
function mod12(p: number): number {
  return ((p % 12) + 12) % 12;
}

/** Re-export a sentinel for clarity. Used by callers as the "ROOT" comparison. */
export const ROOT_DEGREE: Degree = Degrees.ROOT;
