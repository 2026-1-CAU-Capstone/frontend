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

    const bb = svg.getBBox();
    const pad = 2;
    let vbX = bb.x - pad;
    let vbY = bb.y - pad;
    let vbW = bb.width + pad * 2;
    let vbH = bb.height + pad * 2;
    if (!isRest && durBase !== 'w') {
      // Crop the top of the stem so the note head sits in the lower-centre of
      // the icon. The fraction is chosen to show enough flag for 8th/16th notes
      // while moving the head into the visible area of any reasonable button size.
      const cropTop = bb.height * 0.28;
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

export function NoteIcon({ type, width = 40, height = 40 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, false), [type]);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width, height, color: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function RestIcon({ type, width = 40, height = 40 }: IconProps) {
  const html = useMemo(() => renderGlyphSvg(type, true), [type]);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width, height, color: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
