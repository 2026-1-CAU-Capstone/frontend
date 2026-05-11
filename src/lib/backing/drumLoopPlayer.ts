/* ─────────────────────────────────────────────────────────────────────────
 * Drum-loop player — plays a continuous real-recording drum loop, time-
 * stretched offline so the BPM matches the player exactly while the pitch
 * stays at its original value. (Raw playbackRate would shift pitch as a
 * side effect; for piano/bass to stay in tune the drums must be detached
 * from that.)
 *
 * Used when BackingConfig.drumLoop is set. The loop file should be musically
 * loopable (length = integer bars at the recorded BPM), so the pre-stretched
 * buffer also loops cleanly via AudioBufferSourceNode.loop.
 * ──────────────────────────────────────────────────────────────────────── */

import { stretchAudioBuffer } from './timeStretch';

export interface DrumLoopConfig {
  /** Public URL of the loop audio file (wav/mp3). */
  url: string;
  /** Tempo the loop was recorded at, in BPM. */
  recordedBpm: number;
  /** Linear gain (0..2). Default 1. */
  gain?: number;
}

export interface DrumLoopPlayer {
  /** Begin loop playback at `originTime` (AudioContext time, sec). The buffer
   *  is time-stretched (offline, pitch-preserving) to match `targetBpm`. */
  start(originTime: number, targetBpm: number): void;
  /** Update gain in real time. */
  setGain(gain: number): void;
  /** Stop any active loop nodes. Idempotent. */
  stop(): void;
  dispose(): void;
}

/** Load a drum loop and return a player. Throws if the URL is unreachable. */
export async function loadDrumLoopPlayer(
  ctx: AudioContext,
  destination: AudioNode,
  cfg: DrumLoopConfig,
): Promise<DrumLoopPlayer> {
  const res = await fetch(cfg.url);
  if (!res.ok) throw new Error(`drum loop fetch failed: ${res.status} ${cfg.url}`);
  const arr = await res.arrayBuffer();
  const original = await ctx.decodeAudioData(arr);

  const bus = ctx.createGain();
  bus.gain.value = cfg.gain ?? 1;
  bus.connect(destination);

  let active: AudioBufferSourceNode | null = null;
  // Cache the stretched buffer keyed by the BPM it was generated for — re-using
  // it avoids re-running SoundTouch when the user toggles play/stop at the
  // same tempo.
  let cachedBpm: number | null = null;
  let cachedBuffer: AudioBuffer | null = null;

  function getBufferForBpm(targetBpm: number): AudioBuffer {
    if (cachedBpm === targetBpm && cachedBuffer) return cachedBuffer;
    const tempoRatio = targetBpm / cfg.recordedBpm;
    cachedBuffer = stretchAudioBuffer(ctx, original, tempoRatio);
    cachedBpm = targetBpm;
    return cachedBuffer;
  }

  function stopActive() {
    if (!active) return;
    try { active.stop(); } catch { /* already stopped */ }
    try { active.disconnect(); } catch { /* noop */ }
    active = null;
  }

  return {
    start(originTime, targetBpm) {
      stopActive();
      const buffer = getBufferForBpm(targetBpm);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buffer.duration;
      src.playbackRate.value = 1;
      src.connect(bus);
      const startAt = Math.max(originTime, ctx.currentTime + 0.005);
      src.start(startAt);
      active = src;
    },
    setGain(g) {
      bus.gain.value = g;
    },
    stop: stopActive,
    dispose() {
      stopActive();
      try { bus.disconnect(); } catch { /* noop */ }
      cachedBuffer = null;
      cachedBpm = null;
    },
  };
}
