/**
 * TAB 자동 운지 — 음정(MIDI)만 저장하고, 현·프렛은 **렌더 시 여기서 계산**한다.
 *
 * 정책 (기타 교재의 포지션 연주 관행):
 *  - 손 위치(handPos, 대략 검지 프렛)를 추적하고, 각 음은 |fret - handPos| 가
 *    가장 작은 현을 고른다. 동점이면 낮은 프렛 → 높은 현(가는 줄) 우선.
 *  - 개방현(0프렛)은 손 위치와 무관하게 항상 후보(보너스 없이 동일 비용의
 *    대안으로만 — 개방현 남발로 라인이 널뛰지 않게).
 *  - 화음은 낮은 음부터 굵은 줄에 배정하며 한 줄에 한 음.
 *  - 악기 음역 밖 음은 옥타브 시프트로 끌어들인다(표기 전용 — 소리는 원래
 *    음정 그대로). shifted 플래그로 표시를 남긴다.
 */

export interface TabPos {
  /** 1 = 가장 가는 줄(TAB 맨 윗줄) … N = 가장 굵은 줄. VexFlow TabNote 규약. */
  str: number;
  fret: number;
  /** 음역 밖이라 표기용으로 옥타브 이동됨. */
  shifted?: boolean;
  /** 제약(현 중복 금지·스팬)을 다 완화해도 답이 없어 겹침 배정된 음 —
   *  물리적으로 잡을 수 없는 보이싱임을 뜻한다(표기는 되지만 신뢰 금지). */
  impossible?: boolean;
}

/** 표준 튜닝 — index 0 = 1번줄(가는 줄). */
export const GUITAR_TUNING: number[] = [64, 59, 55, 50, 45, 40]; // e4 b3 g3 d3 a2 e2
export const BASS_TUNING: number[] = [43, 38, 33, 28];           // g2 d2 a1 e1
export const BASS5_TUNING: number[] = [43, 38, 33, 28, 23];      // g2 d2 a1 e1 B0
/** 우쿨렐레 High-G 리엔트런트 — 4번줄(g4)이 3번줄(c4)보다 높다. 운지 탐색은
 *  줄별 (개방음+프렛) 후보만 보므로 리엔트런트여도 그대로 성립한다. */
export const UKULELE_TUNING: number[] = [69, 64, 60, 67];        // a4 e4 c4 g4

const MAX_FRET = 17;

/** 음역 밖 MIDI 를 표기 가능한 옥타브로 이동.
 *  ⚠ 리엔트런트 튜닝(우쿨렐레 High-G: 4번줄이 3번줄보다 높다)이 있어
 *  "마지막 줄 = 최저음"을 가정하면 안 된다 — min/max 로 실제 음역을 잡는다. */
function clampToRange(midi: number, tuning: number[]): { midi: number; shifted: boolean } {
  const lo = Math.min(...tuning);                   // 실제 최저 개방현
  const hi = Math.max(...tuning) + MAX_FRET;        // 실제 최고 프렛 음
  let m = midi; let shifted = false;
  while (m < lo) { m += 12; shifted = true; }
  while (m > hi) { m -= 12; shifted = true; }
  return { midi: m, shifted };
}

/** 한 음의 후보 (현, 프렛) 목록. */
function candidates(midi: number, tuning: number[]): TabPos[] {
  const out: TabPos[] = [];
  for (let i = 0; i < tuning.length; i++) {
    const fret = midi - tuning[i];
    if (fret >= 0 && fret <= MAX_FRET) out.push({ str: i + 1, fret });
  }
  return out;
}

function cost(fret: number, handPos: number): number {
  if (fret === 0) return Math.min(2, handPos * 0.4); // 개방현 — 저포지션일수록 자연스러움
  return Math.abs(fret - handPos);
}

/** 한 화음 안에서 프렛 손가락이 벌릴 수 있는 최대 폭(개방현 제외). */
const MAX_CHORD_SPAN = 4;

/**
 * 화음 하나의 운지 — **백트래킹 전수 탐색**.
 *
 * 하드 제약: ① 한 현에 한 음(중복 금지) ② 프렛 짚는 음들의 스팬 ≤ MAX_CHORD_SPAN
 * (개방현은 스팬 계산 제외 — 실제 연주와 동일). 비용 = Σ손위치거리 + 스팬 패널티.
 * 해가 없으면 스팬 제약을 풀고 재시도, 그래도 없으면(현 수 < 음 수 등) 겹침을
 * 허용하되 impossible 플래그를 남긴다 — 예전 그리디는 이 폴백을 **조용히**
 * 일상 케이스에서도 탔다(Drop2 보이싱이 1번줄 두 번 배정되는 버그).
 *
 * overrides: keyIndex → 강제 현 번호(수동 운지). 그 현에서 음이 안 나면 무시.
 */
function assignChord(
  midis: number[],
  tuning: number[],
  handPos: number,
  overrides?: Record<number, number> | null,
): TabPos[] {
  const clamped = midis.map((m) => clampToRange(m, tuning));
  const cands: TabPos[][] = clamped.map(({ midi }, i) => {
    const all = candidates(midi, tuning);
    const forced = overrides?.[i];
    if (forced != null) {
      const hit = all.find((c) => c.str === forced);
      if (hit) return [hit];   // 수동 지정 — 유효할 때만 강제
    }
    return all;
  });

  let best: TabPos[] | null = null;
  let bestCost = Infinity;
  const pick: TabPos[] = new Array(midis.length);

  const solve = (enforceSpan: boolean) => {
    const used = new Set<number>();
    const rec = (i: number, acc: number, fMin: number, fMax: number) => {
      if (acc >= bestCost) return;                       // 가지치기
      if (i === midis.length) {
        const span = fMax >= fMin ? fMax - fMin : 0;
        const total = acc + span * 0.7;
        if (total < bestCost) { bestCost = total; best = pick.slice(); }
        return;
      }
      for (const c of cands[i]) {
        if (used.has(c.str)) continue;
        let nMin = fMin, nMax = fMax;
        if (c.fret > 0) { nMin = Math.min(nMin, c.fret); nMax = Math.max(nMax, c.fret); }
        if (enforceSpan && nMax >= nMin && nMax - nMin > MAX_CHORD_SPAN) continue;
        used.add(c.str);
        pick[i] = c;
        rec(i + 1, acc + cost(c.fret, handPos), nMin, nMax);
        used.delete(c.str);
      }
    };
    rec(0, 0, Infinity, -Infinity);
  };

  solve(true);
  if (!best) solve(false);      // 스팬 완화 — 중복 금지는 유지
  if (best) {
    return (best as TabPos[]).map((c, i) => (clamped[i].shifted ? { ...c, shifted: true } : c));
  }
  // 최후 폴백(음 수 > 현 수 등) — 겹침 배정 + impossible 표시.
  return clamped.map(({ shifted }, i) => {
    const c = cands[i][0] ?? { str: tuning.length, fret: 0 };
    return { ...c, impossible: true, ...(shifted ? { shifted: true } : {}) };
  });
}

/**
 * 마디들의 음표별 MIDI 배열(resolveSheetMidis 결과와 같은 구조; 쉼표는 null)을
 * 받아 같은 구조의 TabPos 배열을 돌려준다.
 *
 * overrides: 같은 [마디][음표] 구조로 keyIndex→현 번호 수동 지정(선택).
 */
export function assignTabPositions(
  midisPerNote: (number[] | null)[][],
  tuning: number[],
  overrides?: ((Record<number, number> | null | undefined)[] | null | undefined)[],
): (TabPos[] | null)[][] {
  let handPos = 2; // 시작은 로우 포지션
  return midisPerNote.map((measure, mi) => measure.map((midis, ni) => {
    if (!midis) return null;
    const byInput = assignChord(midis, tuning, handPos, overrides?.[mi]?.[ni]);
    let fretSum = 0; let fretN = 0;
    for (const c of byInput) {
      if (c.fret > 0) { fretSum += c.fret; fretN += 1; }
    }
    if (fretN > 0) {
      const avg = fretSum / fretN;
      handPos = handPos * 0.5 + avg * 0.5; // 손 위치 완만 추적
    }
    return byInput;
  }));
}
