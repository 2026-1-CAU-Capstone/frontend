import { useState, useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { Keyboard } from '@capacitor/keyboard';
import { mq } from '../styles/theme';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { BrandLogoImage } from '../components/common/BrandLogoImage';
import { IconSidebar } from '../components/layout/IconSidebar';
import { AdminToolsDock } from '../components/layout/AdminToolsDock';
import { AuthTopBar } from '../components/layout/AuthTopBar';
import { AccountModal } from '../components/chat/AccountModal';
import { NativeHomeDashboard } from '../components/native/NativeHomeDashboard';
import { ChatHistoryModal, type ChatConversation } from '../components/chat/ChatHistoryModal';
import { ConfirmNewChatModal } from '../components/chat/ConfirmNewChatModal';
import { isNativeApp } from '../lib/platform';
import { useIsNativeUi } from '../contexts/AppPreviewContext';
import {
  bootstrapAuth,
  getAccessToken,
  getCachedUser,
  logout as apiLogout,
  onAuthChange,
  type AuthUser,
} from '../api/auth';
import { listChats, setActiveChat } from '../api/chat';

/* ─────────────────────────────────────────────────────────────────────────
 * HomePage (intro screen).
 *
 * Two layout variants live in this file:
 *
 *   WEB (desktop / browser): persistent left sidebar with tool list +
 *   centered chat area that shows the intro hero until first message.
 *
 *   NATIVE (Capacitor iOS / Android): no persistent sidebar. Top-left
 *   hamburger button opens an overlay drawer holding the same tool list.
 *   Chat input is auto-focused on mount so the iOS keyboard appears
 *   immediately (ChatGPT / Claude app pattern).
 *
 * Both variants share the same RightChatPanel — chat / RAG / lick-card
 * behaviour is identical. Only the chrome around it differs.
 * ──────────────────────────────────────────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`;

/* ── Layout ───────────────────────────────────────────────────── */

/* Soft warm canvas — light enough that the white chat input pill barely
 * peels off it, but still warmer than pure white so the page doesn't feel
 * sterile. Web stays on the theme's pure-white bg. */
const NATIVE_BG = '#f1f0ec';

const Wrapper = styled.div<{ $native?: boolean }>`
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme, $native }) => ($native ? NATIVE_BG : theme.colors.bgPrimary)};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
  position: relative;
`;

const MobileBrandBar = styled.div`
  display: none;
  ${mq.mobile} {
    display: flex;
    align-items: center;
    gap: 8px;
    position: absolute;
    top: max(4px, env(safe-area-inset-top, 0px));
    left: max(12px, env(safe-area-inset-left, 0px));
    z-index: 40;
    pointer-events: none;
  }
`;

/* MobileBrandLogo removed — wordmark stands alone now. */


/* ── Main column ─────────────────────────────────────────────── */

const Main = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const ChatArea = styled.div<{ $native?: boolean; $started?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;

  & > aside {
    border-left: none;
    background: transparent;
    /* Empty state (chat hasn't started yet) keeps a wider column so the
     * centered hero and large IntroChatInput look roomy. Once messages
     * start flowing, narrow the column down to 760px to match the message
     * bubble width (MessagesArea > * { max-width: 760px }) — input and
     * replies then line up at identical widths. */
    ${({ $native, $started }) => !$native && `
      width: 100%;
      max-width: ${$started ? '760px' : '1200px'};
      transition: max-width 0.25s ease;
    `}
  }
`;

/* ── Intro empty-state visual (shown only when messages.length === 0) ──── */

/* Intro hero — Claude-style. Web: logo INLINE with greeting (HeroRow).
 * Native: stacked (NativeHero). On native we also let IntroBlock claim
 * flex:1 + center its content so the hero stays vertically centered in
 * the available space regardless of whether the keyboard is up or not. */
const IntroBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 0 24px 8px;

  /* Touch / compact (phones + all iPads): claim flex:1 and self-center so the
   *  hero stays in the middle of the remaining space above the input. When
   *  the keyboard appears, IntroInputSlot grows via padding-bottom → this
   *  shrinks → hero recenters automatically in the new smaller area.
   *  padding-top biases the centered hero a bit downward so it doesn't feel
   *  "stuck to the top" when the keyboard squeezes the area. */
  ${mq.compactLayout} {
    flex: 1;
    justify-content: center;
    padding: 8vh 16px 8px;
    min-height: 0;
  }
`;

/* Native variant — logo stacked above greeting (vertical), tighter spacing. */
const NativeHero = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
  animation: ${fadeIn} 0.5s ease both;
`;

const HeroRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-bottom: 10px;
  animation: ${fadeIn} 0.5s ease both;
  ${mq.mobile} { gap: 14px; margin-bottom: 6px; }
`;

const HeroLogo = styled.img`
  width: 84px;
  height: 84px;
  border-radius: 20px;
  object-fit: cover;
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  /* Touch / compact (phones + iPads): smaller, tighter logo. Matches the
   * ChatGPT-on-iPad scale where the hero doesn't dominate the empty state. */
  ${mq.compactLayout} { width: 56px; height: 56px; border-radius: 14px; }
`;

const Greeting = styled.h1`
  font-size: 2.6rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0;
  text-align: left;
  letter-spacing: -0.015em;
  line-height: 1.1;
  ${mq.compactLayout} { font-size: 1.55rem; }
`;

const Subtitle = styled.p`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 0 18px;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.1s ease both;
  ${mq.compactLayout} { font-size: 0.92rem; margin-bottom: 12px; }
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

/* ── Native hamburger + drawer ───────────────────────────────── */

const HamburgerBtn = styled.button`
  position: absolute;
  top: max(14px, env(safe-area-inset-top, 0px));
  left: max(14px, env(safe-area-inset-left, 0px));
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  cursor: pointer;
  z-index: 60;
  &:active { transform: scale(0.95); }
`;

const HamburgerIcon = () => (
  <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden>
    <line x1="4" y1="7"  x2="20" y2="7"  stroke="#333" strokeWidth="2.2" strokeLinecap="round" />
    <line x1="4" y1="12" x2="14" y2="12" stroke="#333" strokeWidth="2.2" strokeLinecap="round" />
    <line x1="4" y1="17" x2="20" y2="17" stroke="#333" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const Drawer = styled.aside<{ $open: boolean }>`
  position: fixed;
  inset: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  transform: translateX(${({ $open }) => ($open ? '0' : '-110%')});
  transition: transform 0.22s ease;
  z-index: 81;
  overflow: hidden;
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(max(16px, env(safe-area-inset-top, 0px)) + 6px) 16px 14px;
`;

/* DrawerBrandLogo removed — wordmark stands alone now. */

const DrawerHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const DrawerFooter = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 12px;
  padding-left: 16px;
  padding-right: 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
`;


const DrawerAvatarBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: none;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  background: linear-gradient(135deg, #d2a35a, #b8860b);
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.18s ease;
  transform-origin: center;
  will-change: transform;

  &:hover {
    transform: scale(1.18);
    box-shadow: 0 6px 16px rgba(184, 134, 11, 0.28);
  }
  &:active {
    transform: scale(1.1);
  }
`;

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 16px;
`;

const DrawerNavItem = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 12px;
  transition: background 0.1s;
  &:active { background: #f5f5f5; }
`;

const NavItemIcon = styled.div`
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #111;
`;

const NavItemLabel = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 1.02rem;
  font-weight: 500;
  color: #111;
`;

const DrawerMoreRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 12px;
`;

const MoreDots = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1.5px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: #888;
  font-weight: 700;
  letter-spacing: 0.05em;
`;

const DrawerSectionTitle = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.95rem;
  font-weight: 700;
  color: #111;
  padding: 18px 12px 6px;
`;

const DrawerDivider = styled.hr`
  margin: 6px 14px;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
`;

/* Logged-out drawer body — plain text links above the auth CTA. */
const DrawerTextLinks = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 22px 18px 0;
`;
const DrawerTextLink = styled.button`
  text-align: left;
  border: none;
  background: transparent;
  padding: 0;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  &:hover { color: #111; }
`;

/* Logged-out drawer footer — small blurb + black sign-up/login pill. */
const AuthFootBlurb = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.55);
  padding: 0 6px 14px;
`;
const AuthPrimaryBtn = styled.button`
  width: 100%;
  padding: 16px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.98); }
`;

const DrawerNewChatBtn = styled.button`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 20px;
  height: 48px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  &:active { opacity: 0.85; }
`;

/* ── Component ────────────────────────────────────────────────── */

/* YouTube-style mark — red rounded rect with white play triangle. Sized to
 * inherit the surrounding icon slot (1em wide so it matches the other tool
 * icons regardless of where it's rendered). */
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
  { label: '음원 분리', icon: '🎚️', path: '/stems' },
];

const DIconChord = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
  </svg>
);
const DIconNote = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 18V4"/><path d="M12 4l6 2"/><circle cx="9" cy="18" r="3"/>
  </svg>
);
const DIconLick = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="16" x2="21" y2="16"/>
    <line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/>
  </svg>
);
const DIconSolo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
  </svg>
);
const DIconEditor = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const DIconVideo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);
const DIconDoc = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);
const DIconScore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);
const DIconNewChat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const DIconStems = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/>
    <circle cx="6" cy="9" r="2" fill="currentColor"/><circle cx="12" cy="15" r="2" fill="currentColor"/><circle cx="18" cy="7" r="2" fill="currentColor"/>
  </svg>
);

const DRAWER_TOOLS: Array<{ label: string; icon: ReactNode; path: string }> = [
  { label: 'Chord Analysis', icon: <DIconChord />, path: '/chord' },
  { label: 'Note Analysis',  icon: <DIconNote />,  path: '/note' },
  { label: 'Lick Database',  icon: <DIconLick />,  path: '/licks' },
  { label: 'Solo Database',  icon: <DIconSolo />,  path: '/solos' },
  { label: 'Editor',         icon: <DIconEditor />, path: '/editor' },
  { label: 'YouTube 분석',  icon: <DIconVideo />,  path: '/youtube-onset' },
  { label: 'OMR',            icon: <DIconDoc />,   path: '/input' },
  { label: '음원 분리',      icon: <DIconStems />,  path: '/stems' },
];

const MOCK_SCORES = [
  'Autumn Leaves',
  'All The Things You Are',
  'Stablemates',
  'Misty',
];

/* Tablet-or-wider detector. iPad portrait starts at 768pt logical width, so
 * this picks up every iPad while excluding all phones. Used to give iPad the
 * desktop-style persistent sidebar (ChatGPT-on-iPad pattern) instead of the
 * hamburger + slide-out drawer we use on iPhone. */

export default function HomePage() {
  const navigate = useNavigate();
  const native = isNativeApp();
  /* 네이티브(iPhone·iPad 공통)면 노션형 대시보드 셸. 이전에는 iPad 가
   * min-width 768px 기준으로 데스크톱형 IconSidebar 경로로 빠졌지만,
   * 새 디자인은 "아이패드·아이폰 동일, 웹 미적용"이 요구사항이라 플랫폼
   * 기준 하나로 통일했다.
   * useIsNativeUi(): 실제 네이티브 OR /preview/* — 브라우저(데스크톱·폰
   * 사파리)에서 /#/preview/home 으로 새 홈을 설치 없이 검수할 수 있다.
   * 일반 웹 "/" 에서는 여전히 false → 웹 UI 불변. */
  const useNativeUI = useIsNativeUi();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  /* Real auth state — driven by Jazzify backend (/v1/auth/*). The cached
   * access token + user info in localStorage seed the initial state so
   * there's no logged-out flash on app launch; in parallel we call
   * bootstrapAuth() to refresh the token via the cookie and confirm the
   * session is still valid (logs user out if it isn't). */
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const isLoggedIn = authUser !== null;

  useEffect(() => {
    /* Subscribe to global auth changes (login/logout/refresh failure). */
    const unsub = onAuthChange((loggedIn, user) => {
      setAuthUser(loggedIn ? user : null);
    });
    /* Quick session check on mount — if we have any token/cookie material
     * try to bootstrap; otherwise stay logged-out. */
    if (getAccessToken() || getCachedUser()) {
      bootstrapAuth().then((u) => { if (!u) setAuthUser(null); }).catch(() => { /* noop */ });
    }
    return unsub;
  }, []);
  /* Track iOS keyboard height so the chat input wrapper can sit just above
   * the keyboard. Capacitor's KeyboardResize: 'none' means the WebView does
   * NOT auto-scroll the input into view — we do it manually via CSS var. */
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!native) return;
    const showSub = Keyboard.addListener('keyboardWillShow', (info) => {
      setKbHeight(info.keyboardHeight);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      setKbHeight(0);
    });
    return () => {
      showSub.then((s) => s.remove());
      hideSub.then((s) => s.remove());
    };
  }, [native]);

  const goTo = (path: string) => {
    setDrawerOpen(false);
    navigate(path);
  };

  /* Drawer swipe-to-close. Tracks the initial touch x-position and closes
   * the drawer on any horizontal swipe (>50px) — supports both directions
   * so the gesture feels forgiving regardless of how the user flicks. */
  const touchStartXRef = useRef<number | null>(null);
  const handleDrawerTouchStart = (e: TouchEvent<HTMLElement>) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };
  const handleDrawerTouchEnd = (e: TouchEvent<HTMLElement>) => {
    if (touchStartXRef.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const dx = endX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(dx) > 50) setDrawerOpen(false);
  };

  /* Hero shifts up by ~half the keyboard height when keyboard is up — so
   * it stays roughly in the VISIBLE center (between top of screen and top
   * of keyboard) rather than fully tracking the input. Smooth GPU transform. */
  /* Hero lifts on any native (iPhone OR iPad) when the keyboard is up — the
   * IntroBlock + input both translate so the input sits just above the keyboard
   * and the hero re-centers in the remaining visible area. */
  const heroLift = native && kbHeight > 0 ? Math.round(kbHeight * 0.55) : 0;
  const introEmptyState = (
    <IntroBlock
      style={{
        transform: heroLift ? `translateY(${-heroLift}px)` : 'translateY(0)',
        transition: 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'transform',
      }}
    >
      {native ? (
        /* All native (iPhone + iPad) — stacked hero is tighter and pairs
         * better with the flex:1 vertical centering used by IntroBlock. */
        <NativeHero>
          <HeroLogo src="/jazzifylogo.png" alt="Jazzify" />
          <Greeting>오늘은 무슨 이야기를 할까요?</Greeting>
        </NativeHero>
      ) : (
        <HeroRow>
          <HeroLogo src="/jazzifylogo.png" alt="Jazzify" />
          <Greeting>오늘은 무슨 이야기를 할까요?</Greeting>
        </HeroRow>
      )}
      <Subtitle>화성학, 재즈 이론, 코드 진행에 대해 물어보세요</Subtitle>
      {/* ToolGrid hidden on native (both iPhone and iPad) for a cleaner
       * ChatGPT-style empty state. Web keeps the action cards. */}
      {!native && (
        <ToolGrid>
          {TOOLS.map((t) => (
            <ToolCard key={t.path} onClick={() => goTo(t.path)}>
              <ToolCardIcon>{t.icon}</ToolCardIcon>
              <ToolCardLabel>{t.label}</ToolCardLabel>
            </ToolCard>
          ))}
        </ToolGrid>
      )}
    </IntroBlock>
  );

  /* Chat history modal — 백엔드 /v1/chat 목록을 열 때마다 로드해 표시.
   * (이전엔 상수 빈 배열 + onSelect no-op이라 '항상 빈 모달'이었다 —
   * RecentChatsList가 이미 쓰는 listChats를 그대로 재사용.) */
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatConversations, setChatConversations] = useState<ChatConversation[]>([]);

  const openChatHistory = () => {
    if (!isLoggedIn) return;
    setChatHistoryOpen(true);
    listChats({ size: 50 })
      .then((page) => {
        setChatConversations(page.content.map((c) => ({
          id: c.publicId,
          title: c.songTitle && c.songTitle !== 'Jazzify' ? c.songTitle : (c.title || '제목 없음'),
          updatedAt: new Date(c.updatedAt).getTime() || Date.now(),
          badge: c.category === 'chord' ? '코드 차트' : c.category === 'sheet' ? '악보' : undefined,
        })));
      })
      .catch((e) => console.warn('[HomePage] 채팅 목록 로드 실패:', e));
  };

  /* New-chat flow. `chatKey` is bumped to remount RightChatPanel so its
   *  internal `messages` state resets cleanly. `chatMessageCount` mirrors
   *  the panel's message count so we can decide whether to prompt before
   *  discarding work — logged-out users get a confirm modal; logged-in
   *  users will eventually have their chat auto-saved server-side and skip
   *  the prompt. */
  const [chatKey, setChatKey] = useState(0);
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const [confirmNewChatOpen, setConfirmNewChatOpen] = useState(false);

  const resetChat = () => {
    // Release the globally-active chat FIRST. onActiveChatChange replays the
    // current id to late subscribers, so without this the remounted panel
    // immediately re-loads the chat we were trying to leave — making the
    // "새 채팅" button a no-op for logged-in users with a chat open.
    setActiveChat(null);
    setChatKey((k) => k + 1);
    setChatMessageCount(0);
  };

  const handleNewChatClick = () => {
    if (chatMessageCount === 0) {
      /* Nothing to lose — silent reset is fine. */
      resetChat();
      return;
    }
    if (!isLoggedIn) {
      setConfirmNewChatOpen(true);
      return;
    }
    /* Logged in + has messages: assume backend autosaves (TODO when wired)
     *  and just start fresh. */
    resetChat();
  };

  /* ── 네이티브(iPhone·iPad) 홈 — 노션형 대시보드로 전면 교체. ──
   * 채팅은 더 이상 홈이 아니라 AiChatSheet(하단 바 "AI에게 질문하기")로
   * 열린다. 아래의 기존 드로어/채팅-홈 JSX 는 웹 경로 전용으로 남는다.
   * (모든 훅 호출 뒤의 조기 반환이라 rules-of-hooks 안전.) */
  if (useNativeUI) {
    /* 로그인 강제 — 네이티브는 게스트 진입을 막고 로그인 사용자만 홈에
     * 들어온다. 캐시된 사용자(getCachedUser)로 초기화하므로 재로그인 사용자는
     * 로그인 화면 깜빡임 없이 바로 대시보드. 미로그인이면 /login 으로.
     * (웹 "/" 은 공개 랜딩이라 이 게이트를 적용하지 않는다.) */
    if (!isLoggedIn) return <Navigate to="/login" replace />;
    return <NativeHomeDashboard />;
  }

  return (
    <Wrapper $native={useNativeUI}>
      {!useNativeUI && (
        <MobileBrandBar>
          <BrandLogoImage height={52} onClick={() => navigate('/')} />
        </MobileBrandBar>
      )}

      {!useNativeUI && (
        <IconSidebar
          onNewChat={handleNewChatClick}
          onOpenChatHistory={openChatHistory}
          isLoggedInUser={isLoggedIn}
        />
      )}

      {!useNativeUI && <AuthTopBar onLoginClick={() => navigate('/login')} />}

      {/* Native hamburger + full-screen drawer (iPhone only — iPads fall through
       * to the desktop sidebar branch above). */}
      {useNativeUI && (
        <>
          <HamburgerBtn onClick={() => setDrawerOpen(true)} aria-label="메뉴 열기">
            <HamburgerIcon />
          </HamburgerBtn>
          <Drawer
            $open={drawerOpen}
            onTouchStart={handleDrawerTouchStart}
            onTouchEnd={handleDrawerTouchEnd}
          >
            <DrawerHeader>
              <BrandLogoImage height={52} onClick={() => navigate('/')} />
              <DrawerHeaderRight>
                {isLoggedIn && (
                  <DrawerAvatarBtn onClick={() => setAccountOpen(true)} aria-label="계정">
                    {(authUser?.name ?? authUser?.username ?? '?').slice(0, 2).toUpperCase()}
                  </DrawerAvatarBtn>
                )}
              </DrawerHeaderRight>
            </DrawerHeader>
            <DrawerBody>
              {/* 새 채팅 — 항상 최상단 */}
              <DrawerNavItem onClick={() => goTo('/')}>
                <NavItemIcon><DIconNewChat /></NavItemIcon>
                <NavItemLabel>새 채팅</NavItemLabel>
              </DrawerNavItem>

              <DrawerDivider />

              {/* 메뉴: 모든 툴 (chord/note + lick/solo/editor/yt/omr) */}
              <DrawerSectionTitle>메뉴</DrawerSectionTitle>
              {DRAWER_TOOLS.slice(0, 2).map((t) => (
                <DrawerNavItem key={t.path} onClick={() => goTo(t.path)}>
                  <NavItemIcon>{t.icon}</NavItemIcon>
                  <NavItemLabel>{t.label}</NavItemLabel>
                </DrawerNavItem>
              ))}
              <DrawerDivider />
              {DRAWER_TOOLS.slice(2).map((t) => (
                <DrawerNavItem key={t.path} onClick={() => goTo(t.path)}>
                  <NavItemIcon>{t.icon}</NavItemIcon>
                  <NavItemLabel>{t.label}</NavItemLabel>
                </DrawerNavItem>
              ))}

              {/* 로그인된 경우에만: 악보 + 채팅 기록 */}
              {isLoggedIn && (
                <>
                  <DrawerSectionTitle>악보</DrawerSectionTitle>
                  {MOCK_SCORES.map((title) => (
                    <DrawerNavItem key={title}>
                      <NavItemIcon><DIconScore /></NavItemIcon>
                      <NavItemLabel>{title}</NavItemLabel>
                    </DrawerNavItem>
                  ))}
                  <DrawerSectionTitle>채팅</DrawerSectionTitle>
                  <DrawerMoreRow>
                    <MoreDots>···</MoreDots>
                    <NavItemLabel style={{ color: '#888' }}>더 보기</NavItemLabel>
                  </DrawerMoreRow>
                </>
              )}

              {/* 비로그인 시 하단 텍스트 링크들 */}
              {!isLoggedIn && (
                <DrawerTextLinks>
                  <DrawerTextLink>이용약관</DrawerTextLink>
                  <DrawerTextLink>개인정보 보호 정책</DrawerTextLink>
                  <DrawerTextLink>설정</DrawerTextLink>
                </DrawerTextLinks>
              )}
            </DrawerBody>
            <DrawerFooter>
              {isLoggedIn ? (
                <DrawerNewChatBtn onClick={() => goTo('/')}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  채팅
                </DrawerNewChatBtn>
              ) : (
                <>
                  <AuthFootBlurb>
                    채팅 기록을 저장하고, 채팅을 공유하고, 경험을 맞춤 설정하세요.
                  </AuthFootBlurb>
                  <AuthPrimaryBtn onClick={() => navigate('/login')}>
                    회원 가입 또는 로그인
                  </AuthPrimaryBtn>
                </>
              )}
            </DrawerFooter>
          </Drawer>
        </>
      )}

      <Main>
        <ChatArea $native={useNativeUI} $started={chatMessageCount > 0}>
          <RightChatPanel
            key={chatKey}
            selectedChords={[]}
            groupExplanation={null}
            songTitle="Jazzify"
            hideHeader
            hideSelectionQuickAction
            emptyState={introEmptyState}
            inputPlaceholder="화성학, 재즈 이론, 무엇이든 물어보세요."
            autoFocusInput
            inputInIntro
            /* Native (iPhone AND iPad) gets the input pinned at the bottom
             * with a keyboard-tracking translate so the field rides just above
             * the keyboard. iPad keeps the persistent IconSidebar (decided via
             * useNativeUI above) — only the intro / input behaviour follows
             * the native pattern here. */
            nativeIntroLayout={native}
            keyboardOffsetPx={native ? kbHeight : 0}
            onMessagesChange={setChatMessageCount}
          />
        </ChatArea>
      </Main>

      <AccountModal
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          onLogout={() => {
            setAccountOpen(false);
            setDrawerOpen(false);
            /* Fire-and-forget — onAuthChange listener clears authUser
             *  for us regardless of network success. */
            apiLogout();
          }}
        />

      {/* Past-chat history modal — gated by login on the trigger side.
       *  Conversations array is empty until persistence is wired. */}
      <ChatHistoryModal
        open={chatHistoryOpen}
        conversations={chatConversations}
        onClose={() => setChatHistoryOpen(false)}
        onSelect={(id) => {
          // RightChatPanel의 onActiveChatChange 구독이 해당 대화를 로드한다.
          setActiveChat(id);
          setChatHistoryOpen(false);
        }}
        onNewChat={handleNewChatClick}
      />

      <ConfirmNewChatModal
        open={confirmNewChatOpen}
        onClose={() => setConfirmNewChatOpen(false)}
        onConfirm={resetChat}
        onLogin={() => { setConfirmNewChatOpen(false); navigate('/login'); }}
      />

      {/* admin 계정 전용 도구 런처 — 우측 하단 독립 위젯(내부에서 admin 게이트). */}
      <AdminToolsDock />
    </Wrapper>
  );
}
