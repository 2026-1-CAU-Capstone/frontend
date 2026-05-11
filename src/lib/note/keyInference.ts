/**
 * Infer a piece's key from its chord progression.
 *
 * The Omnibook XMLs almost all have <fifths>0</fifths> (= C major) regardless
 * of the tune's actual key — the transcribers wrote every accidental out by
 * hand instead of using a proper key signature. This module recovers the real
 * tonal center by analysing the chord symbols.
 *
 * Algorithm (lightweight, no full RN analysis):
 *   1. For each V → I cadence (dominant 7 chord followed by a chord whose root
 *      is a perfect 4th up), score +3 for that target as tonic.
 *   2. For each maj7 / 6 / major-triad chord, score +2 (likely a I or IV — but
 *      I is far more common as a "static" point in jazz heads).
 *   3. For each m7 / minor chord, score +1 (could be i of a minor key, or ii
 *      / vi of a major key).
 *   4. Bonus weight to the FIRST and LAST chords (downbeats anchor the key).
 *   5. The root with the highest aggregate score wins. Mode (major vs minor)
 *      is decided by the quality of the winning-root chord that appears most.
 *
 * Returns a key string compatible with VexFlow / the rest of the codebase:
 *   major:  "C", "Bb", "F#", ...
 *   minor:  "Cm", "F#m", "Bbm", ...
 */

import type { MeasureInfo } from '../../data/sampleMelody';

const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** Choose a sharp- or flat-spelling depending on what jazz lead-sheets usually
 *  print. We pick whichever spelling is more idiomatic for that pitch class. */
const PC_TO_KEY_NAME: Record<number, string> = {
  0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
  6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
};

type Quality = 'maj' | 'min' | 'dom' | 'halfdim' | 'dim' | 'sus' | 'unknown';

interface ParsedChord {
  rootPC: number;
  quality: Quality;
}

function parseChord(raw: string): ParsedChord | null {
  const s = raw.trim();
  if (!s) return null;

  // Extract root letter + optional accidental.
  let rootStr = s[0].toUpperCase();
  let rest = s.slice(1);
  if (rest[0] === '#' || rest[0] === 'b') {
    rootStr += rest[0];
    rest = rest.slice(1);
  }
  const rootPC = NOTE_PC[rootStr];
  if (rootPC == null) return null;

  // Normalise quality tokens. Order matters — match specific tokens first.
  const q = rest;
  let quality: Quality = 'unknown';
  if (/^(-7b5|m7b5|min7b5|ø|h7|h(?!\d))/i.test(q)) quality = 'halfdim';
  else if (/^(o7|°7|dim7|o(?!\d)|°|dim)/i.test(q)) quality = 'dim';
  else if (q === '' || /^(maj|Δ|j7|M7|Maj|6)/.test(q)) quality = 'maj';
  else if (/^(-|m(?!aj)|min)/i.test(q)) quality = 'min';
  else if (/^(7sus|sus)/i.test(q)) quality = 'sus';
  else if (/^[+]/.test(q) || /aug/i.test(q)) quality = 'dom'; // augmented dominants treated as dom
  else if (/^\d/.test(q)) quality = 'dom'; // bare number (7, 9, 13) → dominant
  return { rootPC, quality };
}

/** Extract a flat chord list from a piece's measures, in playback order.
 *  Multi-chord measures are split on the double-space separator the parser
 *  uses (see xmlMelodyParser: `measureChords.join('  ')`). */
function chordsFromMeasures(measures: MeasureInfo[]): ParsedChord[] {
  const out: ParsedChord[] = [];
  for (const m of measures) {
    if (!m.chord) continue;
    for (const sym of m.chord.split(/\s{2,}/)) {
      const c = parseChord(sym);
      if (c) out.push(c);
    }
  }
  return out;
}

export function inferKeyFromMeasures(measures: MeasureInfo[]): string | null {
  const chords = chordsFromMeasures(measures);
  if (chords.length === 0) return null;

  // Score table indexed by pitch class (0-11). Sub-scores split by mode so we
  // can pick the chord quality (major / minor) for the winning root.
  const majScore = new Array<number>(12).fill(0);
  const minScore = new Array<number>(12).fill(0);

  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];

    // 1. V → I cadence: dominant followed by chord a 4th up (+5 semitones).
    if (c.quality === 'dom' && i + 1 < chords.length) {
      const next = chords[i + 1];
      const expectedTonic = (c.rootPC + 5) % 12;
      if (next.rootPC === expectedTonic) {
        if (next.quality === 'maj' || next.quality === 'dom') majScore[expectedTonic] += 3;
        else if (next.quality === 'min') minScore[expectedTonic] += 3;
        else majScore[expectedTonic] += 1.5; // weak cadence
      }
    }

    // 2-3. Chord quality contribution.
    if (c.quality === 'maj') majScore[c.rootPC] += 2;
    else if (c.quality === 'min') minScore[c.rootPC] += 1;
    else if (c.quality === 'dom') {
      // Dominants imply their *tonic* (root + 5) — but only weakly because
      // V can appear far from a cadence (e.g. blues stays on I7).
      majScore[(c.rootPC + 5) % 12] += 0.4;
      // The dom chord itself is also often the "I7" of a blues.
      majScore[c.rootPC] += 0.6;
    }
  }

  // 4. First & last chord anchor bonuses.
  const first = chords[0];
  const last = chords[chords.length - 1];
  if (first.quality === 'maj') majScore[first.rootPC] += 1.5;
  else if (first.quality === 'min') minScore[first.rootPC] += 1.0;
  else if (first.quality === 'dom') majScore[first.rootPC] += 0.8; // blues opening
  if (last.quality === 'maj') majScore[last.rootPC] += 2.0;
  else if (last.quality === 'min') minScore[last.rootPC] += 1.5;
  else if (last.quality === 'dom') majScore[last.rootPC] += 1.0;

  // Pick the (pc, mode) with the highest combined score, but separately track
  // which mode wins so we can spell the key string correctly.
  let bestPc = 0;
  let bestScore = -Infinity;
  let bestIsMinor = false;
  for (let pc = 0; pc < 12; pc++) {
    const majS = majScore[pc];
    const minS = minScore[pc];
    if (majS > bestScore) { bestScore = majS; bestPc = pc; bestIsMinor = false; }
    if (minS > bestScore) { bestScore = minS; bestPc = pc; bestIsMinor = true; }
  }
  if (bestScore <= 0) return null;

  const name = PC_TO_KEY_NAME[bestPc];
  return bestIsMinor ? `${name}m` : name;
}
