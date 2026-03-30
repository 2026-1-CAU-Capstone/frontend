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
  BarlineType,
  StaveTie,
  Tuplet,
  VoltaType,
  Repetition,
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
    .replace(/-7b5/g, '\u00F87')
    .replace(/h7/g, '\u00F87')
    .replace(/h(?!\d)/g, '\u00F8')
    .replace(/o7/g, '\u00B07')
    .replace(/o(?!\d)/g, '\u00B0');
}

function splitChordParts(formatted: string): { base: string; ext: string; tension: string } {
  const m = formatted.match(/^(\D*?)(\d+)(.*)$/);
  if (!m) return { base: formatted, ext: '', tension: '' };
  return { base: m[1], ext: m[2], tension: m[3] || '' };
}

function appendChordSVG(
  svgEl: SVGElement, x: number, y: number,
  chord: string, font: string, size: number,
) {
  const { base, ext, tension } = splitChordParts(formatChord(chord));
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(x));
  txt.setAttribute('y', String(y));
  txt.setAttribute('font-family', font);
  txt.setAttribute('font-weight', '200');
  txt.setAttribute('fill', '#000');

  const baseSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
  baseSpan.setAttribute('font-size', String(size));
  baseSpan.textContent = base;
  txt.appendChild(baseSpan);

  if (ext) {
    const extSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    extSpan.setAttribute('font-size', String(Math.round(size * 0.85)));
    extSpan.setAttribute('dx', base.endsWith('\u25B3') ? '-1' : '1');
    extSpan.setAttribute('dy', String(-size * 0.18));
    extSpan.textContent = ext;
    txt.appendChild(extSpan);

    if (tension) {
      const tensionSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tensionSpan.setAttribute('font-size', String(Math.round(size * 0.6)));
      tensionSpan.setAttribute('dx', '0');
      tensionSpan.setAttribute('dy', String(-size * 0.22));
      tensionSpan.textContent = tension;
      txt.appendChild(tensionSpan);
    }
  }

  svgEl.appendChild(txt);
}
const MAX_PER_LINE = 8;
const FIXED_BAR_W = 175;
const DECOR_FIRST = 80;
const DECOR_OTHER = 40;
const HL_COLOR = 'rgba(212, 168, 67, 0.15)';

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 };

/* ─── key signature accidentals ──────────────────────────────────────── */
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const KS_FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const KS_SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

function keySigAccidentals(vexKey: string): Map<string, 'b' | '#'> {
  const map = new Map<string, 'b' | '#'>();
  const nFlats = KS_FLAT_KEYS[vexKey];
  if (nFlats) { for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b'); }
  const nSharps = KS_SHARP_KEYS[vexKey];
  if (nSharps) { for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#'); }
  return map;
}

function isKeyFlat(vexKey: string): boolean {
  return vexKey in KS_FLAT_KEYS;
}

/* Enharmonic: sharp → flat (e.g. f#/4 → g/4 with 'b') */
const SHARP_TO_FLAT: Record<string, { letter: string; acc: 'b' }> = {
  'c': { letter: 'd', acc: 'b' },
  'd': { letter: 'e', acc: 'b' },
  'f': { letter: 'g', acc: 'b' },
  'g': { letter: 'a', acc: 'b' },
  'a': { letter: 'b', acc: 'b' },
  // e# → f (natural), b# → c (natural) — not flats
};

function enharmonicToFlat(key: string, acc: '#'): { key: string; acc: 'b' } | null {
  const [letter, octave] = key.split('/');
  const mapped = SHARP_TO_FLAT[letter];
  if (!mapped) return null; // e# or b# — skip
  return { key: `${mapped.letter}/${octave}`, acc: mapped.acc };
}

/* ─── glissando ──────────────────────────────────────────────────────── */
function drawGlissLine(svgEl: SVGElement, fromNote: StaveNote, toNote: StaveNote) {
  const fromYs = fromNote.getYs();
  const toYs = toNote.getYs();
  if (!fromYs.length || !toYs.length) return;
  const x1 = fromNote.getNoteHeadEndX() + 3;
  const y1 = fromYs[0];
  const x2 = toNote.getNoteHeadBeginX() - 3;
  const y2 = toYs[0];
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return;
  const px = -dy / dist, py = dx / dist;
  const waves = Math.max(3, Math.round(dist / 5));
  const amp = 3.5;
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i <= waves; i++) {
    const t = i / waves, mt = t - 0.5 / waves;
    const sign = i % 2 === 1 ? -1 : 1;
    d += ` Q ${x1 + dx * mt + px * amp * sign} ${y1 + dy * mt + py * amp * sign} ${x1 + dx * t} ${y1 + dy * t}`;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#333');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('fill', 'none');
  svgEl.appendChild(path);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(midX));
  txt.setAttribute('y', String(midY - 8));
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('font-family', "'Times New Roman', 'Georgia', serif");
  txt.setAttribute('font-size', '9');
  txt.setAttribute('font-style', 'italic');
  txt.setAttribute('fill', '#333');
  txt.setAttribute('transform', `rotate(${angle}, ${midX}, ${midY - 8})`);
  txt.textContent = 'gliss.';
  svgEl.appendChild(txt);
}

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
    const mw = FIXED_BAR_W;
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28px 28px 0;
`;

const HeaderLeft = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 1.05rem;
  color: #999;
`;

const Title = styled.h1`
  font-family: ${CHORD_FONT};
  font-size: 2.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0;
  text-align: center;
  flex: 1;
`;

const Composer = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 1.05rem;
  color: #999;
`;

/* ── floating player (bottom-left) ─────────────────────────────────────── */

const PlayerBar = styled.div`
  position: fixed;
  bottom: 24px;
  left: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1e1e1e;
  padding: 10px 16px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  z-index: 1000;
`;

const PlayerIconBtn = styled.button`
  font-size: 1rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #2a6e3f;
  color: #fff;
  cursor: pointer;
  &:hover { opacity: 0.85; }
`;

const BpmLabel = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  color: #ccc;
`;

const BpmInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a2a;
  color: #fff;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  &:focus { border-color: #888; }
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

/* buildVfNotes is now inlined in the render loop for context-aware accidentals */

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
  const [tempoText, setTempoText] = useState(String(data.tempo ?? 120));
  const [activeMeasure, setActiveMeasure] = useState(-1);
  const [paused, setPaused] = useState(false);
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const prevNoteKeyRef = useRef<string | null>(null);

  // note highlight helpers
  const colorNote = useCallback((key: string, color: string) => {
    const el = noteElMapRef.current.get(key);
    if (!el) return;
    const apply = (e: Element) => { const s = (e as SVGElement).style; s.fill = color; s.stroke = color; };
    apply(el);
    el.querySelectorAll('*').forEach(apply);
    // Walk up to vf-stavenote for stem/flag
    let parent = el.parentElement;
    while (parent && parent.tagName !== 'svg') {
      const cls = parent.getAttribute('class') || '';
      if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) { apply(parent); parent.querySelectorAll('*').forEach(apply); break; }
      parent = parent.parentElement;
    }
  }, []);

  const highlightNote = useCallback((mi: number, ni: number) => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    const key = `${mi}-${ni}`;
    colorNote(key, '#1565c0');
    prevNoteKeyRef.current = key;
  }, [colorNote]);

  const clearNoteHighlight = useCallback(() => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    prevNoteKeyRef.current = null;
  }, [colorNote]);

  // init / cleanup player
  useEffect(() => {
    const p = new NotePlayer();
    p.onMeasure = (idx) => setActiveMeasure(idx);
    p.onNote = (mi, ni) => highlightNote(mi, ni);
    p.onDone = () => { setPlaying(false); setActiveMeasure(-1); clearNoteHighlight(); };
    playerRef.current = p;
    return () => p.dispose();
  }, [highlightNote, clearNoteHighlight]);

  // stop on song change & sync tempo
  useEffect(() => {
    playerRef.current?.stop();
    setPlaying(false);
    setActiveMeasure(-1);
    const t = data.tempo ?? 120;
    setTempo(t);
    setTempoText(String(t));
  }, [data]);

  const togglePlay = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setPlaying(false);
      setPaused(true);
    } else {
      setPlaying(true);
      setPaused(false);
      await p.play(data, tempo);
    }
  }, [data, tempo]);

  const handleStop = useCallback(() => {
    playerRef.current?.stop();
    setPlaying(false);
    setPaused(false);
    setActiveMeasure(-1);
    clearNoteHighlight();
  }, [clearNoteHighlight]);

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

    // reset measure rects & note element map
    noteElMapRef.current.clear();
    const rects: { x: number; y: number; w: number }[] = [];
    const stavePositions: { x: number; y: number; w: number }[] = [];
    const allVfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
    const measureLine = new Map<number, number>();
    const sheetKey = data.key ?? 'C';
    const keySigAcc = keySigAccidentals(sheetKey);
    const useFlats = isKeyFlat(sheetKey);
    let tieCarryAcc: Map<string, 'b' | '#' | 'n'> | undefined;

    for (let li = 0; li < numLines; li++) {
      const indices = lines[li];
      const isFirstLine = li === 0;
      const isLastLine = li === numLines - 1;
      const y = MARGIN.top + li * LINE_HEIGHT;
      const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
      const availForBars = totalW - decorW;

      const barW = (isLastLine && indices.length < MAX_PER_LINE)
        ? FIXED_BAR_W
        : availForBars / indices.length;

      let x = MARGIN.left;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLastBar = m === data.measures.length - 1;
        const w = firstInLine ? barW + decorW : barW;

        const measure = data.measures[m];

        // track rect for highlighting
        rects[m] = { x, y, w };

        // ── Stave ──
        const stave = new Stave(x, y, w);
        if (firstInLine) {
          stave.addClef('treble');
          if (data.key && data.key !== 'C') stave.addKeySignature(data.key);
          if (isFirstLine) stave.addTimeSignature(data.timeSignature);
        }
        // Repeat / end barlines
        if (measure.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (measure.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
        else if (isLastBar) stave.setEndBarType(BarlineType.END);
        // Volta brackets
        if (measure.volta) {
          const v = measure.volta;
          const prevV = m > 0 ? data.measures[m - 1]?.volta : undefined;
          const nextV = m < data.measures.length - 1 ? data.measures[m + 1]?.volta : undefined;
          const isS = prevV !== v;
          stave.setVoltaType(isS ? VoltaType.BEGIN : VoltaType.MID, `${v}.`, -25);
        }
        if (measure.navigation) {
          const navMap: Record<string, number[]> = {
            segno: [Repetition.type.SEGNO_LEFT], coda: [Repetition.type.CODA_LEFT],
            fine: [Repetition.type.FINE], toCoda: [Repetition.type.TO_CODA],
            dc: [Repetition.type.DC], dcAlCoda: [Repetition.type.DC_AL_CODA], dcAlFine: [Repetition.type.DC_AL_FINE],
            ds: [Repetition.type.DS], dsAlCoda: [Repetition.type.DS_AL_CODA], dsAlFine: [Repetition.type.DS_AL_FINE],
          };
          const rts = navMap[measure.navigation];
          if (rts) for (const rt of rts) stave.setRepetitionType(rt);
        }
        stave.setContext(ctx).draw();
        stavePositions[m] = { x, y, w };

        // ── Notes ──
        measureLine.set(m, li);

        const activeAcc = tieCarryAcc ? new Map(tieCarryAcc) : new Map<string, 'b' | '#' | 'n'>();
        tieCarryAcc = undefined;

        const vfNotes = measure.notes.map((n) => {
          const isRest = n.duration.endsWith('r');
          const dur = buildDuration(n.duration, n.dotted);

          // Enharmonic: convert sharps to flats in flat keys
          let keys = n.keys;
          let realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
          if (!isRest && useFlats && realAcc === '#') {
            const conv = enharmonicToFlat(n.keys[0], '#');
            if (conv) {
              keys = [conv.key];
              realAcc = conv.acc;
            }
          }

          const note = new StaveNote({ keys: isRest ? ['b/4'] : keys, duration: dur, autoStem: true });
          if (n.dotted) Dot.buildAndAttach([note]);

          if (!isRest) {
            const noteId = keys[0];
            const letter = noteId.split('/')[0];
            const current = activeAcc.get(letter);
            const keySigForLetter = keySigAcc.get(letter);

            if (realAcc) {
              const effective = current ?? keySigForLetter;
              if (effective !== realAcc) note.addModifier(new Accidental(realAcc), 0);
              activeAcc.set(letter, realAcc);
            } else {
              const effective = current ?? keySigForLetter;
              if (effective && effective !== 'n') {
                note.addModifier(new Accidental('n'), 0);
                activeAcc.set(letter, 'n');
              }
            }
          }
          return note;
        });

        const lastNote = measure.notes[measure.notes.length - 1];
        if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
          let tieAcc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
          let tieKey = lastNote.keys[0];
          if (useFlats && tieAcc === '#') {
            const conv = enharmonicToFlat(tieKey, '#');
            if (conv) { tieKey = conv.key; tieAcc = conv.acc; }
          }
          if (tieAcc) tieCarryAcc = new Map([[tieKey.split('/')[0], tieAcc]]);
        }

        for (let ni = 0; ni < vfNotes.length; ni++) {
          allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni] });
        }

        if (measure.chord) {
          const barContentX = firstInLine ? x + decorW + 4 : x + 4;
          const barContentW = w - (firstInLine ? decorW : 0) - 8;
          const chordY = y + 12;
          const svgEl = el.querySelector('svg');
          if (svgEl) {
            const chords = measure.chord.split(/\s{2,}/);
            if (chords.length === 1) {
              appendChordSVG(svgEl, barContentX, chordY, chords[0], CHORD_FONT, 24);
            } else {
              const sliceW = barContentW / chords.length;
              for (let ci = 0; ci < chords.length; ci++) {
                appendChordSVG(svgEl, barContentX + ci * sliceW, chordY, chords[ci], CHORD_FONT, 24);
              }
            }
          }
        }

        // ── Advanced beams ──
        const beams: Beam[] = [];
        let beamGroup: StaveNote[] = [];
        let groupBeats = 0;
        let inTuplet = false;
        let postTupletMerged = false;

        for (let ni = 0; ni < vfNotes.length; ni++) {
          const vn = vfNotes[ni];
          const isTuplet = !!measure.notes[ni].tuplet;
          const dur = vn.getDuration();
          const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
          const isRest = vn.isRest();
          const noteDots = vn.getModifiersByType('Dot')?.length ?? 0;
          let noteBeats = DUR_BEATS[dur.replace('d', '')] ?? 1;
          if (noteDots > 0 || dur.endsWith('d')) noteBeats *= 1.5;

          if (postTupletMerged && beamGroup.length > 0) {
            if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
            beamGroup = []; groupBeats = 0; postTupletMerged = false;
          }
          if (isTuplet !== inTuplet && beamGroup.length > 0) {
            const prevIs16Triplet = inTuplet && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
            if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
              postTupletMerged = true;
            } else {
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
              beamGroup = [];
              if (!isTuplet) groupBeats = 0;
            }
          }
          inTuplet = isTuplet;

          if (isBeamable && !isRest) {
            if (!isTuplet && !postTupletMerged) {
              const newGroupBeats = groupBeats + noteBeats;
              const has16 = dur === '16' || dur === '16d' || beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
              const boundary = has16 ? 1 : 2;
              if (groupBeats > 0 && Math.floor((groupBeats - 0.001) / boundary) !== Math.floor((newGroupBeats - 0.001) / boundary) && beamGroup.length > 0) {
                if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
                beamGroup = []; groupBeats = 0;
              }
            }
            beamGroup.push(vn);
            if (!isTuplet) groupBeats += noteBeats;
            if (measure.notes[ni].beamBreak) {
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
              beamGroup = []; groupBeats = 0; postTupletMerged = false;
            }
          } else {
            if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
            beamGroup = []; groupBeats = 0; postTupletMerged = false;
          }
        }
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));

        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((bm) => bm.setContext(ctx).draw());

        // Store SVG elements for note highlighting
        for (let ni = 0; ni < vfNotes.length; ni++) {
          const svgNode = vfNotes[ni].getSVGElement();
          if (svgNode) noteElMapRef.current.set(`${m}-${ni}`, svgNode as SVGElement);
        }

        // ── Tuplet brackets ──
        {
          let ti = 0;
          while (ti < measure.notes.length) {
            if (measure.notes[ti].tuplet === 3) {
              const group: StaveNote[] = [];
              while (ti < measure.notes.length && measure.notes[ti].tuplet === 3 && group.length < 3) {
                group.push(vfNotes[ti]); ti++;
              }
              if (group.length >= 2) {
                const stemDown = group[0].getStemDirection() === -1;
                const tuplet = new Tuplet(group, { numNotes: group.length, notesOccupied: 2 });
                if (stemDown) tuplet.setTupletLocation(-1);
                tuplet.setContext(ctx).draw();
              }
            } else { ti++; }
          }
        }

        x += w;
      }
    }

    // Draw ties
    let flatIdx = 0;
    for (let mi = 0; mi < data.measures.length; mi++) {
      const measure = data.measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].tie) {
          const from = allVfNotes[flatIdx];
          const to = allVfNotes[flatIdx + 1];
          if (from && to && measureLine.get(from.mi) === measureLine.get(to.mi)) {
            const tie = new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndices: [0], lastIndices: [0] });
            tie.setContext(ctx).draw();
          }
        }
        flatIdx++;
      }
    }

    // Draw glissando lines
    const svgElGliss = el.querySelector('svg');
    if (svgElGliss) {
      flatIdx = 0;
      for (let mi = 0; mi < data.measures.length; mi++) {
        const measure = data.measures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          if (measure.notes[ni].gliss) {
            const from = allVfNotes[flatIdx];
            const to = allVfNotes[flatIdx + 1];
            if (from && to) drawGlissLine(svgElGliss, from.vfNote, to.vfNote);
          }
          flatIdx++;
        }
      }
    }

    // Draw intro brackets — small arcs inside bracketed measures
    const svgEl = el.querySelector('svg');
    if (svgEl) {
      const drawArc = (cx: number, top: number, bot: number, openSide: boolean) => {
        const h = bot - top;
        const bulge = Math.min(h * 0.18, 6);
        const d = openSide
          ? `M ${cx} ${top} Q ${cx - bulge} ${(top + bot) / 2} ${cx} ${bot}`
          : `M ${cx} ${top} Q ${cx + bulge} ${(top + bot) / 2} ${cx} ${bot}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#444');
        path.setAttribute('stroke-width', '1.8');
        svgEl!.appendChild(path);
      };
      let bi = 0;
      while (bi < data.measures.length) {
        if (data.measures[bi].bracket) {
          const groupStart = bi;
          while (bi < data.measures.length && data.measures[bi].bracket) bi++;
          const groupEnd = bi - 1;
          const pStart = stavePositions[groupStart];
          const pEnd = stavePositions[groupEnd];
          if (pStart && pEnd) {
            const top = pStart.y + 28;
            const bot = pStart.y + LINE_HEIGHT - 50;
            drawArc(pStart.x + 2, top, bot, true);
            drawArc(pEnd.x + pEnd.w * 0.55, top, bot, false);
          }
        } else {
          bi++;
        }
      }
    }

    measureRectsRef.current = rects;
  }, [data, width]);

  /* ─── render ──────────────────────────────────────────────────────── */

  return (
    <Wrapper ref={wrapRef}>
      <Header>
        <HeaderLeft>{data.genre || ''}</HeaderLeft>
        <Title>{data.title}</Title>
        <Composer>{data.composer}</Composer>
      </Header>

      <SvgContainer ref={svgRef} />

      <PlayerBar>
        <BpmLabel>BPM</BpmLabel>
        <BpmInput
          type="text"
          inputMode="numeric"
          value={tempoText}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            setTempoText(v);
            const n = parseInt(v, 10);
            if (n >= 20 && n <= 400) setTempo(n);
          }}
          onBlur={() => {
            const n = parseInt(tempoText, 10);
            const clamped = Math.max(40, Math.min(300, isNaN(n) ? 120 : n));
            setTempo(clamped);
            setTempoText(String(clamped));
          }}
        />
        <PlayerIconBtn onClick={playing ? handleStop : togglePlay} title={playing ? 'Stop' : 'Play'}>
          {playing
            ? <svg width="18" height="18" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" fill="#fff"/></svg>
            : <svg width="18" height="18" viewBox="0 0 14 14"><polygon points="2,0 14,7 2,14" fill="#fff"/></svg>}
        </PlayerIconBtn>
        {(playing || paused) && (
          <PlayerIconBtn onClick={togglePlay} title={paused ? 'Resume' : 'Pause'}>
            {paused
              ? <svg width="18" height="18" viewBox="0 0 14 14"><polygon points="2,0 14,7 2,14" fill="#fff"/></svg>
              : <svg width="18" height="18" viewBox="0 0 14 14"><rect x="1" y="1" width="4" height="12" fill="#fff"/><rect x="9" y="1" width="4" height="12" fill="#fff"/></svg>}
          </PlayerIconBtn>
        )}
      </PlayerBar>
    </Wrapper>
  );
}
