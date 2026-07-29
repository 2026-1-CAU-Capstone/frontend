/* 코드 심볼 ↔ 높은 음표 충돌 회피.
 *
 * 코드 라벨은 보통 보표 위 고정 높이(y+12 등)에 그린다. 그런데 덧줄을 타고
 * 올라간 고음(A5·C6 …)은 그 높이를 뚫고 올라와 코드 글자와 겹친다.
 *
 * 여기서는 **음높이로부터** 가장 높은 음표 머리의 화면 Y를 계산한다. VexFlow
 * 의 getBoundingBox() 는 voice.draw() 이후에만 유효한데, NoteSheet·Lick12Key
 * 는 코드를 음표보다 **먼저** 그리기 때문에 bbox 를 쓸 수 없다. 음높이 계산은
 * draw 순서와 무관해 모든 렌더러에서 동일하게 동작한다.
 *
 * 계산: 보표 맨 윗줄(line 0)은 높은음자리표 F5 · 낮은음자리표 A3. 온음(diatonic)
 * 한 칸은 반 줄(0.5 line)이므로, 음의 diatonic 인덱스 차이를 반 줄 단위로 환산해
 * getYForLine() 에 넣으면 그 음의 중심 Y가 나온다. 머리 높이의 절반을 더 빼서
 * 글리프 상단을 얻는다.
 */

const LETTER_DIA: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

/** 보표 맨 윗줄에 해당하는 음의 diatonic 인덱스 (letter + octave*7). */
const TOP_LINE_DIA = {
  treble: LETTER_DIA.f + 5 * 7, // F5
  bass: LETTER_DIA.a + 3 * 7,   // A3
} as const;

export interface ClearanceNote {
  keys?: string[];
  duration: string;
  grace?: boolean;
}

/** 'a/5' · 'bb/4' → diatonic 인덱스. 임시표는 세로 위치에 영향 없으므로 무시. */
function diaOf(vexKey: string): number | null {
  const letter = vexKey[0]?.toLowerCase();
  if (letter === undefined || !(letter in LETTER_DIA)) return null;
  const oct = parseInt(vexKey.split('/')[1] ?? '', 10);
  if (!Number.isFinite(oct)) return null;
  return LETTER_DIA[letter] + oct * 7;
}

/**
 * 마디에서 **가장 높은 음표 글리프의 상단 Y**(px). 쉼표·장식음은 제외하며,
 * 음이 하나도 없으면 null.
 *
 * @param getYForLine `stave.getYForLine` (스케일·위치가 이미 반영된 좌표계)
 */
export function topNoteGlyphY(
  notes: readonly ClearanceNote[],
  getYForLine: (line: number) => number,
  clef: 'treble' | 'bass' = 'treble',
): number | null {
  let maxDia = -Infinity;
  for (const n of notes) {
    if (n.grace || n.duration?.endsWith('r')) continue;
    for (const k of n.keys ?? []) {
      const d = diaOf(k);
      if (d !== null && d > maxDia) maxDia = d;
    }
  }
  if (!Number.isFinite(maxDia)) return null;

  const steps = maxDia - TOP_LINE_DIA[clef];   // 맨 윗줄 기준 온음 칸 수
  const centerY = getYForLine(-steps / 2);     // 온음 1칸 = 반 줄
  // 머리 높이 ≈ 한 줄 간격 → 상단은 중심에서 그 절반 위. 줄 간격은 stave 에서
  // 역산해 확대/축소에도 안전하게.
  const lineGap = Math.abs(getYForLine(1) - getYForLine(0)) || 10;
  return centerY - lineGap / 2;
}

/**
 * 마디에서 **가장 낮은 음표 글리프의 하단 Y**(px). 쉼표·장식음은 제외하며,
 * 음이 하나도 없으면 null. 편집 중 마디 하이라이트가 보표 아래로 내려간
 * 음표(덧줄)까지 덮어야 할 때 쓴다.
 */
export function bottomNoteGlyphY(
  notes: readonly ClearanceNote[],
  getYForLine: (line: number) => number,
  clef: 'treble' | 'bass' = 'treble',
): number | null {
  let minDia = Infinity;
  for (const n of notes) {
    if (n.grace || n.duration?.endsWith('r')) continue;
    for (const k of n.keys ?? []) {
      const d = diaOf(k);
      if (d !== null && d < minDia) minDia = d;
    }
  }
  if (!Number.isFinite(minDia)) return null;

  const steps = minDia - TOP_LINE_DIA[clef];
  const centerY = getYForLine(-steps / 2);
  const lineGap = Math.abs(getYForLine(1) - getYForLine(0)) || 10;
  return centerY + lineGap / 2;   // 머리 하단
}

/**
 * 코드 심볼 baseline Y 를 결정한다 — 기본 위치를 쓰되, 고음이 그 위로 올라오면
 * 음표 위로 밀어 올린다. `minY` 로 SVG 상단 밖으로 나가지 않게 클램프.
 *
 * @param baseY   충돌이 없을 때 쓸 기본 baseline
 * @param gap     음표 글리프 상단과 코드 baseline 사이 최소 간격
 */
export function chordBaselineY(
  notes: readonly ClearanceNote[],
  getYForLine: (line: number) => number,
  baseY: number,
  opts: { gap?: number; minY?: number; clef?: 'treble' | 'bass' } = {},
): number {
  const { gap = 6, minY = 12, clef = 'treble' } = opts;
  const top = topNoteGlyphY(notes, getYForLine, clef);
  // baseline 은 글자의 아래쪽 기준이라, 음표 상단보다 gap 만큼 더 위에 둔다.
  const lifted = top !== null && top - gap < baseY ? top - gap : baseY;
  return Math.max(lifted, minY);
}
