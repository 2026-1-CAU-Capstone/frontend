import type { NoteSheetData } from '../../data/sampleMelody';

/* 멀티페이지 OMR 결과 병합기.
 *
 * 백엔드 합의: multi-page PDF → 페이지별 단일 이미지 OMR → 페이지별 JSON 을
 * 병합해 전체 반환. 백엔드 배치 API 가 나오기 전까지의 프론트 선작업으로,
 * 페이지별 NoteSheetData 들을 한 악보로 이어붙인다. (배치 API 가 서버 병합을
 * 해주더라도 응답 검증·페이지별 프리뷰에 재사용한다.)
 *
 * 규칙:
 *  - 메타(title/composer/key/tempo/timeSignature)는 첫 페이지 것을 쓴다.
 *  - measures 는 페이지 순서대로 이어붙인다.
 *  - 뒤 페이지의 박자가 앞과 다르면 그 페이지 첫 마디에 per-measure
 *    timeSignature 오버라이드를 심는다 (MeasureInfo.timeSignature 규약).
 *  - 음높이는 각 음표가 절대 임시표(accidentals 맵)를 갖는 앱 규약이라
 *    조표(key)가 첫 페이지 기준이어도 뒤 페이지 음이 틀어지지 않는다. */
export function mergeOmrSheets(pages: NoteSheetData[]): NoteSheetData {
  if (pages.length === 0) throw new Error('병합할 OMR 결과가 없습니다.');
  if (pages.length === 1) return pages[0];

  const [first, ...rest] = pages;
  const merged: NoteSheetData = { ...first, measures: [...first.measures] };

  let prevTs = first.timeSignature || '4/4';
  for (const page of rest) {
    const pageTs = page.timeSignature || '4/4';
    const measures = page.measures.map((m, i) => (
      i === 0 && pageTs !== prevTs && !m.timeSignature
        ? { ...m, timeSignature: pageTs }
        : m
    ));
    merged.measures.push(...measures);
    // 페이지 내 마지막 오버라이드가 있으면 그것이 다음 페이지와의 비교 기준.
    const lastOverride = [...page.measures].reverse().find((m) => m.timeSignature)?.timeSignature;
    prevTs = lastOverride || pageTs;
  }
  return merged;
}
