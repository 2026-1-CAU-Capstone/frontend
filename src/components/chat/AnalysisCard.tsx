import type { ChordOverlay } from '../../data/types';
import { FuncBadge } from '../common/FuncBadge';
import {
  CardContainer,
  CardTitle,
  ChordChipRow,
  ChordChip,
  Arrow,
  CardBody,
} from './AnalysisCard.styles';

interface AnalysisCardProps {
  chords: ChordOverlay[];
  explanation: string;
}

export function AnalysisCard({ chords, explanation }: AnalysisCardProps) {
  return (
    <CardContainer>
      <CardTitle>코드 분석</CardTitle>
      <ChordChipRow>
        {chords.map((chord, i) => (
          <span key={chord.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <Arrow>→</Arrow>}
            <ChordChip $func={chord.analysis.func}>
              {chord.symbol}
              <FuncBadge func={chord.analysis.func} />
            </ChordChip>
          </span>
        ))}
      </ChordChipRow>
      <CardBody>{explanation}</CardBody>
    </CardContainer>
  );
}
