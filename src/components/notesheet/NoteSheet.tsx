import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Beam,
  Accidental,
  Dot,
  Annotation,
  Barline,
  BarlineType,
} from 'vexflow';
import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';

/* ─── constants ─────────────────────────────────────────────────────────── */

const LINE_HEIGHT = 150;
const MARGIN = { top: 10, left: 10, right: 10, bottom: 40 };
const CHORD_FONT = "'MuseJazz Text', 'DM Sans', sans-serif";
const MAX_PER_LINE = 6;
const DECOR_FIRST = 80;   // clef + key + time
const DECOR_OTHER = 40;   // clef only

/* minimum px a measure needs based on its note content */
const PX_PER_DUR: Record<string, number> = {
  w: 50, h: 35, q: 28, '8': 22, '16': 18, '32': 14,
};

function measureMinWidth(measure: MeasureInfo): number {
  let w = 18; // barline + inner padding
  for (const n of measure.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[base] ?? 24;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 10;
    if (n.dotted) w += 5;
  }
  return Math.max(w, 55);
}

/** Pack measures into lines so each line fits within availW */
function packLines(measures: MeasureInfo[], availW: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;

  for (let i = 0; i < measures.length; i++) {
    const mw = measureMinWidth(measures[i]);
    const decor = line.length === 0
      ? (lines.length === 0 ? DECOR_FIRST : DECOR_OTHER)
      : 0;

    if (line.length > 0 && (usedW + mw > availW || line.length >= MAX_PER_LINE)) {
      lines.push(line);
      line = [i];
      usedW = (lines.length === 0 ? DECOR_FIRST : DECOR_OTHER) + mw;
    } else {
      if (line.length === 0) usedW = decor;
      line.push(i);
      usedW += mw;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/* ─── styled ────────────────────────────────────────────────────────────── */

const Wrapper = styled.div`
  flex: 1;
  overflow: auto;
  background: #fff;
`;

const Header = styled.div`
  text-align: center;
  padding: 28px 20px 0;
`;

const Title = styled.h1`
  font-family: ${CHORD_FONT};
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0 0 4px;
`;

const Composer = styled.p`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.95rem;
  color: #666;
  margin: 0 0 8px;
`;

const SvgContainer = styled.div`
  width: 100%;
  padding: 0 20px 40px;
`;

/* ─── helpers ───────────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  // 'q' → 'qd', 'qr' → 'qdr'
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function buildVfNotes(measure: MeasureInfo): StaveNote[] {
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);

    const note = new StaveNote({
      keys: isRest ? ['b/4'] : n.keys,
      duration: dur,
      autoStem: true,
    });

    if (n.dotted) {
      Dot.buildAndAttach([note]);
    }

    if (!isRest && n.accidentals) {
      for (const [idx, type] of Object.entries(n.accidentals)) {
        note.addModifier(new Accidental(type), Number(idx));
      }
    }

    return note;
  });
}

/* ─── component ─────────────────────────────────────────────────────────── */

interface NoteSheetProps {
  data: NoteSheetData;
}

export function NoteSheet({ data }: NoteSheetProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  // Track container width
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setWidth(w - 40);   // subtract horizontal padding
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render notation
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !data.measures.length) return;
    el.innerHTML = '';

    const totalW = width - MARGIN.left - MARGIN.right;
    const lines = packLines(data.measures, totalW);
    const numLines = lines.length;
    const totalH = MARGIN.top + numLines * LINE_HEIGHT + MARGIN.bottom;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(width, totalH);
    const ctx = renderer.getContext();

    const [numBeats, beatValue] = data.timeSignature.split('/').map(Number);

    for (let li = 0; li < numLines; li++) {
      const indices = lines[li];
      const isFirstLine = li === 0;
      const y = MARGIN.top + li * LINE_HEIGHT;
      const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
      const availForBars = totalW - decorW;

      // Proportional widths based on note density
      const weights = indices.map((i) => measureMinWidth(data.measures[i]));
      const totalWeight = weights.reduce((s, w) => s + w, 0);

      let x = MARGIN.left;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLastBar = m === data.measures.length - 1;
        const barW = (weights[j] / totalWeight) * availForBars;
        const w = firstInLine ? barW + decorW : barW;

        // ── Stave ──
        const stave = new Stave(x, y, w);
        if (firstInLine) {
          stave.addClef('treble');
          if (data.key && data.key !== 'C') stave.addKeySignature(data.key);
          if (isFirstLine) stave.addTimeSignature(data.timeSignature);
        }
        if (isLastBar) {
          stave.setEndBarType(BarlineType.END);
        }
        stave.setContext(ctx).draw();

        // ── Notes ──
        const measure = data.measures[m];
        const vfNotes = buildVfNotes(measure);

        // Chord symbol annotation on first note
        if (measure.chord && vfNotes.length > 0) {
          const ann = new Annotation(measure.chord);
          ann.setFont(CHORD_FONT, 13, 'bold');
          ann.setVerticalJustification(Annotation.VerticalJustify.TOP);
          vfNotes[0].addModifier(ann);
        }

        // Auto-beam eighths and shorter
        const beams = Beam.generateBeams(vfNotes);

        // Voice
        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        // Format & draw
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());

        x += w;
      }
    }
  }, [data, width]);

  return (
    <Wrapper ref={wrapRef}>
      <Header>
        <Title>{data.title}</Title>
        <Composer>{data.composer}</Composer>
      </Header>
      <SvgContainer ref={svgRef} />
    </Wrapper>
  );
}
