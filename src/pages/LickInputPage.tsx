import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, Fraction, BarlineType, StaveTie, Tuplet,
} from 'vexflow';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import type { NoteInfo, MeasureInfo } from '../data/sampleMelody';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';

/* ─── helpers ──────────────────────────────────────────────────────────── */

import Soundfont from 'soundfont-player';

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const DUR_LABEL: Record<string, string> = { w: 'whole', h: 'half', q: 'quarter', '8': '8th', '16': '16th' };
const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_TO_FLAT: Record<string, string> = { c: 'd', d: 'e', f: 'g', g: 'a', a: 'b' };

function vexToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI_MAP[n] ?? 0;
  if (acc === '#') s += 1;
  if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

function convertAcc(pn: PianoNote, mode: 'b' | '#'): { vexKey: string; acc?: 'b' | '#' } {
  if (!pn.acc) return { vexKey: pn.vexKey };
  if (mode === '#') {
    // Keep as sharp (piano gives c#/4 style)
    return { vexKey: pn.vexKey, acc: '#' };
  }
  // Flat mode: c#/4 → db/4
  const [letter, oct] = pn.vexKey.split('/');
  const flatLetter = SHARP_TO_FLAT[letter];
  if (!flatLetter) return { vexKey: pn.vexKey };
  return { vexKey: `${flatLetter}/${oct}`, acc: 'b' };
}

function getBeats(dur: string, dotted?: boolean, tuplet?: number): number {
  const base = dur.replace(/r$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (dotted) b *= 1.5;
  if (tuplet === 3) b *= 2 / 3;
  return b;
}

function measureBeats(notes: NoteInfo[]): number {
  return notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
}

/* ─── sax playback ────────────────────────────────────────────────────── */

let _saxCtx: AudioContext | null = null;
let _saxInst: Soundfont.Player | null = null;
let _saxLoading: Promise<void> | null = null;

function ensureSax(): Promise<Soundfont.Player> {
  if (_saxInst) return Promise.resolve(_saxInst);
  if (!_saxCtx) _saxCtx = new AudioContext();
  if (_saxCtx.state === 'suspended') _saxCtx.resume();
  if (!_saxLoading) {
    _saxLoading = Soundfont.instrument(
      _saxCtx,
      'alto_sax' as Soundfont.InstrumentName,
      { gain: 3 },
    ).then((inst) => { _saxInst = inst; });
  }
  return _saxLoading.then(() => _saxInst!);
}

ensureSax().catch(() => {});

/* ─── key signature accidentals ────────────────────────────────────────── */

const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

function keySigAccidentals(vexKey: string): Map<string, 'b' | '#'> {
  const map = new Map<string, 'b' | '#'>();
  const nFlats = FLAT_KEYS[vexKey];
  if (nFlats) { for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b'); }
  const nSharps = SHARP_KEYS[vexKey];
  if (nSharps) { for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#'); }
  return map;
}

/* ─── VexFlow rendering ────────────────────────────────────────────────── */

const SHEET_SCALE = 1.35;
const LINE_HEIGHT = 170;
const MARGIN = { top: 6, left: 10, right: 10, bottom: 10 };
const MAX_PER_LINE = 4;
const DECOR_FIRST = 70;
const DECOR_OTHER = 35;
const PX_PER_DUR: Record<string, number> = { w: 55, h: 40, q: 32, '8': 26, '16': 22 };

interface NotePos { mi: number; ni: number; x: number; y: number; w: number; h: number; }

function measureMinWidth(m: MeasureInfo): number {
  let w = 24;
  for (const n of m.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[base] ?? 28;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 10;
    if (n.dotted) w += 6;
  }
  return Math.max(w, 70);
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


/** Draw a wavy glissando line between two StaveNotes */
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

  // Perpendicular unit vector for wave amplitude
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

  // "gliss." label rotated to match the line angle
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

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number, currentIdx: number, positions: MeasurePos[], sheetKey?: string, notePositions?: NotePos[], selectedNote?: { mi: number; ni: number } | null) {
  positions.length = 0;
  if (notePositions) notePositions.length = 0;
  el.innerHTML = '';
  if (measures.length === 0) return;
  const innerW = width / SHEET_SCALE;
  const totalW = innerW - MARGIN.left - MARGIN.right;
  const lines = packLines(measures, totalW);
  const totalH = MARGIN.top + lines.length * LINE_HEIGHT + MARGIN.bottom;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(innerW, totalH);
  const ctx = renderer.getContext();

  // Uniform scale: scale SVG and set container height
  const svgEl = el.querySelector('svg');
  if (svgEl) {
    svgEl.style.transformOrigin = 'top left';
    svgEl.style.transform = `scale(${SHEET_SCALE})`;
    el.style.height = `${totalH * SHEET_SCALE}px`;
  }
  const allVfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
  let tieCarryAcc: Map<string, 'b' | '#' | 'n'> | undefined;
  const keySigAcc = keySigAccidentals(sheetKey || 'C');

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
      const isLast = m === measures.length - 1 && m !== currentIdx;
      const barW = stretch ? (weights[j] / totalWeight) * availForBars : weights[j] * 1.3;
      const w = firstInLine ? barW + decorW : barW;

      const stave = new Stave(x, y, w);
      if (firstInLine) {
        stave.addClef('treble');
        if (sheetKey && sheetKey !== 'C') stave.addKeySignature(sheetKey);
        if (isFirstLine) stave.addTimeSignature('4/4');
      }
      if (isLast) stave.setEndBarType(BarlineType.END);
      stave.setContext(ctx).draw();

      // Record position for HTML chord overlay
      const chordX = firstInLine ? x + decorW + 4 : x + 4;
      positions.push({ idx: m, x: chordX, y, w: w - (firstInLine ? decorW : 0) - 4, chordX });

      // Highlight current measure
      if (m === currentIdx) {
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y + 14));
          rect.setAttribute('width', String(w));
          rect.setAttribute('height', String(LINE_HEIGHT - 28));
          rect.setAttribute('fill', 'rgba(184, 150, 10, 0.06)');
          rect.setAttribute('rx', '4');
          svgEl.insertBefore(rect, svgEl.firstChild);
        }
      }

      const measure = measures[m];
      if (measure.notes.length === 0) {
        x += w;
        continue;
      }

      // Per-measure accidental tracking for smart display
      // If previous measure ended with a tie, carry its accidental state
      const activeAcc = tieCarryAcc ? new Map(tieCarryAcc) : new Map<string, 'b' | '#' | 'n'>();
      tieCarryAcc = undefined;

      const vfNotes = measure.notes.map((n) => {
        const isRest = n.duration.endsWith('r');
        const dur = buildDuration(n.duration, n.dotted);
        const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: dur, autoStem: true });
        if (n.dotted) Dot.buildAndAttach([note]);

        if (!isRest) {
          const noteId = n.keys[0];
          const letter = noteId.split('/')[0];
          const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
          const current = activeAcc.get(letter);
          const keySigForLetter = keySigAcc.get(letter);

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

      // Carry accidental across barline if last note has a tie
      const lastNote = measure.notes[measure.notes.length - 1];
      if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
        const acc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
        if (acc) {
          tieCarryAcc = new Map([[lastNote.keys[0].split('/')[0], acc]]);
        }
      }

      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setStrict(false);
      voice.addTickables(vfNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);

      // Manual beaming: group consecutive beamable notes (8th, 16th)
      // 16th triplet + one following note beam together, then break
      const beams: Beam[] = [];
      let beamGroup: StaveNote[] = [];
      let groupBeats = 0;
      let inTuplet = false;
      let postTupletMerged = false; // true after merging one note post-16th-triplet

      for (let ni = 0; ni < vfNotes.length; ni++) {
        const vn = vfNotes[ni];
        const isTuplet = !!measure.notes[ni].tuplet;
        const dur = vn.getDuration();
        const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
        const isRest = vn.isRest();
        const noteDots = vn.getModifiersByType('Dot')?.length ?? 0;
        let noteBeats = DUR_BEATS[dur.replace('d', '')] ?? 1;
        if (noteDots > 0 || dur.endsWith('d')) noteBeats *= 1.5;

        // After merging one post-tuplet note, force break before next note
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
            // Allow this one note to merge, then mark for break
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
            // Break at 1-beat boundary for 16th notes, 2-beat boundary for 8th notes
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
          // Force beam break after this note if beamBreak is set
          if (measure.notes[ni].beamBreak) {
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

      voice.draw(ctx, stave);
      beams.forEach((bm) => bm.setContext(ctx).draw());

      // Render tuplet brackets (groups of 3)
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

      // Collect rendered notes for tie drawing
      for (let ni = 0; ni < vfNotes.length; ni++) {
        allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni] });
      }

      x += w;
    }
  }

  // Draw ties: if a note has tie=true, connect it to the next note (same pitch, possibly next measure)
  let flatIdx = 0;
  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi];
    for (let ni = 0; ni < measure.notes.length; ni++) {
      if (measure.notes[ni].tie) {
        const from = allVfNotes[flatIdx];
        const to = allVfNotes[flatIdx + 1];
        if (from && to) {
          const tie = new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndices: [0], lastIndices: [0] });
          tie.setContext(ctx).draw();
        }
      }
      flatIdx++;
    }
  }

  // Draw glissando lines
  if (svgEl) {
    flatIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].gliss) {
          const from = allVfNotes[flatIdx];
          const to = allVfNotes[flatIdx + 1];
          if (from && to) {
            drawGlissLine(svgEl, from.vfNote, to.vfNote);
          }
        }
        flatIdx++;
      }
    }
  }

  // Collect note bounding boxes for click detection & highlight selected note
  if (svgEl) {
    for (const entry of allVfNotes) {
      const bb = entry.vfNote.getBoundingBox();
      if (bb && notePositions) {
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH() });
      }
      // Highlight selected note red (notehead only — stem coloring via CSS class)
      if (selectedNote && entry.mi === selectedNote.mi && entry.ni === selectedNote.ni) {
        const RED = '#d32f2f';
        const noteSvg = entry.vfNote.getSVGElement();
        if (noteSvg) {
          // Color notehead group and all its children
          noteSvg.querySelectorAll('*').forEach((c) => {
            const s = (c as SVGElement).style;
            s.fill = RED; s.stroke = RED;
          });
          (noteSvg as SVGElement).style.fill = RED;
          (noteSvg as SVGElement).style.stroke = RED;
        }
        // Color stem: VexFlow Stem has its own SVG element
        try {
          const stemEl = (entry.vfNote as any).stem?.elem;
          if (stemEl) {
            (stemEl as SVGElement).style.fill = RED;
            (stemEl as SVGElement).style.stroke = RED;
            stemEl.querySelectorAll('*').forEach((c: Element) => {
              (c as SVGElement).style.fill = RED;
              (c as SVGElement).style.stroke = RED;
            });
          }
        } catch { /* no stem (whole note) */ }
        // Color flag
        try {
          const flagEl = (entry.vfNote as any).flag?.elem;
          if (flagEl) {
            (flagEl as SVGElement).style.fill = RED;
            (flagEl as SVGElement).style.stroke = RED;
            flagEl.querySelectorAll('*').forEach((c: Element) => {
              (c as SVGElement).style.fill = RED;
              (c as SVGElement).style.stroke = RED;
            });
          }
        } catch { /* no flag */ }
      }
    }
  }
}

/* ─── SVG icons ────────────────────────────────────────────────────────── */

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

const REST_GLYPHS: Record<string, string> = {
  w:  '\uE4E3',  // SMuFL whole rest
  h:  '\uE4E4',  // SMuFL half rest
  q:  '\uE4E5',  // SMuFL quarter rest
  '8':  '\uE4E6',  // SMuFL 8th rest
  '16': '\uE4E7',  // SMuFL 16th rest
};

function RestIcon({ type }: { type: string }) {
  return (
    <span style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.4rem', lineHeight: 1 }}>
      {REST_GLYPHS[type] ?? REST_GLYPHS['q']}
    </span>
  );
}

const DUR_KEYS = [
  { value: 'w', title: 'Whole (4 beats)' },
  { value: 'h', title: 'Half (2 beats)' },
  { value: 'q', title: 'Quarter (1 beat)' },
  { value: '8', title: 'Eighth (1/2 beat)' },
  { value: '16', title: '16th (1/4 beat)' },
];

/* ─── styled ───────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const BackBtn = styled.button`
  font-size: 0.82rem;
  padding: 4px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover { background: #f0f0f0; }
`;

const Title = styled.span`
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MetaInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.5; }
`;

const MetaLabel = styled.span`
  font-size: 0.7rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ToolBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  flex-wrap: wrap;
`;

const DurCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const DurBtn = styled.button<{ $active?: boolean }>`
  font-size: 1.35rem;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ $active, theme }) => ($active ? '#b8960a' : theme.colors.border)};
  border-radius: 6px;
  background: ${({ $active }) => ($active ? '#f5ecd0' : 'transparent')};
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { background: #f0ebe0; }
`;

const RestBtn = styled.button`
  font-size: 1.35rem;
  width: 42px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover { background: #f0ebe0; }
`;

const BarlineBtn = styled.button`
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.5rem;
  font-weight: 900;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #b8960a;
  border-radius: 6px;
  background: #fff8e1;
  cursor: pointer;
  color: #8B6914;
  &:hover { background: #f5ecd0; }
  &:disabled { opacity: 0.3; cursor: default; }
`;

const Sep = styled.div`
  width: 1px;
  height: 30px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 5px;
`;

const Btn = styled.button`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  padding: 7px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { background: #f0f0f0; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const CopyBtn = styled(Btn)<{ $copied?: boolean }>`
  background: ${({ $copied }) => ($copied ? '#2a6e3f' : '#3070a0')};
  color: #fff;
  border-color: ${({ $copied }) => ($copied ? '#2a6e3f' : '#3070a0')};
  font-weight: 600;
  &:hover { background: ${({ $copied }) => ($copied ? '#2a6e3f' : '#265d88')}; }
`;

const SaveBtn = styled(Btn)<{ $saved?: boolean }>`
  background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  color: #fff;
  border-color: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  font-weight: 600;
  &:hover { background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#6d5310')}; }
`;

const Spacer = styled.div` flex: 1; `;

const PlayBtn = styled.button<{ $playing?: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  padding: 7px 14px;
  border: 1px solid ${({ $playing }) => ($playing ? '#c0392b' : '#2a6e3f')};
  border-radius: 6px;
  background: ${({ $playing }) => ($playing ? '#c0392b' : '#2a6e3f')};
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const BpmInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  outline: none;
  /* Hide number spinner arrows */
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const InfoText = styled.span`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SectionLabel = styled.span`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-right: 2px;
`;

const ChordInput = styled.input`
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.15rem;
  font-weight: 400;
  width: 100px;
  padding: 5px 10px;
  border: 1px solid #b8960a;
  border-radius: 6px;
  background: #fffbe6;
  color: #8B6914;
  outline: none;
  &:focus { border-color: #8B6914; box-shadow: 0 0 0 2px rgba(184, 150, 10, 0.15); }
  &::placeholder { color: #c4a850; opacity: 0.6; }
`;

const MeasureIndicator = styled.span`
  font-size: 0.82rem;
  font-weight: 700;
  color: #8B6914;
  background: #fff8e1;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid #e8d88c;
`;

const BeatIndicator = styled.span<{ $full?: boolean }>`
  font-size: 0.78rem;
  color: ${({ $full }) => ($full ? '#2a6e3f' : '#999')};
  font-weight: ${({ $full }) => ($full ? 700 : 400)};
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
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.5;
  padding-bottom: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const SheetArea = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 16px;
  min-height: 140px;
  position: relative;
`;

const ChordCellWrap = styled.div<{ $hasValue?: boolean }>`
  position: absolute;
  height: 28px;
  border-radius: 3px;
  background: ${({ $hasValue }) => ($hasValue ? 'rgba(255, 248, 220, 0.7)' : 'rgba(0,0,0,0.03)')};
  cursor: text;
  transition: background 0.12s;
  &:hover { background: rgba(255, 248, 220, 0.5); }
`;

const ChordCellDisplay = styled.span`
  display: flex;
  align-items: baseline;
  padding: 0 5px;
  height: 28px;
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  color: #8B6914;
  white-space: nowrap;
  line-height: 28px;
`;

const ChordBase = styled.span`
  font-size: 1.3rem;
  font-weight: 400;
`;

const ChordExt = styled.span`
  font-size: 0.95rem;
  font-weight: 400;
  position: relative;
  top: -4px;
`;

const ChordHalfDim = styled.span`
  font-size: 1.3rem;
  font-weight: 400;
  display: inline-block;
  transform: scaleX(1.3);
  margin: 0 2px;
`;

const ChordTensionNum = styled.span`
  font-size: 0.75rem;
  font-weight: 400;
  position: relative;
  top: -7px;
  margin-left: 0px;
`;

const ChordTensionAcc = styled.span`
  font-size: 0.85rem;
  font-weight: 400;
  position: relative;
  top: -4px;
  margin-left: 2px;
`;

const ChordCellInput = styled.input`
  width: 100%;
  height: 100%;
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.2rem;
  font-weight: 400;
  padding: 2px 5px;
  border: none;
  border-radius: 3px;
  background: rgba(255, 248, 220, 0.85);
  box-shadow: 0 0 0 1.5px rgba(184, 150, 10, 0.25);
  color: #8B6914;
  outline: none;
`;

function normalizeChord(raw: string): string {
  if (!raw) return raw;
  const m = raw.match(/^([A-Ga-g][b#]?)(.*)/);
  if (!m) return raw;
  const root = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  let q = m[2];

  // half-diminished (must be before minor)
  q = q.replace(/^(?:m7b5|min7b5|-7b5)$/i, 'ø7');
  // diminished
  q = q.replace(/^dim7$/i, '°7');
  q = q.replace(/^dim$/i, '°');
  // minor-major (must be before major and minor): -M7, mM7, minmaj7, -maj7
  q = q.replace(/^(?:-|m|min)(?:M|maj)(\d.*)$/i, '-△$1');
  // major
  q = q.replace(/^maj(\d.*)$/i, '△$1');
  q = q.replace(/^maj$/i, '△');
  q = q.replace(/^M(\d.*)$/, '△$1');
  q = q.replace(/^M$/, '△');
  // minor (m, min → -)
  q = q.replace(/^min(\d.*)$/i, '-$1');
  q = q.replace(/^min$/i, '-');
  q = q.replace(/^m(\d.*)$/, '-$1');
  q = q.replace(/^m$/, '-');
  // augmented
  q = q.replace(/^aug(\d.*)$/i, '+$1');
  q = q.replace(/^aug$/i, '+');

  return root + q;
}

function splitChord(chord: string): { base: string; ext: string; tensions: { acc: string; num: string }[] } {
  // Split into base (non-digit prefix) and the rest starting from first digit
  const m = chord.match(/^(\D*?)(\d.*)$/);
  if (!m) return { base: chord, ext: '', tensions: [] };
  // ext is the first number (e.g. "7" from "7♭9♯11")
  const rest = m[2];
  const extMatch = rest.match(/^(\d+)/);
  const ext = extMatch ? extMatch[1] : '';
  let remaining = rest.slice(ext.length);
  // Parse tensions: each is optional accidental + number (e.g. ♭9, ♯11, 13)
  const tensions: { acc: string; num: string }[] = [];
  while (remaining.length > 0) {
    const t = remaining.match(/^([♭♯\u266D\u266F#b]*)(\d+)/);
    if (!t) break;
    tensions.push({ acc: t[1], num: t[2] });
    remaining = remaining.slice(t[0].length);
  }
  // If there's leftover (e.g. trailing "b" without number), append to last tension or ignore
  return { base: m[1], ext, tensions };
}

function formatChordDisplay(raw: string): string {
  const m = raw.match(/^([A-G])([b#]?)(.*)/);
  if (!m) return raw;

  const root = m[1];
  const acc = m[2] === 'b' ? '\u266D' : m[2] === '#' ? '\u266F' : '';
  let q = m[3];

  q = q.replace(/^(-7b5|-7\(b5\)|m7b5)/,  '\u00F87');
  q = q.replace(/^j7/,                     '\u25B37');
  q = q.replace(/^h7/,                     '\u00F87');
  q = q.replace(/^h(?!\d)/,                '\u00F8');
  q = q.replace(/^o7/,                     '\u00B07');
  q = q.replace(/^o(?!\d)/,                '\u00B0');

  q = q.replace(/(\d)b/g,  '$1\u266D');
  q = q.replace(/b(\d)/g,  '\u266D$1');
  q = q.replace(/(\d)#/g,  '$1\u266F');
  q = q.replace(/#(\d)/g,  '\u266F$1');

  return root + acc + q;
}

function ChordCell({ value, onChange, style }: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formatted = formatChordDisplay(value);
  const { base, ext, tensions } = splitChord(formatted);

  return (
    <ChordCellWrap $hasValue={!!value} style={style} onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}>
      {editing ? (
        <ChordCellInput
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { onChange(normalizeChord(value)); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onChange(normalizeChord(value)); setEditing(false); } }}
        />
      ) : (
        <ChordCellDisplay>
          {value ? (() => {
            // Separate half-dim/dim symbol from base if present
            const dimMatch = base.match(/^(.*?)([\u00F8\u00B0])$/);
            const baseText = dimMatch ? dimMatch[1] : base;
            const dimSymbol = dimMatch ? dimMatch[2] : '';
            return <>
              <ChordBase>{baseText}</ChordBase>
              {dimSymbol && <ChordHalfDim>{dimSymbol}</ChordHalfDim>}
              {ext && <ChordExt>{ext}</ChordExt>}
              {tensions.map((t, i) => (
                <span key={i}>
                  {t.acc && <ChordTensionAcc>{t.acc}</ChordTensionAcc>}
                  <ChordTensionNum>{t.num}</ChordTensionNum>
                </span>
              ))}
            </>;
          })() : null}
        </ChordCellDisplay>
      )}
    </ChordCellWrap>
  );
}

const NoteEditBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 18px;
  border-bottom: 2px solid #d32f2f;
  background: #fff5f5;
  flex-wrap: wrap;
`;

const NoteEditLabel = styled.span`
  font-size: 0.82rem;
  font-weight: 700;
  color: #d32f2f;
`;

const NoteEditBtn = styled.button<{ $active?: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  padding: 5px 12px;
  border: 1px solid ${({ $active }) => ($active ? '#d32f2f' : '#ccc')};
  border-radius: 6px;
  background: ${({ $active }) => ($active ? '#ffcdd2' : '#fff')};
  cursor: pointer;
  color: ${({ $active }) => ($active ? '#d32f2f' : '#333')};
  font-weight: ${({ $active }) => ($active ? 700 : 400)};
  &:hover { background: #ffebee; }
`;

const NoteChordOverlayInput = styled.input`
  position: absolute;
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.2rem;
  font-weight: 400;
  width: 58px;
  height: 28px;
  padding: 2px 5px;
  border: none;
  border-radius: 3px;
  background: rgba(255, 248, 220, 0.85);
  box-shadow: 0 0 0 1.5px rgba(184, 150, 10, 0.25);
  color: #8B6914;
  outline: none;
  z-index: 10;
  &:focus { box-shadow: 0 0 0 2px rgba(184, 150, 10, 0.45); }
  &::placeholder { color: #c4a850; opacity: 0.6; }
`;

const EmptyHint = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;
  opacity: 0.5;
`;

const JsonPreview = styled.pre`
  margin: 0 16px 16px;
  padding: 12px 16px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.72rem;
  overflow-x: auto;
  max-height: 240px;
  overflow-y: auto;
`;

/* ─── component ────────────────────────────────────────────────────────── */

export default function LickInputPage() {
  const navigate = useNavigate();

  // Completed measures
  const [measures, setMeasures] = useState<MeasureInfo[]>([]);
  // Current (open) measure
  const [curNotes, setCurNotes] = useState<NoteInfo[]>([]);
  const [curChord, setCurChord] = useState('');

  const [performer, setPerformer] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const [instrument, setInstrument] = useState('');
  const [lickKey, setLickKey] = useState('');

  const [duration, setDuration] = useState('8');
  const [dotted, setDotted] = useState(false);
  const [accMode, setAccMode] = useState<'b' | '#' | 'n'>('b');
  const [tieNext, setTieNext] = useState(false);
  const [tripletMode, setTripletMode] = useState(false);
  const tripletCountRef = useRef(0);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [bpm, setBpm] = useState(200);
  const [bpmText, setBpmText] = useState('200');
  const bpmManualRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playAbortRef = useRef<AbortController | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const chordRef = useRef<HTMLInputElement>(null);
  const positionsRef = useRef<MeasurePos[]>([]);
  const [measurePositions, setMeasurePositions] = useState<MeasurePos[]>([]);
  const notePositionsRef = useRef<NotePos[]>([]);
  const [notePositions, setNotePositions] = useState<NotePos[]>([]);
  const [selectedNote, setSelectedNote] = useState<{ mi: number; ni: number } | null>(null);
  const [noteChordEditing, setNoteChordEditing] = useState(false);
  const [noteChordValue, setNoteChordValue] = useState('');
  const noteChordInputRef = useRef<HTMLInputElement>(null);

  // Undo stack for note-edit operations (accidental, tie, divide, chord)
  const editUndoStack = useRef<{ measures: MeasureInfo[]; curNotes: NoteInfo[]; curChord: string }[]>([]);
  const pushEditUndo = useCallback(() => {
    editUndoStack.current.push({ measures: measures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })), curNotes: curNotes.map((n) => ({ ...n })), curChord });
    if (editUndoStack.current.length > 50) editUndoStack.current.shift();
  }, [measures, curNotes, curChord]);

  const curBeats = useMemo(() => measureBeats(curNotes), [curNotes]);

  // Ref for curChord so auto-close effect reads the latest value
  const curChordRef = useRef(curChord);
  curChordRef.current = curChord;

  // All measures for rendering (completed + current if has notes)
  const allMeasures = useMemo<MeasureInfo[]>(() => {
    if (curNotes.length === 0 && !curChord) return measures;
    return [...measures, { notes: curNotes, chord: curChord || undefined }];
  }, [measures, curNotes, curChord]);

  const currentIdx = curNotes.length > 0 || curChord ? measures.length : -1;

  // Auto-adjust BPM based on 16th note presence
  useEffect(() => {
    if (bpmManualRef.current) return;
    const has16ths = allMeasures.some((m) => m.notes.some((n) => n.duration === '16' || n.duration === '16r'));
    const newBpm = has16ths ? 120 : 200;
    setBpm(newBpm);
    setBpmText(String(newBpm));
  }, [allMeasures]);

  // Auto-close helper: called after adding a note to check if measure is full
  const maybeAutoClose = useCallback((notes: NoteInfo[]) => {
    const beats = notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
    if (notes.length > 0 && beats >= 4 - 0.001) {
      setMeasures((prev) => [...prev, { notes, chord: curChordRef.current || undefined }]);
      setCurNotes([]);
      setCurChord('');
      setTimeout(() => chordRef.current?.focus(), 50);
    }
  }, []);

  // Close the current measure manually
  const closeMeasure = useCallback(() => {
    if (curNotes.length === 0) return;
    setMeasures((prev) => [...prev, { notes: curNotes, chord: curChord || undefined }]);
    setCurNotes([]);
    setCurChord('');
    setTimeout(() => chordRef.current?.focus(), 50);
  }, [curNotes, curChord]);

  /* width tracking */
  const [sheetWidth, setSheetWidth] = useState(800);
  const sheetAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheetAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setSheetWidth(w - 32);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* piano input — store real pitch, display logic handled in renderSheet */
  const handleNotePress = useCallback((pn: PianoNote) => {
    const conv = convertAcc(pn, accMode === 'n' ? 'b' : accMode);
    const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
    if (accMode === 'n') {
      ni.accidentals = { 0: 'n' };
    } else if (conv.acc) {
      ni.accidentals = { 0: conv.acc };
    }
    if (tripletMode) ni.tuplet = 3;
    playMidi(pn.midi);

    let newNotes: NoteInfo[];
    if (tieNext) {
      if (curNotes.length > 0) {
        newNotes = [...curNotes];
        newNotes[newNotes.length - 1] = { ...newNotes[newNotes.length - 1], tie: true };
        newNotes.push(ni);
      } else {
        // Mark last note of last completed measure as tied
        if (measures.length > 0) {
          setMeasures((prev) => {
            const updated = [...prev];
            const lastM = { ...updated[updated.length - 1] };
            const lastNotes = [...lastM.notes];
            lastNotes[lastNotes.length - 1] = { ...lastNotes[lastNotes.length - 1], tie: true };
            lastM.notes = lastNotes;
            updated[updated.length - 1] = lastM;
            return updated;
          });
        }
        newNotes = [ni];
      }
      setTieNext(false);
    } else {
      newNotes = [...curNotes, ni];
    }

    setCurNotes(newNotes);
    maybeAutoClose(newNotes);

    // Auto-exit triplet mode after 3 notes
    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }
  }, [duration, dotted, accMode, tieNext, tripletMode, curNotes, measures.length, maybeAutoClose]);

  const handleRest = useCallback((dur?: string) => {
    const d = dur ?? duration;
    const ni: NoteInfo = { keys: ['b/4'], duration: d + 'r', dotted: dotted || undefined };
    if (tripletMode) ni.tuplet = 3;
    const newNotes = [...curNotes, ni];
    setCurNotes(newNotes);
    maybeAutoClose(newNotes);
    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }
  }, [duration, dotted, tripletMode, curNotes, maybeAutoClose]);

  /* undo: pop edit-undo stack first, then fall back to removing last note / measure */
  const handleUndo = useCallback(() => {
    if (editUndoStack.current.length > 0) {
      const snap = editUndoStack.current.pop()!;
      setMeasures(snap.measures);
      setCurNotes(snap.curNotes);
      setCurChord(snap.curChord);
      return;
    }
    if (curNotes.length > 0) {
      setCurNotes((p) => p.slice(0, -1));
    } else if (measures.length > 0) {
      const last = measures[measures.length - 1];
      setMeasures((p) => p.slice(0, -1));
      setCurNotes(last.notes);
      setCurChord(last.chord ?? '');
    }
  }, [curNotes.length, measures]);

  const handleClear = useCallback(() => {
    setMeasures([]);
    setCurNotes([]);
    setCurChord('');
  }, []);

  /* keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Backspace') { e.preventDefault(); handleUndo(); }
      if (e.key === 'Enter') { e.preventDefault(); closeMeasure(); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setTieNext((v) => !v); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setTripletMode((v) => { if (!v) tripletCountRef.current = 0; return !v; }); }
      if (e.key === '1') { e.preventDefault(); setDuration('w'); setDotted(false); }
      if (e.key === '2') { e.preventDefault(); setDuration('h'); setDotted(false); }
      if (e.key === '4') { e.preventDefault(); setDuration('q'); setDotted(false); }
      if (e.key === '8') { e.preventDefault(); setDuration('8'); setDotted(false); }
      if (e.key === '6') { e.preventDefault(); setDuration('16'); setDotted(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, closeMeasure]);

  /* render VexFlow */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (allMeasures.length === 0) { el.innerHTML = ''; positionsRef.current = []; setMeasurePositions([]); notePositionsRef.current = []; return; }
    renderSheet(el, allMeasures, Math.max(sheetWidth, 300), currentIdx, positionsRef.current, lickKey || undefined, notePositionsRef.current, selectedNote);
    setMeasurePositions([...positionsRef.current]);
    setNotePositions([...notePositionsRef.current]);
  }, [allMeasures, sheetWidth, currentIdx, lickKey, selectedNote]);

  // Selected note info
  const selNoteInfo = useMemo<NoteInfo | null>(() => {
    if (!selectedNote) return null;
    const m = allMeasures[selectedNote.mi];
    if (!m) return null;
    return m.notes[selectedNote.ni] ?? null;
  }, [selectedNote, allMeasures]);

  // Deselect when measures change structurally (undo, clear, etc.)
  useEffect(() => {
    if (selectedNote && !allMeasures[selectedNote.mi]?.notes[selectedNote.ni]) {
      setSelectedNote(null);
    }
  }, [allMeasures, selectedNote]);

  /* click on SVG to select/deselect notes */
  const handleSheetClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    // Convert click coords to unscaled SVG coords
    const cx = (e.clientX - rect.left) / SHEET_SCALE;
    const cy = (e.clientY - rect.top) / SHEET_SCALE;
    // Find closest note within hit distance
    let best: NotePos | null = null;
    let bestDist = Infinity;
    for (const np of notePositionsRef.current) {
      const ncx = np.x + np.w / 2;
      const ncy = np.y + np.h / 2;
      const dx = cx - ncx;
      const dy = cy - ncy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist && dist < 25) { bestDist = dist; best = np; }
    }
    if (best) {
      // Toggle: if already selected, deselect
      if (selectedNote && selectedNote.mi === best.mi && selectedNote.ni === best.ni) {
        setSelectedNote(null);
      } else {
        setSelectedNote({ mi: best.mi, ni: best.ni });
      }
    } else {
      setSelectedNote(null);
    }
  }, [selectedNote]);

  /* helper: modify a specific note in measures/curNotes */
  const updateNote = useCallback((mi: number, ni: number, updater: (n: NoteInfo) => NoteInfo) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? updater(n) : n) } : m));
    } else {
      // It's in curNotes
      setCurNotes((prev) => prev.map((n, j) => j === ni ? updater(n) : n));
    }
  }, [measures.length, pushEditUndo]);

  /* set chord on a specific note */
  const setChordAtNote = useCallback((mi: number, ni: number, chord: string) => {
    updateNote(mi, ni, (n) => ({ ...n, chord: chord || undefined }));
  }, [updateNote]);

  /* build JSON */
  const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length;

  const jsonOutput = useMemo(() => {
    if (allMeasures.length === 0) return '';
    const totalN = allMeasures.reduce((s, m) => s + m.notes.filter(n => !n.duration.endsWith('r')).length, 0);
    const entry = {
      id: 0,
      performer: performer || 'Unknown',
      title: title || 'Untitled',
      album,
      instrument,
      key: lickKey,
      style: '',
      tempo: null as number | null,
      tags: [] as string[],
      chords: allMeasures.map((m) => m.chord ?? '').filter(Boolean),
      sheetData: {
        timeSignature: '4/4',
        measures: allMeasures,
      },
      intervals: [] as number[],
      parsons: [] as number[],
      fuzzyIntervals: [] as number[],
      durationClasses: [] as number[],
    };
    return JSON.stringify(entry, null, 2);
  }, [allMeasures, performer, title, album, instrument, lickKey]);

  /* playback */
  const handlePlay = useCallback(async () => {
    if (playing) {
      playAbortRef.current?.abort();
      setPlaying(false);
      return;
    }
    if (allMeasures.length === 0) return;

    const sax = await ensureSax();
    const abort = new AbortController();
    playAbortRef.current = abort;
    setPlaying(true);

    const beatDur = 60 / bpm; // seconds per beat

    // Flatten all notes for tie merging
    const flat: NoteInfo[] = [];
    for (const m of allMeasures) for (const n of m.notes) flat.push(n);

    try {
      let i = 0;
      while (i < flat.length) {
        if (abort.signal.aborted) throw 'stop';
        const n = flat[i];
        const isRest = n.duration.endsWith('r');
        const baseDur = n.duration.replace(/r$/, '');
        let beats = DUR_BEATS[baseDur] ?? 1;
        if (n.dotted) beats *= 1.5;
        if (n.tuplet === 3) beats *= 2 / 3;

        // Merge tied notes: accumulate duration, skip tied targets
        if (!isRest && n.tie) {
          let look = i + 1;
          while (look < flat.length) {
            const ln = flat[look];
            const lb = ln.duration.replace(/r$/, '');
            let lbeats = DUR_BEATS[lb] ?? 1;
            if (ln.dotted) lbeats *= 1.5;
            if (ln.tuplet === 3) lbeats *= 2 / 3;
            beats += lbeats;
            if (!ln.tie) { look++; break; }
            look++;
          }
          const sec = beats * beatDur;
          const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
          const midi = vexToMidi(n.keys[0], acc);
          sax.play(String(midi), 0, { duration: sec * 0.9, gain: 3 });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, sec * 1000);
            abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
          });
          i = look;
          continue;
        }

        const sec = beats * beatDur;
        if (!isRest) {
          const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
          const midi = vexToMidi(n.keys[0], acc);
          sax.play(String(midi), 0, { duration: sec * 0.9, gain: 3 });
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, sec * 1000);
          abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
        });
        i++;
      }
    } catch {
      // stopped
    }

    sax.stop();
    setPlaying(false);
  }, [playing, allMeasures, bpm]);

  /* update chord for any measure (completed or current) */
  const updateMeasureChord = useCallback((idx: number, chord: string) => {
    if (idx === measures.length) {
      // Current (open) measure
      setCurChord(chord);
    } else {
      setMeasures((prev) => prev.map((m, i) => i === idx ? { ...m, chord: chord || undefined } : m));
    }
  }, [measures.length]);

  /* save to localStorage */
  const handleSave = useCallback(() => {
    if (allMeasures.length === 0) return;
    const totalN = allMeasures.reduce((s, m) => s + m.notes.filter(n => !n.duration.endsWith('r')).length, 0);
    const entry: LickEntry = {
      id: Date.now(),
      performer,
      title,
      instrument,
      album,
      style: '',
      tempo: bpm,
      key: lickKey,
      rhythmfeel: '',
      tag: 'custom',
      chords: allMeasures.map((m) => m.chord ?? ''),
      nEvents: totalN,
      label: `${performer || 'Unknown'} — ${title || 'Untitled'} (${allMeasures.map(m => m.chord || '').filter(Boolean).join(' → ')})`,
      sheetData: {
        title: `${performer || 'Unknown'} — ${title || 'Untitled'}`,
        composer: performer,
        key: lickKey,
        timeSignature: '4/4',
        tempo: bpm,
        measures: allMeasures,
      },
      ...computeLickFeatures(allMeasures),
    };
    saveUserLick(entry);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [allMeasures, performer, title, instrument, bpm, lickKey]);

  /* copy */
  const handleCopy = useCallback(() => {
    if (!jsonOutput) return;
    navigator.clipboard.writeText(jsonOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [jsonOutput]);

  return (
    <Page>
      <Header>
        <BackBtn onClick={() => navigate('/')}>&#8592; Home</BackBtn>
        <Title>Lick JSON Tool</Title>
        <BackBtn onClick={() => navigate('/my-licks')}>My Licks</BackBtn>
        <Sep />
        <MetaLabel>Performer</MetaLabel>
        <MetaInput value={performer} onChange={(e) => setPerformer(e.target.value)} placeholder="e.g. Charlie Parker" style={{ width: 140 }} />
        <MetaLabel>Title</MetaLabel>
        <MetaInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Donna Lee" style={{ width: 140 }} />
        <MetaLabel>Album</MetaLabel>
        <MetaInput value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="e.g. Now's the Time" style={{ width: 160 }} />
        <MetaLabel>Instrument</MetaLabel>
        <MetaInput value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="e.g. as" style={{ width: 70 }} />
        <MetaLabel>Key</MetaLabel>
        <MetaInput value={lickKey} onChange={(e) => setLickKey(e.target.value)} placeholder="e.g. Ab" style={{ width: 50 }} />
      </Header>

      <ToolBar>
        <SectionLabel>Duration</SectionLabel>
        {DUR_KEYS.map((d) => (
          <DurCol key={d.value}>
            <DurBtn $active={duration === d.value} onClick={() => { setDuration(d.value); setDotted(false); }} title={d.title}>
              <NoteIcon type={d.value} />
            </DurBtn>
            <RestBtn onClick={() => handleRest(d.value)} title={`${d.title} rest`}>
              <RestIcon type={d.value} />
            </RestBtn>
          </DurCol>
        ))}
        <DurBtn $active={dotted} onClick={() => setDotted((v) => !v)} title="Dotted" style={{ fontSize: '1.6rem', fontWeight: 900 }}>.</DurBtn>
        <DurBtn $active={accMode === 'b'} onClick={() => setAccMode('b')} title="Flat mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>♭</DurBtn>
        <DurBtn $active={accMode === '#'} onClick={() => setAccMode('#')} title="Sharp mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>♯</DurBtn>
        <DurBtn $active={accMode === 'n'} onClick={() => setAccMode((v) => v === 'n' ? 'b' : 'n')} title="Natural mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>♮</DurBtn>

        <Sep />
        <DurBtn $active={tieNext} onClick={() => setTieNext((v) => !v)} title="Tie to next note (L)" style={{ fontSize: '1.3rem' }}>
          <svg width="22" height="16" viewBox="0 0 18 14" style={{ display: 'block' }}>
            <path d="M2 4 Q9 14 16 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </DurBtn>
        <DurBtn
          $active={tripletMode}
          onClick={() => setTripletMode((v) => { if (!v) tripletCountRef.current = 0; return !v; })}
          title="Triplet mode (T) — next 3 notes become triplet"
          style={{ fontSize: '0.95rem', fontWeight: 700 }}
        >
          3
        </DurBtn>
        <BarlineBtn onClick={closeMeasure} disabled={curNotes.length === 0} title="Close measure (Enter)">|</BarlineBtn>

        <Sep />

        <SectionLabel>Chord</SectionLabel>
        <ChordInput
          ref={chordRef}
          value={curChord}
          onChange={(e) => setCurChord(e.target.value)}
          onBlur={() => setCurChord(normalizeChord(curChord))}
          placeholder="e.g. Dm7"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); setCurChord(normalizeChord(curChord)); closeMeasure(); }
          }}
        />

        <Sep />

        <MeasureIndicator>Bar {measures.length + 1}</MeasureIndicator>
        <BeatIndicator $full={curBeats >= 4}>
          {curBeats}/{4} beats
        </BeatIndicator>

        <Spacer />

        <Btn onClick={handleUndo} title="Undo (Backspace)">Undo</Btn>
        <Btn onClick={handleClear}>Clear</Btn>
        <Btn onClick={() => setShowPreview((v) => !v)} disabled={totalNotes === 0}>
          {showPreview ? 'Hide JSON' : 'Preview JSON'}
        </Btn>
        <CopyBtn $copied={copied} onClick={handleCopy} disabled={totalNotes === 0}>
          {copied ? '\u2713 Copied!' : 'Copy JSON'}
        </CopyBtn>
        <SaveBtn $saved={saved} onClick={handleSave} disabled={totalNotes === 0}>
          {saved ? '\u2713 Saved!' : 'Save Lick'}
        </SaveBtn>

        <Sep />

        <SectionLabel>BPM</SectionLabel>
        <BpmInput
          type="text"
          inputMode="numeric"
          value={bpmText}
          onChange={(e) => {
            bpmManualRef.current = true;
            const v = e.target.value.replace(/[^0-9]/g, '');
            setBpmText(v);
            const n = Number(v);
            if (n >= 20 && n <= 400) setBpm(n);
          }}
          onBlur={() => {
            const n = Math.max(20, Math.min(400, Number(bpmText) || 200));
            setBpm(n);
            setBpmText(String(n));
          }}
        />
        <PlayBtn $playing={playing} onClick={handlePlay} disabled={totalNotes === 0}>
          {playing ? '■ Stop' : '▶ Play'}
        </PlayBtn>

        <Spacer />

        <InfoText>
          {totalNotes} notes &middot; {allMeasures.length} bars
        </InfoText>
      </ToolBar>

      <PianoArea>
        <PianoKeyboard onNotePress={handleNotePress} mute />
      </PianoArea>
      <KeyHint>1=whole &middot; 2=half &middot; 4=quarter &middot; 8=8th &middot; 6=16th &middot; L=tie &middot; T=triplet &middot; Enter=close measure &middot; Backspace=undo</KeyHint>

      {selectedNote && selNoteInfo && (
        <NoteEditBar>
          <NoteEditLabel>
            Note: {selNoteInfo.keys[0]} ({selNoteInfo.duration.replace('r', ' rest')})
            {selNoteInfo.accidentals?.[0] === 'b' ? ' ♭' : selNoteInfo.accidentals?.[0] === '#' ? ' ♯' : selNoteInfo.accidentals?.[0] === 'n' ? ' ♮' : ''}
          </NoteEditLabel>
          <Sep />

          {/* Accidental buttons */}
          <NoteEditBtn
            $active={selNoteInfo.accidentals?.[0] === 'b'}
            onClick={() => {
              updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.accidentals?.[0];
                if (cur === 'b') {
                  // Remove flat
                  const { ...rest } = n;
                  delete rest.accidentals;
                  return rest;
                }
                return { ...n, accidentals: { 0: 'b' as const } };
              });
            }}
          >♭</NoteEditBtn>
          <NoteEditBtn
            $active={selNoteInfo.accidentals?.[0] === '#'}
            onClick={() => {
              updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.accidentals?.[0];
                if (cur === '#') {
                  const { ...rest } = n;
                  delete rest.accidentals;
                  return rest;
                }
                return { ...n, accidentals: { 0: '#' as const } };
              });
            }}
          >♯</NoteEditBtn>
          <NoteEditBtn
            $active={selNoteInfo.accidentals?.[0] === 'n'}
            onClick={() => {
              updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.accidentals?.[0];
                if (cur === 'n') {
                  const { ...rest } = n;
                  delete rest.accidentals;
                  return rest;
                }
                return { ...n, accidentals: { 0: 'n' as const } };
              });
            }}
          >♮</NoteEditBtn>

          <Sep />

          {/* Tie button — only if next note has same pitch */}
          {(() => {
            if (selNoteInfo.duration.endsWith('r')) return null;
            // Find next note
            const flat: { mi: number; ni: number; note: NoteInfo }[] = [];
            for (let mi = 0; mi < allMeasures.length; mi++)
              for (let ni = 0; ni < allMeasures[mi].notes.length; ni++)
                flat.push({ mi, ni, note: allMeasures[mi].notes[ni] });
            const idx = flat.findIndex((f) => f.mi === selectedNote.mi && f.ni === selectedNote.ni);
            const next = flat[idx + 1];
            if (!next || next.note.duration.endsWith('r')) return null;
            // Same pitch check
            const curPitch = vexToMidi(selNoteInfo.keys[0], selNoteInfo.accidentals?.[0] as '#' | 'b' | undefined);
            const nextPitch = vexToMidi(next.note.keys[0], next.note.accidentals?.[0] as '#' | 'b' | undefined);
            if (curPitch !== nextPitch) return null;
            return (
              <NoteEditBtn
                $active={!!selNoteInfo.tie}
                onClick={() => {
                  updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, tie: !n.tie || undefined }));
                }}
              >
                <svg width="22" height="14" viewBox="0 0 18 14" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                  <path d="M2 4 Q9 14 16 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
                {' '}Tie
              </NoteEditBtn>
            );
          })()}

          {/* Glissando button — only if not a rest and has a next note */}
          {(() => {
            if (selNoteInfo.duration.endsWith('r')) return null;
            const flat: { mi: number; ni: number; note: NoteInfo }[] = [];
            for (let mi = 0; mi < allMeasures.length; mi++)
              for (let ni = 0; ni < allMeasures[mi].notes.length; ni++)
                flat.push({ mi, ni, note: allMeasures[mi].notes[ni] });
            const idx = flat.findIndex((f) => f.mi === selectedNote.mi && f.ni === selectedNote.ni);
            const next = flat[idx + 1];
            if (!next || next.note.duration.endsWith('r')) return null;
            return (
              <NoteEditBtn
                $active={!!selNoteInfo.gliss}
                onClick={() => {
                  updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, gliss: !n.gliss || undefined }));
                }}
              >
                <svg width="22" height="14" viewBox="0 0 22 14" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                  <path d="M2 12 Q7 8 12 6 Q17 4 20 2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
                {' '}Gliss
              </NoteEditBtn>
            );
          })()}

          {/* Divide (beam break) button — only for beamable notes */}
          {(() => {
            if (selNoteInfo.duration.endsWith('r')) return null;
            const base = selNoteInfo.duration.replace(/r$/, '');
            if (base !== '8' && base !== '16') return null;
            return (
              <NoteEditBtn
                $active={!!selNoteInfo.beamBreak}
                onClick={() => {
                  updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, beamBreak: !n.beamBreak || undefined }));
                }}
              >
                Divide
              </NoteEditBtn>
            );
          })()}

          <Sep />

          {/* Chord button — opens input overlay above the note on the sheet */}
          <NoteEditBtn
            $active={noteChordEditing}
            onClick={() => {
              if (noteChordEditing) {
                const norm = normalizeChord(noteChordValue);
                setChordAtNote(selectedNote.mi, selectedNote.ni, norm);
                setNoteChordEditing(false);
              } else {
                setNoteChordValue(selNoteInfo?.chord ?? '');
                setNoteChordEditing(true);
                setTimeout(() => noteChordInputRef.current?.focus(), 0);
              }
            }}
          >
            Chord{selNoteInfo?.chord ? `: ${selNoteInfo.chord}` : ''}
          </NoteEditBtn>

          <Sep />
          <NoteEditBtn onClick={() => setSelectedNote(null)}>✕ Deselect</NoteEditBtn>
        </NoteEditBar>
      )}

      {showPreview && jsonOutput && <JsonPreview>{jsonOutput}</JsonPreview>}

      <SheetArea ref={sheetAreaRef}>
        {totalNotes === 0 && <EmptyHint>Type chord &rarr; play notes &rarr; Enter or | to close measure</EmptyHint>}
        <div style={{ position: 'relative' }} onClick={handleSheetClick}>
          <div ref={svgRef} />
          {measurePositions.map((pos) => (
            <ChordCell
              key={pos.idx}
              value={allMeasures[pos.idx]?.chord ?? ''}
              onChange={(v) => updateMeasureChord(pos.idx, v)}
              style={{ left: pos.chordX * SHEET_SCALE, top: (pos.y - 2) * SHEET_SCALE, width: 58 * SHEET_SCALE }}
            />
          ))}
          {/* Per-note chord labels — same style/size as measure chords */}
          {notePositions.map((np) => {
            const note = allMeasures[np.mi]?.notes[np.ni];
            if (!note?.chord) return null;
            // If this note is being chord-edited, show input instead
            if (noteChordEditing && selectedNote && selectedNote.mi === np.mi && selectedNote.ni === np.ni) return null;
            // Use the measure's y so chord sits at the same row as measure chords
            const mpos = measurePositions.find((p) => p.idx === np.mi);
            const chordY = mpos ? mpos.y : np.y - 20;
            return (
              <ChordCell
                key={`nc-${np.mi}-${np.ni}`}
                value={note.chord}
                onChange={(v) => setChordAtNote(np.mi, np.ni, v)}
                style={{ left: (np.x - 4) * SHEET_SCALE, top: (chordY - 2) * SHEET_SCALE, width: 58 * SHEET_SCALE }}
              />
            );
          })}
          {/* Per-note chord input overlay */}
          {noteChordEditing && selectedNote && (() => {
            const np = notePositions.find((p) => p.mi === selectedNote.mi && p.ni === selectedNote.ni);
            if (!np) return null;
            const mpos = measurePositions.find((p) => p.idx === selectedNote.mi);
            const chordY = mpos ? mpos.y : np.y - 20;
            return (
              <NoteChordOverlayInput
                ref={noteChordInputRef}
                value={noteChordValue}
                onChange={(e) => setNoteChordValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => {
                  const norm = normalizeChord(noteChordValue);
                  setChordAtNote(selectedNote.mi, selectedNote.ni, norm);
                  setNoteChordEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    const norm = normalizeChord(noteChordValue);
                    setChordAtNote(selectedNote.mi, selectedNote.ni, norm);
                    setNoteChordEditing(false);
                  }
                }}
                placeholder="e.g. Dm7"
                autoFocus
                style={{ left: (np.x - 4) * SHEET_SCALE, top: (chordY - 2) * SHEET_SCALE }}
              />
            );
          })()}
        </div>
      </SheetArea>
    </Page>
  );
}
