import type { ChordOverlay } from '../../data/types';
import { HighlightBox, DegreeBadge, FuncTag } from './ChordHighlight.styles';

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
      {/* 도수 뱃지 — 악보 코드 위에 표시 (예: ii, V/vi, I) */}
      <DegreeBadge $func={analysis.func}>{analysis.degree}</DegreeBadge>

      {/* 기능 태그 — 영역 안 우하단 (T/SD/D) */}
      <FuncTag $func={analysis.func}>{analysis.func}</FuncTag>
    </HighlightBox>
  );
}
