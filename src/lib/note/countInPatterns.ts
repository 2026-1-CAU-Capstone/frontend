/* Count-in 패턴 — bpm 에 따라 swing-feel 카운트오프 패턴을 선택.
 *
 * 각 cell 은 음악 tempo 의 한 박 (60/bpm 초) 을 차지한다.
 *   - label 이 있는 cell: 시각적 카운트 (1/2/3/4) 또는 쿵 (kick)
 *   - 빈 label (= 짝, 스윙의 오프비트): 시각적으로 비어있고 audio 도 silent
 *
 * 패턴 선택:
 *   - bpm < 150  → SIMPLE  (4 박, 1234 한 줄)
 *   - 150~199    → MEDIUM  (8 박, "1 _ 2 _" / "1 2 3 4")
 *   - bpm >= 200 → FAST    (16 박, "1 _ 쿵 _ 2 _ 쿵 _" / "1 _ 2 _" / "1 2 3 4")
 *
 * MEDIUM/FAST 는 재즈 드러머가 카운트 오프 할 때의 swing-feel 을 시각화한 것:
 * 짝 (blank) 으로 8분음표 오프비트 텍스처를 만들고, 마지막 "1 2 3 4" 에 액센트.
 */

export type CellAudio = 'accent' | 'normal' | 'snap' | 'silent';

export interface Cell {
  /** 표시할 텍스트. 빈 문자열이면 label-less cell (짝 = silent / snap = 빈 사각형). */
  label: string;
  audio: CellAudio;
}

export interface Pattern {
  rows: Cell[][];
}

/* 짧은 helper — 패턴 정의 가독성용
 *   A: accent (마지막 행의 1) — 큰 스틱 클릭
 *   N: normal (1, 2, 3, 4)    — 스틱 클릭
 *   S: snap (손가락 틩김)       — 시각적으론 빈 사각형 (border 만), label 없음
 *   _: silent (짝, 오프비트)    — 시각적으로 완전 투명 (spacer 만), audio 없음
 */
const A = (label: string): Cell => ({ label, audio: 'accent' });
const N = (label: string): Cell => ({ label, audio: 'normal' });
const S = (): Cell => ({ label: '', audio: 'snap' });
const _ = (): Cell => ({ label: '', audio: 'silent' });

export const PATTERN_SIMPLE: Pattern = {
  rows: [
    [A('1'), N('2'), N('3'), N('4')],
  ],
};

export const PATTERN_MEDIUM: Pattern = {
  rows: [
    [N('1'), _(),    N('2'), _()],
    [A('1'), N('2'), N('3'), N('4')],
  ],
};

export const PATTERN_FAST: Pattern = {
  rows: [
    [N('1'), _(), S(),    _(), N('2'), _(), S(),    _()],
    [N('1'), _(), N('2'), _()],
    [A('1'), N('2'), N('3'), N('4')],
  ],
};

export function selectPattern(bpm: number): Pattern {
  if (bpm >= 200) return PATTERN_FAST;
  if (bpm >= 150) return PATTERN_MEDIUM;
  return PATTERN_SIMPLE;
}

export function flatCells(p: Pattern): Cell[] {
  return p.rows.flatMap((r) => r);
}

export function maxRowLength(p: Pattern): number {
  return Math.max(...p.rows.map((r) => r.length));
}
