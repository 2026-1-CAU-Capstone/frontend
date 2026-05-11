/**
 * Offline time-stretching using SoundTouchJS (WSOLA algorithm).
 *
 * Use this when you need to change an AudioBuffer's tempo while preserving
 * pitch (unlike raw playbackRate, which scales both together). The full
 * buffer is processed on the main thread synchronously — for short loops
 * (a few seconds) this finishes in tens of ms; if you ever stretch long
 * material, move this to a Worker.
 */

import {
  SoundTouch,
  SimpleFilter,
  WebAudioBufferSource,
} from 'soundtouchjs';

const BUFFER_SIZE = 4096;

/**
 * Time-stretch an AudioBuffer by `tempoRatio` while preserving pitch.
 *
 * `tempoRatio` semantics match SoundTouchJS:
 *   - 1.0 → no change
 *   - 2.0 → playback is twice as fast (output buffer is ~half as long)
 *   - 0.5 → playback is half as fast (output buffer is ~twice as long)
 *
 * The returned buffer is always 2-channel; if the input is mono, both
 * output channels carry the same data.
 */
export function stretchAudioBuffer(
  ctx: BaseAudioContext,
  input: AudioBuffer,
  tempoRatio: number,
): AudioBuffer {
  // Fast-path: ~no-op at exactly 1.0.
  if (Math.abs(tempoRatio - 1) < 1e-6) {
    const out = ctx.createBuffer(2, input.length, input.sampleRate);
    const inL = input.getChannelData(0);
    const inR = input.numberOfChannels > 1 ? input.getChannelData(1) : inL;
    out.getChannelData(0).set(inL);
    out.getChannelData(1).set(inR);
    return out;
  }

  const source = new WebAudioBufferSource(input);
  const soundtouch = new SoundTouch();
  soundtouch.tempo = tempoRatio;
  soundtouch.rate = 1;
  soundtouch.pitch = 1;
  const filter = new SimpleFilter(source, soundtouch);

  // Allocate generously so we never have to grow mid-loop. SoundTouch output
  // size ≈ inputLen / tempoRatio; we add a few buffers of safety pad.
  const reserved = Math.ceil(input.length / tempoRatio) + BUFFER_SIZE * 4;
  const outL = new Float32Array(reserved);
  const outR = new Float32Array(reserved);
  const interleaved = new Float32Array(BUFFER_SIZE * 2);

  let written = 0;
  for (;;) {
    const remaining = outL.length - written;
    const askFrames = Math.min(BUFFER_SIZE, remaining);
    if (askFrames <= 0) break;
    const framesExtracted = filter.extract(interleaved, askFrames);
    if (framesExtracted === 0) break;
    for (let i = 0; i < framesExtracted; i++) {
      outL[written + i] = interleaved[i * 2];
      outR[written + i] = interleaved[i * 2 + 1];
    }
    written += framesExtracted;
  }

  const finalLen = Math.max(1, written);
  const out = ctx.createBuffer(2, finalLen, input.sampleRate);
  out.getChannelData(0).set(outL.subarray(0, finalLen));
  out.getChannelData(1).set(outR.subarray(0, finalLen));
  return out;
}
