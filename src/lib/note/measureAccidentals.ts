/**
 * Canonical accidental rule for VexFlow note rendering (octave-aware).
 *
 * Standard engraving rule (Elaine Gould, *Behind Bars*): within a measure an
 * accidental persists ONLY for the SAME pitch — same letter AND same octave —
 * until the barline. A note in a DIFFERENT octave is unaffected:
 *   • it does NOT inherit the earlier flat/sharp,
 *   • it does NOT need a cautionary natural, and
 *   • if it must be altered it carries its OWN accidental.
 * The key signature stays letter-based (it applies to every octave of a letter).
 *
 * Consequence — the rendered accidental always matches the note's true (played)
 * pitch, e.g. a high B♭ followed by a low B prints the low B with no natural,
 * and a high E♭ followed by a low E♭ re-prints the flat on the low one.
 *
 * Keep this as the single source of truth so the lick renderers (chat cards,
 * inline licks) never diverge again. `active` is per-measure state keyed by the
 * FULL vex key WITH octave (e.g. 'e/4'); create one empty Map per measure and
 * pass it on every note in source order.
 */

export type SourceAcc = 'b' | '#' | '##' | 'bb';
export type RenderAcc = SourceAcc | 'n';

export interface ResolveAccidentalOpts {
  /**
   * Courtesy mode (full scores / MusicXML, e.g. NoteSheet). When true, an
   * explicit source accidental is printed even if it matches the key signature
   * (the engraver marked it on purpose — often a courtesy after an alteration
   * elsewhere), and a cancelling natural restores the key-signature default
   * rather than a bare ♮. When false (default — licks, melodies), an accidental
   * that already matches the effective state (in-measure OR key signature) is
   * suppressed. Both modes are equally octave-aware.
   */
  courtesy?: boolean;
}

export function resolveMeasureAccidental(
  active: Map<string, RenderAcc>,
  keySig: Map<string, 'b' | '#'> | undefined,
  vexKey: string,                  // natural letter + octave, e.g. 'e/4'
  dataAcc: RenderAcc | undefined,  // explicit accidental from source data, if any (incl. explicit 'n')
  opts?: ResolveAccidentalOpts,
): RenderAcc | null {
  const courtesy = opts?.courtesy ?? false;
  const letter = vexKey.split('/')[0];
  const current = active.get(vexKey);             // octave-specific in-measure state
  const keySigForLetter = keySig?.get(letter);

  if (dataAcc) {
    active.set(vexKey, dataAcc);
    // Print it unless this exact pitch already carries the same accidental.
    // Courtesy mode only suppresses on a true in-measure carry (ignores keysig).
    const effective = courtesy ? current : (current ?? keySigForLetter);
    return effective !== dataAcc ? dataAcc : null;
  }

  // No explicit accidental → natural. A different octave never triggers a ♮.
  if (courtesy) {
    // Cancel back to the key-signature default only if THIS pitch was altered
    // earlier in the measure away from that default.
    if (current !== undefined && current !== keySigForLetter) {
      active.delete(vexKey);
      return keySigForLetter ?? 'n';
    }
    return null;
  }
  const effective = current ?? keySigForLetter;
  if (effective && effective !== 'n') {
    active.set(vexKey, 'n');
    return 'n';
  }
  return null;
}
