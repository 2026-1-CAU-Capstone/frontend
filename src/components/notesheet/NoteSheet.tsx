import { useEffect, useRef, useState, useCallback } from 'react';
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
  BarlineType,
} from 'vexflow';
import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
import { NotePlayer } from '../../lib/note/notePlayer';

/* ─── constants ─────────────────────────────────────────────────────────── */

const LINE_HEIGHT = 170;
const MARGIN = { top: 40, left: 10, right: 10, bottom: 40 };
const CHORD_FONT = "'MuseJazz Text', 'DM Sans', sans-serif";

function formatChord(raw: string): string {
  return raw
    .replace(/j7/g, '\u25B37')
    .replace(/(?<=[A-G])b(?=[^a-z]|$)/g, '\u266D')
    .replace(/(\d)b/g, '$1\u266D')
    .replace(/b(\d)/g, '\u266D$1')
    .replace(/(\d)#/g, '$1\u266F')
    .replace(/#(\d)/g, '\u266F$1')
    .replace(/-/g, 'm')
    .replace(/o7/g, '\u00B07')
    .replace(/o(?!\d)/g, '\u00B0');
}
const MAX_PER_LINE = 6;
const DECOR_FIRST = 80;
const DECOR_OTHER = 40;
const HL_COLOR = 'rgba(212, 168, 67, 0.15)';

const PX_PER_DUR: Record<string, number> = {
  w: 50, h: 35, q: 28, '8': 22, '16': 18, '32': 14,
};

function measureMinWidth(measure: MeasureInfo): number {
  let w = 18;
  for (const n of measure.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[base] ?? 24;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 10;
    if (n.dotted) w += 5;
  }
  return Math.max(w, 55);
}

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
  margin: 0 0 0;
`;

/* ── transport bar ──────────────────────────────────────────────────────── */

const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
`;

const TBtn = styled.button<{ $active?: boolean }>`
  font-size: 1.1rem;
  line-height: 1;
  background: ${({ $active }) => ($active ? '#f0e8d0' : '#fafafa')};
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  color: #333;
  transition: background 0.12s;
  &:hover { background: #f0f0f0; }
`;

const TempoWrap = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  color: #888;
  margin-left: 6px;
`;

const TempoInput = styled.input`
  width: 52px;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  text-align: center;
  outline: none;
  &:focus { border-color: #aaa; }
`;

const SvgContainer = styled.div`
  width: 100%;
  padding: 0 20px 40px;
`;

/* ─── helpers ───────────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
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

  /* ── player state ────────────────────────────────────────────────── */
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(data.tempo ?? 120);
  const [activeMeasure, setActiveMeasure] = useState(-1);
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);

  // init / cleanup player
  useEffect(() => {
    const p = new NotePlayer();
    p.onMeasure = (idx) => setActiveMeasure(idx);
    p.onDone = () => { setPlaying(false); setActiveMeasure(-1); };
    playerRef.current = p;
    return () => p.dispose();
  }, []);

  // stop on song change & sync tempo
  useEffect(() => {
    playerRef.current?.stop();
    setPlaying(false);
    setActiveMeasure(-1);
    setTempo(data.tempo ?? 120);
  }, [data]);

  const togglePlay = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      await p.play(data, tempo);
    }
  }, [data, tempo]);

  const handleStop = useCallback(() => {
    playerRef.current?.stop();
    setPlaying(false);
    setActiveMeasure(-1);
  }, []);

  /* ── measure highlight (SVG manipulation) ────────────────────────── */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;

    svg.querySelector('.m-hl')?.remove();

    const r = measureRectsRef.current[activeMeasure];
    if (activeMeasure < 0 || !r) return;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'm-hl');
    rect.setAttribute('x', String(r.x));
    rect.setAttribute('y', String(r.y + 10));
    rect.setAttribute('width', String(r.w));
    rect.setAttribute('height', String(LINE_HEIGHT - 20));
    rect.setAttribute('fill', HL_COLOR);
    rect.setAttribute('rx', '4');
    svg.insertBefore(rect, svg.firstChild);
  }, [activeMeasure]);

  /* ── auto-scroll to active measure ────────────────────────────────── */
  useEffect(() => {
    if (activeMeasure < 0) return;
    const r = measureRectsRef.current[activeMeasure];
    const wrap = wrapRef.current;
    if (!r || !wrap) return;

    const headerH = 120; // approx header + transport height
    const targetY = r.y + headerH;
    const viewH = wrap.clientHeight;
    if (targetY < wrap.scrollTop + 40 || targetY + LINE_HEIGHT > wrap.scrollTop + viewH - 40) {
      wrap.scrollTo({ top: Math.max(0, targetY - viewH / 3), behavior: 'smooth' });
    }
  }, [activeMeasure]);

  /* ── track container width ────────────────────────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setWidth(w - 40);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── render notation ──────────────────────────────────────────────── */
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

    // reset measure rects
    const rects: { x: number; y: number; w: number }[] = [];

    for (let li = 0; li < numLines; li++) {
      const indices = lines[li];
      const isFirstLine = li === 0;
      const isLastLine = li === numLines - 1;
      const y = MARGIN.top + li * LINE_HEIGHT;
      const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
      const availForBars = totalW - decorW;

      const weights = indices.map((i) => measureMinWidth(data.measures[i]));
      const totalWeight = weights.reduce((s, w) => s + w, 0);

      // Last line: don't stretch — use natural widths (with slight padding)
      const stretchLastLine = !isLastLine || indices.length >= MAX_PER_LINE;

      let x = MARGIN.left;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLastBar = m === data.measures.length - 1;
        const barW = stretchLastLine
          ? (weights[j] / totalWeight) * availForBars
          : weights[j] * 1.3;
        const w = firstInLine ? barW + decorW : barW;

        // track rect for highlighting
        rects[m] = { x, y, w };

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

        if (measure.chord && vfNotes.length > 0) {
          const ann = new Annotation(formatChord(measure.chord));
          ann.setFont(CHORD_FONT, 13, 'bold');
          ann.setVerticalJustification(Annotation.VerticalJustify.TOP);
          vfNotes[0].addModifier(ann);
        }

        const beams = Beam.generateBeams(vfNotes);

        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());

        x += w;
      }
    }

    measureRectsRef.current = rects;
  }, [data, width]);

  /* ─── render ──────────────────────────────────────────────────────── */

  return (
    <Wrapper ref={wrapRef}>
      <Header>
        <Title>{data.title}</Title>
        <Composer>{data.composer}</Composer>
      </Header>

      <Transport>
        <TBtn $active={playing} onClick={togglePlay}>
          {playing ? '\u23F8' : '\u25B6'}
        </TBtn>
        <TBtn onClick={handleStop}>{'\u23F9'}</TBtn>
        <TempoWrap>
          BPM
          <TempoInput
            type="number"
            value={tempo}
            min={40}
            max={300}
            onChange={(e) => setTempo(Math.max(40, Math.min(300, Number(e.target.value) || 120)))}
          />
        </TempoWrap>
      </Transport>

      <SvgContainer ref={svgRef} />
    </Wrapper>
  );
}
