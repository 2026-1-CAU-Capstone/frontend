import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { BackButton } from '../components/common/BackButton';
import { SessionPicker } from '../components/chord/SessionPicker';
import { INSTRUMENT_ICONS, SESSION_ICON_SLUG, instrumentIconUrl } from '../data/instrumentIcons';
import { isMinorKey } from '../components/leadsheet/LeadSheet';
import { transposeNoteSheet, respellNoteSheetKey, normalizeNoteKeyDisplay } from '../lib/note/transposeNoteSheet';
import { ghostHead } from '../lib/note/ghostNote';
import { isComposingEvent } from '../lib/ime';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { tint } from '../styles/theme';
import styled, { keyframes, css } from 'styled-components';
import { AppSidebar } from '../components/layout/AppSidebar';
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, BarlineType, StaveTie, Repetition, TextBracket, TextBracketPosition, Articulation, Annotation, AnnotationVerticalJustify, Ornament, Tremolo, Curve, StaveConnector, GraceNote, GraceNoteGroup, StaveHairpin, TabStave, TabNote, GhostNote, TabTie, TabSlide, PedalMarking } from 'vexflow';
import { minWidthForVoices, barWidthFromMin, heuristicWidth, packLines } from '../lib/notesheet/sheetLayout';
import { PianoKeyboard, playMidi, type PianoNote } from '../components/notesheet/PianoKeyboard';
import { useMidiInput, type MidiNoteEvent } from '../hooks/useMidiInput';
import { MidiSettingsBody } from '../components/notesheet/MidiSettingsPanel';
import { usePref } from '../lib/prefsStore';
import { editorExplicitAcc } from '../lib/pagePrefs';
import { openPerformanceSettings } from '../lib/settingsBus';
import type { NoteInfo, MeasureInfo, NavigationMarker, NoteSheetData, Articulation as ArticulationName, Ornament as OrnamentName, Dynamic as DynamicName } from '../data/sampleMelody';
import type { StaffKind, SheetStaff } from '../data/sampleMelody';
import { STAFF_KIND_META, STAFF_KIND_ORDER, isTabKind, stavesToSheetFields, sheetToStaves, stavesToPlaybackParts, tabTuningFor, clefForKind, restKeyForClef, displayNotesFor, fitTabClefToStave, type NotationClef } from '../lib/note/sheetStaves';
import { buildDrumNote } from '../lib/note/drumVexNote';
import { auditionDrumGm } from '../lib/note/drumAudition';
import { DrumKitPad } from '../components/notesheet/DrumKitPad';
import { assignTabPositions, type TabPos } from '../lib/note/tabFingering';
import { dbDiagramFor, drawFretDiagram } from '../lib/note/chordDiagram';
import {
  EDITOR_MODES, EDITOR_MODE_LABEL, isEditorMode, type EditorMode,
} from '../lib/note/editorModes';
import { loadChordDb } from '../lib/note/chordDb';
import { resolveSheetMidis } from '../lib/note/resolvePitches';

/* ─── helpers ──────────────────────────────────────────────────────────── */

import { useEditorBackingPlayback } from '../hooks/useEditorBackingPlayback';
import { useDismissable } from '../hooks/useDismissable';
import { GenreSelect, BpmControl, RepeatControl, TransportButtons, MixerButton } from '../components/backing/BackingPlayerBar';
import { ChordPasteModal, type ChordPasteResult } from '../components/notesheet/ChordPasteModal';
import { applyChordPaste } from '../lib/note/chordPaste';
import { drawTuplets } from '../lib/note/tupletBrackets';
import { Smufl } from '../components/common/Smufl';
import { dynamicToSmufl } from '../lib/note/smufl';
import { vexToMidi, noteMetricBeats } from '../lib/note/melodyTiming';
import { computeBeamBreaks } from '../lib/note/beamPolicy';
import { bottomNoteGlyphY } from '../lib/note/chordClearance';
import {
  lineHeadroom, defaultHeadroom, clampChordTop,
} from '../lib/note/chordRowLayout';
import { grandStaffDy, GRAND_BASS_DY } from '../lib/note/grandStaffLayout';
import {
  staffExtent, lineOrigins, sheetHeight, SPACE_ABOVE, NO_EXTENT, type LineBox,
} from '../lib/note/sheetVerticalLayout';
import { bakeExplicitAccidentals, emitForKeySignature } from '../lib/note/resolvePitches';
import { resolveMeasureAccidental, type RenderAcc } from '../lib/note/measureAccidentals';
import { drawLyrics, lyricHeight, maxVerseCount, LYRIC_TOP_GAP, type LyricAnchor } from '../lib/note/lyricLayout';
import { drawScoopFall } from '../lib/note/scoopFall';
import { normalizeChord, formatChordDisplay, splitChordParts } from '../lib/jazz-harmony';
import { detectChordFromMidi } from '../lib/jazz-harmony/chord-detect';
import { createSolo, updateSolo } from '../api/solos';
import { useIsStudio } from '../lib/surface';
import { ContextMenu } from '../components/common/ContextMenu';
import { buildUserSoloDraft, invalidateSolosCache, loadAllSolos, pushSoloToCache, updateSoloInCache } from '../data/soloData';
import { saveUserLick, computeLickFeatures, type LickEntry } from '../data/lickData';
import {
  createComping, updateComping,
  type CompingGenre,
} from '../data/compingData';
import {
  createLeadSheet, updateLeadSheet, type LeadSheetStyle,
} from '../data/leadSheetDbData';
import type { LeadSheetData } from '../data/leadSheetTypes';
import { measuresToLeadSheet, leadSheetToMeasures, hasAnyChord } from '../lib/note/leadSheetConvert';
import { NoteIcon, RestIcon } from '../components/notesheet/NotationIcon';
import { useNoteNameStyle } from '../hooks/useNoteNameStyle';
import { drawNoteNameLabels, type NoteNameStyle, type NoteNameTarget } from '../lib/note/noteNameLabels';

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

/* 겹임시표 입력 리스펠 — 눌린 음(midi)을 겹샤프/겹플랫 표기로 바꾼다.
 * ##: 자연음 글자가 midi−2 에 있으면 그 글자 + 𝄪 (D 입력 → C𝄪).
 * bb: 자연음 글자가 midi+2 에 있으면 그 글자 + 𝄫 (C 입력 → D𝄫).
 * 그런 글자가 없으면(대상이 흑건이면) 단일 ♯/♭ 로 폴백한다. */
const NATURAL_PC: Record<number, string> = { 0: 'c', 2: 'd', 4: 'e', 5: 'f', 7: 'g', 9: 'a', 11: 'b' };
function convertAccDouble(pn: PianoNote, mode: '##' | 'bb'): { vexKey: string; acc?: 'b' | '#' | '##' | 'bb' } {
  const base = mode === '##' ? pn.midi - 2 : pn.midi + 2;
  const letter = NATURAL_PC[((base % 12) + 12) % 12];
  if (!letter) return convertAcc(pn, mode === '##' ? '#' : 'b');
  const oct = Math.floor(base / 12) - 1;
  return { vexKey: `${letter}/${oct}`, acc: mode };
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

/** '3/4' → **4분음표 단위** 한 마디 박 수(6/8 = 3.0). 음가 산술이 4분음표
 *  기준이라 그대로 합산할 수 있다.
 *
 *  불러오기 경로에서 4를 박아 두면 3/4·6/8 악보의 정상 마디가 "4박 초과"로
 *  잘못 판정돼 마디가 쪼개진다(실측: 3/4 채보 파일에서 마디가 늘어남). 그래서
 *  **불러오는 데이터 자신의 박자표**로 계산한다 — 이 시점의 에디터 상태는 아직
 *  이전 악보의 박자표라 쓸 수 없다. */
function barBeatsOf(timeSignature: unknown): number {
  const m = /^(\d+)\/(\d+)$/.exec(typeof timeSignature === 'string' ? timeSignature.trim() : '');
  if (!m) return 4;
  const n = Number(m[1]), d = Number(m[2]);
  return n > 0 && d > 0 ? n * (4 / d) : 4;
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
/** 마디 클릭 판정에서 오선 5줄 바깥으로 허용하는 여유(px). 오선 바로 위는
 *  코드 심볼 자리라 넉넉히 잡으면 행끼리 겹친다 — 작게 유지할 것. */
const STAFF_HIT_PAD = 8;
const GRAND_EXTRA = 115;

/* ── 다중 스태프(자유 조합) 행 간격 ──
 * 추가 스태프는 첫 파트 아래로 쌓인다. TAB 은 6줄(줄간 13px)이라 더 높게 잡는다.
 *
 * 오선 행 간격은 **실측으로 정했다**(headless VexFlow 로 한 행의 bounding box 를
 * 재봤다). 오선 자체는 40px 인데 드럼 행은 손 기둥이 위로, 발(킥) 기둥이 아래로
 * 뻗어 양쪽을 다 쓴다:
 *   재즈 스윙 105 · 록 110 · 크래시 들어간 마디 115 · 11종 전부(최악) 122px
 * 종전 100px 은 이보다 좁아 아래 행 오선을 실제로 침범했다. 136px 이면 최악에도
 * 14px 여유가 남는다. */
const EXTRA_ROW_NOTATION = 136;
const EXTRA_ROW_TAB = 125;

/** 렌더러에 넘기는 파트 명세 — 페이지 상태(partMetas+버퍼/스토어)에서 조립. */
interface RenderPart {
  kind: StaffKind;
  measures: MeasureInfo[];
  /** kind='grand' 전용 왼손. */
  bassMeasures?: MeasureInfo[] | null;
  /** TAB 전용: 위에 표준 오선 함께 표기. */
  withNotation?: boolean;
  /** TAB 전용 — 카포·튜닝 프리셋·코드 다이어그램 (SheetStaff 와 동일 의미). */
  capo?: number;
  tuningPreset?: 'standard' | 'drop-d';
  chordDiagrams?: boolean;
}

/** 코드 다이어그램 행 높이(px) — TAB 행 위에 얹힌다. */
const DIAGRAM_H = 50;
/** 다이어그램 그리드 폭. */
const DIAGRAM_W = 34;

/* 다이어그램 계산 캐시는 없앴다 — chords-db 조회는 배열 탐색 한 번이라 캐시할 게
 * 없다(예전엔 운지를 매번 계산해서 캐시가 필요했다). */

function extraPartHeight(p: RenderPart): number {
  if (p.kind === 'grand') return EXTRA_ROW_NOTATION * 2;
  if (isTabKind(p.kind)) {
    return (p.withNotation ? EXTRA_ROW_NOTATION : 0) + (p.chordDiagrams ? DIAGRAM_H : 0) + EXTRA_ROW_TAB;
  }
  return EXTRA_ROW_NOTATION;
}
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
/** 코드칸 아랫변 ↔ 오선 첫 줄 여백(내부 좌표). 음표가 오선 위로 올라오지 않는
 *  보통의 마디에서 이 값이 그대로 화면 간격이 된다. */
const CHORD_STAFF_GAP = 11;
/** 도돌이 번호(volta)·묶음 대괄호가 오선 위를 차지할 때는 코드칸을 더 붙인다. */
const CHORD_STAFF_GAP_MARK = 4;
/** SVG 위쪽으로 잘려나가지 않게 하는 하한. */
const CHORD_TOP_MIN = 2;
/** 코드 글리프가 자기 28px 상자 **위로 넘치는 양**(모델 단위).
 *  ChordBase 는 1.85rem(≈30px) 을 28px line-height 에 담고, tension 위첨자는
 *  다시 6px 올라간다 — 상자 rect 만 덮으면 글자 머리가 잘린다. */
const CHORD_GLYPH_RISE = 8;

/**
 * 코드 입력칸의 윗변 Y(내부 좌표).
 *
 * 기준은 **오선 첫 줄**(`stave.getYForLine(0)`)이다. 예전엔 Stave 원점(`y`)에서
 * -20 을 뺐는데, VexFlow 는 원점과 첫 줄 사이에 40단위(space_above_staff_ln 4칸)를
 * 비워 두므로 실제로는 오선에서 60단위 = 화면 81px 나 떨어져 있었다. 그래서
 * 코드칸과 악보 사이가 늘 뻥 비어 보였다(2026-08-02 실측 후 수정).
 *
 * @param staffTop   오선 첫 줄 Y (`stave.getYForLine(0)`)
 * @param contentTop 그 **줄** 에서 가장 높이 올라간 요소의 Y. 음표가 없으면 Infinity.
 */
function chordRowTopY(
  staffTop: number,
  opts: { volta?: boolean; bracket?: boolean },
  contentTop: number,
): number {
  const cellH = CHORD_CELL_H / SHEET_SCALE;
  const gap = opts.volta || opts.bracket ? CHORD_STAFF_GAP_MARK : CHORD_STAFF_GAP;
  const base = staffTop - cellH - gap;
  /* 기둥·빔이 코드칸 높이까지 올라오면 그 위로 밀어 올린다 — 절대 겹치지 않게. */
  const lifted = contentTop - CHORD_NOTE_GAP - cellH;
  return Math.max(CHORD_TOP_MIN, Math.min(base, lifted));
}
/** VexFlow 음표의 **신뢰할 수 있는** 좌표. 꾸밈음(GraceNote)은 voice 의 tickable
 * 이 아니라 GraceNoteGroup 수식으로 그려져서 `getBoundingBox()` 가 포맷 전
 * 좌표(0,0)를 그대로 돌려준다. 그 값을 좌표로 쓰면
 *   · 코드칸이 "마디의 첫 음표" 로 x≈0 을 골라 악보 왼쪽 끝에 겹쳐 쌓이고,
 *   · 클릭 판정도 엉뚱한 곳을 가리킨다.
 * 실제로 그려진 SVG 의 bbox 로 보정하고, 그것도 못 믿으면 null 을 돌려
 * 아예 수집하지 않는다. */
function reliableNoteRect(vfNote: StaveNote): { x: number; y: number; w: number; h: number } | null {
  const bb = vfNote.getBoundingBox?.();
  if (bb && bb.getX() > 0) return { x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH() };
  try {
    const gb = (vfNote.getSVGElement?.() as SVGGraphicsElement | undefined)?.getBBox?.();
    if (gb && gb.x > 0 && Number.isFinite(gb.x)) return { x: gb.x, y: gb.y, w: gb.width, h: gb.height };
  } catch { /* jsdom 등 getBBox 미지원 */ }
  return null;
}

/** 선택된 마디 하이라이트 면을 SVG 맨 뒤(가장 아래 레이어)에 깐다. */
/** 악보 위 '마디 활성' 하이라이트 색 — VexFlow 렌더러와 상단 상태 띠가
 *  **같은 값**을 쓴다(둘이 갈리면 같은 상태가 화면마다 다른 색으로 보인다). */
const MEASURE_HL_FILL = 'rgba(184, 150, 10, 0.13)';

function paintMeasureHighlight(el: HTMLDivElement, x: number, w: number, top: number, bot: number): void {
  const svgEl = el.querySelector('svg');
  if (!svgEl) return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(top));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(bot - top));
  rect.setAttribute('fill', MEASURE_HL_FILL);
  rect.setAttribute('stroke', 'none');         // 테두리 없음 — 면만
  /* 렌더 뒤 DOM 측정으로 윗변을 보정하기 위한 핸들(useLayoutEffect 가 찾는다).
   * 코드칸은 HTML 오버레이라 SVG 를 그리는 시점엔 실제 높이를 알 수 없다. */
  rect.setAttribute('class', 'jz-measure-hl');
  svgEl.insertBefore(rect, svgEl.firstChild);
}

/* 대체(리하모니제이션) 코드 슬롯 수 — 마디 위 괄호 안에 뜨는 입력 칸 개수. */
const ALT_SLOTS = 4;
/** Soft cap on bars per line. The actual line break is driven by each measure's
 *  real VexFlow width (measured via `minWidthForNotes`), so this only bites for
 *  very thin measures (lots of whole notes) that would otherwise fit a
 *  dozen-plus to a line and look like a crammed timeline. */
const MAX_PER_LINE = 8;
/* MIDI 화음 인식 시간창(ms) — 이 시간 안에 들어온 note-on 을 한 화음으로 본다.
 * 마지막 키마다 창이 갱신되므로 살짝 흩어 쳐도 묶인다. 너무 길면 다음 코드까지
 * 섞이고, 너무 짧으면 손가락이 완전히 동시에 닿아야 해서 60ms 로 잡았다. */
const CHORD_DETECT_WINDOW_MS = 60;

const DECOR_FIRST = 70;
const DECOR_OTHER = 35;

/** staff: 'bass' = 그랜드 스태프의 왼손(낮은음자리표) 행. 없으면 트레블. */
/** 마디 히트박스. `y`는 stave 원점(위쪽 여백 포함)이고, `staveTop`/`staveBot`은
 *  실제 오선 5줄의 최상단/최하단 Y다. 마디 클릭 판정은 반드시 후자를 쓴다 —
 *  stave 원점 위쪽 여백은 코드 심볼 자리라, 거기까지 판정에 넣으면 아래 행의
 *  코드를 만질 때 윗행 마디가 잡힌다. */
interface MeasurePos { idx: number; x: number; y: number; w: number; chordX: number; staveTop: number; staveBot: number;
  /** 코드 입력칸 윗변 Y(내부 좌표). **렌더러가 한 번 계산해** DOM 오버레이와
   *  마디 하이라이트가 같은 값을 쓴다 — 예전엔 양쪽이 각자 계산해 서로 어긋났다. */
  chordTop: number; staff?: 'bass'; /** 추가 스태프 행(1..N). 첫 파트는 undefined — 기존 소비처(코드칸 등)가 그대로 첫 파트만 읽는다. */ part?: number;
  /** 이 줄의 양손 간격(px). 줄마다 다를 수 있어(내용에 따라 벌어짐) DOM 오버레이가
   *  상수 대신 이 값을 봐야 보표와 어긋나지 않는다. */
  bassDy: number; }
interface NotePos {
  mi: number; ni: number;
  /** 글리프 전체 bbox(기둥·플래그 포함) — 하이라이트/폴백용. */
  x: number; y: number; w: number; h: number;
  /** 노트헤드만의 x 범위 + 각 머리(화음 톤 포함)의 y 중심 — 클릭 판정용.
   *  쉼표처럼 머리가 없는 글리프는 비워 두고 bbox 폴백. */
  headX?: number; headW?: number; headYs?: number[];
  staff?: 'bass';
  /** 추가 스태프 행 소속(1..N). 첫 파트는 undefined. */
  part?: number;
  /** 보이스 2 소속 음표. */
  v2?: boolean;
}

/* 음표 클릭은 **머리(notehead)를 정확히 눌렀을 때만** 활성화한다(사양) —
 * 기둥·빔·주변 여백 클릭은 null 을 돌려 마디 선택으로 흘려보낸다.
 * 화음은 각 머리를 개별 판정하고, 쉼표는 머리가 없어 글리프 bbox 전체를
 * 머리로 취급한다. 반환값은 근접도(작을수록 가까움; 겹침 시 정렬용). */
const HEAD_PAD = 3;               // 손끝 오차 허용(px, 언스케일 좌표)
const HEAD_HALF_H = 5 + HEAD_PAD; // 오선 간격 10px → 머리 반높이 5px + 오차
function noteHeadHit(np: NotePos, cx: number, cy: number): number | null {
  if (np.headX != null && np.headW != null && np.headYs && np.headYs.length > 0) {
    if (cx < np.headX - HEAD_PAD || cx > np.headX + np.headW + HEAD_PAD) return null;
    let best: number | null = null;
    for (const hy of np.headYs) {
      const dy = Math.abs(cy - hy);
      if (dy > HEAD_HALF_H) continue;
      const d = dy + Math.abs(cx - (np.headX + np.headW / 2)) * 0.5;
      if (best === null || d < best) best = d;
    }
    return best;
  }
  // 쉼표 등 노트헤드 없는 글리프 — bbox 전체가 곧 "머리".
  if (cx < np.x - HEAD_PAD || cx > np.x + np.w + HEAD_PAD) return null;
  if (cy < np.y - HEAD_PAD || cy > np.y + np.h + HEAD_PAD) return null;
  return Math.hypot(cx - (np.x + np.w / 2), cy - (np.y + np.h / 2));
}

/** 렌더 시 노트헤드 좌표 수집 — 쉼표는 노트헤드 API 가 없어 예외 → 빈 값(bbox 폴백). */
function collectHeadRect(vfNote: {
  getNoteHeadBeginX(): number;
  getNoteHeadEndX(): number;
  getYs(): number[];
}): Pick<NotePos, 'headX' | 'headW' | 'headYs'> {
  try {
    const hx = vfNote.getNoteHeadBeginX();
    const hw = vfNote.getNoteHeadEndX() - hx;
    const ys = vfNote.getYs();
    if (Number.isFinite(hx) && Number.isFinite(hw) && hw > 0 && ys && ys.length > 0) {
      return { headX: hx, headW: hw, headYs: [...ys] };
    }
  } catch { /* rest 등 */ }
  return {};
}
type StaffId = 'treble' | 'bass';
interface NoteSel { mi: number; ni: number; staff?: StaffId; /** 추가 스태프 소속(1..N). 첫 파트는 undefined. */ part?: number; /** 보이스 2 소속. */ v2?: boolean; }

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
  clef: 'treble' | 'bass' | 'alto' | 'tenor',
  activeAcc: Map<string, RenderAcc>,
  keySigAcc: Map<string, 'b' | '#'>,
  /** 조표를 그리는 악보(=조표무시 OFF)면 courtesy 규칙으로 그린다 — NoteSheet(뷰어)
   *  와 플레이어(resolvePitches 'score')가 쓰는 규칙과 같아야 한다. 예전엔 이 인자가
   *  없어 항상 explicit 규칙으로 그렸고, 그 결과 **조표가 그려진 악보에서 임시표 없는
   *  음에 ♮ 가 붙는데 소리는 조표를 따르는**(D장조 c → 화면 ♮, 소리 C♯) 어긋남이 났다. */
  courtesy = false,
): StaveNote {
  const isRest = n.duration.endsWith('r');
  const dur = buildDuration(n.duration, n.dotted, n.doubleDotted);
  const restKey = restKeyForClef(clef);
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
        /* XML <stem> / 플립 버튼의 명시 방향이 autoStem 보다 우선한다. */
        ...(n.stem ? { autoStem: false, stemDirection: n.stem === 'up' ? 1 : -1 } : { autoStem: true }),
        ...ghostHead(n),
      });
  // 점 글리프는 modifier 로 붙인다(길이는 위 duration 문자열이 이미 반영).
  if (n.doubleDotted) { Dot.buildAndAttach([note]); Dot.buildAndAttach([note]); }
  else if (n.dotted) Dot.buildAndAttach([note]);

  if (!isRest) {
    // Octave-aware accidental rule — single shared helper, every chord tone.
    for (let ki = 0; ki < n.keys.length; ki++) {
      const realAcc = n.accidentals?.[ki] as RenderAcc | undefined;
      const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, n.keys[ki], realAcc, { courtesy, tied: n.tieKeys ? n.tieKeys.includes(ki) : n.tieContinuation });
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
      harmonic: 'ah', 'lh-pizz': 'a+', 'snap-pizz': 'ao',
      'up-bow': 'a|', 'down-bow': 'am',
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
  if (n.textAbove) {
    // 연주 지시 텍스트(pizz./arco/mute …) — 음표 위 이탤릭.
    const ann = new Annotation(n.textAbove);
    ann.setVerticalJustification(AnnotationVerticalJustify.TOP);
    try { ann.setFont('Georgia', 11, 'normal', 'italic'); } catch { /* noop */ }
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
/**
 * `drum` 이면 드럼 표기 규칙으로 묶는다:
 *   ① 손(스템↑)과 발(스템↓)을 한 빔에 섞지 않는다 — 방향이 바뀌는 곳에서 끊는다.
 *   ② `new Beam(group, false)` 로 만들어 **음표에 지정한 스템 방향을 보존**한다.
 *      autoStem=true 는 그룹 평균 음높이로 방향을 다시 정해버려서, buildDrumVfNote
 *      가 정한 손/발 방향을 통째로 덮어썼다(실측: 킥·하이햇 교대 8개가 전부 ↓).
 */
function buildBeams(msNotes: NoteInfo[], vfNotes: StaveNote[], drum = false): Beam[] {
  const beams: Beam[] = [];
  const beamBreaks = computeBeamBreaks(msNotes, '4/4');
  /* 드럼은 우리가 정한 스템 방향이 진실 — 빔이 다시 정하게 두지 않는다. */
  const autoStem = !drum;
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
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
      beamGroup = [];
      postTupletMerged = false;
    }

    if (tupletN !== inTupletN && beamGroup.length > 0) {
      const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
      if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
        postTupletMerged = true;
      } else {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
        beamGroup = [];
      }
    }
    inTupletN = tupletN;

    if (isBeamable && !isRest) {
      /* 드럼: 손(↑)과 발(↓)이 바뀌는 곳에서 무조건 끊는다. */
      if (drum && beamGroup.length > 0
          && beamGroup[beamGroup.length - 1].getStemDirection() !== vn.getStemDirection()) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
        beamGroup = [];
        postTupletMerged = false;
      }
      if (!isTuplet && !postTupletMerged && beamGroup.length > 0 && beamBreaks.has(ni)) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
        beamGroup = [];
      }
      beamGroup.push(vn);
      if (isTuplet && beamGroup.length === tupletN) {
        beams.push(new Beam(beamGroup, autoStem));
        beamGroup = [];
        postTupletMerged = false;
        continue;
      }
      if (msNotes[ni].beamBreak) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
        beamGroup = [];
        postTupletMerged = false;
      }
    } else {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
      beamGroup = [];
      postTupletMerged = false;
    }
  }
  if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, autoStem));
  return beams;
}

/** 투플렛 브래킷 렌더 — 트레블/베이스 공용.
 *
 * 알고리즘은 `lib/note/tupletBrackets` 가 단일 소스다(뷰어 NoteSheet 와 공용).
 * 종전 에디터 전용 구현은 ① 표시 숫자를 그룹 개수로 넘기고 ② 그룹 경계를
 * "최대 N개"로 끊고 ③ `tupletNormal` 을 무시해, 3:2 그룹이 연달아 오면
 * `3`·`3` 이 아니라 `3`·`2` 로 나왔다(실측: it-could-happen-to-you 28마디). */
function drawTupletBrackets(msNotes: NoteInfo[], vfNotes: StaveNote[], ctx: ReturnType<Renderer['getContext']>): void {
  drawTuplets({ notes: msNotes, vfNotes }, ctx);
}

/* ── 드럼 보표 음표 — 공용 빌더(drumVexNote)에 위임. per-key 노트헤드(킥은
 * 타원 + 하이햇만 ✕), 라이드 벨 ◆, 손/발 스템 방향, 고스트 괄호, 열린 하이햇 ○,
 * 악센트, 플램(grace)까지 — 에디터·뷰어(NoteSheet)가 완전히 같은 표기를 낸다. */
function buildDrumVfNote(n: NoteInfo): StaveNote {
  return buildDrumNote(n);
}

/* ── TAB 음표 — 사전 계산된 운지(TabPos)로 그린다. 쉼표는 시간만 차지하는
 * GhostNote(보이지 않음 — 실제 TAB 관행). */
const TAB_REST_KEY: Record<number, string> = { 6: 'b/4', 5: 'b/4', 4: 'a/4' };

function buildTabVfNote(
  n: NoteInfo, pos: TabPos[] | null, drawStem = false, numLines = 6,
): TabNote | GhostNote | StaveNote {
  const dur = buildDuration(n.duration, n.dotted, n.doubleDotted);
  if (n.duration.endsWith('r') || !pos || pos.length === 0) {
    /* 동반 오선이 없으면(standalone) 쉼표도 진짜 쉼표 글리프로 — GhostNote 는
     * 시간만 차지하고 아무것도 안 그려서 마디가 비어 보였다. */
    if (drawStem && n.duration.endsWith('r')) {
      const rest = new StaveNote({ keys: [TAB_REST_KEY[numLines] ?? 'b/4'], duration: dur });
      if (n.doubleDotted) { Dot.buildAndAttach([rest]); Dot.buildAndAttach([rest]); }
      else if (n.dotted) Dot.buildAndAttach([rest]);
      return rest;
    }
    return new GhostNote(dur);
  }
  /* drawStem: TAB 단독 보표(동반 오선 없음)는 프렛 숫자만으론 리듬을 읽을 수
   * 없다 — 기둥·플래그를 함께 그린다(출판 TAB 관행). 오선 병기 시엔 오선이
   * 리듬을 담당하므로 끈다. */
  const tn = new TabNote({
    positions: pos.map((tp) => ({ str: tp.str, fret: tp.fret })),
    duration: dur,
  }, drawStem);
  if (drawStem) {
    tn.setStemDirection(-1);   // 출판 TAB 관례 — 리듬 스템은 보표 아래
    try {
      if (n.doubleDotted) { Dot.buildAndAttach([tn]); Dot.buildAndAttach([tn]); }
      else if (n.dotted) Dot.buildAndAttach([tn]);
    } catch { /* noop */ }
  }
  return tn;
}

/* ── TAB 주법 — 마디 안 인접쌍에 그린다.
 *   gliss → 슬라이드(음정 방향), slurStart→slurStop 인접쌍 → 해머온(상행)/풀오프(하행).
 *   스쿱·폴·벤드는 동반 오선 표기가 담당(v2). */
function drawTabTechniques(
  ctx: ReturnType<Renderer['getContext']>,
  notes: NoteInfo[],
  vf: (StaveNote | TabNote | GhostNote)[],
): void {
  const midiOf = (n: NoteInfo): number | null =>
    n.duration.endsWith('r') || n.keys.length === 0 ? null : vexToMidi(n.keys[0]);
  for (let i = 0; i + 1 < notes.length; i++) {
    const a = notes[i], b = notes[i + 1];
    const va = vf[i], vb = vf[i + 1];
    if (!(va instanceof TabNote) || !(vb instanceof TabNote)) continue;
    const ma = midiOf(a), mb = midiOf(b);
    if (ma === null || mb === null) continue;
    const opts = { firstNote: va, lastNote: vb, firstIndexes: [0], lastIndexes: [0] };
    try {
      if (a.gliss) {
        (mb >= ma ? TabSlide.createSlideUp(opts) : TabSlide.createSlideDown(opts)).setContext(ctx).draw();
      } else if (a.slurStart && b.slurStop) {
        (mb >= ma ? TabTie.createHammeron(opts) : TabTie.createPulloff(opts)).setContext(ctx).draw();
      }
    } catch { /* noop */ }
  }
}

/** 추가 파트 한 행의 마디 하나를 그릴 준비물 — renderSheet 내부 전용. */
interface ExtraRowBuilt {
  staves: Stave[];
  voices: Voice[];
  /** 보표별 (vfNotes, 원본 notes) — 빔·타이·notePositions 용. */
  rows: Array<{ stave: Stave; vf: (StaveNote | TabNote | GhostNote)[]; notes: NoteInfo[]; isTab: boolean; isBassRow?: boolean; isDrum?: boolean; tabStems?: boolean }>;
}

function renderSheet(el: HTMLDivElement, measures: MeasureInfo[], width: number, currentIdx: number, activeIdx: number, positions: MeasurePos[], sheetKey?: string, notePositions?: NotePos[], selectedNotes?: NoteSel[] | null, noteElMap?: Map<string, SVGElement>, bassMeasures?: MeasureInfo[] | null, explicitAcc?: boolean, activeStaff: StaffId = 'treble', extraParts?: RenderPart[] | null, part0Kind: StaffKind = 'treble', activePartIdx = 0, part0Staff?: Pick<RenderPart, 'capo' | 'tuningPreset' | 'withNotation' | 'chordDiagrams'>, timeSig = '4/4',
  noteNameStyle?: NoteNameStyle) {
  positions.length = 0;
  if (notePositions) notePositions.length = 0;
  if (noteElMap) noteElMap.clear();
  el.innerHTML = '';
  if (measures.length === 0) return;
  const grand = !!bassMeasures;
  const EMPTY_BASS: MeasureInfo = { notes: [] };
  const bassAt = (i: number): MeasureInfo => bassMeasures?.[i] ?? EMPTY_BASS;
  /* ── 다중 스태프 — 첫 파트(part0)는 기존 파이프라인(장식·타이 전부), 추가
   * 파트는 아래에 행으로 쌓인다. part0 가 TAB/드럼이면 음표 빌드만 갈아끼우고
   * 표준 표기 전용 장식(타이·이음줄·옥타브 등)은 건너뛴다. */
  const extras = extraParts ?? [];
  const p0Tab = isTabKind(part0Kind);
  const p0Drum = part0Kind === 'drum';
  const p0Notation = !p0Tab && !p0Drum;
  const p0Clef = clefForKind(part0Kind);
  const clef0 = (p0Clef.clef === 'percussion' ? 'treble' : p0Clef.clef) as 'treble' | 'bass' | 'alto' | 'tenor';
  const accStyle: 'explicit' | 'score' = explicitAcc ? 'explicit' : 'score';
  const tsMatch = /^([0-9]+)\/([0-9]+)$/.exec(timeSig);
  const vNumBeats = tsMatch ? Number(tsMatch[1]) : 4;
  const vBeatValue = tsMatch ? Number(tsMatch[2]) : 4;
  /* TAB 운지는 파트 전체를 한 번에 — 손 위치 연속성이 마디를 넘어 이어진다. */
  const tabPosOf = (ms: MeasureInfo[], kind: StaffKind, staff?: Pick<RenderPart, 'capo' | 'tuningPreset'>): (TabPos[] | null)[][] =>
    assignTabPositions(
      resolveSheetMidis(ms, sheetKey, accStyle),
      tabTuningFor(kind, staff),
      // 수동 운지(tabStrings) — 음표별 keyIndex→현 지정. 무효 지정은 엔진이 무시.
      ms.map((m) => m.notes.map((n) => n.tabStrings ?? null)),
    );
  const tabPos0 = p0Tab ? tabPosOf(measures, part0Kind, part0Staff) : null;
  const extraTabPos = extras.map((ep) => (isTabKind(ep.kind) ? tabPosOf(ep.measures, ep.kind, ep) : null));
  const extrasH = extras.reduce((sum, ep) => sum + extraPartHeight(ep), 0);
  const lineH = (grand ? LINE_HEIGHT + GRAND_EXTRA : LINE_HEIGHT) + extrasH + (p0Tab ? 25 : 0);
  const innerW = width / SHEET_SCALE;
  const totalW = innerW - MARGIN.left - MARGIN.right;
  /* 양손이면 마디 폭은 두 보표 중 밀도가 높은 쪽 기준. */
  // 조표 무시(explicit): keySig를 비워 마디 안의 임시표만으로 표기·상속 판단.
  let keySigAcc = explicitAcc ? new Map<string, 'b' | '#'>() : keySigAccidentals(sheetKey || 'C');
  /* 마디 중간 조성 변경(measure.key) — 줄 시작 조표 표기용 현재 조성 추적. */
  let curKeyName = sheetKey || 'C';

  /* 마디 폭 사전 측정 — 자체 추정 테이블 대신 VexFlow에게 실제로 필요한 최소
   * 폭을 물어본다. 여기서 만드는 StaveNote는 측정 전용이고, 아래 렌더 루프는
   * 자기 것을 새로 만든다 — 같은 노트를 두 Voice에 넣으면 tickContext가
   * 덮어써지기 때문에 인스턴스를 분리한다.
   * 임시표 상태(tieCarry)는 렌더 루프와 똑같이 마디 순서대로 전파해야 측정폭이
   * 실제 렌더와 일치한다. packLines가 순서를 보존하므로 이 전제가 성립한다. */
  let probeCarry: Map<string, RenderAcc> | undefined;
  let probeKeySig = keySigAcc;
  const widths = measures.map((m, i) => {
    if (measures[i].key && !explicitAcc) probeKeySig = keySigAccidentals(measures[i].key!);
    let minW = 0;
    let floor = heuristicWidth(m.notes);
    /* 한 마디 칸을 공유하는 보이스는 **함께** 재야 한다 — VexFlow 가 렌더 때
     * joinVoices 로 한꺼번에 배치하므로, 따로 재서 max 를 쓰면 실제 필요 폭보다
     * 작게 나와 음표가 마디선을 넘는다(양손 악보에서 실측된 원인). */
    const probeVoices: StaveNote[][] = [];
    if (p0Notation) {
      const active: Map<string, RenderAcc> = probeCarry ? new Map(probeCarry) : new Map();
      probeCarry = undefined;
      const probe = displayNotesFor(part0Kind, m.notes).map((n) => buildVfNote(n, clef0, active, probeKeySig, !explicitAcc));
      const last = m.notes[m.notes.length - 1];
      if (last?.tie && !last.duration.endsWith('r')) {
        const acc = last.accidentals?.[0] as 'b' | '#' | undefined;
        if (acc) probeCarry = new Map([[last.keys[0], acc]]);
      }
      probeVoices.push(probe);
    }
    if (grand) {
      const bassActive: Map<string, RenderAcc> = new Map();
      probeVoices.push(bassAt(i).notes.map((n) => buildVfNote(n, 'bass', bassActive, keySigAcc, !explicitAcc)));
      floor = Math.max(floor, heuristicWidth(bassAt(i).notes));
    }
    minW = minWidthForVoices(probeVoices, vNumBeats, vBeatValue);
    /* 추가 파트도 같은 마디 칸을 쓰므로 밀도가 높은 파트가 폭 하한을 올린다. */
    for (const ep of extras) {
      const em = ep.measures[i];
      if (em && em.notes.length > 0) floor = Math.max(floor, heuristicWidth(em.notes));
      if (ep.kind === 'grand' && ep.bassMeasures?.[i]?.notes.length) {
        floor = Math.max(floor, heuristicWidth(ep.bassMeasures[i].notes));
      }
    }
    return barWidthFromMin(minW, floor);
  });
  /* 강제 줄바꿈(measure.lineBreak) — 플래그 지점에서 분절해 각각 패킹한 뒤 잇는다.
   * 뒤 구간의 첫 줄은 decorFirst 가 아니라 decorOther 규격이다(첫 줄이 아니므로). */
  const lines: number[][] = [];
  {
    let segStart = 0;
    const flush = (endExclusive: number) => {
      if (endExclusive <= segStart) return;
      const segWidths = widths.slice(segStart, endExclusive);
      const packed = packLines(segWidths, totalW, {
        decorFirst: segStart === 0 ? DECOR_FIRST : DECOR_OTHER,
        decorOther: DECOR_OTHER, maxPerLine: MAX_PER_LINE,
      });
      for (const ln of packed) lines.push(ln.map((i2) => i2 + segStart));
      segStart = endExclusive;
    };
    for (let i2 = 0; i2 < measures.length; i2++) {
      if (measures[i2].lineBreak) flush(i2 + 1);
    }
    flush(measures.length);
  }
  /* 줄별 코드칸 자리 확보 — 고음이 있는 줄은 그만큼 아래로 밀어 윗줄 침범을
   * 원천 차단한다(chordRowLayout 규칙). 고음이 없으면 초과분이 0 이라 좌표가
   * 예전과 완전히 같다. lineGap 은 VexFlow 오선 한 칸(=10). */
  const chordMetrics = {
    rowH: CHORD_CELL_H / SHEET_SCALE, staffGap: CHORD_STAFF_GAP, noteGap: CHORD_NOTE_GAP,
  };
  /* alto·tenor 는 코드칸을 쓰지 않는 파트라 treble 기준으로 근사해도 안전하다
   * (예약이 조금 넉넉해질 뿐, 부족해지지 않는다). */
  const headClef = clef0 === 'bass' ? 'bass' : 'treble';
  const lineHeadrooms = lines.map((idxs) =>
    lineHeadroom(idxs.map((i2) => measures[i2]?.notes ?? []), 10, chordMetrics, headClef));
  /* 양손 두 보표 간격 — 줄마다 내용에 맞춰 벌린다(겹치면 벌어지고, 아니면 기본값). */
  const lineBassDy = lines.map((idxs) => (grand
    ? grandStaffDy(
        idxs.map((i2) => measures[i2]?.notes ?? []),
        idxs.map((i2) => bassAt(i2).notes),
        10,
      )
    : GRAND_BASS_DY));

  /* 줄별 세로 상자 — 위(코드칸·고음·위빔)와 아래(저음·아래빔)를 **같은 모델**로
   * 재서, 이웃 줄과 절대 겹치지 않는 간격을 구한다. 기본 줄 높이보다 좁아지지
   * 않으므로 평범한 악보는 좌표가 그대로다. */
  const lineBoxes: LineBox[] = lines.map((idxs, li2) => {
    const tExt = staffExtent(idxs.map((i2) => measures[i2]?.notes ?? []), 10, headClef);
    const bExt = grand
      ? staffExtent(idxs.map((i2) => bassAt(i2).notes), 10, 'bass')
      : NO_EXTENT;
    const dy = lineBassDy[li2];
    /* 가사 자리 — 뷰어(NoteSheet)와 같은 계산. 절 수만큼 아래를 넓힌다. */
    const lyricH = lyricHeight(maxVerseCount(idxs.map((i2) => measures[i2] ?? { notes: [] })));
    return {
      chordRow: lineHeadrooms[li2] ?? 0,
      above: tExt.above,
      // 맨 아래 보표의 마지막 줄 위치 — 양손이면 베이스, 추가 파트가 있으면 그 아래.
      bottomLine4: (grand ? dy : 0) + SPACE_ABOVE + 4 * 10 + extrasH + (p0Tab ? 25 : 0),
      below: (grand ? bExt.below : tExt.below) + lyricH,
    };
  });
  const lineOriginY = lineOrigins(lineBoxes, lineH, MARGIN.top);
  const totalH = sheetHeight(lineBoxes, lineOriginY, MARGIN.bottom);
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(innerW, totalH);
  const ctx = renderer.getContext();

  const svgEl = el.querySelector('svg');
  if (svgEl) {
    svgEl.style.transformOrigin = 'top left';
    svgEl.style.transform = `scale(${SHEET_SCALE})`;
    el.style.height = `${totalH * SHEET_SCALE}px`;
  }
  /* 두 보표를 중괄호(brace)로 묶는다. 중괄호는 보표 왼쪽 끝보다 더 왼쪽에
   * 그려지므로, MARGIN.left 여백 안에서 음자리표와 실제 악보 같은 간격이
   * 남도록 draw 로 새로 생긴 SVG 노드만 살짝 왼쪽으로 옮긴다. */
  const drawBrace = (top: Stave, bottom: Stave) => {
    const before = svgEl ? svgEl.childNodes.length : 0;
    new StaveConnector(top, bottom).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
    if (svgEl) {
      for (let k = before; k < svgEl.childNodes.length; k++) {
        const node = svgEl.childNodes[k];
        if (node.nodeType !== 1) continue;
        const eln = node as SVGElement;
        const prev = eln.getAttribute('transform') ?? '';
        eln.setAttribute('transform', `translate(-8,0) ${prev}`.trim());
      }
    }
  };

  /* 음이름 라벨 대상 — 음높이 보표만 모은다(TAB 숫자·드럼 GM 키는 제외). */
  const nameTargets: NoteNameTarget[] = [];
  const allVfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
  const allBassVfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
  /** 보이스 2(part0) — 선택·타이·빔 용. */
  const allV2VfNotes: { mi: number; ni: number; vfNote: StaveNote }[] = [];
  /* 추가 파트 음표 — 타이(표기 행)·notePositions(활성 파트)·선택 하이라이트용. */
  const allExtraVf: Array<{ pi: number; mi: number; ni: number; vfNote: StaveNote; bassRow: boolean; isTabRow: boolean }> = [];
  let tieCarryAcc: Map<string, RenderAcc> | undefined;

  /* 줄별 마디번호 카운터 — 픽업(anacrusis) 마디는 세지 않는다. 각 줄의 첫
   * 마디 왼쪽에 현재 번호를 그린다(Solo DB / NoteSheet 와 동일 로직·디자인). */
  let mNum = 0;

  for (let li = 0; li < lines.length; li++) {
    const indices = lines[li];
    /* 이 줄의 가사 — 뷰어와 같은 모듈로 그린다(하이픈·멜리스마가 마디선을 넘어
     * 이어지므로 줄 단위). 에디터는 편집 대상이라 항상 표시한다. */
    const lineLyrics: LyricAnchor[] = [];
    const lineNoteXs: number[] = [];
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;
    /* 균등 배치가 아니라 **누적** — 이 줄이 코드칸 때문에 더 높은 자리가 필요하면
     * 그만큼 아래로 내려간다. 윗줄과의 겹침이 구조적으로 불가능해진다. */
    const y = lineOriginY[li];
    /* 이 줄의 양손 간격 — 아래 보표 배치·하이라이트가 전부 이 값을 쓴다.
     * 상수를 직접 쓰면 벌어진 줄에서 아래 보표만 제자리에 남아 어긋난다. */
    const bassDy = lineBassDy[li] ?? GRAND_BASS_DY;
    const lineHeadroomPx = lineHeadrooms[li] ?? defaultHeadroom(chordMetrics);
    const decorW = isFirstLine ? DECOR_FIRST : DECOR_OTHER;
    const availForBars = totalW - decorW;
    /* 코드칸 높이는 한 줄 안에서 모두 같아야 한다 — 그 줄에서 가장 높이
     * 올라간 마디가 기준. 줄을 다 그린 뒤라야 알 수 있어, 이 값을 쓰는
     * 하이라이트는 마디 루프가 끝난 다음에 그린다. */
    let lineContentTop = Infinity;
    /* 이 줄에서 push 한 positions 의 시작 index — 줄이 끝난 뒤 chordTop 을 채운다. */
    const posStart = positions.length;
    let activeHL: { m: number; x: number; w: number; stave: Stave; mData: MeasureInfo } | null = null;

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
    /* ⚠ 늘리기만 한다 — 줄이지 않는다.
     * intrinsic 은 "VexFlow 가 이만큼은 있어야 그릴 수 있다"고 답한 최소 폭이다.
     * 비례 배분이 그보다 작은 값을 내면(줄이 꽉 차서 압축되는 경우) 음표가
     * 마디선을 넘는다. 그래서 배분 결과와 intrinsic 중 **큰 쪽**을 쓴다.
     * 그 결과 줄이 오른쪽 여백을 조금 넘을 수는 있어도, 겹치는 일은 없다. */
    const barWidths = shouldStretch && totalIntrinsic > 0
      ? intrinsics.map((w) => Math.max((w / totalIntrinsic) * availForBars, w))
      : intrinsics;

    let x = MARGIN.left;
    for (let j = 0; j < indices.length; j++) {
      const m = indices[j];
      const firstInLine = j === 0;
      const isLast = m === measures.length - 1 && m !== currentIdx;
      const w = firstInLine ? barWidths[j] + decorW : barWidths[j];

      const stave: Stave = p0Tab ? new TabStave(x, y, w, { numLines: tabTuningFor(part0Kind, part0Staff).length }) : new Stave(x, y, w);
      if (firstInLine) {
        if (p0Tab) (stave as TabStave).addTabGlyph();
        else if (p0Drum) stave.addClef('percussion');
        else stave.addClef(clef0, 'default', p0Clef.annotation);
        if (p0Notation && !explicitAcc && curKeyName && curKeyName !== 'C') stave.addKeySignature(curKeyName);
        if (isFirstLine && !p0Tab) stave.addTimeSignature(timeSig);
      }
      // Repeat / end barlines. Default in VexFlow is SINGLE, but assigning
      // it explicitly avoids edge cases where adjacent staves overlap and
      // the bar line visually disappears (the bug screenshot).
      const mData = measures[m];
      /* 마디 중간 조성 변경 — 이 마디부터 임시표 해석·조표 표기가 바뀐다. */
      if (mData.key) {
        curKeyName = mData.key;
        keySigAcc = explicitAcc ? new Map() : keySigAccidentals(curKeyName);
        if (p0Notation && !explicitAcc && !firstInLine) stave.addKeySignature(curKeyName);
      }
      if (mData.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
      if (mData.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
      else if (mData.barline === 'double') stave.setEndBarType(BarlineType.DOUBLE);
      else if (mData.barline === 'end' || isLast) stave.setEndBarType(BarlineType.END);
      else if (mData.barline === 'none') stave.setEndBarType(BarlineType.NONE);
      else stave.setEndBarType(BarlineType.SINGLE);
      // Navigation markers (D.C., Coda, Segno, Fine, etc.)
      if (mData.navigation) {
        const repTypes = NAV_REPETITION[mData.navigation];
        if (repTypes) {
          for (const rt of repTypes) stave.setRepetitionType(rt);
        }
      }
      stave.setContext(ctx).draw();
      // TAB 글리프는 6줄 기준으로 그려져 4·5줄 보표에선 넘친다 → 높이에 맞춘다.
      if (p0Tab) fitTabClefToStave(svgEl, stave, tabTuningFor(part0Kind).length);

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

      // 리허설 마크 — 마디 시작 위 네모 상자(B1 등).
      if (mData.rehearsal && svgEl) {
        const gR = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const tx = x + (firstInLine ? decorW : 0) + 2;
        const tyTop = y + 2;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', String(tx + 5)); t.setAttribute('y', String(tyTop + 13));
        t.setAttribute('font-size', '12'); t.setAttribute('font-weight', '800');
        t.setAttribute('font-family', "'Pretendard', sans-serif"); t.setAttribute('fill', '#222');
        t.textContent = mData.rehearsal;
        const wBox = 10 + mData.rehearsal.length * 8;
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', String(tx)); r.setAttribute('y', String(tyTop));
        r.setAttribute('width', String(wBox)); r.setAttribute('height', '18');
        r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#222'); r.setAttribute('stroke-width', '1.4');
        gR.appendChild(r); gR.appendChild(t);
        svgEl.appendChild(gR);
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
        chordTop: 0, bassDy,   // 줄 렌더가 끝난 뒤 아래에서 확정
      });


      const measure = measures[m];
      const bassM = grand ? bassAt(m) : EMPTY_BASS;

      /* ── 양손: 트레블 아래 베이스 보표 + brace/barline 연결선 ── */
      let bassStave: Stave | null = null;
      if (grand) {
        bassStave = new Stave(x, y + bassDy, w);
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
          drawBrace(stave, bassStave);
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
        new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        positions.push({
          idx: m, x: chordX, y: y + bassDy, w: w - (firstInLine ? decorW : 0) - 4, chordX,
          staveTop: bassStave.getYForLine(0), staveBot: bassStave.getYForLine(4),
          staff: 'bass', chordTop: 0, bassDy,   // 베이스 보표 위에는 코드칸이 없다
        });
      }

      if (measure.notes.length === 0 && bassM.notes.length === 0 && extras.length === 0) {
        /* 빈 마디도 선택 표시가 보여야 한다. 예전엔 여기서 곧장 continue 해
         * 아래 하이라이트 코드에 닿지 않아, 클릭은 되는데 화면은 그대로였다
         * (양손 악보에서 아래 보표부터 채우려 할 때 특히 티가 났다). */
        if (m === activeIdx) {
          const onBass = grand && activeStaff === 'bass';
          const top = onBass
            ? stave.getYForLine(0) + bassDy - 10
            : chordRowTopY(y, { volta: !!mData.volta, bracket: !!mData.bracket }, Infinity)
              - (mData.altChords ? 17 : 0) - 4;
          const bot = stave.getYForLine(4) + (onBass ? bassDy : 0);
          paintMeasureHighlight(el, x, w, top, bot);
        }
        x += w;
        continue;
      }

      const activeAcc: Map<string, RenderAcc> = tieCarryAcc ? new Map(tieCarryAcc) : new Map();
      tieCarryAcc = undefined;

      // vfNotes는 measure.notes와 1:1 유지(ties/gliss/ottava/slur/positions
      // 인덱싱 보존). 단, 꾸밈음은 GraceNote라 voice의 tickable이 아니므로
      // 아래에서 다음 실음에 GraceNoteGroup으로 붙이고 voice엔 실음만 넣는다.
      // (드럼 포함 — 플램이 드럼 표기의 기본 어휘다. buildDrumNote 가 grace 를
      //  GraceNote 로 돌려준다.)
      const vfNotes: StaveNote[] = p0Tab
        ? measure.notes.map((n, ni0) => buildTabVfNote(n, tabPos0?.[m]?.[ni0] ?? null, true, tabTuningFor(part0Kind).length) as unknown as StaveNote)
        : p0Drum
          ? measure.notes.map((n) => buildDrumVfNote(n))
          : displayNotesFor(part0Kind, measure.notes).map((n) => buildVfNote(n, clef0, activeAcc, keySigAcc, !explicitAcc));
      // 꾸밈음을 다음 실음에 부착 (연속 꾸밈음은 한 그룹으로 묶는다).
      if (p0Notation || p0Drum) {
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
        voice = new Voice({ numBeats: vNumBeats, beatValue: vBeatValue });
        voice.setStrict(false);
        voice.addTickables(realVfNotes); // 꾸밈음 제외 — 그룹 수식으로만 그려짐
        voices.push(voice);
      }
      let bassVfNotes: StaveNote[] = [];  // 실음만(꾸밈음 제외)
      let realBassNotes: NoteInfo[] = [];
      let bassVoice: Voice | null = null;
      if (grand && bassM.notes.length > 0 && bassStave) {
        const bassActive: Map<string, RenderAcc> = new Map();
        const bassAll = bassM.notes.map((n) => buildVfNote(n, 'bass', bassActive, keySigAcc, !explicitAcc));
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
          bassVoice = new Voice({ numBeats: vNumBeats, beatValue: vBeatValue });
          bassVoice.setStrict(false);
          bassVoice.addTickables(bassVfNotes);
          voices.push(bassVoice);
        }
      }
      /* ── 보이스 2 — 같은 보표의 두 번째 성부. 보이스1 기둥 위·보이스2 기둥
       * 아래 관례(명시 stem 이 있으면 그쪽 우선). 한 Formatter 로 묶여 세로
       * 정렬되고, 빔·타이는 성부별 독립. */
      let v2VfNotes: StaveNote[] = [];
      let v2Notes: NoteInfo[] = [];
      let v2Voice: Voice | null = null;
      if (p0Notation && (measure.voice2?.length ?? 0) > 0) {
        v2Notes = measure.voice2!;
        const v2Acc: Map<string, RenderAcc> = new Map();
        v2VfNotes = displayNotesFor(part0Kind, v2Notes).map((n) => buildVfNote(n, clef0, v2Acc, keySigAcc, !explicitAcc));
        v2VfNotes.forEach((vn, vi2) => { if (!v2Notes[vi2].stem) try { vn.setStemDirection(-1); } catch { /* noop */ } });
        // 보이스1은 위로 — 두 성부가 겹치지 않게.
        realVfNotes.forEach((vn, vi2) => { if (!realNotes[vi2]?.stem) try { vn.setStemDirection(1); } catch { /* noop */ } });
        v2Voice = new Voice({ numBeats: vNumBeats, beatValue: vBeatValue });
        v2Voice.setStrict(false);
        v2Voice.addTickables(v2VfNotes);
        voices.push(v2Voice);
        for (let ni2 = 0; ni2 < v2VfNotes.length; ni2++) {
          allV2VfNotes.push({ mi: m, ni: ni2, vfNote: v2VfNotes[ni2] });
        }
      }

      /* ── 추가 파트 행 — part0 아래로 쌓는다. 마디 폭·barline 은 part0 와
       * 동일(도돌이 등 반복 구조는 시스템 전체 속성). 음표는 파트 종류별
       * 빌더로 만들고, 아래에서 part0 voices 와 **한 Formatter** 로 묶어
       * 세로 열이 맞게 정렬한다. */
      const extraBuilt: ExtraRowBuilt = { staves: [], voices: [], rows: [] };
      /* 이 줄에 쌓인 보표들을 위→아래 시각 순서로 모아 둔다. 아래에서 인접한
       * 높은음자리표+낮은음자리표 쌍을 중괄호로 묶는 데 쓴다. 한 파트가 여러
       * 보표를 쓰면(피아노 양손·오선 동반 TAB) top/bottom 이 서로 다르다. */
      const systemGroups: Array<{ kind: StaffKind; top: Stave; bottom: Stave }> = [
        { kind: part0Kind, top: stave, bottom: bassStave ?? stave },
      ];
      {
        let rowY = y + (grand ? bassDy : 0) + (p0Tab ? EXTRA_ROW_TAB : EXTRA_ROW_NOTATION);
        const mkStave = (spec: { tab: StaffKind; staff?: RenderPart } | { clef: NotationClef; annotation?: '8vb' }, sy: number): Stave => {
          const isTabStave = 'tab' in spec;
          const st: Stave = isTabStave
            ? new TabStave(x, sy, w, { numLines: tabTuningFor(spec.tab, spec.staff).length })
            : new Stave(x, sy, w);
          if (firstInLine) {
            if (isTabStave) (st as TabStave).addTabGlyph();
            else {
              st.addClef(spec.clef, 'default', spec.annotation);
              // 조표는 피치 클레프 전부(C 클레프 포함) — 퍼커션만 제외.
              if (spec.clef !== 'percussion' && !explicitAcc && sheetKey && sheetKey !== 'C') st.addKeySignature(sheetKey);
            }
            if (isFirstLine && !isTabStave) st.addTimeSignature(timeSig);
          }
          if (mData.repeatStart) st.setBegBarType(BarlineType.REPEAT_BEGIN);
          if (mData.repeatEnd) st.setEndBarType(BarlineType.REPEAT_END);
          else if (isLast) st.setEndBarType(BarlineType.END);
          else st.setEndBarType(BarlineType.SINGLE);
          st.setContext(ctx).draw();
          if (isTabStave) fitTabClefToStave(svgEl, st, tabTuningFor(spec.tab).length);
          extraBuilt.staves.push(st);
          return st;
        };
        const addRow = (
          pi: number, st: Stave, ms: MeasureInfo, kind: StaffKind,
          opts: {
            isTab?: boolean; bassRow?: boolean; tabPos?: (TabPos[] | null)[] | null;
            /** TAB 단독 행 — 리듬 기둥을 함께 그린다. */
            tabStems?: boolean;
            clef?: 'treble' | 'bass' | 'alto' | 'tenor';
            /** 표기 옥타브 시프트 판정용 종류 — TAB 동반 오선처럼 kind 와 표기
             *  규약이 다를 때만 넘긴다(기타 TAB 의 오선은 treble-8vb 관례). */
            dispKind?: StaffKind;
          },
        ) => {
          const vf: (StaveNote | TabNote | GhostNote)[] = opts.isTab
            ? ms.notes.map((n, ni0) => buildTabVfNote(n, opts.tabPos?.[ni0] ?? null, opts.tabStems, tabTuningFor(kind).length))
            : kind === 'drum'
              ? ms.notes.map((n) => buildDrumVfNote(n))
              : (() => {
                  const acc: Map<string, RenderAcc> = new Map();
                  return displayNotesFor(opts.dispKind ?? kind, ms.notes).map((n) => buildVfNote(n, opts.clef ?? 'treble', acc, keySigAcc, !explicitAcc));
                })();
          /* 꾸밈음은 tickable 이 아니다 — voice 에 넣으면 마디 시간이 넘친다.
           * part0 와 같은 규칙: 실음만 voice 에, grace 는 다음 실음의
           * GraceNoteGroup 으로(표기 행·드럼 행. TAB 행은 grace 미표기). */
          const reals: StaveNote[] = [];
          if (!opts.isTab) {
            let pendingG: GraceNote[] = [];
            for (let gi = 0; gi < vf.length; gi++) {
              if (ms.notes[gi]?.grace) { pendingG.push(vf[gi] as unknown as GraceNote); continue; }
              if (pendingG.length > 0) {
                try { (vf[gi] as StaveNote).addModifier(new GraceNoteGroup(pendingG, false), 0); } catch { /* noop */ }
                pendingG = [];
              }
              reals.push(vf[gi] as StaveNote);
            }
          } else {
            for (let gi = 0; gi < vf.length; gi++) {
              if (!ms.notes[gi]?.grace) reals.push(vf[gi] as unknown as StaveNote);
            }
          }
          if (reals.length > 0) {
            const v = new Voice({ numBeats: vNumBeats, beatValue: vBeatValue });
            v.setStrict(false);
            v.addTickables(reals);
            extraBuilt.voices.push(v);
          }
          extraBuilt.rows.push({ stave: st, vf, notes: ms.notes, isTab: !!opts.isTab, isBassRow: opts.bassRow, isDrum: kind === 'drum', tabStems: opts.tabStems });
          for (let ni0 = 0; ni0 < vf.length; ni0++) {
            allExtraVf.push({ pi, mi: m, ni: ni0, vfNote: vf[ni0] as unknown as StaveNote, bassRow: !!opts.bassRow, isTabRow: !!opts.isTab });
            /* TAB(숫자)·드럼(GM 퍼커션 키)은 음이름을 붙이면 거짓 정보가 된다. */
            if (!opts.isTab && kind !== 'drum') {
              nameTargets.push({ vfNote: vf[ni0] as unknown as StaveNote, keys: ms.notes[ni0]?.keys ?? [] });
            }
          }
          positions.push({
            idx: m, x: chordX, y: st.getY(), w: w - (firstInLine ? decorW : 0) - 4, chordX,
            staveTop: st.getYForLine(0), staveBot: st.getYForLine(opts.isTab ? tabTuningFor(kind).length - 1 : 4),
            part: pi, chordTop: 0, bassDy,   // 추가 파트 행에는 코드칸이 없다
            ...(opts.bassRow ? { staff: 'bass' as const } : {}),
          });
          // 활성(선택) 마디 하이라이트 — 추가 파트 행은 오선 범위 기준의 단순형.
          const onThis = pi === activePartIdx && m === activeIdx
            && (kind !== 'grand' || (opts.bassRow ? activeStaff === 'bass' : activeStaff !== 'bass'));
          if (onThis) {
            paintMeasureHighlight(el, x, w, st.getYForLine(0) - 12, st.getYForLine(opts.isTab ? tabTuningFor(kind).length - 1 : 4) + 12);
          }
        };
        for (let pi = 0; pi < extras.length; pi++) {
          const ep = extras[pi];
          const partIdx = pi + 1;
          const em = ep.measures[m] ?? EMPTY_BASS;
          if (ep.kind === 'grand') {
            const st1 = mkStave({ clef: 'treble' }, rowY);
            const st2 = mkStave({ clef: 'bass' }, rowY + EXTRA_ROW_NOTATION);
            if (firstInLine) {
              try { drawBrace(st1, st2); } catch { /* noop */ }
              try { new StaveConnector(st1, st2).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw(); } catch { /* noop */ }
            }
            try { new StaveConnector(st1, st2).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw(); } catch { /* noop */ }
            addRow(partIdx, st1, em, 'grand', { clef: 'treble' });
            addRow(partIdx, st2, ep.bassMeasures?.[m] ?? EMPTY_BASS, 'grand', { clef: 'bass', bassRow: true });
            systemGroups.push({ kind: ep.kind, top: st1, bottom: st2 });
          } else if (isTabKind(ep.kind)) {
            let stN: Stave | null = null;
            if (ep.withNotation) {
              /* TAB 동반 오선의 클레프는 악기 관례를 따른다 — 기타 = treble-8vb,
               * 우쿨렐레 = treble, 베이스(4·5현) = bass. */
              const notationKind: StaffKind =
                ep.kind === 'guitar-tab' ? 'treble-8vb'
                : (ep.kind === 'bass-tab' || ep.kind === 'bass5-tab') ? 'bass'
                : 'treble';
              const nc = clefForKind(notationKind);
              stN = mkStave({ clef: nc.clef, annotation: nc.annotation }, rowY);
              addRow(partIdx, stN, em, ep.kind, {
                clef: nc.clef as 'treble' | 'bass' | 'alto' | 'tenor',
                dispKind: notationKind,
              });
            }
            const dgOff = ep.chordDiagrams ? DIAGRAM_H : 0;
            const stT = mkStave({ tab: ep.kind, staff: ep }, rowY + (ep.withNotation ? EXTRA_ROW_NOTATION : 0) + dgOff);
            addRow(partIdx, stT, em, ep.kind, { isTab: true, tabPos: extraTabPos[pi]?.[m] ?? null, tabStems: !ep.withNotation });
            /* 코드 다이어그램 — part0 마디의 코드심볼(더블 슬롯이면 첫 코드)로,
             * 이 마디 TAB 위 공간에 그린다. 코드 없으면 빈 공간. */
            if (ep.chordDiagrams && svgEl) {
              const chordTxt = (measures[m]?.chord ?? '').split(/\s{2,}/)[0]?.trim();
              if (chordTxt) {
                /* chords-db 조회 — 운지를 계산하지 않는다. 베이스·카포·드롭D 는
                 * 표준 튜닝 폼이 맞지 않아 null 이 돌아오고, 그러면 안 그린다. */
                const dg = dbDiagramFor(chordTxt, ep.kind, ep.capo, ep.tuningPreset);
                if (dg) {
                  try { drawFretDiagram(svgEl, x + (firstInLine ? decorW : 0) + 10, stT.getY() - DIAGRAM_H + 12, DIAGRAM_W, dg.position, chordTxt); } catch { /* noop */ }
                }
              }
            }
            systemGroups.push({ kind: ep.kind, top: stN ?? stT, bottom: stT });
          } else {
            const cf = clefForKind(ep.kind);
            const st = mkStave({ clef: cf.clef, annotation: cf.annotation }, rowY);
            addRow(partIdx, st, em, ep.kind, {
              clef: (cf.clef === 'percussion' ? 'treble' : cf.clef) as 'treble' | 'bass' | 'alto' | 'tenor',
            });
            systemGroups.push({ kind: ep.kind, top: st, bottom: st });
          }
          rowY += extraPartHeight(ep);
        }
        /* 위아래로 붙은 높은음자리표 + 낮은음자리표는 한 악기의 그랜드 스태프로
         * 보고 중괄호로 묶는다 — 스태프를 둘로 나눠 만든 피아노 악보도 '피아노
         * 양손' 한 파트와 똑같은 모양(중괄호 + 좌우 세로선)으로 그려진다. */
        for (let gi = 0; gi + 1 < systemGroups.length; gi++) {
          const a = systemGroups[gi];
          const b = systemGroups[gi + 1];
          if (a.kind !== 'treble' || b.kind !== 'bass') continue;
          if (firstInLine) {
            try { drawBrace(a.top, b.bottom); } catch { /* noop */ }
            try { new StaveConnector(a.top, b.bottom).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw(); } catch { /* noop */ }
          }
          try { new StaveConnector(a.top, b.bottom).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw(); } catch { /* noop */ }
        }
        extraBuilt.voices.forEach((v) => voices.push(v));
      }
      if (bassStave || extraBuilt.staves.length > 0) {
        // 클레프/조표 폭이 달라도 모든 보표의 음표 시작 x를 맞춘다.
        try { Stave.formatBegModifiers([stave, ...(bassStave ? [bassStave] : []), ...extraBuilt.staves]); } catch { /* noop */ }
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
      /* standalone TAB 도 빔을 그린다 — TabNote 는 StemmableNote 라 Beam 이 그대로
       * 동작한다. preserve 모드(둘째 플래그)로 아래 방향 스템을 지킨다. */
      const beams = voice ? buildBeams(realNotes, realVfNotes, p0Drum || p0Tab) : [];
      const bassBeams = bassVoice ? buildBeams(realBassNotes, bassVfNotes) : [];

      if (voice) voice.draw(ctx, stave);
      /* 가사 앵커 — 포맷 후라 x 확정. realNotes/realVfNotes 는 꾸밈음을 뺀 1:1 쌍. */
      for (let ri = 0; ri < realVfNotes.length; ri++) {
        let cx: number;
        try { const bb = realVfNotes[ri].getBoundingBox(); cx = bb.getX() + bb.getW() / 2; }
        catch { continue; }
        lineNoteXs.push(cx);
        const src = realNotes[ri];
        if (src?.lyrics?.length) lineLyrics.push({ x: cx, lyrics: src.lyrics });
      }
      if (p0Tab && voice) drawTabTechniques(ctx, realNotes, realVfNotes as unknown as (StaveNote | TabNote | GhostNote)[]);
      beams.forEach((bm) => bm.setContext(ctx).draw());
      if (v2Voice) {
        v2Voice.draw(ctx, stave);
        buildBeams(v2Notes, v2VfNotes).forEach((bm) => bm.setContext(ctx).draw());
        drawTupletBrackets(v2Notes, v2VfNotes, ctx);
      }
      if (bassVoice && bassStave) bassVoice.draw(ctx, bassStave);
      bassBeams.forEach((bm) => bm.setContext(ctx).draw());
      /* 추가 파트 행 드로우 — 표기 행은 빔·투플렛까지, TAB 행은 숫자만. */
      {
        let evi = 0;
        for (const row of extraBuilt.rows) {
          if (row.vf.length === 0) continue;
          const rv = extraBuilt.voices[evi++];
          if (!rv) continue;
          rv.draw(ctx, row.stave);
          if (row.isTab) drawTabTechniques(ctx, row.notes, row.vf);
          if (!row.isTab) {
            const rReal = row.notes.filter((n) => !n.grace);
            const rVf = (row.vf as unknown as StaveNote[]).filter((_, ni0) => !row.notes[ni0].grace);
            buildBeams(rReal, rVf, !!row.isDrum).forEach((bm) => bm.setContext(ctx).draw());
            drawTupletBrackets(rReal, rVf, ctx);
          } else if (row.tabStems) {
            /* standalone TAB 행 — 리듬 스템이 있으니 빔도 그린다(preserve 모드). */
            buildBeams(row.notes, row.vf as unknown as StaveNote[], true)
              .forEach((bm) => bm.setContext(ctx).draw());
          }
        }
      }

      if (!p0Tab) drawTupletBrackets(realNotes, realVfNotes, ctx);
      if (bassVfNotes.length) drawTupletBrackets(realBassNotes, bassVfNotes, ctx);

      /* 이 마디에서 가장 높이 올라간 요소의 Y. bbox 는 기둥·빔까지 포함하므로
       * 음높이만 보는 것보다 정확하다 — voice.draw() 뒤라야 유효하다.
       * ⚠ 꾸밈음(GraceNote)은 제외 — voice 에 들어가지 않고 GraceNoteGroup
       * 수식으로 그려져 자체 bbox 가 미포맷 좌표(y≈0)로 남는다. 포함하면
       * 그 줄의 lineContentTop 이 0 으로 무너져 코드칸 전부가 시트 맨 위
       * (CHORD_TOP_MIN)로 날아간다 — MusicXML 수입 악보에서 실측된 버그. */
      for (const vn of realVfNotes) {
        const bb = vn.getBoundingBox();
        if (!bb) continue;
        const bbY = bb.getY();
        /* GraceNoteGroup 이 붙은 본음표는 bbox 가 미포맷 그룹 좌표(y≈0)로
         * 무너진다 — 이 줄 위로 상식적 범위(덧줄+장식 ≤150px)를 벗어난 값은
         * 무시한다. 안 그러면 그 줄 코드칸 전체가 시트 맨 위로 날아간다
         * (MusicXML 꾸밈음 수입 악보에서 실측). */
        if (!Number.isFinite(bbY) || bbY < y - 150) continue;
        lineContentTop = Math.min(lineContentTop, bbY);
      }

      // 하이라이트는 줄 기준 높이가 확정된 뒤(마디 루프 종료 후) 그린다.
      if (activePartIdx === 0 && m === activeIdx) activeHL = { m, x, w, stave, mData };

      for (let ni = 0; ni < vfNotes.length; ni++) {
        allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni] });
        if (p0Notation) nameTargets.push({ vfNote: vfNotes[ni], keys: measure.notes[ni]?.keys ?? [] });
      }
      for (let ni = 0; ni < bassVfNotes.length; ni++) {
        allBassVfNotes.push({ mi: m, ni, vfNote: bassVfNotes[ni] });
        nameTargets.push({ vfNote: bassVfNotes[ni], keys: bassM.notes[ni]?.keys ?? [] });
      }

      x += w;
    }

    /* 코드 입력칸 윗변을 이 줄의 확정된 contentTop 으로 계산해 positions 에 심는다.
     * **여기가 유일한 계산 지점** — DOM 오버레이(코드칸)와 아래 마디 하이라이트가
     * 같은 값을 읽으므로 둘이 어긋날 수 없다(예전엔 각자 계산해 노란 하이라이트가
     * 코드칸까지 닿지 않았다). */
    for (let pi2 = posStart; pi2 < positions.length; pi2++) {
      const p = positions[pi2];
      if (p.staff || p.part) continue;              // 코드칸은 첫 파트 트레블에만
      const md = measures[p.idx];
      /* 예약해 둔 headroom 밖으로는 절대 못 나간다 — 윗줄 침범 차단 빗장. */
      p.chordTop = clampChordTop(
        chordRowTopY(p.staveTop, { volta: !!md?.volta, bracket: !!md?.bracket }, lineContentTop),
        p.staveTop, lineHeadroomPx,
      );
    }

    /* 편집 중 마디 하이라이트 — 줄 전체를 그린 뒤라야 lineContentTop 이 확정된다.
     *   위: 코드 입력 행의 윗변 (대체코드가 있으면 그 행까지)
     *   아래: 보표 마지막 줄. 단 음표가 그 아래로 내려가면(덧줄) 그 음표 밑에
     *         여백을 두고 거기까지.
     * ※ y(Stave 원점)에서 오프셋을 추정하면 안 된다 — 실제 오선은
     *   getYForLine() 이 정확하다(원점과 첫 줄 사이에 여백이 있다). */
    if (activeHL) {
      const { m: hm, x: hx, w: hw, stave: hStave, mData: hData } = activeHL;
      const mNotes = measures[hm]?.notes ?? [];
      const staffBot = hStave.getYForLine(4);      // 트레블 오선 마지막 줄
      const NOTE_PAD = 8;                          // 오선 밖 음표 아래 여백
      /* 머리가 마지막 줄 아래로 조금이라도 나오면(맨 아랫줄에 걸친 음 포함)
       * 그만큼 더 내려간다. 오선 안에만 있으면 마지막 줄에서 끝. */
      const extend = (low: number | null, base: number) =>
        low !== null && low > base ? low + NOTE_PAD : base;

      /* 양손 악보는 위/아래 보표를 각각 고른다. 예전엔 트레블을 골라도
       * 하이라이트가 베이스까지 한 덩어리로 덮여, "1번째 위 마디"와
       * "1번째 아래 마디"가 화면상 구분되지 않았다. */
      const onBass = grand && activeStaff === 'bass';

      const HL_TOP = onBass
        /* 베이스 보표 위에는 코드 입력 행이 없으니 오선 첫 줄에서 조금만 띄운다. */
        ? hStave.getYForLine(0) + bassDy - 10
        // 코드칸과 완전히 같은 계산 — 칸이 밀려 올라가면 하이라이트도 따라간다.
        : clampChordTop(
            chordRowTopY(hStave.getYForLine(0), { volta: !!hData.volta, bracket: !!hData.bracket }, lineContentTop),
            hStave.getYForLine(0), lineHeadroomPx,
          )
          - (hData.altChords ? 17 : 0)
          - 4;                                     // 코드 입력 윗변 + 살짝

      const HL_BOT = onBass
        ? extend(
            bottomNoteGlyphY(bassAt(hm).notes,
              (line) => hStave.getYForLine(line) + bassDy, 'bass'),
            staffBot + bassDy,
          )
        : extend(
            bottomNoteGlyphY(mNotes, (line) => hStave.getYForLine(line)),
            staffBot,
          );
      paintMeasureHighlight(el, hx, hw, HL_TOP, HL_BOT);
    }

    /* ── 가사 작도 — 뷰어와 완전히 같은 구현(lyricLayout). ── */
    if (lineLyrics.length > 0 && svgEl) {
      lineLyrics.sort((p1, p2) => p1.x - p2.x);
      lineNoteXs.sort((p1, p2) => p1 - p2);
      drawLyrics(svgEl, lineLyrics, {
        baselineY: lineOriginY[li] + SPACE_ABOVE + 4 * 10 + LYRIC_TOP_GAP,
        rightEdge: MARGIN.left + totalW,
        noteXs: lineNoteXs,
      });
    }
  }

  /* 음이름 라벨 — 모든 보표를 그린 뒤 마지막에 얹는다(레이아웃 불변). */
  if (noteNameStyle) drawNoteNameLabels(svgEl, nameTargets, noteNameStyle);

  // Build measure→line lookup
  const measureLine = new Map<number, number>();
  for (let li = 0; li < lines.length; li++) {
    for (const idx of lines[li]) measureLine.set(idx, li);
  }

  // Draw ties. Cross-line ties need two open-ended half ties; drawing one
  // StaveTie across different systems either disappears or spans the page.
  // TAB 파트는 TabTie(같은 호 모양, TabNote 대응)로 그린다.
  const TieCls = p0Tab ? TabTie : StaveTie;
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
            try {
              const tie = new TieCls({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] });
              tie.setContext(ctx).draw();
            } catch (e) { console.warn('tie draw failed', e); }
          } else {
            try {
              const halfStart = new TieCls({ firstNote: from.vfNote, lastNote: undefined, firstIndexes: [0], lastIndexes: [0] });
              halfStart.setContext(ctx).draw();
              const halfEnd = new TieCls({ firstNote: undefined, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] });
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
    let active: { kind: '8va' | '8vb' | '15ma' | '15mb'; idx: number } | null = null;
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
              const up = active.kind === '8va' || active.kind === '15ma';
              const tb = new TextBracket({
                start: from.vfNote,
                stop: to.vfNote,
                text: active.kind.startsWith('15') ? '15' : '8',
                superscript: active.kind === '8va' ? 'va' : active.kind === '8vb' ? 'vb' : active.kind === '15ma' ? 'ma' : 'mb',
                position: up ? TextBracketPosition.TOP : TextBracketPosition.BOTTOM,
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

  // Draw hairpins (crescendo < / decrescendo >) — NoteSheet 와 같은 마커 규약:
  // hairpinStart 를 단 음표부터 hairpinStop 을 단 음표까지, 같은 줄일 때만.
  // ⚠️ 여기 allVfNotes 는 NoteSheet 와 달리 grace 를 **포함**해 measure.notes 와
  // 1:1 이다(978 push) — 그래서 grace 도 hIdx 를 올리고, 마커 처리만 건너뛴다.
  {
    let activeHairpin: { kind: 'cresc' | 'dim'; flatIdx: number } | null = null;
    let hIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        const n = measure.notes[ni];
        if (n.grace) { hIdx++; continue; }
        if (n.hairpinStart) activeHairpin = { kind: n.hairpinStart, flatIdx: hIdx };
        if (n.hairpinStop && activeHairpin) {
          const from = allVfNotes[activeHairpin.flatIdx];
          const to = allVfNotes[hIdx];
          if (from && to && measureLine.get(from.mi) === measureLine.get(to.mi)) {
            try {
              const type = activeHairpin.kind === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC;
              new StaveHairpin({ firstNote: from.vfNote, lastNote: to.vfNote }, type).setContext(ctx).draw();
            } catch (e) { console.warn('hairpin draw failed', e); }
          }
          activeHairpin = null;
        }
        hIdx++;
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

  // 보이스 2 타이 — 같은 줄 안의 단순 타이(왼손 파트와 동일 규칙).
  if (allV2VfNotes.length) {
    const byPos = new Map<string, { vfNote: StaveNote; mi: number }>();
    allV2VfNotes.forEach((e) => byPos.set(`${e.mi}-${e.ni}`, { vfNote: e.vfNote, mi: e.mi }));
    for (let mi = 0; mi < measures.length; mi++) {
      const vn2 = measures[mi].voice2 ?? [];
      for (let ni = 0; ni < vn2.length; ni++) {
        if (!vn2[ni].tie) continue;
        const from = byPos.get(`${mi}-${ni}`);
        const to = byPos.get(`${mi}-${ni + 1}`) ?? byPos.get(`${mi + 1}-0`);
        if (!from || !to) continue;
        if (measureLine.get(from.mi) !== measureLine.get(to.mi)) continue;
        try {
          new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
        } catch (e) { console.warn('voice2 tie draw failed', e); }
      }
    }
  }

  // 페달 마킹 — pedalStart(Ped.) 음표부터 pedalEnd(*) 음표까지, 같은 줄일 때만.
  if (p0Notation) {
    let pedalFrom: number | null = null;
    let pIdx = 0;
    for (let mi = 0; mi < measures.length; mi++) {
      for (let ni = 0; ni < measures[mi].notes.length; ni++) {
        const n = measures[mi].notes[ni];
        if (n.pedalStart && pedalFrom === null) pedalFrom = pIdx;
        if (n.pedalEnd && pedalFrom !== null) {
          const from = allVfNotes[pedalFrom];
          const to = allVfNotes[pIdx];
          if (from && to && measureLine.get(from.mi) === measureLine.get(to.mi)) {
            try {
              const pm = new PedalMarking([from.vfNote, to.vfNote]);
              pm.setType(PedalMarking.type.MIXED);
              pm.setContext(ctx).draw();
            } catch (e) { console.warn('pedal draw failed', e); }
          }
          pedalFrom = null;
        }
        pIdx++;
      }
    }
  }

  // 추가 파트 타이 — 표기 행만, 같은 줄 안의 단순 타이(왼손 파트와 동일 규칙).
  if (allExtraVf.length) {
    const byPos = new Map<string, { vfNote: StaveNote; mi: number }>();
    for (const e of allExtraVf) {
      if (e.isTabRow) continue;
      byPos.set(`${e.pi}|${e.bassRow ? 'b' : 't'}|${e.mi}-${e.ni}`, { vfNote: e.vfNote, mi: e.mi });
    }
    for (let pi = 0; pi < extras.length; pi++) {
      const ep = extras[pi];
      if (isTabKind(ep.kind)) continue; // withNotation 표기 행 타이는 v2
      const rows: Array<{ ms: MeasureInfo[]; bass: boolean }> = [{ ms: ep.measures, bass: false }];
      if (ep.kind === 'grand' && ep.bassMeasures) rows.push({ ms: ep.bassMeasures, bass: true });
      for (const { ms, bass } of rows) {
        for (let mi = 0; mi < ms.length; mi++) {
          const notes = ms[mi]?.notes ?? [];
          for (let ni = 0; ni < notes.length; ni++) {
            if (!notes[ni].tie) continue;
            const pfx = `${pi + 1}|${bass ? 'b' : 't'}|`;
            const from = byPos.get(`${pfx}${mi}-${ni}`);
            const to = byPos.get(`${pfx}${mi}-${ni + 1}`) ?? byPos.get(`${pfx}${mi + 1}-0`);
            if (!from || !to) continue;
            if (measureLine.get(from.mi) !== measureLine.get(to.mi)) continue;
            try {
              new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
            } catch (e) { console.warn('extra part tie draw failed', e); }
          }
        }
      }
    }
  }

  // Collect note bounding boxes for click detection & highlight selected note
  if (svgEl) {
    for (const entry of allBassVfNotes) {
      const rect = reliableNoteRect(entry.vfNote);
      if (rect && notePositions && activePartIdx === 0) {
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: rect.x, y: rect.y, w: rect.w, h: rect.h, ...collectHeadRect(entry.vfNote), staff: 'bass' });
      }
    }
    for (const entry of allV2VfNotes) {
      const rect = reliableNoteRect(entry.vfNote);
      if (rect && notePositions && activePartIdx === 0) {
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: rect.x, y: rect.y, w: rect.w, h: rect.h, ...collectHeadRect(entry.vfNote), v2: true });
      }
      if (activePartIdx === 0 && selectedNotes?.some((s2) => s2.v2 && s2.mi === entry.mi && s2.ni === entry.ni)) {
        const RED = '#d32f2f';
        const noteSvg = entry.vfNote.getSVGElement?.();
        if (noteSvg) {
          const applyRed = (elm: Element) => {
            const st2 = (elm as SVGElement).style;
            st2.fill = RED; st2.stroke = RED;
            elm.querySelectorAll('*').forEach((c2) => { const cs = (c2 as SVGElement).style; cs.fill = RED; cs.stroke = RED; });
          };
          applyRed(noteSvg);
          let parent = noteSvg.parentElement;
          while (parent && parent !== (svgEl as unknown as HTMLElement)) {
            const cls = parent.getAttribute('class') || '';
            if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) { applyRed(parent); break; }
            parent = parent.parentElement;
          }
        }
      }
    }
    /* 활성 추가 파트의 음표 좌표 + 선택 하이라이트 — 편집은 항상 활성 파트라
     * notePositions 는 그 파트 것만 수집한다(비활성 파트는 마디 클릭 = 전환). */
    for (const entry of allExtraVf) {
      if (entry.pi !== activePartIdx) continue;   // entry.pi 는 이미 1-based partIdx
      const bb = reliableNoteRect(entry.vfNote);
      if (bb && notePositions) {
        notePositions.push({
          mi: entry.mi, ni: entry.ni, x: bb.x, y: bb.y, w: bb.w, h: bb.h,
          ...collectHeadRect(entry.vfNote as unknown as { getNoteHeadBeginX(): number; getNoteHeadEndX(): number; getYs(): number[] }),
          part: activePartIdx, ...(entry.bassRow ? { staff: 'bass' as const } : {}),
        });
      }
      if (selectedNotes?.some((sel0) => sel0.mi === entry.mi && sel0.ni === entry.ni && (sel0.staff === 'bass') === entry.bassRow)) {
        const RED = '#d32f2f';
        const noteSvg = entry.vfNote.getSVGElement?.();
        if (noteSvg) {
          const applyRed = (elm: Element) => {
            const st = (elm as SVGElement).style;
            st.fill = RED; st.stroke = RED;
            elm.querySelectorAll('*').forEach((c) => { const cs = (c as SVGElement).style; cs.fill = RED; cs.stroke = RED; });
          };
          applyRed(noteSvg);
          let parent = noteSvg.parentElement;
          while (parent && parent !== (svgEl as unknown as HTMLElement)) {
            const cls = parent.getAttribute('class') || '';
            if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote') || cls.includes('vf-tabnote')) { applyRed(parent); break; }
            parent = parent.parentElement;
          }
        }
      }
    }
    for (const entry of allVfNotes) {
      const rect = reliableNoteRect(entry.vfNote);
      if (rect && notePositions && activePartIdx === 0) {
        /* 아티큘레이션·주석은 note bbox 밖(위)으로 나간다 — SVG 그룹 bbox 로
         * 상단을 확장해야 코드칸 간격 계산(lineContentTop)이 장식까지 피한다. */
        let topY = rect.y;
        try {
          const gb = (entry.vfNote.getSVGElement?.() as SVGGraphicsElement | undefined)?.getBBox?.();
          if (gb && Number.isFinite(gb.y) && gb.y < topY && gb.y > topY - 80) topY = gb.y;
        } catch { /* jsdom 등 getBBox 미지원 */ }
        notePositions.push({ mi: entry.mi, ni: entry.ni, x: rect.x, y: topY, w: rect.w, h: rect.y + rect.h - topY, ...collectHeadRect(entry.vfNote) });
      }
      if (noteElMap) {
        const svgNode = entry.vfNote.getSVGElement();
        if (svgNode) noteElMap.set(`${entry.mi}-${entry.ni}`, svgNode as SVGElement);
      }
      if (activePartIdx === 0 && selectedNotes?.some((s) => s.staff !== 'bass' && s.mi === entry.mi && s.ni === entry.ni)) {
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
    for (const sel of (activePartIdx === 0 ? selectedNotes : null) ?? []) {
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

  /* ── 상단 세로 안전 여백 — **가장 위에 오는 것이 무엇이든**(높은 음표·빔·
   * 아티큘레이션·코드 입력칸·대체코드 행) 절대 잘리지 않게 하는 최종 안전장치.
   * 그려진 SVG 전체 bbox 와, 페이지가 그릴 코드칸의 예상 상단(같은 식으로 미리
   * 계산)을 함께 보고, SAFE_TOP 보다 위로 올라가면 그 부족분만큼 내용 전체를
   * 아래로 밀고 시트 높이를 늘린다. positions/notePositions 도 같이 이동하므로
   * 클릭·오버레이 좌표가 어긋나지 않는다. */
  if (svgEl) {
    const SAFE_TOP = 6;
    let minTop = Infinity;
    try {
      const gb = (svgEl as unknown as SVGGraphicsElement).getBBox();
      if (Number.isFinite(gb.y)) minTop = Math.min(minTop, gb.y);
    } catch { /* jsdom 등 */ }
    if (notePositions) {
      // 줄(트레블 stave 원점 Y)별 최고점 → 코드칸 상단 예상치.
      const staveYByMi = new Map<number, number>();
      for (const p of positions) if (!p.staff && !p.part) staveYByMi.set(p.idx, p.y);
      const lineTops = new Map<number, number>();
      for (const np of notePositions) {
        if (np.staff || np.part) continue;
        const sy = staveYByMi.get(np.mi);
        if (sy === undefined) continue;
        lineTops.set(sy, Math.min(lineTops.get(sy) ?? Infinity, np.y));
      }
      for (const p of positions) {
        if (p.staff || p.part) continue;
        const md = measures[p.idx];
        if (!md) continue;
        let ct = chordRowTopY(p.y, { volta: !!md.volta, bracket: !!md.bracket }, lineTops.get(p.y) ?? Infinity);
        if (md.altChords) ct -= 21;   // 대체코드 행(17px) + 간격 — 하이라이트와 같은 값
        minTop = Math.min(minTop, ct);
      }
    }
    if (Number.isFinite(minTop) && minTop < SAFE_TOP) {
      const dy = Math.ceil(SAFE_TOP - minTop);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(0, ${dy})`);
      while (svgEl.firstChild) g.appendChild(svgEl.firstChild);
      svgEl.appendChild(g);
      const newH = totalH + dy;
      renderer.resize(innerW, newH);
      el.style.height = `${newH * SHEET_SCALE}px`;
      for (const p of positions) { p.y += dy; p.staveTop += dy; p.staveBot += dy; }
      if (notePositions) {
        for (const np of notePositions) {
          np.y += dy;
          if (np.headYs) np.headYs = np.headYs.map((v) => v + dy);
        }
      }
    }
  }
}

/* ─── SVG icons ────────────────────────────────────────────────────────── */


/* 스태프 종류 미리보기 — 모달 카드용 미니 아이콘. 오선 수·클레프 글리프·
 * TAB 줄 수를 종류 메타에서 끌어와 11종 전부를 한 컴포넌트가 그린다. */
const StaffKindPreview = ({ kind }: { kind: StaffKind }) => {
  const lines = (n: number, y0: number, gap: number) =>
    Array.from({ length: n }, (_, i) => (
      <line key={i} x1="8" y1={y0 + i * gap} x2="112" y2={y0 + i * gap} stroke="#9aa0a6" strokeWidth="1" />
    ));
  const CLEF: Partial<Record<StaffKind, string>> = {
    'treble': '𝄞', 'treble-8vb': '𝄞', 'bass': '𝄢', 'alto': '𝄡', 'tenor': '𝄡',
  };
  return (
    <svg width="120" height="64" viewBox="0 0 120 64" aria-hidden style={{ display: 'block' }}>
      {kind === 'grand' ? (
        <>
          {lines(5, 10, 5)}{lines(5, 40, 5)}
          <path d="M 5 10 C -1 18, -1 42, 5 60" fill="none" stroke="#555" strokeWidth="2" />
          <text x="14" y="27" fontSize="19" fill="#444">𝄞</text>
          <text x="14" y="53" fontSize="15" fill="#444">𝄢</text>
          <circle cx="70" cy="17.5" r="3" fill="#333" /><circle cx="90" cy="50" r="3" fill="#333" />
        </>
      ) : isTabKind(kind) ? (() => {
        const n = tabTuningFor(kind).length;         // 4·5·6줄
        const gap = n >= 6 ? 7 : 8;
        const y0 = Math.round((64 - (n - 1) * gap) / 2);
        const mid = y0 + Math.round(((n - 1) / 2) * gap);
        /* TAB 라벨 — writing-mode: vertical-rl 에서 y 는 글자 블록의 **위쪽**이다.
         * 예전엔 mid+10 에서 시작해 3글자(≈3×fontSize)가 아래로 흘러 오선은 물론
         * viewBox(64) 밖까지 8px 내려갔다. 실제 TAB 클레프처럼 오선 높이에 맞춰
         * 크기를 정하고, 그 블록을 오선 중앙에 맞춘다. */
        const staffH = (n - 1) * gap;
        const tabFs = Math.min(11, Math.max(7, Math.round(staffH / 3)));
        const tabTop = y0 + Math.round((staffH - tabFs * 3) / 2);
        return (
          <>
            {lines(n, y0, gap)}
            <text x="12" y={tabTop} fontSize={tabFs} fontWeight="700" fill="#555" style={{ writingMode: 'vertical-rl' as const }}>TAB</text>
            <text x="52" y={y0 + gap + 3} fontSize="9" fontWeight="700" fill="#333">3</text>
            <text x="72" y={y0 + gap * (n - 2) + 3} fontSize="9" fontWeight="700" fill="#333">5</text>
            <text x="92" y={mid + 3} fontSize="9" fontWeight="700" fill="#333">7</text>
          </>
        );
      })() : kind === 'drum' ? (
        <>
          {lines(5, 18, 6)}
          <rect x="14" y="24" width="3.4" height="12" fill="#444" />
          <rect x="19" y="24" width="3.4" height="12" fill="#444" />
          <path d="M 52 20 l 7 7 M 59 20 l -7 7" stroke="#333" strokeWidth="2" />
          <circle cx="78" cy="36" r="3.4" fill="#333" />
          <path d="M 98 32 l 7 7 M 105 32 l -7 7" stroke="#333" strokeWidth="2" />
        </>
      ) : (
        <>
          {lines(5, 16, 7)}
          <text
            x="12"
            y={kind === 'bass' ? 34 : kind === 'alto' || kind === 'tenor' ? 38 : 40}
            fontSize={kind === 'bass' ? 22 : kind === 'alto' || kind === 'tenor' ? 24 : 30}
            fill="#444"
          >{CLEF[kind] ?? '𝄞'}</text>
          {kind === 'treble-8vb' && (
            <text x="15" y="55" fontSize="9" fontWeight="700" fill="#444">8</text>
          )}
          <circle cx="62" cy={kind === 'bass' ? 30 : 37} r="3.6" fill="#333" />
          <circle cx="88" cy={kind === 'bass' ? 23 : 30} r="3.6" fill="#333" />
        </>
      )}
    </svg>
  );

};

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
  background: ${({ theme }) => theme.colors.surface};
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
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  font-family: 'Pretendard', sans-serif;

  .mlabel {
    font-size: 0.68rem;
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
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 5px;
    background: ${({ theme }) => theme.colors.surfaceSunken};
    color: ${({ theme }) => theme.colors.textPrimary};
    cursor: pointer;
    white-space: nowrap;
    &:hover { border-color: #b8860b; background: ${({ theme }) => theme.colors.surface}; }
    &.danger { color: ${({ theme }) => theme.colors.danger}; }
    &.danger:hover { border-color: ${({ theme }) => theme.colors.dangerBorder}; }
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

/** 같은 드롭다운 → Lead Sheet DB 의 스타일. 컴핑보다 분류가 넓다(#60).
 *  못 알아본 장르를 SWING 으로 뭉개지 않고 ETC 로 둔다 — 리드시트는 발라드·왈츠가
 *  실제로 많아서, 스윙으로 밀어넣으면 목록이 조용히 오염된다. */
function genreToLeadSheetStyle(g: string): LeadSheetStyle {
  const s = g.toLowerCase();
  if (s.includes('ballad')) return 'BALLAD';
  if (s.includes('blues') || s.includes('shuffle')) return 'BLUES';
  if (/(bossa|samba)/.test(s)) return 'BOSSA';
  if (/(latin|afro|cha-cha|mambo)/.test(s)) return 'LATIN';
  if (s.includes('waltz') || s.includes('jazz waltz')) return 'WALTZ';
  if (s.includes('modal')) return 'MODAL';
  if (s.includes('funk')) return 'FUNK';
  if (s.includes('swing')) return 'SWING';
  return 'ETC';
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
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

/** 보표가 불러온 악보 데이터로 확정돼 수동 변경이 잠긴 상태 표시. */
/* 정보 칩·드롭다운 표기 — 칩 title 과 세그먼트 버튼이 같은 문구를 쓴다. */
/** 악기 슬러그 → 한국어 이름. 목록에 없으면(직접 입력) 그 값을 그대로 쓴다. */
function instrumentName(v: string): string {
  if (!v) return '선택 안 함 (피아노)';
  const slug = SESSION_ICON_SLUG[v] ?? v;
  return INSTRUMENT_ICONS.find((i) => i.slug === slug)?.ko ?? v;
}

/* 자료 종류(solo · lick · comping · leadsheet)는 lib/note/editorModes 가 소유한다. */
const MODE_LABEL = EDITOR_MODE_LABEL;






/* 세그먼트 토글 — 선택지가 2~3개뿐이라 select 보다 한눈에 들어온다. */
/* 세그먼티드 컨트롤 — 비활성은 Genre·Key 와 같은 톤(흰 배경 + 회색 테두리),
 * 활성은 하늘색. 선택이 바뀌면 하늘색 알약이 스르륵 미끄러진다. */
const SEG_GAP = 6;

const SegGroup = styled.div<{ $n: number; $i: number; $vertical?: boolean }>`
  position: relative;
  display: grid;
  ${({ $n, $vertical }) => ($vertical
    ? `grid-template-rows: repeat(${$n}, 1fr);`
    : `grid-template-columns: repeat(${$n}, 1fr);`)}
  gap: ${SEG_GAP}px;
`;

const SegThumb = styled.span<{ $n: number; $i: number; $vertical?: boolean }>`
  position: absolute;
  left: 0;
  ${({ $n, $i, $vertical }) => ($vertical
    ? `top: 0; width: 100%;
       height: calc((100% - ${($n - 1) * SEG_GAP}px) / ${$n});
       transform: translateY(calc((100% + ${SEG_GAP}px) * ${$i}));`
    : `top: 0; bottom: 0;
       width: calc((100% - ${($n - 1) * SEG_GAP}px) / ${$n});
       transform: translateX(calc((100% + ${SEG_GAP}px) * ${$i}));`)}
  border-radius: 7px;
  border: 1.5px solid #a8d4f2;
  background: linear-gradient(180deg, #eaf5fe 0%, #d9ecfb 100%);
  box-shadow: 0 1px 3px rgba(22, 111, 176, 0.22);
  pointer-events: none;
  /* 살짝 튕기며 멈추는 최신 이징 — 위치와 크기 변화 모두 부드럽게. */
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), width 0.34s cubic-bezier(0.22, 1, 0.36, 1), height 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;

const SegBtn = styled.button<{ $on?: boolean }>`
  position: relative;
  z-index: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.84rem;
  font-weight: ${({ $on }) => ($on ? 700 : 600)};
  padding: 3px 12px;
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
  down: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="7" x2="12" y2="16"/></svg>,
  print:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="2"/><rect x="6" y="14" width="12" height="7"/></svg>,
};

const TOOL_TABS = [
  { id: 'note', label: '음표' },
  { id: 'artic', label: '아티큘레이션' },
  { id: 'dyn', label: '다이내믹스' },
  { id: 'lyric', label: '가사' },
  { id: 'measure', label: '마디' },
  { id: 'midi', label: 'MIDI' },
  { id: 'info', label: '정보' },
] as const;

/* 툴바 높이 — 음표 탭 기준으로 고정한다.
 *   음표/쉼표 버튼 54 + 간격 4 + 54 = 112
 *   + 섹션 padding 위8/아래5, border 2*2 = 129
 *   + 툴바 padding 10*2                  = 149
 * 어떤 탭을 열어도 이 높이가 유지돼야 아래 악보가 들썩이지 않는다. */
const TOOLBAR_H = 149;

/** 표현 칩 한 변(px)과 칩 사이 간격.
 *  세로 예산: 섹션 149 - 테두리 4 - 상태 띠 26 = 119 를 위·아래 같은 여백으로
 *  나눠 쓴다 → 2행(40×2 + gap 4 = 84) + 위아래 17.5px 씩. GoldGroup 의
 *  padding 이 이 계산을 그대로 쓴다(EDIT_PAD). */
const NOTE_CHIP = 40;
const CHIP_GAP = 4;
/** 상태 띠 높이 — GoldGroup 위 패딩이 이만큼 비워 둔다(띠는 absolute). */
const STATUS_BAR_H = 26;
/* 툴바 탭 본문의 좌우 여백 — 모든 탭이 같은 값을 써야 첫 섹션 왼쪽과 마지막
 * 섹션 오른쪽 여백이 같아 보인다. 예전엔 오른쪽만 18px 이라 오른쪽이 10px
 * 더 비어 보였고, 그만큼 마지막 섹션이 좁았다. */
const TOOLBAR_PAD_X = 8;

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

/* $accent — 선택(음표/마디)이 있어 탭이 살아났을 때의 글자색.
 * MODE_INK 와 같은 시그니처 톤: 음표 전제 탭은 연한 빨강, 마디 탭은 골드.
 * 액센트가 있는 탭은 골라서 열었을 때도 그 색을 유지한다(밑줄 포함) —
 * 파랑은 액센트 없는 탭(음표·MIDI·정보)의 선택색. */
const TabItem = styled.button<{ $on?: boolean; $accent?: string }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.06rem;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on, $accent, theme }) => ($accent ?? ($on ? '#2f6fe0' : theme.colors.textSecondary))};
  background: none;
  border: none;
  border-bottom: 2px solid ${({ $on, $accent }) => ($on ? $accent ?? '#2f6fe0' : 'transparent')};
  padding: 11px 2px 9px;   /* 글자·아이콘 크기는 그대로, 세로 높이만 낮춤 */
  cursor: pointer;
  white-space: nowrap;
  &:hover { color: ${({ $on, $accent }) => ($accent ?? ($on ? '#2f6fe0' : '#444'))}; }
  /* 음표 활성화가 전제인 탭(아티큘레이션·다이내믹스)은 선택이 없으면 잠근다. */
  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  &:disabled:hover { color: ${({ theme }) => theme.colors.textSecondary}; }
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
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.activeFill}; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const TabDivider = styled.span`
  width: 1px;
  height: 18px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 2px;
`;

/* 정보 탭 — 여러 줄로 나눠 담는 패널. */
/* MIDI 탭 본문 — 정보 탭과 완전히 같은 규격(높이 TOOLBAR_H, 같은 여백·간격).
 * 어느 탭을 눌러도 툴바 높이가 그대로여야 악보가 위아래로 튀지 않는다.
 * 안쪽 묶음 3개는 MidiSettingsBody 가 그린다. */
const MidiTabPanel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 8px;                 /* 툴바 섹션 간격과 동일 */
  padding: 10px ${TOOLBAR_PAD_X}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  background: ${({ theme }) => theme.colors.barBelow};

  /* 세 묶음이 폭을 고르게 나눠 갖되, 기기 목록이 길어도 밀리지 않게 한다. */
  & > * { flex: 1 1 0; min-width: 0; }
`;

/* 가사 탭 — 선택한 음표의 음절을 절(verse)별로 입력한다. */
const LyricTabPanel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px ${TOOLBAR_PAD_X}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  background: ${({ theme }) => theme.colors.barBelow};
  overflow-x: auto;
`;
const LyricInput = styled.input`
  width: 130px;
  padding: 7px 9px;
  font-size: 0.95rem;
  font-family: 'Times New Roman', Georgia, serif;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  &:focus { outline: none; border-color: #e08a8a; }
`;
const LyricHint = styled.div`
  font-size: 0.76rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.45;
  max-width: 300px;
`;

const InfoTabPanel = styled.div`
  display: flex;
  flex-direction: row;      /* 1) 메타데이터  2) 플레이어 — 가로로 나란히 */
  align-items: stretch;
  gap: 8px;                 /* 툴바 섹션 간격과 동일 */
  padding: 10px ${TOOLBAR_PAD_X}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  overflow: visible;   /* 조성 드롭다운이 툴바 밖으로 나올 수 있게 */
  background: ${({ theme }) => theme.colors.barBelow};
`;

/* 정보 탭 내부 섹션 — 툴바 섹션과 같은 라운드 네모로 구분한다. */
/* 라벨 + 입력 한 쌍 — 라벨을 작게 위에 얹는다. */
/* 라벨 + 입력을 가로로 나란히. 바 높이가 고정이라 입력을 작게 잡는다. */
const MetaField = styled.div<{ $tight?: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  /* $tight — 라벨 폭을 줄여 입력을 왼쪽으로 당긴다(Genre·Key 처럼 짧은 항목). */
  > span:first-child { min-width: ${({ $tight }) => ($tight ? '44px' : '76px')}; }
  input {
    width: 186px;
    font-size: 0.84rem;
    padding: 2px 9px;
  }
`;

/* 정보 탭 — 열(세로 스택) 묶음. */
/* 정보 탭의 Genre 트리거 — 폭 고정(상자에 꽉) + 가운데 정렬.
 * GenreSelect 내부는 건드리지 않고 감싸서 조절한다(코드차트 등 다른 사용처 무영향). */
const GenreFill = styled.div`
  min-width: 0;
  > div { display: block; width: 176px; }   /* GenreDropdown 래퍼 — 폭 고정 */
  button { width: 100%; justify-content: center; height: 28px; font-size: 0.9rem; }
`;





/* 3번 섹션 좌측 상단에 고정되는 상태칩(활성 상태 + 마디/박). */
/* 섹션 상단을 가로로 꽉 채우는 띠 — 배경은 구분선과 같은 색. 안에 상태 칩이 앉는다. */
const SectionStatusBar = styled.div<{ $mode: 'none' | 'measure' | 'note' }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 3px;
  /* 활성 상태가 띠에도 보이되, 테두리색보다 훨씬 옅게.
   * (예전엔 항상 회색이라 활성화해도 테두리만 바뀌고 띠는 그대로였다) */
  background: ${({ $mode }) => (
    $mode === 'note' ? '#fbe2e2'
    : $mode === 'measure' ? MEASURE_HL_FILL
    : '#f1f1f3'
  )};
  border-radius: 10px 10px 0 0;   /* 섹션 라운드(12px) - 테두리(2px) */
  pointer-events: none;
  transition: background 0.15s;
`;

const SectionStatus = styled.div<{ $mode: 'none' | 'measure' | 'note' }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: 7px;
  background: transparent;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  line-height: 1;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
  pointer-events: none;
`;

/* 음표 선택 해제 — 3번 섹션 우측 상단의 × 버튼. */
const DeselectBtn = styled.button`
  position: absolute;
  top: 0;
  right: 6px;
  z-index: 3;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: transparent;
  /* 옅은 색 띠(SectionStatusBar) 위에 놓이므로 검정이 가장 잘 읽힌다. */
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.activeFill}; }
`;

/* 상자 안 좌측 상단에 놓는 제목 — 테두리와 겹치지 않는다. */
/* fieldset legend 처럼 섹션 윗 테두리에 걸치는 라벨. 흐름에서 빼야 한 줄을
 * 차지하지 않고, 배경으로 테두리 선을 끊어 글자가 선 위에 얹혀 보인다.
 * (얹히는 InfoBox 는 overflow 를 잘라내면 안 된다 — 라벨이 통째로 잘린다.) */
const BoxLegend = styled.span`
  position: absolute;
  top: -8px;
  /* 모든 섹션 공통: 좌측 상단(모서리 라운드 12px 은 피한다). */
  left: 12px;
  z-index: 1;
  padding: 0 6px;
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
  line-height: 1;
`;



const InfoCols = styled.div`
  display: flex;
  gap: 26px;
  /* 좌(Title~Performer 4줄) · 우(Genre/Key/박자 3줄) 열을 서로 세로 가운데로 맞춘다. */
  align-items: center;
  padding: 6px 10px;
`;

const InfoCol = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;            /* 바 높이가 고정이라 행 간격을 좁게 */
`;

/* 마디 탭 — 마디 편집 도구를 한 줄로. (드롭다운과 같은 버튼 톤) */
const MeasureTabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px ${TOOLBAR_PAD_X}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: 'Pretendard', sans-serif;

  .mlabel {
    font-size: 0.76rem;
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
    background: ${({ theme }) => theme.colors.surface};
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
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.barBelow};
`;

const ToolBar = styled.div`
  display: flex;
  /* stretch: 섹션들의 높이가 가장 큰 섹션에 맞춰 나란히 정렬된다. */
  align-items: stretch;
  gap: 8px;
  /* 왼쪽은 첫 섹션이 화면 끝에 가깝게 붙도록 여백을 줄인다. */
  padding: 10px ${TOOLBAR_PAD_X}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  height: ${TOOLBAR_H}px;
  box-sizing: border-box;
  overflow: hidden;   /* 섹션이 아래 구분선을 넘지 않게 */
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
  min-height: 0;      /* 내용이 길어도 툴바 높이를 밀어내지 않게 */
  gap: 4px;
  padding: 5px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};          /* 섹션 배경은 흰색으로 통일 */
`;

/* 정보 탭 상자 — 공용 Section 규격 그대로. $grow 면 남는 폭을 채운다. */
const InfoBox = styled(Section)<{ $grow?: boolean }>`
  /* BoxLegend 를 윗 테두리에 걸치게 하는 기준. */
  position: relative;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  ${({ $grow }) => $grow && 'flex: 1;'}
`;

const DurGroup = styled(Section)`
  position: relative;   /* BoxLegend(윗 테두리 라벨) 기준 */
  /* 라벨과 버튼 사이 숨통(+3) + 하단 여백 유지(5) — 섹션이 3px 커져
   * TOOLBAR_H 도 함께 +3 됐다(149). */
  padding: 8px 5px 5px;
`;

/* 점·연음·임시표 묶음(두 번째 섹션). */
const ModGroup = styled(Section)`
  position: relative;   /* BoxLegend(윗 테두리 라벨) 기준 */
  padding: 8px 5px 5px;  /* DurGroup 과 동일 — 라벨 +3, 하단 5 유지 */
`;

/* 세 번째 섹션 — 메타데이터 + undo/redo. 중요 영역이라 골드 테두리. */
/* 3번 섹션 — 활성 상태의 시그니처 색을 테두리·배경에 함께 입힌다.
 *   note    → 연한 빨강 · measure → 골드 · none → 중립 회색 */
const MODE_INK = {
  note:    { line: '#e08a8a', fill: '#fff5f5' },   /* 편집 바와 같은 톤으로 통일 */
  measure: { line: '#D4A843', fill: 'rgba(184, 150, 10, 0.12)' },
  none:    { line: 'rgba(0, 0, 0, 0.13)', fill: '#fff' },
} as const;

const GoldGroup = styled(Section)<{ $mode: 'none' | 'measure' | 'note' }>`
  /* 상태 띠(absolute)가 가리는 위쪽만 패딩으로 비우고, 남은 세로 공간의
   * 가운데에 버튼 판을 둔다(justify-content: center) — 위아래 여백이 자동으로
   * 같아진다. 예전엔 위 38 / 아래 5 로 하드코딩돼 비대칭인데다, 2행 버튼이
   * 남은 높이를 넘겨 위아래가 잘렸다. */
  padding: ${STATUS_BAR_H}px 5px 0;
  overflow: hidden;       /* 툴바 높이를 넘어 아래로 삐져나가지 않는다 */
  align-items: stretch;
  height: 100%;
  min-height: 0;
  /* 남는 가로 공간을 모두 차지해 툴바 끝까지 늘어난다. */
  flex: 1;
  /* SectionStatus(좌측 상단 상태칩)를 absolute 로 띄우는 기준. 일반 흐름에 두면
   * 한 줄을 통째로 차지해 아래 편집 바를 밀어낸다. */
  position: relative;
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
  /* hover 도 활성과 같은 파랑 계열 — 활성일 때는 한 단계 진하게 해서 구분 유지. */
  &:hover { background: ${({ $active }) => ($active ? '#d3e9fb' : '#eef6fd')}; }
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
  /* 같은 섹션의 음표 버튼(DurBtn)과 같은 파랑 hover. */
  &:hover { background: ${tint('#eef6fd', 'rgba(107, 164, 255, 0.13)')}; }
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
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const SaveBtn = styled(Btn)<{ $saved?: boolean }>`
  background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  color: #fff;
  border-color: ${({ $saved }) => ($saved ? '#2a6e3f' : '#8B6914')};
  font-weight: 600;
  &:hover { background: ${({ $saved }) => ($saved ? '#2a6e3f' : '#6d5310')}; }
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
  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.activeFill}; }
  &:disabled { opacity: 0.4; cursor: default; }
`;

/* 저장 버튼 — 톱니·MIDI 와 같은 38px 아이콘 버튼 규격(ToolBtn) 위에
 * 상태만 얹는다. 아이콘만 남으므로 상태(저장 중/실패)는 색과 회전, 그리고
 * title/aria-label 로 전달한다.
 * (아래쪽 `spin` 은 이 시점에 아직 선언 전이라 여기 전용 키프레임을 둔다.) */
const saveSpin = keyframes`
  to { transform: rotate(360deg); }
`;

const SaveTabBtn = styled(TabIconBtn)<{ $error?: boolean; $busy?: boolean }>`
  /* 평소 색은 같은 줄의 다른 아이콘과 완전히 동일(TabIconBtn 기본 #5b5b5b).
   * 저장 실패만 빨강으로 남긴다 — 색을 빼면 실패 신호가 사라진다. */
  ${({ $error }) => $error && `
    color: #c62828;
    &:hover:not(:disabled) { background: rgba(198, 40, 40, 0.10); }
  `}
  /* 키프레임 보간은 반드시 css 헬퍼 안에서 한다 — 일반 문자열에 넣으면
   * styled-components 가 해석하지 못하고 렌더에서 예외를 던진다
   * ("interpolating a keyframe declaration into an untagged string").
   * 저장 버튼이 $busy 로 바뀌는 순간 터져 저장 자체가 막혔다.
   * (주의: styled 템플릿 안의 주석에 백틱을 쓰면 템플릿이 거기서 끊긴다.) */
  svg { ${({ $busy }) => $busy && css`animation: ${saveSpin} 0.9s linear infinite;`} }
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
  /* 버튼이 제목 옆(바 왼쪽)이라 오른쪽으로 펼친다 — right:0 이면 화면 밖으로 나간다. */
  left: 0;
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
  color: ${({ theme }) => theme.colors.textSecondary};
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
  height: 28px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  white-space: nowrap;
  background: ${({ theme }) => theme.colors.surface};
  border: 1.5px solid ${({ $open }) => ($open ? '#e8a838' : '#ccc')};
  border-radius: 6px;
  padding: 0 10px;
  font-family: ${KEY_FONT};
  font-size: 1.12rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: border-color 0.14s, background 0.14s;

  &:hover { background: ${tint('#fffdf7', 'rgba(224, 184, 88, 0.10)')}; }

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
/* 3번 섹션 좌측의 활성 상태 배지 — 음표/마디/없음. */
const ModeTag = styled.span<{ $mode: 'none' | 'measure' | 'note' }>`
  font-size: 0.6rem;
  font-weight: 800;
  padding: 2px 5px;
  border-radius: 4px;
  white-space: nowrap;
  color: ${({ $mode }) => ($mode === 'note' ? '#8a2b2b' : $mode === 'measure' ? '#8a7a2b' : '#777')};
  background: ${({ $mode }) => ($mode === 'note' ? 'rgba(200,60,60,0.13)' : $mode === 'measure' ? 'rgba(184,150,10,0.34)' : 'rgba(0,0,0,0.17)')};
`;

const StatusItem = styled.span<{ $warn?: boolean; $plain?: boolean }>`
  display: inline-flex;
  /* baseline 정렬은 크기가 다른 숫자(0.86rem)와 라벨(0.78rem)이 섞이면서
   * 칩 전체의 수직 중심을 흔든다 — 중앙 정렬로 통일. */
  align-items: center;
  gap: 2px;
  line-height: 1;
  /* 라벨(/8 bars 등)은 검정, 숫자는 '음표 활성화' 태그와 같은 진한 빨강. */
  color: ${({ $warn }) => ($warn ? '#c62828' : '#111')};
  b {
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
    color: ${({ $warn, $plain }) => ($warn ? '#c62828' : $plain ? '#111' : '#8a2b2b')};
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
/* 아래 4개는 헤더의 동작 버튼 아이콘 — 톱니와 같은 26px·strokeWidth 2 규격. */

/* 전체 지우기 — 쓰레기통. */
const TrashIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

/* JSON 복사 — 겹친 문서. */
const CopyIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/* 복사 완료 — 잠깐 체크로 바뀌어 눌린 것을 알린다. */
const CheckIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* JSON 불러오기 — 트레이로 들어오는 화살표(import). */
const ImportIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/* 저장 — 플로피 디스크(범용 저장 기호). 톱니와 같은 26px·strokeWidth 2 규격. */
const SaveIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

/* 저장 중 표시 — 아이콘 자리에 그대로 도는 링. 버튼 크기가 바뀌지 않게 26px 고정. */
const SaveSpinnerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
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
  background: ${({ $hasValue, $active, theme }) =>
    $active ? 'rgba(184, 150, 10, 0.13)' : $hasValue ? 'transparent' : theme.colors.hover};
  cursor: text;
  transition: background 0.12s;
  &:hover { background: ${({ $active, theme }) => ($active ? 'rgba(184, 150, 10, 0.22)' : theme.colors.activeFill)}; }
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
  color: ${({ theme }) => theme.colors.textPrimary};
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
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 0 0 1.5px ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
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

function ChordCell({ value, onChange, style, onContextMenu, active, cellId, registerFocus, onNavigate, measureIdx }: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
  /** 이 칸이 속한 마디 index — 하이라이트가 DOM 을 측정할 때 쓰는 표식. */
  measureIdx?: number;
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
      data-chord-measure={measureIdx}
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
  background: ${tint('#fff5f5', 'rgba(240, 113, 103, 0.13)')};
  flex-wrap: wrap;
`;

const NoteEditLabel = styled.span`
  font-size: 0.82rem;
  font-weight: 700;
  color: #d32f2f;
`;

/* ── 3-섹션 노트 편집 바 (핵심 편집 | 표현 | 부가) ── */
/* 음표를 고르지 않았을 때도 3번 섹션의 버튼 배치를 그대로 보여준다(디자인).
 * 값은 더미이고 조작은 막는다 — 클릭·포커스·마우스 반응 없음. */
const GHOST_SEL: NoteSel = { mi: 0, ni: 0, staff: 'treble' };
const GHOST_NOTE: NoteInfo = { keys: ['b/4'], duration: 'q' };

const GhostWrap = styled.div<{ $ghost?: boolean }>`
  display: flex;
  align-items: center;
  flex: none;          /* 내용 높이 그대로 — GoldGroup 이 세로 가운데로 놓는다 */
  min-height: 0;
  width: 100%;
  ${({ $ghost }) => $ghost && `
    opacity: 0.4;
    filter: grayscale(1);
    pointer-events: none;
    user-select: none;
  `}
`;

const SectionedEditBar = styled.div`
  display: flex;
  align-items: center;
  padding: 0;
  background: transparent;   /* 섹션 배경을 그대로 쓴다 */
  flex: 1;
  min-height: 0;
  /* 가로만 스크롤한다. 세로 스크롤을 켜 두면 버튼 판이 컨테이너보다 1px만
   * 커도 위아래가 동시에 잘린다(빨간 밑줄이 판 중간에 걸려 보이던 원인). */
  overflow-x: auto;
  overflow-y: visible;
  width: 100%;
`;

/* 표현 버튼 판 — 그룹을 가로로 늘어놓고 세로 가운데 정렬.
 * 1그룹(Tie·Gliss·Scoop·Fall·8va)만 2행 그리드이고, 나머지 그룹은 한 줄이라
 * 2행 높이 안에서 가운데 맞춰진다. 폭이 모자라면 가로 스크롤. */
const EditWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
`;

/* 1그룹 — 위→아래로 채우고 열 방향으로 흐르는 2행 그리드. */
const EditGrid = styled.div`
  display: grid;
  grid-template-rows: repeat(2, ${NOTE_CHIP}px);
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: ${CHIP_GAP}px;
`;

/* 2·3그룹 — 한 줄 가로 정렬. */
const EditRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${CHIP_GAP}px;
`;

/* 그룹 구분선 — 버튼 두 줄 높이를 관통한다. */
const EditSep = styled.div`
  width: 1px;
  height: ${NOTE_CHIP * 2 + CHIP_GAP}px;
  flex: none;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 7px;
`;
/* 표현(Tie·Gliss·Scoop…) 칩 — 아이콘(위) + 라벨(아래) 2단 구성에
 * 아이콘(위) + 라벨(아래) 2단. 활성 톤은 음표 섹션과 같은 빨강 계열이라
 * 파랑(음표 길이 팔레트)과 역할이 구분된다. */
const NoteChipBtn = styled.button<{ $active?: boolean }>`
  width: ${NOTE_CHIP}px;
  height: ${NOTE_CHIP}px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0;
  border: 1px solid ${({ $active }) => ($active ? '#d32f2f' : '#ddd')};
  border-radius: 6px;
  background: ${({ $active }) => ($active ? '#ffcdd2' : 'transparent')};
  color: ${({ $active }) => ($active ? '#d32f2f' : '#333')};
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  i {
    font-style: normal;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 15px;
    svg { display: block; }
  }
  em {
    font-style: normal;
    font-size: 0.58rem;
    font-weight: ${({ $active }) => ($active ? 700 : 500)};
    line-height: 1;
    white-space: nowrap;
  }
  &:hover:not(:disabled) { background: ${({ $active }) => ($active ? '#ffbdbd' : '#ffebee')}; }
  &:disabled { opacity: 0.4; cursor: default; }
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
  &:hover { background: ${tint('#ffebee', 'rgba(240, 113, 103, 0.16)')}; }
`;
/* 셈여림 글리프 버튼 — 음표(DurBtn) 규격 그대로 54×54, 서체만 악보 관례
 * (이탤릭 세리프 pp·mf·sfz …)로. */
/* 셈여림 — Bravura 의 정식 셈여림 글리프(p·m·f·s·r·z 조합). 이탤릭 세리프
 * 흉내가 아니라 실제 악보에 찍히는 그 모양이다. */
const DynBtn = styled(DurBtn)`
  font-family: 'Bravura', serif;
  font-style: normal;
  font-weight: normal;
  font-size: 1.5rem;
  line-height: 1;
  letter-spacing: -0.03em;
  /* Bravura 셈여림 글리프는 baseline 위쪽에 그려진다 — 버튼 정중앙으로 내린다
   * (측정값: 중심 ≈ 0.13em). */
  padding-top: 0.26em;
`;

/* 아티큘레이션·다이내믹스 탭 섹션 — 공용 Section + BoxLegend(윗 테두리 라벨).
 * 내부는 음표 탭의 세로 2단 컬럼(DurCol)과 같은 **2행 그리드** — 버튼이
 * 열 방향으로 차오르며 두 줄로 쌓인다. 54×2 + gap 4 + padding/border = 126
 * = TOOLBAR_H, 툴바 높이에 정확히 맞는다. */
const LabeledSection = styled(Section)`
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, 54px);
  align-items: center;
  gap: 4px;
  padding: 8px 5px 5px;  /* 라벨 +3, 하단 5 유지 — 섹션고 129 */
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
  background: ${({ theme }) => theme.colors.scrim};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

const ModalBox = styled.div`
  background: ${({ theme }) => theme.colors.surface};
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
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ModalTextarea = styled.textarea`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.75rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
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
  background: ${({ theme }) => theme.colors.surface};
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
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: #ef6c00;
  animation: ${spin} 0.8s linear infinite;
`;

const SavingText = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SavingSub = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

/* ─── component ────────────────────────────────────────────────────────── */

export default function EditorPage() {
  /* 코드 다이어그램 데이터 프리로드.
   *
   * VexFlow 렌더는 동기라서 `dbDiagramFor` 가 데이터를 기다릴 수 없다 — 없으면 그냥
   * 안 그린다. 그래서 미리 받아 두고, 도착하면 state 를 건드려 **다시 그린다**.
   * (동적 import 라 실패해도 다이어그램만 빠지고 악보는 정상이다.) */
  const [chordDbReady, setChordDbReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadChordDb('guitar')
      .then(() => { if (alive) setChordDbReady(true); })
      .catch(() => { /* 다이어그램만 안 뜬다 */ });
    return () => { alive = false; };
  }, []);

  /* 저장 후 이동을 앱/스튜디오로 가른다(lib/surface 참조). */
  const isStudio = useIsStudio();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  /* Mode selector — solo vs lick. Lives in URL so the choice is bookmarkable
   * and reflected on refresh. Default = 'solo'. Persisted to localStorage so
   * the toolbar dropdown defaults to whichever mode the user used last. */
  const initialMode: EditorMode = (() => {
    /* 스튜디오 전용 모드(comping·leadsheet)는 실서비스에서 칩으로도 안 보이고
     * URL(`?mode=leadsheet`)로도 들어올 수 없어야 한다 — 들어오면 저장 목적지가
     * 없는 상태로 편집하게 된다. localStorage 에 남은 값도 같은 이유로 걸러진다. */
    const allowed = (m: EditorMode) => isStudio || (m !== 'comping' && m !== 'leadsheet');
    const q = searchParams.get('mode');
    if (isEditorMode(q) && allowed(q)) return q;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('jazzify.editor.mode');
      if (isEditorMode(stored) && allowed(stored)) return stored;
    }
    return 'solo';
  })();
  const [mode, setMode] = useState<EditorMode>(initialMode);
  /* 타입 칩은 **화면마다 다르다** — Comping·Lead Sheet 는 저장 목적지(/comping,
   * /lead-sheets)가 스튜디오에만 있는 수집 DB다. 실서비스 사이드바에도 '악보 만들기'
   * 로 이 에디터가 있으니, 칩을 그대로 두면 사용자가 고를 수 있는데 저장 후 갈 곳이
   * 없다(라우트가 없어 홈으로 튕긴다). 스튜디오에서만 네 종류를 보여준다. */
  const visibleModes = useMemo<readonly EditorMode[]>(
    () => (isStudio ? EDITOR_MODES : EDITOR_MODES.filter((m) => m !== 'comping' && m !== 'leadsheet')),
    [isStudio],
  );
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
    /* 분류축인 연주자/앨범은 NoteSheetData 가 아니라 Solo 레코드에 있으므로
     * 별도 필드로 실려 온다. 이걸 Performer 칸에 넣어야 재저장이 같은 레코드를
     * 갱신한다(덮어쓰기 판정이 title+performer 기준). */
    prefillPerformer?: string;
    prefillAlbum?: string;
    compingId?: string;
    compingGenre?: CompingGenre;
    /* Lead Sheet DB '에디터로 열기' — 코드 진행(음표 없음)이 실려 온다.
     * prefillSheet(기보)와 **다른 필드**다. 하나로 합치면 음표가 없는 데이터가
     * 기보 경로(보표 판정·임시표 베이킹)를 타서 조용히 깨진다. */
    prefillChart?: LeadSheetData;
    leadSheetId?: string;
  } | null;
  const prefillSheet = navState?.prefillSheet;
  const prefillPerformer = navState?.prefillPerformer;
  const prefillAlbum = navState?.prefillAlbum;
  /* Comping 수정 저장 타깃 — CompingPage 에서 '에디터로 열기' 시 실려 온다.
   * (Comping 은 백엔드 없이 localStorage 저장이므로 id 로 로컬 항목을 갱신) */
  const [editingCompingId] = useState<string | null>(() => navState?.compingId ?? null);
  /* 컴핑 장르는 더 이상 별도 셀렉트로 고르지 않는다 — 아래 GenreSelect(genre)에서
   * 파생한다. navState 로 넘어온 값은 초기값(편집 진입)으로만 쓴다. */
  const [compingGenre, setCompingGenre] = useState<CompingGenre>(() => navState?.compingGenre ?? 'SWING');
  /* Lead Sheet 수정 저장 타깃 — 컴핑과 같은 이유로 state 에 한 번만 붙잡는다
   * (마운트 효과가 location.state 를 비우므로 매 렌더 파생하면 저장 때 null 이 된다). */
  const [editingLeadSheetId] = useState<string | null>(() => navState?.leadSheetId ?? null);
  const prefillChart = navState?.prefillChart;

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

  /* ── 다중 스태프(자유 조합) ──────────────────────────────────────────
   * partMetas[i] = i번째 스태프의 종류·악기·표기 옵션. 파트 **데이터**는
   * 이원화된다: 활성 파트는 기존 편집 버퍼(measures/bassMeasures/curNotes)에
   * 살아 있고(기존 편집 로직 전부 무수정 재사용), 비활성 파트는 partStoreRef 에
   * 잠들어 있다. 파트 전환 = 버퍼를 스토어에 커밋하고 대상 파트를 버퍼로 로드.
   * ⚠ partStoreRef[activePart] 는 전환 전까지 **낡은 값**이다 — 저장/재생은
   * 반드시 buildAllStaves() 를 거쳐 활성 버퍼를 합성해 읽는다. */
  const [partMetas, setPartMetas] = useState<Array<{ kind: StaffKind; instrument?: string; withNotation?: boolean; capo?: number; tuningPreset?: 'standard' | 'drop-d'; chordDiagrams?: boolean }>>([{ kind: 'treble' }]);
  const [activePart, setActivePart] = useState(0);
  const partStoreRef = useRef<Array<{ measures: MeasureInfo[]; bassMeasures: MeasureInfo[] }>>([{ measures: [], bassMeasures: [] }]);
  /* 화음 모드 — ON이면 피아노 입력이 새 음표 대신 마지막(또는 선택된) 음표에
   * 음을 쌓는다. */
  const [chordInput, setChordInput] = useState(false);
  /* 보이스 — 1(기본, 열린 마디 흐름) / 2(선택·마지막 확정 마디의 voice2 에 추가). */
  const [voiceMode, setVoiceMode] = useState<1 | 2>(1);
  /* 양손 모드에서 클릭으로 활성화된 베이스 마디 — 🎹 입력이 이 마디로 간다. */
  const [selectedBassMeasure, setSelectedBassMeasure] = useState<number | null>(null);
  const [curChord1, setCurChord1] = useState('');
  const [curChord2, setCurChord2] = useState('');
  /* 열려있는(미확정) 마디의 대체 코드 — 확정 마디는 MeasureInfo.altChords 사용. */
  const [curAltChords, setCurAltChords] = useState<string[] | undefined>(undefined);
  /* 코드 칸 우클릭 드롭다운 (viewport 좌표 + 대상 마디 인덱스) */
  const [chordMenu, setChordMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  /* 스태프 종류 선택 모달 — add(새 스태프) / change(기존 스태프 종류 교체). */
  const [staffModal, setStaffModal] = useState<{ mode: 'add' } | { mode: 'change'; idx: number } | null>(null);
  /* TAB 설정 팝오버(카포·튜닝·코드표) — 열려 있는 파트 인덱스. */
  const [tabCfgIdx, setTabCfgIdx] = useState<number | null>(null);

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
  /* 리드시트 스타일도 같은 드롭다운에서 파생 — 분류 셀렉트를 모드마다 늘리지 않는다. */
  const leadSheetStyle = useMemo<LeadSheetStyle>(() => genreToLeadSheetStyle(genre), [genre]);
  const [sheetTitle, setSheetTitle] = useState('');
  const [sheetKey, setSheetKey] = useState('C');
  /* ── 박자표 — 전역(악보 단위). 마디 자동 마감·분할·Voice 박 수·표기가 전부
   * 여기서 파생된다. barBeats 는 **4분음표 단위**(6/8=3.0) — 음가 산술
   * (noteMetricBeats/measureBeats)이 4분음표 기준이라 그대로 합산 가능. */
  const [timeSig, setTimeSig] = useState('4/4');
  const [tsNum, tsDen] = useMemo(() => {
    const m = /^([0-9]+)\/([0-9]+)$/.exec(timeSig);
    return m ? [Number(m[1]), Number(m[2])] : [4, 4];
  }, [timeSig]);
  const barBeats = useMemo(() => tsNum * (4 / tsDen), [tsNum, tsDen]);
  /* 표시용 — 분모 단위 박 수(6/8이면 8분음표 6개). */
  const beatsInDenUnits = useCallback((quarterBeats: number) => {
    const v = quarterBeats * (tsDen / 4);
    return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  }, [tsDen]);
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
  /* 코드 붙여넣기 모달 — 아는 곡의 코드 진행을 코드칸에 얹는다(F7.33). */
  const [chordPasteOpen, setChordPasteOpen] = useState(false);
  /* '조표 무시' 를 켜고 끌 때 **소리가 바뀌지 않도록 임시표를 변환**한다.
   *   켤 때  — 조표가 주던 ♯/♭ 을 각 음표에 명시로 펼친다(조표가 사라져도 같은 소리).
   *   끌 때  — 다시 조표 기준 최소 표기로 되돌린다.
   * 이게 없으면 토글만으로 조표의 ♯/♭ 이 통째로 증발해 음이 틀어진다.
   * 시트 로드가 값을 바꾼 경우는 변환하지 않는다(그건 이미 그 표기법의 데이터다). */
  const prevExplicitRef = useRef(explicitAcc);
  const skipAccConvertRef = useRef(true);   // 첫 렌더 + 로드 직후는 건너뛴다
  useEffect(() => {
    const prev = prevExplicitRef.current;
    prevExplicitRef.current = explicitAcc;
    if (skipAccConvertRef.current) { skipAccConvertRef.current = false; return; }
    if (prev === explicitAcc) return;
    const convert = (ms: MeasureInfo[]) => (explicitAcc
      ? bakeExplicitAccidentals(ms, sheetKey)   // 조표 → 음표에 펼치기
      : emitForKeySignature(ms, sheetKey));     // 음표 → 조표 기준 최소 표기
    setMeasures((prevMs) => convert(prevMs));
    setBassMeasures((prevMs) => (prevMs.length ? convert(prevMs) : prevMs));
    setCurNotes((prevNs) => (prevNs.length ? convert([{ notes: prevNs }])[0].notes : prevNs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitAcc]);

  const [duration, setDuration] = useState('8');
  const [dotted, setDotted] = useState(false);
  /* 겹점 — 단일점과 배타(하나를 켜면 다른 하나는 꺼진다). */
  const [doubleDotted, setDoubleDotted] = useState(false);
  const [accMode, setAccMode] = useState<'b' | '#' | 'n' | '##' | 'bb'>('b');
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
  const [ottavaMode, setOttavaMode] = useState<'8va' | '8vb' | '15ma' | '15mb' | null>(null);
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
    .filter((p) => !p.staff && !p.part)
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
  /* 음이름 표시 — 전역 설정 + '에디터' 페이지 덮어쓰기. */
  const noteNameStyle = useNoteNameStyle();

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
  /* 음표 부가 도구(+) 드롭다운 — 꾸밈·아티큘레이션·구조 등 '더 붙이는' 것들. */
  /* 상단 탭 — 지금은 '음표' 탭만 내용이 있고, 나머지는 자리만 잡아 둔다. */
  const [toolTab, setToolTab] = useState<'note' | 'artic' | 'dyn' | 'lyric' | 'measure' | 'midi' | 'info'>('note');

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

    /* ── prefillChart (Lead Sheet DB '에디터로 열기') ─────────────────────
     * 코드 진행만 있는 데이터다. 음표 없는 빈 마디에 코드를 얹어 띄운다 —
     * 임시표 베이킹·보표 판정 같은 기보 전처리를 타면 안 되므로 별도 경로다. */
    if (prefillChart) {
      try {
        setMode('leadsheet');
        const { measures: ms, droppedMidBarChords } = leadSheetToMeasures(prefillChart);
        setMeasures(ms);
        if (prefillChart.title) setSheetTitle(prefillChart.title);
        if (prefillChart.composer) setComposer(prefillChart.composer);
        /* 스타일은 Genre 드롭다운에 싣는다 — 저장 때 거기서 다시 파생하므로
         * (genreToLeadSheetStyle) 왕복에서 분류가 유지된다. */
        if (prefillChart.style) setGenre(prefillChart.style);
        if (prefillChart.key) setSheetKey(prefillChart.key);
        if (/^[0-9]+\/[0-9]+$/.test(prefillChart.timeSignature ?? '')) setTimeSig(prefillChart.timeSignature);
        if (droppedMidBarChords > 0) {
          /* 한 마디에 코드가 둘 이상이면 에디터엔 첫 것만 남는다(마디 중간 코드는
           * 음표에 붙는데 리드시트엔 음표가 없다). 조용히 잃으면 저장 때 진행이
           * 바뀌므로 반드시 알린다. */
          setSaveError(`마디 중간 코드 ${droppedMidBarChords}개는 에디터에 옮기지 못했습니다 — 저장하면 사라집니다.`);
        }
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
        navigate(location.pathname + location.search, { replace: true, state: null });
      } catch (e) {
        console.warn('Failed to apply prefillChart', e);
      }
      return;
    }

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
        /* staves(다중 스태프)가 있으면 그것이 진실 — 파트 메타/스토어를 채우고
         * 첫 파트를 편집 버퍼로 로드한다. 없으면 기존 단일/양손 해석. */
        const loadedStaves = sheetToStaves(prefillSheet);
        if (loadedStaves.length > 1 || (loadedStaves[0] && loadedStaves[0].kind !== 'treble' && loadedStaves[0].kind !== 'grand')) {
          const bakePart = (st: SheetStaff, arr: MeasureInfo[]) => (st.kind === 'drum' ? arr : bake(arr));
          setPartMetas(loadedStaves.map((st) => ({
            kind: st.kind,
            ...(st.instrument ? { instrument: st.instrument } : {}),
            ...(st.withNotation ? { withNotation: true } : {}),
            ...(st.capo ? { capo: st.capo } : {}),
            ...(st.tuningPreset && st.tuningPreset !== 'standard' ? { tuningPreset: st.tuningPreset } : {}),
            ...(st.chordDiagrams ? { chordDiagrams: true } : {}),
          })));
          /* 4박 초과 마디 쪼개기는 손으로 만든 데이터의 안전망이다. 단 **양손
           * (grand)은 쪼개면 안 된다** — 오른손만 마디가 늘어나 왼손과 1:1
           * 인덱스 정렬이 깨지고, 그 지점부터 코드·왼손이 통째로 밀린다
           * (실측: MusicXML 피아노 수입에서 오른손 79 vs 왼손 72). 수입 악보의
           * 마디 구분은 원본이 진실이므로 그대로 싣는다. */
          partStoreRef.current = loadedStaves.map((st) => ({
            measures: st.kind === 'grand'
              ? bakePart(st, st.measures)
              : splitMeasuresByBeats(bakePart(st, st.measures), barBeatsOf(prefillSheet.timeSignature)),
            bassMeasures: st.bassMeasures ? bakePart(st, st.bassMeasures) : [],
          }));
          const first = partStoreRef.current[0];
          setMeasures(first.measures);
          setBassMeasures(first.bassMeasures);
          setActivePart(0);
          if (loadedStaves[0].kind === 'grand') setStaffMode('grand');
          setMetaInstrument(loadedStaves[0].instrument ?? '');
        } else {
          /* 양손이면 쪼개지 않는다 — 위와 같은 이유(오른손/왼손 인덱스 정렬). */
          const isGrand = Array.isArray(prefillSheet.bassMeasures) && prefillSheet.bassMeasures.length > 0;
          const baked = bake(prefillSheet.measures);
          setMeasures(isGrand ? baked : splitMeasuresByBeats(baked, barBeatsOf(prefillSheet.timeSignature)));
          if (isGrand) {
            setBassMeasures(bake(prefillSheet.bassMeasures!));
            setStaffMode('grand');
            setPartMetas([{ kind: 'grand' }]);
          }
        }
        setCurNotes([]);
        setCurChord1('');
        setCurChord2('');
        if (prefillSheet.title) setSheetTitle(prefillSheet.title);
        if (prefillSheet.composer) setComposer(prefillSheet.composer);
        if (prefillPerformer) setPerformer(prefillPerformer);
        if (prefillAlbum) setAlbum(prefillAlbum);
        if (prefillSheet.key) setSheetKey(prefillSheet.key);
        if (/^[0-9]+\/[0-9]+$/.test(prefillSheet.timeSignature ?? '')) setTimeSig(prefillSheet.timeSignature);
        // ⚠️ 반드시 시트의 표기법을 그대로 따른다. 이 값이 데이터의 실제 표기와
        // 어긋나면, 아래 토글 변환이 잘못된 해석으로 임시표를 구워 **음이 바뀐다**
        // (조표가 주던 C♯ 을 "C내추럴" 로 오해해 ♮ 를 박는 사고가 있었다).
        skipAccConvertRef.current = true;
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
          setMeasures(splitMeasuresByBeats(sheetMeasures, barBeatsOf((sd as { timeSignature?: string } | null)?.timeSignature)));
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
      // 드래프트는 에디터 상태를 그대로 저장하므로 키가 `timeSig` 다.
      if (Array.isArray(d.measures)) setMeasures(splitMeasuresByBeats(d.measures, barBeatsOf(d.timeSig ?? d.timeSignature)));
      if (Array.isArray(d.bassMeasures) && d.bassMeasures.length > 0) setBassMeasures(d.bassMeasures);
      if (d.staffMode === 'grand') setStaffMode('grand');
      // 다중 스태프 드래프트 — 메타/스토어/활성 인덱스까지 복원.
      if (Array.isArray(d.partMetas) && d.partMetas.length > 0) {
        setPartMetas(d.partMetas);
        if (Array.isArray(d.partStore) && d.partStore.length === d.partMetas.length) {
          partStoreRef.current = d.partStore;
        } else {
          partStoreRef.current = d.partMetas.map(() => ({ measures: [], bassMeasures: [] }));
        }
        if (typeof d.activePart === 'number' && d.activePart >= 0 && d.activePart < d.partMetas.length) {
          setActivePart(d.activePart);
          const mk = d.partMetas[d.activePart]?.kind;
          if (mk === 'grand') setStaffMode('grand');
          setMetaInstrument(d.partMetas[d.activePart]?.instrument ?? '');
        }
      }
      if (Array.isArray(d.curNotes)) setCurNotes(d.curNotes);
      if (typeof d.curChord1 === 'string') setCurChord1(d.curChord1);
      if (typeof d.curChord2 === 'string') setCurChord2(d.curChord2);
      if (typeof d.composer === 'string') setComposer(d.composer);
      if (typeof d.performer === 'string') setPerformer(d.performer);
      if (typeof d.album === 'string') setAlbum(d.album);
      if (typeof d.genre === 'string') setGenre(d.genre);
      if (typeof d.sheetTitle === 'string') setSheetTitle(d.sheetTitle);
      if (typeof d.sheetKey === 'string') setSheetKey(d.sheetKey);
      if (typeof d.timeSig === 'string' && /^[0-9]+\/[0-9]+$/.test(d.timeSig)) setTimeSig(d.timeSig);
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
  const draftRef = useRef({ measures, bassMeasures, staffMode, curNotes, curChord1, curChord2, composer, performer, album, genre, sheetTitle, sheetKey, timeSig, bpm, partMetas, activePart, partStore: partStoreRef.current });
  draftRef.current = { measures, bassMeasures, staffMode, curNotes, curChord1, curChord2, composer, performer, album, genre, sheetTitle, sheetKey, timeSig, bpm, partMetas, activePart, partStore: partStoreRef.current };
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

  /* 조성(이조·키만 변경)처럼 **스냅샷에 담기지 않는 상태**를 바꾸는 작업은
   * 되돌리기 이력을 통째로 비운다. 스냅샷은 measures/curNotes 만 담고 sheetKey 는
   * 담지 않으므로, 이력을 남겨두면 Ctrl+Z 가 "이전 조성의 음표 + 새 조표" 라는
   * 어긋난 상태를 만든다(B→D 이조 후 Ctrl+Z 하면 음표만 B 로 돌아가고 조표는 D). */
  const resetEditHistory = useCallback(() => {
    editUndoStack.current = [];
    editRedoStack.current = [];
  }, []);

  /* 코드 붙여넣기 적용 — 고른 코드 진행을 현재 파트의 코드칸에 순환으로 채운다.
   *
   * 코드칸은 **첫 스태프**의 것이므로(F7.19 규약) 버튼도 activePart===0 에서만 열린다.
   * `applyChordPaste` 는 순수 함수라 여기서는 undo 스냅샷만 남기고 결과를 갈아끼운다.
   * 임시표 재표기(respell)는 소리를 보존하므로 조표무시 여부와 무관하게 안전하지만,
   * 어느 의미론으로 읽어야 하는지는 알려줘야 한다(explicitAcc). */
  const handleChordPaste = useCallback((r: ChordPasteResult) => {
    pushEditUndo();
    setMeasures((prev) => applyChordPaste(
      prev,
      r.cells,
      sheetKey,
      explicitAcc ? 'explicit' : 'score',
      {
        startCell: r.startCell,
        respell: r.respell,
        overwrite: r.overwrite,
        barBeats: barBeatsRef.current,
      },
    ));
    setChordPasteOpen(false);
  }, [pushEditUndo, sheetKey, explicitAcc]);

  const curBeats = useMemo(() => measureBeats(curNotes), [curNotes]);
  /* 선택이 없을 때 보여줄 전체 박 수 — 확정 마디 + 입력 중인 마디. */
  const totalBeats = useMemo(
    () => measures.reduce((s2, m) => s2 + measureBeats(m.notes), 0) + curBeats,
    [measures, curBeats],
  );

  /* 실제 이조 — 음표를 target 키로 옮기고 조표도 함께 바꾼다(되돌리기 가능).
   * transposeNoteSheet 이 NoteSheetData 단위로 동작하므로, 편집 중인 마디
   * (measures/curNotes/bassMeasures)를 한 장의 시트로 싸서 통째로 옮긴 뒤
   * 다시 풀어 넣는다 — 그래야 트레블·베이스가 같은 간격으로 이동한다. */
  const applyTranspose = useCallback((targetKey: string) => {
    const target = normalizeNoteKeyDisplay(targetKey);
    if (!target || target === sheetKey) { setTransposeOpen(false); return; }
    resetEditHistory();   // 조성 변경은 Ctrl+Z 대상이 아니다(어긋난 상태 방지)
    const packed: NoteSheetData = {
      title: sheetTitle, composer, key: sheetKey, timeSignature: timeSig,
      // 편집 중인 마지막 마디(curNotes)도 함께 옮겨야 이조 후 이어서 쓸 수 있다.
      measures: [...measures, { notes: curNotes }],
      ...(bassMeasures.length ? { bassMeasures } : {}),
      ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
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
  }, [sheetKey, sheetTitle, composer, measures, curNotes, bassMeasures, resetEditHistory, explicitAcc]);

  /* '키만 변경' — 음표는 그대로 두고 조성 표기(조표)만 교체한다. (SolosPage 와 동일 개념) */
  /* 키만 변경 — 조표 표기만 바꾸고 **소리는 그대로 둔다**.
   * setSheetKey 만 하면 임시표 없는 음표가 새 조표를 따라가 음높이가 바뀐다
   * (C장조의 B → E♭장조에선 B♭). respellNoteSheetKey 가 원래 피치를 확정한 뒤
   * 새 조표에서 그 피치를 유지할 임시표(♮ 등)를 다시 붙인다. */
  const applyKeyOnly = useCallback((targetKey: string) => {
    const target = normalizeNoteKeyDisplay(targetKey);
    if (!target || target === sheetKey) { setTransposeOpen(false); return; }
    resetEditHistory();   // 조성 변경은 Ctrl+Z 대상이 아니다(어긋난 상태 방지)
    const packed: NoteSheetData = {
      title: sheetTitle, composer, key: sheetKey, timeSignature: timeSig,
      measures: [...measures, { notes: curNotes }],
      ...(bassMeasures.length ? { bassMeasures } : {}),
      ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
    };
    const out = respellNoteSheetKey(packed, target);
    const outMeasures = out.measures ?? [];
    const tail = outMeasures[outMeasures.length - 1];
    setMeasures(outMeasures.slice(0, -1));
    setCurNotes(tail?.notes ?? []);
    if (out.bassMeasures) setBassMeasures(out.bassMeasures);
    setSheetKey(out.key || target);
    setTransposeOpen(false);
  }, [sheetKey, sheetTitle, composer, measures, curNotes, bassMeasures, resetEditHistory, explicitAcc]);

  /* maybeAutoClose 등 deps-고정 콜백이 읽는 barBeats 미러. */
  const barBeatsRef = useRef(4);
  barBeatsRef.current = barBeats;

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
    : selectedBassMeasure != null
      ? (selectedBassMeasure < allMeasures.length ? selectedBassMeasure : -1)
      : (selectedMeasure != null && selectedMeasure < allMeasures.length ? selectedMeasure : -1);

  /* 어느 보표가 선택됐는지 — 양손 악보에서 위/아래 마디를 구분해 칠하기 위해
   * 렌더러로 함께 넘긴다. 음표를 골랐으면 그 음표가 있는 보표를 따른다. */
  const activeStaff: StaffId = selectedNote
    ? (selectedNote.staff === 'bass' ? 'bass' : 'treble')
    : (selectedBassMeasure != null ? 'bass' : 'treble');

  /* 렌더/저장/재생용 베이스 파트 — 트레블(allMeasures) 길이에 맞춰 패딩. */
  const bassAll = useMemo<MeasureInfo[] | null>(() => {
    if (staffMode !== 'grand') return null;
    return allMeasures.map((_, i) => bassMeasures[i] ?? { notes: [] });
  }, [staffMode, allMeasures, bassMeasures]);

  /* ── 다중 스태프: 파트 전환·추가·삭제·이동 ───────────────────────────
   * 활성 파트만 편집 버퍼에 산다. 전환은 "커밋 → 로드" — 열린 마디는 확정되고,
   * 언두 스택은 파트 간 데이터가 섞이지 않게 비운다. */
  const commitActiveIntoStore = useCallback(() => {
    const committed: MeasureInfo[] = [...measures];
    if (curNotes.length > 0 || curChord || curAltChords) {
      const cur: MeasureInfo = { notes: curNotes, chord: curChord || undefined };
      if (curAltChords) cur.altChords = curAltChords;
      committed.push(cur);
    }
    partStoreRef.current[activePart] = { measures: committed, bassMeasures };
  }, [measures, curNotes, curChord, curAltChords, bassMeasures, activePart]);

  const loadPartBuffers = useCallback((data: { measures: MeasureInfo[]; bassMeasures: MeasureInfo[] }, kind: StaffKind) => {
    setMeasures(data.measures);
    setBassMeasures(data.bassMeasures);
    setCurNotes([]); setCurChord1(''); setCurChord2(''); setCurAltChords(undefined);
    setSelectedNote(null); setExtraSel([]); setSelectedMeasure(null); setSelectedBassMeasure(null); setInsertPos(null);
    editUndoStack.current = []; editRedoStack.current = [];
    setStaffMode(kind === 'grand' ? 'grand' : 'single');
  }, []);

  const switchPart = useCallback((idx: number) => {
    if (idx === activePart || idx < 0 || idx >= partMetas.length) return;
    commitActiveIntoStore();
    const target = partStoreRef.current[idx] ?? { measures: [], bassMeasures: [] };
    loadPartBuffers(target, partMetas[idx].kind);
    setMetaInstrument(partMetas[idx].instrument ?? '');
    setActivePart(idx);
  }, [activePart, partMetas, commitActiveIntoStore, loadPartBuffers]);

  const addPart = useCallback((kind: StaffKind) => {
    const meta = STAFF_KIND_META[kind];
    commitActiveIntoStore();
    partStoreRef.current.push({ measures: [], bassMeasures: [] });
    const inst = !meta.instrumentLocked && meta.defaultInstrument ? meta.defaultInstrument : undefined;
    setPartMetas((prev) => [...prev, { kind, ...(inst ? { instrument: inst } : {}) }]);
    loadPartBuffers({ measures: [], bassMeasures: [] }, kind);
    setMetaInstrument(inst ?? '');
    setActivePart(partMetas.length);
  }, [partMetas.length, commitActiveIntoStore, loadPartBuffers]);

  const removePart = useCallback((idx: number) => {
    if (partMetas.length <= 1 || idx < 0 || idx >= partMetas.length) return;
    commitActiveIntoStore();
    partStoreRef.current.splice(idx, 1);
    const nextMetas = partMetas.filter((_, i) => i !== idx);
    setPartMetas(nextMetas);
    const nextActive = idx === activePart ? Math.max(0, idx - 1) : idx < activePart ? activePart - 1 : activePart;
    loadPartBuffers(partStoreRef.current[nextActive] ?? { measures: [], bassMeasures: [] }, nextMetas[nextActive].kind);
    setMetaInstrument(nextMetas[nextActive].instrument ?? '');
    setActivePart(nextActive);
  }, [partMetas, activePart, commitActiveIntoStore, loadPartBuffers]);

  const movePart = useCallback((idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (idx < 0 || idx >= partMetas.length || to < 0 || to >= partMetas.length) return;
    commitActiveIntoStore();
    const st = partStoreRef.current;
    [st[idx], st[to]] = [st[to], st[idx]];
    setPartMetas((prev) => {
      const nx = [...prev];
      [nx[idx], nx[to]] = [nx[to], nx[idx]];
      return nx;
    });
    // 활성 파트가 이동에 관여했으면 인덱스를 따라간다(버퍼 재로드 불필요 —
    // 방금 커밋한 스토어와 버퍼 내용이 같다).
    setActivePart((cur) => (cur === idx ? to : cur === to ? idx : cur));
  }, [partMetas.length, commitActiveIntoStore]);

  /* 스태프 종류 교체 — 데이터는 유지된다(음정 keys 는 어느 표기로든 해석 가능).
   * 단 드럼↔피치 파트는 keys 해석이 달라(GM vs 음정) 음표가 있으면 확인을 받는다. */
  const changePartKind = useCallback((idx: number, kind: StaffKind) => {
    if (idx < 0 || idx >= partMetas.length || partMetas[idx].kind === kind) return;
    const wasDrum = partMetas[idx].kind === 'drum';
    const toDrum = kind === 'drum';
    const store = partStoreRef.current[idx];
    const n = idx === activePart
      ? measures.reduce((a, mm) => a + mm.notes.length, 0) + curNotes.length + bassMeasures.reduce((a, mm) => a + mm.notes.length, 0)
      : (store?.measures.reduce((a, mm) => a + mm.notes.length, 0) ?? 0) + (store?.bassMeasures.reduce((a, mm) => a + mm.notes.length, 0) ?? 0);
    if (n > 0 && wasDrum !== toDrum
      && !window.confirm('드럼 보표와 일반 보표는 음표 해석이 다릅니다. 기존 음표의 소리·표기가 달라질 수 있는데 계속할까요?')) return;
    const meta = STAFF_KIND_META[kind];
    const inst = !meta.instrumentLocked && meta.defaultInstrument ? meta.defaultInstrument : undefined;
    setPartMetas((prev) => prev.map((pm, i) => (i === idx
      ? { kind, ...(inst ? { instrument: inst } : {}), ...(isTabKind(kind) && pm.withNotation ? { withNotation: true } : {}) }
      : pm)));
    if (idx === activePart) {
      setStaffMode(kind === 'grand' ? 'grand' : 'single');
      if (kind !== 'grand') { setSelectedBassMeasure(null); setSelectedNote((sel) => (sel?.staff === 'bass' ? null : sel)); }
      setMetaInstrument(inst ?? '');
    }
  }, [partMetas, activePart, measures, curNotes, bassMeasures]);

  /* 렌더러에 넘길 파트 명세 — 활성 파트는 라이브 버퍼, 나머지는 스토어.
   * 모든 파트를 같은 마디 수로 패딩(렌더러가 part0 길이 기준으로 돈다). */
  const renderParts = useMemo<RenderPart[]>(() => {
    const raw = partMetas.map((meta, i) => {
      const data = i === activePart
        ? { measures: allMeasures, bassMeasures: meta.kind === 'grand' ? (bassAll ?? bassMeasures) : [] }
        : (partStoreRef.current[i] ?? { measures: [], bassMeasures: [] });
      return { meta, data };
    });
    const maxLen = Math.max(1, ...raw.map((r) => r.data.measures.length));
    const pad = (ms: MeasureInfo[]): MeasureInfo[] => {
      if (ms.length >= maxLen) return ms;
      return [...ms, ...Array.from({ length: maxLen - ms.length }, () => ({ notes: [] as NoteInfo[] }))];
    };
    return raw.map(({ meta, data }) => ({
      kind: meta.kind,
      measures: pad(data.measures),
      ...(meta.kind === 'grand' ? { bassMeasures: pad(data.bassMeasures) } : {}),
      ...(meta.withNotation ? { withNotation: true } : {}),
      ...(meta.capo ? { capo: meta.capo } : {}),
      ...(meta.tuningPreset && meta.tuningPreset !== 'standard' ? { tuningPreset: meta.tuningPreset } : {}),
      ...(meta.chordDiagrams ? { chordDiagrams: true } : {}),
    }));
  }, [partMetas, activePart, allMeasures, bassAll, bassMeasures]);

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
    if (notes.length > 0 && beats >= barBeatsRef.current - 0.001) {
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
  const handleOttavaToggle = useCallback((kind: '8va' | '8vb' | '15ma' | '15mb') => {
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

  const updateNote = useCallback((mi: number, ni: number, updater: (n: NoteInfo) => NoteInfo, staff?: StaffId, v2?: boolean) => {
    pushEditUndo();
    /* v2 미지정 호출(음표 탭 칩 등)이 선택된 보이스2 음표를 겨냥하면 자동 라우팅 —
     * 40여 개 칩 호출부가 성부를 몰라도 된다. */
    if (v2 === undefined && selectedNote?.v2 && selectedNote.mi === mi && selectedNote.ni === ni && selectedNote.staff === staff) {
      v2 = true;
    }
    if (v2) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, voice2: (m.voice2 ?? []).map((n, j) => j === ni ? updater(n) : n) } : m));
    } else if (staff === 'bass') {
      setBassMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? updater(n) : n) } : m));
    } else if (mi < measures.length) {
      setMeasures((prev) => prev.map((m, i) => i === mi ? { ...m, notes: m.notes.map((n, j) => j === ni ? updater(n) : n) } : m));
    } else {
      setCurNotes((prev) => prev.map((n, j) => j === ni ? updater(n) : n));
    }
  }, [measures.length, pushEditUndo, selectedNote]);

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
  const deleteNote = useCallback((mi: number, ni: number, staff?: StaffId, v2?: boolean) => {
    pushEditUndo();
    if (v2 === undefined && selectedNote?.v2 && selectedNote.mi === mi && selectedNote.ni === ni && selectedNote.staff === staff) {
      v2 = true;
    }
    if (v2) {
      setMeasures((prev) => prev.map((m, i) => {
        if (i !== mi) return m;
        const next = (m.voice2 ?? []).filter((_, j) => j !== ni);
        return { ...m, voice2: next.length ? next : undefined };
      }));
      return;
    }
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
  }, [measures.length, pushEditUndo, selectedNote]);

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

  // 포인터 위치의 음표 히트테스트 — **노트헤드를 정확히 눌렀을 때만** 잡힌다
  // (noteHeadHit 사양). 기둥·빔·여백은 null → 클릭이 마디 선택으로 흐른다.
  const noteAtPoint = useCallback((clientX: number, clientY: number): NotePos | null => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const cx = (clientX - rect.left) / SHEET_SCALE;
    const cy = (clientY - rect.top) / SHEET_SCALE;
    let best: NotePos | null = null;
    let bestDist = Infinity;
    for (const np of notePositionsRef.current) {
      const d = noteHeadHit(np, cx, cy);
      if (d !== null && d < bestDist) { bestDist = d; best = np; }
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
    const srcM = (staff === 'bass' ? bassMeasures : allMeasures)[np.mi];
    const note = np.v2 ? srcM?.voice2?.[np.ni] : srcM?.notes[np.ni];
    if (!note || note.duration.endsWith('r')) return; // 쉼표는 음정 없음
    setInsertPos(null); // 음표 클릭 = 삽입 모드 종료(기존 click 동작 유지)
    const sel: NoteSel = { mi: np.mi, ni: np.ni, ...(staff ? { staff } : {}), ...(np.v2 ? { v2: true } : {}) };
    const wasSelected = !!selectedNote && selectedNote.mi === sel.mi && selectedNote.ni === sel.ni && selectedNote.staff === staff && !!selectedNote.v2 === !!np.v2;
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
    }, d.sel.staff, d.sel.v2);
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

  const handleNotePress = useCallback((pn: PianoNote, opts?: { gain?: number; raw?: boolean }) => {
    /* raw(드럼 팔레트): keys 는 GM 퍼커션 절대값이라 임시표 변환·다이어토닉
     * 리스펠을 모두 우회한다 — 스펠링이 바뀌면 표기 매핑(vexKeyToMidi)이 어긋난다. */
    const raw = opts?.raw === true;
    const conv: { vexKey: string; acc?: 'b' | '#' | '##' | 'bb' } = raw
      ? { vexKey: pn.vexKey, acc: undefined }
      : (accMode === '##' || accMode === 'bb')
        ? convertAccDouble(pn, accMode)
        : convertAcc(pn, accMode === 'n' ? 'b' : accMode);
    /* 드럼은 피아노 음원이 아니라 재생과 같은 샘플 킷으로 들려준다 — 패드로 들은
     * 소리와 저장 후 재생되는 소리가 같아야 한다. */
    if (raw) auditionDrumGm(pn.midi);
    else playMidi(pn.midi, opts?.gain);

    // Diatonic respell: in keys whose signature already flats C (Gb/Cb majors
    // + Ebm/Abm) the white B key is pitch-class 11, which spells Cb — not
    // B natural — in those keys. Same idea for E↔Fb in Cb major / Abm.
    // The respelled letter (C or F) is already flat via the key sig, so we
    // drop the accidental entirely (otherwise accMode='n' would force a
    // stray natural sign on the wrong letter).
    let respelled = raw; // raw 는 리스펠 금지 + accMode='n' 내추럴 부착 금지
    if (!raw && sheetKey && !conv.acc && !explicitAcc) {
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
      const acc: Record<number, 'b' | '#' | 'n' | '##' | 'bb'> | undefined =
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

    // ── 보이스 2 입력 — 선택(없으면 마지막) 확정 마디의 voice2 에 추가.
    if (voiceMode === 2 && !raw) {
      const ti = selectedMeasure != null && selectedMeasure < measures.length
        ? selectedMeasure
        : measures.length - 1;
      if (ti >= 0) {
        pushEditUndo();
        const ni: NoteInfo = { keys: [conv.vexKey], duration, dotted: dotted || undefined, doubleDotted: doubleDotted || undefined, ...(ghostMode ? { ghost: true as const } : {}) };
        if (!respelled && accMode === 'n') ni.accidentals = { 0: 'n' };
        else if (conv.acc) ni.accidentals = { 0: conv.acc };
        if (tripletMode) ni.tuplet = 3;
        setMeasures((prev) => prev.map((m2, i2) => (i2 === ti ? { ...m2, voice2: [...(m2.voice2 ?? []), ni] } : m2)));
        if (tripletMode) {
          tripletCountRef.current += 1;
          if (tripletCountRef.current >= 3) { setTripletMode(false); tripletCountRef.current = 0; }
        }
        return;
      }
      // 확정 마디가 없으면 보이스1 흐름으로 폴백.
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
      setMeasures((prev) => {
        const target = prev[selectedMeasure];
        if (!target) return prev;
        const notes = [...target.notes];
        if (tieNext && notes.length > 0) {
          notes[notes.length - 1] = { ...notes[notes.length - 1], tie: true };
        }
        notes.push(ni);
        /* 4박을 넘기면 열린 마디와 똑같이 **자동으로 나눈다**. 예전엔 여기서
         * 그냥 밀어 넣기만 해 한 마디가 무한정 불어났다(추가 스태프는 클릭=마디
         * 선택이라 이 경로만 타서 특히 티가 났다). */
        const split = splitMeasuresByBeats([{ ...target, notes }], barBeats);
        const next = [...prev];
        next.splice(selectedMeasure, 1, ...split);
        // 이어서 입력할 수 있도록 마지막으로 나뉜 마디를 활성으로 옮긴다.
        if (split.length > 1) setSelectedMeasure(selectedMeasure + split.length - 1);
        return next;
      });
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
  const midiSettingsRef = useRef<{ auditionOnInput: boolean; velocityToAudition: boolean; chordDetect: boolean } | null>(null);
  /* 코드 인식용 note-on 버퍼(시간창 안에 모인 음)와, 인식 결과를 코드칸에 쓰는
   * 함수의 ref. 타이머가 나중에 터지므로 stale 클로저를 피하려 ref 로 둔다. */
  const chordBufRef = useRef<{ notes: number[]; timer: ReturnType<typeof setTimeout> | null }>({ notes: [], timer: null });
  const applyDetectedChordRef = useRef<((notes: number[]) => void) | null>(null);
  const handleMidiNoteOn = useCallback((e: MidiNoteEvent) => {
    const s = midiSettingsRef.current;
    let gain: number | undefined;
    if (s && !s.auditionOnInput) gain = 0;                                   // 입력 시 무음
    else if (s && s.velocityToAudition) gain = Math.max(0.2, 2 * (e.velocity / 100)); // 세게 칠수록 크게

    /* 코드 인식 모드 — 음표는 만들지 않고, 짧은 시간창 안에 들어온 note-on 을
     * 모아 하나의 화음으로 보고 코드 심볼을 알아낸다. 창은 마지막 키가 눌릴
     * 때마다 갱신되므로 아르페지오처럼 살짝 흩어 쳐도 한 화음으로 묶인다. */
    if (s?.chordDetect) {
      // 소리는 설정대로 들려준다. 실패해도 무시 — 사운드폰트 로드 실패가
      // unhandledrejection 으로 번지면 오디오 가드가 전체 재생을 멈춘다.
      if (gain !== 0) void playMidi(e.midi, gain).catch(() => {});
      const buf = chordBufRef.current;
      buf.notes.push(e.midi);
      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(() => {
        const notes = chordBufRef.current.notes;
        chordBufRef.current = { notes: [], timer: null };
        applyDetectedChordRef.current?.(notes);
      }, CHORD_DETECT_WINDOW_MS);
      return;
    }

    const pn = midiToPianoNote(e.midi);
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
    // Clear 는 bassMeasures 도 비우므로, 한손 표시 중이어도 왼손까지 세어 알린다.
    const noteCount = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length
      + bassMeasures.reduce((s, m) => s + m.notes.length, 0);
    if (noteCount > 0
      && !window.confirm(`악보를 모두 지울까요? (음표 ${noteCount}개)\nUndo(Backspace)로 되돌릴 수 있습니다.`)) return;
    pushEditUndo();
    setMeasures([]);
    setBassMeasures([]);
    setCurNotes([]);
    setCurChord1('');
    setCurChord2('');
    setSelectedBassMeasure(null);
    // 다중 스태프도 초기 상태(트레블 1개)로 — 다른 파트 데이터까지 비운다.
    setPartMetas([{ kind: 'treble' }]);
    partStoreRef.current = [{ measures: [], bassMeasures: [] }];
    setActivePart(0);
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
      const normalized = splitMeasuresByBeats(chordNormalized, barBeatsOf((data as { timeSignature?: string }).timeSignature));
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
      skipAccConvertRef.current = true;   // 로드는 변환 대상이 아니다(이미 그 표기법의 데이터)
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
    /* 어느 파트든 내용이 있으면 그린다 — part0 가 비어도 다른 파트가 보여야 한다. */
    const anyContent = renderParts.some((rp) => rp.measures.some((m) => m.notes.length > 0) || (rp.bassMeasures?.some((m) => m.notes.length > 0) ?? false))
      || allMeasures.length > 0;
    if (!anyContent) { el.innerHTML = ''; positionsRef.current = []; setMeasurePositions([]); notePositionsRef.current = []; return; }
    const validKey = sheetKey && (FLAT_KEYS[sheetKey] != null || SHARP_KEYS[sheetKey] != null || sheetKey === 'C') ? sheetKey : undefined;
    const p0 = renderParts[0];
    try {
      renderSheet(
        el, p0.measures, Math.max(sheetWidth, 300), currentIdx, activeIdx, positionsRef.current, validKey,
        notePositionsRef.current, multiSel, noteElMapRef.current,
        p0.kind === 'grand' ? (p0.bassMeasures ?? null) : null,
        explicitAcc, activeStaff,
        renderParts.slice(1), p0.kind, activePart, p0, timeSig, noteNameStyle,
      );
    } catch (err) {
      /* 렌더 도중 예외가 나면 el.innerHTML 이 이미 비워진 뒤라 **악보가 통째로
       * 사라진다**. 예전엔 조용히 삼켜서 원인 추적이 불가능했다 — 콘솔에 남기고,
       * 선택 상태만 정리한 뒤 다음 렌더에서 복구되게 한다. */
      console.error('[Editor] 악보 렌더 실패 — 화면이 비었습니다:', err);
      positionsRef.current.length = 0;
      notePositionsRef.current.length = 0;
      setSelectedNote(null);
    }
    setMeasurePositions([...positionsRef.current]);
    setNotePositions([...notePositionsRef.current]);
  }, [chordDbReady, allMeasures, renderParts, activePart, sheetWidth, currentIdx, activeIdx, sheetKey, multiSel, explicitAcc, activeStaff, timeSig, noteNameStyle]);

  /* ── 마디 하이라이트 윗변 보정 ─────────────────────────────────────────
   * 코드 입력칸은 SVG 가 아니라 **HTML 오버레이**라, 렌더러가 하이라이트를 그리는
   * 시점엔 그 칸이 실제로 화면에서 어디까지 올라가는지 알 수 없다(글꼴 넘침·
   * 위첨자 tension 은 계산으로 못 맞춘다 — 실제로 코드칸 윗부분이 잘려 보였다).
   *
   * 그래서 오버레이가 DOM 에 올라온 **뒤에** 실측해서, 하이라이트가 그 마디의
   * 모든 코드칸(대체코드 행 포함)을 완전히 덮도록 위로 늘린다. 페인트 전에
   * 끝나야 깜빡임이 없으므로 useLayoutEffect 다. */
  useLayoutEffect(() => {
    const host = svgRef.current;
    if (!host || activeIdx < 0) return;
    const rect = host.querySelector('rect.jz-measure-hl') as SVGRectElement | null;
    if (!rect) return;
    const cells = host.parentElement?.querySelectorAll(`[data-chord-measure="${activeIdx}"]`);
    if (!cells || cells.length === 0) return;

    const hostTop = host.getBoundingClientRect().top;
    let minTop = Infinity;
    cells.forEach((c) => {
      const r = (c as HTMLElement).getBoundingClientRect();
      if (r.height > 0) minTop = Math.min(minTop, r.top - hostTop);
    });
    if (!Number.isFinite(minTop)) return;

    /* 화면 px → SVG 모델 좌표. CHORD_GLYPH_RISE 는 코드 글리프가 자기 상자 위로
     * 삐져나오는 양(큰 글꼴 + 위첨자) — 상자만 덮으면 글자 머리가 잘린다. */
    const modelTop = minTop / SHEET_SCALE - CHORD_GLYPH_RISE;
    const curY = parseFloat(rect.getAttribute('y') ?? '0');
    const curH = parseFloat(rect.getAttribute('height') ?? '0');
    if (Number.isFinite(curY) && Number.isFinite(curH) && modelTop < curY) {
      rect.setAttribute('y', String(modelTop));
      rect.setAttribute('height', String(curH + (curY - modelTop)));
    }
  });

  const selNoteInfo = useMemo<NoteInfo | null>(() => {
    if (!selectedNote) return null;
    const m = selectedNote.staff === 'bass' ? bassMeasures[selectedNote.mi] : allMeasures[selectedNote.mi];
    if (!m) return null;
    if (selectedNote.v2) return m.voice2?.[selectedNote.ni] ?? null;
    return m.notes[selectedNote.ni] ?? null;
  }, [selectedNote, allMeasures, bassMeasures]);

  /* ── 가사 편집 ─────────────────────────────────────────────────────────
   * 선택한 음표의 절별 음절을 고친다. 빈 문자열이면 그 절을 지운다.
   * `syllabic` 은 사용자가 하이픈 버튼으로 정하고, 없으면 'single'(낱말 하나). */
  const setLyric = useCallback((verse: number, text: string) => {
    if (!selectedNote) return;
    updateNote(selectedNote.mi, selectedNote.ni, (n) => {
      const rest = (n.lyrics ?? []).filter((l) => l.verse !== verse);
      const trimmed = text.trim();
      const prev = (n.lyrics ?? []).find((l) => l.verse === verse);
      const next = trimmed
        ? [...rest, { ...(prev ?? { verse, text: '' }), verse, text: trimmed }]
        : rest;
      next.sort((x, y) => x.verse - y.verse);
      const out: NoteInfo = { ...n };
      if (next.length) out.lyrics = next; else delete out.lyrics;
      return out;
    }, selectedNote.staff);
  }, [selectedNote, updateNote]);

  /** 음절 속성(하이픈 이어짐 / 멜리스마) 토글. */
  const toggleLyricFlag = useCallback((verse: number, flag: 'hyphen' | 'extend') => {
    if (!selectedNote) return;
    updateNote(selectedNote.mi, selectedNote.ni, (n) => {
      const list = (n.lyrics ?? []).map((l) => {
        if (l.verse !== verse) return l;
        if (flag === 'extend') {
          const o = { ...l }; if (o.extend) delete o.extend; else o.extend = true; return o;
        }
        // 하이픈: 'single' ↔ 'begin' 토글(뒤 음절로 이어짐).
        const o = { ...l };
        o.syllabic = (l.syllabic === 'begin' || l.syllabic === 'middle') ? 'single' : 'begin';
        return o;
      });
      return list.length ? { ...n, lyrics: list } : n;
    }, selectedNote.staff);
  }, [selectedNote, updateNote]);

  /* 아티큘레이션·다이내믹스 탭은 음표(쉼표 제외), 마디 탭은 마디 활성화가 전제 —
   * 조건이 안 되면 탭 자체를 잠그고, 보던 중 선택이 풀리면 음표 탭으로 복귀. */
  const noteTabUsable = !!(selectedNote && selNoteInfo && !selNoteInfo.duration.endsWith('r'));
  const measureTabUsable = activeMeasureIdx != null;
  useEffect(() => {
    if (!noteTabUsable && (toolTab === 'artic' || toolTab === 'dyn' || toolTab === 'lyric')) setToolTab('note');
    if (!measureTabUsable && toolTab === 'measure') setToolTab('note');
  }, [noteTabUsable, measureTabUsable, toolTab]);

  useEffect(() => {
    if (!selectedNote) return;
    const m = selectedNote.staff === 'bass' ? bassMeasures[selectedNote.mi] : allMeasures[selectedNote.mi];
    const exists = selectedNote.v2 ? m?.voice2?.[selectedNote.ni] : m?.notes[selectedNote.ni];
    if (!exists) {
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
    /* 음표는 **머리를 정확히 눌렀을 때만** 활성화(사양) — 기둥·빔·주변 여백을
     * 누르면 아래의 마디 히트테스트로 흘러가 마디만 선택된다. */
    let best: NotePos | null = null;
    let bestDist = Infinity;
    for (const np of notePositionsRef.current) {
      const dist = noteHeadHit(np, cx, cy);
      if (dist !== null && dist < bestDist) { bestDist = dist; best = np; }
    }
    if (best) {
      const staff = best.staff;
      const hit: NoteSel = { mi: best.mi, ni: best.ni, ...(staff ? { staff } : {}), ...(best.v2 ? { v2: true } : {}) };
      const same = (a: NoteSel, b: NoteSel) => a.mi === b.mi && a.ni === b.ni && a.staff === b.staff && !!a.v2 === !!b.v2;
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
    let bestM: { idx: number; staff?: 'bass'; part: number } | null = null;
    let bestMDist = Infinity;
    for (const p of positionsRef.current) {
      const pPart = p.part ?? 0;
      // 활성 파트의 열린(미확정) 마디는 기존 입력 플로우가 담당 — 히트 제외.
      if (pPart === activePart && p.staff !== 'bass' && p.idx >= measures.length) continue;
      if (cx < p.x - 6 || cx > p.x + p.w + 6) continue;
      // 오선(5줄) 안을 눌렀을 때만 마디를 활성화한다. 오선 위쪽 여백은 코드
      // 심볼 자리이고 아래쪽은 다음 행과 맞닿으므로, 그 여백까지 판정에 넣으면
      // 아래 행의 코드를 만질 때 윗행 마디가 잡힌다(행 겹침). 양손 모드의
      // 트레블/베이스도 각자 실제 오선 범위로 판정돼 서로 침범하지 않는다.
      if (cy < p.staveTop - STAFF_HIT_PAD || cy > p.staveBot + STAFF_HIT_PAD) continue;
      const dy = Math.abs(cy - (p.staveTop + p.staveBot) / 2);
      if (dy < bestMDist) { bestMDist = dy; bestM = { idx: p.idx, staff: p.staff, part: pPart }; }
    }
    if (bestM === null) {
      setSelectedMeasure(null);
      setSelectedBassMeasure(null);
      return;
    }
    /* 비활성 파트의 마디 클릭 = 그 파트로 전환 + 해당 마디 선택. switchPart 가
     * 선택을 비운 뒤 아래 setState 들이 같은 배치에서 덮어쓴다. */
    if (bestM.part !== activePart) {
      const idx = bestM.idx;
      const targetLen = (partStoreRef.current[bestM.part]?.measures.length ?? 0);
      switchPart(bestM.part);
      if (idx < Math.max(targetLen, 1)) {
        if (bestM.staff === 'bass') setSelectedBassMeasure(idx);
        else if (idx < targetLen) setSelectedMeasure(idx);
      }
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
  }, [selectedNote, measures.length, activePart, switchPart]);

  // (moved before handleNotePress)

  /* 왼손도 항상 센다 — 한손으로 토글해도 데이터는 남아 저장되므로, 여기서만
   * 0으로 세면 Save 가 잠기거나 "음표 N개" 안내가 실제와 어긋난다. */
  const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0) + curNotes.length
    + bassMeasures.reduce((s, m) => s + m.notes.length, 0);

  /* 저장/복사/재생에 포함할 베이스 파트.
   *
   * 화면 토글(한손/양손)과 **분리한다**. 예전엔 bassAll(= 한손이면 null)을 그대로
   * 썼기 때문에, 양손으로 왼손을 찍어둔 뒤 실수로 한손으로 바꾼 상태에서 저장하면
   * 왼손이 통째로 빠진 채 기록됐다(메모리에는 남아 있는데 저장본에서만 소실).
   * 토글은 '지금 무엇을 보고 어디로 입력하나'일 뿐이므로, 내용이 있으면 언제나 싣는다. */
  const bassForOut = useMemo<MeasureInfo[] | null>(() => {
    if (!bassMeasures.some((m) => m.notes.length > 0)) return null;
    // 트레블 길이에 맞춰 패딩 — 인덱스 1:1 정렬을 저장본에서도 유지.
    return allMeasures.map((_, i) => bassMeasures[i] ?? { notes: [] });
  }, [allMeasures, bassMeasures]);

  /* 저장/복사에 실을 마디 — **에디터 상태 그대로** 나간다.
   *
   * 예전엔 '조표 무시'(explicit)일 때 score 해석으로 읽어도 같은 소리가 나도록
   * 임시표를 미리 구웠다. 백엔드가 `accidentalStyle` 을 저장하지 않아(BR-33)
   * 다시 열면 무조건 score 로 읽혔기 때문이다. 이제 그 필드가 왕복하고
   * (2026-08-08 운영 실측: 저장→조회 유실 0) 로드 경로도 시트의 표기법을 그대로
   * 따르므로(`isExplicitSheet`) 우회가 필요 없다. 굽기를 없애면 조표에 걸린
   * 글자마다 박히던 잉여 ♮ 가 저장본에서 사라진다 — 소리는 처음부터 불변이다
   * (explicit 해석에서 ♮ 와 '표기 없음' 은 둘 다 내추럴). */
  const outMeasures = allMeasures;
  const bassOut = bassForOut;

  /* ── 저장·재생용 전체 스태프 스냅샷 ──────────────────────────────────
   * 활성 파트는 라이브 버퍼(allMeasures/bassAll), 비활성은 스토어. 임시표는
   * 굽지 않는다 — `accidentalStyle` 이 함께 저장돼 해석이 보존된다(위 참조). */
  const buildAllStaves = useCallback((): SheetStaff[] => {
    return partMetas.map((meta, i) => {
      const live = i === activePart;
      const ms = live ? allMeasures : (partStoreRef.current[i]?.measures ?? []);
      const bs = meta.kind === 'grand'
        ? (live ? (bassAll ?? bassMeasures) : (partStoreRef.current[i]?.bassMeasures ?? []))
        : [];
      return {
        kind: meta.kind,
        measures: ms,
        ...(meta.kind === 'grand' && bs.some((mm) => mm.notes.length > 0) ? { bassMeasures: bs } : {}),
        ...(meta.instrument ? { instrument: meta.instrument } : {}),
        ...(meta.withNotation ? { withNotation: true } : {}),
        ...(meta.capo ? { capo: meta.capo } : {}),
        ...(meta.tuningPreset && meta.tuningPreset !== 'standard' ? { tuningPreset: meta.tuningPreset } : {}),
        ...(meta.chordDiagrams ? { chordDiagrams: true } : {}),
      };
    });
  }, [partMetas, activePart, allMeasures, bassAll, bassMeasures]);

  /* build JSON — lead sheet format */
  const jsonOutput = useMemo(() => {
    if (allMeasures.length === 0) return '';
    const entry = {
      title: sheetTitle || 'Untitled',
      composer: composer || 'Unknown',
      ...(genre ? { genre } : {}),
      key: sheetKey,
      timeSignature: timeSig,
      tempo: bpm,
      measures: outMeasures,
      ...(bassOut ? { bassMeasures: bassOut } : {}),
      // 다중 스태프면 staves 도 그대로 — 저장 포맷(stavesToSheetFields)과 동일 규약.
      ...(partMetas.length > 1 || (partMetas[0] && partMetas[0].kind !== 'treble' && partMetas[0].kind !== 'grand')
        ? { staves: buildAllStaves() }
        : {}),
      ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
    };
    return JSON.stringify(entry, null, 2);
  }, [outMeasures, bassOut, sheetTitle, composer, genre, sheetKey, bpm, explicitAcc, partMetas, buildAllStaves]);

  /* 재생 — 입력한 멜로디를 풀 백킹 밴드(베이스/드럼/피아노 1·3박 컴핑)와 함께
   * GlobalPlayer(kind:'sheet')로 돌린다. 코드차트와 동일한 backing 엔진. */

  const buildSheet = useCallback((): NoteSheetData => ({
    title: sheetTitle || (mode === 'solo' ? 'Untitled Solo' : 'Untitled Lick'),
    composer: composer || 'Unknown',
    key: sheetKey,
    timeSignature: timeSig,
    tempo: bpm,
    ...(genre ? { genre } : {}),
    measures: outMeasures,
    ...(bassOut ? { bassMeasures: bassOut } : {}),
    ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
  }), [sheetTitle, composer, sheetKey, bpm, genre, outMeasures, bassOut, mode, explicitAcc]);

  /* 다중 파트 재생 — 첫 파트(메인 멜로디)는 buildSheet 가 담당하고, 그 외
   * (양손 왼손 + 추가 스태프 전부)를 extraParts 로 함께 소리낸다.
   * stavesToPlaybackParts 가 파트별 음색(instrument)·드럼(isDrum, key C 고정)을
   * 규약대로 채운다. 단일 트레블(기존 케이스)은 예전과 동일하게 빈 배열. */
  const buildExtraPartsAll = useCallback((): NoteSheetData[] => {
    const staves = buildAllStaves();
    const base: NoteSheetData = {
      title: 'Part', composer: composer || 'Unknown', key: sheetKey,
      timeSignature: timeSig, tempo: bpm, measures: [],
      ...(explicitAcc ? { accidentalStyle: 'explicit' as const } : {}),
    };
    // 첫 원소는 part0 오른손(메인) — buildSheet 와 중복이라 버린다.
    return stavesToPlaybackParts(base, staves).slice(1);
  }, [buildAllStaves, composer, sheetKey, bpm, explicitAcc]);

  const { playing, handlePlayPause, handleStop, countInOverlay } =
    useEditorBackingPlayback({ buildSheet, buildExtraParts: buildExtraPartsAll, bpm, repeatCount, noteElMapRef });

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

  /* MIDI 화음 → 코드 심볼. 대상 마디는 선택된 마디, 없으면 지금 입력 중인 마디.
   * 한 마디에 코드가 둘까지 들어가므로 빈 슬롯을 앞에서부터 채우고, 둘 다 차
   * 있으면 첫 슬롯을 덮어쓴다(같은 마디에 계속 치면 1→2→1… 순환). */
  const applyDetectedChord = useCallback((notes: number[]) => {
    // 표기(♭/♯)는 툴바의 임시표 모드를 따른다 — 타이핑 입력과 같은 감각.
    const sym = detectChordFromMidi(notes, { flats: accMode !== '#' });
    if (!sym) return;
    const idx = selectedMeasure != null && selectedMeasure < measures.length
      ? selectedMeasure
      : measures.length;
    const [c1, c2] = idx === measures.length
      ? [curChord1, curChord2]
      : splitChords(measures[idx]?.chord ?? '');
    const slot: 0 | 1 = !c1.trim() ? 0 : !c2.trim() ? 1 : 0;
    updateMeasureChordSlot(idx, slot, normalizeChord(sym));
  }, [accMode, selectedMeasure, measures, curChord1, curChord2, updateMeasureChordSlot]);
  useEffect(() => { applyDetectedChordRef.current = applyDetectedChord; }, [applyDetectedChord]);

  const handleSave = useCallback(async () => {
    if (allMeasures.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    // On success we navigate away; keep the saving overlay up through the
    // route change instead of flashing it off in `finally`.
    let navigated = false;
    try {
      if (mode === 'solo') {
        /* 다중 스태프면 staves 로 싣고 measures/bassMeasures 는 첫 파트 미러
         * (stavesToSheetFields 규약 — 구버전 리더·백엔드 feature 계산 호환).
         * 단일 트레블/양손이면 기존과 완전히 같은 페이로드가 나간다. */
        const packed = stavesToSheetFields(buildAllStaves());
        const draft = buildUserSoloDraft({
          title: sheetTitle || 'Untitled',
          /* 연주자(Performer)와 작곡가(Composer)는 별개다. Solo Database 는
           * **연주자**로 분류하므로 Performer 칸이 그 값이 된다 — 예전엔
           * Performer·Album 칸이 저장에 아예 안 쓰이고 Composer 값이 연주자로
           * 들어가 분류가 뒤엉켰다. */
          composer: composer || undefined,
          performer: performer || undefined,
          album: album || undefined,
          genre: genre || undefined,
          key: sheetKey,
          timeSignature: timeSig,
          tempo: bpm,
          measures: packed.measures,
          bassMeasures: packed.bassMeasures ?? undefined,
          staves: packed.staves,
          accidentalStyle: explicitAcc ? 'explicit' : undefined,
        });
        const titleLow = (sheetTitle || 'Untitled').toLowerCase();
        /* 덮어쓰기(수정) 판정도 연주자 기준 — 저장되는 값과 같은 축이어야 한다. */
        const performerLow = (performer || '').toLowerCase();
        // Only treat this as an UPDATE of an existing solo when the user
        // actually typed a title AND performer. Otherwise the 'Untitled'/
        // 'Unknown' defaults would make every untitled save overwrite the
        // previous untitled one (data loss). Blank → always create new.
        const canMatch = sheetTitle.trim() !== '' && performer.trim() !== '';
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
        const packedC = stavesToSheetFields(buildAllStaves());
        const sheet: NoteSheetData = {
          title: sheetTitle || 'Untitled',
          composer: composer || 'Unknown',
          key: sheetKey,
          timeSignature: timeSig,
          tempo: bpm,
          measures: packedC.measures,
          ...(packedC.bassMeasures ? { bassMeasures: packedC.bassMeasures } : {}),
          ...(packedC.staves ? { staves: packedC.staves } : {}),
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
      } else if (mode === 'leadsheet') {
        /* Lead Sheet — 백엔드 미구현(요구사항 #60). Comping 과 같이 localStorage 에만.
         *
         * 저장하면 **음표가 사라진다** — 리드시트는 코드 진행이고 음표를 담을 자리가
         * 없다. 실수로 채보한 악보를 리드시트로 저장해 음표를 날리는 일이 없도록,
         * 코드가 하나도 없으면 아예 막는다. */
        if (!hasAnyChord(allMeasures)) {
          setSaveError('코드가 없습니다 — 리드시트는 코드 진행이 본체입니다. 마디에 코드를 입력하세요.');
          setTimeout(() => setSaveError(null), 4000);
          return; // `finally` 가 saving 을 되돌린다
        }
        const chart = measuresToLeadSheet(allMeasures, {
          title: sheetTitle || 'Untitled',
          composer: composer || undefined,
          style: genre === 'Unknown' ? undefined : genre,
          key: sheetKey,
          timeSignature: timeSig,
        });
        const fieldsL = {
          title: chart.title,
          style: leadSheetStyle,
          composer: composer || undefined,
          key: sheetKey,
          tempo: bpm,
          chart,
        };
        const savedL = (editingLeadSheetId ? updateLeadSheet(editingLeadSheetId, fieldsL) : null)
          ?? createLeadSheet(fieldsL);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
        navigated = true;
        navigate(`/lead-sheets?item=${encodeURIComponent(savedL.id)}`);
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
            timeSignature: timeSig,
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
        /* 앱에는 Lick Database 화면이 없다(관리 화면이라 스튜디오로 갔다).
         * 사용자는 자기 릭 목록으로 보낸다. */
        navigate(isStudio ? '/licks' : '/my-licks');
      }
    } catch (err) {
      console.error(`${mode} save failed`, err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      // Leave the overlay up if we're navigating; only restore on failure.
      if (!navigated) setSaving(false);
    }
  }, [mode, allMeasures, outMeasures, bassOut, sheetTitle, composer, performer, album, genre, sheetKey, bpm, saving, editingLickId, navigate, compingGenre, editingCompingId, explicitAcc]);

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
      {/* 스태프 종류 선택 모달 — 6종 카드(이름·설명·미리보기). */}
      {chordPasteOpen && (
        <ChordPasteModal
          measureCount={measures.length}
          initialQuery={sheetTitle}
          onApply={handleChordPaste}
          onClose={() => setChordPasteOpen(false)}
        />
      )}

      {staffModal && (
        <StaffModalOverlay onClick={() => setStaffModal(null)}>
          <StaffModalCard onClick={(e) => e.stopPropagation()}>
            <h2>{staffModal.mode === 'add' ? '스태프 추가' : `${staffModal.idx + 1}번 스태프 종류 변경`}</h2>
            <p className="sub">
              {staffModal.mode === 'add'
                ? '악보에 새 보표를 아래로 추가합니다. 각 스태프는 독립 파트로 저장·재생됩니다.'
                : '이 보표의 표기 방식을 바꿉니다. 입력된 음표 데이터는 유지됩니다.'}
            </p>
            <StaffKindGrid>
              {STAFF_KIND_ORDER.map((k) => {
                const km = STAFF_KIND_META[k];
                const isCurrent = staffModal.mode === 'change' && partMetas[staffModal.idx]?.kind === k;
                return (
                  <StaffKindCard key={k} type="button" $on={isCurrent}
                    onClick={() => {
                      if (staffModal.mode === 'add') addPart(k);
                      else changePartKind(staffModal.idx, k);
                      setStaffModal(null);
                    }}>
                    <StaffKindPreview kind={k} />
                    <b>{km.label}</b>
                    <span>{km.desc}</span>
                  </StaffKindCard>
                );
              })}
            </StaffKindGrid>
            <StaffModalClose type="button" onClick={() => setStaffModal(null)}>닫기</StaffModalClose>
          </StaffModalCard>
        </StaffModalOverlay>
      )}
      {countInOverlay}
      <AppSidebar />
      <PageBody>
      <Header>
        <BackButton onClick={() => navigate(-1)} label="이전 페이지" />
        <Title>Editor</Title>
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
        <Spacer />
        {/* MIDI 버튼은 툴바 'MIDI' 탭으로 편입돼 여기서는 뺐다. */}
        <ToolBtn
          type="button"
          title="에디터 설정 — 조표 무시 등"
          $lit={explicitAcc}
          onClick={() => openPerformanceSettings('editor')}
        >
          <GearIcon />
        </ToolBtn>
      </Header>



      {/* 상단 트랜스포트 바 — 코드차트와 동일한 믹서/재생 컨트롤. 믹서 버튼은
          클릭 시 팝오버(좁은 화면은 모달)로 트랙들을 띄운다. */}

      {/* 상단 탭 — 섹션 위에 얹는 줄. 섹션 내부는 그대로 두고 이 줄만 추가했다. */}
      <TabBar>
        <TabList>
          {TOOL_TABS.map((t) => (
            <TabItem
              key={t.id}
              type="button"
              $on={toolTab === t.id}
              $accent={
                (t.id === 'artic' || t.id === 'dyn' || t.id === 'lyric') && noteTabUsable ? '#e08a8a'
                  : t.id === 'measure' && measureTabUsable ? '#D4A843'
                  : undefined
              }
              disabled={((t.id === 'artic' || t.id === 'dyn' || t.id === 'lyric') && !noteTabUsable)
                || (t.id === 'measure' && !measureTabUsable)}
              title={(t.id === 'artic' || t.id === 'dyn' || t.id === 'lyric') && !noteTabUsable
                ? '음표(머리)를 선택하면 사용할 수 있어요'
                : t.id === 'measure' && !measureTabUsable
                  ? '마디를 선택하면 사용할 수 있어요'
                  : undefined}
              /* MIDI 탭은 열릴 때 기기 접근을 요청한다 — 예전엔 헤더의 MIDI
               * 버튼이 하던 일인데, 그 버튼을 탭으로 편입하며 여기로 옮겼다. */
              onClick={() => {
                setToolTab(t.id);
                if (t.id === 'midi' && !midi.enabled) midi.requestAccess();
              }}
            >
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
        {/* 구분선 기준 3개 묶음 —
          *   1) 편집 되돌리기   2) 출력   3) 악보 파일 동작(상단바에서 내려온 4개) */}
        <TabIcons>
          <TabIconBtn type="button" title="되돌리기" onClick={handleUndo}>{TIco.undo}</TabIconBtn>
          <TabIconBtn type="button" title="다시하기" onClick={handleRedo}>{TIco.redo}</TabIconBtn>

          <TabDivider />
          {/* 아직 동작 미연결 — 디자인만. */}
          <TabIconBtn type="button" title="인쇄 (준비 중)">{TIco.print}</TabIconBtn>
          <TabIconBtn type="button" title="내려받기 (준비 중)">{TIco.down}</TabIconBtn>

          <TabDivider />
          <TabIconBtn
            type="button"
            onClick={handleClear}
            disabled={totalNotes === 0}
            title="악보 전체 지우기 — 확인 후 삭제, Undo(Backspace)로 복구 가능"
            aria-label="악보 전체 지우기"
          >
            <TrashIcon />
          </TabIconBtn>
          <TabIconBtn
            type="button"
            onClick={handleCopy}
            disabled={totalNotes === 0}
            title={copied ? 'JSON 복사됨' : 'JSON 복사'}
            aria-label={copied ? 'JSON 복사됨' : 'JSON 복사'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </TabIconBtn>
          <TabIconBtn
            type="button"
            onClick={() => { setShowLoadModal(true); setLoadJsonText(''); setLoadJsonError(''); }}
            title="JSON 불러오기"
            aria-label="JSON 불러오기"
          >
            <ImportIcon />
          </TabIconBtn>
          <SaveTabBtn
            type="button"
            onClick={handleSave}
            disabled={totalNotes === 0 || saving}
            $busy={saving}
            $error={!saving && !!saveError}
            title={saveLabel}
            aria-label={saveLabel}
          >
            {saving ? <SaveSpinnerIcon /> : <SaveIcon />}
          </SaveTabBtn>
        </TabIcons>
      </TabBar>

      {toolTab === 'lyric' ? (
        /* 가사 탭 — 선택한 음표의 음절을 절별로 입력한다. 보컬용.
         * 표기(하이픈·멜리스마)는 뷰어와 같은 lyricLayout 이 그린다. */
        <LyricTabPanel>
          {[1, 2, 3].map((verse) => {
            const cur = selNoteInfo?.lyrics?.find((l) => l.verse === verse);
            const joins = cur?.syllabic === 'begin' || cur?.syllabic === 'middle';
            return (
              <div key={verse} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: '0.76rem', color: '#888', minWidth: 24 }}>{verse}절</span>
                <LyricInput
                  value={cur?.text ?? ''}
                  placeholder={verse === 1 ? '음절' : ''}
                  onChange={(e) => setLyric(verse, e.target.value)}
                  aria-label={`${verse}절 가사`}
                />
                <NoteEditBtn
                  type="button"
                  title="다음 음절과 한 낱말로 이어짐 — 사이에 하이픈을 그린다"
                  aria-pressed={joins}
                  $active={joins}
                  disabled={!cur}
                  onClick={() => toggleLyricFlag(verse, 'hyphen')}
                >–</NoteEditBtn>
                <NoteEditBtn
                  type="button"
                  title="멜리스마 — 이 음절을 다음 음들까지 끌며 밑줄을 그린다"
                  aria-pressed={!!cur?.extend}
                  $active={!!cur?.extend}
                  disabled={!cur}
                  onClick={() => toggleLyricFlag(verse, 'extend')}
                >__</NoteEditBtn>
              </div>
            );
          })}
          <LyricHint>
            음표를 고르고 음절을 적습니다. <b>–</b> 는 다음 음절과 한 낱말로 이어(하이픈),
            <b> __</b> 는 한 음절을 여러 음에 끕니다(멜리스마).
            <br />⚠️ 백엔드가 아직 가사를 저장하지 않습니다(BR-47).
          </LyricHint>
        </LyricTabPanel>
      ) : toolTab === 'midi' ? (
        /* MIDI 탭 — 예전 톱니 옆 MIDI 버튼이 띄우던 모달의 내용. */
        <MidiTabPanel>
          <MidiSettingsBody midi={midi} />
        </MidiTabPanel>
      ) : toolTab === 'info' ? (
        /* 정보 탭 — 제목·작곡가·악보 메타데이터·장르/조성·믹서/재생을 한곳에 모았다. */
        <InfoTabPanel>
            {/* 1 — Type. 라벨은 테두리에 겹치는 legend 처럼. */}
            {/* 위 여백 = Type 라벨과 칩 사이 간격. 아래 여백까지 늘린 만큼
                세로 3등분되는 칩 높이가 조금씩 줄어든다. */}
            <InfoBox style={{ alignItems: 'stretch', gap: 4, padding: '18px 10px 10px' }}>
              <BoxLegend>타입</BoxLegend>
              <SegGroup $vertical $n={visibleModes.length} $i={visibleModes.indexOf(mode)} style={{ width: '100%', flex: 1, minHeight: 0 }}>
                <SegThumb $vertical $n={visibleModes.length} $i={visibleModes.indexOf(mode)} />
                {visibleModes.map((m) => (
                  <SegBtn key={m} type="button" $on={mode === m} disabled={editingLickId !== null} onClick={() => setMode(m)}>{MODE_LABEL[m]}</SegBtn>
                ))}
              </SegGroup>
            </InfoBox>

            {/* 2 — 텍스트 메타데이터 (두 열) */}
            <InfoBox>
              <InfoCols>
                {/* Title~Performer 를 한 열에 4줄로. 바 높이(146px)에 맞춰 입력을 얇게 잡았다. */}
                <InfoCol>
                  <MetaField><MetaLabel>Title</MetaLabel><MetaInput value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} placeholder="e.g. Autumn Leaves" /></MetaField>
                  <MetaField><MetaLabel>Album</MetaLabel><MetaInput value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="e.g. Bird & Diz" /></MetaField>
                  <MetaField><MetaLabel>Composer</MetaLabel><MetaInput value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="e.g. Joseph Kosma" /></MetaField>
                  <MetaField><MetaLabel>Performer</MetaLabel><MetaInput value={performer} onChange={(e) => setPerformer(e.target.value)} placeholder="e.g. Charlie Parker" /></MetaField>
                </InfoCol>
                <InfoCol style={{ gap: 9 }}>
                  <MetaField $tight><MetaLabel>Genre</MetaLabel><GenreFill><GenreSelect value={genre} onChange={setGenre} /></GenreFill></MetaField>
                  <MetaField $tight>
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
                  <MetaField $tight>
                    <MetaLabel>박자</MetaLabel>
                    <TimeSigSelect
                      value={timeSig}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === timeSig) return;
                        const hasNotes = measures.some((mm) => mm.notes.length > 0) || curNotes.length > 0;
                        if (hasNotes && !window.confirm(`박자표를 ${next} 로 바꾸고 기존 마디를 새 박자로 다시 나눌까요?`)) return;
                        pushEditUndo();
                        const m2 = /^([0-9]+)\/([0-9]+)$/.exec(next)!;
                        const nb = Number(m2[1]) * (4 / Number(m2[2]));
                        setMeasures((prev) => splitMeasuresByBeats(prev, nb));
                        setBassMeasures((prev) => (prev.length ? splitMeasuresByBeats(prev, nb) : prev));
                        setTimeSig(next);
                      }}
                    >
                      {['2/4', '3/4', '4/4', '5/4', '6/4', '3/8', '4/8', '5/8', '6/8', '7/8', '9/8', '12/8', '2/2', '3/2'].map((t2) => (
                        <option key={t2} value={t2}>{t2}</option>
                      ))}
                    </TimeSigSelect>
                  </MetaField>
                </InfoCol>
              </InfoCols>
            </InfoBox>

            {/* 3 — Staff 박스: 자유 조합 스태프 목록. 행 클릭 = 그 파트 활성(편집
                대상), ＋ = 종류 선택 모달, ⇆ = 종류 변경. 첫 스태프가 코드칸과
                재생 멜로디의 기준 파트다. */}
            <InfoBox $grow style={{ alignItems: 'stretch', gap: 4, padding: '16px 8px 8px 10px' }}>
              <BoxLegend>보표 {staffModeLocked && <LockedHint title="불러온 악보 — 첫 스태프의 종류는 바꿀 수 없습니다">🔒</LockedHint>}</BoxLegend>
              <StaffRowArea>
                {/* 스태프 추가 — 섹션 왼쪽에서 세로 전체를 차지하는 큰 버튼.
                    칩들은 그 오른쪽에 부속으로 붙는다. */}
                <AddStaffBtn type="button" disabled={mode === 'lick'}
                  title={mode === 'lick' ? '릭은 단일 보표만 저장됩니다' : '스태프 추가'}
                  onClick={() => setStaffModal({ mode: 'add' })}>
                  ＋<em>스태프<br />추가</em>
                </AddStaffBtn>
                <StaffListWrap>
                {partMetas.map((meta, i) => {
                  const km = STAFF_KIND_META[meta.kind];
                  return (
                    <StaffRowBtn key={i} $on={i === activePart} onClick={() => switchPart(i)}
                      title={i === activePart ? '편집 중인 스태프' : '클릭하면 이 스태프를 편집합니다'}>
                      {/* 번호+이름 묶음 — 모든 행에서 같은 폭이라 오른쪽 컨트롤이 세로로 정렬된다. */}
                      <span className="id" title={km.label}>
                        <span className="ord">{i + 1}</span>
                        <span className="name">{km.label}</span>
                      </span>
                      {!km.instrumentLocked ? (
                        <span className="inst" onClick={(e) => e.stopPropagation()} title={instrumentName(meta.instrument ?? '')}>
                          <SessionPicker
                            value={meta.instrument ?? ''}
                            onChange={(v) => {
                              setPartMetas((prev) => prev.map((pm, pi2) => (pi2 === i ? { ...pm, instrument: v } : pm)));
                              if (i === activePart) setMetaInstrument(v);
                            }}
                            allowCustom
                          />
                        </span>
                      ) : (
                        /* 악기 고정 종류(양손=피아노 · 드럼=드럼킷)도 아이콘은 보여준다. */
                        <span
                          className="fixedinst"
                          title={meta.kind === 'drum' ? '드럼 보표는 드럼 채널로 고정 재생됩니다' : '피아노 양손 악보는 악기가 피아노로 고정됩니다'}
                        >
                          <img
                            src={instrumentIconUrl(meta.kind === 'drum' ? 'drum-kit' : 'piano') ?? ''}
                            alt={meta.kind === 'drum' ? '드럼' : '피아노'}
                          />
                        </span>
                      )}
                      {isTabKind(meta.kind) && i > 0 && (
                        <label className="opt" onClick={(e) => e.stopPropagation()} title="TAB 위에 표준 오선을 함께 표기">
                          <input
                            type="checkbox"
                            checked={!!meta.withNotation}
                            onChange={(e) => setPartMetas((prev) => prev.map((pm, pi2) => (pi2 === i ? { ...pm, withNotation: e.target.checked } : pm)))}
                          />
                          오선
                        </label>
                      )}
                      <span className="btns" onClick={(e) => e.stopPropagation()}>
                        {isTabKind(meta.kind) && (
                          <button type="button" title="TAB 설정 — 카포·튜닝·코드표"
                            onClick={() => setTabCfgIdx((v) => (v === i ? null : i))}>⚙</button>
                        )}
                        <button type="button" title="종류 변경" disabled={staffModeLocked && i === 0}
                          onClick={() => setStaffModal({ mode: 'change', idx: i })}>⇆</button>
                        <button type="button" title="위로" disabled={i === 0} onClick={() => movePart(i, -1)}>↑</button>
                        <button type="button" title="아래로" disabled={i === partMetas.length - 1} onClick={() => movePart(i, 1)}>↓</button>
                        <button type="button" title="스태프 삭제" disabled={partMetas.length <= 1 || (staffModeLocked && i === 0)}
                          onClick={() => {
                            const store = partStoreRef.current[i];
                            const n = i === activePart
                              ? measures.reduce((a, mm) => a + mm.notes.length, 0) + curNotes.length + bassMeasures.reduce((a, mm) => a + mm.notes.length, 0)
                              : (store?.measures.reduce((a, mm) => a + mm.notes.length, 0) ?? 0) + (store?.bassMeasures.reduce((a, mm) => a + mm.notes.length, 0) ?? 0);
                            if (n > 0 && !window.confirm(`${km.label} 스태프의 음표 ${n}개가 함께 삭제됩니다. 계속할까요?`)) return;
                            removePart(i);
                          }}>✕</button>
                      </span>
                      {tabCfgIdx === i && (
                        <TabCfgPop onClick={(e) => e.stopPropagation()}>
                          <div className="row">
                            <span>카포</span>
                            <select
                              value={meta.capo ?? 0}
                              onChange={(e) => setPartMetas((prev) => prev.map((pm, pi2) => (pi2 === i ? { ...pm, capo: Number(e.target.value) || undefined } : pm)))}
                            >
                              {[0, 1, 2, 3, 4, 5, 6, 7].map((c2) => <option key={c2} value={c2}>{c2 === 0 ? '없음' : `${c2}프렛`}</option>)}
                            </select>
                          </div>
                          {meta.kind === 'guitar-tab' && (
                            <div className="row">
                              <span>튜닝</span>
                              <select
                                value={meta.tuningPreset ?? 'standard'}
                                onChange={(e) => setPartMetas((prev) => prev.map((pm, pi2) => (pi2 === i ? { ...pm, tuningPreset: e.target.value === 'drop-d' ? 'drop-d' : undefined } : pm)))}
                              >
                                <option value="standard">표준 (EADGBE)</option>
                                <option value="drop-d">Drop D</option>
                              </select>
                            </div>
                          )}
                          {(meta.kind === 'guitar-tab' || meta.kind === 'ukulele-tab') && (
                            <label className="row chk" title="마디 코드심볼로 프렛 다이어그램을 TAB 위에 표기">
                              <span>코드표</span>
                              <input
                                type="checkbox"
                                checked={!!meta.chordDiagrams}
                                onChange={(e) => setPartMetas((prev) => prev.map((pm, pi2) => (pi2 === i ? { ...pm, chordDiagrams: e.target.checked || undefined } : pm)))}
                              />
                            </label>
                          )}
                          <button type="button" className="close" onClick={() => setTabCfgIdx(null)}>닫기</button>
                        </TabCfgPop>
                      )}
                    </StaffRowBtn>
                  );
                })}
                </StaffListWrap>
              </StaffRowArea>
            </InfoBox>

            {/* 4 — 코드: 아는 곡의 코드 진행을 코드칸에 얹는다(F7.33).
                MusicXML 채보에 코드가 없을 때 일일이 타이핑하지 않게 해준다. */}
            <InfoBox style={{ justifyContent: 'center', gap: 7, padding: '16px 10px 8px' }}>
              <BoxLegend>코드</BoxLegend>
              <ChordPasteBtn
                type="button"
                disabled={activePart !== 0 || measures.length === 0}
                title={
                  activePart !== 0 ? '코드칸은 첫 스태프의 것입니다 — 1번 스태프를 선택하세요'
                  : measures.length === 0 ? '마디가 있어야 코드를 넣을 수 있어요'
                  : '아는 곡의 코드 진행을 골라 코드칸에 채웁니다 (도돌이·볼타 자동 전개)'
                }
                onClick={() => setChordPasteOpen(true)}
              >
                ⎘ 코드 붙여넣기
              </ChordPasteBtn>
              <ChordPasteNote>
                {measures.filter((m) => m.chord).length}/{measures.length} 마디에 코드 있음
              </ChordPasteNote>
            </InfoBox>
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
            {activeMeasureIdx != null && activeMeasureIdx < measures.length && (<>
            <NoteEditBtn
            $active={!!measures[activeMeasureIdx].repeatStart}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, repeatStart: !m.repeatStart || undefined }))}
            >
            <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><line x1="2" y1="1" x2="2" y2="21" stroke="currentColor" strokeWidth="2.5"/><line x1="5.5" y1="1" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/><circle cx="10" cy="14" r="1.7" fill="currentColor"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
            $active={!!measures[activeMeasureIdx].repeatEnd}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, repeatEnd: !m.repeatEnd || undefined }))}
            >
            <svg width="14" height="18" viewBox="0 0 16 22" style={{ display: 'inline-block', verticalAlign: 'middle' }}><circle cx="6" cy="8" r="1.7" fill="currentColor"/><circle cx="6" cy="14" r="1.7" fill="currentColor"/><line x1="10.5" y1="1" x2="10.5" y2="21" stroke="currentColor" strokeWidth="1"/><line x1="14" y1="1" x2="14" y2="21" stroke="currentColor" strokeWidth="2.5"/></svg>
            </NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].volta === 1}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, volta: m.volta === 1 ? undefined : 1 }))}
            >
            <svg width="18" height="14" viewBox="0 0 22 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">1.</text></svg>
            </NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].volta === 2}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, volta: m.volta === 2 ? undefined : 2 }))}
            >
            <svg width="18" height="14" viewBox="0 0 22 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">2.</text></svg>
            </NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].navigation === 'segno'}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, navigation: m.navigation === 'segno' ? undefined : 'segno' }))}
            title="Segno — 세뇨"
            ><Smufl glyph="segno" size={19} /></NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].navigation === 'coda'}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, navigation: m.navigation === 'coda' ? undefined : 'coda' }))}
            title="Coda — 코다"
            ><Smufl glyph="coda" size={19} /></NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].navigation === 'fine'}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, navigation: m.navigation === 'fine' ? undefined : 'fine' }))}
            style={{ fontSize: '0.65rem', fontWeight: 700, fontStyle: 'italic' }}
            >Fine</NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].navigation === 'toCoda'}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, navigation: m.navigation === 'toCoda' ? undefined : 'toCoda' }))}
            title="To Coda"
            ><span style={{ fontFamily: "'Pretendard', sans-serif", fontSize: '0.6rem', fontWeight: 700, fontStyle: 'italic', marginRight: 2 }}>To</span><Smufl glyph="coda" size={15} /></NoteEditBtn>
            <NavSelect
            value={measures[activeMeasureIdx].navigation && ['dc', 'dcAlCoda', 'dcAlFine', 'ds', 'dsAlCoda', 'dsAlFine'].includes(measures[activeMeasureIdx].navigation) ? measures[activeMeasureIdx].navigation : ''}
            onChange={(e) => updateMeasure(activeMeasureIdx, (m) => ({ ...m, navigation: (e.target.value as NavigationMarker) || undefined }))}
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
            $active={!!measures[activeMeasureIdx].bracket}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, bracket: !m.bracket || undefined }))}
            style={{ fontSize: '0.85rem', fontWeight: 300, fontFamily: 'serif' }}
            >(&thinsp;)</NoteEditBtn>
            <NoteEditBtn
            $active={measures[activeMeasureIdx].volta === 3}
            onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, volta: m.volta === 3 ? undefined : 3 }))}
            title="3번 괄호(볼타)"
            >
            <svg width="18" height="14" viewBox="0 0 22 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 1 L1 6 L21 6" stroke="currentColor" strokeWidth="1.5" fill="none"/><text x="4" y="16" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="DM Sans, sans-serif">3.</text></svg>
            </NoteEditBtn>
            <Sep />
            {/* 세로줄 — 겹세로줄·끝세로줄·숨김 (도돌이 표시가 있으면 그쪽 우선). */}
            {([['double', 'barlineDouble', '겹세로줄'], ['end', 'barlineFinal', '끝세로줄']] as const).map(([bl, gl, tt]) => (
              <NoteEditBtn key={bl}
                $active={measures[activeMeasureIdx].barline === bl}
                onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, barline: m.barline === bl ? undefined : bl }))}
                title={tt}
              ><Smufl glyph={gl} size={20} /></NoteEditBtn>
            ))}
            <NoteEditBtn
              $active={measures[activeMeasureIdx].barline === 'none'}
              onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, barline: m.barline === 'none' ? undefined : 'none' }))}
              title="세로줄 숨김"
              style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '-0.02em' }}
            >숨김</NoteEditBtn>
            <NoteEditBtn
              $active={!!measures[activeMeasureIdx].lineBreak}
              onClick={() => updateMeasure(activeMeasureIdx, (m) => ({ ...m, lineBreak: !m.lineBreak || undefined }))}
              title="이 마디 뒤에서 줄바꿈 강제(시스템 브레이크)"
            >↵</NoteEditBtn>
            <NoteEditBtn
              $active={!!measures[activeMeasureIdx].rehearsal}
              onClick={() => {
                const cur = measures[activeMeasureIdx].rehearsal ?? '';
                const v = window.prompt('리허설 마크 (예: A, B1) — 비우면 제거', cur);
                if (v === null) return;
                updateMeasure(activeMeasureIdx, (m) => ({ ...m, rehearsal: v.trim() || undefined }));
              }}
              title="리허설 마크 — 마디 위 네모 상자"
              style={{ fontWeight: 800, fontSize: '0.72rem' }}
            >{measures[activeMeasureIdx].rehearsal ? `[${measures[activeMeasureIdx].rehearsal}]` : '[A]'}</NoteEditBtn>
            <NavSelect
              value={measures[activeMeasureIdx].key ?? ''}
              onChange={(e) => updateMeasure(activeMeasureIdx, (m) => ({ ...m, key: e.target.value || undefined }))}
              title="이 마디부터 조성 변경(조표 교체)"
              style={{ fontSize: '0.65rem' }}
            >
              <option value="">조성변경</option>
              {['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'].map((k2) => (
                <option key={k2} value={k2}>{k2}</option>
              ))}
            </NavSelect>
            </>)}
            <button type="button" onClick={() => { setSelectedMeasure(null); setSelectedNote(null); }}>선택 해제</button>
          </MeasureTabBar>
        )
      ) : toolTab === 'artic' ? (
        /* 아티큘레이션 탭 — 음표 탭과 같은 규격: ToolBar + Section 상자 + 54px 버튼. */
        !selectedNote || !selNoteInfo || selNoteInfo.duration.endsWith('r') ? (
          <TabPlaceholder>음표(머리)를 선택하면 아티큘레이션을 붙일 수 있어요.</TabPlaceholder>
        ) : (() => {
          const sel = selectedNote;
          const info = selNoteInfo;
          const art = (a: ArticulationName) => !!info.articulations?.includes(a);
          const toggleArt = (a: ArticulationName) => updateNote(sel.mi, sel.ni, (n) => {
            const cur = n.articulations ?? [];
            const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
            return { ...n, articulations: next.length ? next : undefined };
          }, sel.staff);
          /* trill 은 독립 토글, 나머지 장식은 서로 배타(하나만). */
          const curOrn = (info.ornaments ?? []).find((o) => o !== 'trill') ?? null;
          const setOrn = (v: Exclude<OrnamentName, 'trill'> | null) => updateNote(sel.mi, sel.ni, (n) => {
            const keepTrill = n.ornaments?.includes('trill') ? ['trill' as const] : [];
            const next = [...keepTrill, ...(v ? [v] : [])];
            return { ...n, ornaments: next.length ? next : undefined };
          }, sel.staff);
          return (
            <ToolBar>
              <LabeledSection>
                <BoxLegend>주법</BoxLegend>
                <DurBtn $active={art('staccato')} onClick={() => toggleArt('staccato')} title="Staccato — 짧게"><Smufl glyph="staccato" size={26} /></DurBtn>
                <DurBtn $active={art('staccatissimo')} onClick={() => toggleArt('staccatissimo')} title="Staccatissimo — 아주 짧게(쐐기)"><Smufl glyph="staccatissimo" size={26} /></DurBtn>
                <DurBtn $active={art('accent')} onClick={() => toggleArt('accent')} title="Accent — 강세"><Smufl glyph="accent" size={26} /></DurBtn>
                <DurBtn $active={art('tenuto')} onClick={() => toggleArt('tenuto')} title="Tenuto — 음가를 충분히"><Smufl glyph="tenuto" size={26} /></DurBtn>
                <DurBtn $active={art('marcato')} onClick={() => toggleArt('marcato')} title="Marcato — 강한 강세"><Smufl glyph="marcato" size={26} /></DurBtn>
                <DurBtn $active={art('detached-legato')} onClick={() => toggleArt('detached-legato')} title="Detached legato — 테누토+스타카토"><Smufl glyph="tenutoStaccato" size={26} /></DurBtn>
                <DurBtn $active={!!info.fermata}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, fermata: !n.fermata || undefined }), sel.staff)}
                  title="Fermata — 늘임표"><Smufl glyph="fermata" size={24} /></DurBtn>
                <DurBtn $active={!!info.ghost}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, ghost: !n.ghost || undefined }), sel.staff)}
                  title="Ghost note — ✕ 노트헤드"><Smufl glyph="noteheadX" size={22} /></DurBtn>
                <DurBtn $active={art('harmonic')} onClick={() => toggleArt('harmonic')} title="Harmonic — 자연 하모닉"><Smufl glyph="harmonic" size={24} /></DurBtn>
                <DurBtn $active={art('lh-pizz')} onClick={() => toggleArt('lh-pizz')} title="Left-hand pizzicato — 왼손 뜯기"><Smufl glyph="lhPizzicato" size={24} /></DurBtn>
                <DurBtn $active={art('snap-pizz')} onClick={() => toggleArt('snap-pizz')} title="Snap(Bartók) pizzicato"><Smufl glyph="snapPizzicato" size={24} /></DurBtn>
                <DurBtn $active={art('up-bow')} onClick={() => toggleArt('up-bow')} title="Up bow — 올려 켜기/업 스트로크"><Smufl glyph="upBow" size={24} /></DurBtn>
                <DurBtn $active={art('down-bow')} onClick={() => toggleArt('down-bow')} title="Down bow — 내려 켜기/다운 스트로크"><Smufl glyph="downBow" size={24} /></DurBtn>
              </LabeledSection>
              <LabeledSection>
                <BoxLegend>장식음</BoxLegend>
                <DurBtn
                  $active={!!info.ornaments?.includes('trill')}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => {
                    const cur = n.ornaments ?? [];
                    const next = cur.includes('trill') ? cur.filter((o) => o !== 'trill') : [...cur, 'trill' as const];
                    return { ...n, ornaments: next.length ? next : undefined };
                  }, sel.staff)}
                  title="Trill — 떨림음 (독립 토글: 다른 장식과 겹칠 수 있음)"
                ><Smufl glyph="trill" size={22} /></DurBtn>
                <DurBtn $active={curOrn === 'mordent'} onClick={() => setOrn(curOrn === 'mordent' ? null : 'mordent')} title="Mordent — 본음-윗음-본음">
                  <svg width="26" height="16" viewBox="0 0 20 12" style={{ display: 'block' }}>
                    <path d="M2 9 L6 3 L10 9 L14 3 L18 9" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" />
                  </svg>
                </DurBtn>
                <DurBtn $active={curOrn === 'inverted-mordent'} onClick={() => setOrn(curOrn === 'inverted-mordent' ? null : 'inverted-mordent')} title="Inverted mordent — 본음-아랫음-본음">
                  <svg width="26" height="20" viewBox="0 0 20 16" style={{ display: 'block' }}>
                    <path d="M2 9 L6 3 L10 9 L14 3 L18 9" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" />
                    <line x1="10" y1="1" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </DurBtn>
                <DurBtn $active={curOrn === 'turn'} onClick={() => setOrn(curOrn === 'turn' ? null : 'turn')} title="Turn — 돌림음">
                  <svg width="26" height="15" viewBox="0 0 20 12" style={{ display: 'block' }}>
                    <path d="M2 8 C2 3.5, 6.5 3.5, 10 6 C13.5 8.5, 18 8.5, 18 4" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
                  </svg>
                </DurBtn>
                <DurBtn $active={curOrn === 'inverted-turn'} onClick={() => setOrn(curOrn === 'inverted-turn' ? null : 'inverted-turn')} title="Inverted turn — 역돌림음">
                  <svg width="26" height="15" viewBox="0 0 20 12" style={{ display: 'block' }}>
                    <path d="M2 4 C2 8.5, 6.5 8.5, 10 6 C13.5 3.5, 18 3.5, 18 8" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
                  </svg>
                </DurBtn>
                <DurBtn $active={curOrn === 'tremolo'} onClick={() => setOrn(curOrn === 'tremolo' ? null : 'tremolo')}
                  title="Tremolo — 반복주(///)" style={{ fontSize: '1.0rem', fontWeight: 700, fontStyle: 'italic' }}>///</DurBtn>
              </LabeledSection>
              <LabeledSection>
                <BoxLegend>연결·꾸밈</BoxLegend>
                <DurBtn
                  $active={!!info.slurStart}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, slurStart: !n.slurStart || undefined }), sel.staff)}
                  title="Slur start (이음줄 시작)" style={{ fontSize: '1.0rem' }}
                >⌒◜</DurBtn>
                <DurBtn
                  $active={!!info.slurStop}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, slurStop: !n.slurStop || undefined }), sel.staff)}
                  title="Slur stop (이음줄 끝)" style={{ fontSize: '1.0rem' }}
                >◞⌒</DurBtn>
                <DurBtn
                  $active={!!info.grace}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => (
                    n.grace
                      ? { ...n, grace: undefined, graceSlash: undefined }
                      : { ...n, grace: true as const, graceSlash: true as const }
                  ), sel.staff)}
                  title="꾸밈음(acciaccatura) 토글"
                >
                  <svg width="20" height="26" viewBox="0 0 18 22" style={{ display: 'block' }}>
                    <ellipse cx="7" cy="16" rx="3.2" ry="2.3" fill="currentColor" transform="rotate(-20 7 16)" />
                    <line x1="9.7" y1="15" x2="9.7" y2="3" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M9.7 3 C 12 4, 13 6.5, 12 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
                    <line x1="4" y1="11" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </DurBtn>
              </LabeledSection>
            </ToolBar>
          );
        })()
      ) : toolTab === 'dyn' ? (
        /* 다이내믹스 탭 — 음표 탭과 같은 규격(Section 상자 + 54px 버튼). */
        !selectedNote || !selNoteInfo || selNoteInfo.duration.endsWith('r') ? (
          <TabPlaceholder>음표(머리)를 선택하면 셈여림을 붙일 수 있어요.</TabPlaceholder>
        ) : (() => {
          const sel = selectedNote;
          const info = selNoteInfo;
          const DYNS: DynamicName[] = [
            'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff',
            'fp', 'pf', 'sf', 'sfz', 'sff', 'sffz', 'sfp', 'rfz', 'rf', 'fz',
          ];
          return (
            <ToolBar>
              <LabeledSection>
                <BoxLegend>셈여림</BoxLegend>
                {DYNS.map((d) => (
                  <DynBtn key={d} $active={info.dynamics === d}
                    onClick={() => updateNote(sel.mi, sel.ni, (n) => (
                      { ...n, dynamics: n.dynamics === d ? undefined : d }
                    ), sel.staff)}
                    title={`Dynamics — ${d}`}
                  >{dynamicToSmufl(d)}</DynBtn>
                ))}
              </LabeledSection>
              <LabeledSection>
                <BoxLegend>헤어핀</BoxLegend>
                <DurBtn
                  $active={info.hairpinStart === 'cresc'}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => (
                    { ...n, hairpinStart: n.hairpinStart === 'cresc' ? undefined : 'cresc' }
                  ), sel.staff)}
                  title="Crescendo 시작 (<) — 끝낼 음표에 ⇥ 를 찍어야 그려진다"
                >
                  <svg width="26" height="14" viewBox="0 0 26 14" style={{ display: 'block' }}>
                    <path d="M24 1 L2 7 L24 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
                  </svg>
                </DurBtn>
                <DurBtn
                  $active={info.hairpinStart === 'dim'}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => (
                    { ...n, hairpinStart: n.hairpinStart === 'dim' ? undefined : 'dim' }
                  ), sel.staff)}
                  title="Decrescendo 시작 (>) — 끝낼 음표에 ⇥ 를 찍어야 그려진다"
                >
                  <svg width="26" height="14" viewBox="0 0 26 14" style={{ display: 'block' }}>
                    <path d="M2 1 L24 7 L2 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
                  </svg>
                </DurBtn>
                <DurBtn
                  $active={!!info.hairpinStop}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, hairpinStop: !n.hairpinStop || undefined }), sel.staff)}
                  title="헤어핀 끝 — 시작 음표부터 이 음표까지 <·> 를 그린다"
                  style={{ fontSize: '1.1rem', fontWeight: 700 }}
                >⇥</DurBtn>
              </LabeledSection>
            </ToolBar>
          );
        })()
      ) : toolTab !== 'note' ? (
        <TabPlaceholder>
          {TOOL_TABS.find((t) => t.id === toolTab)?.label} 탭 — 준비 중입니다.
        </TabPlaceholder>
      ) : (
      <ToolBar>
        <DurGroup>
          <BoxLegend>음길이</BoxLegend>
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
          <BoxLegend>점·연음·임시표</BoxLegend>
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
            <DurBtn $active={accMode === '#'} onClick={() => setAccMode('#')} title="Sharp mode"><Smufl glyph="sharp" size={24} /></DurBtn>
            <DurBtn $active={accMode === 'b'} onClick={() => setAccMode('b')} title="Flat mode"><Smufl glyph="flat" size={24} /></DurBtn>
          </ModCol>
          <ModCol>
            {/* 겹임시표 입력 모드 — 흰건반을 누르면 그 음을 겹샤프/겹플랫 표기로
                리스펠(D→C𝄪, C→D𝄫). 대상 글자가 없으면 단일 ♯/♭ 폴백. */}
            <DurBtn $active={accMode === '##'} onClick={() => setAccMode('##')} title="Double-sharp mode — D 를 누르면 겹샤프 표기로 입력"><Smufl glyph="doubleSharp" size={22} /></DurBtn>
            <DurBtn $active={accMode === 'bb'} onClick={() => setAccMode('bb')} title="Double-flat mode — C 를 누르면 겹플랫 표기로 입력"><Smufl glyph="doubleFlat" size={22} /></DurBtn>
          </ModCol>
          <ModCol>
            {/* 보이스 — 2를 켜면 입력이 선택(없으면 마지막) 마디의 두 번째 성부로
                들어간다(기둥 아래 방향). 마디가 하나도 없으면 보이스1 흐름 유지. */}
            <DurBtn $active={voiceMode === 1} onClick={() => setVoiceMode(1)} title="보이스 1 — 기본 성부(기둥 위)">
              <VoiceGlyph><Smufl glyph="noteQuarterUp" size={17} /><b>1</b></VoiceGlyph>
            </DurBtn>
            <DurBtn $active={voiceMode === 2} onClick={() => setVoiceMode(2)} title="보이스 2 — 같은 보표의 둘째 성부(기둥 아래). 선택한(없으면 마지막) 마디에 쌓인다">
              <VoiceGlyph><Smufl glyph="noteQuarterUp" size={17} /><b>2</b></VoiceGlyph>
            </DurBtn>
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
                      <MarkGlyph><Smufl glyph="ottavaAlta" size={16} /></MarkGlyph>
                      <MarkLabel>옥타브 위</MarkLabel>
                    </MarkBtn>
                    <MarkBtn
                      $active={ottavaMode === '8vb'}
                      onClick={() => handleOttavaToggle('8vb')}
                      title="한 번 눌러 시작, 마지막 음에서 다시 눌러 닫기"
                    >
                      <MarkGlyph><Smufl glyph="ottavaAlta" size={16} /></MarkGlyph>
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
        <GoldGroup $mode={editMode} style={{ position: 'relative' }}>
          {/* 선택이 없어도 섹션은 그대로 보여준다 — 편집 바는 비활성(회색) 상태. */}
          <>
          {/* 선택 해제 — 음표뿐 아니라 마디 활성화에도 나온다(Esc 와 같은 동작). */}
          {editMode !== 'none' && (
            <DeselectBtn
              type="button"
              title={editMode === 'note' ? '음표 선택 해제 (Esc)' : '마디 선택 해제 (Esc)'}
              aria-label="선택 해제"
              onClick={() => {
                setSelectedNote(null);
                setExtraSel([]);
                setSelectedMeasure(null);
                setSelectedBassMeasure(null);
                setInsertPos(null);
              }}
            >×</DeselectBtn>
          )}
          {/* 섹션 안 좌측 상단에 고정 — 내용이 길어져도 테두리에 걸치지 않는다. */}
          <SectionStatusBar $mode={editMode}>
          <SectionStatus $mode={editMode}>
            <ModeTag $mode={editMode}>
              {editMode === 'note' ? '음표 활성화' : editMode === 'measure' ? '마디 활성화' : '선택 없음'}
            </ModeTag>
            {editMode === 'none' ? (
              /* 선택이 없으면 '현재 위치'가 없다 — 전체 규모만 담백하게. */
              <>
                <StatusItem $plain><b>{allMeasures.length}</b> bars</StatusItem>
                <StatusDot />
                <StatusItem $plain><b>{totalBeats}</b> beats</StatusItem>
              </>
            ) : (
              <>
                <StatusItem><b>{Math.min(measures.length + 1, Math.max(allMeasures.length, 1))}</b>/{allMeasures.length} bars</StatusItem>
                <StatusDot />
                <StatusItem $warn={curBeats > barBeats}><b>{beatsInDenUnits(curBeats)}</b>/{tsNum} beats</StatusItem>
              </>
            )}
          </SectionStatus>
          </SectionStatusBar>
        {selectedNote?.staff !== 'bass' && (() => {
          /* 선택이 없어도 버튼 배치는 보여준다(디자인) — 값은 더미, 조작은 막는다. */
          const ghost = !(selectedNote && selNoteInfo);
          const sel = selectedNote ?? GHOST_SEL;
          const info = selNoteInfo ?? GHOST_NOTE;
          const isRest = info.duration.endsWith('r');
          return (
          <GhostWrap $ghost={ghost} aria-hidden={ghost || undefined}>
          <SectionedEditBar>
              <EditWrap>
                {/* 1그룹만 2행 그리드(위→아래로 채우고 열 방향으로 흐름).
                    Tie 가 항상 좌상단 첫 칸이어야 하므로, 조건부인 '연음(3+)'
                    은 자리를 잡아두지 않고 필요할 때만 맨 뒤에 붙인다. */}
                <EditGrid>
                {/* ⚠ 배치 불변 원칙 — 이 판의 버튼은 어떤 선택 상태에서도 **사라지지
                    않는다**. 조건 미충족(쉼표 선택, 다음 음 없음 등)이면 자리를
                    지킨 채 비활성으로만 바뀐다. 숨기면 그리드가 재배열되며
                    "버튼이 어디 갔지"가 된다(Divide·Gliss 에서 실제 발생). */}
                {(() => {
                  /* Gliss 는 다음 실음이 있어야 성립 — 마지막 음·다음이 쉼표면 비활성. */
                  let glissOk = false;
                  if (!isRest) {
                    const flat: { mi: number; ni: number; note: NoteInfo }[] = [];
                    for (let mi = 0; mi < allMeasures.length; mi++)
                      for (let ni = 0; ni < allMeasures[mi].notes.length; ni++)
                        flat.push({ mi, ni, note: allMeasures[mi].notes[ni] });
                    const idx = flat.findIndex((f) => f.mi === sel.mi && f.ni === sel.ni);
                    const next = flat[idx + 1];
                    glissOk = !!next && !next.note.duration.endsWith('r');
                  }
                  return (
                    <>
                      <NoteChipBtn
                        $active={!!info.tie}
                        disabled={isRest}
                        onClick={() => { if (!isRest) updateNote(sel.mi, sel.ni, (n) => ({ ...n, tie: !n.tie || undefined })); }}
                        title={isRest ? '쉼표에는 붙임줄을 걸 수 없습니다' : '붙임줄 — 오른쪽 음과 연결'}
                      >
                        <i>
                          <svg width="22" height="13" viewBox="0 0 18 14">
                            <path d="M2 4 Q9 14 16 4" stroke="currentColor" strokeWidth="1.7" fill="none" />
                          </svg>
                        </i>
                        <em>Tie</em>
                      </NoteChipBtn>
                      <NoteChipBtn
                        $active={!!info.gliss}
                        disabled={!glissOk}
                        onClick={() => { if (glissOk) updateNote(sel.mi, sel.ni, (n) => ({ ...n, gliss: !n.gliss || undefined })); }}
                        title={glissOk ? '글리산도 — 다음 음까지 미끄러짐' : '글리산도는 바로 다음에 실음이 있어야 합니다'}
                      >
                        <i>
                          <svg width="22" height="13" viewBox="0 0 22 14">
                            <path d="M2 12 Q7 8 12 6 Q17 4 20 2" stroke="currentColor" strokeWidth="1.7" fill="none" />
                          </svg>
                        </i>
                        <em>Gliss</em>
                      </NoteChipBtn>
                      <NoteChipBtn
                        $active={!!info.scoop}
                        disabled={isRest}
                        onClick={() => { if (!isRest) updateNote(sel.mi, sel.ni, (n) => ({ ...n, scoop: !n.scoop || undefined })); }}
                        title={isRest ? '쉼표에는 스쿱을 붙일 수 없습니다' : '스쿱 — 음표 앞에서 아래→위로 끌어올려 진입'}
                      >
                        <i><Smufl glyph="scoop" size={20} /></i>
                        <em>Scoop</em>
                      </NoteChipBtn>
                      <NoteChipBtn
                        $active={!!info.fall}
                        disabled={isRest}
                        onClick={() => { if (!isRest) updateNote(sel.mi, sel.ni, (n) => ({ ...n, fall: !n.fall || undefined })); }}
                        title={isRest ? '쉼표에는 폴을 붙일 수 없습니다' : '폴 — 음표 뒤에서 아래로 떨어지는 곡선'}
                      >
                        <i><Smufl glyph="fall" size={20} /></i>
                        <em>Fall</em>
                      </NoteChipBtn>
                    </>
                  );
                })()}
                <NoteChipBtn
                  $active={!!info.stem}
                  disabled={isRest}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => {
                    // 자동 → 위 → 아래 → 자동 순환 (MuseScore 의 X 플립 대응).
                    const next = !n.stem ? 'up' as const : n.stem === 'up' ? 'down' as const : undefined;
                    if (!next) { const { stem, ...rest } = n; void stem; return rest; }
                    return { ...n, stem: next };
                  })}
                  title={isRest ? '쉼표에는 기둥이 없습니다'
                    : `기둥 방향 — 현재 ${info.stem === 'up' ? '위 고정' : info.stem === 'down' ? '아래 고정' : '자동'} (누르면 자동→위→아래 순환)`}
                >
                  <i><Smufl size={13} glyph={info.stem === 'down' ? 'arrowDown' : 'arrowUp'} /></i>
                  <em>{info.stem === 'up' ? '기둥↑' : info.stem === 'down' ? '기둥↓' : '기둥'}</em>
                </NoteChipBtn>
                {/* 옥타브 브래킷 — 4종(8va·8vb·15ma·15mb) 시작 + 공용 끝.
                    같은 종류를 다시 누르면 해제, 다른 종류를 누르면 교체. */}
                {(['8va', '8vb', '15ma', '15mb'] as const).map((ok2) => (
                  <NoteChipBtn
                    key={ok2}
                    $active={info.ottavaStart === ok2}
                    onClick={() => updateNote(sel.mi, sel.ni, (n) => {
                      if (n.ottavaStart === ok2) {
                        const next = { ...n };
                        delete next.ottavaStart;
                        return next;
                      }
                      return { ...n, ottavaStart: ok2 };
                    })}
                    title={
                      ok2 === '8va' ? '8va 시작 — 한 옥타브 위 소리'
                      : ok2 === '8vb' ? '8vb 시작 — 한 옥타브 아래 소리'
                      : ok2 === '15ma' ? '15ma 시작 — 두 옥타브 위 소리'
                      : '15mb 시작 — 두 옥타브 아래 소리'
                    }
                  >
                    <i><Smufl glyph={ok2.startsWith('15') ? 'quindicesimaAlta' : 'ottavaAlta'} size={15} /></i>
                    <em>{ok2}</em>
                  </NoteChipBtn>
                ))}
                <NoteChipBtn
                  $active={!!info.ottavaEnd}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, ottavaEnd: !n.ottavaEnd || undefined }))}
                  title="옥타브 브래킷 끝 — 이 음표에서 종료"
                >
                  <i style={{ fontSize: '1.05rem', fontWeight: 700 }}>⌐</i>
                  <em>브래킷끝</em>
                </NoteChipBtn>
                </EditGrid>

                <EditSep />

                <EditRow>


                {(() => {
                  /* 빔 분리는 빔이 그려지는 8·16분음표에만 성립한다. 예전엔 그 외
                   * 음표에서 버튼을 통째로 감춰 Chord 왼쪽이 비어 보였다 —
                   * 자리는 지키고 비활성으로만 알린다(레이아웃 흔들림 방지). */
                  const base = info.duration.replace(/r$/, '');
                  const beamable = !isRest && (base === '8' || base === '16');
                  return (
                    <NoteChipBtn
                      $active={!!info.beamBreak}
                      disabled={!beamable}
                      onClick={() => { if (beamable) updateNote(sel.mi, sel.ni, (n) => ({ ...n, beamBreak: !n.beamBreak || undefined })); }}
                      title={beamable ? '빔 분리 — 이 음표 뒤에서 빔을 끊는다' : '빔 분리는 8분·16분음표에만 적용됩니다'}
                    >
                      <i>
                        <DivideGlyph>
                          <Smufl glyph="note8thUp" size={15} />
                          <span className="cut" />
                          <Smufl glyph="note8thUp" size={15} />
                        </DivideGlyph>
                      </i>
                      <em>Divide</em>
                    </NoteChipBtn>
                  );
                })()}
                <NoteChipBtn
                  $active={noteChordEditing}
                  onClick={() => {
                    if (noteChordEditing) {
                      const norm = normalizeChord(noteChordValue);
                      setChordAtNote(sel.mi, sel.ni, norm);
                      setNoteChordEditing(false);
                    } else {
                      setNoteChordValue(info?.chord ?? '');
                      setNoteChordEditing(true);
                      setTimeout(() => noteChordInputRef.current?.focus(), 0);
                    }
                  }}
                  title={info?.chord ? `이 음표의 코드: ${info.chord}` : '이 음표 위치에 코드 입력'}
                >
                  <i style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                    {info?.chord ? info.chord : <>C<Smufl glyph="chordSymbolMaj" size={9} /></>}
                  </i>
                  <em>Chord</em>
                </NoteChipBtn>
                <NoteChipBtn
                  $active={!!info.textAbove}
                  onClick={() => {
                    const v = window.prompt('음표 위 텍스트 (pizz. / arco / mute / legato …) — 비우면 제거', info.textAbove ?? '');
                    if (v === null) return;
                    updateNote(sel.mi, sel.ni, (n) => {
                      const t = v.trim();
                      if (!t) { const { textAbove, ...rest } = n; void textAbove; return rest; }
                      return { ...n, textAbove: t };
                    });
                  }}
                  title={info.textAbove ? `텍스트: ${info.textAbove}` : '연주 지시 텍스트 붙이기'}
                >
                  <i style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: '0.8rem' }}>{info.textAbove ? info.textAbove.slice(0, 5) : 'expr'}</i>
                  <em>텍스트</em>
                </NoteChipBtn>
                <NoteChipBtn
                  $active={!!info.pedalStart}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, pedalStart: !n.pedalStart || undefined }))}
                  title="서스테인 페달 시작(Ped.) — 끝낼 음표에 ✱ 를 찍으면 그려진다"
                >
                  <i><Smufl glyph="pedalPed" size={17} /></i>
                  <em>페달</em>
                </NoteChipBtn>
                <NoteChipBtn
                  $active={!!info.pedalEnd}
                  onClick={() => updateNote(sel.mi, sel.ni, (n) => ({ ...n, pedalEnd: !n.pedalEnd || undefined }))}
                  title="서스테인 페달 끝(✱)"
                >
                  <i><Smufl glyph="pedalUp" size={16} /></i>
                  <em>페달끝</em>
                </NoteChipBtn>
                </EditRow>

                <EditSep />

                <EditRow>


                {(['b', '#', 'n', '##', 'bb'] as const).map((g) => (
                  <NoteChipBtn
                    key={g}
                    $active={info.accidentals?.[0] === g}
                    onClick={() => {
                      updateNote(sel.mi, sel.ni, (n) => {
                        const cur = n.accidentals?.[0];
                        if (cur === g) {
                          const { ...rest } = n;
                          delete rest.accidentals;
                          return rest;
                        }
                        return { ...n, accidentals: { 0: g } };
                      });
                    }}
                    title={g === 'b' ? '플랫' : g === '#' ? '샤프' : g === 'n' ? '내추럴' : g === '##' ? '겹샤프' : '겹플랫'}
                  >
                    <i>
                      <Smufl size={19} dy={g === '##' ? 0 : 1}
                        glyph={g === 'b' ? 'flat' : g === '#' ? 'sharp' : g === 'n' ? 'natural' : g === '##' ? 'doubleSharp' : 'doubleFlat'} />
                    </i>
                    <em>{g === 'b' ? 'Flat' : g === '#' ? 'Sharp' : g === 'n' ? 'Nat' : g === '##' ? '𝄪2' : '𝄫2'}</em>
                  </NoteChipBtn>
                ))}
                {/* ── TAB 수동 운지 — 활성 파트가 TAB일 때만 나타나는 그룹.
                    현을 고르면 프렛은 음정에서 자동 계산되므로 표기·소리가
                    어긋날 수 없다. '자동' = 지정 해제(엔진 운지로 복귀). */}
                {isTabKind(partMetas[activePart]?.kind ?? 'treble') && !isRest && (() => {
                  const tKind = partMetas[activePart].kind;
                  const tuning = tabTuningFor(tKind, partMetas[activePart]);
                  const isChord = info.keys.length > 1;
                  let midi: number | null = null;
                  if (!isChord) {
                    try { midi = resolveSheetMidis(allMeasures, sheetKey, explicitAcc ? 'explicit' : 'score')[sel.mi]?.[sel.ni]?.[0] ?? null; } catch { midi = null; }
                  }
                  const forced = info.tabStrings?.[0];
                  return (
                    <>
                      <EditSep />
                      <EditRow>
                        {tuning.map((open, si) => {
                          const strNo = si + 1;
                          const fret = midi !== null ? midi - open : null;
                          const playable = !isChord && fret !== null && fret >= 0 && fret <= 17;
                          return (
                            <NoteChipBtn
                              key={strNo}
                              $active={forced === strNo}
                              disabled={!playable}
                              onClick={() => {
                                if (!playable) return;
                                updateNote(sel.mi, sel.ni, (n) => (
                                  n.tabStrings?.[0] === strNo
                                    ? (() => { const { tabStrings, ...rest } = n; void tabStrings; return rest; })()
                                    : { ...n, tabStrings: { 0: strNo } }
                                ), sel.staff);
                              }}
                              title={isChord ? '화음은 자동 운지만 지원합니다'
                                : playable ? `${strNo}번줄 ${fret}프렛에 강제 배치 (다시 누르면 해제)`
                                : '이 현에서는 이 음이 나지 않습니다'}
                            >
                              <i style={{ fontSize: '0.92rem', fontWeight: 700 }}>{strNo}</i>
                              <em>{playable ? `${fret}프렛` : '현'}</em>
                            </NoteChipBtn>
                          );
                        })}
                        <NoteChipBtn
                          $active={forced === undefined}
                          disabled={isChord}
                          onClick={() => updateNote(sel.mi, sel.ni, (n) => {
                            const { tabStrings, ...rest } = n; void tabStrings; return rest;
                          }, sel.staff)}
                          title="자동 운지(엔진 배치)로 복귀"
                        >
                          <i style={{ fontSize: '0.8rem', fontWeight: 700 }}>A</i>
                          <em>자동</em>
                        </NoteChipBtn>
                      </EditRow>
                    </>
                  );
                })()}
                {/* N연음 묶기 — Ctrl/Cmd+클릭으로 3개 이상 골랐을 때만 나타난다. */}
                {multiSel.length >= 3 && (
                  <NoteChipBtn
                    $active={selectionTupleted}
                    disabled={!tupletGroupable}
                    onClick={applyTupletToSelection}
                    title={tupletGroupable
                      ? `선택한 ${multiSel.length}개를 ${multiSel.length}연음으로 ${selectionTupleted ? '해제' : '묶기'}`
                      : '한 마디 안에서 연속된 음표만 묶을 수 있다'}
                  >
                    <i style={{ fontSize: '1.05rem', fontWeight: 700 }}>{multiSel.length}</i>
                    <em>연음</em>
                  </NoteChipBtn>
                )}
                </EditRow>
              </EditWrap>
          </SectionedEditBar>
          </GhostWrap>
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
          </NoteEditBar>
        )}
          </>
        </GoldGroup>



      </ToolBar>
      )}


      <PianoArea>
        {/* scale 은 상한 — 좁은 화면에서는 fitToWidth 가 컨테이너 폭에 맞춰
            자동으로 낮춘다(1,930px 고정이라 창이 좁으면 잘리던 문제). */}
        {partMetas[activePart]?.kind === 'drum' ? (
          /* 드럼 파트 — 건반 대신 킷 그림. raw 입력이라 조성·임시표 모드의
           * 영향을 받지 않고 GM 퍼커션 키가 그대로 저장된다. */
          <DrumKitPad onHit={(d) => handleNotePress({ vexKey: d.dataKey, midi: d.gm }, { raw: true })} />
        ) : (
          <PianoKeyboard onNotePress={handleNotePress} mute scale={1.28} fitToWidth />
        )}
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
            if (pos.staff === 'bass' || pos.part) return null; // 코드는 첫 파트 트레블 마디에만
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
            /* 코드칸은 보표 위 기본 높이에 두되, 기둥·빔이 그 높이까지 뻗어 올라오면
             * 그 위로 밀어 올린다 — 절대 겹치지 않게. 기준은 **그 줄 전체**에서
             * 가장 높이 올라간 마디라, 한 줄 안의 코드칸 높이는 항상 같다. */
            /* 렌더러가 계산해 MeasurePos 에 심어 준 값 — 하이라이트와 동일 좌표. */
            const chordTop = pos.chordTop;
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
                        measureIdx={pos.idx}
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
                  measureIdx={pos.idx}
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
                  measureIdx={pos.idx}
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
            const pos = measurePositions.find((p) => p.idx === selectedMeasure && !p.staff && (p.part ?? 0) === activePart);
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
                    height: ((grand ? pos.bassDy + 106 : 110)) * SHEET_SCALE,
                  }}
                />
                <MeasureEditBarBox
                  onMouseEnter={() => setMeasureHover(true)}
                  onMouseLeave={() => setMeasureHover(false)}
                  style={{
                    left: Math.max(4, pos.x * SHEET_SCALE),
                    // 하이라이트(노란 배경) 아래끝 바로 밑에 붙인다.
                    top: (pos.y + (grand ? pos.bassDy + 68 : 70)) * SHEET_SCALE,
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
            const pos = measurePositions.find((p) => p.idx === selectedBassMeasure && p.staff === 'bass' && (p.part ?? 0) === activePart);
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
            const mpos = measurePositions.find((p) => p.idx === np.mi && !p.staff && (p.part ?? 0) === activePart);
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
            const mpos = measurePositions.find((p) => p.idx === selectedNote.mi && !p.staff && (p.part ?? 0) === activePart);
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

/* ─── 다중 스태프: Staff 박스 목록 · 종류 모달 · 드럼 팔레트 ────────────── */

/* 스태프 행은 내용만큼만 넓은 "칩"이다 — 예전엔 열 전체로 늘어나 ⇆↑↓✕ 버튼이
 * 오른쪽 끝까지 밀려나며 보표 상자 가로를 다 차지했다. align-items:flex-start 로
 * 각 행을 내용 폭에 맞춘다(세로 순서는 그대로 — ↑↓ 로 스태프 순서를 바꾼다). */
/* [＋ 스태프 추가(세로 풀높이)] | [칩 목록] 가로 배치. */
const StaffRowArea = styled.div`
  flex: 1; min-height: 0;
  display: flex; align-items: stretch; gap: 7px;
`;

const StaffListWrap = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
`;

const StaffRowBtn = styled.div<{ $on: boolean }>`
  position: relative;   /* TAB 설정 팝오버(TabCfgPop) 기준 */
  display: flex; align-items: center; gap: 6px;
  /* 모든 행 동일 규격 — 폭은 섹션을 채우지 않고 고정(짧게), 높이 33px.
   * 보표 박스가 아무리 넓어도 행은 이 폭을 유지한다.
   * 폭은 가장 붐비는 행(TAB + '오선' 체크박스)의 실측 intrinsic 폭 351px 에
   * 여유 9px 을 더한 값이다. 이보다 좁으면 그 행만 내용이 넘쳐 margin-left:auto
   * 가 죽고 ⇆↑↓✕ 가 다른 행보다 오른쪽으로 밀린다(344px 일 때 8px 어긋났다). */
  width: 360px; max-width: 100%; height: 33px; flex: none; box-sizing: border-box;
  padding: 0 6px; border-radius: 8px; cursor: pointer; user-select: none;
  border: 1.4px solid ${({ $on }) => ($on ? '#b8960a' : '#e2e2e6')};
  background: ${({ $on }) => ($on ? 'rgba(184,150,10,0.08)' : '#fff')};
  &:hover { border-color: ${({ $on }) => ($on ? '#b8960a' : '#c8c8ce')}; }
  /* 번호+이름 묶음 필 — 고정 폭이라 뒤 컨트롤 시작점이 전 행에서 같다. */
  .id {
    display: inline-flex; align-items: center; gap: 5px;
    width: 148px; flex: none; overflow: hidden;
    padding: 2px 7px 2px 3px; border-radius: 999px;
    border: 1px solid ${({ $on }) => ($on ? 'rgba(184,150,10,0.55)' : '#e6e6ea')};
    background: ${({ $on }) => ($on ? 'rgba(184,150,10,0.10)' : '#f6f6f8')};
  }
  .ord {
    width: 16px; height: 16px; border-radius: 50%; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.62rem; font-weight: 800;
    background: ${({ $on }) => ($on ? '#b8960a' : '#d6d6dc')};
    color: ${({ $on }) => ($on ? '#fff' : '#666')};
  }
  .name {
    font-size: 0.73rem; font-weight: 700; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; min-width: 0;
  }
  /* 악기 슬롯 — 고를 수 있는 악기(SessionPicker)든 고정 아이콘(피아노·드럼킷)이든
   * **같은 상자·같은 아이콘 크기**. 종전엔 선택기 트리거가 36×36, 고정 아이콘이
   * 20×20 이라 행마다 아이콘 크기도 뒤 버튼 시작점도 어긋났다(행 높이 33px 도 넘겼다). */
  .inst, .fixedinst {
    width: 28px; height: 25px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
  }
  /* 선택기 내부 트리거를 슬롯에 맞춘다 — 클래스 하나짜리 원본 스타일보다 우선한다. */
  .inst > button { width: 28px; height: 25px; border-radius: 7px; }
  .inst img, .fixedinst img { width: 22px; height: 22px; display: block; }
  .opt {
    display: inline-flex; align-items: center; gap: 3px; flex: none;
    white-space: nowrap;   /* 폭이 빠듯해도 '오선' 이 두 줄로 접히지 않게 */
    font-size: 0.68rem; color: ${({ theme }) => theme.colors.textSecondary}; cursor: pointer;
    input { width: 13px; height: 13px; accent-color: #b8960a; cursor: pointer; }
  }
  /* 행 폭이 고정이라 auto 여백이면 ⇆↑↓✕ 가 전 행에서 정확히 같은 x 에 온다. */
  .btns {
    margin-left: auto; display: inline-flex; gap: 2px;
    button {
      border: none; background: transparent; cursor: pointer; border-radius: 5px;
      width: 21px; height: 21px; font-size: 0.72rem; color: ${({ theme }) => theme.colors.textSecondary}; line-height: 1;
      &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.surfaceSunken}; color: ${({ theme }) => theme.colors.textPrimary}; }
      &:disabled { opacity: 0.3; cursor: default; }
    }
  }
`;

/* 섹션 왼쪽에서 세로 전체 높이를 차지하는 큰 추가 버튼. */
/* 코드 붙여넣기 버튼 — 정보 탭 '코드' 박스. 툴바 다른 액션 버튼과 같은 규격. */
const ChordPasteBtn = styled.button`
  padding: 7px 12px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  &:hover:not(:disabled) { border-color: #ef6c00; color: #ef6c00; }
  &:disabled { opacity: 0.45; cursor: default; }
`;
const ChordPasteNote = styled.span`
  font-size: 0.7rem;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const AddStaffBtn = styled.button`
  align-self: stretch;
  flex: none;
  width: 64px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px;
  border: 1.4px dashed ${({ theme }) => theme.colors.border}; background: transparent; border-radius: 10px;
  font-size: 1.05rem; font-weight: 800; color: ${({ theme }) => theme.colors.textSecondary}; cursor: pointer;
  line-height: 1;
  em { font-style: normal; font-size: 0.66rem; font-weight: 700; line-height: 1.25; text-align: center; }
  &:hover:not(:disabled) { border-color: #b8960a; color: #b8960a; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const StaffModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 260;
  background: rgba(20, 20, 24, 0.45);
  display: flex; align-items: center; justify-content: center;
`;

const StaffModalCard = styled.div`
  width: min(680px, calc(100vw - 40px)); max-height: calc(100vh - 80px);
  overflow-y: auto; background: ${({ theme }) => theme.colors.surface}; border-radius: 16px;
  padding: 22px 24px 18px; box-shadow: 0 18px 50px rgba(0,0,0,0.25);
  h2 { margin: 0 0 4px; font-size: 1.05rem; font-weight: 800; }
  .sub { margin: 0 0 14px; font-size: 0.78rem; color: ${({ theme }) => theme.colors.textSecondary}; line-height: 1.5; }
`;

const StaffKindGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px;
`;

const StaffKindCard = styled.button<{ $on?: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  text-align: left; cursor: pointer; padding: 12px 13px;
  border: 1.6px solid ${({ $on }) => ($on ? '#b8960a' : '#e2e2e6')};
  background: ${({ $on }) => ($on ? 'rgba(184,150,10,0.07)' : '#fff')};
  border-radius: 12px; transition: border-color .13s, box-shadow .13s;
  &:hover { border-color: #b8960a; box-shadow: 0 2px 12px rgba(184,150,10,0.16); }
  svg { background: ${({ theme }) => theme.colors.surfaceSunken}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 8px; width: 100%; height: auto; }
  b { font-size: 0.85rem; font-weight: 800; color: ${({ theme }) => theme.colors.textPrimary}; }
  span { font-size: 0.71rem; color: ${({ theme }) => theme.colors.textSecondary}; line-height: 1.45; }
`;

const StaffModalClose = styled.button`
  margin-top: 14px; width: 100%; padding: 9px 0; border: none; border-radius: 9px;
  background: ${({ theme }) => theme.colors.surfaceSunken}; font-weight: 700; font-size: 0.82rem; cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
`;

/* 드럼 킷 입력은 DrumKitPad(킷 그림)가 담당한다 — 건반 자리를 대신한다. */

/* TAB 설정 팝오버 — 보표 행의 ⚙ 로 연다(카포·튜닝·코드 다이어그램). */
const TabCfgPop = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 168px;
  padding: 9px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  cursor: default;

  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 0.72rem; color: ${({ theme }) => theme.colors.textSecondary};
    select {
      flex: 1; min-width: 0; font-size: 0.7rem; padding: 2px 3px;
      border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 6px; background: ${({ theme }) => theme.colors.surface}; cursor: pointer;
    }
    input { width: 14px; height: 14px; accent-color: #b8960a; cursor: pointer; }
  }
  .chk { cursor: pointer; }
  .close {
    margin-top: 2px; padding: 4px 0; border: none; border-radius: 7px;
    background: ${({ theme }) => theme.colors.surfaceSunken}; font-size: 0.7rem; font-weight: 700; cursor: pointer;
    &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
  }
`;

/* 정보 탭 박자표 선택 — Key 표시와 같은 폭 규격의 컴팩트 셀렉트. */
const TimeSigSelect = styled.select`
  width: 100%;
  padding: 5px 8px;
  font-size: 0.82rem;
  font-weight: 700;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.surface};
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  &:hover { border-color: ${({ theme }) => theme.colors.border}; }
`;

/* 보이스 토글 — SMuFL 4분음표 + 성부 번호(입력 툴바 관례). */
const VoiceGlyph = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 1px;
  b { font-size: 0.72rem; font-weight: 800; line-height: 1; }
`;

/* 빔 분리 — 8분음표 둘 사이를 점선으로 끊어 의미를 그대로 보여준다. */
const DivideGlyph = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 1px;
  .cut {
    width: 0;
    height: 13px;
    border-left: 1.3px dashed currentColor;
    opacity: 0.75;
    margin: 0 1px;
  }
`;
