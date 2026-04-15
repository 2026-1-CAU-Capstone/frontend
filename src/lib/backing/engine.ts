import type { BackingEvent, Bar, Chart, Chord } from "./types";
import { swingBar } from "./drums";
import { walkChord } from "./bass";
import { voiceChord } from "./voicing";

/* ─────────────────────────────────────────────────────────────────────────
 * Engine — turns a Chart into a timed stream of BackingEvents.
 *
 * Phase 0 responsibilities:
 *   - Walk sections/bars in order (ignoring repeats/endings)
 *   - Apply default style (medium-swing) and default feel (swing)
 *   - Delegate per-instrument pattern generation to drums/bass/voicing
 *
 * Later phases add:
 *   - Section/bar style+feel overrides → dispatch table
 *   - Figure & unison rendering (break normal pattern on figure bars)
 *   - Instruction handling (stop-time, break, tag, vamp)
 *   - Repeat/volta expansion
 * ──────────────────────────────────────────────────────────────────────── */

export interface RenderOptions {
  /** Effective bpm after config override. */
  bpm: number;
}

export function renderChart(chart: Chart, opts: RenderOptions): BackingEvent[] {
  const secPerBeat = 60 / opts.bpm;
  const beatsPerBar = chart.timeSig[0];
  const secPerBar = beatsPerBar * secPerBeat;

  // Flatten all bars across sections (no repeat expansion in Phase 0).
  const flatBars: Bar[] = [];
  for (const sec of chart.sections) flatBars.push(...sec.bars);

  const events: BackingEvent[] = [];

  for (let bi = 0; bi < flatBars.length; bi++) {
    const bar = flatBars[bi];
    const barStart = bi * secPerBar;

    // Drums — one swing pattern per bar
    events.push(
      ...swingBar({
        secPerBeat,
        barStart,
        beatsInBar: beatsPerBar,
        barIndex: bi,
      }),
    );

    // Chord-level events (bass walking + piano comping)
    let beatCursor = 0;
    for (let ci = 0; ci < bar.chords.length; ci++) {
      const chord = bar.chords[ci];
      const next = nextChord(bar, ci, flatBars, bi);

      // Walking bass
      for (const bn of walkChord(chord, next, chord.beats)) {
        events.push({
          kind: "note",
          instrument: "bass",
          midi: bn.midi,
          time: barStart + (beatCursor + bn.beatOffset) * secPerBeat,
          duration: secPerBeat * 0.92,
          velocity: 0.72,
          bar: bi,
        });
      }

      // Piano comping (shell voicing on jazz comping hits)
      const voicing = voiceChord(chord);
      if (voicing.length > 0) {
        const hits = compingHits(chord.beats);
        for (const hitBeat of hits) {
          const t = barStart + (beatCursor + hitBeat) * secPerBeat;
          for (const midi of voicing) {
            events.push({
              kind: "note",
              instrument: "piano",
              midi,
              time: t,
              duration: secPerBeat * 0.55,
              velocity: 0.55,
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

function nextChord(
  bar: Bar,
  ci: number,
  flatBars: Bar[],
  bi: number,
): Chord | null {
  if (ci < bar.chords.length - 1) return bar.chords[ci + 1];
  const nb = flatBars[bi + 1];
  return nb?.chords[0] ?? null;
}

/**
 * Classic jazz comping hit pattern (offsets within a chord, in beats).
 *   - ≥ 4 beats: hit on beats 2 and 4 ("and of 1" style omitted for Phase 0)
 *   - 2-3 beats: one hit on beat 2 of the chord
 *   - 1 beat:    single hit on the downbeat
 */
function compingHits(beats: number): number[] {
  if (beats >= 4) return [1, 3];
  if (beats >= 2) return [1];
  return [0];
}
