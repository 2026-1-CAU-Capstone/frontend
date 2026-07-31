import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { BackButton } from '../components/common/BackButton';
import { SessionPicker } from '../components/chord/SessionPicker';
import { isMinorKey } from '../components/leadsheet/LeadSheet';
import { transposeNoteSheet, respellNoteSheetKey, normalizeNoteKeyDisplay } from '../lib/note/transposeNoteSheet';
import { ghostHead } from '../lib/note/ghostNote';
import { isComposingEvent } from '../lib/ime';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, StaveTie, Tuplet, Repetition,
  TextBracket, TextBracketPosition, Articulation, Annotation, AnnotationVerticalJustify,
  Ornament, Tremolo, Curve, StaveConnector, GraceNote, GraceNoteGroup,
} from 'vexflow';
import { minWidthForNotes, barWidthFromMin, heuristicWidth, packLines } from '../lib/notesheet/sheetLayout';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import { useMidiInput, type MidiNoteEvent } from '../hooks/useMidiInput';
import { MidiSettingsBody } from '../components/notesheet/MidiSettingsPanel';
import { usePref } from '../lib/prefsStore';
import { editorExplicitAcc } from '../lib/pagePrefs';
import { openPerformanceSettings } from '../lib/settingsBus';
import type { NoteInfo, MeasureInfo, NavigationMarker, NoteSheetData } from '../data/sampleMelody';

/* ─── helpers ──────────────────────────────────────────────────────────── */

import { useEditorBackingPlayback } from '../hooks/useEditorBackingPlayback';
import { useDismissable } from '../hooks/useDismissable';
import { GenreSelect, BpmControl, RepeatControl, TransportButtons, MixerButton } from '../components/backing/BackingPlayerBar';
import { vexToMidi, noteMetricBeats } from '../lib/note/melodyTiming';
import { computeBeamBreaks } from '../lib/note/beamPolicy';
import { bottomNoteGlyphY } from '../lib/note/chordClearance';
import { bakeExplicitAccidentals, bakeForScoreReading } from '../lib/note/resolvePitches';
import { resolveMeasureAccidental, type RenderAcc } from '../lib/note/measureAccidentals';
import { drawScoopFall } from '../lib/note/scoopFall';
import { normalizeChord, formatChordDisplay, splitChordParts } from '../lib/jazz-harmony';
import { createSolo, updateSolo } from '../api/solos';
import { ContextMenu } from '../components/common/ContextMenu';
import { buildUserSoloDraft, invalidateSolosCache, loadAllSolos, pushSoloToCache, updateSoloInCache } from '../data/soloData';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';
import {
  createComping, updateComping,
  type CompingGenre,
} from '../data/compingData';
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

/** MIDI 음번호 → PianoNote(온스크린 피아노와 동일한 샤프-스펠 형태). 검은건반은
 *  아래 흰건반 글자 + acc:'#' 로 표기해 handleNotePress 의 accMode(b/#) 리스펠
 *  로직에 그대로 태운다. */
const MIDI_LETTER: Array<[string, boolean]> = [
  ['c', false], ['c', true], ['d', false], ['d', true], ['e', false], ['f', false],
  ['f', true], ['g', false], ['g', true], ['a', false], ['a', true], ['b', false],
];
function midiToPianoNote(midi: number): PianoNote {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const [letter, sharp] = MIDI_LETTER[pc];
  return sharp
    ? { vexKey: `${letter}/${oct}`, acc: '#', midi }
    : { vexKey: `${letter}/${oct}`, midi };
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
  return notes.reduce((s, n) => s + noteMetricBeats(n), 0);
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
      const b = noteMetricBeats(n);
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
/* 드래그로 음정 옮기기: 한 diatonic 스텝(오선 반칸) = 모델 5px, 화면은 ×스케일.
 * 노트헤드 간격과 1:1이라 음표가 커서를 따라온다. */
const DRAG_PX_PER_STEP = 5 * SHEET_SCALE;
const DIATONIC_LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
/* vex 키를 diatonic 스텝만큼 이동(오선 위/아래로 한 칸씩). 가청·표기 범위를
 * 벗어나면 null. 임시표는 호출부에서 제거한다(화살표 이동과 동일 규칙). */
function shiftDiatonicKey(k: string, steps: number): string | null {
  const [notePart, octStr] = k.split('/');
  const idx = DIATONIC_LETTERS.indexOf(notePart[0].toLowerCase());
  if (idx < 0) return null;
  const pos = idx + steps;
  const oct = parseInt(octStr, 10) + Math.floor(pos / 7);
  if (oct < 1 || oct > 7) return null;
  return `${DIATONIC_LETTERS[((pos % 7) + 7) % 7]}/${oct}`;
}
/* 양손(그랜드 스태프): 트레블 stave 상단 → 베이스 stave 상단 오프셋과,
 * 줄당 추가 높이. 베이스 줄 아래에도 편집 바가 뜰 여백을 남긴다. */
const GRAND_BASS_DY = 100;
/** 마디 클릭 판정에서 오선 5줄 바깥으로 허용하는 여유(px). 오선 바로 위는
 *  코드 심볼 자리라 넉넉히 잡으면 행끼리 겹친다 — 작게 유지할 것. */
const STAFF_HIT_PAD = 8;
const GRAND_EXTRA = 115;
/* MARGIN.top: chord 라벨(28px high) 이 stave 위에 충분한 여유를 두고 들어갈 공간. */
/* left 여백을 넉넉히 — 양손 중괄호(brace)가 뷰포트 끝에 붙지 않고, 브레이스와
 * 음자리표 사이에 실제 악보처럼 여유가 생긴다. */
const MARGIN = { top: 38, left: 30, right: 10, bottom: 10 };

/* ── 코드 입력칸 세로 위치 ────────────────────────────────────────────────
 * 예전엔 보표 원점에서 고정 오프셋(-20)만 썼다. 그래서 기둥이 위로 뻗은
 * 마디(8분음표 빔 등)에서는 빔이 코드칸을 그대로 뚫고 지나갔다.
 * 이제는 그 마디에서 실제로 가장 높이 올라간 요소의 Y를 받아, 필요하면
 * 코드칸을 그 위로 밀어 올린다. */
/** 코드 입력칸 높이(px) — ChordCellWrap 의 height 와 반드시 같은 값. */
const CHORD_CELL_H = 28;
/** 코드칸 아랫변과 음표(기둥·빔) 상단 사이 최소 여백 — 내부 좌표 단위. */
const CHORD_NOTE_GAP = 6;
/** SVG 위쪽으로 잘려나가지 않게 하는 하한. */
const CHORD_TOP_MIN = 2;

/**
 * 코드 입력칸의 윗변 Y(내부 좌표).
 *
 * @param y          Stave 원점 Y
 * @param contentTop 그 마디에서 가장 높이 올라간 요소의 Y. 음표가 없으면 Infinity.
 */
function chordRowTopY(
  y: number,
  opts: { volta?: boolean; bracket?: boolean },
  contentTop: number,
): number {
  const base = y + (opts.volta ? -13 : opts.bracket ? -14 : -20);
  const lifted = contentTop - CHORD_NOTE_GAP - CHORD_CELL_H / SHEET_SCALE;
  return Math.max(CHORD_TOP_MIN, Math.min(base, lifted));
}
/* 대체(리하모니제이션) 코드 슬롯 수 — 마디 위 괄호 안에 뜨는 입력 칸 개수. */
const ALT_SLOTS = 4;
/** Soft cap on bars per line. The actual line break is driven by each measure's
 *  real VexFlow width (measured via `minWidthForNotes`), so this only bites for
 *  very thin measures (lots of whole notes) that would otherwise fit a
 *  dozen-plus to a line and look like a crammed timeline. */
const MAX_PER_LINE = 8;
const DECOR_FIRST = 70;
const DECOR_OTHER = 35;

/** staff: 'bass' = 그랜드 스태프의 왼손(낮은음자리표) 행. 없으면 트레블. */
/** 마디 히트박스. `y`는 stave 원점(위쪽 여백 포함)이고, `staveTop`/`staveBot`은
 *  실제 오선 5줄의 최상단/최하단 Y다. 마디 클릭 판정은 반드시 후자를 쓴다 —
 *  stave 원점 위쪽 여백은 코드 심볼 자리라, 거기까지 판정에 넣으면 아래 행의
 *  코드를 만질 때 윗행 마디가 잡힌다. */
interface MeasurePos { idx: number; x: number; y: number; w: number; chordX: number; staveTop: number; staveBot: number; staff?: 'bass'; }
interface NotePos { mi: number; ni: number; x: number; y: number; w: number; h: number; staff?: 'bass'; }
type StaffId = 'treble' | 'bass';
interface NoteSel { mi: number; ni: number; staff?: StaffId; }

function buildDuration(dur: string, dotted?: boolean, doubleDotted?: boolean): string {
  // VexFlow 는 duration 문자열의 'd' 개수로 점 수를 읽는다('qdd' → 겹점).
  const dots = doubleDotted ? 'dd' : dotted ? 'd' : '';
  if (!dots) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + dots + 'r';
  return dur + dots;
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
  const dur = buildDuration(n.duration, n.dotted, n.doubleDotted);
  const restKey = clef === 'bass' ? 'd/3' : 'b/4';
  // 꾸밈음: 작은 GraceNote(슬래시=acciaccatura). voice의 tickable이 아니라
  // 다음 실음의 GraceNoteGroup 수식으로 붙는다(NoteSheet와 동일 규칙). 임시표는
  // 아래 공용 경로로 함께 처리한다.
  const note: StaveNote = n.grace
    ? new GraceNote({ keys: isRest ? [restKey] : n.keys, duration: dur, slash: n.graceSlash !== false, clef }) as unknown as StaveNote
    /* 고스트(데드) 노트는 X 노트헤드로 — VexFlow noteType 'x'. 쉼표엔 적용 안 함. */
    : new StaveNote({
        keys: isRest ? [restKey] : n.keys,
        duration: dur,
        clef,
        autoStem: true,
        ...ghostHead(n),
      });
  // 점 글리프는 modifier 로 붙인다(길이는 위 duration 문자열이 이미 반영).
  if (n.doubleDotted) { Dot.buildAndAttach([note]); Dot.buildAndAttach([note]); }
  else if (n.dotted) Dot.buildAndAttach([note]);

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

/** 한 마디의 빔 그룹 계산 — 트레블/베이스 공용 (renderSheet 본문에서 추출).
 *  직선 음의 분할 위치는 beamPolicy(절대 박 위치 조판 규칙)가 결정한다 —
 *  쉼표 뒤 오프비트 런은 박 단위로, 정박 8분 4개는 통짜로. */
function buildBeams(msNotes: NoteInfo[], vfNotes: StaveNote[]): Beam[] {
  const beams: Beam[] = [];
  const beamBreaks = computeBeamBreaks(msNotes, '4/4');
  let beamGroup: StaveNote[] = [];
  let inTupletN = 0;
  let postTupletMerged = false;

  for (let ni = 0; ni < vfNotes.length; ni++) {
    const vn = vfNotes[ni];
    const tupletN = msNotes[ni].tuplet ?? 0;
    const isTuplet = tupletN >= 3;
    const dur = vn.getDuration();
    const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
    const isRest = vn.isRest();

    if (postTupletMerged && beamGroup.length > 0) {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
      postTupletMerged = false;
    }

    if (tupletN !== inTupletN && beamGroup.length > 0) {
      const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
      if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
        postTupletMerged = true;
      } else {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
      }
    }
    inTupletN = tupletN;

    if (isBeamable && !isRest) {
      if (!isTuplet && !postTupletMerged && beamGroup.length > 0 && beamBreaks.has(ni)) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
      }
      beamGroup.push(vn);
      if (isTuplet && beamGroup.length === tupletN) {
        beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        postTupletMerged = false;
        continue;
      }
      if (msNotes[ni].beamBreak) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        postTupletMerged = false;
      }
    } else {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
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

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number, currentIdx: number, activeIdx: number, positions: MeasurePos[], sheetKey?: string, notePositions?: NotePos[], selectedNotes?: NoteSel[] | null, noteElMap?: Map<string, SVGElement>, bassMeasures?: MeasureInfo[] | null, explicitAcc?: boolean) {
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
  // 조표 무시(explicit): keySig를 비워 마디 안의 임시표만으로 표기·상속 판단.
  const keySigAcc = explicitAcc ? new Map<string, 'b' | '#'>() : keySigAccidentals(sheetKey || 'C');

  /* 마디 폭 사전 측정 — 자체 추정 테이블 대신 VexFlow에게 실제로 필요한 최소
   * 폭을 물어본다. 여기서 만드는 StaveNote는 측정 전용이고, 아래 렌더 루프는
   * 자기 것을 새로 만든다 — 같은 노트를 두 Voice에 넣으면 tickContext가
   * 덮어써지기 때문에 인스턴스를 분리한다.
   * 임시표 상태(tieCarry)는 렌더 루프와 똑같이 마디 순서대로 전파해야 측정폭이
   * 실제 렌더와 일치한다. packLines가 순서를 보존하므로 이 전제가 성립한다. */
  let probeCarry: Map<string, RenderAcc> | undefined;
  const widths = measures.map((m, i) => {
    const active: Map<string, RenderAcc> = probeCarry ? new Map(probeCarry) : new Map();
    probeCarry = undefined;
    const probe = m.notes.map((n) => buildVfNote(n, 'treble', active, keySigAcc));
    const last = m.notes[m.notes.length - 1];
    if (last?.tie && !last.duration.endsWith('r')) {
      const acc = last.accidentals?.[0] as 'b' | '#' | undefined;
      if (acc) probeCarry = new Map([[last.keys[0], acc]]);
    }
    let minW = minWidthForNotes(probe);
    let floor = heuristicWidth(m.notes);
    if (grand) {
      const bassActive: Map<string, RenderAcc> = new Map();
      const bassProbe = bassAt(i).notes.map((n) => buildVfNote(n, 'bass', bassActive, keySigAcc));
      minW = Math.max(minW, minWidthForNotes(bassProbe));
      floor = Math.max(floor, heuristicWidth(bassAt(i).notes));
    }
    return barWidthFromMin(minW, floor);
  });
  const lines = packLines(widths, totalW, {
    decorFirst: DECOR_FIRST, decorOther: DECOR_OTHER, maxPerLine: MAX_PER_LINE,
  });
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

  /* 줄별 마디번호 카운터 — 픽업(anacrusis) 마디는 세지 않는다. 각 줄의 첫
   * 마디 왼쪽에 현재 번호를 그린다(Solo DB / NoteSheet 와 동일 로직·디자인). */
  let mNum = 0;

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
        if (!explicitAcc && sheetKey && sheetKey !== 'C') stave.addKeySignature(sheetKey);
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

      // 줄별 마디번호: 픽업이 아니면 카운트 증가, 줄의 첫 마디면 왼쪽에 그린다.
      const isPickup = !!mData.anacrusis;
      if (!isPickup) mNum++;
      if (firstInLine && !isPickup && svgEl) {
        const num = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        num.setAttribute('x', String(x + 2));
        num.setAttribute('y', String(y + 30));
        num.setAttribute('font-family', "'Pretendard', sans-serif");
        num.setAttribute('font-size', '8');
        num.setAttribute('font-weight', '200');
        num.setAttribute('font-style', 'italic');
        num.setAttribute('fill', '#9aa0a6');
        num.textContent = String(mNum);
        svgEl.appendChild(num);
      }

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
      positions.push({
        idx: m, x: chordX, y, w: w - (firstInLine ? decorW : 0) - 4, chordX,
        staveTop: stave.getYForLine(0), staveBot: stave.getYForLine(4),
      });


      const measure = measures[m];
      const bassM = grand ? bassAt(m) : EMPTY_BASS;

      /* ── 양손: 트레블 아래 베이스 보표 + brace/barline 연결선 ── */
      let bassStave: Stave | null = null;
      if (grand) {
        bassStave = new Stave(x, y + GRAND_BASS_DY, w);
        if (firstInLine) {
          bassStave.addClef('bass');
          if (!explicitAcc && sheetKey && sheetKey !== 'C') bassStave.addKeySignature(sheetKey);
          if (isFirstLine) bassStave.addTimeSignature('4/4');
        }
        if (mData.repeatStart) bassStave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (mData.repeatEnd) bassStave.setEndBarType(BarlineType.REPEAT_END);
        else if (isLast) bassStave.setEndBarType(BarlineType.END);
        else bassStave.setEndBarType(BarlineType.SINGLE);
        bassStave.setContext(ctx).draw();
        if (firstInLine) {
          // 중괄호(brace)는 보표 왼쪽 끝보다 더 왼쪽에 그려진다. MARGIN.left 여백
          // 안에서 브레이스와 음자리표 사이에 실제 악보 같은 간격이 남도록, draw 로
          // 새로 추가된 SVG 노드만 살짝 왼쪽으로 옮겨 음자리표에서 떨어뜨린다.
          const before = svgEl ? svgEl.childNodes.length : 0;
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
          if (svgEl) {
            for (let k = before; k < svgEl.childNodes.length; k++) {
              const node = svgEl.childNodes[k];
              if (node.nodeType !== 1) continue;
              const eln = node as SVGElement;
              const prev = eln.getAttribute('transform') ?? '';
              eln.setAttribute('transform', `translate(-8,0) ${prev}`.trim());
            }
          }
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
        new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        positions.push({
          idx: m, x: chordX, y: y + GRAND_BASS_DY, w: w - (firstInLine ? decorW : 0) - 4, chordX,
          staveTop: bassStave.getYForLine(0), staveBot: bassStave.getYForLine(4),
          staff: 'bass',
        });
      }

      if (measure.notes.length === 0 && bassM.notes.length === 0) {
        x += w;
        continue;
      }

      const activeAcc: Map<string, RenderAcc> = tieCarryAcc ? new Map(tieCarryAcc) : new Map();
      tieCarryAcc = undefined;

      // vfNotes는 measure.notes와 1:1 유지(ties/gliss/ottava/slur/positions
      // 인덱싱 보존). 단, 꾸밈음은 GraceNote라 voice의 tickable이 아니므로
      // 아래에서 다음 실음에 GraceNoteGroup으로 붙이고 voice엔 실음만 넣는다.
      const vfNotes = measure.notes.map((n) => buildVfNote(n, 'treble', activeAcc, keySigAcc));
      // 꾸밈음을 다음 실음에 부착 (연속 꾸밈음은 한 그룹으로 묶는다).
      {
        let pending: GraceNote[] = [];
        let lastRealVf: StaveNote | null = null;
        for (let ni = 0; ni < measure.notes.length; ni++) {
          if (measure.notes[ni].grace) {
            pending.push(vfNotes[ni] as unknown as GraceNote);
          } else if (pending.length > 0) {
            try {
              (vfNotes[ni] as StaveNote).addModifier(new GraceNoteGroup(pending, false), 0);
            } catch (e) { console.warn('grace group failed', e); }
            pending = [];
            lastRealVf = vfNotes[ni];
          } else {
            lastRealVf = vfNotes[ni];
          }
        }
        // 안전망: 뒤에 실음이 없는 꾸밈음(끝에 남은 경우)은 붙을 곳이 없어
        // VexFlow가 안 그린다. 직전 실음에라도 붙여 최소한 보이게 한다.
        // (정상 입력 플로우는 아래 handleNotePress에서 꾸밈음을 항상 대상 실음
        //  '앞'에 삽입하므로 이 경우는 거의 생기지 않는다.)
        if (pending.length > 0 && lastRealVf) {
          try { lastRealVf.addModifier(new GraceNoteGroup(pending, false), 0); }
          catch (e) { console.warn('trailing grace attach failed', e); }
        }
      }
      const realVfNotes = vfNotes.filter((_, ni) => !measure.notes[ni].grace);
      const realNotes = measure.notes.filter((n) => !n.grace);

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
      if (realVfNotes.length > 0) {
        voice = new Voice({ numBeats: 4, beatValue: 4 });
        voice.setStrict(false);
        voice.addTickables(realVfNotes); // 꾸밈음 제외 — 그룹 수식으로만 그려짐
        voices.push(voice);
      }
      let bassVfNotes: StaveNote[] = [];  // 실음만(꾸밈음 제외)
      let realBassNotes: NoteInfo[] = [];
      let bassVoice: Voice | null = null;
      if (grand && bassM.notes.length > 0 && bassStave) {
        const bassActive: Map<string, RenderAcc> = new Map();
        const bassAll = bassM.notes.map((n) => buildVfNote(n, 'bass', bassActive, keySigAcc));
        let pending: GraceNote[] = [];
        for (let ni = 0; ni < bassM.notes.length; ni++) {
          if (bassM.notes[ni].grace) pending.push(bassAll[ni] as unknown as GraceNote);
          else if (pending.length > 0) {
            try { (bassAll[ni] as StaveNote).addModifier(new GraceNoteGroup(pending, false), 0); } catch { /* noop */ }
            pending = [];
          }
        }
        bassVfNotes = bassAll.filter((_, ni) => !bassM.notes[ni].grace);
        realBassNotes = bassM.notes.filter((n) => !n.grace);
        if (bassVfNotes.length > 0) {
          bassVoice = new Voice({ numBeats: 4, beatValue: 4 });
          bassVoice.setStrict(false);
          bassVoice.addTickables(bassVfNotes);
          voices.push(bassVoice);
        }
      }
      if (bassStave) {
        // 클레프/조표 폭이 달라도 두 보표의 음표 시작 x를 맞춘다.
        try { Stave.formatBegModifiers([stave, bassStave]); } catch { /* noop */ }
      }
      // 실음 voice가 하나도 없으면(예: 마디에 꾸밈음만 있는 입력 중간 상태)
      // 포매터가 빈 voice에서 크래시한다 → 포맷/드로우를 건너뛴다. 붙을 곳
      // 없는 꾸밈음은 그려지지 않지만(정상 입력은 원음 앞에 삽입) 크래시는 없다.
      if (voices.length > 0) {
        const fmt = new Formatter();
        voices.forEach((v) => fmt.joinVoices([v]));
        fmt.formatToStave(voices, stave);
      }

      // 빔·투플렛은 실음(꾸밈음 제외)만 — 꾸밈음은 GraceNoteGroup 내부에서
      // 자체 빔이 그려진다. real 리스트끼리 1:1이라 인덱싱 안전.
      const beams = voice ? buildBeams(realNotes, realVfNotes) : [];
      const bassBeams = bassVoice ? buildBeams(realBassNotes, bassVfNotes) : [];

      if (voice) voice.draw(ctx, stave);
      beams.forEach((bm) => bm.setContext(ctx).draw());
      if (bassVoice && bassStave) bassVoice.draw(ctx, bassStave);
      bassBeams.forEach((bm) => bm.setContext(ctx).draw());

      drawTupletBrackets(realNotes, realVfNotes, ctx);
      if (bassVfNotes.length) drawTupletBrackets(realBassNotes, bassVfNotes, ctx);

      /* 이 마디에서 가장 높이 올라간 요소의 Y. bbox 는 기둥·빔까지 포함하므로
       * 음높이만 보는 것보다 정확하다 — voice.draw() 뒤라야 유효하다. */
      let contentTop = Infinity;
      for (const vn of vfNotes) {
        const bb = vn.getBoundingBox();
        if (bb) contentTop = Math.min(contentTop, bb.getY());
      }

      if (m === activeIdx) {
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          /* 편집 중 마디 하이라이트.
           *   위: 코드 입력 행의 윗변 (대체코드가 있으면 그 행까지)
           *   아래: 보표 마지막 줄. 단 음표가 그 아래로 내려가면(덧줄) 그
           *         음표 밑에 여백을 두고 거기까지.
           * ※ y(Stave 원점)에서 오프셋을 추정하면 안 된다 — 실제 오선은
           *   getYForLine() 이 정확하다(원점과 첫 줄 사이에 여백이 있다). */
          const mNotes = measures[m]?.notes ?? [];
          // 코드칸과 같은 계산 — 칸이 빔 위로 밀려 올라가면 하이라이트도 따라간다.
          const HL_TOP = chordRowTopY(y, { volta: !!mData.volta, bracket: !!mData.bracket }, contentTop)
            - (mData.altChords ? 17 : 0)
            - 4;                                       // 코드 입력 윗변 + 살짝

          const staffBot = stave.getYForLine(4);       // 오선 마지막 줄
          const NOTE_PAD = 8;                          // 오선 밖 음표 아래 여백
          /* 머리가 마지막 줄 아래로 조금이라도 나오면(맨 아랫줄에 걸친 음 포함)
           * 그만큼 더 내려간다. 오선 안에만 있으면 마지막 줄에서 끝. */
          const extend = (low: number | null, base: number) =>
            low !== null && low > base ? low + NOTE_PAD : base;
          const HL_BOT = grand
            // 양손: 아래 베이스 보표 기준(오선 높이를 GRAND_BASS_DY 만큼 내림)
            ? extend(
                bottomNoteGlyphY(bassAt(m).notes,
                  (line) => stave.getYForLine(line) + GRAND_BASS_DY, 'bass'),
                staffBot + GRAND_BASS_DY,
              )
            : extend(
                bottomNoteGlyphY(mNotes, (line) => stave.getYForLine(line)),
                staffBot,
              );
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(HL_TOP));
          rect.setAttribute('width', String(w));
          rect.setAttribute('height', String(HL_BOT - HL_TOP));
          rect.setAttribute('fill', 'rgba(184, 150, 10, 0.13)');
          rect.setAttribute('stroke', 'none');         // 테두리 없음 — 면만
          svgEl.insertBefore(rect, svgEl.firstChild);
        }
      }

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

  // Draw scoop / fall marks (재즈 슬라이드) on individual notes.
  if (svgEl) {
    let sfIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        const n = measure.notes[ni];
        const entry = allVfNotes[sfIdx];
        if (entry && !n.duration.endsWith('r')) {
          if (n.scoop) drawScoopFall(svgEl, entry.vfNote, 'scoop');
          if (n.fall) drawScoopFall(svgEl, entry.vfNote, 'fall');
        }
        sfIdx++;
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
      if (selectedNotes?.some((s) => s.staff !== 'bass' && s.mi === entry.mi && s.ni === entry.ni)) {
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
    for (const sel of selectedNotes ?? []) {
      if (sel.staff !== 'bass') continue;
      const entry = allBassVfNotes.find((e) => e.mi === sel.mi && e.ni === sel.ni);
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


/* 점·겹점 — 문자 '.' 는 베이스라인에 붙어 버튼 아래쪽으로 쏠린다. 세로 정중앙에
 * 오도록 SVG 원으로 그린다. */
const DotGlyph = ({ n = 1 }: { n?: 1 | 2 }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" style={{ display: 'block' }} aria-hidden>
    {n === 1
      ? <circle cx="13" cy="13" r="3.1" fill="currentColor" />
      : <>
          <circle cx="8.4" cy="13" r="3.1" fill="currentColor" />
          <circle cx="17.6" cy="13" r="3.1" fill="currentColor" />
        </>}
  </svg>
);

/* 3연음 / 지속연음 — 숫자 아래에 빔으로 묶인 음표 3개(기둥 3개 + 머리).
 * 머리를 충분히 크게 그려 작은 버튼에서도 보이게 하고, 숫자는 빔에서 살짝 띄운다. */
const TupletGlyph = ({ plus }: { plus?: boolean }) => (
  <svg width="32" height="30" viewBox="0 0 32 30" style={{ display: 'block' }} aria-hidden>
    {/* 숫자 — 빔 위로 올림 */}
    <text x="16" y="8" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="currentColor"
      fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic">{plus ? '3+' : '3'}</text>
    {/* 빔 */}
    <rect x="5" y="12" width="22" height="2.6" fill="currentColor" />
    {/* 기둥 3개 + 각 기둥 아래의 음표 머리 */}
    {[5, 15, 25].map((x) => (
      <g key={x}>
        <rect x={x} y="12" width="2" height="9.5" fill="currentColor" />
        <ellipse cx={x - 1.6} cy="22.4" rx="3.6" ry="2.6" fill="currentColor"
          transform={`rotate(-18 ${x - 1.6} 22.4)`} />
      </g>
    ))}
  </svg>
);

const DUR_KEYS = [
  { value: 'w', title: 'Whole (4 beats)' },
  { value: 'h', title: 'Half (2 beats)' },
  { value: 'q', title: 'Quarter (1 beat)' },
  { value: '8', title: 'Eighth (1/2 beat)' },
  { value: '16', title: '16th (1/4 beat)' },
  { value: '32', title: '32nd (1/8 beat)' },
  { value: '64', title: '64th (1/16 beat)' },
];

/* ─── styled ───────────────────────────────────────────────────────────── */

/* 선택된 마디 외곽선 — 점선 골드 박스(악보를 가리지 않게 채움은 옅게). */
const MeasureSelOutline = styled.div`
  position: absolute;
  border: 2px dashed #b8860b;
  border-radius: 6px;
  /* 채움은 스테이브 하이라이트 rect(activeIdx)가 담당 — 여기선 점선 테두리만. */
  background: transparent;
  pointer-events: none;
  z-index: 3;
`;

/* 활성 마디 위 투명 hover 영역 — 여기 마우스가 오면 마디 드롭다운이 나타난다. */
const MeasureHoverZone = styled.div`
  position: absolute;
  z-index: 4;
  background: transparent;
`;

/* 선택한 '음표' 바로 아래 뜨는 작은 드롭다운 — 삭제·삽입처럼 위험하거나
 * 자주 쓰지 않는 동작을 상단 툴바에서 내려 음표 옆에 붙였다. */
const NoteActionPop = styled.div`
  position: absolute;
  z-index: 7;
  display: flex;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  white-space: nowrap;
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

/** GenreSelect 의 자유 장르 문자열 → 컴핑 DB 의 4개 장르 enum 매핑.
 *  컴핑 저장 시 장르를 이 하나의 드롭다운에서 일임하기 위한 변환. */
function genreToCompingGenre(g: string): CompingGenre {
  const s = g.toLowerCase();
  if (s.includes('blues')) return 'BLUES';
  if (/(bossa|samba|afro)/.test(s)) return 'BOSSA';
  if (s.includes('latin') || s.includes('cha-cha')) return 'LATIN';
  return 'SWING';
}

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px;  /* 가로 여백 16px — Solo DB 상단바 기준으로 통일 */
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  /* 페이지 최상단 바 — 전 페이지 공통으로 여기만 연한 회색. */
  background: ${({ theme }) => theme.colors.barTop};
`;

/* 이전 페이지로 돌아가는 정사각형 버튼 — 홈이 아니라 히스토리 뒤로(-1). */
const Title = styled.span`
  font-size: 1.15rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MetaInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 1rem;
  padding: 7px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.5; }
`;

const MetaLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

/** 보표가 불러온 악보 데이터로 확정돼 수동 변경이 잠긴 상태 표시. */
/* 정보 칩·드롭다운 표기 — 칩 title 과 세그먼트 버튼이 같은 문구를 쓴다. */
const MODE_LABEL: Record<'solo' | 'lick' | 'comping', string> = {
  solo: 'Solo', lick: 'Lick', comping: 'Comping',
};






/* 세그먼트 토글 — 선택지가 2~3개뿐이라 select 보다 한눈에 들어온다. */
/* 세그먼티드 컨트롤 — 비활성은 Genre·Key 와 같은 톤(흰 배경 + 회색 테두리),
 * 활성은 하늘색. 선택이 바뀌면 하늘색 알약이 스르륵 미끄러진다. */
const SEG_GAP = 6;

const SegGroup = styled.div<{ $n: number; $i: number }>`
  position: relative;
  display: grid;
  grid-template-columns: repeat(${({ $n }) => $n}, 1fr);
  gap: ${SEG_GAP}px;
`;

const SegThumb = styled.span<{ $n: number; $i: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc((100% - ${({ $n }) => ($n - 1) * SEG_GAP}px) / ${({ $n }) => $n});
  transform: translateX(calc((100% + ${SEG_GAP}px) * ${({ $i }) => $i}));
  border-radius: 7px;
  border: 1.5px solid #a8d4f2;
  background: linear-gradient(180deg, #eaf5fe 0%, #d9ecfb 100%);
  box-shadow: 0 1px 3px rgba(22, 111, 176, 0.22);
  pointer-events: none;
  /* 살짝 튕기며 멈추는 최신 이징 — 위치와 크기 변화 모두 부드럽게. */
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), width 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;

const SegBtn = styled.button<{ $on?: boolean }>`
  position: relative;
  z-index: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.84rem;
  font-weight: ${({ $on }) => ($on ? 700 : 600)};
  padding: 5px 12px;
  border-radius: 7px;
  white-space: nowrap;
  cursor: pointer;
  /* 비활성 = Genre·Key 와 같은 톤. 활성은 배경/테두리를 비워 썸이 드러나게 한다. */
  background: ${({ $on }) => ($on ? 'transparent' : '#fff')};
  border: 1.5px solid ${({ $on }) => ($on ? 'transparent' : '#ccc')};
  color: ${({ $on }) => ($on ? '#166fb0' : '#222')};
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;

  &:hover:not(:disabled) { border-color: ${({ $on }) => ($on ? 'transparent' : '#888')}; }
  &:active:not(:disabled) { transform: translateY(0.5px); }
  &:disabled { opacity: 0.45; cursor: default; }
`;




const LockedHint = styled.span`
  font-size: 0.62rem;
  font-weight: 700;
  color: #8a7a52;
  background: rgba(184, 134, 11, 0.12);
  padding: 2px 6px;
  border-radius: 5px;
  white-space: nowrap;
`;

/* 탭 바 오른쪽 아이콘들 — undo/redo 외에는 디자인용(동작 미연결). */
const TIco = {
  undo: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h11a5 5 0 0 1 0 10h-1"/><polyline points="8 5 4 9 8 13"/></svg>,
  redo: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 9H9a5 5 0 0 0 0 10h1"/><polyline points="16 5 20 9 16 13"/></svg>,
  add:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8" strokeLinecap="round"/></svg>,
  cut:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M7.5 16 18 4M16.5 16 6 4"/></svg>,
  check:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8 12 11 15 16 9"/></svg>,
  down: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="7" x2="12" y2="16"/></svg>,
  print:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="2"/><rect x="6" y="14" width="12" height="7"/></svg>,
  layout:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/></svg>,
  zin:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6M11 8v6"/></svg>,
  zout: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/></svg>,
  pause:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>,
};

const TOOL_TABS = [
  { id: 'note', label: '음표' },
  { id: 'artic', label: '아티큘레이션' },
  { id: 'dyn', label: '다이내믹스' },
  { id: 'measure', label: '마디' },
  { id: 'midi', label: 'MIDI' },
  { id: 'info', label: '정보' },
] as const;

/* ── 상단 탭 바 ─────────────────────────────────────────────────────────
 * 섹션들 위에 얹는 줄. 왼쪽은 탭, 오른쪽은 아이콘 묶음(undo/redo 만 실제 동작). */
const TabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  /* 아래 섹션 툴바(ToolBar)와 같은 배경 — 탭 줄만 흰색이면 띠처럼 떠 보인다. */
  background: ${({ theme }) => theme.colors.barBelow};
`;

const TabList = styled.div`
  display: flex;
  align-items: stretch;
  gap: 16px;
`;

const TabItem = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.06rem;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on, theme }) => ($on ? '#2f6fe0' : theme.colors.textSecondary)};
  background: none;
  border: none;
  border-bottom: 2px solid ${({ $on }) => ($on ? '#2f6fe0' : 'transparent')};
  padding: 16px 2px 13px;
  cursor: pointer;
  white-space: nowrap;
  &:hover { color: ${({ $on }) => ($on ? '#2f6fe0' : '#444')}; }
`;

const TabSpacer = styled.div`flex: 1;`;

/* 탭 바 가운데의 플레이어 묶음. */
const TabPlayer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TabIcons = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const TabIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 7px;
  background: none;
  color: #5b5b5b;
  cursor: pointer;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const TabDivider = styled.span`
  width: 1px;
  height: 18px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 2px;
`;

/* 정보 탭 — 여러 줄로 나눠 담는 패널. */
/* MIDI 탭 본문 — 정보 탭과 같은 툴바 배경/여백 규격. 내용은 두 칸 그리드라
 * 여기서는 감싸는 여백만 준다. */
const MidiTabPanel = styled.div`
  padding: 12px 18px 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barBelow};
`;

const InfoTabPanel = styled.div`
  display: flex;
  flex-direction: row;      /* 1) 메타데이터  2) 플레이어 — 가로로 나란히 */
  align-items: stretch;
  gap: 8px;                 /* 툴바 섹션 간격과 동일 */
  padding: 10px 18px 10px 8px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barBelow};
`;

/* 정보 탭 내부 섹션 — 툴바 섹션과 같은 라운드 네모로 구분한다. */
/* 라벨 + 입력 한 쌍 — 라벨을 작게 위에 얹는다. */
/* 라벨 + 입력을 가로로 나란히. 바 높이가 고정이라 입력을 작게 잡는다. */
const MetaField = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  > span:first-child { min-width: 78px; }     /* 라벨 폭을 맞춰 입력이 세로로 정렬되게 */
  input {
    width: 186px;
    font-size: 0.86rem;
    padding: 4px 9px;
  }
`;

/* 정보 탭 — 열(세로 스택) 묶음. */
const InfoCols = styled.div`
  display: flex;
  gap: 26px;
  align-items: flex-start;
  padding: 6px 10px;
`;

const InfoCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;            /* 바 높이가 고정이라 행 간격을 좁게 */
`;

/* 마디 탭 — 마디 편집 도구를 한 줄로. (드롭다운과 같은 버튼 톤) */
const MeasureTabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: 'Pretendard', sans-serif;

  .mlabel {
    font-size: 0.86rem;
    font-weight: 700;
    color: #8a7a2b;
    margin-right: 4px;
    white-space: nowrap;
  }
  button {
    font-family: 'Pretendard', sans-serif;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 7px 12px;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 7px;
    background: #fff;
    color: ${({ theme }) => theme.colors.textPrimary};
    cursor: pointer;
    white-space: nowrap;
    &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }
  }
`;

/* 탭 내용이 아직 없는 탭 — 자리만 알린다. */
const TabPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barBelow};
`;

const ToolBar = styled.div`
  display: flex;
  /* stretch: 섹션들의 높이가 가장 큰 섹션에 맞춰 나란히 정렬된다. */
  align-items: stretch;
  gap: 8px;
  /* 왼쪽은 첫 섹션이 화면 끝에 가깝게 붙도록 여백을 줄인다. */
  padding: 10px 18px 10px 8px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barBelow};
  flex-wrap: wrap;
`;

/* 음표·쉼표 묶음 — 온음표부터 64분쉼표까지를 한 덩어리로 감싸는 라운드 테두리.
 * 툴바에서 '음길이 선택' 영역임을 시각적으로 분리한다(가장 왼쪽). */
/* 툴바 섹션 공통 — 연한 회색의 굵은 테두리, 안쪽 여백은 원래 디자인(5px/4px)대로.
 * ToolBar 가 align-items: stretch 라 모든 섹션의 높이가 자동으로 맞춰진다. */
const Section = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 2px solid rgba(0, 0, 0, 0.13);
  border-radius: 12px;
  background: #fff;          /* 섹션 배경은 흰색으로 통일 */
`;

/* 정보 탭 섹션 = 툴바 섹션과 완전히 같은 규격(테두리·라운드·배경·여백).
 * 앞으로 섹션을 나눌 때는 항상 공용 Section 을 상속해 규격을 하나로 유지한다.
 * 여기서는 내용이 세로로 쌓이는 것만 다르다. */
const InfoSection = styled(Section)`
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
`;

const DurGroup = styled(Section)``;

/* 점·연음·임시표 묶음(두 번째 섹션). */
const ModGroup = styled(Section)``;

/* 세 번째 섹션 — 메타데이터 + undo/redo. 중요 영역이라 골드 테두리. */
/* 3번 섹션 — 활성 상태의 시그니처 색을 테두리·배경에 함께 입힌다.
 *   note    → 연한 빨강 · measure → 골드 · none → 중립 회색 */
const MODE_INK = {
  note:    { line: '#e08a8a', fill: 'rgba(214, 88, 88, 0.10)' },
  measure: { line: '#D4A843', fill: 'rgba(184, 150, 10, 0.12)' },
  none:    { line: 'rgba(0, 0, 0, 0.13)', fill: '#fff' },
} as const;

const GoldGroup = styled(Section)<{ $mode: 'none' | 'measure' | 'note' }>`
  /* 남는 가로 공간을 모두 차지해 툴바 끝까지 늘어난다. */
  flex: 1;
  border-color: ${({ $mode }) => MODE_INK[$mode].line};
  background: ${({ $mode }) => MODE_INK[$mode].fill};
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  transition: border-color 0.15s, background 0.15s;
`;

/* 컴팩트 세로 2단 컬럼(음표/쉼표, 점/겹점 …). */
const ModCol = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
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
  /* 활성 = 연한 하늘색 (예전 금색에서 변경) */
  border: 1px solid ${({ $active, theme }) => ($active ? '#7cb8e8' : theme.colors.border)};
  border-radius: 6px;
  background: ${({ $active }) => ($active ? '#e3f2fd' : 'transparent')};
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

const Sep = styled.div`
  width: 1px;
  height: 30px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 5px;
`;

/* ── '+' 기호 추가 드롭다운 ─────────────────────────────────────────────
 * 옥타브·반복·내비게이션·브라켓처럼 "한 번 찍고 마는" 기호들을 담는다.
 * 툴바 버튼(DurBtn)과 같은 금색 활성 톤을 쓰되, 메뉴 안에서는 라벨을 붙여
 * 아이콘만으로 뜻을 추측하지 않아도 되게 했다. */
const MarkWrap = styled.div`
  position: relative;
  display: flex;
`;

const MarkBadge = styled.span`
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: #b8960a;
  color: #fff;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
`;

const MarkMenu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: ${({ theme }) => theme.zIndex.popover};
  width: 320px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
`;

const MarkGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const MarkTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const MarkRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const MarkBtn = styled.button<{ $active?: boolean }>`
  width: 70px;
  min-height: 58px;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid ${({ $active, theme }) => ($active ? '#b8960a' : theme.colors.border)};
  border-radius: 8px;
  background: ${({ $active }) => ($active ? '#f5ecd0' : 'transparent')};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { background: ${({ $active }) => ($active ? '#f2e6c2' : '#f0ebe0')}; }
`;

const MarkGlyph = styled.span`
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
`;

const MarkLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.62rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  white-space: nowrap;
`;

const MarkSelectRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
`;

const MarkSelectLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
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

/* 내 코드 차트(ChordPage)의 ToolBtn 과 동일 — 테두리·배경 없는 38px 아이콘 버튼. */
const ToolBtn = styled.button<{ $lit?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: ${({ $lit }) => ($lit ? '#e8a838' : '#5b5b5b')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  ${({ $lit }) => $lit && 'filter: drop-shadow(0 0 4px rgba(232, 168, 56, 0.55));'}
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
  &:disabled { opacity: 0.4; cursor: default; }
`;

/* 저장 버튼 — 톱니·MIDI 와 같은 38px 아이콘 버튼 규격(ToolBtn) 위에
 * 상태만 얹는다. 아이콘만 남으므로 상태(저장 중/실패)는 색과 회전, 그리고
 * title/aria-label 로 전달한다.
 * (아래쪽 `spin` 은 이 시점에 아직 선언 전이라 여기 전용 키프레임을 둔다.) */
const saveSpin = keyframes`
  to { transform: rotate(360deg); }
`;

const SaveIconBtn = styled(ToolBtn)<{ $error?: boolean; $busy?: boolean }>`
  color: ${({ $error }) => ($error ? '#c62828' : '#ef6c00')};
  &:hover:not(:disabled) {
    background: ${({ $error }) => ($error ? 'rgba(198, 40, 40, 0.10)' : 'rgba(239, 108, 0, 0.12)')};
  }
  svg { ${({ $busy }) => $busy && `animation: ${saveSpin} 0.9s linear infinite;`} }
`;

/* ── 단축키 도움말(?) ─────────────────────────────────────────────────
 * 건반 아래 한 줄로만 흘려 놓던 단축키를 상단바 버튼의 팝오버로 옮겨 담는다. */
const HelpAnchor = styled.div`
  position: relative;
  display: inline-flex;
`;

const ShortcutPop = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  /* 버튼이 바 오른쪽에 있어 왼쪽으로 펼친다. */
  right: 0;
  z-index: 70;
  width: 300px;
  max-width: calc(100vw - 32px);
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 14px 16px 16px;
  text-align: left;
  cursor: default;
`;

const ShortcutTitle = styled.div`
  font-size: 0.98rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 10px;
`;

const ShortcutGroup = styled.div`
  font-size: 0.74rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 12px 0 5px;
  &:first-of-type { margin-top: 0; }
`;

const ShortcutRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 0.84rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Kbd = styled.kbd`
  flex-shrink: 0;
  min-width: 30px;
  text-align: center;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  font-weight: 700;
  color: #444;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 2px 6px;
`;

/* 건반 아래 안내줄과 같은 내용 — 여기가 단일 출처다. */
const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: '음길이',
    items: [
      ['1', 'whole (온음표)'],
      ['2', 'half (2분음표)'],
      ['4', 'quarter (4분음표)'],
      ['8', '8th (8분음표)'],
      ['6', '16th (16분음표)'],
      ['3', '32nd (32분음표)'],
    ],
  },
  {
    group: '편집',
    items: [
      ['L', 'tie (붙임줄)'],
      ['T', 'triplet (셋잇단음표)'],
      ['Enter', 'close measure (마디 닫기)'],
      ['Backspace', 'undo (되돌리기)'],
      ['Ctrl+Z', 'undo (되돌리기)'],
    ],
  },
];

/* ── 조성 표시 + Transpose ────────────────────────────────────────────
 * 에디터의 조성 변경은 영구 이조라 드롭다운(훑어보기)이 아니라 명시적
 * 버튼 → 팝오버로 확정한다. 표시는 GenreSelect 와 같은 높이·폰트. */

/* 내 코드 차트(ChordPage)의 KeyControl(KeyButton)과 동일 규격 — 단, 에디터는
 * 표시 전용(변경은 옆 Transpose 버튼)이라 드롭다운 화살표(::after '▾')는 뺀다. */
const KEY_FONT = "'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif";
/* 조성 칩 = Transpose 버튼 (통합).
 *   평소   : 조성만 보인다 (C장조)
 *   hover  : 조성이 흐려지고 그 자리에 Transpose 아이콘이 겹쳐 뜬다
 *   클릭   : 이조 드롭다운
 * 아이콘을 옆에 따로 두지 않아 상단바가 한 칸 줄고, "이 조성을 바꾼다"는
 * 동작이 조성 자체에 붙어 의미가 분명해진다. */
const KeyDisplay = styled.button<{ $open?: boolean }>`
  position: relative;
  height: 32px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  white-space: nowrap;
  background: #fff;
  border: 1.5px solid ${({ $open }) => ($open ? '#e8a838' : '#ccc')};
  border-radius: 6px;
  padding: 0 10px;
  font-family: ${KEY_FONT};
  font-size: 1.12rem;
  font-weight: 600;
  color: #222;
  cursor: pointer;
  transition: border-color 0.14s, background 0.14s;

  &:hover { background: #fffdf7; }

  /* 조성 텍스트 — hover/열림 시 흐려져 아이콘에 자리를 내준다.
   * line-height 를 건드리지 않는다: 1 로 조이면 줄상자가 글꼴 크기까지 압축돼
   * (MuseJazz 는 ascent 가 커서) 글자가 상자 위쪽으로 밀려 올라간다. 옆의
   * Unknown 칩도 line-height 를 지정하지 않으므로 기본값(normal)이라야 둘의
   * 광학 중심이 맞는다. */
  .key-text {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    transition: opacity 0.14s;
    opacity: ${({ $open }) => ($open ? 0.12 : 1)};
  }
  &:hover .key-text { opacity: 0.12; }

  /* Transpose 아이콘 — 평소 숨김, hover/열림 시 가운데에 겹쳐 표시. */
  .key-ico {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${({ $open }) => ($open ? '#e8a838' : '#5b5b5b')};
    opacity: ${({ $open }) => ($open ? 1 : 0)};
    transition: opacity 0.14s;
    pointer-events: none;
  }
  &:hover .key-ico { opacity: 1; }
`;

/* "장조/단조" — 루트보다 작게(KeyControl 의 KeyQual 과 동일).
 * 루트(MuseJazz)와 한글(Pretendard)은 글꼴이 달라 baseline 이 어긋난다.
 * 한글은 Pretendard 로 명시하고 flex 중앙 정렬로 붙여 높이를 맞춘다. */
const KeyQualEP = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.62em;
  font-weight: 600;
  margin-left: 2px;
`;

const KeyAnchor = styled.div`
  position: relative;
  display: inline-flex;
`;

/* Transpose 아이콘 — 32px 칩 안에 겹쳐 놓으므로 20px(SolosPage 는 26px). */
const IcoTranspose = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 3 21 7 17 11" /><path d="M21 7H8a4 4 0 0 0-4 4" />
    <polyline points="7 21 3 17 7 13" /><path d="M3 17h13a4 4 0 0 0 4-4" />
  </svg>
);

/* ── Transpose 팝오버 — SolosPage(솔로 DB)의 KeyChangePopover 와 동일 로직·디자인 ──
 * '음표 함께 이동'(실제 이조) / '키만 변경'(표기만 교체) 모드 + 이조악기 프리셋. */
const HEADER_PHONE_POPOVER = '@media (max-width: 820px)';

const KeyPanelBar = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  /* 조성 칩이 상단바 왼쪽에 있으므로 왼쪽 정렬 — right:0 이면 패널이 왼쪽으로
   * 뻗어 화면 밖으로 잘린다. */
  left: 0;
  z-index: 60;
  /* 모드 탭 3개가 한 줄에 들어갈 최소 폭. */
  min-width: 400px;
  max-width: calc(100vw - 32px);
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  ${HEADER_PHONE_POPOVER} {
    position: fixed;
    left: 50%;
    right: auto;
    top: auto;
    bottom: 16px;
    transform: translateX(-50%);
    width: calc(100vw - 24px);
    min-width: 0;
    max-width: 420px;
    max-height: 70vh;
    overflow-y: auto;
  }
`;

const KeyPanelTitle = styled.div`
  font-size: 1.12rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ModeSwitch = styled.div`
  display: grid;
  /* 탭 3개 — 반드시 한 줄. 2열이면 '옥타브'가 아래로 떨어져 모양이 깨진다. */
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const ModeTab = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  /* 가장 긴 '음표 함께 이동'(7자)이 3열에 들어가도록 살짝 줄인다. */
  font-size: 0.84rem;
  font-weight: 700;
  white-space: nowrap;
  padding: 8px 4px;
  border: 1.5px solid ${({ $on }) => ($on ? '#1f9a52' : 'transparent')};
  border-radius: 7px;
  background: ${({ $on, theme }) => ($on ? theme.colors.bgPrimary : 'transparent')};
  color: ${({ $on, theme }) => ($on ? '#17773e' : theme.colors.textSecondary)};
  cursor: pointer;
`;

const ModeHint = styled.div`
  font-size: 0.8rem;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const KeyPanelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const KeyFromChip = styled.span`
  font-size: 0.92rem;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const KeyInput = styled.input`
  flex: 1;
  min-width: 100px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  padding: 7px 11px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const KeyApplyBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 8px 15px;
  border-radius: 6px;
  border: none;
  background: #1f9a52;
  color: #fff;
  cursor: pointer;
  &:hover:not(:disabled) { background: #18803f; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;


const OctRow = styled.div`
  display: flex;
  gap: 8px;
`;

const OctPanelBtn = styled.button`
  flex: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 9px 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.colors.gold};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const KeyPresetBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.86rem;
  font-weight: 600;
  text-align: left;
  padding: 9px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  small { color: ${({ theme }) => theme.colors.textSecondary}; font-weight: 500; margin-left: 4px; }
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.gold}; background: ${({ theme }) => theme.colors.bgSecondary}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

/* 현재 조성을 반음(semitone) 단위로 이동한 표시 조성(예: 'C' +3 → 'Eb'). */
const PC_BY_LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function shiftDisplayKeyBySemitones(dispKey: string, semitones: number): string | null {
  const m = /^([A-G])([#b]?)(m?)$/i.exec(dispKey.trim());
  if (!m) return null;
  const base = PC_BY_LETTER[m[1].toUpperCase()];
  if (base == null) return null;
  const pc = (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const next = (((pc + semitones) % 12) + 12) % 12;
  return PC_NAMES_FLAT[next] + (m[3] ? 'm' : '');
}

/* SolosPage 의 조성 변경 팝오버와 동일 — '음표 함께 이동'(실제 이조) / '키만 변경'(표기만). */
function KeyChangePopover({
  currentKey, value, onChange, onApplyTranspose, onApplyKeyOnly, onPreset, onOctave, octaveDisabled, onClose, busy,
}: {
  currentKey: string;
  value: string;
  onChange: (v: string) => void;
  onApplyTranspose: () => void;
  onApplyKeyOnly: () => void;
  onPreset: (semitones: number) => void;
  /** 옥타브 이동 — 조성은 그대로 두고 음표 전체를 ±1 옥타브. */
  onOctave: (dir: -1 | 1) => void;
  octaveDisabled: boolean;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'notes' | 'keyOnly' | 'octave'>('notes');
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // 버튼 자체 클릭은 토글이 처리 — 팝오버(+앵커) 밖이면 닫는다.
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 옥타브 탭은 입력창이 없다 — 이조 두 탭에서만 적용.
  const apply = () => {
    if (mode === 'notes') onApplyTranspose();
    else if (mode === 'keyOnly') onApplyKeyOnly();
  };

  return (
    <KeyPanelBar ref={ref} role="dialog">
      <KeyPanelTitle>Transpose / Octave</KeyPanelTitle>
      <ModeSwitch role="tablist">
        <ModeTab type="button" role="tab" aria-selected={mode === 'notes'} $on={mode === 'notes'} onClick={() => setMode('notes')}>
          음표 함께 이동
        </ModeTab>
        <ModeTab type="button" role="tab" aria-selected={mode === 'keyOnly'} $on={mode === 'keyOnly'} onClick={() => setMode('keyOnly')}>
          키만 변경
        </ModeTab>
        <ModeTab type="button" role="tab" aria-selected={mode === 'octave'} $on={mode === 'octave'} onClick={() => setMode('octave')}>
          옥타브
        </ModeTab>
      </ModeSwitch>
      <ModeHint>
        {mode === 'notes'
          ? '조표와 음표를 함께 옮긴다 — 실제 이조. (Undo 가능)'
          : mode === 'keyOnly'
            ? '음표는 그대로 두고 조성 표기만 교체한다 (파싱 교정용).'
            : '조성은 그대로 두고 음표 전체를 한 옥타브 위/아래로 옮긴다. (Undo 가능)'}
      </ModeHint>

      {mode === 'octave' ? (
        /* 옥타브 — 조표는 손대지 않고 음표만 ±12 반음. 입력·프리셋이 필요 없어
         * 두 버튼만 크게 둔다. */
        <OctRow>
          <OctPanelBtn type="button" disabled={busy || octaveDisabled} onClick={() => onOctave(-1)}>
            Oct −1
          </OctPanelBtn>
          <OctPanelBtn type="button" disabled={busy || octaveDisabled} onClick={() => onOctave(1)}>
            Oct +1
          </OctPanelBtn>
        </OctRow>
      ) : (
        <>
          <KeyPanelRow>
            <KeyFromChip>{currentKey}</KeyFromChip>
            <span aria-hidden>→</span>
            <KeyInput
              autoFocus
              placeholder="예: Bb, F#m"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) apply(); }}
            />
            <KeyApplyBtn type="button" disabled={!value.trim() || busy} onClick={apply}>적용</KeyApplyBtn>
          </KeyPanelRow>
          <KeyPresetBtn type="button" disabled={busy || mode !== 'notes'} onClick={() => onPreset(3)}>
            E♭ → C 로 이조하기 <small>(알토 색소폰 · +3)</small>
          </KeyPresetBtn>
          <KeyPresetBtn type="button" disabled={busy || mode !== 'notes'} onClick={() => onPreset(-2)}>
            B♭ → C 로 이조하기 <small>(테너 색소폰 · 트럼펫 · −2)</small>
          </KeyPresetBtn>
        </>
      )}
    </KeyPanelBar>
  );
}

/* ── 악보 상태 칩 ─────────────────────────────────────────────────────
 * Bar / beats / notes / bars 를 한 덩어리로 묶은 둥근 사각형. 옆의
 * GenreSelect·KeyDisplay 와 같은 높이·폰트로 맞춰 한 줄로 읽힌다. */
const StatusChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  margin-left: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  line-height: 1;                 /* 옆 칩들과 수직 중심 통일 */
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

/* 3번 섹션 좌측의 활성 상태 배지 — 음표/마디/없음. */
const ModeTag = styled.span<{ $mode: 'none' | 'measure' | 'note' }>`
  font-size: 0.72rem;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  color: ${({ $mode }) => ($mode === 'note' ? '#8a2b2b' : $mode === 'measure' ? '#8a7a2b' : '#777')};
  background: ${({ $mode }) => ($mode === 'note' ? 'rgba(200,60,60,0.13)' : $mode === 'measure' ? 'rgba(184,150,10,0.16)' : 'rgba(0,0,0,0.05)')};
`;

const StatusItem = styled.span<{ $warn?: boolean }>`
  display: inline-flex;
  /* baseline 정렬은 크기가 다른 숫자(0.86rem)와 라벨(0.78rem)이 섞이면서
   * 칩 전체의 수직 중심을 흔든다 — 중앙 정렬로 통일. */
  align-items: center;
  gap: 3px;
  line-height: 1;
  color: ${({ $warn }) => ($warn ? '#c62828' : 'inherit')};
  b {
    font-size: 0.86rem;
    font-weight: 700;
    line-height: 1;
    color: ${({ $warn, theme }) => ($warn ? '#c62828' : theme.colors.textPrimary)};
  }
`;

const StatusDot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

/* 코드차트와 동일 규격(26px · stroke 2)의 우측 바 아이콘. */
/* 저장 — 플로피 디스크(범용 저장 기호). 톱니와 같은 26px·strokeWidth 2 규격. */
const SaveIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

/* 저장 중 표시 — 아이콘 자리에 그대로 도는 링. 버튼 크기가 바뀌지 않게 26px 고정. */
const SaveSpinnerIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
);

const GearIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
/* 단축키 도움말 — 동그라미 안 물음표. GearIcon·MidiIcon 과 같은 26px·stroke 2. */
const HelpIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 4" />
    <path d="M12 17.5h.01" />
  </svg>
);
/* 🎹 이모지를 대체하는 건반 아이콘(같은 의미). */
const MidiIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M8 5v9" /><path d="M12 5v9" /><path d="M16 5v9" />
    <path d="M3 14h18" />
  </svg>
);




const PianoArea = styled.div`
  /* 위 여백 0 — 섹션 툴바의 아래 경계선에 건반이 바로 붙는다. */
  padding: 0 0 12px;
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

const ChordCellWrap = styled.div<{ $hasValue?: boolean; $active?: boolean }>`
  position: absolute;
  height: 28px;
  border-radius: 3px;
  /* 활성 마디의 코드칸은 스테이브와 같은 크림색 배경으로 칠한다. */
  background: ${({ $hasValue, $active }) =>
    $active ? 'rgba(184, 150, 10, 0.13)' : $hasValue ? 'transparent' : 'rgba(0,0,0,0.04)'};
  cursor: text;
  transition: background 0.12s;
  &:hover { background: ${({ $active }) => ($active ? 'rgba(184, 150, 10, 0.22)' : 'rgba(0,0,0,0.07)')}; }
`;

/* 대체 코드 행의 양끝 괄호 — 활성화되면 항상 함께 그려진다. */
const AltParen = styled.span`
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
  font-size: 17px;
  color: ${({ theme }) => theme.colors.textSecondary};
  pointer-events: none;
  user-select: none;
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

/* 코드 분해(루트/퀄리티·확장·텐션·분수코드 베이스)는 lib/jazz-harmony 의
 * splitChordParts 하나만 쓴다 — 뷰어(NoteSheet/LickCard/12키)와 100% 동일.
 * 여기서는 그 tension 문자열을 에디터 표기용 acc/num 쌍으로만 더 쪼갠다. */
function parseTensions(tension: string): { acc: string; num: string; text: string }[] {
  const out: { acc: string; num: string; text: string }[] = [];
  let remaining = tension;
  while (remaining.length > 0) {
    const t = remaining.match(/^([♭♯#b]*)(\d+|alt)/);
    if (t) {
      out.push({ acc: t[1], num: t[2], text: '' });
      remaining = remaining.slice(t[0].length);
      continue;
    }
    // 숫자 텐션이 아닌 텍스트 수식어(sus·sus2·sus4·add9·omit3·no5 등)는
    // 통째로 인라인 표기한다. 예전엔 여기서 break 해 'sus'가 통째로 사라졌다.
    const m = remaining.match(/^(sus[24]?|add\d+|omit\d+|no\d+|alt)/i);
    if (m) { out.push({ acc: '', num: '', text: m[1] }); remaining = remaining.slice(m[0].length); continue; }
    // 알 수 없는 잔여 — 떨어뜨리지 말고 그대로 보존.
    out.push({ acc: '', num: '', text: remaining });
    break;
  }
  return out;
}

/* formatChordDisplay imported from src/lib/jazz-harmony — see top of file. */

function ChordCell({ value, onChange, style, onContextMenu, active, cellId, registerFocus, onNavigate }: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
  /** 우클릭 → 대체 코드 추가/제거 드롭다운 */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** 이 칸이 속한 마디가 현재 활성 마디인지 — 활성 배경 표시 */
  active?: boolean;
  /** Tab 이동용 식별자("<마디idx>:<슬롯>"). 있으면 포커스 레지스트리에 등록. */
  cellId?: string;
  registerFocus?: (id: string, fn: (() => void) | null) => void;
  /** Tab/Shift+Tab → 순서상 다음(+1)/이전(-1) 코드칸으로 포커스 이동 */
  onNavigate?: (id: string, dir: 1 | -1) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* 이 칸의 '편집 진입+포커스' 함수를 부모 레지스트리에 등록 — 다른 칸에서 Tab 시 호출된다. */
  useEffect(() => {
    if (!cellId || !registerFocus) return;
    registerFocus(cellId, () => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); });
    return () => registerFocus(cellId, null);
  }, [cellId, registerFocus]);
  const formatted = formatChordDisplay(value);
  const { base, ext, tension, bass } = splitChordParts(formatted);
  const tensions = parseTensions(tension);

  return (
    <ChordCellWrap
      $hasValue={!!value}
      $active={active}
      style={style}
      onContextMenu={onContextMenu}
      onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
    >
      {editing ? (
        <ChordCellInput
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { onChange(normalizeChord(value)); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && isComposingEvent(e)) return; // 한글 조합 확정 Enter 무시
                  if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onChange(normalizeChord(value)); setEditing(false); }
                  // Tab / Shift+Tab → 현재 값 확정 후 다음/이전 코드칸으로 이동
                  else if (e.key === 'Tab' && cellId && onNavigate) {
                    e.preventDefault();
                    onChange(normalizeChord(value));
                    setEditing(false);
                    onNavigate(cellId, e.shiftKey ? -1 : 1);
                  } }}
        />
      ) : (
        <ChordCellDisplay>
          {value ? (() => {
            const dimMatch = base.match(/^(.*?)([ø°])$/);
            const baseText = dimMatch ? dimMatch[1] : base;
            const dimSymbol = dimMatch ? dimMatch[2] : '';
            return <>
              <ChordBase>{baseText}</ChordBase>
              {dimSymbol && <ChordHalfDim>{dimSymbol}</ChordHalfDim>}
              {ext && <ChordExt>{ext}</ChordExt>}
              {tensions.map((t, i) => (
                <span key={i}>
                  {t.text
                    ? <ChordExt>{t.text}</ChordExt>
                    : <>
                        {t.acc && <ChordTensionAcc>{t.acc}</ChordTensionAcc>}
                        <ChordTensionNum>{t.num}</ChordTensionNum>
                      </>}
                </span>
              ))}
              {/* 분수코드 베이스(/F#) — 텐션이 아니라 루트와 같은 크기로. */}
              {bass && <ChordBase>{bass}</ChordBase>}
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

/* ── 3-섹션 노트 편집 바 (핵심 편집 | 표현 | 부가) ── */
const SectionedEditBar = styled.div`
  display: flex;
  align-items: stretch;
  padding: 8px 16px;
  border-bottom: 2px solid #d32f2f;
  background: #fff5f5;
  overflow-x: auto;
`;
const EditWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  max-width: 470px;
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
  const initialMode: 'solo' | 'lick' | 'comping' = (() => {
    const q = searchParams.get('mode');
    if (q === 'solo' || q === 'lick' || q === 'comping') return q;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('jazzify.editor.mode');
      if (stored === 'solo' || stored === 'lick' || stored === 'comping') return stored;
    }
    return 'solo';
  })();
  const [mode, setMode] = useState<'solo' | 'lick' | 'comping'>(initialMode);
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
  const navState = location.state as {
    prefillSheet?: NoteSheetData;
    compingId?: string;
    compingGenre?: CompingGenre;
  } | null;
  const prefillSheet = navState?.prefillSheet;
  /* Comping 수정 저장 타깃 — CompingPage 에서 '에디터로 열기' 시 실려 온다.
   * (Comping 은 백엔드 없이 localStorage 저장이므로 id 로 로컬 항목을 갱신) */
  const [editingCompingId] = useState<string | null>(() => navState?.compingId ?? null);
  /* 컴핑 장르는 더 이상 별도 셀렉트로 고르지 않는다 — 아래 GenreSelect(genre)에서
   * 파생한다. navState 로 넘어온 값은 초기값(편집 진입)으로만 쓴다. */
  const [compingGenre, setCompingGenre] = useState<CompingGenre>(() => navState?.compingGenre ?? 'SWING');

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

  /* 보표(한손/양손)는 **불러온 악보의 데이터가 진실**이다 — OMR MusicXML 의
   * `<staves>` 로 판정된 결과가 `bassMeasures` 유무로 들어오므로, 불러온 악보에서는
   * 사용자에게 묻지도, 임의로 바꾸지도 않는다(잠금). 빈 에디터에서 새로 채보할 때만
   * 수동 선택이 필요하다(왼손 음표 입력 라우팅이 이 값에 달려 있다). */
  const staffModeLocked = !!prefillSheet;

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
  /* 열려있는(미확정) 마디의 대체 코드 — 확정 마디는 MeasureInfo.altChords 사용. */
  const [curAltChords, setCurAltChords] = useState<string[] | undefined>(undefined);
  /* 코드 칸 우클릭 드롭다운 (viewport 좌표 + 대상 마디 인덱스) */
  const [chordMenu, setChordMenu] = useState<{ x: number; y: number; idx: number } | null>(null);

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
  /* 정보 탭의 메타데이터 — 저장 시 실제로 함께 나간다(예전엔 빈 문자열로 고정). */
  const [performer, setPerformer] = useState('');
  const [metaInstrument, setMetaInstrument] = useState('');
  const [album, setAlbum] = useState('');
  /* 기본 장르 — 'Unknown'(미정). 사용자가 드롭다운에서 실제 장르를 고를 때까지
   * 장르를 단정하지 않는다. 반주 느낌은 genreToStyle 기본값(swing)으로 재생된다.
   * 컴핑 편집으로 진입한 경우(navState.compingGenre)엔 그 장르에 대응하는 라벨로 시작. */
  const [genre, setGenre] = useState(() => {
    const cg = navState?.compingGenre;
    if (cg) return ({ SWING: 'Medium Swing', BLUES: 'Shuffle', BOSSA: 'Bossa Nova', LATIN: 'Latin' } as const)[cg];
    return 'Unknown';
  });
  /* 컴핑 장르(SWING/BLUES/BOSSA/LATIN)는 GenreSelect 값에서 파생 — 별도 셀렉트 없음. */
  useEffect(() => { setCompingGenre(genreToCompingGenre(genre)); }, [genre]);
  const [sheetTitle, setSheetTitle] = useState('');
  const [sheetKey, setSheetKey] = useState('C');
  /* 에디터의 조성은 '표시 전환'이 아니라 **영구 이조**다. 뷰어(코드차트/솔로
   * 상세)는 드롭다운으로 보이는 키만 바꾸지만, 여기서는 음표 데이터 자체를
   * 옮겨야 저장 결과가 달라진다. 그래서 헤더의 조성은 읽기 전용 표시로 두고
   * 실제 변경은 옆의 Transpose 버튼(팝오버)에서만 수행한다. */
  const [transposeOpen, setTransposeOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  /* 조표 무시(explicit 임시표): 켜면 조표를 그리지 않고 마디 안의 ♯/♭만으로
   * 판단·표기한다(조표를 안 그린 채 마디 내에서 해결하는 악보 전용). 저장 시
   * sheetData.accidentalStyle='explicit'로 실려 뷰어·플레이어도 같게 해석. */
  /* 조표 무시는 전체 설정(악보/연주 → 에디터)과 공유하는 영속 설정이다.
   * 임시표로만 표기된 악보를 불러오면 그 악보가 제대로 그려지도록 아래에서
   * 이 값을 맞춰 세팅한다 — 설정 창에도 그 상태가 그대로 보인다. */
  const [explicitAcc, setExplicitAcc] = usePref(editorExplicitAcc);

  const [duration, setDuration] = useState('8');
  const [dotted, setDotted] = useState(false);
  /* 겹점 — 단일점과 배타(하나를 켜면 다른 하나는 꺼진다). */
  const [doubleDotted, setDoubleDotted] = useState(false);
  const [accMode, setAccMode] = useState<'b' | '#' | 'n'>('b');
  const [tieNext, setTieNext] = useState(false);
  const [tripletMode, setTripletMode] = useState(false);
  /* 꾸밈음 입력 모드 — 켜져 있으면 피아노/삽입으로 만든 음이 acciaccatura
   * (슬래시 꾸밈음)로 생성된다. 메트릭 0박이라 마디 길이에 영향을 주지 않는다. */
  const [graceMode, setGraceMode] = useState(false);
  /* 고스트(데드) 노트 모드 — 켜져 있으면 피아노로 입력한 음이 X 노트헤드로
   * 만들어진다. graceMode 와 같은 "다음 입력에 적용" 방식. */
  const [ghostMode, setGhostMode] = useState(false);
  const tripletCountRef = useRef(0);
  /* 지속 연음("3+") — 3연음처럼 3개에서 자동 해제되지 않고, 사용자가 버튼을
   * 다시 누를 때까지 입력하는 음표를 계속 한 묶음으로 이어붙인다. 음표가
   * 하나 들어올 때마다 그룹 전체의 tuplet 값을 현재 개수(N)로 다시 찍어서
   * 4·5·6·7… 연음이 실시간으로 만들어진다. (렌더러/박자 계산은 이미 임의 N을
   * 지원하므로 입력 UI만 열어 주면 된다.) */
  const [sustainTuplet, setSustainTuplet] = useState(false);
  const sustainCountRef = useRef(0);

  /* 두 모드는 상호 배타 — 하나를 켜면 다른 쪽은 끄고 카운터를 초기화한다. */
  const toggleTripletMode = useCallback(() => {
    setTripletMode((v) => {
      if (!v) { tripletCountRef.current = 0; setSustainTuplet(false); sustainCountRef.current = 0; }
      return !v;
    });
  }, []);

  const toggleSustainTuplet = useCallback(() => {
    setSustainTuplet((v) => {
      // 끄는 순간 그룹이 확정된다. 다음에 켜면 새 그룹으로 시작.
      sustainCountRef.current = 0;
      if (!v) { setTripletMode(false); tripletCountRef.current = 0; }
      return !v;
    });
  }, []);
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
  /* 악보 기호(옥타브·반복·내비게이션·브라켓) 추가 메뉴 — 툴바의 '+' 안에 모아둔다.
   * 음표 입력용 토글(Tie·꾸밈음·고스트·화음)은 자주 쓰므로 툴바에 그대로 남긴다. */
  const [markMenuOpen, setMarkMenuOpen] = useState(false);
  const markMenuRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadJsonText, setLoadJsonText] = useState('');
  const [loadJsonError, setLoadJsonError] = useState('');
  const [bpm, setBpm] = useState(200);
  const [repeatCount, setRepeatCount] = useState(3);
  const bpmManualRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* 저장 버튼은 아이콘만 남아서, 상태 설명을 툴팁·스크린리더 라벨로 전달한다. */
  const saveLabel = saving ? '저장 중…'
    : saveError ? '저장 실패 — 다시 시도'
    : mode === 'solo' ? 'Save Solo' : 'Save Lick';
  const svgRef = useRef<HTMLDivElement>(null);
  const chord1Ref = useRef<HTMLInputElement>(null);

  const positionsRef = useRef<MeasurePos[]>([]);
  const [measurePositions, setMeasurePositions] = useState<MeasurePos[]>([]);

  /* 코드칸 Tab 이동 — 각 ChordCell 이 자신의 '편집 진입' 함수를 등록하고, Tab 시
   * 순서(각 마디의 c1→c2)상 다음/이전 칸의 함수를 호출해 포커스를 옮긴다. */
  const chordFocusMap = useRef<Map<string, () => void>>(new Map());
  const registerChordFocus = useCallback((id: string, fn: (() => void) | null) => {
    if (fn) chordFocusMap.current.set(id, fn);
    else chordFocusMap.current.delete(id);
  }, []);
  const chordCellOrderRef = useRef<string[]>([]);
  const focusChordSibling = useCallback((id: string, dir: 1 | -1) => {
    const order = chordCellOrderRef.current;
    const i = order.indexOf(id);
    if (i < 0) return;
    const next = order[i + dir];
    if (next) chordFocusMap.current.get(next)?.();
  }, []);
  /* Tab 순서 = 각 마디(트레블)의 c1→c2, 마디 오름차순. 매 렌더 최신 위치로 갱신. */
  chordCellOrderRef.current = measurePositions
    .filter((p) => !p.staff)
    .map((p) => p.idx)
    .sort((a, b) => a - b)
    .flatMap((idx) => [`${idx}:0`, `${idx}:1`]);
  const notePositionsRef = useRef<NotePos[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  /* 음표 상하 드래그 상태. 시작 시점의 keys를 절대 기준으로 잡고, 화면 Y 이동량을
   * diatonic 스텝으로 환산해 매 이동마다 절대 적용 → setState 지연에도 안전. */
  const dragRef = useRef<{ sel: NoteSel; origKeys: string[]; startY: number; steps: number; moved: boolean; wasSelected: boolean; pushedUndo: boolean } | null>(null);
  /* 드래그로 처리한 포인터의 뒤따르는 click(선택 토글)을 한 번 억제. */
  const suppressClickRef = useRef(false);
  const [notePositions, setNotePositions] = useState<NotePos[]>([]);
  const [selectedNote, setSelectedNote] = useState<NoteSel | null>(null);
  /* 복수 선택 — Ctrl/Cmd + 클릭으로 앵커(selectedNote) 위에 덧붙인 음표들.
   * 앵커는 그대로 두고 여기에만 쌓으므로, 앵커가 바뀌면(=단일 선택 경로)
   * 아래 효과가 통째로 비운다. 전체 선택 = [selectedNote, ...extraSel]. */
  const [extraSel, setExtraSel] = useState<NoteSel[]>([]);
  /** 현재 선택된 음표 전체(앵커 포함). 하이라이트·묶기의 단일 출처. */
  const multiSel = useMemo<NoteSel[]>(
    () => (selectedNote ? [selectedNote, ...extraSel] : []),
    [selectedNote, extraSel],
  );
  /* 마디 단위 선택 — 음표가 없는(빈) 마디도 클릭으로 잡아서 삽입/삭제할 수
   * 있게 한다(OMR 교정 워크플로: 마디 사이 삽입·잘못 쪼개진 마디 삭제). */
  const [selectedMeasure, setSelectedMeasure] = useState<number | null>(null);
  /* 마디 내 삽입 모드 — 선택한 음표의 왼쪽/오른쪽에 새 음표를 끼워 넣는다.
   * ni = "이 인덱스 자리에 삽입"(기존 ni 앞). 입력할 때마다 ni+1로 전진해
   * 연속 입력이 자연스럽게 이어진다. 음표/마디 선택이 바뀌면 해제. */
  const [insertPos, setInsertPos] = useState<NoteSel | null>(null);
  /* 마디 모드에서 드롭다운은 평소 숨김 — 활성 마디 영역(또는 드롭다운 자체)에
   * 마우스가 올라왔을 때만 보인다. */
  const [measureHover, setMeasureHover] = useState(false);
  /* 상단 탭 — 지금은 '음표' 탭만 내용이 있고, 나머지는 자리만 잡아 둔다. */
  const [toolTab, setToolTab] = useState<'note' | 'artic' | 'dyn' | 'measure' | 'midi' | 'info'>('note');

  /* 상단바 ? 버튼 — 단축키 목록 팝오버. */
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const shortcutRef = useRef<HTMLDivElement>(null);
  useDismissable(shortcutOpen, shortcutRef, () => setShortcutOpen(false));

  /* 상단 3번 섹션(골드)의 상태 — 세 가지뿐이다.
   *   none    : 아무것도 선택 안 됨. 1·2번 섹션으로 찍으면 새 마디에 입력된다.
   *   measure : 마디를 눌렀거나, 새 마디가 만들어져 자동 활성화된 상태.
   *   note    : 실제 음표를 눌러 빨갛게 활성화한 상태 — 음표 편집 도구가 뜬다. */
  const editMode: 'none' | 'measure' | 'note' =
    selectedNote ? 'note' : (selectedMeasure != null || selectedBassMeasure != null) ? 'measure' : 'none';
  /* 마디 탭이 열리는 조건 — 음표가 활성이면 그 음표의 마디도 활성으로 본다. */
  const activeMeasureIdx: number | null = selectedNote ? selectedNote.mi
    : selectedMeasure != null ? selectedMeasure : null;
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
        // 단, 이미 '조표 무시'(accidentalStyle:'explicit')로 저장된 시트는 필드=소리
        // 상태라 조표 기준으로 구우면 bare음이 조표대로 변조돼 어긋난다 — 그대로 싣는다.
        const isExplicitSheet = prefillSheet.accidentalStyle === 'explicit';
        const bake = (ms: MeasureInfo[]) => isExplicitSheet ? ms : bakeExplicitAccidentals(ms, prefillSheet.key);
        const normalized = splitMeasuresByBeats(bake(prefillSheet.measures), 4);
        setMeasures(normalized);
        if (Array.isArray(prefillSheet.bassMeasures) && prefillSheet.bassMeasures.length > 0) {
          setBassMeasures(bake(prefillSheet.bassMeasures));
          setStaffMode('grand');
        }
        setCurNotes([]);
        setCurChord1('');
        setCurChord2('');
        if (prefillSheet.title) setSheetTitle(prefillSheet.title);
        if (prefillSheet.composer) setComposer(prefillSheet.composer);
        if (prefillSheet.key) setSheetKey(prefillSheet.key);
        setExplicitAcc(isExplicitSheet);
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
  const editRedoStack = useRef<typeof editUndoStack.current>([]);
  /* 현재 편집 상태 전체를 깊은 복사해 스냅샷으로 만든다(undo/redo 공용). */
  const captureSnapshot = useCallback(() => ({
    measures: measures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })),
    bassMeasures: bassMeasures.map((m) => ({ ...m, notes: m.notes.map((n) => ({ ...n })) })),
    curNotes: curNotes.map((n) => ({ ...n })),
    curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket,
  }), [measures, bassMeasures, curNotes, curChord1, curChord2, repeatStart, repeatEnd, volta, navigation, bracket]);
  const pushEditUndo = useCallback(() => {
    editUndoStack.current.push(captureSnapshot());
    if (editUndoStack.current.length > 50) editUndoStack.current.shift();
    editRedoStack.current = [];  // 새 편집이 발생하면 redo 분기는 무효화된다.
  }, [captureSnapshot]);

  const curBeats = useMemo(() => measureBeats(curNotes), [curNotes]);

  /* 실제 이조 — 음표를 target 키로 옮기고 조표도 함께 바꾼다(되돌리기 가능).
   * transposeNoteSheet 이 NoteSheetData 단위로 동작하므로, 편집 중인 마디
   * (measures/curNotes/bassMeasures)를 한 장의 시트로 싸서 통째로 옮긴 뒤
   * 다시 풀어 넣는다 — 그래야 트레블·베이스가 같은 간격으로 이동한다. */
  const applyTranspose = useCallback((targetKey: string) => {
    const target = normalizeNoteKeyDisplay(targetKey);
    if (!target || target === sheetKey) { setTransposeOpen(false); return; }
    pushEditUndo();
    const packed: NoteSheetData = {
      title: sheetTitle, composer, key: sheetKey, timeSignature: '4/4',
      // 편집 중인 마지막 마디(curNotes)도 함께 옮겨야 이조 후 이어서 쓸 수 있다.
      measures: [...measures, { notes: curNotes }],
      ...(bassMeasures.length ? { bassMeasures } : {}),
    };
    const out = transposeNoteSheet(packed, target);
    const outMeasures = out.measures ?? [];
    // 마지막 원소는 curNotes 였으므로 되돌려 분리한다.
    const tail = outMeasures[outMeasures.length - 1];
    setMeasures(outMeasures.slice(0, -1));
    setCurNotes(tail?.notes ?? []);
    if (out.bassMeasures) setBassMeasures(out.bassMeasures);
    setSheetKey(out.key || target);
    setTransposeOpen(false);
  }, [sheetKey, sheetTitle, composer, measures, curNotes, bassMeasures, pushEditUndo]);

  /* '키만 변경' — 음표는 그대로 두고 조성 표기(조표)만 교체한다. (SolosPage 와 동일 개념) */
  /* 키만 변경 — 조표 표기만 바꾸고 **소리는 그대로 둔다**.
   * setSheetKey 만 하면 임시표 없는 음표가 새 조표를 따라가 음높이가 바뀐다
   * (C장조의 B → E♭장조에선 B♭). respellNoteSheetKey 가 원래 피치를 확정한 뒤
   * 새 조표에서 그 피치를 유지할 임시표(♮ 등)를 다시 붙인다. */
  const applyKeyOnly = useCallback((targetKey: string) => {
    const target = normalizeNoteKeyDisplay(targetKey);
    if (!target || target === sheetKey) { setTransposeOpen(false); return; }
    pushEditUndo();
    const packed: NoteSheetData = {
      title: sheetTitle, composer, key: sheetKey, timeSignature: '4/4',
      measures: [...measures, { notes: curNotes }],
      ...(bassMeasures.length ? { bassMeasures } : {}),
    };
    const out = respellNoteSheetKey(packed, target);
    const outMeasures = out.measures ?? [];
    const tail = outMeasures[outMeasures.length - 1];
    setMeasures(outMeasures.slice(0, -1));
    setCurNotes(tail?.notes ?? []);
    if (out.bassMeasures) setBassMeasures(out.bassMeasures);
    setSheetKey(out.key || target);
    setTransposeOpen(false);
  }, [sheetKey, sheetTitle, composer, measures, curNotes, bassMeasures, pushEditUndo]);

  const curChord1Ref = useRef(curChord1);
  curChord1Ref.current = curChord1;
  const curChord2Ref = useRef(curChord2);
  curChord2Ref.current = curChord2;

  const allMeasures = useMemo<MeasureInfo[]>(() => {
    if (curNotes.length === 0 && !curChord && !curAltChords) return measures;
    const cur: MeasureInfo = { notes: curNotes, chord: curChord || undefined };
    if (curAltChords) cur.altChords = curAltChords;
    if (repeatStart) cur.repeatStart = true;
    if (repeatEnd) cur.repeatEnd = true;
    if (volta) cur.volta = volta;
    if (navigation) cur.navigation = navigation;
    if (bracket) cur.bracket = true;
    return [...measures, cur];
  }, [measures, curNotes, curChord, curAltChords, repeatStart, repeatEnd, volta, navigation, bracket]);

  const currentIdx = curNotes.length > 0 || curChord ? measures.length : -1;
  /* 활성(하이라이트) 마디: 사용자가 특정 마디를 선택했으면 그 마디만, 아니면
   * 입력 중인 마지막 마디(currentIdx). → 선택 시 그 바만 활성으로 보이게. */
  /* 노란 하이라이트 = '마디 활성' 표시.
   *   선택 없음  → 아무 마디도 칠하지 않는다(-1).
   *   음표 활성  → 그 음표가 속한 마디도 함께 활성.
   *   마디 활성  → 그 마디. */
  const activeIdx = selectedNote
    ? selectedNote.mi
    : (selectedMeasure != null && selectedMeasure < allMeasures.length ? selectedMeasure : -1);

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
    const beats = notes.reduce((s, n) => s + noteMetricBeats(n), 0);
    if (notes.length > 0 && beats >= 4 - 0.001) {
      const chord = joinChords(curChord1Ref.current, curChord2Ref.current);
      setMeasures((prev) => {
        // 새로 닫힌 마디를 활성 상태로 — '선택 없음'에서 입력을 시작하면 그 마디가 켜진다.
        setSelectedMeasure(prev.length);
        return [...prev, { notes, chord: chord || undefined }];
      });
      setCurNotes([]);
      // 마디가 닫히면 지속 연음 그룹도 확정 — 다음 마디는 새 묶음으로 센다
      // (연음 그룹이 마디선을 넘어가면 렌더러가 묶지 못한다).
      sustainCountRef.current = 0;
      setCurChord1('');
      setCurChord2('');
      setTimeout(() => chord1Ref.current?.focus(), 50);
    }
  }, []);

  /* '+' 안에 접힌 기호 중 지금 켜져 있는 개수 — 접어두면 상태가 안 보이므로
   * 버튼에 배지로 띄운다. */
  const markCount = useMemo(() => (
    (ottavaMode ? 1 : 0)
    + (repeatStart ? 1 : 0)
    + (repeatEnd ? 1 : 0)
    + (volta !== 0 ? 1 : 0)
    + (navigation ? 1 : 0)
    + (bracket ? 1 : 0)
  ), [ottavaMode, repeatStart, repeatEnd, volta, navigation, bracket]);

  /* '+' 기호 메뉴 — 바깥 클릭 / Esc 로 닫는다. 메뉴가 닫혀 있을 땐 리스너를
   * 붙이지 않아 평소 입력(단축키 등)에 얹히지 않는다. */
  useEffect(() => {
    if (!markMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!markMenuRef.current?.contains(e.target as Node)) setMarkMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMarkMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [markMenuOpen]);

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

  /* 선택 음표를 바로 오른쪽 음표와 붙임줄(Tie)로 잇는다 — T 단축키.
   * 붙임줄은 같은 자리의 음끼리만 성립하므로, 노트헤드 위치(keys)가 다르면
   * 아무 것도 하지 않는다. 다음 음이 없거나 쉼표여도 무시. 이미 이어져 있으면 해제. */
  const tieSelectedToNext = useCallback(() => {
    if (!selectedNote) return;
    const src = selectedNote.staff === 'bass' ? bassMeasures : allMeasures;
    const cur = src[selectedNote.mi]?.notes[selectedNote.ni];
    if (!cur || cur.duration.endsWith('r')) return;
    // 다음 음표 — 같은 마디의 다음, 없으면 이후 마디의 첫 음표.
    let next: NoteInfo | undefined;
    if (selectedNote.ni + 1 < (src[selectedNote.mi]?.notes.length ?? 0)) {
      next = src[selectedNote.mi].notes[selectedNote.ni + 1];
    } else {
      for (let mi = selectedNote.mi + 1; mi < src.length; mi++) {
        if (src[mi].notes.length) { next = src[mi].notes[0]; break; }
      }
    }
    if (!next || next.duration.endsWith('r')) return;
    const sameNote = cur.keys.length === next.keys.length
      && cur.keys.every((k, i) => k === next!.keys[i]);
    if (!sameNote) return;   // 같은 음이 아니면 작동하지 않는다
    updateNote(
      selectedNote.mi, selectedNote.ni,
      (n) => ({ ...n, tie: n.tie ? undefined : true }),
      selectedNote.staff,
    );
  }, [selectedNote, allMeasures, bassMeasures, updateNote]);

  // 포인터 위치에서 가장 가까운 음표(25px 이내) 히트테스트 — 드래그 시작용.
  const noteAtPoint = useCallback((clientX: number, clientY: number): NotePos | null => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const cx = (clientX - rect.left) / SHEET_SCALE;
    const cy = (clientY - rect.top) / SHEET_SCALE;
    let best: NotePos | null = null;
    let bestDist = Infinity;
    for (const np of notePositionsRef.current) {
      const d = Math.hypot(cx - (np.x + np.w / 2), cy - (np.y + np.h / 2));
      if (d < bestDist && d < 25) { bestDist = d; best = np; }
    }
    return best;
  }, []);

  // 음표 위 pointerdown → 선택 + 상하 드래그 시작(쉼표 제외). 음표가 아니면
  // 아무것도 안 하고 click(마디/빈 영역 선택)에 맡긴다.
  const handleSheetPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 새 제스처 시작 — 이전 드래그가 남긴 억제 플래그를 정리(click 없이 끝난
    // 큰 드래그가 다음 클릭을 삼키는 것 방지).
    suppressClickRef.current = false;
    if (e.button !== 0) return;
    const np = noteAtPoint(e.clientX, e.clientY);
    if (!np) return;
    const staff = np.staff;
    const note = (staff === 'bass' ? bassMeasures : allMeasures)[np.mi]?.notes[np.ni];
    if (!note || note.duration.endsWith('r')) return; // 쉼표는 음정 없음
    setInsertPos(null); // 음표 클릭 = 삽입 모드 종료(기존 click 동작 유지)
    const sel: NoteSel = { mi: np.mi, ni: np.ni, ...(staff ? { staff } : {}) };
    const wasSelected = !!selectedNote && selectedNote.mi === sel.mi && selectedNote.ni === sel.ni && selectedNote.staff === staff;
    if (!wasSelected) {
      setSelectedNote(sel);
      setSelectedMeasure(null);
      setSelectedBassMeasure(null);
    }
    dragRef.current = { sel, origKeys: [...note.keys], startY: e.clientY, steps: 0, moved: false, wasSelected, pushedUndo: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [noteAtPoint, allMeasures, bassMeasures, selectedNote]);

  // 드래그 이동: 시작 keys를 절대 기준으로, 화면 Y를 diatonic 스텝으로 환산해
  // 매번 절대 적용(임시표 제거, 상단 음 미리듣기). 첫 실제 변경에서 undo 1회.
  const handleSheetPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 3) d.moved = true;
    const target = -Math.round(dy / DRAG_PX_PER_STEP);
    if (target === d.steps) return;
    const newKeys = d.origKeys.map((k) => shiftDiatonicKey(k, target));
    if (newKeys.some((k) => k === null)) return; // 범위 밖 — 적용 보류
    if (!d.pushedUndo) { pushEditUndo(); d.pushedUndo = true; }
    d.steps = target;
    updateNote(d.sel.mi, d.sel.ni, (n) => {
      const updated = { ...n, keys: newKeys as string[] };
      delete updated.accidentals;
      return updated;
    }, d.sel.staff);
    playMidi(vexToMidi(newKeys[0] as string));
  }, [updateNote, pushEditUndo]);

  // pointerup: 음표 위 시작이었으므로 뒤따르는 click을 막는다. 안 움직였고 이미
  // 선택돼 있던 음표면 선택 해제(클릭 토글).
  const endSheetDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    suppressClickRef.current = true;
    if (!d.moved && d.wasSelected) setSelectedNote(null);
  }, []);

  // pointercancel: 제스처 중단 — click이 뒤따르지 않으므로 억제 없이 정리만.
  const cancelSheetDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  const handleNotePress = useCallback((pn: PianoNote, opts?: { gain?: number }) => {
    const conv = convertAcc(pn, accMode === 'n' ? 'b' : accMode);
    playMidi(pn.midi, opts?.gain);

    // Diatonic respell: in keys whose signature already flats C (Gb/Cb majors
    // + Ebm/Abm) the white B key is pitch-class 11, which spells Cb — not
    // B natural — in those keys. Same idea for E↔Fb in Cb major / Abm.
    // The respelled letter (C or F) is already flat via the key sig, so we
    // drop the accidental entirely (otherwise accMode='n' would force a
    // stray natural sign on the wrong letter).
    let respelled = false;
    if (sheetKey && !conv.acc && !explicitAcc) {
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
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(graceMode ? { grace: true as const, graceSlash: true as const } : {}), ...(ghostMode ? { ghost: true as const } : {}) };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode && !graceMode) ni.tuplet = 3;
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

    // ── 꾸밈음 모드 — 대상 실음 '앞'에 꾸밈음을 삽입해 그 음을 꾸민다 ──
    // 꾸밈음은 뒤따르는 실음에 붙는 modifier라, 뒤에 실음이 없으면 아무것도
    // 안 그려진다. 그래서 "먼저 원음을 두고(또는 선택하고) 그 앞에 꾸밈음을
    // 삽입"하는 방식으로 항상 즉시 보이게 한다.
    if (graceMode) {
      const gnote: NoteInfo = { keys: [conv.vexKey], duration, grace: true, graceSlash: true };
      if (!respelled && accMode === 'n') gnote.accidentals = { 0: 'n' };
      else if (conv.acc) gnote.accidentals = { 0: conv.acc };
      if (selectedNote) {
        // 선택한 원음 앞에 삽입 → 원음이 한 칸 뒤로 밀리므로 선택을 따라 옮겨
        // 유지(연속으로 누르면 순서대로 원음 앞에 쌓인다).
        insertNoteAt(selectedNote.mi, selectedNote.ni, gnote, selectedNote.staff);
        setSelectedNote({ ...selectedNote, ni: selectedNote.ni + 1 });
      } else {
        // 미선택: "마지막 실음" 앞에 삽입해 그 음을 꾸민다(항상 즉시 보임).
        // 우선순위: 열린 마디의 마지막 실음 → 마지막 committed 마디의 마지막 실음.
        const lastRealIdx = (() => {
          for (let i = curNotes.length - 1; i >= 0; i--) if (!curNotes[i].grace) return i;
          return -1;
        })();
        if (lastRealIdx >= 0) {
          setCurNotes((prev) => {
            const next = [...prev];
            next.splice(lastRealIdx, 0, gnote);
            return next;
          });
        } else if (measures.length > 0) {
          const lm = measures[measures.length - 1];
          let idx = lm.notes.length; // 마지막 실음 인덱스 찾기
          for (let i = lm.notes.length - 1; i >= 0; i--) { if (!lm.notes[i].grace) { idx = i; break; } }
          insertNoteAt(measures.length - 1, idx, gnote);
        } else {
          // 악보가 완전히 비었으면 꾸밀 대상이 없다 → 안내 후 무시.
          setSaveError('꾸밈음은 먼저 원음을 입력하거나 음표를 선택한 뒤 추가하세요.');
          setTimeout(() => setSaveError(null), 2500);
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
        // 피치뿐 아니라 음표 길이(duration)·점도 현재 툴바 선택값으로 교체한다
        // — "음표를 다른 것으로 바꾼 채 피아노를 누르면 음표 자체도 바뀜".
        // 쉼표였다면 'r' 없는 duration으로 실음이 된다.
        const updated: NoteInfo = { ...n, keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(ghostMode ? { ghost: true as const } : {}) };
        if (acc) updated.accidentals = acc;
        else delete updated.accidentals;
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
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(graceMode ? { grace: true as const, graceSlash: true as const } : {}), ...(ghostMode ? { ghost: true as const } : {}) };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode && !graceMode) ni.tuplet = 3;
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
      const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(graceMode ? { grace: true as const, graceSlash: true as const } : {}), ...(ghostMode ? { ghost: true as const } : {}) };
      if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
      else if (conv.acc) ni.accidentals = { 0: conv.acc };
      if (tripletMode && !graceMode) ni.tuplet = 3;
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
    const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(graceMode ? { grace: true as const, graceSlash: true as const } : {}), ...(ghostMode ? { ghost: true as const } : {}) };
    if (!respelled && accMode === 'n') {
      ni.accidentals = { 0: 'n' };
    } else if (conv.acc) {
      ni.accidentals = { 0: conv.acc };
    }
    if (tripletMode && !graceMode) ni.tuplet = 3;
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

    /* 지속 연음: 방금 넣은 음표까지 포함해 마지막 N개를 하나의 N연음으로
     * 다시 찍는다(3→4→5…). 렌더러는 "연속된 같은 tuplet 값"을 한 그룹으로
     * 묶으므로 이 재태깅만으로 화면·재생이 즉시 N연음이 된다. */
    if (sustainTuplet) {
      const n = sustainCountRef.current + 1;
      sustainCountRef.current = n;
      const start = Math.max(0, newNotes.length - n);
      newNotes = newNotes.map((nt, i) => (i >= start ? { ...nt, tuplet: n } : nt));
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
  }, [duration, dotted, accMode, tieNext, tripletMode, sustainTuplet, graceMode, ghostMode, curNotes, measures, maybeAutoClose, pushEditUndo, selectedNote, selectedMeasure, insertPos, insertNoteAt, updateNote, chordInput, staffMode, selectedBassMeasure, bassMeasures, explicitAcc]);

  /* ── MIDI 외부 기기 입력 ──────────────────────────────────────────────────
   * 선택된 MIDI 입력의 note-on 을 온스크린 피아노 입력과 동일 경로
   * (handleNotePress)로 태운다 → 길이·임시표·삽입·양손·화음 로직 그대로 재사용.
   * 벨로시티는 오디션 소리 세기에 반영(설정에 따라). 설정 UI 는 툴바 MIDI 탭. */
  const midiSettingsRef = useRef<{ auditionOnInput: boolean; velocityToAudition: boolean } | null>(null);
  const handleMidiNoteOn = useCallback((e: MidiNoteEvent) => {
    const pn = midiToPianoNote(e.midi);
    const s = midiSettingsRef.current;
    let gain: number | undefined;
    if (s && !s.auditionOnInput) gain = 0;                                   // 입력 시 무음
    else if (s && s.velocityToAudition) gain = Math.max(0.2, 2 * (e.velocity / 100)); // 세게 칠수록 크게
    handleNotePress(pn, gain !== undefined ? { gain } : undefined);
  }, [handleNotePress]);
  const midi = useMidiInput(handleMidiNoteOn);
  useEffect(() => { midiSettingsRef.current = midi.settings; }, [midi.settings]);

  const handleRest = useCallback((dur?: string) => {
    const d = dur ?? duration;
    const ni: NoteInfo = { keys: ['b/4'], duration: d + 'r', dotted: dotted || undefined, doubleDotted: doubleDotted || undefined };
    if (tripletMode && !graceMode) ni.tuplet = 3;
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
      editRedoStack.current.push(captureSnapshot());  // 되돌리기 전 현재 상태를 redo로.
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
    if (curNotes.length === 0 && measures.length === 0) return;
    editRedoStack.current.push(captureSnapshot());  // fallback undo도 redo로 복원 가능하게.
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
  }, [curNotes.length, measures, captureSnapshot]);

  /* redo — undo로 되돌린 상태를 다시 적용한다. handleUndo가 되돌리기 전 현재 상태를
   * redo 스택에 쌓아두므로, redo는 그 스냅샷을 그대로 복원하면 된다. */
  const handleRedo = useCallback(() => {
    if (editRedoStack.current.length === 0) return;
    editUndoStack.current.push(captureSnapshot());  // 다시 undo할 수 있게 현재를 undo로.
    const snap = editRedoStack.current.pop()!;
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
  }, [captureSnapshot]);

  /* 악보를 전부 비운다. 되돌릴 수 없는 동작이므로 (1) 내용이 있으면 확인을 받고
   * (2) pushEditUndo로 스냅샷을 남겨 Backspace(Undo)로 복구할 수 있게 한다.
   * 저장된 초안도 함께 지운다 — 안 그러면 새로고침 때 지운 악보가 되살아난다.
   * 음표 수는 totalNotes가 이 아래에서 선언되므로(TDZ) 여기서 직접 센다. */
  const handleClear = useCallback(() => {
    const noteCount = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length
      + (staffMode === 'grand' ? bassMeasures.reduce((s, m) => s + m.notes.length, 0) : 0);
    if (noteCount > 0
      && !window.confirm(`악보를 모두 지울까요? (음표 ${noteCount}개)\nUndo(Backspace)로 되돌릴 수 있습니다.`)) return;
    pushEditUndo();
    setMeasures([]);
    setBassMeasures([]);
    setCurNotes([]);
    setCurChord1('');
    setCurChord2('');
    setSelectedBassMeasure(null);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
  }, [measures, curNotes, bassMeasures, staffMode, pushEditUndo]);

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
      setExplicitAcc(data.accidentalStyle === 'explicit');
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
      // Ctrl+Z(Win/Linux) · Cmd+Z(macOS) = undo. Backspace와 동일 동작이며, 위의
      // 입력창 가드 덕에 제목·코드 입력 중에는 브라우저 기본 undo가 그대로 동작한다.
      // Ctrl/Cmd+Shift+Z = redo (관례).
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); handleUndo(); }
      if (e.key === 'Enter') { if (isComposingEvent(e)) return; e.preventDefault(); closeMeasure(); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setTieNext((v) => !v); }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        // Shift+T = 지속 연음(3+). 음표가 선택돼 있으면 T = 오른쪽 음과 붙임줄,
        // 선택이 없으면 셋잇단 토글('3' 키와 동일).
        if (e.shiftKey) toggleSustainTuplet();
        else if (selectedNote) tieSelectedToNext();
        else toggleTripletMode();
      }
      // S = 선택 음표에 스쿱(재즈 슬라이드) 토글
      if ((e.key === 's' || e.key === 'S') && selectedNote) {
        e.preventDefault();
        updateNote(
          selectedNote.mi, selectedNote.ni,
          (n) => ({ ...n, scoop: n.scoop ? undefined : true }),
          selectedNote.staff,
        );
      }
      if (e.key === '1') { e.preventDefault(); setDuration('w'); setDotted(false); }
      if (e.key === '2') { e.preventDefault(); setDuration('h'); setDotted(false); }
      if (e.key === '4') { e.preventDefault(); setDuration('q'); setDotted(false); }
      if (e.key === '8') { e.preventDefault(); setDuration('8'); setDotted(false); }
      if (e.key === '6') { e.preventDefault(); setDuration('16'); setDotted(false); }
      // 3 = 셋잇단 토글 (32분음표는 툴바 버튼으로 입력)
      if (e.key === '3') { e.preventDefault(); toggleTripletMode(); }

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
  }, [handleUndo, handleRedo, closeMeasure, allMeasures, selectedNote, stepSelectedNote, toggleTripletMode, toggleSustainTuplet, tieSelectedToNext, updateNote]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (allMeasures.length === 0) { el.innerHTML = ''; positionsRef.current = []; setMeasurePositions([]); notePositionsRef.current = []; return; }
    const validKey = sheetKey && (FLAT_KEYS[sheetKey] != null || SHARP_KEYS[sheetKey] != null || sheetKey === 'C') ? sheetKey : undefined;
    try {
      renderSheet(el, allMeasures, Math.max(sheetWidth, 300), currentIdx, activeIdx, positionsRef.current, validKey, notePositionsRef.current, multiSel, noteElMapRef.current, bassAll, explicitAcc);
    } catch {
      positionsRef.current.length = 0;
      notePositionsRef.current.length = 0;
      setSelectedNote(null);
    }
    setMeasurePositions([...positionsRef.current]);
    setNotePositions([...notePositionsRef.current]);
  }, [allMeasures, bassAll, sheetWidth, currentIdx, activeIdx, sheetKey, multiSel, explicitAcc]);

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

  /* 앵커가 바뀌면(=단일 선택/이동/삭제 등 모든 기존 경로) 복수 선택 해제.
   * Ctrl/Cmd 클릭은 앵커를 건드리지 않으므로 여기서 지워지지 않는다. */
  useEffect(() => { setExtraSel((prev) => (prev.length ? [] : prev)); }, [selectedNote]);

  /** N연음으로 묶을 수 있는 선택인지. 붙임(튜플렛)은 **한 보표·한 마디 안에서
   *  연속된** 음표에만 성립하므로, 흩어진 선택은 묶지 않는다(null). */
  const tupletGroupable = useMemo(() => {
    if (multiSel.length < 3) return null;
    const staff = multiSel[0].staff;
    const mi = multiSel[0].mi;
    if (multiSel.some((s) => s.staff !== staff || s.mi !== mi)) return null;
    const nis = [...multiSel.map((s) => s.ni)].sort((a, b) => a - b);
    for (let i = 1; i < nis.length; i++) if (nis[i] !== nis[i - 1] + 1) return null;
    return { mi, staff, nis };
  }, [multiSel]);

  /** 현재 선택이 이미 그 N연음으로 묶여 있는지 — 3+ 버튼 활성 표시용. */
  const selectionTupleted = useMemo(() => {
    const g = tupletGroupable;
    if (!g) return false;
    const src = g.staff === 'bass' ? bassMeasures : allMeasures;
    return g.nis.every((ni) => src[g.mi]?.notes[ni]?.tuplet === g.nis.length);
  }, [tupletGroupable, allMeasures, bassMeasures]);

  /** 선택한 N개를 N연음으로 묶는다(이미 그 N연음이면 해제). 렌더러는 "연속된
   *  같은 tuplet 값"을 한 그룹으로 보므로 N개 전부에 tuplet=N 을 찍으면 된다.
   *  undo 는 그룹 전체로 1회만 쌓이게 직접 setState 한다. */
  const applyTupletToSelection = useCallback(() => {
    const g = tupletGroupable;
    if (!g) return;
    const n = g.nis.length;
    const src = g.staff === 'bass' ? bassMeasures : allMeasures;
    const already = g.nis.every((ni) => src[g.mi]?.notes[ni]?.tuplet === n);
    const patch = (notes: NoteInfo[]) => notes.map((nt, j) => {
      if (!g.nis.includes(j)) return nt;
      const u: NoteInfo = { ...nt, tuplet: n };
      if (already) delete u.tuplet;
      return u;
    });
    pushEditUndo();
    if (g.staff === 'bass') {
      setBassMeasures((prev) => prev.map((m, i) => (i === g.mi ? { ...m, notes: patch(m.notes) } : m)));
    } else if (g.mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => (i === g.mi ? { ...m, notes: patch(m.notes) } : m)));
    } else {
      setCurNotes((prev) => patch(prev));
    }
  }, [tupletGroupable, allMeasures, bassMeasures, measures.length, pushEditUndo]);

  const handleSheetClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 드래그(또는 음표 위 pointerdown)가 처리한 포인터의 뒤따르는 click은 한 번 무시.
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
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
      const hit: NoteSel = { mi: best.mi, ni: best.ni, ...(staff ? { staff } : {}) };
      const same = (a: NoteSel, b: NoteSel) => a.mi === b.mi && a.ni === b.ni && a.staff === b.staff;
      // Ctrl(Win)/Cmd(Mac) + 클릭 = 복수 선택 토글. 앵커(selectedNote)는 건드리지
      // 않는다 — 앵커가 바뀌면 복수 선택이 초기화되기 때문.
      if ((e.ctrlKey || e.metaKey) && selectedNote) {
        if (!same(hit, selectedNote)) {
          setExtraSel((prev) => (prev.some((s) => same(s, hit))
            ? prev.filter((s) => !same(s, hit))
            : [...prev, hit]));
        }
        setSelectedMeasure(null);
        setSelectedBassMeasure(null);
        return;
      }
      if (selectedNote && same(hit, selectedNote)) {
        setSelectedNote(null);
      } else {
        setSelectedNote(hit);
      }
      setSelectedMeasure(null);
      setSelectedBassMeasure(null);
      return;
    }
    setSelectedNote(null);
    // 음표 근처가 아니면 마디 히트테스트 — 빈 마디도 선택 가능. 트레블은
    // committed 만(입력 중인 열린 마디는 기존 입력 플로우가 담당), 베이스는
    // 렌더된 모든 마디(열린 마디 아래 포함).
    let bestM: { idx: number; staff?: 'bass' } | null = null;
    let bestMDist = Infinity;
    for (const p of positionsRef.current) {
      if (p.staff !== 'bass' && p.idx >= measures.length) continue;
      if (cx < p.x - 6 || cx > p.x + p.w + 6) continue;
      // 오선(5줄) 안을 눌렀을 때만 마디를 활성화한다. 오선 위쪽 여백은 코드
      // 심볼 자리이고 아래쪽은 다음 행과 맞닿으므로, 그 여백까지 판정에 넣으면
      // 아래 행의 코드를 만질 때 윗행 마디가 잡힌다(행 겹침). 양손 모드의
      // 트레블/베이스도 각자 실제 오선 범위로 판정돼 서로 침범하지 않는다.
      if (cy < p.staveTop - STAFF_HIT_PAD || cy > p.staveBot + STAFF_HIT_PAD) continue;
      const dy = Math.abs(cy - (p.staveTop + p.staveBot) / 2);
      if (dy < bestMDist) { bestMDist = dy; bestM = { idx: p.idx, staff: p.staff }; }
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
  }, [selectedNote, measures.length]);

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

  /* 저장/복사에 실을 마디 — '조표 무시'면 기본 해석(score)으로 읽어도 같은 소리가
   * 나도록 임시표를 구워둔다. 백엔드가 accidentalStyle 을 저장하지 않아(BR-33)
   * 다시 열면 score 로 읽히는데, 굽지 않으면 조표·마디내 상속이 얹혀 에디터에서
   * 듣던 것과 다른 음이 나온다(실측: Bolivia 132음). 소리는 불변, 표기만 명시화. */
  const outMeasures = useMemo<MeasureInfo[]>(
    () => (explicitAcc ? bakeForScoreReading(allMeasures, sheetKey) : allMeasures),
    [explicitAcc, allMeasures, sheetKey],
  );
  const bassOut = useMemo<MeasureInfo[] | null>(
    () => (explicitAcc && bassForOut ? bakeForScoreReading(bassForOut, sheetKey) : bassForOut),
    [explicitAcc, bassForOut, sheetKey],
  );

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
      measures: outMeasures,
      ...(bassOut ? { bassMeasures: bassOut } : {}),
      ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
    };
    return JSON.stringify(entry, null, 2);
  }, [outMeasures, bassOut, sheetTitle, composer, genre, sheetKey, bpm, explicitAcc]);

  /* 재생 — 입력한 멜로디를 풀 백킹 밴드(베이스/드럼/피아노 1·3박 컴핑)와 함께
   * GlobalPlayer(kind:'sheet')로 돌린다. 코드차트와 동일한 backing 엔진. */
  const buildSheet = useCallback((): NoteSheetData => ({
    title: sheetTitle || (mode === 'solo' ? 'Untitled Solo' : 'Untitled Lick'),
    composer: composer || 'Unknown',
    key: sheetKey,
    timeSignature: '4/4',
    tempo: bpm,
    ...(genre ? { genre } : {}),
    measures: outMeasures,
    ...(bassOut ? { bassMeasures: bassOut } : {}),
    ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
  }), [sheetTitle, composer, sheetKey, bpm, genre, outMeasures, bassOut, mode, explicitAcc]);

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
  /* ── 대체(리하모니제이션) 코드 ─────────────────────────────────────────
   * 마디 위에 괄호로 감싼 ALT_SLOTS 칸을 띄운다. 코드 칸(또는 대체 칸) 우클릭
   * 드롭다운으로 켜고 끈다. 열린 마디는 curAltChords, 확정 마디는
   * MeasureInfo.altChords 에 보관. */
  const setMeasureAlt = useCallback((idx: number, next: string[] | undefined) => {
    if (idx === measures.length) { setCurAltChords(next); return; }
    setMeasures((prev) => prev.map((m, i) => {
      if (i !== idx) return m;
      if (!next) { const { altChords: _drop, ...rest } = m; return rest; }
      return { ...m, altChords: next };
    }));
  }, [measures.length]);

  const updateAltSlot = useCallback((idx: number, slot: number, value: string) => {
    if (idx === measures.length) {
      setCurAltChords((prev) => {
        const next = [...(prev ?? Array(ALT_SLOTS).fill(''))];
        next[slot] = value;
        return next;
      });
      return;
    }
    setMeasures((prev) => prev.map((m, i) => {
      if (i !== idx || !m.altChords) return m;
      const next = [...m.altChords];
      next[slot] = value;
      return { ...m, altChords: next };
    }));
  }, [measures.length]);

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
          measures: outMeasures,
          bassMeasures: bassOut ?? undefined,
          accidentalStyle: explicitAcc ? 'explicit' : undefined,
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
        /* 목록이 아니라 방금 저장한 그 악보로 — 수정사항을 바로 확인할 수 있게. */
        navigate(`/solos?solo=${encodeURIComponent(persisted.publicId)}`);
      } else if (mode === 'comping') {
        /* Comping — 백엔드 미구현. localStorage(compingData)에만 저장한다.
         * 장르는 상단바 셀렉트에서 고른 값. 제목/작곡자는 solo 와 동일 규칙. */
        const sheet: NoteSheetData = {
          title: sheetTitle || 'Untitled',
          composer: composer || 'Unknown',
          key: sheetKey,
          timeSignature: '4/4',
          tempo: bpm,
          measures: outMeasures,
          ...(bassOut ? { bassMeasures: bassOut } : {}),
          ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
        };
        const fields = {
          title: sheetTitle || 'Untitled',
          genre: compingGenre,
          composer: composer || undefined,
          key: sheetKey,
          tempo: bpm,
          sheetData: sheet,
        };
        const saved = (editingCompingId ? updateComping(editingCompingId, fields) : null)
          ?? createComping(fields);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
        navigated = true;
        navigate(`/comping?item=${encodeURIComponent(saved.id)}`);
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
          performer: performer || composer || 'Unknown',
          title: sheetTitle || 'Untitled',
          instrument: metaInstrument,
          album,
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
            measures: outMeasures,
            ...(bassOut ? { bassMeasures: bassOut } : {}),
            ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
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
  }, [mode, allMeasures, outMeasures, bassOut, sheetTitle, composer, genre, sheetKey, bpm, saving, editingLickId, navigate, compingGenre, editingCompingId, explicitAcc]);

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
        <BackButton onClick={() => navigate(-1)} label="이전 페이지" />
        <Title>Editor</Title>
        <Spacer />
        {/* ? — 단축키 목록. 건반 아래 안내줄과 같은 내용을 팝오버로 편히 본다. */}
        <HelpAnchor ref={shortcutRef}>
          <ToolBtn
            type="button"
            title="단축키 보기"
            $lit={shortcutOpen}
            onClick={() => setShortcutOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={shortcutOpen}
          >
            <HelpIcon />
          </ToolBtn>
          {shortcutOpen && (
            <ShortcutPop role="dialog" aria-label="단축키">
              <ShortcutTitle>단축키</ShortcutTitle>
              {SHORTCUTS.map((g) => (
                <div key={g.group}>
                  <ShortcutGroup>{g.group}</ShortcutGroup>
                  {g.items.map(([key, desc]) => (
                    <ShortcutRow key={key}>
                      <Kbd>{key}</Kbd>
                      <span>{desc}</span>
                    </ShortcutRow>
                  ))}
                </div>
              ))}
            </ShortcutPop>
          )}
        </HelpAnchor>
        {/* MIDI(왼쪽) → 설정(오른쪽). 트랜스포트 바 우측에 있던 것을 최상단 바로 옮겼다. */}
        <ToolBtn
          type="button"
          title="MIDI 외부 기기(피아노 등) 입력 설정"
          $lit={midi.enabled && !!midi.settings.inputId}
          onClick={() => { if (!midi.enabled) midi.requestAccess(); setToolTab('midi'); }}
        >
          <MidiIcon />
        </ToolBtn>
        <ToolBtn
          type="button"
          title="에디터 설정 — 조표 무시 등"
          $lit={explicitAcc}
          onClick={() => openPerformanceSettings('editor')}
        >
          <GearIcon />
        </ToolBtn>
        <Sep />
        <JsonBtn
          $bg="#c62828"
          $hover="#ad1f1f"
          onClick={handleClear}
          disabled={totalNotes === 0}
          title="악보 전체 지우기 — 확인 후 삭제, Undo(Backspace)로 복구 가능"
        >
          Clear
        </JsonBtn>
        <JsonBtn $bg="#26a69a" $hover="#00897b" onClick={handleCopy} disabled={totalNotes === 0}>
          {copied ? '✓ Copied!' : 'Copy JSON'}
        </JsonBtn>
        <JsonBtn $bg="#7b1fa2" $hover="#6a1b9a" onClick={() => { setShowLoadModal(true); setLoadJsonText(''); setLoadJsonError(''); }}>
          Load JSON
        </JsonBtn>
        {/* YouTube Onset button removed from Editor toolbar */}
        <SaveIconBtn
          type="button"
          onClick={handleSave}
          disabled={totalNotes === 0 || saving}
          $busy={saving}
          $error={!saving && !!saveError}
          title={saveLabel}
          aria-label={saveLabel}
        >
          {saving ? <SaveSpinnerIcon /> : <SaveIcon />}
        </SaveIconBtn>
      </Header>



      {/* 상단 트랜스포트 바 — 코드차트와 동일한 믹서/재생 컨트롤. 믹서 버튼은
          클릭 시 팝오버(좁은 화면은 모달)로 트랙들을 띄운다. */}

      {/* 상단 탭 — 섹션 위에 얹는 줄. 섹션 내부는 그대로 두고 이 줄만 추가했다. */}
      <TabBar>
        <TabList>
          {TOOL_TABS.map((t) => (
            <TabItem key={t.id} type="button" $on={toolTab === t.id} onClick={() => setToolTab(t.id)}>
              {t.label}
            </TabItem>
          ))}
        </TabList>
        <TabSpacer />
        {/* 믹서·BPM·반복·재생 — 탭 바 정중앙. */}
        <TabPlayer>
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
        </TabPlayer>
        <TabSpacer />
        <TabIcons>
          <TabIconBtn type="button" title="되돌리기" onClick={handleUndo}>{TIco.undo}</TabIconBtn>
          <TabIconBtn type="button" title="다시하기" onClick={handleRedo}>{TIco.redo}</TabIconBtn>
          <TabDivider />
          {/* 아래부터는 디자인용 — 동작은 아직 연결하지 않았다. */}
          <TabIconBtn type="button" title="추가 (준비 중)">{TIco.add}</TabIconBtn>
          <TabIconBtn type="button" title="잘라내기 (준비 중)">{TIco.cut}</TabIconBtn>
          <TabIconBtn type="button" title="선택 (준비 중)">{TIco.check}</TabIconBtn>
          <TabDivider />
          <TabIconBtn type="button" title="내려받기 (준비 중)">{TIco.down}</TabIconBtn>
          <TabIconBtn type="button" title="인쇄 (준비 중)">{TIco.print}</TabIconBtn>
          <TabIconBtn type="button" title="레이아웃 (준비 중)">{TIco.layout}</TabIconBtn>
          <TabDivider />
          <TabIconBtn type="button" title="확대 (준비 중)">{TIco.zin}</TabIconBtn>
          <TabIconBtn type="button" title="축소 (준비 중)">{TIco.zout}</TabIconBtn>
          <TabIconBtn type="button" title="정지 (준비 중)">{TIco.pause}</TabIconBtn>
        </TabIcons>
      </TabBar>

      {toolTab === 'midi' ? (
        /* MIDI 탭 — 예전 톱니 옆 MIDI 버튼이 띄우던 모달의 내용. */
        <MidiTabPanel>
          <MidiSettingsBody midi={midi} />
        </MidiTabPanel>
      ) : toolTab === 'info' ? (
        /* 정보 탭 — 제목·작곡가·악보 메타데이터·장르/조성·믹서/재생을 한곳에 모았다. */
        <InfoTabPanel>
          {/* 1) 데이터·메타데이터 */}
          <InfoSection>
            <InfoCols>
              {/* 바 높이는 음표 탭 기준으로 고정 — 한 열에 3줄까지만 두고 넘치면 다음 열로. */}
              <InfoCol>
                <MetaField><MetaLabel>Title</MetaLabel><MetaInput value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} placeholder="e.g. Autumn Leaves" /></MetaField>
                <MetaField><MetaLabel>Album</MetaLabel><MetaInput value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="e.g. Bird & Diz" /></MetaField>
                <MetaField><MetaLabel>Composer</MetaLabel><MetaInput value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="e.g. Joseph Kosma" /></MetaField>
              </InfoCol>

              <InfoCol>
                <MetaField><MetaLabel>Player</MetaLabel><MetaInput value={performer} onChange={(e) => setPerformer(e.target.value)} placeholder="e.g. Charlie Parker" /></MetaField>
                <MetaField>
                  <MetaLabel>Instrument</MetaLabel>
                  {/* 내 코드 차트의 악기 아이콘 드롭다운을 그대로 쓰고, 목록에 없으면 직접 입력. */}
                  <SessionPicker value={metaInstrument} onChange={setMetaInstrument} allowCustom />
                </MetaField>
                <MetaField>
                  <MetaLabel>Type</MetaLabel>
                  <SegGroup $n={3} $i={['solo', 'lick', 'comping'].indexOf(mode)}>
                    <SegThumb $n={3} $i={['solo', 'lick', 'comping'].indexOf(mode)} />
                    {(['solo', 'lick', 'comping'] as const).map((m) => (
                      <SegBtn key={m} type="button" $on={mode === m} disabled={editingLickId !== null} onClick={() => setMode(m)}>{MODE_LABEL[m]}</SegBtn>
                    ))}
                  </SegGroup>
                </MetaField>
              </InfoCol>

              <InfoCol>
                <MetaField>
                  <MetaLabel>보표 {staffModeLocked && <LockedHint title="불러온 악보의 보표 수로 자동 확정">🔒</LockedHint>}</MetaLabel>
                  <SegGroup $n={2} $i={staffMode === 'single' ? 0 : 1}>
                    <SegThumb $n={2} $i={staffMode === 'single' ? 0 : 1} />
                    {(['single', 'grand'] as const).map((v) => (
                      <SegBtn
                        key={v}
                        type="button"
                        $on={staffMode === v}
                        disabled={staffModeLocked}
                        onClick={() => {
                          setStaffMode(v);
                          if (v === 'single') { setSelectedBassMeasure(null); setSelectedNote((sel) => (sel?.staff === 'bass' ? null : sel)); }
                        }}
                      >{v === 'single' ? '한손' : '양손'}</SegBtn>
                    ))}
                  </SegGroup>
                </MetaField>
                <MetaField><MetaLabel>Genre</MetaLabel><GenreSelect value={genre} onChange={setGenre} /></MetaField>
                <MetaField>
                  <MetaLabel>Key</MetaLabel>
                    <KeyAnchor>
                    <KeyDisplay
                    type="button"
                    $open={transposeOpen}
                    title="Transpose · 조성 변경(음표까지 실제로 이조)"
                    aria-haspopup="dialog"
                    aria-expanded={transposeOpen}
                    onClick={() => setTransposeOpen((v) => !v)}
                    >
                    <span className="key-text">
                    {sheetKey.replace(/m$/, '').replace(/b/g, '♭').replace(/#/g, '♯')}
                    <KeyQualEP>{isMinorKey(sheetKey) ? '단조' : '장조'}</KeyQualEP>
                    </span>
                    <span className="key-ico" aria-hidden><IcoTranspose /></span>
                    </KeyDisplay>
                    {transposeOpen && (
                    <KeyChangePopover
                    currentKey={sheetKey.replace(/b/g, '♭').replace(/#/g, '♯')}
                    value={keyInput}
                    onChange={setKeyInput}
                    busy={false}
                    onApplyTranspose={() => { applyTranspose(keyInput.trim()); setKeyInput(''); }}
                    onApplyKeyOnly={() => { applyKeyOnly(keyInput.trim()); setKeyInput(''); }}
                    onPreset={(semi) => { const to = shiftDisplayKeyBySemitones(sheetKey, semi); if (to) applyTranspose(to); }}
                    onOctave={(dir) => handleShiftOctave(dir)}
                    octaveDisabled={totalNotes === 0}
                    onClose={() => setTransposeOpen(false)}
                    />
                    )}
                    </KeyAnchor>
                </MetaField>
              </InfoCol>
            </InfoCols>
          </InfoSection>

        </InfoTabPanel>
      ) : toolTab === 'measure' ? (
        /* 마디 탭 — 마디가 활성일 때만 열린다(음표가 활성이면 그 음표의 마디). */
        activeMeasureIdx == null ? (
          <TabPlaceholder>마디를 선택하면 여기에서 편집할 수 있어요.</TabPlaceholder>
        ) : (
          <MeasureTabBar>
            <span className="mlabel">마디 {activeMeasureIdx + 1} · 🎹 입력은 이 마디로</span>
            <button type="button" onClick={() => { insertMeasureBefore(activeMeasureIdx); setSelectedMeasure(activeMeasureIdx + 1); }}>◀ 앞에 삽입</button>
            <button type="button" onClick={() => insertMeasureAfter(activeMeasureIdx)}>뒤에 삽입 ▶</button>
            <button
              type="button"
              onClick={() => {
                const cnt = measures[activeMeasureIdx]?.notes.length ?? 0;
                if (cnt > 0 && !window.confirm(`마디 ${activeMeasureIdx + 1}(음표 ${cnt}개)를 비울까요?`)) return;
                pushEditUndo();
                setMeasures((prev) => prev.map((m, i) => (i === activeMeasureIdx ? { ...m, notes: [] } : m)));
              }}
            >🧹 비우기</button>
            <button
              type="button"
              onClick={() => {
                const cnt = measures[activeMeasureIdx]?.notes.length ?? 0;
                if (cnt > 0 && !window.confirm(`마디 ${activeMeasureIdx + 1}(음표 ${cnt}개)를 삭제할까요?`)) return;
                deleteMeasure(activeMeasureIdx);
              }}
            >🗑 삭제</button>
            <button type="button" onClick={() => { setSelectedMeasure(null); setSelectedNote(null); }}>선택 해제</button>
          </MeasureTabBar>
        )
      ) : toolTab !== 'note' ? (
        <TabPlaceholder>
          {TOOL_TABS.find((t) => t.id === toolTab)?.label} 탭 — 준비 중입니다.
        </TabPlaceholder>
      ) : (
      <ToolBar>
        <DurGroup>
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
        </DurGroup>
        {/* 두 번째 섹션 — 점/겹점 · 연음 · 임시표. 내츄럴(♮)은 여기서 빼고 아래
            선택 음표 상세 바에서만 다룬다(피아노 입력이 내츄럴을 판별하므로). */}
        <ModGroup>
          <ModCol>
            <DurBtn
              $active={dotted}
              onClick={() => { setDotted((v) => !v); setDoubleDotted(false); }}
              title="점음표 — 원래 길이의 1.5배"
            ><DotGlyph n={1} /></DurBtn>
            <DurBtn
              $active={doubleDotted}
              onClick={() => { setDoubleDotted((v) => !v); setDotted(false); }}
              title="겹점음표 — 원래 길이의 1.75배"
            ><DotGlyph n={2} /></DurBtn>
          </ModCol>
          <ModCol>
            <DurBtn
              $active={tripletMode}
              onClick={toggleTripletMode}
              title="3연음 — 3개 입력하면 자동 해제 (T)"
            ><TupletGlyph /></DurBtn>
            <DurBtn
              $active={sustainTuplet}
              onClick={toggleSustainTuplet}
              title="지속 연음 — 다시 누를 때까지 계속 한 묶음으로 이어붙입니다 (4·5·6·7연음). 단축키 Shift+T"
            ><TupletGlyph plus /></DurBtn>
          </ModCol>
          <ModCol>
            {/* ♯ / ♭ 는 라디오 — 하나를 켜면 다른 하나가 꺼진다. */}
            <DurBtn $active={accMode === '#'} onClick={() => setAccMode('#')} title="Sharp mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>&#9839;</DurBtn>
            <DurBtn $active={accMode === 'b'} onClick={() => setAccMode('b')} title="Flat mode" style={{ fontSize: '1.2rem', fontWeight: 700 }}>&#9837;</DurBtn>
          </ModCol>
          <ModCol>
          <DurBtn
            $active={graceMode}
            onClick={() => setGraceMode((v) => !v)}
            title="꾸밈음 모드 — 먼저 원음을 선택한 뒤 켜고 피아노를 누르면 그 음 '앞'에 작은 슬래시 꾸밈음(acciaccatura)이 붙습니다(선택 안 하면 다음에 칠 음의 꾸밈음이 됩니다). 마디 길이엔 영향 없이 정박 직전 짧게 재생."
            style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}
          >
            {/* 작은 슬래시 꾸밈음(사선 그은 8분음표) */}
            <svg width="18" height="22" viewBox="0 0 18 22" style={{ display: 'block' }}>
              <ellipse cx="7" cy="16" rx="3.2" ry="2.3" fill="currentColor" transform="rotate(-20 7 16)" />
              <line x1="9.7" y1="15" x2="9.7" y2="3" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9.7 3 C 12 4, 13 6.5, 12 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <line x1="4" y1="11" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </DurBtn>
          <DurBtn
            $active={ghostMode}
            onClick={() => setGhostMode((v) => !v)}
            title="고스트(데드) 노트 모드 — 켜고 피아노를 누르면 그 음이 X 노트헤드의 고스트 노트로 입력됩니다. 다시 누르면 해제."
            style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}
          >
            {/* X 노트헤드 + 기둥 */}
            <svg width="18" height="22" viewBox="0 0 18 22" style={{ display: 'block' }}>
              <line x1="4.5" y1="13.5" x2="10.5" y2="18.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              <line x1="10.5" y1="13.5" x2="4.5" y2="18.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              <line x1="11" y1="16" x2="11" y2="3.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </DurBtn>
          </ModCol>
          <ModCol>
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
            {/* 마디 닫기 — 섹션2의 다른 버튼과 같은 규격(DurBtn)으로 통일. */}
            <DurBtn
              onClick={closeMeasure}
              disabled={curNotes.length === 0}
              title="Close measure (Enter)"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', fontWeight: 900 }}
            >|</DurBtn>
          </ModCol>
          <ModCol>
          <DurBtn $active={tieNext} onClick={() => setTieNext((v) => !v)} title="Tie to next note (L)" style={{ fontSize: '1.3rem' }}>
            <svg width="22" height="16" viewBox="0 0 18 14" style={{ display: 'block' }}>
              <path d="M2 4 Q9 14 16 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </DurBtn>

          {/* 악보 기호 추가 — 8va/8vb·도돌이표·볼타·세뇨/코다·브라켓을 '+' 하나로 모았다.
            * 개별 버튼으로 늘어놓으면 툴바가 길어져 음표 버튼이 밀려났다. 자주 쓰는
            * 입력 토글(Tie·꾸밈음·고스트·화음)은 툴바에 그대로 남긴다. */}
          <MarkWrap ref={markMenuRef}>
            <DurBtn
              $active={markMenuOpen || markCount > 0}
              onClick={() => setMarkMenuOpen((v) => !v)}
              title="기호 추가 — 8va/8vb · 도돌이표 · 볼타 · 세뇨/코다 · 브라켓"
              aria-haspopup="menu"
              aria-expanded={markMenuOpen}
              style={{ fontSize: '1.7rem', fontWeight: 300, lineHeight: 1, position: 'relative' }}
            >
              +
              {markCount > 0 && <MarkBadge>{markCount}</MarkBadge>}
            </DurBtn>

            {markMenuOpen && (
              <MarkMenu role="menu">
                <MarkGroup>
                  <MarkTitle>옥타브</MarkTitle>
                  <MarkRow>
                    <MarkBtn
                      $active={ottavaMode === '8va'}
                      onClick={() => handleOttavaToggle('8va')}
                      title="한 번 눌러 시작, 마지막 음에서 다시 눌러 닫기"
                    >
                      <MarkGlyph style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontWeight: 700, fontSize: '0.95rem' }}>8va</MarkGlyph>
                      <MarkLabel>옥타브 위</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={ottavaMode === '8vb'}
                      onClick={() => handleOttavaToggle('8vb')}
                      title="한 번 눌러 시작, 마지막 음에서 다시 눌러 닫기"
                    >
                      <MarkGlyph style={{ fontStyle: 'italic', fontFamily: "'Times New Roman', serif", fontWeight: 700, fontSize: '0.95rem' }}>8vb</MarkGlyph>
                      <MarkLabel>옥타브 아래</MarkLabel>
                    </MarkBtn>
                  </MarkRow>
                </MarkGroup>

                <MarkGroup>
                  <MarkTitle>반복</MarkTitle>
                  <MarkRow>
                    <MarkBtn
                      $active={repeatStart}
                      onClick={() => { pushEditUndo(); setRepeatStart((v) => !v); }}
                      title="Repeat start"
                    >
                      <MarkGlyph>
                        <svg width="16" height="22" viewBox="0 0 16 22"><line x1="2" y1="1" x2="2" y2="21" stroke="currentColor" strokeWidth="2.5"/><line x1="5.5" y1="1" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/><circle cx="10" cy="14" r="1.7" fill="currentColor"/></svg>
                      </MarkGlyph>
                      <MarkLabel>도돌이 시작</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={repeatEnd}
                      onClick={() => { pushEditUndo(); setRepeatEnd((v) => !v); }}
                      title="Repeat end"
                    >
                      <MarkGlyph>
                        <svg width="16" height="22" viewBox="0 0 16 22"><circle cx="6" cy="8" r="1.7" fill="currentColor"/><circle cx="6" cy="14" r="1.7" fill="currentColor"/><line x1="10.5" y1="1" x2="10.5" y2="21" stroke="currentColor" strokeWidth="1"/><line x1="14" y1="1" x2="14" y2="21" stroke="currentColor" strokeWidth="2.5"/></svg>
                      </MarkGlyph>
                      <MarkLabel>도돌이 끝</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={volta === 1}
                      onClick={() => { pushEditUndo(); setVolta((v) => v === 1 ? 0 : 1); }}
                      title="1st ending"
                    >
                      <MarkGlyph>
                        <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">1.</text></svg>
                      </MarkGlyph>
                      <MarkLabel>1번 괄호</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={volta === 2}
                      onClick={() => { pushEditUndo(); setVolta((v) => v === 2 ? 0 : 2); }}
                      title="2nd ending"
                    >
                      <MarkGlyph>
                        <svg width="22" height="18" viewBox="0 0 22 18"><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">2.</text></svg>
                      </MarkGlyph>
                      <MarkLabel>2번 괄호</MarkLabel>
                    </MarkBtn>
                  </MarkRow>
                </MarkGroup>

                <MarkGroup>
                  <MarkTitle>내비게이션</MarkTitle>
                  <MarkRow>
                    <MarkBtn
                      $active={navigation === 'segno'}
                      onClick={() => { pushEditUndo(); setNavigation((v) => v === 'segno' ? '' : 'segno'); }}
                      title="Segno"
                    >
                      <MarkGlyph style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.4rem' }}>{''}</MarkGlyph>
                      <MarkLabel>세뇨</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={navigation === 'coda'}
                      onClick={() => { pushEditUndo(); setNavigation((v) => v === 'coda' ? '' : 'coda'); }}
                      title="Coda"
                    >
                      <MarkGlyph style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.4rem' }}>{''}</MarkGlyph>
                      <MarkLabel>코다</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={navigation === 'toCoda'}
                      onClick={() => { pushEditUndo(); setNavigation((v) => v === 'toCoda' ? '' : 'toCoda'); }}
                      title="To Coda"
                    >
                      <MarkGlyph style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1rem' }}>
                        <span style={{ fontFamily: "'Pretendard', sans-serif", fontSize: '0.72rem', fontWeight: 700, fontStyle: 'italic', marginRight: 1 }}>To</span>{''}
                      </MarkGlyph>
                      <MarkLabel>To Coda</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={navigation === 'fine'}
                      onClick={() => { pushEditUndo(); setNavigation((v) => v === 'fine' ? '' : 'fine'); }}
                      title="Fine"
                    >
                      <MarkGlyph style={{ fontSize: '0.9rem', fontWeight: 700, fontStyle: 'italic' }}>Fine</MarkGlyph>
                      <MarkLabel>피네</MarkLabel>
                    </MarkBtn>
                  </MarkRow>
                  <MarkSelectRow>
                    <MarkSelectLabel>다 카포 · 달 세뇨</MarkSelectLabel>
                    <NavSelect
                      value={navigation && ['dc', 'dcAlCoda', 'dcAlFine', 'ds', 'dsAlCoda', 'dsAlFine'].includes(navigation) ? navigation : ''}
                      onChange={(e) => { pushEditUndo(); setNavigation(e.target.value as NavigationMarker | ''); }}
                    >
                      <option value="">없음</option>
                      <option value="dc">D.C.</option>
                      <option value="dcAlCoda">D.C. al Coda</option>
                      <option value="dcAlFine">D.C. al Fine</option>
                      <option value="ds">D.S.</option>
                      <option value="dsAlCoda">D.S. al Coda</option>
                      <option value="dsAlFine">D.S. al Fine</option>
                    </NavSelect>
                  </MarkSelectRow>
                </MarkGroup>

                <MarkGroup>
                  <MarkTitle>기타</MarkTitle>
                  <MarkRow>
                    <MarkBtn
                      $active={bracket}
                      onClick={() => { pushEditUndo(); setBracket((v) => !v); }}
                      title="Intro bracket"
                    >
                      <MarkGlyph style={{ fontWeight: 300, fontFamily: 'serif', fontSize: '1.15rem' }}>(&thinsp;)</MarkGlyph>
                      <MarkLabel>인트로 브라켓</MarkLabel>
                    </MarkBtn>
                  </MarkRow>
                </MarkGroup>
              </MarkMenu>
            )}
          </MarkWrap>
          </ModCol>
        </ModGroup>

        {/* 세 번째 섹션 — 악보 상태(위) + undo/redo(아래). 중요 영역이라 골드 테두리. */}
        <GoldGroup $mode={editMode === 'note' ? 'note' : 'none'}>
          {/* 좌측 상단 = 지금 무엇이 활성인지. 그 뒤에 '현재/전체 마디'와 '현재 박'만. */}
          <StatusChip>
            <ModeTag $mode={editMode}>
              {editMode === 'note' ? '음표 활성화' : editMode === 'measure' ? '마디 활성화' : '선택 없음'}
            </ModeTag>
            <StatusItem><b>{Math.min(measures.length + 1, Math.max(allMeasures.length, 1))}</b>/{allMeasures.length} bars</StatusItem>
            <StatusDot />
            <StatusItem $warn={curBeats > 4}><b>{curBeats}</b>/4 beats</StatusItem>
          </StatusChip>
          {/* 음표 모드 — 아래에 있던 편집 바를 이 섹션으로 옮겼다. */}
        {selectedNote && selectedNote.staff !== 'bass' && selNoteInfo && (() => {
          const isRest = selNoteInfo.duration.endsWith('r');
          return (
          <SectionedEditBar>
              <EditWrap>
                {/* N연음 묶기 — Ctrl/Cmd+클릭으로 3개 이상 골랐을 때만 보인다.
                    2개 이하면 자리만 남기고 숨겨(visibility) 옆 버튼이 밀리지 않게 한다. */}
                <NoteEditBtn
                  $active={selectionTupleted}
                  disabled={multiSel.length >= 3 && !tupletGroupable}
                  onClick={applyTupletToSelection}
                  style={multiSel.length < 3 ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
                  title={multiSel.length < 3 ? undefined
                    : tupletGroupable
                      ? `선택한 ${multiSel.length}개를 ${multiSel.length}연음으로 ${selectionTupleted ? '해제' : '묶기'}`
                      : '한 마디 안에서 연속된 음표만 묶을 수 있다'}
                >3+</NoteEditBtn>
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
                {!isRest && (
                  <NoteEditBtn
                    $active={!!selNoteInfo.scoop}
                    onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, scoop: !n.scoop || undefined }))}
                    title="스쿱 — 음표 앞에서 아래→위로 끌어올려 진입"
                  >
                    <svg width="20" height="15" viewBox="0 0 20 15" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                      <path d="M3 13 Q4 4 12 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                      <circle cx="14.5" cy="3" r="2.2" fill="currentColor" />
                    </svg>
                    {' '}Scoop
                  </NoteEditBtn>
                )}
                {!isRest && (
                  <NoteEditBtn
                    $active={!!selNoteInfo.fall}
                    onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => ({ ...n, fall: !n.fall || undefined }))}
                    title="폴 — 음표 뒤에서 아래로 떨어지는 곡선"
                  >
                    <svg width="20" height="15" viewBox="0 0 20 15" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                      <circle cx="5.5" cy="3" r="2.2" fill="currentColor" />
                      <path d="M8 3 Q16 4 17 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                    </svg>
                    {' '}Fall
                  </NoteEditBtn>
                )}
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
                {!isRest && (<>
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
                    title="Fermata"
                    style={{ fontSize: '1.0rem', fontFamily: 'serif' }}
                  >𝄐</NoteEditBtn>
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
                    <option value="mordent">mordent</option>
                    <option value="inverted-mordent">inv-mor</option>
                    <option value="turn">turn</option>
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
                    onClick={() => updateNote(selectedNote.mi, selectedNote.ni, (n) => (
                      n.grace
                        ? { ...n, grace: undefined, graceSlash: undefined }
                        : { ...n, grace: true as const, graceSlash: true as const }
                    ))}
                    title="꾸밈음(acciaccatura) 토글"
                    style={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1 }}
                  >
                    <svg width="16" height="20" viewBox="0 0 18 22" style={{ display: 'block' }}>
                      <ellipse cx="7" cy="16" rx="3.2" ry="2.3" fill="currentColor" transform="rotate(-20 7 16)" />
                      <line x1="9.7" y1="15" x2="9.7" y2="3" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M9.7 3 C 12 4, 13 6.5, 12 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
                      <line x1="4" y1="11" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </NoteEditBtn>
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
                </>)}
              </EditWrap>


            {/* 섹션 3: 부가 (빔·코드·옥타브·마디·구조) */}
              <EditWrap>
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
                  >{''}</NoteEditBtn>
                  <NoteEditBtn
                    $active={selMeasure.navigation === 'coda'}
                    onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'coda' ? undefined : 'coda' }))}
                    style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '1.1rem' }}
                  >{''}</NoteEditBtn>
                  <NoteEditBtn
                    $active={selMeasure.navigation === 'fine'}
                    onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'fine' ? undefined : 'fine' }))}
                    style={{ fontSize: '0.65rem', fontWeight: 700, fontStyle: 'italic' }}
                  >Fine</NoteEditBtn>
                  <NoteEditBtn
                    $active={selMeasure.navigation === 'toCoda'}
                    onClick={() => updateMeasure(selectedNote.mi, (m) => ({ ...m, navigation: m.navigation === 'toCoda' ? undefined : 'toCoda' }))}
                    style={{ fontFamily: "'MuseJazz Text', serif", fontSize: '0.75rem' }}
                  ><span style={{ fontFamily: "'Pretendard', sans-serif", fontSize: '0.6rem', fontWeight: 700, fontStyle: 'italic', marginRight: 1 }}>To</span>{''}</NoteEditBtn>
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
                {selectedNote && selectedNote.mi < measures.length && (<>
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
                <NoteEditBtn onClick={() => setSelectedNote(null)}>× Deselect</NoteEditBtn>
              </EditWrap>
          </SectionedEditBar>
          );
        })()}

        {/* ── 왼손(베이스 보표) 음표 편집 바 — 추가·수정·삭제 핵심 기능 ── */}
        {selectedNote && selectedNote.staff === 'bass' && selNoteInfo && (
          <NoteEditBar>
            <NoteEditLabel>
              🎼 왼손 Note: {selNoteInfo.keys.join(' ')} ({selNoteInfo.duration.replace('r', ' rest')})
              {selNoteInfo.accidentals?.[0] === 'b' ? ' ♭' : selNoteInfo.accidentals?.[0] === '#' ? ' ♯' : selNoteInfo.accidentals?.[0] === 'n' ? ' ♮' : ''}
            </NoteEditLabel>
            {!selNoteInfo.duration.endsWith('r') && (
              <>
              </>
            )}
            {/* N연음 묶기 — 트레블 표현 섹션과 동일 규칙(3개 이상일 때만 노출). */}
            <NoteEditBtn
              $active={selectionTupleted}
              disabled={multiSel.length >= 3 && !tupletGroupable}
              onClick={applyTupletToSelection}
              style={multiSel.length < 3 ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
              title={multiSel.length < 3 ? undefined
                : tupletGroupable
                  ? `선택한 ${multiSel.length}개를 ${multiSel.length}연음으로 ${selectionTupleted ? '해제' : '묶기'}`
                  : '한 마디 안에서 연속된 음표만 묶을 수 있다'}
            >3+</NoteEditBtn>
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
        </GoldGroup>



      </ToolBar>
      )}


      <PianoArea>
        {/* scale 은 상한 — 좁은 화면에서는 fitToWidth 가 컨테이너 폭에 맞춰
            자동으로 낮춘다(1,930px 고정이라 창이 좁으면 잘리던 문제). */}
        <PianoKeyboard onNotePress={handleNotePress} mute scale={1.28} fitToWidth />
      </PianoArea>

      {insertPos && (
        <NoteEditBar>
          <NoteEditLabel>
            ✏️ 삽입 모드 — {insertPos.staff === 'bass' ? '왼손 ' : ''}마디 {insertPos.mi + 1}, 위치 {insertPos.ni + 1} · 피아노/쉼표로 입력하면 여기에 끼워집니다
          </NoteEditLabel>
          <Sep />
          <NoteEditBtn onClick={() => setInsertPos(null)}>완료 (Esc)</NoteEditBtn>
        </NoteEditBar>
      )}



      <SheetArea ref={sheetAreaRef}>
        {totalNotes === 0 && <EmptyHint>Type chord &rarr; play notes &rarr; Enter or | to close measure</EmptyHint>}
        <div
          style={{ position: 'relative' }}
          onClick={handleSheetClick}
          onPointerDown={handleSheetPointerDown}
          onPointerMove={handleSheetPointerMove}
          onPointerUp={endSheetDrag}
          onPointerCancel={cancelSheetDrag}
        >
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
            const measureNotes = notePositions.filter((np) => np.mi === pos.idx && !np.staff);
            const firstNote = measureNotes
              .reduce<NotePos | null>((best, cur) => (best === null || cur.x < best.x ? cur : best), null);
            const baseLeft = firstNote ? firstNote.x - 4 : pos.chordX;
            const chordLeft = hasVolta ? baseLeft + 8 : hasBracket ? baseLeft + 12 : baseLeft;
            /* 코드칸은 보표 위 기본 높이에 두되, 기둥·빔이 그 높이까지 뻗어 올라온
             * 마디에서는 그 위로 밀어 올린다 — 절대 겹치지 않게. bbox 는 기둥까지
             * 포함한 값이라 음높이만 보는 것보다 정확하다. */
            const contentTop = measureNotes.reduce((min, np) => Math.min(min, np.y), Infinity);
            const chordTop = chordRowTopY(pos.y, { volta: hasVolta, bracket: hasBracket }, contentTop);
            /* Clamp chord widths to their half so they never overflow into
             * the next bar (or into the c2 slot). */
            const measureRightPx = (pos.x + pos.w) * SHEET_SCALE;
            const chordLeftPx = chordLeft * SHEET_SCALE;
            const c1MaxWidth = Math.max(28, halfW - 4);
            const c2MaxWidth = Math.max(28, measureRightPx - (chordLeftPx + halfW) - 2);
            /* 대체 코드 행 — 코드 행 바로 위. 마디 폭을 ALT_SLOTS 등분하고
             * 양끝에 괄호를 항상 붙인다. */
            const alt = allMeasures[pos.idx]?.altChords;
            const openMenu = (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setChordMenu({ x: e.clientX, y: e.clientY, idx: pos.idx });
            };
            const measureLeftPx = pos.x * SHEET_SCALE;
            const measureWpx = pos.w * SHEET_SCALE;
            const altTop = (chordTop - 17) * SHEET_SCALE;
            const altSlotW = (measureWpx - 18) / ALT_SLOTS; // 괄호 자리 확보
            return (
              <span key={pos.idx}>
                {alt && (
                  <>
                    <AltParen style={{ left: measureLeftPx + 1, top: altTop }}>(</AltParen>
                    {alt.slice(0, ALT_SLOTS).map((av, si) => (
                      <ChordCell
                        key={si}
                        value={av}
                        onChange={(v) => updateAltSlot(pos.idx, si, v)}
                        onContextMenu={openMenu}
                        style={{
                          left: measureLeftPx + 10 + si * altSlotW,
                          top: altTop,
                          maxWidth: Math.max(24, altSlotW - 2),
                          ...(av ? {} : { width: Math.max(24, altSlotW - 2) }),
                        }}
                      />
                    ))}
                    <AltParen style={{ left: measureLeftPx + measureWpx - 8, top: altTop }}>)</AltParen>
                  </>
                )}
                <ChordCell
                  value={c1}
                  active={pos.idx === activeIdx}
                  cellId={`${pos.idx}:0`}
                  registerFocus={registerChordFocus}
                  onNavigate={focusChordSibling}
                  onChange={(v) => updateMeasureChordSlot(pos.idx, 0, v)}
                  onContextMenu={openMenu}
                  style={{ left: chordLeftPx, top: chordTop * SHEET_SCALE, maxWidth: c1MaxWidth, ...(c1 ? {} : { width: 36 }) }}
                />
                <ChordCell
                  value={c2}
                  active={pos.idx === activeIdx}
                  cellId={`${pos.idx}:1`}
                  registerFocus={registerChordFocus}
                  onNavigate={focusChordSibling}
                  onChange={(v) => updateMeasureChordSlot(pos.idx, 1, v)}
                  onContextMenu={openMenu}
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
                {/* 점선 테두리는 없앴다 — 활성 표시는 악보에 칠해지는 노란 배경이 한다.
                  * 여기 있는 건 hover 를 감지하기 위한 투명 영역(그 배경과 같은 범위). */}
                <MeasureHoverZone
                  onMouseEnter={() => setMeasureHover(true)}
                  onMouseLeave={() => setMeasureHover(false)}
                  style={{
                    left: (pos.x - 3) * SHEET_SCALE,
                    top: (pos.y - 44) * SHEET_SCALE,
                    width: (pos.w + 6) * SHEET_SCALE,
                    height: ((grand ? GRAND_BASS_DY + 106 : 110)) * SHEET_SCALE,
                  }}
                />
                <MeasureEditBarBox
                  onMouseEnter={() => setMeasureHover(true)}
                  onMouseLeave={() => setMeasureHover(false)}
                  style={{
                    left: Math.max(4, pos.x * SHEET_SCALE),
                    // 하이라이트(노란 배경) 아래끝 바로 밑에 붙인다.
                    top: (pos.y + (grand ? GRAND_BASS_DY + 68 : 70)) * SHEET_SCALE,
                    display: measureHover ? undefined : 'none',
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
                    title="이 마디의 음표를 전부 지웁니다(마디는 유지)"
                    disabled={noteCnt === 0}
                    onClick={() => {
                      if (noteCnt > 0 && !window.confirm(`마디 ${selectedMeasure + 1}(음표 ${noteCnt}개)를 비울까요?`)) return;
                      pushEditUndo();
                      setMeasures((prev) => prev.map((m, i) => (i === selectedMeasure ? { ...m, notes: [] } : m)));
                    }}
                  >🧹 비우기</button>
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
          {/* 음표 아래 드롭다운 — 삭제/삽입 4종(툴바에서 내려온 것). */}
          {selectedNote && !selectedNote.staff && (() => {
            const np = notePositions.find((p) => p.mi === selectedNote.mi && p.ni === selectedNote.ni && !p.staff);
            if (!np) return null;
            const total = allMeasures[selectedNote.mi]?.notes.length ?? 0;
            const after = total - selectedNote.ni - 1;
            return (
              <NoteActionPop
                onClick={(e) => e.stopPropagation()}
                style={{ left: Math.max(4, (np.x - 6) * SHEET_SCALE), top: (np.y + np.h + 8) * SHEET_SCALE }}
              >
                <NoteEditBtn title="이 음표 왼쪽에 삽입 — 피아노/쉼표로 입력"
                  onClick={() => { setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni }); setSelectedNote(null); }}
                >◀ 삽입</NoteEditBtn>
                <NoteEditBtn title="이 음표 오른쪽에 삽입 — 피아노/쉼표로 입력"
                  onClick={() => { setInsertPos({ mi: selectedNote.mi, ni: selectedNote.ni + 1 }); setSelectedNote(null); }}
                >삽입 ▶</NoteEditBtn>
                <NoteEditBtn title="이 음표/쉼표 삭제"
                  onClick={() => deleteNote(selectedNote.mi, selectedNote.ni)}
                >🗑 삭제</NoteEditBtn>
                <NoteEditBtn title="같은 마디에서 이 음표 오른쪽 내용 전부 삭제"
                  disabled={after <= 0}
                  onClick={() => {
                    if (after <= 0) return;
                    if (!window.confirm(`이 음표 오른쪽의 ${after}개(같은 마디)를 삭제할까요?`)) return;
                    deleteNotesAfter(selectedNote.mi, selectedNote.ni);
                  }}
                >→끝 삭제</NoteEditBtn>
              </NoteActionPop>
            );
          })()}
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

      {chordMenu && (() => {
        const has = !!allMeasures[chordMenu.idx]?.altChords;
        return (
          <ContextMenu
            x={chordMenu.x}
            y={chordMenu.y}
            onClose={() => setChordMenu(null)}
            items={[
              has
                ? { label: '대체 코드 제거', danger: true, onSelect: () => setMeasureAlt(chordMenu.idx, undefined) }
                : { label: '대체 코드 추가', onSelect: () => setMeasureAlt(chordMenu.idx, Array(ALT_SLOTS).fill('')) },
            ]}
          />
        );
      })()}


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
