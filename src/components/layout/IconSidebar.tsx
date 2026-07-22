import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { BrandLogoImage } from '../common/BrandLogoImage';
import { getCachedUser, onAuthChange, isAdminUser, type AuthUser } from '../../api/auth';
import { UserMenu } from '../auth/UserMenu';
import { RecentChatsList } from './RecentChatsList';
import { ChatSearchModal } from '../chat/ChatSearchModal';
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
  /* 즉시 전환 — width 를 애니메이션하면 옆 콘텐츠(flex:1) 폭이 매 프레임 바뀌어
   * 악보/차트의 ResizeObserver 가 220ms 동안 수십 번 재렌더되며 심하게 버벅였다.
   * 스냅 전환은 콘텐츠를 단 1회만 reflow 시켜 끊김이 없다. (align-items 는 애초에
   * 애니메이션 불가 속성이라 transition 에 넣어도 툭 튀기만 했음.) */

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
  z-index: ${({ theme }) => theme.zIndex.modal};
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
/* Scrollable middle region — everything from the "새 채팅" quick-nav down
 * through the recent-chats list scrolls together, so a long chat history no
 * longer squashes the rows. TopRow (brand) stays pinned above; AdminBlock /
 * UserMenu stay pinned below. flex:1 also takes over RailSpacer's old job of
 * filling the gap and pushing the bottom cluster down when content is short. */
const ScrollArea = styled.div<{ $expanded: boolean }>`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 세로만 스크롤. overflow-y:auto 만 두면 규격상 overflow-x 가 auto 로 계산돼
   * 축소(아이콘) 모드에서 내용이 1~2px 넘칠 때 가로 스크롤바가 떴다 — 가로는 클립. */
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  /* Mirror Rail's cross-axis alignment so collapsed-mode icons stay centered. */
  align-items: ${({ $expanded }) => ($expanded ? 'stretch' : 'center')};
  gap: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.18) transparent;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.28); }

  ${mq.phone} { align-items: center; }
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
  z-index: ${({ theme }) => theme.zIndex.modal};
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

/* 음원 분리 — 믹서 페이더 3열. */
const StemsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="6" y1="4" x2="6" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="18" y1="4" x2="18" y2="20" />
    <circle cx="6" cy="9" r="2" fill="currentColor" /><circle cx="12" cy="15" r="2" fill="currentColor" /><circle cx="18" cy="7" r="2" fill="currentColor" />
  </svg>
);

/* Admin 전용 도구 목록(평면 버튼으로 나열됨). 음원 분리는 전역 기능이라 여기
 * 대신 아래 USER_TOOLS(모든 유저 평면 버튼)에 있고, OMR 단독 진입(/input)은
 * 내 코드 차트 / 내 악보 차트의 업로드 플로우가 대신하므로 admin 도구로만 남긴다. */
const NAV = [
  { path: '/chord', icon: ChordIcon, label: 'Chord Analysis' },
  { path: '/note', icon: NoteIcon, label: 'Note Analysis' },
  { path: '/licks', icon: LickIcon, label: 'Lick Database' },
  { path: '/solos', icon: SoloIcon, label: 'Solo Database' },
  { path: '/editor', icon: EditorIcon, label: 'Editor' },
  { path: '/youtube-onset', icon: VideoIcon, label: 'YouTube Onset' },
  { path: '/input', icon: OmrIcon, label: 'OMR' },
] as const;

/* 모든 사용자에게 노출되는 하단 도구 — 드롭다운 없이 평면 버튼. */
const USER_TOOLS = [
  { path: '/stems', icon: StemsIcon, label: '음원 분리' },
] as const;

/* ── Admin 전용 도구 (평면 버튼) ──────────────────────────────────────────
 * USER_TOOLS(음원 분리)와 같은 패턴 — admin 계정에만 노출되는 레거시 NAV
 * 도구(Chord/Note/Lick/Solo/Editor/YouTube/OMR)를 드롭업 없이 그대로 쌓는다. */

/* Wraps each admin nav item so its layout matches USER_TOOLS' AdminBlock. */
const AdminBlock = styled.div<{ $expanded?: boolean }>`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: ${({ $expanded }) => ($expanded ? 'stretch' : 'center')};
  margin-bottom: 2px;
`;

/* Admin nav item — visually a NavBtn so it fits the rest of the rail. The
 * $on prop highlights the item matching the current route. */
const AdminBtn = styled.button<{ $expanded?: boolean; $on?: boolean }>`
  ${({ $expanded }) => ($expanded
    ? `
      width: 100%;
      height: 32px;
      padding: 0 10px;
      justify-content: flex-start;
      border-radius: 9px;
      gap: 12px;
    `
    : `
      width: 32px;
      height: 32px;
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
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  &:hover { background: rgba(0, 0, 0, 0.06); color: #1a1a1a; }
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
  /* Chat-search overlay — opened by the "검색" NavBtn (both expanded
   * and collapsed sidebar variants). Closing it returns focus to the
   * sidebar. Cmd/Ctrl+K is also bound as a global shortcut. */
  const [searchOpen, setSearchOpen] = useState(false);
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
  /* Admin 게이트 — GET /v1/auth/me 의 등급(role)으로 판별(isAdminUser).
   * login 직후엔 fetchMe()가 role을 백그라운드 보강 → onAuthChange로 갱신됨. */
  const isAdmin = isAdminUser(authUser);

  /* Chat nav defaults: navigate to '/' so tool pages get a "back to chat"
   * affordance, while HomePage can pass its own handlers for in-page actions.
   * Always clear the active backend chat so RightChatPanel resets to a fresh
   * conversation (which then creates a new backend chat on first message). */
  const handleNewChat = onNewChat ?? (() => { setActiveChat(null); navigate('/'); });
  const handleOpenChatHistory = onOpenChatHistory ?? (() => navigate('/'));
  const chatEnabled = isLoggedInUser !== undefined ? isLoggedInUser : loggedIn;

  /* Cmd/Ctrl+K toggles the chat-search modal globally — matches the
   * familiar shortcut from Claude / ChatGPT / Linear / VSCode. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <ChatSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
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

      <ScrollArea $expanded={expanded}>
      {/* Chat quick-nav — expanded layout */}
      {expanded && (
        <ChatNavBlock>
          <NavBtn $expanded={true} onClick={handleNewChat}>
            <NewChatIcon />
            <NavLabel $expanded={true}>새 채팅</NavLabel>
          </NavBtn>
          <NavBtn $expanded={true} onClick={() => setSearchOpen(true)}>
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
            <NavBtn $expanded={false} title="검색" onClick={() => setSearchOpen(true)}>
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
              $active={loggedIn && pathname.startsWith('/my-licks')}
              onClick={() => navigate('/my-licks')}
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
                $active={loggedIn && pathname.startsWith('/my-licks')}
                onClick={() => navigate('/my-licks')}
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
       * the ScrollArea's flex:1 fills the gap. */}
      <RecentChatsList expanded={expanded} loggedIn={loggedIn} />
      </ScrollArea>

      {/* 하단 도구 — 모든 사용자에게 음원 분리 평면 버튼 노출.
       * (admin 전용 도구 목록은 바로 아래, 역시 평면 버튼) */}
      {USER_TOOLS.map(({ path, icon: Icon, label }) => (
        <AdminBlock key={path} $expanded={expanded}>
          <AdminBtn
            $expanded={expanded}
            $on={pathname.startsWith(path)}
            onClick={() => navigate(path)}
            title={label}
          >
            <Icon />
            {expanded && <span>{label}</span>}
          </AdminBtn>
        </AdminBlock>
      ))}

      {/* Admin 전용 도구 — 드롭업 없이 음원 분리와 동일하게 평면 나열
       * (Chord / Note / Lick / Solo / Editor / YouTube / OMR). */}
      {isAdmin && NAV.map(({ path, icon: Icon, label }) => (
        <AdminBlock key={path} $expanded={expanded}>
          <AdminBtn
            $expanded={expanded}
            $on={pathname.startsWith(path)}
            onClick={() => navigate(path)}
            title={label}
          >
            <Icon />
            {expanded && <span>{label}</span>}
          </AdminBtn>
        </AdminBlock>
      ))}

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
