/* 악보 **세로 배치**의 단일 규칙 — 에디터·뷰어 공용.
 *
 * ─ 문제 ─
 * 줄 높이가 `LINE_HEIGHT` 상수였다. 음표가 오선 위로(덧줄 고음·위 빔) 또는 아래로
 * (덧줄 저음·아래 빔) 아무리 뻗어도 줄 간격은 그대로라, 32분음표가 빽빽한 줄이나
 * 음역이 넓은 줄에서 아랫줄·윗줄과 겹쳤다.
 * 게다가 "위쪽 여유"와 "아래쪽 여유"를 서로 다른 식으로 재고 있어, 같은 악보가
 * 화면마다 다르게 나왔다.
 *
 * ─ 규칙 ─
 *   1. 한 줄이 세로로 차지하는 범위를 **위·아래 모두** 음높이에서 계산한다.
 *      머리·덧줄뿐 아니라 **기둥과 빔**까지 포함한다.
 *   2. 이웃한 두 줄 사이에는 항상 `minGap` 이상이 있어야 한다.
 *   3. 모자라면 **줄 간격을 벌린다**. 기본 줄 높이보다 좁아지는 일은 없다
 *      → 평범한 악보는 좌표가 1px도 안 바뀐다.
 *
 * 기둥 모델: VexFlow autoStem 은 가운데 줄보다 위인 음에 아래 기둥을 준다. 빔으로
 * 묶이면 그룹 전체가 한 방향이고, 빔은 **가장 바깥 음**이 최소 기둥 길이를 확보하도록
 * 놓인다 — 그래서 아래 방향은 최저음, 위 방향은 최고음이 기준이다.
 */

import type { ClearanceNote } from './chordClearance';

/** VexFlow 가 Stave 원점 위에 비워 두는 높이(space_above_staff_ln 4칸). */
export const SPACE_ABOVE = 40;
/** 기둥 길이 — VexFlow 기본값(오선 3.5칸). */
const STEM_LEN_LINES = 3.5;
/** 이웃 줄 사이 최소 여백(px). */
export const LINE_MIN_GAP = 10;

/** 빔 한 겹이 차지하는 세로 간격(오선 칸 단위) — 두께 + 사이 여백. */
const BEAM_PITCH_LINES = 0.7;

const LETTER_DIA: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
const TOP_LINE_DIA = { treble: LETTER_DIA.f + 5 * 7, bass: LETTER_DIA.a + 3 * 7 } as const;

/** 빔 겹 수 — 8분 1, 16분 2, 32분 3, 64분 4. 그 외 0. */
function beamCount(duration: string | undefined): number {
  switch ((duration ?? '').replace(/r$/, '')) {
    case '8': return 1;
    case '16': return 2;
    case '32': return 3;
    case '64': return 4;
    default: return 0;
  }
}

export type LayoutClef = 'treble' | 'bass';

function diaOf(vexKey: string): number | null {
  const letter = vexKey[0]?.toLowerCase();
  if (letter === undefined || !(letter in LETTER_DIA)) return null;
  const oct = parseInt(vexKey.split('/')[1] ?? '', 10);
  if (!Number.isFinite(oct)) return null;
  return LETTER_DIA[letter] + oct * 7;
}

/** 오선 밖으로 뻗은 양(px). `above` = line0 위로, `below` = line4 아래로. 둘 다 >= 0. */
export interface StaffExtent { above: number; below: number }

export const NO_EXTENT: StaffExtent = { above: 0, below: 0 };

/**
 * 마디들의 내용이 오선 밖으로 얼마나 뻗는지 — 머리·덧줄 + 기둥/빔까지.
 * 쉼표·장식음은 제외한다.
 */
export function staffExtent(
  measures: readonly (readonly ClearanceNote[])[],
  lineGap: number,
  clef: LayoutClef = 'treble',
): StaffExtent {
  let hi = -Infinity; let lo = Infinity;
  let maxBeams = 0;
  for (const notes of measures) {
    for (const n of notes) {
      if (n.grace || n.duration?.endsWith('r')) continue;
      const b = beamCount(n.duration);
      if (b > maxBeams) maxBeams = b;
      for (const k of n.keys ?? []) {
        const d = diaOf(k);
        if (d === null) continue;
        if (d > hi) hi = d;
        if (d < lo) lo = d;
      }
    }
  }
  if (!Number.isFinite(hi)) return NO_EXTENT;

  const topLine = TOP_LINE_DIA[clef];
  const bottomLine = topLine - 8;   // 한 줄 = 2 diatonic
  const middleLine = topLine - 4;
  /* 빔이 여러 겹이면(16·32·64분) 그 두께만큼 기둥이 더 길어진다 — VexFlow 가
   * 빔을 쌓을 자리를 만들려고 늘린다. 이걸 빼먹으면 32분음표가 빽빽한 줄에서
   * 실제보다 얕게 잡혀 아랫줄과 겹친다(실측된 원인). */
  const stem = STEM_LEN_LINES * lineGap + Math.max(0, maxBeams - 1) * BEAM_PITCH_LINES * lineGap;

  // 위: 최고음 머리 위끝. 위 기둥이면 최고음에서 기둥만큼 더.
  const headTop = ((hi - topLine) / 2) * lineGap + lineGap / 2;
  const stemTop = lo <= middleLine ? ((hi - topLine) / 2) * lineGap + stem : -Infinity;
  // 아래: 최저음 머리 아래끝. 아래 기둥이면 최저음에서 기둥만큼 더.
  const headBottom = ((bottomLine - lo) / 2) * lineGap + lineGap / 2;
  const stemBottom = hi > middleLine ? ((bottomLine - lo) / 2) * lineGap + stem : -Infinity;

  return {
    above: Math.max(0, headTop, stemTop),
    below: Math.max(0, headBottom, stemBottom),
  };
}

/** 두 범위의 합집합 — 한 줄에 보표가 여러 개일 때. */
export function mergeExtent(a: StaffExtent, b: StaffExtent): StaffExtent {
  return { above: Math.max(a.above, b.above), below: Math.max(a.below, b.below) };
}

/** 한 줄의 세로 정보 — 전부 그 줄 **Stave 원점 기준** px. */
export interface LineBox {
  /** 코드칸이 맨 위 오선 line0 위로 필요로 하는 높이(없으면 0). */
  chordRow: number;
  /** 맨 위 보표 내용이 line0 위로 뻗는 양. */
  above: number;
  /** 맨 아래 보표의 line4 가 줄 원점에서 얼마나 아래인지(단일 보표면 SPACE_ABOVE+4*lineGap). */
  bottomLine4: number;
  /** 맨 아래 보표 내용이 그 line4 아래로 뻗는 양. */
  below: number;
}

/** 줄 원점 기준, 내용의 **맨 위** 오프셋(음수 = 원점보다 위). */
export function boxTop(b: LineBox): number {
  return SPACE_ABOVE - Math.max(b.chordRow, b.above);
}

/** 줄 원점 기준, 내용의 **맨 아래** 오프셋. */
export function boxBottom(b: LineBox): number {
  return b.bottomLine4 + b.below;
}

/**
 * 줄 i 원점 → 줄 i+1 원점 거리들(길이 = lines.length - 1).
 *
 * `baseLineH` 보다 작아지지 않는다 — 넓힐 수만 있고 좁히지 않는다.
 */
export function lineSpacings(
  lines: readonly LineBox[], baseLineH: number, minGap = LINE_MIN_GAP,
): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    // 다음 줄 내용의 맨 위가, 이 줄 내용의 맨 아래보다 minGap 이상 밑에 오도록.
    const need = boxBottom(lines[i]) + minGap - boxTop(lines[i + 1]);
    out.push(Math.max(baseLineH, Math.ceil(need)));
  }
  return out;
}

/** 각 줄의 원점 Y. 첫 줄은 위로 삐져나가지 않게 상단 여백 안에서 내려 잡는다. */
export function lineOrigins(
  lines: readonly LineBox[], baseLineH: number, marginTop: number, minGap = LINE_MIN_GAP,
): number[] {
  if (lines.length === 0) return [];
  const spacings = lineSpacings(lines, baseLineH, minGap);
  const first = marginTop + Math.max(0, -boxTop(lines[0]));
  const out = [first];
  for (let i = 0; i < spacings.length; i++) out.push(out[i] + spacings[i]);
  return out;
}

/** 캔버스 전체 높이 — 마지막 줄이 아래로 뻗는 양까지 포함한다. */
export function sheetHeight(
  lines: readonly LineBox[], origins: readonly number[], marginBottom: number,
): number {
  if (lines.length === 0) return marginBottom;
  const last = lines.length - 1;
  return Math.ceil(origins[last] + boxBottom(lines[last]) + marginBottom);
}
