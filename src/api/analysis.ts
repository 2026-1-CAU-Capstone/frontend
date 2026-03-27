import { allOfMe } from '../data/allOfMe';
import type { ChordOverlay, SongData } from '../data/types';

const SONGS: Record<string, SongData> = {
  'all-of-me': allOfMe,
};

export async function getSongData(songId: string): Promise<SongData | null> {
  // 목업: return from local data
  // 실제: return fetch(`/api/songs/${songId}`).then(r => r.json());
  return SONGS[songId] ?? null;
}

export async function analyzeChords(songId: string): Promise<ChordOverlay[]> {
  // 목업: return from local data
  // 실제: return fetch('/api/analyze', { method: 'POST', body: JSON.stringify({ songId }) }).then(r => r.json());
  const song = SONGS[songId];
  return song?.chords ?? [];
}
