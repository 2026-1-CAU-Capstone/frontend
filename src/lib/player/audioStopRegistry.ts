/* ─────────────────────────────────────────────────────────────────────────
 * audioStopRegistry — process-wide kill switch for every audio engine.
 *
 * Why this exists:
 *   Audio used to keep playing after the user navigated to another page,
 *   the app crashed (render error), or the tab/app was closed/backgrounded.
 *   Each engine (GlobalPlayer, GlobalKeyboard, …) had its own stop path,
 *   and there was no single place the app shell could call to cut sound
 *   immediately.
 *
 * Design:
 *   Engines SELF-REGISTER a stop fn when their module first loads. The app
 *   shell (route-change guard, error boundary, page-hide / app-background
 *   handlers) calls `stopAllAudio()` to fire every registered stopper at
 *   once. Each stopper is expected to be a safe no-op when nothing is
 *   playing.
 *
 *   This module is intentionally ZERO-dependency — it must never import
 *   `smplr` (directly or transitively), so the app shell can import
 *   `stopAllAudio` without pulling the audio stack into the startup chunk.
 *   Engines themselves are only loaded lazily (first play), and they
 *   register at that point.
 * ──────────────────────────────────────────────────────────────────── */

type StopFn = () => void;

const stoppers = new Set<StopFn>();

/**
 * Register an audio engine's stop fn. Returns an unregister handle.
 * Most engines are process-wide singletons and never unregister.
 */
export function registerAudioStopper(fn: StopFn): () => void {
  stoppers.add(fn);
  return () => {
    stoppers.delete(fn);
  };
}

/**
 * Stop every registered audio source immediately. Safe to call anytime —
 * each stopper no-ops if its engine isn't currently active. One stopper
 * throwing never blocks the others.
 */
export function stopAllAudio(): void {
  // Snapshot so a stopper that unregisters during iteration can't mutate
  // the set we're walking.
  for (const fn of [...stoppers]) {
    try {
      fn();
    } catch {
      /* keep stopping the rest */
    }
  }
}
