/* ─────────────────────────────────────────────────────────────────────────
 * GlobalKeyboard — Shared single-piano singleton for "click to hear"
 * interactions across pages (PianoKeyboard, LeadSheet voicing preview,
 * Lick12KeyPage transpose preview, etc.).
 *
 * Why a singleton:
 *   Six call sites currently each construct their own `new AudioContext()`
 *   plus `createPiano()` from smplrAdapter. That wastes memory/CPU,
 *   breaks sound consistency (each piano warms up independently), and
 *   repeats the first-click load whenever the user navigates pages.
 *   A single shared instance fixes all three.
 *
 * Scope:
 *   - Click-to-hear ONLY. The unified BackingPlayer/GlobalPlayer family
 *     owns the playback timeline and has its own AudioContext per engine
 *     (cross-engine clock alignment with this keyboard is not required —
 *     these are ad-hoc note-on events, not scheduled music).
 *   - Plain module-level singleton, no React context. Callers just
 *     `import { getGlobalKeyboard }` and call methods. We can wrap in a
 *     React Context later if needed for SSR/test isolation.
 *
 * Lifetime:
 *   The AudioContext and SplendidGrandPiano live for the lifetime of the
 *   page. We don't expose a dispose() — pages come and go but the audio
 *   stack should persist.
 * ──────────────────────────────────────────────────────────────────── */

import { createPiano, type SoundfontPlayerLike, type SmplrPlayHandle } from "../note/smplrAdapter";
import { registerAudioStopper } from "./audioStopRegistry";

export interface GlobalKeyboard {
  /** Plays a single note. Returns a handle for early stop, or null if
   *  the piano isn't loaded yet (call `ensureReady()` first in a user
   *  gesture handler to avoid this). */
  play(noteName: string, opts?: { duration?: number; gain?: number }): { stop(): void } | null;
  /** Force initialization. Safe to call repeatedly — subsequent calls
   *  return the same in-flight promise. Call this from a user-gesture
   *  handler (click/touch) so the AudioContext unlocks on iOS Safari. */
  ensureReady(): Promise<void>;
  /** Stop all currently sounding notes on the shared piano. */
  stopAll(): void;
}

/* ─── Module-level state (lazy) ──────────────────────────────────────── */

let _ctx: AudioContext | null = null;
let _piano: SoundfontPlayerLike | null = null;
let _loadPromise: Promise<void> | null = null;
let _instance: GlobalKeyboard | null = null;

/* Join the process-wide audio kill switch the moment this module loads
 * (which only happens once a page actually imports the keyboard, so smplr
 * stays out of the startup chunk). Stable fn; no-ops until the piano has
 * sounded a note. Lets the app shell stop click-to-hear / lick playback on
 * route change, crash, or app exit. */
registerAudioStopper(() => {
  try { _piano?.stop(); } catch { /* */ }
});

function getOrCreateCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  return _ctx;
}

async function loadPiano(): Promise<void> {
  // Idempotent: if a load is already in flight or done, reuse it.
  if (_piano) return;
  if (_loadPromise) return _loadPromise;
  const ctx = getOrCreateCtx();
  _loadPromise = (async () => {
    // Best-effort resume — required on iOS Safari when the first
    // ensureReady() runs inside a user gesture.
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* */ }
    }
    _piano = await createPiano(ctx);
  })();
  return _loadPromise;
}

/* ─── Public surface ─────────────────────────────────────────────────── */

export function getGlobalKeyboard(): GlobalKeyboard {
  if (_instance) return _instance;
  _instance = {
    play(noteName, opts = {}) {
      if (!_piano) {
        // Kick off lazy load so a subsequent click works. We deliberately
        // return null rather than buffering the note — click-to-hear with
        // a delayed first sound is worse than a silent first click.
        void loadPiano();
        return null;
      }
      const when = _ctx ? _ctx.currentTime : 0;
      const handle: SmplrPlayHandle | null = _piano.play(noteName, when, {
        duration: opts.duration,
        gain: opts.gain ?? 1,
      });
      if (!handle) return null;
      return {
        stop() {
          try { handle.stop(); } catch { /* already stopped */ }
        },
      };
    },
    ensureReady() {
      return loadPiano();
    },
    stopAll() {
      try { _piano?.stop(); } catch { /* */ }
    },
  };
  return _instance;
}
