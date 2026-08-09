import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { BrandLogoImage } from '../common/BrandLogoImage';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';
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
  /* 좌우 여백 대칭(12px) — 예전엔 오른쪽이 2px 라 활성/hover 하이라이트가
   * 오른쪽 끝에 붙어 보였다. 스크롤바(6px)는 이 안쪽에서 겹친다. */
  padding: 0 ${({ $expanded }) => ($expanded ? '12px 0 12px' : '0')};
  gap: 4px;
  background: transparent;
  /* Solid right border so the rail visually separates from the chat area. */
  border-right: 1px solid ${({ theme }) => theme.colors.border};
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
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
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
    background: ${({ theme }) => theme.colors.hover};
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
  scrollbar-color: ${({ theme }) => theme.colors.textSecondary} transparent;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: ${({ theme }) => theme.colors.border}; border-radius: 3px; }
  &::-webkit-scrollbar-thumb:hover { background: ${({ theme }) => theme.colors.scrim}; }

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
  /* 라벨 색은 **테마 토큰**을 쓴다 — 예전엔 '#1a1a1a'/'#2a2a2a' 로 박아 두어
   *  다크 모드에서 어두운 배경에 어두운 글자가 되어 읽을 수 없었다.
   *  활성 상태는 배경 하이라이트로 구분되므로 색은 동일하게 둔다. */
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.hover};
    color: ${({ theme }) => theme.colors.textPrimary};
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
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
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
  /* 28px 은 로고와 사이 여백이 과했다 — 아래 블록 전체를 살짝 끌어올린다. */
  margin-top: 18px;
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

/* 내 릭 아래 도구 묶음(음원 분리·카피하기·연습하기·커뮤니티) — 라이브러리와
 * 같은 간격(margin-top)으로 약간 내려 배치. */
const ToolNavBlock = styled(MyLibBlock)``;

/* "준비중" 배지 — 확장 모드에서만 라벨 옆에 작게. */
const Soon = styled.span`
  margin-left: 6px;
  font-size: 9px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.activeFill};
  border-radius: 6px;
  padding: 1px 5px;
  line-height: 1.4;
  ${mq.phone} { display: none; }
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
  height: 1px;
  /* 부모 ScrollArea 가 flex column + overflow 라, flex-shrink 기본값(1)이면
   * 이 1px 이 0 으로 찌그러져 선이 아예 그려지지 않는다. */
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.activeFill};

  /* Rail 의 좌우 패딩이 비대칭이라(왼쪽 12px / 오른쪽 2px) 같은 margin 을 주면
   * 오른쪽만 가장자리에 붙어 보인다. 좌우 시각 여백이 20px 로 같아지도록 보정.
   * 아래 margin 을 위보다 좁혀 "최근 채팅" 을 살짝 끌어올린다. */
  ${({ $expanded }) => ($expanded
    ? `
      align-self: stretch;
      width: auto;
      margin: 8px 18px 4px 8px;
    `
    : `
      width: 24px;
      margin: 8px 0;
    `)}

  ${mq.phone} {
    align-self: center;
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
  border: 1px solid ${({ theme }) => theme.colors.border};
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
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.12s;

  &:hover {
    background: ${({ theme }) => theme.colors.hover};
    border-color: ${({ theme }) => theme.colors.border};
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

/* ── personal-library icons ──
 * 일부는 public/icons/sidebar/*.png 를 쓴다. 그 폴더에는 **실제로 사이드바에
 * 출력되는 확정 아이콘만** 두고, 파일명은 항목 이름(mylick·stems …)으로 맞춘다.
 * <img> 로 넣으면 색이 고정돼 테마·호버·비활성 상태를 못 따라가므로,
 * **CSS mask + background-color: currentColor** 로 칠한다 — SVG 아이콘과
 * 동일하게 동작한다. */
const PngIcon = styled.span<{ $src: string; $size: number }>`
  display: inline-block;
  flex-shrink: 0;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  background-color: currentColor;
  -webkit-mask: url(${({ $src }) => $src}) center / contain no-repeat;
  mask: url(${({ $src }) => $src}) center / contain no-repeat;
`;
const SIDEBAR_ICON = (name: string) => `${import.meta.env.BASE_URL}icons/sidebar/${name}.png`;

/* 내 코드 차트 — 격자. */
const MyChordChartIcon = () => <PngIcon $src={SIDEBAR_ICON('mychordchart')} $size={18} />;

/* 내 악보 차트 — 음표 문서. */
const MyScoreChartIcon = () => <PngIcon $src={SIDEBAR_ICON('myscorechart')} $size={18} />;

/* 내 릭 — 음표 + 북마크. 가로로 긴 아이콘이라 정사각 캔버스 안에서 contain 으로 맞춰진다. */
const MyLickIcon = () => <PngIcon $src={SIDEBAR_ICON('mylick')} $size={18} />;

/* 음원 분리 — 페이더. */
const StemsIcon = () => <PngIcon $src={SIDEBAR_ICON('stems')} $size={20} />;
/* 카피하기 — 귀 + 음표. */
const SaxIcon = () => <PngIcon $src={SIDEBAR_ICON('copy')} $size={20} />;

/* 연습하기 — 메트로놈. */
const PracticeIcon = () => <PngIcon $src={SIDEBAR_ICON('practice')} $size={20} />;

/* 커뮤니티 — 두 사람. */
const CommunityIcon = () => <PngIcon $src={SIDEBAR_ICON('community')} $size={20} />;

/* 개인 라이브러리 아래 도구 묶음 — 내 릭 밑에 약간 여백 두고 배치. 음원 분리는
 * 활성(/stems), 나머지는 준비중(비활성). 넷 다 로그인 시에만 사용 가능. */
const LIB_TOOLS = [
  { icon: StemsIcon,     label: '음원 분리', to: '/stems' as string | undefined, soon: false },
  /* 에디터(/editor)는 여기에 두지 않는다 — 빈 에디터로 바로 들어가면 저장할 대상이
   * 없다. 사용자에게는 **내 릭에서 만들기·수정**으로만 열리는 편집 화면이고,
   * 스튜디오에서만 독립 도구('Editor')로 쓴다. */
  { icon: SaxIcon,       label: '카피하기',  to: '/copy' as string | undefined, soon: false },
  { icon: PracticeIcon,  label: '연습하기',  to: undefined as string | undefined, soon: true },
  { icon: CommunityIcon, label: '커뮤니티',  to: undefined as string | undefined, soon: true },
] as const;

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

      {/* 내 릭 밑 도구 묶음 — 음원 분리(활성) + 카피하기/연습하기/커뮤니티(준비중).
       *  넷 다 로그인 시에만 활성(라이브러리 항목과 동일 게이팅). */}
      <ToolNavBlock>
        {expanded ? (
          <>
            {LIB_TOOLS.map(({ icon: Icon, label, to, soon }) => (
              <NavBtn
                key={label}
                $expanded={true}
                $active={!soon && !!to && loggedIn && pathname.startsWith(to)}
                onClick={!loggedIn || soon || !to ? undefined : () => navigate(to)}
                disabled={!loggedIn || soon}
                title={!loggedIn ? '로그인 필요' : soon ? `${label} (준비중)` : label}
              >
                <Icon />
                <NavLabel $expanded={true}>{label}</NavLabel>
                {soon && <Soon>준비중</Soon>}
              </NavBtn>
            ))}
          </>
        ) : (
          <>
            {LIB_TOOLS.map(({ icon: Icon, label, to, soon }) => (
              <NavBtnWrap key={label}>
                <NavBtn
                  $expanded={false}
                  $active={!soon && !!to && loggedIn && pathname.startsWith(to)}
                  onClick={!loggedIn || soon || !to ? undefined : () => navigate(to)}
                  disabled={!loggedIn || soon}
                  title={!loggedIn ? '로그인 필요' : soon ? `${label} (준비중)` : label}
                >
                  <Icon />
                </NavBtn>
                <NavTooltip>{!loggedIn ? '로그인 필요' : soon ? `${label} (준비중)` : label}</NavTooltip>
              </NavBtnWrap>
            ))}
          </>
        )}
      </ToolNavBlock>

      <Divider $expanded={expanded} />

      {/* "최근 채팅" — per-user chat history list (Jazzify backend /v1/chat).
       * Click an item → RightChatPanel loads that chat. Only renders in
       * expanded mode + when logged in; otherwise it self-mounts to null and
       * the ScrollArea's flex:1 fills the gap. */}
      <RecentChatsList expanded={expanded} loggedIn={loggedIn} />
      </ScrollArea>

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
