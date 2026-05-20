/* ─────────────────────────────────────────────────────────────────────────
 * Backing track type schema
 *
 * Designed for progressive expansion. Phase 0 (MVP) only exercises a small
 * subset (StyleId="medium-swing", FeelId="swing", empty figures/unison), but
 * the full differentiation surface is declared now so later phases don't
 * require a schema rewrite.
 *
 * Phase roadmap:
 *   Phase 0  (MVP)  — rule-based medium swing: piano comping + walking bass + ride
 *   Phase 1         — Latin family (bossa/samba/afro-cuban 6/8/mambo/songo)
 *   Phase 1.5       — Feel modifiers (half-time/double-time/straight-8)
 *   Phase 2         — Section figures (band hits) + unison lines + stop-time/breaks
 *   Phase 3         — Style/feel changes mid-tune
 *   Phase 4         — Learned models behind the same interface
 * ──────────────────────────────────────────────────────────────────────── */

/* ─── Primitives ─────────────────────────────────────────────────────── */

/** Pitch class 0..11 (C=0, C#=1, ..., B=11). */
export type PitchClass = number;

/** MIDI note number 0..127. */
export type MidiNote = number;

/** Beats from the start of a bar. A value in [0, timeSig[0]). */
export type BeatOffset = number;

/** Duration in beats. */
export type BeatDuration = number;

/* ─── Chord model ────────────────────────────────────────────────────── */

/**
 * Normalized chord quality. Mirrors the vocabulary used by
 * lib/note/notePlayer.ts::VOICINGS so adapters can map cleanly.
 */
export type ChordQuality =
  // Major family
  | "maj" | "maj6" | "maj7" | "maj9"
  // Minor family
  | "min" | "min6" | "min7" | "min9" | "min11" | "minmaj7"
  // Dominant family
  | "dom7" | "dom9" | "dom13"
  | "7sus4" | "7alt" | "7#9" | "7b9" | "7#11" | "7b13"
  // Half-diminished / diminished
  | "min7b5" | "dim" | "dim7"
  // Augmented
  | "aug" | "aug7"
  // Sus
  | "sus2" | "sus4"
  // Power / unknown fallback
  | "5";

export interface Chord {
  /** Root pitch class (0..11). */
  root: PitchClass;
  quality: ChordQuality;
  /** Slash-chord bass pitch class (optional). */
  bass?: PitchClass;
  /** Beats this chord occupies within its bar. */
  beats: BeatDuration;
  /** Original symbol (for debugging/display). */
  symbol?: string;
}

/* ─── Style & Feel (two orthogonal axes) ─────────────────────────────── */

/**
 * StyleId is the genre/groove family. Each style owns its own pattern
 * library (piano voicing rules, bass approach, drum pattern).
 *
 * Phase 0 implements only "medium-swing". The rest are declared so
 * adapters and UI can accept them without type errors.
 */
export type StyleId =
  // Swing family (Phase 0)
  | "medium-swing" | "up-swing" | "ballad-swing" | "slow-swing"
  // Latin family (Phase 1)
  | "bossa" | "samba" | "afro-cuban-68" | "mambo" | "songo" | "cha-cha"
  // Other (Phase 1+)
  | "funk" | "rock" | "pop-ballad" | "rubato" | "waltz-jazz"
  // Fallback
  | "none";

/**
 * FeelId is orthogonal to StyleId: it modifies how the rhythm section
 * subdivides the beat. The same style can be played with different feels
 * (e.g. {style: medium-swing, feel: half-time} = "half-time swing").
 *
 * Phase 0 uses only "swing". Feels can be applied per-bar (B axis of the
 * differentiation plan — drummer responds to half-time/double-time cues).
 */
export type FeelId =
  | "swing"
  | "straight-8"
  | "straight-16"
  | "shuffle"
  | "half-time"
  | "double-time";

/* ─── Chart instructions (bar-level behaviors) ───────────────────────── */

/**
 * Non-musical directives the engine should honor on a given bar.
 * Phase 2 implements these; Phase 0 ignores them.
 */
export type BarInstruction =
  | "stop-time"   // rhythm section hits only on downbeat, then rest
  | "break"       // full rhythm section drops out (e.g. solo break)
  | "tag"         // repeat last N bars (structural)
  | "vamp"        // loop current bar until cue
  | "solo"        // marks bar as solo space (affects comping density)
  | "cue"         // fermata / hold until cue
  | "fill";       // drummer fill bar

/* ─── Section figures & unison lines (differentiation C & D) ─────────── */

/**
 * A rhythmic figure the ensemble plays in unison on top of the groove.
 * All listed instruments break their normal pattern and hit these beats.
 *
 * Example: a bar-4 kick pattern the band nails together at the end of the A section.
 *
 * Phase 0 ignores figures. Phase 2 implements parsing + rendering.
 */
export interface Figure {
  hits: FigureHit[];
  instruments: InstrumentSet;
  /** How emphatically the ensemble plays the figure. */
  accent?: "normal" | "hard" | "ghost";
}

export interface FigureHit {
  /** Beat offset within the bar, 0-based. */
  position: BeatOffset;
  /** Duration in beats. */
  duration: BeatDuration;
  /**
   * Optional pitched content. If present, pitched instruments play this.
   * If absent, only drums/percussion respond.
   */
  pitch?: MidiNote | MidiNote[];
}

/**
 * A unison melodic line spanning one or more beats inside a bar.
 * Differs from Figure in that unisons always carry pitches.
 */
export interface UnisonSpan {
  hits: Required<Pick<FigureHit, "position" | "duration" | "pitch">>[];
  instruments: InstrumentSet;
}

/* ─── Instruments ────────────────────────────────────────────────────── */

export type InstrumentId =
  | "piano"
  | "bass"
  | "drums"       // shorthand — engine picks which pieces to trigger
  | "guitar"
  | "vibes"
  | "horns";      // melody voice for unisons

/** Fine-grained drum pieces for precise figure/unison targeting. */
export type DrumPiece =
  | "kick" | "snare" | "rim"
  | "hihat-closed" | "hihat-open" | "hihat-foot"
  | "ride" | "ride-bell"
  | "crash" | "splash"
  | "tom-low" | "tom-mid" | "tom-high";

/**
 * Target instrument set for figures/unisons.
 * "all" = rhythm-section + horns; "rhythm-section" = piano+bass+drums.
 */
export type InstrumentSet =
  | "all"
  | "rhythm-section"
  | "horns"
  | InstrumentId[];

/* ─── Chart (normalized input to the engine) ─────────────────────────── */

export interface Bar {
  chords: Chord[];
  /** Feel override for this bar only (e.g. sudden half-time). */
  feel?: FeelId;
  /** Section figures the band plays on this bar. */
  figures?: Figure[];
  /** Unison line covering part or all of this bar. */
  unison?: UnisonSpan;
  /** Bar-level directive. */
  instruction?: BarInstruction;
  /** Original measure number (for UI sync / highlighting). */
  measureNumber?: number;
}

export interface Section {
  /** "A", "B", "Bridge", "Intro", etc. */
  label?: string;
  /** Style override for this section (Phase 3). */
  style?: StyleId;
  /** Feel override for this section (Phase 1.5). */
  feel?: FeelId;
  bars: Bar[];
  /** Repeat structure hints (from source chart). */
  repeatStart?: boolean;
  repeatEnd?: boolean;
  ending?: number;
}

export interface Chart {
  title?: string;
  composer?: string;
  key?: string;               // tonic, e.g. "F", "Bb", "Dm"
  bpm: number;
  timeSig: [number, number];  // e.g. [4,4], [3,4], [6,8]
  defaultStyle: StyleId;
  defaultFeel: FeelId;
  sections: Section[];
}

/* ─── Runtime events (engine output) ─────────────────────────────────── */

/** A scheduled musical event in absolute seconds from playback origin. */
export type BackingEvent = NoteEvent | DrumEvent;

export interface NoteEvent {
  kind: "note";
  instrument: Exclude<InstrumentId, "drums">;
  midi: MidiNote;
  /** Absolute time in seconds from playback origin. */
  time: number;
  /** Duration in seconds. */
  duration: number;
  /** 0..1 */
  velocity: number;
  /** Source bar index (flat, across sections) for UI sync. */
  bar: number;
}

export interface DrumEvent {
  kind: "drum";
  piece: DrumPiece;
  time: number;
  velocity: number;
  bar: number;
}

/* ─── Player configuration ───────────────────────────────────────────── */

/** Runtime configuration the user/UI can pass to createBackingPlayer. */
export interface BackingConfig {
  /** Override chart.bpm if set. */
  bpm?: number;
  /** Override chart.defaultStyle if set. */
  style?: StyleId;
  /** Override chart.defaultFeel if set. */
  feel?: FeelId;
  /** Toggle individual instruments (all default true). */
  enabled?: Partial<Record<Exclude<InstrumentId, "drums"> | "drums", boolean>>;
  /** 0..1 gain per instrument group. */
  volume?: Partial<Record<Exclude<InstrumentId, "drums"> | "drums", number>>;
  /** Count-in bars before playback starts (default 0). */
  countIn?: number;
  /**
   * Drum source mode.
   *  - "hit"  (default): per-hit sample triggering driven by drums.ts patterns
   *  - "loop": continuous real-recording loop, replacing all per-hit drums.
   *           Requires `drumLoop` to be set with the audio file URL and
   *           recorded BPM. Pitch will shift via playbackRate scaling.
   */
  drumMode?: "hit" | "loop";
  /** Drum loop source. Required when drumMode === "loop". The loop is
   * time-stretched offline (pitch-preserving) to match `bpm` exactly. */
  drumLoop?: {
    url: string;
    recordedBpm: number;
    gain?: number;
  };
  /** Piano reverb send level, 0..1. Drives the same wet bus loadInstruments
   * sets up. Default ~0.22 (matches the soundfont module's static value). */
  pianoReverb?: number;
  /** When true, playback wraps back to bar 0 after the last bar finishes
   *  (continuous chorus loop). When false, `onDone` fires and the player
   *  stops. Default true — backing tracks are practice loops. */
  loop?: boolean;
  /** Number of times the chart plays before stopping. When set (>=1) it takes
   *  precedence over `loop`: the song plays exactly this many times then fires
   *  `onDone`. Undefined → fall back to `loop` (infinite). */
  repeatCount?: number;
}

/* ─── Player lifecycle callbacks ─────────────────────────────────────── */

export interface BackingPlayerCallbacks {
  /** Fires when the playhead enters a new bar (flat index across sections). */
  onBar?: (barIndex: number) => void;
  /** Fires when playback finishes naturally. */
  onDone?: () => void;
}

/* ─── Public player interface ────────────────────────────────────────── */

export interface BackingPlayer {
  readonly playing: boolean;
  /** `opts.startAt` (AudioContext seconds, in THIS player's ctx clock) anchors
   *  the first event so it lands on the beat. Compute via
   *  `player.ctxNow() + cin.downbeatInSec` to bridge the count-in's separate
   *  AudioContext clock. */
  play(opts?: { startAt?: number }): Promise<void>;
  /** Pre-warm AudioContext + instruments + drum 자원 (count-in 과 병렬용). */
  preload(): Promise<void>;
  pause(): void;
  stop(): void;
  setConfig(next: Partial<BackingConfig>): void;
  dispose(): void;
  /** Audio-context time (sec). Returns 0 if ctx has not been created yet —
   *  call `preload()` first for a stable clock. */
  ctxNow(): number;
  /** Attach / replace a callback. */
  on<K extends keyof BackingPlayerCallbacks>(ev: K, cb: BackingPlayerCallbacks[K]): void;
}
