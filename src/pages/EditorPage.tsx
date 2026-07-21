import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { isComposingEvent } from '../lib/ime';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, StaveTie, Tuplet, Repetition,
  TextBracket, TextBracketPosition, Articulation, Annotation, AnnotationVerticalJustify,
  Ornament, Tremolo, Curve, StaveConnector,
} from 'vexflow';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import type { NoteInfo, MeasureInfo, NavigationMarker, NoteSheetData } from '../data/sampleMelody';

/* ─── helpers ──────────────────────────────────────────────────────────── */

import { useEditorBackingPlayback } from '../hooks/useEditorBackingPlayback';
import { GenreSelect, BpmControl, RepeatControl, TransportButtons, MixerButton } from '../components/backing/BackingPlayerBar';
import { DUR_BEATS, vexToMidi, getBeats } from '../lib/note/melodyTiming';
import { bakeExplicitAccidentals } from '../lib/note/resolvePitches';
import { resolveMeasureAccidental, type RenderAcc } from '../lib/note/measureAccidentals';
import { normalizeChord, formatChordDisplay } from '../lib/jazz-harmony';
import { createSolo, updateSolo } from '../api/solos';
import { buildUserSoloDraft, invalidateSolosCache, loadAllSolos, pushSoloToCache, updateSoloInCache } from '../data/soloData';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';
import { NoteIcon, RestIcon } from '../components/notesheet/NotationIcon';

const SHARP_TO_FLAT: Record<string, string> = { c: 'd', d: 'e', f: 'g', g: 'a', a: 'b' };

/* Autosave: 작성 중인 solo를 10초마다 localStorage에 저장. 새로고침/크래시 후
 * 마운트 시 자동 복구. handleSaveSolo 성공/handleClear에서 삭제.
 * 저장된 솔로 자체는 백엔드 (POST /v1/solos) 로 보낸다 — soloData.ts 참고. */
const DRAFT_KEY = 'leadSheetGenerator.draft.v1';


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


/* ─── 화음(chord) 쌓기 ─────────────────────────────────────────────────── */

const LETTER_ORDER: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

/** 보표상 위치 순서 (옥타브 → 글자). VexFlow 화음 keys는 낮은음부터. */
function diatonicRank(vexKey: string): number {
  const [np, oct] = vexKey.split('/');
  return (parseInt(oct, 10) || 0) * 7 + (LETTER_ORDER[np?.[0]?.toLowerCase() ?? 'c'] ?? 0);
}

/** 음표에 화음 톤 추가 — 같은 자리 음이면 제거(토글), 아니면 정렬 삽입.
 *  accidentals 는 keys 인덱스에 맞춰 재매핑한다. 쉼표에는 쌓지 않는다. */
function addKeyToNote(n: NoteInfo, vexKey: string, acc: NonNullable<NoteInfo['accidentals']>[number] | undefined): NoteInfo {
  if (n.duration.endsWith('r')) return n;
  const pairs = n.keys.map((k, i) => ({ k, a: n.accidentals?.[i] }));
  const existing = pairs.findIndex((p) => p.k === vexKey);
  if (existing >= 0) {
    if (pairs.length === 1) return n; // 마지막 남은 음은 제거하지 않음
    pairs.splice(existing, 1);
  } else {
    const rank = diatonicRank(vexKey);
    let at = pairs.findIndex((p) => diatonicRank(p.k) > rank);
    if (at < 0) at = pairs.length;
    pairs.splice(at, 0, { k: vexKey, a: acc });
  }
  const accOut: NonNullable<NoteInfo['accidentals']> = {};
  pairs.forEach((p, i) => { if (p.a) accOut[i] = p.a; });
  const next: NoteInfo = { ...n, keys: pairs.map((p) => p.k) };
  if (Object.keys(accOut).length) next.accidentals = accOut;
  else delete next.accidentals;
  return next;
}

function measureBeats(notes: NoteInfo[]): number {
  return notes.reduce((s, n) => s + getBeats(n.duration, n.dotted, n.tuplet, n.tupletNormal), 0);
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
    // Malformed external input (Load JSON paste / backend lick / stale draft)
    // can contain non-object entries — drop them instead of crashing later.
    if (!src || typeof src !== 'object') continue;
    const srcNotes = Array.isArray(src.notes) ? src.notes : [];
    if (srcNotes.length === 0) {
      // IMPORTANT: re-emit with notes normalized to an array. Pushing `src`
      // as-is let `{ chord: "C" }` (notes: undefined) flow into state, and the
      // render-path `m.notes.length` (outside any try) white-screened the page.
      // All load paths (Load JSON / editingLick / localStorage draft) funnel
      // through this helper, so this one guard covers them all.
      out.push({ ...src, notes: srcNotes });
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

/* ─── playback ───────────────────────────────────────────────────────── */

/* 재생은 useEditorBackingPlayback 훅에 위임 — GlobalPlayer(kind:'sheet')로
 * 멜로디 + 풀 백킹 밴드(베이스/드럼/피아노 1·3박 컴핑)를 함께 돌린다. */



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
/* 양손(그랜드 스태프): 트레블 stave 상단 → 베이스 stave 상단 오프셋과,
 * 줄당 추가 높이. 베이스 줄 아래에도 편집 바가 뜰 여백을 남긴다. */
const GRAND_BASS_DY = 100;
const GRAND_EXTRA = 115;
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

/** staff: 'bass' = 그랜드 스태프의 왼손(낮은음자리표) 행. 없으면 트레블. */
interface MeasurePos { idx: number; x: number; y: number; w: number; chordX: number; staff?: 'bass'; }
interface NotePos { mi: number; ni: number; x: number; y: number; w: number; h: number; staff?: 'bass'; }
type StaffId = 'treble' | 'bass';
interface NoteSel { mi: number; ni: number; staff?: StaffId; }

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

function packLines(measures: MeasureInfo[], availW: number, widths?: number[]): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;
  for (let i = 0; i < measures.length; i++) {
    const mw = widths?.[i] ?? measureWidth(measures[i]);
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

/** NoteInfo → VexFlow StaveNote — 트레블/베이스 공용. 임시표는 keys 인덱스
 *  전부에 옥타브 인식 규칙으로 붙인다(화음 지원). */
function buildVfNote(
  n: NoteInfo,
  clef: 'treble' | 'bass',
  activeAcc: Map<string, RenderAcc>,
  keySigAcc: Map<string, 'b' | '#'>,
): StaveNote {
  const isRest = n.duration.endsWith('r');
  const dur = buildDuration(n.duration, n.dotted);
  const restKey = clef === 'bass' ? 'd/3' : 'b/4';
  const note = new StaveNote({ keys: isRest ? [restKey] : n.keys, duration: dur, clef, autoStem: true });
  if (n.dotted) Dot.buildAndAttach([note]);

  if (!isRest) {
    // Octave-aware accidental rule — single shared helper, every chord tone.
    for (let ki = 0; ki < n.keys.length; ki++) {
      const realAcc = n.accidentals?.[ki] as RenderAcc | undefined;
      const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, n.keys[ki], realAcc);
      if (glyph) note.addModifier(new Accidental(glyph), ki);
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
}

/** 한 마디의 빔 그룹 계산 — 트레블/베이스 공용 (renderSheet 본문에서 추출). */
function buildBeams(msNotes: NoteInfo[], vfNotes: StaveNote[]): Beam[] {
  const beams: Beam[] = [];
  let beamGroup: StaveNote[] = [];
  let groupBeats = 0;
  let inTupletN = 0;
  let postTupletMerged = false;

  for (let ni = 0; ni < vfNotes.length; ni++) {
    const vn = vfNotes[ni];
    const tupletN = msNotes[ni].tuplet ?? 0;
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
      if (msNotes[ni].beamBreak) {
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

/** 투플렛 브래킷 렌더 — 트레블/베이스 공용 (renderSheet 본문에서 추출). */
function drawTupletBrackets(msNotes: NoteInfo[], vfNotes: StaveNote[], ctx: ReturnType<Renderer['getContext']>): void {
  let ti = 0;
  while (ti < msNotes.length) {
    const n = msNotes[ti].tuplet;
    if (n && n >= 3) {
      const group: StaveNote[] = [];
      while (ti < msNotes.length && msNotes[ti].tuplet === n && group.length < n) {
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

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number, currentIdx: number, positions: MeasurePos[], sheetKey?: string, notePositions?: NotePos[], selectedNote?: NoteSel | null, noteElMap?: Map<string, SVGElement>, bassMeasures?: MeasureInfo[] | null) {
  positions.length = 0;
  if (notePositions) notePositions.length = 0;
  if (noteElMap) noteElMap.clear();
  el.innerHTML = '';
  if (measures.length === 0) return;
  const grand = !!bassMeasures;
  const EMPTY_BASS: MeasureInfo = { notes: [] };
  const bassAt = (i: number): MeasureInfo => bassMeasures?.[i] ?? EMPTY_BASS;
  const lineH = grand ? LINE_HEIGHT + GRAND_EXTRA : LINE_HEIGHT;
  const innerW = width / SHEET_SCALE;
  const totalW = innerW - MARGIN.left - MARGIN.right;
  /* 양손이면 마디 폭은 두 보표 중 밀도가 높은 쪽 기준. */
  const widths = measures.map((m, i) => grand
    ? Math.max(measureWidth(m), measureWidth(bassAt(i)))
    : measureWidth(m));
  const lines = packLines(measures, totalW, widths);
  const totalH = MARGIN.top + lines.length * lineH + MARGIN.bottom;
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
  const allBassVfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
  let tieCarryAcc: Map<string, RenderAcc> | undefined;
  const keySigAcc = keySigAccidentals(sheetKey || 'C');

  for (let li = 0; li < lines.length; li++) {
    const indices = lines[li];
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;
    const y = MARGIN.top + li * lineH;
    const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
    const availForBars = totalW - decorW;

    /* Allocate each bar a width proportional to its intrinsic note density
     * (so a 16th-heavy bar gets more pixels than a half-note bar). The line
     * fully fills `availForBars` — except for the last line when it has
     * less content than the soft cap, in which case bars keep their
     * natural width (left-aligned) so a short final phrase doesn't
     * stretch out cartoonishly. */
    const intrinsics = indices.map((idx) => widths[idx]);
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
      const bassM = grand ? bassAt(m) : EMPTY_BASS;

      /* ── 양손: 트레블 아래 베이스 보표 + brace/barline 연결선 ── */
      let bassStave: Stave | null = null;
      if (grand) {
        bassStave = new Stave(x, y + GRAND_BASS_DY, w);
        if (firstInLine) {
          bassStave.addClef('bass');
          if (sheetKey && sheetKey !== 'C') bassStave.addKeySignature(sheetKey);
          if (isFirstLine) bassStave.addTimeSignature('4/4');
        }
        if (mData.repeatStart) bassStave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (mData.repeatEnd) bassStave.setEndBarType(BarlineType.REPEAT_END);
        else if (isLast) bassStave.setEndBarType(BarlineType.END);
        else bassStave.setEndBarType(BarlineType.SINGLE);
        bassStave.setContext(ctx).draw();
        if (firstInLine) {
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
        new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        positions.push({ idx: m, x: chordX, y: y + GRAND_BASS_DY, w: w - (firstInLine ? decorW : 0) - 4, chordX, staff: 'bass' });
      }

      if (measure.notes.length === 0 && bassM.notes.length === 0) {
        x += w;
        continue;
      }

      const activeAcc: Map<string, RenderAcc> = tieCarryAcc ? new Map(tieCarryAcc) : new Map();
      tieCarryAcc = undefined;

      const vfNotes = measure.notes.map((n) => buildVfNote(n, 'treble', activeAcc, keySigAcc));

      const lastNote = measure.notes[measure.notes.length - 1];
      if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
        const acc = lastNote.accidentals?.[0] as 'b' | '#' | undefined;
        if (acc) {
          tieCarryAcc = new Map([[lastNote.keys[0], acc]]);
        }
      }

      /* 보표별 voice 구성 — 양손이면 두 voice를 한 Formatter로 묶어 세로 정렬.
       * formatToStave 는 stave의 실제 note-area 경계(getNoteStartX/EndX)를
       * 존중한다 — naïve format(voices, width)은 마지막 음표 머리/기가 barline
       * 을 넘을 수 있다. */
      const voices: Voice[] = [];
      let voice: Voice | null = null;
      if (vfNotes.length > 0) {
        voice = new Voice({ numBeats: 4, beatValue: 4 });
        voice.setStrict(false);
        voice.addTickables(vfNotes);
        voices.push(voice);
      }
      let bassVfNotes: StaveNote[] = [];
      let bassVoice: Voice | null = null;
      if (grand && bassM.notes.length > 0 && bassStave) {
        const bassActive: Map<string, RenderAcc> = new Map();
        bassVfNotes = bassM.notes.map((n) => buildVfNote(n, 'bass', bassActive, keySigAcc));
        bassVoice = new Voice({ numBeats: 4, beatValue: 4 });
        bassVoice.setStrict(false);
        bassVoice.addTickables(bassVfNotes);
        voices.push(bassVoice);
      }
      if (bassStave) {
        // 클레프/조표 폭이 달라도 두 보표의 음표 시작 x를 맞춘다.
        try { Stave.formatBegModifiers([stave, bassStave]); } catch { /* noop */ }
      }
      const fmt = new Formatter();
      voices.forEach((v) => fmt.joinVoices([v]));
      fmt.formatToStave(voices, stave);

      const beams = voice ? buildBeams(measure.notes, vfNotes) : [];
      const bassBeams = bassVoice ? buildBeams(bassM.notes, bassVfNotes) : [];

      if (voice) voice.draw(ctx, stave);
      beams.forEach((bm) => bm.setContext(ctx).draw());
      if (bassVoice && bassStave) bassVoice.draw(ctx, bassStave);
      bassBeams.forEach((bm) => bm.setContext(ctx).draw());

      drawTupletBrackets(measure.notes, vfNotes, ctx);
      if (bassVfNotes.length) drawTupletBrackets(bassM.notes, bassVfNotes, ctx);

      for (let ni = 0; ni < vfNotes.length; ni++) {
        allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni] });
      }
      for (let ni = 0; ni < bassVfNotes.length; ni++) {
        allBassVfNotes.push({ mi: m, ni, vfNote: bassVfNotes[ni] });
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

  // Bass ties — 왼손 파트는 같은 줄 안의 단순 타이만 그린다.
  if (grand && allBassVfNotes.length) {
    const byPos = new Map<string, { vfNote: StaveNote; mi: number }>();
    allBassVfNotes.forEach((e) => byPos.set(`${e.mi}-${e.ni}`, { vfNote: e.vfNote, mi: e.mi }));
    for (let mi = 0; mi < measures.length; mi++) {
      const bm = bassAt(mi);
      for (let ni = 0; ni < bm.notes.length; ni++) {
        if (!bm.notes[ni].tie) continue;
        const from = byPos.get(`${mi}-${ni}`);
        const to = byPos.get(`${mi}-${ni + 1}`) ?? byPos.get(`${mi + 1}-0`);
        if (!from || !to) continue;
        if (measureLine.get(from.mi) !== measureLine.get(to.mi)) continue;
        try {
          new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
        } catch (e) { console.warn('bass tie draw failed', e); }
      }
    }
  }

  // Collect note bounding boxes for click detection & highlight selected note
  if (svgEl) {
    for (const entry of allBassVfNotes) {
      const bb = entry.vfNote.getBoundingBox();
      if (bb && notePositions) {
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH(), staff: 'bass' });
      }
    }
    for (const entry of allVfNotes) {
      const bb = entry.vfNote.getBoundingBox();
      if (bb && notePositions) {
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH() });
      }
      if (noteElMap) {
        const svgNode = entry.vfNote.getSVGElement();
        if (svgNode) noteElMap.set(`${entry.mi}-${entry.ni}`, svgNode as SVGElement);
      }
      if (selectedNote && selectedNote.staff !== 'bass' && entry.mi === selectedNote.mi && entry.ni === selectedNote.ni) {
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
    // 베이스 보표 선택 음표 하이라이트 (트레블과 동일 규칙)
    if (selectedNote?.staff === 'bass') {
      const entry = allBassVfNotes.find((e) => e.mi === selectedNote.mi && e.ni === selectedNote.ni);
      if (entry) {
        const RED = '#d32f2f';
        const applyRed = (elm: Element) => {
          const s = (elm as SVGElement).style;
          s.fill = RED; s.stroke = RED;
          elm.querySelectorAll('*').forEach((c) => {
            const cs = (c as SVGElement).style;
            cs.fill = RED; cs.stroke = RED;
          });
        };
        const noteSvg = entry.vfNote.getSVGElement();
        if (noteSvg) {
          applyRed(noteSvg);
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
  { value: '32', title: '32nd (1/8 beat)' },
];

/* ─── styled ───────────────────────────────────────────────────────────── */

/* 선택된 마디 외곽선 — 점선 골드 박스(악보를 가리지 않게 채움은 옅게). */
const MeasureSelOutline = styled.div`
  position: absolute;
  border: 2px dashed #b8860b;
  border-radius: 6px;
  background: rgba(184, 134, 11, 0.05);
  pointer-events: none;
  z-index: 3;
`;

/* 선택된 마디 바로 아래 뜨는 마디 편집 바 — 삽입/삭제. */
const MeasureEditBarBox = styled.div`
  position: absolute;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  font-family: 'Pretendard', sans-serif;

  .mlabel {
    font-size: 0.74rem;
    font-weight: 700;
    color: #8a6d1a;
    margin-right: 2px;
    white-space: nowrap;
  }
  button {
    font-family: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    padding: 3px 8px;
    border: 1px solid rgba(0, 0, 0, 0.14);
    border-radius: 5px;
    background: #fafafa;
    color: #333;
    cursor: pointer;
    white-space: nowrap;
    &:hover { border-color: #b8860b; background: #fff; }
    &.danger { color: #c0392b; }
    &.danger:hover { border-color: #c0392b; }
  }
`;

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

/* 상단 트랜스포트 바 — ChordPage의 전역 믹서 바와 동일한 레이아웃을 에디터에
 * 가져온다. Header 아래 한 줄로 배치하며, 드롭다운/팝오버가 악보 위로 뜨도록
 * z-index를 올린다. */
const TransportBar = styled.div`
  position: relative;
  z-index: 60;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding: 5px 10px;
  flex-shrink: 0;
  min-width: 0;
`;
const BarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;
const BarCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
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
    const t = remaining.match(/^([♭♯\u266D\u266F#b]*)(\d+|alt)/);
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
          onKeyDown={(e) => { if (e.key === 'Enter' && isComposingEvent(e)) return; // 한글 조합 확정 Enter 무시
                  if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onChange(normalizeChord(value)); setEditing(false); } }}
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
  /* 양손(그랜드 스태프) — 'single'(기본) | 'grand'. grand일 때 bassMeasures가
   * 왼손(낮은음자리표) 파트로 measures와 인덱스 1:1 정렬된다. single로 되돌려도
   * 데이터는 보존되고 렌더/저장에서만 제외된다. */
  const [staffMode, setStaffMode] = useState<'single' | 'grand'>('single');
  const [bassMeasures, setBassMeasures] = useState<MeasureInfo[]>([]);
  /* 화음 모드 — ON이면 피아노 입력이 새 음표 대신 마지막(또는 선택된) 음표에
   * 음을 쌓는다. */
  const [chordInput, setChordInput] = useState(false);
  /* 양손 모드에서 클릭으로 활성화된 베이스 마디 — 🎹 입력이 이 마디로 간다. */
  const [selectedBassMeasure, setSelectedBassMeasure] = useState<number | null>(null);
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
  const [repeatCount, setRepeatCount] = useState(3);
  const bpmManualRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const chord1Ref = useRef<HTMLInputElement>(null);

  const positionsRef = useRef<MeasurePos[]>([]);
  const [measurePositions, setMeasurePositions] = useState<MeasurePos[]>([]);
  const notePositionsRef = useRef<NotePos[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const [notePositions, setNotePositions] = useState<NotePos[]>([]);
  const [selectedNote, setSelectedNote] = useState<NoteSel | null>(null);
  /* 마디 단위 선택 — 음표가 없는(빈) 마디도 클릭으로 잡아서 삽입/삭제할 수
   * 있게 한다(OMR 교정 워크플로: 마디 사이 삽입·잘못 쪼개진 마디 삭제). */
  const [selectedMeasure, setSelectedMeasure] = useState<number | null>(null);
  /* 마디 내 삽입 모드 — 선택한 음표의 왼쪽/오른쪽에 새 음표를 끼워 넣는다.
   * ni = "이 인덱스 자리에 삽입"(기존 ni 앞). 입력할 때마다 ni+1로 전진해
   * 연속 입력이 자연스럽게 이어진다. 음표/마디 선택이 바뀌면 해제. */
  const [insertPos, setInsertPos] = useState<NoteSel | null>(null);
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
        // 솔로(OMR/MusicXML) 데이터는 score 임시표 의미론(조표+마디 상속) —
        // 에디터/에디터 재생은 explicit(필드=소리) 의미론이므로 로드 시점에
        // 명시 임시표로 구워 반음 어긋남을 차단한다. (릭·초안 로드는 이미
        // explicit 데이터라 굽지 않음.)
        const normalized = splitMeasuresByBeats(
          bakeExplicitAccidentals(prefillSheet.measures, prefillSheet.key), 4,
        );
        setMeasures(normalized);
        if (Array.isArray(prefillSheet.bassMeasures) && prefillSheet.bassMeasures.length > 0) {
          setBassMeasures(bakeExplicitAccidentals(prefillSheet.bassMeasures, prefillSheet.key));
          setStaffMode('grand');
        }
        setCurNotes([]);
        setCurChord1('');
        setCurChord2('');
        if (prefillSheet.title) setSheetTitle(prefillSheet.title);
        if (prefillSheet.composer) setComposer(prefillSheet.composer);
        if (prefillSheet.key) setSheetKey(prefillSheet.key);
        if (prefillSheet.tempo) {
          setBpm(prefillSheet.tempo);
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
        const lickBass = (sd as { bassMeasures?: MeasureInfo[] } | null)?.bassMeasures;
        if (Array.isArray(lickBass) && lickBass.length > 0) {
          setBassMeasures(lickBass);
          setStaffMode('grand');
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
      if (Array.isArray(d.bassMeasures) && d.bassMeasures.length > 0) setBassMeasures(d.bassMeasures);
      if (d.staffMode === 'grand') setStaffMode('grand');
      if (Array.isArray(d.curNotes)) setCurNotes(d.curNotes);
      if (typeof d.curChord1 === 'string') setCurChord1(d.curChord1);
      if (typeof d.curChord2 === 'string') setCurChord2(d.curChord2);
      if (typeof d.composer === 'string') setComposer(d.composer);
      if (typeof d.genre === 'string') setGenre(d.genre);
      if (typeof d.sheetTitle === 'string') setSheetTitle(d.sheetTitle);
      if (typeof d.sheetKey === 'string') setSheetKey(d.sheetKey);
      if (typeof d.bpm === 'number' && d.bpm >= 20 && d.bpm <= 400) {
        setBpm(d.bpm);
        bpmManualRef.current = true;
      }
    } catch (e) {
      console.warn('Failed to load lead-sheet draft', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Autosave draft every 10s — survives reload/crash ──────────────────
   * 최신 상태는 ref 미러로 읽고 interval은 마운트 시 1회만 건다. deps에 상태를
   * 전부 넣던 이전 구현은 키 입력마다 타이머가 0부터 리셋돼 "10초마다"가 아니라
   * "마지막 입력 후 10초 무입력"이어야 저장됐다 — 연속 입력 중 크래시하면
   * 드래프트가 한 번도 안 남았다. */
  const draftRef = useRef({ measures, bassMeasures, staffMode, curNotes, curChord1, curChord2, composer, genre, sheetTitle, sheetKey, bpm });
  draftRef.current = { measures, bassMeasures, staffMode, curNotes, curChord1, curChord2, composer, genre, sheetTitle, sheetKey, bpm };
  useEffect(() => {
    const intv = setInterval(() => {
      try {
        const d = draftRef.current;
        // 내용(마디/음표/코드) 기준으로만 '비었는지' 판정한다 — 메타데이터(제목·
        // 작곡가 등)만 남은 상태는 복원 가치가 없다. 비었으면 저장 대신 기존 draft를
        // 제거해 (1) Clear 후 메타데이터-only draft 재생성, (2) 빈 상태에서 옛 draft
        // 부활을 둘 다 막는다(Fable §4 471).
        const isEmpty =
          d.measures.length === 0 &&
          d.curNotes.length === 0 &&
          d.bassMeasures.every((m) => m.notes.length === 0) &&
          !d.curChord1 && !d.curChord2;
        if (isEmpty) { localStorage.removeItem(DRAFT_KEY); return; }
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch (e) {
        console.warn('Failed to autosave lead-sheet draft', e);
      }
    }, 10000);
    return () => clearInterval(intv);
  }, []);

  const editUndoStack = useRef<{ measures: MeasureInfo[]; bassMeasures: MeasureInfo[]; curNotes: NoteInfo[]; curChord1: string; curChord2: string; repeatStart: boolean; repeatEnd: boolean; volta: 0 | 1 | 2; navigation: NavigationMarker | ''; bracket: boolean }[]>([]);
  const pushEditUndo = useCallback(() => {
    editUndoStack.current.push({ measures: measures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })), bassMeasures: bassMeasures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })), curNotes: curNotes.map((n) => ({ ...n })), curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket });
    if (editUndoStack.current.length > 50) editUndoStack.current.shift();
  }, [measures, bassMeasures, curNotes, curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket]);

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

  /* 렌더/저장/재생용 베이스 파트 — 트레블(allMeasures) 길이에 맞춰 패딩. */
  const bassAll = useMemo<MeasureInfo[] | null>(() => {
    if (staffMode !== 'grand') return null;
    return allMeasures.map((_, i) => bassMeasures[i] ?? { notes: [] });
  }, [staffMode, allMeasures, bassMeasures]);

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

  const updateNote = useCallback((mi: number, ni: number, updater: (n: NoteInfo) => NoteInfo, staff?: StaffId) => {
    pushEditUndo();
    if (staff === 'bass') {
      setBassMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? updater(n) : n) } : m));
    } else if (mi < measures.length) {
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
    // 베이스 파트도 같은 자리에 빈 마디를 넣어 1:1 정렬 유지.
    setBassMeasures((prev) => {
      if (prev.length === 0 || mi >= prev.length) return prev;
      const next = [...prev];
      next.splice(Math.max(0, mi), 0, { notes: [] });
      return next;
    });
    setSelectedNote(null);
    setSelectedBassMeasure(null);
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
    setBassMeasures((prev) => {
      if (prev.length === 0 || mi + 1 >= prev.length) return prev;
      const next = [...prev];
      next.splice(mi + 1, 0, { notes: [] });
      return next;
    });
    setSelectedNote(null);
    setSelectedBassMeasure(null);
  }, [pushEditUndo]);

  /** Remove the measure at `mi`. Selection is cleared if it pointed at the
   *  removed bar (or anything past it). */
  const deleteMeasure = useCallback((mi: number) => {
    pushEditUndo();
    setMeasures((prev) => prev.filter((_, i) => i !== mi));
    setBassMeasures((prev) => (mi < prev.length ? prev.filter((_, i) => i !== mi) : prev));
    setSelectedNote(null);
    setSelectedBassMeasure(null);
  }, [pushEditUndo]);

  /* Tie toggling is already wired into the existing note edit panel via
   * updateNote(...) — see the 'Tie' button row in the selected-note UI. */

  /** 마디 내 임의 위치에 음표/쉼표 삽입 (committed·열린 마디·베이스 모두). */
  const insertNoteAt = useCallback((mi: number, ni: number, note: NoteInfo, staff?: StaffId) => {
    pushEditUndo();
    if (staff === 'bass') {
      setBassMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        const notes = [...m.notes];
        notes.splice(Math.max(0, Math.min(ni, notes.length)), 0, note);
        return { ...m, notes };
      }));
    } else if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        const notes = [...m.notes];
        notes.splice(Math.max(0, Math.min(ni, notes.length)), 0, note);
        return { ...m, notes };
      }));
    } else {
      setCurNotes((prev) => {
        const notes = [...prev];
        notes.splice(Math.max(0, Math.min(ni, notes.length)), 0, note);
        return notes;
      });
    }
  }, [measures.length, pushEditUndo]);

  /** 이 음표 "오른쪽"의 같은 마디 내용 전부 삭제 (ni 이후만, 마디 한정). */
  const deleteNotesAfter = useCallback((mi: number, ni: number) => {
    pushEditUndo();
    if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => (
        i === mi ? { ...m, notes: m.notes.slice(0, ni + 1) } : m
      )));
    } else {
      setCurNotes((prev) => prev.slice(0, ni + 1));
    }
  }, [measures.length, pushEditUndo]);

  /** Delete a single note at (mi, ni). */
  const deleteNote = useCallback((mi: number, ni: number, staff?: StaffId) => {
    pushEditUndo();
    if (staff === 'bass') {
      setBassMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        return { ...m, notes: m.notes.filter((_, j) => j !== ni) };
      }));
    } else if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        return { ...m, notes: m.notes.filter((_, j) => j !== ni) };
      }));
    } else {
      setCurNotes((prev) => prev.filter((_, j) => j !== ni));
    }
    setSelectedNote(null);
  }, [measures.length, pushEditUndo]);

  /** 선택된 음표를 보표 한 칸(다음/이전 글자)씩 올리거나 내린다.
   *  다이어토닉 스텝이므로 임시표는 지우고 순수 글자 피치로 이동 —
   *  필요한 b/#는 이동 후 임시표 버튼으로 다시 붙인다. */
  const stepSelectedNote = useCallback((dir: 1 | -1) => {
    if (!selectedNote) return;
    const srcM = selectedNote.staff === 'bass' ? bassMeasures[selectedNote.mi] : allMeasures[selectedNote.mi];
    const cur = srcM?.notes[selectedNote.ni];
    if (!cur || cur.duration.endsWith('r')) return;
    const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
    const stepKey = (k: string): string | null => {
      const [notePart, octStr] = k.split('/');
      const letter = notePart[0].toLowerCase();
      let idx = LETTERS.indexOf(letter);
      if (idx < 0) return null;
      let oct = parseInt(octStr, 10);
      idx += dir;
      if (idx > 6) { idx = 0; oct += 1; }
      else if (idx < 0) { idx = 6; oct -= 1; }
      if (oct < 1 || oct > 7) return null; // 가청·표기 범위 밖 이동 방지
      return `${LETTERS[idx]}/${oct}`;
    };
    // 화음이면 모든 키를 같이 한 칸 이동 — 하나라도 범위를 벗어나면 취소.
    const newKeys = cur.keys.map(stepKey);
    if (newKeys.some((k) => k === null)) return;
    updateNote(selectedNote.mi, selectedNote.ni, (n) => {
      const updated = { ...n, keys: newKeys as string[] };
      delete updated.accidentals;
      return updated;
    }, selectedNote.staff);
    playMidi(vexToMidi(newKeys[0] as string));
  }, [selectedNote, allMeasures, bassMeasures, updateNote]);

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

    // 삽입 모드 — 지정 위치에 끼워 넣고 삽입점을 한 칸 전진(연속 입력).
    if (insertPos) {
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode) ni.tuplet = 3;
      insertNoteAt(insertPos.mi, insertPos.ni, ni, insertPos.staff);
      setInsertPos({ ...insertPos, ni: insertPos.ni + 1 });
      if (tripletMode) {
        tripletCountRef.current += 1;
        if (tripletCountRef.current >= 3) {
          setTripletMode(false);
          tripletCountRef.current = 0;
        }
      }
      return;
    }

    // 화음 톤으로 쓸 임시표 글리프 (b/#/n — respell 시 생략).
    const chordAcc = respelled ? undefined : accMode === 'n' ? ('n' as const) : conv.acc;

    // If a note is selected: 화음 모드면 그 음표에 음을 쌓고, 아니면 음정 교체.
    if (selectedNote) {
      if (chordInput) {
        updateNote(selectedNote.mi, selectedNote.ni, (n) => addKeyToNote(n, conv.vexKey, chordAcc), selectedNote.staff);
        return;
      }
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
      }, selectedNote.staff);
      return;
    }

    // 화음 모드(선택 없음) — 현재 입력 대상의 마지막 음표에 쌓는다.
    // 쌓을 음표가 없으면 아래 기본 흐름으로 떨어져 새 음표를 만든다.
    if (chordInput) {
      const stackLast = (notes: NoteInfo[]): NoteInfo[] =>
        notes.map((n, i) => (i === notes.length - 1 ? addKeyToNote(n, conv.vexKey, chordAcc) : n));
      if (staffMode === 'grand' && selectedBassMeasure != null) {
        if ((bassMeasures[selectedBassMeasure]?.notes.length ?? 0) > 0) {
          pushEditUndo();
          setBassMeasures((prev) => prev.map((m, i) => (i === selectedBassMeasure ? { ...m, notes: stackLast(m.notes) } : m)));
          return;
        }
      } else if (selectedMeasure != null && selectedMeasure < measures.length) {
        if ((measures[selectedMeasure]?.notes.length ?? 0) > 0) {
          pushEditUndo();
          setMeasures((prev) => prev.map((m, i) => (i === selectedMeasure ? { ...m, notes: stackLast(m.notes) } : m)));
          return;
        }
      } else if (curNotes.length > 0) {
        pushEditUndo();
        setCurNotes((prev) => stackLast(prev));
        return;
      }
    }

    // 양손: 활성화된 베이스 마디로 입력 (트레블 기본 — 베이스는 마디 클릭 후).
    if (staffMode === 'grand' && selectedBassMeasure != null) {
      pushEditUndo();
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode) ni.tuplet = 3;
      setBassMeasures((prev) => {
        const next = [...prev];
        while (next.length <= selectedBassMeasure) next.push({ notes: [] });
        next[selectedBassMeasure] = { ...next[selectedBassMeasure], notes: [...next[selectedBassMeasure].notes, ni] };
        return next;
      });
      if (tripletMode) {
        tripletCountRef.current += 1;
        if (tripletCountRef.current >= 3) {
          setTripletMode(false);
          tripletCountRef.current = 0;
        }
      }
      return;
    }

    // 마디가 선택돼 있으면 그 마디의 끝에 음표를 추가 — 중간에 삽입한 빈
    // 마디를 피아노로 바로 채우는 OMR 교정 플로우. (열린 입력 마디가 아니라
    // 선택된 committed 마디로 들어간다.)
    if (selectedMeasure != null && selectedMeasure < measures.length) {
      pushEditUndo();
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode) ni.tuplet = 3;
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== selectedMeasure) return m;
        const notes = [...m.notes];
        if (tieNext && notes.length > 0) {
          notes[notes.length - 1] = { ...notes[notes.length - 1], tie: true };
        }
        notes.push(ni);
        return { ...m, notes };
      }));
      if (tieNext) setTieNext(false);
      if (tripletMode) {
        tripletCountRef.current += 1;
        if (tripletCountRef.current >= 3) {
          setTripletMode(false);
          tripletCountRef.current = 0;
        }
      }
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
            // Empty last measure (insert-measure / all notes deleted): there's
            // no note to tie FROM — skip instead of writing to lastNotes[-1]
            // (which silently polluted the array with a "-1" key and dropped
            // the tie). Same guard handleOttavaToggle already has.
            if (lastNotes.length === 0) return prev;
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
  }, [duration, dotted, accMode, tieNext, tripletMode, curNotes, measures, maybeAutoClose, pushEditUndo, selectedNote, selectedMeasure, insertPos, insertNoteAt, updateNote, chordInput, staffMode, selectedBassMeasure, bassMeasures]);

  const handleRest = useCallback((dur?: string) => {
    const d = dur ?? duration;
    const ni: NoteInfo = { keys: ['b/4'], duration: d + 'r', dotted: dotted || undefined };
    if (tripletMode) ni.tuplet = 3;
    // 삽입 모드 — 쉼표도 지정 위치에 끼워 넣는다 (insertNoteAt이 undo 푸시).
    if (insertPos) {
      insertNoteAt(insertPos.mi, insertPos.ni, ni, insertPos.staff);
      setInsertPos({ ...insertPos, ni: insertPos.ni + 1 });
      if (tripletMode) {
        tripletCountRef.current += 1;
        if (tripletCountRef.current >= 3) {
          setTripletMode(false);
          tripletCountRef.current = 0;
        }
      }
      return;
    }
    pushEditUndo();
    // 선택된 마디가 있으면 쉼표도 그 마디로 (피아노 입력과 동일 규칙).
    if (staffMode === 'grand' && selectedBassMeasure != null) {
      setBassMeasures((prev) => {
        const next = [...prev];
        while (next.length <= selectedBassMeasure) next.push({ notes: [] });
        next[selectedBassMeasure] = { ...next[selectedBassMeasure], notes: [...next[selectedBassMeasure].notes, ni] };
        return next;
      });
    } else if (selectedMeasure != null && selectedMeasure < measures.length) {
      setMeasures((prev) => prev.map((m, i) => (
        i === selectedMeasure ? { ...m, notes: [...m.notes, ni] } : m
      )));
    } else {
      const newNotes = [...curNotes, ni];
      setCurNotes(newNotes);
      maybeAutoClose(newNotes);
    }
    if (tripletMode) {
      tripletCountRef.current += 1;
      if (tripletCountRef.current >= 3) {
        setTripletMode(false);
        tripletCountRef.current = 0;
      }
    }
  }, [duration, dotted, tripletMode, curNotes, measures.length, maybeAutoClose, pushEditUndo, selectedMeasure, insertPos, insertNoteAt, staffMode, selectedBassMeasure]);

  const handleUndo = useCallback(() => {
    if (editUndoStack.current.length > 0) {
      const snap = editUndoStack.current.pop()!;
      setMeasures(snap.measures);
      setBassMeasures(snap.bassMeasures ?? []);
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
    setBassMeasures([]);
    setCurNotes([]);
    setCurChord1('');
    setCurChord2('');
    setSelectedBassMeasure(null);
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
      // 양손 파트 — bassMeasures가 있으면 양손 모드로 복원. (마디 분할은 치지
      // 않는다 — 트레블과 인덱스 1:1 정렬이 깨지므로 그대로 싣는다.)
      if (Array.isArray(data.bassMeasures) && data.bassMeasures.length > 0) {
        setBassMeasures(data.bassMeasures as MeasureInfo[]);
        setStaffMode('grand');
      } else {
        setBassMeasures([]);
        setStaffMode('single');
      }
      setSelectedBassMeasure(null);
      setCurNotes([]);
      setCurChord1('');
      setCurChord2('');
      if (data.title) setSheetTitle(data.title);
      if (data.composer) setComposer(data.composer);
      if (data.genre) setGenre(data.genre);
      if (data.key) setSheetKey(data.key);
      if (data.tempo) { setBpm(data.tempo); bpmManualRef.current = true; }
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
      if (e.key === 'Enter') { if (isComposingEvent(e)) return; e.preventDefault(); closeMeasure(); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setTieNext((v) => !v); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setTripletMode((v) => { if (!v) tripletCountRef.current = 0; return !v; }); }
      if (e.key === '1') { e.preventDefault(); setDuration('w'); setDotted(false); }
      if (e.key === '2') { e.preventDefault(); setDuration('h'); setDotted(false); }
      if (e.key === '4') { e.preventDefault(); setDuration('q'); setDotted(false); }
      if (e.key === '8') { e.preventDefault(); setDuration('8'); setDotted(false); }
      if (e.key === '6') { e.preventDefault(); setDuration('16'); setDotted(false); }
      if (e.key === '3') { e.preventDefault(); setDuration('32'); setDotted(false); }

      if (e.key === 'Escape') { setInsertPos(null); setSelectedNote(null); setSelectedMeasure(null); setSelectedBassMeasure(null); }

      // 선택 음표 피치 스텝 — ↑/↓ 로 보표 한 칸씩 (마우스로 고른 뒤 미세 조정).
      if (selectedNote && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        stepSelectedNote(e.key === 'ArrowUp' ? 1 : -1);
        return;
      }

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
  }, [handleUndo, closeMeasure, allMeasures, selectedNote, stepSelectedNote]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (allMeasures.length === 0) { el.innerHTML = ''; positionsRef.current = []; setMeasurePositions([]); notePositionsRef.current = []; return; }
    const validKey = sheetKey && (FLAT_KEYS[sheetKey] != null || SHARP_KEYS[sheetKey] != null || sheetKey === 'C') ? sheetKey : undefined;
    try {
      renderSheet(el, allMeasures, Math.max(sheetWidth, 300), currentIdx, positionsRef.current, validKey, notePositionsRef.current, selectedNote, noteElMapRef.current, bassAll);
    } catch {
      positionsRef.current.length = 0;
      notePositionsRef.current.length = 0;
      setSelectedNote(null);
    }
    setMeasurePositions([...positionsRef.current]);
    setNotePositions([...notePositionsRef.current]);
  }, [allMeasures, bassAll, sheetWidth, currentIdx, sheetKey, selectedNote]);

  const selNoteInfo = useMemo<NoteInfo | null>(() => {
    if (!selectedNote) return null;
    const m = selectedNote.staff === 'bass' ? bassMeasures[selectedNote.mi] : allMeasures[selectedNote.mi];
    if (!m) return null;
    return m.notes[selectedNote.ni] ?? null;
  }, [selectedNote, allMeasures, bassMeasures]);

  useEffect(() => {
    if (!selectedNote) return;
    const m = selectedNote.staff === 'bass' ? bassMeasures[selectedNote.mi] : allMeasures[selectedNote.mi];
    if (!m?.notes[selectedNote.ni]) {
      setSelectedNote(null);
    }
  }, [allMeasures, bassMeasures, selectedNote]);

  const handleSheetClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setInsertPos(null); // 악보 클릭 = 삽입 모드 종료 (새 선택으로 전환)
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
      const staff = best.staff;
      if (selectedNote && selectedNote.mi === best.mi && selectedNote.ni === best.ni && selectedNote.staff === staff) {
        setSelectedNote(null);
      } else {
        setSelectedNote({ mi: best.mi, ni: best.ni, ...(staff ? { staff } : {}) });
      }
      setSelectedMeasure(null);
      setSelectedBassMeasure(null);
      return;
    }
    setSelectedNote(null);
    // 음표 근처가 아니면 마디 히트테스트 — 빈 마디도 선택 가능. 트레블은
    // committed 만(입력 중인 열린 마디는 기존 입력 플로우가 담당), 베이스는
    // 렌더된 모든 마디(열린 마디 아래 포함).
    const grand = staffMode === 'grand';
    let bestM: { idx: number; staff?: 'bass' } | null = null;
    let bestMDist = Infinity;
    for (const p of positionsRef.current) {
      if (p.staff !== 'bass' && p.idx >= measures.length) continue;
      if (cx < p.x - 6 || cx > p.x + p.w + 6) continue;
      // 양손이면 각 보표 행의 실제 stave 중심 근처로만 판정(행 겹침 방지).
      const centerY = grand ? p.y + 52 : p.y + LINE_HEIGHT / 2;
      const range = grand ? 55 : LINE_HEIGHT / 2;
      const dy = Math.abs(cy - centerY);
      if (dy < range && dy < bestMDist) { bestMDist = dy; bestM = { idx: p.idx, staff: p.staff }; }
    }
    if (bestM === null) {
      setSelectedMeasure(null);
      setSelectedBassMeasure(null);
      return;
    }
    if (bestM.staff === 'bass') {
      setSelectedMeasure(null);
      const idx = bestM.idx;
      setSelectedBassMeasure((prev) => (prev === idx ? null : idx));
    } else {
      setSelectedBassMeasure(null);
      const idx = bestM.idx;
      setSelectedMeasure((prev) => (prev === idx ? null : idx));
    }
  }, [selectedNote, measures.length, staffMode]);

  // (moved before handleNotePress)

  const selMeasure = useMemo<MeasureInfo | null>(() => {
    if (!selectedNote) return null;
    return allMeasures[selectedNote.mi] ?? null;
  }, [selectedNote, allMeasures]);

  const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length
    + (staffMode === 'grand' ? bassMeasures.reduce((s, m) => s + m.notes.length, 0) : 0);

  /* 저장/복사/재생에 포함할 베이스 파트 — 양손 모드이고 내용이 있을 때만. */
  const bassForOut = useMemo<MeasureInfo[] | null>(() => {
    if (!bassAll) return null;
    return bassAll.some((m) => m.notes.length > 0) ? bassAll : null;
  }, [bassAll]);

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
      ...(bassForOut ? { bassMeasures: bassForOut } : {}),
    };
    return JSON.stringify(entry, null, 2);
  }, [allMeasures, bassForOut, sheetTitle, composer, genre, sheetKey, bpm]);

  /* 재생 — 입력한 멜로디를 풀 백킹 밴드(베이스/드럼/피아노 1·3박 컴핑)와 함께
   * GlobalPlayer(kind:'sheet')로 돌린다. 코드차트와 동일한 backing 엔진. */
  const buildSheet = useCallback((): NoteSheetData => ({
    title: sheetTitle || (mode === 'solo' ? 'Untitled Solo' : 'Untitled Lick'),
    composer: composer || 'Unknown',
    key: sheetKey,
    timeSignature: '4/4',
    tempo: bpm,
    ...(genre ? { genre } : {}),
    measures: allMeasures,
    ...(bassForOut ? { bassMeasures: bassForOut } : {}),
  }), [sheetTitle, composer, sheetKey, bpm, genre, allMeasures, bassForOut, mode]);

  /* 양손 재생 — 베이스 파트를 extraParts(멀티파트 병합 타임라인)로 함께 소리낸다. */
  const buildBassParts = useCallback((): NoteSheetData[] => {
    if (!bassForOut) return [];
    return [{
      title: 'Left Hand',
      composer: composer || 'Unknown',
      key: sheetKey,
      timeSignature: '4/4',
      tempo: bpm,
      measures: bassForOut,
    }];
  }, [bassForOut, composer, sheetKey, bpm]);

  const { playing, handlePlayPause, handleStop, countInOverlay } =
    useEditorBackingPlayback({ buildSheet, buildExtraParts: buildBassParts, bpm, repeatCount, noteElMapRef });

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
          bassMeasures: bassForOut ?? undefined,
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
            ...(bassForOut ? { bassMeasures: bassForOut } : {}),
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
  }, [mode, allMeasures, bassForOut, sheetTitle, composer, genre, sheetKey, bpm, saving, editingLickId, navigate]);

  const handleCopy = useCallback(() => {
    if (!jsonOutput) return;
    // Only flash "Copied!" when the write actually succeeded — clipboard can
    // reject (insecure context / permission denied), and we used to show
    // success unconditionally while leaving an unhandled rejection behind.
    navigator.clipboard.writeText(jsonOutput)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        setSaveError('클립보드 복사 실패 — 브라우저 권한을 확인하세요');
        setTimeout(() => setSaveError(null), 4000);
      });
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
    setBassMeasures((prev) => prev.map((m) => ({ ...m, notes: shift(m.notes) })));
    setCurNotes((prev) => shift(prev));
  }, [pushEditUndo]);

  return (
    <Page>
      {countInOverlay}
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
        <MetaLabel>보표</MetaLabel>
        <KeySelect
          value={staffMode}
          onChange={(e) => {
            const v = e.target.value as 'single' | 'grand';
            setStaffMode(v);
            if (v === 'single') { setSelectedBassMeasure(null); setSelectedNote((s) => (s?.staff === 'bass' ? null : s)); }
          }}
          style={{ minWidth: 96, fontWeight: 700 }}
          title="한손 = 높은음자리표 한 줄 · 양손 = 그랜드 스태프(위 트레블 / 아래 베이스)"
        >
          <option value="single">한손 악보</option>
          <option value="grand">양손 악보</option>
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
          {saving ? '\u2026 \uc800\uc7a5 \uc911' : saveError ? '\u26a0 Save failed' : (mode === 'solo' ? 'Save Solo' : 'Save Lick')}
        </JsonBtn>
      </Header>

      {/* 상단 트랜스포트 바 — 코드차트와 동일한 믹서/재생 컨트롤. 믹서 버튼은
          클릭 시 팝오버(좁은 화면은 모달)로 트랙들을 띄운다. */}
      <TransportBar>
        <BarLeft>
          <GenreSelect />
        </BarLeft>
        <BarCenter>
          <MixerButton />
          <BpmControl
            tempo={bpm}
            onTempoChange={(n) => { bpmManualRef.current = true; setBpm(n); }}
            disabled={totalNotes === 0}
          />
          <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} disabled={totalNotes === 0} />
          <TransportButtons
            playing={playing}
            onPlayPause={handlePlayPause}
            onStop={handleStop}
            /* 재생 중엔 항상 활성 — 재생 도중 음표를 전부 지웠을 때 정지 버튼까지
               죽어 오디오를 멈출 수 없게 되는 것을 방지. */
            disabled={totalNotes === 0 && !playing}
          />
        </BarCenter>
      </TransportBar>

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
          $active={chordInput}
          onClick={() => setChordInput((v) => !v)}
          title="화음 모드 — ON이면 피아노 입력이 마지막(또는 선택한) 음표에 음을 쌓습니다. 같은 음을 다시 누르면 제거."
          style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}
        >
          <svg width="18" height="22" viewBox="0 0 18 22" style={{ display: 'block' }}>
            <line x1="13.5" y1="2" x2="13.5" y2="17" stroke="currentColor" strokeWidth="1.6" />
            <ellipse cx="9.5" cy="17" rx="4.2" ry="3" fill="currentColor" />
            <ellipse cx="9.5" cy="11" rx="4.2" ry="3" fill="currentColor" />
            <ellipse cx="9.5" cy="5" rx="4.2" ry="3" fill="currentColor" />
          </svg>
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
      <KeyHint>1=whole &middot; 2=half &middot; 4=quarter &middot; 8=8th &middot; 6=16th &middot; 3=32nd &middot; L=tie &middot; T=triplet &middot; Enter=close measure &middot; Backspace=undo</KeyHint>

      {insertPos && (
        <NoteEditBar>
          <NoteEditLabel>
            ✏️ 삽입 모드 — {insertPos.staff === 'bass' ? '왼손 ' : ''}마디 {insertPos.mi + 1}, 위치 {insertPos.ni + 1} · 피아노/쉼표로 입력하면 여기에 끼워집니다
          </NoteEditLabel>
          <Sep />
          <NoteEditBtn onClick={() => setInsertPos(null)}>완료 (Esc)</NoteEditBtn>
        </NoteEditBar>
      )}

      {selectedNote && selectedNote.staff !== 'bass' && selNoteInfo && (
        <NoteEditBar>
          <NoteEditLabel>
            Note: {selNoteInfo.keys.join(' ')} ({selNoteInfo.duration.replace('r', ' rest')})
            {selNoteInfo.accidentals?.[0] === 'b' ? ' \u266D' : selNoteInfo.accidentals?.[0] === '#' ? ' \u266F' : selNoteInfo.accidentals?.[0] === 'n' ? ' \u266E' : ''}
          </NoteEditLabel>
          {!selNoteInfo.duration.endsWith('r') && (
            <>
              <NoteEditBtn title="\uD55C \uCE78 \uC62C\uB9AC\uAE30 (\u2191)" onClick={() => stepSelectedNote(1)}>\u25B2</NoteEditBtn>
              <NoteEditBtn title="\uD55C \uCE78 \uB0B4\uB9AC\uAE30 (\u2193)" onClick={() => stepSelectedNote(-1)}>\u25BC</NoteEditBtn>
            </>
          )}
          <Sep />
          {/* \uB9C8\uB514 \uB0B4 \uD3B8\uC9D1: \uC774 \uC74C\uD45C \uC88C/\uC6B0\uC5D0 \uB07C\uC6CC\uB123\uAE30 \u00B7 \uC0AD\uC81C \u00B7 \uC624\uB978\uCABD \uC804\uBD80 \uC0AD\uC81C */}
          <NoteEditBtn
            title="\uC774 \uC74C\uD45C \uC67C\uCABD\uC5D0 \uC0BD\uC785 \u2014 \uD53C\uC544\uB178/\uC27C\uD45C\uB85C \uC785\uB825"
            onClick={() => {
              setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni });
              setSelectedNote(null);
            }}
          >\u25C0 \uC67C\uCABD \uC0BD\uC785</NoteEditBtn>
          <NoteEditBtn
            title="\uC774 \uC74C\uD45C \uC624\uB978\uCABD\uC5D0 \uC0BD\uC785 \u2014 \uD53C\uC544\uB178/\uC27C\uD45C\uB85C \uC785\uB825"
            onClick={() => {
              setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni + 1 });
              setSelectedNote(null);
            }}
          >\uC624\uB978\uCABD \uC0BD\uC785 \u25B6</NoteEditBtn>
          <NoteEditBtn
            title="\uC774 \uC74C\uD45C/\uC27C\uD45C \uC0AD\uC81C"
            onClick={() => deleteNote(selectedNote.mi, selectedNote.ni)}
          >\uD83D\uDDD1 \uC0AD\uC81C</NoteEditBtn>
          <NoteEditBtn
            title="\uAC19\uC740 \uB9C8\uB514\uC5D0\uC11C \uC774 \uC74C\uD45C \uC624\uB978\uCABD \uB0B4\uC6A9 \uC804\uBD80 \uC0AD\uC81C"
            onClick={() => {
              const total = allMeasures[selectedNote.mi]?.notes.length ?? 0;
              const after = total - selectedNote.ni - 1;
              if (after <= 0) return;
              if (!window.confirm(`\uC774 \uC74C\uD45C \uC624\uB978\uCABD\uC758 ${after}\uAC1C(\uAC19\uC740 \uB9C8\uB514)\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`)) return;
              deleteNotesAfter(selectedNote.mi, selectedNote.ni);
            }}
          >\u2192\uB05D \uC0AD\uC81C</NoteEditBtn>
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

      {/* ── 왼손(베이스 보표) 음표 편집 바 — 추가·수정·삭제 핵심 기능 ── */}
      {selectedNote && selectedNote.staff === 'bass' && selNoteInfo && (
        <NoteEditBar>
          <NoteEditLabel>
            🎼 왼손 Note: {selNoteInfo.keys.join(' ')} ({selNoteInfo.duration.replace('r', ' rest')})
            {selNoteInfo.accidentals?.[0] === 'b' ? ' ♭' : selNoteInfo.accidentals?.[0] === '#' ? ' ♯' : selNoteInfo.accidentals?.[0] === 'n' ? ' ♮' : ''}
          </NoteEditLabel>
          {!selNoteInfo.duration.endsWith('r') && (
            <>
              <NoteEditBtn title="한 칸 올리기 (↑)" onClick={() => stepSelectedNote(1)}>▲</NoteEditBtn>
              <NoteEditBtn title="한 칸 내리기 (↓)" onClick={() => stepSelectedNote(-1)}>▼</NoteEditBtn>
            </>
          )}
          <Sep />
          <NoteEditBtn
            title="이 음표 왼쪽에 삽입 — 피아노/쉼표로 입력"
            onClick={() => {
              setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni, staff: 'bass' });
              setSelectedNote(null);
            }}
          >◀ 왼쪽 삽입</NoteEditBtn>
          <NoteEditBtn
            title="이 음표 오른쪽에 삽입 — 피아노/쉼표로 입력"
            onClick={() => {
              setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni + 1, staff: 'bass' });
              setSelectedNote(null);
            }}
          >오른쪽 삽입 ▶</NoteEditBtn>
          <Sep />
          {!selNoteInfo.duration.endsWith('r') && (['b', '#', 'n'] as const).map((g) => (
            <NoteEditBtn
              key={g}
              $active={selNoteInfo.accidentals?.[0] === g}
              onClick={() => {
                updateNote(selectedNote.mi, selectedNote.ni, (n) => {
                  const cur = n.accidentals?.[0];
                  if (cur === g) {
                    const { ...rest } = n;
                    delete rest.accidentals;
                    return rest;
                  }
                  return { ...n, accidentals: { 0: g } };
                }, 'bass');
              }}
            ><span style={{ fontFamily: 'serif' }}>{g === 'b' ? '♭' : g === '#' ? '♯' : '♮'}</span></NoteEditBtn>
          ))}
          <Sep />
          <NoteEditBtn
            onClick={() => deleteNote(selectedNote.mi, selectedNote.ni, 'bass')}
            style={{ color: '#c0392b' }}
          >🗑 삭제</NoteEditBtn>
          <NoteEditBtn onClick={() => setSelectedNote(null)}>× Deselect</NoteEditBtn>
        </NoteEditBar>
      )}

      <SheetArea ref={sheetAreaRef}>
        {totalNotes === 0 && <EmptyHint>Type chord &rarr; play notes &rarr; Enter or | to close measure</EmptyHint>}
        <div style={{ position: 'relative' }} onClick={handleSheetClick}>
          <div ref={svgRef} />
          {measurePositions.map((pos) => {
            if (pos.staff === 'bass') return null; // 코드는 트레블(오른손) 마디에만
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
              .filter((np) => np.mi === pos.idx && !np.staff)
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
          {selectedMeasure != null && (() => {
            const pos = measurePositions.find((p) => p.idx === selectedMeasure && !p.staff);
            if (!pos) return null;
            const noteCnt = measures[selectedMeasure]?.notes.length ?? 0;
            const grand = staffMode === 'grand';
            return (
              <span onClick={(e) => e.stopPropagation()}>
                <MeasureSelOutline
                  style={{
                    left: (pos.x - 3) * SHEET_SCALE,
                    top: (pos.y + 14) * SHEET_SCALE,
                    width: (pos.w + 6) * SHEET_SCALE,
                    height: ((grand ? 90 : LINE_HEIGHT - 28)) * SHEET_SCALE,
                  }}
                />
                <MeasureEditBarBox
                  style={{
                    left: Math.max(4, pos.x * SHEET_SCALE),
                    top: (pos.y + (grand ? LINE_HEIGHT + GRAND_EXTRA - 42 : LINE_HEIGHT - 12)) * SHEET_SCALE,
                  }}
                >
                  <span className="mlabel">마디 {selectedMeasure + 1} · 🎹 입력은 이 마디로</span>
                  <button
                    type="button"
                    title="이 마디 앞에 빈 마디 삽입"
                    onClick={() => {
                      insertMeasureBefore(selectedMeasure);
                      setSelectedMeasure(selectedMeasure + 1); // 선택은 원래 마디를 따라감
                    }}
                  >◀ 앞에 삽입</button>
                  <button
                    type="button"
                    title="이 마디 뒤에 빈 마디 삽입"
                    onClick={() => insertMeasureAfter(selectedMeasure)}
                  >뒤에 삽입 ▶</button>
                  <button
                    type="button"
                    className="danger"
                    title="이 마디 삭제"
                    onClick={() => {
                      if (noteCnt > 0 && !window.confirm(`마디 ${selectedMeasure + 1}(음표 ${noteCnt}개)를 삭제할까요?`)) return;
                      deleteMeasure(selectedMeasure);
                      setSelectedMeasure(null);
                    }}
                  >🗑 삭제</button>
                  <button type="button" onClick={() => setSelectedMeasure(null)}>닫기</button>
                </MeasureEditBarBox>
              </span>
            );
          })()}
          {selectedBassMeasure != null && staffMode === 'grand' && (() => {
            const pos = measurePositions.find((p) => p.idx === selectedBassMeasure && p.staff === 'bass');
            if (!pos) return null;
            const noteCnt = bassMeasures[selectedBassMeasure]?.notes.length ?? 0;
            return (
              <span onClick={(e) => e.stopPropagation()}>
                <MeasureSelOutline
                  style={{
                    left: (pos.x - 3) * SHEET_SCALE,
                    top: (pos.y + 14) * SHEET_SCALE,
                    width: (pos.w + 6) * SHEET_SCALE,
                    height: 90 * SHEET_SCALE,
                  }}
                />
                <MeasureEditBarBox
                  style={{
                    left: Math.max(4, pos.x * SHEET_SCALE),
                    top: (pos.y + 104) * SHEET_SCALE,
                  }}
                >
                  <span className="mlabel">🎼 왼손 마디 {selectedBassMeasure + 1} · 🎹 입력은 이 마디로</span>
                  <button
                    type="button"
                    className="danger"
                    title="이 왼손 마디의 음표 전부 삭제"
                    onClick={() => {
                      if (noteCnt > 0 && !window.confirm(`왼손 마디 ${selectedBassMeasure + 1}(음표 ${noteCnt}개)를 비울까요?`)) return;
                      pushEditUndo();
                      setBassMeasures((prev) => prev.map((m, i) => (i === selectedBassMeasure ? { ...m, notes: [] } : m)));
                    }}
                  >🗑 비우기</button>
                  <button type="button" onClick={() => setSelectedBassMeasure(null)}>닫기</button>
                </MeasureEditBarBox>
              </span>
            );
          })()}
          {notePositions.map((np) => {
            if (np.staff === 'bass') return null; // 음표별 코드 라벨은 트레블만
            const note = allMeasures[np.mi]?.notes[np.ni];
            if (!note?.chord) return null;
            if (noteChordEditing && selectedNote && selectedNote.mi === np.mi && selectedNote.ni === np.ni) return null;
            const mpos = measurePositions.find((p) => p.idx === np.mi && !p.staff);
            const chordY = mpos ? mpos.y - 20 : np.y - 26;
            // Clamp width to next note position or measure end so per-note
            // chord labels never bleed into the next note or next bar.
            const nextInBar = notePositions
              .filter((p) => p.mi === np.mi && !p.staff && p.x > np.x)
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
            const np = notePositions.find((p) => p.mi === selectedNote.mi && p.ni === selectedNote.ni && !p.staff);
            if (!np) return null;
            const mpos = measurePositions.find((p) => p.idx === selectedNote.mi && !p.staff);
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
                  if (e.key === 'Enter' && isComposingEvent(e)) return; // 한글 조합 확정 Enter 무시
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

      </PageBody>
    </Page>
  );
}
