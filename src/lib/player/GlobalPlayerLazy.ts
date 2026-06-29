/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayerLazy — Deferred-loading proxy for the unified player.
 *
 * Why this exists:
 *   `./GlobalPlayer` transitively imports `smplr` (via soundfont loaders).
 *   Importing it at app boot pulls smplr into a chunk that the main
 *   bundle eagerly fetches. This module is a tiny zero-dependency proxy
 *   that exposes the same `GlobalPlayer` surface synchronously but only
 *   dynamic-imports `./GlobalPlayer` (and therefore smplr) when a method
 *   that actually needs audio is first called.
 *
 * Behavior contract:
 *   • `on(ev, cb)` is fully synchronous and returns a working unsubscribe
 *     fn — subscribers attached before load are replayed onto the real
 *     player once it materializes.
 *   • `preload()` / `play()` / `scheduleAnacrusis()` trigger the dynamic
 *     import and await it before delegating.
 *   • Sync no-arg controls (`pause`, `stop`, `cancelAnacrusis`,
 *     `seekToMeasure`, `dispose`) are no-ops before the real player has
 *     been created — there's nothing playing to pause/stop yet.
 *   • `setConfig()` stores the patch locally so it survives across the
 *     load boundary, and forwards once the real player exists.
 *   • `ctxNow()` returns 0 before load (matches the existing fallback
 *     in createGlobalPlayer).
 *   • `playing` / `currentInput` mirror the real player when present,
 *     otherwise `false` / `null`.
 *
 * Not a runtime dependency for tests:
 *   Tests can still import `createGlobalPlayer` from `./GlobalPlayer`
 *   directly. This proxy is only used by the React provider's default
 *   singleton path.
 * ──────────────────────────────────────────────────────────────────── */

import type {
  AnacrusisNote,
  GlobalPlayer,
  GlobalPlayerConfig,
  GlobalPlayerEvents,
  PlayerInput,
} from "./types";

type EventKey = keyof GlobalPlayerEvents;

/** Pending subscription recorded before the real player exists. */
interface PendingSub<K extends EventKey> {
  ev: K;
  cb: GlobalPlayerEvents[K];
  /** Live unsubscribe handle once the real player wires it up. */
  unsub?: () => void;
  /** Set to true if the consumer unsubscribed before load completed. */
  cancelled: boolean;
}

function createLazyGlobalPlayer(): GlobalPlayer {
  // Cached promise so concurrent callers share one dynamic import.
  let realPromise: Promise<GlobalPlayer> | null = null;
  let real: GlobalPlayer | null = null;

  // Pending state captured before the real player exists.
  const pendingSubs: PendingSub<EventKey>[] = [];
  let configMirror: GlobalPlayerConfig = {};

  async function load(): Promise<GlobalPlayer> {
    if (real) return real;
    if (!realPromise) {
      realPromise = import("./GlobalPlayer").then((mod) => {
        const r = mod.getGlobalPlayerSingleton();
        // Apply any config patches accumulated before load.
        if (Object.keys(configMirror).length > 0) {
          r.setConfig(configMirror);
        }
        // Replay pending subscriptions onto the real player.
        for (const sub of pendingSubs) {
          if (sub.cancelled) continue;
          sub.unsub = r.on(sub.ev, sub.cb);
        }
        real = r;
        return r;
      });
    }
    return realPromise;
  }

  return {
    get playing() {
      return real?.playing ?? false;
    },
    get currentInput() {
      return real?.currentInput ?? null;
    },

    async preload(input: PlayerInput): Promise<void> {
      const r = await load();
      return r.preload(input);
    },

    isReady(input: PlayerInput): boolean {
      // Before the real player (and smplr) loads there's nothing ready — the
      // page treats this as cold and shows "준비 중…" while preload() loads.
      return real?.isReady(input) ?? false;
    },

    unlock(input: PlayerInput): void {
      // Must stay SYNCHRONOUS to keep the ctx.resume() inside the user gesture.
      // By the time a page calls unlock() (play-button click) its mount-time
      // preload() has already materialized the real player, so `real` is set.
      // If it somehow isn't, kick off the load so the *next* play is warm —
      // this first one falls back to play()'s own (late) resume.
      if (real) real.unlock(input);
      else void load();
    },

    async play(
      input: PlayerInput,
      opts?: { startAt?: number; measureOffset?: number; downbeatInSec?: number },
    ): Promise<void> {
      const r = await load();
      return r.play(input, opts);
    },

    pause(): void {
      real?.pause();
    },

    stop(): void {
      real?.stop();
    },

    seekToMeasure(mi: number): void {
      real?.seekToMeasure(mi);
    },

    setConfig(patch: Partial<GlobalPlayerConfig>): void {
      configMirror = { ...configMirror, ...patch };
      real?.setConfig(patch);
    },

    getConfig(): GlobalPlayerConfig {
      return real ? real.getConfig() : { ...configMirror };
    },

    ctxNow(): number {
      return real?.ctxNow() ?? 0;
    },

    scheduleAnacrusis(notes: AnacrusisNote[]): void {
      if (notes.length === 0) return;
      if (real) {
        real.scheduleAnacrusis(notes);
        return;
      }
      // Anacrusis schedule times are in AudioContext time and only meaningful
      // once a real engine + ctx exist. Before load, our `ctxNow()` returns
      // 0 — so callers computed `startAt = 0 + offsetSec`. After load, the
      // real ctx has advanced past 0, so we shift every startAt by the real
      // ctx's currentTime to preserve the intended "offsetSec from now"
      // semantics.
      load()
        .then((r) => {
          const now = r.ctxNow();
          const shifted = notes.map((n) => ({ ...n, startAt: n.startAt + now }));
          r.scheduleAnacrusis(shifted);
        })
        .catch(() => {
          /* error already surfaced through the real player's error bus */
        });
    },

    cancelAnacrusis(): void {
      real?.cancelAnacrusis();
    },

    on<K extends EventKey>(
      ev: K,
      cb: GlobalPlayerEvents[K],
    ): () => void {
      if (real) {
        return real.on(ev, cb);
      }
      const sub: PendingSub<K> = { ev, cb, cancelled: false };
      pendingSubs.push(sub as PendingSub<EventKey>);
      return () => {
        sub.cancelled = true;
        if (sub.unsub) {
          sub.unsub();
          sub.unsub = undefined;
        }
      };
    },

    dispose(): void {
      // Clear pending state so a fresh singleton can be built later.
      for (const sub of pendingSubs) {
        sub.cancelled = true;
        sub.unsub?.();
      }
      pendingSubs.length = 0;
      configMirror = {};
      real?.dispose();
      real = null;
      realPromise = null;
    },
  };
}

/* ─── Lazy singleton (mirrors getGlobalPlayerSingleton's lifetime) ───── */

let _lazySingleton: GlobalPlayer | null = null;

/**
 * Process-wide lazy proxy singleton. Returned synchronously; the real
 * underlying player (and its smplr dependency) is only fetched on the
 * first method call that needs audio.
 */
export function getLazyGlobalPlayerSingleton(): GlobalPlayer {
  if (!_lazySingleton) _lazySingleton = createLazyGlobalPlayer();
  return _lazySingleton;
}

export function disposeLazyGlobalPlayerSingleton(): void {
  _lazySingleton?.dispose();
  _lazySingleton = null;
}
