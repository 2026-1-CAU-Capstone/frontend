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
} from 'vexflow';
import type { NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import type { LickEntry } from '../../data/lickData';
import { NotePlayer } from '../../lib/note/notePlayer';

/* ─── layout constants ──────────────────────────────────────────────── */

const LINE_HEIGHT = 140;
const MARGIN = { top: 20, left: 10, right: 10, bottom: 10 };
const CHORD_FONT = "'MuseJazz Text', 'DM Sans', sans-serif";
const MAX_PER_LINE = 6;
const DECOR_OTHER = 35;
const PX_PER_DUR: Record<string, number> = { w: 50, h: 35, q: 28, '8': 22, '16': 18 };
const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

/**
 * Replace text chord tokens with proper music symbols.
 * Parses root+accidental first, then normalises quality tokens.
 */
function formatChord(raw: string): string {
  // Separate root (+ optional accidental) from quality
  const m = raw.match(/^([A-G])([b#]?)(.*)/);
  if (!m) return raw;

  const root = m[1];
  const acc = m[2] === 'b' ? '\u266D' : m[2] === '#' ? '\u266F' : '';
  let q = m[3];

  // Quality normalisations (order matters: specific before general)
  q = q.replace(/^(-7b5|-7\(b5\)|m7b5)/,  '\u00F87');   // half-dim → ø7
  q = q.replace(/^j7/,                     '\u25B37');   // j7 → △7
  q = q.replace(/^h7/,                     '\u00F87');   // h7 → ø7
  q = q.replace(/^h(?!\d)/,                '\u00F8');    // h  → ø
  q = q.replace(/^o7/,                     '\u00B07');   // o7 → °7
  q = q.replace(/^o(?!\d)/,                '\u00B0');    // o  → °

  // Accidentals in tensions (b5, #9, etc.)
  q = q.replace(/(\d)b/g,  '$1\u266D');
  q = q.replace(/b(\d)/g,  '\u266D$1');
  q = q.replace(/(\d)#/g,  '$1\u266F');
  q = q.replace(/#(\d)/g,  '\u266F$1');

  return root + acc + q;
}

/** Normalize lick key to VexFlow key signature format. */
function toVexKey(key: string): string {
  const parts = key.split('-');
  const root = parts[0] || 'C';
  const mode = parts[1] || '';
  if (mode === 'min' || mode === 'minor') return root + 'm';
  return root;
}

/** Split formatted chord into base, extension number, and tensions. */
function splitChordParts(formatted: string): { base: string; ext: string; tension: string } {
  const m = formatted.match(/^(\D*?)(\d+)(.*)$/);
  if (!m) return { base: formatted, ext: '', tension: '' };
  return { base: m[1], ext: m[2], tension: m[3] || '' };
}

/** Append chord text to SVG with superscript extension + smaller tension above. */
function appendChordSVG(
  svgEl: SVGElement, x: number, y: number,
  chord: string, font: string, size: number,
) {
  const { base, ext, tension } = splitChordParts(formatChord(chord));
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(x));
  txt.setAttribute('y', String(y));
  txt.setAttribute('font-family', font);
  txt.setAttribute('fill', '#333');
  txt.setAttribute('stroke', '#333');
  txt.setAttribute('stroke-width', '0.3');

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
      // Split tension into accidental symbols (♭♯) and digits
      const accMatch = tension.match(/^([\u266D\u266F]*)(.*)/);
      const tensionAcc = accMatch?.[1] || '';
      const tensionNum = accMatch?.[2] || '';

      if (tensionNum) {
        const numSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        numSpan.setAttribute('font-size', String(Math.round(size * 0.6)));
        numSpan.setAttribute('dx', '4.5');
        numSpan.setAttribute('dy', String(-size * 0.15));
        numSpan.textContent = tensionNum;
        txt.appendChild(numSpan);
      }
      if (tensionAcc) {
        const accSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        accSpan.setAttribute('font-size', String(Math.round(size * 0.55)));
        accSpan.setAttribute('dx', tensionNum ? '-' + String(Math.round(size * 0.38)) : '2');
        accSpan.setAttribute('dy', String(size * 0.1));
        accSpan.textContent = tensionAcc;
        txt.appendChild(accSpan);
      }
    }
  }

  svgEl.appendChild(txt);
}
/** Estimate first-measure decoration width (clef + key sig + time sig). */
function decorFirstWidth(vexKey: string): number {
  const CLEF_W = 33;
  const TIME_SIG_W = 28;
  const PER_ACC = 10;
  const nFlats = FLAT_KEYS[vexKey] ?? 0;
  const nSharps = SHARP_KEYS[vexKey] ?? 0;
  const keySigW = (nFlats || nSharps) * PER_ACC;
  return CLEF_W + keySigW + TIME_SIG_W + 6; // 6px padding
}

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

function packLines(measures: MeasureInfo[], availW: number, decorFirst: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;
  for (let i = 0; i < measures.length; i++) {
    const mw = measureMinWidth(measures[i]);
    const decor = line.length === 0 ? (lines.length === 0 ? decorFirst : DECOR_OTHER) : 0;
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

/* ─── styled ────────────────────────────────────────────────────────── */

const Card = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px 20px 8px;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const MetaRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 2px;
`;

const LickId = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.6;
`;

const Performer = styled.span`
  font-family: "MuseJazz Text", 'DM Sans', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Title = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
`;

const Badge = styled.span<{ $color?: string }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 2px 8px;
  border-radius: 3px;
  background: ${({ $color }) => $color ?? '#f0ebe0'};
  color: #555;
`;

const ChordBadge = styled(Badge)`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.88rem;
  background: #efe8d4;
  color: #8B6914;
`;

const PlayBtn = styled.button<{ $active?: boolean }>`
  font-size: 0.85rem;
  line-height: 1;
  background: ${({ $active }) => ($active ? '#f0e8d0' : 'transparent')};
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  color: #333;
  &:hover { background: #f0f0f0; }
`;

const SvgWrap = styled.div`
  overflow-x: auto;
`;

const Placeholder = styled.div`
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  opacity: 0.4;
`;

/* ─── helpers ───────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function drawGlissLine(svgEl: SVGElement, fromNote: StaveNote, toNote: StaveNote) {
  const fromYs = fromNote.getYs();
  const toYs = toNote.getYs();
  if (!fromYs.length || !toYs.length) return;

  const x1 = fromNote.getNoteHeadEndX() + 3;
  const y1 = fromYs[0];
  const x2 = toNote.getNoteHeadBeginX() - 3;
  const y2 = toYs[0];

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return;

  const px = -dy / dist;
  const py = dx / dist;

  const waves = Math.max(3, Math.round(dist / 5));
  const amp = 3.5;
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i <= waves; i++) {
    const t = i / waves;
    const mt = t - 0.5 / waves;
    const sign = i % 2 === 1 ? -1 : 1;
    const mx = x1 + dx * mt + px * amp * sign;
    const my = y1 + dy * mt + py * amp * sign;
    const ex = x1 + dx * t;
    const ey = y1 + dy * t;
    d += ` Q ${mx} ${my} ${ex} ${ey}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#333');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('fill', 'none');
  svgEl.appendChild(path);

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
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

function buildManualBeams(vfNotes: StaveNote[], notes: NoteInfo[]): Beam[] {
  const beams: Beam[] = [];
  let beamGroup: StaveNote[] = [];
  let groupBeats = 0;
  let inTuplet = false;
  let postTupletMerged = false;

  for (let i = 0; i < vfNotes.length; i++) {
    const vn = vfNotes[i];
    const isTuplet = !!notes[i]?.tuplet;
    const dur = vn.getDuration();
    const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
    const isRest = vn.isRest();
    const noteDots = vn.getModifiersByType('Dot')?.length ?? 0;
    let noteBeats = DUR_BEATS[dur.replace('d', '')] ?? 1;
    if (noteDots > 0 || dur.endsWith('d')) noteBeats *= 1.5;

    if (postTupletMerged && beamGroup.length > 0) {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
      groupBeats = 0;
      postTupletMerged = false;
    }

    // Break beam group at tuplet boundary — allow one merge after 16th triplet
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
          beamGroup = [];
          groupBeats = 0;
        }
      }
      beamGroup.push(vn);
      if (!isTuplet) groupBeats += noteBeats;
      if (notes[i]?.beamBreak) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        groupBeats = 0;
        postTupletMerged = false;
      }
    } else {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
      groupBeats = 0;
      postTupletMerged = false;
    }
  }
  if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
  return beams;
}

/** Build a map of note letters affected by the key signature.
 *  e.g. key "F" → { b: 'b' }, key "G" → { f: '#' }, key "Bbm" → { b:'b', e:'b', a:'b', d:'b', g:'b' }
 */
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

function keySigAccidentals(vexKey: string): Map<string, 'b' | '#'> {
  const map = new Map<string, 'b' | '#'>();
  const nFlats = FLAT_KEYS[vexKey];
  if (nFlats) {
    for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b');
  }
  const nSharps = SHARP_KEYS[vexKey];
  if (nSharps) {
    for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#');
  }
  return map;
}

function buildVfNotes(measure: MeasureInfo, initialAcc?: Map<string, 'b' | '#' | 'n'>, keySigAcc?: Map<string, 'b' | '#'>): StaveNote[] {
  const activeAcc = initialAcc ? new Map(initialAcc) : new Map<string, 'b' | '#' | 'n'>();

  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);
    const note = new StaveNote({
      keys: isRest ? ['b/4'] : n.keys,
      duration: dur,
      autoStem: true,
    });
    if (n.dotted) Dot.buildAndAttach([note]);

    if (!isRest) {
      const noteId = n.keys[0];
      const letter = noteId.split('/')[0];
      const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
      const current = activeAcc.get(letter);
      const keySigForLetter = keySigAcc?.get(letter);

      if (realAcc) {
        if (current !== realAcc) {
          note.addModifier(new Accidental(realAcc), 0);
        }
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
}

/* ─── component ─────────────────────────────────────────────────────── */

interface LickCardProps {
  lick: LickEntry;
  width: number;
  visible: boolean;
  compact?: boolean;
  displayId?: number;
  onDelete?: () => void;
  onClick?: () => void;
}

export function LickCard({ lick, width, visible, compact, displayId, onDelete, onClick }: LickCardProps) {
  const svgRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  /* player */
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer();
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing) {
      p.stop();
      setPlaying(false);
    } else {
      setPlaying(true);
      const has16ths = lick.sheetData.measures.some((m) => m.notes.some((n) => n.duration === '16' || n.duration === '16r'));
      const defaultBpm = has16ths ? 120 : 200;
      await p.play(lick.sheetData, lick.tempo ?? defaultBpm);
    }
  }, [lick]);

  // cleanup on unmount
  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  // stop if lick changes while playing
  useEffect(() => {
    playerRef.current?.stop();
    setPlaying(false);
    renderedRef.current = false;
  }, [lick.id]);

  /* render notation — auto-scale then multi-line if needed */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !visible || renderedRef.current) return;
    if (!lick.sheetData.measures.length) return;

    renderedRef.current = true;
    el.innerHTML = '';

    const data = lick.sheetData;
    const nMeasures = data.measures.length;
    const [numBeats, beatValue] = data.timeSignature.split('/').map(Number);
    const vexKey = toVexKey(lick.key);
    const keySigAcc = keySigAccidentals(vexKey);
    const DECOR_FIRST = decorFirstWidth(vexKey);

    const measWidths = data.measures.map((m) => measureMinWidth(m) * 1.4);
    const decorW = DECOR_FIRST;
    const naturalW = MARGIN.left + decorW + measWidths.reduce((s, w) => s + w, 0) + MARGIN.right;

    // Determine scale: shrink to fit single line (min 0.65), else multi-line
    const MIN_SCALE = 0.65;
    const cardInner = width;
    let scale = 1;
    let multiLine = false;

    if (naturalW > cardInner) {
      scale = cardInner / naturalW;
      if (scale < MIN_SCALE) {
        scale = 1;
        multiLine = true;
      }
    }

    // Build line layout
    let lines: number[][];
    if (multiLine) {
      const availW = cardInner - MARGIN.left - MARGIN.right;
      lines = packLines(data.measures, availW, DECOR_FIRST);
    } else {
      lines = [Array.from({ length: nMeasures }, (_, i) => i)];
    }

    const nLines = lines.length;
    const svgW = multiLine ? cardInner : Math.max(naturalW, cardInner);
    const totalH = MARGIN.top + nLines * LINE_HEIGHT + MARGIN.bottom;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, totalH);
    const ctx = renderer.getContext();

    // Apply scale via SVG transform
    const svgEl = el.querySelector('svg');
    if (svgEl && scale < 1) {
      svgEl.style.transformOrigin = 'top left';
      svgEl.style.transform = `scale(${scale})`;
      el.style.height = `${totalH * scale}px`;
    }

    const allVfNotes: StaveNote[] = [];
    let tieCarryAcc: Map<string, 'b' | '#' | 'n'> | undefined;

    for (let li = 0; li < nLines; li++) {
      const indices = lines[li];
      const y = MARGIN.top + li * LINE_HEIGHT;
      let x = MARGIN.left;

      // For multi-line: stretch bars to fill width
      const lineDecorW = indices[0] === 0 ? DECOR_FIRST : DECOR_OTHER;
      const lineWeights = indices.map((i) => measWidths[i]);
      const lineTotalWeight = lineWeights.reduce((s, w) => s + w, 0);
      const lineAvail = (multiLine ? cardInner : svgW) - MARGIN.left - MARGIN.right - lineDecorW;
      const isLastLine = li === nLines - 1;
      const stretch = multiLine && (!isLastLine || indices.length >= MAX_PER_LINE);

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLast = m === nMeasures - 1;
        const barW = stretch ? (lineWeights[j] / lineTotalWeight) * lineAvail : measWidths[m];
        const w = firstInLine ? barW + lineDecorW : barW;

        const stave = new Stave(x, y, w);
        if (firstInLine) {
          stave.addClef('treble');
          if (vexKey && vexKey !== 'C') stave.addKeySignature(vexKey);
          if (m === 0) stave.addTimeSignature(data.timeSignature);
        }
        if (isLast) stave.setEndBarType(BarlineType.END);
        stave.setContext(ctx).draw();

        const measure = data.measures[m];
        const vfNotes = buildVfNotes(measure, tieCarryAcc, keySigAcc);

        tieCarryAcc = undefined;
        const lastNote = measure.notes[measure.notes.length - 1];
        if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
          const acc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
          if (acc) {
            tieCarryAcc = new Map([[lastNote.keys[0].split('/')[0], acc]]);
          }
        }

        if (measure.chord) {
          const barContentX = firstInLine ? x + lineDecorW + 4 : x + 4;
          const barContentW = barW - 8;
          const chordY = y + 12;
          const svg = el.querySelector('svg');
          if (svg) {
            const chords = measure.chord.split(/\s{2,}/);
            if (chords.length === 1) {
              appendChordSVG(svg, barContentX, chordY, chords[0], CHORD_FONT, 20);
            } else {
              const sliceW = barContentW / chords.length;
              for (let ci = 0; ci < chords.length; ci++) {
                appendChordSVG(svg, barContentX + ci * sliceW, chordY, chords[ci], CHORD_FONT, 20);
              }
            }
          }
        }

        const beams = buildManualBeams(vfNotes, measure.notes);
        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());

        // Render tuplet brackets
        {
          let ti = 0;
          while (ti < measure.notes.length) {
            if (measure.notes[ti].tuplet === 3) {
              const group: StaveNote[] = [];
              while (ti < measure.notes.length && measure.notes[ti].tuplet === 3 && group.length < 3) {
                group.push(vfNotes[ti]);
                ti++;
              }
              if (group.length >= 2) {
                const stemDown = group[0].getStemDirection() === -1;
                const tuplet = new Tuplet(group, { numNotes: group.length, notesOccupied: 2 });
                if (stemDown) tuplet.setTupletLocation(-1);
                tuplet.setContext(ctx).draw();
              }
            } else {
              ti++;
            }
          }
        }

        allVfNotes.push(...vfNotes);
        x += w;
      }
    }

    // Draw ties
    let flatIdx = 0;
    for (const measure of data.measures) {
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].tie && allVfNotes[flatIdx + 1]) {
          new StaveTie({ firstNote: allVfNotes[flatIdx], lastNote: allVfNotes[flatIdx + 1], firstIndices: [0], lastIndices: [0] })
            .setContext(ctx).draw();
        }
        flatIdx++;
      }
    }

    // Draw glissando lines
    const svg = el.querySelector('svg');
    if (svg) {
      flatIdx = 0;
      for (const measure of data.measures) {
        for (let ni = 0; ni < measure.notes.length; ni++) {
          if (measure.notes[ni].gliss && allVfNotes[flatIdx + 1]) {
            drawGlissLine(svg as SVGElement, allVfNotes[flatIdx], allVfNotes[flatIdx + 1]);
          }
          flatIdx++;
        }
      }
    }
  }, [visible, width, lick]);

  const keyNorm = lick.key.split('-')[0] || '?';

  return (
    <Card style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <MetaRow>
        <LickId>#{displayId ?? lick.id}</LickId>
        <Performer>{lick.performer}</Performer>
        <Title>{lick.title}</Title>
        <PlayBtn $active={playing} onClick={(e) => { e.stopPropagation(); togglePlay(); }} style={{ color: '#2a6e3f', borderColor: '#2a6e3f' }}>
          {playing ? '\u23F9 Stop' : '\u25B6 Play'}
        </PlayBtn>
        {onDelete && (
          <PlayBtn onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ color: '#c62828', borderColor: '#e57373' }}>
            Delete
          </PlayBtn>
        )}
      </MetaRow>
      {!compact && (
        <TagRow>
          <Badge>{keyNorm}</Badge>
          <Badge $color="#e8eef5">{lick.style}</Badge>
          <Badge $color="#eee">{lick.instrument}</Badge>
          {lick.tempo && <Badge $color="#f5f0e0">{lick.tempo} bpm</Badge>}
          <Badge $color="#f0eee8">{lick.rhythmfeel}</Badge>
          <Badge $color="#ede8f0">{lick.tag}</Badge>
          <Badge $color="#e8f0e8">{lick.nEvents} notes</Badge>
          {lick.chords.map((c, i) => (
            <ChordBadge key={i}>{formatChord(c)}</ChordBadge>
          ))}
        </TagRow>
      )}
      {compact && (
        <TagRow>
          <Badge>{keyNorm}</Badge>
          <Badge $color="#eee">{lick.instrument}</Badge>
        </TagRow>
      )}
      {visible ? (
        <SvgWrap ref={svgRef} />
      ) : (
        <Placeholder>scroll to render</Placeholder>
      )}
    </Card>
  );
}
