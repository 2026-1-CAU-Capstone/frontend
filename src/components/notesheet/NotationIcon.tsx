import { useMemo } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

const CACHE: Record<string, string> = {};

function renderGlyphSvg(durBase: string, isRest: boolean): string {
  const key = (isRest ? 'r:' : 'n:') + durBase;
  if (CACHE[key]) return CACHE[key];
  if (typeof document === 'undefined') return '';

  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.left = '-10000px';
  div.style.top = '0';
  document.body.appendChild(div);

  try {
    const renderer = new Renderer(div, Renderer.Backends.SVG);
    // Use a larger offscreen canvas so the generated SVG glyphs are higher
    // resolution and scale up crisply when we display them in the toolbar.
    renderer.resize(240, 240);
    const ctx = renderer.getContext();

    const stave = new Stave(0, 0, 80);
    stave.setContext(ctx);

    const dur = isRest ? `${durBase}r` : durBase;
    const note = new StaveNote({ keys: ['b/4'], duration: dur, stem_direction: 1 } as any);

    const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false);
    voice.addTickables([note]);
    new Formatter().joinVoices([voice]).format([voice], 40);

    note.setStave(stave);
    voice.draw(ctx, stave);

    const svg = div.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return '';

    /* 온쉼표·2분쉼표는 둘 다 같은 '작은 사각형'이라 보표선 없이는 구별이 안 된다.
     * 악보 규칙대로 기준선을 사각형에 '딱 붙여' 그린다 — 온쉼표는 선 아래에
     * 매달리고(선이 위), 2분쉼표는 선 위에 앉는다(선이 아래).
     * 글리프 좌표계에 그리므로 아이콘 배율이 달라져도 절대 떨어지지 않는다.
     * ⚠ 쉼표에만 적용 — 음표(NoteIcon) 렌더는 이 블록을 타지 않는다. */
    if (isRest && (durBase === 'w' || durBase === 'h')) {
      const r = svg.getBBox();
      const th = Math.max(r.height * 0.30, 0.7);   // 선 두께
      const ext = r.width * 0.38;                  // 좌우로 삐져나오는 길이
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      line.setAttribute('x', String(r.x - ext));
      line.setAttribute('width', String(r.width + ext * 2));
      // 간격 0 — 온쉼표는 사각형 바로 위, 2분쉼표는 바로 아래에 맞붙인다.
      line.setAttribute('y', String(durBase === 'w' ? r.y - th : r.y + r.height));
      line.setAttribute('height', String(th));
      line.setAttribute('fill', 'currentColor');
      svg.appendChild(line);
    }

    const bb = svg.getBBox();
    const pad = 0;
    let vbX = bb.x - pad;
    let vbY = bb.y - pad;
    let vbW = bb.width + pad * 2;
    let vbH = bb.height + pad * 2;
    if (!isRest && durBase !== 'w') {
      const isShortStem = durBase === 'h' || durBase === 'q';
      // ✏️ STEM_CUT: half/quarter only — shave a bit off the top of the stem.
      //   Bigger → stem shorter + head sits slightly lower in the icon.
      const cropTop = isShortStem ? bb.height * 0.15 : 0;
      vbY = bb.y + cropTop;
      vbH = bb.height - cropTop + pad;
    }
    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.removeAttribute('style');
    const html = svg.outerHTML;
    CACHE[key] = html;
    return html;
  } finally {
    document.body.removeChild(div);
  }
}

interface IconProps { type: string; width?: number; height?: number }

/* Visually scale the glyph up beyond its container by drawing it inside an
 * absolutely-positioned inner viewport that's larger than the outer span.
 * The outer span keeps its declared width/height (so layout/grid alignment
 * stay correct), and `overflow: visible` lets the bigger SVG paint outside.
 *
 *   - Notes with a stem (half/quarter/8th/16th) get scale 1.55 but are
 *     nudged DOWN so the long stem doesn't make the whole glyph look
 *     top-heavy in the button.
 *   - Whole notes are pure noteheads (no stem), so they're scaled up more
 *     aggressively and stay vertically centered.
 *   - Rests are scaled and centered like before. */
// ─────────────────────────────────────────────────────────────────────
// ✏️ ADJUST: visual size of each glyph in its toolbar button.
//   Higher number = bigger glyph. Glyph stays centered regardless.
//   May slightly overflow the button border at large values.
// ─────────────────────────────────────────────────────────────────────
const STEMMED_SCALE = 2.1;   // half, quarter (h, q) — reduced to compensate for cropTop making the glyph bigger
const LONG_STEM_SCALE = 2.8; // 8th, 16th — bumped a touch
const WHOLE_SCALE = 2.0;     // whole note (already big, no stem)
const REST_SCALE = 2.2;      // rests — bumped to match the bigger note glyphs

function GlyphSpan({
  html,
  width,
  height,
  type,
  isRest,
}: {
  html: string;
  width: number;
  height: number;
  type: string;
  isRest: boolean;
}) {
  const isWhole = !isRest && type === 'w';
  const isShortStem = !isRest && (type === 'h' || type === 'q');
  const isLongStem = !isRest && (type === '8' || type === '16');
  const scale = isRest
    ? REST_SCALE
    : isWhole
      ? WHOLE_SCALE
      : isLongStem
        ? LONG_STEM_SCALE
        : STEMMED_SCALE;
  const inner = Math.round(Math.max(width, height) * scale);
  // ✏️ HEAD_DOWN_PX: pushes half/quarter glyphs lower in the icon.
  // ✏️ LONG_UP_PX:   nudges 8th/16th glyphs slightly upward.
  //    Bigger → bigger nudge. 0 = centered.
  const HEAD_DOWN_PX = 37;
  const LONG_UP_PX = 5;
  const shiftDownPx = isShortStem ? HEAD_DOWN_PX : 0;
  const shiftUpPx = isLongStem ? LONG_UP_PX : 0;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        color: 'currentColor',
        overflow: 'visible',
        paddingTop: `${shiftDownPx}px`,
        paddingBottom: `${shiftUpPx}px`,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: inner,
          height: inner,
          pointerEvents: 'none',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </span>
  );
}

export function NoteIcon({ type, width = 40, height = 40 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, false), [type]);
  return <GlyphSpan html={html} width={width} height={height} type={type} isRest={false} />;
}

export function RestIcon({ type, width = 40, height = 40 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, true), [type]);
  return <GlyphSpan html={html} width={width} height={height} type={type} isRest={true} />;
}
