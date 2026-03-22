import styled from 'styled-components';

const Badge = styled.span<{ $func: 'T' | 'SD' | 'D' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.chord};
  color: white;
  background: ${({ $func, theme }) =>
    $func === 'T'
      ? theme.colors.tonic
      : $func === 'D'
        ? theme.colors.dominant
        : theme.colors.subdominant};
`;

interface FuncBadgeProps {
  func: 'T' | 'SD' | 'D';
}

export function FuncBadge({ func }: FuncBadgeProps) {
  return <Badge $func={func}>{func}</Badge>;
}
