import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Beam,
  Accidental,
  BarlineType,
} from 'vexflow';

/* ─── midi → vexflow ─────────────────────────────────────────────────── */

const LETTER  = ['c', 'd', 'd', 'e', 'e', 'f', 'g', 'g', 'a', 'a', 'b', 'b'];
const HAS_FLAT = [false, true, false, true, false, false, true, false, true, false, true, false];

function midiToVex(midi: number): { key: string; acc?: 'b' } {
  const pc = midi % 12;
  const oct = Math.floor(midi / 12) - 1;
  return { key: `${LETTER[pc]}/${oct}`, acc: HAS_FLAT[pc] ? 'b' : undefined };
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Wrap = styled.div`
  overflow-x: auto;
  padding-bottom: 40px;
  margin-bottom: 16px;
`;

/* ─── component ──────────────────────────────────────────────────────── */

interface Props {
  midis: number[];
  width: number;
}

export function MelodyPreview({ midis, width }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    if (midis.length === 0) return;

    // group into 4/4 measures (all quarter notes)
    const measures: { key: string; acc?: 'b' }[][] = [];
    let cur: { key: string; acc?: 'b' }[] = [];
    for (const m of midis) {
      cur.push(midiToVex(m));
      if (cur.length === 4) {
        measures.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) measures.push(cur);

    // Width proportional to note count, capped to container
    const CLEF_W = 50;
    const PX_PER_NOTE = 50;
    const BAR_PAD = 20;
    const barsW = measures.reduce((s, m) => s + BAR_PAD + m.length * PX_PER_NOTE, 0);
    const svgW = Math.min(width, CLEF_W + barsW);

    const STAVE_Y = 20;
    const totalH = 160;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, totalH);
    const ctx = renderer.getContext();

    let x = 0;

    for (let mi = 0; mi < measures.length; mi++) {
      const isFirst = mi === 0;
      const isLast = mi === measures.length - 1;
      const noteW = BAR_PAD + measures[mi].length * PX_PER_NOTE;
      const w = isFirst ? noteW + CLEF_W : noteW;

      const stave = new Stave(x, STAVE_Y, w);
      if (isFirst) stave.addClef('treble');
      if (isLast) stave.setEndBarType(BarlineType.END);
      stave.setContext(ctx).draw();

      const vfNotes = measures[mi].map((n) => {
        const sn = new StaveNote({ keys: [n.key], duration: 'q', autoStem: true });
        if (n.acc) sn.addModifier(new Accidental(n.acc));
        return sn;
      });

      const beams = Beam.generateBeams(vfNotes);
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setStrict(false);
      voice.addTickables(vfNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      beams.forEach((b) => b.setContext(ctx).draw());

      x += w;
    }
  }, [midis, width]);

  return <Wrap ref={ref} />;
}
