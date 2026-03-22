import styled from 'styled-components';

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
  display: ${({ $visible }) => ($visible ? 'flex' : 'none')};
  flex-direction: column;
  align-items: center;
  justify-content: center;
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

export const ChordLabel = styled.span`
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  pointer-events: none;
`;

export const DegreeLabel = styled.span`
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  pointer-events: none;
`;
