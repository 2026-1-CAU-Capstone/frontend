import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, VoltaType, StaveTie, Tuplet, Repetition,
} from 'vexflow';
/* Click-to-hear / lick playback uses the shared app-wide piano singleton. */
import { getGlobalKeyboard } from '../lib/player/GlobalKeyboard';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { PATTERN_SIMPLE } from '../lib/note/countInPatterns';
import { swungBeats } from '../lib/note/swing';
import { resolveMeasureAccidental, type RenderAcc } from '../lib/note/measureAccidentals';
import type { NoteInfo, MeasureInfo } from '../data/sampleMelody';
import { loadUserLicks, type LickEntry } from '../data/lickData';
import { getLickVideo, type LickVideo } from '../data/lickVideos';
import { YoutubeEmbed } from '../components/common/YoutubeEmbed';
import { formatChordDisplay } from '../lib/jazz-harmony';

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

/* 4도권 (cycle of fourths) — ascending perfect 4ths (+5 semitones each step).
 * Jazz practice convention: C → F → Bb → Eb → Ab → Db → Gb → B → E → A → D → G. */
const CIRCLE_OF_4THS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'B', 'E', 'A', 'D', 'G'];
const CIRCLE_OF_4THS_MINOR = ['Cm', 'Fm', 'Bbm', 'Ebm', 'G#m', 'C#m', 'F#m', 'Bm', 'Em', 'Am', 'Dm', 'Gm'];
const CIRCLE_SEMITONES = CIRCLE_OF_4THS.map(k => NAME_TO_SEMI[k]);
const CIRCLE_SEMITONES_MINOR = CIRCLE_OF_4THS_MINOR.map(k => NAME_TO_SEMI[k.replace('m', '')] ?? 0);

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

  // First pass: transpose all notes
  const midiValues: number[] = [];
  const transposed = measures.map(m => ({
    ...m,
    chord: m.chord ? transposeChord(m.chord, semitones) : m.chord,
    notes: m.notes.map(n => {
      if (n.duration.endsWith('r')) return { ...n };
      const acc = n.accidentals?.[0] as 'b' | '#' | 'n' | undefined;
      const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc) + semitones;
      midiValues.push(midi);
      const tr = midiToNote(midi);
      const newNote: NoteInfo = { keys: [tr.key], duration: n.duration, dotted: n.dotted, tie: n.tie, tuplet: n.tuplet };
      if (tr.acc) newNote.accidentals = { 0: tr.acc };
      return newNote;
    }),
  }));

  if (midiValues.length === 0) return transposed;

  // Octave adjustment: use median pitch to decide, not a single outlier
  const sorted = [...midiValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let octShift = 0;
  if (median > MIDI_F6) octShift = -12;
  else if (median < MIDI_F3) octShift = 12;
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
  const isMinor = /m$/i.test(lickKey);
  const rootMatch = lickKey?.match(/^([A-G][b#]?)/);
  if (!rootMatch) {
    // Unknown key: chromatic ascending
    const suffix = isMinor ? 'm' : '';
    return KEY_NAMES.map((name, i) => ({ keyName: name + suffix, semitones: i }));
  }
  const rootSemi = NAME_TO_SEMI[rootMatch[1]] ?? 0;
  const circle = isMinor ? CIRCLE_OF_4THS_MINOR : CIRCLE_OF_4THS;
  const circleSemis = isMinor ? CIRCLE_SEMITONES_MINOR : CIRCLE_SEMITONES;
  const circleIdx = circleSemis.indexOf(rootSemi);
  const startIdx = circleIdx >= 0 ? circleIdx : 0;
  const result: { keyName: string; semitones: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = (startIdx + i) % 12;
    const targetSemi = circleSemis[idx];
    const interval = ((targetSemi - rootSemi) % 12 + 12) % 12;
    result.push({ keyName: circle[idx], semitones: interval });
  }
  return result;
}

/* ─── rendering helpers (same as LickCard/LickInputPage) ──────────────── */

const LINE_HEIGHT = 140;
const MARGIN = { top: 24, left: 10, right: 10, bottom: 10 };
const DECOR_FIRST = 70;
const PX_PER_DUR: Record<string, number> = { w: 50, h: 35, q: 28, '8': 22, '16': 18 };
const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const CHORD_FONT = "'MuseJazz Text', 'Pretendard', sans-serif";

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

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function buildManualBeams(vfNotes: StaveNote[], notes: NoteInfo[]): Beam[] {
  const beams: Beam[] = [];
  let beamGroup: StaveNote[] = [];
  let groupBeats = 0;
  let inTupletN = 0; // 0 = outside tuplet; else N of the current N-tuplet
  let postTupletMerged = false;
  for (let i = 0; i < vfNotes.length; i++) {
    const vn = vfNotes[i];
    const tupletN = notes[i]?.tuplet ?? 0;
    const isTuplet = tupletN >= 3;
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

    // Break beam group when tuplet N changes (legacy: one merge after 16th triplet)
    if (tupletN !== inTupletN && beamGroup.length > 0) {
      const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
      if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
        postTupletMerged = true;
      } else {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        if (!isTuplet) groupBeats = 0;
      }
    }
    inTupletN = tupletN;

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
      // Force a beam break once an N-tuplet group has accumulated N notes.
      if (isTuplet && beamGroup.length === tupletN) {
        beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        groupBeats = 0;
        postTupletMerged = false;
        continue;
      }
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

function buildVfNotes(measure: MeasureInfo, initialAcc?: Map<string, RenderAcc>, keySigAcc?: Map<string, 'b' | '#'>): StaveNote[] {
  // Octave-aware accidental rule — single shared helper. `initialAcc` carries
  // tied-note state across the barline (keyed by full vex key, e.g. 'e/4').
  const activeAcc: Map<string, RenderAcc> = initialAcc ? new Map(initialAcc) : new Map();
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);
    const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: dur, autoStem: true });
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
      const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, n.keys[0], realAcc);
      if (glyph) note.addModifier(new Accidental(glyph), 0);
    }
    return note;
  });
}

const formatChord = formatChordDisplay;

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

  if (base.includes('°')) {
    const dimSize = Math.round(size * 1.4);
    for (const seg of base.split(/(°)/g)) {
      if (!seg) continue;
      const sp = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      sp.setAttribute('font-size', String(seg === '°' ? dimSize : size));
      sp.textContent = seg;
      txt.appendChild(sp);
    }
  } else {
    const baseSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    baseSpan.setAttribute('font-size', String(size));
    baseSpan.textContent = base;
    txt.appendChild(baseSpan);
  }

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
  let tieCarryAcc: Map<string, RenderAcc> | undefined;
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

    // Build carry state for next measure: if last note has tie, pass its
    // accidental (keyed by full vex key, octave-aware — matches buildVfNotes above).
    tieCarryAcc = undefined;
    const lastNote = measure.notes[measure.notes.length - 1];
    if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
      const acc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
      if (acc) {
        tieCarryAcc = new Map([[lastNote.keys[0], acc]]);
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

    // Render tuplet brackets — any N-tuplet (3, 5, 6, 7, …) with the correct number above
    {
      let ti = 0;
      while (ti < measure.notes.length) {
        const n = measure.notes[ti].tuplet;
        if (n && n >= 3) {
          const group: StaveNote[] = [];
          while (ti < measure.notes.length && measure.notes[ti].tuplet === n && group.length < n) {
            group.push(vfNotes[ti]);
            ti++;
          }
          if (group.length >= 2) {
            const stemDown = group[0].getStemDirection() === -1;
            const notesOccupied = Math.pow(2, Math.floor(Math.log2(n - 1)));
            const tuplet = new Tuplet(group, { numNotes: group.length, notesOccupied });
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
        new StaveTie({ firstNote: allVfNotes[flatIdx], lastNote: allVfNotes[flatIdx + 1], firstIndexes: [0], lastIndexes: [0] })
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

/* ─── piano playback ─────────────────────────────────────────────────── */

/* Lick playback shares the app-wide piano via getGlobalKeyboard(). */

/* ─── styled ──────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'Pretendard', sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 20px 10px;
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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: ${({ $active }) => ($active ? '#8B6914' : '#555')};
  padding-top: 4px;
`;

const OriginalBadge = styled.span`
  display: block;
  font-size: 0.55rem;
  font-family: 'Pretendard', sans-serif;
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

const YoutubeBtn = styled.button<{ $active?: boolean }>`
  font-size: 0.72rem;
  padding: 3px 6px;
  border: 1px solid #c4302b;
  border-radius: 4px;
  background: ${({ $active }) => ($active ? '#c4302b' : '#fff')};
  color: ${({ $active }) => ($active ? '#fff' : '#c4302b')};
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  &:hover { opacity: 0.85; }
`;

const PlayBpmRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
`;

const RightCol = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

/* ─── key row component ───────────────────────────────────────────────── */

function KeyRow({ keyName, measures, width, isOriginal, defaultBpm, video }: {
  keyName: string; measures: MeasureInfo[]; width: number; isOriginal: boolean; defaultBpm: number; video?: LickVideo;
}) {
  const svgRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const visRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(defaultBpm);
  const [bpmText, setBpmText] = useState(String(defaultBpm));
  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => { setBpm(defaultBpm); setBpmText(String(defaultBpm)); }, [defaultBpm]);
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

  const countIn = useCountInIntro();

  const handlePlay = useCallback(async () => {
    if (playing || countIn.active) {
      abortRef.current?.abort();
      countIn.cancel();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    // 카운트인과 병렬로 piano soundfont 로드 — 첫 재생 지연 제거.
    const kb = getGlobalKeyboard();
    const loadPromise = kb.ensureReady();
    // 릭 재생: BPM 무관하게 SIMPLE 카운트인.
    const cin = await countIn.run({ bpm, pattern: PATTERN_SIMPLE, bars: 1, forceEnabled: true });
    if (!cin.ok) { setPlaying(false); return; }
    await loadPromise;
    const abort = new AbortController();
    abortRef.current = abort;
    const beatDur = 60 / bpm;
    // Swing-feel beat→seconds projection. Off-beat 8ths sit later in the
    // beat (long-short feel). Quarters and larger durations are unaffected.
    const toSec = (beatPos: number) => swungBeats(beatPos) * beatDur;
    try {
      // Align the first note with the count-in's downbeat. cin.downbeatInSec
      // captures the setTimeout slop between cin resolve and here.
      if (cin.downbeatInSec > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, cin.downbeatInSec * 1000);
          abort.signal.addEventListener(
            'abort',
            () => { clearTimeout(timer); reject('stop'); },
            { once: true },
          );
        });
      }
      // Flatten all notes for tie handling
      const allNotes = measures.flatMap(m => m.notes);
      let mt = 0; // cumulative beat cursor (straight-time beats)
      let ni = 0;
      while (ni < allNotes.length) {
        if (abort.signal.aborted) throw 'stop';
        const n = allNotes[ni];
        const isRest = n.duration.endsWith('r');
        const baseDur = n.duration.replace(/r$/, '');
        let beats = DUR_BEATS[baseDur] ?? 1;
        if (n.dotted) beats *= 1.5;
        if (n.tuplet && n.tuplet >= 2) {
          const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
          beats *= denom / n.tuplet;
        }

        // Merge tied notes
        if (!isRest && n.tie) {
          let look = ni + 1;
          while (look < allNotes.length) {
            const ln = allNotes[look];
            const lb = ln.duration.replace(/r$/, '');
            let lbeats = DUR_BEATS[lb] ?? 1;
            if (ln.dotted) lbeats *= 1.5;
            if (ln.tuplet && ln.tuplet >= 2) {
              const denom = Math.pow(2, Math.floor(Math.log2(ln.tuplet - 1)));
              lbeats *= denom / ln.tuplet;
            }
            beats += lbeats;
            if (!ln.tie) { look++; break; }
            look++;
          }
          const sec = toSec(mt + beats) - toSec(mt);
          const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
          const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc);
          kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, sec * 1000);
            abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
          });
          mt += beats;
          ni = look;
          continue;
        }

        const sec = toSec(mt + beats) - toSec(mt);
        if (!isRest) {
          const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
          const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc);
          kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, sec * 1000);
          abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
        });
        mt += beats;
        ni++;
      }
    } catch { /* stopped */ }
    kb.stopAll();
    setPlaying(false);
  }, [playing, measures, bpm]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return (
    <KeySection ref={visRef}>
      {countIn.overlay}
      <KeyCol>
        <KeyLabel $active={isOriginal}>
          {keyName}
          {isOriginal && <OriginalBadge>original</OriginalBadge>}
        </KeyLabel>
        <PlayBpmRow>
          <PlayKeyBtn $playing={playing} onClick={handlePlay}>
            {playing ? '\u25A0' : '\u25B6'}
          </PlayKeyBtn>
          {video && (
            <YoutubeBtn
              $active={showVideo}
              onClick={() => setShowVideo((v) => !v)}
              title={showVideo ? '\uC6D0\uBCF8 \uC601\uC0C1 \uB2EB\uAE30' : '\uC6D0\uBCF8 \uC601\uC0C1 \uBCF4\uAE30'}
            >
              <svg width="12" height="9" viewBox="0 0 24 17" aria-hidden>
                <path fill={showVideo ? '#fff' : '#c4302b'} d="M23.5 2.6a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.6 31 31 0 0 0 0 8.5c0 2 .2 4 .5 5.9a3 3 0 0 0 2.1 2.1C4.5 17 12 17 12 17s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.9.5-5.9 0-2-.2-4-.5-5.9z" />
                <path fill={showVideo ? '#c4302b' : '#fff'} d="M9.6 12.1V4.9L15.8 8.5z" />
              </svg>
            </YoutubeBtn>
          )}
          <BpmInput
            type="text"
            inputMode="numeric"
            value={bpmText}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              setBpmText(v);
              const n = Number(v);
              if (n >= 20 && n <= 400) setBpm(n);
            }}
            onBlur={() => {
              const n = Math.max(20, Math.min(400, Number(bpmText) || defaultBpm));
              setBpm(n);
              setBpmText(String(n));
            }}
          />
        </PlayBpmRow>
      </KeyCol>
      <RightCol>
        <SheetWrap>
          <div ref={svgRef} />
        </SheetWrap>
        {video && showVideo && (
          <YoutubeEmbed
            videoId={video.videoId}
            startSec={video.startSec}
            endSec={video.endSec}
            maxWidth={480}
            autoplay
          />
        )}
      </RightCol>
    </KeySection>
  );
}

/* ─── page component ──────────────────────────────────────────────────── */

export default function Lick12KeyPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  // The caller (Lick DB / My Licks) may hand the full lick over via router
  // state — that's the only reliable source for the 8,000-lick frontend
  // dataset, which isn't in loadUserLicks(). Fall back to a backend lookup by
  // id, and surface a clear "not found" instead of hanging on "Loading…".
  const passedLick = (location.state as { lick?: LickEntry } | null)?.lick;
  const [lick, setLick] = useState<LickEntry | null>(passedLick ?? null);
  const [notFound, setNotFound] = useState(false);
  const [bpm, setBpm] = useState(200);

  useEffect(() => {
    const applyLick = (found: LickEntry) => {
      setLick(found);
      const has16ths = found.sheetData.measures.some((m) =>
        m.notes.some((n) => {
          const base = n.duration.replace(/[dr]/g, '');
          return base === '16' || base === '32';
        }),
      );
      // 16분음표 릭은 무조건 최저 BPM 150
      if (has16ths) setBpm(Math.max(150, found.tempo ?? 150));
      else setBpm(found.tempo ?? 200);
    };

    if (passedLick) { applyLick(passedLick); return; }
    if (!id) { setNotFound(true); return; }
    let cancelled = false;
    loadUserLicks().then((licks) => {
      if (cancelled) return;
      const found = licks.find((l) => String(l.id) === id);
      if (found) applyLick(found);
      else setNotFound(true);
    }).catch(() => { if (!cancelled) setNotFound(true); });
    return () => { cancelled = true; };
  }, [id, passedLick]);

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
          <TitleText>{notFound ? '릭을 찾을 수 없습니다' : 'Loading…'}</TitleText>
        </Header>
      </Page>
    );
  }

  const order = getTranspositionOrder(lick.key);
  const video = getLickVideo(lick.id);

  return (
    <Page>
      <Header>
        <BackBtn onClick={() => navigate(-1)}>&larr; Back</BackBtn>
        <TitleText>12-Key Practice · 4도권</TitleText>
        <SubText>{lick.performer} — {lick.title}</SubText>
      </Header>
      <ListArea ref={listRef}>
        {order.map(({ keyName, semitones }) => (
          <KeyRow
            key={keyName}
            keyName={keyName}
            measures={transposeMeasures(lick.sheetData.measures, semitones)}
            width={sheetWidth}
            isOriginal={semitones === 0}
            defaultBpm={bpm}
            video={video}
          />
        ))}
      </ListArea>
    </Page>
  );
}
