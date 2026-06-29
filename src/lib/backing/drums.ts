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

/* ─── Cha-Cha (cowbell + tumbao + the "cha-cha-cha") ───────────────────── */

/**
 * Cha-cha-cha — straight 4/4 latin dance groove, distinct from the generic
 * `latin` mambo bell:
 *   • Cowbell (ride-bell) steady on the quarters — the anchor.
 *   • The signature "cha-cha-cha" triple: rim taps on 4, the "& of 4", and a
 *     resolving snare on beat 1.
 *   • Conga tumbao (tom-low) — open taps mid-bar, slap on 4.
 *   • Light kick on 1 & 3, pedal hat on 2 & 4.
 */
export function chaChaBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);
  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Cowbell on the quarters (downbeats fuller).
  push(0, "ride-bell", 0.62);
  push(1, "ride-bell", 0.50);
  push(2, "ride-bell", 0.58);
  push(3, "ride-bell", 0.50);

  // The "cha-cha-cha": the quick triple across 4 → "&4" → 1 (the 1 resolves
  // into the downbeat / this bar's beat 1).
  push(0, "snare", 0.55);   // the resolving "cha" on 1
  push(3, "rim", 0.6);      // "cha"
  push(3.5, "rim", 0.62);   // "cha"

  // Conga tumbao.
  push(1.5, "tom-low", 0.45);
  push(2, "tom-low", 0.45);
  push(3, "tom-low", 0.6);

  // Light kick on 1 & 3, pedal hat on 2 & 4.
  push(0, "kick", 0.5);
  push(2, "kick", 0.5);
  push(1, "hihat-foot", 0.4);
  push(3, "hihat-foot", 0.4);

  return events;
}

/* ─── Afro-Cuban (4/4 son — cascara + 3-2 son clave + tumbao) ──────────── */

/**
 * Afro-Cuban son/songo in 4/4 (a flattening of the traditional 6/8 so it fits
 * the engine's 4/4 grid). Voices:
 *   • Cascara (rim) — the steady shell pattern on the ride-bell.
 *   • 3-2 son clave (rim) — 2-bar: the 3-side (1, "&2", 4) then the 2-side
 *     (2, 3).
 *   • Conga tumbao (tom-low) — heel/tip taps + slaps, accented on 4.
 *   • Surdo-ish kick on 1 and the "& of 2"; pedal hat on 2 & 4.
 */
export function afroCubanBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);
  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Cascara on the ride-bell — the recognizable "1, &, a-of-2, 3, a-of-4" shell.
  for (const b of [0, 1, 1.5, 2, 2.5, 3.5]) push(b, "ride-bell", b === 0 ? 0.55 : 0.42);

  // 3-2 son clave on the rim (2-bar): 3-side then 2-side.
  if (barIndex % 2 === 0) {
    push(0, "rim", 0.6); push(1.5, "rim", 0.6); push(3, "rim", 0.6);   // 3-side
  } else {
    push(1, "rim", 0.6); push(2, "rim", 0.6);                          // 2-side
  }

  // Conga tumbao — taps then a slap accent on 4.
  push(1.5, "tom-low", 0.42);
  push(2, "tom-low", 0.42);
  push(3, "tom-low", 0.58);
  push(3.5, "tom-low", 0.5);

  // Surdo-style kick + pedal hat.
  push(0, "kick", 0.62);
  push(1.5, "kick", 0.6);
  push(1, "hihat-foot", 0.4);
  push(3, "hihat-foot", 0.4);

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

/* ─── Samba (distinct from `latin` — fast surdo 2-feel + 16th caixa) ────── */

/**
 * Samba — a true samba groove, NOT the generic `latin` (mambo-ish) bell pattern.
 * Voices (straight 16ths):
 *   • Surdo (kick) — the 2-feel pulse: beats 2 & 4 carry it, beat 4 (the
 *     surdo's strong "1") loudest; beats 1 & 3 ghosted.
 *   • Caixa (snare) — continuous low 16ths with the samba accent contour
 *     (the 'e' and 'a' lifted) → brush-roll texture under the kit.
 *   • Agogô / ride-bell — telecoteco-flavoured 8th figure (offbeats accented).
 *   • Pedal hi-hat on 2 & 4.
 */
export function sambaBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Surdo (kick) — 2-feel; beat 4 is the strong surdo, beat 2 the answer.
  push(0, "kick", 0.30);
  push(1, "kick", 0.82);
  push(2, "kick", 0.32);
  push(3, "kick", 0.95);

  // Caixa (snare) — continuous 16ths, ghosts on the beats, the 'e/a' lifted.
  const CAIXA = [
    0.30, 0.22, 0.44, 0.50,
    0.30, 0.22, 0.44, 0.54,
    0.30, 0.22, 0.44, 0.50,
    0.34, 0.26, 0.48, 0.60,
  ];
  for (let i = 0; i < 16; i++) push(i * 0.25, "snare", CAIXA[i]);

  // Agogô / ride-bell — telecoteco 8th figure, offbeats accented.
  for (const b of [0, 0.5, 1.5, 2, 2.5, 3.5]) push(b, "ride-bell", 0.5);

  // Pedal hi-hat on 2 & 4.
  push(1, "hihat-foot", 0.40);
  push(3, "hihat-foot", 0.40);

  return events;
}

/* ─── Funk (straight-16 backbeat + ghost notes + syncopated kick) ──────── */

/**
 * Funk — a real backbeat groove rather than the generic `even-8ths` ride. Kept
 * deliberately simple/clean (one-bar): closed-hat 16ths, hard snare backbeat
 * on 2 & 4 with ghost-note fills, and a syncopated kick (1, the 'a of 1', the
 * '& of 3', and a pickup 'a of 4'). Straight subdivision (0.5).
 */
export function funkBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.5);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Closed hi-hat — straight 16ths, downbeats accented, the rest even.
  const HH = [
    0.56, 0.30, 0.44, 0.30,
    0.50, 0.30, 0.44, 0.32,
    0.56, 0.30, 0.44, 0.30,
    0.50, 0.30, 0.48, 0.34,
  ];
  for (let i = 0; i < 16; i++) push(i * 0.25, "hihat-closed", HH[i]);

  // Snare — hard backbeat on 2 & 4, ghost taps before each for the funk lilt.
  push(1, "snare", 0.92);
  push(3, "snare", 0.95);
  push(0.75, "snare", 0.26);
  push(1.75, "snare", 0.24);
  push(2.75, "snare", 0.30);

  // Kick — syncopated funk pocket.
  push(0,    "kick", 0.92);
  push(0.75, "kick", 0.58);
  push(2.5,  "kick", 0.86);
  if (barIndex % 2 === 1) push(3.75, "kick", 0.50);

  return events;
}

/* ─── Jazz Waltz (3/4 swung ride) ──────────────────────────────────────── */

/**
 * Jazz waltz — 3/4 swung ride: beat 1, then beats 2 & 3 each get a "quarter +
 * swung 8th" (the '1, 2-let, 3-let' lilt), hi-hat foot on 2 & 3, feathered
 * kick. Falls back to medium swing when the chart isn't actually in 3 (so
 * picking "Jazz Waltz" on a 4/4 tune still grooves instead of going silent).
 */
export function waltzBar(opts: DrumBarOptions, bpm: number): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 3) return mediumSwingBar(opts, bpm);

  const swingRatio = getSwingRatio(bpm, "medium-swing");
  const beatToSec = makeBeatToSec(secPerBeat, swingRatio);

  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Ride — 1, then 2 + "a of 2", 3 + "a of 3".
  push(0, "ride", 0.68);
  push(1, "ride", 0.64);
  push(1.5, "ride", 0.58);
  push(2, "ride", 0.64);
  push(2.5, "ride", 0.58);

  // Hi-hat foot on 2 & 3 — the waltz "down-up-up" pulse.
  push(1, "hihat-foot", 0.46);
  push(2, "hihat-foot", 0.46);

  // Feathered kick — strong 1, soft 2 & 3.
  push(0, "kick", 0.30);
  push(1, "kick", 0.22);
  push(2, "kick", 0.22);

  // Light cross-stick comp on the "a of 3" every other bar for motion.
  if (barIndex % 2 === 1) push(2.5, "rim", 0.50);

  return events;
}

/* ─── Style → drum renderer dispatcher ─────────────────────────────────── */

/**
 * Single entry point: switches on the FeelId and dispatches to the matching
 * per-style bar renderer. Unknown / unhandled feels fall back to medium
 * swing so the playback never silently goes silent.
 */
/* ─── Bebop (fast driving swing + dropped "bombs") ─────────────────────── */

/**
 * Bebop — the up-tempo swing skeleton, but driven harder like a 1940s-50s
 * bebop drummer:
 *   • Tight swing ratio (0.6) so fast 8th-note lines stay articulate.
 *   • Standard "spang-a-lang" ride (skip-beat on 2 & 4) — recognizable and
 *     uncluttered, locked to the bass/piano swing.
 *   • Crisp PHH on 2 & 4.
 *   • Feathered kick on all four PLUS an occasional "bomb" — at most one
 *     accented off-beat bass-drum kick per bar, ~1 bar in 3 (bar-seeded so a
 *     chart renders identically every play).
 *   • Snare comping from the shared library + a phrase-end left-hand accent.
 */
export function bebopBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  // Tight, driving swing (0.6) — tighter than medium (~0.708), looser than
  // straight. Off-beats articulate the fast 8th lines.
  const beatToSec = makeBeatToSec(secPerBeat, 0.6);
  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Ride — the spang-a-lang (same recognizable shape as medium/up-tempo, just
  // faster + tighter). The continuous-8th ride the old version used read as
  // cluttered against the comping; the skip-beat ride is the idiomatic bebop
  // pulse and locks with the bass/piano swing.
  push(0, "ride", 0.64);
  push(1, "ride", 0.70);
  push(2, "ride", 0.64);
  push(3, "ride", 0.68);
  push(1.5, "ride", 0.62);   // skip-beat "a" of 2
  push(3.5, "ride", 0.60);   // skip-beat "a" of 4

  // Hi-hat foot — crisp backbeat on 2 & 4.
  push(1, "hihat-foot", 0.55);
  push(3, "hihat-foot", 0.55);

  // Feathered kick on all four — barely-audible bebop pulse (not a thud).
  push(0, "kick", 0.22);
  push(1, "kick", 0.22);
  push(2, "kick", 0.22);
  push(3, "kick", 0.22);

  // "Bombs" — the accented bass-drum kicks of Roach / Philly Joe. The old
  // version stacked up to three loud bombs in a bar (and ALL three on bar 0,
  // since hash(0)=0), which lurched. Now: at most ONE bomb per bar, on roughly
  // one bar in three, at a musical (not slamming) level — so the line breathes.
  const r = ((barIndex * 2654435761) >>> 0) % 6;
  if (r === 0) push(3.5, "kick", 0.58);        // bomb on "& of 4" (leads into next bar)
  else if (r === 3) push(1.5, "kick", 0.56);   // bomb on "& of 2"

  // Snare comping (shared library) + a phrase-end left-hand accent every 4 bars.
  const snarePattern = SNARE_PATTERNS[barIndex % SNARE_PATTERNS.length];
  for (const [offset, vel] of snarePattern) push(offset, "snare", vel);
  if (barIndex % 4 === 3) push(3.5, "snare", 0.85);

  return events;
}

/* ─── Shuffle (blues — hard triplet ride + 2&4 backbeat) ───────────────── */

/**
 * Blues / jazz shuffle — the classic "dt-dt-dt-dt" triplet lilt:
 *   • Hi-hat (closed) plays the shuffle ride: each beat + its swung "&" landing
 *     on the triplet 3rd (ratio 0.667), giving the dotted shuffle bounce.
 *   • Strong backbeat snare on 2 & 4.
 *   • Steady kick on 1 & 3 (the "boom-CHK boom-CHK" foundation) plus a soft
 *     pickup kick into beat 1.
 *   • PHH foot on 2 & 4 reinforcing the backbeat.
 */
export function shuffleBar(opts: DrumBarOptions): DrumEvent[] {
  const { secPerBeat, barStart, beatsInBar, barIndex } = opts;
  if (beatsInBar !== 4) return [];

  const beatToSec = makeBeatToSec(secPerBeat, 0.667);
  const events: DrumEvent[] = [];
  const push = (beat: number, piece: DrumPiece, velocity: number) => {
    events.push({ kind: "drum", piece, time: barStart + beatToSec(beat), velocity, bar: barIndex });
  };

  // Shuffle ride on closed hi-hat: beat + swung "&" (triplet 3rd) on each beat.
  for (let b = 0; b < 4; b++) {
    push(b, "hihat-closed", b % 2 === 1 ? 0.58 : 0.64);   // downbeats a touch fuller
    push(b + 0.5, "hihat-closed", 0.46);                  // the triplet "&"
  }

  // Backbeat snare on 2 & 4 — the heart of the shuffle.
  push(1, "snare", 0.9);
  push(3, "snare", 0.92);

  // Kick foundation on 1 & 3, with a soft lead-in kick on the "& of 4".
  push(0, "kick", 0.8);
  push(2, "kick", 0.78);
  if (barIndex % 2 === 1) push(3.5, "kick", 0.42);

  // PHH foot reinforcing 2 & 4.
  push(1, "hihat-foot", 0.4);
  push(3, "hihat-foot", 0.4);

  return events;
}

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
    case "cha-cha":
      return chaChaBar(opts);
    case "afro-cuban":
      return afroCubanBar(opts);
    case "samba":
      return sambaBar(opts);
    case "funk":
      return funkBar(opts);
    case "waltz":
      return waltzBar(opts, bpm);
    case "bebop-swing":
      return bebopBar(opts);
    case "shuffle-blues":
      return shuffleBar(opts);
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
