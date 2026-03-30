import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, VoltaType, StaveTie, Tuplet, Repetition,
} from 'vexflow';
import Soundfont from 'soundfont-player';
import type { NoteInfo, MeasureInfo } from '../data/sampleMelody';
import { loadUserLicks, type LickEntry } from '../data/lickData';

/* ─── transposition helpers ───────────────────────────────────────────── */

const FLAT_NOTES: { letter: string; acc?: 'b' }[] = [
  { letter: 'c' }, { letter: 'd', acc: 'b' }, { letter: 'd' },
  { letter: 'e', acc: 'b' }, { letter: 'e' }, { letter: 'f' },
  { letter: 'g', acc: 'b' }, { letter: 'g' }, { letter: 'a', acc: 'b' },
  { letter: 'a' }, { letter: 'b', acc: 'b' }, { letter: 'b' },
];

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAME_TO_SEMI: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

const CIRCLE_OF_5THS = ['Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab'];
const CIRCLE_SEMITONES = CIRCLE_OF_5THS.map(k => NAME_TO_SEMI[k]);

function noteToMidi(key: string, acc?: 'b' | '#' | 'n'): number {
  const [letter, oct] = key.split('/');
  let semi = SEMI_MAP[letter] ?? 0;
  if (acc === 'b') semi -= 1;
  if (acc === '#') semi += 1;
  return (parseInt(oct) + 1) * 12 + semi;
}

function midiToNote(midi: number): { key: string; acc?: 'b' } {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const { letter, acc } = FLAT_NOTES[pc];
  return { key: `${letter}/${oct}`, acc };
}

function transposeChord(chord: string, semitones: number): string {
  if (!chord) return chord;
  const m = chord.match(/^([A-G][b#]?)(.*)/);
  if (!m) return chord;
  const rootSemi = NAME_TO_SEMI[m[1]] ?? 0;
  const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;
  return KEY_NAMES[newSemi] + m[2];
}

const MIDI_F6 = 89; // upper bound (inclusive)
const MIDI_F3 = 53; // lower bound (inclusive)

function transposeMeasures(measures: MeasureInfo[], semitones: number): MeasureInfo[] {
  if (semitones === 0) return measures;

  // First pass: transpose all notes and collect MIDI values
  let hasHigh = false;
  let hasLow = false;
  const transposed = measures.map(m => ({
    ...m,
    chord: m.chord ? transposeChord(m.chord, semitones) : m.chord,
    notes: m.notes.map(n => {
      if (n.duration.endsWith('r')) return { ...n };
      const acc = n.accidentals?.[0] as 'b' | '#' | 'n' | undefined;
      const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc) + semitones;
      if (midi > MIDI_F6) hasHigh = true;
      if (midi < MIDI_F3) hasLow = true;
      const tr = midiToNote(midi);
      const newNote: NoteInfo = { keys: [tr.key], duration: n.duration, dotted: n.dotted, tie: n.tie, tuplet: n.tuplet };
      if (tr.acc) newNote.accidentals = { 0: tr.acc };
      return newNote;
    }),
  }));

  // Octave adjustment: shift all pitched notes if any note is out of range
  const octShift = hasHigh ? -12 : hasLow ? 12 : 0;
  if (octShift === 0) return transposed;

  return transposed.map(m => ({
    ...m,
    notes: m.notes.map(n => {
      if (n.duration.endsWith('r')) return n;
      const acc = n.accidentals?.[0] as 'b' | '#' | 'n' | undefined;
      const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc) + octShift;
      const tr = midiToNote(midi);
      const newNote: NoteInfo = { keys: [tr.key], duration: n.duration, dotted: n.dotted, tie: n.tie, tuplet: n.tuplet };
      if (tr.acc) newNote.accidentals = { 0: tr.acc };
      return newNote;
    }),
  }));
}

function getTranspositionOrder(lickKey: string): { keyName: string; semitones: number }[] {
  const rootMatch = lickKey?.match(/^([A-G][b#]?)/);
  if (!rootMatch) {
    // Unknown key: chromatic ascending
    return KEY_NAMES.map((name, i) => ({ keyName: name, semitones: i }));
  }
  const rootSemi = NAME_TO_SEMI[rootMatch[1]] ?? 0;
  const circleIdx = CIRCLE_SEMITONES.indexOf(rootSemi);
  const startIdx = circleIdx >= 0 ? circleIdx : 0;
  const result: { keyName: string; semitones: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = (startIdx + i) % 12;
    const targetSemi = CIRCLE_SEMITONES[idx];
    const interval = ((targetSemi - rootSemi) % 12 + 12) % 12;
    result.push({ keyName: CIRCLE_OF_5THS[idx], semitones: interval });
  }
  return result;
}

/* ─── rendering helpers (same as LickCard/LickInputPage) ──────────────── */

const LINE_HEIGHT = 140;
const MARGIN = { top: 24, left: 10, right: 10, bottom: 10 };
const MAX_PER_LINE = 6;
const DECOR_FIRST = 70;
const DECOR_OTHER = 35;
const PX_PER_DUR: Record<string, number> = { w: 50, h: 35, q: 28, '8': 22, '16': 18 };
const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const CHORD_FONT = "'MuseJazz Text', 'DM Sans', sans-serif";

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

function buildVfNotes(measure: MeasureInfo, initialAcc?: Map<string, 'b' | '#' | 'n'>, keySigAcc?: Map<string, 'b' | '#'>): StaveNote[] {
  const activeAcc = initialAcc ? new Map(initialAcc) : new Map<string, 'b' | '#' | 'n'>();
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);
    const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: dur, autoStem: true });
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      const noteId = n.keys[0];
      const letter = noteId.split('/')[0];
      const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
      const current = activeAcc.get(letter);
      const keySigForLetter = keySigAcc?.get(letter);
      if (realAcc) {
        if (current !== realAcc) note.addModifier(new Accidental(realAcc), 0);
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

function renderMeasures(el: HTMLDivElement, measures: MeasureInfo[], minWidth: number, keyName?: string) {
  el.innerHTML = '';
  if (measures.length === 0) return;
  const nMeasures = measures.length;

  // Single line: compute natural width from measure contents
  const measWidths = measures.map((m) => measureMinWidth(m) * 1.4);
  const decorW = DECOR_FIRST;
  const naturalW = MARGIN.left + decorW + measWidths.reduce((s, w) => s + w, 0) + MARGIN.right;
  const svgW = Math.max(naturalW, minWidth);
  const totalH = MARGIN.top + LINE_HEIGHT + MARGIN.bottom;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(svgW, totalH);
  const ctx = renderer.getContext();
  const allVfNotes: StaveNote[] = [];

  const y = MARGIN.top;
  let x = MARGIN.left;
  const stavePositions: { x: number; y: number; w: number }[] = [];

  // Track accidentals carried across barlines via ties
  let tieCarryAcc: Map<string, 'b' | '#' | 'n'> | undefined;
  const keySigAcc = keySigAccidentals(keyName || 'C');

  for (let m = 0; m < nMeasures; m++) {
    const firstInLine = m === 0;
    const isLast = m === nMeasures - 1;
    const barW = measWidths[m];
    const w = firstInLine ? barW + decorW : barW;

    const stave = new Stave(x, y, w);
    if (firstInLine) {
      stave.addClef('treble');
      if (keyName && keyName !== 'C') stave.addKeySignature(keyName);
      stave.addTimeSignature('4/4');
    }
    if (measures[m]?.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
    if (measures[m]?.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
    else if (isLast) stave.setEndBarType(BarlineType.END);
    if (measures[m]?.volta) {
      const v = measures[m].volta!;
      const prevV = m > 0 ? measures[m - 1]?.volta : undefined;
      const nextV = m < measures.length - 1 ? measures[m + 1]?.volta : undefined;
      const isS = prevV !== v;
      stave.setVoltaType(isS ? VoltaType.BEGIN : VoltaType.MID, `${v}.`, 30);
    }
    if (measures[m]?.navigation) {
      const navMap: Record<string, number[]> = {
        segno: [Repetition.type.SEGNO_LEFT], coda: [Repetition.type.CODA_LEFT],
        fine: [Repetition.type.FINE], toCoda: [Repetition.type.TO_CODA],
        dc: [Repetition.type.DC], dcAlCoda: [Repetition.type.DC_AL_CODA], dcAlFine: [Repetition.type.DC_AL_FINE],
        ds: [Repetition.type.DS], dsAlCoda: [Repetition.type.DS_AL_CODA], dsAlFine: [Repetition.type.DS_AL_FINE],
      };
      const rts = navMap[measures[m].navigation!];
      if (rts) for (const rt of rts) stave.setRepetitionType(rt);
    }
    stave.setContext(ctx).draw();
    stavePositions[m] = { x, y, w };

    const measure = measures[m];
    const vfNotes = buildVfNotes(measure, tieCarryAcc, keySigAcc);

    // Build carry state for next measure: if last note has tie, pass its accidental
    tieCarryAcc = undefined;
    const lastNote = measure.notes[measure.notes.length - 1];
    if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
      const acc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
      if (acc) {
        tieCarryAcc = new Map([[lastNote.keys[0].split('/')[0], acc]]);
      }
    }

    if (measure.chord) {
      const barContentX = firstInLine ? x + decorW + 4 : x + 4;
      const barContentW = firstInLine ? barW : barW - 4;
      const chordY = y + 12;
      const svgEl = el.querySelector('svg');
      if (svgEl) {
        const chords = measure.chord.split(/\s{2,}/);
        if (chords.length === 1) {
          appendChordSVG(svgEl, barContentX, chordY, chords[0], CHORD_FONT, 20);
        } else {
          const sliceW = barContentW / chords.length;
          for (let ci = 0; ci < chords.length; ci++) {
            appendChordSVG(svgEl, barContentX + ci * sliceW, chordY, chords[ci], CHORD_FONT, 20);
          }
        }
      }
    }

    const beams = buildManualBeams(vfNotes, measure.notes);
    const voice = new Voice({ numBeats: 4, beatValue: 4 });
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

  // Draw ties
  let flatIdx = 0;
  for (const measure of measures) {
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
    for (const measure of measures) {
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].gliss && allVfNotes[flatIdx + 1]) {
          drawGlissLine(svg as SVGElement, allVfNotes[flatIdx], allVfNotes[flatIdx + 1]);
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
    while (bi < measures.length) {
      if (measures[bi].bracket) {
        const groupStart = bi;
        while (bi < measures.length && measures[bi].bracket) bi++;
        const groupEnd = bi - 1;
        const pStart = stavePositions[groupStart];
        const pEnd = stavePositions[groupEnd];
        if (pStart && pEnd) {
          const top = pStart.y + 28;
          const bot = pStart.y + LINE_HEIGHT - 60;
          drawArc(pStart.x + 2, top, bot, true);
          drawArc(pEnd.x + pEnd.w * 0.55, top, bot, false);
        }
      } else {
        bi++;
      }
    }
  }
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
    _saxLoading = Soundfont.instrument(_saxCtx, 'alto_sax' as Soundfont.InstrumentName, { gain: 3 })
      .then((inst) => { _saxInst = inst; });
  }
  return _saxLoading.then(() => _saxInst!);
}

ensureSax().catch(() => {});

/* ─── styled ──────────────────────────────────────────────────────────── */

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

const TitleText = styled.span`
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.span`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const BpmInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  width: 44px;
  padding: 3px 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  outline: none;
`;

const BpmLabel = styled.span`
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ListArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const KeySection = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`;

const KeyCol = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const KeyLabel = styled.div<{ $active?: boolean }>`
  min-width: 48px;
  text-align: center;
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: ${({ $active }) => ($active ? '#8B6914' : '#555')};
  padding-top: 4px;
`;

const OriginalBadge = styled.span`
  display: block;
  font-size: 0.55rem;
  font-family: 'DM Sans', sans-serif;
  font-weight: 400;
  color: #b8960a;
  margin-top: -2px;
`;

const SheetWrap = styled.div`
  flex: 1;
  overflow-x: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 4px 0;
  background: #fff;
  position: relative;
`;

const PlayKeyBtn = styled.button<{ $playing?: boolean }>`
  margin-top: 6px;
  font-size: 0.72rem;
  padding: 3px 8px;
  border: 1px solid ${({ $playing }) => ($playing ? '#c0392b' : '#2a6e3f')};
  border-radius: 4px;
  background: ${({ $playing }) => ($playing ? '#c0392b' : '#2a6e3f')};
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { opacity: 0.85; }
`;

/* ─── key row component ───────────────────────────────────────────────── */

function KeyRow({ keyName, measures, width, isOriginal, bpm }: {
  keyName: string; measures: MeasureInfo[]; width: number; isOriginal: boolean; bpm: number;
}) {
  const svgRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const visRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = visRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || renderedRef.current || !svgRef.current) return;
    renderedRef.current = true;
    renderMeasures(svgRef.current, measures, width, keyName);
  }, [visible, width, measures]);

  const handlePlay = useCallback(async () => {
    if (playing) { abortRef.current?.abort(); setPlaying(false); return; }
    const sax = await ensureSax();
    const abort = new AbortController();
    abortRef.current = abort;
    setPlaying(true);
    const beatDur = 60 / bpm;
    try {
      // Flatten all notes for tie handling
      const allNotes = measures.flatMap(m => m.notes);
      let ni = 0;
      while (ni < allNotes.length) {
        if (abort.signal.aborted) throw 'stop';
        const n = allNotes[ni];
        const isRest = n.duration.endsWith('r');
        const baseDur = n.duration.replace(/r$/, '');
        let beats = DUR_BEATS[baseDur] ?? 1;
        if (n.dotted) beats *= 1.5;
        if (n.tuplet === 3) beats *= 2 / 3;

        // Merge tied notes
        if (!isRest && n.tie) {
          let look = ni + 1;
          while (look < allNotes.length) {
            const ln = allNotes[look];
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
          const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc);
          sax.play(String(midi), 0, { duration: sec * 0.9, gain: 3 });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, sec * 1000);
            abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
          });
          ni = look;
          continue;
        }

        const sec = beats * beatDur;
        if (!isRest) {
          const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
          const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc);
          sax.play(String(midi), 0, { duration: sec * 0.9, gain: 3 });
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, sec * 1000);
          abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
        });
        ni++;
      }
    } catch { /* stopped */ }
    sax.stop();
    setPlaying(false);
  }, [playing, measures, bpm]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return (
    <KeySection ref={visRef}>
      <KeyCol>
        <KeyLabel $active={isOriginal}>
          {keyName}
          {isOriginal && <OriginalBadge>original</OriginalBadge>}
        </KeyLabel>
        <PlayKeyBtn $playing={playing} onClick={handlePlay}>
          {playing ? '\u25A0' : '\u25B6'}
        </PlayKeyBtn>
      </KeyCol>
      <SheetWrap>
        <div ref={svgRef} />
      </SheetWrap>
    </KeySection>
  );
}

/* ─── page component ──────────────────────────────────────────────────── */

export default function Lick12KeyPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [lick, setLick] = useState<LickEntry | null>(null);
  const [bpm, setBpm] = useState(200);

  useEffect(() => {
    if (!id) return;
    loadUserLicks().then((licks) => {
      const found = licks.find((l) => String(l.id) === id);
      if (found) {
        setLick(found);
        if (found.tempo) {
          setBpm(found.tempo);
        } else {
          const has16ths = found.sheetData.measures.some((m) => m.notes.some((n) => n.duration === '16' || n.duration === '16r'));
          setBpm(has16ths ? 120 : 200);
        }
      }
    });
  }, [id]);

  /* width tracking */
  const listRef = useRef<HTMLDivElement>(null);
  const [sheetWidth, setSheetWidth] = useState(700);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setSheetWidth(w - 120);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!lick) {
    return (
      <Page>
        <Header>
          <BackBtn onClick={() => navigate(-1)}>&larr; Back</BackBtn>
          <TitleText>Loading...</TitleText>
        </Header>
      </Page>
    );
  }

  const order = getTranspositionOrder(lick.key);

  return (
    <Page>
      <Header>
        <BackBtn onClick={() => navigate(-1)}>&larr; Back</BackBtn>
        <TitleText>12-Key Practice</TitleText>
        <SubText>{lick.performer} — {lick.title}</SubText>
        <BpmLabel>BPM</BpmLabel>
        <BpmInput
          type="number"
          value={bpm}
          onChange={(e) => setBpm(Math.max(20, Math.min(400, Number(e.target.value) || 200)))}
        />
      </Header>
      <ListArea ref={listRef}>
        {order.map(({ keyName, semitones }) => (
          <KeyRow
            key={keyName}
            keyName={keyName}
            measures={transposeMeasures(lick.sheetData.measures, semitones)}
            width={sheetWidth}
            isOriginal={semitones === 0}
            bpm={bpm}
          />
        ))}
      </ListArea>
    </Page>
  );
}
