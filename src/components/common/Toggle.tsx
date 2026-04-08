import styled from 'styled-components';

const ToggleWrapper = styled.button<{ $active: boolean; $disabled?: boolean; $color?: string }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid ${({ $active, $color, theme }) =>
    $active && $color ? $color + '40' : theme.colors.border};
  background: ${({ $active, $disabled, $color, theme }) =>
    $disabled ? theme.colors.bgPrimary :
    $active ? ($color ? $color + '18' : theme.colors.highlightIiVI) :
    theme.colors.bgPrimary};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ $active, $disabled, $color, theme }) =>
    $disabled ? theme.colors.textSecondary + '60' :
    $active ? ($color ?? theme.colors.tonic) :
    theme.colors.textSecondary};
  opacity: ${({ $disabled }) => $disabled ? 0.5 : 1};
  transition: all 0.15s ease;

  &:hover {
    background: ${({ $disabled, $active, $color, theme }) =>
      $disabled ? theme.colors.bgPrimary :
      $active && $color ? $color + '22' :
      theme.colors.bgSecondary};
  }
`;

const Dot = styled.div<{ $active: boolean; $disabled?: boolean; $color?: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $active, $disabled, $color, theme }) =>
    $disabled ? theme.colors.textSecondary + '40' :
    $active ? ($color ?? theme.colors.tonic) :
    theme.colors.textSecondary};
  transition: background 0.15s ease;
`;

interface ToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  color?: string;
}

export function Toggle({ label, active, onToggle, disabled, color }: ToggleProps) {
  return (
    <ToggleWrapper
      $active={active}
      $disabled={disabled}
      $color={color}
      onClick={disabled ? undefined : onToggle}
    >
      <Dot $active={active} $disabled={disabled} $color={color} />
      {label}
    </ToggleWrapper>
  );
}
