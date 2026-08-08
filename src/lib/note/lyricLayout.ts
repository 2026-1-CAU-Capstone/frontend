/* ─────────────────────────────────────────────────────────────────────────
 * 가사(lyrics) 작도 — 뷰어(NoteSheet)와 에디터가 **함께 쓰는 단일 구현**.
 *
 * 표준 성악 기보 관례(레퍼런스 리드시트와 동일):
 *   • 음절은 그 음표의 **머리 중앙**에 맞춰 놓는다.
 *   • 절(verse)은 위에서 아래로 쌓는다 — 1절, 2절…
 *   • 한 낱말이 여러 음절로 나뉘면(`syllabic` = begin/middle) 음절 사이에
 *     **하이픈**을 그린다. 간격이 넓으면 가운데에 하나.
 *   • 한 음절이 여러 음에 걸치면(`extend`) 오른쪽으로 **밑줄(멜리스마 선)**을 끈다.
 *
 * VexFlow 의 Annotation 을 쓰지 않는 이유: 하이픈·멜리스마 선은 **음절 사이**를
 * 잇는 요소라 음표 하나에 붙는 모디파이어로는 그릴 수 없다(볼타 브래킷과 같은
 * 이유로 여기서도 SVG 를 직접 그린다).
 * ──────────────────────────────────────────────────────────────────────── */

import type { LyricSyllable } from '../../data/sampleMelody';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 절 한 줄의 높이(px) — 폰트 크기에 맞춘 행간. */
export const LYRIC_LINE_H = 15;
/** 오선 아래끝에서 첫 절 baseline 까지의 여백(px). */
export const LYRIC_TOP_GAP = 18;
/** 가사 글자 크기(px). */
export const LYRIC_FONT_PX = 12;
const LYRIC_FONT = "'Times New Roman', 'Georgia', serif";
/** 멜리스마 선이 마지막 음표 머리를 지나 더 뻗는 길이(px). */
const MELISMA_TAIL = 10;

/** 가사가 차지하는 세로 높이 — 세로 레이아웃(줄 간격) 계산용. */
export function lyricHeight(verseCount: number): number {
  return verseCount > 0 ? LYRIC_TOP_GAP + verseCount * LYRIC_LINE_H : 0;
}

/** 한 시트/구간에 등장하는 절 번호의 최댓값(= 가사 줄 수). */
export function maxVerseCount(measures: readonly { notes: readonly { lyrics?: LyricSyllable[] }[] }[]): number {
  let max = 0;
  for (const m of measures) {
    for (const n of m.notes) {
      for (const l of n.lyrics ?? []) if (l.verse > max) max = l.verse;
    }
  }
  return max;
}

/** 작도에 필요한 음표 하나의 정보 — 렌더러(VexFlow)에서 뽑아 넘긴다. */
export interface LyricAnchor {
  /** 음표 머리의 가로 중심(SVG 좌표). */
  x: number;
  /** 이 음표에 붙은 음절들. */
  lyrics: LyricSyllable[];
}

export interface DrawLyricsOpts {
  /** 첫 절의 baseline y. */
  baselineY: number;
  /** 이 줄의 오른쪽 한계 — 멜리스마 선이 넘어가지 않게 자른다. */
  rightEdge: number;
  /** 이 줄의 **모든 음표** x(가사 없는 음 포함, 오름차순). 멜리스마 선이 어디서
   *  끝나야 하는지 정하는 데 쓴다 — 그 음절이 실제로 얹힌 마지막 음까지만 긋고,
   *  다음 낱말까지 끌지 않는다(관례). 없으면 다음 음절 직전까지 긋는다. */
  noteXs?: readonly number[];
  /** 색(선택 하이라이트 등). 기본 검정. */
  color?: string;
}

/**
 * 한 줄(system)의 가사를 그린다. `anchors` 는 **x 오름차순**이어야 한다.
 * 반환값은 그린 그룹 — 호출자가 필요하면 지우거나 색을 바꿀 수 있다.
 */
export function drawLyrics(
  parent: SVGElement,
  anchors: readonly LyricAnchor[],
  opts: DrawLyricsOpts,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'vf-lyrics');
  parent.appendChild(g);
  const color = opts.color ?? '#000';

  // 절 번호별로 나눠서, 각 절을 하나의 가로 흐름으로 처리한다.
  const verses = new Set<number>();
  for (const a of anchors) for (const l of a.lyrics) verses.add(l.verse);

  for (const verse of [...verses].sort((a, b) => a - b)) {
    const baseY = opts.baselineY + (verse - 1) * LYRIC_LINE_H;
    /** 이 절에 속한 음절들만 x 순서로. */
    const row = anchors
      .map((a) => ({ x: a.x, syl: a.lyrics.find((l) => l.verse === verse) }))
      .filter((e): e is { x: number; syl: LyricSyllable } => !!e.syl);

    // 1) 음절 텍스트 — 머리 중앙 정렬. 폭은 그린 뒤 실측한다(하이픈 위치용).
    const placed = row.map((e) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(e.x));
      t.setAttribute('y', String(baseY));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', LYRIC_FONT);
      t.setAttribute('font-size', String(LYRIC_FONT_PX));
      t.setAttribute('fill', color);
      t.textContent = e.syl.text;
      g.appendChild(t);
      let w = 0;
      try { w = (t as SVGTextElement).getComputedTextLength(); } catch { /* jsdom 등 */ }
      if (!w) w = e.syl.text.length * LYRIC_FONT_PX * 0.5;   // 측정 불가 시 근사
      return { ...e, half: w / 2 };
    });

    // 2) 하이픈 / 멜리스마 선 — 음절 **사이**를 잇는다.
    for (let i = 0; i < placed.length; i++) {
      const cur = placed[i];
      const next = placed[i + 1];
      const gapL = cur.x + cur.half + 2;
      const gapR = next ? next.x - next.half - 2 : opts.rightEdge;
      if (gapR <= gapL) continue;

      const joins = cur.syl.syllabic === 'begin' || cur.syl.syllabic === 'middle';
      if (joins && next) {
        // 낱말 안 하이픈 — 두 음절 사이 가운데 하나.
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', String((gapL + gapR) / 2));
        t.setAttribute('y', String(baseY));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-family', LYRIC_FONT);
        t.setAttribute('font-size', String(LYRIC_FONT_PX));
        t.setAttribute('fill', color);
        t.textContent = '-';
        g.appendChild(t);
      } else if (cur.syl.extend) {
        /* 멜리스마 — 그 음절이 걸친 **마지막 음표**까지만 긋는다. 다음 음절
         * 직전까지 끌면 낱말 사이가 선으로 이어져 붙어 보인다(레퍼런스는
         * 음이 끝나는 자리에서 멈춘다). */
        let end = gapR;
        if (opts.noteXs?.length) {
          const limit = next ? next.x : opts.rightEdge;
          let last = -Infinity;
          for (const nx of opts.noteXs) if (nx > cur.x && nx < limit - 1) last = nx;
          if (Number.isFinite(last)) end = Math.min(gapR, last + MELISMA_TAIL);
        }
        if (end <= gapL) continue;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(gapL));
        line.setAttribute('x2', String(end));
        line.setAttribute('y1', String(baseY + 1));
        line.setAttribute('y2', String(baseY + 1));
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '1');
        g.appendChild(line);
      }
    }
  }
  return g;
}
