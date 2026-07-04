import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ALL_MAJOR_KEYS, ALL_MINOR_KEYS, transposeData } from './leadSheetTranspose';
import { normalizeQuality, splitQuality } from './leadSheetQuality';
import { detectIIVBrackets, detectIIVI, detectSecDomArrows, type IIVISpan } from './leadSheetAnalysis';
/* 기존 외부 소비자(ChordPage/NotePage)의 import 경로 보존. */
export { ALL_MAJOR_KEYS, ALL_MINOR_KEYS, isMinorKey, shiftKey } from './leadSheetTranspose';
import { useLeadSheetSelection, type LeadSheetChordSelection } from './useLeadSheetSelection';
export type { LeadSheetChordSelection } from './useLeadSheetSelection';
import { isComposingEvent } from '../../lib/ime';
import styled from 'styled-components';
import type {
  LeadSheetData,
  LeadSheetSystem,
  LeadSheetChord,
} from '../../data/leadSheetTypes';
import type { NoteSheetData } from '../../data/sampleMelody';
import { FullscreenButton } from '../common/FullscreenButton';
import { CompactButton } from '../common/CompactButton';
import { ZoomControls, useZoom } from '../common/ZoomControls';
import { analyzeHarmony, formatKeyDisplay } from '../../lib/harmonyAnalyzer';
import type { AnalysisFilters } from '../../hooks/useAnalysisFilters';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { useIsNativeLandscape } from '../../hooks/useIsNativeLandscape';
import { usePlayerBarPosition } from '../../contexts/PlayerBarPositionContext';
import { chordToInputString } from '../../lib/leadSheetChordEdit';
import { breakBeatForBar, type BreakPoint } from '../../lib/breakPoints';
import { getModalInterchangeTemplate } from '../../lib/modalInterchangeTemplates';
import { ModalInterchangePopup } from './ModalInterchangePopup';
import { SubVPopup } from './SubVPopup';
import { InlineLickRow } from './InlineLickRow';
import { mq } from '../../styles/theme';

/* ─── constants ──────────────────────────────────────────────────────────────
 *  BARLINE_PAD = left padding reserved inside every bar cell for the barline.
 *  All four bar cells always have the same padding, so chords stay perfectly
 *  column-aligned regardless of the barline type (normal / section / repeat).
 * ────────────────────────────────────────────────────────────────────────── */
const BARLINE_PAD  = 18;  // px — left padding reserved for barline decoration
const BAR_H        = 78;  // px — row height (snug around chord content)
const BARLINE_GAP  = 6;   // px — vertical inset at top/bottom of each barline
const ROW_GAP      = 44;  // px — space between rows (extra room for bigger labels)
const COMPACT_ROW_GAP = 28; // px — tighter gap when neither this row nor the next
                            // carries an analysis decoration (ii-V bracket below /
                            // ii-V-I or modal-interchange band above)
/* Section spacing. The A/B label floats above its own chord row by
 * LABEL_OFFSET; lowering it pulls the label closer to its section's first row
 * (intentional slight asymmetry — sits nearer the part it labels).
 * With ROW_GAP=44, SECTION_GAP=64, LABEL_OFFSET=52, label height ≈26px:
 *   • gap below label (label → its chord row)  = LABEL_OFFSET − labelH ≈ 26px
 *   • gap above label (prev row → label)       = ROW_GAP + SECTION_GAP − LABEL_OFFSET = 56px */
const SECTION_GAP  = 64;  // px — extra space before a new section (A, B, …)
const LABEL_OFFSET = 52;  // px — how far the section label floats above the grid
const CHORD_FONT   = "'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif";
const LABEL_FONT   = "'Pretendard', 'Pretendard', sans-serif"; // gothic for A/B labels

/* ─── page ───────────────────────────────────────────────────────────────── */

const ViewerOuter = styled.div<{ $fs?: boolean; $fit?: boolean }>`
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

  ${mq.compactLayout} {
    justify-content: stretch;
    padding: 0;
    background: #fff;
  }

  ${mq.mobile} {
    padding: 0;
  }

  /* Native landscape "fit to one page": no scroll, vertical-center the
   * scaled chart inside the score column. */
  ${({ $fit }) => $fit && `
    overflow: hidden;
    padding: 0;
    align-items: center;
  `}

  /* In-app "fullscreen": fill the viewport BELOW the top toolbar (58px) so the
   * app's top bar stays visible, instead of the browser's native fullscreen
   * (which covers the whole screen). */
  ${({ $fs, theme }) => $fs && `
    position: fixed;
    top: calc(58px + env(safe-area-inset-top, 0px));
    left: 0;
    right: 0;
    bottom: 0;
    z-index: ${theme.zIndex.floating};
    flex: none;
    overflow: hidden;
    padding: 0;
  `}
`;

const Page = styled.div`
  position: relative;
  background: #fff;
  width: 100%;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  border-radius: 4px;
  padding: 50px 32px 48px;
  font-family: ${CHORD_FONT};
  color: #000;

  ${mq.compactLayout} {
    min-height: 100%;
    box-shadow: none;
    border-radius: 0;
    padding: 40px 18px 34px;
  }

  ${mq.mobile} {
    padding: 36px 10px 28px;
  }
`;

const PageShell = styled.div`
  width: 100%;

  ${mq.compactLayout} {
    min-height: 100%;
    display: flex;
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
  font-family: 'Pretendard', sans-serif;
  font-weight: 400;
  /* Margin-bottom must clear the SectionLabel of the first row, which floats
   * up by LABEL_OFFSET (66px). Set higher than SECTION_GAP+LABEL_OFFSET margin
   * so the genre text never abuts the first A/B label. */
  margin-bottom: 88px;

  @media (max-width: 960px) {
    margin-bottom: 78px;
    font-size: 0.85rem;
  }
`;

/* Original genre/style — left of the meta row. Font size + family + color all
 * match the composer on the right (both inherit MetaRow's Pretendard + text
 * color). */
const MetaStyle = styled.span`
  align-self: center;
  font-size: inherit;
  color: inherit;
`;

const TitleRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 36px;
`;

const KeyDropdownWrap = styled.div`
  position: relative;
  display: inline-block;
  flex-shrink: 1;
  min-width: 0;
`;

const KeyButton = styled.button`
  height: 32px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  background: #fff;
  border: 1.5px solid #ccc;
  border-radius: 6px;
  padding: 0 10px;
  cursor: pointer;
  font-family: ${CHORD_FONT};
  font-size: 1.12rem;
  font-weight: 600;
  line-height: 1;
  color: #222;
  &:hover { border-color: #888; }

  &::after {
    content: '▾';
    font-size: 0.7em;
    color: #999;
  }
`;

/* "장조/단조" — smaller than the key root, snug to it. */
const KeyQual = styled.span`
  font-size: 0.6em;
  margin-left: 1px;
`;

const KeyMenu = styled.div<{ $up?: boolean }>`
  position: absolute;
  ${({ $up }) => ($up ? 'bottom: calc(100% + 4px);' : 'top: calc(100% + 4px);')}
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

const SystemRow = styled.div<{ $sectionStart?: boolean; $hasVolta?: boolean; $compact?: boolean }>`
  display: flex;
  /* center (not stretch) so the larger TimeSig on row 1 doesn't inflate the
   * BarsGrid height — every row's chord grid stays at BAR_H regardless. */
  align-items: center;
  /* Compact the gap below a row only when nothing decorates the seam: no ii-V
   * bracket hangs off this row AND no ii-V-I / modal band tab pokes up from the
   * next row. Decorated seams keep the full ROW_GAP so tabs/brackets never touch. */
  margin-bottom: ${({ $compact }) => $compact ? COMPACT_ROW_GAP : ROW_GAP}px;
  /* When a row has a volta bracket (which sits VOLTA_HEIGHT px above the
   * grid) AND the previous row carries a ii-V bracket below (~14px), the
   * default ROW_GAP=44 isn't enough. Force margin-top to VOLTA_HEIGHT+22 on
   * volta rows so the two decorations can never collide vertically.
   * $sectionStart wins via max() when both apply. */
  ${({ $sectionStart, $hasVolta }) => {
    const mt = Math.max($sectionStart ? SECTION_GAP : 0, $hasVolta ? VOLTA_HEIGHT + 22 : 0);
    return mt > 0 ? `margin-top: ${mt}px;` : '';
  }}
  /* overflow visible so the section label can float above the grid */
  position: relative;
  overflow: visible;

  @media (max-width: 960px) {
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

  @media (max-width: 960px) {
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

  @media (max-width: 960px) {
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
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

/* Floats above the top-left corner of the bars grid. left=6px nudges it
 * slightly off the page edge so it doesn't sit flush with the genre text
 * in the meta row above. */
const SectionLabel = styled.div`
  position: absolute;
  top: -${LABEL_OFFSET}px;
  left: 6px;
  background: #000;
  color: #fff;
  font-family: ${LABEL_FONT};
  font-size: clamp(1rem, 2.4cqi, 1.5rem);
  font-weight: 800;
  line-height: 1;
  /* Square badge: min-width === height so single-letter labels (A, B) render
   * a perfect 1:1 square. Two-glyph labels (A') still fit inside the square
   * (they're narrower than the box), and any longer label grows horizontally
   * via min-width rather than clipping. letter-spacing removed so the glyph
   * stays optically centered. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 1.5em;
  height: 1.5em;
  padding: 0 0.25em;
  letter-spacing: 0;
  z-index: 3;
`;

/* ─── volta ending bracket ──────────────────────────────────────────────── */

// 볼타 브래킷 높이 — 충분한 여백을 두어 IIVI/모달 인터체인지 밴드와 겹치지 않도록.
const VOLTA_HEIGHT = 44;

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
const BarCell = styled.div<{ $endPad?: number }>`
  position: relative;
  min-width: 0;
  min-height: ${BAR_H}px;
  display: flex;
  align-items: center;
  overflow: visible;
  box-sizing: border-box;
  padding: 0 ${({ $endPad }) => $endPad ?? 6}px 0 ${BARLINE_PAD}px;

  @media (max-width: 960px) {
    min-height: 56px;
    padding: 0 ${({ $endPad }) => $endPad ?? 3}px 0 12px;
  }
`;

/* ── Loop region (구간 반복): edit-mode pick target, region tint, edge marks ── */
const LoopPickLayer = styled.button`
  position: absolute;
  inset: 0;
  z-index: 6;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  &:hover { background: rgba(44, 127, 184, 0.14); }
`;
const LoopRegionTint = styled.div<{ $draft?: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: ${({ $draft }) => ($draft ? 'rgba(44, 127, 184, 0.14)' : 'rgba(44, 127, 184, 0.07)')};
`;
const LoopStartMark = styled.div`
  position: absolute;
  left: 0; top: 6%; bottom: 6%;
  width: 4px;
  border-radius: 2px;
  background: #2c7fb8;
  pointer-events: none;
  z-index: 5;
`;
const LoopEndMark = styled.div`
  position: absolute;
  right: 0; top: 6%; bottom: 6%;
  width: 4px;
  border-radius: 2px;
  background: #2c7fb8;
  pointer-events: none;
  z-index: 5;
`;

/* ── Break Editor: per-beat markers + label ─────────────────────────────
 * The marker row floats above the chord area of a bar (only in break-edit
 * mode). Each cell holds a clickable quarter-note glyph; the active beat
 * (break start) is rendered solid, the rest faint, hover in between. */
const BeatMarkerRow = styled.div`
  position: absolute;
  /* Sit slightly higher and a touch further left than before so the
   * quarter-note glyphs read as floating ABOVE the chord band rather
   * than crowding it from the top. */
  top: -16px;
  left: ${BARLINE_PAD - 10}px;
  right: 16px;
  height: 22px;
  display: grid;
  z-index: 5;
  pointer-events: auto;
`;

const BeatMarker = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  color: #1a1a1a;
  opacity: ${({ $active }) => ($active ? 1 : 0.26)};
  transition: opacity 0.12s, transform 0.06s;
  &:hover { opacity: ${({ $active }) => ($active ? 1 : 0.6)}; }
  &:active { transform: scale(0.9); }
`;

/* Real quarter note — filled notehead + stem, drawn as inline SVG so it's
 * crisp at any size and doesn't depend on a music font being present. */
function QuarterNoteGlyph() {
  return (
    <svg width="11" height="20" viewBox="0 0 11 20" aria-hidden style={{ display: 'block' }}>
      <ellipse cx="3.6" cy="15.4" rx="3.6" ry="2.7" fill="currentColor" transform="rotate(-20 3.6 15.4)" />
      <rect x="6.5" y="2" width="1.3" height="13.2" fill="currentColor" />
    </svg>
  );
}

/* Break label shown on a marked bar outside edit mode, e.g. "Break (2/4)".
 * Sits ABOVE the roman-numeral / ii-V-I amber tab (which occupies roughly
 * [-16px, +6px] from the bar-grid top) so the two never overlap: top:-34px
 * places the label clear above that band, and a high z-index keeps it over
 * the analysis overlay layer. */
const BreakLabel = styled.div`
  position: absolute;
  top: -34px;
  left: ${BARLINE_PAD}px;
  z-index: 30;
  background: #1a1a1a;
  color: #fff;
  font-family: 'Pretendard', sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  padding: 2px 6px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
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

function chordSpanInBar(chords: LeadSheetChord[], chordIndex: number): { start: number; end: number } {
  const count = chords.length;
  if (count <= 1) return { start: 0, end: 1 };
  if (count === 4) {
    const start = chordIndex / 4;
    return { start, end: start + 0.25 };
  }

  const [s1, s2] = splitSections(chords);
  const firstCount = s1.length;
  if (s2.length === 0) return { start: 0, end: 1 };

  if (chordIndex < firstCount) {
    const sectionWidth = 0.5 / Math.max(firstCount, 1);
    const start = chordIndex * sectionWidth;
    return { start, end: start + sectionWidth };
  }

  const localIndex = chordIndex - firstCount;
  const sectionWidth = 0.5 / Math.max(s2.length, 1);
  const start = 0.5 + localIndex * sectionWidth;
  return { start, end: start + sectionWidth };
}

/* Two equal columns, one per section */
const BarSections = styled.div<{ $compact?: boolean }>`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;   /* bottom-align so chords w/ accidentals (Bb6) share a baseline */
  min-width: 0;
  width: 100%;
  ${({ $compact }) => $compact && 'transform: scaleX(0.85); transform-origin: left center;'}
`;

const FourChordGrid = styled.div<{ $compact?: boolean }>`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: end;   /* bottom-align so chords w/ accidentals (Bb6) share a baseline */
  min-width: 0;
  width: 100%;
  transform: translateX(-8px)${({ $compact }) => $compact ? ' scaleX(0.85)' : ''};
  transform-origin: left center;
`;

const FourChordSlot = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  min-width: 0;
  overflow: visible;

  &:nth-child(n + 3) {
    transform: translateX(10px);
  }
`;

/* One section slot. When 2 chords share a half-bar, the pair are rendered
 * at the SAME 'full' size as solo-section chords (so the letters never
 * shrink); the slot itself applies a strong horizontal scaleX to squeeze
 * the pair into the available half-bar width. Letter heights are preserved
 * — only the width is compressed. */
const SectionSlot = styled.div<{ $squeeze?: boolean }>`
  display: ${({ $squeeze }) => $squeeze ? 'grid' : 'flex'};
  ${({ $squeeze }) => $squeeze
    ? 'grid-template-columns: repeat(2, minmax(0, 1fr)); transform: scaleX(0.78); transform-origin: left center; & > :nth-child(2) { padding-left: 20px; }'
    : 'gap: 3px;'}
  align-items: flex-end;
  min-width: 0;
  overflow: visible;
`;

/* ─── chord symbol ───────────────────────────────────────────────────────── */

const ChordWrap = styled.span<{ $nonDiatonic?: boolean; $modal?: boolean; $subV?: boolean; $iiviHovered?: boolean; $size?: ChordSize }>`
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  line-height: 1;
  z-index: 2;
  transform: ${({ $size }) => ($size === 'four' ? 'scaleX(0.78)' : 'none')};
  transform-origin: left bottom;
  color: ${({ $nonDiatonic, $modal, $subV, $iiviHovered }) =>
    $iiviHovered ? '#B8860B' :
    $modal       ? '#7B3FB0' :
    $subV        ? '#1E8A56' :
    $nonDiatonic ? '#c62828' : '#000'};
  cursor: ${({ $modal, $subV }) => ($modal || $subV ? 'pointer' : 'default')};
  transition: color 0.12s, opacity 0.12s;
  ${({ $modal, $subV }) => ($modal || $subV) && `
    &:hover { opacity: 0.7; }
  `}
`;

/* $size controls chord symbol scale:
 *   'full'    — 1 chord fills the whole bar
 *   'split'   — 1 chord per half-bar (2-chord bar, each gets its own half)
 *   'compact' — 2 chords share one half-bar slot
 *   'four'    — 4 evenly-spaced chords in one bar
 * All sizes use clamp(min, X cqi, max) relative to the leadsheet container. */
type ChordSize = 'full' | 'split' | 'compact' | 'four';

const Root = styled.span<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'four'    ? 'clamp(1.45rem, 5.15cqi, 3.1rem)' :
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
    $size === 'four'    ? 'clamp(0.8rem, 2.7cqi, 1.55rem)' :
    $size === 'compact' ? 'clamp(0.55rem, 1.9cqi, 1.1rem)' :
    $size === 'split'   ? 'clamp(0.65rem, 2.3cqi, 1.4rem)' :
                          'clamp(0.8rem,  3.0cqi, 1.8rem)'};
  font-weight: 700;
  font-family: ${CHORD_FONT};
  line-height: 1;
`;

/* When a tension exists AND there's no chord-level accidental, Quality
 * becomes a 2-row stack (tension on top, ext on bottom). With an Acc the
 * layout reverts to plain inline so we don't get a 3-row pileup
 * (Acc / tension / base) — see the JSX site for the conditional.
 *
 * translateY pulls the quality glyph upward off the bottom edge of root so
 * the "7" sits closer to the middle of the root letter — without this the
 * AccQualStack's space-between pushed Quality flush against the root's
 * baseline, which read as "F7 is too far down" beside the high-perched Acc. */
const Quality = styled.span<{ $size?: ChordSize; $stacked?: boolean; $dom7?: boolean }>`
  /* Dominant 7 ("G7", "C7sus" …) renders ~8 % larger than other qualities
   * (△7, m7, °7, ø7) and sits slightly lower / nudged right — per design
   * request. Multiplier is applied to every value inside the clamp so the
   * font scales consistently across viewport sizes. */
  font-size: ${({ $size, $dom7 }) => {
    const m = $dom7 ? 1.08 : 1;
    if ($size === 'four')    return `clamp(${0.88 * m}rem, ${2.75 * m}cqi, ${1.6 * m}rem)`;
    if ($size === 'compact') return `clamp(${0.6 * m}rem, ${1.8 * m}cqi, ${1.1 * m}rem)`;
    if ($size === 'split')   return `clamp(${0.75 * m}rem, ${2.2 * m}cqi, ${1.4 * m}rem)`;
    return `clamp(${0.9 * m}rem, ${2.9 * m}cqi, ${1.7 * m}rem)`;
  }};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
  padding-bottom: 1px;
  transform: ${({ $dom7 }) =>
    $dom7 ? 'translate(0.04em, -0.04em)' : 'translateY(-0.18em)'};
  transform-origin: left bottom;
  ${({ $stacked }) => $stacked && `
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 0.95;
  `}
`;

const TensionSpan = styled.span<{ $size?: ChordSize }>`
  /* Tensions ("#5", "b9", "alt", …) render as a superscript glyph stacked
   * above the ext (e.g. "△7"). Sized at ~64 % of the quality glyph — small
   * enough to subordinate to the base, big enough to remain legible.
   * (Was bumped to 75 % when inline, but stacked superscripts look cleaner
   * at a slightly smaller scale relative to the base.) */
  font-size: ${({ $size }) =>
    $size === 'four'    ? 'clamp(0.55rem, 1.75cqi, 1.0rem)' :
    $size === 'compact' ? 'clamp(0.4rem, 1.2cqi, 0.75rem)' :
    $size === 'split'   ? 'clamp(0.5rem, 1.45cqi, 0.9rem)' :
                          'clamp(0.58rem, 1.85cqi, 1.1rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
`;

/* Diminished sign (°) is rendered ~40% larger than surrounding quality text
 * so it's legible — the raw glyph is tiny in most fonts. Applied via inline
 * em scaling so it rescales with whatever container size the chord uses. */
const Dim = styled.span`
  font-size: 1.4em;
  line-height: 0;
`;

/* Half-diminished (ø) at 'full' size renders compressed in MuseJazz Text —
 * the slashed-O glyph reads as a narrow squished circle next to the "7".
 * Apply a slight horizontal stretch only at 'full' size; smaller sizes
 * (split/compact/four) leave the glyph at its native width since narrower
 * sizing would over-extend it. */
const HalfDim = styled.span<{ $size?: ChordSize }>`
  display: inline-block;
  ${({ $size }) => $size === 'full' && `
    transform: scaleX(1.18);
    transform-origin: center;
    margin: 0 0.05em;
  `}
`;

/** Split a chord quality/base string and wrap glyphs that need custom sizing. */
function renderWithDim(s: string, size?: ChordSize): React.ReactNode {
  if (!s.includes('°') && !s.includes('ø')) return s;
  return s.split(/([°ø])/g).map((p, i) => {
    if (p === '°') return <Dim key={i}>°</Dim>;
    if (p === 'ø') return <HalfDim key={i} $size={size}>ø</HalfDim>;
    return p;
  });
}

const SlashBass = styled.span<{ $size?: ChordSize }>`
  position: absolute;
  left: 8px;
  top: 100%;
  font-size: ${({ $size }) =>
    $size === 'four'    ? 'clamp(0.84rem, 2.45cqi, 1.45rem)' :
    $size === 'compact' ? 'clamp(0.6rem, 1.8cqi, 1.05rem)' :
    $size === 'split'   ? 'clamp(0.7rem, 2.1cqi, 1.2rem)' :
                          'clamp(0.8rem, 2.4cqi, 1.45rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
  white-space: nowrap;
`;

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
          const repeatId = bar.chords[0].id;
          const copied = snapshotPrevBar.map(({ isRepeat: _, ...rest }, index) => ({
            ...rest,
            id: repeatId ? `${repeatId}-r${index + 1}` : rest.id,
          }));
          // Don't update prevBar — next bar repeat should copy the same source
          prevChord = copied[copied.length - 1] ?? null;
          return { ...bar, chords: copied };
        }
        // Otherwise resolve individual repeat chords
        const chords = bar.chords.map((chord) => {
          if (chord.isRepeat && prevChord) {
            const { isRepeat: _, ...rest } = prevChord;
            return { ...rest, id: chord.id ?? rest.id };
          }
          if (!chord.isRepeat) prevChord = chord;
          return chord;
        });
        // Only update prevBar from bars with real chords (not empty bars)
        const realChords = chords.filter((c) => !!c.root);
        if (realChords.length > 0) prevBar = chords;
        return { ...bar, chords };
      }),
    })),
  };
  return resolved;
}

/* ─── degree label (rule-based analysis) ─────────────────────────────────── */

const ChordColumn = styled.div<{ $selected?: boolean; $selectable?: boolean; $editable?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  min-width: 0;
  z-index: 2;
  cursor: ${({ $selectable, $editable }) => $selectable ? 'crosshair' : $editable ? 'pointer' : 'default'};
  touch-action: ${({ $selectable }) => $selectable ? 'none' : 'auto'};
  user-select: none;

  /* Edit-mode affordance: a faint rounded highlight on hover so the user
   * knows the chord is clickable. Uses a negative-inset pseudo so it never
   * changes the glyph's footprint (no layout shift, no size change). */
  ${({ $editable }) => $editable && `
    &::before {
      content: '';
      position: absolute;
      inset: -3px -5px;
      border-radius: 5px;
      background: transparent;
      transition: background 0.12s;
      pointer-events: none;
      z-index: -1;
    }
    &:hover::before { background: rgba(66, 133, 244, 0.1); }
  `}
`;

/* Edit-mode inline input — replaces the chord glyph IN PLACE while editing,
 * rendered at the chord's own font-size (matched to <Root>) so you type
 * directly over the chord rather than in a separate popover box. Width grows
 * with the text via the `size` attribute (set on change). */
const ChordInlineInput = styled.input<{ $size?: ChordSize }>`
  font-size: ${({ $size }) =>
    $size === 'four'    ? 'clamp(1.45rem, 5.15cqi, 3.1rem)' :
    $size === 'compact' ? 'clamp(1.0rem, 3.7cqi, 2.2rem)' :
    $size === 'split'   ? 'clamp(1.2rem, 4.5cqi, 2.8rem)' :
                          'clamp(1.5rem, 5.8cqi, 3.5rem)'};
  font-weight: 700;
  letter-spacing: -0.01em;
  font-family: ${CHORD_FONT};
  line-height: 0.88;
  color: #1a1a1a;
  text-align: center;
  background: rgba(66, 133, 244, 0.1);
  border: none;
  border-bottom: 2px solid rgba(66, 133, 244, 0.75);
  border-radius: 4px 4px 0 0;
  box-sizing: content-box;
  min-width: 1ch;
  padding: 0 0.1em;
  margin: 0;
  outline: none;
`;

/* ── SubV (tritone substitution) decoration: green highlight + label band ── */
const SubVHighlight = styled.div`
  position: absolute;
  left: -8px;
  right: -8px;
  top: -26px;
  bottom: -4px;
  background: rgba(30, 138, 86, 0.14);
  border: 2px solid rgba(30, 138, 86, 0.6);
  box-sizing: border-box;
  border-radius: 4px;
  pointer-events: none;
  z-index: 0;
`;

const SubVBand = styled.div`
  position: absolute;
  left: -6px;
  right: -6px;
  top: -24px;
  height: 18px;
  background: rgba(30, 138, 86, 0.55);
  border-radius: 2px 2px 0 0;
  pointer-events: none;
  z-index: 1;
`;

const SubVBandText = styled.span<{ $size?: ChordSize }>`
  position: absolute;
  left: 0;
  top: -22px;
  font-size: ${({ $size }) =>
    $size === 'compact' ? 'clamp(0.55rem, 1.5cqi, 0.7rem)' :
    $size === 'split'   ? 'clamp(0.6rem,  1.6cqi, 0.78rem)' :
                          'clamp(0.65rem, 1.7cqi, 0.85rem)'};
  font-family: 'Noto Serif', 'Georgia', 'Times New Roman', serif;
  font-weight: 700;
  font-style: italic;
  color: #1a1a1a;
  line-height: 1;
  letter-spacing: 0.04em;
  white-space: nowrap;
  z-index: 3;
  pointer-events: none;
`;

/* ─── ChordSymbol ─────────────────────────────────────────────────────────── */

interface ChordSymbolProps {
  chord: LeadSheetChord;
  size?: ChordSize;
  systemIndex: number;
  chordKey: string;
  selectionTarget?: LeadSheetChordSelection;
  registerEl?: (id: string, el: HTMLSpanElement | null) => void;
  showColors?: boolean;
  showIIVI?: boolean;
  onModalClick?: (chord: LeadSheetChord) => void;
  onSubVClick?: (chord: LeadSheetChord) => void;
  onClick?: () => void;
  onSelectionPointerDown?: (target: LeadSheetChordSelection, event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerEnter?: (target: LeadSheetChordSelection) => void;
  selected?: boolean;
  selectionMode?: boolean;
  iiviHovered?: boolean;
  editMode?: boolean;
  onEdit?: (value: string) => void;
}

function ChordSymbol({
  chord,
  size = 'full',
  systemIndex,
  chordKey,
  selectionTarget,
  registerEl,
  showColors = true,
  showIIVI = true,
  onModalClick,
  onSubVClick,
  onClick,
  onSelectionPointerDown,
  onSelectionPointerEnter,
  selected,
  selectionMode = false,
  iiviHovered = false,
  editMode = false,
  onEdit,
}: ChordSymbolProps) {
  /* Edit mode: clicking a chord swaps its glyph for an inline text input
   * rendered at the same font-size, so you type the new value directly in
   * place (no separate popover). The rule-based analysis decorations stay
   * off via filters while editing. */
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editMode) setEditing(false); }, [editMode]);

  const isNonDiatonic = showColors && chord.isDiatonic === false;
  const isModal = showColors && !!chord.analysis?.modalInterchange;
  // SubV (tritone substitution) highlighting is disabled for now —
  // we're keeping only ii-V-I and modal-interchange decorations. Set
  // to false unconditionally so all SubV-conditional rendering paths
  // (band, badge, popup trigger, ChordWrap $subV outline) become inert.
  const isSubV = false;

  const accChar =
    chord.accidental === '#' ? '♯' :
    chord.accidental === 'b' ? '♭' : null;

  const [base, tensions] = chord.quality
    ? splitQuality(normalizeQuality(chord.quality))
    : ['', ''];

  const hasQuality = !!(base || tensions);
  /* Dominant 7: base is bare "7" (or "7sus", "7sus2", "7sus4"); excludes
   * △7, m7/-7, °7, ø7. Drives a tiny per-glyph offset in <Quality>. */
  const isDom7 = /^7(sus[24]?)?$/.test(base);

  const subVLabel = isSubV  ? `SubV/${chord.analysis!.subV!.targetDegree}` : null;

  const handleChordWrapClick = !selectionMode && (isModal || isSubV) ? (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isModal && onModalClick) onModalClick(chord);
    else if (isSubV && onSubVClick) onSubVClick(chord);
  } : undefined;

  return (
    <ChordColumn
      $selected={selected}
      $selectable={selectionMode}
      $editable={editMode}
      onClick={
        editMode
          ? (e) => { e.stopPropagation(); setEditing(true); }
          : selectionMode ? undefined : onClick
      }
      onPointerDown={!editMode && selectionMode && selectionTarget ? (event) => onSelectionPointerDown?.(selectionTarget, event) : undefined}
      onPointerEnter={!editMode && selectionMode && selectionTarget ? () => onSelectionPointerEnter?.(selectionTarget) : undefined}
    >
      {isSubV && subVLabel && (
        <>
          <SubVHighlight />
          <SubVBand />
          <SubVBandText $size={size}>{subVLabel}</SubVBandText>
        </>
      )}
      {/* Roman-numeral labels are now rendered inside the dark amber tab
          at the LeadSheet level (so they're vertically centered in the
          band via flex/translateY rather than via per-chord pixel
          offsets that varied with chord-cell height). */}
      {editMode && editing ? (
        <ChordInlineInput
          $size={size}
          autoFocus
          spellCheck={false}
          aria-label="코드 수정"
          placeholder="Cmaj7"
          defaultValue={chordToInputString(chord)}
          size={Math.max(chordToInputString(chord).length, 2)}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            onEdit?.(e.target.value);
            e.currentTarget.size = Math.max(e.target.value.length, 2);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isComposingEvent(e)) return; // 한글 조합 확정 Enter 무시
                  if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
      <ChordWrap
        $nonDiatonic={isNonDiatonic && !isSubV}
        $modal={isModal}
        $subV={isSubV}
        $iiviHovered={showIIVI && iiviHovered}
        $size={size}
        data-system-index={systemIndex}
        ref={(el) => {
          if (registerEl) {
            registerEl(chordKey, el);
            if (chord.id) registerEl(chord.id, el);
          }
        }}
        onClick={handleChordWrapClick}
      >
        <Root $size={size}>{chord.root}</Root>

        {(accChar || hasQuality) && (
          <AccQualStack>
            <AccTopSlot>
              {accChar && <Acc $size={size}>{accChar}</Acc>}
            </AccTopSlot>
            {hasQuality && (
              /* Stack tension above base ONLY when there's no chord-level
               * accidental. With an Acc already perched at the top of the
               * root (e.g. F♯), adding a stacked tension creates a confusing
               * 3-row vertical pileup (♯ / tension / base) — so for chords
               * like F♯7♯9 we keep tension inline with the base. Chords
               * without an Acc (E△7♯5 etc.) still benefit from the stack
               * since it saves horizontal space against neighbouring chords.
               *
               * data-inline-tension marks the tension when it's rendered
               * inline (after base). The V→I arrow placement code looks for
               * it to anchor the arrow at the BASE glyph's right edge rather
               * than the tension's, so the cadence arc doesn't shoot off
               * from a high "#9" instead of the "7" trunk. */
              <Quality $size={size} $stacked={!!tensions && !accChar} $dom7={isDom7}>
                {tensions && !accChar && <TensionSpan $size={size}>{tensions}</TensionSpan>}
                <span>{renderWithDim(base, size)}</span>
                {tensions && accChar && (
                  <TensionSpan $size={size} data-inline-tension="true">{tensions}</TensionSpan>
                )}
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
      )}
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

/* final:  thin | thick — end of song marker */
function FinalBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
      <div style={{ width: '1.5px', background: '#000', marginRight: '2px' }} />
      <div style={{ width: '4px',   background: '#000' }} />
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
  isLast: boolean;
  timeSignature: string;
  systemIndex: number;
  /** True when the gap below this row can be compacted (no decoration on the seam). */
  compact?: boolean;
  registerChordEl: (id: string, el: HTMLSpanElement | null) => void;
  registerSystemEl: (index: number, el: HTMLDivElement | null) => void;
  registerGridEl: (index: number, el: HTMLDivElement | null) => void;
  showColors?: boolean;
  showIIVI?: boolean;
  onModalClick?: (chord: LeadSheetChord) => void;
  onSubVClick?: (chord: LeadSheetChord) => void;
  onChordClick?: (chord: LeadSheetChord, measureNumber: number, target?: LeadSheetChordSelection) => void;
  onSelectionPointerDown?: (target: LeadSheetChordSelection, event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerEnter?: (target: LeadSheetChordSelection) => void;
  selectedChordIds?: string[];
  dragPreviewChordIds?: string[];
  selectionTargetByKey?: Map<string, LeadSheetChordSelection>;
  selectionMode?: boolean;
  hoveredIiviChordKeys?: Set<string>;
  editMode?: boolean;
  onChordEdit?: (systemIndex: number, barIndex: number, chordIndex: number, value: string) => void;
  /** Flat bar index of this system's first bar (across all prior systems). */
  barIndexBase: number;
  breakEditMode?: boolean;
  breakPoints?: BreakPoint[];
  onToggleBreak?: (bar: number, beat: number) => void;
  /** Loop region (구간 반복): edit-mode bar picking + start/end markers. */
  loopEditMode?: boolean;
  loopRegion?: { startBar: number; endBar: number } | null;
  loopDraftStart?: number | null;
  onPickLoopBar?: (flatBar: number) => void;
  onLoopBarPointerDown?: (flatBar: number) => void;
  onLoopBarPointerEnter?: (flatBar: number) => void;
}

function SystemRowComponent({
  system,
  isFirst,
  isLast,
  timeSignature,
  systemIndex,
  compact = false,
  registerChordEl,
  registerSystemEl,
  registerGridEl,
  showColors = true,
  showIIVI = true,
  onModalClick,
  onSubVClick,
  onChordClick,
  onSelectionPointerDown,
  onSelectionPointerEnter,
  selectedChordIds,
  dragPreviewChordIds,
  selectionTargetByKey,
  selectionMode = false,
  hoveredIiviChordKeys,
  editMode = false,
  onChordEdit,
  barIndexBase,
  breakEditMode = false,
  breakPoints,
  onToggleBreak,
  loopEditMode = false,
  loopRegion,
  loopDraftStart,
  onPickLoopBar,
  onLoopBarPointerDown,
  onLoopBarPointerEnter,
}: SystemRowProps) {
  const [top, bot] = timeSignature.split('/');
  const beatsPerBar = parseInt(top, 10) || 4;

  // Determine left barline style for the first bar of this row
  const firstBarlineKind: LeftBarlineKind =
    system.hasRepeatStart   ? 'repeat-start'  :
    (isFirst || system.sectionLabel) ? 'section-start' : 'normal';

  const isChordSelected = (target?: LeadSheetChordSelection, chord?: LeadSheetChord) => {
    const id = target?.id ?? chord?.id;
    if (!id) return false;
    return !!selectedChordIds?.includes(id) || !!dragPreviewChordIds?.includes(id);
  };

  return (
    <SystemRow
      ref={(el) => registerSystemEl(systemIndex, el)}
      $sectionStart={!!system.sectionLabel}
      $hasVolta={system.bars.some((b) => b.ending != null)}
      $compact={compact}
    >
      {/* Section label — lifted to SystemRow level so its left edge sits in
       *  the LeftMeta column, sharing the X position of the 4/4 time sig
       *  rather than the chord grid. */}
      {system.sectionLabel && (
        <SectionLabel>{system.sectionLabel}</SectionLabel>
      )}

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
          let endBarlineType: 'none' | 'repeat-end' | 'normal' | 'final' = 'none';
          const isLastReal = i === (lastNonEmpty >= 0 ? lastNonEmpty : system.bars.length - 1);
          if (isLastReal) {
            endBarlineType = system.hasRepeatEnd
              ? 'repeat-end'
              : isLast
                ? 'final'
                : 'normal';
          }

          const kind: LeftBarlineKind = i === 0 ? firstBarlineKind : 'normal';
          const renderChordSymbol = (chord: LeadSheetChord, chordIndex: number, size?: ChordSize) => {
            const chordKey = `${systemIndex}-${i}-${chordIndex}`;
            const target = selectionTargetByKey?.get(chordKey);
            return (
              <ChordSymbol
                key={chordIndex}
                chord={chord}
                size={size ?? (bar.chords.length === 4 ? 'four' : 'full')}
                chordKey={chordKey}
                selectionTarget={target}
                systemIndex={systemIndex}
                registerEl={registerChordEl}
                showColors={showColors}
                showIIVI={showIIVI}
                onModalClick={onModalClick}
                onSubVClick={onSubVClick}
                onClick={() => onChordClick?.(chord, bar.measureNumber ?? -1, target)}
                onSelectionPointerDown={onSelectionPointerDown}
                onSelectionPointerEnter={onSelectionPointerEnter}
                selected={isChordSelected(target, chord)}
                selectionMode={selectionMode}
                iiviHovered={hoveredIiviChordKeys?.has(chordKey)}
                editMode={editMode}
                onEdit={(value) => onChordEdit?.(systemIndex, i, chordIndex, value)}
              />
            );
          };

          // Reserve extra right padding when the end barline is wider than
          // the default 6px gutter, so the rightmost chord doesn't overlap
          // the close-repeat dots / final-barline thickness.
          const endPad = endBarlineType === 'repeat-end' ? 22
            : endBarlineType === 'final' ? 12
            : undefined;

          const flatBar = barIndexBase + i;
          const breakBeat = breakBeatForBar(breakPoints ?? [], flatBar);

          // Loop region (구간 반복) flags for this bar.
          const loopInRegion = !!loopRegion && flatBar >= loopRegion.startBar && flatBar <= loopRegion.endBar;
          const isLoopStart = !!loopRegion && flatBar === loopRegion.startBar;
          const isLoopEnd = !!loopRegion && flatBar === loopRegion.endBar;
          const isLoopDraft = loopDraftStart != null && flatBar === loopDraftStart;

          return (
            <BarCell key={i} data-bar-cell={`${systemIndex}-${i}`} $endPad={endPad}>
              {/* Left barline — skip for empty trailing bars */}
              {!isEmpty && (
                <BarlineArea>
                  <LeftBarline kind={kind} />
                </BarlineArea>
              )}

              {/* Loop region (구간 반복): subtle tint on in-region bars, start/end
                  edge markers (shown in BOTH modes), and a click target while editing. */}
              {(loopInRegion || isLoopDraft) && <LoopRegionTint $draft={!loopInRegion} aria-hidden />}
              {isLoopStart && <LoopStartMark aria-hidden title={`루프 시작 (${flatBar + 1}마디)`} />}
              {isLoopEnd && <LoopEndMark aria-hidden title={`루프 끝 (${flatBar + 1}마디)`} />}
              {loopEditMode && !isEmpty && (
                <LoopPickLayer
                  type="button"
                  aria-label={`${flatBar + 1}번째 마디를 루프 ${loopDraftStart == null ? '시작' : '끝'}으로 선택`}
                  onClick={(e) => { e.stopPropagation(); onPickLoopBar?.(flatBar); }}
                  onPointerDown={(e) => { e.stopPropagation(); onLoopBarPointerDown?.(flatBar); }}
                  onPointerEnter={() => onLoopBarPointerEnter?.(flatBar)}
                />
              )}

              {/* Break Editor: per-beat quarter-note markers above the bar.
                  Clicking a beat means "play THROUGH this beat, then rest" —
                  so the rest starts on the NEXT beat. The active (filled)
                  marker is therefore the last-played beat = breakBeat - 1
                  (breakBeat is the stored rest-start). */}
              {breakEditMode && (
                <BeatMarkerRow style={{ gridTemplateColumns: `repeat(${beatsPerBar}, 1fr)` }}>
                  {Array.from({ length: beatsPerBar }, (_, b) => {
                    const beat = b + 1;
                    return (
                      <BeatMarker
                        key={beat}
                        type="button"
                        $active={breakBeat === beat + 1}
                        aria-label={`${flatBar + 1}번째 마디 ${beat}박까지 연주 후 Break`}
                        onClick={(e) => { e.stopPropagation(); onToggleBreak?.(flatBar, beat); }}
                      >
                        <QuarterNoteGlyph />
                      </BeatMarker>
                    );
                  })}
                </BeatMarkerRow>
              )}

              {/* Break label (shown when a break exists; in edit mode the active
                  marker already indicates it, so only show the label out of edit
                  mode to avoid clutter). */}
              {breakBeat != null && !breakEditMode && (
                <BreakLabel>Break ({breakBeat}/{beatsPerBar})</BreakLabel>
              )}

              {/* End barline */}
              {endBarlineType !== 'none' && (
                <EndBarlineArea>
                  {endBarlineType === 'repeat-end' ? <RepeatEndBarline />
                    : endBarlineType === 'final' ? <FinalBarline />
                    : <NormalLine />}
                </EndBarlineArea>
              )}

              {/* Chord content */}
              {(() => {
                // When the bar carries a close-repeat barline, the
                // ●● thin | thick decoration eats ~15px on the right; squash
                // the chord layout horizontally so multi-chord bars don't
                // crowd the dots. Only applied when a bar carries 3+ chords —
                // 1- and 2-chord bars stay at their natural ('full') size and
                // position regardless of barline type, so chord glyphs in
                // every bar of the same row visually match.
                const compact = endBarlineType === 'repeat-end' && bar.chords.length >= 3;

                if (bar.chords.length === 4) {
                  return (
                    <FourChordGrid $compact={compact}>
                      {bar.chords.map((chord, j) => (
                        <FourChordSlot key={j}>
                          {renderChordSymbol(chord, j)}
                        </FourChordSlot>
                      ))}
                    </FourChordGrid>
                  );
                }

                const [s1, s2] = splitSections(bar.chords);
                const mid = s1.length;
                // 1 chord: full bar, full size
                if (s2.length === 0) {
                  return s1.map((chord, j) => (
                    renderChordSymbol(chord, j, 'full')
                  ));
                }
                // Size policy (per user direction):
                //   • A half-bar section with 1 chord  → 'full'  (same as a
                //     1-chord bar; chord glyphs read identically across bars).
                //   • A half-bar section with 2 chords → still 'full', but the
                //     containing SectionSlot applies a heavy scaleX so the
                //     pair squeezes horizontally to fit while preserving the
                //     letter height. This is the "keep existing size, only
                //     squeeze width" rule.
                // 4-chord bars are handled by the FourChordGrid branch above
                // (uses the smaller 'four' size). Bars with 3 chords land
                // here: typically s1 has 1 chord ('full') and s2 has 2
                // chords ('full' + squeeze).
                const s1Size: ChordSize = 'full';
                const s2Size: ChordSize = 'full';
                return (
                  <BarSections $compact={compact}>
                    <SectionSlot $squeeze={s1.length > 1}>
                      {s1.map((chord, j) => (
                        renderChordSymbol(chord, j, s1Size)
                      ))}
                    </SectionSlot>
                    <SectionSlot $squeeze={s2.length > 1}>
                      {s2.map((chord, j) => (
                        renderChordSymbol(chord, mid + j, s2Size)
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

const DEFAULT_ANALYSIS_FILTERS: AnalysisFilters = {
  showAnalysis: true,
  showDegree: true,
  showIIVI: true,
  showArrows: true,
  showColors: true,
};

interface LeadSheetProps {
  data: LeadSheetData;
  analysisFilters?: AnalysisFilters;
  /** @deprecated Use analysisFilters instead */
  showAnalysis?: boolean;
  /**
   * Flat bar index (across all systems) of the currently playing bar.
   * Pass -1 (or omit) to disable the playback highlight.
   */
  activeBar?: number;
  /**
   * Playback tempo (BPM). When provided, multi-chord bars advance the
   * playback highlight chord-by-chord in beat-proportion within the active
   * bar. Omit to keep the highlight covering the whole bar.
   */
  bpm?: number;
  onChordClick?: (chord: LeadSheetChord, measureNumber: number, target?: LeadSheetChordSelection) => void;
  onChordRangeSelect?: (targets: LeadSheetChordSelection[], pos?: { x: number; y: number }) => void;
  selectedChordIds?: string[];
  selectionMode?: boolean;
  /** 저장된 릭이 있는 ii-V-I 시작 마디 번호 세트 */
  savedLickBarNums?: Set<number>;
  onSavedLickBadgeClick?: (bar: number, spanLabel: string) => void;
  /** Expanded lick row rendered directly below the target chart system —
   *  placed ONCE at the clicked (systemIndex, anchorBar). Pickup-bar skipping
   *  and the I-resolution cutoff are computed inside the render (no
   *  multi-anchor fan-out; that path was rolled back in 3854709). */
  inlineLick?: {
    systemIndex: number;
    anchorBar: number;
    sheet: NoteSheetData;
  } | null;
  onInlineLickClose?: () => void;
  /** Controlled transpose key. When provided the host owns the key — e.g.
   *  ChordPage renders the transpose control in the player transport.
   *  Omit for the standalone uncontrolled (original-key) display. */
  selectedKey?: string;
  /** Replaces the style text at the left of the meta row (e.g. genre dropdown). */
  styleSlot?: ReactNode;
  /** Chord-chart edit mode: every chord renders as a bordered text input. */
  editMode?: boolean;
  /** Fired on each keystroke while editing a chord, with its source indices. */
  onChordEdit?: (systemIndex: number, barIndex: number, chordIndex: number, value: string) => void;
  /** Break Editor mode: show a row of clickable per-beat quarter-note markers
   *  above every bar. Independent of `editMode`. */
  breakEditMode?: boolean;
  /** Active break points (flat bar index + 1-based beat). Renders a `Break
   *  (K/4)` label on marked bars and fills the active marker. */
  breakPoints?: BreakPoint[];
  /** Toggle a break at (flat bar index, 1-based beat). */
  onToggleBreak?: (bar: number, beat: number) => void;
  /** Loop region editor (구간 반복). When `loopEditMode`, clicking a bar calls
   *  `onPickLoopBar(flatBar)` (1st = start, 2nd = end). `loopRegion` (0-based
   *  bar indices) draws start/end edge markers in BOTH modes; `loopDraftStart`
   *  tints the bar picked as start while awaiting the end click. */
  loopEditMode?: boolean;
  loopRegion?: { startBar: number; endBar: number } | null;
  loopDraftStart?: number | null;
  onPickLoopBar?: (flatBar: number) => void;
  onLoopBarPointerDown?: (flatBar: number) => void;
  onLoopBarPointerEnter?: (flatBar: number) => void;
}

interface ActiveBarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionHighlightRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a flat bar index into (systemIndex, barInSystem). */
function flatBarToSystemBar(
  flat: number,
  systems: LeadSheetData['systems'],
): { si: number; bi: number } | null {
  if (flat < 0) return null;
  let cursor = 0;
  for (let si = 0; si < systems.length; si++) {
    const count = systems[si].bars.length;
    if (flat < cursor + count) return { si, bi: flat - cursor };
    cursor += count;
  }
  return null;
}

interface ArrowPathSegment {
  d: string;
  markerEnd?: boolean;
}

interface ResolvedArrow {
  key: string;
  segments: ArrowPathSegment[];
}

interface ResolvedBracket {
  key: string;
  d: string;
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
  /** Roman-numeral labels rendered inside the dark amber tab. Each entry
   *  is positioned at offsetX (px from band's left); vertical centering
   *  is handled in CSS so we don't have to fudge pixel offsets. */
  bandLabels: { offsetX: number; role: string; roleBottom?: string }[];
}

interface ModalHighlightRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bandX: number;
  bandY: number;
  bandWidth: number;
  bandHeight: number;
  bandLabel: { offsetX: number; text: string };
}

function hlBorderRadius(pos: HighlightRect['rowPosition']): string {
  // Body's TOP corners stay sharp because the dark amber tab sits above
  // and provides the rounded top edge — together they read as one shape.
  switch (pos) {
    case 'first':  return '0 0 0 4px';
    case 'last':   return '0 0 4px 0';
    case 'middle': return '0';
    default:       return '0 0 4px 4px';
  }
}

/** Span border: always shown, open ends on multi-row to visually connect rows. */
function hlBorder(pos: HighlightRect['rowPosition'], hovered: boolean): React.CSSProperties {
  const normal = '2px solid rgba(180, 130, 10, 0.5)';
  const strong = '2px solid #B8860B';
  const b = hovered ? strong : normal;
  const tb: React.CSSProperties = { borderTop: b, borderBottom: b };
  switch (pos) {
    case 'first':  return { ...tb, borderLeft: b, borderRight: 'none' };
    case 'last':   return { ...tb, borderRight: b, borderLeft: 'none' };
    case 'middle': return tb;
    default:       return { ...tb, borderLeft: b, borderRight: b };
  }
}

/* Standalone transpose-key dropdown — used by ChordPage's transport bar above
 * the sheet. Reuses the in-sheet KeyButton/KeyMenu look (MuseJazz, 장조/단조). */
export function KeyControl({
  selectedKey,
  onChange,
  isMinor,
}: {
  selectedKey: string;
  onChange: (key: string) => void;
  isMinor: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const up = usePlayerBarPosition() === 'bottom';
  const keys = isMinor ? ALL_MINOR_KEYS : ALL_MAJOR_KEYS;
  return (
    <KeyDropdownWrap ref={ref}>
      <KeyButton onClick={() => setOpen((v) => !v)}>
        {formatKeyDisplay(selectedKey).replace(/m$/, '')}<KeyQual>{isMinor ? '단조' : '장조'}</KeyQual>
      </KeyButton>
      {open && (
        <KeyMenu $up={up}>
          <KeyGrid>
            {keys.map((k) => (
              <KeyOption
                key={k}
                $active={k === selectedKey || k === selectedKey.replace('-', 'm')}
                onClick={() => { onChange(k); setOpen(false); }}
              >
                {k}
              </KeyOption>
            ))}
          </KeyGrid>
        </KeyMenu>
      )}
    </KeyDropdownWrap>
  );
}

export function LeadSheet({
  data,
  analysisFilters,
  showAnalysis,
  activeBar = -1,
  bpm,
  onChordClick,
  onChordRangeSelect,
  selectedChordIds,
  selectionMode = false,
  savedLickBarNums,
  onSavedLickBadgeClick,
  inlineLick,
  onInlineLickClose,
  selectedKey: selectedKeyProp,
  styleSlot,
  editMode = false,
  onChordEdit,
  breakEditMode = false,
  breakPoints,
  onToggleBreak,
  loopEditMode = false,
  loopRegion,
  loopDraftStart,
  onPickLoopBar,
  onLoopBarPointerDown,
  onLoopBarPointerEnter,
}: LeadSheetProps) {
  // Resolve filters: prefer analysisFilters, fall back to legacy showAnalysis prop
  const af = analysisFilters ?? (showAnalysis === false
    ? { showAnalysis: false, showDegree: false, showIIVI: false, showArrows: false, showColors: false }
    : DEFAULT_ANALYSIS_FILTERS
  );
  const outerRef = useRef<HTMLDivElement>(null);
  // In-app fullscreen (CSS overlay below the top bar) instead of the browser's
  // native fullscreen, so the app's top toolbar stays visible.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = () => setIsFullscreen((v) => !v);
  // Mirror to a ref so observer callbacks see the live value without re-binding.
  const isFullscreenRef = useRef(false);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
  // Esc exits fullscreen (native fullscreen handled this for us before).
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);
  const { zoom, zoomIn, zoomOut, setZoomLevel } = useZoom(100);
  const isCompactLayout = useCompactLayout();
  /* On iPhone/iPad in landscape we fit the whole chart on one screen (shrink
   * to fit) instead of scrolling — mirrors iRealPro's landscape behaviour. */
  const isNativeLandscape = useIsNativeLandscape();
  const fitToScreen = isFullscreen || isNativeLandscape;

  // Scroll to top when zoom changes
  useEffect(() => {
    if (!isFullscreen) outerRef.current?.scrollTo({ top: 0 });
  }, [zoom, isFullscreen]);

  // Auto-analyze isDiatonic for all chords
  const analyzedData = useMemo(() => analyzeHarmony(data), [data]);

  const originalKey = analyzedData.key ?? 'C';
  // Controlled (host-owned) when selectedKeyProp is supplied; else internal.
  const [internalKey, setInternalKey] = useState(originalKey);
  const selectedKey = selectedKeyProp ?? internalKey;

  // Reset the uncontrolled key when the song changes. (Controlled hosts reset
  // their own state.)
  useEffect(() => { setInternalKey(originalKey); }, [originalKey]);

  const [keyMenuOpen, setKeyMenuOpen] = useState(false);
  const keyMenuRef = useRef<HTMLDivElement>(null);

  // Modal interchange popup
  const [miPopupChord, setMiPopupChord] = useState<LeadSheetChord | null>(null);
  // SubV popup
  const [subVPopupChord, setSubVPopupChord] = useState<LeadSheetChord | null>(null);

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
    () => (selectedKey === originalKey ? analyzedData : analyzeHarmony(transposeData(analyzedData, selectedKey))),
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
      if (!isFullscreenRef.current) {
        setPageNaturalSize({ w: el.offsetWidth, h: el.offsetHeight });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolvedData]);

  // Compute fit-to-screen scale for fullscreen
  const FS_PAD = 32;      // padding inside fullscreen viewport
  const FS_TOPBAR = 58;   // top toolbar height the overlay sits below
  const [viewportSize, setViewportSize] = useState({ vw: window.innerWidth, vh: window.innerHeight });

  useEffect(() => {
    if (!isFullscreen) return;
    const onResize = () => setViewportSize({ vw: window.innerWidth, vh: window.innerHeight });
    // Capture viewport after entering fullscreen (may need a frame)
    requestAnimationFrame(onResize);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isFullscreen]);

  /* Track the LeadSheet container's size so we can fit the page within IT
   * (not the whole viewport) when running native + landscape. */
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!isNativeLandscape || isFullscreen) return;
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isNativeLandscape, isFullscreen]);

  /* On orientation flip (or entering/leaving fit mode) discard the cached
   * page natural size so the next render measures it again at the new
   * container width — otherwise rotation would scale a stale size. */
  useEffect(() => {
    setPageNaturalSize({ w: 0, h: 0 });
  }, [isNativeLandscape]);

  const fitScale = useMemo(() => {
    if (!fitToScreen || pageNaturalSize.w === 0 || pageNaturalSize.h === 0) return 1;
    if (isFullscreen) {
      const availW = viewportSize.vw - FS_PAD * 2;
      const availH = viewportSize.vh - FS_TOPBAR - FS_PAD * 2;
      return Math.min(availW / pageNaturalSize.w, availH / pageNaturalSize.h) * 1.08;
    }
    // Native landscape: fit inside the lead-sheet's own container, not the
    // whole viewport (the bar above + chat panel beside it eat space).
    const availW = Math.max(0, containerSize.w - 8);
    const availH = Math.max(0, containerSize.h - 8);
    if (!availW || !availH) return 1;
    return Math.min(availW / pageNaturalSize.w, availH / pageNaturalSize.h);
  }, [fitToScreen, isFullscreen, pageNaturalSize, viewportSize, containerSize]);

  // The effective scale: fit-to-screen modes use fitScale, otherwise zoom.
  const effectiveScale = fitToScreen ? fitScale : isCompactLayout ? 1 : zoom / 100;

  /* "Compact" button — toggles between fit-to-one-screen and the zoom the
   * user had before. Behaviour:
   *   1st press   → save current zoom, compute fit, apply.
   *   2nd press   → if still at the fitted zoom, restore the saved one.
   *   If the user manually changes zoom (+/-/preset) in between, the saved
   *   state is invalidated (compactFitRef no longer matches `zoom`) so the
   *   next press starts a fresh compact cycle from the new zoom.
   *
   * Reading from refs (not state) avoids two known traps with the existing
   * state: `containerSize` is only populated in native-landscape mode (would
   * early-return on desktop), and `pageNaturalSize` actually tracks the
   * scaled offsetWidth at the current zoom — so neither is a reliable
   * reference for "true natural size". Working from `factor = avail / current`
   * and multiplying the current zoom sidesteps both. */
  const compactPreZoomRef = useRef<number | null>(null);
  const compactFitZoomRef = useRef<number | null>(null);
  const handleCompact = useCallback(() => {
    /* Toggle back to the saved pre-compact zoom if (a) we stored one AND
     * (b) the current zoom is still the fitted value we set (i.e. the user
     * hasn't manually zoomed since). */
    if (
      compactPreZoomRef.current !== null &&
      compactFitZoomRef.current !== null &&
      zoom === compactFitZoomRef.current
    ) {
      const saved = compactPreZoomRef.current;
      compactPreZoomRef.current = null;
      compactFitZoomRef.current = null;
      setZoomLevel(saved);
      return;
    }
    /* Otherwise: compute fit and engage compact mode. */
    const page = pageRef.current;
    const outer = outerRef.current;
    if (!page || !outer) return;
    const pageW = page.offsetWidth;
    const pageH = page.offsetHeight;
    if (pageW <= 0 || pageH <= 0) return;
    /* Leave a small safety margin so the last bar's border doesn't kiss the
     * bottom edge. Match what fitScale does (-8 each axis). */
    const availW = Math.max(0, outer.clientWidth - 8);
    const availH = Math.max(0, outer.clientHeight - 8);
    if (!availW || !availH) return;
    const factor = Math.min(availW / pageW, availH / pageH);
    /* Match the clamp range that ZoomControls applies (25 … 400) so the
     * stored "fitted" value equals what `zoom` will actually be on the
     * next render — needed for the toggle-back equality check above. */
    const fitted = Math.max(25, Math.min(400, Math.round(zoom * factor)));
    compactPreZoomRef.current = zoom;
    compactFitZoomRef.current = fitted;
    setZoomLevel(fitted);
  }, [zoom, setZoomLevel]);

  const {
    selectionTargetByKey,
    visibleSelectionChordIds,
    dragPreviewChordIds,
    handleSelectionPointerDown,
    handleSelectionPointerEnter,
  } = useLeadSheetSelection({
    resolvedData,
    selectionMode,
    selectedChordIds,
    onChordClick,
    onChordRangeSelect,
  });

  const systemElsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const gridElsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const chordElsRef = useRef<Record<string, HTMLSpanElement | null>>({});
  const [arrowFrame, setArrowFrame] = useState<{ width: number; height: number }>({ width: 1, height: 1 });
  const [arrows, setArrows] = useState<ResolvedArrow[]>([]);
  const [brackets, setBrackets] = useState<ResolvedBracket[]>([]);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [modalHighlights, setModalHighlights] = useState<ModalHighlightRect[]>([]);
  const [activeBarRect, setActiveBarRect] = useState<ActiveBarRect | null>(null);
  // Which chord within the active bar is currently sounding. Only advances for
  // multi-chord bars (driven by the bpm timing effect below); stays 0 otherwise.
  const [activeChordIndex, setActiveChordIndex] = useState(0);
  const [selectionHighlights, setSelectionHighlights] = useState<SelectionHighlightRect[]>([]);
  const [hoveredSpanKey, setHoveredSpanKey] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<{ hl: HighlightRect; anchorX: number; anchorY: number } | null>(null);
  const arrowSpecs = useMemo(() => detectSecDomArrows(resolvedData), [resolvedData]);
  const bracketSpecs = useMemo(() => detectIIVBrackets(resolvedData), [resolvedData]);
  const iiviSpans = useMemo(() => detectIIVI(resolvedData), [resolvedData]);
  const modalChordLabels = useMemo(() => {
    const labels: { chordKey: string; text: string }[] = [];
    resolvedData.systems.forEach((system, si) => {
      system.bars.forEach((bar, bi) => {
        bar.chords.forEach((chord, ci) => {
          const text = chord.analysis?.modalInterchange?.borrowedDegree;
          if (!text) return;
          labels.push({ chordKey: `${si}-${bi}-${ci}`, text });
        });
      });
    });
    return labels;
  }, [resolvedData]);
  const hoveredIiviChordKeys = useMemo(() => {
    if (!af.showIIVI || !hoveredSpanKey) return new Set<string>();
    const spanIndex = Number(hoveredSpanKey.replace('span-', ''));
    return new Set(iiviSpans[spanIndex]?.chordKeys ?? []);
  }, [af.showIIVI, hoveredSpanKey, iiviSpans]);

  // Per-row: can the gap BELOW this row be compacted? Yes when the seam carries
  // no analysis decoration — i.e. this row has no ii-V bracket hanging below AND
  // the next row has no ii-V-I / modal-interchange band tab poking up. Derived
  // from data + the active filter toggles, so compaction tracks what's visible.
  const compactRows = useMemo(() => {
    const n = resolvedData.systems.length;
    const belowDeco = new Array<boolean>(n).fill(false); // ii-V bracket hangs below
    const aboveDeco = new Array<boolean>(n).fill(false); // ii-V-I / modal tab above
    if (af.showIIVI) {
      for (const spec of bracketSpecs) {
        const si = Number(spec.chordId1.split('-')[0]);
        if (si >= 0 && si < n) belowDeco[si] = true;
      }
      for (const span of iiviSpans) {
        for (const ck of span.chordKeys) {
          const si = Number(ck.split('-')[0]);
          if (si >= 0 && si < n) aboveDeco[si] = true;
        }
      }
    }
    if (af.showColors) {
      for (const { chordKey } of modalChordLabels) {
        const si = Number(chordKey.split('-')[0]);
        if (si >= 0 && si < n) aboveDeco[si] = true;
      }
    }
    return resolvedData.systems.map((_, i) => !(belowDeco[i] || aboveDeco[i + 1]));
  }, [resolvedData, bracketSpecs, iiviSpans, modalChordLabels, af.showIIVI, af.showColors]);

  useLayoutEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || visibleSelectionChordIds.length === 0) {
      setSelectionHighlights([]);
      return;
    }

    const scale = effectiveScale;

    const measureSelectionHighlights = () => {
      const freshPageEl = pageRef.current;
      if (!freshPageEl) {
        setSelectionHighlights([]);
        return;
      }

      // Group by systemIndex → barIndex → Set<chordIndex>
      const byRow = new Map<number, Map<number, Set<number>>>();
      visibleSelectionChordIds.forEach((id) => {
        const target = selectionTargetByKey.get(id);
        if (!target) return;
        let barMap = byRow.get(target.systemIndex);
        if (!barMap) { barMap = new Map<number, Set<number>>(); byRow.set(target.systemIndex, barMap); }
        let chordSet = barMap.get(target.barIndex);
        if (!chordSet) { chordSet = new Set<number>(); barMap.set(target.barIndex, chordSet); }
        chordSet.add(target.chordIndex);
      });

      if (byRow.size === 0) {
        setSelectionHighlights([]);
        return;
      }

      const pageRect = freshPageEl.getBoundingClientRect();
      const nextRects: SelectionHighlightRect[] = [];

      // Cross-row continuity: when the selection spans multiple system rows
      // we want the highlight to read as one continuous band — extend the
      // first row to the grid right edge and the last row from the grid
      // left edge so the visual doesn't visually "skip" the line break.
      const rowIndices = [...byRow.keys()].sort((a, b) => a - b);
      const isMultiRow = rowIndices.length > 1;
      const firstRowIdx = rowIndices[0];
      const lastRowIdx = rowIndices[rowIndices.length - 1];

      [...byRow.entries()].forEach(([systemIndex, barMap]) => {
        const gridEl  = gridElsRef.current[systemIndex];
        if (!gridEl || barMap.size === 0) return;

        const gridRect     = gridEl.getBoundingClientRect();
        const visualBars   = Math.max(resolvedData.systems[systemIndex]?.bars.length ?? 4, 4);
        const barW         = gridRect.width / visualBars;

        // Merge bar indices into contiguous ranges
        const sortedBars = [...barMap.keys()].sort((a, b) => a - b);
        const ranges: { minBi: number; maxBi: number }[] = [];
        sortedBars.forEach((bi) => {
          const last = ranges[ranges.length - 1];
          if (last && bi <= last.maxBi + 1) { last.maxBi = bi; }
          else { ranges.push({ minBi: bi, maxBi: bi }); }
        });

        // Vertical bounds: match the yellow ii-V-I highlight EXACTLY so the
        // green selection wraps the dark amber tab on top + the yellow
        // panel below as a single block.
        //   yellow tab top    = gridTop + BARLINE_GAP - TAB_HEIGHT
        //   yellow panel bot  = gridTop + gridHeight - BARLINE_GAP
        const TAB_HEIGHT = 22;
        const y      = (gridRect.top - pageRect.top) / scale + BARLINE_GAP - TAB_HEIGHT;
        const height = gridRect.height / scale - 2 * BARLINE_GAP + TAB_HEIGHT;

        const isFirstRow = systemIndex === firstRowIdx;
        const isLastRow  = systemIndex === lastRowIdx;
        const isMiddleRow = isMultiRow && !isFirstRow && !isLastRow;

        ranges.forEach(({ minBi, maxBi }, index) => {
          // Left edge: leftmost selected chord's fractional start in the first bar
          const firstBar = resolvedData.systems[systemIndex]?.bars[minBi];
          const firstChords = firstBar?.chords ?? [];
          const selectedFirst = barMap.get(minBi);
          const minChordIdx = selectedFirst ? Math.min(...selectedFirst) : 0;
          const startFraction = chordSpanInBar(firstChords, minChordIdx).start;

          // Right edge: mirror yellow ii-V-I exactly.
          //   - single-row 1-chord bar: 0.5  (yellow line ~2323)
          //   - cross-row last-row I:  0.5  (yellow I_CHORD_END_FRACTION, line ~2978)
          const SINGLE_BAR_END_FRACTION = 0.5;
          const I_CHORD_END_FRACTION   = 0.5;
          const lastBar = resolvedData.systems[systemIndex]?.bars[maxBi];
          const lastChords = lastBar?.chords ?? [];
          const realChordCount = lastChords.filter(c => c.root).length;
          const selectedLast = barMap.get(maxBi);
          const maxChordIdx = selectedLast ? Math.max(...selectedLast) : 0;
          let endFraction: number;
          if (realChordCount === 1) {
            endFraction = SINGLE_BAR_END_FRACTION;
          } else if (realChordCount === 0) {
            endFraction = 1.0;
          } else {
            endFraction = chordSpanInBar(lastChords, maxChordIdx).end;
          }

          let hlLeft  = gridRect.left + (minBi + startFraction) * barW;
          let hlRight = gridRect.left + (maxBi + endFraction) * barW;

          if (isMultiRow) {
            const isLastRangeInRow  = index === ranges.length - 1;
            // Mirror the yellow ii-V-I cross-row rules:
            //   - first row's last range bleeds out to the grid right edge
            //   - middle rows are fully covered
            //   - last row keeps its tight bounds (start at the selected
            //     chord's bar, end at the chord's natural endFraction —
            //     which is HALF_BAR_FRACTION for a one-chord I bar)
            if (isFirstRow && isLastRangeInRow) hlRight = gridRect.right;
            if (isMiddleRow) {
              hlLeft = gridRect.left;
              hlRight = gridRect.right;
            }
            // Force half-bar end on the last row's terminating range when
            // the user has selected exactly one chord there (e.g. just
            // the I of a cross-row ii-V-I). This mirrors the yellow
            // highlight's I_CHORD_END_FRACTION rule even if the bar's
            // chord array has filler/repeat cells that would otherwise
            // skip the realChordCount === 1 branch above.
            const selectedInLastBar = barMap.get(maxBi);
            const lastRangeIsSingleChord =
              minBi === maxBi && (selectedInLastBar?.size ?? 0) === 1;
            if (isLastRow && isLastRangeInRow && lastRangeIsSingleChord) {
              hlRight = gridRect.left + (maxBi + I_CHORD_END_FRACTION) * barW;
            }
          }

          // ── Modal interchange override ──
          // If the leftmost / rightmost selected chord is a modal-interchange
          // chord, mirror the purple highlight's bounds exactly. Constants must
          // match the modal-highlight measurement above:
          //   left  = chord text left - MI_HL_PAD_X (8)
          //   right = next sibling chord left - MI_SIBLING_GAP (8)
          //         | bar cell right - (BARLINE_RIGHT_PAD + MI_BAR_INSET) (12)
          const MI_HL_PAD_X      = 8;
          const MI_SIBLING_GAP   = 8;
          const MI_BAR_END_INSET = 12;
          const firstChordObj = firstChords[minChordIdx];
          if (firstChordObj?.analysis?.modalInterchange) {
            const elL = chordElsRef.current[`${systemIndex}-${minBi}-${minChordIdx}`];
            if (elL) hlLeft = elL.getBoundingClientRect().left - MI_HL_PAD_X * scale;
          }
          const lastChordObj = lastChords[maxChordIdx];
          if (lastChordObj?.analysis?.modalInterchange) {
            const elR = chordElsRef.current[`${systemIndex}-${maxBi}-${maxChordIdx}`];
            const barCell = elR?.closest(`[data-bar-cell="${systemIndex}-${maxBi}"]`) as HTMLElement | null;
            if (barCell) {
              const nextEl = chordElsRef.current[`${systemIndex}-${maxBi}-${maxChordIdx + 1}`];
              hlRight = nextEl
                ? nextEl.getBoundingClientRect().left - MI_SIBLING_GAP * scale
                : barCell.getBoundingClientRect().right - MI_BAR_END_INSET * scale;
            }
          }

          nextRects.push({
            key: `selection-${systemIndex}-${index}-${minBi}-${maxBi}`,
            x: (hlLeft - pageRect.left) / scale,
            y,
            width: Math.max((hlRight - hlLeft) / scale, 0),
            height,
          });
        });
      });

      setSelectionHighlights(nextRects);
    };

    measureSelectionHighlights();

    const observer = new ResizeObserver(measureSelectionHighlights);
    observer.observe(pageEl);
    Object.values(gridElsRef.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    window.addEventListener('resize', measureSelectionHighlights);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureSelectionHighlights);
    };
  }, [visibleSelectionChordIds, selectionTargetByKey, resolvedData, effectiveScale, inlineLick]);

  useLayoutEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || (arrowSpecs.length === 0 && bracketSpecs.length === 0 && iiviSpans.length === 0 && modalChordLabels.length === 0)) {
      setArrows([]);
      setBrackets([]);
      setHighlights([]);
      setModalHighlights([]);
      return;
    }

    const scale = effectiveScale;

    const measure = () => {
      const freshPageEl = pageRef.current;
      if (!freshPageEl) {
        setArrows([]);
        setBrackets([]);
        setHighlights([]);
        setModalHighlights([]);
        return;
      }

      const pageRect = freshPageEl.getBoundingClientRect();
      // Helper: convert screen-pixel position to unscaled Page-local coordinate
      const lx = (screenX: number) => (screenX - pageRect.left) / scale;
      const ly = (screenY: number) => (screenY - pageRect.top) / scale;
      const lw = (screenW: number) => screenW / scale;
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
        const targetGridRect = gridElsRef.current[targetSystemIndex]?.getBoundingClientRect();
        const isSameSystem = sourceSystemIndex === targetSystemIndex;

        const targetSlotStartX = (() => {
          if (!isSameSystem) return null;
          const [, biStr, ciStr] = spec.targetChordId.split('-');
          const targetBarIndex = Number(biStr);
          const targetChordIndex = Number(ciStr);
          const targetBar = resolvedData.systems[targetSystemIndex]?.bars[targetBarIndex];
          if (!targetGridRect || !targetBar || !Number.isFinite(targetBarIndex) || !Number.isFinite(targetChordIndex)) {
            return null;
          }

          const visualBarCount = Math.max(resolvedData.systems[targetSystemIndex]?.bars.length ?? 4, 4);
          const barW = targetGridRect.width / visualBarCount;
          const span = chordSpanInBar(targetBar.chords, targetChordIndex);

          // If the target starts at the far-left system boundary, there is no
          // useful "before the bar" space; keep the arrow aimed near the chord.
          if (targetBarIndex === 0 && span.start === 0) return null;
          return targetGridRect.left + (targetBarIndex + span.start) * barW;
        })();

        // Side-to-side: from right edge of source chord to left edge of target chord,
        // slightly above mid-height of the chord row, with a small gap before target.
        //
        // Source-side anchor: if the chord has an inline tension (e.g. F#7#9
        // where "#9" sits to the right of "7"), the chord's bounding right
        // edge is the tension glyph — using it would launch the cadence arc
        // from "#9" instead of "7" and pull the bow up to the tension's
        // height. Switch to the inline-tension's LEFT edge in that case so
        // the arrow originates from the base/ext glyph as it should.
        const inlineTensionEl = sourceEl.querySelector('[data-inline-tension]') as HTMLElement | null;
        const sourceTrunkRight = inlineTensionEl
          ? inlineTensionEl.getBoundingClientRect().left
          : sourceRect.right;
        const x1 = lx(sourceTrunkRight) + (isSameSystem ? 10 : 7);
        const y1 = ly(sourceRect.top + sourceRect.height * 0.5) - 4;
        const targetEndScreenX = isSameSystem && targetSlotStartX != null
          ? targetSlotStartX - 6 * scale
          : targetRect.left - (isSameSystem ? 10 : 7) * scale;
        let x2 = lx(targetEndScreenX);
        if (isSameSystem && x2 <= x1 + 18) {
          x2 = Math.max(lx(targetRect.left) - 10, x1 + 18);
        }
        const y2 = ly(targetRect.top + targetRect.height * 0.5) - 4;

        if (isSameSystem) {
          const [, srcBiStr] = spec.sourceChordId.split('-');
          const [, tgtBiStr] = spec.targetChordId.split('-');
          const isSameBar = srcBiStr === tgtBiStr;

          // Cross-bar arrows already span enough horizontal distance that
          // anchoring the endpoints near the chord's mid-height with a
          // tall 38px bow reads as a clean cadence arc above the row.
          //
          // Same-bar arrows only have ~20–40px to work with. Anchoring at
          // mid-height there squashes the arc behind the chord text, so
          // lift both endpoints just above the chord top and use a shorter
          // bow proportional to the gap (so close pairs get a tight arc,
          // wider pairs a slightly taller one) — clamped for legibility.
          const arcY1 = isSameBar ? ly(sourceRect.top) - 3 : y1;
          const arcY2 = isSameBar ? ly(targetRect.top) - 3 : y2;
          const cx = (x1 + x2) / 2;
          const bowHeight = isSameBar
            ? Math.min(22, Math.max(12, (x2 - x1) * 0.45))
            : 38;
          const cy = Math.min(arcY1, arcY2) - bowHeight;
          resolvedArrows.push({
            key: spec.key,
            segments: [{ d: `M ${x1} ${arcY1} Q ${cx} ${cy} ${x2} ${arcY2}`, markerEnd: true }],
          });
          continue;
        }

        const edgeInset = 24;
        // If the source chord sits mid-row (row doesn't reach near the page
        // right edge — e.g. final system with fewer than 4 bars), draw a
        // single short arrow at the source instead of the long wrap-around.
        const SHORT_ARROW_THRESHOLD = 160;
        if (pageW - edgeInset - x1 > SHORT_ARROW_THRESHOLD) {
          const shortEndX = x1 + 70;
          const shortCx   = x1 + 35;
          const shortCy   = y1 - 28;
          resolvedArrows.push({
            key: spec.key,
            segments: [{
              d: `M ${x1} ${y1} Q ${shortCx} ${shortCy} ${shortEndX} ${y1}`,
              markerEnd: true,
            }],
          });
          continue;
        }

        const exitX = pageW - edgeInset;
        const entryX = edgeInset;
        const sourceExitY = y1;   // exit at same chord-mid height
        const targetEntryY = y2;
        const exitCx = (x1 + exitX) / 2;
        const entryCx = (entryX + x2) / 2;
        const exitCy = y1 - 26;
        const entryCy = y2 - 38;

        // Right half of the entry curve only (split quadratic Bezier at t=0.5):
        // start at the midpoint and use (control + end)/2 as the new control.
        const entryMidX = (entryX + 2 * entryCx + x2) / 4;
        const entryMidY = (targetEntryY + 2 * entryCy + y2) / 4;
        const entryHalfCx = (entryCx + x2) / 2;
        const entryHalfCy = (entryCy + y2) / 2;

        resolvedArrows.push({
          key: spec.key,
          segments: [
            {
              d: `M ${x1} ${y1} Q ${exitCx} ${exitCy} ${exitX} ${sourceExitY}`,
            },
            {
              d: `M ${entryMidX} ${entryMidY} Q ${entryHalfCx} ${entryHalfCy} ${x2} ${y2}`,
              markerEnd: true,
            },
          ],
        });
      }

      /* ── ii-V brackets ── */
      const resolvedBrackets: ResolvedBracket[] = [];
      const BRACKET_GAP = 4;   // px below row bottom
      const BRACKET_DEPTH = 10; // px height of the bracket
      const BRACKET_UNHL_LIFT = 7; // px — non-highlighted ii-V brackets ride up a
                                   // touch toward the chords (no band fills the
                                   // row above them, so the default seam looks loose)

      // Chord keys covered by a (rule-based) ii-V-I highlight span. A bracket
      // whose ii AND V are both highlighted sits flush under the yellow band;
      // a standalone ii-V (no highlight) gets lifted toward the chord text.
      const highlightedKeys = new Set<string>();
      for (const span of iiviSpans) {
        for (const ck of span.chordKeys) highlightedKeys.add(ck);
      }

      for (const spec of bracketSpecs) {
        const el1 = chordElsRef.current[spec.chordId1];
        const el2 = chordElsRef.current[spec.chordId2];
        if (!el1 || !el2) continue;

        const rect1 = el1.getBoundingClientRect();
        const rect2 = el2.getBoundingClientRect();

        const x1 = lx(rect1.left) + lw(rect1.width) / 2;
        const x2 = lx(rect2.left) + lw(rect2.width) / 2;

        /* yBase는 같은 행의 grid 하단(BARLINE_GAP 안쪽) 기준으로 통일.
         * 코드 텍스트 bottom은 superscript/subscript 유무에 따라 달라지므로
         * chord rect를 쓰면 같은 행에서도 브래킷 높이가 어긋남. */
        const siStr = spec.chordId1.split('-')[0];
        const gridEl = gridElsRef.current[Number(siStr)];
        const gridRect = gridEl?.getBoundingClientRect();
        const isHighlighted =
          highlightedKeys.has(spec.chordId1) && highlightedKeys.has(spec.chordId2);
        const lift = isHighlighted ? 0 : BRACKET_UNHL_LIFT;
        const yBase = (gridRect
          ? ly(gridRect.bottom - BARLINE_GAP * scale) + BRACKET_GAP
          : Math.max(ly(rect1.bottom), ly(rect2.bottom)) + BRACKET_GAP) - lift;
        const yBottom = yBase + BRACKET_DEPTH;

        resolvedBrackets.push({
          key: spec.key,
          d: `M ${x1} ${yBase} L ${x1} ${yBottom} L ${x2} ${yBottom} L ${x2} ${yBase}`,
        });
      }

      /* ── ii-V-I highlight bands ── */
      const resolvedHighlights: HighlightRect[] = [];
      const HL_PAD_X = 6;

      // Canonical row height for THIS song — measured from the median of all
      // system grids so the value adapts per-song (longer songs may render
      // smaller chord rows) but stays uniform across rows within a single song.
      const measuredHeights: number[] = [];
      for (let si = 0; si < resolvedData.systems.length; si++) {
        const el = gridElsRef.current[si];
        if (el) measuredHeights.push(el.getBoundingClientRect().height / scale);
      }
      measuredHeights.sort((a, b) => a - b);
      const canonicalRowHeight = measuredHeights.length > 0
        ? measuredHeights[Math.floor(measuredHeights.length / 2)]
        : BAR_H;

      // ── Pivot chords ──────────────────────────────────────────────────
      // A chord that is the I (resolution) of one 2-5-1 AND simultaneously the
      // ii of the next 2-5-1 (classical common-chord). We label it with both
      // numerals stacked ("I" over "ii") on the band that owns it as I, and
      // suppress the duplicate label on the band that uses it as ii — so the
      // two abutting bands don't print numerals on top of each other.
      const roleAt = (s: IIVISpan, idx: number) =>
        s.chordRoles[idx]
          ?? (s.kind === 'minor' ? ['ii°', 'V', 'i'][idx] : ['ii', 'V', 'I'][idx])
          ?? '';
      const iKeys = new Set<string>();
      const iiRoleByKey = new Map<string, string>();
      for (const s of iiviSpans) {
        const last = s.chordKeys.length - 1;
        iKeys.add(s.chordKeys[last]);
        iiRoleByKey.set(s.chordKeys[0], roleAt(s, 0));
      }
      const pivotByKey = new Map<string, { iiRole: string }>();
      for (const [key, iiRole] of iiRoleByKey) {
        if (iKeys.has(key)) pivotByKey.set(key, { iiRole });
      }

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
          /* Floor for the right edge — the I chord glyph's right edge + a
           * small pad. Used by every "snap to bar midpoint" branch below so
           * the highlight never cuts INTO the chord text on narrow widths
           * (where geometric midpoint can land inside the glyph because the
           * text font is min-clamped while the bar slot shrinks). */
          const chordRightFloor = hlRight !== -Infinity
            ? hlRight + HL_PAD_X * scale
            : -Infinity;

          // Fallback X: extend to end of last bar if no element was found
          if (hlRight === -Infinity) {
            hlRight = gridRect.left + (maxBi + 1) * barW;
          } else {
            const lastBar = resolvedData.systems[si]?.bars[maxBi];
            const lastBarChordCount = lastBar?.chords.filter(c => c.root).length ?? 0;
            if (lastBarChordCount === 1) {
              // 1-chord bar: prefer the bar midpoint (iReal-style half-bar
              // look), but never let it cut into the chord text.
              const midpoint = gridRect.left + (maxBi + 0.5) * barW;
              hlRight = Math.max(midpoint, chordRightFloor);
            } else {
              hlRight += HL_PAD_X * scale;
            }
          }

          // Fallback Y: use system element bounds if no chord element was found
          if (minY === Infinity) {
            const sysRect = systemEl?.getBoundingClientRect();
            if (!sysRect) continue;
            minY = sysRect.top + BARLINE_GAP * scale;
            maxY = sysRect.top + (BAR_H - BARLINE_GAP) * scale;
          }

          // Cross-row (consecutive): extend to grid width on open ends.
          // Last row (contains only I) keeps its tight left edge — start exactly
          // at the I chord's bar — and we force its right edge to the bar
          // midpoint so the I chord's highlight reads as a clean half-bar
          // block (matching iReal's visual rule for one-chord bars).
          const I_CHORD_END_FRACTION = 0.5;
          if (isMultiRow && !isWrapAround) {
            if (r === 0) {
              hlRight = gridRect.right;
            } else if (r === rowIndices.length - 1) {
              const midpoint = gridRect.left + (maxBi + I_CHORD_END_FRACTION) * barW;
              hlRight = Math.max(midpoint, chordRightFloor);
            } else {
              hlLeft = gridRect.left;
              hlRight = gridRect.right;
            }
          }
          // Wrap-around: the departure row (largest si, contains ii–V) extends
          // to the right edge; the arrival row (smallest si, contains I) is a
          // half-bar block, same rule as the consecutive-cross-row last row.
          if (isWrapAround) {
            if (si === rowIndices[rowIndices.length - 1]) {
              hlRight = gridRect.right;
            } else if (si === rowIndices[0]) {
              const midpoint = gridRect.left + (maxBi + I_CHORD_END_FRACTION) * barW;
              hlRight = Math.max(midpoint, chordRightFloor);
            }
          }

          // Wrap-around overrides:
          //   - arrival row (smallest si, contains I): 'only' — standalone,
          //     close all edges since there's no neighbor row.
          //   - departure row (largest si, contains ii–V): 'first' — left
          //     side closes at the ii chord, right side bleeds to grid.right.
          //     Without this it'd inherit 'last' (left open / right closed),
          //     making the F-7 (ii) corner unrounded.
          let rowPosition: HighlightRect['rowPosition'] =
            rowIndices.length === 1 ? 'only'
            : r === 0 ? 'first'
            : r === rowIndices.length - 1 ? 'last'
            : 'middle';
          if (isWrapAround && r === 0) rowPosition = 'only';
          if (isWrapAround && r === rowIndices.length - 1) rowPosition = 'first';

          // Compute the roman numeral labels rendered inside the dark
          // amber tab — one per chord that lands on this row of the
          // span. The X offset is measured from the band's left edge
          // so vertical centering can be handled with pure CSS.
          const finalHlX = lx(hlLeft);
          const bandLabels: { offsetX: number; role: string; roleBottom?: string }[] = [];
          for (let kIdx = 0; kIdx < span.chordKeys.length; kIdx++) {
            const ck = span.chordKeys[kIdx];
            const [siStr] = ck.split('-');
            if (Number(siStr) !== si) continue;
            // Pivot: render the stacked "I/ii" only on the span that owns this
            // chord as its I (last role); skip it on the span that uses it as
            // ii (first role) so the label isn't drawn twice on the seam.
            const pivot = pivotByKey.get(ck);
            const isPivotI = !!pivot && kIdx === span.chordKeys.length - 1;
            if (pivot && kIdx === 0) continue;
            const role = span.chordRoles[kIdx]
              ?? (span.kind === 'minor' ? ['ii°', 'V', 'i'][kIdx] : ['ii', 'V', 'I'][kIdx])
              ?? '';
            const el = chordElsRef.current[ck];
            if (!el) continue;
            const elRect = el.getBoundingClientRect();
            // X position of chord glyph in page coords (matches the
            // chord's left edge), then converted to band-local offset.
            const chordX = lx(elRect.left);
            bandLabels.push({
              offsetX: chordX - finalHlX + 4,
              role,
              roleBottom: isPivotI ? pivot!.iiRole : undefined,
            });
          }

          resolvedHighlights.push({
            key: `hl-${spanIdx}-${si}`,
            spanKey: `span-${spanIdx}`,
            x: finalHlX,
            // Vertically match the barline (BARLINE_GAP inset top & bottom).
            // canonicalRowHeight is measured once per song and shared across
            // every highlight in the song, so all rows are uniform — yet the
            // size still adapts naturally for songs with smaller/larger rows.
            y: ly(gridRect.top) + BARLINE_GAP,
            width: lw(hlRight - hlLeft),
            height: canonicalRowHeight - 2 * BARLINE_GAP,
            label: span.label,
            kind: span.kind,
            rowPosition,
            bandLabels,
          });

        }
      }

      /* ── Modal interchange highlight bands ── */
      const MI_HL_PAD_X = 8;
      const MI_HL_OFFSET_TOP = 26;
      // Match IIVI band height (22) so 2-5-1 and modal interchange use the
      // exact same band/body layout — body height = canonicalRow - 2*GAP, band
      // sits ABOVE body separately with same offset.
      const MI_TAB_HEIGHT = 22;
      const MI_BAR_INSET = 6;     // 마디 끝 barline 여백
      const MI_SIBLING_GAP = 8;   // 같은 마디 내 다음 코드와 간격
      const BARLINE_RIGHT_PAD = 6;
      const resolvedModalHighlights: ModalHighlightRect[] = [];

      for (const { chordKey, text } of modalChordLabels) {
        const el = chordElsRef.current[chordKey];
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const chordCenterX = lx((rect.left + rect.right) / 2);
        const chordY = ly(rect.top);

        /* ── 우측만 확장: 같은 마디 내 다음 코드 직전 또는 마디 끝 안쪽까지 ── */
        let rightEdgeScreen = rect.right + MI_HL_PAD_X * scale;
        const parts = chordKey.split('-').map(Number);
        const si = parts[0], bi = parts[1], ci = parts[2];
        const barCell = el.closest(`[data-bar-cell="${si}-${bi}"]`) as HTMLElement | null;
        if (barCell) {
          const nextEl = chordElsRef.current[`${si}-${bi}-${ci + 1}`];
          rightEdgeScreen = nextEl
            ? Math.max(rightEdgeScreen, nextEl.getBoundingClientRect().left - MI_SIBLING_GAP * scale)
            : Math.max(rightEdgeScreen, barCell.getBoundingClientRect().right - (BARLINE_RIGHT_PAD + MI_BAR_INSET) * scale);
        }
        const leftEdgeScreen = rect.left - MI_HL_PAD_X * scale;
        const hlX = lx(leftEdgeScreen);
        const hlW = lw(rightEdgeScreen - leftEdgeScreen);
        // Band shares the body's exact x/width so the two read as one shape
        // (matches the ii-V-I layout). bandX/bandWidth kept for back-compat.
        const bandX = hlX;
        const bandWidth = hlW;

        /* ── 세로 높이: 곡당 캐노니컬 행 높이를 사용해 ii-V-I 하이라이트와
         * 완전히 동일한 디자인 로직으로 정렬되도록 함. y는 각 행의 gridRect.top
         * 기준이지만 height는 곡 전체 공통이라 모든 블록이 한 곡 안에서 균일. */
        const gridEl = gridElsRef.current[si];
        const gridRect = gridEl?.getBoundingClientRect();
        const hlY = gridRect
          ? ly(gridRect.top) + BARLINE_GAP
          : chordY - MI_HL_OFFSET_TOP;
        const hlHeight = canonicalRowHeight - 2 * BARLINE_GAP;

        resolvedModalHighlights.push({
          key: `mi-${chordKey}`,
          x: hlX,
          y: hlY,
          width: hlW,
          height: hlHeight,
          bandX,
          // 탭은 본체 위에 분리되어 위치 — IIVI 하이라이트와 동일한 로직.
          bandY: hlY - MI_TAB_HEIGHT,
          bandWidth,
          bandHeight: MI_TAB_HEIGHT,
          // Center the label over the chord's visual center rather than
          // anchoring its left edge to the chord's left + inset. The label
          // text width (~36px for "bVII") is wider than scaled chord
          // symbols ($size='four' → scaleX(0.78), or compact bars), so a
          // left-anchored label visually drifts off the chord. Centering
          // keeps the label glued to the chord regardless of scaling.
          bandLabel: {
            offsetX: chordCenterX - bandX,
            text,
          },
        });
      }

      setArrowFrame({
        width: pageW,
        height: pageH,
      });
      setArrows(resolvedArrows);
      setBrackets(resolvedBrackets);
      setHighlights(resolvedHighlights);
      setModalHighlights(resolvedModalHighlights);
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
  }, [arrowSpecs, bracketSpecs, iiviSpans, modalChordLabels, resolvedData, effectiveScale, inlineLick]);

  /* ── Per-beat chord advance within the active bar ─────────────────────
   * A bar with 2+ chords advances the playback highlight chord-by-chord in
   * beat-proportion (chordSpanInBar mirrors the painted layout, so each chord
   * owns its beats). Single-chord bars hold index 0 → full-bar highlight.
   * Bar start is approximated at effect-run time; accurate enough for a cue. */
  useEffect(() => {
    if (activeBar < 0) { setActiveChordIndex(0); return; }
    const mapping = flatBarToSystemBar(activeBar, resolvedData.systems);
    const chords = mapping
      ? resolvedData.systems[mapping.si]?.bars[mapping.bi]?.chords ?? []
      : [];
    if (!bpm || bpm <= 0 || chords.length < 2) { setActiveChordIndex(0); return; }

    const beatsPerBar = Number(resolvedData.timeSignature.split('/')[0]) || 4;
    const secPerBar = (60 / bpm) * beatsPerBar;
    if (secPerBar <= 0) { setActiveChordIndex(0); return; }

    setActiveChordIndex(0);
    const barStart = performance.now();
    let raf = 0;
    const tick = () => {
      const frac = Math.min((performance.now() - barStart) / 1000 / secPerBar, 0.9999);
      let idx = chords.length - 1;
      for (let i = 0; i < chords.length; i++) {
        const { start, end } = chordSpanInBar(chords, i);
        if (frac >= start && frac < end) { idx = i; break; }
      }
      setActiveChordIndex((prev) => (prev === idx ? prev : idx));
      if (frac < 0.9999) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeBar, bpm, resolvedData]);

  /* ── Active-bar playback highlight ───────────────────────────────────
   * Transparent sky-blue overlay covering the currently-sounding chord. Its
   * vertical bounds mirror the yellow ii-V-I band EXACTLY (BARLINE_GAP inset
   * top & bottom, song-canonical row height) so the two align when they meet.
   * Recomputes on activeBar / activeChordIndex / scale / resize / data. */
  useLayoutEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || activeBar < 0) {
      setActiveBarRect(null);
      return;
    }
    const scale = effectiveScale;

    const measureActiveBar = () => {
      const freshPageEl = pageRef.current;
      if (!freshPageEl) { setActiveBarRect(null); return; }

      const mapping = flatBarToSystemBar(activeBar, resolvedData.systems);
      if (!mapping) { setActiveBarRect(null); return; }

      const gridEl = gridElsRef.current[mapping.si];
      if (!gridEl) { setActiveBarRect(null); return; }

      const pageRect = freshPageEl.getBoundingClientRect();
      const gridRect = gridEl.getBoundingClientRect();
      const numBars = resolvedData.systems[mapping.si]?.bars.length ?? 4;
      const barW = gridRect.width / numBars;

      // Canonical (median) row height, measured exactly like the yellow band
      // so the sky-blue overlay shares its top & bottom edges.
      const measuredHeights: number[] = [];
      for (let si = 0; si < resolvedData.systems.length; si++) {
        const el = gridElsRef.current[si];
        if (el) measuredHeights.push(el.getBoundingClientRect().height / scale);
      }
      measuredHeights.sort((a, b) => a - b);
      const canonicalRowHeight = measuredHeights.length > 0
        ? measuredHeights[Math.floor(measuredHeights.length / 2)]
        : BAR_H;

      // Beat-proportional sub-region: a multi-chord bar paints only the active
      // chord's slot; a single-chord bar gets span {0,1} → the whole bar.
      const chords = resolvedData.systems[mapping.si]?.bars[mapping.bi]?.chords ?? [];
      const idx = Math.min(Math.max(activeChordIndex, 0), Math.max(chords.length - 1, 0));
      const { start, end } = chordSpanInBar(chords, idx);

      setActiveBarRect({
        x: (gridRect.left + (mapping.bi + start) * barW - pageRect.left) / scale,
        y: (gridRect.top - pageRect.top) / scale + BARLINE_GAP,
        width: ((end - start) * barW) / scale,
        height: canonicalRowHeight - 2 * BARLINE_GAP,
      });
    };

    measureActiveBar();

    const observer = new ResizeObserver(measureActiveBar);
    observer.observe(pageEl);
    window.addEventListener('resize', measureActiveBar);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureActiveBar);
    };
  }, [activeBar, activeChordIndex, resolvedData, effectiveScale, inlineLick]);

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
    // Native landscape: collapse the wrapper to the scaled visible size so the
    // whole chart shows centred in the container without scrolling.
    if (isNativeLandscape && pageNaturalSize.w > 0 && fitScale > 0 && fitScale < 1) {
      return {
        width: `${pageNaturalSize.w * fitScale}px`,
        height: `${pageNaturalSize.h * fitScale}px`,
        margin: '0 auto',
      };
    }
    if (isCompactLayout) {
      return {
        width: '100%',
        minHeight: '100%',
        margin: 0,
      };
    }
    if (zoom === 100) return { width: '100%' };
    return {
      width: pageNaturalSize.w > 0 ? `${pageNaturalSize.w * (zoom / 100)}px` : '100%',
      height: pageNaturalSize.h > 0 ? `${pageNaturalSize.h * (zoom / 100)}px` : undefined,
      margin: '0 auto',
    };
  }, [isFullscreen, isNativeLandscape, isCompactLayout, zoom, pageNaturalSize, fitScale]);

  const pageStyle = useMemo<React.CSSProperties | undefined>(() => {
    // Fit modes always need transform; otherwise compact/zoom=100 means no transform.
    if (!fitToScreen && (effectiveScale === 1 || isCompactLayout)) return undefined;
    // Not measured yet — let the Page render naturally so the observer can
    // capture its size; only then will fitScale kick in.
    if (pageNaturalSize.w === 0) return undefined;
    // In native-landscape, if the chart already fits without shrinking, just
    // render naturally (avoids locking Page width to a possibly-stale measure).
    if (isNativeLandscape && !isFullscreen && effectiveScale >= 1) return undefined;
    return {
      width: `${pageNaturalSize.w}px`,
      transform: `scale(${effectiveScale})`,
      transformOrigin: 'top left',
    };
  }, [effectiveScale, fitToScreen, isFullscreen, isNativeLandscape, isCompactLayout, pageNaturalSize.w]);

  return (
    <ViewerOuter ref={outerRef} $fs={isFullscreen} $fit={isNativeLandscape && !isFullscreen}>
      <FullscreenButton isFullscreen={isFullscreen} onClick={toggleFullscreen} />
      {/* Corner button row (right-anchored, uniform 6px gaps):
       *   [   -  %  +   ] gap6 [ compact ] gap6 [ fullscreen ]
       *      right=80px        right=44px      right=8px
       * Compact + fullscreen share the same 30×30 / radius-6 silhouette. */}
      {!isFullscreen && !isCompactLayout && (
        <>
          <ZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onSetZoom={setZoomLevel}
            rightPx={80}
          />
          <CompactButton onClick={handleCompact} />
        </>
      )}
      <PageShell style={wrapperStyle}>
      <Page ref={pageRef} style={pageStyle}>
        {(af.showArrows || af.showIIVI) && (
          <ArrowLayer viewBox={`0 0 ${Math.max(arrowFrame.width, 1)} ${Math.max(arrowFrame.height, 1)}`}>
            <defs>
              <marker id="secdom-arrow" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#000" strokeWidth="1.3" />
              </marker>
            </defs>
            {af.showArrows && arrows.flatMap((arrow) =>
              arrow.segments.map((segment, index) => (
                <path
                  key={`${arrow.key}-${index}`}
                  d={segment.d}
                  fill="none"
                  stroke="#000"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  markerEnd={segment.markerEnd ? 'url(#secdom-arrow)' : undefined}
                />
              )),
            )}
            {/* ii-V brackets */}
            {af.showIIVI && brackets.map((bracket) => (
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
        {/* ── Background highlight layer (behind text) ──
            Mirrors the Modal Interchange decoration: yellow translucent
            panel + a dark amber "tab" above with the per-chord roman
            numerals (ii / V / I) sitting on top. Both are always visible;
            hover only thickens the surrounding border via hlBorder. */}
        {af.showIIVI && highlights.map((hl) => {
          const isHovered = hoveredSpanKey === hl.spanKey;
          const baseRadius = hlBorderRadius(hl.rowPosition);
          const bandRadius = (() => {
            switch (hl.rowPosition) {
              case 'first':  return '4px 0 0 0';
              case 'last':   return '0 4px 0 0';
              case 'middle': return '0';
              default:       return '4px 4px 0 0';
            }
          })();
          return (
            <div key={`bg-group-${hl.key}`}>
              <div
                key={`band-${hl.key}`}
                style={{
                  position: 'absolute',
                  left: hl.x,
                  top: hl.y - 22,
                  width: hl.width,
                  height: 22,
                  background: 'rgba(201, 133, 30, 0.85)',
                  borderRadius: bandRadius,
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              >
                {/* Roman-numeral labels — vertically centered inside the
                    tab via top:50% + translateY, so we never have to
                    fudge pixel offsets. Horizontal X is the chord's
                    rendered position relative to the band. */}
                {hl.bandLabels.map((lab, i) => (
                  <span
                    key={i}
                    style={{
                      position: 'absolute',
                      left: lab.offsetX,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#111',
                      fontFamily: "'Noto Serif', 'Georgia', 'Times New Roman', serif",
                      fontWeight: 700,
                      // Pivot stacks two numerals in the 22px tab → shrink.
                      fontSize: lab.roleBottom ? '0.6rem' : '0.95rem',
                      letterSpacing: '0.04em',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      ...(lab.roleBottom && {
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                      }),
                    }}
                  >
                    {lab.roleBottom ? (
                      <>
                        <span>{lab.role}</span>
                        <span style={{ width: '1.3em', height: 1, background: 'rgba(0,0,0,0.4)', margin: '1.5px 0' }} />
                        <span>{lab.roleBottom}</span>
                      </>
                    ) : lab.role}
                  </span>
                ))}
              </div>
              <div
                key={`bg-${hl.key}`}
                style={{
                  position: 'absolute',
                  left: hl.x, top: hl.y,
                  width: hl.width, height: hl.height,
                  background: isHovered
                    ? 'rgba(255, 220, 130, 0.55)'
                    : 'rgba(255, 236, 179, 0.45)',
                  borderRadius: baseRadius,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  zIndex: 0,
                  ...hlBorder(hl.rowPosition, isHovered),
                  transition: 'background 0.15s',
                }}
              />
            </div>
          );
        })}
        {af.showColors && modalHighlights.map((hl) => (
          <div key={`mi-group-${hl.key}`}>
            <div
              style={{
                position: 'absolute',
                left: hl.bandX,
                top: hl.bandY,
                width: hl.bandWidth,
                height: hl.bandHeight,
                background: 'rgba(123, 63, 176, 0.85)',
                borderRadius: '4px 4px 0 0',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: hl.bandLabel.offsetX,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: '#111',
                  fontFamily: "'Noto Serif', 'Georgia', 'Times New Roman', serif",
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  letterSpacing: '0.04em',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {hl.bandLabel.text}
              </span>
            </div>
            <div
              style={{
                position: 'absolute',
                left: hl.x,
                top: hl.y,
                width: hl.width,
                height: hl.height,
                background: 'rgba(220, 180, 240, 0.45)',
                border: '2px solid rgba(123, 63, 176, 0.5)',
                boxSizing: 'border-box',
                borderRadius: '0 0 4px 4px',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
          </div>
        ))}

        {/* ── Active-bar playback highlight (sky blue, transparent) ── */}
        {activeBarRect && (
          <div
            style={{
              position: 'absolute',
              left: activeBarRect.x,
              top: activeBarRect.y,
              width: activeBarRect.width,
              height: activeBarRect.height,
              background: 'rgba(135, 206, 250, 0.28)',
              border: 'none',
              outline: 'none',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}

        {selectionHighlights.map((rect) => (
          <div
            key={rect.key}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              background: 'rgba(35, 149, 88, 0.62)',
              boxShadow: 'inset 0 0 0 2px rgba(19, 111, 65, 0.95)',
              borderRadius: 4,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        ))}

        <TitleRow>
          <SheetTitle>{resolvedData.title}</SheetTitle>
        </TitleRow>
        <MetaRow>
          {styleSlot ?? <MetaStyle>{resolvedData.style}</MetaStyle>}
          <span>{resolvedData.composer}</span>
        </MetaRow>

        {resolvedData.systems.map((system, i) => (
          <div key={i}>
            <SystemRowComponent
              system={system}
              isFirst={i === 0}
              isLast={i === resolvedData.systems.length - 1}
              systemIndex={i}
              barIndexBase={resolvedData.systems.slice(0, i).reduce((n, s) => n + s.bars.length, 0)}
              breakEditMode={breakEditMode}
              breakPoints={breakPoints}
              onToggleBreak={onToggleBreak}
              loopEditMode={loopEditMode}
              loopRegion={loopRegion}
              loopDraftStart={loopDraftStart}
              onPickLoopBar={onPickLoopBar}
              onLoopBarPointerDown={onLoopBarPointerDown}
              onLoopBarPointerEnter={onLoopBarPointerEnter}
              compact={compactRows[i]}
              timeSignature={resolvedData.timeSignature}
              registerChordEl={registerChordEl}
              registerSystemEl={registerSystemEl}
              registerGridEl={registerGridEl}
              showColors={af.showColors}
              showIIVI={af.showIIVI}
              onModalClick={setMiPopupChord}
              onSubVClick={setSubVPopupChord}
              onChordClick={onChordClick}
              onSelectionPointerDown={handleSelectionPointerDown}
              onSelectionPointerEnter={handleSelectionPointerEnter}
              selectedChordIds={selectedChordIds}
              dragPreviewChordIds={dragPreviewChordIds}
              selectionTargetByKey={selectionTargetByKey}
              selectionMode={selectionMode}
              hoveredIiviChordKeys={hoveredIiviChordKeys}
              editMode={editMode}
              onChordEdit={onChordEdit}
            />
            {(() => {
              // Inline lick — placed ONCE at the clicked anchor. Each lick
              // measure sits 1:1 under a consecutive chart bar, starting at the
              // anchor and wrapping row by row. Leading no-chord pickup measures
              // are skipped so the first chord-bearing measure lands on the
              // anchor. (Simple + predictable — no multi-anchor fan-out.)
              if (!inlineLick) return null;
              const barsOf = (k: number) => resolvedData.systems[k]?.bars.length ?? 0;
              const globalBarStartOf = (systemIndex: number) => {
                let n = 0;
                for (let k = 0; k < systemIndex; k++) n += barsOf(k);
                return n;
              };
              const measures = inlineLick.sheet.measures;
              // A measure "has a chord" only if it carries a real chord symbol —
              // empty / N.C. / repeat markers count as NO chord. We READ each
              // measure's chord and skip the leading no-chord pickup bar(s) so
              // the lick's first CHORD-bearing measure (e.g. the D-7) lands on
              // the clicked anchor, not the blank pickup.
              const hasChord = (c?: string) => {
                const t = (c ?? '').trim();
                return t.length > 0 && t !== 'N.C.' && t !== 'NC' && t !== '%';
              };
              let start = 0;
              while (start < measures.length && !hasChord(measures[start]?.chord)) start++;
              if (start >= measures.length) start = 0;
              // Stop at the I (tonic) resolution: render only the ii-V-I, not the
              // lick's trailing measures past it (a turnaround / repeated tonic
              // on the next bar). The I = first chord-bearing measure whose chord
              // root equals the lick key's tonic.
              const rootOf = (c: string) =>
                c.trim().match(/^([A-G][b#♭♯]?)/)?.[1]?.replace('♭', 'b').replace('♯', '#') ?? '';
              // Tonic = the CHART's current (written) key — the progression the
              // user clicked resolves to the chart's I, and the lick is transposed
              // to match. Prefer this over the lick's own sheet.key (which can be
              // stale after a transpose), so the I-cap finds the real I (e.g. F△7
              // in F), not a chord that merely shares the original tonic (C7).
              const keyRoot = rootOf(selectedKey || inlineLick.sheet.key || 'C') || 'C';
              let endIdx = measures.length - 1;
              for (let k = start; k < measures.length; k++) {
                const ch = (measures[k]?.chord ?? '').trim();
                if (ch && ch.split(/\s+/).some((sub) => rootOf(sub) === keyRoot)) { endIdx = k; break; }
              }
              const placeCount = endIdx - start + 1;
              if (placeCount <= 0) return null;

              const anchorGlobalBar = globalBarStartOf(inlineLick.systemIndex) + inlineLick.anchorBar;
              const rowGlobalStart = globalBarStartOf(i);
              const rowGlobalEnd = rowGlobalStart + barsOf(i) - 1;
              const lo = Math.max(anchorGlobalBar, rowGlobalStart);
              const hi = Math.min(anchorGlobalBar + placeCount - 1, rowGlobalEnd);
              if (hi < lo) return null;
              const colStart = lo - rowGlobalStart;
              const measureOffset = start + (lo - anchorGlobalBar);
              const colCount = hi - lo + 1;
              const rowHasBracket = bracketSpecs.some((b) => Number(b.chordId1.split('-')[0]) === i);
              return (
                <InlineLickRow
                  sheet={inlineLick.sheet}
                  measureOffset={measureOffset}
                  colStart={colStart}
                  colCount={colCount}
                  firstGlobalBar={lo}
                  rowHasBracket={rowHasBracket}
                  showClose={i === inlineLick.systemIndex}
                  onClose={onInlineLickClose}
                />
              );
            })()}
          </div>
        ))}

        {/* ── Event capture layer (above text, transparent) ──
            Hover shows the tooltip; click opens the saved-licks modal for
            this ii-V-I span (replaces the old "★ 저장 릭" pill badge). */}
        {af.showIIVI && highlights.map((hl) => {
          if (!onSavedLickBadgeClick) return null;
          const spanIdx = Number(hl.spanKey.replace('span-', ''));
          const span = iiviSpans[spanIdx];
          if (!span) return null;
          const [siStr, biStr] = span.chordKeys[0].split('-');
          const bar = resolvedData.systems[Number(siStr)]?.bars[Number(biStr)];
          const barNum = bar?.measureNumber ?? -1;
          if (savedLickBarNums && !savedLickBarNums.has(barNum)) return null;
          const handleSpanClick = () => {
            onSavedLickBadgeClick(barNum, hl.label);
          };
          return (
            <div
              key={`ev-${hl.key}`}
              onMouseEnter={(e) => {
                setHoveredSpanKey(hl.spanKey);
                if (!pageRef.current) return;
                const r = pageRef.current.getBoundingClientRect();
                setActiveTooltip({ hl, anchorX: (e.clientX - r.left) / effectiveScale, anchorY: (e.clientY - r.top) / effectiveScale });
              }}
              onMouseMove={(e) => {
                if (!pageRef.current) return;
                const r = pageRef.current.getBoundingClientRect();
                setActiveTooltip({ hl, anchorX: (e.clientX - r.left) / effectiveScale, anchorY: (e.clientY - r.top) / effectiveScale });
              }}
              onMouseLeave={() => {
                setHoveredSpanKey(null);
                setActiveTooltip(null);
              }}
              onClick={handleSpanClick}
              style={{
                position: 'absolute',
                left: hl.x, top: hl.y,
                width: hl.width, height: hl.height,
                boxSizing: 'border-box',
                background: 'transparent',
                borderRadius: hlBorderRadius(hl.rowPosition),
                cursor: 'pointer',
                pointerEvents: selectionMode ? 'none' : 'auto',
                zIndex: 3,
              }}
            />
          );
        })}


        {/* ── 2-5-1 라벨 — 마우스를 따라다니는 툴팁 ── */}
        {activeTooltip && (
          <div style={{
            position: 'absolute',
            left: activeTooltip.anchorX,
            top: activeTooltip.hl.y,
            transform: 'translate(-50%, -100%)',
            background: 'rgba(160, 110, 5, 0.95)',
            color: '#fff',
            padding: '5px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontFamily: "'Pretendard', sans-serif",
            fontWeight: 700,
            letterSpacing: '0.04em',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}>
            {activeTooltip.hl.label}
          </div>
        )}
      </Page>
      </PageShell>
      {miPopupChord && miPopupChord.analysis?.modalInterchange && (() => {
        const mi = miPopupChord.analysis.modalInterchange;
        const tpl = getModalInterchangeTemplate(mi.sourceMode, mi.borrowedDegree);
        const acc = miPopupChord.accidental === '#' ? '♯' : miPopupChord.accidental === 'b' ? '♭' : '';
        const sym = (miPopupChord.root ?? '') + acc + (miPopupChord.quality ?? '');
        return (
          <ModalInterchangePopup
            chordSymbol={sym}
            sourceMode={mi.sourceMode}
            borrowedDegree={mi.borrowedDegree}
            shortText={tpl.short}
            longText={tpl.long}
            onClose={() => setMiPopupChord(null)}
          />
        );
      })()}
      {subVPopupChord && subVPopupChord.analysis?.subV && (() => {
        const sv = subVPopupChord.analysis.subV;
        const acc = subVPopupChord.accidental === '#' ? '♯' : subVPopupChord.accidental === 'b' ? '♭' : '';
        const sym = (subVPopupChord.root ?? '') + acc + (subVPopupChord.quality ?? '');
        return (
          <SubVPopup
            chordSymbol={sym}
            targetDegree={sv.targetDegree}
            originalVLabel={sv.originalVLabel}
            onClose={() => setSubVPopupChord(null)}
          />
        );
      })()}
    </ViewerOuter>
  );
}
