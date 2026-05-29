import type { DrumEvent, DrumPiece, FeelId } from "./types";
import { getSwingRatio } from "../note/swing";

/* ─────────────────────────────────────────────────────────────────────────
 * Drum pattern generators.
 *
 * Phase 0: classic medium-swing "spang-a-lang" ride pattern.
 *   ride on beats 1,2,3,4 (quarters)
 *   ride swung 8th "a" between beats 2&3 and 4&1 (triplet 3rd of beats 2 and 4)
 *   hi-hat foot chick on beats 2 and 4 (backbeat)
 *
 * Phase 1:  latin family (bossa, samba, afro-cuban 6/8, songo)
 * Phase 1.5: feel modifiers (half-time / double-time / straight-8)
 * Phase 2:   figure rendering (bar-scoped band hits)
 *
 * Stage-2 PATCH #5: per-style bar renderers (mediumSwing, ballad, upTempo,
 * newOrleans, even8ths, bossa, latin, latinSwing) routed by `renderDrumBar`.
 * The legacy `swingBar` / `bossaBar` exports remain so existing call sites
 * keep working until the engine migrates fully.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DrumBarOptions {
  /** Seconds per beat (60 / bpm). */
  secPerBeat: number;
  /** Absolute bar start time in seconds. */
  barStart: number;
  /** Beats per bar (time signature numerator). */
  beatsInBar: number;
  /** Feel override (defaults to the parent style's swing feel). */
  feel?: FeelId;
  /** Flat bar index across the chart, for event tagging. */
  barIndex: number;
}

/** Swung 8th lands at 2/3 through the beat (triplet 3rd). */
const SWING_OFFSET = 2 / 3;

/** Build a beat-offset → seconds projector for a given swing ratio.
 *  Mirrors the math in lib/note/swing.ts so 8th-note "a" hits land at
 *  the same place the bass/piano use. ratio = 0.5 → straight 8ths. */
function makeBeatToSec(secPerBeat: number, swingRatio: number) {
  return (beat: number): number => {
    if (swingRatio === 0.5) return beat * secPerBeat;
    const whole = Math.floor(beat);
    const frac = beat - whole;
    const swung =
      frac < 0.5
        ? whole + frac * (swingRatio / 0.5)
        : whole + swingRatio + (frac - 0.5) * ((1 - swingRatio) / 0.5);
    return swung * secPerBeat;
  };
}

/* ─── Medium Swing (classic spang-a-lang) ──────────────────────────────── */

/**
 * Medium swing pattern — classic ride + PHH backbeat + feathered kick + snare
 * comping. Ride hits use GM 71 internally (mapped to "ride" via gm-drum-map).
 */
export function mediumSwingBar(opts: DrumBarOptions, bpm: number): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const swingRatio = getSwingRatio(bpm, "medium-swing");
  const beatToSec = makeBeatToSec(secPerBeat, swingRatio);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Ride — quarters with slight accent on 1 & 3
  push(0, "ride", 0.72);
  push(1, "ride", 0.62);
  push(2, "ride", 0.70);
  push(3, "ride", 0.62);
  // Swung 8ths — the "a" of 2 and 4
  push(1.5, "ride", 0.48);
  push(3.5, "ride", 0.48);

  // PHH on backbeats (2 & 4)
  push(1, "hihat-foot", 0.95);
  push(3, "hihat-foot", 0.95);

  // Feathered kick on every beat (1 & 3)
  push(0, "kick", 0.45);
  push(1, "kick", 0.38);
  push(2, "kick", 0.45);
  push(3, "kick", 0.38);

  // Snare comping
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    push(offset, "snare", vel);
  }

  if (barIndex % 8 === 7) {
    push(3.5, "snare", 0.95);
  }

  return events;
}

/* ─── Ballad Swing (no ride — felt kick + low tom + clap) ──────────────── */

/**
 * Ballad swing — drummer drops the ride and rides on brush sweeps in real
 * life. We approximate that here with a soft kick + low floor tom doubled
 * on every beat, plus a sparse hand-clap on the "a" of 2 and 4. Swing ratio
 * is wider (0.667 triplet feel) per the iReal ballad measurement.
 */
export function balladBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.667);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Soft kick + tom-low pulse on every beat — felt more than heard.
  // GM 35 = kick (already mapped), GM 41 = Low Floor Tom → "tom-low".
  for (let b = 0; b < 4; b++) {
    push(b, "kick", 0.42);
    push(b, "tom-low", 0.38);
  }

  // Hand-clap on the "a" of 2 and 4 (GM 39 → currently mapped to "clap"
  // which is outside the DrumPiece union — fall back to "rim" so the
  // type stays sound until a clap voice exists).
  push(1.75, "rim", 0.55);
  push(3.75, "rim", 0.55);

  return events;
}

/* ─── Up-tempo Swing (tighter swing ratio) ─────────────────────────────── */

/**
 * Up-tempo swing — same skeleton as medium swing but the swing ratio
 * compresses toward straight (0.621) per the iReal up-tempo measurement.
 */
export function upTempoBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.621);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Ride quarters + swung 8ths
  push(0, "ride", 0.72);
  push(1, "ride", 0.62);
  push(2, "ride", 0.70);
  push(3, "ride", 0.62);
  push(1.5, "ride", 0.50);
  push(3.5, "ride", 0.50);

  // PHH on 2 & 4
  push(1, "hihat-foot", 0.92);
  push(3, "hihat-foot", 0.92);

  // Lighter feathered kick at fast tempos
  push(0, "kick", 0.38);
  push(2, "kick", 0.38);

  // Snare comping (same library, rotates with bar index)
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    push(offset, "snare", vel);
  }

  return events;
}

/* ─── New Orleans Swing (straight 8ths, second-line snare) ─────────────── */

/**
 * New Orleans / second-line — the snare drives every beat (GM 38) with a
 * doubled hit at +0.75 to imitate the parade-style drag. PHH on 2 & 4.
 * Straight subdivision (1.0).
 */
export function newOrleansBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5); // straight

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Snare every beat + +0.75 second-line drag
  for (let b = 0; b < 4; b++) {
    push(b, "snare", 0.62);
    push(b + 0.75, "snare", 0.48);
  }

  // PHH on backbeats
  push(1, "hihat-foot", 0.88);
  push(3, "hihat-foot", 0.88);

  // Kick on 1 & 3
  push(0, "kick", 0.55);
  push(2, "kick", 0.52);

  return events;
}

/* ─── Even-8ths (straight rock/funk feel) ──────────────────────────────── */

/**
 * Even-8ths — relentless ride (GM 51) on every 8th + PHH on every 8th.
 * Straight subdivision (1.0). Kick on 1 & 3, snare on 2 & 4.
 */
export function even8thsBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Ride on every 8th
  for (let i = 0; i < 8; i++) {
    const beat = i * 0.5;
    const onDownbeat = i % 2 === 0;
    push(beat, "ride", onDownbeat ? 0.68 : 0.50);
    push(beat, "hihat-foot", onDownbeat ? 0.45 : 0.32);
  }

  // Kick on 1 & 3, snare on 2 & 4
  push(0, "kick", 0.78);
  push(2, "kick", 0.78);
  push(1, "snare", 0.72);
  push(3, "snare", 0.72);

  return events;
}

/* ─── Bossa Nova (re-implemented w/ ride + sidestick + clave) ──────────── */

/**
 * Bossa Nova — ride (GM 71) straight 8ths, kick on the surdo pattern, and
 * a 2-bar clave-flavoured side-stick (GM 37 → "rim" in our piece set).
 */
export function bossaBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Ride straight 8ths
  for (let i = 0; i < 8; i++) {
    const beat = i * 0.5;
    const onDownbeat = i % 2 === 0;
    push(beat, "ride", onDownbeat ? 0.58 : 0.42);
  }

  // Surdo-style kick
  push(0,   "kick", 0.78);
  push(1.5, "kick", 0.62);
  push(2,   "kick", 0.78);
  push(3.5, "kick", 0.62);

  // Side-stick (rim) — 2-bar clave alternation
  const evenBar = barIndex % 2 === 0;
  if (evenBar) {
    push(0,   "rim", 0.7);
    push(1.5, "rim", 0.72);
    push(2.5, "rim", 0.72);
  } else {
    push(0,   "rim", 0.7);
    push(1,   "rim", 0.68);
    push(2.5, "rim", 0.72);
    push(3,   "rim", 0.68);
  }

  return events;
}

/* ─── Latin (paired ride bell + conga emulation) ───────────────────────── */

/**
 * Latin — paired ride-bell (GM 53) and ride2 (GM 59) on a cha-cha-flavoured
 * rhythm. LowTom (GM 45 → "tom-low") + HiFloorTom (GM 43 → "tom-low") play
 * the conga part. SideStick (GM 37 → "rim") plays the clave. Straight 1.0.
 */
export function latinBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat),
      velocity,
      bar: barIndex,
    });
  };

  // Paired ride-bell + ride — cha-cha pulse on every 8th, accent every beat
  for (let i = 0; i < 8; i++) {
    const beat = i * 0.5;
    const onDownbeat = i % 2 === 0;
    push(beat, "ride-bell", onDownbeat ? 0.62 : 0.40);
    push(beat, "ride",      onDownbeat ? 0.50 : 0.32);
  }

  // Conga-style toms — open conga on 1 & 3, slap on the "and" of 2 & 4
  push(0,   "tom-low", 0.62);
  push(2,   "tom-low", 0.62);
  push(1.5, "tom-low", 0.48);
  push(3.5, "tom-low", 0.48);

  // Side-stick clave
  push(0,   "rim", 0.62);
  push(1.5, "rim", 0.62);
  push(2.5, "rim", 0.62);

  return events;
}

/* ─── Latin Swing (alternates latin & medium-swing bars) ───────────────── */

/**
 * Latin-swing — even bars play `latinBar` (straight), odd bars play
 * `mediumSwingBar` (swung). This mirrors the iReal "latin/swing" charts
 * where the band switches halfway through a section.
 */
export function latinSwingBar(opts: DrumBarOptions, bpm: number): DrumEvent[] {
  return opts.barIndex % 2 === 0
    ? latinBar(opts)
    : mediumSwingBar(opts, bpm);
}

/* ─── Legacy swingBar (retained for back-compat) ───────────────────────── */

/**
 * Legacy entry point — delegates to mediumSwingBar at the legacy SWING_OFFSET
 * cadence. Kept so existing engine call sites continue working until they
 * migrate to `renderDrumBar`.
 */
export function swingBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beat * secPerBeat,
      velocity,
      bar: barIndex,
    });
  };

  push(0, "ride", 0.72);
  push(1, "ride", 0.62);
  push(2, "ride", 0.70);
  push(3, "ride", 0.62);
  push(1 + SWING_OFFSET, "ride", 0.48);
  push(3 + SWING_OFFSET, "ride", 0.48);
  push(1, "hihat-foot", 0.95);
  push(3, "hihat-foot", 0.95);
  push(0, "kick", 0.45);
  push(1, "kick", 0.38);
  push(2, "kick", 0.45);
  push(3, "kick", 0.38);

  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    push(offset, "snare", vel);
  }
  if (barIndex % 8 === 7) {
    push(3 + SWING_OFFSET, "snare", 0.95);
  }
  return events;
}

/**
 * Rotating snare comping patterns (offset in beats → velocity).
 * Velocities are intentionally strong (0.7-0.85) so they sit clearly in
 * the mix after the drums volume multiplier (~0.9) is applied.
 */
const SNARE_PATTERNS: Array<Array<[number, number]>> = [
  [[2.0 + SWING_OFFSET, 0.72]],                              // "and of 3"
  [[3.0 + SWING_OFFSET, 0.78]],                              // "and of 4"
  [[0.0 + SWING_OFFSET, 0.68], [2.0 + SWING_OFFSET, 0.75]], // "and of 1" + "and of 3"
  [[1.0 + SWING_OFFSET, 0.74]],                              // "and of 2"
  [[3.0, 0.72]],                                             // downbeat of 4
  [[1.0 + SWING_OFFSET, 0.7], [3.0 + SWING_OFFSET, 0.82]],  // "and of 2" + "and of 4"
];

/* ─── Style → drum renderer dispatcher ─────────────────────────────────── */

/**
 * Single entry point: switches on the FeelId and dispatches to the matching
 * per-style bar renderer. Unknown / unhandled feels fall back to medium
 * swing so the playback never silently goes silent.
 */
export function renderDrumBar(
  opts: DrumBarOptions,
  feel: FeelId,
  bpm: number,
): DrumEvent[] {
  switch (feel) {
    case "ballad-swing":
      return balladBar(opts);
    case "up-tempo-swing":
      return upTempoBar(opts);
    case "new-orleans-swing":
      return newOrleansBar(opts);
    case "even-8ths":
    case "straight-8":
    case "straight-16":
      return even8thsBar(opts);
    case "bossa":
      return bossaBar(opts);
    case "latin":
      return latinBar(opts);
    case "latin-swing":
      return latinSwingBar(opts, bpm);
    case "swing":
    case "medium-swing":
    case "medium-up-swing":
    case "shuffle":
    case "half-time":
    case "double-time":
    default:
      return mediumSwingBar(opts, bpm);
  }
}
