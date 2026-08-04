import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { isNativeApp } from '../lib/platform';
import { BP } from '../styles/theme';

/* True only when the current URL is under /preview/*. Lets components render
 * their Capacitor-app-only UI from a browser for design review, without
 * affecting the regular /chord, /note, … routes (which stay strictly web).
 *
 * Mount this provider once at the app root (inside the Router so useLocation
 * works) — it reads the current pathname so the value is reactive to
 * navigation and visible from globally-mounted components like the bottom
 * tab bar. */
const AppPreviewContext = createContext(false);

export function AppPreviewProvider({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const inPreview = loc.pathname.startsWith('/preview');
  return (
    <AppPreviewContext.Provider value={inPreview}>
      {children}
      {inPreview && <PreviewBadge>앱 프리뷰</PreviewBadge>}
    </AppPreviewContext.Provider>
  );
}

export function useInAppPreview(): boolean {
  return useContext(AppPreviewContext);
}

/* 모바일 웹도 앱과 같은 셸을 쓴다 (2026-08-04).
 *
 * 종전 설계(기능명세 F14.11 ②)는 "모바일 웹 = 데스크톱 웹의 반응형" 이었다.
 * 그런데 실제로는 반응형이 아니라 **데스크톱 셸이 그대로 잘려서** 사이드바가
 * 화면을 먹고 본문이 밖으로 넘어갔다. 그래서 앱 셸을 함께 쓰도록 뒤집었다.
 *
 * 조건은 **터치 && 좁은 화면** 둘 다다. `useCompactLayout` 은 OR 조건이라
 * (좁은 데스크톱 창도 매칭) 이 게이트로는 못 쓴다 — 마우스로 창만 줄였을 때
 * 앱 셸로 바뀌면 그게 더 이상하다. */
const MOBILE_WEB_SHELL_QUERY = `(pointer: coarse) and (max-width: ${BP.tablet}px)`;

function useMobileWebShell(): boolean {
  const [on, setOn] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(MOBILE_WEB_SHELL_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_WEB_SHELL_QUERY);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return on;
}

/** Single gate for "render the Capacitor-app-only UI". True when actually
 *  inside the native shell, mounted under a /preview/* route, OR viewed on a
 *  touch phone/tablet browser. Use this anywhere you'd otherwise call
 *  `isNativeApp()` to render app-only UI. */
export function useIsNativeUi(): boolean {
  const inPreview = useContext(AppPreviewContext);
  const mobileWeb = useMobileWebShell();
  return isNativeApp() || inPreview || mobileWeb;
}

const PreviewBadge = styled.div`
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: ${({ theme }) => theme.zIndex.max};
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(28, 100, 242, 0.92);
  color: #fff;
  font-family: 'Pretendard', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  pointer-events: none;
`;
