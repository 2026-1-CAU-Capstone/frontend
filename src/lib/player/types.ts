/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayer — Unified player Core types.
 *
 * This file defines the public surface of the unified player layer
 * (Approach B in the Unified Player Architecture design doc). The
 * orchestrator (`GlobalPlayer`) wraps the two concrete engines —
 * the `BackingPlayer` family
 * (`lib/backing/player.ts`, `lib/yamaha-sty/sty-backing-player.ts`,
 * `lib/yamaha-sty/hybrid-backing-player.ts`) — and exposes a single
 * uniform API to React pages.
 *
 * Why a discriminated union for `PlayerInput`?
 *   • `NoteSheetData` (sheet/lick/solo) and `LeadSheetData` (chart) are
 *     genuinely different inputs. Forcing them into one shape would leak
 *     notation parsing into chord-chart playback or bolt the `Chart`
 *     model onto melody rendering — both are impedance mismatches.
 *   • The `kind` tag lets the orchestrator route to the correct inner
 *     engine and emit the correct event payload (`onNote` for melody
 *     kinds, `onBar`/`onChord` for the chart kind).
 *
 * Migration callers (page-level):
 *   • Pages that previously instantiated a per-page lick player →
 *     `play({ kind: 'lick', data: sheetData })`.
 *   • Pages that previously instantiated a per-page melody player →
 *     `play({ kind: 'sheet', data: sheetData })`.
 *   • Pages with hand-rolled Soundfont schedulers (EditorPage,
 *     SoloGeneratorPage, Lick12KeyPage) →
 *     `play({ kind: 'solo' | 'lick', data: measureInfoToNoteSheet(...) })`.
 *   • ChordPage's `createBackingPlayer` / `createStyBackingPlayer` /
 *     `createHybridBackingPlayer` direct calls →
 *     `play({ kind: 'chart', data: leadSheet, engineBackend })`.
 *
 * Out of scope for this Core layer (see design Section 7):
 *   • `PianoKeyboard.playMidi()` single-note audition — stays as-is.
 *   • Cross-engine simultaneous playback (melody engine atop
 *     BackingPlayer chart) — both engines own their own AudioContext.
 *   • Unifying `soundfont-player` vs `smplr` piano libraries.
 * ──────────────────────────────────────────────────────────────────── */

import type { NoteSheetData } from "../../data/sampleMelody";
import type { LeadSheetData } from "../../data/leadSheetTypes";
import type { MelodyNote } from "../backing/adapters/noteSheetToChart";
import type {
  BackingPlayer,
  BackingConfig,
  StyleId,
  FeelId,
} from "../backing/types";
import type { PlayerSettings } from "../note/playerSettings";

/* ─── Engine backend selector ────────────────────────────────────────── */

/**
 * Engine backend for the `chart` kind only.
 * Mirrors `EngineBackend` from `components/backing/BackingPlayerBar.tsx`
 * — re-declared here so the player core has no React/UI dependency.
 *
 *  - "rule"   : procedural engine in `lib/backing/player.ts`
 *  - "sty"    : Yamaha .sty engine in `lib/yamaha-sty/sty-backing-player.ts`
 *  - "hybrid" : combined rule (bass+drums) + sty (piano/horns/etc.)
 */
export type EngineBackend = "rule" | "sty" | "hybrid";

/* ─── PlayerInput discriminated union ────────────────────────────────── */

/**
 * Sheet kind — full notation playback with melody + comp + bass + drums.
 * The active engine is the melody-side BackingPlayer (no lickMode).
 */
export interface SheetInput {
  kind: "sheet";
  data: NoteSheetData;
}

/**
 * Lick kind — audition mode: melody is boosted, rhythm section is
 * silenced, piano reverb is maxed so the line sits over a soft pad.
 * The active engine is the melody-side BackingPlayer with lick-mode mix
 * (rhythm section silenced).
 */
export interface LickInput {
  kind: "lick";
  data: NoteSheetData;
}

/**
 * Solo kind — same engine path as `sheet` (full rhythm section, piano
 * melody) but signals to consumers that this is a generated/edited
 * transcription. Reserved for `EditorPage` / `SoloGeneratorPage`
 * migrations: those pages may later want to differentiate solo defaults
 * (e.g., metronome on, different starting BPM) without affecting normal
 * sheet playback. The orchestrator caches a separate BackingPlayer
 * instance for `solo` so future solo-specific config can be applied
 * without disturbing sheet playback.
 */
export interface SoloInput {
  kind: "solo";
  data: NoteSheetData;
}

/**
 * Chart kind — chord chart backing track (no melody). The active engine
 * is one of the BackingPlayer family, selected by `engineBackend`.
 * Defaults to "rule" if omitted.
 */
export interface ChartInput {
  kind: "chart";
  data: LeadSheetData;
  engineBackend?: EngineBackend;
  /** Optional pre-loaded .sty bytes for sty/hybrid backends (so we don't
   *  refetch a user-uploaded style from IndexedDB on every play()). */
  styleData?: ArrayBuffer;
  /** Optional .sty URL override (defaults to '/styles/psBase.sst'). */
  styleUrl?: string;
}

export type PlayerInput =
  | SheetInput
  | LickInput
  | SoloInput
  | ChartInput;

/* ─── Chord symbol (for chart kind's onChord event) ──────────────────── */

/**
 * Minimal chord identification fired on `onChord`. We deliberately do NOT
 * re-export `lib/backing/types::Chord` here: that type carries beat /
 * symbol metadata that's specific to the rendered chart, and pages just
 * want to know "what chord is sounding now". The orchestrator builds this
 * from the current bar's chord array on each `onBar` tick.
 */
export interface ChordSymbol {
  /** Display text (e.g. "Cmaj7", "F#7b9"). Source of truth = original
   *  chart symbol so the page can format it however it likes. */
  symbol: string;
  /** Root pitch class 0..11, for downstream highlighting / analysis. */
  root?: number;
  /** Optional slash-chord bass pitch class. */
  bass?: number;
}

/* ─── Unified player configuration ───────────────────────────────────── */

/**
 * Configuration the page can apply via `setConfig()`. The orchestrator
 * fans these out to the active inner engine and/or the global
 * `playerSettings` store:
 *
 *  - `bpm` / `style` / `feel` / `loop` / `repeatCount`
 *      → routed to the active inner engine (BackingPlayer.setConfig
 *        for chart kind, or playerSettings + replay for
 *        sheet/lick/solo kinds).
 *
 *  - `mixer`
 *      → written through to `setPlayerSettings(patch.mixer)`. Both
 *        inner engines subscribe to this store, so the patch
 *        propagates automatically.
 *
 *  - `countInBeats`
 *      → consumed by the page-level count-in hook (`useCountInIntro`)
 *        rather than by the inner engines. We declare it here for
 *        completeness so a single `setConfig` call can stage everything;
 *        the orchestrator stores it and exposes it via
 *        `player.getConfig().countInBeats` for the page to read.
 */
export interface GlobalPlayerConfig {
  bpm?: number;
  style?: StyleId;
  feel?: FeelId;
  loop?: boolean;
  repeatCount?: number;
  countInBeats?: number;
  /** Optional melody track injected into the CHART engine — used to play an
   *  inline lick over the chord chart at its anchor bars. Notes carry absolute
   *  beatOffsets (already shifted to the lick's position in the chart). Set to
   *  [] / undefined to clear. */
  melody?: MelodyNote[];
  /** Break Editor "stop-time" rests. Forwarded to BOTH inner backing engines
   *  (chart + melody) so the backing is silenced on Chord Analysis and Note
   *  Analysis alike, while each page's melody/metronome play straight through.
   *  Each entry = { bar (flat index), beat (1-based) }. */
  breakBeats?: Array<{ bar: number; beat: number }>;
  /** Bypass path — writes through to the global `playerSettings` store. */
  mixer?: Partial<PlayerSettings>;
}

/* ─── Anacrusis (pickup-note) scheduling ─────────────────────────────── */

/**
 * Single pickup-note descriptor for `scheduleAnacrusis()`. Times are in
 * the active engine's AudioContext clock — callers should anchor `startAt`
 * relative to `player.ctxNow()`.
 */
export interface AnacrusisNote {
  /** MIDI note number (0..127). */
  pitch: number;
  /** Per-note velocity in 0..1. If omitted, the engine's default gain
   *  (tied to the mixer's melody volume) is used. */
  velocity?: number;
  /** Sustain length in seconds. */
  durationSec: number;
  /** Absolute AudioContext time at which the note begins. Use
   *  `player.ctxNow() + offset` to compute. */
  startAt: number;
}

/* ─── Event bus ──────────────────────────────────────────────────────── */

/**
 * Event types emitted on the unified bus. Not every event fires for
 * every kind — see the per-event notes:
 *
 *  - `bar(barIndex)`      — fires for chart/sheet/lick/solo.
 *  - `chord(c, barIndex)` — fires for chart only (sheet/lick/solo don't
 *                           consume a Chart, so there's no per-bar chord
 *                           model to read).
 *  - `note(mi, ni)`       — fires for sheet/lick/solo only (chart has no
 *                           melody track). `mi` is the source-measure
 *                           index, `ni` the note index within the
 *                           measure.
 *  - `done()`             — natural end of playback (no auto-loop).
 *  - `error(err)`         — engine failure (asset load, audio context, …).
 *  - `drumKitError(err)`  — drum-kit asset load failure surfaced from an
 *                           inner engine. Separate channel because pages
 *                           typically show a non-fatal toast and keep
 *                           playing with the synth fallback, rather than
 *                           treating it as a hard error.
 */
export interface GlobalPlayerEvents {
  bar: (barIndex: number) => void;
  chord: (chord: ChordSymbol, barIndex: number) => void;
  note: (mi: number, ni: number) => void;
  done: () => void;
  error: (err: Error) => void;
  drumKitError: (err: Error | string) => void;
}

/* ─── Public player interface ────────────────────────────────────────── */

/**
 * The unified player. One instance lives in the React context;
 * `useGlobalPlayer()` returns it (and reactive state derived from
 * events). All methods are safe to call before any `play()` —
 * the orchestrator lazy-instantiates the inner engines on demand.
 *
 * Method semantics:
 *  - `preload(input)`  — warm up the engine and its assets for `input`.
 *  - `play(input)`     — start (or restart) with `input`. Stops any
 *                        previous engine; switches engines as needed.
 *  - `pause()`         — pause the currently active engine. No-op if not
 *                        playing.
 *  - `stop()`          — stop and reset the active engine.
 *  - `seekToMeasure()` — sheet/lick/solo only (delegates to the melody engine).
 *                        No-op for chart.
 *  - `setConfig()`     — apply config patch (see GlobalPlayerConfig).
 *  - `ctxNow()`        — current AudioContext time of the active engine
 *                        (or 0 if no engine is active). Used by count-in
 *                        hooks to bridge clocks.
 *  - `on(ev, cb)`      — subscribe to an event; returns unsubscribe fn.
 *  - `dispose()`       — release all engines and audio contexts.
 */
export interface GlobalPlayer {
  readonly playing: boolean;
  readonly currentInput: PlayerInput | null;
  preload(input: PlayerInput): Promise<void>;
  play(
    input: PlayerInput,
    opts?: { startAt?: number; measureOffset?: number },
  ): Promise<void>;
  pause(): void;
  stop(): void;
  seekToMeasure(mi: number): void;
  setConfig(patch: Partial<GlobalPlayerConfig>): void;
  getConfig(): GlobalPlayerConfig;
  ctxNow(): number;
  /**
   * Schedule anacrusis (pickup) notes for melody playback. Delegates to
   * an internal `AnacrusisPlayer` instance so pages no longer need to
   * construct their own player just for pickup scheduling. Notes are routed
   * through the same melody instrument as `play({ kind: 'sheet' | 'lick'
   * | 'solo' })`. Schedule before the main `play()` call begins.
   */
  scheduleAnacrusis(notes: AnacrusisNote[]): void;
  /**
   * Cancel any pending anacrusis notes previously queued with
   * `scheduleAnacrusis`. Safe to call when nothing is scheduled.
   */
  cancelAnacrusis(): void;
  on<K extends keyof GlobalPlayerEvents>(
    ev: K,
    cb: GlobalPlayerEvents[K],
  ): () => void;
  dispose(): void;
}

/* ─── Internal engine handles (for orchestrator implementation) ──────── */

/**
 * Re-exports used inside the orchestrator. Pages should NOT import these
 * — they should depend only on `GlobalPlayer` / `PlayerInput` /
 * `GlobalPlayerConfig` / `GlobalPlayerEvents`.
 */
export type {
  BackingPlayer,
  BackingConfig,
  StyleId,
  FeelId,
  NoteSheetData,
  LeadSheetData,
  PlayerSettings,
};
