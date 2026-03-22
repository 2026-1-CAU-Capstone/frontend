import styled from 'styled-components';

export const BracketBox = styled.div<{ $selected: boolean }>`
  position: absolute;
  border: 2px dashed ${({ $selected, theme }) => ($selected ? theme.colors.gold : theme.colors.tonic)};
  border-radius: 8px;
  pointer-events: none;
  transition: all 0.2s ease;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.highlightSelected : 'transparent'};
`;

export const BracketLabel = styled.div`
  position: absolute;
  top: -18px;
  left: 4px;
  font-size: 10px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.chord};
  color: ${({ theme }) => theme.colors.tonic};
  white-space: nowrap;
`;
