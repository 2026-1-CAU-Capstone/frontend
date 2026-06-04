import styled from 'styled-components';
import type { ChatChart } from '../../lib/chatChartParser';
import type { LeadSheetData, LeadSheetBar, LeadSheetSystem } from '../../data/leadSheetTypes';
import { parseChordInput } from '../../lib/leadSheetChordEdit';
import { LeadSheet } from '../leadsheet/LeadSheet';

/* ─────────────────────────────────────────────────────────────────────────
 * Inline chord chart for chat messages.
 *
 * Renders the SAME <LeadSheet> component the chord-analysis (/mychord) page
 * uses, so an inline chat chart is pixel-for-pixel identical to the real
 * lead sheet — section labels, barlines, MuseJazz typography, paper card,
 * everything. We just:
 *   - convert the parsed ChatChart (bars as plain strings) into LeadSheetData
 *   - turn OFF every analysis overlay (chat charts are bare progressions with
 *     no rule-based analysis attached)
 *   - hide LeadSheet's interactive chrome (zoom / fullscreen / compact
 *     buttons) and its scroll viewport, since a chat chart is read-only.
 * ──────────────────────────────────────────────────────────────────────── */

/* All analysis decorations off — chat charts carry no analysis data, so we
 * render only the bare lead sheet. */
const CHART_FILTERS = {
  showAnalysis: false,
  showDegree: false,
  showIIVI: false,
  showArrows: false,
  showColors: false,
} as const;

/** Chunk a section's bars into 4-bar systems (rows), matching how the
 *  chord-analysis page lays out one system per row. */
function chunk4<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 4) out.push(arr.slice(i, i + 4));
  return out;
}

/** Convert a parsed ChatChart into the LeadSheetData shape the LeadSheet
 *  component renders. Each bar string ("D-7 G7") is split on whitespace and
 *  each token parsed into a structured LeadSheetChord via the shared parser. */
function chatChartToLeadSheet(chart: ChatChart): LeadSheetData {
  const systems: LeadSheetSystem[] = [];
  let measureNumber = 1;

  for (const section of chart.sections) {
    const rows = chunk4(section.bars);
    rows.forEach((rowBars, rowIdx) => {
      const bars: LeadSheetBar[] = rowBars.map((barStr) => {
        const tokens = (barStr ?? '').split(/\s+/).filter(Boolean);
        const chords = tokens.map((t) => parseChordInput(t));
        return { measureNumber: measureNumber++, chords };
      });
      systems.push({
        // Section label only on the section's first row (matches LeadSheet).
        sectionLabel: rowIdx === 0 ? section.label : undefined,
        bars,
      });
    });
  }

  return {
    title: chart.title ?? '',
    style: '',
    composer: chart.composer ?? '',
    timeSignature: chart.timeSig ?? '4/4',
    key: chart.key,
    systems,
  };
}

interface Props {
  chart: ChatChart;
}

export function ChatChartCard({ chart }: Props) {
  const data = chatChartToLeadSheet(chart);
  return (
    <ChartFrame>
      <LeadSheet data={data} analysisFilters={CHART_FILTERS} />
    </ChartFrame>
  );
}

/* Wrapper that embeds the full LeadSheet read-only inline:
 *   - hide the zoom / fullscreen / compact corner controls
 *   - strip the viewer's scroll/flex/padding chrome so the white "paper"
 *     page sits naturally in the chat flow
 *   - block pointer interaction (no chord selection in a chat chart) */
const ChartFrame = styled.div`
  margin: 14px 0;

  /* The LeadSheet root (ViewerOuter) is the first child div — neutralise its
   * full-page chrome so it lays out as an inline block. */
  & > div {
    overflow: visible !important;
    flex: none !important;
    padding: 0 !important;
    background: transparent !important;
    /* not fixed/fullscreen inside chat */
    position: relative !important;
    inset: auto !important;
  }

  /* Hide all interactive corner controls. */
  .fullscreen-btn,
  .zoom-controls,
  .compact-btn {
    display: none !important;
  }

  /* Read-only: clicks on chords do nothing meaningful here. */
  & * {
    cursor: default;
  }
`;
