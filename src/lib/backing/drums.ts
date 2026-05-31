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

/** Extra lay-back (in beats) applied to the dominant "& of 3" snare comp in
 *  medium swing. iReal Pro plays it at frac ≈ 0.835 — about this far behind
 *  the ride's swung 8th (frac ≈ 0.708) — a characteristic fat, behind-the-beat
 *  comp. Only used at medium swing; up-tempo plays it on the grid. */
const SNARE_AND3_LAYBACK_BEATS = 0.127;

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
  // `extraSec` nudges a hit later than its swung grid position (used for the
  // behind-the-beat snare comp); defaults to 0 for everything else.
  const push = (beat: number, piece: DrumPiece, velocity: number, extraSec = 0) => {
    events.push({
      kind: "drum",
      piece,
      time: barStart + beatToSec(beat) + extraSec,
      velocity,
      bar: barIndex,
    });
  };

  // Ride — quarters (beat 2 leads), velocities sampled from iReal Pro's
  // medium-swing track. The swung "&" of 2 & 4 sit fuller than the old
  // ghosted value, matching iReal's prominent spang-a-lang.
  push(0, "ride", 0.65);
  push(1, "ride", 0.70);
  push(2, "ride", 0.65);
  push(3, "ride", 0.68);
  // Swung 8ths — the "a" of 2 and 4
  push(1.5, "ride", 0.64);
  push(3.5, "ride", 0.61);

  // PHH on backbeats (2 & 4) — iReal keeps the foot soft (~0.50), not the
  // hard chick the old value implied.
  push(1, "hihat-foot", 0.50);
  push(3, "hihat-foot", 0.50);

  // Feathered kick on every beat — barely-there in iReal (~0.24).
  push(0, "kick", 0.25);
  push(1, "kick", 0.24);
  push(2, "kick", 0.24);
  push(3, "kick", 0.24);

  // Snare comping — the "& of 3" (offset 2.5) is laid back behind the ride
  // grid to match iReal's fat, behind-the-beat comp; the rest lock to the grid.
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    const layback = offset === 2.5 ? SNARE_AND3_LAYBACK_BEATS * secPerBeat : 0;
    push(offset, "snare", vel, layback);
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

  // iReal's ballad has a very soft kick (~0.20) doubled by a Low Floor Tom
  // (~0.55) on every beat — felt more than heard.
  for (let b = 0; b < 4; b++) {
    push(b, "kick", 0.20);
    push(b, "tom-low", 0.55);
  }

  // PHH foot on 2 & 4.
  push(1, "hihat-foot", 0.39);
  push(3, "hihat-foot", 0.39);

  // Brush/hand-clap comp on the swung "&" of 2 and 4 (GM 39 clap → "rim",
  // the closest voice in our piece set).
  push(1.5, "rim", 0.39);
  push(3.5, "rim", 0.39);

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

  // Ride quarters + swung 8ths — iReal's up-tempo ride sits a touch lower
  // than medium swing; the swung "&" still rings clearly.
  push(0, "ride", 0.62);
  push(1, "ride", 0.64);
  push(2, "ride", 0.61);
  push(3, "ride", 0.64);
  push(1.5, "ride", 0.57);
  push(3.5, "ride", 0.59);

  // PHH on 2 & 4 — soft foot (iReal ~0.50).
  push(1, "hihat-foot", 0.50);
  push(3, "hihat-foot", 0.50);

  // Feathered kick on every beat (iReal keeps all four, barely audible).
  push(0, "kick", 0.24);
  push(1, "kick", 0.24);
  push(2, "kick", 0.24);
  push(3, "kick", 0.24);

  // Snare comping (same library, rotates with bar index)
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) {
    push(offset, "snare", vel);
  }

  return events;
}

/* ─── New Orleans Swing (straight 8ths, second-line snare) ─────────────── */

/**
 * New Orleans / second-line — transcribed from iReal Pro's "New Orleans
 * Swing" track. It's a *swung* feel (ride spang-a-lang), not the straight
 * pattern the old version used. Signature elements:
 *   • Swing ride on the quarters + swung "&" of 2 & 4.
 *   • "Big-four" kick: strong on beat 1, the swung "& of 2", and beat 4,
 *     with feathered taps on 2 & 3.
 *   • Continuous second-line snare across the beats and swung "&"s.
 *   • PHH on 2 & 4.
 */
export function newOrleansBar(opts: DrumBarOptions, bpm: number): DrumEvent[] {
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

  // Swing ride
  push(0, "ride", 0.66);
  push(1, "ride", 0.70);
  push(2, "ride", 0.66);
  push(3, "ride", 0.68);
  push(1.5, "ride", 0.64);
  push(3.5, "ride", 0.63);

  // PHH on 2 & 4
  push(1, "hihat-foot", 0.54);
  push(3, "hihat-foot", 0.54);

  // Big-four kick: beat 1, the swung "& of 2" (the accent, iReal hits 127),
  // beat 4; beats 2 & 3 feathered.
  push(0,   "kick", 0.74);
  push(1.5, "kick", 0.95);
  push(3,   "kick", 0.76);
  push(1,   "kick", 0.24);
  push(2,   "kick", 0.24);

  // Second-line snare — beats + swung "&"s, backbeat (2 & 4) accented.
  push(0,   "snare", 0.55);
  push(0.5, "snare", 0.50);
  push(1,   "snare", 0.64);
  push(1.5, "snare", 0.62);
  push(2,   "snare", 0.55);
  push(2.5, "snare", 0.58);
  push(3,   "snare", 0.64);
  push(3.5, "snare", 0.50);

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

  // Ride on every 8th — iReal keeps these fairly even (~0.55) with only a
  // slight downbeat lean.
  const RIDE_VEL = [0.60, 0.55, 0.55, 0.50, 0.58, 0.54, 0.50, 0.55];
  for (let i = 0; i < 8; i++) push(i * 0.5, "ride", RIDE_VEL[i]);

  // PHH on the quarters only (not every 8th), soft foot.
  push(0, "hihat-foot", 0.31);
  push(1, "hihat-foot", 0.31);
  push(2, "hihat-foot", 0.31);
  push(3, "hihat-foot", 0.31);

  // Kick on 1 and the "& of 3"; snare backbeat on 2 & 4.
  push(0,   "kick", 0.69);
  push(2.5, "kick", 0.66);
  push(1, "snare", 0.72);
  push(3, "snare", 0.74);

  return events;
}

/* ─── Bossa Nova (re-implemented w/ ride + sidestick + clave) ──────────── */

/**
 * Bossa Nova — transcribed bar-for-bar from iReal Pro's own bossa backing
 * track (its GM export of "Autumn Leaves / Jazz-Bossa Nova", drum track on
 * GM channel 10, ticks quantized to 16ths). Four voices:
 *   • Ride (GM 71)      — straight 8ths with iReal's velocity contour.
 *   • Surdo kick (GM 35)— 1, "&2", 3, "&4"; beat 3 is the strongest hit.
 *   • Pedal hi-hat (44) — soft chick on 2 & 4.
 *   • Cross-stick (37→"rim") — the 2-bar bossa clave (2-side then 3-side).
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

  // Ride — straight 8ths. Velocity contour sampled from iReal Pro: beats 1 & 3
  // lead, the "&" of 2 & 4 next, beats 2 & 4 mid, the "&" of 1 & 3 softest.
  const RIDE_VEL = [0.63, 0.43, 0.52, 0.59, 0.64, 0.42, 0.52, 0.58];
  for (let i = 0; i < 8; i++) push(i * 0.5, "ride", RIDE_VEL[i]);

  // Surdo kick — iReal accents beat 3 (122) hardest, then "&2" (111),
  // beat 1 (100), and "&4" (82) lightest.
  push(0,   "kick", 0.79);
  push(1.5, "kick", 0.87);
  push(2,   "kick", 0.96);
  push(3.5, "kick", 0.65);

  // Pedal hi-hat — soft foot chick on 2 & 4.
  push(1, "hihat-foot", 0.34);
  push(3, "hihat-foot", 0.34);

  // Cross-stick clave (rim) — 2-bar bossa clave. iReal's track opens on the
  // 2-side, so even bars play the 2-side and odd bars the 3-side.
  if (barIndex % 2 === 0) {
    // 2-side: beat 2 and the "&" of 3
    push(1,   "rim", 0.66);
    push(2.5, "rim", 0.66);
  } else {
    // 3-side: beat 1, the "&" of 2, and beat 4
    push(0,   "rim", 0.66);
    push(1.5, "rim", 0.66);
    push(3,   "rim", 0.66);
  }

  return events;
}

/* ─── Latin (paired ride bell + conga emulation) ───────────────────────── */

/**
 * Latin — transcribed from iReal Pro's "Latin" track (a mambo/bossa-latin
 * groove). Voices:
 *   • Bell — ride-bell doubled by a quieter ride, on a 2-bar bell pattern.
 *   • Surdo kick on beat 1 and the "& of 2".
 *   • Cross-stick (GM 37 SideStick → "rim") on beat 2.
 *   • Pedal hi-hat on 2 & 4.
 *   • Conga (toms → "tom-low") tumbao: high taps mid-bar, low slaps on 4.
 * Straight subdivision (1.0).
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

  // Bell pattern (ride-bell + quieter ride doubling) — 2-bar. iReal opens the
  // odd bar on the downbeat and the even bar on the "& of 1".
  const bell = barIndex % 2 === 0
    ? [0.5, 1.0, 2.0, 2.5, 3.5]
    : [0.0, 1.0, 2.0, 2.5, 3.5];
  for (const b of bell) {
    push(b, "ride-bell", 0.42);
    push(b, "ride",      0.32);
  }

  // Surdo kick — beat 1 and the "& of 2".
  push(0,   "kick", 0.71);
  push(1.5, "kick", 0.71);

  // Cross-stick on beat 2.
  push(1, "rim", 0.50);

  // Pedal hi-hat on 2 & 4.
  push(1, "hihat-foot", 0.46);
  push(3, "hihat-foot", 0.46);

  // Conga tumbao — high taps on the "& of 2" and beat 3, low slaps on beat 4
  // and its "&".
  push(1.5, "tom-low", 0.43);
  push(2.0, "tom-low", 0.43);
  push(3.0, "tom-low", 0.61);
  push(3.5, "tom-low", 0.56);

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
 *
 * Offsets are STRAIGHT half-beats (x.5). `mediumSwingBar` / `upTempoBar`
 * project them through `beatToSec`, which swings them onto the SAME grid as
 * the ride's swung 8ths (frac ≈ 0.71). The earlier patterns pre-baked the
 * swing (`x.0 + SWING_OFFSET`) and were then swung a second time, landing the
 * snare ~0.1 beat behind the ride (a flam). Using straight offsets locks the
 * comp to the ride, matching the iReal Pro medium-swing track.
 *
 * Distribution mirrors iReal's measured comp: the "& of 3" is by far the most
 * common hit, then "& of 1", then "& of 4"; the straight downbeat-of-4 hit
 * iReal never plays is dropped. ~1.5 hits/bar (iReal ≈ 1.66).
 *
 * NOTE: the deprecated `swingBar` below schedules at raw time (no beatToSec),
 * so it now reads these as un-swung — it is unused by `renderDrumBar`.
 */
const SNARE_PATTERNS: Array<Array<[number, number]>> = [
  [[2.5, 0.72]],               // "& of 3" — iReal's dominant comp
  [[0.5, 0.66]],               // "& of 1"
  [[0.5, 0.62], [2.5, 0.72]],  // "& of 1" + "& of 3"
  [[2.5, 0.70], [3.5, 0.64]],  // "& of 3" + "& of 4"
  [[0.5, 0.64]],               // "& of 1"
  [[1.0, 0.55], [2.5, 0.70]],  // beat-2 tap + "& of 3"
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
      return newOrleansBar(opts, bpm);
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
