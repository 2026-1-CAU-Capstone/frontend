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
  Fraction,
  BarlineType,
} from 'vexflow';
import type { NoteSheetData, NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import { PianoKeyboard, type PianoNote } from './PianoKeyboard';
import { NotePlayer } from '../../lib/note/notePlayer';
import { useCountInIntro } from '../../hooks/useCountInIntro';
import { PATTERN_SIMPLE } from '../../lib/note/countInPatterns';

/* ─── key helpers ────────────────────────────────────────────────────── */

// Display key → LickEntry.key format: "Bb" → "Bb-maj", "Gm" → "G-min"
export function displayKeyToLickKey(key: string): string {
  if (key.endsWith('m') && key.length > 1 && key !== 'Am'.slice(-2)) {
    // Check it's actually a minor key (ends with lowercase 'm')
    const last = key[key.length - 1];
    const secondLast = key[key.length - 2];
    if (last === 'm' && secondLast !== secondLast.toUpperCase()) {
      return key.slice(0, -1) + '-min';
    }
  }
  if (key.endsWith('m')) return key.slice(0, -1) + '-min';
  return key + '-maj';
}

const JAZZ_KEYS_MAJOR = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'G', 'D', 'A', 'E', 'B', 'F#'];
const JAZZ_KEYS_MINOR = ['Cm', 'Fm', 'Bbm', 'Ebm', 'Abm', 'Gm', 'Dm', 'Am', 'Em', 'Bm'];

// Sharp-preferring keys: keep # notation instead of converting to b
const SHARP_KEY_SET = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'Em', 'Bm', 'F#m', 'C#m', 'G#m']);

function isSharpKey(key: string): boolean {
  return SHARP_KEY_SET.has(key);
}

// Key-aware accidental resolution (replaces the old toFlat)
function resolveAcc(pn: PianoNote, key: string): { vexKey: string; acc?: '#' | 'b' } {
  if (!pn.acc) return { vexKey: pn.vexKey };

  const [letter, octStr] = pn.vexKey.split('/');
  const oct = parseInt(octStr);

  // Defensive: B# → C (octave up), E# → F (not reachable from piano but safe)
  if (letter === 'b' && pn.acc === '#') return { vexKey: `c/${oct + 1}` };
  if (letter === 'e' && pn.acc === '#') return { vexKey: `f/${oct}` };

  if (isSharpKey(key)) return { vexKey: pn.vexKey, acc: '#' };

  // Flat keys: convert sharp → flat enharmonic
  const SHARP_TO_FLAT: Record<string, string> = { c: 'd', d: 'e', f: 'g', g: 'a', a: 'b' };
  const flatLetter = SHARP_TO_FLAT[letter];
  if (!flatLetter) return { vexKey: pn.vexKey, acc: '#' };
  return { vexKey: `${flatLetter}/${oct}`, acc: 'b' };
}

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
const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function vexToMidi(key: string, acc?: '#' | 'b' | 'n' | '##' | 'bb'): number {
  const [n, o] = key.split('/');
  let s = SEMI_MAP[n] ?? 0;
  if (acc === '#')  s += 1;
  else if (acc === 'b')  s -= 1;
  else if (acc === '##') s += 2;
  else if (acc === 'bb') s -= 2;
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

const MEASURE_HL_COLOR = 'rgba(100, 181, 246, 0.13)';

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number): { x: number; y: number; w: number }[] {
  el.innerHTML = '';
  if (measures.length === 0) return [];

  const totalW = width - MARGIN.left - MARGIN.right;
  const lines = packLines(measures, totalW);
  const totalH = MARGIN.top + lines.length * LINE_HEIGHT + MARGIN.bottom;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, totalH);
  const ctx = renderer.getContext();

  const rects: { x: number; y: number; w: number }[] = [];

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

      const dw = firstInLine ? decorW : 0;
      rects[m] = { x: x + dw + 4, y, w: barW - 4 };

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

      const beams = Beam.generateBeams(vfNotes, {
        groups: [new Fraction(4, 8)],
      });
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setStrict(false);
      voice.addTickables(vfNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      beams.forEach((bm) => bm.setContext(ctx).draw());

      x += w;
    }
  }
  return rects;
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

const CopyBtn = styled(ActionBtn)<{ $copied?: boolean }>`
  background: ${({ $copied }) => ($copied ? '#2a6e3f' : '#3070a0')};
  color: #fff;
  border-color: ${({ $copied }) => ($copied ? '#2a6e3f' : '#3070a0')};
  &:hover {
    background: ${({ $copied }) => ($copied ? '#2a6e3f' : '#265d88')};
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

const KeySelect = styled.select`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  padding: 4px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  height: 34px;
`;

const ToggleBtn = styled.button<{ $active?: boolean; $color?: string }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 4px 10px;
  height: 34px;
  border: 1.5px solid ${({ $active, $color }) => $active ? ($color ?? '#b8960a') : '#ddd'};
  border-radius: 5px;
  background: ${({ $active, $color }) => $active ? ($color ? $color + '22' : '#f5ecd0') : 'transparent'};
  color: ${({ $active, $color }) => $active ? ($color ?? '#b8960a') : '#888'};
  cursor: pointer;
  &:hover { opacity: 0.8; }
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
  const [selectedKey, setSelectedKey] = useState('C');
  const [tripletMode, setTripletMode] = useState(false);
  const tripletCountRef = useRef(0);   // 0,1,2 → wraps; tracks position within triplet group
  const [pendingTie, setPendingTie] = useState(false);
  const [pendingGliss, setPendingGliss] = useState(false);
  const [pendingGhost, setPendingGhost] = useState(false);
  const [ottavaMode, setOttavaMode] = useState<'8va' | '8vb' | null>(null);
  const ottavaOpenRef = useRef(false); // true = bracket is currently open
  const svgRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [activeMeasure, setActiveMeasure] = useState(-1);
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);

  const measures = useMemo(() => notesToMeasures(notes), [notes]);
  const analysis = useMemo(() => computeAnalysis(notes), [notes]);

  /* ── add note from piano ─────────────────────────────────────────── */
  const handleNotePress = useCallback(
    (pn: PianoNote) => {
      const resolved = resolveAcc(pn, selectedKey);
      const ni: NoteInfo = {
        keys: [resolved.vexKey],
        duration,
        dotted: dotted || undefined,
      };
      if (resolved.acc) ni.accidentals = { 0: resolved.acc };
      if (tripletMode) {
        ni.tuplet = 3;
        // beamBreak after every 3rd note in a group
        const cnt = tripletCountRef.current;
        if (cnt === 2) {
          ni.beamBreak = true;
          tripletCountRef.current = 0;
        } else {
          tripletCountRef.current = cnt + 1;
        }
      }
      if (pendingTie) { ni.tie = true; setPendingTie(false); }
      if (pendingGliss) { ni.gliss = true; setPendingGliss(false); }
      if (pendingGhost) { ni.ghost = true; setPendingGhost(false); }
      // 8va: first note of bracket gets ottavaStart, last note (when toggled off) gets ottavaEnd
      if (ottavaMode && !ottavaOpenRef.current) {
        ni.ottavaStart = ottavaMode;
        ottavaOpenRef.current = true;
      }
      setNotes((prev) => [...prev, ni]);
    },
    [duration, dotted, selectedKey, tripletMode, pendingTie, pendingGliss, pendingGhost, ottavaMode],
  );

  /* ── add rest ────────────────────────────────────────────────────── */
  const handleRest = useCallback(() => {
    const rest: NoteInfo = { keys: ['b/4'], duration: duration + 'r', dotted: dotted || undefined };
    if (tripletMode) {
      rest.tuplet = 3;
      const cnt = tripletCountRef.current;
      if (cnt === 2) { rest.beamBreak = true; tripletCountRef.current = 0; }
      else tripletCountRef.current = cnt + 1;
    }
    setNotes((prev) => [...prev, rest]);
  }, [duration, dotted, tripletMode]);

  /* ── undo / clear ────────────────────────────────────────────────── */
  const handleUndo = useCallback(() => {
    setNotes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.tuplet) {
        // step back triplet counter
        tripletCountRef.current = (tripletCountRef.current + 2) % 3;
      }
      return prev.slice(0, -1);
    });
  }, []);
  const handleClear = useCallback(() => {
    setNotes([]);
    tripletCountRef.current = 0;
    ottavaOpenRef.current = false;
    setPendingTie(false);
    setPendingGliss(false);
    setPendingGhost(false);
    setOttavaMode(null);
  }, []);

  // Close the 8va bracket: mark the last note as ottavaEnd, then toggle off
  const handleOttavaToggle = useCallback((type: '8va' | '8vb') => {
    if (ottavaMode === type && ottavaOpenRef.current) {
      // Close: stamp ottavaEnd onto the last note
      setNotes((prev) => {
        if (prev.length === 0) return prev;
        const last = { ...prev[prev.length - 1], ottavaEnd: true };
        return [...prev.slice(0, -1), last];
      });
      ottavaOpenRef.current = false;
      setOttavaMode(null);
    } else {
      setOttavaMode(type);
      ottavaOpenRef.current = false;
    }
  }, [ottavaMode]);

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
      key: selectedKey,
      timeSignature: '4/4',
      tempo: 120,
      measures,
    }),
    [measures, selectedKey],
  );

  const countIn = useCountInIntro();

  const handlePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer({ lickMode: true });
      p.onMeasure = (idx) => setActiveMeasure(idx);
      p.onDone = () => { setPlaying(false); };
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing || countIn.active) {
      p.stop();
      countIn.cancel();
      setPlaying(false);
      return;
    }
    if (measures.length > 0) {
      setPlaying(true);
      const preload = p.preload();
      // 릭 재생: BPM 무관하게 SIMPLE 카운트인.
      const cin = await countIn.run({ bpm: 120, pattern: PATTERN_SIMPLE });
      if (!cin.ok) { setPlaying(false); return; }
      await preload;
      await p.play(sheetData, 120, { startAt: p.ctxNow() + cin.downbeatInSec });
    }
  }, [measures, sheetData]);

  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  /* ── save ──────────────────────────────────────────────────────────── */
  const handleSave = useCallback(() => {
    if (measures.length === 0) return;
    onSave(sheetData);
  }, [measures, sheetData, onSave]);

  /* ── copy JSON (pitch/duration/bar) ──────────────────────────────── */
  const [copied, setCopied] = useState(false);
  const handleCopyJson = useCallback(() => {
    if (notes.length === 0) return;
    const DUR_LABEL: Record<string, string> = {
      w: 'whole', h: 'half', q: 'quarter', '8': '8th', '16': '16th',
    };
    const jsonNotes = measures.flatMap((m, mi) =>
      m.notes.map((n) => {
        const isRest = n.duration.endsWith('r');
        const baseDur = n.duration.replace(/r$/, '');
        const durStr = (n.dotted ? 'dotted-' : '') + (DUR_LABEL[baseDur] ?? baseDur);
        if (isRest) return { pitch: null, duration: durStr, bar: mi + 1 };
        const acc = n.accidentals ? (n.accidentals[0] as '#' | 'b' | 'n' | undefined) : undefined;
        return { pitch: vexToMidi(n.keys[0], acc), duration: durStr, bar: mi + 1 };
      }),
    );
    const obj = {
      id: `custom-${Date.now()}`,
      performer: '',
      title: '',
      key: '',
      style: '',
      tempo: null,
      tags: [],
      notes: jsonNotes,
    };
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [notes, measures]);

  /* ── render VexFlow ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (measures.length === 0) {
      el.innerHTML = '';
      return;
    }
    const rects = renderSheet(el, measures, Math.max(width - 32, 300));
    measureRectsRef.current = rects;
  }, [measures, width]);

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
    rect.setAttribute('y', String(r.y + 8));
    rect.setAttribute('width', String(r.w));
    rect.setAttribute('height', String(LINE_HEIGHT - 16));
    rect.setAttribute('fill', MEASURE_HL_COLOR);
    rect.setAttribute('stroke', 'none');
    rect.setAttribute('rx', '4');
    svg.insertBefore(rect, svg.firstChild);
  }, [activeMeasure]);

  const totalBeats = notes.reduce((s, n) => s + getBeats(n.duration, n.dotted), 0);

  return (
    <Container>
      {countIn.overlay}
      <TopBar>
        {/* Key */}
        <SectionLabel>Key</SectionLabel>
        <KeySelect value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
          <optgroup label="Major">
            {JAZZ_KEYS_MAJOR.map((k) => <option key={k} value={k}>{k}</option>)}
          </optgroup>
          <optgroup label="Minor">
            {JAZZ_KEYS_MINOR.map((k) => <option key={k} value={k}>{k}</option>)}
          </optgroup>
        </KeySelect>

        <Sep />

        {/* Duration */}
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

        {/* Special modes */}
        <ToggleBtn
          $active={tripletMode}
          $color="#7B3FB0"
          title="Triplet mode (every 3 notes = 1 triplet group)"
          onClick={() => { setTripletMode((v) => !v); tripletCountRef.current = 0; }}
        >
          \u00B3
        </ToggleBtn>
        <ToggleBtn
          $active={pendingTie}
          $color="#1565c0"
          title="Next note will be tied to previous"
          onClick={() => setPendingTie((v) => !v)}
        >
          Tie
        </ToggleBtn>
        <ToggleBtn
          $active={pendingGliss}
          $color="#2a8040"
          title="Next note will have glissando from previous"
          onClick={() => setPendingGliss((v) => !v)}
        >
          Gliss
        </ToggleBtn>
        <ToggleBtn
          $active={pendingGhost}
          $color="#888"
          title="Next note will be a ghost note (parentheses)"
          onClick={() => setPendingGhost((v) => !v)}
        >
          (Ghost)
        </ToggleBtn>
        <ToggleBtn
          $active={ottavaMode === '8va'}
          $color="#c47a20"
          title="8va bracket — click to start, click again to close"
          onClick={() => handleOttavaToggle('8va')}
        >
          8va
        </ToggleBtn>
        <ToggleBtn
          $active={ottavaMode === '8vb'}
          $color="#c47a20"
          title="8vb bracket — one octave below written"
          onClick={() => handleOttavaToggle('8vb')}
        >
          8vb
        </ToggleBtn>

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
        <CopyBtn $copied={copied} onClick={handleCopyJson} disabled={notes.length === 0}>
          {copied ? '\u2713 Copied!' : '\u{1F4CB} Copy JSON'}
        </CopyBtn>
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
