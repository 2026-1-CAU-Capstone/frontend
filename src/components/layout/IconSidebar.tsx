import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { BrandLogoImage } from '../common/BrandLogoImage';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';
import { UserMenu } from '../auth/UserMenu';
import { RecentChatsList } from './RecentChatsList';
import { setActiveChat } from '../../api/chat';

/* ─────────────────────────────────────────────────────────────────────────
 * IconSidebar — universal left rail for all pages.
 *
 * Two modes (toggled by the top "panel" button, persisted to localStorage):
 *
 *   collapsed (default): 56px-wide icon rail with just the logo, NAV icons
 *                        and the user avatar. Tooltips reveal labels.
 *   expanded:            260px-wide panel with "Jazzify" brand + textual
 *                        NAV labels + user name on the avatar row. Matches
 *                        the side-panel pattern from popular AI chat UIs.
 * ──────────────────────────────────────────────────────────────────────── */

const Rail = styled.nav<{ $expanded: boolean }>`
  width: ${({ $expanded }) => ($expanded ? '244px' : '52px')};
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: ${({ $expanded }) => ($expanded ? 'stretch' : 'center')};
  padding: 0 ${({ $expanded }) => ($expanded ? '2px 0 12px' : '0')};
  gap: 4px;
  background: transparent;
  /* Solid right border so the rail visually separates from the chat area. */
  border-right: 1px solid rgba(0, 0, 0, 0.12);
  transition: width 0.22s ease, padding 0.22s ease, align-items 0.22s ease;

  /* iPhone notch / iPad gesture area — desktop uses 0. */
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));

  /* Phone-only: collapse into a 58px icon rail along the left edge. iPad
   * portrait (820pt) and wider keep the proper desktop-style sidebar so the
   * ChatGPT-on-iPad layout is preserved in both orientations. */
  ${mq.phone} {
    width: 58px;
    padding: 8px 0;
    align-items: center;
    gap: 4px;
    padding-top: max(8px, env(safe-area-inset-top, 0px));
    padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
  }
`;

/* Top row — expanded: "Jazzify" brand + toggle on the right.
 *          collapsed: toggle button stacked, brand logo just below. */
const TopRow = styled.div<{ $expanded: boolean }>`
  display: flex;
  align-items: flex-start;
  justify-content: ${({ $expanded }) => ($expanded ? 'space-between' : 'center')};
  width: 100%;
  padding: 0;
  gap: 4px;
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  padding-top: 12px;
  margin-left: 8px;
`;

/* Pill-style tooltip that appears to the right of the toggle on hover. Lives
 * here (not down near NavTooltip) so ToggleBtn can reference it. */
const ToggleTooltip = styled.span`
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
`;

/* Square panel-toggle icon button (matches the side-panel-toggle iconography
 * used by ChatGPT / Claude). Vertically aligned with the Jazzify logo. */
const ToggleBtn = styled.button<{ $expanded?: boolean }>`
  position: relative;
  width: 52px;
  height: 52px;
  margin-top: 6px;
  margin-right: ${({ $expanded }) => ($expanded ? '8px' : '0')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }

  &:hover ${ToggleTooltip} {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
`;

/* Exported so other components can render the identical toggle glyph. */
export const PanelToggleIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);

/** localStorage key the IconSidebar uses for its expanded state. */
export const SIDEBAR_STORAGE_KEY = 'iconSidebar.expanded';

/* Spacer that pushes the avatar block to the very bottom of the rail. */
const RailSpacer = styled.div`
  flex: 1;
  min-height: 12px;
`;

const NavBtn = styled.button<{ $active?: boolean; $expanded?: boolean; disabled?: boolean }>`
  ${({ $expanded }) => ($expanded
    ? `
      width: 100%;
      height: 38px;
      padding: 0 10px;
      justify-content: flex-start;
      border-radius: 10px;
      gap: 12px;
    `
    : `
      width: 36px;
      height: 36px;
      justify-content: center;
      border-radius: 50%;
      gap: 0;
    `)}

  display: flex;
  align-items: center;
  border: none;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  /* 사이드바 라벨은 거의 검정에 준하는 진한 회색으로 통일 — 가독성 우선.
   *  활성 상태는 배경 하이라이트로 구분되므로 색은 동일하게 둠. */
  color: ${({ $active }) => ($active ? '#1a1a1a' : '#2a2a2a')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    color: #1a1a1a;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  ${mq.phone} {
    width: 50px;
    height: 46px;
    border-radius: 9px;
    padding: 4px 0;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    svg { width: 18px; height: 18px; }
  }
`;

/* Tooltip shown on collapsed-rail buttons — slides in from the right. */
const NavTooltip = styled.span`
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
`;

/* Wrapper needed so NavTooltip can use position:absolute relative to the
 * collapsed NavBtn. Hover on the wrapper reveals the sibling tooltip. */
const NavBtnWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover ${NavTooltip} {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
`;

/* Chat quick-nav cluster — sits between the brand row and the divider.
 * margin-top creates a deliberate vertical gap between Jazzify/toggle and
 * the first chat button. */
const ChatNavBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: inherit;
  gap: 4px;
  margin-top: 28px;
  width: 100%;
`;

/* Personal library — "내 릭" / "내 악보". Logged-in only, sits right under the
 * chat cluster (above the divider). Backend wiring is pending; the buttons are
 * placeholders for the per-user lick/score database. */
const MyLibBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: inherit;
  gap: 4px;
  margin-top: 8px;
  width: 100%;
`;

const NavLabel = styled.span<{ $expanded?: boolean }>`
  display: ${({ $expanded }) => ($expanded ? 'inline' : 'none')};

  ${mq.phone} {
    display: block;
    font-family: ${({ theme }) => theme.fonts.ui};
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
  }
`;

const Divider = styled.div<{ $expanded?: boolean }>`
  width: ${({ $expanded }) => ($expanded ? '100%' : '24px')};
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 8px 0;

  ${mq.phone} {
    width: 36px;
    margin: 2px 0;
  }
`;

/* Bottom user row — ChatGPT-style "account bar".
 *   collapsed: avatar circle only
 *   expanded:  avatar + name/plan + download icon + chevron, all on one row */
const UserRow = styled.button<{ $expanded?: boolean }>`
  ${({ $expanded }) => ($expanded
    ? `
      width: 100%;
      padding: 8px 10px;
      gap: 12px;
      border-radius: 12px;
      justify-content: flex-start;
    `
    : `
      width: 36px;
      height: 36px;
      padding: 0;
      justify-content: center;
      border-radius: 50%;
    `)}

  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${({ $expanded }) => ($expanded ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.04)')};
  }
`;

const AvatarCircle = styled.span<{ $logged?: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: ${({ $logged }) => ($logged ? '#1a1a1a' : 'rgba(0, 0, 0, 0.06)')};
  color: ${({ $logged, theme }) => ($logged ? '#fff' : theme.colors.textSecondary)};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const UserText = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.ui};
  line-height: 1.2;
`;

const UserName = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
`;

const UserSub = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
`;

const TrailingIconBtn = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
`;

const ChevronWrap = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
`;

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v12" />
    <path d="M6 11l6 6 6-6" />
    <path d="M5 20h14" />
  </svg>
);

const ChevronUpDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 9l4-4 4 4" />
    <path d="M16 15l-4 4-4-4" />
  </svg>
);

/* Logged-out promo block shown at the very bottom of the EXPANDED sidebar. */
const PromoCard = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px 6px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const PromoTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.01em;
`;

const PromoText = styled.span`
  font-size: 11.5px;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PromoLoginBtn = styled.button`
  margin-top: 4px;
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

const PersonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

/* ── Chat quick-nav icons ─────────────────────────────────────────────── */

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

/* ── Tool nav icons ───────────────────────────────────────────────────── */

const ChordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);

const NoteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 18V4" /><path d="M12 4l6 2" /><circle cx="9" cy="18" r="3" />
  </svg>
);

const LickIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="16" x2="21" y2="16" />
    <line x1="8" y1="5" x2="8" y2="19" /><line x1="16" y1="5" x2="16" y2="19" />
  </svg>
);

const SoloIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" />
  </svg>
);

/* ── personal-library icons (Lucide-style, distinct from the admin nav) ── */

/* 내 코드 차트 — table/grid (a chord chart is a grid of bars). Sized to match
 * the chat-nav icons above (18px / strokeWidth 1.7) so the rows align. */
const MyChordChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 9v12" />
    <path d="M15 9v12" />
  </svg>
);

/* 내 악보 차트 — a sheet/page with a music note (a score document). */
const MyScoreChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <circle cx="9" cy="16.5" r="1.6" />
    <path d="M10.6 16.5V11l4 1.1" />
  </svg>
);

/* 내 릭 — audio waveform (a lick is a short melodic phrase). */
const MyLickIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 13v-2" />
    <path d="M6 16V8" />
    <path d="M10 19V5" />
    <path d="M14 16V8" />
    <path d="M18 14v-4" />
    <path d="M22 13v-2" />
  </svg>
);

const EditorIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const VideoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const OmrIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const NAV = [
  { path: '/chord', icon: ChordIcon, label: 'Chord Analysis' },
  { path: '/note', icon: NoteIcon, label: 'Note Analysis' },
  { path: '/licks', icon: LickIcon, label: 'Lick Database' },
  { path: '/solos', icon: SoloIcon, label: 'Solo Database' },
  { path: '/editor', icon: EditorIcon, label: 'Editor' },
  { path: '/youtube-onset', icon: VideoIcon, label: 'YouTube Onset' },
  { path: '/input', icon: OmrIcon, label: 'OMR' },
] as const;

/* ── Admin drop-up ───────────────────────────────────────────────────────
 * Sits just above the bottom UserMenu / PromoCard row. Clicking the button
 * opens a popover that slides UPWARD from the button, listing the legacy NAV
 * tools (Chord/Note/Lick/Solo/Editor/YouTube/OMR). Closes on outside-click
 * or after a nav-item click. */

const AdminIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3"  y="3"  width="6" height="6" rx="1" />
    <rect x="15" y="3"  width="6" height="6" rx="1" />
    <rect x="3"  y="15" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
  </svg>
);

/* Wraps the button + popover so position:absolute on the popover anchors to
 * the button, not the whole Rail. */
const AdminBlock = styled.div<{ $expanded?: boolean }>`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: ${({ $expanded }) => ($expanded ? 'stretch' : 'center')};
  margin-bottom: 6px;
`;

/* Admin trigger — visually a NavBtn so it fits the rest of the rail. The
 * $on prop highlights it while the dropup is open. */
const AdminBtn = styled.button<{ $expanded?: boolean; $on?: boolean }>`
  ${({ $expanded }) => ($expanded
    ? `
      width: 100%;
      height: 38px;
      padding: 0 10px;
      justify-content: flex-start;
      border-radius: 10px;
      gap: 12px;
    `
    : `
      width: 36px;
      height: 36px;
      justify-content: center;
      border-radius: 50%;
      gap: 0;
    `)}

  display: flex;
  align-items: center;
  border: none;
  background: ${({ $on }) => ($on ? 'rgba(0, 0, 0, 0.08)' : 'transparent')};
  color: ${({ $on }) => ($on ? '#1a1a1a' : '#2a2a2a')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  &:hover { background: rgba(0, 0, 0, 0.06); color: #1a1a1a; }
`;

/* Popover anchored to the bottom of AdminBlock and growing upward. min-width
 * keeps labels readable even when the rail is collapsed (52px). */
const AdminDropup = styled.div<{ $expanded?: boolean }>`
  position: absolute;
  bottom: calc(100% + 6px);
  left: ${({ $expanded }) => ($expanded ? '0' : '8px')};
  ${({ $expanded }) => ($expanded ? 'right: 0;' : '')}
  min-width: 220px;
  max-width: calc(100vw - 80px);
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 60;
  /* Subtle slide-up reveal. */
  animation: adminDropupIn 0.14s ease-out;
  @keyframes adminDropupIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

const AdminItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: #1a1a1a;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;

  &:hover { background: rgba(0, 0, 0, 0.06); }
  svg { flex-shrink: 0; }
`;

interface IconSidebarProps {
  /** Suppress the "로그인하세요" promo card. */
  hideAuthPromo?: boolean;
  /** Called when "새 채팅" is clicked. Defaults to `navigate('/')`. */
  onNewChat?: () => void;
  /** Called when "채팅" (history) is clicked. Defaults to `navigate('/')`. */
  onOpenChatHistory?: () => void;
  /** Override for whether the chat-history button is enabled (defaults to local auth state). */
  isLoggedInUser?: boolean;
}

export function IconSidebar({
  hideAuthPromo = false,
  onNewChat,
  onOpenChatHistory,
  isLoggedInUser,
}: IconSidebarProps = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const [expanded, setExpanded] = useState<boolean>(() => {
    /* Tablet / desktop widths: always start expanded on launch. Users can
     * still toggle it closed within a session via the panel button, but
     * each fresh entry re-opens the sidebar so the first screen consistently
     * shows the ChatGPT-on-iPad pattern. (The saved preference is honoured
     * only on narrow / phone widths where space is at a premium.) */
    if (typeof window !== 'undefined'
        && window.matchMedia('(min-width: 768px)').matches) {
      return true;
    }
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch { /* storage unavailable */ }
    return false;
  });

  useEffect(() => {
    const unsub = onAuthChange((loggedIn, user) => {
      setAuthUser(loggedIn ? user : null);
    });
    return unsub;
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const loggedIn = authUser !== null;

  /* Chat nav defaults: navigate to '/' so tool pages get a "back to chat"
   * affordance, while HomePage can pass its own handlers for in-page actions.
   * Always clear the active backend chat so RightChatPanel resets to a fresh
   * conversation (which then creates a new backend chat on first message). */
  const handleNewChat = onNewChat ?? (() => { setActiveChat(null); navigate('/'); });
  const handleOpenChatHistory = onOpenChatHistory ?? (() => navigate('/'));
  const chatEnabled = isLoggedInUser !== undefined ? isLoggedInUser : loggedIn;

  /* Admin drop-up state. Closes when the user clicks outside the block
   * or presses Escape — both standard popover dismissal patterns. */
  const [adminOpen, setAdminOpen] = useState(false);
  const adminBlockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!adminOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!adminBlockRef.current?.contains(e.target as Node)) setAdminOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAdminOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [adminOpen]);

  return (
    <>
      <Rail $expanded={expanded}>
      <TopRow $expanded={expanded}>
        {expanded ? (
          <>
            <BrandRow>
              <BrandLogoImage height={34} scaleX={1.05} onClick={() => navigate('/')} />
            </BrandRow>
            <ToggleBtn $expanded onClick={toggleExpanded} aria-label="사이드바 접기">
              <PanelToggleIcon />
              <ToggleTooltip>사이드바 접기</ToggleTooltip>
            </ToggleBtn>
          </>
        ) : (
          <ToggleBtn onClick={toggleExpanded} aria-label="사이드바 열기">
            <PanelToggleIcon />
            <ToggleTooltip>사이드바 열기</ToggleTooltip>
          </ToggleBtn>
        )}
      </TopRow>

      {/* Chat quick-nav — expanded layout */}
      {expanded && (
        <ChatNavBlock>
          <NavBtn $expanded={true} onClick={handleNewChat}>
            <NewChatIcon />
            <NavLabel $expanded={true}>새 채팅</NavLabel>
          </NavBtn>
          <NavBtn $expanded={true} onClick={() => { /* TODO: open search overlay */ }}>
            <SearchIcon />
            <NavLabel $expanded={true}>검색</NavLabel>
          </NavBtn>
          <NavBtn
            $expanded={true}
            onClick={handleOpenChatHistory}
            disabled={!chatEnabled}
            title={chatEnabled ? '대화 기록' : '로그인 필요'}
          >
            <ChatIcon />
            <NavLabel $expanded={true}>채팅</NavLabel>
          </NavBtn>
        </ChatNavBlock>
      )}

      {/* Chat quick-nav — collapsed layout */}
      {!expanded && (
        <ChatNavBlock>
          <NavBtnWrap>
            <NavBtn $expanded={false} onClick={handleNewChat} title="새 채팅">
              <NewChatIcon />
            </NavBtn>
            <NavTooltip>새 채팅</NavTooltip>
          </NavBtnWrap>
          <NavBtnWrap>
            <NavBtn $expanded={false} title="검색">
              <SearchIcon />
            </NavBtn>
            <NavTooltip>검색</NavTooltip>
          </NavBtnWrap>
          <NavBtnWrap>
            <NavBtn
              $expanded={false}
              onClick={handleOpenChatHistory}
              disabled={!chatEnabled}
              title={chatEnabled ? '채팅' : '로그인 필요'}
            >
              <ChatIcon />
            </NavBtn>
            <NavTooltip>{chatEnabled ? '채팅' : '로그인 필요'}</NavTooltip>
          </NavBtnWrap>
        </ChatNavBlock>
      )}

      {/* Personal library — always rendered. Disabled (and visibly dimmed via
       *  NavBtn's :disabled styling) when logged out so the section is
       *  discoverable but inert. */}
      <MyLibBlock>
        {expanded ? (
          <>
            <NavBtn
              $expanded={true}
              $active={loggedIn && pathname.startsWith('/my-charts')}
              onClick={() => navigate('/my-charts')}
              disabled={!loggedIn}
              title={loggedIn ? '내 코드 차트' : '로그인 필요'}
            >
              <MyChordChartIcon />
              <NavLabel $expanded={true}>내 코드 차트</NavLabel>
            </NavBtn>
            <NavBtn
              $expanded={true}
              $active={loggedIn && pathname.startsWith('/my-sheets')}
              onClick={() => navigate('/my-sheets')}
              disabled={!loggedIn}
              title={loggedIn ? '내 악보 차트' : '로그인 필요'}
            >
              <MyScoreChartIcon />
              <NavLabel $expanded={true}>내 악보 차트</NavLabel>
            </NavBtn>
            <NavBtn
              $expanded={true}
              onClick={() => { /* TODO: 사용자별 릭 DB */ }}
              disabled={!loggedIn}
              title={loggedIn ? '내 릭' : '로그인 필요'}
            >
              <MyLickIcon />
              <NavLabel $expanded={true}>내 릭</NavLabel>
            </NavBtn>
          </>
        ) : (
          <>
            <NavBtnWrap>
              <NavBtn
                $expanded={false}
                $active={loggedIn && pathname.startsWith('/my-charts')}
                onClick={() => navigate('/my-charts')}
                disabled={!loggedIn}
                title={loggedIn ? '내 코드 차트' : '로그인 필요'}
              >
                <MyChordChartIcon />
              </NavBtn>
              <NavTooltip>{loggedIn ? '내 코드 차트' : '로그인 필요'}</NavTooltip>
            </NavBtnWrap>
            <NavBtnWrap>
              <NavBtn
                $expanded={false}
                $active={loggedIn && pathname.startsWith('/my-sheets')}
                onClick={() => navigate('/my-sheets')}
                disabled={!loggedIn}
                title={loggedIn ? '내 악보 차트' : '로그인 필요'}
              >
                <MyScoreChartIcon />
              </NavBtn>
              <NavTooltip>{loggedIn ? '내 악보 차트' : '로그인 필요'}</NavTooltip>
            </NavBtnWrap>
            <NavBtnWrap>
              <NavBtn
                $expanded={false}
                onClick={() => { /* TODO: 사용자별 릭 DB */ }}
                disabled={!loggedIn}
                title={loggedIn ? '내 릭' : '로그인 필요'}
              >
                <MyLickIcon />
              </NavBtn>
              <NavTooltip>{loggedIn ? '내 릭' : '로그인 필요'}</NavTooltip>
            </NavBtnWrap>
          </>
        )}
      </MyLibBlock>

      <Divider $expanded={expanded} />

      {/* "최근 채팅" — per-user chat history list (Jazzify backend /v1/chat).
       * Click an item → RightChatPanel loads that chat. Only renders in
       * expanded mode + when logged in; otherwise it self-mounts to null and
       * RailSpacer fills the gap. */}
      <RecentChatsList expanded={expanded} loggedIn={loggedIn} />

      <RailSpacer />

      {/* Admin drop-up — clicking opens a popover ABOVE the button that
       * contains the legacy tool nav (Chord / Note / Lick / Solo / Editor /
       * YouTube / OMR). Sits just above the profile/Max-plan row. */}
      <AdminBlock ref={adminBlockRef} $expanded={expanded}>
        {adminOpen && (
          <AdminDropup $expanded={expanded} role="menu">
            {NAV.map(({ path, icon: Icon, label }) => (
              <AdminItem
                key={path}
                $active={pathname.startsWith(path)}
                role="menuitem"
                onClick={() => { navigate(path); setAdminOpen(false); }}
              >
                <Icon />
                <span>{label}</span>
              </AdminItem>
            ))}
          </AdminDropup>
        )}
        <AdminBtn
          $expanded={expanded}
          $on={adminOpen}
          onClick={() => setAdminOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={adminOpen}
          title="Admin"
        >
          <AdminIcon />
          {expanded && <span>Admin</span>}
        </AdminBtn>
      </AdminBlock>

      {loggedIn && authUser ? (
        <UserMenu user={authUser} compact={!expanded} />
      ) : expanded && !hideAuthPromo ? (
        <PromoCard>
          <PromoTitle>나만의 재즈 라이브러리를 시작하세요</PromoTitle>
          <PromoText>로그인하면 릭·솔로를 저장하고, 개인화된 코드 분석과 추천을 받을 수 있어요.</PromoText>
          <PromoLoginBtn onClick={() => navigate('/login')}>로그인</PromoLoginBtn>
        </PromoCard>
      ) : (
        <UserRow
          $expanded={expanded}
          onClick={() => navigate('/login')}
          title="로그인"
          aria-label="로그인"
        >
          <AvatarCircle $logged={false}>
            <PersonIcon />
          </AvatarCircle>
          {expanded && (
            <>
              <UserText>
                <UserName>로그인</UserName>
                <UserSub>시작하기</UserSub>
              </UserText>
              <TrailingIconBtn aria-hidden>
                <DownloadIcon />
              </TrailingIconBtn>
              <ChevronWrap aria-hidden>
                <ChevronUpDownIcon />
              </ChevronWrap>
            </>
          )}
        </UserRow>
      )}
      </Rail>
    </>
  );
}
