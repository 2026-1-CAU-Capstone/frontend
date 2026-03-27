/**
 * iRealPro parser — faithful reproduction of iRealPro's chart format.
 *
 * Usage:
 *   import { parseIRealUrl, tokenize, parse } from '@/lib/ireal';
 *
 *   // From a full irealb:// URL (single song or playlist)
 *   const playlist = parseIRealUrl(url);
 *   playlist.songs[0].measures  // IRealMeasure[]
 *
 *   // From an already-decoded chart string
 *   const tokens   = tokenize(chartString);
 *   const measures = parse(tokens);
 */

export type {
  Barline,
  IRealCell,
  IRealChord,
  IRealMeasure,
  IRealPlaylist,
  IRealSong,
} from './types';

export { decodeIRealUrl, unscramble } from './decode';
export type { RawSong } from './decode';

export { tokenize } from './tokenize';
export type { Token } from './tokenize';

export { parse } from './parse';

// ─── convenience: URL → fully parsed playlist ───────────────────────────────

import { decodeIRealUrl } from './decode';
import { tokenize } from './tokenize';
import { parse } from './parse';
import type { IRealPlaylist, IRealSong } from './types';

export function parseIRealUrl(uri: string): IRealPlaylist {
  const rawSongs = decodeIRealUrl(uri);
  const songs: IRealSong[] = [];

  for (const raw of rawSongs) {
    const tokens   = tokenize(raw.chart);
    const measures = parse(tokens);

    if (measures.length === 0) continue;

    songs.push({
      title:     raw.title,
      composer:  raw.composer,
      style:     raw.style,
      key:       raw.key,
      transpose: raw.transpose,
      bpm:       raw.bpm,
      repeats:   raw.repeats,
      compStyle: raw.compStyle,
      measures,
    });
  }

  return { songs };
}
