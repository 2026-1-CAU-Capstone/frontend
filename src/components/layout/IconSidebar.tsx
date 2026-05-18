import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { BrandLogoImage } from '../common/BrandLogoImage';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';
import { LoginModal } from '../auth/LoginModal';

/* ─────────────────────────────────────────────────────────────────────────
 * IconSidebar — shared left rail for Chord / Note / Licks / Solos pages.
 *
 * Two modes (toggled by the top "panel" button, persisted to localStorage):
 *
 *   collapsed (default): 56px-wide icon rail with just the logo, NAV icons
 *                        and the user avatar. Tooltips reveal labels.
 *   expanded:            260px-wide panel with "Jazzify" brand + textual
 *                        NAV labels + user name on the avatar row. Matches
 *                        the side-panel pattern from popular AI chat UIs.
 *
 * Native (Capacitor) and the existing mobile drawer pattern are untouched —
 * those flows still use the compact icon rail.
 * ──────────────────────────────────────────────────────────────────────── */

// SIDEBAR_STORAGE_KEY is exported (line ~100) so HomePage stays in sync.

const Rail = styled.nav<{ $expanded: boolean }>`
  width: ${({ $expanded }) => ($expanded ? '260px' : '56px')};
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

  ${mq.mobile} {
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
  align-items: center;
  justify-content: ${({ $expanded }) => ($expanded ? 'space-between' : 'center')};
  width: 100%;
  padding: 0;
  gap: 4px;
`;

/* BrandText replaced by the combined <BrandLogoImage>. */

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

/* Square panel-toggle icon button (matches the side-panel-toggle iconography
 * used by ChatGPT / Claude). */
const ToggleBtn = styled.button`
  width: 50px;
  height: 50px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

/* Exported so HomePage's own sidebar can render the identical toggle glyph. */
export const PanelToggleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);

/** localStorage key the IconSidebar uses for its expanded state. Reused by
 *  HomePage so the two sidebars stay in sync across the app. */
export const SIDEBAR_STORAGE_KEY = 'iconSidebar.expanded';

/* (TopSlot / SlotLogo / SlotToggle / SlotTooltip removed — the collapsed
 *  rail now shows the toggle button directly instead of swapping a logo on
 *  hover, matching the Claude/ChatGPT side-rail pattern.) */

/* Spacer that pushes the avatar block to the very bottom of the rail. */
const RailSpacer = styled.div`
  flex: 1;
  min-height: 12px;
`;

const NavBtn = styled.button<{ $active?: boolean; $expanded?: boolean }>`
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
  color: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : theme.colors.textSecondary)};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }

  ${mq.mobile} {
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

const NavLabel = styled.span<{ $expanded?: boolean }>`
  display: ${({ $expanded }) => ($expanded ? 'inline' : 'none')};

  ${mq.mobile} {
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

  ${mq.mobile} {
    width: 36px;
    margin: 2px 0;
  }
`;

/* Bottom user row — ChatGPT-style "account bar".
 *   collapsed: avatar circle only
 *   expanded:  avatar + name/plan + download icon + chevron, all on one row
 *              with rounded hover background.
 * The whole row is a single button (clicking the avatar area / name) for
 * primary "open account" action. The download and chevron are visual only
 * here — both forward to the same handler, kept distinct to mirror the
 * reference design exactly. */
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

/* Small square button rendered to the right of the user text — matches the
 * "app download" affordance from the ChatGPT sidebar. */
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

/* Small chevron icon at the very end of the row. */
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

/* Logged-out promo block shown at the very bottom of the EXPANDED sidebar.
 * Collapsed rail keeps using the small person icon. Mirrors the ChatGPT
 * "내게 맞춘 응답을 받으세요" card so users have a contextual call to log in. */
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

/** Pick the first character of the user's display name. Defaults to '?' when
 *  the cached user object hasn't filled in a name yet (e.g. right after
 *  signup before the next /me call). Korean names render fine since we just
 *  slice the first code point — no uppercasing is applied to non-Latin. */
function userInitial(user: AuthUser | null): string {
  if (!user) return '';
  const source = user.name?.trim() || user.username?.trim() || '';
  if (!source) return '?';
  const first = Array.from(source)[0] ?? '?';
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}

/* Inline SVG icons — kept matching the HomePage drawer set so the desktop
 * rail and the mobile drawer feel like the same product. */
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

interface IconSidebarProps {
  /** Suppress the "로그인하세요" promo card. Used on chord/note pages where
   *  login will be required up-front, making the in-rail CTA redundant. */
  hideAuthPromo?: boolean;
}

export function IconSidebar({ hideAuthPromo = false }: IconSidebarProps = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'; }
    catch { return false; }
  });
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((loggedIn, user) => {
      setAuthUser(loggedIn ? user : null);
      if (loggedIn) setLoginOpen(false);
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
  const initial = userInitial(authUser);
  const displayName = authUser?.name || authUser?.username || '';
  const subText = authUser?.username && authUser.name ? authUser.username : '';

  return (
    <Rail $expanded={expanded}>
      <TopRow $expanded={expanded}>
        {expanded ? (
          <>
            <BrandRow>
              <BrandLogoImage height={32} scaleX={1.05} onClick={() => navigate('/')} />
            </BrandRow>
            <ToggleBtn onClick={toggleExpanded} title="사이드바 접기" aria-label="사이드바 접기">
              <PanelToggleIcon />
            </ToggleBtn>
          </>
        ) : (
          /* Collapsed: just the toggle button — no logo, matches the
           * Claude/ChatGPT side-rail pattern where the brand mark vanishes
           * once the rail itself is doing all the work. */
          <ToggleBtn onClick={toggleExpanded} title="사이드바 열기" aria-label="사이드바 열기">
            <PanelToggleIcon />
          </ToggleBtn>
        )}
      </TopRow>

      <Divider $expanded={expanded} />

      {NAV.map(({ path, icon: Icon, label }) => (
        <NavBtn
          key={path}
          $active={pathname.startsWith(path)}
          $expanded={expanded}
          onClick={() => navigate(path)}
          title={label}
        >
          <Icon />
          <NavLabel $expanded={expanded}>{label}</NavLabel>
        </NavBtn>
      ))}

      <RailSpacer />

      {expanded && !loggedIn && !hideAuthPromo ? (
        <PromoCard>
          <PromoTitle>나만의 재즈 라이브러리를 시작하세요</PromoTitle>
          <PromoText>로그인하면 릭·솔로를 저장하고, 개인화된 코드 분석과 추천을 받을 수 있어요.</PromoText>
          <PromoLoginBtn onClick={() => setLoginOpen(true)}>로그인</PromoLoginBtn>
        </PromoCard>
      ) : (
        <UserRow
          $expanded={expanded}
          onClick={() => (loggedIn ? navigate('/') : setLoginOpen(true))}
          title={loggedIn ? `계정 — ${displayName}` : '로그인'}
          aria-label={loggedIn ? `계정 — ${displayName}` : '로그인'}
        >
          <AvatarCircle $logged={loggedIn}>
            {loggedIn ? initial : <PersonIcon />}
          </AvatarCircle>
          {expanded && (
            <>
              <UserText>
                <UserName>{loggedIn ? displayName : '로그인'}</UserName>
                <UserSub>{loggedIn ? (subText || '무료 플랜') : '시작하기'}</UserSub>
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

      {loginOpen && (
        <LoginModal
          onLogin={() => setLoginOpen(false)}
          onClose={() => setLoginOpen(false)}
        />
      )}
    </Rail>
  );
}
