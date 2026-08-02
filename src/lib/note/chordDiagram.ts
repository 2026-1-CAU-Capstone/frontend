/**
 * 코드 다이어그램 — 코드심볼 → 기타/우쿨렐레 프렛 그리드.
 *
 * 보이싱은 셰이프 사전이 아니라 **운지 엔진(assignTabPositions)으로 계산**한다:
 * 코드톤(루트·3·7·5, 7th 없으면 6th)을 셸 스택(R-7-3-5)으로 쌓아 여러 손
 * 위치에서 풀고, 스팬·베이스프렛이 가장 낮은 해를 고른다. 사전 없이도 관용
 * 오픈폼(C=x32010 등)이 그대로 나오는 것은 운지 엔진 검증에서 확인됨.
 *
 * 그리기는 drawFretDiagram — 에디터·뷰어가 같은 함수를 쓴다(SVG 직접 생성).
 */
import { ChordSymbol } from '../jazz-harmony';
import { assignTabPositions } from './tabFingering';

export interface FretDiagram {
  /** 현별 프렛(인덱스 0 = 1번줄·가는 줄). null = 뮤트, 0 = 개방. */
  frets: (number | null)[];
  /** 그리드 왼쪽 라벨 프렛 — 1이면 너트(개방 표기 가능). */
  baseFret: number;
}

const DIAGRAM_WINDOW = 4;   // 그리드에 보여줄 프렛 수

/** 코드심볼 → 다이어그램. 파싱 실패·해 없음이면 null. */
export function chordToDiagram(chordText: string, tuning: number[]): FretDiagram | null {
  let root = 0;
  let degrees: number[] = [];
  try {
    const c = (ChordSymbol as unknown as { parse(t: string): { rootNote: { pitch: number }; chordType: { degrees: Array<{ pitch: number }> } } }).parse(chordText);
    root = ((c.rootNote.pitch % 12) + 12) % 12;
    degrees = c.chordType.degrees.map((d) => ((d.pitch % 12) + 12) % 12);
  } catch { return null; }
  if (degrees.length === 0) return null;

  /* 셸 우선 코드톤 선택: 루트 + 3도(3|4) + 7도(10|11, 없으면 6도 9) + 5도류.
   * 4음을 넘기지 않는다 — 다이어그램은 잡을 수 있는 폼이어야 한다. */
  const has = (p: number) => degrees.includes(p);
  const third = has(4) ? 4 : has(3) ? 3 : null;
  const seventh = has(10) ? 10 : has(11) ? 11 : has(9) && third !== null ? 9 : null;
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : null;
  const rel: number[] = [0];
  if (seventh !== null) rel.push(seventh);
  if (third !== null) rel.push(third);
  if (fifth !== null && rel.length < 4) rel.push(fifth);

  /* 셸 스택으로 미디 쌓기: 루트를 저음역에 두고, 각 톤을 직전 음 위 2반음
   * 초과의 가장 가까운 옥타브에 배치(R-7-3-5 순 — 재즈 기타 관용). */
  const lowOpen = Math.min(...tuning);
  const buildMidis = (rootMidi: number): number[] => {
    const out = [rootMidi];
    for (const p of rel.slice(1)) {
      const target = (root + p) % 12;
      let m = out[out.length - 1] + 1;
      while (m % 12 !== target) m += 1;
      if (m - out[out.length - 1] < 2) m += 12;   // 단2도 겹침 회피
      out.push(m);
    }
    return out;
  };

  let best: FretDiagram | null = null;
  let bestScore = Infinity;
  for (let rootMidi = lowOpen; rootMidi <= lowOpen + 14; rootMidi++) {
    if (rootMidi % 12 !== root) continue;
    const midis = buildMidis(rootMidi);
    const pos = assignTabPositions([[midis]], tuning)[0][0];
    if (!pos || pos.some((p) => p.impossible || p.shifted)) continue;
    const fretted = pos.filter((p) => p.fret > 0).map((p) => p.fret);
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const base = fretted.length ? Math.min(...fretted) : 1;
    if (span >= DIAGRAM_WINDOW) continue;
    const score = span + base * 0.35;
    if (score < bestScore) {
      const frets: (number | null)[] = Array.from({ length: tuning.length }, () => null);
      for (const p of pos) frets[p.str - 1] = p.fret;
      bestScore = score;
      best = { frets, baseFret: base > DIAGRAM_WINDOW ? base : 1 };
    }
  }
  return best;
}

/* ─── SVG 그리기 (에디터·뷰어 공용) ─────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';

/** 프렛 다이어그램을 svg 루트에 직접 그린다. (x,y) = 좌상단, 폭 w 기준 비율 배치. */
export function drawFretDiagram(
  svgEl: SVGElement,
  x: number,
  y: number,
  w: number,
  diagram: FretDiagram,
  label: string,
): void {
  const nStr = diagram.frets.length;
  const gridW = w;
  const colGap = gridW / (nStr - 1);
  const rowGap = colGap * 0.92;
  const gridH = rowGap * DIAGRAM_WINDOW;
  const topY = y + 13;                     // 코드명 자리
  const g = document.createElementNS(NS, 'g');

  const text = (tx: number, ty: number, str: string, size: number, weight = '600', anchor = 'middle') => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(tx)); t.setAttribute('y', String(ty));
    t.setAttribute('font-size', String(size)); t.setAttribute('font-weight', weight);
    t.setAttribute('text-anchor', anchor); t.setAttribute('fill', '#333');
    t.setAttribute('font-family', "'Pretendard', sans-serif");
    t.textContent = str;
    g.appendChild(t);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number) => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', '#555'); l.setAttribute('stroke-width', String(sw));
    g.appendChild(l);
  };

  text(x + gridW / 2, y + 8, label, 10.5, '700');

  // 세로줄(현) — 인덱스 0(1번줄)이 오른쪽 (다이어그램 관례: 왼쪽=굵은 줄).
  for (let i = 0; i < nStr; i++) line(x + i * colGap, topY, x + i * colGap, topY + gridH, 1);
  // 가로줄(프렛) — 너트(baseFret 1)는 굵게.
  for (let f = 0; f <= DIAGRAM_WINDOW; f++) {
    line(x, topY + f * rowGap, x + gridW, topY + f * rowGap, f === 0 && diagram.baseFret === 1 ? 2.6 : 1);
  }
  if (diagram.baseFret > 1) text(x - 4, topY + rowGap * 0.72, String(diagram.baseFret), 8.5, '600', 'end');

  diagram.frets.forEach((fret, i) => {
    const cx = x + (nStr - 1 - i) * colGap;   // 1번줄이 오른쪽 끝
    if (fret === null) { text(cx, topY - 3, '×', 8.5, '600'); return; }
    if (fret === 0) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(topY - 6));
      c.setAttribute('r', '2.6'); c.setAttribute('fill', 'none');
      c.setAttribute('stroke', '#555'); c.setAttribute('stroke-width', '1.1');
      g.appendChild(c);
      return;
    }
    const row = fret - diagram.baseFret;      // 0-based 그리드 행
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(topY + (row + 0.5) * rowGap));
    c.setAttribute('r', String(Math.min(colGap * 0.34, 4.6)));
    c.setAttribute('fill', '#333');
    g.appendChild(c);
  });

  svgEl.appendChild(g);
}

/** 다이어그램(코드명 포함)이 차지하는 높이 — 행 높이 계산용. */
export function fretDiagramHeight(w: number, nStrings: number): number {
  const colGap = w / (nStrings - 1);
  return 13 + colGap * 0.92 * DIAGRAM_WINDOW + 6;
}
