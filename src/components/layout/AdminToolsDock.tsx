/* ─────────────────────────────────────────────────────────────────────────
 * AdminToolsDock — 인트로(홈) 화면 우측 하단의 독립 admin 도구 런처.
 *
 * 예전에는 좌측 IconSidebar 하단에 admin 전용 NAV(Chord/Note/Lick/Solo/Editor/
 * YouTube/OMR)를 붙였는데, "좌측 사이드바는 admin·일반 동일" 요구에 따라 여기
 * 우측 하단 독립 위젯으로 분리했다. **admin 계정에서만** 렌더된다(그 외 null).
 * position:fixed + 최상위 z-index 라 **어느 페이지에서도** 우측 하단에 뜨고,
 * 모달·오버레이·재생 바 위에서도 열린다. 마운트는 App.tsx 한 곳(전역).
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { getCachedUser, onAuthChange, isAdminUser, type AuthUser } from '../../api/auth';

/* ── 도구 아이콘 (IconSidebar admin nav 에서 이동) ─────────────────────────── */
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
const CompingIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* 피아노 건반 — 컴핑 */}
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="8" y1="5" x2="8" y2="19" />
    <line x1="16" y1="5" x2="16" y2="19" />
    <line x1="6" y1="5" x2="6" y2="12" strokeWidth="2.6" />
    <line x1="12" y1="5" x2="12" y2="12" strokeWidth="2.6" />
    <line x1="18" y1="5" x2="18" y2="12" strokeWidth="2.6" />
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
const OmrMonitorIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="14" rx="2" />
    <polyline points="6 12 9 12 11 9 13 15 15 12 18 12" />
    <line x1="9" y1="21" x2="15" y2="21" /><line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);
const RagIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3 1.2 0 2.34-.1 3.36-.28" />
    <circle cx="18" cy="18" r="3" /><line x1="20.5" y1="20.5" x2="22" y2="22" />
  </svg>
);

const NAV = [
  { path: '/chord', icon: ChordIcon, label: 'Chord Analysis' },
  { path: '/note', icon: NoteIcon, label: 'Note Analysis' },
  { path: '/licks', icon: LickIcon, label: 'Lick Database' },
  { path: '/solos', icon: SoloIcon, label: 'Solo Database' },
  { path: '/comping', icon: CompingIcon, label: 'Comping Database' },
  { path: '/editor', icon: EditorIcon, label: 'Editor' },
  { path: '/youtube-onset', icon: VideoIcon, label: 'YouTube Onset' },
  { path: '/input', icon: OmrIcon, label: 'OMR' },
  { path: '/admin/omr', icon: OmrMonitorIcon, label: 'OMR 모니터' },
  { path: '/admin/rag', icon: RagIcon, label: 'RAG' },
] as const;

export function AdminToolsDock() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  const [open, setOpen] = useState(false);

  /* 로그인 상태 구독. 로그인 알림에 user 가 비어 오면(부분 payload) 캐시로 보강한다. */
  useEffect(() => onAuthChange((loggedIn, user) => {
    setAuthUser(loggedIn ? (user ?? getCachedUser()) : null);
  }), []);

  /* 라우트가 바뀔 때 캐시에서 다시 읽어 온다.
   *
   * 이 독은 App 루트에 상주하지만, 페이지 이동 중 프로액티브 리프레시나 어떤
   * API 의 일시적 401 로 `onAuthChange(false)` 가 한 번 흐르면 authUser 가
   * null 이 된 채 **다시는 복구되지 않아** 그 뒤로 모든 페이지에서 사라졌다
   * (실측: 홈에서만 보이고 다른 페이지로 가면 없어짐). 진짜 로그아웃은
   * 사용자 캐시까지 지우므로, 캐시가 살아 있으면 세션은 유효한 것으로 보고
   * 되살린다. */
  useEffect(() => {
    if (!authUser) {
      const cached = getCachedUser();
      if (cached) setAuthUser(cached);
    }
  }, [pathname, authUser]);

  if (!isAdminUser(authUser)) return null;

  return (
    <Dock>
      {open && (
        <Panel>
          <PanelHead>
            <span>🛠 Admin 도구</span>
            <HeadClose type="button" onClick={() => setOpen(false)} aria-label="닫기">✕</HeadClose>
          </PanelHead>
          {NAV.map(({ path, icon: Icon, label }) => (
            <Item
              key={path}
              type="button"
              $on={pathname.startsWith(path)}
              onClick={() => navigate(path)}
            >
              <Icon />
              <span>{label}</span>
            </Item>
          ))}
        </Panel>
      )}
      <Fab type="button" $open={open} onClick={() => setOpen((v) => !v)} title="Admin 도구" aria-label="Admin 도구">
        {open ? '✕' : '🛠'}
      </Fab>
    </Dock>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────── */
const Dock = styled.div`
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: ${({ theme }) => theme.zIndex.adminDock};
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;

  /* 좁은 레이아웃에는 같은 자리(bottom 24 · right 20 · 52px)에 MobileChatFab 이
   * 있다. 전역 상주로 바뀌면서 겹치게 됐으므로, 그 위로 올려 나란히 쌓는다
   * (24 + 52 + 14 = 90). 데스크톱에는 채팅 FAB 이 없어 그대로 둔다. */
  ${mq.compactLayout} {
    bottom: 90px;
  }
`;
const Fab = styled.button<{ $open: boolean }>`
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  color: #fff;
  background: ${({ $open }) => ($open ? '#455a64' : '#37474f')};
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s, background 0.15s;
  &:hover { background: ${({ theme }) => theme.colors.inkSurface}; }
  &:active { transform: scale(0.94); }
`;
const Panel = styled.div`
  width: 210px;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const PanelHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
  font-size: 12px;
  font-weight: 800;
  color: #546e7a;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-bottom: 4px;
`;
const HeadClose = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;
const Item = styled.button<{ $on?: boolean }>`
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  text-align: left;
  padding: 8px 9px;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on, theme }) => ($on ? theme.colors.gold : '#37474f')};
  background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.10)' : 'transparent')};
  transition: background 0.1s;
  &:hover { background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.14)' : '#f4f6f8')}; }
`;
