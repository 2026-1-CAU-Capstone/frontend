/* 코드칸(코드 심볼/입력칸)의 세로 자리 확보 — VexFlow 렌더러 **공용** 규칙.
 *
 * ─ 문제 ─
 * 코드칸은 오선 위에 그린다. 덧줄을 타고 올라간 고음이 있으면 코드칸을 그 위로
 * 밀어 올려야 음표와 안 겹친다(chordClearance). 그런데 줄 높이가 `LINE_HEIGHT`
 * 상수로 고정돼 있으면, 밀어 올린 코드칸이 **윗줄 영역으로 침범**한다. 지금까지
 * 반복해서 보고된 "2번째 줄 코드칸이 1번째 줄 마디와 겹침"이 정확히 이것이다.
 * 기존 하한(`minY`/`CHORD_TOP_MIN`)은 **시트 맨 위**만 막을 뿐 줄 사이는 못 막는다.
 *
 * ─ 규칙 (이 모듈이 강제한다) ─
 *   1. 코드칸 아래변은 그 줄에서 가장 높은 음표 글리프보다 항상 `noteGap` 이상 위.
 *   2. 코드칸이 그만큼 올라가야 하면, **줄 자체를 아래로 밀어** 자리를 만든다.
 *      → 줄 간격이 늘어날 뿐, 코드칸이 윗줄을 침범하는 일은 발생할 수 없다.
 *   3. 따라서 줄 Y 는 `MARGIN.top + li*lineH` 같은 **균등 배치가 아니라 누적**이다.
 *
 * 계산은 **음높이 기반**이라 draw 전에 알 수 있다(bbox 는 voice.draw 이후에만
 * 유효한데, 줄 Y 는 그리기 전에 정해져야 하므로 bbox 를 쓸 수 없다).
 * 그린 뒤 bbox 로 미세 조정하더라도, 여기서 잡아둔 예약분을 넘지 않도록
 * `clampChordTop` 으로 묶으면 침범이 원천 차단된다.
 */

import type { ClearanceNote } from './chordClearance';

/** 코드칸 세로 치수 — 렌더러마다 값이 달라(입력칸 vs 글자) 주입받는다. */
export interface ChordRowMetrics {
  /** 코드칸이 차지하는 높이(입력칸 높이 또는 글자 높이). */
  rowH: number;
  /** 충돌이 없을 때 오선 첫 줄과 코드칸 아래변 사이 기본 간격. */
  staffGap: number;
  /** 음표 글리프 상단과 코드칸 아래변 사이 최소 간격. */
  noteGap: number;
}

const LETTER_DIA: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
/** 보표 맨 윗줄(line 0)에 해당하는 음 — 높은음자리표 F5 · 낮은음자리표 A3. */
const TOP_LINE_DIA = { treble: LETTER_DIA.f + 5 * 7, bass: LETTER_DIA.a + 3 * 7 } as const;

function diaOf(vexKey: string): number | null {
  const letter = vexKey[0]?.toLowerCase();
  if (letter === undefined || !(letter in LETTER_DIA)) return null;
  const oct = parseInt(vexKey.split('/')[1] ?? '', 10);
  if (!Number.isFinite(oct)) return null;
  return LETTER_DIA[letter] + oct * 7;
}

/**
 * 가장 높은 음표 글리프 상단이 **오선 첫 줄보다 몇 px 위**인지(양수 = 위).
 * 오선 안에 머무는 음은 0 이하가 나온다. 음이 없으면 0.
 *
 * `chordClearance.topNoteGlyphY` 와 같은 식이지만 절대 Y 대신 **상대 오프셋**을
 * 낸다 — 줄 Y 가 아직 안 정해진 시점(레이아웃 계산 중)에도 쓸 수 있어야 한다.
 */
export function topNoteOffsetAboveStaff(
  notes: readonly ClearanceNote[],
  lineGap: number,
  clef: 'treble' | 'bass' = 'treble',
): number {
  let maxDia = -Infinity;
  for (const n of notes) {
    if (n.grace || n.duration?.endsWith('r')) continue;
    for (const k of n.keys ?? []) {
      const d = diaOf(k);
      if (d !== null && d > maxDia) maxDia = d;
    }
  }
  if (!Number.isFinite(maxDia)) return 0;
  const steps = maxDia - TOP_LINE_DIA[clef];        // 맨 윗줄 기준 온음 칸 수(위가 +)
  // 중심은 첫 줄에서 steps/2 줄만큼 위, 글리프 상단은 거기서 반 칸 더 위.
  return Math.max(0, (steps / 2) * lineGap + lineGap / 2);
}

/** 충돌이 전혀 없을 때 코드칸이 오선 위로 차지하는 높이. */
export function defaultHeadroom(m: ChordRowMetrics): number {
  return m.rowH + m.staffGap;
}

/**
 * **한 줄**이 오선 첫 줄 위로 필요로 하는 총 높이(px).
 * 그 줄 안 모든 마디(양손이면 위 보표)의 최고음을 본다.
 */
export function lineHeadroom(
  lineNotes: readonly (readonly ClearanceNote[])[],
  lineGap: number,
  m: ChordRowMetrics,
  clef: 'treble' | 'bass' = 'treble',
): number {
  let top = 0;
  for (const notes of lineNotes) {
    const t = topNoteOffsetAboveStaff(notes, lineGap, clef);
    if (t > top) top = t;
  }
  // 음표 위로 noteGap 을 띄우고 그 위에 코드칸을 얹는다.
  return Math.max(defaultHeadroom(m), top + m.noteGap + m.rowH);
}

/**
 * 줄별 **누적 Y 오프셋**. `y[li] = base + li*lineH + offsets[li]` 로 쓴다.
 *
 * 기본 높이를 넘는 초과분만 더해 나가므로, 고음이 없는 악보는 예전과 **완전히
 * 같은 좌표**가 나온다(회귀 없음).
 */
export function cumulativeLineOffsets(headrooms: readonly number[], m: ChordRowMetrics): number[] {
  const base = defaultHeadroom(m);
  const out: number[] = [];
  let acc = 0;
  for (const h of headrooms) {
    acc += Math.max(0, h - base);
    out.push(acc);
  }
  return out;
}

/** 모든 줄의 초과분 합 — 캔버스 전체 높이에 더한다. */
export function totalExtraHeight(headrooms: readonly number[], m: ChordRowMetrics): number {
  const offs = cumulativeLineOffsets(headrooms, m);
  return offs.length ? offs[offs.length - 1] : 0;
}

/**
 * 코드칸 윗변 Y 를 **예약해 둔 범위 안으로** 묶는다.
 *
 * 그린 뒤 bbox(기둥·빔 포함)로 더 밀어 올리더라도, 이 줄에 확보해 둔 headroom 을
 * 넘어가면 윗줄을 침범한다. 그래서 상한을 둔다 — 규칙 2 를 지키는 마지막 빗장.
 *
 * @param wanted     bbox 기준으로 계산된 희망 Y(작을수록 위)
 * @param staffTopY  이 줄 오선 첫 줄 Y
 * @param headroom   이 줄에 확보된 높이(`lineHeadroom` 결과)
 */
export function clampChordTop(wanted: number, staffTopY: number, headroom: number): number {
  return Math.max(wanted, staffTopY - headroom);
}
