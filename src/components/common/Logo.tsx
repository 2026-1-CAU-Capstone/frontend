import styled from 'styled-components';

const LogoWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const LogoIcon = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const LogoText = styled.span`
  font-weight: 700;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

export function Logo() {
  return (
    <LogoWrapper>
      <LogoIcon>J</LogoIcon>
      <LogoText>Jazzify</LogoText>
    </LogoWrapper>
  );
}
