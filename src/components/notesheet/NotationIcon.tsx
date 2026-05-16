import { useMemo } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

/* Render a single VexFlow note/rest glyph offscreen, measure its bbox, and
 * return an SVG string tightly cropped to that bbox. Cached per (type, isRest).
 * Result is injected via dangerouslySetInnerHTML so each icon button shows
 * real engraved musical notation instead of hand-drawn approximations. */

const CACHE: Record<string, string> = {};

function renderGlyphSvg(durBase: string, isRest: boolean): string {
  const key = (isRest ? 'r:' : 'n:') + durBase;
  if (CACHE[key]) return CACHE[key];
  if (typeof document === 'undefined') return '';

  const div = document.createElement('div');
  // Must be in DOM with non-zero layout for getBBox(); render off-screen.
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.left = '-10000px';
  div.style.top = '0';
  document.body.appendChild(div);

  try {
    const renderer = new Renderer(div, Renderer.Backends.SVG);
    renderer.resize(80, 80);
    const ctx = renderer.getContext();

    const stave = new Stave(0, 0, 80);
    stave.setContext(ctx);
    // Intentionally do NOT call stave.draw() — we only need it for note layout,
    // not for rendering staff lines.

    const dur = isRest ? `${durBase}r` : durBase;
    const note = new StaveNote({
      keys: ['b/4'],
      duration: dur,
      stem_direction: 1, // force stem UP for icon clarity
    } as ConstructorParameters<typeof StaveNote>[0]);

    const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false);
    voice.addTickables([note]);
    new Formatter().joinVoices([voice]).format([voice], 40);

    note.setStave(stave);
    voice.draw(ctx, stave);

    const svg = div.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return '';
    
    // Instead of tightly cropping each note causing inconsistent scaling,
    // we use a fixed viewBox aligned to the stave's b/4 line (centered).
    // The notehead is roughly at x=20~40, y=60 (or around there).
    // Let's measure X tightly to remove horizontal whitespace,
    // but fix the height and vertical alignment so all notes scale equally!
    const bb = svg.getBBox();
    const pad = 2;
    // Fix vertical extents (e.g., from y=10 to y=80 which is height 70)
    // to ensure stems and rests fit, and the scale remains consistent.
    const cy = 60; // Approximate y-coordinate of b/4 line
    const fixedHeight = 84; 
    const fixedY = 16;
    
    svg.setAttribute(
      'viewBox',
      `${bb.x - pad} ${fixedY} ${bb.width + pad * 2} ${fixedHeight}`
    );
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

interface IconProps {
  type: string;
  width?: number;
  height?: number;
}

export function NoteIcon({ type, width = 44, height = 64 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, false), [type]);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width, height, color: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function RestIcon({ type, width = 32, height = 44 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, true), [type]);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width, height, color: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
