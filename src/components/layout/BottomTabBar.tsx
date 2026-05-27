import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useIsNativeUi } from '../../contexts/AppPreviewContext';

/* ─────────────────────────────────────────────────────────────────────────
 * 5-tab bottom navigation for the Capacitor iOS/iPad app (and the
 * /preview/* browser preview). Hidden on plain web.
 *
 *   홈   |   내 코드 차트   |   내 악보 차트   |   릭 연습하기   |   마이
 *
 * Anchored to the screen bottom with safe-area padding. Globally mounted in
 * App.tsx so it persists across navigations.
 * ──────────────────────────────────────────────────────────────────────── */

interface Tab {
  path: string;
  /** Extra paths that should also light this tab up (sub-routes). */
  matchPrefixes?: string[];
  label: string;
  icon: (active: boolean) => ReactElement;
}

const TABS: Tab[] = [
  { path: '/', label: '홈', icon: HomeIcon },
  { path: '/my-charts', label: '내 코드 차트', icon: ChartsIcon, matchPrefixes: ['/my-charts', '/mychord'] },
  { path: '/my-licks', label: '내 악보 차트', icon: SheetIcon, matchPrefixes: ['/my-licks', '/note'] },
  { path: '/licks', label: '릭 연습하기', icon: PracticeIcon, matchPrefixes: ['/licks', '/lick-practice'] },
  { path: '/login', label: '마이', icon: PersonIcon },
];

export function BottomTabBar() {
  const isNativeUi = useIsNativeUi();
  const navigate = useNavigate();
  const loc = useLocation();
  if (!isNativeUi) return null;

  /* Hide the bar on full-screen flows where it would just get in the way:
   * editor, lick practice playback, the marketing intro. */
  const path = loc.pathname;
  if (path.startsWith('/editor') || path.startsWith('/lick-practice') || path.startsWith('/intro')) {
    return null;
  }

  const isActive = (t: Tab): boolean => {
    if (t.matchPrefixes) {
      return t.matchPrefixes.some((p) => (p === '/' ? path === '/' : path.startsWith(p)));
    }
    return t.path === '/' ? path === '/' : path.startsWith(t.path);
  };

  return (
    <Bar>
      {TABS.map((t) => {
        const active = isActive(t);
        return (
          <TabBtn key={t.path} type="button" $active={active} onClick={() => navigate(t.path)}>
            {t.icon(active)}
            <Label $active={active}>{t.label}</Label>
          </TabBtn>
        );
      })}
    </Bar>
  );
}

/* ── icons (Lucide-style) ───────────────────────────────────────────── */

function HomeIcon(active: boolean) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

function ChartsIcon(active: boolean) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SheetIcon(active: boolean) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

function PracticeIcon(active: boolean) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6,3 21,12 6,21" />
    </svg>
  );
}

function PersonIcon(active: boolean) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/* ── styled ──────────────────────────────────────────────────────────── */

const Bar = styled.nav`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  align-items: stretch;
  background: #ffffff;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.04);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: 'Pretendard', sans-serif;
`;

const TabBtn = styled.button<{ $active?: boolean }>`
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px 6px;
  border: none;
  background: transparent;
  color: ${({ $active }) => ($active ? '#111' : '#9a9a9a')};
  cursor: pointer;
  transition: color 0.15s;

  &:active { opacity: 0.55; }
`;

const Label = styled.span<{ $active?: boolean }>`
  font-size: 0.74rem;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;
