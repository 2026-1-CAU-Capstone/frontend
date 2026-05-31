import type { LeadSheetData } from '../../data/leadSheetTypes';
import { withLeadSheetSelectionIds } from '../leadSheetSelection';

export interface SongEntry {
  index: number;
  title: string;
  composer: string;
  style: string;
  key: string;
}

/** iReal Pro / library cataloging encodes titles with leading articles
 *  moved to the end after a comma — "Girl From Ipanema, The" / "African
 *  Queen, The". Reverse that so the UI shows "The Girl From Ipanema". */
export function normalizeIRealTitle(title: string): string {
  const m = title.match(/^(.+),\s+(The|A|An)$/);
  return m ? `${m[2]} ${m[1]}` : title;
}

/** Single-composer entries in jazz1460 are stored "LastName FirstName"
 *  (e.g. "Coltrane John"); multi-composer entries are already comma-
 *  separated "FirstName LastName" pairs (e.g. "Miles Davis, Bill Evans").
 *  Swap word order only for the no-comma single-composer case so the UI
 *  shows "John Coltrane" without breaking the already-correct multi case. */
export function normalizeIRealComposer(composer: string): string {
  if (!composer || composer.includes(',')) return composer;
  const parts = composer.trim().split(/\s+/);
  if (parts.length !== 2) return composer;
  return `${parts[1]} ${parts[0]}`;
}

let cachedSongs: LeadSheetData[] | null = null;
let cachedIndex: SongEntry[] | null = null;

async function ensureLoaded(): Promise<LeadSheetData[]> {
  if (cachedSongs) return cachedSongs;
  const response = await fetch('/jazz1460.json');
  const rawSongs = (await response.json()) as LeadSheetData[];
  cachedSongs = rawSongs.map((song, index) =>
    withLeadSheetSelectionIds(
      {
        ...song,
        title: normalizeIRealTitle(song.title),
        composer: normalizeIRealComposer(song.composer),
      },
      `jazz-${index}`,
    ),
  );
  return cachedSongs;
}

export async function getSongIndex(): Promise<SongEntry[]> {
  if (cachedIndex) return cachedIndex;
  const songs = await ensureLoaded();
  cachedIndex = songs.map((s, i) => ({
    index: i,
    title: s.title,
    composer: s.composer,
    style: s.style,
    key: s.key ?? 'C',
  }));
  return cachedIndex;
}

export async function getSong(index: number): Promise<LeadSheetData | null> {
  const songs = await ensureLoaded();
  return songs[index] ?? null;
}
