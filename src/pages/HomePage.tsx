import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
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
      </CardRow>
    </Container>
  );
}
