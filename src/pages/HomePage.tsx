import { useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { mq } from '../styles/theme';
import { RightChatPanel } from '../components/layout/RightChatPanel';

/* ─────────────────────────────────────────────────────────────────────────
 * HomePage (intro screen).
 *
 * The chat behaviour is identical to ChordPage / NotePage — same
 * `RightChatPanel` component, same RAG / lick-card / chord-chart logic.
 * What's different here is the EMPTY-STATE visual: instead of the panel's
 * default "click a chord / ask below" prompt, we show the classic Jazzify
 * intro (big logo + greeting + subtitle + mobile tool grid). The moment a
 * message is sent, the empty state disappears and the panel becomes a
 * regular chat surface.
 * ──────────────────────────────────────────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`;

/* ── Layout ───────────────────────────────────────────────────── */

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
  position: relative;
`;

const AdminBtn = styled.button`
  position: absolute;
  top: max(16px, env(safe-area-inset-top, 0px));
  right: max(22px, calc(env(safe-area-inset-right, 0px) + 16px));
  padding: 7px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  z-index: 50;
  transition: all 0.12s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }

  ${mq.mobile} {
    padding: 5px 10px;
    font-size: 0.74rem;
  }
`;

const MobileBrandBar = styled.div`
  display: none;
  ${mq.mobile} {
    display: flex;
    align-items: center;
    gap: 8px;
    position: absolute;
    top: max(14px, env(safe-area-inset-top, 0px));
    left: max(16px, env(safe-area-inset-left, 0px));
    z-index: 40;
    pointer-events: none;
  }
`;

const MobileBrandLogo = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
`;

const MobileBrandName = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.98rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: 0.02em;
`;

/* ── Sidebar (desktop tool list) ─────────────────────────────── */

const Sidebar = styled.aside`
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  padding: 22px 16px;
  gap: 22px;
  overflow: hidden;

  ${mq.mobile} {
    display: none;
  }
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
`;

const BrandLogo = styled.img`
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
`;

const BrandName = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 1.15rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: 0.02em;
`;

const SidebarSpacer = styled.div`
  flex: 1;
  min-height: 0;
`;

const ToolList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding-top: 16px;
`;

const ToolBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  border: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.98rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, color 0.12s;

  > span:first-child {
    font-size: 1.2em;
    width: 24px;
    text-align: center;
    color: ${({ theme }) => theme.colors.textSecondary};
  }

  &:hover {
    background: ${({ theme }) => theme.colors.bgPrimary};
    > span:first-child { color: ${({ theme }) => theme.colors.gold}; }
  }
`;

/* ── Main column ─────────────────────────────────────────────── */

const Main = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const ChatArea = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;

  & > aside {
    border-left: none;
  }
`;

/* ── Intro empty-state visual (shown only when messages.length === 0) ──── */

const IntroBlock = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 16px 24px;
`;

const HeroLogo = styled.img`
  width: 96px;
  height: 96px;
  border-radius: 22px;
  margin-bottom: 22px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.08);
  animation: ${fadeIn} 0.5s ease both;

  ${mq.mobile} {
    width: 72px;
    height: 72px;
    margin-bottom: 16px;
  }
`;

const Greeting = styled.h1`
  font-size: 2.4rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0 0 14px;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.05s ease both;

  ${mq.mobile} {
    font-size: 1.6rem;
  }
`;

const Subtitle = styled.p`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.1s ease both;

  ${mq.mobile} {
    font-size: 0.92rem;
  }
`;

const ToolGrid = styled.div`
  display: none;

  ${mq.mobile} {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    max-width: 480px;
    margin: 24px auto 0;
    padding: 0 16px;
    animation: ${fadeIn} 0.5s 0.15s ease both;
  }
`;

const ToolCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 6px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  cursor: pointer;
  transition: transform 0.12s, border-color 0.15s, background 0.15s;

  &:active {
    transform: scale(0.97);
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

const ToolCardIcon = styled.span`
  font-size: 1.6rem;
  line-height: 1;
  color: ${({ theme }) => theme.colors.gold};
`;

const ToolCardLabel = styled.span`
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: center;
  line-height: 1.2;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* ── Component ────────────────────────────────────────────────── */

const TOOLS = [
  { label: 'Chord Analysis', icon: '𝄢', path: '/chord' },
  { label: 'Note Analysis', icon: '♪', path: '/note' },
  { label: 'Lick Database', icon: '🎷', path: '/licks' },
  { label: 'Solo Database', icon: '🎺', path: '/solos' },
  { label: 'Editor', icon: '✎', path: '/editor' },
  { label: 'OMR', icon: '📄', path: '/input' },
] as const;

export default function HomePage() {
  const navigate = useNavigate();

  const introEmptyState = (
    <IntroBlock>
      <HeroLogo src="/jazzifylogo.png" alt="Jazzify" />
      <Greeting>오늘은 무슨 이야기를 할까요?</Greeting>
      <Subtitle>화성학, 재즈 이론, 코드 진행에 대해 물어보세요</Subtitle>
      <ToolGrid>
        {TOOLS.map((t) => (
          <ToolCard key={t.path} onClick={() => navigate(t.path)}>
            <ToolCardIcon>{t.icon}</ToolCardIcon>
            <ToolCardLabel>{t.label}</ToolCardLabel>
          </ToolCard>
        ))}
      </ToolGrid>
    </IntroBlock>
  );

  return (
    <Wrapper>
      <MobileBrandBar>
        <MobileBrandLogo src="/jazzifylogo.png" alt="Jazzify" />
        <MobileBrandName>Jazzify</MobileBrandName>
      </MobileBrandBar>
      <AdminBtn onClick={() => navigate('/admin')}>Admin</AdminBtn>

      <Sidebar>
        <BrandRow>
          <BrandLogo src="/jazzifylogo.png" alt="Jazzify" />
          <BrandName>Jazzify</BrandName>
        </BrandRow>
        <SidebarSpacer />
        <ToolList>
          {TOOLS.map((t) => (
            <ToolBtn key={t.path} onClick={() => navigate(t.path)}>
              <span>{t.icon}</span>
              {t.label}
            </ToolBtn>
          ))}
        </ToolList>
      </Sidebar>

      <Main>
        <ChatArea>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle="Jazzify"
            hideHeader
            hideSelectionQuickAction
            emptyState={introEmptyState}
          />
        </ChatArea>
      </Main>
    </Wrapper>
  );
}
