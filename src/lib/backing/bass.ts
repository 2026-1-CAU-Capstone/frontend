import type { Chord, ChordQuality, MidiNote, PitchClass } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Walking bass generator.
 *
 * Calibrated against iReal Pro's own bass tracks (GM backing-track MIDI).
 * Key characteristics matched from those samples:
 *   - Register: upright range E1..B2 (MIDI 28..47), centred ~A1..E2. Each
 *     note is placed in the octave NEAREST the previous note (`placeNear`) so
 *     the line walks stepwise instead of leaping per fixed pitch-class octave.
 *   - Line: root on beat 1, an approach tone on the last beat (leading into
 *     the next chord), and the inner beats connected with either chord tones
 *     (arpeggio) or a diatonic scale fragment (scalar run) — chosen per chord.
 *   - Swung-8th ornament: occasionally a beat's note is re-articulated on its
 *     swung "&" (iReal does this ~once every 2 bars in medium swing, most
 *     often on beat 1).
 *
 * Approach note = weighted offset below/above the next chord's root, from the
 * measured iReal distribution. Falls back to the current root at end of chart.
 * ──────────────────────────────────────────────────────────────────────── */

export interface WalkingBassBeat {
  /** 0-indexed beat offset from the start of the chord. Fractional offsets
   *  (e.g. 0.708) are used for swung-8th ornaments. */
  beatOffset: number;
  midi: MidiNote;
  /** Optional note length override, in beats. Engine default applies when
   *  omitted (legato quarter for walking, long for 2-feel). */
  durBeats?: number;
  /** Swung-8th ornament push — engine plays it accented + short. */
  accent?: boolean;
}

/** Upright walking range: E1 (28) .. B2 (47). */
const BASS_LO = 28;
const BASS_HI = 47;

/**
 * Approach-tone distribution measured from 18 iReal Pro MIDI samples.
 * Offsets are semitones relative to the next chord's bass target:
 *   -2: 44%, -1: 26%, +1: 13%, +2: 9%, +5: 4%, -7: 4%
 * Encoded as a 100-bucket roulette so a uniform [0,1) draw picks the
 * weighted offset directly via index lookup.
 */
const APPROACH_OFFSETS: number[] = (() => {
  const buckets: number[] = [];
  const weighted: Array<[number, number]> = [
    [-2, 44],
    [-1, 26],
    [+1, 13],
    [+2, 9],
    [+5, 4],
    [-7, 4],
  ];
  for (const [offset, weight] of weighted) {
    for (let i = 0; i < weight; i++) buckets.push(offset);
  }
  return buckets;
})();

/** Deterministic [0,1) PRNG (mulberry32) — repeatable per (bar, chord)
 *  pair so the same chart renders the same approach every time. */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function walkChord(
  current: Chord,
  next: Chord | null,
  beats: number,
  /** Deterministic seed (e.g. hash of bar index + chord index). */
  seed: number = 0,
  /** Previous bass MIDI note, for register continuity. Null at chart start. */
  prevMidi: MidiNote | null = null,
  /** Swing ratio (>0.5) enables the swung-8th ornament; 0.5 disables it. */
  swingRatio: number = 0.5,
): WalkingBassBeat[] {
  if (beats <= 0) return [];

  const rootPc = current.bass ?? current.root;
  const fifthPc = (current.root + 7) % 12;
  const thirdPc = (current.root + thirdInterval(current.quality)) % 12;
  const approach = approachPc(current, next, mulberry32(seed));

  // Walk the line: the downbeat root re-anchors to the centre tessitura each
  // chord (iReal places every chord's root in the octave nearest centre, not
  // nearest the previous note, which is what keeps the line from drifting up).
  // Inner beats then place nearest the previous note for stepwise continuity.
  void prevMidi; // root re-anchors per chord, so prior note isn't threaded
  let prev: MidiNote = BASS_CENTER;
  const out: WalkingBassBeat[] = [];
  const add = (pc: PitchClass, beatOffset: number, anchorCentre = false) => {
    const midi = placeNear(pc, anchorCentre ? BASS_CENTER : prev);
    prev = midi;
    out.push({ beatOffset, midi });
  };

  if (beats === 1) {
    add(rootPc, 0, true);
  } else if (beats === 2) {
    add(rootPc, 0, true);
    add(approach, 1);
  } else if (beats === 3) {
    add(rootPc, 0, true);
    add(fifthPc, 1);
    add(approach, 2);
  } else {
    add(rootPc, 0, true);
    // Inner two beats: scalar run more often than not (iReal walks mostly
    // stepwise), chord-tone arpeggio the rest.
    if (mulberry32(seed * 13 + 5) < 0.62) {
      const scale = chordScale(current.root, current.quality);
      const dir = mulberry32(seed * 17 + 3) < 0.5 ? -1 : 1;
      const len = scale.length;
      add(scale[((1 * dir) % len + len) % len], 1);
      add(scale[((2 * dir) % len + len) % len], 2);
    } else {
      // Put the chord tone closest to the approach on beat 3 for a smooth lead-in.
      const [m1, m2] = pcDist(thirdPc, approach) <= pcDist(fifthPc, approach)
        ? [fifthPc, thirdPc]
        : [thirdPc, fifthPc];
      add(m1, 1);
      add(m2, 2);
    }
    add(approach, 3);
    for (let b = 4; b < beats; b++) add(rootPc, b);
  }

  maybeOrnament(out, beats, seed, swingRatio);
  return out;
}

/**
 * Two-feel bass for ballads — root on beat 1, fifth on beat 3, both held as
 * (near) half notes. Matches iReal Pro's ballad-swing bass, which walks in 2
 * rather than 4. Register continuity via `placeNear`.
 */
export function twoFeelBass(
  current: Chord,
  beats: number,
  prevMidi: MidiNote | null = null,
  seed: number = 0,
): WalkingBassBeat[] {
  if (beats <= 0) return [];
  const rootPc = current.bass ?? current.root;
  const fifthPc = (current.root + 7) % 12;
  void prevMidi; // root re-anchors to centre per chord (see walkChord)
  let prev: MidiNote = BASS_CENTER;
  const out: WalkingBassBeat[] = [];
  const add = (pc: PitchClass, beatOffset: number, durBeats: number, anchorCentre = false) => {
    const midi = placeNear(pc, anchorCentre ? BASS_CENTER : prev);
    prev = midi;
    out.push({ beatOffset, midi, durBeats });
  };

  if (beats === 1) {
    add(rootPc, 0, 0.95, true);
  } else if (beats === 2) {
    add(rootPc, 0, 1.9, true);
  } else {
    add(rootPc, 0, 1.85, true);
    add(fifthPc, 2, Math.max(0.95, (beats - 2) * 0.95));
  }
  // Ballads also drag the occasional swung "&" (sparser than walking).
  maybeOrnament(out, beats, seed, 0.667, 0.28);
  return out;
}

/**
 * Funk bass — a syncopated, root-driven riff (straight feel) that locks with
 * the funkBar kick (downbeat, the 'a of 1', the '& of 3'). Uses the fifth for
 * motion and a half-step chromatic approach into the next chord's root on the
 * last 16th of a full bar. Hits whose offset exceeds the chord's length are
 * dropped, so shorter chords just play the early part of the riff.
 */
export function funkBass(
  current: Chord,
  next: Chord | null,
  beats: number,
  prevMidi: MidiNote | null = null,
): WalkingBassBeat[] {
  if (beats <= 0) return [];
  const rootPc = current.bass ?? current.root;
  const fifthPc = (current.root + 7) % 12;
  let prev: MidiNote = prevMidi ?? BASS_CENTER;
  const out: WalkingBassBeat[] = [];
  const add = (pc: PitchClass, beatOffset: number, durBeats: number, accent = false) => {
    if (beatOffset >= beats) return;
    const midi = placeNear(pc, prev);
    prev = midi;
    out.push({ beatOffset, midi, durBeats, accent });
  };

  add(rootPc, 0, 0.7);            // the "one"
  add(rootPc, 0.75, 0.4, true);   // 'a of 1' push — locks with the kick
  add(fifthPc, 1.5, 0.4);         // '& of 2' fifth for motion
  add(rootPc, 2.5, 0.6, true);    // '& of 3' — the funk pocket accent
  if (beats >= 4 && next) {
    // Chromatic approach into the next chord on the last 16th.
    const tgt = next.bass ?? next.root;
    add((tgt + 11) % 12, 3.75, 0.25, true);
  } else if (beats >= 3) {
    add(rootPc, 3, 0.5);
  }
  return out;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

/** Tessitura centre the line gravitates toward (≈ D2). Real bassists re-centre
 *  here rather than drifting up after an ascending arpeggio. */
const BASS_CENTER = 38;

/**
 * Place pitch class `pc` in an octave within E1..B2, choosing the one that
 * minimises motion from `prev` while gently pulling back toward the centre
 * tessitura (so the line doesn't drift high and stay there, matching iReal).
 */
function placeNear(pc: PitchClass, prev: MidiNote): MidiNote {
  const p = ((pc % 12) + 12) % 12;
  let best = -1;
  let bestScore = Infinity;
  for (let n = BASS_LO + ((p - BASS_LO) % 12 + 12) % 12; n <= BASS_HI; n += 12) {
    const score = Math.abs(n - prev) + 0.45 * Math.abs(n - BASS_CENTER);
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best >= 0 ? best : clampBass(36 + p);
}

/**
 * Add a swung-8th ornament to ~`prob` of bars: re-articulate one beat's note
 * on its swung "&" (most often beat 1), shortening the host beat. The ornament
 * lands at `beatOffset + swingRatio` so the engine's straight scheduler places
 * it on the swung subdivision. No-op for straight feels (swingRatio === 0.5).
 */
function maybeOrnament(
  out: WalkingBassBeat[],
  beats: number,
  seed: number,
  swingRatio: number,
  prob = 0.45,
): void {
  if (swingRatio <= 0.5 || beats < 2) return;
  if (mulberry32(seed * 23 + 9) >= prob) return;
  // Bias toward beat 1 (iReal's most common spot), else a later beat.
  const obeat = mulberry32(seed * 31 + 2) < 0.5
    ? 0
    : 1 + Math.floor(mulberry32(seed * 29 + 4) * (beats - 2)); // 1..beats-2
  const host = out.find((o) => o.beatOffset === obeat);
  if (!host) return;
  host.durBeats = 0.6;
  out.push({ beatOffset: obeat + swingRatio, midi: host.midi, durBeats: 0.3, accent: true });
}

/**
 * Bass register clamp — E1 (MIDI 28) floor, C4 (MIDI 60) defensive ceiling.
 * Octave-shifts notes into the playable range without changing pitch class.
 */
export function clampBass(n: number): number {
  while (n < 28) n += 12;
  while (n > 60) n -= 12;
  return n;
}

/** Shortest distance between two pitch classes, in semitones (0..6). */
function pcDist(a: PitchClass, b: PitchClass): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/**
 * Diatonic scale (as absolute pitch classes, root first) for the chord — used
 * to source scalar walking fragments. Dorian for minor chords, mixolydian for
 * dominant/sus, ionian otherwise. Close enough for stepwise passing tones.
 */
function chordScale(root: number, q: ChordQuality): PitchClass[] {
  const r = ((root % 12) + 12) % 12;
  const third = thirdInterval(q);
  let degs: number[];
  if (third === 3) {
    degs = [0, 2, 3, 5, 7, 9, 10];          // dorian (minor family)
  } else if (q === "dom7" || q === "dom9" || q === "dom13" || q.startsWith("7") || third === 5 || third === 2) {
    degs = [0, 2, 4, 5, 7, 9, 10];          // mixolydian (dominant / sus)
  } else {
    degs = [0, 2, 4, 5, 7, 9, 11];          // ionian (major family)
  }
  return degs.map((d) => (r + d) % 12);
}

/**
 * Weighted-random approach tone — the empirical distribution measured from
 * iReal Pro samples. `rand` must be a deterministic [0,1) draw.
 */
function approachPc(current: Chord, next: Chord | null, rand: number): PitchClass {
  if (!next) return current.bass ?? current.root;
  const targetPc = next.bass ?? next.root;
  const offset = APPROACH_OFFSETS[Math.floor(rand * APPROACH_OFFSETS.length) % APPROACH_OFFSETS.length];
  return (((targetPc + offset) % 12) + 12) % 12;
}

const THIRD_BY_QUALITY: Record<ChordQuality, number> = {
  maj: 4, maj6: 4, maj7: 4, maj9: 4,
  min: 3, min6: 3, min7: 3, min9: 3, min11: 3, minmaj7: 3,
  dom7: 4, dom9: 4, dom13: 4,
  "7sus4": 5, "7alt": 4, "7#9": 4, "7b9": 4, "7#11": 4, "7b13": 4,
  min7b5: 3, dim: 3, dim7: 3,
  aug: 4, aug7: 4,
  sus2: 2, sus4: 5,
  "5": 7,
};

function thirdInterval(q: ChordQuality): number {
  return THIRD_BY_QUALITY[q] ?? 4;
}
