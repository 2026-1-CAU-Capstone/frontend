import type { LeadSheetData } from '../../data/leadSheetTypes';

export interface SongEntry {
  index: number;
  title: string;
  composer: string;
  style: string;
  key: string;
}

let cachedSongs: LeadSheetData[] | null = null;
let cachedIndex: SongEntry[] | null = null;

async function ensureLoaded(): Promise<LeadSheetData[]> {
  if (cachedSongs) return cachedSongs;
  const response = await fetch('/jazz1460.json');
  cachedSongs = (await response.json()) as LeadSheetData[];
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
