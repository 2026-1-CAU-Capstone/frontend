/**
 * AnacrusisPlayer — minimal standalone-note player for pickup (anacrusis)
 * notes that must sound DURING the count-in, before the main transport
 * starts.
 *
 * Why a dedicated class (instead of reusing the full melody player):
 *   The legacy NotePlayer shipped a measure timeline, drum loop, comp + bass voicings,
 *   swing math, and a callback bus — none of which the anacrusis path
 *   uses. The legacy code path created a full player just to fire
 *   one or two standalone piano notes, wasting an AudioContext, a reverb
 *   bus, and the drum/comp/bass instrument loads. This class is the
 *   minimum: a piano voice on top of an AudioContext, with schedule /
 *   cancel / dispose hooks that mirror the legacy player surface
 *   GlobalPlayer already calls into.
 *
 * Scope:
 *   - One smplr piano (createPiano) routed to `opts.destination ?? ctx.destination`.
 *   - schedule one note at a future AudioContext time, with a duration and gain.
 *   - cancel all pending notes.
 *   - report ctx.currentTime so the caller can align scheduling.
 *
 * Non-goals: drums, comp, bass, measure callbacks, swing, reverb.
 */

import type { SoundfontPlayerLike, SmplrPlayHandle } from '../note/smplrAdapter';
import { createPiano } from '../note/smplrAdapter';

export class AnacrusisPlayer {
  private ctx: AudioContext;
  private destination: AudioNode;
  private piano: SoundfontPlayerLike | null = null;
  /** Loaded-or-loading piano. Resolved once; reused across preload() calls. */
  private loadPromise: Promise<SoundfontPlayerLike> | null = null;
  /** Live note handles for cancelStandaloneNotes(). */
  private handles: Set<SmplrPlayHandle> = new Set();
  /** Surface compatibility: GlobalPlayer assigns a drum-kit-error forwarder
   *  onto the anacrusis player. AnacrusisPlayer has no drum kit, so this is
   *  a no-op slot — kept only so the existing assignment type-checks. */
  onDrumKitError: ((msg: string | null) => void) | null = null;

  constructor(ctx: AudioContext, opts?: { destination?: AudioNode }) {
    this.ctx = ctx;
    this.destination = opts?.destination ?? ctx.destination;
  }

  /** Load the piano sample. Idempotent — second call returns the same
   *  promise. Callers SHOULD await this before scheduleStandaloneNote(),
   *  otherwise the first scheduled note may be dropped (piano is null
   *  until the smplr `load` promise resolves). */
  async preload(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = createPiano(this.ctx, this.destination);
    }
    this.piano = await this.loadPromise;
  }

  /** AudioContext clock — same semantics as the legacy `ctxNow()`. */
  ctxNow(): number {
    return this.ctx.currentTime;
  }

  /** The AudioContext this player schedules on. GlobalPlayer compares it to
   *  the active BackingPlayer's ctx to detect the "same engine instance but
   *  internally-recreated (poisoned→new) ctx" stale case. */
  getCtx(): AudioContext {
    return this.ctx;
  }

  /** Fire a single piano note at audio time `when` (this player's ctx clock).
   *  Silently drops the note if the piano hasn't finished loading yet —
   *  matches the legacy `scheduleStandaloneNote`'s `if (!this.melodyInst) return`
   *  contract. `gain` defaults to 2.5 — same scale as the legacy default
   *  (`2.5 * melodyVolume`) so anacrusis notes match melody-default loudness. */
  scheduleStandaloneNote(midi: number, when: number, durationSec: number, gain: number = 2.5): void {
    if (!this.piano) return;
    // smplrAdapter parses numeric strings → midi number; gain → velocity is
    // handled by gainToVelocity (gain * 32, clamped 0..127) inside the adapter.
    const handle = this.piano.play(String(midi), when, { duration: durationSec, gain });
    if (handle) this.handles.add(handle);
  }

  /** Stop any still-pending notes. Tolerates already-stopped handles. */
  cancelStandaloneNotes(): void {
    for (const h of this.handles) {
      try { h.stop(); } catch { /* already stopped */ }
    }
    this.handles.clear();
  }

  /** Stop pending notes and drop the instrument reference. Does NOT close
   *  the AudioContext — the ctx is owned by the caller. */
  dispose(): void {
    this.cancelStandaloneNotes();
    this.piano = null;
    this.loadPromise = null;
  }
}
