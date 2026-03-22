import type { ChordOverlay } from '../../data/types';
import { HighlightBox, ChordLabel, DegreeLabel } from './ChordHighlight.styles';

interface ChordHighlightProps {
  chord: ChordOverlay;
  selected: boolean;
  grouped: boolean;
  visible: boolean;
  onClick: (chord: ChordOverlay) => void;
}

export function ChordHighlight({
  chord,
  selected,
  grouped,
  visible,
  onClick,
}: ChordHighlightProps) {
  const { position, analysis } = chord;

  return (
    <HighlightBox
      $func={analysis.func}
      $selected={selected}
      $grouped={grouped}
      $visible={visible}
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
        width: `${position.width * 100}%`,
        height: `${position.height * 100}%`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(chord);
      }}
    >
      <ChordLabel>{chord.symbol}</ChordLabel>
      <DegreeLabel>{analysis.degree}</DegreeLabel>
    </HighlightBox>
  );
}
