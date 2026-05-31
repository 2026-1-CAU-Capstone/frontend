/**
 * Thin compatibility wrapper that lets legacy callers keep their soundfont-player
 * call surface (`inst.play(noteName, when, { duration, gain })`) while we swap
 * the underlying sample library to `smplr` (same author, newer library, higher
 * quality MusyngKite samples + SplendidGrandPiano velocity layers).
 *
 * Why an adapter instead of a full rewrite of notePlayer.ts:
 *   - notePlayer.ts has ~15 call sites that pass `inst.play()` results around
 *     and call `.stop()` on the returned handles. Rewriting them is bigger
 *     surface than a thin shim.
 *   - smplr's `start({ note, time, duration, velocity })` returns a stop fn —
 *     we just need to wrap it so legacy `.stop()`-on-node code keeps working.
 *
 * Gain → velocity mapping: soundfont-player's `gain` was a free-floating
 * multiplier (often 1.0–2.5). smplr's `velocity` is MIDI 0–127 and controls
 * both sample selection (velocity layers) and amplitude. We map gain × 32 to
 * velocity, so gain=1 → vel≈32 (soft), gain=2.5 → vel≈80 (medium-loud),
 * gain≈4 → vel=127 (full). Clamped to 0–127.
 */

import { Soundfont, SplendidGrandPiano } from 'smplr';

export interface SoundfontPlayerLike {
  play(
    noteName: string,
    when: number,
    opts: { duration?: number; gain?: number },
  ): SmplrPlayHandle | null;
  /** Stop all currently-sounding notes on this instrument immediately. */
  stop(): void;
}

export interface SmplrPlayHandle {
  /** Mirrors AudioBufferSourceNode.stop() — schedules note off. */
  stop(when?: number): void;
}

interface SmplrInstrument {
  load: Promise<unknown>;
  start(opts: {
    note: number | string;
    time?: number;
    duration?: number;
    velocity?: number;
  }): () => void;
  /** Stop ALL currently sounding notes. Used as a fallback when stop(when)
   *  is called without a specific stopId. */
  stop(): void;
}

function gainToVelocity(gain: number): number {
  return Math.round(Math.max(0, Math.min(127, gain * 32)));
}

async function wrap(inst: SmplrInstrument): Promise<SoundfontPlayerLike> {
  await inst.load;
  return {
    play(noteName, when, opts) {
      const gain = opts.gain ?? 1;
      const velocity = gainToVelocity(gain);
      const parsed = parseInt(noteName, 10);
      const note: number | string = Number.isNaN(parsed) ? noteName : parsed;
      const stopFn = inst.start({ note, time: when, duration: opts.duration, velocity });
      return {
        stop() {
          try {
            stopFn();
          } catch {
            /* already stopped */
          }
        },
      };
    },
    stop() {
      try {
        inst.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Concert-grand piano via smplr's SplendidGrandPiano (multi-velocity-layer
 *  recording). Replaces gleitz/midi-js-soundfonts acoustic_grand_piano.
 *  `destination` lets the caller route through a reverb/eq chain (legacy melody
 *  routes melody+comp through pianoAmp → reverb send). */
export function createPiano(ctx: AudioContext, destination?: AudioNode): Promise<SoundfontPlayerLike> {
  const opts: { destination?: AudioNode } = destination ? { destination } : {};
  return wrap(new SplendidGrandPiano(ctx, opts) as unknown as SmplrInstrument);
}

/** Acoustic upright bass via smplr's MusyngKite kit (higher quality than
 *  FluidR3_GM — richer low end, better attack for jazz walking lines). */
export function createBass(ctx: AudioContext, destination?: AudioNode): Promise<SoundfontPlayerLike> {
  return wrap(
    new Soundfont(ctx, {
      instrument: 'acoustic_bass',
      kit: 'MusyngKite',
      ...(destination ? { destination } : {}),
    }) as unknown as SmplrInstrument,
  );
}
