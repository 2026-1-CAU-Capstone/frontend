import styled from 'styled-components';

const ToggleWrapper = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ $active, theme }) => ($active ? theme.colors.highlightIiVI : theme.colors.bgPrimary)};
  cursor: pointer;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ $active, theme }) => ($active ? theme.colors.tonic : theme.colors.textSecondary)};
  transition: all 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const Dot = styled.div<{ $active: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $active, theme }) => ($active ? theme.colors.tonic : theme.colors.textSecondary)};
  transition: background 0.15s ease;
`;

interface ToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
}

export function Toggle({ label, active, onToggle }: ToggleProps) {
  return (
    <ToggleWrapper $active={active} onClick={onToggle}>
      <Dot $active={active} />
      {label}
    </ToggleWrapper>
  );
}
