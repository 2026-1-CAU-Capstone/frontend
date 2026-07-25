/* 조성 추정(key suggestion) — 순수 모듈. React 의존 없음.
 *
 * "이 차트에 적힌 조성이 실제 코드 진행과 맞는가"를 채점한다. 별도의 ML 모델은
 * 필요 없다. 코드 심볼은 이미 이산적인 화성 기호라 화성 문법 자체가 규칙이며,
 * 근거는 전부 기존 analyzeHarmony() 의 산출물을 재사용한다.
 *
 * ── 채점 근거 (실측으로 확정한 것) ──────────────────────────────────────
 *  1) 설명 불가(unexplained) 코드 — 논다이아토닉인데 secondaryDominant / subV /
 *     modalInterchange 어느 것으로도 설명되지 않는 코드. 감점.
 *     ※ "논다이아토닉 개수"를 그대로 세면 안 된다. 올바른 키에서도 세컨더리
 *        도미넌트·트라이톤 서브는 정상적으로 논다이아토닉이다.
 *
 *  2) 으뜸화음으로 해결되는 케이던스 — 재즈에서 가장 강한 증거.
 *     ※ 주의: detectGroups() 의 ii-V-I 탐지는 근음 진행 + 코드 성질만 보므로
 *        키와 무관하다. 따라서 "케이던스 개수"는 24개 후보 키 전부에 똑같이
 *        붙어 판별력이 0이다(실측 확인). 반드시 그 그룹의 role:'I' 코드가
 *        으뜸음에 떨어지는지, 그리고 variant 가 조성의 장/단조와 맞는지를 봐야
 *        비로소 판별자가 된다.
 *
 *  3) 마지막 코드가 으뜸화음 — 관계조 판별의 결정타.
 *     (B♭ major 와 G minor 는 다이아토닉 집합이 완전히 같아 1)·2)로 못 가른다.
 *      Autumn Leaves 가 Gm 으로 끝나므로 G minor 가 이긴다.)
 *     ※ 근음만 비교하면 안 된다. 차트 끝이 턴어라운드(예: …G7)면 근음 G 때문에
 *        G/Gm 이 부당하게 가점된다(실측으로 오답 발생). 성질까지 봐서 실제
 *        으뜸화음일 때만 가점한다.
 *
 *  4) 첫 코드가 으뜸화음 — 약한 보조 증거.
 *
 * ── 물러서야 하는 경우 ─────────────────────────────────────────────────
 *  · 블루스(I7 IV7 V7 전부 도미넌트): 어느 장조에도 맞지 않는다.
 *  · 모달 곡: 기능 화성이 없다.
 *  · 곡 중간 전조: 애초에 곡 전체를 한 개 키로 표현할 수 없다.
 *  → 최선 후보조차 설명력이 낮고 으뜸 케이던스도 없으면 modal=true 로 반환하고
 *    억지로 키를 제안하지 않는다.
 */

import type { LeadSheetChord, LeadSheetData } from '../../data/leadSheetTypes';
import { analyzeHarmony, parseKey } from '../../lib/harmonyAnalyzer';
import { ALL_MAJOR_KEYS, ALL_MINOR_KEYS } from './leadSheetTranspose';

/* ── 튜닝 상수 ────────────────────────────────────────────────────────── */

/** 으뜸 케이던스 가점이 곡 길이에 비례해 무한정 커지면 긴 곡이 편향된다.
 *  또한 재즈에선 부차적 조성이 자주 토닉화된다(All of Me 의 Dm 은 ii 인데도
 *  ii-V-i 로 여러 번 해결된다). 그래서 케이던스 '개수'의 가중치는 낮게 잡고,
 *  아래의 '으뜸화음 체류 시간'이 주된 판별자가 되게 한다. */
const MAX_TONIC_CADENCE_CREDIT = 3;
const W_TONIC_CADENCE = 8;

/** 곡의 조성을 결정하는 것은 '마지막 완결 케이던스가 어디로 해결되는가' 다.
 *  All of Me 는 Dm 으로 해결되는 ii-V-i 가 여러 번 있어(ii 의 토닉화) 케이던스
 *  개수·체류 시간만으로는 Dm 이 C 를 이겨버린다(실측). 하지만 마지막 완결
 *  케이던스는 C 로 떨어진다. 케이던스 탐지가 키와 무관하므로, '마지막 I 코드'는
 *  모든 후보 키가 공유하는 고정 앵커가 되어 결정적 판별자로 쓸 수 있다. */
const W_LAST_CADENCE = 30;

/** 으뜸화음이 곡 전체에서 차지하는 시간 비중. 진짜 으뜸조는 오래 머물고,
 *  토닉화된 부차 조성(Dm)은 스쳐 지나간다. Krumhansl 키 프로파일이 포착하는
 *  것과 같은 신호를, 코드 차트에선 이렇게 직접 잴 수 있다. */
const W_TONIC_TIME = 80;

const W_FINAL_TONIC = 24;
const W_FIRST_TONIC = 6;

/** 현재 키보다 이만큼 이상 좋아야 "바꾸라"고 제안한다. 관계조끼리는 점수가
 *  붙어 있는 경우가 많아, 마진이 없으면 무의미한 알림이 계속 뜬다. */
export const SUGGEST_MARGIN = 12;

/** 최선 후보조차 이 비율 넘게 설명 못 하고 으뜸 케이던스도 0이면 → 조성 없음. */
const MODAL_UNEXPLAINED_RATIO = 0.35;

/** 현재 키가 '스스로 설득력 있다'고 볼 설명 실패 상한. 이보다 잘 설명하고
 *  토닉 근거가 하나라도 있으면 제안하지 않는다(오탐 방지). */
const SELF_CONSISTENT_UNEXPLAINED = 0.15;

/* harmonyAnalyzer 의 normalizeQualityForAnalysis() 가 뱉는 토큰 기준.
 * 으뜸화음 자격: 장조는 장3화음 계열, 단조는 단3화음 계열만. dom7 은 어느
 * 쪽에서도 으뜸이 아니며(딸림화음), min7b5·dim 도 아니다. */
const MAJOR_TONIC_QUALITIES = new Set(['maj', 'maj7', 'maj6']);
const MINOR_TONIC_QUALITIES = new Set(['min', 'min7', 'min6']);

/** 블루스 관용 — I7·IV7·V7 이 전부 도미넌트인 형태.
 *
 *  블루스에서 으뜸화음은 장3화음이 아니라 **I7(도미넌트)** 이다. 이걸 모르면
 *  진짜 으뜸조가 "으뜸화음 0회"로 채점돼 모든 토닉 항목에서 0점을 받고, 그
 *  사이 ii 가 세컨더리 도미넌트로 토닉화된 관계단조가 이겨버린다.
 *  (실측: F 블루스 → F 100.0 vs Gm 157.4. D7→Gm7 이 두 번 나와 Gm 이
 *   케이던스·마지막케이던스를 싹쓸이. F 는 Eb·Bb·Cm 과 동점이라 신호 0.)
 *
 *  오검출 방지: dom7 세 개가 우연히 I·IV·V 자리에 놓이는 일은 흔하다
 *  (All of Me 의 D7·G7·A7 → D 장조가 블루스로 오인될 수 있다). 그래서
 *  "그 I7 이 실제로 곡의 중심인가"를 함께 요구한다 — 첫 코드가 I7 이거나,
 *  I7 이 곡의 30% 이상을 차지할 것. */
const W_BLUES = 60;
const BLUES_TONIC_MIN_RATIO = 0.3;

/* ── 타입 ─────────────────────────────────────────────────────────────── */

export interface KeyScore {
  /** ALL_MAJOR_KEYS / ALL_MINOR_KEYS 의 정규 표기 (예: 'Ab', 'Gm'). */
  key: string;
  score: number;
  /** 설명되지 않는 코드가 차지하는 비중(0~1). 낮을수록 좋다. */
  unexplainedRatio: number;
  /** 으뜸화음으로 해결되는 '서로 다른' 딸림화음의 수(반복 제거). */
  tonicCadences: number;
  /** 으뜸화음이 차지하는 시간 비중(0~1). 높을수록 좋다. */
  tonicTimeRatio: number;
  /** 곡의 마지막 완결 케이던스가 이 조성의 으뜸화음으로 해결되는가. 결정적 신호. */
  lastCadenceTonic: boolean;
  finalTonic: boolean;
  firstTonic: boolean;
}

export interface KeySuggestion {
  /** 차트에 적힌 현재 조성의 점수. */
  current: KeyScore;
  /** 최고점 후보. */
  best: KeyScore;
  /** 점수 내림차순 전체 24키. */
  ranked: KeyScore[];
  /** 모달/블루스/전조 등으로 단일 조성을 특정할 수 없음. */
  modal: boolean;
  /** 사용자에게 변경을 권할 만한가. modal 이면 항상 false. */
  shouldSuggest: boolean;
}

/* ── 헬퍼 ─────────────────────────────────────────────────────────────── */

/** 'G-' · 'Gm' · 'g' 등 어떤 표기로 들어와도 정규 표기로 되돌린다. */
export function canonicalKey(key: string | undefined): string {
  const { pc, isMinor } = parseKey(key ?? 'C');
  return isMinor ? ALL_MINOR_KEYS[pc] : ALL_MAJOR_KEYS[pc];
}

const ALL_KEYS: string[] = [...ALL_MAJOR_KEYS, ...ALL_MINOR_KEYS];

function cloneData(data: LeadSheetData): LeadSheetData {
  return typeof structuredClone === 'function'
    ? structuredClone(data)
    : (JSON.parse(JSON.stringify(data)) as LeadSheetData);
}

/** analyzeHarmony 가 analysis 를 채운 코드만 순서대로 뽑는다.
 *  (반복 기호(%)·심볼 없는 칸은 analysis 가 없으므로 자연히 제외된다.) */
function analyzedChords(data: LeadSheetData): LeadSheetChord[] {
  const out: LeadSheetChord[] = [];
  for (const system of data.systems ?? []) {
    for (const bar of system.bars ?? []) {
      for (const chord of bar.chords ?? []) {
        if (chord.analysis?.rootPc != null) out.push(chord);
      }
    }
  }
  return out;
}

/** 논다이아토닉이면서 어떤 화성적 장치로도 설명되지 않는가. */
function isUnexplained(chord: LeadSheetChord): boolean {
  const a = chord.analysis;
  if (!a || a.isDiatonic) return false;
  return !a.secondaryDominant && !a.subV && !a.modalInterchange;
}

/** 이 코드가 해당 조성의 으뜸화음인가 (근음 + 성질 둘 다).
 *  `blues` 면 장조에서 I7(dom7)도 으뜸화음으로 인정한다(블루스 관용). */
function isTonicChord(
  chord: LeadSheetChord, keyPc: number, isMinor: boolean, blues = false,
): boolean {
  const a = chord.analysis;
  if (!a || a.rootPc !== keyPc) return false;
  const q = a.normalizedQuality ?? '';
  if (isMinor) return MINOR_TONIC_QUALITIES.has(q);
  if (blues && q === 'dom7') return true;
  return MAJOR_TONIC_QUALITIES.has(q);
}

/** 이 후보 조성에서 곡이 '블루스'인가 — I7·IV7·V7 이 모두 도미넌트로 존재하고,
 *  그 I7 이 실제로 곡의 중심(첫 코드이거나 30% 이상)일 때. */
function isBluesIn(chords: LeadSheetChord[], keyPc: number, isMinor: boolean): boolean {
  if (isMinor) return false; // 단조 블루스는 별도 관용 — 여기선 다루지 않는다
  const domRoots = new Set<number>();
  let totalW = 0;
  let tonicDomW = 0;
  for (const c of chords) {
    const a = c.analysis;
    if (!a || a.rootPc == null) continue;
    const w = c.durationBeats ?? 1;
    totalW += w;
    if (a.normalizedQuality === 'dom7') {
      domRoots.add(a.rootPc);
      if (a.rootPc === keyPc) tonicDomW += w;
    }
  }
  const hasIIVV = domRoots.has(keyPc)
    && domRoots.has((keyPc + 5) % 12)
    && domRoots.has((keyPc + 7) % 12);
  if (!hasIIVV) return false;

  const first = chords[0]?.analysis;
  const firstIsTonicDom = first?.rootPc === keyPc && first?.normalizedQuality === 'dom7';
  const ratio = totalW > 0 ? tonicDomW / totalW : 0;
  return firstIsTonicDom || ratio >= BLUES_TONIC_MIN_RATIO;
}

/* ── 채점 ─────────────────────────────────────────────────────────────── */

function scoreKey(data: LeadSheetData, key: string): KeyScore {
  const probe = cloneData(data);
  probe.key = key;
  analyzeHarmony(probe); // in-place 로 analysis 전체 재계산

  const chords = analyzedChords(probe);
  if (chords.length === 0) {
    return {
      key, score: 0, unexplainedRatio: 1, tonicCadences: 0, tonicTimeRatio: 0,
      lastCadenceTonic: false, finalTonic: false, firstTonic: false,
    };
  }

  const { pc: keyPc, isMinor } = parseKey(key);
  /* 블루스면 I7 을 으뜸화음으로 인정한다(아래 모든 토닉 판정에 전달). */
  const blues = isBluesIn(chords, keyPc, isMinor);

  /* 코드 길이(박)로 가중한다. 한 박짜리 지나가는 코드가 네 박 코드와 같은
   * 무게를 갖는 건 부당하다. */
  let totalW = 0;
  let unexplainedW = 0;
  let tonicW = 0;
  /* 으뜸화음으로 해결되는 '서로 다른 딸림화음'의 근음 집합.
   *
   * 그룹 인스턴스를 그대로 세면 같은 V-i 가 반복되는 형식(AABA)에서 부차 조성이
   * 폭증한다 — 리듬 체인지의 G7→Cm7 은 9번 나오지만 이는 하나의 화성 장치가
   * 반복된 것이지 9개의 독립 증거가 아니다(실측: 그 때문에 Cm 이 진짜 으뜸조
   * Bb 를 이겼다). 딸림화음 근음으로 중복을 제거해 '토닉에 이르는 서로 다른
   * 경로가 몇 개인가'를 센다. */
  const tonicCadenceApproaches = new Set<number>();
  /* groupId → 그 그룹의 V 코드 근음 (중복 제거 키). */
  const groupVRoot = new Map<number, number>();
  for (const chord of chords) {
    const rp = chord.analysis?.rootPc;
    if (rp == null) continue;
    for (const g of chord.analysis?.groupMemberships ?? []) {
      if (g.groupType === 'ii-V-I' && g.role === 'V') groupVRoot.set(g.groupId, rp);
    }
  }
  /* 곡에서 가장 늦게 등장하는 '완결 케이던스의 I 코드'. 키와 무관하게 결정되는
   * 고정 앵커이므로, 후보 키마다 "그게 내 으뜸화음인가"만 물으면 된다. */
  let lastCadenceI: { chord: LeadSheetChord; minorVariant: boolean } | null = null;

  for (const chord of chords) {
    const w = chord.durationBeats ?? 1;
    totalW += w;
    if (isUnexplained(chord)) unexplainedW += w;
    if (isTonicChord(chord, keyPc, isMinor, blues)) tonicW += w;

    for (const g of chord.analysis?.groupMemberships ?? []) {
      if (g.groupType === 'ii-V-I' && g.role === 'I' && g.variant !== 'incomplete') {
        lastCadenceI = { chord, minorVariant: g.variant === 'minor' };
      }
    }

    /* 이 코드가 어떤 ii-V-I 그룹의 'I' 이고, 그 자리가 이 조성의 으뜸화음이며,
     * 그룹의 variant(장/단조)가 조성과 일치할 때만 그 케이던스를 인정한다. */
    for (const g of chord.analysis?.groupMemberships ?? []) {
      if (g.groupType !== 'ii-V-I' || g.role !== 'I' || g.variant === 'incomplete') continue;
      if (!isTonicChord(chord, keyPc, isMinor, blues)) continue;
      if ((g.variant === 'minor') !== isMinor) continue;
      const v = groupVRoot.get(g.groupId);
      if (v != null) tonicCadenceApproaches.add(v);
    }
  }

  const firstTonic = isTonicChord(chords[0], keyPc, isMinor, blues);
  const finalTonic = isTonicChord(chords[chords.length - 1], keyPc, isMinor, blues);

  const unexplainedRatio = totalW > 0 ? unexplainedW / totalW : 1;
  const tonicTimeRatio = totalW > 0 ? tonicW / totalW : 0;
  const tonicCadences = tonicCadenceApproaches.size;

  /* 턴어라운드로 끝나는 차트(블루스·리듬 체인지 등)는 마지막 코드가 V7 이고
   * 곡이 처음으로 되돌아간다. 이때 '마지막 완결 케이던스'는 차트 안에 적혀
   * 있지 않지만 실제로는 첫 코드(으뜸화음)로 해결된다. 순환(wrap-around)
   * 해석으로 이를 인정하지 않으면, 진짜 으뜸조가 마지막 케이던스 점수를 통째로
   * 놓치고 반복 토닉화된 ii 에게 진다(실측: 리듬 체인지 Bb 113 vs Cm 168). */
  const lastCh = chords[chords.length - 1];
  const firstCh = chords[0];
  const wrapResolvesToFirst =
    lastCh.analysis?.normalizedQuality === 'dom7' &&
    lastCh.analysis?.rootPc != null &&
    firstCh.analysis?.rootPc != null &&
    ((lastCh.analysis.rootPc + 5) % 12) === firstCh.analysis.rootPc;
  const wrapCadenceTonic =
    wrapResolvesToFirst && isTonicChord(firstCh, keyPc, isMinor, blues);

  const lastCadenceTonic =
    (lastCadenceI != null &&
      isTonicChord(lastCadenceI.chord, keyPc, isMinor, blues) &&
      lastCadenceI.minorVariant === isMinor) ||
    wrapCadenceTonic;

  const score =
    100 * (1 - unexplainedRatio) +
    W_TONIC_TIME * tonicTimeRatio +
    W_TONIC_CADENCE * Math.min(tonicCadences, MAX_TONIC_CADENCE_CREDIT) +
    (lastCadenceTonic ? W_LAST_CADENCE : 0) +
    (finalTonic ? W_FINAL_TONIC : 0) +
    (firstTonic ? W_FIRST_TONIC : 0) +
    (blues ? W_BLUES : 0);

  return { key, score, unexplainedRatio, tonicCadences, tonicTimeRatio, lastCadenceTonic, finalTonic, firstTonic };
}

/**
 * 24개 후보 조성을 모두 채점해 순위를 매긴다.
 *
 * 비용: 코드 차트 한 곡(보통 32~64코드) × 24회 analyzeHarmony. 수 ms 수준이라
 * 렌더마다 돌려도 되지만, 호출부에서 useMemo 로 감싸는 것을 권한다.
 */
export function suggestKeys(data: LeadSheetData): KeySuggestion {
  const currentKey = canonicalKey(data.key);
  const ranked = ALL_KEYS.map((k) => scoreKey(data, k)).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const current = ranked.find((r) => r.key === currentKey) ?? best;

  const modal = best.unexplainedRatio > MODAL_UNEXPLAINED_RATIO && best.tonicCadences === 0;

  /* 현재 키가 스스로 설득력 있으면 제안하지 않는다.
   *
   * 이 기능은 "현재 키가 틀렸을 때" 고쳐주는 것이지, "점수가 더 높은 후보가
   * 있을 때마다" 바꾸라고 하는 게 아니다. 재즈에선 ii 가 반복 토닉화되어
   * (리듬 체인지의 Cm, All of Me 의 Dm, F 블루스의 Gm) 부차 조성이 점수에서
   * 진짜 으뜸조를 앞지르는 일이 구조적으로 흔하다. 오탐의 비용(사용자가 맞는
   * 조성을 틀린 것으로 바꿔버림)이 미탐보다 훨씬 크므로, 현재 키가 ①코드를
   * 잘 설명하고 ②토닉 근거를 하나라도 갖고 있으면 침묵한다. */
  const currentIsSelfConsistent =
    current.unexplainedRatio <= SELF_CONSISTENT_UNEXPLAINED &&
    (current.firstTonic || current.finalTonic
      || current.lastCadenceTonic || current.tonicCadences > 0);

  const shouldSuggest = !modal
    && !currentIsSelfConsistent
    && best.key !== currentKey
    && best.score - current.score >= SUGGEST_MARGIN;

  return { current, best, ranked, modal, shouldSuggest };
}
