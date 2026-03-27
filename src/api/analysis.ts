import { allOfMe } from '../data/allOfMe';
import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordOverlay, SongData } from '../data/types';

const LEAD_SHEETS: Record<string, LeadSheetData> = {
  'all-of-me': allOfMe,
};

export async function getLeadSheetData(songId: string): Promise<LeadSheetData | null> {
  return LEAD_SHEETS[songId] ?? null;
}

export async function getSongData(_songId: string): Promise<SongData | null> {
  // 목업: return from local data
  // 실제: return fetch(`/api/songs/${songId}`).then(r => r.json());
  return null;
}

export async function analyzeChords(_songId: string): Promise<ChordOverlay[]> {
  // 목업: return from local data
  // 실제: return fetch('/api/analyze', { method: 'POST', body: JSON.stringify({ songId }) }).then(r => r.json());
  return [];
}
