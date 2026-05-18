import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { logout as apiLogout, type AuthUser } from '../../api/auth';
import { SettingsModal } from './SettingsModal';

/* 사이드바 하단의 로그인된 사용자 영역.
 *
 * 가로 행: [아바타] [이름 / "무료 플랜"] [↕]
 * 클릭하면 위로 드롭업 메뉴가 떠오른다 (Claude 데스크탑 앱 패턴).
 * 외부 클릭 / Esc 로 닫히고, 로그아웃만 실제 동작 — 나머지 항목은
 * Jazzify 에 아직 대응 기능이 없는 placeholder. */

interface Props {
  user: AuthUser;
}

export function UserMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    /* fire-and-forget — onAuthChange 가 상태를 갱신해 줌 */
    void apiLogout();
  };

  const initial = pickInitial(user);
  const displayName = (user.name?.trim() || user.username || '').trim();

  return (
    <Root ref={rootRef}>
      {open && (
        <Menu role="menu">
          <MenuHeader>@{user.username}</MenuHeader>
          <MenuDivider />
          <MenuItem
            type="button"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            <MenuIcon><SettingsIcon /></MenuIcon>
            <MenuLabel>설정</MenuLabel>
            <MenuShortcut>⇧⌘,</MenuShortcut>
          </MenuItem>
          <MenuItem type="button">
            <MenuIcon><GlobeIcon /></MenuIcon>
            <MenuLabel>언어</MenuLabel>
            <Chevron>›</Chevron>
          </MenuItem>
          <MenuItem type="button" $highlight>
            <MenuIcon><HelpIcon /></MenuIcon>
            <MenuLabel>도움 받기</MenuLabel>
          </MenuItem>
          <MenuDivider />
          <MenuItem type="button">
            <MenuIcon><UpgradeIcon /></MenuIcon>
            <MenuLabel>요금제 업그레이드</MenuLabel>
          </MenuItem>
          <MenuItem type="button">
            <MenuIcon><DownloadIcon /></MenuIcon>
            <MenuLabel>앱 및 확장 프로그램 받기</MenuLabel>
          </MenuItem>
          <MenuItem type="button">
            <MenuIcon><GiftIcon /></MenuIcon>
            <MenuLabel>Jazzify 선물하기</MenuLabel>
          </MenuItem>
          <MenuItem type="button">
            <MenuIcon><InfoIcon /></MenuIcon>
            <MenuLabel>자세히 알아보기</MenuLabel>
            <Chevron>›</Chevron>
          </MenuItem>
          <MenuDivider />
          <MenuItem type="button" onClick={handleLogout}>
            <MenuIcon><LogoutIcon /></MenuIcon>
            <MenuLabel>로그아웃</MenuLabel>
          </MenuItem>
        </Menu>
      )}

      <Trigger
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar>{initial}</Avatar>
        <Texts>
          <Name>{displayName}</Name>
          <Sub>무료 플랜</Sub>
        </Texts>
        <UpDownIcon />
      </Trigger>
      <SettingsModal
        open={settingsOpen}
        user={user}
        onClose={() => setSettingsOpen(false)}
      />
    </Root>
  );
}

function pickInitial(user: AuthUser): string {
  const src = (user.name?.trim() || user.username?.trim() || '?');
  const first = Array.from(src)[0] ?? '?';
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

/* ── icons ───────────────────────────────────────────────── */

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const HelpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const UpgradeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <polyline points="16 12 12 8 8 12" />
    <line x1="12" y1="16" x2="12" y2="8" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const GiftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect x="2" y="7" width="20" height="5" />
    <line x1="12" y1="22" x2="12" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const UpDownIcon = () => (
  <ChevronWrap aria-hidden>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 2 12 6" />
      <polyline points="4 10 8 14 12 10" />
    </svg>
  </ChevronWrap>
);

/* ── styles ──────────────────────────────────────────────── */

const Root = styled.div`
  position: relative;
  width: 100%;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const Trigger = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 8px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: ${({ theme }) => theme.fonts.ui};
  transition: background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

const Avatar = styled.span`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #6b6b6b;
  color: #fff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const Texts = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
  line-height: 1.2;
`;

const Name = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: #1a1a1a;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Sub = styled.span`
  font-size: 12px;
  font-weight: 400;
  color: rgba(0, 0, 0, 0.55);
`;

const ChevronWrap = styled.span`
  flex-shrink: 0;
  color: rgba(0, 0, 0, 0.45);
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const Menu = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  background: #ffffff;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
  padding: 6px 0;
  font-family: ${({ theme }) => theme.fonts.ui};
  z-index: 100;
`;

const MenuHeader = styled.div`
  padding: 8px 14px 6px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MenuDivider = styled.hr`
  margin: 4px 10px;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
`;

const MenuItem = styled.button<{ $highlight?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  background: ${({ $highlight }) => ($highlight ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  color: #1a1a1a;
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

const MenuIcon = styled.span`
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.75);
  flex-shrink: 0;
`;

const MenuLabel = styled.span`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MenuShortcut = styled.span`
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  letter-spacing: 0.04em;
`;

const Chevron = styled.span`
  font-size: 15px;
  color: rgba(0, 0, 0, 0.45);
  line-height: 1;
`;
