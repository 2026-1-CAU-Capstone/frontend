/* ─────────────────────────────────────────────────────────────────────────
 * Synthetic "small jazz club" convolution reverb.
 *
 * Builds an impulse response procedurally (no external IR file needed):
 *   - Stereo decaying noise with slight L/R variation for width
 *   - ~1.2s decay time — short enough to stay out of the way, long enough
 *     to give the ride cymbal and piano chords a sense of space
 *   - High-frequency roll-off so cymbals don't get harsh
 *
 * Exposes createReverbBus() which returns wet/dry nodes you can route any
 * instrument through. Typical usage:
 *
 *   const reverb = createReverbBus(ctx);
 *   instrument.connect(reverb.dry);          // dry path straight through
 *   const send = ctx.createGain();
 *   send.gain.value = 0.25;                   // 25% wet send
 *   instrument.connect(send).connect(reverb.wet);
 * ──────────────────────────────────────────────────────────────────────── */

export interface ReverbBus {
  /** Dry input — passes straight through to destination. */
  dry: GainNode;
  /** Wet input — feeds the convolver, then to destination. */
  wet: GainNode;
  /** Final output node (already connected to destination). */
  output: GainNode;
}

export function createReverbBus(ctx: AudioContext, destination?: AudioNode): ReverbBus {
  const output = ctx.createGain();
  output.gain.value = 1.0;
  output.connect(destination ?? ctx.destination);

  // Dry path
  const dry = ctx.createGain();
  dry.gain.value = 1.0;
  dry.connect(output);

  // Wet path: gain → convolver (+tone shaping) → wet level → output
  const wet = ctx.createGain();
  wet.gain.value = 1.0;

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulseResponse(ctx, 1.2, 2.8);

  // High-frequency roll-off to keep cymbal reverb dark and jazzy
  const tone = ctx.createBiquadFilter();
  tone.type = "highshelf";
  tone.frequency.value = 4000;
  tone.gain.value = -6;

  // Final wet level — how loud the reverb is overall
  const wetLevel = ctx.createGain();
  wetLevel.gain.value = 0.35;

  wet.connect(convolver).connect(tone).connect(wetLevel).connect(output);

  return { dry, wet, output };
}

/**
 * Generate a stereo exponential-decay noise impulse response.
 * @param durationSec — total length (and roughly the RT60)
 * @param decayShape — higher = tighter decay
 */
function buildImpulseResponse(
  ctx: AudioContext,
  durationSec: number,
  decayShape: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const buffer = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // White noise, slightly decorrelated per channel for stereo width
      const noise = Math.random() * 2 - 1;
      // Exponential decay envelope
      const env = Math.pow(1 - i / length, decayShape);
      // Skip the first ~10ms so the reverb has a pre-delay feel
      const preDelay = i < rate * 0.01 ? 0 : 1;
      data[i] = noise * env * preDelay;
    }
  }

  return buffer;
}
