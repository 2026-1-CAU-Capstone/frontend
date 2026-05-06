import type { ChordOverlay } from '../../data/types';
import { FuncBadge } from '../common/FuncBadge';
import {
  CardContainer,
  CardTitle,
  ChordChipRow,
  ChordChip,
  Arrow,
  ChordStep,
  MoreChip,
  CardBody,
} from './AnalysisCard.styles';

interface AnalysisCardProps {
  chords: ChordOverlay[];
  explanation: string;
}

export function AnalysisCard({ chords, explanation }: AnalysisCardProps) {
  const visibleChords = chords.slice(0, 10);
  const hiddenCount = Math.max(chords.length - visibleChords.length, 0);

  return (
    <CardContainer>
      <CardTitle>선택한 코드 구간 · {chords.length}개</CardTitle>
      <ChordChipRow>
        {visibleChords.map((chord, i) => (
          <ChordStep key={chord.id}>
            {i > 0 && <Arrow>→</Arrow>}
            <ChordChip $func={chord.analysis.func}>
              {chord.symbol}
              <FuncBadge func={chord.analysis.func} />
            </ChordChip>
          </ChordStep>
        ))}
        {hiddenCount > 0 && <MoreChip>+{hiddenCount}</MoreChip>}
      </ChordChipRow>
      <CardBody>{explanation}</CardBody>
    </CardContainer>
  );
}
