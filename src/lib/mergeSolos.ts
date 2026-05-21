import type { SoloResponse, SoloDraft } from '../api/solos';

/* Merge several solos (in the given order) into one new solo draft by
 * concatenating their measures. Useful when OMR split one continuous solo
 * across multiple separate solos. Metadata (instrument/key/tempo/…) is taken
 * from the first solo; the backend re-derives chords/harmony/features from the
 * combined sheetData. Boundary measures are concatenated as-is (no dedup). */
export function buildMergedSoloDraft(ordered: SoloResponse[]): SoloDraft {
  if (ordered.length === 0) throw new Error('합칠 솔로가 없습니다.');
  const first = ordered[0];

  const measures = ordered.flatMap((s) => s.sheetData.measures ?? []);
  const sheetData = { ...first.sheetData, measures };

  return {
    source: 'user',
    title: `${first.title} (합본)`,
    instrument: first.instrument,
    sheetData,
    performer: first.performer ?? undefined,
    album: first.album ?? undefined,
    style: first.style ?? undefined,
    tempo: first.tempo ?? undefined,
    // first.key is already Weimar ("C-maj"); createSolo's toWeimarKey is idempotent.
    key: first.key ?? undefined,
    rhythmFeel: first.rhythmFeel ?? undefined,
    timeSignature: first.sheetData.timeSignature ?? first.timeSignature ?? undefined,
  };
}
