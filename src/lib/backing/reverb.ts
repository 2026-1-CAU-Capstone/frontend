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
  // Slightly longer, smoother tail + more pre-delay = a more realistic "real
  // room" bloom (less synthetic) so the sampled instruments sit in a space
  // rather than sounding dry/MIDI. (was 2.0s / shape 2.2 / 10ms pre-delay.)
  convolver.buffer = buildImpulseResponse(ctx, 2.6, 1.9, 0.018);

  // High-frequency roll-off to keep cymbal reverb dark and jazzy. A touch
  // warmer (lower corner, deeper cut) so the tail doesn't add fizz.
  const tone = ctx.createBiquadFilter();
  tone.type = "highshelf";
  tone.frequency.value = 3500;
  tone.gain.value = -7;

  // Final wet level — how loud the reverb is overall. Bumped from 0.35 so the
  // piano send (~0.45 by default) gives a clearly audible room without needing
  // the user to crank the slider.
  const wetLevel = ctx.createGain();
  wetLevel.gain.value = 0.6;

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
  preDelaySec = 0.01,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelaySamples = rate * preDelaySec;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // White noise, slightly decorrelated per channel for stereo width
      const noise = Math.random() * 2 - 1;
      // Exponential decay envelope
      const env = Math.pow(1 - i / length, decayShape);
      // Pre-delay gap before the tail starts — gives the room depth/clarity.
      const gate = i < preDelaySamples ? 0 : 1;
      data[i] = noise * env * gate;
    }
  }

  return buffer;
}
