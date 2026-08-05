/* 양손(그랜드 스태프) 두 보표 사이 세로 간격 — VexFlow 렌더러 **공용** 규칙.
 *
 * ─ 문제 ─
 * 아래 보표를 위 보표에서 **고정 거리**(GRAND_BASS_DY)에 놓으면, 위 보표의 음이
 * 아래로 뻗거나(덧줄·아래 기둥) 아래 보표의 음이 위로 뻗을 때(덧줄 화음) 서로
 * 겹친다. 간격이 내용과 무관하게 상수였기 때문이다.
 *
 * ─ 규칙 ─
 *   1. 위 보표의 **가장 낮은 요소**와 아래 보표의 **가장 높은 요소** 사이에는
 *      항상 `minClearance` 이상이 있어야 한다.
 *   2. 모자라면 **간격을 벌린다**(줄 높이도 그만큼 커진다).
 *   3. 여유가 있으면 기본 간격을 그대로 쓴다 → 평범한 악보는 좌표가 안 바뀐다.
 *
 * 계산은 음높이 기반이라 draw 전에 알 수 있다(레이아웃은 그리기 전에 정해져야 한다).
 * 기둥은 VexFlow autoStem 규칙(가운데 줄 위 → 아래 기둥)을 그대로 반영한다.
 */

import type { ClearanceNote } from './chordClearance';

/** 위·아래 보표 원점 사이 기본 거리(px). 에디터·뷰어가 **같은 값**을 쓴다. */
export const GRAND_BASS_DY = 100;
/** 위 보표 마지막 줄과 아래 보표 첫 줄 사이 최소 여백(px). */
export const GRAND_MIN_CLEARANCE = 16;
/** 기둥 길이 — VexFlow 기본값(오선 3.5칸). */
const STEM_LEN_LINES = 3.5;

const LETTER_DIA: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
/** 보표 맨 윗줄(line 0) 음 — 트레블 F5 · 베이스 A3. */
const TOP_LINE_DIA = { treble: LETTER_DIA.f + 5 * 7, bass: LETTER_DIA.a + 3 * 7 } as const;

type Clef = 'treble' | 'bass';

function diaOf(vexKey: string): number | null {
  const letter = vexKey[0]?.toLowerCase();
  if (letter === undefined || !(letter in LETTER_DIA)) return null;
  const oct = parseInt(vexKey.split('/')[1] ?? '', 10);
  if (!Number.isFinite(oct)) return null;
  return LETTER_DIA[letter] + oct * 7;
}

/** 실음(쉼표·장식음 제외) 중 최고/최저 diatonic 값. 없으면 null. */
function extremes(measures: readonly (readonly ClearanceNote[])[]): { hi: number; lo: number } | null {
  let hi = -Infinity; let lo = Infinity;
  for (const notes of measures) {
    for (const n of notes) {
      if (n.grace || n.duration?.endsWith('r')) continue;
      for (const k of n.keys ?? []) {
        const d = diaOf(k);
        if (d === null) continue;
        if (d > hi) hi = d;
        if (d < lo) lo = d;
      }
    }
  }
  return Number.isFinite(hi) ? { hi, lo } : null;
}

/**
 * 이 보표의 내용이 **맨 아랫줄(line 4)보다 몇 px 아래**까지 내려가는지(양수 = 아래).
 * 머리·덧줄뿐 아니라 **아래로 향한 기둥**까지 본다 — 가운데 줄보다 위에 있는 음은
 * autoStem 이 기둥을 아래로 뻗는다.
 */
export function contentBelowStaff(
  measures: readonly (readonly ClearanceNote[])[], lineGap: number, clef: Clef,
): number {
  const ex = extremes(measures);
  if (!ex) return 0;
  const bottomLine = TOP_LINE_DIA[clef] - 8;   // line 4 (한 줄 = 2 diatonic)
  const middleLine = TOP_LINE_DIA[clef] - 4;   // line 2

  // 가장 낮은 머리의 아래끝.
  const headBottom = ((bottomLine - ex.lo) / 2) * lineGap + lineGap / 2;
  /* 아래 기둥(빔)의 끝. 빔은 그룹의 **가장 낮은 음**이 최소 기둥 길이를 확보하도록
   * 놓이므로, 가장 깊이 내려오는 지점은 최저음 기준이다(최고음 기준으로 잡으면
   * 실제보다 얕게 나와 겹친다 — 양손 악보에서 실측된 원인).
   * 한 음이라도 가운데 줄 위에 있으면 그룹 전체가 아래 기둥이 될 수 있다고 본다. */
  const stemBottom = ex.hi > middleLine
    ? ((bottomLine - ex.lo) / 2) * lineGap + STEM_LEN_LINES * lineGap
    : -Infinity;

  return Math.max(0, headBottom, stemBottom);
}

/**
 * 이 보표의 내용이 **맨 윗줄(line 0)보다 몇 px 위**까지 올라가는지(양수 = 위).
 * 위로 향한 기둥(가운데 줄 아래 음)도 함께 본다.
 */
export function contentAboveStaff(
  measures: readonly (readonly ClearanceNote[])[], lineGap: number, clef: Clef,
): number {
  const ex = extremes(measures);
  if (!ex) return 0;
  const topLine = TOP_LINE_DIA[clef];
  const middleLine = topLine - 4;

  const headTop = ((ex.hi - topLine) / 2) * lineGap + lineGap / 2;
  /* 위 기둥(빔)의 끝 — 대칭 논리로 그룹의 **가장 높은 음** 기준이다. */
  const stemTop = ex.lo <= middleLine
    ? ((ex.hi - topLine) / 2) * lineGap + STEM_LEN_LINES * lineGap
    : -Infinity;

  return Math.max(0, headTop, stemTop);
}

/**
 * **한 줄**의 양손 간격(위 보표 원점 → 아래 보표 원점, px).
 *
 * 기본값보다 좁아지는 일은 없다 — 겹치지 않으면 `GRAND_BASS_DY` 그대로다.
 */
export function grandStaffDy(
  trebleMeasures: readonly (readonly ClearanceNote[])[],
  bassMeasures: readonly (readonly ClearanceNote[])[],
  lineGap: number,
  opts: { defaultDy?: number; minClearance?: number } = {},
): number {
  const defaultDy = opts.defaultDy ?? GRAND_BASS_DY;
  const minClearance = opts.minClearance ?? GRAND_MIN_CLEARANCE;

  const below = contentBelowStaff(trebleMeasures, lineGap, 'treble');
  const above = contentAboveStaff(bassMeasures, lineGap, 'bass');

  /* 위 보표 line4 = trebleY + SPACE_ABOVE + 4*lineGap
   * 아래 보표 line0 = trebleY + dy + SPACE_ABOVE
   * 요구: (line0 - above) - (line4 + below) >= minClearance
   *   →  dy >= 4*lineGap + below + above + minClearance          */
  const needed = 4 * lineGap + below + above + minClearance;
  return Math.max(defaultDy, Math.ceil(needed));
}

/** 줄별 간격 → 기본값 대비 **초과분**(줄 높이에 더해야 하는 양). */
export function grandExtraPerLine(dys: readonly number[], defaultDy = GRAND_BASS_DY): number[] {
  return dys.map((d) => Math.max(0, d - defaultDy));
}
