import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Renderer, Stave, Voice, Formatter } from 'vexflow';
import type { NoteSheetData } from '../../data/sampleMelody';
import { buildVfNotes, buildBeams } from '../chat/LickRecommendMessage';

/* ─────────────────────────────────────────────────────────────────────────
 * InlineLickRow — renders a saved lick's notation IN FLOW directly under a
 * chord-chart row, measure-aligned to the chart's 4-column grid.
 *
 * The chart row is `LeftMeta (56px) + BarsGrid (4 equal columns)`. We mirror
 * that exactly: a 56px spacer + a grid-width area. The lick's measure m is
 * drawn into chart column (anchorBar + m); rendering stops at the row edge
 * (decision: stay within one row). Each measure is its own VexFlow stave at
 * `col*colWidth` so the barlines land on the chart's column boundaries.
 *
 * Notes carry explicit accidentals (lickMatcher.transposeMeasures writes them
 * into `accidentals`), so we render with an EMPTY key-signature map and no
 * clef/time — compact, and every accidental is explicit (correct without a
 * staff key signature). The lick is already transposed to the chart key by
 * the matcher, satisfying "auto-transpose to chart key".
 * ──────────────────────────────────────────────────────────────────────── */

const BARS_PER_ROW = 4;
const STAFF_TOP = 30;       // px — staff line top inside the SVG
const ROW_HEIGHT = 104;     // px — reserved height (pushes following rows down)
const EMPTY_KACC = new Map<string, 'b' | '#'>();

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  /* pull up tight under the chart row (which has ~44px margin-bottom), small
   * gap before the next row. */
  margin: -56px 0 12px;
  position: relative;
  z-index: 3;
`;

const LeftSpacer = styled.div`
  width: 56px;
  flex-shrink: 0;
  @media (max-width: 960px) { width: 34px; }
`;

const GridArea = styled.div`
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  height: ${ROW_HEIGHT}px;
`;

const ScoreHost = styled.div`
  position: absolute;
  top: 0;
  & svg { display: block; overflow: visible; }
`;

const SvgHost = styled.div`
  width: 100%;
`;

/* Close button — sits just ABOVE the first measure's opening barline (x=0 of
 * the score block, which is the lick's first bar). Bigger, "✕" only. */
const Tab = styled.button`
  position: absolute;
  left: -3px;
  top: 3px;            /* staff begins at STAFF_TOP (30) — this sits just above it */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: #B8860B;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  &:hover { background: #9b7209; }
`;

interface Props {
  sheet: NoteSheetData;
  /** Index of the first lick measure rendered in THIS row segment. */
  measureOffset: number;
  /** Starting grid column (0..3) for this segment. */
  colStart: number;
  /** Number of measures/columns to draw in this row segment. */
  colCount: number;
  /** Show the "릭 ✕" close tab (only on the first/anchor segment). */
  showClose?: boolean;
  onClose?: () => void;
}

export function InlineLickRow({ sheet, measureOffset, colStart, colCount, showClose, onClose }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);

  // Track the chart grid's content width so columns line up exactly.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    setGridW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    if (gridW <= 0) return;

    const colW = gridW / BARS_PER_ROW;
    const visible = Math.min(colCount, sheet.measures.length - measureOffset);
    if (visible <= 0) return;

    const [numBeats, beatValue] = (sheet.timeSignature ?? '4/4').split('/').map(Number);
    const width = visible * colW;

    // Position the score block under the starting column (columns are equal width).
    host.parentElement!.style.left = `${colStart * colW}px`;
    host.parentElement!.style.width = `${width}px`;

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(width, ROW_HEIGHT);
    const ctx = renderer.getContext();

    for (let m = 0; m < visible; m++) {
      const measure = sheet.measures[measureOffset + m];
      const stave = new Stave(m * colW, STAFF_TOP, colW);
      stave.setContext(ctx).draw();
      const vfNotes = buildVfNotes(measure, EMPTY_KACC);
      if (vfNotes.length === 0) continue;
      const beams = buildBeams(vfNotes, measure.notes);
      const voice = new Voice({ numBeats: numBeats || 4, beatValue: beatValue || 4 });
      voice.setStrict(false);
      voice.addTickables(vfNotes);
      try {
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());
      } catch { /* a malformed measure shouldn't kill the whole row */ }
    }

    const svg = host.querySelector('svg');
    if (svg) { (svg as SVGElement).style.overflow = 'visible'; }
  }, [gridW, sheet, measureOffset, colStart, colCount]);

  return (
    <Row>
      <LeftSpacer />
      <GridArea ref={gridRef}>
        <ScoreHost>
          {showClose && onClose && <Tab onClick={onClose} title="인라인 릭 닫기">✕</Tab>}
          <SvgHost ref={hostRef} />
        </ScoreHost>
      </GridArea>
    </Row>
  );
}
