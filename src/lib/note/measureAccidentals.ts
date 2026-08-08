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
  /**
   * 이 음표가 **타이로 이어받은 뒤쪽 음**(`NoteInfo.tieContinuation`)인지.
   *
   * 기보 규칙(Gould, *Behind Bars*): 타이로 묶인 음에는 임시표를 다시 찍지
   * 않는다 — 타이가 음높이를 이미 전달한다. 같은 마디 안이라면 마디 내 상속이
   * 알아서 억제하지만, **마디를 넘어가는 타이**는 새 마디의 상태가 비어 있어
   * 그냥 두면 ♭/♯ 이 한 번 더 그려진다(MusicXML 원본 대조에서 실제로 발견).
   *
   * 소리는 그대로이므로 마디 내 상태(`active`)는 갱신하고 글리프만 생략한다 —
   * 뒤따르는 같은 음은 이 상태를 상속한다.
   */
  tied?: boolean;
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

  // 타이로 이어받은 음: 기호를 찍지 않고 마디 내 상태도 **건드리지 않는다**.
  //  • 같은 마디 안의 타이 → 앞 음이 남긴 상태가 그대로 살아 있어 뒤따르는 같은
  //    음이 알아서 억제된다.
  //  • 마디를 넘는 타이 → 새 마디의 상태는 비어 있고, 비어 있어야 맞다. 기보
  //    규칙상 넘어온 임시표는 **그 음에만** 유효하므로, 같은 마디 뒤쪽의 같은
  //    음은 자기 임시표를 다시 가져야 한다(원본 조판과 일치).
  if (opts?.tied) return null;

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
    // earlier in the measure away from that default. 조표가 없는 글자의 기본값은
    // 'n' 이다 — undefined 와 'n' 을 같은 것으로 봐야 "앞서 ♮ 를 찍은 음"에
    // 불필요한 ♮ 를 한 번 더 그리지 않는다.
    const ksDefault: RenderAcc = keySigForLetter ?? 'n';
    if (current !== undefined && current !== ksDefault) {
      active.delete(vexKey);
      return ksDefault;
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
