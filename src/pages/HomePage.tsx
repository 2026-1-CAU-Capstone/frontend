import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
  padding: 20px;

  ${mq.mobile} {
    justify-content: flex-start;
    padding-top: 60px;
  }
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
  max-width: 90%;
  margin-bottom: 48px;
  object-fit: contain;

  ${mq.tablet} {
    height: 280px;
    margin-bottom: 32px;
  }
  ${mq.mobile} {
    height: 180px;
    margin-bottom: 24px;
  }
`;

const CardRow = styled.div`
  display: flex;
  gap: 40px;

  ${mq.tablet} {
    gap: 20px;
  }
  ${mq.mobile} {
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }
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

  ${mq.tablet} {
    width: 280px;
    height: 200px;
  }
  ${mq.mobile} {
    width: 100%;
    height: auto;
    padding: 24px 16px;
    flex-direction: row;
    gap: 16px;
    border-radius: 14px;
  }
`;

const CardIcon = styled.span`
  font-size: 4rem;
  margin-bottom: 20px;

  ${mq.tablet} {
    font-size: 3rem;
    margin-bottom: 14px;
  }
  ${mq.mobile} {
    font-size: 2.2rem;
    margin-bottom: 0;
  }
`;

const CardText = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  ${mq.mobile} {
    align-items: flex-start;
  }
`;

const CardTitle = styled.span`
  font-size: 1.6rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};

  ${mq.tablet} {
    font-size: 1.3rem;
  }
  ${mq.mobile} {
    font-size: 1.15rem;
  }
`;

const CardDesc = styled.span`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 10px;

  ${mq.tablet} {
    font-size: 0.9rem;
  }
  ${mq.mobile} {
    font-size: 0.85rem;
    margin-top: 4px;
  }
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
          <CardText>
            <CardTitle>Chord Analysis</CardTitle>
            <CardDesc>ii-V-I, secondary dominants</CardDesc>
          </CardText>
        </Card>

        <Card onClick={() => navigate('/note')}>
          <CardIcon>&#9835;</CardIcon>
          <CardText>
            <CardTitle>Note Analysis</CardTitle>
            <CardDesc>Melody, voicing, rhythm</CardDesc>
          </CardText>
        </Card>

        <Card onClick={() => navigate('/licks')}>
          <CardIcon>&#127927;</CardIcon>
          <CardText>
            <CardTitle>Lick Database</CardTitle>
            <CardDesc>8,000+ jazz licks from WJD</CardDesc>
          </CardText>
        </Card>

        <Card onClick={() => navigate('/input')}>
          <CardIcon>&#128196;</CardIcon>
          <CardText>
            <CardTitle>악보 인식</CardTitle>
            <CardDesc>PDF / 이미지 → 자동 분석</CardDesc>
          </CardText>
        </Card>
      </CardRow>
    </Container>
  );
}
