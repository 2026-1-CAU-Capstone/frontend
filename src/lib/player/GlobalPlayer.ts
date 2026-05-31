/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayer — Unified player orchestrator.
 *
 * Approach B from the Unified Player Architecture design doc: this is a
 * thin orchestrator that wraps the concrete engines —
 *  • `BackingPlayer`      (lib/backing/player.ts +
 *                          lib/yamaha-sty/sty-backing-player.ts +
 *                          lib/yamaha-sty/hybrid-backing-player.ts)
 *  • `AnacrusisPlayer`    (lib/player/anacrusisPlayer.ts) — pickup notes
 *
 * Responsibilities of this layer (intentionally small):
 *  1. Route `play({ kind })` to the correct inner engine and instantiate
 *     it lazily (we don't pay an AudioContext for engines a page never
 *     uses).
 *  2. Maintain a single unified event bus (`bar`, `chord`, `note`,
 *     `done`, `error`) so pages subscribe once and survive engine
 *     swaps.
 *  3. Fan out `setConfig` to (a) the active inner engine's setConfig
 *     where applicable and (b) the global `playerSettings` store
 *     (when `patch.mixer` is given).
 *  4. Track `currentInput` so the page can introspect what's playing
 *     (e.g., to choose between `onNote` vs `onChord` consumers).
 *
 * Non-responsibilities:
 *  • Notation parsing, voicing, drum patterns — those stay inside the
 *    inner engines.
 *  • Cross-engine simultaneous playback (each engine owns its own
 *    AudioContext; merging clocks is a separate refactor).
 *  • UI state (React subscriptions live in `GlobalPlayerContext.tsx`).
 *
 * Lifetime:
 *  • One instance lives in the React context at the app root. Tests can
 *    construct their own via `createGlobalPlayer()` with mocked engine
 *    factories.
 *
 * ──────────────────────────────────────────────────────────────────────
 * What is SHARED across all engine paths (cross-talk policy)
 * ──────────────────────────────────────────────────────────────────────
 *
 * SHARED — every page that plays audio sees the same value:
 *   • `playerSettings` store (mixer volumes, drumKit, swingRatio, style,
 *     bassMode, metroEnabled, pianoReverb). The BackingPlayer family
 *     subscribes via `subscribePlayerSettings()`. Patches written through
 *     `setConfig({ mixer })` reach all engines.
 *   • `createReverbBus()`, `loadSampledDrumKit()`, `loadDrumLoopPlayer()`
 *     — common asset loaders (per-engine AudioContext, but identical
 *     samples).
 *
 * Engine-internal details (live inside BackingPlayer):
 *   • Piano comping — pre-recorded `PSBASE_CH0_PATTERN` slice (swing)
 *     or `renderLegacyPianoComping` (bossa/latin) in engine.ts. Stage-2
 *     iReal patches (#6 roll, #7 anticipation, #8 3-hit pool) live here.
 *   • Bass walk — `walkChord()` in bass.ts. Patch #1 (approach-tone
 *     weighted roulette) lives here.
 *   • Drum patterns — `renderDrumBar()` in drums.ts. Patch #2 (snare
 *     rotation library) and #5 (style router) live here.
 *   • Piano library — `smplr`'s `SplendidGrandPiano` (velocity layers).
 *
 * Melody (sheet/lick/solo) and chart paths both route through
 * BackingPlayer engines, so Stage-2 iReal humanization patches reach
 * audio uniformly. In lick mode the rhythm section is silenced via
 * `seed.volume` rather than swapped for a different engine.
 * ──────────────────────────────────────────────────────────────────── */

import { AnacrusisPlayer } from "./anacrusisPlayer";
import { setPlayerSettings } from "../note/playerSettings";
import { createBackingPlayer } from "../backing/player";
import { leadSheetToChart } from "../backing/adapters/leadSheetToChart";
import {
  noteSheetToChart,
  extractMelody,
  type MelodyNote,
} from "../backing/adapters/noteSheetToChart";
import { createStyBackingPlayer } from "../../lib/yamaha-sty/sty-backing-player";
import { createHybridBackingPlayer } from "../../lib/yamaha-sty/hybrid-backing-player";
import type { Chart, BackingPlayer, BackingConfig } from "../backing/types";
import type { LeadSheetData } from "../../data/leadSheetTypes";
import type { NoteSheetData } from "../../data/sampleMelody";
import type {
  AnacrusisNote,
  ChartInput,
  ChordSymbol,
  EngineBackend,
  GlobalPlayer,
  GlobalPlayerConfig,
  GlobalPlayerEvents,
  PlayerInput,
} from "./types";

/* ─── Engine factories (overridable for tests) ───────────────────────── */

/**
 * Test seam: each engine factory can be swapped at construction so unit
 * tests can drive the orchestrator without spinning up a real
 * AudioContext / soundfont fetch.
 */
export interface GlobalPlayerEngineFactories {
  createBackingPlayer: (
    chart: Chart,
    config?: BackingConfig,
  ) => BackingPlayer;
  createStyBackingPlayer: (
    chart: Chart,
    config?: BackingConfig,
    options?: { styleUrl?: string; styleData?: ArrayBuffer },
  ) => BackingPlayer;
  createHybridBackingPlayer: (
    chart: Chart,
    config?: BackingConfig,
    options?: { styleUrl?: string; styleData?: ArrayBuffer },
  ) => BackingPlayer;
}

const DEFAULT_FACTORIES: GlobalPlayerEngineFactories = {
  createBackingPlayer: (chart, config) => createBackingPlayer(chart, config),
  createStyBackingPlayer: (chart, config, options) =>
    createStyBackingPlayer(chart, config, options),
  createHybridBackingPlayer: (chart, config, options) =>
    createHybridBackingPlayer(chart, config, options),
};

/* ─── Helpers ────────────────────────────────────────────────────────── */

function isMelodyInput(
  input: PlayerInput,
): input is Extract<PlayerInput, { kind: "sheet" | "lick" | "solo" }> {
  return (
    input.kind === "sheet" || input.kind === "lick" || input.kind === "solo"
  );
}

/**
 * Build a flat `barIndex → ChordSymbol` lookup from a Chart. The chart
 * is already expanded (sections × bars are flat), so indices match the
 * `onBar` callback's `barIndex`.
 */
function buildBarChordTable(chart: Chart): (ChordSymbol | null)[] {
  const out: (ChordSymbol | null)[] = [];
  for (const sec of chart.sections) {
    for (const bar of sec.bars) {
      const first = bar.chords[0];
      if (!first) {
        out.push(null);
        continue;
      }
      out.push({
        symbol: first.symbol ?? "",
        root: first.root,
        bass: first.bass,
      });
    }
  }
  return out;
}

/* ─── Orchestrator ───────────────────────────────────────────────────── */

export function createGlobalPlayer(
  factories: GlobalPlayerEngineFactories = DEFAULT_FACTORIES,
): GlobalPlayer {
  /* ── Inner engine handles (lazy) ─────────────────────────────────── */

  // Dedicated AnacrusisPlayer for pickup-note scheduling. Kept separate
  // from the melody engine so the page can schedule pickups without
  // affecting whichever melody playback is about to start — and so
  // cancelAnacrusis() doesn't interfere with the main timeline.
  let notePlayerAnacrusis: AnacrusisPlayer | null = null;
  // Non-null only when AnacrusisPlayer's ctx was allocated by us (fallback
  // path: no active BackingPlayer existed at first getAnacrusisPlayer()).
  // dispose() closes this; a shared ctx (sourced from active.getCtx())
  // belongs to the BackingPlayer's lifecycle and must NOT be closed here.
  let ownedAnacrusisCtx: AudioContext | null = null;
  // The BackingPlayer instance whose ctx anacrusis is currently sharing. If
  // active changes (song switch → new BackingPlayer with new ctx), we must
  // rebuild anacrusis so its scheduler reads the same clock as p.ctxNow().
  let anacrusisCtxOwner: BackingPlayer | null = null;
  let backingPlayer: BackingPlayer | null = null;
  // The chart input we last built `backingPlayer` for. If the user calls
  // play() with a different chart or engineBackend, we tear down and
  // rebuild — there's no clean "setChart" API on BackingPlayer.
  let backingPlayerSig: string | null = null;
  // Separate BackingPlayer dedicated to the unified `sheet`/`lick`/`solo`
  // path so it doesn't fight the chord-chart `backingPlayer` for an
  // AudioContext. Lazy: only created when the page calls play() with a
  // melody kind.
  let backingPlayerMelody: BackingPlayer | null = null;
  let backingPlayerMelodySig: string | null = null;
  let backingPlayerMelodyOffset = 0;

  /* ── Active engine pointer ───────────────────────────────────────── */

  // Which inner engine is currently selected. Used by pause/stop/etc.
  // so the orchestrator routes to the right one without re-checking
  // currentInput on every call.
  let active: BackingPlayer | null = null;
  let activeKind: PlayerInput["kind"] | null = null;
  let currentInput: PlayerInput | null = null;
  let barChordTable: (ChordSymbol | null)[] = [];

  /* ── Event bus ───────────────────────────────────────────────────── */

  // Each entry is a Set of subscribers; `on()` returns an unsubscribe fn.
  // We use `unknown` casts internally to preserve the per-event type at
  // the public API surface without sprinkling generics through here.
  const listeners: {
    [K in keyof GlobalPlayerEvents]: Set<GlobalPlayerEvents[K]>;
  } = {
    bar: new Set(),
    chord: new Set(),
    note: new Set(),
    done: new Set(),
    error: new Set(),
    drumKitError: new Set(),
  };

  function emit<K extends keyof GlobalPlayerEvents>(
    ev: K,
    ...args: Parameters<GlobalPlayerEvents[K]>
  ): void {
    for (const cb of listeners[ev]) {
      try {
        (cb as (...a: unknown[]) => void)(...(args as unknown[]));
      } catch (err) {
        // Listener errors must not break the engine. Surface via the
        // `error` channel unless we ARE on the error channel — in which
        // case we just log to avoid recursion.
        if (ev === "error") {
          // eslint-disable-next-line no-console
          console.error("[GlobalPlayer] error listener threw", err);
        } else {
          emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  /* ── Engine → bus wiring ─────────────────────────────────────────── */

  function wireBackingPlayer(bp: BackingPlayer) {
    bp.on("onBar", (barIndex: number) => {
      if (barIndex < 0) return;
      emit("bar", barIndex);
      const chord = barChordTable[barIndex];
      if (chord) emit("chord", chord, barIndex);
    });
    bp.on("onDone", () => {
      emit("done");
    });
    bp.on("onDrumKitError", (msg: string | null) => {
      // `null = clear` semantics: subscribers only see real error strings.
      if (msg == null) return;
      emit("drumKitError", msg);
    });
  }

  /**
   * Wire the melody-side BackingPlayer to the unified event bus. Emits
   * `bar` + `note` events (no `chord` — sheet/lick consumers don't subscribe
   * to chord changes via this path). Applies the orchestrator's latest
   * `measureOffset` so source-bar indices match what pages expect.
   */
  function wireBackingPlayerMelody(bp: BackingPlayer) {
    bp.on("onBar", (barIndex: number) => {
      if (barIndex < 0) return;
      emit("bar", barIndex + backingPlayerMelodyOffset);
    });
    bp.on("onNote", (mi: number, ni: number) => {
      emit("note", mi + backingPlayerMelodyOffset, ni);
    });
    bp.on("onDone", () => {
      emit("done");
    });
    bp.on("onDrumKitError", (msg: string | null) => {
      if (msg == null) return;
      emit("drumKitError", msg);
    });
  }

  /* ── Config state ────────────────────────────────────────────────── */

  let config: GlobalPlayerConfig = {};

  /* ── BackingPlayer selection ─────────────────────────────────────── */

  function ensureBackingPlayer(input: ChartInput): BackingPlayer {
    const backend: EngineBackend = input.engineBackend ?? "rule";
    // Signature includes the LeadSheet identity, backend, and any style
    // override. If any change → tear down and rebuild.
    // LeadSheetData isn't easily hashed; use title+bpm+systems.length as a
    // cheap proxy. Callers that want a forced rebuild can call stop()
    // first; play() also tears down on engineBackend change.
    const sig = computeBackingSig(input);
    if (backingPlayer && backingPlayerSig === sig) {
      return backingPlayer;
    }
    if (backingPlayer) {
      backingPlayer.dispose();
      backingPlayer = null;
      backingPlayerSig = null;
    }

    const chart: Chart = leadSheetToChart(input.data);
    barChordTable = buildBarChordTable(chart);

    // Thread the orchestrator's current config (bpm/style/feel/loop/
    // repeatCount) into the BackingConfig seed so the player starts in
    // the right state without needing an extra setConfig() round-trip.
    const seed: BackingConfig = {};
    if (config.bpm !== undefined) seed.bpm = config.bpm;
    if (config.style !== undefined) seed.style = config.style;
    if (config.feel !== undefined) seed.feel = config.feel;
    if (config.loop !== undefined) seed.loop = config.loop;
    if (config.repeatCount !== undefined) seed.repeatCount = config.repeatCount;

    const styOpts = {
      styleUrl: input.styleUrl,
      styleData: input.styleData,
    };

    switch (backend) {
      case "sty":
        backingPlayer = factories.createStyBackingPlayer(chart, seed, styOpts);
        break;
      case "hybrid":
        backingPlayer = factories.createHybridBackingPlayer(
          chart,
          seed,
          styOpts,
        );
        break;
      case "rule":
      default:
        backingPlayer = factories.createBackingPlayer(chart, seed);
        break;
    }

    backingPlayerSig = sig;
    wireBackingPlayer(backingPlayer);
    return backingPlayer;
  }

  /**
   * Build (or reuse) the unified BackingPlayer for a sheet/lick input.
   * Converts NoteSheetData → Chart + MelodyNote[] via the Phase-2 adapter,
   * seeds the BackingConfig with the orchestrator's current config plus the
   * melody track and (for lick) the lick-mode volume preset, and wires the
   * unified event bus through `wireBackingPlayerMelody`.
   *
   * Returns the BackingPlayer instance; caller is responsible for calling
   * `play({ startAt })` on it.
   */
  function ensureBackingPlayerForSheet(
    input: { kind: "sheet" | "lick" | "solo"; data: NoteSheetData },
  ): BackingPlayer {
    const sig = computeMelodySig(input);
    if (backingPlayerMelody && backingPlayerMelodySig === sig) {
      return backingPlayerMelody;
    }
    if (backingPlayerMelody) {
      backingPlayerMelody.dispose();
      backingPlayerMelody = null;
      backingPlayerMelodySig = null;
    }

    const chart: Chart = noteSheetToChart(input.data);
    const melody: MelodyNote[] = extractMelody(input.data);

    // Seed BackingConfig with orchestrator state. Tempo precedence matches
    // the legacy path: explicit config.bpm > sheet.tempo > chart.bpm default.
    const tempo = config.bpm ?? input.data.tempo ?? chart.bpm;
    const seed: BackingConfig = {
      bpm: tempo,
      melody,
    };
    if (config.style !== undefined) seed.style = config.style;
    if (config.feel !== undefined) seed.feel = config.feel;
    if (config.loop !== undefined) seed.loop = config.loop;
    if (config.repeatCount !== undefined) seed.repeatCount = config.repeatCount;

    // Lick mode: silence rhythm section, boost the lead (preserves the
    // legacy `lickMode: true` preset behavior). Volume keys hit the
    // BackingPlayer.dispatch lookup (config.volume[ev.instrument]) directly.
    if (input.kind === "lick") {
      seed.volume = { drums: 0, bass: 0, piano: 0, melody: 1.0 };
      seed.pianoReverb = 0.5;
    }

    backingPlayerMelody = factories.createBackingPlayer(chart, seed);
    backingPlayerMelodySig = sig;
    wireBackingPlayerMelody(backingPlayerMelody);
    return backingPlayerMelody;
  }

  function computeMelodySig(input: { kind: string; data: NoteSheetData }): string {
    // Cheap identity proxy — same convention as computeBackingSig. The kind
    // is part of the signature so toggling sheet↔lick (different volume
    // preset) forces a rebuild.
    const d = input.data;
    return (
      input.kind +
      "|" +
      (d.title ?? "?") +
      "/" +
      (d.measures?.length ?? 0)
    );
  }

  function computeBackingSig(input: ChartInput): string {
    const backend = input.engineBackend ?? "rule";
    const data: LeadSheetData = input.data;
    // Cheap, stable proxy for "same chart": title + bpm + system count.
    // If two different charts happen to collide here, the page can force a
    // rebuild by calling stop() before play(). Page code that toggles
    // backends triggers a rebuild via the backend portion of the sig.
    const id =
      (data.title ?? "?") +
      "/" +
      (data.style ?? "?") +
      "/" +
      (data.systems?.length ?? 0);
    return backend + "|" + id;
  }

  /* ── Active engine swap helper ───────────────────────────────────── */

  function activate(
    input: PlayerInput,
  ): { engine: BackingPlayer; unifiedMelody?: boolean } {
    // If a previously active engine differs, stop it cleanly before
    // swapping so the user doesn't hear two engines at once.
    if (active && active !== getCandidate(input)) {
      try {
        active.stop();
      } catch {
        /* swallow — engine may already be stopped */
      }
    }
    currentInput = input;
    if (isMelodyInput(input)) {
      // Unified path: sheet/lick/solo all go through BackingPlayer + melody
      // track. Solo uses the same piano melody instrument as sheet — its
      // distinct kind only forces a separate cache entry so downstream
      // callbacks (and any future solo-specific defaults) can branch.
      const bp = ensureBackingPlayerForSheet(
        input as { kind: "sheet" | "lick" | "solo"; data: NoteSheetData },
      );
      active = bp;
      activeKind = input.kind;
      return { engine: bp, unifiedMelody: true };
    }
    const bp = ensureBackingPlayer(input);
    active = bp;
    activeKind = input.kind;
    return { engine: bp };
  }

  /** Helper for `activate` — returns the engine that WOULD become active
   *  for `input` without mutating any state. Lets us detect engine swaps. */
  function getCandidate(input: PlayerInput): BackingPlayer | null {
    if (isMelodyInput(input)) return backingPlayerMelody;
    return backingPlayer;
  }

  /* ── Public methods ──────────────────────────────────────────────── */

  async function preload(input: PlayerInput): Promise<void> {
    try {
      if (isMelodyInput(input)) {
        const bp = ensureBackingPlayerForSheet(
          input as { kind: "sheet" | "lick" | "solo"; data: NoteSheetData },
        );
        await bp.preload();
        return;
      }
      const bp = ensureBackingPlayer(input);
      await bp.preload();
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async function play(
    input: PlayerInput,
    opts: { startAt?: number; measureOffset?: number } = {},
  ): Promise<void> {
    try {
      // Stash the measureOffset for the unified path's `wireBackingPlayerMelody`
      // to bias `bar`/`note` events. Applied before activate() so the wiring
      // (which may have been attached on a previous play() call) uses the new
      // offset.
      backingPlayerMelodyOffset = opts.measureOffset ?? 0;
      const handle = activate(input);
      await handle.engine.play({ startAt: opts.startAt });
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  function pause(): void {
    if (!active) return;
    try {
      active.pause();
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  function stop(): void {
    if (!active) return;
    try {
      active.stop();
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  function seekToMeasure(_mi: number): void {
    if (!active) return;
    // BackingPlayer has no per-measure seek API — silently ignore. All
    // melody/chart playback now routes through BackingPlayer, so this
    // method is currently a no-op kept for API compatibility.
  }

  function setConfig(patch: Partial<GlobalPlayerConfig>): void {
    config = { ...config, ...patch };

    // Mixer patches go through the global store; both inner engines
    // already subscribe so the value propagates without us touching them.
    if (patch.mixer) {
      setPlayerSettings(patch.mixer);
    }

    // Fan out chart-engine fields (bpm/style/feel/loop/repeatCount) to the
    // chart BackingPlayer *instance* directly — NOT gated on `active`. The
    // user typically sets these (e.g. the "3x" repeat control) before pressing
    // play, when `active` is still null; gating on `active` silently dropped
    // the value and the player fell back to its default (infinite loop).
    // Targeting the instance keeps its config in sync so the next play()
    // honours it. The mixer-store comment above still holds for melody BPM.
    if (!backingPlayer) return;
    const bpPatch: Partial<BackingConfig> = {};
    if ("bpm" in patch) bpPatch.bpm = patch.bpm;
    if ("style" in patch) bpPatch.style = patch.style;
    if ("feel" in patch) bpPatch.feel = patch.feel;
    if ("loop" in patch) bpPatch.loop = patch.loop;
    if ("repeatCount" in patch) bpPatch.repeatCount = patch.repeatCount;
    if (Object.keys(bpPatch).length > 0) {
      backingPlayer.setConfig(bpPatch);
    }
  }

  function getConfig(): GlobalPlayerConfig {
    return { ...config };
  }

  function ctxNow(): number {
    return active?.ctxNow() ?? 0;
  }

  /* ── Anacrusis (pickup-note) scheduling ──────────────────────────── */

  function getAnacrusisPlayer(): AnacrusisPlayer {
    // If active changed since we created the anacrusis player, the old
    // ctx is stale (or closed). Tear down and rebuild against the new ctx
    // so picking-up notes line up with p.ctxNow().
    if (notePlayerAnacrusis && active && anacrusisCtxOwner !== active) {
      notePlayerAnacrusis.dispose();
      notePlayerAnacrusis = null;
      anacrusisCtxOwner = null;
      if (ownedAnacrusisCtx) {
        try { ownedAnacrusisCtx.close(); } catch { /* */ }
        ownedAnacrusisCtx = null;
      }
    }
    if (!notePlayerAnacrusis) {
      // Prefer the active BackingPlayer's AudioContext so anacrusis schedule
      // times computed from `p.ctxNow()` (which reads active's ctx) align
      // with the AnacrusisPlayer's own clock. Without this, the two ctxs
      // start at independent t=0 and pickup-note timing is undefined.
      //
      // Fallback: if no active engine exists yet (anacrusis called before
      // any play()), allocate our own ctx. dispose() will close it because
      // we own it; if active later becomes non-null we keep using this
      // fallback ctx for the rest of the singleton's life (rebuilding
      // mid-session would drop in-flight scheduled notes).
      const sharedCtx = active?.getCtx() ?? null;
      let ctx: AudioContext;
      if (sharedCtx) {
        ctx = sharedCtx;
        ownedAnacrusisCtx = null;
      } else {
        ctx = new AudioContext();
        ownedAnacrusisCtx = ctx;
      }
      notePlayerAnacrusis = new AnacrusisPlayer(ctx);
      anacrusisCtxOwner = sharedCtx ? active : null;
      // Kick off the piano sample load now so the first scheduled note
      // doesn't get silently dropped by AnacrusisPlayer.scheduleStandaloneNote's
      // `if (!this.piano) return` guard. We fire-and-forget: if load fails,
      // surface it through the error bus rather than crashing the caller.
      notePlayerAnacrusis.preload().catch((err) => {
        emit("error", err instanceof Error ? err : new Error(String(err)));
      });
      // No-op slot retained for surface compatibility — AnacrusisPlayer
      // has no drum kit, but keeping this assignment matches the prior
      // wiring shape.
      notePlayerAnacrusis.onDrumKitError = (msg: string | null) => {
        if (msg == null) return;
        emit("drumKitError", msg);
      };
    }
    return notePlayerAnacrusis;
  }

  function scheduleAnacrusis(notes: AnacrusisNote[]): void {
    if (notes.length === 0) return;
    try {
      const np = getAnacrusisPlayer();
      for (const n of notes) {
        // velocity is 0..1 in our public API; AnacrusisPlayer's gain is in
        // the same scale already multiplied by `melodyVolume`. Defer to its
        // default when velocity is omitted by not passing the optional arg.
        if (n.velocity === undefined) {
          np.scheduleStandaloneNote(n.pitch, n.startAt, n.durationSec);
        } else {
          np.scheduleStandaloneNote(
            n.pitch,
            n.startAt,
            n.durationSec,
            n.velocity,
          );
        }
      }
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  function cancelAnacrusis(): void {
    notePlayerAnacrusis?.cancelStandaloneNotes();
  }

  function on<K extends keyof GlobalPlayerEvents>(
    ev: K,
    cb: GlobalPlayerEvents[K],
  ): () => void {
    listeners[ev].add(cb);
    return () => {
      listeners[ev].delete(cb);
    };
  }

  function dispose(): void {
    try {
      notePlayerAnacrusis?.dispose();
    } catch {
      /* */
    }
    // AnacrusisPlayer.dispose() does NOT close the AudioContext (caller owns
    // it). Close it here ONLY if we allocated the fallback ctx ourselves —
    // shared ctxs are owned by the BackingPlayer and closed by its dispose().
    if (ownedAnacrusisCtx) {
      try { ownedAnacrusisCtx.close(); } catch { /* */ }
    }
    try {
      backingPlayer?.dispose();
    } catch {
      /* */
    }
    try {
      backingPlayerMelody?.dispose();
    } catch {
      /* */
    }
    notePlayerAnacrusis = null;
    ownedAnacrusisCtx = null;
    anacrusisCtxOwner = null;
    backingPlayer = null;
    backingPlayerSig = null;
    backingPlayerMelody = null;
    backingPlayerMelodySig = null;
    active = null;
    activeKind = null;
    currentInput = null;
    for (const k of Object.keys(listeners) as (keyof GlobalPlayerEvents)[]) {
      listeners[k].clear();
    }
  }

  /* ── Bundle ──────────────────────────────────────────────────────── */

  return {
    get playing() {
      return active?.playing ?? false;
    },
    get currentInput() {
      return currentInput;
    },
    preload,
    play,
    pause,
    stop,
    seekToMeasure,
    setConfig,
    getConfig,
    ctxNow,
    scheduleAnacrusis,
    cancelAnacrusis,
    on,
    dispose,
  };
}

/* ─── Process-wide singleton (for non-React callers / tests) ─────────── */

let _singleton: GlobalPlayer | null = null;

/**
 * Lazy process-wide singleton. The React provider in
 * `GlobalPlayerContext.tsx` uses this so re-mounts don't accidentally
 * create a fresh engine pool (and lose all event subscribers / engine
 * warm-up).
 *
 * Tests can reset by calling `disposeGlobalPlayerSingleton()`.
 */
export function getGlobalPlayerSingleton(): GlobalPlayer {
  if (!_singleton) _singleton = createGlobalPlayer();
  return _singleton;
}

export function disposeGlobalPlayerSingleton(): void {
  _singleton?.dispose();
  _singleton = null;
}
