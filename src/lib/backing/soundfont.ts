import { SplendidGrandPiano, Soundfont } from "smplr";
import { loadSampledDrumKit } from "./sampledDrumKit";
import { createReverbBus } from "./reverb";

/* ─────────────────────────────────────────────────────────────────────────
 * Sample-based instrument loading via the smplr library.
 *
 * Upgrades from Phase 0:
 *   - piano:  soundfont-player acoustic_grand_piano  →  smplr SplendidGrandPiano
 *             (Salamander grand, proper velocity layers, much less synthetic)
 *   - bass:   soundfont-player acoustic_bass         →  smplr Soundfont acoustic_bass
 *             (same gleitz samples but unified smplr API; Smolken was tried
 *             first but its ~50 parallel sample fetches get 503'd by GitHub
 *             Pages throttling, so we use the single-bundle soundfont instead)
 *   - drums:  SimpleDrumSynth (Web Audio synthesis)  →  custom SampledDrumKit
 *             (acoustic kick/snare/hihat/tom fetched from Tone.js acoustic
 *             drum pack, plus smpldsnds Casio-RZ1 ride/crash because no
 *             acoustic kit in the public catalog ships a ride cymbal.
 *             Further improvement = bundle dedicated jazz samples.)
 *
 * All three expose a unified `trigger()` method with a common signature so
 * player.ts can dispatch events without branching on instrument type. This
 * isolates the smplr-specific details (start() + MIDI velocity scale + drum
 * sample-name map) inside this file.
 * ──────────────────────────────────────────────────────────────────────── */

import type { NoteEvent } from "smplr";

/** Simplified trigger signature consumed by player.ts. */
export interface TriggerableInstrument {
  trigger(params: {
    /** MIDI note number (piano/bass) or drum piece name (drums). */
    note: number | string;
    /** Absolute AudioContext time in seconds. */
    time: number;
    /** Duration in seconds (piano/bass). Drums ignore this. */
    duration: number;
    /** 0..1 gain; converted to MIDI velocity internally. */
    velocity: number;
  }): void;
  stopAll(): void;
}

export interface BackingInstruments {
  piano: TriggerableInstrument;
  bass: TriggerableInstrument;
  drums: TriggerableInstrument;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

/** Convert 0..1 gain to MIDI velocity (1..127). */
function toMidiVelocity(gain: number): number {
  return Math.max(1, Math.min(127, Math.round(gain * 127)));
}

/* ─── pitched instrument (piano, bass) wrapper ───────────────────────── */

interface PitchedSampler {
  start(ev: NoteEvent): unknown;
  stop(target?: unknown): void;
}

function wrapPitched(inst: PitchedSampler, gainMultiplier = 1.0): TriggerableInstrument {
  return {
    trigger({ note, time, duration, velocity }) {
      if (typeof note !== "number") return;
      const midiVel = toMidiVelocity(velocity * gainMultiplier);
      if (midiVel < 1) return;
      inst.start({
        note,
        time,
        duration,
        velocity: midiVel,
      });
    },
    stopAll() {
      inst.stop();
    },
  };
}

/* ─── loader ─────────────────────────────────────────────────────────── */

export async function loadInstruments(ctx: AudioContext): Promise<BackingInstruments> {
  /* Signal flow
   * ──────────────────────────────────────────────────────────────────
   *  piano  ──┬──(dry)──► reverb.dry  ──┐
   *           └──(send)─► reverb.wet  ──┤
   *  drums  ──┬──(dry)──► reverb.dry  ──┤
   *           └──(send)─► reverb.wet  ──┼─► reverb.output ─► destination
   *  bass   ───── bassAmp ─────────────►┘    (bass stays mostly dry —
   *                                           we don't send it to verb)
   * ────────────────────────────────────────────────────────────────── */

  const reverb = createReverbBus(ctx);

  // Piano routing: dry straight through reverb bus, plus a wet send
  const pianoAmp = ctx.createGain();
  pianoAmp.gain.value = 1.0;
  pianoAmp.connect(reverb.dry);

  const pianoSend = ctx.createGain();
  pianoSend.gain.value = 0.22;
  pianoAmp.connect(pianoSend);
  pianoSend.connect(reverb.wet);

  // Drum routing: same dry + send pattern
  const drumAmp = ctx.createGain();
  drumAmp.gain.value = 1.0;
  drumAmp.connect(reverb.dry);

  const drumSend = ctx.createGain();
  drumSend.gain.value = 0.28;
  drumAmp.connect(drumSend);
  drumSend.connect(reverb.wet);

  // Bass: push above the MIDI velocity ceiling via a dedicated amp. Bass
  // bypasses reverb to stay tight and present in the mix (jazz bass is
  // almost always dry).
  const bassAmp = ctx.createGain();
  bassAmp.gain.value = 3.2;
  bassAmp.connect(ctx.destination);

  const piano = new SplendidGrandPiano(ctx, { destination: pianoAmp });
  const bass = new Soundfont(ctx, {
    instrument: "acoustic_bass",
    kit: "FluidR3_GM",
    destination: bassAmp,
  });

  const [, , drums] = await Promise.all([
    piano.load,
    bass.load,
    loadSampledDrumKit(ctx, drumAmp),
  ]);

  return {
    piano: wrapPitched(piano, 1.0),
    bass: wrapPitched(bass, 1.0),
    drums,
  };
}
