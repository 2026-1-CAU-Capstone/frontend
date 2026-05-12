import type {
  Chart,
  BackingConfig,
  BackingEvent,
  BackingPlayer,
  BackingPlayerCallbacks,
} from "./types";
import { renderChart } from "./engine";
import { loadInstruments, type TriggerableInstrument } from "./soundfont";
import { loadDrumLoopPlayer, type DrumLoopPlayer } from "./drumLoopPlayer";
import {
  getPlayerSettings,
  subscribePlayerSettings,
  type PlayerSettings,
} from "../note/playerSettings";
import { DRUM_KIT_PRESETS } from "./drumKitPresets";

/* ─────────────────────────────────────────────────────────────────────────
 * Backing player.
 *
 * Owns the AudioContext, lazy-loads soundfont instruments, renders the chart
 * to an event stream via the engine, and schedules those events into the
 * AudioContext with a lookahead-based RAF tick loop.
 *
 * Transport pattern is ported from lib/note/notePlayer.ts::NotePlayer.
 * ──────────────────────────────────────────────────────────────────────── */

const LOOKAHEAD_SEC = 0.2;
const TICK_TOLERANCE_SEC = 0.05;

/** Merge the global PlayerSettings into a BackingConfig — explicit fields in
 *  the config take precedence so callers can override per-player if needed. */
function mixSettingsIntoConfig(
  s: PlayerSettings,
  base: BackingConfig,
): BackingConfig {
  const kitCfg = DRUM_KIT_PRESETS[s.drumKit].toConfig();
  return {
    ...kitCfg,                   // drumMode + drumLoop
    ...base,                     // caller overrides win
    volume: {
      piano: s.pianoVolume,
      bass: s.bassVolume,
      drums: s.drumVolume,
      ...(base.volume ?? {}),
    },
    pianoReverb: base.pianoReverb ?? s.pianoReverb,
  };
}

export function createBackingPlayer(
  chart: Chart,
  initialConfig: BackingConfig = {},
): BackingPlayer {
  const callbacks: BackingPlayerCallbacks = {};
  // Seed config with the global mixer settings so volume / reverb / kit are
  // shared across every backing player and note-sheet player.
  const seeded = mixSettingsIntoConfig(getPlayerSettings(), initialConfig);
  let config: BackingConfig = seeded;

  let ctx: AudioContext | null = null;
  let piano: TriggerableInstrument | null = null;
  let bass: TriggerableInstrument | null = null;
  let drums: TriggerableInstrument | null = null;
  let pianoReverbSend: GainNode | null = null;
  let drumLoop: DrumLoopPlayer | null = null;
  let drumLoopUrl: string | null = null;       // currently-loaded loop URL
  let loading: Promise<void> | null = null;
  // In-flight drum loop fetch; second concurrent call awaits this instead of
  // racing a parallel fetch (whose late-arriving result would otherwise clobber
  // the newer selection).
  let drumLoopLoading: Promise<void> | null = null;

  let events: BackingEvent[] = [];
  let origin = 0;
  let elapsed = 0;
  let nextIdx = 0;
  let rafHandle = 0;
  let playing = false;
  let lastBarFired = -2;
  let secPerBar = 0;
  let totalBars = 0;

  /* ── audio context / instruments ─────────────────────────────────── */

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function ensureInstruments(): Promise<void> {
    if (piano && bass && drums) return Promise.resolve();
    if (loading) return loading;
    loading = loadInstruments(ensureCtx()).then((inst) => {
      piano = inst.piano;
      bass = inst.bass;
      drums = inst.drums;
      pianoReverbSend = inst.pianoReverbSend;
      // Apply any pianoReverb setting that was already in config when we loaded.
      applyPianoReverb();
    });
    return loading;
  }

  function applyPianoReverb() {
    if (!ctx || !pianoReverbSend) return;
    if (config.pianoReverb === undefined) return;
    pianoReverbSend.gain.setTargetAtTime(
      config.pianoReverb,
      ctx.currentTime,
      0.05,
    );
  }

  /** Lazy-load drum loop player if config.drumLoop is set. Reloads when URL
   *  changes. Concurrent / rapid-fire calls (e.g. sticks→brushes→sticks) chain
   *  off the in-flight fetch and the chain re-evaluates against the latest
   *  config when it resolves — so a stale load can't clobber the newer one. */
  function ensureDrumLoop(): Promise<void> {
    if (drumLoopLoading) return drumLoopLoading.then(() => ensureDrumLoop());
    const cfg = config.drumLoop;
    if (config.drumMode !== "loop" || !cfg) {
      if (drumLoop) { drumLoop.dispose(); drumLoop = null; drumLoopUrl = null; }
      return Promise.resolve();
    }
    if (drumLoop && drumLoopUrl === cfg.url) return Promise.resolve();
    const targetUrl = cfg.url;
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    drumLoopLoading = (async () => {
      try {
        const c = ensureCtx();
        const player = await loadDrumLoopPlayer(c, c.destination, cfg);
        // Config may have flipped during the fetch — drop a stale result.
        if (config.drumLoop?.url !== targetUrl) {
          player.dispose();
          return;
        }
        drumLoop = player;
        drumLoopUrl = targetUrl;
      } catch (err) {
        console.warn("[backing] drum loop load failed, falling back to hit mode:", err);
      } finally {
        drumLoopLoading = null;
      }
    })();
    return drumLoopLoading;
  }

  /* ── event building ──────────────────────────────────────────────── */

  function build() {
    const bpm = config.bpm ?? chart.bpm;
    events = renderChart(chart, { bpm });
    const beatsPerBar = chart.timeSig[0];
    secPerBar = beatsPerBar * (60 / bpm);
    totalBars = chart.sections.reduce((s, sec) => s + sec.bars.length, 0);
  }

  /* ── scheduler loop ──────────────────────────────────────────────── */

  const tick = () => {
    if (!playing || !ctx) return;
    const now = ctx.currentTime - origin;

    // Schedule upcoming events inside the lookahead window
    while (nextIdx < events.length) {
      const ev = events[nextIdx];
      if (ev.time > now + LOOKAHEAD_SEC) break;
      if (ev.time >= now - TICK_TOLERANCE_SEC) {
        dispatch(ev);
      }
      nextIdx++;
    }

    // Compute current bar directly from elapsed time — this is perfectly
    // aligned with the audio because both use the same secPerBar grid.
    // No event-scanning needed, so humanization offsets on individual
    // events can't cause the highlight to jump early or late.
    const currentBar = secPerBar > 0
      ? Math.min(Math.floor(now / secPerBar), totalBars - 1)
      : -1;
    if (currentBar !== lastBarFired) {
      lastBarFired = currentBar;
      callbacks.onBar?.(currentBar);
    }

    // Done?
    if (nextIdx >= events.length) {
      const last = events[events.length - 1];
      if (last && now > last.time + 0.5) {
        stop();
        callbacks.onDone?.();
        return;
      }
    }

    rafHandle = requestAnimationFrame(tick);
  };

  function dispatch(ev: BackingEvent) {
    if (!ctx) return;
    const absTime = origin + ev.time;

    if (ev.kind === "drum") {
      // Loop mode owns the entire drum part — skip per-hit dispatch.
      if (config.drumMode === "loop" && drumLoop) return;
      const vol = config.volume?.drums ?? 1;
      if (vol <= 0) return;
      drums?.trigger({
        note: ev.piece,
        time: absTime,
        duration: 0,
        velocity: ev.velocity * vol,
      });
      return;
    }

    const inst = ev.instrument === "piano" ? piano : ev.instrument === "bass" ? bass : null;
    if (!inst) return;

    const vol = config.volume?.[ev.instrument] ?? 1;
    if (vol <= 0) return;

    inst.trigger({
      note: ev.midi,
      time: absTime,
      duration: ev.duration,
      velocity: ev.velocity * vol,
    });
  }

  function killActiveNodes() {
    piano?.stopAll();
    bass?.stopAll();
    drums?.stopAll();
    drumLoop?.stop();
  }

  /* ── public API ──────────────────────────────────────────────────── */

  /** AudioContext + instruments + drum 자원을 미리 로드. play() 가 같은 ensure* 들을
   *  호출하지만 모두 idempotent (캐시) 라 카운트인과 병렬로 호출해두면 첫 재생
   *  지연이 사라진다. */
  async function preload(): Promise<void> {
    ensureCtx();
    await ensureInstruments();
    await ensureDrumLoop();
  }

  async function play(playOpts: { startAt?: number } = {}): Promise<void> {
    if (playing) return;
    ensureCtx();
    await ensureInstruments();
    await ensureDrumLoop();
    build();
    playing = true;
    lastBarFired = -2;
    // Lead the origin slightly so the first event (time=0) is strictly in the
    // future. With a caller-supplied `startAt` (count-in's exact downbeat) we
    // trust the audio clock and use a tight 5 ms margin so the first event
    // lands essentially ON the beat. Without it we use the wider 50 ms margin
    // that covers post-count-in setTimeout slop.
    const SCHED_LEAD = playOpts.startAt != null ? 0.005 : 0.05;
    const now = ctx!.currentTime;
    const desiredOrigin = playOpts.startAt != null
      ? Math.max(playOpts.startAt, now + SCHED_LEAD)
      : now + SCHED_LEAD;
    origin = desiredOrigin - elapsed;

    // Fast-forward nextIdx on resume
    nextIdx = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time >= elapsed - TICK_TOLERANCE_SEC) {
        nextIdx = i;
        break;
      }
    }

    // Start the drum loop in sync with the transport origin.
    if (config.drumMode === "loop" && drumLoop) {
      const drumVol = config.volume?.drums ?? 1;
      drumLoop.setGain((config.drumLoop?.gain ?? 1) * drumVol);
      // Resume from pause: seek into the loop buffer so it stays phase-aligned
      // with the comp/bass that were already mid-bar. AudioBufferSourceNode's
      // start(when, offset) is part of the standard API.
      drumLoop.start(origin + elapsed, opts().bpm, elapsed);
    }

    tick();
  }

  function opts() {
    return { bpm: config.bpm ?? chart.bpm };
  }

  function pause(): void {
    if (!playing || !ctx) return;
    playing = false;
    cancelAnimationFrame(rafHandle);
    elapsed = ctx.currentTime - origin;
    killActiveNodes();
  }

  function stop(): void {
    playing = false;
    cancelAnimationFrame(rafHandle);
    elapsed = 0;
    nextIdx = 0;
    lastBarFired = -2;
    killActiveNodes();
    callbacks.onBar?.(-1);
  }

  function setConfig(next: Partial<BackingConfig>): void {
    const prevMode = config.drumMode;
    const prevUrl = config.drumLoop?.url;
    const prevBpm = config.bpm;
    config = { ...config, ...next };

    // Apply pianoReverb immediately whether playing or not.
    applyPianoReverb();

    if (playing) {
      // Mid-playback drum-kit / loop-URL / BPM changes all desync against
      // events already scheduled at the old tempo (and require a re-time-
      // stretch on loop kits). Fully stop so the user explicitly resumes.
      const modeChanged = prevMode !== config.drumMode;
      const urlChanged = prevUrl !== config.drumLoop?.url;
      const bpmChanged = "bpm" in next && prevBpm !== config.bpm;
      if (modeChanged || urlChanged || bpmChanged) {
        stop();
        callbacks.onDone?.();
        // Pre-fetch the new loop so the next play() doesn't wait on IO.
        if (config.drumMode === "loop") {
          ensureDrumLoop().catch(() => { /* logged in loader */ });
        }
        return;
      }
      if (config.drumMode === "loop" && drumLoop) {
        const drumVol = config.volume?.drums ?? 1;
        drumLoop.setGain((config.drumLoop?.gain ?? 1) * drumVol);
      }
    }
  }

  function dispose(): void {
    stop();
    unsubSettings?.();
    unsubSettings = null;
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    ctx?.close();
    ctx = null;
    piano = null;
    bass = null;
    drums = null;
    pianoReverbSend = null;
    loading = null;
  }

  // Subscribe to the global mixer store so every player instance picks up
  // changes from any UI without per-page glue code. The diff is funneled
  // through setConfig so kit-change-forces-stop semantics still apply.
  let unsubSettings: (() => void) | null = subscribePlayerSettings((next) => {
    setConfig(mixSettingsIntoConfig(next, {}));
  });

  return {
    get playing() { return playing; },
    play,
    preload,
    pause,
    stop,
    setConfig,
    dispose,
    ctxNow() { return ctx?.currentTime ?? 0; },
    on(ev, cb) {
      callbacks[ev] = cb as never;
    },
  };
}
