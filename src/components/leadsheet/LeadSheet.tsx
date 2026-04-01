import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import type {
  LeadSheetData,
  LeadSheetSystem,
  LeadSheetChord,
} from '../../data/leadSheetTypes';
import { FullscreenButton, useFullscreen } from '../common/FullscreenButton';
import { ZoomControls, useZoom } from '../common/ZoomControls';
import { analyzeIsDiatonic, formatKeyDisplay, getRelativeKey } from '../../lib/harmonyAnalyzer';

/* ─── constants ──────────────────────────────────────────────────────────────
 *  BARLINE_PAD = left padding reserved inside every bar cell for the barline.
 *  All four bar cells always have the same padding, so chords stay perfectly
 *  column-aligned regardless of the barline type (normal / section / repeat).
 * ────────────────────────────────────────────────────────────────────────── */
const BARLINE_PAD  = 18;  // px — left padding reserved for barline decoration
const BAR_H        = 78;  // px — row height (snug around chord content)
const BARLINE_GAP  = 6;   // px — vertical inset at top/bottom of each barline
const ROW_GAP      = 46;  // px — space between rows (extra room for bigger labels)
const SECTION_GAP  = 20;  // px — extra space before a new section (A, B, …)
const LABEL_OFFSET = 26;  // px — how far the section label floats above the grid
const CHORD_FONT   = "'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif";
const LABEL_FONT   = "'DM Sans', 'Pretendard', sans-serif"; // gothic for A/B labels

/* ─── transposition ──────────────────────────────────────────────────────── */

const ALL_MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const ALL_MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const FLAT_KEYS = new Set(['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

// pitch-class → [root, accidental]
const PC_FLAT:  [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['D','b'],['D',undefined],['E','b'],['E',undefined],
  ['F',undefined],['G','b'],['G',undefined],['A','b'],['A',undefined],
  ['B','b'],['B',undefined],
];
const PC_SHARP: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['C','#'],['D',undefined],['D','#'],['E',undefined],
  ['F',undefined],['F','#'],['G',undefined],['G','#'],['A',undefined],
  ['A','#'],['B',undefined],
];

function keyToPc(key: string): number {
  // handle e.g. "Bb", "F#", "C", "Cm", "F#m", "Bb-"
  const cleaned = key.replace(/[-m]$/, '');
  const root = cleaned[0];
  const acc = cleaned.length > 1 ? cleaned[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function isMinorKey(key: string): boolean {
  return key.endsWith('-') || key.endsWith('m');
}

function transposeChord(chord: LeadSheetChord, semitones: number, useFlats: boolean): LeadSheetChord {
  if (!chord.root || chord.isRepeat) return chord;

  const table = useFlats ? PC_FLAT : PC_SHARP;
  const rootPc = ((NOTE_TO_PC[chord.root] ?? 0) + (chord.accidental === '#' ? 1 : chord.accidental === 'b' ? -1 : 0) + 12) % 12;
  const newPc = (rootPc + semitones + 12) % 12;
  const [newRoot, newAcc] = table[newPc];

  const result: LeadSheetChord = { ...chord, root: newRoot, accidental: newAcc };

  if (chord.bass) {
    const bassPc = ((NOTE_TO_PC[chord.bass.root] ?? 0) + (chord.bass.accidental === '#' ? 1 : chord.bass.accidental === 'b' ? -1 : 0) + 12) % 12;
    const newBassPc = (bassPc + semitones + 12) % 12;
    const [bRoot, bAcc] = table[newBassPc];
    result.bass = { root: bRoot, accidental: bAcc };
  }

  if (chord.analysis) {
    result.analysis = {
      ...chord.analysis,
      rootPc: newPc,
      bassPc: chord.analysis.bassPc != null ? (chord.analysis.bassPc + semitones + 12) % 12 : undefined,
    };
  }

  return result;
}

function transposeData(data: LeadSheetData, targetKey: string): LeadSheetData {
  const origPc = keyToPc(data.key ?? 'C');
  const targetPc = keyToPc(targetKey);
  const semitones = (targetPc - origPc + 12) % 12;

  // No pitch change needed — just update key label (e.g. relative key switch)
  if (semitones === 0) return { ...data, key: targetKey };

  const cleanTarget = targetKey.replace(/[-m]$/, '');
  const useFlats = FLAT_KEYS.has(cleanTarget);
  return {
    ...data,
    key: targetKey,
    systems: data.systems.map((sys) => ({
      ...sys,
      bars: sys.bars.map((bar) => ({
        ...bar,
        chords: bar.chords.map((ch) => transposeChord(ch, semitones, useFlats)),
      })),
    })),
  };
}

/* ─── page ───────────────────────────────────────────────────────────────── */

const ViewerOuter = styled.div`
  position: relative;
  flex: 1;
  overflow: auto;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  justify-content: center;
  padding: 24px;
  /* container queries — child styled components use cqi units */
  container-type: inline-size;
  container-name: leadsheet;

  &:hover .fullscreen-btn,
  &:hover .zoom-controls {
    opacity: 1;
  }

  &:fullscreen {
    overflow: hidden;
    padding: 0;
  }

  @media (max-width: 600px) {
    padding: 8px;
  }
`;

const Page = styled.div`
  position: relative;
  background: #fff;
  width: 100%;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  border-radius: 4px;
  padding: 36px 32px 48px;
  font-family: ${CHORD_FONT};
  color: #000;

  @media (max-width: 600px) {
    padding: 20px 10px 28px;
    border-radius: 0;
    box-shadow: none;
  }
`;

/* ─── header ─────────────────────────────────────────────────────────────── */

const SheetTitle = styled.h1`
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: clamp(1.6rem, 4.5cqi, 3.0rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0;
  font-family: ${CHORD_FONT};
  pointer-events: none;
`;

const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: clamp(1.0rem, 1.8cqi, 1.3rem);
  font-family: 'DM Sans', sans-serif;
  font-weight: 400;
  margin-bottom: 28px;

  @media (max-width: 600px) {
    margin-bottom: 16px;
    font-size: 0.85rem;
  }
`;

const TitleRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 6px;
`;

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
  font-size: clamp(1.2rem, 2.8cqi, 1.8rem);
  font-weight: 600;
  line-height: 1.3;
  color: #222;
  &:hover { border-color: #888; }

  &::after {
    content: '▾';
    font-size: 0.7em;
    color: #999;
  }
`;

const KeyMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 100;
`;

const KeyGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
`;

const KeySectionLabel = styled.div`
  font-size: 0.65rem;
  font-weight: 600;
  color: #999;
  padding: 4px 4px 2px;
  font-family: ${LABEL_FONT};
  &:first-child { padding-top: 0; }
`;

const KeyOption = styled.button<{ $active?: boolean }>`
  background: ${({ $active }) => $active ? '#333' : 'transparent'};
  color: ${({ $active }) => $active ? '#fff' : '#333'};
  border: none;
  border-radius: 4px;
  padding: 7px 12px;
  cursor: pointer;
  font-family: ${CHORD_FONT};
  font-size: clamp(1.0rem, 1.8cqi, 1.3rem);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  &:hover { background: ${({ $active }) => $active ? '#333' : '#f0f0f0'}; }
`;

/* ─── system row ─────────────────────────────────────────────────────────── */

const SystemRow = styled.div<{ $sectionStart?: boolean }>`
  display: flex;
  align-items: stretch;
  margin-bottom: ${ROW_GAP}px;
  ${({ $sectionStart }) => $sectionStart && `margin-top: ${SECTION_GAP}px;`}
  /* overflow visible so the section label can float above the grid */
  position: relative;
  overflow: visible;

  @media (max-width: 600px) {
    margin-bottom: 28px;
  }
`;

/* Left column: time-sig lives here (only row 1); always same width so that
   the bars grid starts at the same x-position on every row.             */
const LeftMeta = styled.div`
  width: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;

  @media (max-width: 600px) {
    width: 34px;
    padding-right: 2px;
  }
`;

const TimeSig = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 2.6rem;
  font-weight: 700;
  line-height: 1;
  font-family: ${CHORD_FONT};

  @media (max-width: 600px) {
    font-size: 1.5rem;
  }
`;

const TimeSigDivider = styled.div`
  width: 100%;
  height: 2px;
  background: #000;
  margin: 1px 0;
`;

/* ─── bars grid ──────────────────────────────────────────────────────────── */

/* 4 equal columns. Barlines are absolute overlays so they never affect
   the column widths — this is what keeps chords vertically aligned.    */
const BarsGrid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  position: relative; /* anchor for SectionLabel */
`;

const ArrowLayer = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 2;
`;

/* ─── section label ──────────────────────────────────────────────────────── */

/* Floats above the top-left corner of the bars grid */
const SectionLabel = styled.div`
  position: absolute;
  top: -${LABEL_OFFSET}px;
  left: 0;
  background: #000;
  color: #fff;
  font-family: ${LABEL_FONT};
  font-size: clamp(0.75rem, 1.8cqi, 1.1rem);
  font-weight: 800;
  line-height: 1;
  padding: 3px 7px 3px 6px;
  letter-spacing: 0.02em;
  z-index: 3;
`;

/* ─── volta ending bracket ──────────────────────────────────────────────── */

const VOLTA_HEIGHT = 34;

const VoltaBracket = styled.div<{ $cols?: number }>`
  position: absolute;
  top: -${VOLTA_HEIGHT}px;
  left: 0;
  width: ${({ $cols }) => $cols != null ? `${($cols / 4) * 100}%` : '100%'};
  height: ${VOLTA_HEIGHT - 2}px;
  border: 2.5px solid #000;
  border-bottom: none;
  border-right: none;
  pointer-events: none;
  z-index: 3;
`;

const VoltaNumber = styled.span`
  position: absolute;
  top: 2px;
  left: 6px;
  font-family: ${LABEL_FONT};
  font-size: clamp(0.7rem, 1.6cqi, 0.95rem);
  font-weight: 700;
  line-height: 1;
`;

/* ─── bar cell ───────────────────────────────────────────────────────────── */

/* Each bar cell has a left padding equal to BARLINE_PAD.
   display:flex + align-items:center keeps chord content vertically centred
   regardless of BAR_H — barlines are absolute so they always span the full
   cell, giving a uniform line length across every bar in the row.        */
const BarCell = styled.div`
  position: relative;
  min-height: ${BAR_H}px;
  display: flex;
  align-items: center;
  padding: 0 6px 0 ${BARLINE_PAD}px;

  @media (max-width: 600px) {
    min-height: 56px;
    padding: 0 3px 0 12px;
  }
`;

/* Barline decoration area — sits inside the BARLINE_PAD space on the left.
   BARLINE_GAP creates white space above and below so barlines don't touch
   across rows — giving the classic lead-sheet "floating bar" look.       */
const BarlineArea = styled.div`
  position: absolute;
  left: 0;
  top: ${BARLINE_GAP}px;
  bottom: ${BARLINE_GAP}px;
  width: ${BARLINE_PAD}px;
  display: flex;
  align-items: stretch;
`;

/* End barline — on the right edge of the 4th bar cell */
const EndBarlineArea = styled.div`
  position: absolute;
  right: 0;
  top: ${BARLINE_GAP}px;
  bottom: ${BARLINE_GAP}px;
  display: flex;
  align-items: stretch;
`;

/* ─── chord quality normalisation ───────────────────────────────────────────
 * Converts all common chord quality notations (iReal Pro, lead-sheet, etc.)
 * to the standard jazz symbols used on this sheet:
 *
 *   M7 / maj7 / ^7 / Δ7  →  △7   (major-seven triangle)
 *   m  / min  / -        →  -    (minus = minor)
 *   m7 / min7 / -7       →  -7
 *   dim / o              →  °    (degree sign = diminished)
 *   dim7 / o7            →  °7
 *   h  / m7b5 / -7b5     →  ø    (ø = half-diminished)
 *   h7 / m7b5 (with 7)   →  ø7
 *   -maj7 / mMaj7        →  -△7  (minor-major seven)
 *
 * The function only replaces the quality PREFIX; any tensions / alterations
 * that follow (b9, #11, b13 …) are preserved verbatim.
 * ────────────────────────────────────────────────────────────────────────── */

/** [prefix-regex, replacement] pairs – evaluated in order (specific first). */
const QUALITY_PREFIXES: [RegExp, string][] = [
  // ── Half-diminished ──────────────────────────────────────────────────────
  [/^(-7b5|-7\(b5\)|m7b5)/,                         'ø7'],
  [/^h(?=\d)/,                                        'ø'],   // h7 → ø7, h9 → ø9
  [/^h$/,                                             'ø'],   // bare h → ø
  // ── Diminished ───────────────────────────────────────────────────────────
  [/^(dim7|o7)/,                                      '°7'],
  [/^(dim|o)(?!\d)/,                                  '°'],   // o alone (lookahead avoids matching o7 here)
  // ── Minor-Major 7 (before both minor and major checks) ───────────────────
  [/^(-[Mm]aj7|-△7|-Δ7|-\^7|m[Mm]aj7|mM7)/,         '-△7'],
  // ── Major 7 ──────────────────────────────────────────────────────────────
  [/^(Δ7|△7|\^7|[Mm]aj7|M7)/,                        '△7'],
  // ── Major (triad / with extension number) ────────────────────────────────
  [/^(Δ|△|\^|[Mm]aj(?!7)|M(?=[69]|$))/,              '△'],
  // ── Minor 7 (before bare-minor check) ────────────────────────────────────
  [/^(-7(?!b5)|m7(?!b5)|min7)/,                       '-7'],
  // ── Minor (triad / with extension) ───────────────────────────────────────
  [/^(-|m(?!aj|7|in)|min(?!7))/,                      '-'],
];

function normalizeQuality(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  for (const [re, rep] of QUALITY_PREFIXES) {
    const match = s.match(re);
    if (match) return rep + s.slice(match[0].length);
  }
  return s;
}

/* ─── bar section layout ─────────────────────────────────────────────────────
 *  A bar is always divided into 2 equal SECTIONS (half-note units in 4/4).
 *  Each section holds 1 or 2 chords.  When a section holds 2 chords the
 *  chord symbols are scaled down ($compact) so they fit comfortably.
 * ────────────────────────────────────────────────────────────────────────── */

/** Split a bar's chord array into [section1, section2]. */
function splitSections(chords: LeadSheetChord[]): [LeadSheetChord[], LeadSheetChord[]] {
  const n = chords.length;
  if (n <= 1) return [chords, []];          // single chord: full-width
  const mid = Math.floor(n / 2);            // 2→[1,1]  3→[1,2]  4→[2,2]
  return [chords.slice(0, mid), chords.slice(mid)];
}

/* Two equal columns, one per section */
const BarSections = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  width: 100%;
`;

/* One section slot: when 2 chords share a half-bar, use grid to give
 * each chord exactly 50 % of the slot width. */
const SectionSlot = styled.div<{ $squeeze?: boolean }>`
  display: ${({ $squeeze }) => $squeeze ? 'grid' : 'flex'};
  ${({ $squeeze }) => $squeeze
    ? 'grid-template-columns: 1fr 1fr; transform: scaleX(0.88); transform-origin: left center; & > :nth-child(2) { padding-left: 20px; }'
    : 'gap: 3px;'}
  align-items: flex-end;
`;

/* ─── chord symbol ───────────────────────────────────────────────────────── */

const ChordWrap = styled.span<{ $nonDiatonic?: boolean; $modal?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  line-height: 1;
  color: ${({ $nonDiatonic, $modal }) =>
    $modal       ? '#7B3FB0' :
    $nonDiatonic ? '#c62828' : '#000'};
`;

/* $size controls chord symbol scale:
 *   'full'    — 1 chord fills the whole bar
 *   'split'   — 1 chord per half-bar (2-chord bar, each gets its own half)
 *   'compact' — 2 chords share one half-bar slot (3-4 chord bars)
 * All sizes use clamp(min, X cqi, max) relative to the leadsheet container. */
type ChordSize = 'full' | 'split' | 'compact';

const Root = styled.span<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(1.0rem, 3.7cqi, 2.2rem)' :
    $size === 'split'   ? 'clamp(1.2rem, 4.5cqi, 2.8rem)' :
                          'clamp(1.5rem, 5.8cqi, 3.5rem)'};
  font-weight: 700;
  line-height: 0.88;
  letter-spacing: -0.01em;
  font-family: ${CHORD_FONT};
`;

/* ── AccQualStack: stacks accidental (top) + quality (bottom) ────────────
 * By sharing one horizontal slot the quality never drifts right when an
 * accidental is present (e.g. C♯-7 vs C-7 stay visually aligned).       */
const AccQualStack = styled.span`
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
  align-self: stretch;  /* matches Root height → acc at top, quality at bottom */
`;

/* Top-slot wrapper — always rendered; holds Acc when present, empty otherwise */
const AccTopSlot = styled.span`
  line-height: 1;
`;

const Acc = styled.span<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.55rem, 1.9cqi, 1.1rem)' :
    $size === 'split'   ? 'clamp(0.65rem, 2.3cqi, 1.4rem)' :
                          'clamp(0.8rem,  3.0cqi, 1.8rem)'};
  font-weight: 700;
  font-family: ${CHORD_FONT};
  line-height: 1;
`;

const Quality = styled.span<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.6rem,  1.8cqi, 1.1rem)' :
    $size === 'split'   ? 'clamp(0.75rem, 2.2cqi, 1.4rem)' :
                          'clamp(0.9rem,  2.9cqi, 1.7rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
  padding-bottom: 1px;
`;

const TensionSpan = styled.span<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.35rem, 1.2cqi, 0.7rem)' :
    $size === 'split'   ? 'clamp(0.38rem, 1.3cqi, 0.85rem)' :
                          'clamp(0.45rem, 1.6cqi, 1.0rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
`;

const SlashBass = styled.span<{ $size?: ChordSize }>`
  position: absolute;
  left: 8px;
  top: 100%;
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.6rem, 1.8cqi, 1.05rem)' :
    $size === 'split'   ? 'clamp(0.7rem, 2.1cqi, 1.2rem)' :
                          'clamp(0.8rem, 2.4cqi, 1.45rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
  white-space: nowrap;
`;

/* ─── quality string → [base, tensions] ─────────────────────────────────────
 * After normalisation, optional tension tokens (b5 #5 b9 #9 #11 b13 alt …)
 * that trail the base quality are split off for lighter rendering.          */
function splitQuality(normalized: string): [base: string, tensions: string] {
  // Base is: optional quality char(s) + optional extension number + optional sus
  // Tensions: one or more of (b|#)<digits> or 'alt', optionally in parens
  const m = normalized.match(
    /^(△7?|-7?|°7?|ø7?|-△7?|[0-9]+(?:sus[24]?)?|sus[24]?|add\d+)?(.*)/,
  );
  if (m) {
    const base = m[1] ?? normalized;
    const rest = (m[2] ?? '').replace(/[()]/g, ''); // strip optional parens
    if (rest && /^(?:[b#]\d+|alt)+$/.test(rest)) {
      return [base, rest];
    }
  }
  return [normalized, ''];
}

/* ─── resolve repeats ────────────────────────────────────────────────────────
 *  Replace every { isRepeat: true } with the actual previous chord.
 *  After this pass no chord carries isRepeat — rendering and detection
 *  can treat every slot as a real chord symbol.
 * ────────────────────────────────────────────────────────────────────────── */

function resolveRepeats(data: LeadSheetData): LeadSheetData {
  let prevBar: LeadSheetChord[] = [];
  let prevChord: LeadSheetChord | null = null;

  const resolved = {
    ...data,
    systems: data.systems.map((system) => ({
      ...system,
      bars: system.bars.map((bar) => {
        // Snapshot prevBar BEFORE this bar so bar-repeat references the
        // bar that came before this one, not one overwritten by bar 0.
        const snapshotPrevBar = prevBar;

        // Single isRepeat in a bar = bar repeat (copy entire previous bar)
        if (bar.chords.length === 1 && bar.chords[0].isRepeat && snapshotPrevBar.length > 0) {
          const copied = snapshotPrevBar.map(({ isRepeat: _, id: __, ...rest }) => rest);
          // Don't update prevBar — next bar repeat should copy the same source
          prevChord = copied[copied.length - 1] ?? null;
          return { ...bar, chords: copied };
        }
        // Otherwise resolve individual repeat chords
        const chords = bar.chords.map((chord) => {
          if (chord.isRepeat && prevChord) {
            const { isRepeat: _, id: __, ...rest } = prevChord;
            return rest;
          }
          if (!chord.isRepeat) prevChord = chord;
          return chord;
        });
        // Only update prevBar from bars with real chords (not empty bars)
        const realChords = chords.filter((c) => !c.isRepeat && c.root);
        if (realChords.length > 0) prevBar = chords;
        return { ...bar, chords };
      }),
    })),
  };
  return resolved;
}

/* ─── degree label (rule-based analysis) ─────────────────────────────────── */

const FUNC_COLORS: Record<string, string> = {
  T:  '#388E3C',  // green  — Tonic
  SD: '#1565C0',  // blue   — Subdominant
  D:  '#E64A19',  // orange — Dominant
};

const ChordColumn = styled.div`
  position: relative;
  display: inline-flex;
  align-items: flex-end;
`;

const DegreeLabel = styled.span<{ $color: string; $size?: ChordSize }>`
  position: absolute;
  left: -6px;
  top: -1px;
  transform: translateY(-100%);
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.5rem,  1.5cqi, 0.75rem)' :
    $size === 'split'   ? 'clamp(0.55rem, 1.7cqi, 0.88rem)' :
                          'clamp(0.65rem, 2.0cqi, 1.0rem)'};
  font-family: 'Noto Serif', 'Georgia', 'Times New Roman', serif;
  font-weight: 600;
  font-style: italic;
  color: ${({ $color }) => $color};
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
`;

/* ─── ChordSymbol ─────────────────────────────────────────────────────────── */

interface ChordSymbolProps {
  chord: LeadSheetChord;
  size?: ChordSize;
  systemIndex: number;
  chordKey: string;
  registerEl?: (id: string, el: HTMLSpanElement | null) => void;
  showAnalysis?: boolean;
}

function ChordSymbol({ chord, size = 'full', systemIndex, chordKey, registerEl, showAnalysis = true }: ChordSymbolProps) {
  const isNonDiatonic = showAnalysis && chord.isDiatonic === false;
  const isModal = showAnalysis && !!chord.analysis?.modalInterchange;
  const analysis = chord.analysis;
  const primaryFunc = analysis?.functions?.[0]?.function;
  const secDom = analysis?.secondaryDominant;
  const degreeText = showAnalysis
    ? (secDom?.targetDegree ? `V/${secDom.targetDegree}` : analysis?.degree)
    : undefined;
  const fnColor = FUNC_COLORS[primaryFunc ?? ''] ?? '#888';

  const accChar =
    chord.accidental === '#' ? '♯' :
    chord.accidental === 'b' ? '♭' : null;

  const [base, tensions] = chord.quality
    ? splitQuality(normalizeQuality(chord.quality))
    : ['', ''];

  const hasQuality = !!(base || tensions);

  return (
    <ChordColumn>
      {degreeText && (
        <DegreeLabel $color={fnColor} $size={size}>{degreeText}</DegreeLabel>
      )}
      <ChordWrap
        $nonDiatonic={isNonDiatonic}
        $modal={isModal}
        data-system-index={systemIndex}
        ref={(el) => {
          if (registerEl) {
            registerEl(chordKey, el);
            if (chord.id) registerEl(chord.id, el);
          }
        }}
      >
        <Root $size={size}>{chord.root}</Root>

        {(accChar || hasQuality) && (
          <AccQualStack>
            <AccTopSlot>
              {accChar && <Acc $size={size}>{accChar}</Acc>}
            </AccTopSlot>
            {hasQuality && (
              <Quality $size={size}>
                {base}
                {tensions && <TensionSpan $size={size}>{tensions}</TensionSpan>}
              </Quality>
            )}
          </AccQualStack>
        )}
        {chord.bass && (
          <SlashBass $size={size}>
            /{chord.bass.root}{chord.bass.accidental === '#' ? '♯' : chord.bass.accidental === 'b' ? '♭' : ''}
          </SlashBass>
        )}
      </ChordWrap>
    </ChordColumn>
  );
}

/* ─── barline rendering helpers ──────────────────────────────────────────── */

function NormalLine() {
  return <div style={{ width: '1.5px', background: '#000', alignSelf: 'stretch' }} />;
}

/* section-start: two thin lines (||) */
function SectionStartBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '3px' }}>
      <div style={{ width: '1.5px', background: '#000' }} />
      <div style={{ width: '1.5px', background: '#000' }} />
    </div>
  );
}

/* repeat-start: thick | thin  ●
 *                             ●                                           */
function RepeatStartBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
      <div style={{ width: '4px',   background: '#000' }} />
      <div style={{ width: '1.5px', background: '#000', marginLeft: '2px' }} />
      <div style={{
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '7px', paddingLeft: '3px',
      }}>
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
      </div>
    </div>
  );
}

/* repeat-end:  ●  thin | thick */
function RepeatEndBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '7px', paddingRight: '3px',
      }}>
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
      </div>
      <div style={{ width: '1.5px', background: '#000', marginRight: '2px' }} />
      <div style={{ width: '4px',   background: '#000' }} />
    </div>
  );
}

/* double end: thin | thick */
function DoubleEndBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '2px' }}>
      <div style={{ width: '1.5px', background: '#000' }} />
      <div style={{ width: '4px',   background: '#000' }} />
    </div>
  );
}

type LeftBarlineKind = 'normal' | 'section-start' | 'repeat-start';

function LeftBarline({ kind }: { kind: LeftBarlineKind }) {
  if (kind === 'repeat-start')  return <RepeatStartBarline />;
  if (kind === 'section-start') return <SectionStartBarline />;
  return <NormalLine />;
}

/* ─── SystemRowComponent ─────────────────────────────────────────────────── */

interface SystemRowProps {
  system: LeadSheetSystem;
  isFirst: boolean;
  timeSignature: string;
  systemIndex: number;
  registerChordEl: (id: string, el: HTMLSpanElement | null) => void;
  registerSystemEl: (index: number, el: HTMLDivElement | null) => void;
  registerGridEl: (index: number, el: HTMLDivElement | null) => void;
  showAnalysis?: boolean;
}

function SystemRowComponent({
  system,
  isFirst,
  timeSignature,
  systemIndex,
  registerChordEl,
  registerSystemEl,
  registerGridEl,
  showAnalysis = true,
}: SystemRowProps) {
  const [top, bot] = timeSignature.split('/');

  // Determine left barline style for the first bar of this row
  const firstBarlineKind: LeftBarlineKind =
    system.hasRepeatStart   ? 'repeat-start'  :
    (isFirst || system.sectionLabel) ? 'section-start' : 'normal';

  return (
    <SystemRow ref={(el) => registerSystemEl(systemIndex, el)} $sectionStart={!isFirst && !!system.sectionLabel}>
      {/* ── left meta (time sig, first row only) ── */}
      <LeftMeta>
        {isFirst && (
          <TimeSig>
            <span>{top}</span>
            <TimeSigDivider />
            <span>{bot}</span>
          </TimeSig>
        )}
      </LeftMeta>

      {/* ── bars grid ── */}
      <BarsGrid ref={(el) => registerGridEl(systemIndex, el)}>
        {/* Section label floated over the top-left corner */}
        {system.sectionLabel && (
          <SectionLabel>{system.sectionLabel}</SectionLabel>
        )}

        {/* Volta ending brackets — rendered per-bar ending property */}
        {system.bars.map((bar, bi) => {
          if (bar.ending == null) return null;
          // Count how many bars this volta spans (until end of system or next volta)
          let span = 0;
          for (let j = bi; j < system.bars.length; j++) {
            if (j > bi && system.bars[j].ending != null) break;
            span++;
          }
          return (
            <VoltaBracket key={`volta-${bi}`} style={{ left: `${(bi / system.bars.length) * 100}%`, width: `${(span / system.bars.length) * 100}%` }}>
              <VoltaNumber>{bar.ending}.</VoltaNumber>
            </VoltaBracket>
          );
        })}

        {system.bars.map((bar, i) => {
          const isEmpty = bar.chords.length === 0;
          const lastNonEmpty = system.bars.findLastIndex((b: { chords: unknown[] }) => b.chords.length > 0);

          // End barline logic
          let endBarlineType: 'none' | 'repeat-end' | 'normal' = 'none';
          const isLastReal = i === (lastNonEmpty >= 0 ? lastNonEmpty : system.bars.length - 1);
          if (isLastReal) {
            endBarlineType = system.hasRepeatEnd ? 'repeat-end' : 'normal';
          }

          const kind: LeftBarlineKind = i === 0 ? firstBarlineKind : 'normal';

          return (
            <BarCell key={i}>
              {/* Left barline — skip for empty trailing bars */}
              {!isEmpty && (
                <BarlineArea>
                  <LeftBarline kind={kind} />
                </BarlineArea>
              )}

              {/* End barline */}
              {endBarlineType !== 'none' && (
                <EndBarlineArea>
                  {endBarlineType === 'repeat-end' ? <RepeatEndBarline /> : <NormalLine />}
                </EndBarlineArea>
              )}

              {/* Chord content */}
              {(() => {
                const [s1, s2] = splitSections(bar.chords);
                const mid = s1.length;
                // 1 chord: full bar, full size
                if (s2.length === 0) {
                  return s1.map((chord, j) => (
                    <ChordSymbol key={j} chord={chord} size='full' chordKey={`${systemIndex}-${i}-${j}`} systemIndex={systemIndex} registerEl={registerChordEl} showAnalysis={showAnalysis} />
                  ));
                }
                // 2+ chords: two half-bar sections
                // — slot has 1 chord → 'split' (half-bar sized)
                // — slot has 2 chords → 'compact' (two per half)
                return (
                  <BarSections>
                    <SectionSlot $squeeze={s1.length > 1}>
                      {s1.map((chord, j) => (
                        <ChordSymbol key={j} chord={chord} size='full' chordKey={`${systemIndex}-${i}-${j}`} systemIndex={systemIndex} registerEl={registerChordEl} showAnalysis={showAnalysis} />
                      ))}
                    </SectionSlot>
                    <SectionSlot $squeeze={s2.length > 1}>
                      {s2.map((chord, j) => (
                        <ChordSymbol key={j} chord={chord} size='full' chordKey={`${systemIndex}-${i}-${mid + j}`} systemIndex={systemIndex} registerEl={registerChordEl} showAnalysis={showAnalysis} />
                      ))}
                    </SectionSlot>
                  </BarSections>
                );
              })()}
            </BarCell>
          );
        })}
      </BarsGrid>
    </SystemRow>
  );
}

/* ─── LeadSheet (public) ─────────────────────────────────────────────────── */

interface LeadSheetProps {
  data: LeadSheetData;
  showAnalysis?: boolean;
}

interface ArrowPathSegment {
  d: string;
  markerEnd?: boolean;
}

interface ResolvedArrow {
  key: string;
  segments: ArrowPathSegment[];
}

interface HighlightRect {
  key: string;
  spanKey: string;  // groups all rects from the same 2-5-1 span
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  kind: 'major' | 'minor';
  rowPosition: 'only' | 'first' | 'middle' | 'last';
}

function hlBorderRadius(pos: HighlightRect['rowPosition']): string {
  switch (pos) {
    case 'first':  return '4px 0 0 4px';
    case 'last':   return '0 4px 4px 0';
    case 'middle': return '0';
    default:       return '4px';
  }
}

/** Hover border: only left edge of first chord + right edge of last chord. */
function hlHoverBorder(pos: HighlightRect['rowPosition'], hovered: boolean): React.CSSProperties {
  if (!hovered) return {};
  const b = '2px solid #B8860B';
  const tb: React.CSSProperties = { borderTop: b, borderBottom: b };
  switch (pos) {
    case 'first':  return { ...tb, borderLeft: b };
    case 'last':   return { ...tb, borderRight: b };
    case 'middle': return tb;
    default:       return { ...tb, borderLeft: b, borderRight: b }; // single-row
  }
}

interface ArrowSpec {
  key: string;
  sourceChordId: string;
  targetChordId: string;
}

/* ─── ii-V detection ──────────────────────────────────────────────────── */

interface BracketSpec {
  key: string;
  chordId1: string;
  chordId2: string;
}

interface ResolvedBracket {
  key: string;
  d: string;
}

const ROOT_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function chordPitchClass(root: string, accidental?: 'b' | '#'): number {
  const base = ROOT_PC[root] ?? 0;
  if (accidental === '#') return (base + 1) % 12;
  if (accidental === 'b') return (base + 11) % 12;
  return base;
}

/** True when the normalised quality is a dominant-7th type (7, 9, 13 …). */
function isDominant7(q: string): boolean {
  return /^7/.test(q) || /^(9|13)/.test(q);
}

/** True when q is the ii of a major 2-5-1 (must be -7). */
function isMajorII(q: string): boolean { return q.startsWith('-7'); }
/** True when q is the ii of a minor 2-5-1 (must be ø). */
function isMinorII(q: string): boolean { return q.startsWith('ø'); }
/** True when q is a major tonic (Δ7, △, 6, or bare major). */
function isMajorI(q: string): boolean {
  return q === '' || q.startsWith('△') || q === '6' || q.startsWith('maj');
}
/** True when q is a minor tonic (-7, -, -△7, etc. but NOT ø). */
function isMinorI(q: string): boolean {
  return q.startsWith('-') && !q.startsWith('ø');
}

/** Detect ii→V root motion (P4 up). Used for bracket detection — quality-agnostic. */
function isIIV(c1: LeadSheetChord, c2: LeadSheetChord): boolean {
  if (!c1.root || !c2.root || !c1.quality || !c2.quality) return false;
  const q1 = normalizeQuality(c1.quality);
  const q2 = normalizeQuality(c2.quality);
  if ((!isMajorII(q1) && !isMinorII(q1)) || !isDominant7(q2)) return false;
  const pc1 = chordPitchClass(c1.root, c1.accidental);
  const pc2 = chordPitchClass(c2.root, c2.accidental);
  return (pc2 - pc1 + 12) % 12 === 5;
}

/** Auto-detect ii-V pairs within each system row (expects resolved data). */
/**
 * Compute the active volta number for each bar in a system.
 * Once a bar has `ending: N`, all following bars in that system
 * are inside volta N until a different `ending` appears.
 * Returns an array parallel to system.bars (undefined = not inside any volta).
 */
function getActiveVoltas(system: LeadSheetSystem): (number | undefined)[] {
  let active: number | undefined;
  return system.bars.map((bar) => {
    if (bar.ending != null) active = bar.ending;
    return active;
  });
}

/** True when two volta values represent a cross-volta boundary.
 *  undefined→1 is OK (bars before volta lead into volta 1).
 *  1→2 is a boundary (volta 1 and 2 never play consecutively). */
function isVoltaBoundary(a?: number, b?: number): boolean {
  if (a == null || b == null) return false; // no-volta ↔ any volta is fine
  return a !== b;
}

function detectIIVBrackets(data: LeadSheetData): BracketSpec[] {
  const brackets: BracketSpec[] = [];

  for (let si = 0; si < data.systems.length; si++) {
    const system = data.systems[si];
    const voltas = getActiveVoltas(system);
    const items: { chord: LeadSheetChord; key: string; volta?: number }[] = [];

    for (let bi = 0; bi < system.bars.length; bi++) {
      const bar = system.bars[bi];
      if (bar.chords.length > 2) continue;
      for (let ci = 0; ci < bar.chords.length; ci++) {
        items.push({ chord: bar.chords[ci], key: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }

    for (let i = 0; i < items.length - 1; i++) {
      // Don't match across different volta brackets
      if (isVoltaBoundary(items[i].volta, items[i + 1].volta)) continue;
      if (isIIV(items[i].chord, items[i + 1].chord)) {
        brackets.push({
          key: `iiv-${items[i].key}`,
          chordId1: items[i].key,
          chordId2: items[i + 1].key,
        });
      }
    }
  }

  return brackets;
}

/** A continuous highlight span covering one ii-V-I progression. */
interface IIVISpan {
  chordKeys: string[];              // ordered chord keys from ii through I
  label: string;                    // e.g. "G Minor 2-5-1"
  kind: 'major' | 'minor';
}

/** Detect ii-V-I across the entire song (cross-row).
 *  Consecutive duplicate chords are collapsed so resolved repeats don't
 *  break pattern matching. The I chord key is the actual occurrence that
 *  immediately follows V in sequence (not the first group occurrence),
 *  ensuring cross-row resolution is always highlighted correctly. */
function detectIIVI(data: LeadSheetData): IIVISpan[] {
  const spans: IIVISpan[] = [];

  // Flatten all chords with chord-level keys and volta tracking.
  // Chords in different voltas must never form a pattern together.
  const all: { chord: LeadSheetChord; chordKey: string; volta?: number }[] = [];
  for (let si = 0; si < data.systems.length; si++) {
    const voltas = getActiveVoltas(data.systems[si]);
    for (let bi = 0; bi < data.systems[si].bars.length; bi++) {
      const bar = data.systems[si].bars[bi];
      if (bar.chords.length > 2) continue;
      for (let ci = 0; ci < bar.chords.length; ci++) {
        all.push({ chord: bar.chords[ci], chordKey: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }
  }

  // Build fast lookup: chordKey → index in all[]
  const allIdxByKey = new Map<string, number>();
  all.forEach((item, idx) => allIdxByKey.set(item.chordKey, idx));

  // Collapse consecutive identical chords into groups (ordered keys).
  // Never merge across volta boundaries.
  const groups: { chord: LeadSheetChord; chordKeys: string[]; volta?: number }[] = [];
  for (const item of all) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.volta === item.volta &&
      prev.chord.root === item.chord.root &&
      prev.chord.accidental === item.chord.accidental &&
      prev.chord.quality === item.chord.quality
    ) {
      prev.chordKeys.push(item.chordKey);
    } else {
      groups.push({ chord: item.chord, chordKeys: [item.chordKey], volta: item.volta });
    }
  }

  // Check consecutive groups for ii → V → I (strict: ii and I quality must agree)
  for (let i = 0; i < groups.length - 2; i++) {
    // Skip if any of the three groups cross a volta boundary
    if (isVoltaBoundary(groups[i].volta, groups[i + 1].volta) || isVoltaBoundary(groups[i + 1].volta, groups[i + 2].volta)) continue;
    if (!isDomResolution(groups[i + 1].chord, groups[i + 2].chord)) continue;

    const iiQ = normalizeQuality(groups[i].chord.quality ?? '');
    const vQ  = normalizeQuality(groups[i + 1].chord.quality ?? '');
    const iQ  = normalizeQuality(groups[i + 2].chord.quality ?? '');
    if (!isDominant7(vQ)) continue;

    const pc1 = groups[i].chord.root ? chordPitchClass(groups[i].chord.root!, groups[i].chord.accidental) : -1;
    const pc2 = groups[i + 1].chord.root ? chordPitchClass(groups[i + 1].chord.root!, groups[i + 1].chord.accidental) : -1;
    if ((pc2 - pc1 + 12) % 12 !== 5) continue; // must be ii→V root motion

    let kind: 'major' | 'minor' | null = null;
    if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
    if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
    if (!kind) continue;

    const tonicChord = groups[i + 2].chord;
    const tonicAcc = tonicChord.accidental === '#' ? '♯' : tonicChord.accidental === 'b' ? '♭' : '';
    const label = `${tonicChord.root ?? ''}${tonicAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`;

    // Find the actual I key: the item in all[] immediately after V's last occurrence.
    // This avoids the dedup bug where groups[i+2].chordKeys[0] might point to a
    // repeated I chord earlier in the song (same row as V) rather than the true resolution.
    const vLastKey = groups[i + 1].chordKeys[groups[i + 1].chordKeys.length - 1];
    const vLastIdx = allIdxByKey.get(vLastKey) ?? -1;
    const iActualKey = vLastIdx >= 0 && vLastIdx + 1 < all.length
      ? all[vLastIdx + 1].chordKey
      : groups[i + 2].chordKeys[0];

    spans.push({
      chordKeys: [
        ...groups[i].chordKeys,
        ...groups[i + 1].chordKeys,
        iActualKey,
      ],
      label,
      kind,
    });
  }

  // Wrap-around: check last 2 groups + first group for a turnaround ii-V-I
  // (e.g. the D-7 G7 at the end of the last row resolving to C△7 at bar 1).
  if (groups.length >= 3) {
    const iiGroup = groups[groups.length - 2];
    const vGroup  = groups[groups.length - 1];
    const iGroup  = groups[0];
    if (isDomResolution(vGroup.chord, iGroup.chord)) {
      const iiQ = normalizeQuality(iiGroup.chord.quality ?? '');
      const vQ  = normalizeQuality(vGroup.chord.quality  ?? '');
      const iQ  = normalizeQuality(iGroup.chord.quality  ?? '');
      if (isDominant7(vQ)) {
        const pc1 = iiGroup.chord.root ? chordPitchClass(iiGroup.chord.root, iiGroup.chord.accidental) : -1;
        const pc2 = vGroup.chord.root  ? chordPitchClass(vGroup.chord.root,  vGroup.chord.accidental)  : -1;
        if ((pc2 - pc1 + 12) % 12 === 5) {
          let kind: 'major' | 'minor' | null = null;
          if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
          if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
          if (kind) {
            const tonicChord = iGroup.chord;
            const tonicAcc = tonicChord.accidental === '#' ? '♯' : tonicChord.accidental === 'b' ? '♭' : '';
            const label = `${tonicChord.root ?? ''}${tonicAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`;
            spans.push({
              chordKeys: [...iiGroup.chordKeys, ...vGroup.chordKeys, iGroup.chordKeys[0]],
              label,
              kind,
            });
          }
        }
      }
    }
  }

  // Volta-1 repeat: the last chords of volta 1 loop back to the repeat start.
  // Check if they form a ii-V-I with the first chord after the repeat-start barline.
  const repeatStartIdx = data.systems.findIndex((sys) => sys.hasRepeatStart);
  if (repeatStartIdx >= 0 && groups.length >= 3) {
    const repeatSys = data.systems[repeatStartIdx];
    let repeatIKey: string | undefined;
    findRepeatI: for (let bi = 0; bi < repeatSys.bars.length; bi++) {
      for (let ci = 0; ci < repeatSys.bars[bi].chords.length; ci++) {
        repeatIKey = `${repeatStartIdx}-${bi}-${ci}`;
        break findRepeatI;
      }
    }
    if (repeatIKey) {
      const repeatIGroup = groups.find((g) => g.chordKeys.includes(repeatIKey!));
      const v1Groups = groups.filter((g) => g.volta === 1);
      if (v1Groups.length >= 2 && repeatIGroup && repeatIGroup.volta !== 1) {
        const iiG = v1Groups[v1Groups.length - 2];
        const vG = v1Groups[v1Groups.length - 1];
        if (isDomResolution(vG.chord, repeatIGroup.chord)) {
          const iiQ = normalizeQuality(iiG.chord.quality ?? '');
          const vQ = normalizeQuality(vG.chord.quality ?? '');
          const iQ = normalizeQuality(repeatIGroup.chord.quality ?? '');
          if (isDominant7(vQ)) {
            const pc1 = iiG.chord.root ? chordPitchClass(iiG.chord.root, iiG.chord.accidental) : -1;
            const pc2 = vG.chord.root ? chordPitchClass(vG.chord.root, vG.chord.accidental) : -1;
            if ((pc2 - pc1 + 12) % 12 === 5) {
              let kind: 'major' | 'minor' | null = null;
              if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
              if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
              if (kind) {
                const tc = repeatIGroup.chord;
                const tcAcc = tc.accidental === '#' ? '♯' : tc.accidental === 'b' ? '♭' : '';
                spans.push({
                  chordKeys: [...iiG.chordKeys, ...vG.chordKeys, repeatIGroup.chordKeys[0]],
                  label: `${tc.root ?? ''}${tcAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`,
                  kind,
                });
              }
            }
          }
        }
      }
    }
  }

  return spans;
}

/** True when source (dominant) resolves down a P5 to target. */
function isDomResolution(source: LeadSheetChord, target: LeadSheetChord): boolean {
  if (!source.root || !target.root || !source.quality) return false;
  const q = normalizeQuality(source.quality);
  if (!isDominant7(q)) return false;
  const srcPc = chordPitchClass(source.root, source.accidental);
  const tgtPc = chordPitchClass(target.root, target.accidental);
  return (srcPc - tgtPc + 12) % 12 === 7;
}

/** Auto-detect dominant resolutions V7 → I (song-wide, handles cross-row). */
function detectSecDomArrows(data: LeadSheetData): ArrowSpec[] {
  const specs: ArrowSpec[] = [];

  // Flatten all chords across the entire song with volta tracking
  const all: { chord: LeadSheetChord; key: string; volta?: number }[] = [];
  for (let si = 0; si < data.systems.length; si++) {
    const voltas = getActiveVoltas(data.systems[si]);
    for (let bi = 0; bi < data.systems[si].bars.length; bi++) {
      const bar = data.systems[si].bars[bi];
      if (bar.chords.length > 2) continue;
      for (let ci = 0; ci < bar.chords.length; ci++) {
        all.push({ chord: bar.chords[ci], key: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }
  }

  for (let i = 0; i < all.length - 1; i++) {
    // Don't match across different volta brackets
    if (isVoltaBoundary(all[i].volta, all[i + 1].volta)) continue;
    if (isDomResolution(all[i].chord, all[i + 1].chord)) {
      specs.push({
        key: `secdom-${all[i].key}`,
        sourceChordId: all[i].key,
        targetChordId: all[i + 1].key,
      });
    }
  }

  // Wrap-around: last chord → first chord (turnaround)
  if (all.length >= 2 && isDomResolution(all[all.length - 1].chord, all[0].chord)) {
    specs.push({
      key: `secdom-wrap`,
      sourceChordId: all[all.length - 1].key,
      targetChordId: all[0].key,
    });
  }

  return specs;
}

export function LeadSheet({ data, showAnalysis = true }: LeadSheetProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(outerRef);
  const { zoom, zoomIn, zoomOut, setZoomLevel } = useZoom(100);

  // Scroll to top when zoom changes
  useEffect(() => {
    if (!isFullscreen) outerRef.current?.scrollTo({ top: 0 });
  }, [zoom, isFullscreen]);

  // Auto-analyze isDiatonic for all chords
  const analyzedData = useMemo(() => analyzeIsDiatonic(data), [data]);

  const originalKey = analyzedData.key ?? 'C';
  const originalIsMinor = isMinorKey(originalKey);
  const [selectedKey, setSelectedKey] = useState(originalKey);

  // Reset key when song changes
  useEffect(() => { setSelectedKey(originalKey); }, [originalKey]);

  const [keyMenuOpen, setKeyMenuOpen] = useState(false);
  const keyMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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

  const transposedData = useMemo(
    () => (selectedKey === originalKey ? analyzedData : analyzeIsDiatonic(transposeData(analyzedData, selectedKey))),
    [analyzedData, selectedKey, originalKey],
  );

  const resolvedData = useMemo(() => resolveRepeats(transposedData), [transposedData]);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [pageNaturalSize, setPageNaturalSize] = useState({ w: 0, h: 0 });

  // Track the Page element's natural (unscaled) size for scroll-area compensation
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Only capture natural size when not in fullscreen (fullscreen applies its own scale)
      if (!document.fullscreenElement) {
        setPageNaturalSize({ w: el.offsetWidth, h: el.offsetHeight });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolvedData]);

  // Compute fit-to-screen scale for fullscreen
  const FS_PAD = 32; // padding inside fullscreen viewport
  const [viewportSize, setViewportSize] = useState({ vw: window.innerWidth, vh: window.innerHeight });

  useEffect(() => {
    if (!isFullscreen) return;
    const onResize = () => setViewportSize({ vw: window.innerWidth, vh: window.innerHeight });
    // Capture viewport after entering fullscreen (may need a frame)
    requestAnimationFrame(onResize);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isFullscreen]);

  const fitScale = useMemo(() => {
    if (!isFullscreen || pageNaturalSize.w === 0 || pageNaturalSize.h === 0) return 1;
    const availW = viewportSize.vw - FS_PAD * 2;
    const availH = viewportSize.vh - FS_PAD * 2;
    return Math.min(availW / pageNaturalSize.w, availH / pageNaturalSize.h) * 1.08;
  }, [isFullscreen, pageNaturalSize, viewportSize]);

  // The effective scale: in fullscreen use fitScale, otherwise use zoom
  const effectiveScale = isFullscreen ? fitScale : zoom / 100;

  const systemElsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const gridElsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const chordElsRef = useRef<Record<string, HTMLSpanElement | null>>({});
  const [arrowFrame, setArrowFrame] = useState<{ width: number; height: number }>({ width: 1, height: 1 });
  const [arrows, setArrows] = useState<ResolvedArrow[]>([]);
  const [brackets, setBrackets] = useState<ResolvedBracket[]>([]);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [hoveredSpanKey, setHoveredSpanKey] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<{ hl: HighlightRect; anchorX: number } | null>(null);
  const arrowSpecs = useMemo(() => detectSecDomArrows(resolvedData), [resolvedData]);
  const bracketSpecs = useMemo(() => detectIIVBrackets(resolvedData), [resolvedData]);
  const iiviSpans = useMemo(() => detectIIVI(resolvedData), [resolvedData]);

  useLayoutEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || (arrowSpecs.length === 0 && bracketSpecs.length === 0 && iiviSpans.length === 0)) {
      setArrows([]);
      setBrackets([]);
      setHighlights([]);
      return;
    }

    const scale = effectiveScale;

    const measure = () => {
      const freshPageEl = pageRef.current;
      if (!freshPageEl) {
        setArrows([]);
        setBrackets([]);
        setHighlights([]);
        return;
      }

      const pageRect = freshPageEl.getBoundingClientRect();
      // Helper: convert screen-pixel position to unscaled Page-local coordinate
      const lx = (screenX: number) => (screenX - pageRect.left) / scale;
      const ly = (screenY: number) => (screenY - pageRect.top) / scale;
      const lw = (screenW: number) => screenW / scale;
      const lh = (screenH: number) => screenH / scale;
      const pageW = pageRect.width / scale;
      const pageH = pageRect.height / scale;
      const resolvedArrows: ResolvedArrow[] = [];

      for (const spec of arrowSpecs) {
        const sourceEl = chordElsRef.current[spec.sourceChordId];
        const targetEl = chordElsRef.current[spec.targetChordId];
        if (!sourceEl || !targetEl) continue;

        const sourceSystemIndex = Number(sourceEl.dataset.systemIndex);
        const targetSystemIndex = Number(targetEl.dataset.systemIndex);
        const sourceSystemEl = systemElsRef.current[sourceSystemIndex];
        const targetSystemEl = systemElsRef.current[targetSystemIndex];
        if (!sourceSystemEl || !targetSystemEl) continue;

        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const sourceSystemRect = sourceSystemEl.getBoundingClientRect();
        const targetSystemRect = targetSystemEl.getBoundingClientRect();

        const x1 = lx(sourceRect.left) + lw(sourceRect.width) * 0.52;
        const y1 = ly(sourceRect.top) - 14;
        const x2 = lx(targetRect.left) + lw(targetRect.width) * 0.38;
        const y2 = ly(targetRect.top) - 14;

        if (sourceSystemIndex === targetSystemIndex) {
          const cx = (x1 + x2) / 2;
          const cy = Math.min(y1, y2) - 28;
          resolvedArrows.push({
            key: spec.key,
            segments: [{ d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, markerEnd: true }],
          });
          continue;
        }

        const edgeInset = 24;
        const exitX = pageW - edgeInset;
        const entryX = edgeInset;
        const sourceExitY = ly(sourceSystemRect.top) + 10;
        const targetEntryY = ly(targetSystemRect.top) + 10;
        const exitCx = x1 + (exitX - x1) * 0.55;
        const entryCx = entryX + (x2 - entryX) * 0.45;

        resolvedArrows.push({
          key: spec.key,
          segments: [
            {
              d: `M ${x1} ${y1} Q ${exitCx} ${Math.min(y1, sourceExitY) - 28} ${exitX} ${sourceExitY}`,
            },
            {
              d: `M ${entryX} ${targetEntryY} Q ${entryCx} ${Math.min(targetEntryY, y2) - 28} ${x2} ${y2}`,
              markerEnd: true,
            },
          ],
        });
      }

      /* ── ii-V brackets ── */
      const resolvedBrackets: ResolvedBracket[] = [];
      const BRACKET_GAP = 4;   // px below chord bottom
      const BRACKET_DEPTH = 10; // px height of the bracket

      for (const spec of bracketSpecs) {
        const el1 = chordElsRef.current[spec.chordId1];
        const el2 = chordElsRef.current[spec.chordId2];
        if (!el1 || !el2) continue;

        const rect1 = el1.getBoundingClientRect();
        const rect2 = el2.getBoundingClientRect();

        const x1 = lx(rect1.left) + lw(rect1.width) / 2;
        const x2 = lx(rect2.left) + lw(rect2.width) / 2;
        const yBase = Math.max(ly(rect1.bottom), ly(rect2.bottom)) + BRACKET_GAP;
        const yBottom = yBase + BRACKET_DEPTH;

        resolvedBrackets.push({
          key: spec.key,
          d: `M ${x1} ${yBase} L ${x1} ${yBottom} L ${x2} ${yBottom} L ${x2} ${yBase}`,
        });
      }

      /* ── ii-V-I highlight bands ── */
      const resolvedHighlights: HighlightRect[] = [];
      const HL_PAD_Y = 3;
      const HL_PAD_X = 6;

      for (let spanIdx = 0; spanIdx < iiviSpans.length; spanIdx++) {
        const span = iiviSpans[spanIdx];

        // Group chord keys by system row (keyed on si), tracking min/max bar index.
        // Populate from keys first so every row in the span is represented, even
        // when a chord element hasn't been registered yet (e.g. the I chord on a
        // cross-row 2-5-1 occasionally misses its ref on first layout).
        const byRow = new Map<number, { minBi: number; maxBi: number; chordKeys: string[] }>();
        for (const ck of span.chordKeys) {
          const [siStr, biStr] = ck.split('-');
          const si = Number(siStr);
          const bi = Number(biStr);
          if (!byRow.has(si)) {
            byRow.set(si, { minBi: bi, maxBi: bi, chordKeys: [ck] });
          } else {
            const row = byRow.get(si)!;
            row.minBi = Math.min(row.minBi, bi);
            row.maxBi = Math.max(row.maxBi, bi);
            row.chordKeys.push(ck);
          }
        }

        const rowIndices = [...byRow.keys()].sort((a, b) => a - b);
        const isMultiRow = rowIndices.length > 1;
        // Wrap-around: rows are not consecutive (e.g. last system → first system),
        // or chord keys go backward (e.g. volta-1 repeat: S1 → S0).
        const firstKeySi = Number(span.chordKeys[0].split('-')[0]);
        const lastKeySi  = Number(span.chordKeys[span.chordKeys.length - 1].split('-')[0]);
        const isWrapAround = isMultiRow && (
          !rowIndices.every((si, r) => r === 0 || si === rowIndices[r - 1] + 1) ||
          firstKeySi > lastKeySi
        );

        for (let r = 0; r < rowIndices.length; r++) {
          const si = rowIndices[r];
          const { minBi, maxBi, chordKeys: rowCks } = byRow.get(si)!;
          const gridEl = gridElsRef.current[si];
          const systemEl = systemElsRef.current[si];
          if (!gridEl) continue;

          const gridRect = gridEl.getBoundingClientRect();
          const numBars = resolvedData.systems[si]?.bars.length ?? 4;
          const barW = gridRect.width / numBars;

          // Collect positions from chord elements that are available
          let hlLeft  = gridRect.left + minBi * barW;
          let hlRight = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          for (const ck of rowCks) {
            const el = chordElsRef.current[ck];
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            hlRight = Math.max(hlRight, rect.right);
            minY = Math.min(minY, rect.top);
            maxY = Math.max(maxY, rect.bottom);
          }

          // Fallback X: extend to end of last bar if no element was found
          if (hlRight === -Infinity) {
            hlRight = gridRect.left + (maxBi + 1) * barW;
          } else {
            hlRight += HL_PAD_X * scale;
          }

          // Fallback Y: use system element bounds if no chord element was found
          if (minY === Infinity) {
            const sysRect = systemEl?.getBoundingClientRect();
            if (!sysRect) continue;
            minY = sysRect.top + BARLINE_GAP * scale;
            maxY = sysRect.top + (BAR_H - BARLINE_GAP) * scale;
          }

          // Cross-row (consecutive): extend to full grid width on open ends.
          if (isMultiRow && !isWrapAround) {
            if (r === 0)                          hlRight = gridRect.right;
            else if (r === rowIndices.length - 1) hlLeft  = gridRect.left;
            else { hlLeft = gridRect.left; hlRight = gridRect.right; }
          }
          // Wrap-around: the departure row (largest si, contains ii–V) extends
          // to the right edge; the arrival row (smallest si, contains I) stays tight.
          if (isWrapAround && si === rowIndices[rowIndices.length - 1]) {
            hlRight = gridRect.right;
          }

          const rowPosition: HighlightRect['rowPosition'] =
            rowIndices.length === 1 ? 'only'
            : r === 0 ? 'first'
            : r === rowIndices.length - 1 ? 'last'
            : 'middle';

          resolvedHighlights.push({
            key: `hl-${spanIdx}-${si}`,
            spanKey: `span-${spanIdx}`,
            x: lx(hlLeft),
            y: ly(minY) - HL_PAD_Y,
            width: lw(hlRight - hlLeft),
            height: lh(maxY - minY) + HL_PAD_Y * 2,
            label: span.label,
            kind: span.kind,
            rowPosition,
          });
        }
      }

      setArrowFrame({
        width: pageW,
        height: pageH,
      });
      setArrows(resolvedArrows);
      setBrackets(resolvedBrackets);
      setHighlights(resolvedHighlights);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(pageEl);
    Object.values(systemElsRef.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [arrowSpecs, bracketSpecs, iiviSpans, resolvedData, effectiveScale]);

  const registerChordEl = (id: string, el: HTMLSpanElement | null) => {
    chordElsRef.current[id] = el;
  };

  const registerSystemEl = (index: number, el: HTMLDivElement | null) => {
    systemElsRef.current[index] = el;
  };

  const registerGridEl = (index: number, el: HTMLDivElement | null) => {
    gridElsRef.current[index] = el;
  };

  const wrapperStyle = useMemo<React.CSSProperties>(() => {
    if (isFullscreen) {
      // Fullscreen: center the scaled page in the viewport
      const scaledW = pageNaturalSize.w * fitScale;
      const scaledH = pageNaturalSize.h * fitScale;
      return {
        width: `${scaledW}px`,
        height: `${scaledH}px`,
        position: 'absolute',
        top: '50%',
        left: 'calc(50% + 24px)',
        transform: 'translate(-50%, -50%)',
      };
    }
    if (zoom === 100) return { width: '100%' };
    return {
      width: pageNaturalSize.w > 0 ? `${pageNaturalSize.w * (zoom / 100)}px` : '100%',
      height: pageNaturalSize.h > 0 ? `${pageNaturalSize.h * (zoom / 100)}px` : undefined,
      margin: '0 auto',
    };
  }, [isFullscreen, zoom, pageNaturalSize, fitScale]);

  const pageStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (effectiveScale === 1 && !isFullscreen) return undefined;
    return {
      width: pageNaturalSize.w > 0 ? `${pageNaturalSize.w}px` : undefined,
      transform: `scale(${effectiveScale})`,
      transformOrigin: 'top left',
    };
  }, [effectiveScale, isFullscreen, pageNaturalSize.w]);

  return (
    <ViewerOuter ref={outerRef}>
      <FullscreenButton isFullscreen={isFullscreen} onClick={toggleFullscreen} />
      {!isFullscreen && <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onSetZoom={setZoomLevel} />}
      <div style={wrapperStyle}>
      <Page ref={pageRef} style={pageStyle}>
        {showAnalysis && (
          <ArrowLayer viewBox={`0 0 ${Math.max(arrowFrame.width, 1)} ${Math.max(arrowFrame.height, 1)}`}>
            <defs>
              <marker id="secdom-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="none" stroke="#000" strokeWidth="1.6" />
              </marker>
            </defs>
            {arrows.flatMap((arrow) =>
              arrow.segments.map((segment, index) => (
                <path
                  key={`${arrow.key}-${index}`}
                  d={segment.d}
                  fill="none"
                  stroke="#000"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  markerEnd={segment.markerEnd ? 'url(#secdom-arrow)' : undefined}
                />
              )),
            )}
            {/* ii-V brackets */}
            {brackets.map((bracket) => (
              <path
                key={bracket.key}
                d={bracket.d}
                fill="none"
                stroke="#000"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </ArrowLayer>
        )}
        {/* ── Background highlight layer (behind text) ── */}
        {showAnalysis && highlights.map((hl) => (
          <div
            key={`bg-${hl.key}`}
            style={{
              position: 'absolute',
              left: hl.x, top: hl.y,
              width: hl.width, height: hl.height,
              background: 'rgba(255, 236, 179, 0.45)',
              borderRadius: hlBorderRadius(hl.rowPosition),
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        ))}

        <TitleRow>
          <KeyDropdownWrap ref={keyMenuRef}>
            <KeyButton onClick={() => setKeyMenuOpen((v) => !v)}>
              {formatKeyDisplay(selectedKey)}
            </KeyButton>
            {keyMenuOpen && (
              <KeyMenu>
                <KeyGrid>
                  {(originalIsMinor ? ALL_MINOR_KEYS : ALL_MAJOR_KEYS).map((k) => (
                    <KeyOption
                      key={k}
                      $active={k === selectedKey || k === selectedKey.replace('-', 'm')}
                      onClick={() => { setSelectedKey(k); setKeyMenuOpen(false); }}
                    >
                      {k}
                    </KeyOption>
                  ))}
                </KeyGrid>
              </KeyMenu>
            )}
          </KeyDropdownWrap>
          <SheetTitle>{resolvedData.title}</SheetTitle>
        </TitleRow>
        <MetaRow>
          <span>{resolvedData.style}</span>
          <span>{resolvedData.composer}</span>
        </MetaRow>

        {resolvedData.systems.map((system, i) => (
          <SystemRowComponent
            key={i}
            system={system}
            isFirst={i === 0}
            systemIndex={i}
            timeSignature={resolvedData.timeSignature}
            registerChordEl={registerChordEl}
            registerSystemEl={registerSystemEl}
            registerGridEl={registerGridEl}
            showAnalysis={showAnalysis}
          />
        ))}

        {/* ── Event capture layer (above text, transparent) ── */}
        {showAnalysis && highlights.map((hl) => {
          const isHovered = hoveredSpanKey === hl.spanKey;
          return (
            <div
              key={`ev-${hl.key}`}
              onMouseEnter={(e) => {
                setHoveredSpanKey(hl.spanKey);
                if (!pageRef.current) return;
                setActiveTooltip({ hl, anchorX: (e.clientX - pageRef.current.getBoundingClientRect().left) / effectiveScale });
              }}
              onMouseMove={(e) => {
                if (!pageRef.current) return;
                setActiveTooltip({ hl, anchorX: (e.clientX - pageRef.current.getBoundingClientRect().left) / effectiveScale });
              }}
              onMouseLeave={() => {
                setHoveredSpanKey(null);
                setActiveTooltip(null);
              }}
              style={{
                position: 'absolute',
                left: hl.x, top: hl.y,
                width: hl.width, height: hl.height,
                boxSizing: 'border-box',
                background: 'transparent',
                borderRadius: hlBorderRadius(hl.rowPosition),
                ...hlHoverBorder(hl.rowPosition, isHovered),
                cursor: 'pointer',
                zIndex: 3,
              }}
            />
          );
        })}

        {/* ── 2-5-1 popup ── */}
        {activeTooltip && (
          <div style={{
            position: 'absolute',
            left: activeTooltip.anchorX,
            top: activeTooltip.hl.y - 10,
            transform: 'translate(-50%, -100%)',
            background: '#7A5C00',
            color: '#fff',
            padding: '5px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 200,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}>
            {activeTooltip.hl.label}
          </div>
        )}
      </Page>
      </div>
    </ViewerOuter>
  );
}
