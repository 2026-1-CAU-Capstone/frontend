/**
 * Translate Jazzify's Chart `ChordQuality` enum (lib/backing/types.ts) into
 * our jazz-harmony ChordType so the .sty engine can be plugged in as an
 * alternative backend behind the existing BackingPlayer interface.
 */

import { ChordSymbol, type ChordType } from '../jazz-harmony';

const QUALITY_TO_NAME: Record<string, string> = {
  // Major family
  maj: '',
  maj6: '6',
  maj7: 'M7',
  maj9: 'M9',
  // Minor family
  min: 'm',
  min6: 'm6',
  min7: 'm7',
  min9: 'm9',
  min11: 'm11',
  minmaj7: 'mM7',
  // Dominant family
  dom7: '7',
  dom9: '9',
  dom13: '13',
  '7sus4': '7sus',
  '7alt': '7alt',
  '7#9': '7#9',
  '7b9': '7b9',
  '7#11': '7#11',
  '7b13': '7b13',
  // Half-diminished / diminished
  min7b5: 'm7b5',
  dim: 'dim',
  dim7: 'dim7',
  // Augmented
  aug: '+',
  aug7: '7#5',
  // Sus
  sus2: 'sus2',
  sus4: 'sus',
  // Power / fallback
  '5': '',
};

const CACHE = new Map<string, ChordType>();

/** Resolve a ChordType for the given backing-track quality string.
 *  Falls back to plain major when unknown. */
export function chordTypeFromQuality(quality: string): ChordType {
  let ct = CACHE.get(quality);
  if (ct) return ct;
  const name = QUALITY_TO_NAME[quality] ?? '';
  // Prefix with C so ChordSymbol.parse can resolve; we only care about
  // the ChordType, not the root.
  ct = ChordSymbol.parse('C' + name).chordType;
  CACHE.set(quality, ct);
  return ct;
}
