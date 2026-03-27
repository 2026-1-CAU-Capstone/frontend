import styled from 'styled-components';

/* 반투명 영역 — 원본 악보 코드 위에 겹침 */
export const HighlightBox = styled.div<{
  $func: 'T' | 'SD' | 'D';
  $selected: boolean;
  $grouped: boolean;
  $visible: boolean;
}>`
  position: absolute;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: ${({ $visible }) => ($visible ? 'block' : 'none')};
  background: ${({ $func, $selected, theme }) =>
    $selected
      ? theme.colors.highlightSelected
      : $func === 'T'
        ? theme.colors.highlightIiVI
        : $func === 'D'
          ? theme.colors.highlightSecDom
          : theme.colors.highlightModal};
  border: 2px solid
    ${({ $selected, $grouped, theme }) =>
      $selected
        ? theme.colors.gold
        : $grouped
          ? theme.colors.tonic
          : 'transparent'};

  &:hover {
    box-shadow: ${({ theme }) => theme.shadows.md};
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

/* 도수 뱃지 — 코드 영역 바로 위에 표시 */
export const DegreeBadge = styled.div<{ $func: 'T' | 'SD' | 'D' }>`
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 2px;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  color: white;
  background: ${({ $func, theme }) =>
    $func === 'T'
      ? theme.colors.tonic
      : $func === 'D'
        ? theme.colors.dominant
        : theme.colors.subdominant};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

/* 기능 표시 (T/SD/D) — 코드 영역 안 우측 하단 */
export const FuncTag = styled.span<{ $func: 'T' | 'SD' | 'D' }>`
  position: absolute;
  bottom: 2px;
  right: 2px;
  padding: 0 4px;
  border-radius: 3px;
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 9px;
  font-weight: 700;
  pointer-events: none;
  color: white;
  opacity: 0.85;
  background: ${({ $func, theme }) =>
    $func === 'T'
      ? theme.colors.tonic
      : $func === 'D'
        ? theme.colors.dominant
        : theme.colors.subdominant};
`;
