import type { ChordOverlay } from '../../data/types';
import { BracketBox, BracketLabel } from './GroupBracket.styles';

interface GroupBracketProps {
  chords: ChordOverlay[];
  groupType: string;
  selected: boolean;
  visible: boolean;
}

export function GroupBracket({ chords, groupType, selected, visible }: GroupBracketProps) {
  if (!visible || chords.length === 0) return null;

  const minX = Math.min(...chords.map((c) => c.position.x));
  const minY = Math.min(...chords.map((c) => c.position.y));
  const maxX = Math.max(...chords.map((c) => c.position.x + c.position.width));
  const maxY = Math.max(...chords.map((c) => c.position.y + c.position.height));

  const pad = 0.01;

  return (
    <BracketBox
      $selected={selected}
      style={{
        left: `${(minX - pad) * 100}%`,
        top: `${(minY - pad) * 100}%`,
        width: `${(maxX - minX + pad * 2) * 100}%`,
        height: `${(maxY - minY + pad * 2) * 100}%`,
      }}
    >
      <BracketLabel>{groupType}</BracketLabel>
    </BracketBox>
  );
}
