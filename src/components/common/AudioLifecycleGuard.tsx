import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
// Import the zero-dependency registry directly (not the `lib/player`
// barrel) so this app-root component never drags smplr into the startup
// chunk — mirrors why GlobalPlayerContext imports the lazy proxy directly.
import { stopAllAudio } from '../../lib/player/audioStopRegistry';

/* ─────────────────────────────────────────────────────────────────────────
 * AudioLifecycleGuard — app-level safety net that cuts all audio when the
 * user leaves whatever was playing. Renders nothing.
 *
 * It covers the three cases where sound used to keep playing:
 *   1. Navigating to another page    → stop on every route (pathname) change.
 *   2. Closing / leaving the tab/app → `pagehide` + `visibilitychange`
 *                                      (also fires when an iOS Capacitor app
 *                                      is backgrounded).
 *   3. An uncaught async crash       → `error` / `unhandledrejection`
 *                                      (render-phase crashes are handled by
 *                                      AudioErrorBoundary instead).
 *
 * Pages still stop their own playback on unmount; this is the belt-and-
 * suspenders layer so a single missed cleanup can't leave audio running.
 * ──────────────────────────────────────────────────────────────────── */

export function AudioLifecycleGuard(): null {
  const { pathname } = useLocation();

  // Stop on navigation. Runs once on mount too (harmless no-op when idle).
  useEffect(() => {
    stopAllAudio();
  }, [pathname]);

  // Stop on tab/app exit, background, and uncaught async errors.
  useEffect(() => {
    const onHide = () => stopAllAudio();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopAllAudio();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('error', onHide);
    window.addEventListener('unhandledrejection', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('error', onHide);
      window.removeEventListener('unhandledrejection', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
