/* ─────────────────────────────────────────────────────────────────────────
 * Drum-loop player — replaces per-hit drum scheduling with a continuous
 * real-recording loop (e.g. a live jazz drummer playing swing on a ride
 * cymbal with room ambience).
 *
 * Used when BackingConfig.drumLoop is set. The loop's recorded BPM is
 * scaled to the playback BPM via `playbackRate`; pitch shifts as a side
 * effect (acceptable within the ±15% range a typical jazz tempo spans).
 *
 * The loop file is *expected to be musically loopable* — measured so that
 * one period equals an integer number of bars at the recorded BPM.
 * If the bar boundaries drift over many bars, the buffer-source's
 * `loop = true` repeats seamlessly because we set `loopStart`/`loopEnd`
 * exactly to the buffer endpoints.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DrumLoopConfig {
  /** Public URL of the loop audio file (wav/mp3). */
  url: string;
  /** Tempo the loop was recorded at, in BPM. */
  recordedBpm: number;
  /** Linear gain (0..2). Default 1. */
  gain?: number;
  /**
   * Max playbackRate deviation from 1.0 — clamps pitch shift to a tolerable
   * range. Default 0.15 (±15%).
   */
  maxRateDeviation?: number;
}

export interface DrumLoopPlayer {
  /** Begin loop playback at `originTime` (AudioContext time, sec). */
  start(originTime: number, targetBpm: number): void;
  /** Stop any active loop nodes. Idempotent. */
  stop(): void;
  /** Update gain in real time. */
  setGain(gain: number): void;
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
  const buffer = await ctx.decodeAudioData(arr);

  const bus = ctx.createGain();
  bus.gain.value = cfg.gain ?? 1;
  bus.connect(destination);

  const maxDev = cfg.maxRateDeviation ?? 0.15;
  let active: AudioBufferSourceNode | null = null;

  function stopActive() {
    if (!active) return;
    try { active.stop(); } catch { /* already stopped */ }
    try { active.disconnect(); } catch { /* noop */ }
    active = null;
  }

  return {
    start(originTime, targetBpm) {
      stopActive();
      const ratio = targetBpm / cfg.recordedBpm;
      const clamped = Math.max(1 - maxDev, Math.min(1 + maxDev, ratio));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buffer.duration;
      src.playbackRate.value = clamped;
      src.connect(bus);
      // Schedule slightly into the future to avoid context-time underrun
      const startAt = Math.max(originTime, ctx.currentTime + 0.005);
      src.start(startAt);
      active = src;
    },
    stop: stopActive,
    setGain(g) {
      bus.gain.value = g;
    },
    dispose() {
      stopActive();
      try { bus.disconnect(); } catch { /* noop */ }
    },
  };
}
