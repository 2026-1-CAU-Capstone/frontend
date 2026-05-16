import styled from 'styled-components';
import type { ChatChart } from '../../lib/chatChartParser';
import { formatChordsInText } from './chordFormat';

/* ─────────────────────────────────────────────────────────────────────────
 * Inline chord chart card for chat messages.
 *
 * Visually mirrors the ChordPage LeadSheet style:
 *   - black-filled square SectionLabel floating top-left of each system
 *   - 4 bars per row, separated by thin vertical barlines (no grid borders)
 *   - thicker barline on the right edge of a system end
 *   - jazz chord typography (MuseJazz Text) with sub/superscript handling
 *
 * Differences from the full LeadSheet:
 *   - no analysis annotations / overlays
 *   - no repeat / volta / coda markers (chat charts are usually simple)
 *   - chord symbols are already-formatted text, not LeadSheetChord objects
 * ──────────────────────────────────────────────────────────────────────── */

const CHORD_FONT = "'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif";
const LABEL_FONT = "'Pretendard', 'Pretendard', sans-serif";

const Card = styled.div`
  background: #fff;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 26px 22px 18px;
  margin: 14px 0;
  font-family: ${CHORD_FONT};
  color: #111;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
`;

const Title = styled.div`
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
  margin-bottom: 2px;
`;

const Meta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${LABEL_FONT};
  margin-bottom: 18px;

  .composer { font-style: italic; }
  .key { font-weight: 600; }
`;

/** A system is one "row" — 4 bars side by side with a section label floating
 *  on top-left like the LeadSheet component does. */
const System = styled.div`
  position: relative;
  margin: 22px 0 16px;
  &:first-of-type { margin-top: 8px; }
`;

const SectionLabel = styled.div`
  position: absolute;
  top: -16px;
  left: 0;
  background: #000;
  color: #fff;
  font-family: ${LABEL_FONT};
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1;
  padding: 4px 8px;
  letter-spacing: 0.02em;
  z-index: 2;
`;

/** 4 bars in a row separated by thin vertical barlines on each bar's LEFT
 *  edge. The wrapping <Row> draws the top/bottom horizontal bars so the
 *  whole system reads as one continuous staff. */
const Row = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1.5px solid #2a2a2a;
  border-bottom: 1.5px solid #2a2a2a;
  position: relative;

  /* End-of-system thicker double barline visually. We just add a heavier
   * right border on the row. */
  border-right: 2.5px solid #2a2a2a;
  border-left: 1.5px solid #2a2a2a;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding: 16px 14px;
  min-height: 60px;
  border-left: 1px solid #2a2a2a;

  &:first-child { border-left: none; }

  /* In a partial last row (e.g. 2 bars instead of 4), keep the right border
   * thin so it doesn't look like the system is closed. The system's outer
   * right border handles the full close. */
`;

const ChordSymbol = styled.span`
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  font-size: 1.25rem;
`;

/** When a single bar holds 2 chords ("D-7 G7"), put them side-by-side. */
const ChordPair = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 18px;
`;

interface Props {
  chart: ChatChart;
}

/** Split a section's bars into 4-bar rows. Last row may be partial. */
function chunk4<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 4) out.push(arr.slice(i, i + 4));
  return out;
}

export function ChatChartCard({ chart }: Props) {
  return (
    <Card>
      {chart.title && <Title>{chart.title}</Title>}
      {(chart.composer || chart.key || chart.timeSig) && (
        <Meta>
          <span className="composer">{chart.composer ?? ''}</span>
          <span className="key">
            {chart.key ? `Key: ${chart.key}` : ''}
            {chart.key && chart.timeSig ? ' · ' : ''}
            {chart.timeSig ?? ''}
          </span>
        </Meta>
      )}
      {chart.sections.map((sec, si) => {
        const rows = chunk4(sec.bars);
        return (
          <div key={si}>
            {rows.map((row, ri) => {
              // Pad incomplete final row so the 4-column grid stays aligned
              // (empty bars get no left border so they read as continued empty space).
              const padded = row.length < 4 ? [...row, ...Array(4 - row.length).fill('')] : row;
              return (
                <System key={`s-${si}-r-${ri}`}>
                  {ri === 0 && sec.label && <SectionLabel>{sec.label}</SectionLabel>}
                  <Row>
                    {padded.map((bar, bi) => {
                      const chords = (bar ?? '').split(/\s+/).filter(Boolean);
                      return (
                        <Bar key={bi}>
                          {chords.length === 0 ? null :
                           chords.length === 1 ? (
                             <ChordSymbol>{formatChordsInText(chords[0])}</ChordSymbol>
                           ) : (
                             <ChordPair>
                               {chords.map((c: string, ci: number) => (
                                 <ChordSymbol key={ci}>{formatChordsInText(c)}</ChordSymbol>
                               ))}
                             </ChordPair>
                           )}
                        </Bar>
                      );
                    })}
                  </Row>
                </System>
              );
            })}
          </div>
        );
      })}
    </Card>
  );
}
