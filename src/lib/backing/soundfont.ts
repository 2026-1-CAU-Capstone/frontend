import Soundfont from "soundfont-player";
import { SimpleDrumSynth } from "./drumSynth";

/* Soundfont loading for the backing engine.
 *
 * Phase 0:
 *   - acoustic_grand_piano  (comping)
 *   - acoustic_bass         (walking bass)
 *   - SimpleDrumSynth       (synthesized drum kit via Web Audio)
 *
 * Keeping drums as Web Audio synthesis avoids the GM drum kit rabbit hole
 * with soundfont-player's instrument catalog. Phase 2 can swap in a sampled
 * kit behind the same interface. */

export interface BackingInstruments {
  piano: Soundfont.Player;
  bass: Soundfont.Player;
  drums: SimpleDrumSynth;
}

export async function loadInstruments(ctx: AudioContext): Promise<BackingInstruments> {
  const [piano, bass] = await Promise.all([
    Soundfont.instrument(ctx, "acoustic_grand_piano" as Soundfont.InstrumentName, { gain: 1.5 }),
    Soundfont.instrument(ctx, "acoustic_bass" as Soundfont.InstrumentName, { gain: 2.0 }),
  ]);
  const drums = new SimpleDrumSynth(ctx);
  return { piano, bass, drums };
}
