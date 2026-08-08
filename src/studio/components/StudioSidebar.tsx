import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { StudioLogo } from './StudioLogo';
import { STUDIO_NAV, STUDIO_NAV_GROUPS } from '../nav';
import { UserMenu } from '../../components/auth/UserMenu';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * StudioSidebar — 스튜디오의 좌측 레일.
 *
 * 실서비스 사이드바(IconSidebar)와 **치수·모양을 같이 맞춘다**: 244/52px 폭,
 * 38px 항목 높이, 같은 반경·간격·테마 토큰. 다만 내용은 완전히 다르다 —
 * 최근 채팅·라이브러리·계정 메뉴가 없고, 예전 우측 하단 `AdminToolsDock`
 * 드롭업에 있던 도구 목록이 그대로 들어온다.
 *
 * IconSidebar 를 모드 분기로 재사용하지 않은 이유: 그쪽은 900줄에 채팅 목록·
 * 차트 배지·유저 메뉴가 얽혀 있어서, 절반을 끄는 조건문을 넣으면 양쪽 다
 * 읽기 어려워진다. 공유하는 건 **디자인 토큰과 치수**이고 구조는 각자 갖는다.
 * ──────────────────────────────────────────────────────────────────────── */

/* 펼침 상태는 사이드바가 **스스로** 들고 localStorage 에 남긴다.
 * 셸이 들고 주입하면 렌더마다 컴포넌트 정체성이 바뀌어 사이드바가 리마운트된다.
 * 앱 사이드바(IconSidebar)도 같은 방식으로 자기 상태를 갖는다. */
const EXPANDED_KEY = 'studioSidebar.expanded';

export function StudioSidebar() {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(EXPANDED_KEY) !== 'false'; } catch { return true; }
  });
  const onToggle = () => setExpanded((v) => {
    try { localStorage.setItem(EXPANDED_KEY, String(!v)); } catch { /* private mode */ }
    return !v;
  });
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [user, setUser] = useState<AuthUser | null>(() => getCachedUser());
  useEffect(() => onAuthChange((isIn, u) => setUser(isIn ? (u ?? getCachedUser()) : null)), []);

  return (
    <Rail $expanded={expanded}>
      <TopRow $expanded={expanded}>
        {expanded && (
          <BrandRow>
            <StudioLogo $h={26} $clickable onClick={() => navigate('/')} />
          </BrandRow>
        )}
        <ToggleBtn
          type="button"
          onClick={onToggle}
          aria-label={expanded ? '사이드바 접기' : '사이드바 펼치기'}
        >
          <RailIcon />
        </ToggleBtn>
      </TopRow>

      {!expanded && (
        <CollapsedBrand>
          {/* 접힌 레일(52px)에는 워드마크가 안 들어간다 — 색소폰 부분만 보이게
            * 왼쪽을 기준으로 잘라낸다(로고 비율 1.84:1). */}
          <CollapsedLogoClip>
            <StudioLogo $h={20} $clickable onClick={() => navigate('/')} />
          </CollapsedLogoClip>
        </CollapsedBrand>
      )}

      <Divider $expanded={expanded} />

      <NavList>
        {STUDIO_NAV_GROUPS.map((group, gi) => (
          <Group key={group.title}>
            {expanded && <GroupTitle>{group.title}</GroupTitle>}
            {gi > 0 && !expanded && <Divider $expanded={false} />}
            {group.items.map((path) => {
              const item = STUDIO_NAV.find((n) => n.path === path)!;
              const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
              return (
                <NavBtnWrap key={item.path}>
                  <NavBtn
                    type="button"
                    $active={active}
                    $expanded={expanded}
                    onClick={() => navigate(item.path)}
                  >
                    <item.icon />
                    {expanded && <NavLabel>{item.label}</NavLabel>}
                  </NavBtn>
                  {!expanded && <NavTooltip>{item.label}</NavTooltip>}
                </NavBtnWrap>
              );
            })}
          </Group>
        ))}
      </NavList>

      {/* 계정 — 앱 사이드바와 같은 UserMenu. 설정·로그아웃 진입이 여기뿐이다. */}
      {user && (
        <Footer>
          <UserMenu user={user} compact={!expanded} />
        </Footer>
      )}
    </Rail>
  );
}

/* 사이드바 토글 아이콘 — IconSidebar 의 것과 같은 모양(패널 토글). */
const RailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);

/* ─── styles — IconSidebar 와 같은 치수 ──────────────────────────────── */

const Rail = styled.nav<{ $expanded: boolean }>`
  width: ${({ $expanded }) => ($expanded ? '244px' : '52px')};
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: ${({ $expanded }) => ($expanded ? 'stretch' : 'center')};
  padding: 0 ${({ $expanded }) => ($expanded ? '12px 0 12px' : '0')};
  gap: 4px;
  background: transparent;
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  overflow-y: auto;
  overflow-x: hidden;

  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));

  ${mq.phone} {
    width: 58px;
    padding: 8px 0;
    align-items: center;
  }
`;

const TopRow = styled.div<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: ${({ $expanded }) => ($expanded ? 'space-between' : 'center')};
  width: 100%;
  /* BackendBadge 가 화면 좌상단에 fixed(top 8 · left 8) 로 얹힌다 — 12px 만 두면
   * 워드마크가 배지에 덮여 읽히지 않는다(실측). 배지 높이만큼 더 비운다. */
  padding-top: 34px;
  gap: 4px;
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-left: 4px;
`;

/* 접힌 레일에서 로고의 왼쪽(색소폰)만 남긴다. */
const CollapsedLogoClip = styled.div`
  width: 26px;
  overflow: hidden;
  display: flex;
  justify-content: flex-start;
`;

const CollapsedBrand = styled.div`
  display: flex;
  justify-content: center;
  padding: 6px 0 2px;
`;

const ToggleBtn = styled.button`
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover {
    background: ${({ theme }) => theme.colors.hover};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const Divider = styled.div<{ $expanded?: boolean }>`
  height: 1px;
  width: ${({ $expanded }) => ($expanded ? '100%' : '28px')};
  background: ${({ theme }) => theme.colors.border};
  margin: 8px 0 4px;
  flex-shrink: 0;
`;

const NavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  align-items: inherit;
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  align-items: inherit;
`;

const GroupTitle = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 10px 10px 4px;
`;

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
  padding: 6px 10px;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: ${({ theme }) => theme.zIndex.modal};
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
`;

const NavBtnWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;

  &:hover ${NavTooltip} {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
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
  background: ${({ $active, theme }) => ($active ? theme.colors.activeFill : 'transparent')};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  white-space: nowrap;
  overflow: hidden;

  svg { flex-shrink: 0; }

  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

const Footer = styled.div`
  margin-top: auto;
  padding-top: 10px;
  width: 100%;
  display: flex;
  justify-content: center;
`;

const NavLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`;
