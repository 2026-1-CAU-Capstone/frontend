import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { BrandLogoImage } from '../common/BrandLogoImage';
import { PanelToggleIcon, SIDEBAR_STORAGE_KEY } from './IconSidebar';
import { UserMenu } from '../auth/UserMenu';
import { LoginModal } from '../auth/LoginModal';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * MainSidebar — the rich Claude/ChatGPT-style left rail used on HomePage,
 * extracted so other tool pages (ChordPage / NotePage) can render the
 * identical visual without duplicating the styling.
 *
 * Chat-related actions ("새 채팅", "채팅" history) are HomePage-specific, so
 * callers pass `onNewChat` / `onOpenChatHistory`. When omitted (tool pages),
 * we fall back to navigating home — the same buttons stay clickable but
 * land users where the actual chat lives.
 *
 * Expand/collapse state is shared with IconSidebar through the same
 * localStorage key so toggling persists across pages.
 * ──────────────────────────────────────────────────────────────────────── */

interface MainSidebarProps {
  /** Defaults to navigate('/'). HomePage passes the real chat reset handler. */
  onNewChat?: () => void;
  /** Defaults to navigate('/'). HomePage passes the real history opener. */
  onOpenChatHistory?: () => void;
}

export function MainSidebar({ onNewChat, onOpenChatHistory }: MainSidebarProps = {}) {
  const navigate = useNavigate();
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0'; }
    catch { return true; }
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((loggedIn, user) => {
      setAuthUser(loggedIn ? user : null);
      if (loggedIn) setLoginOpen(false);
    });
    return unsub;
  }, []);

  const toggleSidebar = () => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const isLoggedIn = authUser !== null;
  const handleNewChat = onNewChat ?? (() => navigate('/'));
  const handleChatHistory = onOpenChatHistory ?? (() => navigate('/'));
  const goTo = (path: string) => navigate(path);

  return (
    <>
      <Sidebar $collapsed={!sidebarExpanded}>
        {sidebarExpanded ? (
          <>
            <BrandRow>
              <BrandLogoImage height={45} scaleX={1.10} onClick={() => navigate('/')} />
              <SidebarToggleBtn onClick={toggleSidebar} aria-label="사이드바 접기">
                <PanelToggleIcon />
                <SidebarToggleTooltip>사이드바 접기</SidebarToggleTooltip>
              </SidebarToggleBtn>
            </BrandRow>

            <QuickNavList>
              <QuickNavBtn onClick={handleNewChat}>
                <QuickNavIcon><NewChatIcon /></QuickNavIcon>
                <span>새 채팅</span>
              </QuickNavBtn>
              <QuickNavBtn onClick={() => { /* TODO: open chat-search overlay */ }}>
                <QuickNavIcon><SearchIcon /></QuickNavIcon>
                <span>검색</span>
              </QuickNavBtn>
              <QuickNavBtn
                onClick={handleChatHistory}
                disabled={!isLoggedIn}
                title={isLoggedIn ? '대화 기록' : '로그인 후 사용할 수 있어요'}
              >
                <QuickNavIcon><ChatIcon /></QuickNavIcon>
                <span>채팅</span>
              </QuickNavBtn>
            </QuickNavList>

            <SidebarSpacer />
            <ToolList>
              {TOOLS.map((t) => (
                <ToolBtn key={t.path} onClick={() => goTo(t.path)}>
                  <span>{t.icon}</span>
                  {t.label}
                </ToolBtn>
              ))}
            </ToolList>
            {isLoggedIn && authUser ? (
              <UserMenu user={authUser} />
            ) : (
              <SidebarPromo>
                <SidebarPromoTitle>나만의 재즈 라이브러리를 시작하세요</SidebarPromoTitle>
                <SidebarPromoText>로그인하면 릭·솔로를 저장하고, 개인화된 코드 분석과 추천을 받을 수 있어요.</SidebarPromoText>
                <SidebarPromoBtn onClick={() => setLoginOpen(true)}>로그인</SidebarPromoBtn>
              </SidebarPromo>
            )}
          </>
        ) : (
          <>
            <NarrowToggleBtn onClick={toggleSidebar} aria-label="사이드바 열기">
              <PanelToggleIcon />
              <SidebarToggleTooltip>사이드바 열기</SidebarToggleTooltip>
            </NarrowToggleBtn>

            <NarrowIconBtn onClick={handleNewChat} aria-label="새 채팅">
              <NewChatIcon />
              <SidebarToggleTooltip>새 채팅</SidebarToggleTooltip>
            </NarrowIconBtn>
            <NarrowIconBtn aria-label="검색">
              <SearchIcon />
              <SidebarToggleTooltip>검색</SidebarToggleTooltip>
            </NarrowIconBtn>
            <NarrowIconBtn
              onClick={handleChatHistory}
              disabled={!isLoggedIn}
              aria-label="채팅"
            >
              <ChatIcon />
              <SidebarToggleTooltip>{isLoggedIn ? '채팅' : '로그인 필요'}</SidebarToggleTooltip>
            </NarrowIconBtn>

            <SidebarSpacer />

            {TOOLS.map((t) => (
              <NarrowIconBtn
                key={t.path}
                onClick={() => goTo(t.path)}
                aria-label={t.label}
              >
                <span style={{ fontSize: '1.1em' }}>{t.icon}</span>
                <SidebarToggleTooltip>{t.label}</SidebarToggleTooltip>
              </NarrowIconBtn>
            ))}
          </>
        )}
      </Sidebar>

      {loginOpen && (
        <LoginModal
          onLogin={() => setLoginOpen(false)}
          onClose={() => setLoginOpen(false)}
        />
      )}
    </>
  );
}

/* ── icons used in QuickNavList ──────────────────────────────────────── */

function NewChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 11 a6 6 0 0 1 6-6 h2 a6 6 0 0 1 6 6 v2 a6 6 0 0 1-6 6 H7 l-3 2 v-4 a6 6 0 0 1 0-6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const YoutubeMark = () => (
  <svg
    width="1.25em"
    height="0.9em"
    viewBox="0 0 24 17"
    aria-hidden="true"
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path
      fill="#c4302b"
      d="M23.5 2.6a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.6 31 31 0 0 0 0 8.5c0 2 .2 4 .5 5.9a3 3 0 0 0 2.1 2.1C4.5 17 12 17 12 17s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.9.5-5.9 0-2-.2-4-.5-5.9z"
    />
    <path fill="#fff" d="M9.6 12.1V4.9L15.8 8.5z" />
  </svg>
);

const TOOLS: ReadonlyArray<{ label: string; icon: ReactNode; path: string }> = [
  { label: 'Chord Analysis', icon: '𝄢', path: '/chord' },
  { label: 'Note Analysis', icon: '♪', path: '/note' },
  { label: 'Lick Database', icon: '🎷', path: '/licks' },
  { label: 'Solo Database', icon: '🎺', path: '/solos' },
  { label: 'Editor', icon: '✎', path: '/editor' },
  { label: 'YouTube Onset', icon: <YoutubeMark />, path: '/youtube-onset' },
  { label: 'OMR', icon: '📄', path: '/input' },
];

/* ── styled (exact copy of HomePage sidebar visual) ───────────────────── */

const Sidebar = styled.aside<{ $collapsed?: boolean }>`
  width: ${({ $collapsed }) => ($collapsed ? '48px' : '280px')};
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: ${({ $collapsed }) => ($collapsed ? 'center' : 'stretch')};
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  padding: ${({ $collapsed }) => ($collapsed ? '12px 4px 22px' : '0 4px 22px 14px')};
  gap: ${({ $collapsed }) => ($collapsed ? '2px' : '14px')};
  overflow: visible;
  transition: width 0.22s ease, padding 0.22s ease;
  position: relative;

  ${mq.mobile} {
    display: none;
  }
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px;
  margin-top: 10px;
  margin-bottom: 0;
`;

const SidebarToggleBtn = styled.button`
  position: relative;
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const NarrowToggleBtn = styled.button`
  position: relative;
  width: 100%;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  margin-top: 0px;
  margin-bottom: 18px;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const NarrowIconBtn = styled.button`
  position: relative;
  width: 100%;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s, opacity 0.15s;

  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const SidebarToggleTooltip = styled.span`
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%) translateX(-4px);
  white-space: nowrap;
  background: #1a1a1a;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 6px 10px;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 1000;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);

  button:hover > & {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
`;

const SidebarSpacer = styled.div`
  flex: 1;
  min-height: 0;
`;

const QuickNavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
`;

const QuickNavBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.92rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, opacity 0.12s;

  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const QuickNavIcon = styled.span`
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
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
  padding: 9px 10px;
  border: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.92rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, color 0.12s;

  > span:first-child {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.05em;
    color: ${({ theme }) => theme.colors.textSecondary};
    flex-shrink: 0;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    > span:first-child { color: ${({ theme }) => theme.colors.gold}; }
  }
`;

const SidebarPromo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 6px 4px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  margin-top: 4px;
`;

const SidebarPromoTitle = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.01em;
`;

const SidebarPromoText = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11.5px;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SidebarPromoBtn = styled.button`
  margin-top: 6px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  background: #ffffff;
  color: #1a1a1a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.12s;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.28);
  }
  &:active { transform: scale(0.98); }
`;
