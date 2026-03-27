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

const LETTER = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
const HAS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

function midiToVex(midi: number): { key: string; acc?: '#' } {
  const pc = midi % 12;
  const oct = Math.floor(midi / 12) - 1;
  return { key: `${LETTER[pc]}/${oct}`, acc: HAS_SHARP[pc] ? '#' : undefined };
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Wrap = styled.div`
  min-height: 140px;
  overflow-x: auto;
  padding-bottom: 10px;
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
    const measures: { key: string; acc?: '#' }[][] = [];
    let cur: { key: string; acc?: '#' }[] = [];
    for (const m of midis) {
      cur.push(midiToVex(m));
      if (cur.length === 4) {
        measures.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) measures.push(cur);

    const CLEF_W = 50;
    const minBarW = 120;
    const maxBarsPerLine = Math.max(1, Math.floor((width - CLEF_W) / minBarW));
    const barsPerLine = Math.min(maxBarsPerLine, measures.length);
    const barW = barsPerLine > 0 ? (width - CLEF_W) / barsPerLine : minBarW;

    const lineCount = Math.ceil(measures.length / barsPerLine);
    const lineH = 140;
    const totalH = lineCount * lineH + 20;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(width, totalH);
    const ctx = renderer.getContext();

    for (let mi = 0; mi < measures.length; mi++) {
      const lineIdx = Math.floor(mi / barsPerLine);
      const posInLine = mi % barsPerLine;
      const isFirstInLine = posInLine === 0;
      const isLast = mi === measures.length - 1;

      const w = isFirstInLine ? barW + CLEF_W : barW;
      const x = isFirstInLine
        ? 0
        : CLEF_W + posInLine * barW;
      const y = lineIdx * lineH;

      const stave = new Stave(x, y, w);
      if (isFirstInLine) stave.addClef('treble');
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
    }
  }, [midis, width]);

  return <Wrap ref={ref} />;
}
