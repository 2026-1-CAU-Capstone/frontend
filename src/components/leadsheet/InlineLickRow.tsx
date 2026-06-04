import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Renderer, Stave, Voice, Formatter } from 'vexflow';
import type { NoteSheetData } from '../../data/sampleMelody';
import { buildVfNotes, buildBeams } from '../chat/LickRecommendMessage';
import { useGlobalPlayer } from '../../lib/player';

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

const Row = styled.div<{ $lower?: boolean }>`
  display: flex;
  align-items: flex-start;
  /* Pull up under the chart row. A row that carries a ii-V bracket below its
   * chords drops a bit ($lower) so the lick clears the bracket; clean rows keep
   * the tight height. Bottom margin pushes the NEXT chart row further down so
   * the lick + next line don't crowd. */
  margin: ${({ $lower }) => ($lower ? '-74px' : '-90px')} 0 30px;
  position: relative;
  z-index: 3;
  /* X close button is hidden until the lick is hovered (then black bg). */
  &:hover [data-lick-close] { opacity: 1; }
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
  position: relative;
  z-index: 1;   /* notes paint ABOVE the blue current-measure region */
`;

/* Light-blue current-measure box (mirrors NoteSheet's m-hl). Positioned per
 * playing column via the player subscription; hidden when idle / out of range. */
const Region = styled.div`
  position: absolute;
  top: ${STAFF_TOP - 10}px;
  height: 60px;
  display: none;
  background: rgba(100, 181, 246, 0.13);
  border-radius: 4px;
  pointer-events: none;
  z-index: 0;
`;

/* Close button — sits just ABOVE the first measure's opening barline (x=0 of
 * the score block, which is the lick's first bar). Bigger, "✕" only. */
const Tab = styled.button`
  position: absolute;
  left: -3px;
  top: 11px;           /* sits just above the staff (STAFF_TOP=30), nudged down */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  opacity: 0;                 /* shown only on hover (see Row:hover) */
  transition: opacity .12s;
  &:hover { background: #000; }
`;

interface Props {
  sheet: NoteSheetData;
  /** Index of the first lick measure rendered in THIS row segment. */
  measureOffset: number;
  /** Starting grid column (0..3) for this segment. */
  colStart: number;
  /** Number of measures/columns to draw in this row segment. */
  colCount: number;
  /** Global flat bar index of this segment's first column — used to map the
   *  player's onNote(globalBar)/onBar(globalBar) to a local column for the
   *  blue current-note / current-measure highlight. */
  firstGlobalBar?: number;
  /** This chart row carries a ii-V bracket below → drop the lick a touch. */
  rowHasBracket?: boolean;
  /** Show the "릭 ✕" close tab (only on the first/anchor segment). */
  showClose?: boolean;
  onClose?: () => void;
}

const BLUE_NOTE = '#1565c0';

export function InlineLickRow({
  sheet, measureOffset, colStart, colCount, firstGlobalBar, rowHasBracket, showClose, onClose,
}: Props) {
  const { player } = useGlobalPlayer();
  const gridRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);
  // (column, non-rest note index) → drawn SVG note element, for blue highlight.
  const noteElsRef = useRef<Map<string, SVGElement>>(new Map());
  const prevNoteRef = useRef<SVGElement | null>(null);
  const colWRef = useRef(0);

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
    noteElsRef.current = new Map();
    prevNoteRef.current = null;
    if (gridW <= 0) return;

    const colW = gridW / BARS_PER_ROW;
    colWRef.current = colW;
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
        // Map each non-rest note to its SVG element (ni counts non-rests only,
        // matching the player's onNote note index).
        let ni = 0;
        for (let idx = 0; idx < vfNotes.length; idx++) {
          if (measure.notes[idx]?.duration?.endsWith('r')) continue;
          const svgEl = (vfNotes[idx] as unknown as { getSVGElement?: () => SVGElement }).getSVGElement?.();
          if (svgEl) noteElsRef.current.set(`${m}-${ni}`, svgEl);
          ni++;
        }
      } catch { /* a malformed measure shouldn't kill the whole row */ }
    }

    const svg = host.querySelector('svg');
    if (svg) { (svg as SVGElement).style.overflow = 'visible'; }
  }, [gridW, sheet, measureOffset, colStart, colCount]);

  // Subscribe to the player so the inline lick highlights its current note (blue)
  // + current measure (light-blue box) as the chord chart plays over it.
  useEffect(() => {
    if (firstGlobalBar == null) return;
    const colorNote = (el: SVGElement | null, color: string) => {
      if (!el) return;
      const apply = (e: Element) => { (e as SVGElement).style.fill = color; };
      apply(el); el.querySelectorAll('*').forEach(apply);
    };
    const clear = () => {
      if (prevNoteRef.current) { colorNote(prevNoteRef.current, ''); prevNoteRef.current = null; }
      if (regionRef.current) regionRef.current.style.display = 'none';
    };
    const offNote = player.on('note', (globalBar: number, ni: number) => {
      const col = globalBar - firstGlobalBar;
      if (prevNoteRef.current) colorNote(prevNoteRef.current, '');
      prevNoteRef.current = null;
      if (col < 0 || col >= colCount) return;
      const el = noteElsRef.current.get(`${col}-${ni}`) ?? null;
      if (el) { colorNote(el, BLUE_NOTE); prevNoteRef.current = el; }
    });
    const offBar = player.on('bar', (globalBar: number) => {
      const col = globalBar - firstGlobalBar;
      const region = regionRef.current;
      if (!region) return;
      if (col < 0 || col >= colCount) { region.style.display = 'none'; return; }
      region.style.display = 'block';
      region.style.left = `${col * colWRef.current}px`;
      region.style.width = `${colWRef.current}px`;
    });
    const offDone = player.on('done', clear);
    return () => { offNote(); offBar(); offDone(); clear(); };
  }, [player, firstGlobalBar, colCount]);

  return (
    <Row $lower={rowHasBracket}>
      <LeftSpacer />
      <GridArea ref={gridRef}>
        <ScoreHost>
          {showClose && onClose && <Tab data-lick-close onClick={onClose} title="인라인 릭 닫기">✕</Tab>}
          <Region ref={regionRef} />
          <SvgHost ref={hostRef} />
        </ScoreHost>
      </GridArea>
    </Row>
  );
}
