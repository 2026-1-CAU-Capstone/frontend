import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, StaveTie, Tuplet, Repetition,
  TextBracket, TextBracketPosition, Articulation, Annotation, AnnotationVerticalJustify,
  Ornament, Tremolo, Curve,
} from 'vexflow';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import type { NoteInfo, MeasureInfo, NavigationMarker, NoteSheetData } from '../data/sampleMelody';

/* ─── helpers ──────────────────────────────────────────────────────────── */

import { getGlobalKeyboard } from '../lib/player/GlobalKeyboard';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { swungBeats } from '../lib/note/swing';
import { normalizeChord, formatChordDisplay } from '../lib/jazz-harmony';
import { createSolo, updateSolo } from '../api/solos';
import { buildUserSoloDraft, invalidateSolosCache, loadAllSolos, pushSoloToCache, updateSoloInCache } from '../data/soloData';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';
import { NoteIcon, RestIcon } from '../components/notesheet/NotationIcon';

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_TO_FLAT: Record<string, string> = { c: 'd', d: 'e', f: 'g', g: 'a', a: 'b' };

/* Autosave: 작성 중인 solo를 10초마다 localStorage에 저장. 새로고침/크래시 후
 * 마운트 시 자동 복구. handleSaveSolo 성공/handleClear에서 삭제.
 * 저장된 솔로 자체는 백엔드 (POST /v1/solos) 로 보낸다 — soloData.ts 참고. */
const DRAFT_KEY = 'leadSheetGenerator.draft.v1';

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
    return { vexKey: pn.vexKey, acc: '#' };
  }
  const [letter, oct] = pn.vexKey.split('/');
  const flatLetter = SHARP_TO_FLAT[letter];
  if (!flatLetter) return { vexKey: pn.vexKey };
  return { vexKey: `${flatLetter}/${oct}`, acc: 'b' };
}

function getBeats(dur: string, dotted?: boolean, tuplet?: number): number {
  const base = dur.replace(/r$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (dotted) b *= 1.5;
  if (tuplet && tuplet >= 2) {
    const denom = Math.pow(2, Math.floor(Math.log2(tuplet - 1)));
    b *= denom / tuplet;
  }
  return b;
}

function measureBeats(notes: NoteInfo[]): number {
  return notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
}

/* ─── measure normalization ───────────────────────────────────────────────
 *
 * LLM-generated solo JSON occasionally produces measures whose notes don't
 * add up to a clean bar (typically over-stuffed — 5 to 9 beats in one
 * "measure"). VexFlow's `voice.setStrict(false)` will still render it, but
 * the visual result is a wall of unbroken beams with no barlines — which is
 * exactly the bug screenshot.
 *
 * This normalizer walks each input measure note-by-note and flushes a new
 * bar every `beatsPerBar` (4 by default), so a 9-beat blob becomes 3 clean
 * measures (4 + 4 + 1) the renderer can lay out properly. Bar-level metadata
 * (chord, repeat, volta, navigation) is preserved on the first / last
 * sub-bar so the on-screen score reads identically.
 *
 * Limitations: doesn't tie-split an individual note that straddles a bar
 * line (e.g. a quarter on beat 4.5 spilling into beat 1 of the next bar);
 * such a note stays whole and goes to the bar where it starts. That keeps
 * the implementation linear and avoids inventing tied note pairs that
 * don't match what the LLM actually wrote — empirically the over-stuffing
 * happens at note boundaries far more often than mid-note.
 */
function splitMeasuresByBeats(measures: MeasureInfo[], beatsPerBar = 4): MeasureInfo[] {
  const out: MeasureInfo[] = [];
  const EPS = 0.001;

  for (const src of measures) {
    const srcNotes = Array.isArray(src.notes) ? src.notes : [];
    if (srcNotes.length === 0) {
      out.push(src);
      continue;
    }

    const total = measureBeats(srcNotes);
    if (total <= beatsPerBar + EPS) {
      // Already legal — pass through unchanged.
      out.push(src);
      continue;
    }

    let bucket: NoteInfo[] = [];
    let cursor = 0;
    let isFirst = true;
    let lastFlushedIdx = -1;

    const flush = (isFinal: boolean) => {
      if (bucket.length === 0) return;
      const piece: MeasureInfo = { notes: bucket };
      if (isFirst) {
        // Carry leading metadata only to the first sub-bar.
        if (src.chord) piece.chord = src.chord;
        if (src.repeatStart) piece.repeatStart = true;
        if (src.volta) piece.volta = src.volta;
        if (src.bracket) piece.bracket = true;
        if (src.timeSignature) piece.timeSignature = src.timeSignature;
        if (src.key) piece.key = src.key;
        if (src.anacrusis) piece.anacrusis = true;
        isFirst = false;
      }
      if (isFinal) {
        // End-of-bar metadata sticks to the last sub-bar.
        if (src.repeatEnd) piece.repeatEnd = true;
        if (src.navigation) piece.navigation = src.navigation;
      }
      out.push(piece);
      lastFlushedIdx = out.length - 1;
      bucket = [];
      cursor = 0;
    };

    for (const n of srcNotes) {
      const b = getBeats(n.duration, n.dotted, n.tuplet);
      if (cursor + b > beatsPerBar + EPS && bucket.length > 0) {
        flush(false);
      }
      bucket.push(n);
      cursor += b;
    }
    flush(true);

    // Edge case: nothing got flushed (e.g. a single mega-note > 4 beats) —
    // fall back to the original so we don't drop data silently.
    if (lastFlushedIdx === -1) out.push(src);
  }

  return out;
}

/* ─── piano playback ─────────────────────────────────────────────────── */

/* Playback shares the app-wide piano via getGlobalKeyboard(). */

/** Parse a chord symbol like "CΔ7", "Dm7", "G7b9" → array of MIDI notes (3-4 note voicing around C3-C4) */
function chordToMidi(chord: string): number[] {
  if (!chord) return [];
  // Root note
  const rootMatch = chord.match(/^([A-Ga-g])([#b♯♭]?)/);
  if (!rootMatch) return [];
  const rootLetter = rootMatch[1].toLowerCase();
  const rootAcc = rootMatch[2];
  let root = SEMI_MAP[rootLetter] ?? 0;
  if (rootAcc === '#' || rootAcc === '♯') root += 1;
  if (rootAcc === 'b' || rootAcc === '♭') root -= 1;
  const rest = chord.slice(rootMatch[0].length);

  // Determine chord quality → intervals from root
  let intervals: number[];
  if (/^[mM\-](?!aj)/i.test(rest) && !/^min.*maj/i.test(rest)) {
    // minor
    if (/7/.test(rest)) intervals = [0, 3, 7, 10]; // m7
    else intervals = [0, 3, 7];
  } else if (/dim|[oø°]/.test(rest)) {
    if (/ø|half/i.test(rest) || /7/.test(rest)) intervals = [0, 3, 6, 10]; // half-dim
    else intervals = [0, 3, 6]; // dim
  } else if (/aug|\+/.test(rest)) {
    if (/7/.test(rest)) intervals = [0, 4, 8, 10];
    else intervals = [0, 4, 8];
  } else if (/[Δ△]|[Mm]aj7/i.test(rest)) {
    intervals = [0, 4, 7, 11]; // maj7
  } else if (/7/.test(rest)) {
    intervals = [0, 4, 7, 10]; // dom7
  } else if (/sus4/.test(rest)) {
    intervals = [0, 5, 7];
  } else if (/sus2/.test(rest)) {
    intervals = [0, 2, 7];
  } else {
    intervals = [0, 4, 7]; // major triad
  }

  // Voice around C3 (MIDI 48) - rootless voicing style
  const base = 48 + root; // C3 range
  return intervals.map((iv) => base + iv);
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

/* ─── navigation marker → VexFlow Repetition type ─────────────────────── */

const NAV_REPETITION: Record<NavigationMarker, number[]> = {
  segno:     [Repetition.type.SEGNO_LEFT],
  coda:      [Repetition.type.CODA_LEFT],
  fine:      [Repetition.type.FINE],
  toCoda:    [Repetition.type.TO_CODA],
  dc:        [Repetition.type.DC],
  dcAlCoda:  [Repetition.type.DC_AL_CODA],
  dcAlFine:  [Repetition.type.DC_AL_FINE],
  ds:        [Repetition.type.DS],
  dsAlCoda:  [Repetition.type.DS_AL_CODA],
  dsAlFine:  [Repetition.type.DS_AL_FINE],
};

/* ─── VexFlow rendering ────────────────────────────────────────────────── */

const SHEET_SCALE = 1.35;
const LINE_HEIGHT = 170;
/* MARGIN.top: chord 라벨(28px high) 이 stave 위에 충분한 여유를 두고 들어갈 공간. */
const MARGIN = { top: 50, left: 10, right: 10, bottom: 10 };
/** Soft cap on bars per line. The actual line break is driven by the
 *  per-measure intrinsic width (see `measureWidth`), so this only bites
 *  for very thin measures (lots of whole notes) that would otherwise
 *  fit a dozen-plus to a line and look like a crammed timeline. */
const MAX_PER_LINE = 8;
const DECOR_FIRST = 70;
const DECOR_OTHER = 35;
/** Intrinsic width per duration token. Heuristic — VexFlow's Formatter does
 *  the fine-grained spacing inside the cell, but the cell itself must be at
 *  least this wide so a bar full of 8th/16th notes isn't compressed into
 *  the same width as one whole note. Tuned empirically: 4 quarter notes
 *  → ~205px, 8 eighth notes → ~245px, 16 sixteenths → ~320px. */
const NOTE_W: Record<string, number> = {
  w: 90, h: 64, q: 42, '8': 26, '16': 18, '32': 14,
};
/** Fallback when a measure is empty / unrecognised. */
const FIXED_BAR_W = 200;

interface MeasurePos { idx: number; x: number; y: number; w: number; chordX: number; }
interface NotePos { mi: number; ni: number; x: number; y: number; w: number; h: number; }

/** Intrinsic visual width for one measure based on its notes — not used for
 *  pixel-perfect placement (the Formatter does that), but as the weight when
 *  we proportionally divide each line's available width across its bars. A
 *  16th-rich bar gets more pixels than a half-note-rich one. */
function measureWidth(m: MeasureInfo): number {
  if (!m.notes || m.notes.length === 0) return FIXED_BAR_W;
  let w = 0;
  for (const n of m.notes) {
    const base = n.duration.replace(/r$/, '');
    let nw = NOTE_W[base] ?? 26;
    if (n.dotted) nw *= 1.4;
    if (n.tuplet && n.tuplet >= 3) nw *= 0.85;
    if (n.accidentals?.[0]) nw += 6;
    w += nw;
  }
  /* Leading/trailing padding for chord text + the barline glyph. */
  return Math.max(w + 22, 150);
}

function packLines(measures: MeasureInfo[], availW: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;
  for (let i = 0; i < measures.length; i++) {
    const mw = measureWidth(measures[i]);
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

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number, currentIdx: number, positions: MeasurePos[], sheetKey?: string, notePositions?: NotePos[], selectedNote?: { mi: number; ni: number } | null, noteElMap?: Map<string, SVGElement>) {
  positions.length = 0;
  if (notePositions) notePositions.length = 0;
  if (noteElMap) noteElMap.clear();
  el.innerHTML = '';
  if (measures.length === 0) return;
  const innerW = width / SHEET_SCALE;
  const totalW = innerW - MARGIN.left - MARGIN.right;
  const lines = packLines(measures, totalW);
  const totalH = MARGIN.top + lines.length * LINE_HEIGHT + MARGIN.bottom;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(innerW, totalH);
  const ctx = renderer.getContext();

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

    /* Allocate each bar a width proportional to its intrinsic note density
     * (so a 16th-heavy bar gets more pixels than a half-note bar). The line
     * fully fills `availForBars` — except for the last line when it has
     * less content than the soft cap, in which case bars keep their
     * natural width (left-aligned) so a short final phrase doesn't
     * stretch out cartoonishly. */
    const intrinsics = indices.map((idx) => measureWidth(measures[idx]));
    const totalIntrinsic = intrinsics.reduce((s, w) => s + w, 0);
    const shouldStretch =
      !isLastLine || indices.length >= MAX_PER_LINE || totalIntrinsic > availForBars;
    const barWidths = shouldStretch && totalIntrinsic > 0
      ? intrinsics.map((w) => (w / totalIntrinsic) * availForBars)
      : intrinsics;

    let x = MARGIN.left;
    for (let j = 0; j < indices.length; j++) {
      const m = indices[j];
      const firstInLine = j === 0;
      const isLast = m === measures.length - 1 && m !== currentIdx;
      const w = firstInLine ? barWidths[j] + decorW : barWidths[j];

      const stave = new Stave(x, y, w);
      if (firstInLine) {
        stave.addClef('treble');
        if (sheetKey && sheetKey !== 'C') stave.addKeySignature(sheetKey);
        if (isFirstLine) stave.addTimeSignature('4/4');
      }
      // Repeat / end barlines. Default in VexFlow is SINGLE, but assigning
      // it explicitly avoids edge cases where adjacent staves overlap and
      // the bar line visually disappears (the bug screenshot).
      const mData = measures[m];
      if (mData.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
      if (mData.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
      else if (isLast) stave.setEndBarType(BarlineType.END);
      else stave.setEndBarType(BarlineType.SINGLE);
      // Navigation markers (D.C., Coda, Segno, Fine, etc.)
      if (mData.navigation) {
        const repTypes = NAV_REPETITION[mData.navigation];
        if (repTypes) {
          for (const rt of repTypes) stave.setRepetitionType(rt);
        }
      }
      stave.setContext(ctx).draw();

      // Draw volta brackets manually so vertical lines reach the stave
      if (mData.volta && svgEl) {
        const v = mData.volta;
        const prevVolta = m > 0 ? measures[m - 1]?.volta : undefined;
        const isStart = prevVolta !== v;
        const voltaTop = y - 16;
        const staveY = y + 40;
        const lx = x + 1;
        const rx = x + w - 1;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Horizontal line
        const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hLine.setAttribute('x1', String(lx)); hLine.setAttribute('y1', String(voltaTop));
        hLine.setAttribute('x2', String(rx)); hLine.setAttribute('y2', String(voltaTop));
        hLine.setAttribute('stroke', '#333'); hLine.setAttribute('stroke-width', '1.5');
        g.appendChild(hLine);
        if (isStart) {
          // Left vertical line from top to stave
          const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          vLine.setAttribute('x1', String(lx)); vLine.setAttribute('y1', String(voltaTop));
          vLine.setAttribute('x2', String(lx)); vLine.setAttribute('y2', String(staveY));
          vLine.setAttribute('stroke', '#333'); vLine.setAttribute('stroke-width', '1.5');
          g.appendChild(vLine);
          // Label
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', String(lx + 6)); txt.setAttribute('y', String(voltaTop + 22));
          txt.setAttribute('font-size', '17'); txt.setAttribute('font-weight', '700');
          txt.setAttribute('font-family', '"Times New Roman", "Noto Serif KR", serif');
          txt.setAttribute('fill', '#333');
          txt.textContent = `${v}.`;
          g.appendChild(txt);
        }
        svgEl.appendChild(g);
      }

      const chordX = firstInLine ? x + decorW + 4 : x + 4;
      positions.push({ idx: m, x: chordX, y, w: w - (firstInLine ? decorW : 0) - 4, chordX });

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

      const activeAcc = tieCarryAcc ? new Map(tieCarryAcc) : new Map<string, 'b' | '#' | 'n'>();
      tieCarryAcc = undefined;

      const vfNotes = measure.notes.map((n) => {
        const isRest = n.duration.endsWith('r');
        const dur = buildDuration(n.duration, n.dotted);
        const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: dur, autoStem: true });
        if (n.dotted) Dot.buildAndAttach([note]);

        if (!isRest) {
          // Letter-scoped accidental memory: once a letter has been altered
          // in this measure, the next bare same-letter note — regardless of
          // octave — prints with a cautionary ♮ so the reader sees the
          // Bb→B transition across octaves.
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

        // ── Articulations / fermata / dynamics ─────────────────────────
        // Same rendering rules as NoteSheet (the master reference). Position
        // 3 = above, 4 = below. Articulations flip to the stem's OPPOSITE
        // side; marcato is conventionally always above; fermata always above.
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
      /* Use formatToStave so the formatter respects the stave's actual
       * note-area boundaries (getNoteStartX() / getNoteEndX()). With the
       * naïve format(voices, width) call the last notehead/flag can extend
       * past the barline because `width` constrains note ANCHOR positions,
       * not their right edges. */
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);

      const beams: Beam[] = [];
      let beamGroup: StaveNote[] = [];
      let groupBeats = 0;
      let inTupletN = 0;
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

  // Draw 8va / 8vb brackets (ottava). The printed pitch is at-stave; the
  // bracket signals "sounds an octave up / down". The player applies the
  // matching ±12 semitones at scheduling time so playback stays correct.
  {
    let active: { kind: '8va' | '8vb'; idx: number } | null = null;
    let oIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        const n = measure.notes[ni];
        if (n.ottavaStart && !active) active = { kind: n.ottavaStart, idx: oIdx };
        if (n.ottavaEnd && active) {
          const from = allVfNotes[active.idx];
          const to = allVfNotes[oIdx];
          if (from && to) {
            try {
              const tb = new TextBracket({
                start: from.vfNote,
                stop: to.vfNote,
                text: '8',
                superscript: active.kind === '8va' ? 'va' : 'vb',
                position: active.kind === '8va' ? TextBracketPosition.TOP : TextBracketPosition.BOTTOM,
              });
              tb.setContext(ctx).draw();
            } catch (e) { console.warn('ottava draw failed', e); }
          }
          active = null;
        }
        oIdx++;
      }
    }
  }

  // Draw slurs (이음줄). Stack-based so nested slurs work, and graceful
  // fallback if a stop has no matching start (or vice versa) — that's not a
  // crash, just a silently-skipped curve.
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
            try {
              new Curve(from.vfNote, to.vfNote, {}).setContext(ctx).draw();
            } catch (e) { console.warn('slur draw failed', e); }
          }
        }
        sIdx++;
      }
    }
  }

  // Draw intro brackets — small parentheses inside bracketed measures
  if (svgEl) {
    const drawBracketArc = (cx: number, top: number, bot: number, openSide: boolean) => {
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
        const pStart = positions.find((p) => p.idx === groupStart);
        if (pStart) {
          const top = pStart.y + 28;
          const bot = pStart.y + LINE_HEIGHT - 60;
          drawBracketArc(pStart.x + 2, top, bot, true);
          // Find last note's right edge in the bracket group
          const lastNoteInGroup = [...allVfNotes].reverse().find((e) => e.mi === groupEnd);
          let closeX: number;
          if (lastNoteInGroup) {
            const bb = lastNoteInGroup.vfNote.getBoundingBox();
            closeX = bb ? bb.getX() + bb.getW() + 4 : (positions.find((p) => p.idx === groupEnd)?.x ?? 0) + (positions.find((p) => p.idx === groupEnd)?.w ?? 0) - 2;
          } else {
            const pEnd = positions.find((p) => p.idx === groupEnd);
            closeX = pEnd ? pEnd.x + pEnd.w - 2 : 0;
          }
          drawBracketArc(closeX, top, bot, false);
        }
      } else {
        bi++;
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
      if (noteElMap) {
        const svgNode = entry.vfNote.getSVGElement();
        if (svgNode) noteElMap.set(`${entry.mi}-${entry.ni}`, svgNode as SVGElement);
      }
      if (selectedNote && entry.mi === selectedNote.mi && entry.ni === selectedNote.ni) {
        const RED = '#d32f2f';
        const applyRed = (el: Element) => {
          const s = (el as SVGElement).style;
          s.fill = RED; s.stroke = RED;
          el.querySelectorAll('*').forEach((c) => {
            const cs = (c as SVGElement).style;
            cs.fill = RED; cs.stroke = RED;
          });
        };
        // Note head group
        const noteSvg = entry.vfNote.getSVGElement();
        if (noteSvg) applyRed(noteSvg);
        // Walk up to find the parent vf-stavenote group which contains stem + flag
        if (noteSvg) {
          let parent = noteSvg.parentElement;
          while (parent && parent !== (svgEl as unknown as HTMLElement)) {
            const cls = parent.getAttribute('class') || '';
            if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) {
              applyRed(parent);
              break;
            }
            parent = parent.parentElement;
          }
        }
        // Also try internal VexFlow refs as fallback
        try { const stemEl = (entry.vfNote as any).stem?.elem; if (stemEl) applyRed(stemEl); } catch {}
        try { const flagEl = (entry.vfNote as any).flag?.elem; if (flagEl) applyRed(flagEl); } catch {}
      }
    }
  }
}

/* ─── SVG icons ────────────────────────────────────────────────────────── */


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
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'Pretendard', sans-serif;
`;

const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
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

const Title = styled.span`
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MetaInput = styled.input`
  font-family: 'Pretendard', sans-serif;
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

const KeySelect = styled.select`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 3px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
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
  font-size: 1.45rem;
  width: 54px;
  height: 54px;
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
  width: 54px;
  height: 54px;
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

const NavSelect = styled.select`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 4px;
  border-radius: 6px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.bgPrimary}; }
`;

const Btn = styled.button`
  font-family: 'Pretendard', sans-serif;
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

const SaveBtn = styled(Btn)<{ $saved?: boolean }>`
  background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  color: #fff;
  border-color: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  font-weight: 600;
  &:hover { background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#6d5310')}; }
`;

const JsonBtn = styled.button<{ $bg: string; $hover: string }>`
  padding: 5px 14px;
  font-size: 0.82rem;
  font-weight: 700;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  color: #fff;
  background: ${({ $bg }) => $bg};
  transition: background 0.12s;
  &:hover { background: ${({ $hover }) => $hover}; }
  &:disabled { opacity: 0.4; cursor: default; }
`;

const Spacer = styled.div` flex: 1; `;

const PlayerBar = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #1e1e1e;
  padding: 14px 22px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  z-index: 1000;
`;

const PlayerIconBtn = styled.button`
  font-size: 1.3rem;
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #2a6e3f;
  color: #fff;
  cursor: pointer;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const BpmInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  outline: none;
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

const UndoClearRow = styled.div`
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 4px 0;
`;

const SectionLabel = styled.span`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-right: 2px;
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
  background: ${({ $hasValue }) => ($hasValue ? 'transparent' : 'rgba(0,0,0,0.04)')};
  cursor: text;
  transition: background 0.12s;
  &:hover { background: rgba(0,0,0,0.07); }
`;

const ChordCellDisplay = styled.span`
  display: flex;
  align-items: baseline;
  padding: 0 5px;
  height: 28px;
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
  color: #222;
  white-space: nowrap;
  line-height: 28px;
`;

const ChordBase = styled.span`
  font-size: 1.85rem;
  font-weight: 400;
`;

const ChordExt = styled.span`
  font-size: 1.3rem;
  font-weight: 400;
  position: relative;
  top: -6px;
`;

const ChordHalfDim = styled.span`
  font-size: 1.85rem;
  font-weight: 400;
  display: inline-block;
  transform: scaleX(1.3);
  margin: 0 2px;
`;

const ChordTensionNum = styled.span`
  font-size: 1.05rem;
  font-weight: 400;
  position: relative;
  top: -9px;
  margin-left: 0px;
`;

const ChordTensionAcc = styled.span`
  font-size: 1.15rem;
  font-weight: 400;
  position: relative;
  top: -6px;
  margin-left: 2px;
`;

const ChordCellInput = styled.input`
  width: 52px;
  height: 100%;
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
  font-size: 1.2rem;
  font-weight: 400;
  padding: 2px 4px;
  border: none;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.15);
  color: #222;
  outline: none;
`;

/* normalizeChord now imported from src/lib/jazz-harmony. */

function splitChord(chord: string): { base: string; ext: string; tensions: { acc: string; num: string }[] } {
  const m = chord.match(/^(\D*?)(\d.*)$/);
  if (!m) return { base: chord, ext: '', tensions: [] };
  const rest = m[2];
  const extMatch = rest.match(/^(\d+)/);
  const ext = extMatch ? extMatch[1] : '';
  let remaining = rest.slice(ext.length);
  const tensions: { acc: string; num: string }[] = [];
  while (remaining.length > 0) {
    const t = remaining.match(/^([♭♯\u266D\u266F#b]*)(\d+)/);
    if (!t) break;
    tensions.push({ acc: t[1], num: t[2] });
    remaining = remaining.slice(t[0].length);
  }
  return { base: m[1], ext, tensions };
}

/* formatChordDisplay imported from src/lib/jazz-harmony \u2014 see top of file. */

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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
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

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

const ModalBox = styled.div`
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-family: 'Pretendard', sans-serif;
  font-size: 1.1rem;
  color: #333;
`;

const ModalTextarea = styled.textarea`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 12px;
  min-height: 260px;
  resize: vertical;
  outline: none;
  &:focus { border-color: #b8960a; }
`;

const ModalBtnRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const ModalError = styled.div`
  color: #d32f2f;
  font-size: 0.8rem;
  font-family: 'Pretendard', sans-serif;
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

/* Saving overlay — shown while the create/update POST is in flight. The
 * backend save can take several seconds, so we block interaction and make
 * the wait explicit, then auto-navigate away once it's persisted. */
const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const SavingBox = styled.div`
  background: #fff;
  border-radius: 14px;
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
`;

const Spinner = styled.div`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 3px solid rgba(0, 0, 0, 0.12);
  border-top-color: #ef6c00;
  animation: ${spin} 0.8s linear infinite;
`;

const SavingText = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: #333;
`;

const SavingSub = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: #888;
`;

/* ─── component ────────────────────────────────────────────────────────── */

export default function EditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  /* Mode selector — solo vs lick. Lives in URL so the choice is bookmarkable
   * and reflected on refresh. Default = 'solo'. Persisted to localStorage so
   * the toolbar dropdown defaults to whichever mode the user used last. */
  const initialMode: 'solo' | 'lick' = (() => {
    const q = searchParams.get('mode');
    if (q === 'solo' || q === 'lick') return q;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('jazzify.editor.mode');
      if (stored === 'solo' || stored === 'lick') return stored;
    }
    return 'solo';
  })();
  const [mode, setMode] = useState<'solo' | 'lick'>(initialMode);
  useEffect(() => {
    window.localStorage.setItem('jazzify.editor.mode', mode);
    // Keep URL in sync so back/forward and bookmarks work.
    if (searchParams.get('mode') !== mode) {
      const next = new URLSearchParams(searchParams);
      next.set('mode', mode);
      setSearchParams(next, { replace: true });
    }
  }, [mode, searchParams, setSearchParams]);

  /* When this page is entered via "수정하기" from another admin viewer, the
   * caller passes a NoteSheetData in route state. We pull it once on mount,
   * skip the localStorage draft restore, and pre-populate the editor with it. */
  const prefillSheet = (location.state as { prefillSheet?: NoteSheetData } | null)?.prefillSheet;

  /* When entered to edit a Lick (mode=lick), the caller passes the full
   * LickEntry. We populate from that on mount. */
  const editingLick = (location.state as { editingLick?: LickEntry } | null)?.editingLick;
  // Capture the edit-target id ONCE. The mount effect clears location.state
  // (state: null) so deriving editingLickId every render would yield null by
  // save time → createLick instead of updateLick (duplicate lick). Holding it
  // in state survives the history replace.
  const [editingLickId] = useState<string | null>(
    () => (editingLick ? String(editingLick.id) : null),
  );

  const [measures, setMeasures] = useState<MeasureInfo[]>([]);
  const [curNotes, setCurNotes] = useState<NoteInfo[]>([]);
  const [curChord1, setCurChord1] = useState('');
  const [curChord2, setCurChord2] = useState('');

  // Join two chord slots into double-space format for storage
  const joinChords = (c1: string, c2: string) => {
    if (c1 && c2) return `${c1}  ${c2}`;
    if (c1) return c1;
    if (c2) return `  ${c2}`;
    return '';
  };
  // Split double-space chord into two slots
  const splitChords = (chord: string): [string, string] => {
    if (!chord) return ['', ''];
    const parts = chord.split(/\s{2,}/);
    return [parts[0] ?? '', parts[1] ?? ''];
  };
  const curChord = joinChords(curChord1, curChord2);

  const [composer, setComposer] = useState('');
  const [genre, setGenre] = useState('');
  const [sheetTitle, setSheetTitle] = useState('');
  const [sheetKey, setSheetKey] = useState('C');

  const [duration, setDuration] = useState('8');
  const [dotted, setDotted] = useState(false);
  const [accMode, setAccMode] = useState<'b' | '#' | 'n'>('b');
  const [tieNext, setTieNext] = useState(false);
  const [tripletMode, setTripletMode] = useState(false);
  const tripletCountRef = useRef(0);
  /* ── 8va / 8vb bracket toggle. Activate before entering notes, then call
   *    handleOttavaToggle(same kind) on the last note to close. Same UX as
   *    LickCreator. */
  const [ottavaMode, setOttavaMode] = useState<'8va' | '8vb' | null>(null);
  const ottavaOpenRef = useRef(false);
  const [repeatStart, setRepeatStart] = useState(false);
  const [repeatEnd, setRepeatEnd] = useState(false);
  const [volta, setVolta] = useState<0 | 1 | 2>(0); // 0=none, 1=1st ending, 2=2nd ending
  const [navigation, setNavigation] = useState<NavigationMarker | ''>('');
  const [bracket, setBracket] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadJsonText, setLoadJsonText] = useState('');
  const [loadJsonError, setLoadJsonError] = useState('');
  const [bpm, setBpm] = useState(200);
  const [bpmText, setBpmText] = useState('200');
  const bpmManualRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const playAbortRef = useRef<AbortController | null>(null);
  const pauseResolveRef = useRef<(() => void) | null>(null);
  const pausedRef = useRef(false);
  const svgRef = useRef<HTMLDivElement>(null);
  const chord1Ref = useRef<HTMLInputElement>(null);

  const positionsRef = useRef<MeasurePos[]>([]);
  const [measurePositions, setMeasurePositions] = useState<MeasurePos[]>([]);
  const notePositionsRef = useRef<NotePos[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const [notePositions, setNotePositions] = useState<NotePos[]>([]);
  const [selectedNote, setSelectedNote] = useState<{ mi: number; ni: number } | null>(null);
  const [noteChordEditing, setNoteChordEditing] = useState(false);
  const [noteChordValue, setNoteChordValue] = useState('');
  const noteChordInputRef = useRef<HTMLInputElement>(null);

  /* ── Load draft on mount: restore the last in-progress solo state ──────
   * 같은 페이지를 다시 열거나 새로고침해도 작성하던 내용이 살아남음.
   * handleSaveSolo 성공 / handleClear 시 키 삭제. */
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    // ── prefillSheet (from Admin Tools "수정하기") wins over localStorage draft.
    // Clears the existing draft so the imported state doesn't immediately get
    // mashed up with stale autosave content.
    if (prefillSheet) {
      try {
        const normalized = splitMeasuresByBeats(prefillSheet.measures, 4);
        setMeasures(normalized);
        setCurNotes([]);
        setCurChord1('');
        setCurChord2('');
        if (prefillSheet.title) setSheetTitle(prefillSheet.title);
        if (prefillSheet.composer) setComposer(prefillSheet.composer);
        if (prefillSheet.key) setSheetKey(prefillSheet.key);
        if (prefillSheet.tempo) {
          setBpm(prefillSheet.tempo);
          setBpmText(String(prefillSheet.tempo));
          bpmManualRef.current = true;
        }
        // Replace history entry so a refresh doesn't re-prefill the same data,
        // and so the back button doesn't loop through the same view.
        navigate(location.pathname, { replace: true, state: null });
      } catch (e) {
        console.warn('Failed to apply prefillSheet', e);
      }
      return;
    }

    if (editingLick) {
      // Auto-force lick mode when entered via lick-edit, then populate.
      try {
        setMode('lick');
        if (editingLick.title) setSheetTitle(editingLick.title);
        if (editingLick.performer) setComposer(editingLick.performer);
        if (editingLick.style) setGenre(editingLick.style);
        if (editingLick.key) {
          const keyRoot = editingLick.key.split('-')[0];
          if (keyRoot) setSheetKey(keyRoot);
        }
        if (editingLick.tempo) {
          setBpm(editingLick.tempo);
          setBpmText(String(editingLick.tempo));
          bpmManualRef.current = true;
        }
        let sd: unknown = editingLick.sheetData;
        if (typeof sd === 'string') {
          try { sd = JSON.parse(sd); } catch { /* noop */ }
        }
        const sheetMeasures = (sd as { measures?: MeasureInfo[] } | null)?.measures;
        if (Array.isArray(sheetMeasures) && sheetMeasures.length > 0) {
          setMeasures(splitMeasuresByBeats(sheetMeasures, 4));
        } else {
          console.warn('[EditorPage] editingLick has no measures', editingLick);
        }
        setCurNotes([]);
        setCurChord1('');
        setCurChord2('');
        navigate(location.pathname, { replace: true, state: null });
      } catch (e) {
        console.warn('Failed to apply editingLick', e);
      }
      return;
    }

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d.measures)) setMeasures(splitMeasuresByBeats(d.measures, 4));
      if (Array.isArray(d.curNotes)) setCurNotes(d.curNotes);
      if (typeof d.curChord1 === 'string') setCurChord1(d.curChord1);
      if (typeof d.curChord2 === 'string') setCurChord2(d.curChord2);
      if (typeof d.composer === 'string') setComposer(d.composer);
      if (typeof d.genre === 'string') setGenre(d.genre);
      if (typeof d.sheetTitle === 'string') setSheetTitle(d.sheetTitle);
      if (typeof d.sheetKey === 'string') setSheetKey(d.sheetKey);
      if (typeof d.bpm === 'number' && d.bpm >= 20 && d.bpm <= 400) {
        setBpm(d.bpm);
        setBpmText(String(d.bpm));
        bpmManualRef.current = true;
      }
    } catch (e) {
      console.warn('Failed to load lead-sheet draft', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Autosave draft every 10s — survives reload/crash ────────────────── */
  useEffect(() => {
    const intv = setInterval(() => {
      try {
        const isEmpty =
          measures.length === 0 &&
          curNotes.length === 0 &&
          !curChord1 && !curChord2 &&
          !composer && !genre && !sheetTitle;
        if (isEmpty) return;
        const draft = {
          measures, curNotes, curChord1, curChord2,
          composer, genre, sheetTitle, sheetKey, bpm,
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {
        console.warn('Failed to autosave lead-sheet draft', e);
      }
    }, 10000);
    return () => clearInterval(intv);
  }, [measures, curNotes, curChord1, curChord2, composer, genre, sheetTitle, sheetKey, bpm]);

  const editUndoStack = useRef<{ measures: MeasureInfo[]; curNotes: NoteInfo[]; curChord1: string; curChord2: string; repeatStart: boolean; repeatEnd: boolean; volta: 0 | 1 | 2; navigation: NavigationMarker | ''; bracket: boolean }[]>([]);
  const pushEditUndo = useCallback(() => {
    editUndoStack.current.push({ measures: measures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })), curNotes: curNotes.map((n) => ({ ...n })), curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket });
    if (editUndoStack.current.length > 50) editUndoStack.current.shift();
  }, [measures, curNotes, curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket]);

  const curBeats = useMemo(() => measureBeats(curNotes), [curNotes]);

  const curChord1Ref = useRef(curChord1);
  curChord1Ref.current = curChord1;
  const curChord2Ref = useRef(curChord2);
  curChord2Ref.current = curChord2;

  const allMeasures = useMemo<MeasureInfo[]>(() => {
    if (curNotes.length === 0 && !curChord) return measures;
    const cur: MeasureInfo = { notes: curNotes, chord: curChord || undefined };
    if (repeatStart) cur.repeatStart = true;
    if (repeatEnd) cur.repeatEnd = true;
    if (volta) cur.volta = volta;
    if (navigation) cur.navigation = navigation;
    if (bracket) cur.bracket = true;
    return [...measures, cur];
  }, [measures, curNotes, curChord, repeatStart, repeatEnd, volta, navigation, bracket]);

  const currentIdx = curNotes.length > 0 || curChord ? measures.length : -1;

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

  const maybeAutoClose = useCallback((notes: NoteInfo[]) => {
    const beats = notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet), 0);
    if (notes.length > 0 && beats >= 4 - 0.001) {
      const chord = joinChords(curChord1Ref.current, curChord2Ref.current);
      setMeasures((prev) => [...prev, { notes, chord: chord || undefined }]);
      setCurNotes([]);
      setCurChord1('');
      setCurChord2('');
      setTimeout(() => chord1Ref.current?.focus(), 50);
    }
  }, []);

  /* ── 8va / 8vb toggle. Click once to arm the bracket (next note becomes
   *    its start). Click the same button again to close — last note in
   *    curNotes (or last note of last measure if curNotes is empty) gets
   *    ottavaEnd. */
  const handleOttavaToggle = useCallback((kind: '8va' | '8vb') => {
    if (ottavaMode === kind && ottavaOpenRef.current) {
      // Close — stamp ottavaEnd on the last entered note.
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

  const closeMeasure = useCallback(() => {
    if (curNotes.length === 0) return;
    pushEditUndo();
    const chord = joinChords(curChord1, curChord2);
    const m: MeasureInfo = { notes: curNotes, chord: chord || undefined };
    if (repeatStart) m.repeatStart = true;
    if (repeatEnd) m.repeatEnd = true;
    if (volta) m.volta = volta;
    if (navigation) m.navigation = navigation;
    if (bracket) m.bracket = true;
    setMeasures((prev) => [...prev, m]);
    setCurNotes([]);
    setCurChord1('');
    setCurChord2('');
    setRepeatStart(false);
    setRepeatEnd(false);
    setNavigation('');
    setBracket(false);
    setTimeout(() => chord1Ref.current?.focus(), 50);
  }, [curNotes, curChord1, curChord2, pushEditUndo, repeatStart, repeatEnd, navigation, bracket]);

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

  const setChordAtNote = useCallback((mi: number, ni: number, chord: string) => {
    updateNote(mi, ni, (n) => ({ ...n, chord: chord || undefined }));
  }, [updateNote]);

  const updateMeasure = useCallback((mi: number, updater: (m: MeasureInfo) => MeasureInfo) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? updater(m) : m));
    }
  }, [measures.length, pushEditUndo]);

  /** Insert a fresh empty measure BEFORE the given measure index. If `mi`
   *  is >= measures.length the new measure is appended at the end. */
  const insertMeasureBefore = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => {
      const idx = Math.max(0, Math.min(mi, prev.length));
      const fresh: MeasureInfo = { notes: [], chord: undefined };
      const next = [...prev];
      next.splice(idx, 0, fresh);
      return next;
    });
    setSelectedNote(null);
  }, [pushEditUndo]);

  /** Insert a fresh empty measure AFTER the given measure index. */
  const insertMeasureAfter = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => {
      const idx = Math.max(0, Math.min(mi + 1, prev.length));
      const fresh: MeasureInfo = { notes: [], chord: undefined };
      const next = [...prev];
      next.splice(idx, 0, fresh);
      return next;
    });
    setSelectedNote(null);
  }, [pushEditUndo]);

  /** Remove the measure at `mi`. Selection is cleared if it pointed at the
   *  removed bar (or anything past it). */
  const deleteMeasure = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => prev.filter((_, i) => i !== mi));
    setSelectedNote(null);
  }, [pushEditUndo]);

  /* Tie toggling is already wired into the existing note edit panel via
   * updateNote(...) — see the 'Tie' button row in the selected-note UI. */

  /** Delete a single note at (mi, ni). */
  const deleteNote = useCallback((mi: number, ni: number) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        return { ...m, notes: m.notes.filter((_, j) => j !== ni) };
      }));
    } else {
      setCurNotes((prev) => prev.filter((_, j) => j !== ni));
    }
    setSelectedNote(null);
  }, [measures.length, pushEditUndo]);

  const handleNotePress = useCallback((pn: PianoNote) => {
    const conv = convertAcc(pn, accMode === 'n' ? 'b' : accMode);
    playMidi(pn.midi);

    // Diatonic respell: in keys whose signature already flats C (Gb/Cb majors
    // + Ebm/Abm) the white B key is pitch-class 11, which spells Cb — not
    // B natural — in those keys. Same idea for E↔Fb in Cb major / Abm.
    // The respelled letter (C or F) is already flat via the key sig, so we
    // drop the accidental entirely (otherwise accMode='n' would force a
    // stray natural sign on the wrong letter).
    let respelled = false;
    if (sheetKey && !conv.acc) {
      const sig = keySigAccidentals(sheetKey);
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
        : accMode === 'n' ? { 0: 'n' as const }
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

    pushEditUndo();
    const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
    if (!respelled && accMode === 'n') {
      ni.accidentals = { 0: 'n' };
    } else if (conv.acc) {
      ni.accidentals = { 0: conv.acc };
    }
    if (tripletMode) ni.tuplet = 3;
    // 8va / 8vb bracket: first note inside the active bracket gets the
    // ottavaStart marker. ottavaEnd is stamped by handleOttavaToggle when
    // the user toggles the same bracket off again.
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

    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }
  }, [duration, dotted, accMode, tieNext, tripletMode, curNotes, measures.length, maybeAutoClose, pushEditUndo, selectedNote, updateNote]);

  const handleRest = useCallback((dur?: string) => {
    pushEditUndo();
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
  }, [duration, dotted, tripletMode, curNotes, maybeAutoClose, pushEditUndo]);

  const handleUndo = useCallback(() => {
    if (editUndoStack.current.length > 0) {
      const snap = editUndoStack.current.pop()!;
      setMeasures(snap.measures);
      setCurNotes(snap.curNotes);
      setCurChord1(snap.curChord1);
      setCurChord2(snap.curChord2);
      setRepeatStart(snap.repeatStart);
      setRepeatEnd(snap.repeatEnd);
      setVolta(snap.volta);
      setNavigation(snap.navigation);
      setBracket(snap.bracket);
      return;
    }
    if (curNotes.length > 0) {
      setCurNotes((p) => p.slice(0, -1));
    } else if (measures.length > 0) {
      const last = measures[measures.length - 1];
      setMeasures((p) => p.slice(0, -1));
      setCurNotes(last.notes);
      const [c1, c2] = splitChords(last.chord ?? '');
      setCurChord1(c1);
      setCurChord2(c2);
      setRepeatStart(last.repeatStart ?? false);
      setRepeatEnd(last.repeatEnd ?? false);
      // last.volta is a generic number from MeasureInfo but the editor
      // only tracks 0|1|2 — clamp anything else to 0.
      const v = last.volta ?? 0;
      setVolta(v === 1 || v === 2 ? v : 0);
      setNavigation(last.navigation ?? '');
      setBracket(last.bracket ?? false);
    }
  }, [curNotes.length, measures]);

  const handleClear = useCallback(() => {
    setMeasures([]);
    setCurNotes([]);
    setCurChord1('');
    setCurChord2('');
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
  }, []);

  const handleLoadJson = useCallback(() => {
    try {
      const data = JSON.parse(loadJsonText);
      if (!data.measures || !Array.isArray(data.measures)) {
        setLoadJsonError('Invalid format: missing "measures" array');
        return;
      }
      // Re-normalize chord cells so pasted multi-chord ("D-7 G7") becomes the
      // canonical 2-space form the sheet renderer can split on.
      const chordNormalized = (data.measures as MeasureInfo[]).map((m) => {
        const nm: MeasureInfo = { ...m };
        if (typeof nm.chord === 'string') {
          const parts = nm.chord.split(/\s+/).filter(Boolean);
          nm.chord = parts.length > 1
            ? parts.map(normalizeChord).join('  ')
            : normalizeChord(nm.chord.trim());
        }
        if (Array.isArray(nm.notes)) {
          nm.notes = nm.notes.map((n) =>
            typeof n.chord === 'string'
              ? { ...n, chord: normalizeChord(n.chord) }
              : n,
          );
        }
        return nm;
      });
      // Snap measures that exceed 4 beats into multiple legal bars so the
      // renderer can draw real barlines / line breaks instead of bleeding
      // beams across the page (the bug screenshot).
      const normalized = splitMeasuresByBeats(chordNormalized, 4);
      setMeasures(normalized);
      setCurNotes([]);
      setCurChord1('');
      setCurChord2('');
      if (data.title) setSheetTitle(data.title);
      if (data.composer) setComposer(data.composer);
      if (data.genre) setGenre(data.genre);
      if (data.key) setSheetKey(data.key);
      if (data.tempo) { setBpm(data.tempo); setBpmText(String(data.tempo)); bpmManualRef.current = true; }
      setSelectedNote(null);
      setShowLoadModal(false);
      setLoadJsonText('');
      setLoadJsonError('');
    } catch {
      setLoadJsonError('Invalid JSON');
    }
  }, [loadJsonText]);

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

      // Note navigation — < / > (or ArrowLeft/Right) cycles selection through
      // every note/rest in the score in order.
      const isPrev = e.key === ',' || e.key === '<' || e.key === 'ArrowLeft';
      const isNext = e.key === '.' || e.key === '>' || e.key === 'ArrowRight';
      if (isPrev || isNext) {
        e.preventDefault();
        const flat: Array<{ mi: number; ni: number }> = [];
        allMeasures.forEach((m, mi) => {
          m.notes.forEach((_, ni) => flat.push({ mi, ni }));
        });
        if (flat.length === 0) return;
        let nextIdx: number;
        if (!selectedNote) {
          nextIdx = isPrev ? flat.length - 1 : 0;
        } else {
          const idx = flat.findIndex(
            (f) => f.mi === selectedNote.mi && f.ni === selectedNote.ni,
          );
          if (idx < 0) {
            nextIdx = isPrev ? flat.length - 1 : 0;
          } else {
            nextIdx = isPrev
              ? Math.max(0, idx - 1)
              : Math.min(flat.length - 1, idx + 1);
          }
        }
        setSelectedNote(flat[nextIdx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, closeMeasure, allMeasures, selectedNote]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (allMeasures.length === 0) { el.innerHTML = ''; positionsRef.current = []; setMeasurePositions([]); notePositionsRef.current = []; return; }
    const validKey = sheetKey && (FLAT_KEYS[sheetKey] != null || SHARP_KEYS[sheetKey] != null || sheetKey === 'C') ? sheetKey : undefined;
    try {
      renderSheet(el, allMeasures, Math.max(sheetWidth, 300), currentIdx, positionsRef.current, validKey, notePositionsRef.current, selectedNote, noteElMapRef.current);
    } catch {
      positionsRef.current.length = 0;
      notePositionsRef.current.length = 0;
      setSelectedNote(null);
    }
    setMeasurePositions([...positionsRef.current]);
    setNotePositions([...notePositionsRef.current]);
  }, [allMeasures, sheetWidth, currentIdx, sheetKey, selectedNote]);

  const selNoteInfo = useMemo<NoteInfo | null>(() => {
    if (!selectedNote) return null;
    const m = allMeasures[selectedNote.mi];
    if (!m) return null;
    return m.notes[selectedNote.ni] ?? null;
  }, [selectedNote, allMeasures]);

  useEffect(() => {
    if (selectedNote && !allMeasures[selectedNote.mi]?.notes[selectedNote.ni]) {
      setSelectedNote(null);
    }
  }, [allMeasures, selectedNote]);

  const handleSheetClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / SHEET_SCALE;
    const cy = (e.clientY - rect.top) / SHEET_SCALE;
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
      if (selectedNote && selectedNote.mi === best.mi && selectedNote.ni === best.ni) {
        setSelectedNote(null);
      } else {
        setSelectedNote({ mi: best.mi, ni: best.ni });
      }
    } else {
      setSelectedNote(null);
    }
  }, [selectedNote]);

  // (moved before handleNotePress)

  const selMeasure = useMemo<MeasureInfo | null>(() => {
    if (!selectedNote) return null;
    return allMeasures[selectedNote.mi] ?? null;
  }, [selectedNote, allMeasures]);

  const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length;

  /* build JSON — lead sheet format */
  const jsonOutput = useMemo(() => {
    if (allMeasures.length === 0) return '';
    const entry = {
      title: sheetTitle || 'Untitled',
      composer: composer || 'Unknown',
      ...(genre ? { genre } : {}),
      key: sheetKey,
      timeSignature: '4/4',
      tempo: bpm,
      measures: allMeasures,
    };
    return JSON.stringify(entry, null, 2);
  }, [allMeasures, sheetTitle, composer, genre, sheetKey, bpm]);

  /* playback */
  const handlePause = useCallback(() => {
    if (!playing) return;
    if (pausedRef.current) {
      // Resume
      pausedRef.current = false;
      setPaused(false);
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
    } else {
      // Pause
      pausedRef.current = true;
      setPaused(true);
    }
  }, [playing]);

  const countIn = useCountInIntro();

  /* Stop playback if the editor unmounts mid-play (save→navigate, sidebar
   * nav, etc.). Aborting trips the play loop's catch → kb.stopAll(),
   * so sound stops and we don't keep scheduling notes after leaving. */
  useEffect(() => () => { playAbortRef.current?.abort(); }, []);

  const handlePlay = useCallback(async () => {
    if (playing || countIn.active) {
      playAbortRef.current?.abort();
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
      pausedRef.current = false;
      countIn.cancel();
      setPaused(false);
      setPlaying(false);
      return;
    }
    if (allMeasures.length === 0) return;

    setPlaying(true);
    // 카운트인과 병렬로 piano soundfont 로드 — 첫 재생 지연 제거.
    const kb = getGlobalKeyboard();
    const kbReady = kb.ensureReady();
    const cin = await countIn.run({ bpm });
    if (!cin.ok) { setPlaying(false); return; }
    await kbReady;
    const abort = new AbortController();
    playAbortRef.current = abort;
    pausedRef.current = false;
    setPaused(false);

    // Align the first note with the count-in's downbeat. cin.downbeatInSec
    // measures setTimeout slop between cin resolve and here in any clock.
    if (cin.downbeatInSec > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, cin.downbeatInSec * 1000);
          abort.signal.addEventListener(
            'abort',
            () => { clearTimeout(timer); reject('stop'); },
            { once: true },
          );
        });
      } catch {
        setPlaying(false);
        return;
      }
    }

    const beatDur = 60 / bpm;
    // Swung-time projection: distance between two straight-beat positions in
    // wall-clock seconds, after the swing-feel non-linear remap. Off-beat 8ths
    // sit ~24% later inside the beat. Quarter notes and downbeats land exactly
    // on integer-beat boundaries so chord comping fires in straight time even
    // while the melody breathes.
    const beatRange = (start: number, b: number) =>
      (swungBeats(start + b) - swungBeats(start)) * beatDur;

    // Helper: expand repeat/volta/navigation for a set of measures
    type ExpandedM = { m: MeasureInfo; origMi: number };
    const expandMeasures = (srcMeasures: MeasureInfo[]): ExpandedM[] => {
      const expandedMeasures: ExpandedM[] = [];

      // Phase 1: expand repeats + volta
      const afterRepeats: ExpandedM[] = [];
      let repeatFromIdx = 0;
      let mi = 0;
      while (mi < srcMeasures.length) {
        const m = srcMeasures[mi];
        if (m.repeatStart) repeatFromIdx = mi;
        afterRepeats.push({ m, origMi: mi });

        if (m.repeatEnd) {
          for (let ri = repeatFromIdx; ri <= mi; ri++) {
            if (srcMeasures[ri].volta === 1) break;
            afterRepeats.push({ m: srcMeasures[ri], origMi: ri });
          }
          let vi = mi + 1;
          while (vi < srcMeasures.length && srcMeasures[vi].volta === 2) {
            afterRepeats.push({ m: srcMeasures[vi], origMi: vi });
            vi++;
          }
          mi = vi;
          continue;
        }
        mi++;
      }

      // Phase 2: expand D.C./D.S./Coda/Fine navigation
      const segnoIdx = afterRepeats.findIndex((e) => e.m.navigation === 'segno');
      const codaIdx = afterRepeats.findIndex((e) => e.m.navigation === 'coda');

      let jumped = false;
      for (let mi = 0; mi < afterRepeats.length; mi++) {
        const entry = afterRepeats[mi];
        expandedMeasures.push(entry);
        const nav = entry.m.navigation;
        if (!nav || jumped) continue;

        if (nav === 'fine') break;
        if (nav === 'toCoda' && !jumped) continue;
        if (nav === 'dc' || nav === 'dcAlCoda' || nav === 'dcAlFine' ||
            nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine') {
          jumped = true;
          const jumpTo = (nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine')
            ? Math.max(0, segnoIdx) : 0;
          const alCoda = nav === 'dcAlCoda' || nav === 'dsAlCoda';
          const alFine = nav === 'dcAlFine' || nav === 'dsAlFine';

          for (let ri = jumpTo; ri < afterRepeats.length; ri++) {
            const re = afterRepeats[ri];
            expandedMeasures.push(re);
            if (alCoda && re.m.navigation === 'toCoda') {
              if (codaIdx >= 0) {
                for (let ci = codaIdx; ci < afterRepeats.length; ci++) {
                  expandedMeasures.push(afterRepeats[ci]);
                }
              }
              break;
            }
            if (alFine && re.m.navigation === 'fine') break;
            if (!alCoda && !alFine && (nav === 'dc' || nav === 'ds') && ri === afterRepeats.length - 1) break;
          }
          break;
        }
      }
      return expandedMeasures;
    };

    // Highlight helpers — direct DOM manipulation, no React re-render
    const elMap = noteElMapRef.current;
    let prevKey: string | null = null;
    const BLUE = '#1565c0';
    const colorNote = (key: string, color: string) => {
      const svg = elMap.get(key);
      if (!svg) return;
      const apply = (el: Element) => { (el as SVGElement).style.fill = color; };
      apply(svg);
      svg.querySelectorAll('*').forEach(apply);
    };
    const highlight = (mi: number, ni: number) => {
      if (prevKey) colorNote(prevKey, '');
      const key = `${mi}-${ni}`;
      colorNote(key, BLUE);
      prevKey = key;
    };
    const clearHighlight = () => { if (prevKey) colorNote(prevKey, ''); prevKey = null; };
    const checkPause = async () => {
      if (abort.signal.aborted) throw 'stop';
      if (pausedRef.current) {
        await new Promise<void>((resolve, reject) => {
          pauseResolveRef.current = resolve;
          abort.signal.addEventListener('abort', () => { reject('stop'); }, { once: true });
        });
      }
    };

    try {
      let loopCount = 0;
      while (!abort.signal.aborted) {
        // On first loop: use all measures. On subsequent loops: skip bracket measures
        // and start from the first measure with a chord.
        let srcMeasures: MeasureInfo[];
        if (loopCount === 0) {
          srcMeasures = allMeasures;
        } else {
          // Find first measure index with a chord
          const firstChordIdx = allMeasures.findIndex((m) => !!m.chord);
          const startIdx = firstChordIdx >= 0 ? firstChordIdx : 0;
          srcMeasures = allMeasures.slice(startIdx);
        }

        const expandedMeasures = expandMeasures(srcMeasures);
        // Remap origMi: when loopCount > 0, srcMeasures is a slice, so origMi is relative.
        // We need to offset it back to absolute index for highlight.
        const miOffset = loopCount === 0 ? 0 : (allMeasures.findIndex((m) => !!m.chord) || 0);

        // Build flat note list with beat-position tracking for inline piano comping
        type FlatNote = { note: NoteInfo; mi: number; ni: number; emIdx: number; beatPos: number };
        const flat: FlatNote[] = [];
        for (let ei = 0; ei < expandedMeasures.length; ei++) {
          const em = expandedMeasures[ei];
          let bp = 0;
          for (let ni = 0; ni < em.m.notes.length; ni++) {
            flat.push({ note: em.m.notes[ni], mi: em.origMi + miOffset, ni, emIdx: ei, beatPos: bp });
            bp += getBeats(em.m.notes[ni].duration, em.m.notes[ni].dotted, em.m.notes[ni].tuplet);
          }
        }

        // Pre-compute piano chord voicings per expanded measure
        const compChords: { midi1: number[]; midi2: number[] }[] = expandedMeasures.map((em) => {
          const mChord = em.m.chord;
          if (!mChord) return { midi1: [], midi2: [] };
          const parts = mChord.split(/\s{2,}/);
          const c1 = parts[0]?.trim();
          const c2 = parts[1]?.trim() || c1;
          return { midi1: chordToMidi(c1 || ''), midi2: chordToMidi(c2 || '') };
        });
        const compDur = beatDur * 0.6;
        const compedBeats = new Set<string>();
        const fireComp = (emIdx: number, beatStart: number, beatEnd: number) => {
          if ((beatStart < 1 && beatEnd > 1) || beatStart === 1) {
            const key = `${emIdx}-2`;
            if (!compedBeats.has(key)) {
              compedBeats.add(key);
              const cc = compChords[emIdx];
              if (cc.midi1.length > 0) {
                for (const m of cc.midi1) kb.play(String(m), { duration: compDur, gain: 1.2 });
              }
            }
          }
          if ((beatStart < 3 && beatEnd > 3) || beatStart === 3) {
            const key = `${emIdx}-4`;
            if (!compedBeats.has(key)) {
              compedBeats.add(key);
              const cc = compChords[emIdx];
              if (cc.midi2.length > 0) {
                for (const m of cc.midi2) kb.play(String(m), { duration: compDur, gain: 1.2 });
              }
            }
          }
        };

        // Helper: wait for a duration, fire piano comping at exact beat 2 (pos 1) and beat 4 (pos 3)
        const waitWithComp = async (totalBeats: number, emIdx: number, startBeat: number) => {
          const boundaries: number[] = [];
          for (const b of [1, 3]) {
            if (b > startBeat && b < startBeat + totalBeats) boundaries.push(b);
          }
          if (startBeat === 1 || startBeat === 3) {
            fireComp(emIdx, startBeat, startBeat);
          }

          let elapsed = 0;
          for (const b of boundaries) {
            const waitBeats = (b - startBeat) - elapsed;
            if (waitBeats > 0.001) {
              // Swung wait — off-beat starts get a shorter wall-clock leg to the
              // next downbeat than straight 8ths would.
              const waitSec = beatRange(startBeat + elapsed, waitBeats);
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, waitSec * 1000);
                abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
              });
              elapsed += waitBeats;
            }
            fireComp(emIdx, b, b);
          }
          const leftBeats = totalBeats - elapsed;
          if (leftBeats > 0.001) {
            const waitSec = beatRange(startBeat + elapsed, leftBeats);
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, waitSec * 1000);
              abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject('stop'); }, { once: true });
            });
          }
        };

        // Play all notes in this loop pass
        let i = 0;
        while (i < flat.length) {
          await checkPause();
          const { note: n, mi, ni, emIdx, beatPos } = flat[i];
          const isRest = n.duration.endsWith('r');
          const baseDur = n.duration.replace(/r$/, '');
          let beats = DUR_BEATS[baseDur] ?? 1;
          if (n.dotted) beats *= 1.5;
          if (n.tuplet && n.tuplet >= 2) {
            const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
            beats *= denom / n.tuplet;
          }

          if (!isRest) highlight(mi, ni);

          if (!isRest && n.tie) {
            const tieSegs: { emIdx: number; beatPos: number; beats: number }[] = [
              { emIdx, beatPos, beats },
            ];
            let look = i + 1;
            while (look < flat.length) {
              const ln = flat[look].note;
              const lb = ln.duration.replace(/r$/, '');
              let lbeats = DUR_BEATS[lb] ?? 1;
              if (ln.dotted) lbeats *= 1.5;
              if (ln.tuplet && ln.tuplet >= 2) {
                const denom = Math.pow(2, Math.floor(Math.log2(ln.tuplet - 1)));
                lbeats *= denom / ln.tuplet;
              }
              tieSegs.push({ emIdx: flat[look].emIdx, beatPos: flat[look].beatPos, beats: lbeats });
              if (!ln.tie) { look++; break; }
              look++;
            }
            const totalBeats = tieSegs.reduce((s, seg) => s + seg.beats, 0);
            const sec = beatRange(beatPos, totalBeats);
            const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
            const midi = vexToMidi(n.keys[0], acc);
            kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
            for (const seg of tieSegs) {
              await waitWithComp(seg.beats, seg.emIdx, seg.beatPos);
            }
            i = look;
            continue;
          }

          const sec = beatRange(beatPos, beats);
          if (!isRest) {
            const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
            const midi = vexToMidi(n.keys[0], acc);
            kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
          }
          await waitWithComp(beats, emIdx, beatPos);
          i++;
        }

        loopCount++;
      }
    } catch {
      // stopped
    }

    clearHighlight();
    kb.stopAll();
    setPlaying(false);
  }, [playing, allMeasures, bpm]);

  // Update a specific chord slot (0 or 1) for a given measure
  const updateMeasureChordSlot = useCallback((idx: number, slot: 0 | 1, value: string) => {
    if (idx === measures.length) {
      // Current (open) measure
      if (slot === 0) setCurChord1(value);
      else setCurChord2(value);
    } else {
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== idx) return m;
        const [c1, c2] = splitChords(m.chord ?? '');
        const newC1 = slot === 0 ? value : c1;
        const newC2 = slot === 1 ? value : c2;
        const joined = joinChords(newC1, newC2);
        return { ...m, chord: joined || undefined };
      }));
    }
  }, [measures.length]);

  const handleSave = useCallback(async () => {
    if (allMeasures.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    // On success we navigate away; keep the saving overlay up through the
    // route change instead of flashing it off in `finally`.
    let navigated = false;
    try {
      if (mode === 'solo') {
        const draft = buildUserSoloDraft({
          title: sheetTitle || 'Untitled',
          composer: composer || 'Unknown',
          genre: genre || undefined,
          key: sheetKey,
          timeSignature: '4/4',
          tempo: bpm,
          measures: allMeasures,
        });
        const titleLow = (sheetTitle || 'Untitled').toLowerCase();
        const performerLow = (composer || 'Unknown').toLowerCase();
        // Only treat this as an UPDATE of an existing solo when the user
        // actually typed a title AND performer. Otherwise the 'Untitled'/
        // 'Unknown' defaults would make every untitled save overwrite the
        // previous untitled one (data loss). Blank → always create new.
        const canMatch = sheetTitle.trim() !== '' && composer.trim() !== '';
        const existing = canMatch ? await loadAllSolos() : [];
        const found = canMatch
          ? existing.find(
              (s) => s.title.toLowerCase() === titleLow && (s.performer ?? '').toLowerCase() === performerLow,
            )
          : undefined;
        const persisted = found
          ? await updateSolo(found.publicId, draft)
          : await createSolo(draft);
        found ? updateSoloInCache(persisted) : pushSoloToCache(persisted);
        invalidateSolosCache();
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
        navigated = true;
        navigate('/solos');
      } else {
        // A solo is NOT a lick. A "lick" is a short phrase (a few bars); a full
        // chorus / solo must never be persisted to the lick store (it would
        // pollute the saved-licks modal, where a long Giant Steps solo matches
        // every ii-V-I via the sliding-window matcher). Block it and tell the
        // user to use Solo mode instead.
        const LICK_MAX_BARS = 8;
        if (allMeasures.length > LICK_MAX_BARS) {
          setSaveError(`${allMeasures.length}마디는 릭이 아니라 솔로입니다 — Solo 모드로 저장하세요.`);
          setTimeout(() => setSaveError(null), 4000);
          return; // `finally` restores the saving flag
        }
        // Lick mode — save via the lick API.
        const totalN = allMeasures.reduce((s, m) => s + m.notes.filter((n) => !n.duration.endsWith('r')).length, 0);
        const entry: LickEntry = {
          id: Date.now(),
          performer: composer || 'Unknown',
          title: sheetTitle || 'Untitled',
          instrument: '',
          album: '',
          style: genre || '',
          tempo: bpm,
          key: sheetKey,
          rhythmfeel: '',
          tag: 'custom',
          chords: allMeasures.map((m) => m.chord ?? ''),
          nEvents: totalN,
          label: `${composer || 'Unknown'} — ${sheetTitle || 'Untitled'} (${allMeasures.map((m) => m.chord || '').filter(Boolean).join(' → ')})`,
          sheetData: {
            title: `${composer || 'Unknown'} — ${sheetTitle || 'Untitled'}`,
            composer,
            key: sheetKey,
            timeSignature: '4/4',
            tempo: bpm,
            measures: allMeasures,
          },
          ...computeLickFeatures(allMeasures),
        };
        const { createLick, updateLick } = await import('../api/licks');
        const { invalidateLicksCache } = await import('../data/lickData');
        const persisted = editingLickId
          ? await updateLick(editingLickId, entry)
          : await createLick(entry);
        invalidateLicksCache();
        saveUserLick(persisted);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
        navigated = true;
        navigate('/licks');
      }
    } catch (err) {
      console.error(`${mode} save failed`, err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      // Leave the overlay up if we're navigating; only restore on failure.
      if (!navigated) setSaving(false);
    }
  }, [mode, allMeasures, sheetTitle, composer, genre, sheetKey, bpm, saving, editingLickId, navigate]);

  const handleCopy = useCallback(() => {
    if (!jsonOutput) return;
    navigator.clipboard.writeText(jsonOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [jsonOutput]);

  /* Shift every pitched note in the score by `delta` octaves. Rests are left
   * alone. Vex keys look like "c#/4" — we only touch the octave number after
   * the slash. Pushes onto the undo stack so Backspace can revert it. */
  const handleShiftOctave = useCallback((delta: number) => {
    pushEditUndo();
    const shift = (notes: NoteInfo[]): NoteInfo[] =>
      notes.map((n) => {
        if (n.duration.endsWith('r')) return n;
        return {
          ...n,
          keys: n.keys.map((k) => {
            const slash = k.lastIndexOf('/');
            if (slash < 0) return k;
            const note = k.slice(0, slash);
            const oct = parseInt(k.slice(slash + 1), 10);
            if (Number.isNaN(oct)) return k;
            return `${note}/${oct + delta}`;
          }),
        };
      });
    setMeasures((prev) => prev.map((m) => ({ ...m, notes: shift(m.notes) })));
    setCurNotes((prev) => shift(prev));
  }, [pushEditUndo]);

  return (
    <Page>
      {countIn.overlay}
      <IconSidebar />
      <PageBody>
      <Header>
        <BackBtn onClick={() => navigate('/')}>&#8592; Home</BackBtn>
        <Title>Editor</Title>
        <Sep />
        <MetaLabel>Mode</MetaLabel>
        <KeySelect
          value={mode}
          onChange={(e) => setMode(e.target.value as 'solo' | 'lick')}
          style={{ minWidth: 80, fontWeight: 700 }}
          disabled={editingLickId !== null /* lick edit forces lick mode */}
        >
          <option value="solo">Solo</option>
          <option value="lick">Lick</option>
        </KeySelect>
        <Sep />
        <MetaLabel>Title</MetaLabel>
        <MetaInput value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} placeholder={mode === 'solo' ? 'e.g. Autumn Leaves' : 'e.g. ii-V Lick #3'} style={{ width: 160 }} />
        <MetaLabel>{mode === 'solo' ? 'Composer' : 'Performer'}</MetaLabel>
        <MetaInput value={composer} onChange={(e) => setComposer(e.target.value)} placeholder={mode === 'solo' ? 'e.g. Joseph Kosma' : 'e.g. Charlie Parker'} style={{ width: 160 }} />
        <MetaLabel>{mode === 'solo' ? 'Genre' : 'Style'}</MetaLabel>
        <MetaInput value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={mode === 'solo' ? 'e.g. Bossa Nova' : 'e.g. Bebop'} style={{ width: 130 }} />
        <MetaLabel>Key</MetaLabel>
        <KeySelect value={sheetKey} onChange={(e) => setSheetKey(e.target.value)}>
          <optgroup label="Major">
            {['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </optgroup>
          <optgroup label="Minor">
            {['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </optgroup>
        </KeySelect>
        <JsonBtn
          $bg="#546e7a"
          $hover="#455a64"
          onClick={() => handleShiftOctave(-1)}
          disabled={totalNotes === 0}
          title="모든 음표 옥타브 -1"
        >
          Oct −1
        </JsonBtn>
        <JsonBtn
          $bg="#546e7a"
          $hover="#455a64"
          onClick={() => handleShiftOctave(1)}
          disabled={totalNotes === 0}
          title="모든 음표 옥타브 +1"
        >
          Oct +1
        </JsonBtn>
        <Spacer />
        <JsonBtn $bg="#26a69a" $hover="#00897b" onClick={handleCopy} disabled={totalNotes === 0}>
          {copied ? '\u2713 Copied!' : 'Copy JSON'}
        </JsonBtn>
        <JsonBtn $bg="#7b1fa2" $hover="#6a1b9a" onClick={() => { setShowLoadModal(true); setLoadJsonText(''); setLoadJsonError(''); }}>
          Load JSON
        </JsonBtn>
        {/* YouTube Onset button removed from Editor toolbar */}
        <JsonBtn $bg="#ef6c00" $hover="#e65100" onClick={handleSave} disabled={totalNotes === 0 || saving}>
          {saving ? '\u2026 \uc800\uc7a5 \uc911' : saveError ? '\u26a0 Save failed' : 'Save Solo'}
        </JsonBtn>
      </Header>

      <ToolBar>
        <SectionLabel>Duration</SectionLabel>
        {DUR_KEYS.map((d) => (
          <DurCol key={d.value}>
            <DurBtn $active={duration === d.value} onClick={() => { setDuration(d.value); setDotted(false); }} title={d.title}>
              <NoteIcon type={d.value} width={50} height={50} />
            </DurBtn>
            <RestBtn onClick={() => handleRest(d.value)} title={`${d.title} rest`}>
              <RestIcon type={d.value} width={50} height={50} />
            </RestBtn>
          </DurCol>
        ))}
        <DurBtn $active={dotted} onClick={() => setDotted((v) => !v)} title="Dotted" style={{ fontSize: '1.6rem', fontWeight: 900 }}>.</DurBtn>
        <DurBtn $active={accMode === 'b'} onClick={() => setAccMode('b')} title="Flat mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>&#9837;</DurBtn>
        <DurBtn $active={accMode === '#'} onClick={() => setAccMode('#')} title="Sharp mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>&#9839;</DurBtn>
        <DurBtn $active={accMode === 'n'} onClick={() => setAccMode((v) => v === 'n' ? 'b' : 'n')} title="Natural mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>&#9838;</DurBtn>

        <Sep />
        <DurBtn $active={tieNext} onClick={() => setTieNext((v) => !v)} title="Tie to next note (L)" style={{ fontSize: '1.3rem' }}>
          <svg width="22" height="16" viewBox="0 0 18 14" style={{ display: 'block' }}>
            <path d="M2 4 Q9 14 16 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </DurBtn>
        <DurBtn
          $active={tripletMode}
          onClick={() => setTripletMode((v) => { if (!v) tripletCountRef.current = 0; return !v; })}
          title="Triplet mode (T)"
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
        <BarlineBtn onClick={closeMeasure} disabled={curNotes.length === 0} title="Close measure (Enter)">|</BarlineBtn>
        <DurBtn
          $active={repeatStart}
          onClick={() => { pushEditUndo(); setRepeatStart((v) => !v); }}
          title="Repeat start"
        >
          <svg width="16" height="22" viewBox="0 0 16 22"><line x1="2" y1="1" x2="2" y2="21" stroke="currentColor" strokeWidth="2.5"/><line x1="5.5" y1="1" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/><circle cx="10" cy="14" r="1.7" fill="currentColor"/></svg>
        </DurBtn>
        <DurBtn
          $active={repeatEnd}
          onClick={() => { pushEditUndo(); setRepeatEnd((v) => !v); }}
          title="Repeat end"
        >
          <svg width="16" height="22" viewBox="0 0 16 22"><circle cx="6" cy="8" r="1.7" fill="currentColor"/><circle cx="6" cy="14" r="1.7" fill="currentColor"/><line x1="10.5" y1="1" x2="10.5" y2="21" stroke="currentColor" strokeWidth="1"/><line x1="14" y1="1" x2="14" y2="21" stroke="currentColor" strokeWidth="2.5"/></svg>
        </DurBtn>
        <DurBtn
          $active={volta === 1}
          onClick={() => { pushEditUndo(); setVolta((v) => v === 1 ? 0 : 1); }}
          title="1st ending"
        >
          <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">1.</text></svg>
        </DurBtn>
        <DurBtn
          $active={volta === 2}
          onClick={() => { pushEditUndo(); setVolta((v) => v === 2 ? 0 : 2); }}
          title="2nd ending"
        >
          <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">2.</text></svg>
        </DurBtn>
        <DurBtn
          $active={navigation === 'segno'}
          onClick={() => { pushEditUndo(); setNavigation((v) => v === 'segno' ? '' : 'segno'); }}
          title="Segno"
          style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.5rem', lineHeight: 1 }}
        >
          {'\uE047'}
        </DurBtn>
        <DurBtn
          $active={navigation === 'coda'}
          onClick={() => { pushEditUndo(); setNavigation((v) => v === 'coda' ? '' : 'coda'); }}
          title="Coda"
          style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.5rem', lineHeight: 1 }}
        >
          {'\uE048'}
        </DurBtn>
        <DurBtn
          $active={navigation === 'fine'}
          onClick={() => { pushEditUndo(); setNavigation((v) => v === 'fine' ? '' : 'fine'); }}
          title="Fine"
          style={{ fontSize: '0.72rem', fontWeight: 700, fontStyle: 'italic' }}
        >
          Fine
        </DurBtn>
        <DurBtn
          $active={navigation === 'toCoda'}
          onClick={() => { pushEditUndo(); setNavigation((v) => v === 'toCoda' ? '' : 'toCoda'); }}
          title="To Coda"
          style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '0.85rem', lineHeight: 1 }}
        >
          <span style={{ fontFamily: "'Pretendard', sans-serif", fontSize: '0.7rem', fontWeight: 700, fontStyle: 'italic', marginRight: 1 }}>To</span>{'\uE048'}
        </DurBtn>
        <NavSelect
          value={navigation && ['dc', 'dcAlCoda', 'dcAlFine', 'ds', 'dsAlCoda', 'dsAlFine'].includes(navigation) ? navigation : ''}
          onChange={(e) => { pushEditUndo(); setNavigation(e.target.value as NavigationMarker | ''); }}
        >
          <option value="">D.C./D.S.</option>
          <option value="dc">D.C.</option>
          <option value="dcAlCoda">D.C. al Coda</option>
          <option value="dcAlFine">D.C. al Fine</option>
          <option value="ds">D.S.</option>
          <option value="dsAlCoda">D.S. al Coda</option>
          <option value="dsAlFine">D.S. al Fine</option>
        </NavSelect>
        <DurBtn $active={bracket} title="Intro bracket"
          onClick={() => { pushEditUndo(); setBracket((v) => !v); }}
          style={{ fontSize: '0.85rem', fontWeight: 300, fontFamily: 'serif' }}
        >(&thinsp;)</DurBtn>

        <Sep />

        <MeasureIndicator>Bar {measures.length + 1}</MeasureIndicator>
        <BeatIndicator $full={curBeats >= 4}>
          {curBeats}/{4} beats
        </BeatIndicator>

        <Spacer />

        <InfoText>
          {totalNotes} notes &middot; {allMeasures.length} bars
        </InfoText>
      </ToolBar>

      <UndoClearRow>
        <Btn onClick={handleUndo} title="Undo (Backspace)">Undo</Btn>
        <Btn onClick={handleClear}>Clear</Btn>
      </UndoClearRow>

      <PianoArea>
        <PianoKeyboard onNotePress={handleNotePress} mute />
      </PianoArea>
      <KeyHint>1=whole &middot; 2=half &middot; 4=quarter &middot; 8=8th &middot; 6=16th &middot; L=tie &middot; T=triplet &middot; Enter=close measure &middot; Backspace=undo</KeyHint>

      {selectedNote && selNoteInfo && (
        <NoteEditBar>
          <NoteEditLabel>
            Note: {selNoteInfo.keys[0]} ({selNoteInfo.duration.replace('r', ' rest')})
            {selNoteInfo.accidentals?.[0] === 'b' ? ' \u266D' : selNoteInfo.accidentals?.[0] === '#' ? ' \u266F' : selNoteInfo.accidentals?.[0] === 'n' ? ' \u266E' : ''}
          </NoteEditLabel>
          <Sep />

          <NoteEditBtn
            $active={selNoteInfo.accidentals?.[0] === 'b'}
            onClick={() => {
              updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.accidentals?.[0];
                if (cur === 'b') {
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

          {(() => {
            if (selNoteInfo.duration.endsWith('r')) return null;
            const flat: { mi: number; ni: number; note: NoteInfo }[] = [];
            for (let mi = 0; mi < allMeasures.length; mi++)
              for (let ni = 0; ni < allMeasures[mi].notes.length; ni++)
                flat.push({ mi, ni, note: allMeasures[mi].notes[ni] });
            const idx = flat.findIndex((f) => f.mi === selectedNote.mi && f.ni === selectedNote.ni);
            const next = flat[idx + 1];
            if (!next || next.note.duration.endsWith('r')) return null;
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

          {/* ── Measure-level: repeat / volta / navigation ── */}
          {selMeasure && selectedNote && selectedNote.mi < measures.length && (<>
            <NoteEditBtn
              $active={!!selMeasure.repeatStart}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, repeatStart: !m.repeatStart || undefined }))}
            >
              <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><line x1="2" y1="1" x2="2" y2="21" stroke="currentColor" strokeWidth="2.5"/><line x1="5.5" y1="1" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/><circle cx="10" cy="14" r="1.7" fill="currentColor"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={!!selMeasure.repeatEnd}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, repeatEnd: !m.repeatEnd || undefined }))}
            >
              <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><circle cx="6" cy="8" r="1.7" fill="currentColor"/><circle cx="6" cy="14" r="1.7" fill="currentColor"/><line x1="10.5" y1="1" x2="10.5" y2="21" stroke="currentColor" strokeWidth="1"/><line x1="14" y1="1" x2="14" y2="21" stroke="currentColor" strokeWidth="2.5"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.volta === 1}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, volta: m.volta === 1 ? undefined : 1 }))}
            >
              <svg width="18" height="14" viewBox="0 0 22 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">1.</text></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.volta === 2}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, volta: m.volta === 2 ? undefined : 2 }))}
            >
              <svg width="18" height="14" viewBox="0 0 22 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">2.</text></svg>
            </NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.navigation === 'segno'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'segno' ? undefined : 'segno' }))}
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.1rem' }}
            >{'\uE047'}</NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.navigation === 'coda'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'coda' ? undefined : 'coda' }))}
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.1rem' }}
            >{'\uE048'}</NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.navigation === 'fine'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'fine' ? undefined : 'fine' }))}
              style={{ fontSize: '0.65rem', fontWeight: 700, fontStyle: 'italic' }}
            >Fine</NoteEditBtn>
            <NoteEditBtn
              $active={selMeasure.navigation === 'toCoda'}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'toCoda' ? undefined : 'toCoda' }))}
              style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '0.75rem' }}
            ><span style={{ fontFamily: "'Pretendard', sans-serif", fontSize: '0.6rem', fontWeight: 700, fontStyle: 'italic', marginRight: 1 }}>To</span>{'\uE048'}</NoteEditBtn>
            <NavSelect
              value={selMeasure.navigation && ['dc', 'dcAlCoda', 'dcAlFine', 'ds', 'dsAlCoda', 'dsAlFine'].includes(selMeasure.navigation) ? selMeasure.navigation : ''}
              onChange={(e) => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: (e.target.value as NavigationMarker) || undefined }))}
              style={{ fontSize: '0.65rem' }}
            >
              <option value="">D.C./D.S.</option>
              <option value="dc">D.C.</option>
              <option value="dcAlCoda">D.C. al Coda</option>
              <option value="dcAlFine">D.C. al Fine</option>
              <option value="ds">D.S.</option>
              <option value="dsAlCoda">D.S. al Coda</option>
              <option value="dsAlFine">D.S. al Fine</option>
            </NavSelect>
            <NoteEditBtn
              $active={!!selMeasure.bracket}
              onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, bracket: !m.bracket || undefined }))}
              style={{ fontSize: '0.85rem', fontWeight: 300, fontFamily: 'serif' }}
            >(&thinsp;)</NoteEditBtn>
          </>)}

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
              title="Staccato (.)"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >·</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('accent')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('accent') ? cur.filter((a) => a !== 'accent') : [...cur, 'accent' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Accent (>)"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >&gt;</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('tenuto')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('tenuto') ? cur.filter((a) => a !== 'tenuto') : [...cur, 'tenuto' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Tenuto (—)"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >—</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.articulations?.includes('marcato')}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                const cur = n.articulations ?? [];
                const next = cur.includes('marcato') ? cur.filter((a) => a !== 'marcato') : [...cur, 'marcato' as const];
                return { ...n, articulations: next.length ? next : undefined };
              })}
              title="Marcato (^)"
              style={{ fontSize: '0.95rem', fontWeight: 700 }}
            >^</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.fermata}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, fermata: !n.fermata || undefined }))}
              title="Fermata (𝄐)"
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
            {/* ── Ornaments + slur + grace ── */}
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
              title="Slur start (이음줄 시작)"
              style={{ fontSize: '0.78rem' }}
            >⌒◜</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.slurStop}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, slurStop: !n.slurStop || undefined }))}
              title="Slur stop (이음줄 끝)"
              style={{ fontSize: '0.78rem' }}
            >◞⌒</NoteEditBtn>
            <NoteEditBtn
              $active={!!selNoteInfo.grace}
              onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, grace: !n.grace || undefined }))}
              title="Grace note (꾸밈음)"
              style={{ fontSize: '0.7rem', fontWeight: 700 }}
            >gr</NoteEditBtn>
          </>)}

          <Sep />
          {/* ── Note-level structural edits (post-input) ── */}
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
            title="Toggle 8va start on this note"
            style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontSize: '0.72rem' }}
          >8va◜</NoteEditBtn>
          <NoteEditBtn
            $active={!!selNoteInfo.ottavaEnd}
            onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, ottavaEnd: !n.ottavaEnd || undefined }))}
            title="Toggle 8va end on this note"
            style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontSize: '0.72rem' }}
          >◞8va</NoteEditBtn>

          {/* ── Measure-level structural edits: insert before/after, delete ── */}
          {selectedNote && selectedNote.mi < measures.length && (<>
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
                if (confirm(`Delete measure ${selectedNote.mi + 1}? This cannot be undone except by Undo (Backspace).`)) {
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
          <NoteEditBtn onClick={() => setSelectedNote(null)}>× Deselect</NoteEditBtn>
        </NoteEditBar>
      )}

      <SheetArea ref={sheetAreaRef}>
        {totalNotes === 0 && <EmptyHint>Type chord &rarr; play notes &rarr; Enter or | to close measure</EmptyHint>}
        <div style={{ position: 'relative' }} onClick={handleSheetClick}>
          <div ref={svgRef} />
          {measurePositions.map((pos) => {
            const chord = allMeasures[pos.idx]?.chord ?? '';
            const [c1, c2] = splitChords(chord);
            const halfW = pos.w * SHEET_SCALE / 2;
            const hasBracket = !!allMeasures[pos.idx]?.bracket;
            const hasVolta = !!allMeasures[pos.idx]?.volta;
            /* Place the first chord directly above the first NOTE of the
             * measure (lead-sheet convention). Fall back to the bar's note
             * area start when no notes exist yet. Volta/bracket marks above
             * the stave still need their own horizontal offset to clear. */
            const firstNote = notePositions
              .filter((np) => np.mi === pos.idx)
              .reduce<NotePos | null>((best, cur) => (best === null || cur.x < best.x ? cur : best), null);
            const baseLeft = firstNote ? firstNote.x - 4 : pos.chordX;
            const chordLeft = hasVolta ? baseLeft + 8 : hasBracket ? baseLeft + 12 : baseLeft;
            /* Lift chord above the stave with a comfortable gap so ledger
             * lines and high notes don't bleed into the chord label.
             * MARGIN.top reserves the page-top space for this. */
            const chordTop = hasVolta ? pos.y - 13 : hasBracket ? pos.y - 14 : pos.y - 20;
            /* Clamp chord widths to their half so they never overflow into
             * the next bar (or into the c2 slot). */
            const measureRightPx = (pos.x + pos.w) * SHEET_SCALE;
            const chordLeftPx = chordLeft * SHEET_SCALE;
            const c1MaxWidth = Math.max(28, halfW - 4);
            const c2MaxWidth = Math.max(28, measureRightPx - (chordLeftPx + halfW) - 2);
            return (
              <span key={pos.idx}>
                <ChordCell
                  value={c1}
                  onChange={(v) => updateMeasureChordSlot(pos.idx, 0, v)}
                  style={{ left: chordLeftPx, top: chordTop * SHEET_SCALE, maxWidth: c1MaxWidth, ...(c1 ? {} : { width: 36 }) }}
                />
                <ChordCell
                  value={c2}
                  onChange={(v) => updateMeasureChordSlot(pos.idx, 1, v)}
                  style={{ left: chordLeftPx + halfW, top: chordTop * SHEET_SCALE, maxWidth: c2MaxWidth, ...(c2 ? {} : { width: 36 }) }}
                />
              </span>
            );
          })}
          {notePositions.map((np) => {
            const note = allMeasures[np.mi]?.notes[np.ni];
            if (!note?.chord) return null;
            if (noteChordEditing && selectedNote && selectedNote.mi === np.mi && selectedNote.ni === np.ni) return null;
            const mpos = measurePositions.find((p) => p.idx === np.mi);
            const chordY = mpos ? mpos.y - 20 : np.y - 26;
            // Clamp width to next note position or measure end so per-note
            // chord labels never bleed into the next note or next bar.
            const nextInBar = notePositions
              .filter((p) => p.mi === np.mi && p.x > np.x)
              .reduce<NotePos | null>((best, cur) => (best === null || cur.x < best.x ? cur : best), null);
            const rightBoundary = nextInBar
              ? nextInBar.x - 2
              : (mpos ? mpos.x + mpos.w : np.x + 58);
            const maxW = Math.max(28, (rightBoundary - (np.x - 4)) * SHEET_SCALE);
            return (
              <ChordCell
                key={`nc-${np.mi}-${np.ni}`}
                value={note.chord}
                onChange={(v) => setChordAtNote(np.mi, np.ni, v)}
                style={{ left: (np.x - 4) * SHEET_SCALE, top: chordY * SHEET_SCALE, maxWidth: maxW }}
              />
            );
          })}
          {noteChordEditing && selectedNote && (() => {
            const np = notePositions.find((p) => p.mi === selectedNote.mi && p.ni === selectedNote.ni);
            if (!np) return null;
            const mpos = measurePositions.find((p) => p.idx === selectedNote.mi);
            const chordY = mpos ? mpos.y - 20 : np.y - 26;
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
                style={{ left: (np.x - 4) * SHEET_SCALE, top: chordY * SHEET_SCALE }}
              />
            );
          })()}
        </div>
      </SheetArea>

      {showLoadModal && (
        <ModalOverlay onClick={() => setShowLoadModal(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalTitle>Load JSON</ModalTitle>
            <ModalTextarea
              value={loadJsonText}
              onChange={(e) => { setLoadJsonText(e.target.value); setLoadJsonError(''); }}
              placeholder='Paste lead sheet JSON here...'
              autoFocus
            />
            {loadJsonError && <ModalError>{loadJsonError}</ModalError>}
            <ModalBtnRow>
              <Btn onClick={() => setShowLoadModal(false)}>Cancel</Btn>
              <SaveBtn $saved={false} onClick={handleLoadJson} disabled={!loadJsonText.trim()}>
                Load
              </SaveBtn>
            </ModalBtnRow>
          </ModalBox>
        </ModalOverlay>
      )}

      {saving && (
        <ModalOverlay>
          <SavingBox>
            <Spinner />
            <SavingText>저장하는 중입니다…</SavingText>
            <SavingSub>완료되면 자동으로 이동합니다.</SavingSub>
          </SavingBox>
        </ModalOverlay>
      )}

      {/* Floating player controls — bottom right */}
      <PlayerBar>
        <SectionLabel style={{ color: '#ccc', marginRight: 4 }}>BPM</SectionLabel>
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
          style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #555' }}
        />
        <PlayerIconBtn onClick={handlePlay} disabled={totalNotes === 0} title={playing ? 'Stop' : 'Play'}>
          {playing
            ? <svg width="20" height="20" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" fill="#fff"/></svg>
            : <svg width="20" height="20" viewBox="0 0 14 14"><polygon points="2,0 14,7 2,14" fill="#fff"/></svg>}
        </PlayerIconBtn>
        {playing && (
          <PlayerIconBtn onClick={handlePause} title={paused ? 'Resume' : 'Pause'}>
            {paused
              ? <svg width="20" height="20" viewBox="0 0 14 14"><polygon points="2,0 14,7 2,14" fill="#fff"/></svg>
              : <svg width="20" height="20" viewBox="0 0 14 14"><rect x="1" y="1" width="4" height="12" fill="#fff"/><rect x="9" y="1" width="4" height="12" fill="#fff"/></svg>}
          </PlayerIconBtn>
        )}
      </PlayerBar>
      </PageBody>
    </Page>
  );
}
