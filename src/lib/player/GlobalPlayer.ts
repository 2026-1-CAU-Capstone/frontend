/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayer — Unified player orchestrator.
 *
 * Approach B from the Unified Player Architecture design doc: this is a
 * thin orchestrator that wraps the concrete engines —
 *  • `BackingPlayer`      (lib/backing/player.ts) — rule-based engine
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
import { registerAudioStopper } from "./audioStopRegistry";
import { setPlayerSettings } from "../note/playerSettings";
import { createBackingPlayer } from "../backing/player";
import { leadSheetToChart } from "../backing/adapters/leadSheetToChart";
import {
  noteSheetToChart,
  extractMelody,
  type MelodyNote,
} from "../backing/adapters/noteSheetToChart";
import { swungBeats } from "../note/swing";
import { melodySwingRatio } from "../backing/engine";
import type { Chart, BackingPlayer, BackingConfig } from "../backing/types";
import type { LeadSheetData } from "../../data/leadSheetTypes";
import type { NoteSheetData } from "../../data/sampleMelody";
import type {
  AnacrusisNote,
  ChartInput,
  ChordSymbol,
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
}

const DEFAULT_FACTORIES: GlobalPlayerEngineFactories = {
  createBackingPlayer: (chart, config) => createBackingPlayer(chart, config),
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
  // The `kind` the melody engine was last built for. When the next content is
  // the SAME kind (e.g. browsing lick→lick) we reuse the engine — swap its
  // chart/melody but keep the warmed AudioContext + soundfonts — so playback
  // starts instantly. A kind change rebuilds with that kind's full preset.
  let backingPlayerMelodyKind: string | null = null;
  let backingPlayerMelodyOffset = 0;

  /* ── Active engine pointer ───────────────────────────────────────── */

  // Which inner engine is currently selected. Used by pause/stop/etc.
  // so the orchestrator routes to the right one without re-checking
  // currentInput on every call.
  let active: BackingPlayer | null = null;
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
    // Chart playback historically had no melody, so onNote was never forwarded.
    // It does now when an inline lick is injected over the chord chart — forward
    // it so InlineLickRow can highlight the current note in real time.
    bp.on("onNote", (mi: number, ni: number) => {
      emit("note", mi, ni);
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
    // Signature includes the LeadSheet identity + chord-content hash. If it
    // changes → tear down and rebuild. Callers that want a forced rebuild can
    // call stop() first.
    const sig = computeBackingSig(input);
    if (backingPlayer && backingPlayerSig === sig) {
      return backingPlayer;
    }
    if (backingPlayer) {
      if (active === backingPlayer) active = null;
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
    if (config.melody !== undefined) seed.melody = config.melody;
    if (config.breakBeats !== undefined) seed.breakBeats = config.breakBeats;
    if (config.loopRegion !== undefined) seed.loopRegion = config.loopRegion;

    backingPlayer = factories.createBackingPlayer(chart, seed);

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
    input: { kind: "sheet" | "lick" | "solo"; data: NoteSheetData; extraParts?: NoteSheetData[] },
  ): BackingPlayer {
    const sig = computeMelodySig(input);
    if (backingPlayerMelody && backingPlayerMelodySig === sig) {
      return backingPlayerMelody;
    }

    const chart: Chart = noteSheetToChart(input.data);

    // Seed BackingConfig with orchestrator state. Tempo precedence matches
    // the legacy path: explicit config.bpm > sheet.tempo > chart.bpm default.
    // ??(nullish)는 tempo:0을 통과시킨다 — 서버/OMR산 데이터의 0이 그대로
    // secPerBeat=60/0=Infinity로 흘러 무음+하이라이트 고착이 됐다. 유한 양수만.
    const validBpm = (n: number | undefined): n is number => Number.isFinite(n) && (n as number) > 0;
    const tempo = validBpm(config.bpm) ? config.bpm!
      : validBpm(input.data.tempo) ? input.data.tempo!
      : chart.bpm;

    // Pre-swing the lead line to the song's feel so it locks with the swung
    // rhythm section (bass/drums/comp swing via the engine's swingRatio; a
    // straight melody flams against them on every off-beat 8th). We pre-shape
    // the offsets here — the same pattern ChordPage's inline-lick path uses —
    // so the engine's "melody arrives already-swung by the caller" contract
    // holds for sheet/lick/solo too. `melodySwingRatio` mirrors the engine's
    // exact feel resolution, and `swungBeats` is a no-op at ratio 0.5
    // (bossa/latin/straight) so those feels stay straight. Onset AND end are
    // both mapped so each note keeps its written length in swung time.
    const swingRatio = melodySwingRatio(chart, { bpm: tempo, style: config.style, feel: config.feel });
    // Multi-part: flatten the displayed part + any extraParts into one melody
    // timeline so every part sounds together. MelodyNote[] is a flat list, so
    // overlapping notes from different parts coexist (polyphony) cleanly.
    const sheetsToSound: NoteSheetData[] = [
      input.data,
      ...((input.kind === "sheet" && input.extraParts) ? input.extraParts : []),
    ];
    const melody: MelodyNote[] = sheetsToSound.flatMap((sheet) =>
      extractMelody(sheet).map((m) => {
        const onset = swungBeats(m.beatOffset, swingRatio);
        const end = swungBeats(m.beatOffset + m.durationBeats, swingRatio);
        return { ...m, beatOffset: onset, durationBeats: Math.max(0.05, end - onset) };
      }),
    );

    // ── Fast path: REUSE the live engine when only the CONTENT changed within
    // the same kind (browsing lick→lick, sheet→sheet). Swap the chart + melody
    // + tempo but keep the warmed AudioContext + loaded soundfonts, so the next
    // play() rebuilds events INSTANTLY. Reloading the engine (dispose → new ctx
    // → re-decode piano/bass/drums) overran the count-in, which is why playback
    // lagged a beat behind "1 2 3 4". Same-kind ⇒ the per-kind preset (lick
    // loop/repeat/piano-lead/no-tail) is already applied, so only bpm+melody
    // need updating.
    if (backingPlayerMelody && backingPlayerMelodyKind === input.kind) {
      backingPlayerMelody.stop();
      backingPlayerMelody.setChart(chart);
      backingPlayerMelody.setConfig({ bpm: tempo, melody });
      backingPlayerMelodySig = sig;
      return backingPlayerMelody;
    }

    // Different kind (or first build) → (re)create with that kind's full preset.
    if (backingPlayerMelody) {
      if (active === backingPlayerMelody) active = null;
      backingPlayerMelody.dispose();
      backingPlayerMelody = null;
      backingPlayerMelodySig = null;
      backingPlayerMelodyKind = null;
    }

    const seed: BackingConfig = {
      bpm: tempo,
      melody,
    };
    if (config.style !== undefined) seed.style = config.style;
    if (config.feel !== undefined) seed.feel = config.feel;
    if (config.loop !== undefined) seed.loop = config.loop;
    if (config.repeatCount !== undefined) seed.repeatCount = config.repeatCount;
    if (config.pianoComp1And3 !== undefined) seed.pianoComp1And3 = config.pianoComp1And3;

    // Lick mode:
    //  - play ONCE through (no infinite loop / no repeats),
    //  - pin the lead line to piano (don't follow the global sax/flute setting),
    //  - keep the rhythm section AUDIBLE so the lick sits over a swing groove
    //    (drums/bass/piano comp at the user's mixer volumes — no longer muted).
    if (input.kind === "lick") {
      seed.loop = false;
      seed.repeatCount = 1;
      seed.melodyInstrument = "piano";
      seed.pianoReverb = 0.5;
      // End the instant the phrase finishes (no 6s reverb tail) so the card's
      // Stop button flips back to Play right when one pass completes.
      seed.endingTail = false;
    }

    backingPlayerMelody = factories.createBackingPlayer(chart, seed);
    backingPlayerMelodySig = sig;
    backingPlayerMelodyKind = input.kind;
    wireBackingPlayerMelody(backingPlayerMelody);
    return backingPlayerMelody;
  }

  function computeMelodySig(input: { kind: string; data: NoteSheetData; extraParts?: NoteSheetData[] }): string {
    // Identity proxy — same convention as computeBackingSig. The kind is part
    // of the signature so toggling sheet↔lick forces a rebuild. `key` busts the
    // cache on transpose. A content hash of the actual notes/chords is included
    // because title + key + measure count ALONE collide badly for licks — the
    // lick database has many short, same-length, untitled fragments, so two
    // different licks produced an identical signature and the second one reused
    // the FIRST lick's cached engine (→ playing the wrong/previous lick).
    const d = input.data;
    return (
      input.kind +
      "|" +
      (d.title ?? "?") +
      "/" +
      (d.key ?? "?") +
      "/" +
      (d.measures?.length ?? 0) +
      "/" +
      hashMeasures(d.measures) +
      // Multi-part: bust the cache when the set of extra parts changes
      // (switching part / toggling 전체보기 must rebuild the merged melody).
      "/" +
      (input.extraParts?.length ?? 0) +
      ":" +
      (input.extraParts ?? []).map((p) => hashMeasures(p.measures)).join(",")
    );
  }

  /** Cheap rolling hash over a sheet's note/chord content — enough to tell two
   *  distinct phrases apart in the melody-engine cache key. */
  function hashMeasures(measures: NoteSheetData["measures"] | undefined): string {
    let h = 0;
    const mix = (s: string | undefined) => {
      if (!s) return;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    };
    for (const m of measures ?? []) {
      mix(m.chord);
      for (const n of m.notes ?? []) {
        mix(n.duration);
        for (const k of n.keys ?? []) mix(k);
      }
      h = (Math.imul(h, 31) + 1) | 0; // measure boundary marker
    }
    return (h >>> 0).toString(36);
  }

  function computeBackingSig(input: ChartInput): string {
    const data: LeadSheetData = input.data;
    // title/style/system-count PLUS a rolling hash of the chord CONTENT.
    // The old proxy ignored chord symbols, so editing a chord on the same
    // chart (system count unchanged) silently kept playing the stale
    // pre-edit chart from the cached engine — and contrary to the old
    // comment here, stop() does NOT clear backingPlayerSig, so a content
    // hash is the only reliable invalidation. (The melody path solved the
    // identical bug with hashMeasures — its comment records a real
    // two-licks-collided incident.)
    let h = 0;
    const mix = (str: string | undefined) => {
      if (!str) return;
      for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    };
    for (const sys of data.systems ?? []) {
      for (const bar of sys.bars ?? []) {
        for (const c of bar.chords ?? []) {
          mix(c?.root); mix(c?.accidental); mix(c?.quality);
          mix(c?.bass?.root); mix(c?.bass?.accidental);
          if (c?.durationBeats != null) mix(String(c.durationBeats));
        }
        h = (Math.imul(h, 31) + 1) | 0; // bar boundary
      }
      h = (Math.imul(h, 31) + 7) | 0; // system boundary
    }
    const id =
      (data.title ?? "?") +
      "/" +
      (data.style ?? "?") +
      "/" +
      (data.systems?.length ?? 0) +
      "/" +
      (h >>> 0).toString(36);
    return "rule|" + id;
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
      return { engine: bp, unifiedMelody: true };
    }
    const bp = ensureBackingPlayer(input);
    active = bp;
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
        if (!active) active = bp;
        await bp.preload();
        return;
      }
      const bp = ensureBackingPlayer(input);
      if (!active) active = bp;
      await bp.preload();
    } catch (err) {
      emit("error", err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /** Is the engine for `input` already loaded (instant play)? Reads the
   *  existing engine without instantiating one — an absent engine is "not
   *  ready", so the page preloads first. Lets the page show "준비 중" + load
   *  BEFORE the count-in on a cold start, then count-in straight into playback. */
  function isReady(input: PlayerInput): boolean {
    const bp = getCandidate(input);
    return bp ? bp.isReady() : false;
  }

  /** Resume the input's engine ctx synchronously, inside the user gesture.
   *  Ensures the engine exists (creating it if the mount-warmup preload hasn't
   *  run for this input yet) so its AudioContext is both created AND resumed
   *  within the gesture — see the GlobalPlayer interface doc. Without this the
   *  first play after a cold page entry stays silent (play()'s resume fires
   *  ~2s later, after the count-in, when the gesture has expired). */
  function unlock(input: PlayerInput): void {
    const bp = isMelodyInput(input)
      ? ensureBackingPlayerForSheet(
          input as { kind: "sheet" | "lick" | "solo"; data: NoteSheetData },
        )
      : ensureBackingPlayer(input);
    if (!active) active = bp;
    bp.unlock();
  }

  async function play(
    input: PlayerInput,
    opts: { startAt?: number; measureOffset?: number; downbeatInSec?: number } = {},
  ): Promise<void> {
    try {
      // Stash the measureOffset for the unified path's `wireBackingPlayerMelody`
      // to bias `bar`/`note` events. Applied before activate() so the wiring
      // (which may have been attached on a previous play() call) uses the new
      // offset.
      backingPlayerMelodyOffset = opts.measureOffset ?? 0;
      const handle = activate(input);
      // startAt은 '실제로 재생할 엔진의 ctx' 기준으로 계산해야 한다. 카운트인이 주는
      // downbeatInSec(상대 오프셋, cross-ctx 안전)을 그 엔진의 ctxNow()에 더한다. 예전엔
      // 호출부가 전역 ctxNow()(=active 엔진)로 절대 startAt을 만들었는데, 코드차트는
      // active가 시트 엔진(앱루트 워밍업)일 때 '다른 AudioContext'의 시각이 섞여
      // 첫 재생이 "1 2 3 4 후 무음"이 됐다(이벤트가 먼 미래로 스케줄).
      const startAt = opts.downbeatInSec != null
        ? handle.engine.ctxNow() + opts.downbeatInSec
        : opts.startAt;
      await handle.engine.play({ startAt });
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
    // `mi` is a DISPLAYED measure index. Anacrusis songs strip the pickup bar
    // and bias bar/note events by `backingPlayerMelodyOffset` (see
    // wireBackingPlayerMelody), so translate back to the backing chart's bar
    // index before seeking.
    active.seekToBar(mi - backingPlayerMelodyOffset);
  }

  function setConfig(patch: Partial<GlobalPlayerConfig>): void {
    config = { ...config, ...patch };

    // Mixer patches go through the global store; both inner engines
    // already subscribe so the value propagates without us touching them.
    if (patch.mixer) {
      setPlayerSettings(patch.mixer);
    }

    // Fan out engine fields (bpm/style/feel/loop/repeatCount) to BOTH inner
    // engine instances directly — NOT gated on `active`. The user typically
    // sets these (e.g. the "3x" repeat control, or a sheet's tempo) before
    // pressing play, when `active` is still null; gating on `active` silently
    // dropped the value. Crucially we must reach `backingPlayerMelody` too:
    // the note-analysis (sheet/lick/solo) path plays through that instance,
    // and its tempo is seeded as `config.bpm ?? data.tempo` — so a stale
    // orchestrator bpm from a previously-played song would override the new
    // song's own tempo (e.g. Confirmation @208 playing back at the prior
    // song's ~120) unless this setConfig actually propagates to it.
    const bpPatch: Partial<BackingConfig> = {};
    if ("bpm" in patch) bpPatch.bpm = patch.bpm;
    if ("style" in patch) bpPatch.style = patch.style;
    if ("feel" in patch) bpPatch.feel = patch.feel;
    if ("loop" in patch) bpPatch.loop = patch.loop;
    if ("repeatCount" in patch) bpPatch.repeatCount = patch.repeatCount;
    if ("pianoComp1And3" in patch) bpPatch.pianoComp1And3 = patch.pianoComp1And3;
    // breakBeats go to BOTH engines — chart (Chord Analysis) and melody
    // (Note Analysis). The engine's gate excludes melody events, so the lead
    // line keeps playing; only the backing rests.
    if ("breakBeats" in patch) bpPatch.breakBeats = patch.breakBeats;
    // Melody only goes to the CHART engine — it's the inline-lick-over-chord-
    // chart track. The melody engine (sheet/lick/solo) gets its melody from its
    // own NoteSheetData seed, not from here.
    if ("melody" in patch) bpPatch.melody = patch.melody;
    // Practice region loop is chart-only too (confines the Chord Analysis
    // backing); the melody/sheet engine must not inherit it.
    if ("loopRegion" in patch) bpPatch.loopRegion = patch.loopRegion;
    if (Object.keys(bpPatch).length > 0) {
      backingPlayer?.setConfig(bpPatch);
      // Strip CHART-only fields (inline-lick `melody` + `loopRegion`) before
      // forwarding to the melody/sheet engine — it owns its own track and range.
      if (backingPlayerMelody) {
        const { melody: _m, loopRegion: _lr, ...rest } = bpPatch;
        if (Object.keys(rest).length > 0) backingPlayerMelody.setConfig(rest);
      }
    }
  }

  function getConfig(): GlobalPlayerConfig {
    return { ...config };
  }

  function ctxNow(): number {
    return active?.ctxNow() ?? backingPlayerMelody?.ctxNow() ?? backingPlayer?.ctxNow() ?? 0;
  }

  /* ── Anacrusis (pickup-note) scheduling ──────────────────────────── */

  function getAnacrusisPlayer(): AnacrusisPlayer {
    // If active changed since we created the anacrusis player, the old
    // ctx is stale (or closed). Tear down and rebuild against the new ctx
    // so picking-up notes line up with p.ctxNow().
    // ALSO compare the held ctx instance: a BackingPlayer can recreate its
    // ctx in place (poisoned-resume recovery) — owner identity then matches
    // while the anacrusis player still holds the CLOSED ctx, silently
    // dropping every pickup note.
    const activeCtx = active?.getCtx?.() ?? null;
    const heldCtx = notePlayerAnacrusis?.getCtx() ?? null;
    if (
      notePlayerAnacrusis && active &&
      (anacrusisCtxOwner !== active ||
        (anacrusisCtxOwner === active && activeCtx !== null && heldCtx !== activeCtx))
    ) {
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
    isReady,
    unlock,
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

/* Register the singleton with the process-wide audio kill switch so the
 * app shell (route change / error boundary / page-hide) can cut its sound
 * without importing this smplr-heavy module. The fn is stable and no-ops
 * whenever the singleton is absent or nothing is playing — cancelAnacrusis
 * also kills any scheduled-but-not-yet-sounding pickup notes. */
registerAudioStopper(() => {
  try { _singleton?.cancelAnacrusis(); } catch { /* */ }
  try { _singleton?.stop(); } catch { /* */ }
});

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
