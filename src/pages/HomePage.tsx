import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
`;

const ToolBtn = styled.button`
  position: absolute;
  top: 20px;
  right: 24px;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  padding: 6px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  opacity: 0.7;
  transition: all 0.15s;
  &:hover {
    opacity: 1;
    border-color: ${({ theme }) => theme.colors.goldDark};
  }
`;

const LogoImg = styled.img`
  height: 420px;
  margin-bottom: 48px;
  object-fit: contain;
`;

const CardRow = styled.div`
  display: flex;
  gap: 40px;
`;

const Card = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 360px;
  height: 260px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 20px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.goldDark};
    box-shadow: ${({ theme }) => theme.shadows.md};
    transform: translateY(-3px);
  }
`;

const CardIcon = styled.span`
  font-size: 4rem;
  margin-bottom: 20px;
`;

const CardTitle = styled.span`
  font-size: 1.6rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const CardDesc = styled.span`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 10px;
`;

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <Container>
      <ToolBtn onClick={() => navigate('/lick-input')}>Lick JSON Tool</ToolBtn>
      <LogoImg src="/JAZZIFY.jpg" alt="Jazzify" />

      <CardRow>
        <Card onClick={() => navigate('/chord')}>
          <CardIcon>&#119070;</CardIcon>
          <CardTitle>Chord Analysis</CardTitle>
          <CardDesc>ii-V-I, secondary dominants</CardDesc>
        </Card>

        <Card onClick={() => navigate('/note')}>
          <CardIcon>&#9835;</CardIcon>
          <CardTitle>Note Analysis</CardTitle>
          <CardDesc>Melody, voicing, rhythm</CardDesc>
        </Card>

        <Card onClick={() => navigate('/licks')}>
          <CardIcon>&#127927;</CardIcon>
          <CardTitle>Lick Database</CardTitle>
          <CardDesc>8,000+ jazz licks from WJD</CardDesc>
        </Card>
      </CardRow>
    </Container>
  );
}
