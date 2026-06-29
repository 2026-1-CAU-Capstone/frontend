import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
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
  Tuplet as TupletT,
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
type Tuplet = TupletT;
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
let Tuplet: typeof TupletT;
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
  Tuplet = vf.Tuplet;
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
  __vexflowLoaded = true;
}
import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
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
import { formatChordDisplay } from '../../lib/jazz-harmony';
import { resolveMeasureAccidental } from '../../lib/note/measureAccidentals';

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

function splitChordParts(formatted: string): { base: string; ext: string; tension: string; bass?: string } {
  // Slash chord — the bass after '/' is rendered at full size (NOT tension).
  let bass: string | undefined;
  let body = formatted;
  const slashIdx = formatted.indexOf('/');
  if (slashIdx > 0) {
    body = formatted.slice(0, slashIdx);
    bass = formatted.slice(slashIdx);   // includes leading '/'
  }
  const m = body.match(/^(\D*?)(\d+)(.*)$/);
  if (!m) return { base: body, ext: '', tension: '', ...(bass ? { bass } : {}) };
  return { base: m[1], ext: m[2], tension: m[3] || '', ...(bass ? { bass } : {}) };
}

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

  // Render base — split out the diminished sign (°) so it can be drawn at
  // ~1.4x size (raw glyph is too small to read at chord-label sizes).
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
function getBarLayout(containerW: number) {
  // Always render with desktop-size constants
  const decorFirst = 80, decorOther = 40, lineH = 170;
  // Scale factor: shrink proportionally below 800px
  const scale = containerW < 1000 ? Math.max(0.42, containerW / 1000) : 1;
  return { decorFirst, decorOther, lineH, scale };
}

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
function measureBeats(m: MeasureInfo): number {
  let beats = 0;
  for (const n of m.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    let b = DUR_BEATS[base] ?? 1;
    if (n.dotted) b *= 1.5;
    if (n.tuplet && n.tuplet >= 2) {
      const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
      b *= denom / n.tuplet;
    }
    beats += b;
  }
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

function isKeyFlat(rawKey: string): boolean {
  return normalizeVexKey(rawKey) in KS_FLAT_KEYS;
}

/* Enharmonic: sharp → flat (e.g. f#/4 → g/4 with 'b') */
const SHARP_TO_FLAT: Record<string, { letter: string; acc: 'b' }> = {
  'c': { letter: 'd', acc: 'b' },
  'd': { letter: 'e', acc: 'b' },
  'f': { letter: 'g', acc: 'b' },
  'g': { letter: 'a', acc: 'b' },
  'a': { letter: 'b', acc: 'b' },
  // e# → f (natural), b# → c (natural) — not flats
};

function enharmonicToFlat(key: string, _acc: '#'): { key: string; acc: 'b' } | null {
  const [letter, octave] = key.split('/');
  const mapped = SHARP_TO_FLAT[letter];
  if (!mapped) return null; // e# or b# — skip
  return { key: `${mapped.letter}/${octave}`, acc: mapped.acc };
}

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
  background: #fff;

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
  color: #999;

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
  color: #999;

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
  background: #1a1a1a;
  color: #fff;
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
  &:hover { background: #333; }
`;

const PartMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.14);
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
  color: #1a1a1a;
  white-space: nowrap;
  &:hover { background: rgba(0, 0, 0, 0.05); }
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
  background: #fff;
  border: 1.5px solid #ccc;
  border-radius: 5px;
  padding: 5px 14px;
  cursor: pointer;
  font-family: ${CHORD_FONT};
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
  color: #222;
  &:hover { border-color: #888; }
  &::after { content: '▾'; font-size: 0.7em; color: #999; }

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
  background: #fff;
  border: 1px solid #ddd;
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
  background: #1e1e1e;
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
  color: #ccc;
`;

const BpmInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a2a;
  color: #fff;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  &:focus { border-color: #888; }
`;

const MixSep = styled.div`
  width: 1px;
  height: 20px;
  background: #444;
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
  &:hover { border-color: #888; }
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
  background: linear-gradient(180deg, #1d1d1d 0%, #161616 100%);
  border: 1px solid #2a2a2a;
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
  border-bottom: 1px solid #262626;

  & > span {
    font-family: 'Pretendard', sans-serif;
    font-size: 0.74rem;
    font-weight: 700;
    color: #d4d4d4;
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
  &:not(:last-child) { border-bottom: 1px solid #232323; }
`;

const MixerSectionTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  color: #cfcfcf;
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
  color: #888;
  width: 36px;
  flex-shrink: 0;
  white-space: nowrap;
`;

const MixerValue = styled.span`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.68rem;
  color: #9a9a9a;
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
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
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
  background: #161616;
  border: 1px solid #262626;
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
  color: #6e6e6e;
  margin-top: 2px;
  padding: 0 2px;
  text-align: right;
  line-height: 1.2;
`;

const SvgContainer = styled.div<{ $seekable?: boolean }>`
  width: 100%;
  padding: 0 20px 40px;
  ${({ $seekable }) => $seekable && 'cursor: pointer;'}

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
  hideTransport, noPreload, onPlayingChange, onTempoChange,
  breakEditMode = false, breakPoints, onToggleBreak, extraParts,
  partOptions, selectedPartId, onSelectPart,
}, ref) {
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
    const inferred = inferPlayStyle(data.genre);
    if (inferred && inferred !== getPlayerSettings().style) {
      setPlayerSetting('style', inferred);
    }
    const genre = inferGenre(data.genre);
    if (genre && genre !== getPlayerSettings().genre) {
      setPlayerSetting('genre', genre);
    }
  }, [data.genre]);
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
    const unsubBar = player.on('bar', (barIndex) => setActiveMeasure(barIndex));
    const unsubNote = player.on('note', (mi, ni) => highlightNote(mi, ni));
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
      for (const n of firstMeas.notes) {
        const base = n.duration.replace(/[dr]/g, '');
        let b = DUR_BEATS[base] ?? 1;
        if (n.dotted) b *= 1.5;
        if (n.tuplet && n.tuplet >= 2) {
          const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
          b *= denom / n.tuplet;
        }
        const isRest = n.duration.endsWith('r');
        if (!isRest && !n.tieContinuation) {
          const midi = noteToMidi(n.keys[0], n.accidentals?.[0]);
          const when = pickupStart + beatCursor * beatDur;
          const dur = Math.max(b * beatDur * 0.9, 0.04);
          anacrusisNotes.push({ pitch: midi, startAt: when, durationSec: dur });
        }
        beatCursor += b;
      }
      p.scheduleAnacrusis(anacrusisNotes);

      const cin = await countIn.run({ bpm: tempo });
      if (!cin.ok) { p.cancelAnacrusis(); setPlaying(false); return; }
      const strippedData: NoteSheetData = { ...data, measures: data.measures.slice(1) };
      p.setConfig({ bpm: tempo });
      try {
        await p.play({ kind: 'sheet', data: strippedData, extraParts }, { startAt: songStart, measureOffset: 1 });
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
        await p.play({ kind: 'sheet', data, extraParts }, { downbeatInSec: cin.downbeatInSec });
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

  /* ── selection highlight (admin region picker) ────────────────────── */
  useEffect(() => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.m-sel').forEach((n) => n.remove());
    const ranges = selectedRanges ?? [];
    for (const [start, end] of ranges) {
      const lo = Math.max(0, Math.min(start, end));
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) {
        const r = measureRectsRef.current[i];
        if (!r) continue;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'm-sel');
        rect.setAttribute('x', String(r.x));
        rect.setAttribute('y', String(r.y + 10));
        rect.setAttribute('width', String(r.w));
        rect.setAttribute('height', String(unscaledLineHRef.current - 20));
        rect.setAttribute('fill', 'rgba(35, 149, 88, 0.62)');
        rect.setAttribute('stroke', 'rgba(19, 111, 65, 0.95)');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '4');
        svg.insertBefore(rect, svg.firstChild);
      }
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
    const svg = svgRef.current?.querySelector('svg');
    if (!svg || !selectable || !onSelectionChange) return;
    const handler = (e: MouseEvent) => {
      const pt = (svg as SVGSVGElement).createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = (svg as SVGSVGElement).getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      const lineH = unscaledLineHRef.current;
      let hit = -1;
      for (let i = 0; i < measureRectsRef.current.length; i++) {
        const r = measureRectsRef.current[i];
        if (!r) continue;
        if (local.x >= r.x && local.x <= r.x + r.w
            && local.y >= r.y && local.y <= r.y + lineH) {
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
    (svg as SVGSVGElement).addEventListener('click', handler);
    return () => { (svg as SVGSVGElement).removeEventListener('click', handler); };
  }, [selectable, selectedRanges, onSelectionChange, data]);

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

    const layout = getBarLayout(width);
    lineHRef.current = layout.lineH * layout.scale;
    unscaledLineHRef.current = layout.lineH;
    // Render at virtual (unscaled) size, then CSS-scale down
    const renderW = width / layout.scale;
    const totalW = renderW - MARGIN.left - MARGIN.right;
    const lines = packLines(data.measures, totalW, layout.decorFirst, layout.decorOther);
    const numLines = lines.length;
    const totalH = MARGIN.top + numLines * layout.lineH + MARGIN.bottom;

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
    const keySigAcc = keySigAccidentals(sheetKey);
    const useFlats = isKeyFlat(sheetKey);
    type Acc = 'b' | '#' | 'n' | '##' | 'bb';
    let tieCarryAcc: Map<string, Acc> | undefined;

    for (let li = 0; li < numLines; li++) {
      const indices = lines[li];
      const isFirstLine = li === 0;
      const isLastLine = li === numLines - 1;
      const y = MARGIN.top + li * layout.lineH;
      const decorW = isFirstLine ? layout.decorFirst : layout.decorOther;
      const availForBars = totalW - decorW;

      // Per-bar min widths (more space for dense bars). Distribute the line's
      // available width proportionally; last partial line keeps natural widths.
      const mins = indices.map((i) => measureMinWidth(data.measures[i]));
      const totalMin = mins.reduce((a, b) => a + b, 0) || 1;
      const stretch = (isLastLine && indices.length < MAX_PER_LINE)
        ? 1
        : Math.max(1, availForBars / totalMin);
      const barWidths = mins.map((m) => m * stretch);

      let x = MARGIN.left;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLastBar = m === data.measures.length - 1;
        const barW = barWidths[j];
        const w = firstInLine ? barW + decorW : barW;

        const measure = data.measures[m];

        // track rect for highlighting
        rects[m] = { x, y, w };

        // ── Stave ──
        const stave = new Stave(x, y, w);
        if (firstInLine) {
          stave.addClef('treble');
          // VexFlow only accepts plain keys ("G", "Em") — normalise jazz-style
          // strings like "G-maj" / "Eb-min" first or it throws BadKeySignature.
          const vexKey = normalizeVexKey(data.key);
          if (vexKey !== 'C') stave.addKeySignature(vexKey);
          if (isFirstLine) stave.addTimeSignature(data.timeSignature);
        }
        // Mid-piece changes (MusicXML <attributes> emitted mid-stream).
        if (measure.key && !firstInLine) {
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
        else if (isLastBar) stave.setEndBarType(BarlineType.END);
        // Volta brackets
        if (measure.volta) {
          const v = measure.volta;
          const prevV = m > 0 ? data.measures[m - 1]?.volta : undefined;
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

          // Enharmonic: convert sharps to flats in flat keys
          let keys = n.keys;
          let realAcc = n.accidentals?.[0] as Acc | undefined;
          // Enharmonic flat-key conversion: single sharp → flat. Skip double
          // sharps (rare; converting C## → D would mis-spell the note).
          if (!isRest && useFlats && realAcc === '#') {
            const conv = enharmonicToFlat(n.keys[0], '#');
            if (conv) {
              keys = [conv.key];
              realAcc = conv.acc;
            }
          }

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
            ? new StaveNote({ keys, duration: dur, stemDirection: explicitStemDir })
            : new StaveNote({ keys: isRest ? ['b/4'] : keys, duration: dur, autoStem: true });
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
              const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, keys[ki], acc, { courtesy: true });
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
            let tieKey = lastNote.keys[ki];
            let tieAcc: Acc = accForKi;
            if (useFlats && tieAcc === '#') {
              const conv = enharmonicToFlat(tieKey, '#');
              if (conv) { tieKey = conv.key; tieAcc = conv.acc; }
            }
            carry.set(tieKey, tieAcc);
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
          const chordY = y + 12;
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
        // When any note carries an explicit stem direction (MusicXML import),
        // pass auto_stem=false so Beam respects each note's stem_direction
        // rather than averaging pitch positions (which would flip the stems
        // the engraver intentionally chose).
        //
        // forceAutoStem (Omnibook viewer): override the above and let Beam pick
        // a shared direction from pitch — otherwise each note's individual
        // autoStem decision can produce a jagged beam through the noteheads.
        const beamAutoStem = forceAutoStem
          || !measure.notes.some((nn) => nn.stem !== undefined);
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
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
              beamGroup = [];
              continue;
            }

            // Group runs purely on XML's explicit beam markers (beamBreak=end).
            // We DON'T flush at tuplet boundaries — engravers freely beam across
            // tuplet/non-tuplet transitions and even tuplet/tuplet of differing N
            // (e.g. triplet 8ths into 9-tuplet 16ths on one primary beam).

            beamGroup.push(vn);

            if (sourceNote?.beamBreak) {
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
              beamGroup = [];
            }
          }
          if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
        } else {
          // Heuristic mode (legacy auto-beaming for manually-authored licks).
          let groupBeats = 0;
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
            const noteDots = vn.getModifiersByType('Dot')?.length ?? 0;
            let noteBeats = DUR_BEATS[dur.replace('d', '')] ?? 1;
            if (noteDots > 0 || dur.endsWith('d')) noteBeats *= 1.5;

            if (postTupletMerged && beamGroup.length > 0) {
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
              beamGroup = []; groupBeats = 0; postTupletMerged = false;
            }
            if (tupletN !== inTupletN && beamGroup.length > 0) {
              const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
              if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
                postTupletMerged = true;
              } else {
                if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
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
                  if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
                  beamGroup = []; groupBeats = 0;
                }
              }
              beamGroup.push(vn);
              if (!isTuplet) groupBeats += noteBeats;
              if (isTuplet && beamGroup.length === tupletN) {
                beams.push(new Beam(beamGroup, beamAutoStem));
                beamGroup = []; groupBeats = 0; postTupletMerged = false;
                continue;
              }
              if (measure.notes[sourceIdx]?.beamBreak) {
                if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
                beamGroup = []; groupBeats = 0; postTupletMerged = false;
              }
            } else {
              if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
              beamGroup = []; groupBeats = 0; postTupletMerged = false;
            }
          }
          if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, beamAutoStem));
        }

        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
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
        //    skip graces; map real indices → vfNotes via vfNoteIdxOf. ──
        {
          let ti = 0;
          while (ti < measure.notes.length) {
            if (measure.notes[ti].grace) { ti++; continue; }
            const n = measure.notes[ti].tuplet;
            if (n && n >= 3) {
              const startTi = ti; // capture first non-grace index of this tuplet group
              const group: StaveNote[] = [];
              // The first note of the tuplet group carries the bracket preference.
              const bracketAttr = measure.notes[startTi].tupletBracket;
              const tupletNormalFromData = measure.notes[startTi].tupletNormal;
              while (ti < measure.notes.length && measure.notes[ti].tuplet === n && group.length < n) {
                if (measure.notes[ti].grace) { ti++; continue; }
                const vIdx = vfNoteIdxOf[ti];
                if (vIdx >= 0) group.push(vfNotes[vIdx]);
                ti++;
              }
              if (group.length >= 2) {
                const stemDown = group[0].getStemDirection() === -1;
                // Prefer XML-supplied normal-notes (handles unusual ratios
                // like 7:6, 5:3). Fall back to power-of-2 heuristic when
                // the data lacks the explicit denominator.
                const notesOccupied = tupletNormalFromData ?? Math.pow(2, Math.floor(Math.log2(n - 1)));
                const tupletOpts: { numNotes: number; notesOccupied: number; bracketed?: boolean } = {
                  numNotes: group.length, notesOccupied,
                };
                if (bracketAttr !== undefined) tupletOpts.bracketed = bracketAttr;
                const tuplet = new Tuplet(group, tupletOpts);
                if (stemDown) tuplet.setTupletLocation(-1);
                tuplet.setContext(ctx).draw();
              }
            } else { ti++; }
          }
        }

        x += w;
      }
    }

    // Draw ties
    // NOTE: allVfNotes is indexed by VFNOTES position (excludes graces).
    // Below we walk measure.notes and skip graces, so flatIdx increments
    // 1:1 with allVfNotes regardless of how many graces are in between.
    let flatIdx = 0;
    for (let mi = 0; mi < data.measures.length; mi++) {
      const measure = data.measures[mi];
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
            for (let i = 0; i < from.keys.length; i++) {
              const j = to.keys.indexOf(from.keys[i]);
              if (j >= 0) { firstIndexes.push(i); lastIndexes.push(j); }
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
      for (let mi = 0; mi < data.measures.length; mi++) {
        const measure = data.measures[mi];
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
      let activeOttava: { kind: '8va' | '8vb'; flatIdx: number } | null = null;
      let flatIdxO = 0;
      for (let mi = 0; mi < data.measures.length; mi++) {
        const measure = data.measures[mi];
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
                const tb = new TextBracket({
                  start: from.vfNote,
                  stop: to.vfNote,
                  text: activeOttava.kind === '8va' ? '8' : '8',
                  superscript: 'va',
                  position: activeOttava.kind === '8va' ? TextBracketPosition.TOP : TextBracketPosition.BOTTOM,
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
      for (let mi = 0; mi < data.measures.length; mi++) {
        const measure = data.measures[mi];
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

    // Draw glissando lines
    const svgElGliss = el.querySelector('svg');
    if (svgElGliss) {
      flatIdx = 0;
      for (let mi = 0; mi < data.measures.length; mi++) {
        const measure = data.measures[mi];
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
      while (bi < data.measures.length) {
        if (data.measures[bi].bracket) {
          const groupStart = bi;
          while (bi < data.measures.length && data.measures[bi].bracket) bi++;
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

    measureRectsRef.current = rects;
    } // end renderNotation
  }, [data, width, forceAutoStem]);

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

      <SvgContainer ref={svgRef} $seekable={playing && !selectable} />

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
