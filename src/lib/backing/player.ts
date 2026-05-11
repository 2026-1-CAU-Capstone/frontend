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

export function createBackingPlayer(
  chart: Chart,
  initialConfig: BackingConfig = {},
): BackingPlayer {
  const callbacks: BackingPlayerCallbacks = {};
  let config: BackingConfig = { ...initialConfig };

  let ctx: AudioContext | null = null;
  let piano: TriggerableInstrument | null = null;
  let bass: TriggerableInstrument | null = null;
  let drums: TriggerableInstrument | null = null;
  let drumLoop: DrumLoopPlayer | null = null;
  let drumLoopUrl: string | null = null;       // currently-loaded loop URL
  let loading: Promise<void> | null = null;

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
    });
    return loading;
  }

  /** Lazy-load drum loop player if config.drumLoop is set. Reloads when URL changes. */
  async function ensureDrumLoop(): Promise<void> {
    const cfg = config.drumLoop;
    if (config.drumMode !== "loop" || !cfg) {
      if (drumLoop) { drumLoop.dispose(); drumLoop = null; drumLoopUrl = null; }
      return;
    }
    if (drumLoop && drumLoopUrl === cfg.url) return;
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    try {
      const c = ensureCtx();
      drumLoop = await loadDrumLoopPlayer(c, c.destination, cfg);
      drumLoopUrl = cfg.url;
    } catch (err) {
      console.warn("[backing] drum loop load failed, falling back to hit mode:", err);
    }
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

  async function play(): Promise<void> {
    if (playing) return;
    ensureCtx();
    await ensureInstruments();
    await ensureDrumLoop();
    build();
    playing = true;
    lastBarFired = -2;
    origin = ctx!.currentTime - elapsed;

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
      // Resuming mid-stream: skip into the loop's phase so it aligns with elapsed time.
      // BufferSource doesn't support arbitrary offset + loop reliably across browsers
      // for non-zero offsets, so for paused-resume we restart from loop t=0.
      drumLoop.start(origin + elapsed, opts().bpm);
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
    config = { ...config, ...next };
    if (playing) {
      build();
      // If drum mode or loop URL changed mid-playback, restart the loop accordingly.
      const modeChanged = prevMode !== config.drumMode;
      const urlChanged = prevUrl !== config.drumLoop?.url;
      if (modeChanged || urlChanged) {
        drumLoop?.stop();
        if (config.drumMode === "loop") {
          ensureDrumLoop().then(() => {
            if (!playing || !ctx) return;
            const drumVol = config.volume?.drums ?? 1;
            drumLoop?.setGain((config.drumLoop?.gain ?? 1) * drumVol);
            drumLoop?.start(ctx.currentTime, opts().bpm);
          });
        }
      } else if (config.drumMode === "loop" && drumLoop) {
        const drumVol = config.volume?.drums ?? 1;
        drumLoop.setGain((config.drumLoop?.gain ?? 1) * drumVol);
      }
    }
  }

  function dispose(): void {
    stop();
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    ctx?.close();
    ctx = null;
    piano = null;
    bass = null;
    drums = null;
    loading = null;
  }

  return {
    get playing() { return playing; },
    play,
    pause,
    stop,
    setConfig,
    dispose,
    on(ev, cb) {
      callbacks[ev] = cb as never;
    },
  };
}
