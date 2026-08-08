import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useCallback } from 'react';
import { ghostHead } from '../../lib/note/ghostNote';
import styled from 'styled-components';
// vexflow는 ~1 MB이므로 dynamic import로 lazy-load.
// 렌더링 useEffect 내부에서 await import('vexflow') 로 사용.
import type {
  Renderer as RendererT,
  Stave as StaveT,
  StaveNote as StaveNoteT,
  Voice as VoiceT,
  Formatter as FormatterT,
  Beam as BeamT,
  Accidental as AccidentalT,
  Dot as DotT,
  BarlineType as BarlineTypeT,
  StaveTie as StaveTieT,
  VoltaType as VoltaTypeT,
  Repetition as RepetitionT,
  Articulation as ArticulationT,
  Ornament as OrnamentT,
  Annotation as AnnotationT,
  AnnotationVerticalJustify as AnnotationVerticalJustifyT,
  GraceNote as GraceNoteT,
  GraceNoteGroup as GraceNoteGroupT,
  Curve as CurveT,
  TextBracket as TextBracketT,
  TextBracketPosition as TextBracketPositionT,
  Tremolo as TremoloT,
  StaveHairpin as StaveHairpinT,
  StaveConnector as StaveConnectorT,
  TabStave as TabStaveT,
  TabNote as TabNoteT,
  GhostNote as GhostNoteT,
  TabSlide as TabSlideT,
  TabTie as TabTieT,
  PedalMarking as PedalMarkingT,
} from 'vexflow';
// Type aliases — `StaveNote` etc. used as type annotations in the code below.
type Renderer = RendererT;
type Stave = StaveT;
type StaveNote = StaveNoteT;
type Voice = VoiceT;
type Formatter = FormatterT;
type Beam = BeamT;
type Accidental = AccidentalT;
type Dot = DotT;
type BarlineType = BarlineTypeT;
type StaveTie = StaveTieT;
type VoltaType = VoltaTypeT;
type Repetition = RepetitionT;
type Articulation = ArticulationT;
type Ornament = OrnamentT;
type Annotation = AnnotationT;
type AnnotationVerticalJustify = AnnotationVerticalJustifyT;
type GraceNote = GraceNoteT;
type GraceNoteGroup = GraceNoteGroupT;
type Curve = CurveT;
type TextBracket = TextBracketT;
type TextBracketPosition = TextBracketPositionT;
type Tremolo = TremoloT;
type StaveHairpin = StaveHairpinT;
// runtime bindings are populated lazily inside the rendering useEffect.
let Renderer: typeof RendererT;
let Stave: typeof StaveT;
let StaveNote: typeof StaveNoteT;
let Voice: typeof VoiceT;
let Formatter: typeof FormatterT;
let Beam: typeof BeamT;
let Accidental: typeof AccidentalT;
let Dot: typeof DotT;
let BarlineType: typeof BarlineTypeT;
let StaveTie: typeof StaveTieT;
let VoltaType: typeof VoltaTypeT;
let Repetition: typeof RepetitionT;
let Articulation: typeof ArticulationT;
let Ornament: typeof OrnamentT;
let Annotation: typeof AnnotationT;
let AnnotationVerticalJustify: typeof AnnotationVerticalJustifyT;
let GraceNote: typeof GraceNoteT;
let GraceNoteGroup: typeof GraceNoteGroupT;
let Curve: typeof CurveT;
let TextBracket: typeof TextBracketT;
let TextBracketPosition: typeof TextBracketPositionT;
let Tremolo: typeof TremoloT;
let StaveHairpin: typeof StaveHairpinT;
let StaveConnector: typeof StaveConnectorT;
let TabStave: typeof TabStaveT;
let TabNote: typeof TabNoteT;
let GhostNote: typeof GhostNoteT;
let TabSlide: typeof TabSlideT;
let TabTie: typeof TabTieT;
let PedalMarking: typeof PedalMarkingT;
let __vexflowLoaded = false;
async function __ensureVexflow() {
  if (__vexflowLoaded) return;
  const vf = await import('vexflow');
  Renderer = vf.Renderer;
  Stave = vf.Stave;
  StaveNote = vf.StaveNote;
  Voice = vf.Voice;
  Formatter = vf.Formatter;
  Beam = vf.Beam;
  Accidental = vf.Accidental;
  Dot = vf.Dot;
  BarlineType = vf.BarlineType;
  StaveTie = vf.StaveTie;
  VoltaType = vf.VoltaType;
  Repetition = vf.Repetition;
  Articulation = vf.Articulation;
  Ornament = vf.Ornament;
  Annotation = vf.Annotation;
  AnnotationVerticalJustify = vf.AnnotationVerticalJustify;
  GraceNote = vf.GraceNote;
  GraceNoteGroup = vf.GraceNoteGroup;
  Curve = vf.Curve;
  TextBracket = vf.TextBracket;
  TextBracketPosition = vf.TextBracketPosition;
  Tremolo = vf.Tremolo;
  StaveHairpin = vf.StaveHairpin;
  StaveConnector = vf.StaveConnector;
  TabStave = vf.TabStave;
  TabNote = vf.TabNote;
  GhostNote = vf.GhostNote;
  TabSlide = vf.TabSlide;
  TabTie = vf.TabTie;
  PedalMarking = vf.PedalMarking;
  __vexflowLoaded = true;
}
import type { NoteSheetData, MeasureInfo, NoteInfo, SheetStaff } from '../../data/sampleMelody';
import { sheetToStaves, stavesToPlaybackParts, isTabKind, tabTuningFor, clefForKind, restKeyForClef, displayNotesFor, fitTabClefToStave, type NotationClef } from '../../lib/note/sheetStaves';
import { buildDrumNote } from '../../lib/note/drumVexNote';
import { drawTuplets } from '../../lib/note/tupletBrackets';
import { assignTabPositions, type TabPos } from '../../lib/note/tabFingering';
import { chordToDiagram, drawFretDiagram, type FretDiagram } from '../../lib/note/chordDiagram';
import { resolveSheetMidis } from '../../lib/note/resolvePitches';
import { keySigLetterMap, soundingAccidental, type AccGlyph } from '../../lib/note/resolvePitches';
import { expandMeasures } from '../../lib/note/expandMeasures';
import { useGlobalPlayer } from '../../lib/player';
import type { AnacrusisNote } from '../../lib/player';
import { useCountInIntro } from '../../hooks/useCountInIntro';
import { breakBeatForBar, type BreakPoint } from '../../lib/breakPoints';
import {
  DRUM_KIT_PRESETS,
  type DrumKitId,
} from '../../lib/backing/drumKitPresets';
import {
  getPlayerSettings,
  inferGenre,
  inferPlayStyle,
  setPlayerSetting,
  subscribePlayerSettings,
  type BassMode,
  type PlayStyle,
  type PlayerSettings,
} from '../../lib/note/playerSettings';
import { FullscreenButton, useFullscreen } from '../common/FullscreenButton';
import { formatChordDisplay, chordBaseSegments, chordExtStyle, splitChordParts } from '../../lib/jazz-harmony';
import { resolveMeasureAccidental } from '../../lib/note/measureAccidentals';
import { drawScoopFall } from '../../lib/note/scoopFall';
import { computeBeamBreaks } from '../../lib/note/beamPolicy';
import { chordBaselineY } from '../../lib/note/chordClearance';
import {
  lineHeadroom, defaultHeadroom, clampChordTop,
} from '../../lib/note/chordRowLayout';
import { grandStaffDy, GRAND_BASS_DY } from '../../lib/note/grandStaffLayout';
import {
  staffExtent, lineOrigins, sheetHeight, SPACE_ABOVE, NO_EXTENT, type LineBox,
} from '../../lib/note/sheetVerticalLayout';
import { showLyricsDefault } from '../../lib/pagePrefs';
import { usePref } from '../../lib/prefsStore';
import { drawLyrics, lyricHeight, maxVerseCount, LYRIC_TOP_GAP, type LyricAnchor } from '../../lib/note/lyricLayout';
import { useNoteNameStyle } from '../../hooks/useNoteNameStyle';
import { drawNoteNameLabels } from '../../lib/note/noteNameLabels';

/* ─── constants ─────────────────────────────────────────────────────────── */

const LINE_HEIGHT = 170;
const MARGIN = { top: 40, left: 10, right: 30, bottom: 40 };
const CHORD_FONT = "'MuseJazz Text', 'Pretendard', sans-serif";

/**
 * Normalize chord-quality text to the jazz lead-sheet glyphs we expect downstream:
 *   maj7 / M7 / j7    →  △7
 *   minor (m, mi, min)→  -
 *   m7b5 / -7b5       →  ø7
 *   o, dim            →  °
 * Tension accidentals (b9, #11, etc.) are spelled with ♭ / ♯.
 */
/* formatChord moved to src/lib/jazz-harmony (formatChordDisplay) \u2014 single
 * source of truth shared with LickCard / Lick12KeyPage. */
const formatChord = formatChordDisplay;

/* splitChordParts 는 lib/jazz-harmony/chord-glyph 로 승격됐다 — 에디터를 포함한
 * 모든 렌더러가 같은 분해 로직(분수코드 베이스 포함)을 쓰게 하기 위함. */

function appendChordSVG(
  svgEl: SVGElement, x: number, y: number,
  chord: string, font: string, size: number,
) {
  const { base, ext, tension, bass } = splitChordParts(formatChord(chord));
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(x));
  txt.setAttribute('y', String(y));
  txt.setAttribute('font-family', font);
  txt.setAttribute('font-weight', '200');
  txt.setAttribute('fill', '#000');

  for (const seg of chordBaseSegments(base, size)) {
    const sp = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    sp.setAttribute('font-size', String(seg.fontSize));
    sp.textContent = seg.text;
    txt.appendChild(sp);
  }

  if (ext) {
    const extSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    const extStyle = chordExtStyle(base, ext, size);
    extSpan.setAttribute('font-size', String(extStyle.fontSize));
    extSpan.setAttribute('dx', extStyle.dx);
    extSpan.setAttribute('dy', extStyle.dy);
    extSpan.textContent = ext;
    txt.appendChild(extSpan);

    if (tension) {
      const tensionSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      // 0.75 (was 0.6) — match LeadSheet's bumped TensionSpan so the
      // subscript reads clearly without disappearing under the ext glyph.
      tensionSpan.setAttribute('font-size', String(Math.round(size * 0.75)));
      tensionSpan.setAttribute('dx', '0');
      tensionSpan.setAttribute('dy', String(-size * 0.22));
      tensionSpan.textContent = tension;
      txt.appendChild(tensionSpan);
    }
  }

  // Slash chord bass — drawn at full root size after everything else.
  if (bass) {
    const bassSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    bassSpan.setAttribute('font-size', String(size));
    bassSpan.setAttribute('dx', '1');
    // dy resets if a tension was last (was raised); use a small downward shift
    // to bring it back down to baseline level.
    bassSpan.setAttribute('dy', tension ? String(size * 0.4) : (ext ? String(size * 0.18) : '0'));
    bassSpan.textContent = bass;
    txt.appendChild(bassSpan);
  }

  svgEl.appendChild(txt);
}
const MAX_PER_LINE = 8;

/* Responsive: on narrow screens render at desktop size then CSS-scale down.
 * This keeps VexFlow's native proportions crisp. */
function getBarLayout(containerW: number, grand = false) {
  // Always render with desktop-size constants
  // 양손(그랜드 스태프)은 아래에 베이스 보표가 한 줄 더 붙으므로 줄 높이를 키운다.
  const decorFirst = 80, decorOther = 40, lineH = grand ? 170 + GRAND_BASS_DY : 170;
  // Scale factor: shrink proportionally below 800px
  const scale = containerW < 1000 ? Math.max(0.42, containerW / 1000) : 1;
  return { decorFirst, decorOther, lineH, scale };
}

/** 양손 악보에서 트레블 보표 y 로부터 베이스 보표까지의 간격(px). */

const FIXED_BAR_W = 175;
const DECOR_FIRST = 80;
const DECOR_OTHER = 40;

/* Per-duration minimum px reservation. Used to grow dense bars beyond
 * FIXED_BAR_W when they contain many short notes (16th/32nd) — otherwise
 * VexFlow's Formatter crams notes too close together. */
const PX_PER_DUR: Record<string, number> = {
  w: 70, h: 50, q: 38, '8': 26, '16': 19, '32': 14,
};

function measureMinWidth(m: MeasureInfo): number {
  let w = 22;
  for (const n of m.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[base] ?? 28;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 8;
    if (n.dotted) w += 5;
  }
  return Math.max(w, FIXED_BAR_W);
}
const MEASURE_HL_COLOR = 'rgba(100, 181, 246, 0.13)';

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625, '128': 0.03125 };

/** Pitch helpers for scheduling anacrusis pickup notes during the count-in. */
const PITCH_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteToMidi(key: string, acc?: '#' | 'b' | 'n' | '##' | 'bb'): number {
  const [np, o] = key.split('/');
  const letter = np[0].toLowerCase();
  // The accidental may be BAKED into the key string ("eb/5") — e.g. transposed
  // notes whose accidental is implied by the key signature. The explicit `acc`
  // arg wins; otherwise fall back to the baked one. (PITCH_SEMI is keyed by
  // bare letter, so the old `PITCH_SEMI["eb"]` lookup silently returned C.)
  const baked = np.slice(1);
  const a = acc ?? (baked || undefined);
  let s = PITCH_SEMI[letter] ?? 0;
  if (a === '#')  s += 1;
  else if (a === 'b')  s -= 1;
  else if (a === '##') s += 2;
  else if (a === 'bb') s -= 2;
  return (parseInt(o) + 1) * 12 + s;
}

/** Compute the playable beat-length of a measure (sum of its notes), used for
 *  anacrusis detection. Mirrors the player's per-note beat formula. */
function noteBeatsOf(n: NoteInfo): number {
  if (n.grace) return 0; // 꾸밈음은 메트릭 시간 0박(픽업 감지 과다계수 방지)
  const base = n.duration.replace(/[dr]/g, '');
  let b = DUR_BEATS[base] ?? 1;
  if (n.dotted) b *= 1.5;
  if (n.tuplet && n.tuplet >= 2) {
    // XML normal-notes(5:3, 7:6 등) 우선, 없으면 2의 거듭제곱 휴리스틱.
    const denom = n.tupletNormal ?? Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
    b *= denom / n.tuplet;
  }
  return b;
}

function measureBeats(m: MeasureInfo): number {
  let beats = 0;
  for (const n of m.notes) beats += noteBeatsOf(n);
  return beats;
}

/* ─── key signature accidentals ──────────────────────────────────────── */
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const KS_FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const KS_SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

/** Normalise a possibly jazz-style key string into the form VexFlow's
 *  `addKeySignature` accepts. Examples:
 *    'G-maj'   → 'G'
 *    'Eb-maj' → 'Eb'
 *    'G-min'  → 'Gm'
 *    'F#-min' → 'F#m'
 *    'Em'     → 'Em'   (already valid)
 *    'C'      → 'C'    (already valid)
 *  Unknown / bad input falls back to 'C' so VexFlow can't throw. */
function normalizeVexKey(raw: string | undefined | null): string {
  const k = (raw ?? '').trim();
  if (!k) return 'C';
  // Hyphenated jazz form like "G-maj" / "Eb-min".
  const hy = k.match(/^([A-G][b#♭♯]?)-?(maj|min|major|minor)$/i);
  if (hy) {
    const root = hy[1].replace('♭', 'b').replace('♯', '#');
    const isMin = /min/i.test(hy[2]);
    const v = isMin ? root + 'm' : root;
    return (v in KS_FLAT_KEYS || v in KS_SHARP_KEYS || v === 'C' || v === 'Am') ? v : 'C';
  }
  // Already-canonical (allow C / Am / G / Em / etc.).
  const clean = k.replace('♭', 'b').replace('♯', '#');
  if (clean in KS_FLAT_KEYS || clean in KS_SHARP_KEYS || clean === 'C' || clean === 'Am') return clean;
  // Strip any trailing "-anything" then retry.
  const stripped = clean.split('-')[0];
  if (stripped in KS_FLAT_KEYS || stripped in KS_SHARP_KEYS || stripped === 'C' || stripped === 'Am') return stripped;
  return 'C';
}

function keySigAccidentals(rawKey: string): Map<string, 'b' | '#'> {
  const vexKey = normalizeVexKey(rawKey);
  const map = new Map<string, 'b' | '#'>();
  const nFlats = KS_FLAT_KEYS[vexKey];
  if (nFlats) { for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b'); }
  const nSharps = KS_SHARP_KEYS[vexKey];
  if (nSharps) { for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#'); }
  return map;
}

/* 이명동음 강제 변환(플랫 조성에서 샵 → 플랫)은 제거했다 — 저장된 표기가
 * 정본이고 화면이 임의로 리스펠하면 에디터와 어긋난다. 자세한 이유는 음표
 * 렌더 루프의 주석 참조. */

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

function packLines(measures: MeasureInfo[], availW: number, dFirst = DECOR_FIRST, dOther = DECOR_OTHER): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let usedW = 0;

  for (let i = 0; i < measures.length; i++) {
    const mw = measureMinWidth(measures[i]);
    const decor = line.length === 0
      ? (lines.length === 0 ? dFirst : dOther)
      : 0;

    if (line.length > 0 && (usedW + mw > availW || line.length >= MAX_PER_LINE)) {
      lines.push(line);
      line = [i];
      usedW = (lines.length === 0 ? dFirst : dOther) + mw;
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
  position: relative;
  flex: 1;
  overflow: auto;
  background: ${({ theme }) => theme.colors.surface};

  &:hover .fullscreen-btn {
    opacity: 1;
  }

  &:fullscreen {
    display: flex;
    flex-direction: column;
  }

  /* Print: drop the scroll container so the full score flows across pages
   * instead of being clipped to the on-screen viewport height. Screen-only
   * affordances (fullscreen button) are hidden too. */
  @media print {
    overflow: visible;
    height: auto;
    .fullscreen-btn { display: none !important; }
  }
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28px 28px 0;

  @media (max-width: 960px) {
    padding: 12px 8px 0;
  }
`;

const HeaderLeft = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};

  @media (max-width: 960px) {
    font-size: 0.7rem;
  }
`;

const Title = styled.h1`
  font-family: ${CHORD_FONT};
  font-size: clamp(1.3rem, 4vw, 2.8rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0;
  text-align: center;
  flex: 1;
`;

const Composer = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};

  @media (max-width: 960px) {
    font-size: 0.7rem;
  }
`;

/* ── part dropdown (multi-part scores) — sits ABOVE the key dropdown ────── */

const PartStack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
`;

const PartDropdownWrap = styled.div`
  position: relative;
  display: inline-block;
`;

const PartButton = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &::after { content: '▾'; font-size: 0.85em; opacity: 0.7; }
  &:hover { background: ${({ theme }) => theme.colors.inkSurface}; }
`;

const PartMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: 4px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
`;

const PartOption = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: ${({ $active }) => ($active ? 'rgba(0,0,0,0.07)' : 'transparent')};
  border-radius: 5px;
  padding: 7px 10px;
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

/* ── key dropdown ──────────────────────────────────────────────────────── */

const KeyDropdownWrap = styled.div`
  position: relative;
  display: inline-block;
  margin-top: -8px;
`;

const KeyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  padding: 5px 14px;
  cursor: pointer;
  font-family: ${CHORD_FONT};
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { border-color: ${({ theme }) => theme.colors.textPrimary}; }
  &::after { content: '▾'; font-size: 0.7em; color: ${({ theme }) => theme.colors.textSecondary}; }

  @media (max-width: 960px) {
    font-size: 1rem;
    padding: 3px 10px;
  }
`;

const KeyMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 100;

  @media (max-width: 960px) {
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 6px;
  }
`;

const KeyOption = styled.button<{ $active?: boolean }>`
  background: ${({ $active }) => $active ? '#333' : 'transparent'};
  color: ${({ $active }) => $active ? '#fff' : '#333'};
  border: none;
  border-radius: 4px;
  padding: 7px 12px;
  cursor: pointer;
  font-family: ${CHORD_FONT};
  font-size: 1.1rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  &:hover { background: ${({ $active }) => $active ? '#333' : '#f0f0f0'}; }

  @media (max-width: 960px) {
    font-size: 0.9rem;
    padding: 5px 8px;
  }
`;

/* ── floating player (bottom-left) ─────────────────────────────────────── */

const PlayerBar = styled.div`
  /* absolute (not fixed) so it anchors to the score Wrapper's bottom-left
   * — i.e. the sheet section — instead of the viewport, keeping it clear
   * of the sidebar. */
  position: absolute;
  bottom: 24px;
  left: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: ${({ theme }) => theme.colors.inkSurface};
  padding: 12px 16px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  z-index: ${({ theme }) => theme.zIndex.modal};

  /* Hidden when printing to PDF — the floating player is a screen-only
   * control and was forcing a blank first page in the exported PDF. */
  @media print {
    display: none !important;
  }
`;

const PlayerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
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
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const BpmInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid ${({ theme }) => theme.colors.textPrimary};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  &:focus { border-color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const MixSep = styled.div`
  width: 1px;
  height: 20px;
  background: ${({ theme }) => theme.colors.inkSurface};
`;

const MixToggle = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  padding: 4px 8px;
  border: 1px solid ${({ $on }) => ($on ? '#6aaa7e' : '#555')};
  border-radius: 6px;
  background: ${({ $on }) => ($on ? '#2a6e3f' : '#2a2a2a')};
  color: ${({ $on }) => ($on ? '#fff' : '#999')};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover { border-color: ${({ theme }) => theme.colors.textPrimary}; }
`;

/* ─── mixer popup (slides up from PlayerBar) ──────────────────────────── */
/* Channel-strip list: each track is one row with name + filled slider + value,
 * sub-options (pattern, kit, genre) stacked underneath as a pill group.
 * Solid panel — no grid gaps so the score never bleeds through. */

const MixerPopup = styled.div`
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  width: 340px;
  background: linear-gradient(180deg, ${({ theme }) => theme.colors.inkSurface} 0%, #161616 100%);
  border: 1px solid ${({ theme }) => theme.colors.textPrimary};
  border-radius: 14px;
  padding: 14px 14px 12px;
  box-shadow: 0 12px 38px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset;
  display: flex;
  flex-direction: column;
  gap: 4px;

  @media (max-width: 720px) {
    width: min(340px, calc(100vw - 32px));
  }

  @media print {
    display: none !important;
  }
`;

const MixerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.textPrimary};

  & > span {
    font-family: 'Pretendard', sans-serif;
    font-size: 0.74rem;
    font-weight: 700;
    color: ${({ theme }) => theme.colors.textSecondary};
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }
`;

/** One track row — header + slider + (optional) pill group. */
const MixerSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 4px 10px;
  &:not(:last-child) { border-bottom: 1px solid ${({ theme }) => theme.colors.textPrimary}; }
`;

const MixerSectionTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  letter-spacing: 0.2px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const MixerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const MixerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.7rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  width: 36px;
  flex-shrink: 0;
  white-space: nowrap;
`;

const MixerValue = styled.span`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.68rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  width: 30px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
`;

/* Slider with filled-track look — uses a background gradient driven by the
 * --pct CSS var (set inline as style on each slider). */
const MixerSlider = styled.input.attrs<{ $pct?: number }>(({ $pct }) => ({
  style: { '--pct': `${$pct ?? 0}%` } as React.CSSProperties,
}))<{ $pct?: number }>`
  -webkit-appearance: none;
  flex: 1;
  min-width: 0;
  height: 5px;
  border-radius: 3px;
  background:
    linear-gradient(90deg, #6aaa7e 0%, #6aaa7e var(--pct), #2c2c2c var(--pct), #2c2c2c 100%);
  outline: none;
  cursor: pointer;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.surface};
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.surface};
    border: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  }
`;

const KitGroup = styled.div`
  display: flex;
  gap: 4px;
  flex: 1;
  padding: 2px;
  background: ${({ theme }) => theme.colors.inkSurface};
  border: 1px solid ${({ theme }) => theme.colors.textPrimary};
  border-radius: 999px;
`;

const KitBtn = styled.button<{ $active?: boolean }>`
  flex: 1;
  background: ${({ $active }) => ($active ? '#2a6e3f' : 'transparent')};
  color: ${({ $active }) => ($active ? '#fff' : '#9a9a9a')};
  border: none;
  border-radius: 999px;
  padding: 5px 8px;
  font-family: 'Pretendard', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
  &:hover {
    background: ${({ $active }) => ($active ? '#2a6e3f' : '#1f1f1f')};
    color: #fff;
  }
`;

const AttribLine = styled.div`
  font-size: 9px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
  padding: 0 2px;
  text-align: right;
  line-height: 1.2;
`;

const SvgContainer = styled.div<{ $seekable?: boolean; $selecting?: boolean }>`
  width: 100%;
  padding: 0 20px 40px;
  ${({ $seekable }) => $seekable && 'cursor: pointer;'}
  /* 구간 선택 모드: Shift+클릭이 브라우저 텍스트 선택을 일으키지 않게. */
  ${({ $selecting }) => $selecting && 'cursor: pointer; user-select: none;'}

  @media (max-width: 960px) {
    padding: 0 4px 20px;
  }
`;

/* ─── helpers ───────────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

/* 양손(그랜드 스태프) 왼손 보표용 음표 빌더.
 *
 * 오른손(트레블)은 선택·타이·튜플렛·빔·아티큘레이션까지 전부 그리는 기존 경로를
 * 그대로 쓰고, 왼손은 **읽기용 표시**에 필요한 것(음높이·길이·점·임시표·쉼표)만
 * 만든다. 임시표는 프로젝트 규칙대로 반드시 `resolveMeasureAccidental`(옥타브 인식)
 * 을 경유한다 — 음이름만으로 키를 잡으면 옥타브가 다른 같은 음이 잘못 표기된다. */
function buildBassStaveNotes(
  measure: { notes: NoteInfo[] } | undefined,
  keySigAcc: Map<string, 'b' | '#'> | undefined,
  explicitAcc: boolean,
): StaveNote[] {
  if (!measure?.notes?.length) return [];
  const active = new Map<string, 'b' | '#' | 'n' | '##' | 'bb'>(); // 마디 단위 임시표 상태
  const out: StaveNote[] = [];
  for (const n of measure.notes) {
    const isRest = n.duration.endsWith('r');
    const keys = isRest ? ['d/3'] : n.keys;   // 베이스 보표 쉼표는 3옥타브 D 위치
    const dur = buildDuration(n.duration, n.dotted);
    let note: StaveNote;
    try {
      note = new StaveNote({ keys, duration: dur, autoStem: true, ...ghostHead(n) });
    } catch {
      continue; // 깨진 음표 하나가 악보 전체를 못 그리게 만들지 않는다
    }
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      for (let ki = 0; ki < keys.length; ki++) {
        const glyph = resolveMeasureAccidental(
          active, keySigAcc, keys[ki],
          n.accidentals?.[ki],
          { courtesy: !explicitAcc, tied: n.tieKeys ? n.tieKeys.includes(ki) : n.tieContinuation },
        );
        if (glyph) note.addModifier(new Accidental(glyph), ki);
      }
    }
    out.push(note);
  }
  return out;
}

/* ── 추가 스태프 행(뷰어) 음표 빌더 — 표기(피치)/드럼/TAB 3종. 꾸밈음은
 * 추가 파트에선 생략(v1). 빌더는 lazy vexflow 바인딩 이후에만 호출된다. */
const TAB_REST_KEY: Record<number, string> = { 6: 'b/4', 5: 'b/4', 4: 'a/4' };

/** 뷰어 코드 다이어그램 높이/폭 + 캐시 — 에디터(DIAGRAM_H)와 같은 규격. */
const VIEW_DIAGRAM_H = 50;
const VIEW_DIAGRAM_W = 34;
const viewerDiagramCache = new Map<string, FretDiagram | null>();
function viewerCachedDiagram(chord: string, tuning: number[]): FretDiagram | null {
  const key = chord + '|' + tuning.join(',');
  if (!viewerDiagramCache.has(key)) viewerDiagramCache.set(key, chordToDiagram(chord, tuning));
  return viewerDiagramCache.get(key) ?? null;
}

/* TAB 주법 — 마디 안 인접쌍: gliss→슬라이드(음정 방향), slurStart→slurStop
 * 인접쌍→해머온(상행)/풀오프(하행). 에디터(drawTabTechniques)와 같은 규약. */
function drawViewerTabTechniques(
  ctx: ReturnType<Renderer['getContext']>,
  notes: NoteInfo[],
  vf: (StaveNote | TabNoteT | GhostNoteT)[],
): void {
  const real = notes.filter((n) => !n.grace);
  const midiOf = (n: NoteInfo): number | null =>
    n.duration.endsWith('r') || n.keys.length === 0 ? null : noteToMidi(n.keys[0], n.accidentals?.[0]);
  for (let i = 0; i + 1 < real.length && i + 1 < vf.length; i++) {
    const a = real[i], b = real[i + 1];
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

function buildExtraRowNotes(
  kind: SheetStaff['kind'],
  notes: NoteInfo[],
  keySigAcc: Map<string, 'b' | '#'> | undefined,
  explicitAcc: boolean,
  clef: 'treble' | 'bass' | 'alto' | 'tenor',
  tabPosRow: (TabPos[] | null)[] | null,
  /** 표기 옥타브 시프트 판정용(TAB 동반 오선 등 kind 와 표기 규약이 다를 때). */
  dispKind?: SheetStaff['kind'],
  /** standalone TAB(동반 오선 없음) — 리듬 스템·플래그·진짜 쉼표를 TAB 에 그린다. */
  tabStems = false,
  /** 카포·튜닝 프리셋(줄 수·쉼표 위치 계산용). */
  staffOpts?: Pick<SheetStaff, 'capo' | 'tuningPreset'>,
): (StaveNote | TabNoteT | GhostNoteT)[] {
  const real = displayNotesFor(dispKind ?? kind, notes.filter((n) => !n.grace));
  if (isTabKind(kind)) {
    const numLines = tabTuningFor(kind, staffOpts).length;
    return real.map((n, ni) => {
      const dur = buildDuration(n.duration, n.dotted);
      const pos = tabPosRow?.[ni] ?? null;
      if (n.duration.endsWith('r') || !pos || pos.length === 0) {
        if (tabStems && n.duration.endsWith('r')) {
          const rest = new StaveNote({ keys: [TAB_REST_KEY[numLines] ?? 'b/4'], duration: dur });
          if (n.dotted) Dot.buildAndAttach([rest]);
          return rest;
        }
        return new GhostNote(dur);
      }
      const tn = new TabNote({ positions: pos.map((tp) => ({ str: tp.str, fret: tp.fret })), duration: dur }, tabStems);
      if (tabStems) {
        tn.setStemDirection(-1);           // 출판 TAB 관례 — 스템은 보표 아래
        if (n.dotted) Dot.buildAndAttach([tn]);
      }
      return tn;
    });
  }
  if (kind === 'drum') {
    /* 공용 빌더 — per-key 노트헤드(킥 타원 + 심벌 ✕ + 벨 ◆), 손/발 스템 방향,
     * 고스트 괄호, 열린 하이햇 ○, 악센트. 에디터와 동일 표기. */
    return real.map((n) => buildDrumNote(n));
  }
  const active = new Map<string, 'b' | '#' | 'n' | '##' | 'bb'>();
  const out: (StaveNote | TabNoteT | GhostNoteT)[] = [];
  for (const n of real) {
    const isRest = n.duration.endsWith('r');
    const keys = isRest ? [restKeyForClef(clef)] : n.keys;
    const dur = buildDuration(n.duration, n.dotted);
    let note: StaveNote;
    try {
      note = new StaveNote({ keys, duration: dur, autoStem: true, clef, ...ghostHead(n) });
    } catch { continue; }
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      for (let ki = 0; ki < keys.length; ki++) {
        const glyph = resolveMeasureAccidental(active, keySigAcc, keys[ki], n.accidentals?.[ki], { courtesy: !explicitAcc, tied: n.tieKeys ? n.tieKeys.includes(ki) : n.tieContinuation });
        if (glyph) note.addModifier(new Accidental(glyph), ki);
      }
    }
    out.push(note);
  }
  return out;
}

/* buildVfNotes is now inlined in the render loop for context-aware accidentals */

/* ─── component ─────────────────────────────────────────────────────────── */

interface NoteSheetProps {
  data: NoteSheetData;
  selectedKey?: string;
  allKeys?: readonly string[];
  onKeyChange?: (key: string) => void;
  /** Region-selection mode (admin lick picker). When true, clicking a measure
   * sets/extends the selected ranges. */
  selectable?: boolean;
  /** Inclusive [start, end] measure indices per region. Multiple disjoint
   * regions are supported (Cmd/Ctrl+click to add). */
  selectedRanges?: Array<[number, number]>;
  onSelectionChange?: (ranges: Array<[number, number]>) => void;
  /** Render a small 1-based measure number above each bar. */
  showMeasureNumbers?: boolean;
  /** Render a tiny 1-based measure number only at the START of each line
   *  (the left-most bar of every system row) — standard lead-sheet
   *  convention. Used on the note page + solo database. */
  lineStartMeasureNumbers?: boolean;
  /** Ignore any explicit per-note stem direction from the source data and let
   *  VexFlow auto-stem (high notes → stem down, low notes → stem up). Useful
   *  for sources like the Charlie Parker Omnibook where the XML hard-codes
   *  stems-up for jazz-single-line convention but the on-screen rendering
   *  reads better with standard engraver auto-stem. */
  forceAutoStem?: boolean;
  /** Hide the bottom PlayerBar (BPM + Play/Stop + 믹서 toggle). Used when a
   *  parent renders its own transport (NotePage) and drives this NoteSheet
   *  via the imperative handle below. */
  hideTransport?: boolean;
  /** 가사 표시 — 악보에 가사가 있어도 이 값이 false 면 그리지 않는다.
   *  생략하면 **전역 기본값**(`showLyricsDefault`)을 따른다. */
  showLyrics?: boolean;
  /** Skip the mount-time instrument warmup. Set on static thumbnails/previews
   *  (e.g. 내 악보 차트 cards) that render the score but never play. Without it,
   *  every card mounts and preloads the full piano/bass/drum sample banks,
   *  flooding the network with hundreds of .ogg fetches and slowing the page.
   *  Instruments still load lazily if the user ever does press play. */
  noPreload?: boolean;
  /** Fires whenever the internal player transitions play/stop/pause, so
   *  the parent transport can mirror the playing state. */
  onPlayingChange?: (playing: boolean) => void;
  /** Fires whenever the tempo changes (song load, BPM input, or external
   *  setTempo via the ref handle). */
  onTempoChange?: (tempo: number) => void;
  /** Break Editor mode: overlay clickable per-beat quarter-note markers above
   *  every measure (drawn into the SVG). */
  breakEditMode?: boolean;
  /** Active break points (flat measure index + 1-based rest-start beat). */
  breakPoints?: BreakPoint[];
  /** Toggle a break: passes the CLICKED beat (last played); the host maps it
   *  to the rest-start beat (clicked + 1). */
  onToggleBreak?: (bar: number, clickedBeat: number) => void;
  /** Multi-part scores: other parts whose melody should ALSO sound during
   *  playback (the displayed staff stays `data`). Forwarded into the player. */
  extraParts?: NoteSheetData[];
  /** Multi-part picker options shown as a dropdown ABOVE the in-score key
   *  selector. Includes a synthetic "전체 보기" (id 'all') entry. Omit/empty
   *  to hide (single-part scores). */
  partOptions?: { id: string; name: string }[];
  selectedPartId?: string;
  onSelectPart?: (id: string) => void;
  /** Lock the rhythm-section feel to SWING regardless of the chart's genre.
   *  Solo Database uses this so a chord chart's latin/bossa choice never leaks
   *  into solo playback (same "릭·솔로는 무조건 스윙" 정책). */
  lockSwing?: boolean;
}

/** Imperative handle exposed to parents that own an external transport.
 *  togglePlay mirrors the internal play button; stop is unconditional. */
export interface NoteSheetHandle {
  togglePlay: () => void;
  stop: () => void;
  setTempo: (n: number) => void;
}

export const NoteSheet = forwardRef<NoteSheetHandle, NoteSheetProps>(function NoteSheet({
  data, selectedKey, allKeys, onKeyChange, selectable, selectedRanges, onSelectionChange,
  showMeasureNumbers, lineStartMeasureNumbers, forceAutoStem,
  hideTransport, showLyrics, noPreload, onPlayingChange, onTempoChange,
  breakEditMode = false, breakPoints, onToggleBreak, extraParts: extraPartsProp,
  partOptions, selectedPartId, onSelectPart, lockSwing,
}, ref) {

  /* 가사 표시 — prop 이 있으면 그 값, 없으면 전역 기본값(설정에서 바꾼다). */
  const [lyricsDefault] = usePref(showLyricsDefault);
  const lyricsOn = showLyrics ?? lyricsDefault;
  /* 다중 스태프 악보(data.staves)의 추가 파트는 뷰어가 스스로 재생 파트를
   * 만든다(TAB→해당 악기 음색, 드럼→퍼커션 채널·key C). 호출자가 extraParts 를
   * 명시하면 그것이 우선 — 기존 호출부(양손 LH 전달 등)와 충돌하지 않는다. */
  const extraParts = useMemo<NoteSheetData[] | undefined>(() => {
    if (extraPartsProp) return extraPartsProp;
    if (!data.staves || data.staves.length === 0) return undefined;
    const parts = stavesToPlaybackParts(data, sheetToStaves(data)).slice(1);
    return parts.length ? parts : undefined;
  }, [extraPartsProp, data]);
  const [partMenuOpen, setPartMenuOpen] = useState(false);
  const partMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!partMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!partMenuRef.current?.contains(e.target as Node)) setPartMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [partMenuOpen]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  /* Bumped AFTER the async VexFlow render commits a fresh SVG. The overlay
   * effects (.m-hl / .m-num / .brk-mk / .m-sel / .m-num-ls) inject into the SVG and
   * read measureRectsRef — but the main render is async (dynamic vexflow
   * import), so on data/width changes they used to run BEFORE the new SVG
   * existed, then get wiped by `innerHTML=''` with nothing re-triggering
   * them (stale "Defined AFTER the render effect" assumption from the
   * synchronous era). Including renderTick in their deps re-runs them
   * against the freshly-rendered SVG. */
  const [renderTick, setRenderTick] = useState(0);
  const lineHRef = useRef(LINE_HEIGHT);
  const unscaledLineHRef = useRef(LINE_HEIGHT);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(wrapRef);
  const [keyMenuOpen, setKeyMenuOpen] = useState(false);
  const keyMenuRef = useRef<HTMLDivElement>(null);

  /* ── player state ────────────────────────────────────────────────── */
  const { player } = useGlobalPlayer();
  const [playing, setPlaying] = useState(false);
  /* 음이름 표시 — 전역 설정 + 현재 페이지 덮어쓰기. */
  const noteNameStyle = useNoteNameStyle();
  const [tempo, setTempo] = useState(data.tempo ?? 120);
  const [tempoText, setTempoText] = useState(String(data.tempo ?? 120));
  const [activeMeasure, setActiveMeasure] = useState(-1);
  const [paused, setPaused] = useState(false);
  /* Global mixer state — every player instance reads from / writes to the
   * same store via setPlayerSetting, so the mixer is truly global. */
  const [settings, setSettingsState] = useState<PlayerSettings>(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettingsState), []);

  // Auto-pick rhythm style from the chart's genre — bossa charts default to
  // bossa, everything else to swing. Runs whenever the chart's genre changes
  // (i.e. when a new piece is loaded), so the user never has to toggle the
  // style themselves. The user can still override manually after this fires.
  useEffect(() => {
    // 솔로 데이터베이스 등 lockSwing 은 차트 genre 와 무관하게 스윙으로 고정한다 —
    // 코드 차트에서 라틴/보사로 바꾼 전역 style 이 솔로 재생에 새지 않도록.
    if (lockSwing) {
      if (getPlayerSettings().style !== 'swing') setPlayerSetting('style', 'swing');
      if (getPlayerSettings().genre !== 'Medium Swing') setPlayerSetting('genre', 'Medium Swing');
      return;
    }
    const inferred = inferPlayStyle(data.genre);
    if (inferred && inferred !== getPlayerSettings().style) {
      setPlayerSetting('style', inferred);
    }
    const genre = inferGenre(data.genre);
    if (genre && genre !== getPlayerSettings().genre) {
      setPlayerSetting('genre', genre);
    }
  }, [data.genre, lockSwing]);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [drumKitError, setDrumKitError] = useState<string | null>(null);
  const metroOn = settings.metroEnabled;
  const melodyVol = settings.melodyVolume;
  const pianoVol = settings.pianoVolume;
  const bassVol = settings.bassVolume;
  const pianoReverb = settings.pianoReverb;
  const drumVol = settings.drumVolume;
  const metroVol = settings.metroVolume;
  const drumKit = settings.drumKit;
  const bassMode = settings.bassMode;
  const playStyle = settings.style;
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const prevNoteKeyRef = useRef<string | null>(null);
  /* 재생용으로 도돌이/볼타/D.C.를 전개하면 srcMi가 전개-인덱스가 되므로,
   * 하이라이트를 원본 마디로 환원하는 매핑. play() 직전에 채운다. */
  const origMiRef = useRef<number[]>([]);

  // note highlight helpers
  const colorNote = useCallback((key: string, color: string) => {
    const el = noteElMapRef.current.get(key);
    if (!el) return;
    const apply = (e: Element) => { (e as SVGElement).style.fill = color; };
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
    if (mi < 0) { prevNoteKeyRef.current = null; return; }
    const key = `${mi}-${ni}`;
    colorNote(key, '#1565c0');
    prevNoteKeyRef.current = key;
  }, [colorNote]);

  // subscribe to GlobalPlayer events
  useEffect(() => {
    // 전개 재생 시 이벤트의 mi는 전개-인덱스 → origMi로 환원해 원본 마디를 칠한다.
    const unsubBar = player.on('bar', (barIndex) => setActiveMeasure(origMiRef.current[barIndex] ?? barIndex));
    const unsubNote = player.on('note', (mi, ni) => highlightNote(origMiRef.current[mi] ?? mi, ni));
    const unsubDone = player.on('done', () => { setPlaying(false); });
    const unsubError = player.on('drumKitError', (msg) => {
      setDrumKitError(typeof msg === 'string' ? msg : msg.message);
    });
    return () => { unsubBar(); unsubNote(); unsubDone(); unsubError(); };
  }, [player, highlightNote]);

  /* Player instances subscribe to playerSettings on construction, so any
   * setPlayerSetting() call below propagates automatically — no per-player
   * sync useEffects needed here anymore. */

  // stop on song change & sync tempo
  useEffect(() => {
    player.stop();
    setPlaying(false);
    setActiveMeasure(-1);
    const t = data.tempo ?? 120;
    setTempo(t);
    setTempoText(String(t));
  }, [data]);

  const countIn = useCountInIntro();

  // Warm up instruments/samples as soon as the sheet is known, BEFORE the user
  // presses play. preload() loads on a suspended AudioContext (no user gesture
  // needed), so by play time everything is decoded and the count-in starts
  // instantly instead of stalling ~2s on a cold first play.
  useEffect(() => {
    if (noPreload) return; // static thumbnail/preview — never plays, so don't load sample banks
    void player.preload({ kind: 'sheet', data, extraParts }).catch(() => { /* retry at play time */ });
  }, [player, data, noPreload, extraParts]);

  const togglePlay = useCallback(async () => {
    const p = player;
    if (playing || countIn.active) {
      if (playing) {
        p.pause();
        setPaused(true);
      }
      countIn.cancel();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    setPaused(false);
    // .catch at creation: this promise is awaited ~2s later (inside the
    // count-in / anacrusis path). A rejection in that gap is an
    // `unhandledrejection`, which AudioLifecycleGuard answers with
    // stopAllAudio() — killing the very playback we're starting. play()
    // reloads instruments anyway if the preload failed.
    const preload = p.preload({ kind: 'sheet', data, extraParts }).catch(() => {});
    // Resume the melody engine's AudioContext NOW, synchronously inside this
    // click gesture. play() runs only after the ~2s count-in await, when the
    // gesture has expired and its resume() can no longer start a ctx created
    // suspended during mount warmup — the cause of the first-play-after-cold-
    // entry silence. This is the in-gesture resume.
    p.unlock({ kind: 'sheet', data, extraParts });

    // ── 도돌이/볼타/D.C./D.S./Coda/Fine 전개 ───────────────────────────────
    // 렌더러는 원본 마디(반복 기호 포함)를 그리지만, 재생은 사람이 읽는
    // 반복 순서대로 들려야 한다. play() 직전에 전개하고, origMiRef로 하이라이트를
    // 원본 마디로 환원한다(이벤트의 mi는 전개-인덱스). extraParts도 동일 구조로
    // 전개(파트 간 반복 마커는 일치한다고 가정).
    const expandedMain = expandMeasures(data.measures);
    origMiRef.current = expandedMain.map((e) => e.origMi);
    const expData: NoteSheetData = { ...data, measures: expandedMain.map((e) => e.m) };
    const expExtra: NoteSheetData[] | undefined = extraParts?.map((pt) => ({
      ...pt, measures: expandMeasures(pt.measures).map((e) => e.m),
    }));

    // ── Anacrusis (pickup) handling ───────────────────────────────────────
    // If the song opens with a pickup measure (shorter than the time
    // signature), the user's musical intent is: count-in clicks fill the
    // missing leading beats, the pickup notes sound DURING the count-in
    // (on its last A beats), and bar-1's downbeat lands exactly on the
    // count-in's resolution. We achieve this by:
    //   1. Detecting anacrusis from first-measure note durations
    //   2. Scheduling pickup notes via the player's soundfont aligned to
    //      the count-in's last A audio-context beats
    //   3. Stripping the pickup measure and calling play() with
    //      startAt = count-in end, measureOffset = 1 so highlights keep
    //      pointing at the original bar indices.
    const firstMeas = data.measures[0];
    const [tsNumStr] = (data.timeSignature || '4/4').split('/');
    const tsNum = parseInt(tsNumStr, 10) || 4;
    const firstBeats = firstMeas ? measureBeats(firstMeas) : 0;
    const hasAnacrusis = !!firstMeas
      && (firstMeas.anacrusis || (firstBeats > 0 && firstBeats < tsNum - 0.001));

    const beatDur = 60 / tempo;

    if (hasAnacrusis) {
      // Pickup notes SOUND during the count-in via the player's soundfont, so
      // the instruments must already be loaded before the clicks start — here
      // (and only here) we still await preload up front.
      await preload;
      // Anchor: when the count-in's first click will sound, in the PLAYER's
      // ctx clock. Count-in clicks live in a separate AudioContext but both
      // contexts advance at wall-clock rate, so reading both at the same JS
      // tick gives us a stable offset (the +0.06 mirrors the internal lead
      // inside useCountInIntro).
      const cinStart = p.ctxNow() + 0.06;
      const anacrusisBeats = firstBeats;
      // Pickup notes sound during count-in's last `anacrusisBeats` beats.
      // They start at the (tsNum - anacrusisBeats)'th beat of the count-in
      // and end exactly when the count-in resolves.
      const pickupStart = cinStart + (tsNum - anacrusisBeats) * beatDur;
      const songStart = cinStart + tsNum * beatDur;

      // Schedule pickup notes through the GlobalPlayer anacrusis API.
      const anacrusisNotes: AnacrusisNote[] = [];
      let beatCursor = 0;
      // 픽업 마디 피치도 본편(어댑터)과 동일하게 score 의미론으로 해석 —
      // 조표·마디 내 임시표 지속을 무시하면 픽업만 반음 틀리게 들린다.
      const pickupKeySig = keySigLetterMap(firstMeas.key ?? data.key);
      const pickupActive = new Map<string, AccGlyph>();
      for (const n of firstMeas.notes) {
        const b = noteBeatsOf(n);
        const isRest = n.duration.endsWith('r');
        if (!isRest && !n.tieContinuation) {
          const acc = soundingAccidental(
            pickupActive, pickupKeySig, n.keys[0],
            n.accidentals?.[0] as AccGlyph | undefined, 'score',
          );
          const midi = noteToMidi(n.keys[0], acc);
          const when = pickupStart + beatCursor * beatDur;
          const dur = Math.max(b * beatDur * 0.9, 0.04);
          anacrusisNotes.push({ pitch: midi, startAt: when, durationSec: dur });
        }
        beatCursor += b;
      }
      p.scheduleAnacrusis(anacrusisNotes);

      const cin = await countIn.run({ bpm: tempo });
      if (!cin.ok) { p.cancelAnacrusis(); setPlaying(false); return; }
      // 픽업(전개본 첫 마디)을 떼고 재생. measureOffset:1이 bar/note 이벤트의
      // mi에 +1을 더하므로(재생인덱스 → 전개본 인덱스), origMiRef는 자르지
      // 않는다 — origMiRef[전개본 인덱스] = 원본 마디로 하이라이트가 정확히 환원된다.
      const strippedData: NoteSheetData = { ...expData, measures: expData.measures.slice(1) };
      p.setConfig({ bpm: tempo });
      try {
        await p.play({ kind: 'sheet', data: strippedData, extraParts: expExtra }, { startAt: songStart, measureOffset: 1 });
      } catch {
        // play() rethrows after emitting 'error' — unhandled it would both
        // freeze the ▶ button on "playing" and trip AudioLifecycleGuard.
        p.cancelAnacrusis();
        setPlaying(false);
      }
    } else {
      // No pickup → load instruments CONCURRENTLY with the clicks (prepare).
      // Anchor the downbeat to `cin.downbeatInSec` re-read AFTER run() resolves,
      // NOT to a press-time absolute time. On a cold first play the preload can
      // outrun the count-in, so run() blocks on `prepare` after the clicks; a
      // press-time `startAt` would then already be in the PAST and the
      // scheduler drops the downbeat → nothing plays until samples are cached
      // (the "have to press a few times" bug). downbeatInSec is clamped ≥0 and
      // converted to the player's clock here. (Matches ChordPage's play path.)
      const cin = await countIn.run({ bpm: tempo, prepare: preload });
      if (!cin.ok) { setPlaying(false); return; }
      p.setConfig({ bpm: tempo });
      try {
        // 전개본으로 재생 — 도돌이/볼타/D.C. 반영. origMiRef로 하이라이트 환원.
        await p.play({ kind: 'sheet', data: expData, extraParts: expExtra }, { downbeatInSec: cin.downbeatInSec });
      } catch {
        setPlaying(false); // see anacrusis branch — same guard
      }
    }
  }, [data, tempo, countIn, player, playing, extraParts]);

  const handleStop = useCallback(() => {
    player.stop();
    setPlaying(false);
    setPaused(false);
  }, [player]);

  /* External transport sync — fires callbacks so a parent owning its own
   * transport bar (NotePage) can mirror our play/tempo state. */
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  useEffect(() => { onTempoChange?.(tempo); }, [tempo, onTempoChange]);

  /* Imperative handle so the parent can drive play/stop/tempo from its own UI
   * without us re-implementing the count-in + anacrusis logic externally. */
  useImperativeHandle(ref, () => ({
    togglePlay,
    stop: handleStop,
    setTempo: (n: number) => {
      const clamped = Math.max(40, Math.min(300, Math.round(n)));
      setTempo(clamped);
      setTempoText(String(clamped));
    },
  }), [togglePlay, handleStop]);

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
    rect.setAttribute('height', String(unscaledLineHRef.current - 20));
    rect.setAttribute('fill', MEASURE_HL_COLOR);
    rect.setAttribute('stroke', 'none');
    rect.setAttribute('rx', '4');
    svg.insertBefore(rect, svg.firstChild);
  }, [activeMeasure, renderTick]);

  /* ── measure-number labels (opt-in) ──────────────────────────────────
   * Small "1, 2, 3…" labels at the top-left of each measure, sitting above
   * the stave so they don't collide with notes or chord labels. */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.m-num').forEach((n) => n.remove());
    if (!showMeasureNumbers) return;
    const rects = measureRectsRef.current;
    // Convention: anacrusis (pickup) is NOT numbered. Measure 1 begins on the
    // first DOWNBEAT-aligned bar. Skip the anacrusis when assigning numbers.
    let mNum = 0;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const isPickup = !!data.measures[i]?.anacrusis;
      if (!isPickup) mNum++;
      const label = isPickup ? '' : String(mNum);
      if (!label) continue;
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('class', 'm-num');
      txt.setAttribute('x', String(r.x + 2));
      txt.setAttribute('y', String(r.y + 6));
      txt.setAttribute('font-family', "'Pretendard', sans-serif");
      txt.setAttribute('font-size', '11');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('fill', '#1565c0');
      txt.textContent = label;
      svg.appendChild(txt);
    }
  }, [data, width, showMeasureNumbers, renderTick]);

  /* ── Break Editor markers (SVG overlay) ───────────────────────────────
   * Mirrors the measure-highlight/number pattern: inject elements straight
   * into the rendered SVG in user-space coords (they scale with the staff
   * automatically). measureRectsRef is populated by the main render effect
   * above; this runs after it and re-runs when break state changes.
   *
   * Measure index === flat chart bar index (noteSheetToChart maps 1 measure →
   * 1 bar), so the (bar, beat) here matches the engine's break gate exactly.
   *
   * Clicking a beat = "play THROUGH this beat, rest after" → the host stores
   * rest-start = clicked + 1; the active (filled) marker is breakBeat - 1. */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.brk-mk, .brk-lbl').forEach((n) => n.remove());

    const beatsPerBar = parseInt((data.timeSignature || '4/4').split('/')[0], 10) || 4;
    const rects = measureRectsRef.current;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const breakBeat = breakBeatForBar(breakPoints ?? [], i); // stored rest-start

      if (breakEditMode) {
        // One clickable quarter-note marker per beat, evenly across the bar.
        for (let b = 0; b < beatsPerBar; b++) {
          const beat = b + 1;
          const cx = r.x + (r.w * (b + 0.5)) / beatsPerBar;
          const cy = r.y + 2;
          const active = breakBeat === beat + 1;

          const g = document.createElementNS(SVG_NS, 'g');
          g.setAttribute('class', 'brk-mk');
          g.setAttribute('transform', `translate(${cx}, ${cy})`);
          g.style.cursor = 'pointer';
          g.setAttribute('opacity', active ? '1' : '0.26');

          // Transparent hit area (bigger than the glyph) for easy clicking.
          const hit = document.createElementNS(SVG_NS, 'rect');
          hit.setAttribute('x', '-9'); hit.setAttribute('y', '-4');
          hit.setAttribute('width', '18'); hit.setAttribute('height', '24');
          hit.setAttribute('fill', 'transparent');
          g.appendChild(hit);

          // Filled notehead + stem (quarter note).
          const head = document.createElementNS(SVG_NS, 'ellipse');
          head.setAttribute('cx', '-1.5'); head.setAttribute('cy', '14');
          head.setAttribute('rx', '3.4'); head.setAttribute('ry', '2.6');
          head.setAttribute('fill', '#1a1a1a');
          head.setAttribute('transform', 'rotate(-20 -1.5 14)');
          g.appendChild(head);
          const stem = document.createElementNS(SVG_NS, 'rect');
          stem.setAttribute('x', '1.3'); stem.setAttribute('y', '1');
          stem.setAttribute('width', '1.3'); stem.setAttribute('height', '12.5');
          stem.setAttribute('fill', '#1a1a1a');
          g.appendChild(stem);

          g.addEventListener('click', (e) => {
            e.stopPropagation();
            onToggleBreak?.(i, beat);
          });
          svg.appendChild(g);
        }
      } else if (breakBeat != null) {
        // "Break (K/4)" label above the bar, out of edit mode.
        const lbl = document.createElementNS(SVG_NS, 'text');
        lbl.setAttribute('class', 'brk-lbl');
        lbl.setAttribute('x', String(r.x + 2));
        lbl.setAttribute('y', String(r.y - 2));
        lbl.setAttribute('font-family', "'Pretendard', sans-serif");
        lbl.setAttribute('font-size', '10.5');
        lbl.setAttribute('font-weight', '700');
        lbl.setAttribute('fill', '#1a1a1a');
        lbl.textContent = `Break (${breakBeat}/${beatsPerBar})`;
        svg.appendChild(lbl);
      }
    }
  }, [data, width, breakEditMode, breakPoints, onToggleBreak, renderTick]);

  /* ── selection highlight (region picker) ──────────────────────────────
   * 요구 스타일: 마디 전체를 투명한 색으로 칠하고 가장자리만 굵은 선.
   * 마디별 사각형을 따로 그리면 이웃 마디 사이에 내부 경계선이 생기므로,
   * 범위를 "같은 줄의 연속 구간" 단위로 병합해 구간당 하나의 rect 를 그린다. */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.m-sel').forEach((n) => n.remove());
    /* 겹치거나 "맞닿은"([2,3]+[4,4]) 범위를 먼저 하나로 병합 — 클릭 토글이
     * 마디별 개별 범위를 쌓기 때문에, 병합 없이는 인접 마디마다 상자가 따로
     * 그려져 경계가 이중선으로 보인다. */
    const merged: Array<[number, number]> = [...(selectedRanges ?? [])]
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
      .sort((x, y) => x[0] - y[0])
      .reduce<Array<[number, number]>>((acc, cur) => {
        const last = acc[acc.length - 1];
        if (last && cur[0] <= last[1] + 1) last[1] = Math.max(last[1], cur[1]);
        else acc.push([...cur] as [number, number]);
        return acc;
      }, []);

    /* 세로 범위: rect.y = 보표 윗선. 코드기호는 baseline y+12(24px)라 위로 약
     * 18px 삐져나오고, 음표·아래 덧줄은 보표 아래로 약 25px 내려간다.
     * → 위는 코드기호까지 덮고, 아래는 짧게 끊는다(예전엔 줄높이 170 전체를
     *   칠해 상자가 통째로 아래로 쏠려 보였다). */
    const SEL_TOP_PAD = 24;   // 보표 윗선 위로
    const SEL_BOT_PAD = 62;   // 보표 윗선 아래로
    const drawSeg = (
      x: number, y: number, w: number,
      openL: boolean, openR: boolean, // 줄바꿈으로 이어지는 쪽은 모서리를 연다
    ) => {
      const top = y - SEL_TOP_PAD;
      const bot = y + SEL_BOT_PAD;
      const right = x + w;
      // 채움: 단순 사각형(가로 테두리를 없앴으므로 모서리 라운드는 무의미).
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      fill.setAttribute('class', 'm-sel');
      fill.setAttribute('x', String(x));
      fill.setAttribute('y', String(top));
      fill.setAttribute('width', String(w));
      fill.setAttribute('height', String(bot - top));
      fill.setAttribute('fill', 'rgba(35, 149, 88, 0.14)');
      fill.setAttribute('stroke', 'none');
      fill.setAttribute('pointer-events', 'none');
      svg.appendChild(fill);
      // 테두리: 세로변만 — 위/아래 가로선은 그리지 않는다(악보 선과 겹쳐 지저분).
      const vline = (vx: number) => {
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        ln.setAttribute('class', 'm-sel');
        ln.setAttribute('d', `M ${vx},${top} L ${vx},${bot}`);
        ln.setAttribute('fill', 'none');
        ln.setAttribute('stroke', '#1f9a52');
        ln.setAttribute('stroke-width', '3');
        ln.setAttribute('stroke-linecap', 'round');
        ln.setAttribute('pointer-events', 'none');
        svg.appendChild(ln);
      };
      if (!openL) vline(x);
      if (!openR) vline(right);
    };

    for (const [lo, hi] of merged) {
      // 같은 y(줄)에 연속으로 붙은 마디들을 한 세그먼트로 묶는다.
      type Seg = { x: number; y: number; w: number };
      const segs: Seg[] = [];
      let cur: Seg | null = null;
      for (let i = Math.max(0, lo); i <= hi; i++) {
        const r = measureRectsRef.current[i];
        if (!r) continue;
        if (cur && r.y !== cur.y) { segs.push(cur); cur = null; }
        if (!cur) cur = { x: r.x, y: r.y, w: 0 };
        cur.w = r.x + r.w - cur.x;
      }
      if (cur) segs.push(cur);
      segs.forEach((s, si) => {
        drawSeg(s.x, s.y, s.w, si > 0, si < segs.length - 1);
      });
    }
  }, [selectedRanges, data, renderTick]);

  /* ── click → toggle / extend selection (admin mode only) ─────────────
   * Every click in select mode toggles a single-measure region:
   *   - click an unselected measure → add new disjoint region
   *   - click an already-selected measure → remove the region containing it
   *   - shift+click → extend the LAST region from its lo as anchor
   *   - click in whitespace → no-op (use the Clear button to wipe all)
   */
  useEffect(() => {
    const host = svgRef.current;
    const svg = host?.querySelector('svg');
    if (!host || !svg || !selectable || !onSelectionChange) return;
    const handler = (e: MouseEvent) => {
      const pt = (svg as SVGSVGElement).createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = (svg as SVGSVGElement).getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      const lineH = unscaledLineHRef.current;
      /* 히트 영역은 보표 윗선 기준 위로 34px(코드기호) ~ 아래로 lineH-34 까지.
       * 예전엔 r.y 부터라 코드기호를 눌러도 아무 마디에도 맞지 않았다. */
      const HIT_UP = 34;
      let hit = -1;
      for (let i = 0; i < measureRectsRef.current.length; i++) {
        const r = measureRectsRef.current[i];
        if (!r) continue;
        if (local.x >= r.x && local.x <= r.x + r.w
            && local.y >= r.y - HIT_UP && local.y <= r.y + lineH - HIT_UP) {
          hit = i;
          break;
        }
      }
      if (hit < 0) return;

      const ranges = selectedRanges ?? [];

      if (e.shiftKey && ranges.length > 0) {
        const last = ranges[ranges.length - 1];
        const anchor = Math.min(last[0], last[1]);
        onSelectionChange([
          ...ranges.slice(0, -1),
          [Math.min(anchor, hit), Math.max(anchor, hit)],
        ]);
        return;
      }

      const containing = ranges.findIndex(([lo, hi]) =>
        hit >= Math.min(lo, hi) && hit <= Math.max(lo, hi),
      );
      if (containing >= 0) {
        onSelectionChange(ranges.filter((_, i) => i !== containing));
      } else {
        onSelectionChange([...ranges, [hit, hit]]);
      }
    };
    /* 리스너는 SVG가 아니라 **컨테이너 div** 에 건다. SVG 루트는 칠해진
     * 도형(음표·보표선·글자)만 히트 테스트 대상이어서, 마디 안 빈 공간을
     * 클릭하면 이벤트가 SVG를 그대로 통과해 아무 일도 일어나지 않았다
     * ("마디가 잘 안 눌러짐"의 실제 원인). 좌표 변환은 그대로 SVG CTM 을 쓴다. */
    host.addEventListener('click', handler);
    return () => { host.removeEventListener('click', handler); };
    /* renderTick 필수: 본 렌더는 async(dynamic vexflow)라 SVG 노드가 통째로
     * 교체된다. 이게 없으면 재렌더 후 예전 SVG 기준으로 좌표를 환산한다. */
  }, [selectable, selectedRanges, onSelectionChange, data, renderTick]);

  /* ── click → seek to measure (playing OR paused; not in selection mode) ── */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg || selectable) return;
    const handler = (e: MouseEvent) => {
      // Seek only when there's a live timeline: actively playing (live jump)
      // or paused (re-seats the resume point for the next play()). Ignored
      // when fully stopped — there's nothing to seek into.
      if (!player.playing && !paused) return;
      const pt = (svg as SVGSVGElement).createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = (svg as SVGSVGElement).getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      const lineH = unscaledLineHRef.current;
      for (let i = 0; i < measureRectsRef.current.length; i++) {
        const r = measureRectsRef.current[i];
        if (!r) continue;
        if (local.x >= r.x && local.x <= r.x + r.w
            && local.y >= r.y && local.y <= r.y + lineH) {
          player.seekToMeasure(i);
          setActiveMeasure(i);
          return;
        }
      }
    };
    (svg as SVGSVGElement).addEventListener('click', handler);
    return () => { (svg as SVGSVGElement).removeEventListener('click', handler); };
  }, [selectable, data, player, paused]);

  /* ── auto-scroll to active measure ────────────────────────────────── */
  useEffect(() => {
    if (activeMeasure < 0) return;
    const r = measureRectsRef.current[activeMeasure];
    const wrap = wrapRef.current;
    if (!r || !wrap) return;

    const headerH = 120; // approx header + transport height
    // r.y는 가상(unscaled) 좌표인데 scrollTop/clientHeight는 실제 CSS px다. 좁은
    // 화면(scale<1)에선 화면상 y = r.y*scale이므로 스케일 비율을 곱해 좌표계를
    // 통일한다(데스크톱은 비율 1 → 무변화). 안 그러면 모바일에서 자동 스크롤이
    // 현재 마디를 1/scale배 지나쳐 내려간다(Fable §4). lineHRef는 이미 스케일값.
    const scale = lineHRef.current / unscaledLineHRef.current;
    const targetY = r.y * scale + headerH;
    const viewH = wrap.clientHeight;
    if (targetY < wrap.scrollTop + 40 || targetY + lineHRef.current > wrap.scrollTop + viewH - 40) {
      wrap.scrollTo({ top: Math.max(0, targetY - viewH / 3), behavior: 'smooth' });
    }
  }, [activeMeasure, renderTick]);

  /* ── track container width ────────────────────────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) {
        // padding (SvgContainer 좌우) + scrollbar 여유
        const pad = w <= 960 ? 12 : 56;
        setWidth(w - pad);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── render notation ──────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    const elOuter = svgRef.current;
    if (!elOuter || !data.measures.length) return;
    void __ensureVexflow().then(() => {
      if (cancelled) return;
      elOuter.innerHTML = '';
      renderNotation(elOuter);
      setRenderTick((t) => t + 1); // overlays re-run against the new SVG
    });
    return () => { cancelled = true; };

    function renderNotation(el: HTMLDivElement) {

    /* 양손(그랜드 스태프) 여부는 **데이터가 결정한다** — OMR MusicXML `<staves>2`
     * 로 파싱된 결과가 `bassMeasures` 로 들어온다. 사용자에게 묻지 않는다. */
    const grand = Array.isArray(data.bassMeasures) && data.bassMeasures.length > 0;
    const layout = getBarLayout(width, grand);
    /* ── 다중 스태프(자유 조합) — staves[0] 은 measures/bassMeasures 미러라
     * 기존 파이프라인이 그대로 그리고, staves[1..] 만 아래 행으로 쌓는다.
     * (뷰어 v1 한계: 첫 파트가 TAB 이면 표준 오선으로, 드럼이면 퍼커션 매핑으로
     *  폴백 — 에디터가 정본 표시를 담당한다.) */
    const vStaves: SheetStaff[] = data.staves && data.staves.length > 0 ? sheetToStaves(data) : [];
    const vExtras = vStaves.slice(1);
    const v0Kind = vStaves[0]?.kind ?? (grand ? 'grand' : 'treble');
    const VIEW_ROW_NOTATION = 92;
    const VIEW_ROW_TAB = 118;
    const extraRowH = (st: SheetStaff): number =>
      st.kind === 'grand' ? VIEW_ROW_NOTATION * 2
      : isTabKind(st.kind)
        ? (st.withNotation ? VIEW_ROW_NOTATION : 0) + (st.chordDiagrams ? VIEW_DIAGRAM_H : 0) + VIEW_ROW_TAB
      : VIEW_ROW_NOTATION;
    const extrasH = vExtras.reduce((a, st) => a + extraRowH(st), 0);
    const lineH = layout.lineH + extrasH;
    const explicitAccPre = data.accidentalStyle === 'explicit';
    /* part0 드럼은 main 루프에서 공용 빌더(buildDrumNote)가 GM 키 → 표준
     * 표기(per-key 노트헤드·손/발 스템·고스트 괄호·열린 하이햇 ○)로 그린다.
     * 예전의 "keys 를 미리 바꿔치기" 방식은 화음 전체에 한 노트헤드를 강제하고
     * 킥 방향도 잃었다. */
    const dispMeasures: MeasureInfo[] = data.measures;
    const vTabPos = vExtras.map((st) => (isTabKind(st.kind)
      ? assignTabPositions(
          resolveSheetMidis(st.measures, data.key ?? 'C', explicitAccPre ? 'explicit' : 'score'),
          tabTuningFor(st.kind, st),   // 카포·튜닝 프리셋 반영
          // 에디터에서 지정한 수동 운지(tabStrings)도 뷰어가 그대로 존중한다.
          st.measures.map((mm) => mm.notes.map((n) => n.tabStrings ?? null)),
        )
      : null));
    lineHRef.current = lineH * layout.scale;
    unscaledLineHRef.current = lineH;
    // Render at virtual (unscaled) size, then CSS-scale down
    const renderW = width / layout.scale;
    const totalW = renderW - MARGIN.left - MARGIN.right;
    /* 강제 줄바꿈(measure.lineBreak) — 플래그 지점에서 분절 패킹(에디터와 동일). */
    const lines: number[][] = [];
    {
      let segStart = 0;
      const flush = (endEx: number) => {
        if (endEx <= segStart) return;
        const packed = packLines(dispMeasures.slice(segStart, endEx), totalW,
          segStart === 0 ? layout.decorFirst : layout.decorOther, layout.decorOther);
        for (const ln of packed) lines.push(ln.map((i2) => i2 + segStart));
        segStart = endEx;
      };
      for (let i2 = 0; i2 < dispMeasures.length; i2++) {
        if (dispMeasures[i2].lineBreak) flush(i2 + 1);
      }
      flush(dispMeasures.length);
    }
    const numLines = lines.length;
    /* 코드 글자 자리 확보 — 에디터와 **같은 규칙**(chordRowLayout). 고음이 있는
     * 줄은 그만큼 아래로 밀어 윗줄 침범을 원천 차단한다.
     * 기준값: VexFlow 는 Stave 원점과 오선 첫 줄 사이를 40 비우므로(space_above_
     * staff_ln 4칸), 기본 baseline(y+12)은 첫 줄보다 28 위. 글자는 baseline 위로
     * 폰트 크기(24)만큼 올라간다 → 기본 확보량 52. */
    const chordMetrics = { rowH: 24, staffGap: 28, noteGap: 4 };
    const lineHeadrooms = lines.map((idxs) =>
      lineHeadroom(idxs.map((i2) => dispMeasures[i2]?.notes ?? []), 10, chordMetrics, 'treble'));
    /* 양손 두 보표 간격 — 에디터와 **같은 규칙**(grandStaffLayout). */
    const lineBassDy = lines.map((idxs) => (grand
      ? grandStaffDy(
          idxs.map((i2) => dispMeasures[i2]?.notes ?? []),
          idxs.map((i2) => data.bassMeasures?.[i2]?.notes ?? []),
          10,
        )
      : GRAND_BASS_DY));

    /* 줄별 세로 상자 — 에디터와 **같은 모델**(sheetVerticalLayout). 위/아래를 한
     * 식으로 재서 이웃 줄과 겹치지 않는 간격을 구한다. */
    const lineBoxes: LineBox[] = lines.map((idxs, li2) => {
      const tExt = staffExtent(idxs.map((i2) => dispMeasures[i2]?.notes ?? []), 10, 'treble');
      const bExt = grand
        ? staffExtent(idxs.map((i2) => data.bassMeasures?.[i2]?.notes ?? []), 10, 'bass')
        : NO_EXTENT;
      /* 가사는 오선 아래로 뻗는다 — 절 수만큼 자리를 잡아야 아랫줄과 겹치지 않는다.
       * 표시가 꺼져 있으면 자리도 잡지 않는다(빈 여백이 남지 않게). */
      const lyricH = lyricsOn
        ? lyricHeight(maxVerseCount(idxs.map((i2) => dispMeasures[i2] ?? { notes: [] })))
        : 0;
      return {
        chordRow: lineHeadrooms[li2] ?? 0,
        above: tExt.above,
        bottomLine4: (grand ? lineBassDy[li2] : 0) + SPACE_ABOVE + 4 * 10 + extrasH,
        below: (grand ? bExt.below : tExt.below) + lyricH,
      };
    });
    const lineOriginY = lineOrigins(lineBoxes, lineH, MARGIN.top);
    const totalH = sheetHeight(lineBoxes, lineOriginY, MARGIN.bottom);

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(renderW, totalH);

    // Apply CSS scale to the SVG
    const svgEl = el.querySelector('svg');
    if (svgEl && layout.scale < 1) {
      svgEl.style.transformOrigin = 'top left';
      svgEl.style.transform = `scale(${layout.scale})`;
      svgEl.style.width = `${renderW}px`;
      svgEl.style.height = `${totalH}px`;
      el.style.width = `${width}px`;
      el.style.height = `${totalH * layout.scale}px`;
      el.style.overflow = 'hidden';
    } else {
      // Reset inline styles when scale is 1 (avoids stuck dimensions on resize)
      if (svgEl) {
        svgEl.style.transform = '';
        svgEl.style.width = '';
        svgEl.style.height = '';
      }
      el.style.width = '';
      el.style.height = '';
      el.style.overflow = '';
    }
    // Give the SVG a viewBox matching its native px size. On screen this is a
    // no-op (the width/height attrs still drive layout), but it lets the print
    // stylesheet scale the score to the page width while keeping aspect ratio.
    if (svgEl && !svgEl.getAttribute('viewBox')) {
      svgEl.setAttribute('viewBox', `0 0 ${renderW} ${totalH}`);
    }
    const ctx = renderer.getContext();

    const [numBeats, beatValue] = data.timeSignature.split('/').map(Number);

    // reset measure rects & note element map
    noteElMapRef.current.clear();
    const rects: { x: number; y: number; w: number }[] = [];
    const stavePositions: { x: number; y: number; w: number }[] = [];
    // `keys` mirrors the StaveNote's keys array (post enharmonic conversion).
    // Used by tie/slur drawing to match chord-tone indices across paired notes.
    const allVfNotes: { mi: number; ni: number; vfNote: StaveNote; keys: string[] }[] = [];
    const measureLine = new Map<number, number>();
    const sheetKey = data.key ?? 'C';
    // 조표 무시(explicit): 조표를 그리지 않고 keySig를 비워 마디 안의 임시표만으로
    // 판단한다(조표 없는 악보). 그 외에는 조표+마디 상속(courtesy) 기본.
    const explicitAcc = data.accidentalStyle === 'explicit';
    const keySigAcc = explicitAcc ? new Map<string, 'b' | '#'>() : keySigAccidentals(sheetKey);
    type Acc = 'b' | '#' | 'n' | '##' | 'bb';
    let tieCarryAcc: Map<string, Acc> | undefined;

    for (let li = 0; li < numLines; li++) {
      const indices = lines[li];
      /* 이 줄의 가사 앵커 — 마디를 돌며 모았다가 줄이 끝나면 한 번에 그린다.
       * 낱말 하이픈·멜리스마 선이 **마디선을 넘어** 이어지므로 줄 단위로 처리한다. */
      const lineLyrics: LyricAnchor[] = [];
      const lineNoteXs: number[] = [];
      const isFirstLine = li === 0;
      const isLastLine = li === numLines - 1;
      /* 균등 배치가 아니라 누적 — 코드 글자가 필요로 하는 만큼 줄이 내려간다. */
      const y = lineOriginY[li];
      const bassDy = lineBassDy[li] ?? GRAND_BASS_DY;
      const lineHeadroomPx = lineHeadrooms[li] ?? defaultHeadroom(chordMetrics);
      const decorW = isFirstLine ? layout.decorFirst : layout.decorOther;

      /* ── 코드 심볼 baseline — **줄 단위 공통값** ──────────────────────
       * 마디마다 따로 계산하면 높은 음이 있는 마디만 코드가 위로 밀려, 한 줄
       * 안에서 코드 높이가 들쭉날쭉해진다(실제로 그렇게 보였다). 리드시트
       * 관례대로 **그 줄에서 가장 위로 올라간 마디를 기준**으로 한 줄을 맞춘다
       * (에디터 렌더러가 이미 쓰는 방식과 동일).
       *
       * ⚠️ stave 는 아래 마디 루프에서 만들어지므로 여기선 아직 없다. 모든
       * 마디의 stave y 는 같은 줄이면 동일하므로, 줄 원점 y 로부터 같은
       * 규칙(getYForLine)을 쓰는 임시 Stave 하나로 계산한다. */
      const lineChordY = (() => {
        const probe = new Stave(MARGIN.left, y, 100);
        const getY = (line: number) => probe.getYForLine(line);
        let top = Infinity;
        for (const mi2 of indices) {
          const md = dispMeasures[mi2];
          if (!md) continue;
          top = Math.min(top, chordBaselineY(md.notes, getY, y + 12, { gap: 4, minY: 12 }));
        }
        if (!Number.isFinite(top)) top = y + 12;
        return clampChordTop(top, getY(0), lineHeadroomPx - chordMetrics.rowH);
      })();
      const availForBars = totalW - decorW;

      // Per-bar min widths (more space for dense bars). Distribute the line's
      // available width proportionally; last partial line keeps natural widths.
      const mins = indices.map((i) => measureMinWidth(dispMeasures[i]));
      const totalMin = mins.reduce((a, b) => a + b, 0) || 1;
      const stretch = (isLastLine && indices.length < MAX_PER_LINE)
        ? 1
        : Math.max(1, availForBars / totalMin);
      const barWidths = mins.map((m) => m * stretch);

      let x = MARGIN.left;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLastBar = m === dispMeasures.length - 1;
        const barW = barWidths[j];
        const w = firstInLine ? barW + decorW : barW;

        const measure = dispMeasures[m];

        // track rect for highlighting
        rects[m] = { x, y, w };

        // ── Stave ──
        const stave = new Stave(x, y, w);
        if (firstInLine) {
          if (v0Kind === 'drum') stave.addClef('percussion');
          else {
            const c0 = clefForKind(v0Kind);
            stave.addClef(c0.clef === 'percussion' ? 'treble' : c0.clef, 'default', c0.annotation);
          }
          // VexFlow only accepts plain keys ("G", "Em") — normalise jazz-style
          // strings like "G-maj" / "Eb-min" first or it throws BadKeySignature.
          const vexKey = normalizeVexKey(data.key);
          if (!explicitAcc && vexKey !== 'C' && v0Kind !== 'drum') stave.addKeySignature(vexKey);
          if (isFirstLine) stave.addTimeSignature(data.timeSignature);
        }
        // Mid-piece changes (MusicXML <attributes> emitted mid-stream).
        if (!explicitAcc && measure.key && !firstInLine) {
          stave.addKeySignature(normalizeVexKey(measure.key));
        }
        if (measure.timeSignature) {
          stave.addTimeSignature(measure.timeSignature);
        }
        // Mid-piece clef change. We always emit the engraver-requested clef
        // at this measure (a clef set on `firstInLine` already drew the default
        // treble; this overrides it for the rest of the line).
        if (measure.clef && !firstInLine) {
          stave.addClef(measure.clef);
        } else if (measure.clef && firstInLine) {
          // Replace the default 'treble' clef set above.
          // (We already called addClef('treble') unconditionally — VexFlow
          // lets you add another clef; the explicit one wins by order.)
          stave.addClef(measure.clef);
        }
        // Tempo marking — only show for MID-PIECE tempo changes (rare).
        // Initial tempo is intentionally omitted: it overlaps with the
        // first-measure chord label and is already shown in the player bar.
        if (measure.tempo) {
          try {
            stave.setTempo({ duration: 'q', dots: 0, bpm: measure.tempo }, -10);
          } catch (e) { console.warn('tempo marking failed', e); }
        }
        // Repeat / end barlines
        if (measure.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (measure.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
        else if (measure.barline === 'double') stave.setEndBarType(BarlineType.DOUBLE);
        else if (measure.barline === 'end' || isLastBar) stave.setEndBarType(BarlineType.END);
        else if (measure.barline === 'none') stave.setEndBarType(BarlineType.NONE);
        // 리허설 마크 — 마디 시작 위 네모 상자(에디터와 동일 표기).
        if (measure.rehearsal && svgEl) {
          const gR = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const tx = x + (firstInLine ? decorW : 0) + 2;
          const tyTop = y + 2;
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t.setAttribute('x', String(tx + 5)); t.setAttribute('y', String(tyTop + 13));
          t.setAttribute('font-size', '12'); t.setAttribute('font-weight', '800');
          t.setAttribute('font-family', "'Pretendard', sans-serif"); t.setAttribute('fill', '#222');
          t.textContent = measure.rehearsal;
          const rct = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rct.setAttribute('x', String(tx)); rct.setAttribute('y', String(tyTop));
          rct.setAttribute('width', String(10 + measure.rehearsal.length * 8)); rct.setAttribute('height', '18');
          rct.setAttribute('fill', 'none'); rct.setAttribute('stroke', '#222'); rct.setAttribute('stroke-width', '1.4');
          gR.appendChild(rct); gR.appendChild(t);
          svgEl.appendChild(gR);
        }
        // Volta brackets
        if (measure.volta) {
          const v = measure.volta;
          const prevV = m > 0 ? dispMeasures[m - 1]?.volta : undefined;
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

        /* ── 양손: 트레블 아래 베이스 보표 + brace/barline 연결선 ──────────
         * 좌표계(rects/stavePositions)는 트레블 기준을 그대로 유지한다 —
         * 구간 선택·재생 하이라이트·스크롤이 모두 그 값에 걸려 있다. */
        let bassStave: Stave | null = null;
        if (grand) {
          bassStave = new Stave(x, y + bassDy, w);
          if (firstInLine) {
            bassStave.addClef('bass');
            const vexKey = normalizeVexKey(data.key);
            if (!explicitAcc && vexKey !== 'C') bassStave.addKeySignature(vexKey);
            if (isFirstLine) bassStave.addTimeSignature(data.timeSignature);
          }
          if (measure.timeSignature) bassStave.addTimeSignature(measure.timeSignature);
          if (measure.repeatStart) bassStave.setBegBarType(BarlineType.REPEAT_BEGIN);
          if (measure.repeatEnd) bassStave.setEndBarType(BarlineType.REPEAT_END);
          else if (isLastBar) bassStave.setEndBarType(BarlineType.END);
          bassStave.setContext(ctx).draw();
          // 줄 시작에는 brace + 좌측 연결선, 매 마디 끝에는 우측 연결선.
          if (firstInLine) {
            new StaveConnector(stave, bassStave).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
            new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
          }
          new StaveConnector(stave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        }

        /* ── 추가 스태프 행(staves[1..]) — part0 아래로 쌓는다. 마디 폭·barline 은
         * part0 와 동일, voice 는 아래에서 part0 와 한 Formatter 로 정렬한다. */
        const extraRows: Array<{ stave: Stave; vf: (StaveNote | TabNoteT | GhostNoteT)[]; isTab: boolean; tabStems?: boolean; isDrum?: boolean; notes?: NoteInfo[] }> = [];
        if (vExtras.length > 0) {
          let rowY = y + (grand ? bassDy : 0) + VIEW_ROW_NOTATION;
          const mkExtraStave = (spec: { tab: SheetStaff['kind']; staff?: SheetStaff } | { clef: NotationClef; annotation?: '8vb' }, sy: number): Stave => {
            const isTabStave = 'tab' in spec;
            const st: Stave = isTabStave
              ? new TabStave(x, sy, w, { numLines: tabTuningFor(spec.tab, spec.staff).length })
              : new Stave(x, sy, w);
            if (firstInLine) {
              if (isTabStave) (st as TabStaveT).addTabGlyph();
              else {
                st.addClef(spec.clef, 'default', spec.annotation);
                if (spec.clef !== 'percussion' && !explicitAcc) {
                  const vk = normalizeVexKey(data.key);
                  if (vk !== 'C') st.addKeySignature(vk);
                }
              }
              if (isFirstLine && !isTabStave) st.addTimeSignature(data.timeSignature);
            }
            if (measure.repeatStart) st.setBegBarType(BarlineType.REPEAT_BEGIN);
            if (measure.repeatEnd) st.setEndBarType(BarlineType.REPEAT_END);
            else if (isLastBar) st.setEndBarType(BarlineType.END);
            st.setContext(ctx).draw();
            // TAB 글리프는 6줄 기준으로 그려져 4·5줄 보표에선 넘친다 → 높이에 맞춘다.
            if (isTabStave) fitTabClefToStave(svgEl, st, tabTuningFor(spec.tab).length);
            return st;
          };
          for (let vi = 0; vi < vExtras.length; vi++) {
            const st = vExtras[vi];
            const em = st.measures[m] ?? { notes: [] };
            if (st.kind === 'grand') {
              const st1 = mkExtraStave({ clef: 'treble' }, rowY);
              const st2 = mkExtraStave({ clef: 'bass' }, rowY + VIEW_ROW_NOTATION);
              if (firstInLine) {
                try {
                  new StaveConnector(st1, st2).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
                  new StaveConnector(st1, st2).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
                } catch { /* noop */ }
              }
              try { new StaveConnector(st1, st2).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw(); } catch { /* noop */ }
              extraRows.push({ stave: st1, vf: buildExtraRowNotes('grand', em.notes, keySigAcc, explicitAcc, 'treble', null), isTab: false });
              extraRows.push({ stave: st2, vf: buildExtraRowNotes('grand', st.bassMeasures?.[m]?.notes ?? [], keySigAcc, explicitAcc, 'bass', null), isTab: false });
            } else if (isTabKind(st.kind)) {
              if (st.withNotation) {
                // TAB 동반 오선 — 악기 관례 클레프(기타 treble-8vb · 베이스 bass).
                const notationKind: SheetStaff['kind'] =
                  st.kind === 'guitar-tab' ? 'treble-8vb'
                  : (st.kind === 'bass-tab' || st.kind === 'bass5-tab') ? 'bass'
                  : 'treble';
                const nc = clefForKind(notationKind);
                const stN = mkExtraStave({ clef: nc.clef, annotation: nc.annotation }, rowY);
                extraRows.push({
                  stave: stN,
                  vf: buildExtraRowNotes(st.kind, em.notes, keySigAcc, explicitAcc, nc.clef as 'treble' | 'bass' | 'alto' | 'tenor', null, notationKind),
                  isTab: false,
                });
              }
              const dgOff = st.chordDiagrams ? VIEW_DIAGRAM_H : 0;
              const stT = mkExtraStave({ tab: st.kind, staff: st }, rowY + (st.withNotation ? VIEW_ROW_NOTATION : 0) + dgOff);
              if (st.chordDiagrams) {
                const chordTxt = (dispMeasures[m]?.chord ?? '').split(/\s{2,}/)[0]?.trim();
                if (chordTxt) {
                  const dg = viewerCachedDiagram(chordTxt, tabTuningFor(st.kind, st));
                  if (dg && svgEl) {
                    try { drawFretDiagram(svgEl as unknown as SVGElement, x + (firstInLine ? decorW : 0) + 10, stT.getY() - VIEW_DIAGRAM_H + 12, VIEW_DIAGRAM_W, dg, chordTxt); } catch { /* noop */ }
                  }
                }
              }
              extraRows.push({ stave: stT, vf: buildExtraRowNotes(st.kind, em.notes, keySigAcc, explicitAcc, 'treble', vTabPos[vi]?.[m] ?? null, undefined, !st.withNotation, st), isTab: true, tabStems: !st.withNotation, notes: em.notes });
            } else {
              const cf = clefForKind(st.kind);
              const st1 = mkExtraStave({ clef: cf.clef, annotation: cf.annotation }, rowY);
              extraRows.push({
                stave: st1,
                vf: buildExtraRowNotes(st.kind, em.notes, keySigAcc, explicitAcc, (cf.clef === 'percussion' ? 'treble' : cf.clef) as 'treble' | 'bass' | 'alto' | 'tenor', null),
                isTab: false,
                isDrum: st.kind === 'drum',
              });
            }
            rowY += extraRowH(st);
          }
        }

        // ── Notes ──
        measureLine.set(m, li);

        const activeAcc = tieCarryAcc ? new Map(tieCarryAcc) : new Map<string, Acc>();
        tieCarryAcc = undefined;

        // Build vfNotes manually so we can skip grace notes (which become
        // modifiers on the next real note, not standalone tickables).
        // vfNoteIdxOf[i] = vfNotes index for measure.notes[i], or -1 if grace.
        // measureIdxOfVf[j] = measure.notes index for vfNotes[j].
        const vfNotes: StaveNote[] = [];
        const vfNoteIdxOf: number[] = new Array(measure.notes.length).fill(-1);
        const measureIdxOfVf: number[] = [];
        let pendingGraces: GraceNote[] = [];

        for (let mi_ = 0; mi_ < measure.notes.length; mi_++) {
          const n = measure.notes[mi_];
          const isRest = n.duration.endsWith('r');
          const dur = buildDuration(n.duration, n.dotted);

          /* ── 드럼 파트 — 공용 빌더로 전부 처리(노트헤드·스템·고스트·○·악센트).
           * 아래 일반 경로의 임시표·아티큘레이션 처리는 중복이므로 건너뛴다. */
          if (v0Kind === 'drum') {
            if (n.grace) { pendingGraces.push(buildDrumNote(n) as unknown as GraceNote); continue; }
            const dn = buildDrumNote(n);
            if (pendingGraces.length > 0) {
              try { dn.addModifier(new GraceNoteGroup(pendingGraces, false), 0); } catch { /* noop */ }
              pendingGraces = [];
            }
            vfNoteIdxOf[mi_] = vfNotes.length;
            measureIdxOfVf.push(mi_);
            vfNotes.push(dn);
            continue;
          }

          /* 저장된 표기를 그대로 쓴다 — 이명동음 강제 변환 없음.
           *
           * 예전엔 플랫 조성(F 등)에서 저장된 샵을 무조건 플랫으로 바꿔 그렸다
           * (f#/4 → g♭/4). 그 결과 에디터에서 일부러 샵으로 적어 저장한 음이
           * 솔로 DB 화면에선 전부 플랫으로 보여 "저장한 것과 다르게 보이는"
           * 불일치가 생겼다(Charlie Parker - Confirmation 실측: 저장 데이터엔
           * 샵 34개가 그대로 있는데 화면은 전부 플랫). 표기는 작성자의 의도이며
           * 저장값이 곧 정본이므로, 화면이 임의로 리스펠하지 않는다.
           * (수입 데이터의 표기가 나쁘면 그건 임포트 시점에 바로잡을 일이다.) */
          const keys = n.keys;
          const realAcc = n.accidentals?.[0] as Acc | undefined;

          if (n.grace) {
            // Build a GraceNote — not added to vfNotes (not a tickable).
            const g = new GraceNote({
              keys: isRest ? ['b/4'] : keys,
              duration: dur,
              slash: !!n.graceSlash,
            });
            if (n.dotted) Dot.buildAndAttach([g]);
            if (realAcc && !isRest) g.addModifier(new Accidental(realAcc), 0);
            pendingGraces.push(g);
            continue;
          }

          // Explicit stem direction (e.g. MusicXML import preserves the engraver's
          // choice on the middle line / phrase boundaries). Falls back to autoStem.
          // forceAutoStem ignores the source's stem and lets VexFlow decide based on pitch.
          const explicitStemDir = forceAutoStem
            ? undefined
            : n.stem === 'up' ? 1 : n.stem === 'down' ? -1 : undefined;
          const note = explicitStemDir !== undefined && !isRest
            ? new StaveNote({ keys, duration: dur, stemDirection: explicitStemDir, ...ghostHead(n) })
            : new StaveNote({ keys: isRest ? ['b/4'] : keys, duration: dur, autoStem: true, ...ghostHead(n) });
          if (n.dotted) Dot.buildAndAttach([note]);

          // Attach accumulated grace notes (if any) as a GraceNoteGroup modifier.
          if (pendingGraces.length > 0) {
            try {
              const group = new GraceNoteGroup(pendingGraces, false);
              note.addModifier(group, 0);
            } catch (e) { console.warn('grace group failed', e); }
            pendingGraces = [];
          }

          // ── Modifiers from MusicXML import: articulations, fermata,
          //    ornaments, dynamics, grace notes. Renderer/parser-agnostic
          //    so manually-authored notes also pick these up. ──────────
          if (n.articulations) {
            const ART_VF: Record<string, string> = {
              staccato: 'a.', staccatissimo: 'av',
              accent: 'a>', tenuto: 'a-',
              marcato: 'a^', 'detached-legato': 'a-.',
              harmonic: 'ah', 'lh-pizz': 'a+', 'snap-pizz': 'ao',
              'up-bow': 'a|', 'down-bow': 'am',
            };
            // Engraving convention: most articulations (staccato/tenuto/accent)
            // go on the OPPOSITE side of the stem. Marcato by tradition usually
            // sits above. Stem-down note → above (3), stem-up note → below (4).
            // We resolve via the VexFlow note's own stem direction (works for
            // both autoStem and forceAutoStem since StaveNote already decided).
            for (const a of n.articulations) {
              const code = ART_VF[a];
              if (!code) continue;
              const stemUp = note.getStemDirection() === 1;
              // Marcato is conventionally placed above the staff regardless of stem.
              const forceAbove = a === 'marcato';
              const pos = (forceAbove || !stemUp) ? 3 : 4; // 3=above, 4=below
              note.addModifier(new Articulation(code).setPosition(pos), 0);
            }
          }
          if (n.fermata) {
            // Fermata is ALWAYS above (over the staff). Never affected by stem.
            note.addModifier(new Articulation('a@a').setPosition(3), 0);
          }
          if (n.ornaments) {
            // Tremolo is a STEM marking (slashes across the stem), separate
            // from melodic ornaments like trill/mordent/turn (text above note).
            const ORN_VF: Record<string, string> = {
              trill: 'tr', mordent: 'mordent',
              'inverted-mordent': 'mordent_inverted',
              turn: 'turn', 'inverted-turn': 'turn_inverted',
            };
            for (const o of n.ornaments) {
              if (o === 'tremolo') {
                // 3 slashes = 32nd-note tremolo (common jazz/classical default).
                note.addModifier(new Tremolo(3), 0);
                continue;
              }
              const code = ORN_VF[o];
              if (code) note.addModifier(new Ornament(code), 0);
            }
          }
          if (n.dynamics) {
            const ann = new Annotation(n.dynamics);
            ann.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
            note.addModifier(ann, 0);
          }
          if (n.textAbove) {
            // 연주 지시 텍스트(pizz./arco …) — 에디터와 동일 표기(위·이탤릭).
            const ann = new Annotation(n.textAbove);
            ann.setVerticalJustification(AnnotationVerticalJustify.TOP);
            try { ann.setFont('Georgia', 11, 'normal', 'italic'); } catch { /* noop */ }
            note.addModifier(ann, 0);
          }
          // Grace notes — attach a GraceNoteGroup so the grace appears
          // BEFORE this (parent) note. Marked via parent.grace OR by a
          // separate `grace` array we'll add later if needed. Here we
          // skip parent notes that ARE grace (those become group members).

          if (!isRest) {
            // Octave-aware accidental rule — single shared helper
            // (resolveMeasureAccidental), courtesy mode for full scores so an
            // explicit source accidental prints even when it matches the key
            // signature. Iterate EVERY pitch in `keys` so inner chord tones
            // (e.g. {keys:['c/4','eb/4','g/4'], accidentals:{1:'b'}}) resolve too.
            for (let ki = 0; ki < keys.length; ki++) {
              const acc = ki === 0 ? realAcc : (n.accidentals?.[ki] as Acc | undefined);
              const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, keys[ki], acc, { courtesy: !explicitAcc, tied: n.tieKeys ? n.tieKeys.includes(ki) : n.tieContinuation });
              if (glyph) note.addModifier(new Accidental(glyph), ki);
            }
          }
          vfNoteIdxOf[mi_] = vfNotes.length;
          measureIdxOfVf.push(mi_);
          vfNotes.push(note);
        }
        // Trailing graces at end of measure → attach to last real note.
        if (pendingGraces.length > 0 && vfNotes.length > 0) {
          try {
            const group = new GraceNoteGroup(pendingGraces, false);
            vfNotes[vfNotes.length - 1].addModifier(group, 0);
          } catch (e) { console.warn('trailing grace group failed', e); }
          pendingGraces = [];
        }

        // Find last non-grace note for cross-measure tie carry.
        let lastNote: typeof measure.notes[0] | undefined;
        for (let li = measure.notes.length - 1; li >= 0; li--) {
          if (!measure.notes[li].grace) { lastNote = measure.notes[li]; break; }
        }
        if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
          // Carry ALL altered tones of a tied chord — not just keys[0].
          // Modern convention: each (letter+octave) tracks independently.
          const carry = new Map<string, Acc>();
          for (let ki = 0; ki < lastNote.keys.length; ki++) {
            const accForKi = lastNote.accidentals?.[ki] as Acc | undefined;
            if (!accForKi) continue;
            // 저장된 표기 그대로 (위 음표 렌더와 동일 — 이명동음 변환 없음).
            carry.set(lastNote.keys[ki], accForKi);
          }
          if (carry.size > 0) tieCarryAcc = carry;
        }

        for (let ni = 0; ni < vfNotes.length; ni++) {
          const srcIdx = measureIdxOfVf[ni];
          const srcNote = measure.notes[srcIdx];
          // For rests vfNote uses ['b/4']; tie/slur drawing won't use rest keys.
          const srcKeys = srcNote.duration.endsWith('r') ? ['b/4'] : srcNote.keys;
          allVfNotes.push({ mi: m, ni, vfNote: vfNotes[ni], keys: srcKeys });
        }

        if (measure.chord) {
          const barContentX = firstInLine ? x + decorW + 4 : x + 4;
          const barContentW = w - (firstInLine ? decorW : 0) - 8;
          // 덧줄을 타고 올라간 고음이 코드 글자를 뚫지 않도록 baseline 을 위로
          // 밀어 올린다(음높이 기반 — 코드는 voice.draw 보다 먼저 그려서 bbox 를
          // 쓸 수 없다). 보표 안에 머무는 음은 기본 위치 그대로.
          /* 줄 단위 공통 baseline — 이 줄에서 가장 높이 올라간 마디를 기준으로
           * 이미 계산해 뒀다(줄 루프 상단). 마디마다 다시 계산하지 않는다. */
          const chordY = lineChordY;
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

        // ── Beam grouping ──
        // Two modes:
        //   1. Explicit mode (MusicXML import): per-note flags `noBeam` / `beamBreak`
        //      fully describe XML's <beam number="1"> start/continue/end pattern.
        //      A new beam group opens implicitly when we encounter a beamable note
        //      after any flush point (rest, non-beamable, noBeam, beamBreak,
        //      tuplet-bracket transition into a new tuplet). This faithfully
        //      preserves engraver choices like "16th-triplet beamed together with
        //      an adjacent 8th" (very common in Parker's lines).
        //   2. Heuristic mode (manual data): no notes carry explicit beam flags;
        //      group by beat boundary, force-flush N-tuplets at length===N, and
        //      use the prevIs16Triplet/postTupletMerged trick to glue 16th-trip+8th.
        const beams: Beam[] = [];
        let beamGroup: StaveNote[] = [];
        // 투플렛 브래킷 규칙용 빔 멤버십: 투플렛 그룹이 자기 빔과 정확히
        // 일치할 때만 숫자-온리(브래킷 생략)가 허용된다. 더 긴 빔 속에 섞인
        // 투플렛은 브래킷을 강제해 "어느 음까지가 N연음인지"를 명확히 한다.
        const beamOf = new Map<StaveNote, { id: number; size: number }>();
        const pushBeam = (grp: StaveNote[]) => {
          const id = beams.length;
          for (const g of grp) beamOf.set(g, { id, size: grp.length });
          beams.push(new Beam(grp, beamAutoStem));
        };
        // When any note carries an explicit stem direction (MusicXML import),
        // pass auto_stem=false so Beam respects each note's stem_direction
        // rather than averaging pitch positions (which would flip the stems
        // the engraver intentionally chose).
        //
        // forceAutoStem (Omnibook viewer): override the above and let Beam pick
        // a shared direction from pitch — otherwise each note's individual
        // autoStem decision can produce a jagged beam through the noteheads.
        const beamAutoStem = v0Kind === 'drum'
          ? false   // 손(↑)/발(↓) 방향은 빌더가 정한 것이 진실 — 빔이 못 뒤집게
          : (forceAutoStem || !measure.notes.some((nn) => nn.stem !== undefined));
        /* 드럼: 스템 방향이 바뀌는 곳(손↔발)에서 빔을 끊는다 — 통용 표기. */
        const drumDirBreak = (grp: StaveNote[], vn: StaveNote): boolean =>
          v0Kind === 'drum' && grp.length > 0
          && grp[grp.length - 1].getStemDirection() !== vn.getStemDirection();
        const explicitBeamMode = measure.notes.some((nn) => nn.noBeam || nn.beamBreak);

        if (explicitBeamMode) {
          for (let ni = 0; ni < vfNotes.length; ni++) {
            const vn = vfNotes[ni];
            const sourceIdx = measureIdxOfVf[ni];
            const sourceNote = measure.notes[sourceIdx];
            const dur = vn.getDuration();
            const isBeamable = dur === '8' || dur === '16' || dur === '32' || dur === '64' || dur === '128' || dur === '8d' || dur === '16d' || dur === '32d' || dur === '64d';
            const isRest = vn.isRest();

            // Rest-inside-beam: XML beamed *over* this rest (e.g. 16th-rest
            // between two 16ths). Keep the group open and push the rest so
            // VexFlow's Beam draws across it.
            if (isRest && sourceNote?.restInBeam && beamGroup.length > 0) {
              beamGroup.push(vn);
              continue;
            }
            // Rest, non-beamable, or noBeam → flush group.
            if (isRest || !isBeamable || sourceNote?.noBeam) {
              if (beamGroup.length >= 2) pushBeam(beamGroup);
              beamGroup = [];
              continue;
            }

            // Group runs purely on XML's explicit beam markers (beamBreak=end).
            // We DON'T flush at tuplet boundaries — engravers freely beam across
            // tuplet/non-tuplet transitions and even tuplet/tuplet of differing N
            // (e.g. triplet 8ths into 9-tuplet 16ths on one primary beam).

            if (drumDirBreak(beamGroup, vn)) {
              if (beamGroup.length >= 2) pushBeam(beamGroup);
              beamGroup = [];
            }
            beamGroup.push(vn);

            if (sourceNote?.beamBreak) {
              if (beamGroup.length >= 2) pushBeam(beamGroup);
              beamGroup = [];
            }
          }
          if (beamGroup.length >= 2) pushBeam(beamGroup);
        } else {
          // Heuristic mode (legacy auto-beaming for manually-authored licks).
          // 직선 음의 분할 위치는 beamPolicy(절대 박 위치 조판 규칙)가 결정 —
          // 쉼표 뒤 오프비트 런은 박 단위, 정박 8분 4개는 통짜.
          const beamBreaks = computeBeamBreaks(measure.notes, data.timeSignature);
          let inTupletN = 0;
          let postTupletMerged = false;

          for (let ni = 0; ni < vfNotes.length; ni++) {
            const vn = vfNotes[ni];
            const sourceIdx = measureIdxOfVf[ni];
            const tupletN = measure.notes[sourceIdx]?.tuplet ?? 0;
            const isTuplet = tupletN >= 3;
            const dur = vn.getDuration();
            const isBeamable = dur === '8' || dur === '16' || dur === '32' || dur === '64' || dur === '128' || dur === '8d' || dur === '16d' || dur === '32d' || dur === '64d';
            const isRest = vn.isRest();

            if (postTupletMerged && beamGroup.length > 0) {
              if (beamGroup.length >= 2) pushBeam(beamGroup);
              beamGroup = []; postTupletMerged = false;
            }
            if (tupletN !== inTupletN && beamGroup.length > 0) {
              const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
              if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
                postTupletMerged = true;
              } else {
                if (beamGroup.length >= 2) pushBeam(beamGroup);
                beamGroup = [];
              }
            }
            inTupletN = tupletN;

            if (isBeamable && !isRest) {
              if (drumDirBreak(beamGroup, vn)) {
                if (beamGroup.length >= 2) pushBeam(beamGroup);
                beamGroup = [];
              }
              if (!isTuplet && !postTupletMerged && beamGroup.length > 0 && beamBreaks.has(sourceIdx)) {
                if (beamGroup.length >= 2) pushBeam(beamGroup);
                beamGroup = [];
              }
              beamGroup.push(vn);
              if (isTuplet && beamGroup.length === tupletN) {
                pushBeam(beamGroup);
                beamGroup = []; postTupletMerged = false;
                continue;
              }
              if (measure.notes[sourceIdx]?.beamBreak) {
                if (beamGroup.length >= 2) pushBeam(beamGroup);
                beamGroup = []; postTupletMerged = false;
              }
            } else {
              if (beamGroup.length >= 2) pushBeam(beamGroup);
              beamGroup = []; postTupletMerged = false;
            }
          }
          if (beamGroup.length >= 2) pushBeam(beamGroup);
        }

        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        /* 양손이면 두 보표의 voice 를 **한 Formatter 로 묶어** 같은 시간축에
         * 정렬한다(따로 format 하면 좌우가 어긋난다). */
        const bassVfNotes = grand
          ? buildBassStaveNotes(data.bassMeasures?.[m], keySigAcc, explicitAcc)
          : [];
        let bassVoice: Voice | null = null;
        if (grand && bassVfNotes.length > 0) {
          bassVoice = new Voice({ numBeats, beatValue });
          bassVoice.setStrict(false);
          bassVoice.addTickables(bassVfNotes);
        }
        const extraVoices: Voice[] = [];
        for (const row of extraRows) {
          if (row.vf.length === 0) continue;
          const rv = new Voice({ numBeats, beatValue });
          rv.setStrict(false);
          rv.addTickables(row.vf as unknown as StaveNote[]);
          extraVoices.push(rv);
        }
        /* 보이스 2 — 같은 보표의 둘째 성부(기둥 아래). 에디터와 동일 규약. */
        let v2Voice: Voice | null = null;
        let v2Vf: (StaveNote | TabNoteT | GhostNoteT)[] = [];
        if ((measure.voice2?.length ?? 0) > 0) {
          v2Vf = buildExtraRowNotes('treble', measure.voice2!, keySigAcc, explicitAcc, 'treble', null);
          v2Vf.forEach((vn, vi2) => {
            const src = measure.voice2![vi2];
            if (vn instanceof StaveNote && !src?.stem && !src?.duration.endsWith('r')) {
              try { vn.setStemDirection(-1); } catch { /* noop */ }
            }
          });
          vfNotes.forEach((vn, vi2) => {
            const srcNi = measureIdxOfVf[vi2];
            const src = measure.notes[srcNi];
            if (!src?.stem && !src?.duration.endsWith('r')) {
              try { vn.setStemDirection(1); } catch { /* noop */ }
            }
          });
          if (v2Vf.length > 0) {
            v2Voice = new Voice({ numBeats, beatValue });
            v2Voice.setStrict(false);
            v2Voice.addTickables(v2Vf as unknown as StaveNote[]);
          }
        }
        {
          const fmt = new Formatter();
          const allVoices: Voice[] = [voice, ...(bassVoice ? [bassVoice] : []), ...(v2Voice ? [v2Voice] : []), ...extraVoices];
          allVoices.forEach((v) => fmt.joinVoices([v]));
          const allStaves: Stave[] = [stave, ...(bassStave ? [bassStave] : []), ...extraRows.map((r) => r.stave)];
          if (allStaves.length > 1) { try { Stave.formatBegModifiers(allStaves); } catch { /* noop */ } }
          fmt.formatToStave(allVoices, stave);
        }
        voice.draw(ctx, stave);
        /* 가사 앵커 수집 — 포맷이 끝난 뒤라 음표 x 가 확정돼 있다.
         * vfNotes 는 꾸밈음을 제외한 실음 목록이고, measureIdxOfVf 로 원본
         * 음표(가사 보유)를 되찾는다. */
        if (lyricsOn) for (let vi = 0; vi < vfNotes.length; vi++) {
          const srcIdx = measureIdxOfVf[vi];
          const src = srcIdx != null ? measure.notes[srcIdx] : undefined;
          if (!src?.lyrics?.length) continue;
          let cx: number;
          try {
            const bb = vfNotes[vi].getBoundingBox();
            cx = bb.getX() + bb.getW() / 2;
          } catch { cx = vfNotes[vi].getAbsoluteX(); }
          lineLyrics.push({ x: cx, lyrics: src.lyrics });
        }
        for (let vi = 0; vi < vfNotes.length; vi++) {
          try {
            const bb = vfNotes[vi].getBoundingBox();
            lineNoteXs.push(bb.getX() + bb.getW() / 2);
          } catch { /* noop */ }
        }
        if (v2Voice) {
          v2Voice.draw(ctx, stave);
          try {
            Beam.generateBeams(v2Vf.filter((n0) => n0 instanceof StaveNote) as StaveNote[], { maintainStemDirections: true, beamRests: false })
              .forEach((bm) => bm.setContext(ctx).draw());
          } catch { /* noop */ }
        }
        if (bassVoice && bassStave) bassVoice.draw(ctx, bassStave);
        {
          let evi = 0;
          for (const row of extraRows) {
            if (row.vf.length === 0) continue;
            const rv = extraVoices[evi++];
            rv.draw(ctx, row.stave);
            if (row.isTab && row.notes) drawViewerTabTechniques(ctx, row.notes, row.vf);
            if (!row.isTab) {
              try {
                /* 드럼: 손(↑)/발(↓) 스템 방향은 빌더가 정한 것이 진실 —
                 * maintainStemDirections 로 빔이 다시 뒤집지 못하게 한다. */
                Beam.generateBeams(
                  row.vf.filter((n0) => n0 instanceof StaveNote) as StaveNote[],
                  row.isDrum ? { maintainStemDirections: true, beamRests: false } : undefined,
                ).forEach((bm) => bm.setContext(ctx).draw());
              } catch { /* noop */ }
            } else if (row.tabStems) {
              /* standalone TAB — 리듬 스템이 있으니 빔도 그린다(방향 보존). */
              try {
                Beam.generateBeams(
                  row.vf.filter((n0) => n0 instanceof TabNote) as unknown as StaveNote[],
                  { maintainStemDirections: true, beamRests: false },
                ).forEach((bm) => bm.setContext(ctx).draw());
              } catch { /* noop */ }
            }
          }
        }
        beams.forEach((bm) => bm.setContext(ctx).draw());

        // Store SVG elements for note highlighting. Key by the SOURCE note
        // index (measure.notes), NOT the vfNotes array index, so it lines up
        // with the playback highlight events (srcNi) regardless of rests, ties,
        // chords or grace notes — vfNotes includes rests/tie-continuations and
        // excludes graces, so a positional index would drift out of sync.
        for (let ni = 0; ni < vfNotes.length; ni++) {
          const svgNode = vfNotes[ni].getSVGElement();
          if (svgNode) {
            const srcNi = measureIdxOfVf[ni];
            noteElMapRef.current.set(`${m}-${srcNi}`, svgNode as SVGElement);
          }
        }

        // ── Tuplet brackets — any N-tuplet (3, 5, 6, 7, …). Walk measure.notes but
        //    skip graces; map real indices → vfNotes via vfNoteIdxOf.
        //
        //    그룹 완결은 "개수 == N"이 아니라 박자 수학으로 판정한다:
        //    같은 N 이 연속되는 동안 무스케일 박자를 누적해, (누적/N)이 2의
        //    거듭제곱 박자 단위(…1/4, 1/2, 1, 2…)가 되는 지점이 한 브래킷.
        //    → [8분,4분] 3연음(2개 음)이나 [8,8,16,16] 3연음(4개 음)처럼
        //    불균등 분할도 정확히 한 그룹으로 묶인다. 라벨은 그룹 크기가
        //    아니라 선언된 N("3","5",…)을 그대로 쓴다 — 예전 구현은 그룹
        //    크기를 라벨로 써서 [8분,4분] 3연음이 "2"로 찍혔다. ──
        {
          /* 잇단음표 브래킷 — lib/note/tupletBrackets 가 단일 소스(에디터 공용). */
          drawTuplets(
            { notes: measure.notes, vfNotes, vfIndexOf: (i) => vfNoteIdxOf[i], beamOf },
            ctx,
          );
        }

        x += w;
      }

      /* ── 가사 작도 — 줄 단위(하이픈·멜리스마가 마디선을 넘기 때문). ── */
      if (lyricsOn && lineLyrics.length > 0 && svgEl) {
        lineLyrics.sort((p1, p2) => p1.x - p2.x);
        lineNoteXs.sort((p1, p2) => p1 - p2);
        drawLyrics(svgEl, lineLyrics, {
          baselineY: y + SPACE_ABOVE + 4 * 10 + LYRIC_TOP_GAP,
          rightEdge: x - 4,
          noteXs: lineNoteXs,
        });
      }
    }

    // Draw ties
    // NOTE: allVfNotes is indexed by VFNOTES position (excludes graces).
    // Below we walk measure.notes and skip graces, so flatIdx increments
    // 1:1 with allVfNotes regardless of how many graces are in between.
    let flatIdx = 0;
    for (let mi = 0; mi < dispMeasures.length; mi++) {
      const measure = dispMeasures[mi];
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].grace) continue;
        if (measure.notes[ni].tie) {
          const from = allVfNotes[flatIdx];
          const to = allVfNotes[flatIdx + 1];
          if (from && to) {
            // Chord tie: pair every matching pitch (letter+octave) between
            // the two notes. Tying [C/4, E/4, G/4] → [C/4, E/4, G/4] yields
            // three ties simultaneously.
            const firstIndexes: number[] = [];
            const lastIndexes: number[] = [];
            /* 받는 쪽에 `tieKeys` 가 있으면 **그 음들만** 묶는다 — 화음의 일부만
             * 이어지는 보이싱(베이스만 붙잡고 윗성부는 움직임)에서 음높이만 보고
             * 짝지으면 원본에 없는 타이가 더 그려진다. */
            const only = measure.notes[ni + 1]?.tieKeys;
            for (let i = 0; i < from.keys.length; i++) {
              const j = to.keys.indexOf(from.keys[i]);
              if (j < 0) continue;
              if (only && !only.includes(j)) continue;
              firstIndexes.push(i); lastIndexes.push(j);
            }
            if (firstIndexes.length === 0) { firstIndexes.push(0); lastIndexes.push(0); }

            const sameLine = measureLine.get(from.mi) === measureLine.get(to.mi);
            if (sameLine) {
              const tie = new StaveTie({ firstNote: from.vfNote, lastNote: to.vfNote, firstIndexes, lastIndexes });
              tie.setContext(ctx).draw();
            } else {
              // Cross-line tie: draw half-tie at end of from's line (tail off
              // to the right) AND half-tie at start of to's line (lead-in from
              // the left). StaveTie accepts undefined for one of firstNote/
              // lastNote to render an open-ended half curve.
              try {
                const halfStart = new StaveTie({ firstNote: from.vfNote, lastNote: undefined, firstIndexes, lastIndexes });
                halfStart.setContext(ctx).draw();
                const halfEnd = new StaveTie({ firstNote: undefined, lastNote: to.vfNote, firstIndexes, lastIndexes });
                halfEnd.setContext(ctx).draw();
              } catch (e) { console.warn('cross-line tie draw failed', e); }
            }
          }
        }
        flatIdx++;
      }
    }

    // Draw slurs — slurs nest like parentheses: a stop pairs with the most
    // recently opened start (LIFO). Using `pop()` (not `shift()`) handles
    // nested slurs correctly (e.g. an inner phrase mark inside a longer slur).
    // Cross-line slurs render as two half-curves (start → end-of-line,
    // beginning-of-next-line → stop) via VexFlow's Curve(undefined, …) support.
    {
      const startStack: { flatIdx: number }[] = [];
      let flatIdxS = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        const measure = dispMeasures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const n = measure.notes[ni];
          if (n.grace) continue;
          if (n.slurStart) startStack.push({ flatIdx: flatIdxS });
          if (n.slurStop && startStack.length > 0) {
            const start = startStack.pop()!;
            const from = allVfNotes[start.flatIdx];
            const to = allVfNotes[flatIdxS];
            if (from && to) {
              const sameLine = measureLine.get(from.mi) === measureLine.get(to.mi);
              try {
                if (sameLine) {
                  new Curve(from.vfNote, to.vfNote, {}).setContext(ctx).draw();
                } else {
                  // Half-curves on each line.
                  new Curve(from.vfNote, undefined, {}).setContext(ctx).draw();
                  new Curve(undefined, to.vfNote, {}).setContext(ctx).draw();
                }
              } catch (e) { console.warn('slur draw failed', e); }
            }
          }
          flatIdxS++;
        }
      }
    }

    // Draw ottava brackets (8va / 8vb).
    {
      let activeOttava: { kind: '8va' | '8vb' | '15ma' | '15mb'; flatIdx: number } | null = null;
      let flatIdxO = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        const measure = dispMeasures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const n = measure.notes[ni];
          if (n.grace) continue;
          if (n.ottavaStart && !activeOttava) {
            activeOttava = { kind: n.ottavaStart, flatIdx: flatIdxO };
          }
          if (n.ottavaEnd && activeOttava) {
            const from = allVfNotes[activeOttava.flatIdx];
            const to = allVfNotes[flatIdxO];
            if (from && to && measureLine.get(from.mi) === measureLine.get(to.mi)) {
              try {
                const up = activeOttava.kind === '8va' || activeOttava.kind === '15ma';
                const tb = new TextBracket({
                  start: from.vfNote,
                  stop: to.vfNote,
                  text: activeOttava.kind.startsWith('15') ? '15' : '8',
                  superscript: activeOttava.kind === '8va' ? 'va' : activeOttava.kind === '8vb' ? 'vb' : activeOttava.kind === '15ma' ? 'ma' : 'mb',
                  position: up ? TextBracketPosition.TOP : TextBracketPosition.BOTTOM,
                });
                tb.setContext(ctx).draw();
              } catch (e) { console.warn('ottava draw failed', e); }
            }
            activeOttava = null;
          }
          flatIdxO++;
        }
      }
    }

    // Draw hairpins (crescendo < / decrescendo >).
    {
      let activeHairpin: { kind: 'cresc' | 'dim'; flatIdx: number } | null = null;
      let flatIdxH = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        const measure = dispMeasures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const n = measure.notes[ni];
          if (n.grace) continue;
          if (n.hairpinStart) {
            activeHairpin = { kind: n.hairpinStart, flatIdx: flatIdxH };
          }
          if (n.hairpinStop && activeHairpin) {
            const from = allVfNotes[activeHairpin.flatIdx];
            const to = allVfNotes[flatIdxH];
            if (from && to && measureLine.get(from.mi) === measureLine.get(to.mi)) {
              try {
                const type = activeHairpin.kind === 'cresc'
                  ? StaveHairpin.type.CRESC
                  : StaveHairpin.type.DECRESC;
                const hp = new StaveHairpin({ firstNote: from.vfNote, lastNote: to.vfNote }, type);
                hp.setContext(ctx).draw();
              } catch (e) { console.warn('hairpin draw failed', e); }
            }
            activeHairpin = null;
          }
          flatIdxH++;
        }
      }
    }

    // 페달 마킹 — pedalStart(Ped.) ~ pedalEnd(✱), 같은 줄 안에서만(에디터 동일).
    {
      let pedalFrom: number | null = null;
      let pIdx = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        for (const n of dispMeasures[mi].notes) {
          if (n.grace) continue;   // allVfNotes 는 꾸밈음 제외 — 인덱스 미증가
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

    // Draw glissando lines
    const svgElGliss = el.querySelector('svg');
    if (svgElGliss) {
      flatIdx = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        const measure = dispMeasures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          if (measure.notes[ni].grace) continue;
          if (measure.notes[ni].gliss) {
            const from = allVfNotes[flatIdx];
            const to = allVfNotes[flatIdx + 1];
            if (from && to) drawGlissLine(svgElGliss, from.vfNote, to.vfNote);
          }
          flatIdx++;
        }
      }
    }

    // Draw scoop / fall marks (재즈 슬라이드). 에디터(EditorPage)와 **같은 공용
    // 함수**(lib/note/scoopFall)를 써서 두 화면의 표기가 갈리지 않게 한다.
    const svgElSf = el.querySelector('svg');
    if (svgElSf) {
      flatIdx = 0;
      for (let mi = 0; mi < dispMeasures.length; mi++) {
        const measure = dispMeasures[mi];
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const n = measure.notes[ni];
          if (n.grace) continue;
          const entry = allVfNotes[flatIdx];
          if (entry && !n.duration.endsWith('r')) {
            if (n.scoop) drawScoopFall(svgElSf, entry.vfNote, 'scoop');
            if (n.fall) drawScoopFall(svgElSf, entry.vfNote, 'fall');
          }
          flatIdx++;
        }
      }
    }

    // Draw intro brackets — small arcs inside bracketed measures
    const svgElBracket = el.querySelector('svg');
    if (svgElBracket) {
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
        svgElBracket!.appendChild(path);
      };
      let bi = 0;
      while (bi < dispMeasures.length) {
        if (dispMeasures[bi].bracket) {
          const groupStart = bi;
          while (bi < dispMeasures.length && dispMeasures[bi].bracket) bi++;
          const groupEnd = bi - 1;
          const pStart = stavePositions[groupStart];
          const pEnd = stavePositions[groupEnd];
          if (pStart && pEnd) {
            const top = pStart.y + 28;
            const bot = pStart.y + layout.lineH - 50;
            drawArc(pStart.x + 2, top, bot, true);
            drawArc(pEnd.x + pEnd.w * 0.55, top, bot, false);
          }
        } else {
          bi++;
        }
      }
    }

    /* 음이름 라벨 — 모든 음표를 다 그린 뒤 마지막에 얹는다(레이아웃 불변). */
    drawNoteNameLabels(svgEl, allVfNotes, noteNameStyle);

    measureRectsRef.current = rects;
    } // end renderNotation
  }, [data, width, forceAutoStem, noteNameStyle]);

  /* ── line-start measure numbers ───────────────────────────────────────
   * A tiny number at the left edge of each LINE's first bar (note page +
   * solo DB). Defined AFTER the main render effect above so measureRectsRef
   * is already populated when this runs. Lines are detected by a change in
   * the measure rect's y; the anacrusis (pickup) bar is not numbered. */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.m-num-ls').forEach((n) => n.remove());
    if (!lineStartMeasureNumbers) return;
    const rects = measureRectsRef.current;
    let mNum = 0;
    let prevY: number | null = null;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const isPickup = !!data.measures[i]?.anacrusis;
      if (!isPickup) mNum++;
      const isLineStart = prevY === null || Math.abs(r.y - prevY) > 1;
      prevY = r.y;
      if (isPickup || !isLineStart) continue;
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('class', 'm-num-ls');
      txt.setAttribute('x', String(r.x + 2));
      txt.setAttribute('y', String(r.y + 30));
      txt.setAttribute('font-family', "'Pretendard', sans-serif");
      txt.setAttribute('font-size', '8');
      txt.setAttribute('font-weight', '200');
      txt.setAttribute('font-style', 'italic');
      txt.setAttribute('fill', '#9aa0a6');
      txt.textContent = String(mNum);
      svg.appendChild(txt);
    }
  }, [data, width, lineStartMeasureNumbers, renderTick]);

  /* ── close key menu on outside click ──────────────────────────────── */
  useEffect(() => {
    if (!keyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (keyMenuRef.current && !keyMenuRef.current.contains(e.target as Node)) {
        setKeyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [keyMenuOpen]);

  /* ─── render ──────────────────────────────────────────────────────── */

  return (
    <Wrapper ref={wrapRef}>
      {countIn.overlay}
      <FullscreenButton isFullscreen={isFullscreen} onClick={toggleFullscreen} />
      <Header>
        <HeaderLeft>
          <PartStack>
            {/* Part picker — only for multi-part scores; sits directly above
                the key dropdown. */}
            {partOptions && partOptions.length > 1 && onSelectPart && (
              <PartDropdownWrap ref={partMenuRef}>
                <PartButton onClick={() => setPartMenuOpen((v) => !v)}>
                  {partOptions.find((p) => p.id === selectedPartId)?.name ?? '파트'}
                </PartButton>
                {partMenuOpen && (
                  <PartMenu>
                    {partOptions.map((p) => (
                      <PartOption
                        key={p.id}
                        $active={p.id === selectedPartId}
                        onClick={() => { onSelectPart(p.id); setPartMenuOpen(false); }}
                      >
                        {p.name}
                      </PartOption>
                    ))}
                  </PartMenu>
                )}
              </PartDropdownWrap>
            )}
            {selectedKey && allKeys && onKeyChange ? (
              <KeyDropdownWrap ref={keyMenuRef}>
                <KeyButton onClick={() => setKeyMenuOpen((v) => !v)}>
                  {selectedKey}
                </KeyButton>
                {keyMenuOpen && (
                  <KeyMenu>
                    {allKeys.map((k) => (
                      <KeyOption
                        key={k}
                        $active={k === selectedKey}
                        onClick={() => { onKeyChange(k); setKeyMenuOpen(false); }}
                      >
                        {k}
                      </KeyOption>
                    ))}
                  </KeyMenu>
                )}
              </KeyDropdownWrap>
            ) : (
              <span>{data.genre || ''}</span>
            )}
          </PartStack>
        </HeaderLeft>
        <Title>{data.title}</Title>
        <Composer>{data.composer}</Composer>
      </Header>

      <SvgContainer ref={svgRef} $seekable={playing && !selectable} $selecting={selectable} />

      {!hideTransport && (
      <PlayerBar>
        {/* -- Mixer popup — split into Piano / Bass / Drums channel strips.
             Every change writes to the global playerSettings store so other
             players (LickCard, LickRecommend, etc.) pick up the change too. -- */}
          {mixerOpen && (
            <MixerPopup>
              <MixerHeader>
                <span>Mixer</span>
              </MixerHeader>

              {/* Melody (sax/lead) */}
              <MixerSection>
                <MixerSectionTitle>🎵 멜로디</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>볼륨</MixerLabel>
                  <MixerSlider type='range' min='0' max='100'
                    $pct={Math.min(100, melodyVol * 100)}
                    value={Math.round(melodyVol * 100)}
                    onChange={(e) => setPlayerSetting('melodyVolume', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(melodyVol * 100)}</MixerValue>
                </MixerRow>
              </MixerSection>

              {/* Piano — volume + reverb */}
              <MixerSection>
                <MixerSectionTitle>🎹 피아노</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>볼륨</MixerLabel>
                  <MixerSlider type='range' min='0' max='100'
                    $pct={Math.min(100, pianoVol * 100)}
                    value={Math.round(pianoVol * 100)}
                    onChange={(e) => setPlayerSetting('pianoVolume', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(pianoVol * 100)}</MixerValue>
                </MixerRow>
                <MixerRow>
                  <MixerLabel>잔향</MixerLabel>
                  <MixerSlider type='range' min='0' max='100'
                    $pct={Math.round(pianoReverb * 100)}
                    value={Math.round(pianoReverb * 100)}
                    onChange={(e) => setPlayerSetting('pianoReverb', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(pianoReverb * 100)}</MixerValue>
                </MixerRow>
              </MixerSection>

              {/* Bass — volume + walking pattern */}
              <MixerSection>
                <MixerSectionTitle>🎸 베이스</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>볼륨</MixerLabel>
                  <MixerSlider type='range' min='0' max='100'
                    $pct={Math.min(100, bassVol * 100)}
                    value={Math.round(bassVol * 100)}
                    onChange={(e) => setPlayerSetting('bassVolume', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(bassVol * 100)}</MixerValue>
                </MixerRow>
                <MixerRow>
                  <MixerLabel>패턴</MixerLabel>
                  <KitGroup>
                    {(
                      [
                        { id: 'half',       label: '1박/코드' },
                        { id: 'two-feel',   label: '2-feel' },
                        { id: 'four-feel',  label: '4-feel' },
                      ] as { id: BassMode; label: string }[]
                    ).map(({ id, label }) => (
                      <KitBtn
                        key={id}
                        type='button'
                        $active={bassMode === id}
                        onClick={() => setPlayerSetting('bassMode', id)}
                      >
                        {label}
                      </KitBtn>
                    ))}
                  </KitGroup>
                </MixerRow>
              </MixerSection>

              {/* Drums — kit + volume */}
              <MixerSection>
                <MixerSectionTitle>🥁 드럼</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>볼륨</MixerLabel>
                  <MixerSlider type='range' min='0' max='100'
                    $pct={Math.min(100, drumVol * 100)}
                    value={Math.round(drumVol * 100)}
                    onChange={(e) => setPlayerSetting('drumVolume', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(drumVol * 100)}</MixerValue>
                </MixerRow>
                <MixerRow>
                  <MixerLabel>킷</MixerLabel>
                  <KitGroup>
                    {(Object.keys(DRUM_KIT_PRESETS) as DrumKitId[]).map((id) => (
                      <KitBtn key={id} type='button' $active={drumKit === id}
                        onClick={() => setPlayerSetting('drumKit', id)}>
                        {DRUM_KIT_PRESETS[id].label}
                      </KitBtn>
                    ))}
                  </KitGroup>
                </MixerRow>
                {DRUM_KIT_PRESETS[drumKit].attribution && (
                  <AttribLine>{DRUM_KIT_PRESETS[drumKit].attribution}</AttribLine>
                )}
                {drumKitError && (
                  <AttribLine style={{ color: '#ff8a8a' }}>{drumKitError}</AttribLine>
                )}
              </MixerSection>

              {/* Style / genre — drives comp + drum + bass patterns
               *  AND forces straight 8ths when 'bossa'. */}
              <MixerSection>
                <MixerSectionTitle>🎵 스타일</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>장르</MixerLabel>
                  <KitGroup>
                    {(
                      [
                        { id: 'swing', label: 'Swing' },
                        { id: 'bossa', label: 'Bossa Nova' },
                      ] as { id: PlayStyle; label: string }[]
                    ).map(({ id, label }) => (
                      <KitBtn
                        key={id}
                        type='button'
                        $active={playStyle === id}
                        onClick={() => setPlayerSetting('style', id)}
                      >
                        {label}
                      </KitBtn>
                    ))}
                  </KitGroup>
                </MixerRow>
              </MixerSection>

              {/* Metronome */}
              <MixerSection>
                <MixerSectionTitle>⏱ 메트로놈</MixerSectionTitle>
                <MixerRow>
                  <MixerLabel>전원</MixerLabel>
                  <MixToggle $on={metroOn}
                    onClick={() => setPlayerSetting('metroEnabled', !metroOn)}>
                    {metroOn ? 'ON' : 'OFF'}
                  </MixToggle>
                  {metroOn && (
                    <>
                      <MixerSlider type='range' min='0' max='100'
                        $pct={Math.min(100, metroVol * 100)}
                        value={Math.round(metroVol * 100)}
                        onChange={(e) => setPlayerSetting('metroVolume', Number(e.target.value) / 100)} />
                      <MixerValue>{Math.round(metroVol * 100)}</MixerValue>
                    </>
                  )}
                </MixerRow>
              </MixerSection>
            </MixerPopup>
        )}
        {/* Transport */}
        <PlayerRow>
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
          <MixSep />
          <MixToggle $on={mixerOpen} onClick={() => setMixerOpen(v => !v)}>믹서</MixToggle>
        </PlayerRow>
      </PlayerBar>
      )}
    </Wrapper>
  );
});
