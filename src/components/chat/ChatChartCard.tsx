import styled from 'styled-components';
import type { ChatChart } from '../../lib/chatChartParser';

/* ─────────────────────────────────────────────────────────────────────────
 * Inline chord chart card for chat messages.
 *
 * Visually mirrors the ChordPage LeadSheet style — same chord font, same
 * grid layout with clear section labels and bar cells — but in a self-
 * contained, chat-bubble-friendly card. No zoom controls, no key dropdown,
 * no analysis annotations. Just the chart, like iRealPro.
 * ──────────────────────────────────────────────────────────────────────── */

const CHORD_FONT = "'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif";

const Card = styled.div`
  background: #fff;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 22px 24px 20px;
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
  margin-bottom: 4px;
`;

const Meta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  margin-bottom: 16px;

  .composer { font-style: italic; }
  .key { font-weight: 600; }
`;

const SectionWrap = styled.div`
  margin: 10px 0;
`;

const SectionLabel = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 6px;
  padding-left: 4px;
`;

const BarGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1.5px solid #2a2a2a;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 14px;
  border-right: 1px solid #2a2a2a;
  border-bottom: 1px solid #2a2a2a;
  font-size: 1.15rem;
  min-height: 52px;

  /* No right border on the last column */
  &:nth-child(4n) { border-right: none; }
`;

/* Strip bottom borders from the last row of bars in each section */
const BarGridLastRow = styled(BarGrid)`
  ${Bar}:nth-last-child(-n + 4) { border-bottom: none; }
`;

const ChordSymbol = styled.span`
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
`;

interface Props {
  chart: ChatChart;
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
        // Pad bars so the grid always has multiples of 4 cells per section
        const bars = sec.bars;
        const remainder = bars.length % 4;
        const padded = remainder === 0 ? bars : [...bars, ...Array(4 - remainder).fill('')];

        return (
          <SectionWrap key={si}>
            {sec.label && <SectionLabel>{sec.label}</SectionLabel>}
            <BarGridLastRow>
              {padded.map((bar, bi) => (
                <Bar key={bi}>
                  {bar
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((c: string, ci: number) => (
                      <ChordSymbol key={ci}>{c}</ChordSymbol>
                    ))}
                </Bar>
              ))}
            </BarGridLastRow>
          </SectionWrap>
        );
      })}
    </Card>
  );
}
