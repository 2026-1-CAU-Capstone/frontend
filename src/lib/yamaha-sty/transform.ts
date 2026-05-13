/**
 * Top-level dispatch — port of YamJJazzRhythmGenerator.fitSrcPhraseToChordSymbol
 * (LGPL v2.1).
 *
 * Given:
 *   - a source phrase
 *   - the CtabChannelSettings for that channel (NTR / NTT / bassOn etc.)
 *   - the destination chord symbol (root + chord type [+ optional bass])
 *
 * choose the right fitXxxPhrase function and apply it. Post-processes the
 * result with chordRootUpperLimit (octave-down if exceeded).
 *
 * Caveats / deferred features:
 *   - Scale-forced minor families (HARMONIC_MINOR, MELODIC_MINOR,
 *     NATURAL_MINOR, DORIAN, and their _5 variants): JJazzLab forces the
 *     destination chord's scale here, which steers fitMelodyPhrase's degree
 *     fitting. We currently just call fitMelodyPhrase without that nudge —
 *     output still musical, just not identical to JJazzLab on these NTTs.
 *   - RetriggerRule post-processing across sections is not yet applied (it's
 *     a multi-phrase concern, not per-phrase).
 */

import type { ChordType } from '../jazz-harmony';
import type { CtabChannelSettings } from './ctab-channel-settings';
import type { Ctb2ChannelSettings } from './ctb2-channel-settings';
import type { SourceNoteEvent, SourcePhrase } from './style-part';
import {
  fitMelodyPhraseToChord,
  fitBassPhraseToChord,
  fitChordPhraseToChord,
} from './fit-phrase';

/** Information about the target chord — pulled together so callers don't
 *  carry six positional arguments. */
export interface DestChord {
  rootRelPitch: number;
  chordType: ChordType;
  /** For slash chords. If equal to rootRelPitch, no slash. */
  bassRelPitch: number;
}

/**
 * Transform a source phrase to fit the destination chord, using the rules
 * stored in the channel's Ctab + Ctb2 main subpart.
 */
export function transformPhrase(
  phrase: SourcePhrase,
  ctab: CtabChannelSettings,
  dest: DestChord,
): SourceNoteEvent[] {
  if (phrase.notes.length === 0) return [];

  const ctb2 = ctab.ctb2Main;
  const srcRoot = ctab.sourceChordNote;
  const srcType = ctab.sourceChordType;

  let result: SourceNoteEvent[];

  // BYPASS short-circuit (covers ROOT_FIXED + BYPASS too)
  if (ctb2.ntt === 'BYPASS') {
    result = parallelTranspose(phrase, srcRoot, dest.rootRelPitch);
  } else if (ctb2.ntr === 'GUITAR') {
    // Guitar NTTs: chord-style voicing
    result = fitChordPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType);
  } else if (ctb2.ntr === 'ROOT_FIXED') {
    // Chord-oriented patterns (pads, comping) — UNLESS this is a bass
    // channel, in which case the .sty author mis-labelled it (Yamaha
    // doesn't strictly forbid it) and the musically-correct behaviour
    // is bass-line fitting. Same goes for melodic phrase channels.
    if (ctab.accType === 'BASS') {
      result = fitBassPhraseToChord(
        phrase, srcRoot, srcType,
        dest.rootRelPitch, dest.chordType,
        dest.bassRelPitch,
      );
    } else if (ctab.accType === 'PHRASE1' || ctab.accType === 'PHRASE2') {
      result = fitMelodyPhraseToChord(
        phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType,
      );
    } else {
      result = fitChordPhraseToChord(
        phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType,
      );
    }
  } else {
    // ROOT_TRANSPOSITION — melody-oriented
    result = dispatchRootTransposition(phrase, ctb2, srcRoot, srcType, dest);
  }

  // chordRootUpperLimit: if dest root > limit, drop the whole phrase an octave
  if (dest.rootRelPitch > ctb2.chordRootUpperLimit) {
    result = result.map((n) => ({ ...n, pitch: Math.max(0, n.pitch - 12) }));
  }

  // noteLow / noteHigh clamping: drop notes outside the channel's range
  result = result.filter((n) => n.pitch >= ctb2.noteLowLimit && n.pitch <= ctb2.noteHighLimit);

  return result;
}

function dispatchRootTransposition(
  phrase: SourcePhrase,
  ctb2: Ctb2ChannelSettings,
  srcRoot: number,
  srcType: ChordType,
  dest: DestChord,
): SourceNoteEvent[] {
  switch (ctb2.ntt) {
    case 'CHORD':
      // Java: PhraseUtilities.fitMelodyPhrase2ChordSymbol(pSrc, destEcs, true)
      // (the boolean chord-mode flag) — we approximate with fitMelodyPhrase.
      return fitMelodyPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType);

    case 'MELODY':
      return ctb2.bassOn
        ? fitBassPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType, dest.bassRelPitch)
        : fitMelodyPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType);

    // Scale-forced families: JJazzLab tweaks destChordType with a scale; we
    // fall back to plain melody fitting for now. Audibly close in most cases.
    case 'HARMONIC_MINOR':
    case 'HARMONIC_MINOR_5':
    case 'MELODIC_MINOR':
    case 'MELODIC_MINOR_5':
    case 'NATURAL_MINOR':
    case 'NATURAL_MINOR_5':
    case 'DORIAN':
    case 'DORIAN_5':
      return fitMelodyPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType);

    default:
      // Shouldn't happen for ROOT_TRANSPOSITION + BYPASS (handled upstream),
      // and GUITAR-only NTTs (ALL_PURPOSE etc.) are routed through the
      // GUITAR branch in transformPhrase. Fall back safely.
      return fitMelodyPhraseToChord(phrase, srcRoot, srcType, dest.rootRelPitch, dest.chordType);
  }
}

/**
 * BYPASS handling — parallel-transpose every note by (destRoot - srcRoot)
 * mod 12, plus closest-octave adjustment to avoid huge jumps.
 *
 * Used for intros/endings (Yamaha's "play exactly what was recorded, just
 * shifted to the new key") and any non-harmonic transposition.
 */
function parallelTranspose(
  phrase: SourcePhrase,
  srcRoot: number,
  destRoot: number,
): SourceNoteEvent[] {
  const delta = ((destRoot - srcRoot) % 12 + 12) % 12;
  return phrase.notes.map((n) => ({
    ...n,
    pitch: Math.max(0, Math.min(127, n.pitch + delta)),
  }));
}
