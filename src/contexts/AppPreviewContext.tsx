import { createContext, useContext, type ReactNode } from 'react';
import styled from 'styled-components';
import { isNativeApp } from '../lib/platform';

/* True only inside a /preview/* route. Lets components render their
 * Capacitor-app-only UI from a browser for design review, without affecting
 * the regular /chord, /note, … routes (which stay strictly web). */
const AppPreviewContext = createContext(false);

export function AppPreviewProvider({ children }: { children: ReactNode }) {
  return (
    <AppPreviewContext.Provider value={true}>
      {children}
      <PreviewBadge>앱 프리뷰</PreviewBadge>
    </AppPreviewContext.Provider>
  );
}

export function useInAppPreview(): boolean {
  return useContext(AppPreviewContext);
}

/** Single gate for "render the Capacitor-app-only UI". True when actually
 *  inside the native shell, OR mounted under a /preview/* route. Use this
 *  anywhere you'd otherwise call `isNativeApp()` to render app-only UI. */
export function useIsNativeUi(): boolean {
  const inPreview = useContext(AppPreviewContext);
  return isNativeApp() || inPreview;
}

const PreviewBadge = styled.div`
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 9999;
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
