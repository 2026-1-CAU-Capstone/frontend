import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { AuthTopBar } from '../../components/layout/AuthTopBar';
import { StudioSidebar } from '../components/StudioSidebar';
import { STUDIO_NAV } from '../nav';

/* ─────────────────────────────────────────────────────────────────────────
 * StudioHome — 스튜디오 첫 화면.
 *
 * 실서비스 홈과 **레이아웃은 같다**(좌측 레일 + 상단 계정 바 + 본문). 다른 점은
 * 히어로에 **AI 채팅이 없다**는 것 — 스튜디오는 데이터를 만드는 작업대라 대화
 * 진입점이 필요 없다. 그 자리에 도구 카드를 깐다.
 * ──────────────────────────────────────────────────────────────────────── */

export default function StudioHome() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  return (
    <Wrapper>
      <StudioSidebar expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      <Main>
        <AuthTopBar onLoginClick={() => navigate('/login')} />
        <Content>
          <Hero>
            <Title>Jazzify Studio</Title>
            <Subtitle>릭 · 솔로 · 컴핑 데이터를 만들고 검수하는 내부 작업대입니다.</Subtitle>
          </Hero>
          <ToolGrid>
            {STUDIO_NAV.map((t) => (
              <ToolCard key={t.path} type="button" onClick={() => navigate(t.path)}>
                <CardIcon><t.icon /></CardIcon>
                <CardLabel>{t.label}</CardLabel>
                <CardDesc>{t.desc}</CardDesc>
              </ToolCard>
            ))}
          </ToolGrid>
        </Content>
      </Main>
    </Wrapper>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────── */

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.barBelow};
`;

const Main = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 48px 32px 64px;
  ${mq.phone} { padding: 24px 16px 48px; }
`;

const Hero = styled.div`
  max-width: 900px;
  margin: 0 auto 36px;
  text-align: center;
`;

const Title = styled.h1`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 10px;
  ${mq.phone} { font-size: 26px; }
`;

const Subtitle = styled.p`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ToolGrid = styled.div`
  max-width: 900px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
`;

const ToolCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
  padding: 16px 18px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.surface};
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  transition: border-color 0.12s, transform 0.1s, box-shadow 0.12s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.textSecondary};
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
  }
  &:active { transform: scale(0.99); }
`;

const CardIcon = styled.span`
  display: flex;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 2px;
`;

const CardLabel = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const CardDesc = styled.span`
  font-size: 12.5px;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
