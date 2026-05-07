import type { BackingEvent, Bar, Chart, Chord, MidiNote } from "./types";
import { swingBar } from "./drums";
import { walkChord } from "./bass";
import { voiceChord } from "./voicing";

/* ─────────────────────────────────────────────────────────────────────────
 * Engine — turns a Chart into a timed stream of BackingEvents.
 *
 * Phase 1 (current):
 *   - Walk sections/bars in order (no repeat expansion yet)
 *   - Medium-swing only; feel & style overrides ignored
 *   - Piano comping:
 *       * rhythm pattern pool with per-bar rotation (less mechanical)
 *       * voice-leading state (prev voicing → minimal-motion next voicing)
 *       * velocity jitter to humanize
 *   - Walking bass: delegated to bass.ts
 *   - Drums: delegated to drums.ts, then lightly humanized
 *
 * Later phases add figures, instruction handling, feel modifiers, etc.
 * ──────────────────────────────────────────────────────────────────────── */

export interface RenderOptions {
  /** Effective bpm after config override. */
  bpm: number;
}

/* ─── comping rhythm patterns ────────────────────────────────────────── */

/**
 * Each pattern is a list of (beatOffset, velocity) pairs inside a 4-beat
 * chord duration. Velocities are 0..1 and will be further jittered.
 *
 * These follow classic jazz piano comping — not just 2 & 4, but also
 * "and of 1 → 4", anticipations, and sparser pushes.
 */
/**
 * Comping rhythm patterns — kept deliberately simple so multiple chords
 * in flight don't pile up into a muddy wash. Each pattern is 2 hits
 * maximum over a 4-beat chord. Choose one per chord via selectCompingPattern.
 */
const COMPING_PATTERNS_4BEAT: Array<Array<[number, number]>> = [
  // Classic 2 & 4
  [[1.0, 0.62], [3.0, 0.58]],
  // 2 + "and of 3" push
  [[1.0, 0.6], [2.5, 0.55]],
  // "And of 1" + 3
  [[0.5, 0.58], [2.0, 0.58]],
  // Anticipation on "and of 4" only
  [[1.0, 0.6], [3.5, 0.6]],
  // Downbeat + "and of 2"
  [[0.0, 0.55], [1.5, 0.6]],
];

const COMPING_PATTERNS_2BEAT: Array<Array<[number, number]>> = [
  [[0.5, 0.58]],
  [[0.0, 0.58]],
  [[1.0, 0.6]],
];

/** Deterministic "random" in [0,1) from a seed int. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* ─── main render ────────────────────────────────────────────────────── */

export function renderChart(chart: Chart, opts: RenderOptions): BackingEvent[] {
  const secPerBeat = 60 / opts.bpm;
  const beatsPerBar = chart.timeSig[0];
  const secPerBar = beatsPerBar * secPerBeat;

  // Flatten all bars across sections (no repeat expansion yet).
  const flatBars: Bar[] = [];
  for (const sec of chart.sections) flatBars.push(...sec.bars);

  const events: BackingEvent[] = [];
  let prevVoicing: MidiNote[] = [];

  for (let bi = 0; bi < flatBars.length; bi++) {
    const bar = flatBars[bi];
    const barStart = bi * secPerBar;

    // Drums — one swing pattern per bar, with light humanization
    const drumEvents = swingBar({
      secPerBeat,
      barStart,
      beatsInBar: beatsPerBar,
      barIndex: bi,
    });
    humanizeDrums(drumEvents, secPerBeat, bi);
    events.push(...drumEvents);

    // Chord-level events (bass walking + piano comping)
    let beatCursor = 0;
    for (let ci = 0; ci < bar.chords.length; ci++) {
      const chord = bar.chords[ci];
      const next = nextChord(bar, ci, flatBars, bi);

      // Walking bass — downbeat accent gives the walking line its
      // characteristic "pulse". Beats 2-4 are slightly softer, creating
      // the classic "thump...step...step...step" feel.
      for (const bn of walkChord(chord, next, chord.beats)) {
        const isDownbeat = bn.beatOffset === 0;
        const baseVel = isDownbeat ? 0.92 : 0.78;
        events.push({
          kind: "note",
          instrument: "bass",
          midi: bn.midi,
          time: barStart + (beatCursor + bn.beatOffset) * secPerBeat,
          duration: secPerBeat * 0.92,
          velocity: baseVel + (rand(bi * 31 + ci * 7 + bn.beatOffset) - 0.5) * 0.08,
          bar: bi,
        });
      }

      // Piano comping — voice-led from prev voicing, clipped to 3 notes
      // so chord hits stay punchy instead of turning into a wall of sound.
      // Register rotates per phrase (every 4 bars) so the comping moves
      // between a mid voicing and an upper voicing — a real pianist's
      // stylistic trick to avoid staying in one register all night.
      const fullVoicing = voiceChord(chord, prevVoicing);
      const phrase = Math.floor(bi / 4) % 3;
      const octaveShift = phrase === 0 ? 0 : phrase === 1 ? 12 : -12;
      const voicing = fullVoicing.slice(0, 3).map((n) => n + octaveShift);
      prevVoicing = fullVoicing;

      if (voicing.length > 0) {
        const pattern = selectCompingPattern(chord.beats, bi, ci);
        // 1-beat 코드는 단일 히트 → 한 박 내내 울리도록 길게 sustain.
        // 다중 히트 패턴은 짧게 끊어 머디해지지 않게 유지.
        const isSingleHit = pattern.length === 1;
        for (const [offset, velBase] of pattern) {
          if (offset >= chord.beats) continue;
          const t = barStart + (beatCursor + offset) * secPerBeat;
          // velocity jitter only — timing stays tight on the grid so
          // piano, drums, and the visual bar highlight all align.
          const vel = velBase + (rand(bi * 97 + ci * 11 + offset * 3) - 0.5) * 0.08;
          const microTime = t;
          const duration = isSingleHit
            ? secPerBeat * chord.beats * 1.1   // 1박 코드: 한 박을 꽉 채워 잔향까지
            : secPerBeat * 0.45;                // 패턴 히트: 머디함 방지용 짧은 길이
          for (const midi of voicing) {
            events.push({
              kind: "note",
              instrument: "piano",
              midi,
              time: microTime,
              duration,
              velocity: Math.max(0.3, Math.min(0.78, vel)),
              bar: bi,
            });
          }
        }
      }

      beatCursor += chord.beats;
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function nextChord(bar: Bar, ci: number, flatBars: Bar[], bi: number): Chord | null {
  if (ci < bar.chords.length - 1) return bar.chords[ci + 1];
  const nb = flatBars[bi + 1];
  return nb?.chords[0] ?? null;
}

/**
 * Pick a comping rhythm pattern.
 *   - ≥ 4 beats: rotate through COMPING_PATTERNS_4BEAT per bar/chord index
 *   - 2-3 beats: rotate through COMPING_PATTERNS_2BEAT
 *   - 1 beat:    a single downbeat hit
 */
function selectCompingPattern(beats: number, barIdx: number, chordIdx: number): Array<[number, number]> {
  if (beats >= 4) {
    const idx = Math.floor(rand(barIdx * 13 + chordIdx * 17) * COMPING_PATTERNS_4BEAT.length);
    return COMPING_PATTERNS_4BEAT[idx];
  }
  if (beats >= 2) {
    const idx = Math.floor(rand(barIdx * 19 + chordIdx * 23) * COMPING_PATTERNS_2BEAT.length);
    return COMPING_PATTERNS_2BEAT[idx];
  }
  return [[0, 0.55]];
}

/**
 * Drum humanization — in-place perturbation of timing and velocity so the
 * ride stops feeling like a metronome. Kept small so the groove still locks.
 */
function humanizeDrums(drumEvents: BackingEvent[], _secPerBeat: number, barIdx: number): void {
  const VEL_JITTER = 0.06;

  for (let i = 0; i < drumEvents.length; i++) {
    const ev = drumEvents[i];
    if (ev.kind !== "drum") continue;
    const dv = (rand(barIdx * 59 + i * 17) - 0.5) * 2 * VEL_JITTER;
    drumEvents[i] = {
      ...ev,
      velocity: Math.max(0.15, Math.min(1, ev.velocity + dv)),
    };
  }
}
