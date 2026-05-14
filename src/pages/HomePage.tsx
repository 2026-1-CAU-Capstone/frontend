import { useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { mq } from '../styles/theme';
import { RightChatPanel } from '../components/layout/RightChatPanel';

/* ─────────────────────────────────────────────────────────────────────────
 * HomePage (intro screen).
 *
 * The chat itself is the SAME component used on ChordPage / NotePage —
 * `RightChatPanel`. Previously HomePage had its own bespoke chat loop which
 * silently dropped the RAG debug panel, lick-card insertion, and lead-sheet
 * chord-chart rendering. Embedding RightChatPanel guarantees the intro chat
 * behaves identically: VexFlow lick cards, HarmoRAG similarity panel, and
 * ```chart → lead-sheet rendering all come for free.
 *
 * HomePage just owns the surrounding chrome — desktop tool sidebar, mobile
 * tool grid, brand strip, Admin shortcut.
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

/* Compact-screen brand strip — replaces the desktop sidebar's BrandRow on
 * phones/tablets so the user still sees the Jazzify wordmark. */
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

/* ── Mobile/tablet tool grid (replaces the hidden sidebar) ───── */

const ToolGrid = styled.div`
  display: none;

  ${mq.mobile} {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    padding: 12px 16px 6px;
    flex-shrink: 0;
    animation: ${fadeIn} 0.5s 0.1s ease both;
  }
`;

const ToolCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 6px 10px;
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
  font-size: 1.4rem;
  line-height: 1;
  color: ${({ theme }) => theme.colors.gold};
`;

const ToolCardLabel = styled.span`
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: center;
  line-height: 1.2;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* ── Chat panel wrapper — RightChatPanel renders its own border-left;
 *    cancel it here so it doesn't double up with the sidebar's border. */
const ChatArea = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;

  & > aside {
    border-left: none;
  }
`;

/* ── Component ────────────────────────────────────────────────── */

const TOOLS = [
  { label: 'Chord Analysis', icon: '𝄢', path: '/chord' },
  { label: 'Note Analysis', icon: '♪', path: '/note' },
  { label: 'Lick Database', icon: '🎷', path: '/licks' },
  { label: 'JSON Tool', icon: '{ }', path: '/lick-input' },
  { label: 'OMR', icon: '📄', path: '/input' },
] as const;

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <Wrapper>
      <MobileBrandBar>
        <MobileBrandLogo src="/jazzifylogo.png" alt="Jazzify" />
        <MobileBrandName>Jazzify</MobileBrandName>
      </MobileBrandBar>
      <AdminBtn onClick={() => navigate('/admin')}>Admin</AdminBtn>

      {/* ── Desktop sidebar — tool list only ───────────────────── */}
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

      {/* ── Main column ────────────────────────────────────────── */}
      <Main>
        {/* Mobile/tablet tool grid — desktop hides it (sidebar covers the role) */}
        <ToolGrid>
          {TOOLS.map((t) => (
            <ToolCard key={t.path} onClick={() => navigate(t.path)}>
              <ToolCardIcon>{t.icon}</ToolCardIcon>
              <ToolCardLabel>{t.label}</ToolCardLabel>
            </ToolCard>
          ))}
        </ToolGrid>

        {/* The chat — IDENTICAL component/logic as ChordPage & NotePage. */}
        <ChatArea>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle="Jazzify"
          />
        </ChatArea>
      </Main>
    </Wrapper>
  );
}
