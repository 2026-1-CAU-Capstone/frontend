import { useState, useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { Keyboard } from '@capacitor/keyboard';
import { mq } from '../styles/theme';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { BrandLogoImage } from '../components/common/BrandLogoImage';
import { PanelToggleIcon, SIDEBAR_STORAGE_KEY } from '../components/layout/IconSidebar';
import { AuthTopBar } from '../components/layout/AuthTopBar';
import { AccountModal } from '../components/chat/AccountModal';
import { LoginModal } from '../components/auth/LoginModal';
import { ChatHistoryModal, type ChatConversation } from '../components/chat/ChatHistoryModal';
import { ConfirmNewChatModal } from '../components/chat/ConfirmNewChatModal';
import { UserMenu } from '../components/auth/UserMenu';
import { isNativeApp } from '../lib/platform';
import {
  bootstrapAuth,
  getAccessToken,
  getCachedUser,
  logout as apiLogout,
  onAuthChange,
  type AuthUser,
} from '../api/auth';

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

/* ── Sidebar (desktop tool list) ─────────────────────────────── */

const Sidebar = styled.aside`
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  padding: 0 4px 22px 14px;
  gap: 14px;
  overflow: hidden;

  ${mq.mobile} {
    display: none;
  }
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0;
  /* Pull the row above the nominal top edge — the wordmark PNG has some
   * intrinsic optical padding even after -trim. */
  margin-top: -10px;
  margin-bottom: -4px;
`;

/** Same shape + hover behaviour as IconSidebar's ToggleBtn — kept inline so
 *  the two sidebars don't have to share a styled-component module. */
const SidebarToggleBtn = styled.button`
  width: 42px;
  height: 42px;
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

/** Floating toggle pinned to the top-left when the sidebar is collapsed.
 *  Clicking it re-expands the sidebar. */
const FloatingOpenBtn = styled.button`
  position: absolute;
  top: max(10px, env(safe-area-inset-top, 0px));
  left: max(10px, env(safe-area-inset-left, 0px));
  z-index: 60;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    color: ${({ theme }) => theme.colors.textPrimary};
  }

  ${mq.mobile} { display: none; }
`;

/* BrandLogo removed — wordmark stands alone now. */

const SidebarSpacer = styled.div`
  flex: 1;
  min-height: 0;
`;

/* Quick nav under the logo — new chat / search / chats. Mirrors the
 * ChatGPT/Claude side-rail look: tight rows, icon + text, subtle hover. */
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

/* "+" inside a rounded square — the new-chat affordance. */
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

/* Two overlapping speech bubbles — matches the screenshot's "채팅" glyph. */
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

const ToolList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding-top: 16px;
`;

/* Matches QuickNavBtn (above) for visual continuity — same padding, font,
 * gap, and 22px icon slot. Hover & icon-color accent kept from the prior
 * design so the tool list still feels like the "active" CTA cluster. */
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

/* Logged-out promo card at the very bottom of the HomePage sidebar — mirrors
 * the ChatGPT-style "내게 맞춘 응답을 받으세요" prompt so users have a
 * contextual nudge to sign in. Hidden once authed. */
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

  /* Mobile: claim flex:1 and self-center so hero stays in the middle of
   *  the remaining space (above the input). When keyboard appears, the
   *  IntroInputSlot grows via padding-bottom → this shrinks → hero
   *  recenters automatically in the new smaller available area.
   *  padding-top biases the centered hero a bit downward so it doesn't
   *  feel "stuck to the top" when the keyboard squeezes the area. */
  @media (max-width: 768px) {
    flex: 1;
    justify-content: center;
    padding: 14vh 16px 8px;
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
  ${mq.mobile} { width: 44px; height: 44px; border-radius: 11px; }
`;

const Greeting = styled.h1`
  font-size: 2.6rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0;
  text-align: left;
  letter-spacing: -0.015em;
  line-height: 1.1;
  ${mq.mobile} { font-size: 1.35rem; }
`;

const Subtitle = styled.p`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 0 18px;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.1s ease both;
  ${mq.mobile} { font-size: 0.85rem; margin-bottom: 12px; }
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

const DRAWER_TOOLS: Array<{ label: string; icon: ReactNode; path: string }> = [
  { label: 'Chord Analysis', icon: <DIconChord />, path: '/chord' },
  { label: 'Note Analysis',  icon: <DIconNote />,  path: '/note' },
  { label: 'Lick Database',  icon: <DIconLick />,  path: '/licks' },
  { label: 'Solo Database',  icon: <DIconSolo />,  path: '/solos' },
  { label: 'Editor',         icon: <DIconEditor />, path: '/editor' },
  { label: 'YouTube 분석',  icon: <DIconVideo />,  path: '/youtube-onset' },
  { label: 'OMR',            icon: <DIconDoc />,   path: '/input' },
];

const MOCK_SCORES = [
  'Autumn Leaves',
  'All The Things You Are',
  'Stablemates',
  'Misty',
];

export default function HomePage() {
  const navigate = useNavigate();
  const native = isNativeApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  /* Collapse state for the desktop sidebar — mirrors IconSidebar so the two
   * pages share the same expanded/collapsed preference. */
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0'; }
    catch { return true; }
  });
  const toggleSidebar = () => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0'); }
      catch { /* storage unavailable */ }
      return next;
    });
  };
  /* Real auth state — driven by Jazzify backend (/v1/auth/*). The cached
   * access token + user info in localStorage seed the initial state so
   * there's no logged-out flash on app launch; in parallel we call
   * bootstrapAuth() to refresh the token via the cookie and confirm the
   * session is still valid (logs user out if it isn't). */
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const isLoggedIn = authUser !== null;
  const setIsLoggedIn = (val: boolean) => {
    if (val) setAuthUser((prev) => prev ?? getCachedUser());
    else setAuthUser(null);
  };

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

  /* Login is shown as a SCREEN-COVER overlay (rendered at the end of the
   * tree) only after the user explicitly taps "회원 가입 또는 로그인" in the
   * drawer. The main HomePage stays usable in a logged-out state. */
  const [loginOpen, setLoginOpen] = useState(false);

  /* Chat history modal — gated by login. Conversations array is empty for
   *  now (no persistent chat backend yet); once wired, swap the empty
   *  array for the real list. */
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const chatConversations: ChatConversation[] = [];

  const openChatHistory = () => {
    if (!isLoggedIn) return;
    setChatHistoryOpen(true);
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

  return (
    <Wrapper $native={native}>
      {!native && (
        <MobileBrandBar>
          <BrandLogoImage height={62} onClick={() => navigate('/')} />
        </MobileBrandBar>
      )}

      {/* Desktop / web sidebar — hidden on native (replaced by drawer).
       *  Collapses to nothing via the top-right toggle, matching the
       *  Claude-style affordance used by IconSidebar. */}
      {!native && sidebarExpanded && (
        <Sidebar>
          <BrandRow>
            <BrandLogoImage height={80} scaleX={1.1} onClick={() => navigate('/')} />
            <SidebarToggleBtn onClick={toggleSidebar} title="사이드바 접기" aria-label="사이드바 접기">
              <PanelToggleIcon />
            </SidebarToggleBtn>
          </BrandRow>

          {/* Quick nav — ChatGPT-style "+ 새 채팅 / 검색 / 채팅" right under
           *  the logo. Handlers are placeholders; wire them once chat history
           *  + search backends exist. */}
          <QuickNavList>
            <QuickNavBtn onClick={handleNewChatClick}>
              <QuickNavIcon><NewChatIcon /></QuickNavIcon>
              <span>새 채팅</span>
            </QuickNavBtn>
            <QuickNavBtn onClick={() => { /* TODO: open chat-search overlay */ }}>
              <QuickNavIcon><SearchIcon /></QuickNavIcon>
              <span>검색</span>
            </QuickNavBtn>
            <QuickNavBtn
              onClick={openChatHistory}
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
        </Sidebar>
      )}

      {!native && <AuthTopBar onLoginClick={() => setLoginOpen(true)} />}

      {/* When the sidebar is collapsed, surface a small floating toggle so
       *  the user can bring it back. */}
      {!native && !sidebarExpanded && (
        <FloatingOpenBtn onClick={toggleSidebar} title="사이드바 열기" aria-label="사이드바 열기">
          <PanelToggleIcon />
        </FloatingOpenBtn>
      )}

      {/* Native hamburger + full-screen drawer. */}
      {native && (
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
              <BrandLogoImage height={62} />
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
                  <AuthPrimaryBtn onClick={() => setLoginOpen(true)}>
                    회원 가입 또는 로그인
                  </AuthPrimaryBtn>
                </>
              )}
            </DrawerFooter>
          </Drawer>
        </>
      )}

      <Main>
        <ChatArea $native={native} $started={chatMessageCount > 0}>
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
            nativeIntroLayout={native}
            keyboardOffsetPx={native ? kbHeight : 0}
            onMessagesChange={setChatMessageCount}
          />
        </ChatArea>
      </Main>

      {native && (
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
      )}

      {/* Sign-up / login overlay — opens from the native drawer button OR
       *  from the desktop top-right pills / sidebar promo. Shared modal so
       *  there's only one auth UI in the tree regardless of entry point. */}
      {loginOpen && (
        <LoginModal
          onLogin={() => {
            setLoginOpen(false);
            setDrawerOpen(false);
            setIsLoggedIn(true);
          }}
          onClose={() => setLoginOpen(false)}
        />
      )}

      {/* Past-chat history modal — gated by login on the trigger side.
       *  Conversations array is empty until persistence is wired. */}
      <ChatHistoryModal
        open={chatHistoryOpen}
        conversations={chatConversations}
        onClose={() => setChatHistoryOpen(false)}
        onSelect={() => { /* TODO: load conversation into RightChatPanel */ }}
        onNewChat={handleNewChatClick}
      />

      <ConfirmNewChatModal
        open={confirmNewChatOpen}
        onClose={() => setConfirmNewChatOpen(false)}
        onConfirm={resetChat}
        onLogin={() => { setConfirmNewChatOpen(false); setLoginOpen(true); }}
      />
    </Wrapper>
  );
}
