import Soundfont from "soundfont-player";
import type {
  Chart,
  BackingConfig,
  BackingEvent,
  BackingPlayer,
  BackingPlayerCallbacks,
} from "./types";
import { renderChart } from "./engine";
import { SimpleDrumSynth } from "./drumSynth";
import { loadInstruments } from "./soundfont";

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
  let piano: Soundfont.Player | null = null;
  let bass: Soundfont.Player | null = null;
  let drums: SimpleDrumSynth | null = null;
  let loading: Promise<void> | null = null;

  let events: BackingEvent[] = [];
  let origin = 0;
  let elapsed = 0;
  let nextIdx = 0;
  let rafHandle = 0;
  let playing = false;
  let lastBarFired = -2;
  const activeNodes: { stop(): void }[] = [];

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

  /* ── event building ──────────────────────────────────────────────── */

  function build() {
    const bpm = config.bpm ?? chart.bpm;
    events = renderChart(chart, { bpm });
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

    // Find current bar for UI highlighting
    let currentBar = -1;
    for (let i = nextIdx - 1; i >= 0; i--) {
      if (events[i].time <= now + TICK_TOLERANCE_SEC) {
        currentBar = events[i].bar;
        break;
      }
    }
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
      drums?.play(ev.piece, absTime, ev.velocity);
      return;
    }

    const inst = ev.instrument === "piano" ? piano : ev.instrument === "bass" ? bass : null;
    if (!inst) return;

    const node = inst.play(String(ev.midi), absTime, {
      duration: ev.duration,
      gain: ev.velocity,
    });
    if (node) activeNodes.push(node as unknown as { stop(): void });
  }

  function killActiveNodes() {
    for (const n of activeNodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    activeNodes.length = 0;
  }

  /* ── public API ──────────────────────────────────────────────────── */

  async function play(): Promise<void> {
    if (playing) return;
    ensureCtx();
    await ensureInstruments();
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
    tick();
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
    config = { ...config, ...next };
    if (playing) build();
  }

  function dispose(): void {
    stop();
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
