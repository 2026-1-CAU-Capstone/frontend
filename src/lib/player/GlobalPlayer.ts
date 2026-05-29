/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayer — Unified player orchestrator.
 *
 * Approach B from the Unified Player Architecture design doc: this is a
 * thin orchestrator that wraps two concrete engines —
 *  • `NotePlayer`         (lib/note/notePlayer.ts)
 *  • `BackingPlayer`      (lib/backing/player.ts +
 *                          lib/yamaha-sty/sty-backing-player.ts +
 *                          lib/yamaha-sty/hybrid-backing-player.ts)
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
 *     bassMode, metroEnabled, pianoReverb). Both NotePlayer and the
 *     BackingPlayer family subscribe via `subscribePlayerSettings()`.
 *     Patches written through `setConfig({ mixer })` reach all engines.
 *   • `createReverbBus()`, `loadSampledDrumKit()`, `loadDrumLoopPlayer()`
 *     — common asset loaders (per-engine AudioContext, but identical
 *     samples).
 *
 * NOT SHARED — by design, these live inside the inner engines:
 *   • Piano comping algorithm — NotePlayer uses its own `VOICINGS` table
 *     + `COMP_PATTERNS_*` rhythms (see notePlayer.ts `build()`).
 *     BackingPlayer uses the pre-recorded `PSBASE_CH0_PATTERN` slice
 *     (swing) or `renderLegacyPianoComping` (bossa/latin) in engine.ts.
 *     Stage-2 iReal patches (#6 roll, #7 anticipation, #8 3-hit pool) are
 *     applied INSIDE the BackingPlayer paths only — NotePlayer has its
 *     own humanization tuned for the melody-on-top context.
 *   • Bass walk — BackingPlayer uses `walkChord()` in bass.ts; NotePlayer
 *     has its own two-feel/four-feel routine in `build()`. Patch #1
 *     (approach-tone weighted roulette) is in walkChord only.
 *   • Drum patterns — BackingPlayer uses `renderDrumBar()` in drums.ts;
 *     NotePlayer has its own swing/bossa hits in `build()`. Patch #2
 *     (snare rotation library) and #5 (style router) live in drums.ts
 *     only.
 *   • Piano library — NotePlayer uses `soundfont-player`'s
 *     `acoustic_grand_piano`; BackingPlayer uses `smplr`'s
 *     `SplendidGrandPiano` (velocity layers). Unifying these is a
 *     separate audio-engineering decision (see design doc §7).
 *
 * So: when the user plays a "chart" (chord chart) every Stage-2 patch
 * reaches audio. When the user plays a "sheet"/"lick"/"solo" (melody
 * with embedded rhythm section), the rhythm-section humanization comes
 * from NotePlayer's own (separate) logic, NOT from the iReal patches.
 * If a future patch should reach BOTH paths, it must be applied in BOTH
 * engines.
 * ──────────────────────────────────────────────────────────────────── */

import { NotePlayer } from "../note/notePlayer";
import { setPlayerSettings } from "../note/playerSettings";
import { createBackingPlayer } from "../backing/player";
import { leadSheetToChart } from "../backing/adapters/leadSheetToChart";
import { createStyBackingPlayer } from "../../lib/yamaha-sty/sty-backing-player";
import { createHybridBackingPlayer } from "../../lib/yamaha-sty/hybrid-backing-player";
import type { Chart, BackingPlayer, BackingConfig } from "../backing/types";
import type { LeadSheetData } from "../../data/leadSheetTypes";
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
  createNotePlayer: (opts: { lickMode?: boolean }) => NotePlayer;
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
  createNotePlayer: (opts) => new NotePlayer(opts),
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

  // We keep one NotePlayer per `lickMode` value because lickMode is
  // baked into the instance at construction (silences bass/drums,
  // boosts melody). Cheap: no AudioContext is created until first play.
  let notePlayerSheet: NotePlayer | null = null;
  let notePlayerLick: NotePlayer | null = null;
  // Dedicated NotePlayer for anacrusis (pickup-note) scheduling. Kept
  // separate from the sheet/lick instances so the page can schedule
  // pickups without affecting whichever melody engine is about to play()
  // — and so cancelAnacrusis() doesn't interfere with the main timeline.
  let notePlayerAnacrusis: NotePlayer | null = null;
  let backingPlayer: BackingPlayer | null = null;
  // The chart input we last built `backingPlayer` for. If the user calls
  // play() with a different chart or engineBackend, we tear down and
  // rebuild — there's no clean "setChart" API on BackingPlayer.
  let backingPlayerSig: string | null = null;

  function getNotePlayer(lickMode: boolean): NotePlayer {
    if (lickMode) {
      if (!notePlayerLick) {
        notePlayerLick = factories.createNotePlayer({ lickMode: true });
        wireNotePlayer(notePlayerLick);
      }
      return notePlayerLick;
    }
    if (!notePlayerSheet) {
      notePlayerSheet = factories.createNotePlayer({ lickMode: false });
      wireNotePlayer(notePlayerSheet);
    }
    return notePlayerSheet;
  }

  /* ── Active engine pointer ───────────────────────────────────────── */

  // Which inner engine is currently selected. Used by pause/stop/etc.
  // so the orchestrator routes to the right one without re-checking
  // currentInput on every call.
  let active: NotePlayer | BackingPlayer | null = null;
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

  function wireNotePlayer(np: NotePlayer) {
    np.onMeasure = (idx: number) => {
      // NotePlayer fires onMeasure(-1) on stop — only forward live bars.
      if (idx < 0) return;
      emit("bar", idx);
    };
    np.onNote = (mi: number, ni: number) => {
      emit("note", mi, ni);
    };
    np.onDone = () => {
      emit("done");
    };
    np.onDrumKitError = (msg: string | null) => {
      // NotePlayer calls this with `null` on successful (re)load to clear
      // any stale warning. We only forward actual error strings so
      // subscribers don't have to filter the no-op case.
      if (msg == null) return;
      emit("drumKitError", msg);
    };
  }

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
      // Same `null = clear` semantics as NotePlayer; subscribers only see
      // real error strings.
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
  ): { engine: NotePlayer; lickMode: boolean } | { engine: BackingPlayer } {
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
      const lickMode = input.kind === "lick";
      const np = getNotePlayer(lickMode);
      active = np;
      activeKind = input.kind;
      return { engine: np, lickMode };
    }
    const bp = ensureBackingPlayer(input);
    active = bp;
    activeKind = input.kind;
    return { engine: bp };
  }

  /** Helper for `activate` — returns the engine that WOULD become active
   *  for `input` without mutating any state. Lets us detect engine swaps. */
  function getCandidate(input: PlayerInput): NotePlayer | BackingPlayer | null {
    if (isMelodyInput(input)) {
      const lickMode = input.kind === "lick";
      return lickMode ? notePlayerLick : notePlayerSheet;
    }
    return backingPlayer;
  }

  /* ── Public methods ──────────────────────────────────────────────── */

  async function preload(input: PlayerInput): Promise<void> {
    try {
      if (isMelodyInput(input)) {
        const np = getNotePlayer(input.kind === "lick");
        await np.preload();
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
      const handle = activate(input);
      if ("lickMode" in handle) {
        const tempo =
          config.bpm ??
          (isMelodyInput(input) ? input.data.tempo : undefined) ??
          120;
        await handle.engine.play(
          isMelodyInput(input) ? input.data : (input as never),
          tempo,
          {
            startAt: opts.startAt,
            measureOffset: opts.measureOffset,
          },
        );
      } else {
        await handle.engine.play({ startAt: opts.startAt });
      }
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

  function seekToMeasure(mi: number): void {
    if (!active) return;
    // Only NotePlayer supports per-measure seeking. BackingPlayer has no
    // analogous method — silently ignore for the chart kind.
    if (activeKind === "chart") return;
    (active as NotePlayer).seekToMeasure(mi);
  }

  function setConfig(patch: Partial<GlobalPlayerConfig>): void {
    config = { ...config, ...patch };

    // Mixer patches go through the global store; both inner engines
    // already subscribe so the value propagates without us touching them.
    if (patch.mixer) {
      setPlayerSettings(patch.mixer);
    }

    if (!active) return;

    // For melody engines, NotePlayer reads bpm/style/swingRatio via the
    // mixer store and rebuilds its schedule on the next tick when those
    // change. The orchestrator's `bpm` field above isn't part of the
    // mixer store, so we only push it through when the user explicitly
    // patches the mixer (already handled). The actual BPM applied to
    // melody playback comes from `play()`'s `tempo` arg — pages that
    // change BPM mid-play should call `play()` again with the new BPM.
    if (activeKind !== "chart") return;

    // For chart engine, fan out to BackingPlayer.setConfig.
    const bp = active as BackingPlayer;
    const bpPatch: Partial<BackingConfig> = {};
    if ("bpm" in patch) bpPatch.bpm = patch.bpm;
    if ("style" in patch) bpPatch.style = patch.style;
    if ("feel" in patch) bpPatch.feel = patch.feel;
    if ("loop" in patch) bpPatch.loop = patch.loop;
    if ("repeatCount" in patch) bpPatch.repeatCount = patch.repeatCount;
    if (Object.keys(bpPatch).length > 0) {
      bp.setConfig(bpPatch);
    }
  }

  function getConfig(): GlobalPlayerConfig {
    return { ...config };
  }

  function ctxNow(): number {
    return active?.ctxNow() ?? 0;
  }

  /* ── Anacrusis (pickup-note) scheduling ──────────────────────────── */

  function getAnacrusisPlayer(): NotePlayer {
    if (!notePlayerAnacrusis) {
      // Anacrusis playback is melody-on-top only; lickMode would silence
      // the rhythm section but pages call this BEFORE the count-in, so
      // there's no rhythm section to silence. Use the plain sheet config.
      notePlayerAnacrusis = factories.createNotePlayer({ lickMode: false });
      // Forward drum-kit errors only — the anacrusis player has no
      // measure/note/done timeline of its own, so wiring bar/note/done
      // would cross-fire with the main melody engine.
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
        // velocity is 0..1 in our public API; NotePlayer's gain is in the
        // same scale already multiplied by `melodyVolume`. Defer to its
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
      notePlayerSheet?.dispose();
    } catch {
      /* */
    }
    try {
      notePlayerLick?.dispose();
    } catch {
      /* */
    }
    try {
      notePlayerAnacrusis?.dispose();
    } catch {
      /* */
    }
    try {
      backingPlayer?.dispose();
    } catch {
      /* */
    }
    notePlayerSheet = null;
    notePlayerLick = null;
    notePlayerAnacrusis = null;
    backingPlayer = null;
    backingPlayerSig = null;
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
