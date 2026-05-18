/**
 * AI onset suggestion client.
 *
 * Currently backed by a hand-frozen mock JSON generated from rag/scratch/PoC
 * runs (`rag/scratch/dump_mock_suggestions.py`). When the real worker ships,
 * swap the body of `fetchOnsetSuggestions` for a network call to
 * `POST /api/v1/onset/suggest`.
 */
import mockData from '../data/mockOnsetSuggestions.json';

export interface OnsetCandidate {
  startSec: number;
  endSec: number;
  score: number;
}

export interface OnsetSuggestion {
  label: string;
  gtStartSec: number;
  gtEndSec: number | null;
  nEvents: number;
  candidates: OnsetCandidate[];
}

type MockMap = Record<string, OnsetSuggestion>;
const MOCK = mockData as MockMap;

/** Returns top-K candidates for a given video. lickNum is ignored by mock. */
export async function fetchOnsetSuggestions(
  videoId: string,
  _lickNum?: number,
): Promise<OnsetSuggestion | null> {
  // simulate a short network round-trip so UI states feel real
  await new Promise((r) => setTimeout(r, 200));
  // exact match first; otherwise scan for a key whose prefix is this videoId
  // (multiple licks can share a videoId — see "HSeiIvBdAis#..." in mock).
  if (MOCK[videoId]) return MOCK[videoId];
  const prefixHit = Object.keys(MOCK).find((k) => k.startsWith(`${videoId}#`));
  return prefixHit ? MOCK[prefixHit] : null;
}
