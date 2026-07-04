/* 도돌이표(|: :|)·볼타(1./2.)·내비게이션(D.C./D.S./Coda/Fine) 전개.
 *
 * useNoteSheetPlayback(피아노 단독 재생)에 있던 로직을 그대로 추출한 순수
 * 함수 — 에디터의 백킹 재생(useEditorBackingPlayback)도 같은 전개를 써서
 * 도돌이가 재생에 반영되게 한다. 각 항목은 원본 마디 인덱스(origMi)를
 * 유지해 재생 하이라이트가 전개 전 악보의 마디를 가리킬 수 있게 한다. */
import type { MeasureInfo } from '../../data/sampleMelody';

export interface ExpandedMeasure { m: MeasureInfo; origMi: number }

export function expandMeasures(srcMeasures: MeasureInfo[]): ExpandedMeasure[] {
  const expandedMeasures: ExpandedMeasure[] = [];

  // Phase 1: expand repeats + volta
  const afterRepeats: ExpandedMeasure[] = [];
  let repeatFromIdx = 0;
  let mi = 0;
  while (mi < srcMeasures.length) {
    const m = srcMeasures[mi];
    if (m.repeatStart) repeatFromIdx = mi;
    afterRepeats.push({ m, origMi: mi });

    if (m.repeatEnd) {
      for (let ri = repeatFromIdx; ri <= mi; ri++) {
        if (srcMeasures[ri].volta === 1) break;
        afterRepeats.push({ m: srcMeasures[ri], origMi: ri });
      }
      let vi = mi + 1;
      while (vi < srcMeasures.length && srcMeasures[vi].volta === 2) {
        afterRepeats.push({ m: srcMeasures[vi], origMi: vi });
        vi++;
      }
      mi = vi;
      continue;
    }
    mi++;
  }

  // Phase 2: expand D.C./D.S./Coda/Fine navigation
  const segnoIdx = afterRepeats.findIndex((e) => e.m.navigation === 'segno');
  const codaIdx = afterRepeats.findIndex((e) => e.m.navigation === 'coda');

  let jumped = false;
  for (let ai = 0; ai < afterRepeats.length; ai++) {
    const entry = afterRepeats[ai];
    expandedMeasures.push(entry);
    const nav = entry.m.navigation;
    if (!nav || jumped) continue;

    if (nav === 'fine') break;
    if (nav === 'toCoda' && !jumped) continue;
    if (nav === 'dc' || nav === 'dcAlCoda' || nav === 'dcAlFine' ||
        nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine') {
      jumped = true;
      const jumpTo = (nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine')
        ? Math.max(0, segnoIdx) : 0;
      const alCoda = nav === 'dcAlCoda' || nav === 'dsAlCoda';
      const alFine = nav === 'dcAlFine' || nav === 'dsAlFine';

      for (let ri = jumpTo; ri < afterRepeats.length; ri++) {
        const re = afterRepeats[ri];
        expandedMeasures.push(re);
        if (alCoda && re.m.navigation === 'toCoda') {
          if (codaIdx >= 0) {
            for (let ci = codaIdx; ci < afterRepeats.length; ci++) {
              expandedMeasures.push(afterRepeats[ci]);
            }
          }
          break;
        }
        if (alFine && re.m.navigation === 'fine') break;
        if (!alCoda && !alFine && (nav === 'dc' || nav === 'ds') && ri === afterRepeats.length - 1) break;
      }
      break;
    }
  }
  return expandedMeasures;
}
