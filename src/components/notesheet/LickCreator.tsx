import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  BarlineType,
} from 'vexflow';
import type { NoteSheetData, NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import { PianoKeyboard, type PianoNote } from './PianoKeyboard';
import { NotePlayer } from '../../lib/note/notePlayer';

/* ─── duration helpers ───────────────────────────────────────────────── */

const DUR_BEATS: Record<string, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25,
};

const DUR_KEYS = [
  { value: 'w', title: 'Whole (4 beats)' },
  { value: 'h', title: 'Half (2 beats)' },
  { value: 'q', title: 'Quarter (1 beat)' },
  { value: '8', title: 'Eighth (½ beat)' },
  { value: '16', title: '16th (¼ beat)' },
];

/* SVG note icons — renders identically on all systems */
function NoteIcon({ type }: { type: string }) {
  const filled = type !== 'w' && type !== 'h';
  const hasStem = type !== 'w';
  const flags = type === '8' ? 1 : type === '16' ? 2 : 0;
  const cx = hasStem ? 5.5 : 7;
  const cy = hasStem ? 19 : 12;
  return (
    <svg width="14" height="24" viewBox="0 0 14 24" style={{ display: 'block' }}>
      <ellipse cx={cx} cy={cy} rx="5" ry="3.5"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={filled ? 0 : 1.5}
        transform={`rotate(-20 ${cx} ${cy})`} />
      {hasStem && <line x1="10" y1="18" x2="10" y2="3" stroke="currentColor" strokeWidth="1.3" />}
      {flags >= 1 && <path d="M10 3 C13.5 5.5 13.5 9 10 10.5" stroke="currentColor" strokeWidth="1.3" fill="none" />}
      {flags >= 2 && <path d="M10 7 C13.5 9.5 13.5 13 10 14.5" stroke="currentColor" strokeWidth="1.3" fill="none" />}
    </svg>
  );
}

function RestIcon() {
  return (
    <svg width="10" height="20" viewBox="0 0 10 20" style={{ display: 'block' }}>
      <path d="M7 2 L3 8 L7 12 L3 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getBeats(dur: string, dotted?: boolean): number {
  const base = dur.replace(/r$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (dotted) b *= 1.5;
  return b;
}

function notesToMeasures(notes: NoteInfo[]): MeasureInfo[] {
  const measures: MeasureInfo[] = [];
  let cur: NoteInfo[] = [];
  let beats = 0;

  for (const n of notes) {
    const b = getBeats(n.duration, n.dotted);
    if (beats + b > 4 + 0.001 && cur.length > 0) {
      measures.push({ notes: cur });
      cur = [];
      beats = 0;
    }
    cur.push(n);
    beats += b;
    if (Math.abs(beats - 4) < 0.001) {
      measures.push({ notes: cur });
      cur = [];
      beats = 0;
    }
  }
  if (cur.length > 0) measures.push({ notes: cur });
  return measures;
}

/* ─── analysis helpers ────────────────────────────────────────────────── */

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function vexToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI_MAP[n] ?? 0;
  if (acc === '#') s += 1;
  if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

function fuzzyInterval(iv: number): number {
  const abs = Math.abs(iv);
  const sign = iv > 0 ? 1 : iv < 0 ? -1 : 0;
  if (abs === 0) return 0;
  if (abs <= 2) return sign;
  if (abs <= 4) return 2 * sign;
  if (abs <= 7) return 3 * sign;
  return 4 * sign;
}

function durationClass(dur: string, dotted?: boolean): number {
  const base = dur.replace(/r$/, '');
  let beats = DUR_BEATS[base] ?? 1;
  if (dotted) beats *= 1.5;
  if (beats >= 2) return 2;
  if (beats >= 1) return 1;
  if (beats >= 0.5) return 0;
  if (beats >= 0.25) return -1;
  return -2;
}

interface Analysis {
  pitches: number[];
  pitchClasses: number[];
  intervals: number[];
  parsons: number[];
  fuzzyIntervals: number[];
  durClasses: number[];
}

function computeAnalysis(notes: NoteInfo[]): Analysis | null {
  const pitched = notes.filter((n) => !n.duration.endsWith('r'));
  if (pitched.length === 0) return null;

  const pitches = pitched.map((n) => vexToMidi(n.keys[0], n.accidentals?.[0]));
  const pitchClasses = pitches.map((p) => p % 12);

  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i++) intervals.push(pitches[i] - pitches[i - 1]);

  const parsons = intervals.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0));
  const fuzzyInts = intervals.map(fuzzyInterval);
  const durClasses = pitched.map((n) => durationClass(n.duration, n.dotted));

  return { pitches, pitchClasses, intervals, parsons, fuzzyIntervals: fuzzyInts, durClasses };
}

/* ─── VexFlow rendering ──────────────────────────────────────────────── */

const LINE_HEIGHT = 120;
const MARGIN = { top: 6, left: 10, right: 10, bottom: 10 };
const MAX_PER_LINE = 6;
const DECOR_FIRST = 70;
const DECOR_OTHER = 35;
const PX_PER_DUR: Record<string, number> = {
  w: 50, h: 35, q: 28, '8': 22, '16': 18,
};

function measureMinWidth(m: MeasureInfo): number {
  let w = 18;
  for (const n of m.notes) {
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
    const decor = line.length === 0 ? (lines.length === 0 ? DECOR_FIRST : DECOR_OTHER) : 0;
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

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number) {
  el.innerHTML = '';
  if (measures.length === 0) return;

  const totalW = width - MARGIN.left - MARGIN.right;
  const lines = packLines(measures, totalW);
  const totalH = MARGIN.top + lines.length * LINE_HEIGHT + MARGIN.bottom;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, totalH);
  const ctx = renderer.getContext();

  for (let li = 0; li < lines.length; li++) {
    const indices = lines[li];
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;
    const y = MARGIN.top + li * LINE_HEIGHT;
    const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
    const availForBars = totalW - decorW;
    const weights = indices.map((i) => measureMinWidth(measures[i]));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const stretch = !isLastLine || indices.length >= MAX_PER_LINE;

    let x = MARGIN.left;
    for (let j = 0; j < indices.length; j++) {
      const m = indices[j];
      const firstInLine = j === 0;
      const isLastBar = m === measures.length - 1;
      const barW = stretch
        ? (weights[j] / totalWeight) * availForBars
        : weights[j] * 1.3;
      const w = firstInLine ? barW + decorW : barW;

      const stave = new Stave(x, y, w);
      if (firstInLine) {
        stave.addClef('treble');
        if (isFirstLine) stave.addTimeSignature('4/4');
      }
      if (isLastBar) stave.setEndBarType(BarlineType.END);
      stave.setContext(ctx).draw();

      const measure = measures[m];
      const vfNotes = measure.notes.map((n) => {
        const isRest = n.duration.endsWith('r');
        const dur = buildDuration(n.duration, n.dotted);
        const note = new StaveNote({
          keys: isRest ? ['b/4'] : n.keys,
          duration: dur,
          autoStem: true,
        });
        if (n.dotted) Dot.buildAndAttach([note]);
        if (!isRest && n.accidentals) {
          for (const [idx, type] of Object.entries(n.accidentals)) {
            note.addModifier(new Accidental(type), Number(idx));
          }
        }
        return note;
      });

      const beams = Beam.generateBeams(vfNotes);
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setStrict(false);
      voice.addTickables(vfNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      beams.forEach((bm) => bm.setContext(ctx).draw());

      x += w;
    }
  }
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  flex-wrap: wrap;
`;

const SectionLabel = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-right: 2px;
`;

const DurBtn = styled.button<{ $active?: boolean }>`
  font-size: 1.15rem;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ $active, theme }) => ($active ? '#b8960a' : theme.colors.border)};
  border-radius: 5px;
  background: ${({ $active }) => ($active ? '#f5ecd0' : 'transparent')};
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover {
    background: #f0ebe0;
  }
`;

const Sep = styled.div`
  width: 1px;
  height: 24px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 4px;
`;

const ActionBtn = styled.button`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  padding: 5px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover {
    background: #f0f0f0;
  }
`;

const SaveBtn = styled(ActionBtn)`
  background: #2a6e3f;
  color: #fff;
  border-color: #2a6e3f;
  &:hover {
    background: #1f5530;
  }
`;

const Spacer = styled.div`
  flex: 1;
`;

const InfoText = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.73rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SheetArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px;
  min-height: 140px;
`;

const EmptyHint = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  opacity: 0.5;
`;

const PianoArea = styled.div`
  padding: 14px 0 12px;
  overflow-x: auto;
  display: flex;
  justify-content: center;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const KeyHint = styled.div`
  text-align: center;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.68rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.5;
  padding-bottom: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const AnalysisPanel = styled.div`
  padding: 6px 16px 8px;
  overflow-x: auto;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const AnalysisRow = styled.div`
  display: flex;
  align-items: center;
  min-height: 19px;
`;

const RowLabel = styled.span`
  width: 72px;
  flex-shrink: 0;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.64rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: right;
  padding-right: 6px;
`;

const ACell = styled.span<{ $color?: string }>`
  min-width: 32px;
  text-align: center;
  padding: 0 2px;
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: 0.66rem;
  color: ${({ $color }) => $color ?? 'inherit'};
`;

/* ─── component ──────────────────────────────────────────────────────── */

interface LickCreatorProps {
  width: number;
  onSave: (data: NoteSheetData) => void;
  onCancel: () => void;
}

export function LickCreator({ width, onSave, onCancel }: LickCreatorProps) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [duration, setDuration] = useState('q');
  const [dotted, setDotted] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  const measures = useMemo(() => notesToMeasures(notes), [notes]);
  const analysis = useMemo(() => computeAnalysis(notes), [notes]);

  /* ── add note from piano ─────────────────────────────────────────── */
  const handleNotePress = useCallback(
    (pn: PianoNote) => {
      const ni: NoteInfo = {
        keys: [pn.vexKey],
        duration,
        dotted: dotted || undefined,
      };
      if (pn.acc) ni.accidentals = { 0: pn.acc };
      setNotes((prev) => [...prev, ni]);
    },
    [duration, dotted],
  );

  /* ── add rest ────────────────────────────────────────────────────── */
  const handleRest = useCallback(() => {
    setNotes((prev) => [
      ...prev,
      { keys: ['b/4'], duration: duration + 'r', dotted: dotted || undefined },
    ]);
  }, [duration, dotted]);

  /* ── undo / clear ────────────────────────────────────────────────── */
  const handleUndo = useCallback(() => setNotes((p) => p.slice(0, -1)), []);
  const handleClear = useCallback(() => setNotes([]), []);

  /* ── backspace for undo ──────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo]);

  /* ── play ─────────────────────────────────────────────────────────── */
  const sheetData = useMemo<NoteSheetData>(
    () => ({
      title: 'My Lick',
      composer: 'Me',
      key: 'C',
      timeSignature: '4/4',
      tempo: 120,
      measures,
    }),
    [measures],
  );

  const handlePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer();
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing) {
      p.stop();
      setPlaying(false);
    } else if (measures.length > 0) {
      setPlaying(true);
      await p.play(sheetData, 120);
    }
  }, [measures, sheetData]);

  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  /* ── save ──────────────────────────────────────────────────────────── */
  const handleSave = useCallback(() => {
    if (measures.length === 0) return;
    onSave(sheetData);
  }, [measures, sheetData, onSave]);

  /* ── render VexFlow ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (measures.length === 0) {
      el.innerHTML = '';
      return;
    }
    renderSheet(el, measures, Math.max(width - 32, 300));
  }, [measures, width]);

  const totalBeats = notes.reduce((s, n) => s + getBeats(n.duration, n.dotted), 0);

  return (
    <Container>
      <TopBar>
        <SectionLabel>Duration</SectionLabel>
        {DUR_KEYS.map((d) => (
          <DurBtn
            key={d.value}
            $active={duration === d.value}
            onClick={() => setDuration(d.value)}
            title={d.title}
          >
            <NoteIcon type={d.value} />
          </DurBtn>
        ))}
        <DurBtn $active={dotted} onClick={() => setDotted((v) => !v)} title="Dotted note"
          style={{ fontSize: '1.4rem', fontWeight: 900 }}>
          .
        </DurBtn>

        <Sep />

        <DurBtn onClick={handleRest} title="Add rest">
          <RestIcon />
        </DurBtn>
        <ActionBtn onClick={handleUndo} title="Undo last note (Backspace)">
          Undo
        </ActionBtn>
        <ActionBtn onClick={handleClear}>Clear</ActionBtn>

        <Spacer />

        <InfoText>
          {notes.length} notes &middot; {measures.length} bars &middot; {totalBeats.toFixed(1)}{' '}
          beats
        </InfoText>

        <Sep />

        <ActionBtn onClick={handlePlay}>{playing ? '\u23F9' : '\u25B6'} Play</ActionBtn>
        <SaveBtn onClick={handleSave}>Save Lick</SaveBtn>
        <ActionBtn onClick={onCancel}>Cancel</ActionBtn>
      </TopBar>

      <PianoArea>
        <PianoKeyboard onNotePress={handleNotePress} />
      </PianoArea>
      <KeyHint>Keyboard: Z-M (C4-B4) &middot; Q-U (C5-B5) &middot; I (C6) &middot; Backspace = undo &middot; C3-B3 mouse only</KeyHint>

      {analysis && analysis.pitches.length > 0 && (
        <AnalysisPanel>
          <AnalysisRow>
            <RowLabel>Pitch</RowLabel>
            {analysis.pitches.map((p, i) => <ACell key={i}>{p}</ACell>)}
          </AnalysisRow>
          <AnalysisRow>
            <RowLabel>PC</RowLabel>
            {analysis.pitchClasses.map((pc, i) => (
              <ACell key={i} $color={`hsl(${pc * 30}, 50%, 38%)`}>{PC_NAMES[pc]}</ACell>
            ))}
          </AnalysisRow>
          <AnalysisRow>
            <RowLabel>Interval</RowLabel>
            <ACell />
            {analysis.intervals.map((iv, i) => (
              <ACell key={i} $color={iv > 0 ? '#2a8040' : iv < 0 ? '#c04040' : '#888'}>
                {iv > 0 ? `+${iv}` : String(iv)}
              </ACell>
            ))}
          </AnalysisRow>
          <AnalysisRow>
            <RowLabel>Parsons</RowLabel>
            <ACell />
            {analysis.parsons.map((p, i) => (
              <ACell key={i} $color={p > 0 ? '#2a8040' : p < 0 ? '#c04040' : '#888'}>
                {p > 0 ? '\u2191' : p < 0 ? '\u2193' : '\u2192'}
              </ACell>
            ))}
          </AnalysisRow>
          <AnalysisRow>
            <RowLabel>Fuzzy Int</RowLabel>
            <ACell />
            {analysis.fuzzyIntervals.map((fi, i) => (
              <ACell key={i} $color={fi > 0 ? '#2a8040' : fi < 0 ? '#c04040' : '#888'}>
                {fi > 0 ? `+${fi}` : String(fi)}
              </ACell>
            ))}
          </AnalysisRow>
          <AnalysisRow>
            <RowLabel>Dur Class</RowLabel>
            {analysis.durClasses.map((dc, i) => (
              <ACell key={i} $color={dc > 0 ? '#3070a0' : dc < 0 ? '#a07030' : '#888'}>
                {dc > 0 ? `+${dc}` : String(dc)}
              </ACell>
            ))}
          </AnalysisRow>
        </AnalysisPanel>
      )}

      <SheetArea>
        {notes.length === 0 && (
          <EmptyHint>Click piano keys or use keyboard to compose</EmptyHint>
        )}
        <div ref={svgRef} />
      </SheetArea>
    </Container>
  );
}
