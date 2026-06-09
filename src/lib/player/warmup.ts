import type { GlobalPlayer, PlayerInput } from './types';

/* ─────────────────────────────────────────────────────────────────────────
 * Eager audio warmup.
 *
 * The first time a lick is played, the engine pays the full cost of creating
 * the AudioContext + fetching/decoding the piano/bass/drums + melody-lead
 * sample banks (several MB). That load only kicked off when the user pressed
 * Play (in parallel with the "1 2 3 4" count-in) — so the very first play of a
 * session still stalled after the count-in until the samples finished.
 *
 * `warmupPlayerOnce` lets a lick UI (the Lick Database cards, or a chat lick
 * recommendation) kick that load off at MOUNT instead, while the user is still
 * reading. `preload()` deliberately does NOT resume the AudioContext (that
 * needs a user gesture) — it creates it suspended and decodes samples onto it,
 * so there's no autoplay violation and no sound. By the time the user clicks
 * Play, everything is decoded and playback starts immediately.
 *
 * Guarded so it runs exactly once per session regardless of how many cards
 * mount. All licks share the same rhythm section + piano lead, so a single
 * warmup covers every lick on every surface. On failure the flag resets so a
 * later mount can retry.
 * ──────────────────────────────────────────────────────────────────────── */

let warmed = false;

export function warmupPlayerOnce(player: GlobalPlayer, input: PlayerInput): void {
  if (warmed) return;
  warmed = true;
  void Promise.resolve(player.preload(input)).catch(() => {
    warmed = false; // allow a retry on the next mount
  });
}
