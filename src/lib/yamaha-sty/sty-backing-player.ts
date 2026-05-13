/**
 * Adapter: implement the same BackingPlayer interface (lib/backing/types.ts)
 * but drive playback from a Yamaha .sty file instead of the rule-based
 * engine. This lets ChordPage and friends toggle between the two backends
 * without touching their wiring.
 *
 * High level:
 *   1. fetch + parse a .sty into a Style object
 *   2. load every unique GM program the style touches via smplr
 *   3. play()  — for each Bar of the Chart, advance through Main_A's beat
 *      cycle and transform that slice to the bar's chord, scheduling notes
 *      on the AudioContext clock
 *
 * Caveats / simplifications vs JJazzLab:
 *   - One chord per bar (we use bar.chords[0])
 *   - No fills / intros / endings yet — only Main_A
 *   - No RetriggerRule cross-bar post-processing
 *   - Drums (ch 9 GM) not mapped — psBase uses ch9 for bass so we drop the
 *     drum-kit shape until we add a proper drum mapper
 */

import { Soundfont, DrumMachine } from 'smplr';
import { gmNoteToDrumGroup } from './gm-drum-map';
import { isDrums } from './acc-type';
import type {
  BackingConfig, BackingPlayer, BackingPlayerCallbacks, Chart,
} from '../backing/types';
import { parseStyleFile } from './parser';
import { transformPhrase } from './transform';
import { chordTypeFromQuality } from './quality-map';
import type { Style } from './style';
import type { SourceNoteEvent, StylePart } from './style-part';
import type { StylePartType } from './style-part-type';

/**
 * Decide which StylePart to use for a given Chart section.
 *
 *   Section label 'A' / 'A1' / 'A2'     → Main_A
 *   Section label 'B' / 'B1'             → Main_B
 *   Section label 'Bridge'               → Main_C (or fall back to Main_B)
 *   Section label 'C' / 'C1'             → Main_C
 *   Section label 'D' / 'D1'             → Main_D
 *   isLastSection                        → Ending_A (post-process applies)
 *   Otherwise / not present in style     → Main_A
 *
 * Returns undefined when none of the candidates exist in the style (which
 * means the section is silent for this style — rare but possible for stub
 * styles).
 */
/**
 * Try to find the Yamaha Fill-In pattern that bridges two sections.
 *
 * Yamaha names fills "Fill In AB" = "during A, played to lead into B" etc.
 * Most styles ship the diagonal "AA / BB / CC / DD" fills plus a "BA" or
 * "AB" cross-fade. We try the exact diagonal first, then fall back to the
 * same-letter fill, then to undefined (caller falls back to main pattern).
 */
function pickFillIn(
  style: Style,
  fromLabel: string | undefined,
  toLabel: string | undefined,
): StylePart | undefined {
  const tryGet = (t: StylePartType): StylePart | undefined => style.parts.get(t);
  const from = (fromLabel ?? 'A').charAt(0).toUpperCase();
  const to = (toLabel ?? 'A').charAt(0).toUpperCase();
  if ('ABCD'.includes(from) && 'ABCD'.includes(to)) {
    const cross = `Fill_In_${from}${to}` as StylePartType;
    if (tryGet(cross)) return tryGet(cross);
    const same = `Fill_In_${from}${from}` as StylePartType;
    if (tryGet(same)) return tryGet(same);
  }
  return undefined;
}

function pickStylePart(style: Style, sectionLabel: string | undefined): StylePart | undefined {
  const tryGet = (t: StylePartType): StylePart | undefined => style.parts.get(t);
  const fallback = () => tryGet('Main_A') ?? tryGet('Main_B');
  if (!sectionLabel) return fallback();

  const lc = sectionLabel.toLowerCase();
  if (lc.includes('bridge')) return tryGet('Main_C') ?? tryGet('Main_B') ?? fallback();
  if (lc.startsWith('intro')) return tryGet('Intro_A') ?? fallback();
  if (lc.startsWith('outro') || lc.startsWith('ending')) {
    return tryGet('Ending_A') ?? fallback();
  }
  const first = sectionLabel.charAt(0).toUpperCase();
  switch (first) {
    case 'A': return tryGet('Main_A') ?? fallback();
    case 'B': return tryGet('Main_B') ?? fallback();
    case 'C': return tryGet('Main_C') ?? fallback();
    case 'D': return tryGet('Main_D') ?? fallback();
    default: return fallback();
  }
}

const GM_NAME_BY_PROGRAM: Record<number, string> = {
  0: 'acoustic_grand_piano',
  4: 'electric_piano_1',
  16: 'drawbar_organ',
  24: 'acoustic_guitar_nylon',
  25: 'acoustic_guitar_steel',
  26: 'electric_guitar_jazz',
  27: 'electric_guitar_clean',
  32: 'acoustic_bass',
  33: 'electric_bass_finger',
  34: 'electric_bass_pick',
  40: 'violin',
  48: 'string_ensemble_1',
  50: 'synth_strings_1',
  56: 'trumpet',
  61: 'brass_section',
  65: 'alto_sax',
  66: 'tenor_sax',
  73: 'flute',
};

export interface StyBackingOptions {
  /** URL of the .sty/.sst file (default: '/styles/psBase.sst'). Ignored
   *  when `styleData` is given. */
  styleUrl?: string;
  /** Pre-loaded .sty bytes (priority over `styleUrl`). Use when the file
   *  came from a user upload via IndexedDB. */
  styleData?: ArrayBuffer;
}

export function createStyBackingPlayer(
  chart: Chart,
  initialConfig: BackingConfig = {},
  options: StyBackingOptions = {},
): BackingPlayer {
  const styleUrl = options.styleUrl ?? '/styles/psBase.sst';
  const callbacks: BackingPlayerCallbacks = {};
  let config: BackingConfig = { ...initialConfig };

  let ctx: AudioContext | null = null;
  let style: Style | null = null;
  /** channel (0-15) → smplr Soundfont (melodic instruments) */
  const instByChannel = new Map<number, Soundfont>();
  /** Single DrumMachine shared across all drum-mapped channels. Loaded lazily. */
  let drumMachine: DrumMachine | null = null;
  /** active timer handles for bar callbacks */
  let barTimers: ReturnType<typeof setTimeout>[] = [];
  let playing = false;
  let preloadPromise: Promise<void> | null = null;

  async function preload(): Promise<void> {
    if (preloadPromise) return preloadPromise;
    preloadPromise = (async () => {
      ctx = ctx ?? new AudioContext();
      await ctx.resume();

      let buf: ArrayBuffer;
      if (options.styleData) {
        buf = options.styleData;
      } else {
        const resp = await fetch(styleUrl);
        buf = await resp.arrayBuffer();
      }
      style = parseStyleFile(buf, { name: 'sty' });

      const programs = new Set<number>();
      for (const inst of style.channelInstruments.values()) programs.add(inst.program);

      const instByProgram = new Map<number, Soundfont>();
      await Promise.all(
        Array.from(programs).map(async (prog) => {
          const name = GM_NAME_BY_PROGRAM[prog];
          if (!name) return;
          const inst = new Soundfont(ctx!, { instrument: name, kit: 'FluidR3_GM' });
          await inst.load;
          instByProgram.set(prog, inst);
        }),
      );

      // Lazily kick off a DrumMachine load — even if this style has no drum
      // channels we'll just discard the load. Kit is "TR-808" by default;
      // for jazz contexts a future setting could pick an acoustic kit.
      drumMachine = new DrumMachine(ctx!, { instrument: 'TR-808' });
      await drumMachine.load;

      instByChannel.clear();
      // For each channel we have a Program Change in the SInt section,
      // attach the matching melodic Soundfont. Drum channels (AccType =
      // RHYTHM / SUBRHYTHM) are detected per-section via CTAB metadata
      // and routed through DrumMachine in play(); we don't pre-load them
      // here. Yamaha files often co-opt GM ch9 for non-drum content
      // (psBase uses it for the upright bass), so we can't blanket-skip
      // by channel number — the CTAB AccType is the real signal.
      for (const [ch, instSpec] of style.channelInstruments) {
        const inst = instByProgram.get(instSpec.program);
        if (inst) instByChannel.set(ch, inst);
      }
    })();
    return preloadPromise;
  }

  function clearBarTimers() {
    for (const t of barTimers) clearTimeout(t);
    barTimers = [];
  }

  function stopAllInstruments() {
    for (const inst of instByChannel.values()) inst.stop();
    drumMachine?.stop();
  }

  async function play(opts: { startAt?: number } = {}): Promise<void> {
    if (!ctx || !style) await preload();
    if (!ctx || !style) return;
    playing = true;
    clearBarTimers();

    const ppq = style.ticksPerQuarter;
    const tempo = config.bpm ?? chart.bpm;
    const secondsPerBeat = 60 / tempo;
    const beatsPerBar = chart.timeSig[0];

    let absoluteTime = opts.startAt ?? (ctx.currentTime + 0.1);
    let barIndex = 0;

    for (let sIdx = 0; sIdx < chart.sections.length; sIdx++) {
      const section = chart.sections[sIdx];
      const nextSection = chart.sections[sIdx + 1];
      const mainStylePart = pickStylePart(style, section.label);
      if (!mainStylePart) {
        // No usable StylePart — skip the section silently (still tick barIndex).
        for (const _ of section.bars) {
          const idx = barIndex;
          const delay = Math.max(0, (absoluteTime - ctx.currentTime) * 1000);
          barTimers.push(setTimeout(() => callbacks.onBar?.(idx), delay));
          barIndex++;
          absoluteTime += beatsPerBar * secondsPerBeat;
        }
        continue;
      }
      const styleBarsPerCycle = Math.max(1, Math.round(mainStylePart.sizeInBeats / beatsPerBar));
      let cyclePos = 0;
      for (let bIdx = 0; bIdx < section.bars.length; bIdx++) {
        const bar = section.bars[bIdx];
        const isLastBarOfSection = bIdx === section.bars.length - 1;
        const wantsFill = isLastBarOfSection && nextSection !== undefined
          && nextSection.label !== section.label;
        const fill = wantsFill ? pickFillIn(style, section.label, nextSection?.label) : undefined;
        const mainA = fill ?? mainStylePart;
        const chord = bar.chords[0];
        if (chord) {
          const chordType = chordTypeFromQuality(chord.quality);
          // Slice = beats [cyclePos * beatsPerBar, (cyclePos + 1) * beatsPerBar)
          const sliceStartTick = cyclePos * beatsPerBar * ppq;
          const sliceEndTick = (cyclePos + 1) * beatsPerBar * ppq;

          for (const [ch, phrase] of mainA.phraseByChannel) {
            const ctab = mainA.ctabByChannel.get(ch);
            if (!ctab) continue;

            // Slice the source phrase to the current bar's beat window and
            // re-base its ticks to 0. We also cap each note's duration so
            // it ends within this bar — equivalent to RetriggerRule = STOP
            // for cross-bar notes. PITCH_SHIFT (Yamaha's pitch-bend retrigger)
            // is not yet implemented; STOP avoids notes from the previous
            // chord bleeding through to the next one, which is the most
            // important musical correctness for chord transitions.
            const sliceLengthTick = sliceEndTick - sliceStartTick;
            const slicedNotes = phrase.notes
              .filter((n) => n.tick >= sliceStartTick && n.tick < sliceEndTick)
              .map<SourceNoteEvent>((n) => {
                const relTick = n.tick - sliceStartTick;
                const maxDur = sliceLengthTick - relTick;
                return {
                  ...n,
                  tick: relTick,
                  durationTicks: Math.max(1, Math.min(n.durationTicks, maxDur)),
                };
              });
            if (slicedNotes.length === 0) continue;

            // Prefer the melodic Soundfont if one is mounted for this
            // channel. Some Yamaha styles label channels as RHYTHM /
            // SUBRHYTHM (drum AccType) while routing a melodic program
            // (e.g. psBase puts a violin on ch 15 with AccType=RHYTHM),
            // and routing that into the DrumMachine via gmNoteToDrumGroup
            // produces near-silence. The right discriminator is "do we
            // have a melodic Soundfont instance?" — if yes, use it.
            const inst = instByChannel.get(ch);
            if (inst) {
              const transformed = transformPhrase(
                { channel: ch, notes: slicedNotes },
                ctab,
                {
                  rootRelPitch: chord.root,
                  chordType,
                  bassRelPitch: chord.bass ?? chord.root,
                },
              );
              for (const n of transformed) {
                const t = absoluteTime + (n.tick / ppq) * secondsPerBeat;
                const dur = Math.max(0.05, (n.durationTicks / ppq) * secondsPerBeat);
                inst.start({
                  note: n.pitch,
                  time: t,
                  duration: dur,
                  velocity: n.velocity,
                });
              }
              continue;
            }

            // No melodic Soundfont — fall back to DrumMachine if this is
            // a real drum AccType. Drum patterns aren't chord-transposed.
            if (isDrums(ctab.accType) && drumMachine) {
              for (const n of slicedNotes) {
                const group = gmNoteToDrumGroup(n.pitch);
                if (!group) continue;
                const t = absoluteTime + (n.tick / ppq) * secondsPerBeat;
                drumMachine.start({
                  note: group,
                  time: t,
                  velocity: n.velocity,
                });
              }
              continue;
            }
            // Channel has neither a melodic Soundfont nor a drum-acc-type
            // mapping — drop it. Real Yamaha styles sometimes leave a
            // channel's program unassigned; we silently skip rather than
            // crash.
          }
        }

        // schedule onBar callback at bar start
        const wallDelay = Math.max(0, (absoluteTime - ctx.currentTime) * 1000);
        const idx = barIndex;
        barTimers.push(setTimeout(() => callbacks.onBar?.(idx), wallDelay));

        cyclePos = (cyclePos + 1) % styleBarsPerCycle;
        barIndex++;
        absoluteTime += beatsPerBar * secondsPerBeat;
      }
    }

    // onDone after the last bar finishes
    const totalDelay = Math.max(0, (absoluteTime - ctx.currentTime) * 1000);
    barTimers.push(setTimeout(() => {
      playing = false;
      callbacks.onDone?.();
    }, totalDelay));
  }

  function pause() {
    playing = false;
    clearBarTimers();
    stopAllInstruments();
  }

  function stop() {
    pause();
  }

  function dispose() {
    pause();
    instByChannel.clear();
    drumMachine = null;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
    ctx = null;
    style = null;
    preloadPromise = null;
  }

  return {
    get playing() { return playing; },
    play,
    preload,
    pause,
    stop,
    setConfig(next) { config = { ...config, ...next }; },
    dispose,
    ctxNow() { return ctx?.currentTime ?? 0; },
    on(ev, cb) { callbacks[ev] = cb as never; },
  };
}
