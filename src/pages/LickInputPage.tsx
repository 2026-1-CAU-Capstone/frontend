import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, StaveTie, Tuplet, VoltaType, Repetition,
  Articulation, Annotation, AnnotationVerticalJustify, Ornament, Tremolo, Curve,
} from 'vexflow';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import type { NoteInfo, MeasureInfo, NavigationMarker } from '../data/sampleMelody';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';
import { NotePlayer } from '../lib/note/notePlayer';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { PATTERN_SIMPLE } from '../lib/note/countInPatterns';
import { normalizeChord, formatChordDisplay } from '../lib/jazz-harmony';
import { NoteIcon, RestIcon } from '../components/notesheet/NotationIcon';

/* ─── helpers ──────────────────────────────────────────────────────────── */

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
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

/* Autosave: 작성 중인 lick(편집 모드 제외)을 15초마다 localStorage에 저장.
 * 새로고침/크래시 후 마운트 시 자동 복구. handleSave 성공/handleClear에서 삭제.
 * 버전 키에 v1 suffix — 스키마 바뀌면 v2로 올려서 옛 드래프트 무시되도록. */
const DRAFT_KEY = 'lickInput.draft.v1';

/**
 * Tuplet beat scaling — N notes occupy the time of the largest power of 2
 * strictly less than N (3→2, 4→2, 5→4, 6→4, 7→4, 9→8, …). This generalises
 * the previous "triplet only" rule so n-tuplet (4+, 5+, …) groups also shrink
 * total beat duration, preventing premature measure auto-close as the user
 * adds the 4th, 5th, … note to an n-tuplet group.
 */
function tupletScale(t?: number): number {
  if (!t || t < 2) return 1;
  const denom = Math.pow(2, Math.floor(Math.log2(t - 1)));
  return denom / t;
}

function getBeats(dur: string, dotted?: boolean, tuplet?: number): number {
  const base = dur.replace(/r$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (dotted) b *= 1.5;
  b *= tupletScale(tuplet);
  return b;
}

function measureBeats(notes: NoteInfo[]): number {
  return notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
}

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
interface MeasurePos { idx: number; x: number; y: number; w: number; chordX: number; }

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
    /* 기본: 마지막 줄이고 마디 수가 MAX_PER_LINE 미만이면 자연 폭으로(×1.3) 좌측 정렬.
     * 단, 자연 폭 합이 가용 폭을 넘어가면(=꽉 찼으면) 강제로 stretch 모드로 전환해서
     * 비율을 유지한 채 가용 폭에 맞게 비례 축소. 그래야 마지막 줄 음표가 화면 우측을
     * 침범하지 않음. */
    const naturalWithFactor = totalWeight * 1.3;
    const stretch = !isLastLine || indices.length >= MAX_PER_LINE || naturalWithFactor > availForBars;

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
      const measure = measures[m];
      if (measure.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
      if (measure.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
      else if (isLast) stave.setEndBarType(BarlineType.END);
      if (measure.volta) {
        const v = measure.volta;
        const prevV = m > 0 ? measures[m - 1]?.volta : undefined;
        const isS = prevV !== v;
        stave.setVoltaType(isS ? VoltaType.BEGIN : VoltaType.MID, `${v}.`, 30);
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
            const effective = current ?? keySigForLetter;
            if (effective !== realAcc) {
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

        // ── Articulations / fermata / dynamics (matches NoteSheet) ─────
        if (n.articulations) {
          const ART_VF: Record<string, string> = {
            staccato: 'a.', staccatissimo: 'av',
            accent: 'a>', tenuto: 'a-',
            marcato: 'a^', 'detached-legato': 'a-.',
          };
          for (const a of n.articulations) {
            const code = ART_VF[a];
            if (!code) continue;
            const stemUp = note.getStemDirection() === 1;
            const forceAbove = a === 'marcato';
            const pos = (forceAbove || !stemUp) ? 3 : 4;
            note.addModifier(new Articulation(code).setPosition(pos), 0);
          }
        }
        if (n.fermata) {
          note.addModifier(new Articulation('a@a').setPosition(3), 0);
        }
        if (n.dynamics) {
          const ann = new Annotation(n.dynamics);
          ann.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
          note.addModifier(ann, 0);
        }
        if (n.ornaments) {
          const ORN_VF: Record<string, string> = {
            trill: 'tr', mordent: 'mordent',
            'inverted-mordent': 'mordent_inverted',
            turn: 'turn', 'inverted-turn': 'turn_inverted',
          };
          for (const o of n.ornaments) {
            if (o === 'tremolo') { note.addModifier(new Tremolo(3), 0); continue; }
            const code = ORN_VF[o];
            if (code) note.addModifier(new Ornament(code), 0);
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

      // Manual beaming: group consecutive beamable notes (8th, 16th).
      // N-tuplet groups stay beamed together (3 for triplet, 5 for quintuplet, …).
      const beams: Beam[] = [];
      let beamGroup: StaveNote[] = [];
      let groupBeats = 0;
      let inTupletN = 0; // 0 = outside tuplet; else the N of the current N-tuplet group
      let postTupletMerged = false;

      for (let ni = 0; ni < vfNotes.length; ni++) {
        const vn = vfNotes[ni];
        const tupletN = measure.notes[ni].tuplet ?? 0;
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

        // Break beam group when tuplet N changes (including entering/leaving a tuplet).
        // Allow one note to merge after a 16th triplet (legacy beaming convention).
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
          // Force a beam break once an N-tuplet group has accumulated N notes (so 5/7/9-tuplets
          // stay beamed together — and don't accidentally continue past N if the data omits a
          // beamBreak flag on the last tuplet note).
          if (isTuplet && beamGroup.length === tupletN) {
            beams.push(new Beam(beamGroup, true));
            beamGroup = [];
            groupBeats = 0;
            postTupletMerged = false;
            continue;
          }
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
              // notesOccupied = largest power of 2 strictly less than n (3→2, 5→4, 7→4, 9→8…)
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

      // Collect rendered notes for tie drawing
      for (let ni = 0; ni < vfNotes.length; ni++) {
        allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni] });
      }

      x += w;
    }
  }

  // Build measure→line lookup
  const measureLine = new Map<number, number>();
  for (let li = 0; li < lines.length; li++) {
    for (const idx of lines[li]) measureLine.set(idx, li);
  }

  // Draw ties. Cross-line ties need two open-ended half ties; drawing one
  // StaveTie across different systems either disappears or spans the page.
  let flatIdx = 0;
  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi];
    for (let ni = 0; ni < measure.notes.length; ni++) {
      if (measure.notes[ni].tie) {
        const from = allVfNotes[flatIdx];
        const to = allVfNotes[flatIdx + 1];
        if (from && to) {
          const sameLine = measureLine.get(from.mi) === measureLine.get(to.mi);
          if (sameLine) {
            const tie = new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] });
            tie.setContext(ctx).draw();
          } else {
            try {
              const halfStart = new StaveTie({ firstNote: from.vfNote, lastNote: undefined, firstIndexes: [0], lastIndexes: [0] });
              halfStart.setContext(ctx).draw();
              const halfEnd = new StaveTie({ firstNote: undefined, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] });
              halfEnd.setContext(ctx).draw();
            } catch (e) { console.warn('cross-line tie draw failed', e); }
          }
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

  // Draw slurs (이음줄)
  {
    const startStack: number[] = [];
    let sIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        const n = measure.notes[ni];
        if (n.slurStart) startStack.push(sIdx);
        if (n.slurStop && startStack.length > 0) {
          const startIdx = startStack.pop()!;
          const from = allVfNotes[startIdx];
          const to = allVfNotes[sIdx];
          if (from && to) {
            try { new Curve(from.vfNote, to.vfNote, {}).setContext(ctx).draw(); }
            catch (e) { console.warn('slur draw failed', e); }
          }
        }
        sIdx++;
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
  padding: 10px 18px 10px 8px;
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

const SectionLabel = styled.span`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-right: 2px;
`;

const TwoFiveOneSelect = styled.select`
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  width: 110px;
  padding: 5px 8px;
  border: 1px solid #b8960a;
  border-radius: 6px;
  background: #fffbe6;
  color: #8B6914;
  outline: none;
  cursor: pointer;
  &:focus { border-color: #8B6914; box-shadow: 0 0 0 2px rgba(184, 150, 10, 0.15); }
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

/* normalizeChord now imported from src/lib/jazz-harmony — see top of file. */

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

/* formatChordDisplay imported from src/lib/jazz-harmony \u2014 see top of file. */

function renderChordParts(chord: string, keyPrefix: string) {
  const { base, ext, tensions } = splitChord(chord);
  const dimMatch = base.match(/^(.*?)([\u00F8\u00B0])$/);
  const baseText = dimMatch ? dimMatch[1] : base;
  const dimSymbol = dimMatch ? dimMatch[2] : '';
  return (
    <>
      <ChordBase>{baseText}</ChordBase>
      {dimSymbol && <ChordHalfDim>{dimSymbol}</ChordHalfDim>}
      {ext && <ChordExt>{ext}</ChordExt>}
      {tensions.map((t, i) => (
        <span key={`${keyPrefix}-t-${i}`}>
          {t.acc && <ChordTensionAcc>{t.acc}</ChordTensionAcc>}
          <ChordTensionNum>{t.num}</ChordTensionNum>
        </span>
      ))}
    </>
  );
}

function ChordCell({ value, onChange, style }: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Multi-chord per measure: split on \u22652 spaces (canonical) or 1+ space
  // (fallback for un-normalized input pasted via Load JSON).
  const chords = value
    ? value.split(/\s{2,}|\s+(?=[A-G])/).filter(Boolean)
    : [];

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
          {chords.map((c, i) => (
            <span key={`c-${i}`} style={{ marginRight: i < chords.length - 1 ? 6 : 0 }}>
              {renderChordParts(formatChordDisplay(c), `c-${i}`)}
            </span>
          ))}
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

/* ── Load JSON modal ────────────────────────────────────────────────── */

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

const ModalCard = styled.div`
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  width: min(720px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
`;

const ModalTitle = styled.div`
  font-size: 0.95rem;
  font-weight: 700;
  color: #111;
`;

const ModalHint = styled.div`
  font-size: 0.78rem;
  color: #666;
  line-height: 1.5;
`;

const JsonTextarea = styled.textarea`
  flex: 1;
  min-height: 280px;
  padding: 12px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.78rem;
  resize: vertical;
  outline: none;
  &:focus { border-color: #888; }
`;

const ModalErr = styled.div`
  font-size: 0.8rem;
  color: #c62828;
  background: #fdecea;
  padding: 6px 10px;
  border-radius: 6px;
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const ModalBtn = styled.button<{ $primary?: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  padding: 6px 16px;
  border: 1px solid ${({ $primary }) => ($primary ? '#1565c0' : '#bbb')};
  background: ${({ $primary }) => ($primary ? '#1976d2' : '#fff')};
  color: ${({ $primary }) => ($primary ? '#fff' : '#333')};
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  &:hover { opacity: 0.85; }
`;


/* ─── 2-5-1 auto-tagger ────────────────────────────────────────────────── */

const TWO_FIVE_ONE_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
type TwoFiveOneKey = typeof TWO_FIVE_ONE_KEYS[number];

const TWO_FIVE_ONE_BY_KEY: Record<TwoFiveOneKey, [string, string, string]> = {
  'C':  ['Dm7',  'G7',  'CM7'],
  'Db': ['Ebm7', 'Ab7', 'DbM7'],
  'D':  ['Em7',  'A7',  'DM7'],
  'Eb': ['Fm7',  'Bb7', 'EbM7'],
  'E':  ['F#m7', 'B7',  'EM7'],
  'F':  ['Gm7',  'C7',  'FM7'],
  'F#': ['G#m7', 'C#7', 'F#M7'],
  'G':  ['Am7',  'D7',  'GM7'],
  'Ab': ['Bbm7', 'Eb7', 'AbM7'],
  'A':  ['Bm7',  'E7',  'AM7'],
  'Bb': ['Cm7',  'F7',  'BbM7'],
  'B':  ['C#m7', 'F#7', 'BM7'],
};

/* ─── component ────────────────────────────────────────────────────────── */

export default function LickInputPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 라우터 state로 전달된 편집 대상 릭 (LicksPage의 Edit 버튼 → setState)
  const editingLick = (location.state as { editingLick?: LickEntry } | null)?.editingLick;
  const editingId = editingLick ? String(editingLick.id) : null;

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
  /** 8va / 8vb bracket state. Same UX as SoloGenerator and LickCreator:
   *  click toggle once to arm, next entered note becomes the bracket start;
   *  click the same toggle again to close — the previous note gets ottavaEnd. */
  const [ottavaMode, setOttavaMode] = useState<'8va' | '8vb' | null>(null);
  const ottavaOpenRef = useRef(false);
  /* N-tuplet (4+, 5+, ...) mode — counts notes/rests added while active and
   * keeps re-assigning their `tuplet` value to the current count so the group
   * "grows" with each new entry. Reset on toggle / measure close.
   * Mutually exclusive with tripletMode. */
  const [nTupletMode, setNTupletMode] = useState(false);
  const nTupletCountRef = useRef(0);
  const [nTupletDisplay, setNTupletDisplay] = useState(0);
  const [copied, setCopied] = useState(false);
  // Load JSON modal — paste a lick JSON to populate the editor
  const [loadJsonOpen, setLoadJsonOpen] = useState(false);
  const [loadJsonText, setLoadJsonText] = useState('');
  const [loadJsonError, setLoadJsonError] = useState<string | null>(null);
  const [bpm, setBpm] = useState(200);
  const [bpmText, setBpmText] = useState('200');
  const bpmManualRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 편집 모드: 라우터 state의 lick으로 폼 prefill (마운트 시 1회)
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!editingLick || prefilledRef.current) return;
    prefilledRef.current = true;
    setPerformer(editingLick.performer ?? '');
    setTitle(editingLick.title ?? '');
    setAlbum(editingLick.album ?? '');
    setInstrument(editingLick.instrument ?? '');
    const keyRoot = (editingLick.key ?? '').split('-')[0];
    setLickKey(keyRoot);
    if (editingLick.tempo) {
      setBpm(editingLick.tempo);
      setBpmText(String(editingLick.tempo));
      bpmManualRef.current = true;
    }
    // Defensive: 일부 응답에선 sheetData가 JSON 직렬화된 string으로 올 수 있음
    // (백엔드 직렬화 방식에 따라). 그 경우 그냥 .measures 접근하면 undefined.
    let sd: unknown = editingLick.sheetData;
    if (typeof sd === 'string') {
      try { sd = JSON.parse(sd); } catch { sd = null; }
    }
    const sdMeasures = (sd as { measures?: unknown } | null)?.measures;
    const editMeasures = Array.isArray(sdMeasures) ? (sdMeasures as MeasureInfo[]) : [];
    if (editMeasures.length === 0) {
      console.warn('[LickInputPage] Edit 진입 시 measures가 비어 있음. editingLick:', editingLick);
    }
    setMeasures(editMeasures);
  }, [editingLick]);

  /* ── Autosave draft to localStorage every 15s (new-lick mode only) ──
   * 편집 모드(/my-licks → Edit)에서는 라우터 state가 source of truth라
   * 드래프트를 덮어쓰지 않음. 작성 중 새로고침/크래시 후 돌아왔을 때
   * 자동 복구된다. handleSave 성공 또는 handleClear 시 키 삭제. */
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (editingLick || draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d.measures)) setMeasures(d.measures);
      if (Array.isArray(d.curNotes)) setCurNotes(d.curNotes);
      if (typeof d.curChord === 'string') setCurChord(d.curChord);
      if (typeof d.performer === 'string') setPerformer(d.performer);
      if (typeof d.title === 'string') setTitle(d.title);
      if (typeof d.album === 'string') setAlbum(d.album);
      if (typeof d.instrument === 'string') setInstrument(d.instrument);
      if (typeof d.lickKey === 'string') setLickKey(d.lickKey);
      if (typeof d.bpm === 'number' && d.bpm >= 20 && d.bpm <= 400) {
        setBpm(d.bpm);
        setBpmText(String(d.bpm));
        bpmManualRef.current = true;
      }
    } catch (e) {
      console.warn('Failed to load lick draft', e);
    }
  }, [editingLick]);

  useEffect(() => {
    if (editingLick) return;
    const intv = setInterval(() => {
      try {
        const isEmpty =
          measures.length === 0 &&
          curNotes.length === 0 &&
          !performer && !title && !album && !instrument && !lickKey && !curChord;
        if (isEmpty) return;
        const draft = {
          measures, curNotes, curChord,
          performer, title, album, instrument, lickKey, bpm,
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {
        console.warn('Failed to autosave lick draft', e);
      }
    }, 15000);
    return () => clearInterval(intv);
  }, [editingLick, measures, curNotes, curChord, performer, title, album, instrument, lickKey, bpm]);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<NotePlayer | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);
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
  // 16분음표(또는 32분음표) 한 음이라도 있으면 최저 150 BPM
  useEffect(() => {
    if (bpmManualRef.current) return;
    const has16ths = allMeasures.some((m) =>
      m.notes.some((n) => {
        const base = n.duration.replace(/[dr]/g, '');
        return base === '16' || base === '32';
      }),
    );
    const newBpm = has16ths ? 150 : 200;
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
    }
  }, []);

  // Close the current measure manually
  const closeMeasure = useCallback(() => {
    if (curNotes.length === 0) return;
    pushEditUndo();
    setMeasures((prev) => [...prev, { notes: curNotes, chord: curChord || undefined }]);
    setCurNotes([]);
    setCurChord('');
  }, [curNotes, curChord, pushEditUndo]);

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

  const updateNote = useCallback((mi: number, ni: number, updater: (n: NoteInfo) => NoteInfo) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? updater(n) : n) } : m));
    } else {
      setCurNotes((prev) => prev.map((n, j) => j === ni ? updater(n) : n));
    }
  }, [measures.length, pushEditUndo]);

  /** Apply an updater to a measure at index `mi` (committed measures only). */
  const updateMeasure = useCallback((mi: number, updater: (m: MeasureInfo) => MeasureInfo) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? updater(m) : m));
    }
  }, [measures.length, pushEditUndo]);

  /** Insert a fresh empty measure before `mi`. Clears selection. */
  const insertMeasureBefore = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => {
      const idx = Math.max(0, Math.min(mi, prev.length));
      const next = [...prev];
      next.splice(idx, 0, { notes: [], chord: undefined });
      return next;
    });
    setSelectedNote(null);
  }, [pushEditUndo]);

  /** Insert a fresh empty measure after `mi`. */
  const insertMeasureAfter = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => {
      const idx = Math.max(0, Math.min(mi + 1, prev.length));
      const next = [...prev];
      next.splice(idx, 0, { notes: [], chord: undefined });
      return next;
    });
    setSelectedNote(null);
  }, [pushEditUndo]);

  /** Delete the measure at `mi`. */
  const deleteMeasure = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => prev.filter((_, i) => i !== mi));
    setSelectedNote(null);
  }, [pushEditUndo]);

  /** Delete a single note at (mi, ni). Works for both committed measures
   *  and the still-open current-measure buffer. */
  const deleteNote = useCallback((mi: number, ni: number) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) =>
        i === mi ? { ...m, notes: m.notes.filter((_, j) => j !== ni) } : m,
      ));
    } else {
      setCurNotes((prev) => prev.filter((_, j) => j !== ni));
    }
    setSelectedNote(null);
  }, [measures.length, pushEditUndo]);

  /** 8va / 8vb toggle. Mirrors SoloGenerator / LickCreator. */
  const handleOttavaToggle = useCallback((kind: '8va' | '8vb') => {
    if (ottavaMode === kind && ottavaOpenRef.current) {
      pushEditUndo();
      if (curNotes.length > 0) {
        setCurNotes((prev) => {
          if (prev.length === 0) return prev;
          const last = { ...prev[prev.length - 1], ottavaEnd: true };
          return [...prev.slice(0, -1), last];
        });
      } else if (measures.length > 0) {
        setMeasures((prev) => {
          const updated = [...prev];
          const lastM = { ...updated[updated.length - 1] };
          const lastNotes = [...lastM.notes];
          if (lastNotes.length > 0) {
            lastNotes[lastNotes.length - 1] = { ...lastNotes[lastNotes.length - 1], ottavaEnd: true };
            lastM.notes = lastNotes;
            updated[updated.length - 1] = lastM;
          }
          return updated;
        });
      }
      ottavaOpenRef.current = false;
      setOttavaMode(null);
    } else {
      setOttavaMode(kind);
      ottavaOpenRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ottavaMode, curNotes, measures]);

  /* Insert a rest slot BEFORE the currently selected note. Uses the duration
   * currently chosen in the top toolbar. After insertion the new slot becomes
   * the selected note, so the user can immediately:
   *   - press a piano key → the rest is replaced by that pitch (existing
   *     handleNotePress behavior already does pitch-replace when selected)
   *   - tweak accidentals / make it shorter or longer, etc.
   * If the inserted slot is in a measure that's already full, that's fine —
   * VexFlow renders in non-strict mode and the user can adjust durations. */
  const handleInsertBefore = useCallback(() => {
    if (!selectedNote) return;
    pushEditUndo();
    const newNote: NoteInfo = {
      keys: ['b/4'],
      duration: duration + 'r',
      dotted: dotted || undefined,
    };
    if (tripletMode) newNote.tuplet = 3;

    const { mi, ni } = selectedNote;
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) =>
        i === mi
          ? { ...m, notes: [...m.notes.slice(0, ni), newNote, ...m.notes.slice(ni)] }
          : m,
      ));
    } else {
      setCurNotes((prev) => [...prev.slice(0, ni), newNote, ...prev.slice(ni)]);
    }
    // Selection stays at the same (mi, ni) — which is now the newly inserted
    // slot. The originally-selected note has shifted to ni + 1.
  }, [selectedNote, duration, dotted, tripletMode, measures.length, pushEditUndo]);

  /* When n-tuplet mode is active, bump the running count and stamp every
   * note in the current group with the new tuplet number so the bracket label
   * grows as the user adds entries. Returns the transformed array to feed
   * into setCurNotes. */
  const applyNTuplet = useCallback((notes: NoteInfo[]): NoteInfo[] => {
    if (!nTupletMode) return notes;
    const k = nTupletCountRef.current + 1;
    nTupletCountRef.current = k;
    setNTupletDisplay(k);
    return notes.map((n, i) =>
      i >= notes.length - k ? { ...n, tuplet: k } : n,
    );
  }, [nTupletMode]);

  /* Detect synchronous auto-close (mirrors maybeAutoClose's predicate) so we
   * can reset n-tuplet state when a measure closes mid-group. */
  const willMeasureClose = useCallback((notes: NoteInfo[]): boolean => {
    const beats = notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
    return notes.length > 0 && beats >= 4 - 0.001;
  }, []);

  /* piano input — store real pitch, display logic handled in renderSheet */
  const handleNotePress = useCallback((pn: PianoNote) => {
    const conv = convertAcc(pn, accMode === 'n' ? 'b' : accMode);
    playMidi(pn.midi);

    // Diatonic respell: in keys whose signature already flats C (Gb/Cb majors
    // + Ebm/Abm) the white B key is pitch-class 11, which spells Cb — not
    // B natural — in those keys. Same idea for E↔Fb in Cb major / Abm.
    // Without this the note lands on the wrong staff line, and accMode='n'
    // additionally forces a stray natural sign. The respelled letter (C or
    // F) is already flat via the key sig, so we drop the accidental entirely.
    let respelled = false;
    if (lickKey && !conv.acc) {
      const sig = keySigAccidentals(lickKey);
      const [letter, octStr] = conv.vexKey.split('/');
      const oct = parseInt(octStr);
      if (letter === 'b' && sig.get('c') === 'b') {
        conv.vexKey = `c/${oct + 1}`;
        respelled = true;
      } else if (letter === 'e' && sig.get('f') === 'b') {
        conv.vexKey = `f/${oct}`;
        respelled = true;
      }
    }

    // If a note is selected, replace its pitch instead of adding a new note
    if (selectedNote) {
      const acc: Record<number, 'b' | '#' | 'n'> | undefined =
        respelled ? undefined
        : accMode === 'n' ? { 0: 'n' }
        : conv.acc ? { 0: conv.acc }
        : undefined;
      updateNote(selectedNote.mi, selectedNote.ni, (n) => {
        const updated = { ...n, keys: [conv.vexKey] };
        if (acc) {
          updated.accidentals = acc;
        } else {
          delete updated.accidentals;
        }
        return updated;
      });
      return;
    }

    // Save snapshot before adding note so undo reverts one note at a time
    pushEditUndo();
    const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
    if (!respelled && accMode === 'n') {
      ni.accidentals = { 0: 'n' };
    } else if (conv.acc) {
      ni.accidentals = { 0: conv.acc };
    }
    if (tripletMode) ni.tuplet = 3;
    // 8va / 8vb: first note inside an active bracket gets ottavaStart.
    if (ottavaMode && !ottavaOpenRef.current) {
      ni.ottavaStart = ottavaMode;
      ottavaOpenRef.current = true;
    }

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

    const finalNotes = applyNTuplet(newNotes);
    setCurNotes(finalNotes);
    maybeAutoClose(finalNotes);

    // Auto-exit triplet mode after 3 notes
    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }

    // If the measure just auto-closed mid n-tuplet group, reset the count so
    // the next measure starts a fresh group rather than appending to the old.
    if (nTupletMode && willMeasureClose(finalNotes)) {
      nTupletCountRef.current = 0;
      setNTupletDisplay(0);
    }
  }, [duration, dotted, accMode, tieNext, tripletMode, nTupletMode, curNotes, measures.length, maybeAutoClose, pushEditUndo, selectedNote, updateNote, applyNTuplet, willMeasureClose]);

  const handleRest = useCallback((dur?: string) => {
    const d = dur ?? duration;

    /* If a rest is currently selected, REPLACE its duration in place rather
     * than appending a new rest at the end. This lets the user select an
     * inserted rest and freely switch between whole / half / quarter / 8th /
     * 16th rests until they get the desired length. */
    if (selectedNote) {
      const { mi, ni } = selectedNote;
      const target = mi < measures.length
        ? measures[mi]?.notes[ni]
        : curNotes[ni];
      if (target?.duration.endsWith('r')) {
        pushEditUndo();
        const replaced: NoteInfo = {
          ...target,
          duration: d + 'r',
          dotted: dotted || undefined,
          tuplet: tripletMode ? 3 : undefined,
        };
        if (mi < measures.length) {
          setMeasures((prev) => prev.map((m, i) =>
            i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? replaced : n) } : m,
          ));
        } else {
          setCurNotes((prev) => prev.map((n, j) => j === ni ? replaced : n));
        }
        return;
      }
    }

    /* Default — no rest selected: append a new rest at the end of the
     * current measure (original behavior). */
    pushEditUndo();
    const ni: NoteInfo = { keys: ['b/4'], duration: d + 'r', dotted: dotted || undefined };
    if (tripletMode) ni.tuplet = 3;
    const newNotes = [...curNotes, ni];
    const finalNotes = applyNTuplet(newNotes);
    setCurNotes(finalNotes);
    maybeAutoClose(finalNotes);
    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }
    if (nTupletMode && willMeasureClose(finalNotes)) {
      nTupletCountRef.current = 0;
      setNTupletDisplay(0);
    }
  }, [duration, dotted, tripletMode, nTupletMode, curNotes, maybeAutoClose, pushEditUndo, selectedNote, measures, applyNTuplet, willMeasureClose]);

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
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
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
    const validKey = lickKey && (FLAT_KEYS[lickKey] != null || SHARP_KEYS[lickKey] != null || lickKey === 'C') ? lickKey : undefined;
    try {
      renderSheet(el, allMeasures, Math.max(sheetWidth, 300), currentIdx, positionsRef.current, validKey, notePositionsRef.current, selectedNote);
    } catch {
      positionsRef.current.length = 0;
      notePositionsRef.current.length = 0;
      setSelectedNote(null);
    }
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
  // (updateNote moved before handleNotePress)

  /* set chord on a specific note */
  const setChordAtNote = useCallback((mi: number, ni: number, chord: string) => {
    updateNote(mi, ni, (n) => ({ ...n, chord: chord || undefined }));
  }, [updateNote]);

  /* build JSON */
  const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length;

  const jsonOutput = useMemo(() => {
    if (allMeasures.length === 0) return '';
    const features = computeLickFeatures(allMeasures);
    const entry = {
      id: 0,
      performer: performer || 'Unknown',
      title: title || 'Untitled',
      album,
      instrument,
      key: lickKey,
      style: '',
      tempo: bpm,
      tags: [] as string[],
      chords: allMeasures.map((m) => m.chord ?? '').filter(Boolean),
      sheetData: {
        timeSignature: '4/4',
        measures: allMeasures,
      },
      ...features,
    };
    return JSON.stringify(entry, null, 2);
  }, [allMeasures, performer, title, album, instrument, lickKey, bpm]);

  const countIn = useCountInIntro();

  /* playback — lick mode: melody + piano comp (no bass/drums), lush reverb */
  const handlePlay = useCallback(async () => {
    if (allMeasures.length === 0) return;
    if (!playerRef.current) {
      const p = new NotePlayer({ lickMode: true });
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing || countIn.active) {
      p.stop();
      countIn.cancel();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const preload = p.preload();
    // 릭 재생: BPM 무관하게 SIMPLE 카운트인.
    const cin = await countIn.run({ bpm, pattern: PATTERN_SIMPLE });
    if (!cin.ok) { setPlaying(false); return; }
    await preload;
    await p.play({
      title: title || 'Lick',
      composer: performer || '',
      key: lickKey || 'C',
      timeSignature: '4/4',
      tempo: bpm,
      measures: allMeasures,
    }, bpm, { startAt: p.ctxNow() + cin.downbeatInSec });
  }, [allMeasures, bpm, title, performer, lickKey, countIn]);

  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  /* update chord for any measure (completed or current) */
  const updateMeasureChord = useCallback((idx: number, chord: string) => {
    if (idx === measures.length) {
      // Current (open) measure
      setCurChord(chord);
    } else {
      setMeasures((prev) => prev.map((m, i) => i === idx ? { ...m, chord: chord || undefined } : m));
    }
  }, [measures.length]);

  /* 2-5-1 auto-tagger: fill ii-V-I chords for the chosen major key into the
   * first 3 chord slots. If the 1st measure already has a chord, start from
   * the 2nd measure instead. Creates empty measures as needed. */
  const applyTwoFiveOne = useCallback((key: TwoFiveOneKey) => {
    const chords = TWO_FIVE_ONE_BY_KEY[key];
    if (!chords) return;

    pushEditUndo();

    const hasCurrent = curNotes.length > 0 || !!curChord;
    const combined: MeasureInfo[] = hasCurrent
      ? [...measures, { notes: curNotes, chord: curChord || undefined }]
      : [...measures];

    const firstChord = combined[0]?.chord;
    const startIdx = firstChord ? 1 : 0;

    while (combined.length < startIdx + 3) {
      combined.push({ notes: [], chord: undefined });
    }

    for (let k = 0; k < 3; k++) {
      combined[startIdx + k] = { ...combined[startIdx + k], chord: chords[k] };
    }

    setMeasures(combined);
    setCurNotes([]);
    setCurChord('');
    setSelectedNote(null);
  }, [measures, curNotes, curChord, pushEditUndo]);

  /* Load JSON modal — accepts either:
   *   - a full lick entry: { performer, title, ..., sheetData: { measures: [...] } }
   *   - the inner sheetData object: { measures: [...] }
   * Populates the editor with the parsed measures + metadata. */
  const handleLoadJson = useCallback(() => {
    setLoadJsonError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(loadJsonText) as Record<string, unknown>;
    } catch (e) {
      setLoadJsonError(e instanceof Error ? `JSON 파싱 실패: ${e.message}` : 'Invalid JSON');
      return;
    }

    // Locate measures: prefer parsed.sheetData.measures, fall back to parsed.measures
    const sheetData = parsed.sheetData as { measures?: unknown } | undefined;
    const measuresRaw = (sheetData?.measures ?? parsed.measures) as MeasureInfo[] | undefined;
    if (!Array.isArray(measuresRaw)) {
      setLoadJsonError('JSON에 measures 배열이 없습니다. `sheetData.measures` 또는 최상위 `measures` 필드가 필요합니다.');
      return;
    }

    pushEditUndo();
    // Re-normalize chord cells so pasted multi-chord ("D-7 G7") becomes the
    // canonical 2-space form ("D-7  G7") the sheet renderer can split on.
    const normalized = measuresRaw.map((m) => {
      const nm: MeasureInfo = { ...m };
      if (typeof nm.chord === 'string') nm.chord = normalizeChord(nm.chord);
      if (Array.isArray(nm.notes)) {
        nm.notes = nm.notes.map((n) =>
          typeof n.chord === 'string' ? { ...n, chord: normalizeChord(n.chord) } : n,
        );
      }
      return nm;
    });
    setMeasures(normalized);
    setCurNotes([]);
    setCurChord('');
    setSelectedNote(null);

    // Pull metadata if present (top-level overrides sheetData-nested)
    const sheetMeta = sheetData as Record<string, unknown> | undefined;
    const pickStr = (key: string): string | undefined => {
      const v = parsed[key] ?? sheetMeta?.[key];
      return typeof v === 'string' ? v : undefined;
    };
    const pickNum = (key: string): number | undefined => {
      const v = parsed[key] ?? sheetMeta?.[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };

    const p = pickStr('performer');
    if (p !== undefined) setPerformer(p);
    const t = pickStr('title');
    if (t !== undefined) setTitle(t);
    const a = pickStr('album');
    if (a !== undefined) setAlbum(a);
    const inst = pickStr('instrument');
    if (inst !== undefined) setInstrument(inst);
    const k = pickStr('key');
    if (k !== undefined) setLickKey(k.split('-')[0]);
    const tempo = pickNum('tempo');
    if (tempo !== undefined) {
      setBpm(tempo);
      setBpmText(String(tempo));
      bpmManualRef.current = true;
    }

    setLoadJsonOpen(false);
    setLoadJsonText('');
  }, [loadJsonText, pushEditUndo]);

  /* save to backend (POST /api/v1/licks) — falls back to localStorage on failure */
  const handleSave = useCallback(async () => {
    if (allMeasures.length === 0 || saving) return;
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

    setSaving(true);
    setSaveError(null);
    try {
      const { createLick, updateLick } = await import('../api/licks');
      const { invalidateLicksCache } = await import('../data/lickData');
      let persisted: LickEntry;
      if (editingId) {
        // 편집 모드: PUT — 같은 publicId로 덮어쓰기
        persisted = await updateLick(editingId, entry);
      } else {
        persisted = await createLick(entry);
      }
      invalidateLicksCache();
      saveUserLick(persisted);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        if (editingId) navigate('/licks');
      }, 1200);
    } catch (err) {
      console.error('Backend save failed', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSaving(false);
    }
  }, [allMeasures, performer, title, instrument, album, bpm, lickKey, saving, editingId, navigate]);

  /* copy */
  const handleCopy = useCallback(() => {
    if (!jsonOutput) return;
    navigator.clipboard.writeText(jsonOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [jsonOutput]);

  return (
    <Page>
      {countIn.overlay}
      <Header>
        <BackBtn onClick={() => navigate(editingId ? '/licks' : '/')}>
          &#8592; {editingId ? 'Licks' : 'Home'}
        </BackBtn>
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
        {editingLick && (
          <span style={{ fontSize: '12px', color: '#888', alignSelf: 'center', marginLeft: '4px' }}>
            #{editingLick.id}
          </span>
        )}

        <Spacer />

        <Btn onClick={() => { setLoadJsonText(''); setLoadJsonError(null); setLoadJsonOpen(true); }}>
          Load JSON
        </Btn>
        <CopyBtn $copied={copied} onClick={handleCopy} disabled={totalNotes === 0}>
          {copied ? '✓ Copied!' : 'Copy JSON'}
        </CopyBtn>
        <SaveBtn $saved={saved} onClick={handleSave} disabled={totalNotes === 0 || saving}>
          {saving
            ? (editingId ? 'Updating…' : 'Saving…')
            : saved
              ? (editingId ? '✓ Updated!' : '✓ Saved!')
              : saveError
                ? '✕ Failed'
                : (editingId ? 'Update Lick' : 'Save Lick')}
        </SaveBtn>
        {saveError && (
          <span style={{ color: '#c0392b', fontSize: '12px', marginLeft: '8px', alignSelf: 'center' }}>
            {saveError}
          </span>
        )}
      </Header>

      <ToolBar>
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
          onClick={() => {
            // Triplet & n-tuplet are mutually exclusive
            setNTupletMode(false);
            nTupletCountRef.current = 0;
            setNTupletDisplay(0);
            setTripletMode((v) => { if (!v) tripletCountRef.current = 0; return !v; });
          }}
          title="Triplet mode (T) — next 3 notes become triplet"
          style={{ fontSize: '0.95rem', fontWeight: 700 }}
        >
          3
        </DurBtn>
        <DurBtn
          $active={ottavaMode === '8va'}
          onClick={() => handleOttavaToggle('8va')}
          title="8va bracket (octave up) — click to start, click again on last note to close"
          style={{ fontSize: '0.78rem', fontWeight: 700, fontStyle: 'italic', fontFamily: "'Times New Roman', serif" }}
        >
          8va
        </DurBtn>
        <DurBtn
          $active={ottavaMode === '8vb'}
          onClick={() => handleOttavaToggle('8vb')}
          title="8vb bracket (octave down) — click to start, click again on last note to close"
          style={{ fontSize: '0.78rem', fontWeight: 700, fontStyle: 'italic', fontFamily: "'Times New Roman', serif" }}
        >
          8vb
        </DurBtn>
        <DurBtn
          $active={nTupletMode}
          onClick={() => {
            // Toggle n-tuplet mode. Turning ON resets count; turning OFF keeps
            // already-stamped tuplet values on the notes.
            if (nTupletMode) {
              setNTupletMode(false);
              nTupletCountRef.current = 0;
              setNTupletDisplay(0);
            } else {
              setTripletMode(false);
              tripletCountRef.current = 0;
              setNTupletMode(true);
              nTupletCountRef.current = 0;
              setNTupletDisplay(0);
            }
          }}
          title="N-tuplet mode — every added note/rest joins one growing tuplet group (count increases per entry). Toggle off to end the group."
          style={{ fontSize: '0.85rem', fontWeight: 700 }}
        >
          {nTupletMode && nTupletDisplay > 0 ? `${nTupletDisplay}+` : '3+'}
        </DurBtn>
        <BarlineBtn onClick={closeMeasure} disabled={curNotes.length === 0} title="Close measure (Enter)">|</BarlineBtn>

        <Sep />

        <SectionLabel>2-5-1</SectionLabel>
        <TwoFiveOneSelect
          value=""
          onChange={(e) => {
            const key = e.target.value as TwoFiveOneKey | '';
            if (!key) return;
            applyTwoFiveOne(key);
            e.target.value = '';
          }}
          title="Pick a major key to auto-fill ii-V-I into the chord cells"
        >
          <option value="">Key…</option>
          {TWO_FIVE_ONE_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </TwoFiveOneSelect>

        <Sep />

        <MeasureIndicator>Bar {measures.length + 1}</MeasureIndicator>
        <BeatIndicator $full={curBeats >= 4}>
          {curBeats}/{4} beats
        </BeatIndicator>
        <Btn onClick={handleUndo} title="Undo (Backspace)">Undo</Btn>
        <Btn onClick={handleClear}>Clear</Btn>

        <Spacer />

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
      </ToolBar>

      <PianoArea>
        <PianoKeyboard onNotePress={handleNotePress} mute />
      </PianoArea>

      {selectedNote && selNoteInfo && (
        <NoteEditBar>
          <NoteEditLabel>
            Note: {selNoteInfo.keys[0]} ({selNoteInfo.duration.replace('r', ' rest')})
            {selNoteInfo.accidentals?.[0] === 'b' ? ' ♭' : selNoteInfo.accidentals?.[0] === '#' ? ' ♯' : selNoteInfo.accidentals?.[0] === 'n' ? ' ♮' : ''}
          </NoteEditLabel>
          <Sep />

          {/* Insert Before — 선택된 음표 앞에 (상단 툴바에서 고른) duration의
           * 쉼표 슬롯을 끼워넣음. 슬롯이 새로 선택 상태가 되므로 그 자리에서
           * 바로 피아노로 음을 치면 음표로 교체 / 음정/임시표/길이 조정 가능. */}
          <NoteEditBtn
            onClick={handleInsertBefore}
            title={`Insert ${duration}${dotted ? '·' : ''} rest before selected note`}
          >
            ↤ Insert
          </NoteEditBtn>

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
          ><span style={{ fontFamily: 'serif' }}>♭</span></NoteEditBtn>
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
          ><span style={{ fontFamily: 'serif' }}>♯</span></NoteEditBtn>
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
          ><span style={{ fontFamily: 'serif' }}>♮</span></NoteEditBtn>

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
          {/* ── Music symbols: articulations / fermata / dynamics ── */}
          {!selNoteInfo.duration.endsWith('r') && (<>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('staccato')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('staccato') ? cur.filter((a) => a !== 'staccato') : [...cur, 'staccato' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Staccato"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >·</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('accent')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('accent') ? cur.filter((a) => a !== 'accent') : [...cur, 'accent' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Accent"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >&gt;</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('tenuto')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('tenuto') ? cur.filter((a) => a !== 'tenuto') : [...cur, 'tenuto' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Tenuto"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >—</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('marcato')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('marcato') ? cur.filter((a) => a !== 'marcato') : [...cur, 'marcato' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Marcato"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >^</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.fermata}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, fermata: !n.fermata || undefined }))}
              title="Fermata"
              style={{ fontSize: '1.0rem', fontFamily: 'serif' }}
            >𝄐</NoteEditBtn>
            <select
              value={selNoteInfo.dynamics ?? ''}
              onChange={(e) => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const v = e.target.value;
                return { ...n, dynamics: (v || undefined) as typeof n.dynamics };
              })}
              title="Dynamics"
              style={{ fontSize: '0.65rem', padding: '3px 4px', border: '1px solid #ccc', borderRadius: 4, fontStyle: 'italic' }}
            >
              <option value="">dyn</option>
              <option value="pp">pp</option>
              <option value="p">p</option>
              <option value="mp">mp</option>
              <option value="mf">mf</option>
              <option value="f">f</option>
              <option value="ff">ff</option>
              <option value="fff">fff</option>
              <option value="sfz">sfz</option>
              <option value="fp">fp</option>
            </select>
            <NoteEditBtn
              $active={!!selNoteInfo.ornaments?.includes('trill')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.ornaments ?? [];
                const next = cur.includes('trill') ? cur.filter((o) => o !== 'trill') : [...cur, 'trill' as const];
                return { ...n, ornaments: next.length ? next : undefined };
              })}
              title="Trill"
              style={{ fontStyle: 'italic', fontFamily: 'serif', fontSize: '0.85rem' }}
            >tr</NoteEditBtn>
            <select
              value={(selNoteInfo.ornaments ?? []).find((o) => o !== 'trill') ?? ''}
              onChange={(e) => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const v = e.target.value as '' | 'mordent' | 'inverted-mordent' | 'turn' | 'inverted-turn' | 'tremolo';
                const keepTrill = n.ornaments?.includes('trill') ? ['trill' as const] : [];
                const rest = v ? [v] : [];
                const next = [...keepTrill, ...rest];
                return { ...n, ornaments: next.length ? next : undefined };
              })}
              title="Ornament"
              style={{ fontSize: '0.65rem', padding: '3px 4px', border: '1px solid #ccc', borderRadius: 4 }}
            >
              <option value="">orn</option>
              <option value="mordent">𝆗 mordent</option>
              <option value="inverted-mordent">𝆘 inv-mor</option>
              <option value="turn">𝆗 turn</option>
              <option value="inverted-turn">inv-turn</option>
              <option value="tremolo">/// trem</option>
            </select>
            <NoteEditBtn
              $active={!!selNoteInfo.slurStart}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, slurStart: !n.slurStart || undefined }))}
              title="Slur start"
              style={{ fontSize: '0.78rem' }}
            >⌒◜</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.slurStop}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, slurStop: !n.slurStop || undefined }))}
              title="Slur stop"
              style={{ fontSize: '0.78rem' }}
            >◞⌒</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.grace}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, grace: !n.grace || undefined }))}
              title="Grace note"
              style={{ fontSize: '0.7rem', fontWeight: 700 }}
            >gr</NoteEditBtn>
          </>)}

          <Sep />
          {/* ── Ottava (8va/8vb) toggle on the selected note ── */}
          <NoteEditBtn
            $active={!!selNoteInfo.ottavaStart}
            onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
              if (n.ottavaStart) {
                const next = { ...n };
                delete next.ottavaStart;
                return next;
              }
              return { ...n, ottavaStart: '8va' };
            })}
            title="Toggle 8va bracket start on this note"
            style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontSize: '0.72rem' }}
          >8va◜</NoteEditBtn>
          <NoteEditBtn
            $active={!!selNoteInfo.ottavaEnd}
            onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, ottavaEnd: !n.ottavaEnd || undefined }))}
            title="Toggle 8va bracket end on this note"
            style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontSize: '0.72rem' }}
          >◞8va</NoteEditBtn>

          {/* ── Measure-level edits (only valid when the selected note is in a
                committed measure — the still-open current measure isn't yet a
                measure index we can structurally manipulate). ── */}
          {selectedNote && selectedNote.mi < measures.length && (<>
            <Sep />
            {/* Repeat / volta / navigation (D.S./Coda/D.C./Fine) toggles */}
            <NoteEditBtn
              $active={!!measures[selectedNote.mi]?.repeatStart}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, repeatStart: !m.repeatStart || undefined }))}
              title="Repeat start"
            >
              <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><line x1="2" y1="1" x2="2" y2="21" stroke="currentColor" strokeWidth="2.5"/><line x1="5.5" y1="1" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/><circle cx="10" cy="14" r="1.7" fill="currentColor"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={!!measures[selectedNote.mi]?.repeatEnd}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, repeatEnd: !m.repeatEnd || undefined }))}
              title="Repeat end"
            >
              <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><circle cx="6" cy="8" r="1.7" fill="currentColor"/><circle cx="6" cy="14" r="1.7" fill="currentColor"/><line x1="10.5" y1="1" x2="10.5" y2="21" stroke="currentColor" strokeWidth="1"/><line x1="14" y1="1" x2="14" y2="21" stroke="currentColor" strokeWidth="2.5"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={measures[selectedNote.mi]?.navigation === 'segno'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'segno' ? undefined : 'segno' }))}
              title="Segno (𝄋)"
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.1rem' }}
            >{''}</NoteEditBtn>
            <NoteEditBtn
              $active={measures[selectedNote.mi]?.navigation === 'coda'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'coda' ? undefined : 'coda' }))}
              title="Coda (𝄌)"
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.1rem' }}
            >{''}</NoteEditBtn>
            <NoteEditBtn
              $active={measures[selectedNote.mi]?.navigation === 'fine'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'fine' ? undefined : 'fine' }))}
              title="Fine"
              style={{ fontSize: '0.65rem', fontWeight: 700, fontStyle: 'italic' }}
            >Fine</NoteEditBtn>
            <NoteEditBtn
              $active={measures[selectedNote.mi]?.navigation === 'toCoda'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'toCoda' ? undefined : 'toCoda' }))}
              title="To Coda"
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '0.75rem' }}
            ><span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.6rem', fontWeight: 700, fontStyle: 'italic', marginRight: 1 }}>To</span>{''}</NoteEditBtn>
            <select
              value={(() => {
                const n = measures[selectedNote.mi]?.navigation;
                return n && ['dc', 'dcAlCoda', 'dcAlFine', 'ds', 'dsAlCoda', 'dsAlFine'].includes(n) ? n : '';
              })()}
              onChange={(e) => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: (e.target.value as NavigationMarker) || undefined }))}
              style={{ fontSize: '0.65rem', padding: '3px 4px', border: '1px solid #ccc', borderRadius: 4 }}
            >
              <option value="">D.C./D.S.</option>
              <option value="dc">D.C.</option>
              <option value="dcAlCoda">D.C. al Coda</option>
              <option value="dcAlFine">D.C. al Fine</option>
              <option value="ds">D.S.</option>
              <option value="dsAlCoda">D.S. al Coda</option>
              <option value="dsAlFine">D.S. al Fine</option>
            </select>

            <Sep />
            <NoteEditBtn
              onClick={() => insertMeasureBefore(selectedNote.mi)}
              title="Insert a fresh empty measure BEFORE this one"
              style={{ fontSize: '0.72rem' }}
            >＋ ◀ Bar</NoteEditBtn>
            <NoteEditBtn
              onClick={() => insertMeasureAfter(selectedNote.mi)}
              title="Insert a fresh empty measure AFTER this one"
              style={{ fontSize: '0.72rem' }}
            >Bar ▶ ＋</NoteEditBtn>
            <NoteEditBtn
              onClick={() => {
                if (confirm(`Delete measure ${selectedNote.mi + 1}? (undo with Backspace)`)) {
                  deleteMeasure(selectedNote.mi);
                }
              }}
              title="Delete this entire measure"
              style={{ fontSize: '0.72rem', color: '#c0392b' }}
            >🗑 Bar</NoteEditBtn>
          </>)}
          <NoteEditBtn
            onClick={() => deleteNote(selectedNote.mi, selectedNote.ni)}
            title="Delete just this note"
            style={{ fontSize: '0.72rem', color: '#c0392b' }}
          >🗑 Note</NoteEditBtn>

          <Sep />
          <NoteEditBtn onClick={() => setSelectedNote(null)}>✕ Deselect</NoteEditBtn>
        </NoteEditBar>
      )}

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

      {loadJsonOpen && (
        <ModalOverlay onClick={() => setLoadJsonOpen(false)}>
          <ModalCard onClick={(e) => e.stopPropagation()}>
            <ModalTitle>Load JSON</ModalTitle>
            <ModalHint>
              릭 JSON을 붙여넣으세요. 전체 lick entry 또는 <code>sheetData</code> 내부 객체 모두 지원
              (<code>measures</code> 배열만 있으면 됨). 로드 시 편집기 내용이 교체됩니다 (Undo 가능).
            </ModalHint>
            <JsonTextarea
              autoFocus
              spellCheck={false}
              placeholder='{"performer":"Charlie Parker","title":"Donna Lee","key":"Ab","tempo":200,"sheetData":{"measures":[{"chord":"Eb-7","notes":[{"keys":["b/4"],"duration":"8"}]}]}}'
              value={loadJsonText}
              onChange={(e) => { setLoadJsonText(e.target.value); if (loadJsonError) setLoadJsonError(null); }}
            />
            {loadJsonError && <ModalErr>{loadJsonError}</ModalErr>}
            <ModalActions>
              <ModalBtn onClick={() => setLoadJsonOpen(false)}>Cancel</ModalBtn>
              <ModalBtn $primary onClick={handleLoadJson} disabled={!loadJsonText.trim()}>Load</ModalBtn>
            </ModalActions>
          </ModalCard>
        </ModalOverlay>
      )}
    </Page>
  );
}
