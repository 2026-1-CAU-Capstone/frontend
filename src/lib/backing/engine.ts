import type { BackingEvent, Bar, Chart, Chord, MidiNote, StyleId } from "./types";
import { swingBar, bossaBar } from "./drums";
import { walkChord } from "./bass";
import { voiceChord } from "./voicing";
import { PSBASE_CH0_PATTERN } from "./jazz-piano-pattern";
import { fitChordPhraseToChord } from "../yamaha-sty/fit-phrase";
import { chordTypeFromQuality } from "../yamaha-sty/quality-map";
import { ChordSymbol } from "../jazz-harmony";

// Pre-resolve the source ChordType once (cached) — PSBASE_CH0_PATTERN was
// recorded against C Maj7 ("M7").
const PSBASE_SRC_CHORD_TYPE = ChordSymbol.parse('C' + PSBASE_CH0_PATTERN.sourceChordTypeName).chordType;
const PSBASE_PPQ = PSBASE_CH0_PATTERN.ticksPerQuarter;

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
  /** Effective style after config override. */
  style?: StyleId;
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

/**
 * Bossa Nova piano comping — sparser, syncopated, no swing.
 * Each pattern is over a 4-beat chord. Sustain is longer so the chord rings.
 */
const COMPING_PATTERNS_BOSSA_4BEAT: Array<Array<[number, number]>> = [
  // Classic bossa: 1, "and of 2", 4
  [[0.0, 0.62], [1.5, 0.68], [3.0, 0.6]],
  // Partido alto variant: "and of 1", 3, "and of 4"
  [[0.5, 0.66], [2.0, 0.6], [3.5, 0.7]],
];

const COMPING_PATTERNS_BOSSA_2BEAT: Array<Array<[number, number]>> = [
  [[0.0, 0.62], [1.0, 0.6]],
  [[0.5, 0.66]],
];

/**
 * Bossa Nova bass — 2-feel, NOT walking. Root on beat 1, fifth on beat 3
 * for 4-beat chords; just the root for shorter chords. This is the surdo-
 * style bass line that gives bossa its characteristic "boom-boom" pulse.
 */
function bossaBass(current: Chord, beats: number): Array<{ beatOffset: number; midi: MidiNote }> {
  if (beats <= 0) return [];
  const rootPc = current.bass ?? current.root;
  const fifthPc = (current.root + 7) % 12;
  const rootMidi = bossaBassNote(rootPc);
  const fifthMidi = bossaBassNote(fifthPc);

  if (beats === 1) return [{ beatOffset: 0, midi: rootMidi }];
  if (beats === 2) return [{ beatOffset: 0, midi: rootMidi }, { beatOffset: 1, midi: fifthMidi }];
  if (beats === 3) {
    return [
      { beatOffset: 0, midi: rootMidi },
      { beatOffset: 2, midi: fifthMidi },
    ];
  }
  // 4+ beats: root on 1, fifth on 3.
  const out = [
    { beatOffset: 0, midi: rootMidi },
    { beatOffset: 2, midi: fifthMidi },
  ];
  return out;
}

function bossaBassNote(pc: number): MidiNote {
  const normalized = ((pc % 12) + 12) % 12;
  let n = 36 + normalized;
  if (n < 40) n += 12;
  return n;
}

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
  const style = opts.style ?? chart.defaultStyle;
  const isBossa = style === "bossa";

  // Flatten all bars across sections (no repeat expansion yet).
  const flatBars: Bar[] = [];
  for (const sec of chart.sections) flatBars.push(...sec.bars);

  const events: BackingEvent[] = [];
  // Beat position into the psBase piano pattern (length = sizeInBeats).
  // Advances by chord.beats per chord so the comping rhythm flows naturally
  // across the song instead of restarting every bar.
  let psBaseCycleBeats = 0;

  for (let bi = 0; bi < flatBars.length; bi++) {
    const bar = flatBars[bi];
    const barStart = bi * secPerBar;

    // Drums — one pattern per bar, with light humanization
    const drumBuilder = isBossa ? bossaBar : swingBar;
    const drumEvents = drumBuilder({
      secPerBeat,
      barStart,
      beatsInBar: beatsPerBar,
      barIndex: bi,
    });
    humanizeDrums(drumEvents, secPerBeat, bi);
    events.push(...drumEvents);

    // Chord-level events (bass + piano comping)
    let beatCursor = 0;
    for (let ci = 0; ci < bar.chords.length; ci++) {
      const chord = bar.chords[ci];
      const next = nextChord(bar, ci, flatBars, bi);

      // Bass — bossa uses 2-feel (root + fifth), swing uses walking bass.
      const bassNotes = isBossa
        ? bossaBass(chord, chord.beats)
        : walkChord(chord, next, chord.beats);
      for (const bn of bassNotes) {
        const isDownbeat = bn.beatOffset === 0;
        const baseVel = isBossa
          ? (isDownbeat ? 0.9 : 0.82)
          : (isDownbeat ? 0.92 : 0.78);
        events.push({
          kind: "note",
          instrument: "bass",
          midi: bn.midi,
          time: barStart + (beatCursor + bn.beatOffset) * secPerBeat,
          duration: secPerBeat * (isBossa ? 1.6 : 0.92),
          velocity: baseVel + (rand(bi * 31 + ci * 7 + bn.beatOffset) - 0.5) * 0.08,
          bar: bi,
        });
      }

      // Piano comping — use the pre-recorded psBase ch 0 pattern instead
      // of generating from scratch. The pattern is a Yamaha professional
      // pianist's 8-bar comping recorded against CMaj7; we slice the
      // current chord's beats out of it and re-fit to the chord via
      // fitChordPhraseToChord. Bossa still uses the legacy voicing-based
      // path because the psBase pattern is swing-specific.
      if (isBossa) {
        renderLegacyPianoComping(chord, beatCursor, bi, ci, barStart, secPerBeat, isBossa, events);
      } else {
        renderPsBasePianoComping(
          chord, beatCursor, psBaseCycleBeats, bi, barStart, secPerBeat, events,
        );
      }

      psBaseCycleBeats = (psBaseCycleBeats + chord.beats) % PSBASE_CH0_PATTERN.sizeInBeats;
      beatCursor += chord.beats;
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

/* ─── psBase pattern-driven piano comping ────────────────────────────── */

/**
 * Emit piano comping events for one chord by slicing the psBase piano
 * pattern at the current cycle position and fitting it to the chord.
 *
 * Voice leading + register choice + rhythmic feel are all baked into the
 * recorded pattern, so we just need to translate the source notes (CMaj7-
 * relative) to the destination chord via fitChordPhraseToChord. That uses
 * the same voicing-optimisation logic as the .sty engine.
 */
function renderPsBasePianoComping(
  chord: Chord,
  beatCursor: number,
  cycleBeats: number,
  bi: number,
  barStart: number,
  secPerBeat: number,
  events: BackingEvent[],
): void {
  const sliceStartTick = cycleBeats * PSBASE_PPQ;
  const sliceEndTick = (cycleBeats + chord.beats) * PSBASE_PPQ;
  // Slice + clamp note durations to the slice (acts like Yamaha's STOP
  // RetriggerRule — avoids notes bleeding into the next chord).
  const sliced = PSBASE_CH0_PATTERN.notes
    .filter((n) => n.tick >= sliceStartTick && n.tick < sliceEndTick)
    .map((n) => {
      const relTick = n.tick - sliceStartTick;
      const maxDur = sliceEndTick - n.tick;
      return {
        channel: 0,
        pitch: n.pitch,
        velocity: n.velocity,
        tick: relTick,
        durationTicks: Math.max(1, Math.min(n.durationTicks, maxDur)),
      };
    });
  if (sliced.length === 0) return;

  const destType = chordTypeFromQuality(chord.quality);
  const transformed = fitChordPhraseToChord(
    { channel: 0, notes: sliced },
    PSBASE_CH0_PATTERN.sourceChordRootRelPitch,
    PSBASE_SRC_CHORD_TYPE,
    chord.root,
    destType,
  );

  for (const n of transformed) {
    const offsetBeats = n.tick / PSBASE_PPQ;
    const t = barStart + (beatCursor + offsetBeats) * secPerBeat;
    const dur = Math.max(0.05, (n.durationTicks / PSBASE_PPQ) * secPerBeat);
    events.push({
      kind: "note",
      instrument: "piano",
      midi: n.pitch,
      time: t,
      duration: dur,
      velocity: Math.max(0.3, Math.min(0.85, n.velocity / 127)),
      bar: bi,
    });
  }
}

/**
 * Legacy piano comping (used for Bossa where the psBase swing pattern
 * doesn't fit). Verbatim re-extraction of the pre-rewrite logic. */
function renderLegacyPianoComping(
  chord: Chord,
  beatCursor: number,
  bi: number,
  ci: number,
  barStart: number,
  secPerBeat: number,
  isBossa: boolean,
  events: BackingEvent[],
): void {
  const fullVoicing = voiceChord(chord, []);
  const phrase = Math.floor(bi / 4) % 3;
  const octaveShift = phrase === 0 ? 0 : phrase === 1 ? 12 : -12;
  const voicing = fullVoicing.slice(0, 3).map((n: MidiNote) => n + octaveShift);
  if (voicing.length === 0) return;

  const pattern = selectCompingPattern(chord.beats, bi, ci, isBossa);
  const isSingleHit = pattern.length === 1;
  for (const [offset, velBase] of pattern) {
    if (offset >= chord.beats) continue;
    const t = barStart + (beatCursor + offset) * secPerBeat;
    const vel = velBase + (rand(bi * 97 + ci * 11 + offset * 3) - 0.5) * 0.08;
    const duration = isSingleHit
      ? secPerBeat * chord.beats * 1.1
      : (isBossa ? secPerBeat * 1.1 : secPerBeat * 0.45);
    for (const midi of voicing) {
      events.push({
        kind: "note",
        instrument: "piano",
        midi,
        time: t,
        duration,
        velocity: Math.max(0.3, Math.min(0.78, vel)),
        bar: bi,
      });
    }
  }
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
function selectCompingPattern(beats: number, barIdx: number, chordIdx: number, isBossa: boolean): Array<[number, number]> {
  const pool4 = isBossa ? COMPING_PATTERNS_BOSSA_4BEAT : COMPING_PATTERNS_4BEAT;
  const pool2 = isBossa ? COMPING_PATTERNS_BOSSA_2BEAT : COMPING_PATTERNS_2BEAT;
  if (beats >= 4) {
    const idx = Math.floor(rand(barIdx * 13 + chordIdx * 17) * pool4.length);
    return pool4[idx];
  }
  if (beats >= 2) {
    const idx = Math.floor(rand(barIdx * 19 + chordIdx * 23) * pool2.length);
    return pool2[idx];
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
