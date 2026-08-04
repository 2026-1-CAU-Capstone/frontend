/* ─────────────────────────────────────────────────────────────────────────
 * themePrefs — 화면 모양(시스템/라이트/다크).
 *
 * 'system' 이면 OS 설정(prefers-color-scheme)을 따라간다. OS 를 바꾸면 앱도
 * 즉시 따라가야 하므로 matchMedia 를 구독한다.
 * ──────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { createPref, oneOf, usePref, type Pref } from './prefsStore';

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = typeof THEME_MODES[number];

export const themeMode: Pref<ThemeMode> =
  createPref('ui.themeMode', 'system', oneOf(THEME_MODES));

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** OS 가 다크인가 — 'system' 모드에서 쓴다. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(DARK_QUERY);
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return dark;
}

/** 지금 다크로 그려야 하는가. ThemeProvider 를 고르는 단일 판단 지점. */
export function useIsDark(): boolean {
  const [mode] = usePref(themeMode);
  const systemDark = useSystemDark();
  return mode === 'dark' || (mode === 'system' && systemDark);
}
