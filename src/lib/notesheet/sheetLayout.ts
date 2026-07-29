/* 악보 줄바꿈(line packing)과 마디 폭 산출 — VexFlow 렌더러 공용 모듈.
 *
 * 배경: EditorPage / SoloGeneratorPage / LickInputPage / LickCreator 가 각자
 * 같은 로직을 복붙해 쓰고 있었고, 마디 폭을 `{ w:90, h:64, q:42, '8':26 … }`
 * 같은 자체 추정 테이블로 계산했다. 그 값은 VexFlow가 실제로 필요로 하는 폭
 * (글리프 폭·최소 간격·임시표 충돌 회피)과 무관해서 두 가지 증상을 낳았다:
 *   1) 과소추정 → 한 줄에 마디가 너무 많이 묶임 → 비례 배분에서 압축 →
 *      음표가 stave 오른쪽 경계를 넘어 그려짐(오선 밖으로 삐져나옴)
 *   2) 음길이에만 비례하고 임시표를 거의 반영 안 함 → 임시표 많은 마디는
 *      뭉치고 단순한 마디는 헐거워짐(간격 불규칙)
 * 그래서 폭은 VexFlow 자신의 `preCalculateMinTotalWidth`로 실측한다. */
import { Formatter, Voice, type StaveNote } from 'vexflow';

/** 마디 좌우 여백 + barline 글리프 몫. 실측 최소폭에 더해 숨통을 틔운다. */
export const BAR_PADDING = 22;
/** 음표가 없거나 측정 불가일 때의 최소 마디 폭. */
export const MIN_BAR_W = 150;

/**
 * VexFlow가 이 음표들을 그리는 데 실제로 필요한 최소 폭(px).
 *
 * 브라우저에서는 실제 글리프 메트릭을 쓰므로 정확하다. 측정용으로 임시 Voice를
 * 만들기 때문에, 넘기는 StaveNote는 **렌더에 쓸 것과 별개 인스턴스**여야 한다
 * (같은 노트를 두 Voice에 넣으면 tickContext가 덮어써진다).
 */
export function minWidthForNotes(notes: StaveNote[], numBeats = 4, beatValue = 4): number {
  if (notes.length === 0) return 0;
  try {
    const voice = new Voice({ numBeats, beatValue });
    voice.setStrict(false);
    voice.addTickables(notes);
    const fmt = new Formatter();
    fmt.joinVoices([voice]);
    return fmt.preCalculateMinTotalWidth([voice]);
  } catch {
    // 측정 실패(메트릭 미준비 등)해도 렌더는 계속돼야 한다 — 호출부가 MIN_BAR_W로 폴백.
    return 0;
  }
}

/** 음길이별 대략 폭 — 구 휴리스틱. 이제 주 계산이 아니라 **안전 하한선**이다. */
const NOTE_W: Record<string, number> = { w: 90, h: 64, q: 42, '8': 26, '16': 18, '32': 14, '64': 12 };

/**
 * 구 휴리스틱 폭. `minWidthForNotes`가 어떤 이유로든(폰트 메트릭 미준비 등)
 * 과소 보고할 때 대비한 하한선으로만 쓴다 — 단독으로는 부정확하다.
 */
export function heuristicWidth(notes: readonly {
  duration: string; dotted?: boolean | null; tuplet?: number | null;
  accidentals?: Record<string, string> | null;
}[]): number {
  if (notes.length === 0) return 0;
  let w = 0;
  for (const n of notes) {
    let nw = NOTE_W[n.duration.replace(/r$/, '')] ?? 26;
    if (n.dotted) nw *= 1.4;
    if (n.tuplet && n.tuplet >= 3) nw *= 0.85;
    if (n.accidentals?.[0]) nw += 6;
    w += nw;
  }
  return w;
}

/**
 * 실측 최소폭에 여백을 더해 실제 배정 폭으로 바꾼다.
 *
 * `floor`(구 휴리스틱)를 함께 받아 둘 중 큰 값을 쓴다. 실측이 정상일 때는
 * 실측이 이기고(= 넘침·간격 문제 해결), 실측이 실패하거나 과소 보고하면
 * 기존 동작으로 안전하게 되돌아간다. 즉 이 변경은 **기존보다 나빠질 수 없다**.
 */
export function barWidthFromMin(minW: number, floor = 0): number {
  return Math.max(minW + BAR_PADDING, floor + BAR_PADDING, MIN_BAR_W);
}

export interface PackOptions {
  /** 첫 줄 첫 마디의 클레프+조표+박자표 몫. */
  decorFirst: number;
  /** 둘째 줄 이후 첫 마디의 클레프(+조표) 몫. */
  decorOther: number;
  /** 한 줄 최대 마디 수. */
  maxPerLine: number;
}

/**
 * 마디들을 줄 단위로 묶는다. 반환값은 줄별 마디 인덱스 배열이며 원래 순서를
 * 보존한다(임시표 상태가 마디 순서대로 전파되므로 이 보장이 중요하다).
 */
export function packLines(widths: number[], availW: number, opts: PackOptions): number[][] {
  const { decorFirst, decorOther, maxPerLine } = opts;
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;
  for (let i = 0; i < widths.length; i++) {
    const mw = widths[i];
    const decor = line.length === 0 ? (lines.length === 0 ? decorFirst : decorOther) : 0;
    if (line.length > 0 && (usedW + mw > availW || line.length >= maxPerLine)) {
      lines.push(line);
      line = [i];
      // 새 줄의 장식 폭은 "이미 푸시된 줄 수" 기준으로 정해진다.
      usedW = (lines.length === 0 ? decorFirst : decorOther) + mw;
    } else {
      if (line.length === 0) usedW = decor;
      line.push(i);
      usedW += mw;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}
