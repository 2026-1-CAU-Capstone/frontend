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
 *  4) 첫 코드가 으뜸화음 — 정답 라벨로 검정하니 나란한조를 95% 정확히 가르는
 *     최강 판별자였다(단, ii 로 기능하는 첫 코드는 제외해야 한다).
 *
 *  5) 음고류 프로파일 상관(Krumhansl–Schmuckler) — 1)~4)가 '어디로 해결되는가'
 *     를 보는 반면, 이건 '이 곡이 어느 음계에 사는가'를 직접 잰다. 직교 신호라
 *     같은 다이아토닉 집합을 쓰는 나란한조·3음만 다른 동주조에서 힘을 쓴다.
 *
 * ── ii 가 진짜 으뜸조를 이기는 문제 (구조적) ───────────────────────────
 * 재즈에선 ii 가 반복 토닉화돼(리듬 체인지의 Cm, All of Me 의 Dm, Tea For Two
 * 의 Bbm) 점수로는 ii 가 이기기 쉽다. 오답 분해로 확인한 원인과 대응:
 *   · 한 그룹의 I 이면서 곧바로 다음 ii-V 의 ii 가 되는 코드(피벗)는 쉬어가는
 *     종지가 아니라 통과점 → 종지·체류 시간에서 제외한다.
 *   · '마지막 완결 케이던스'는 곡 뒤쪽(FINAL_CADENCE_ZONE) 에 있을 때만 센다.
 *     곡 중간의 부차 토닉화가 30점을 통째로 가져가던 단독 최대 원인이었다.
 *   · 차트 끝의 턴어라운드(되돌아가는 V7 + 그 ii)는 건너뛰고 그 앞을 '실질
 *     마지막 코드'로 본다 — 진짜 종지가 뒤에서 셋째에 오는 곡이 흔하다.
 *
 * ── 정확도 (iReal Pro 1460곡, scripts/keySuggestBenchmark.ts) ──────────
 * 1순위 84.5% · 2순위 이내 92.3% · 3순위 이내 94.1%
 * (장조 85.2% / 단조 81.5%. 코드 심볼만 보고 24개 후보 중 고른 결과다.)
 * 곡을 반으로 갈라 따로 재도 84.52% / 84.52% 로 같아, 특정 곡에 맞춘 값이 아니다.
 *
 * 특징을 고를 때는 추측 대신 **정답 라벨로 검정**했다: 각 곡의 정답 키와 그
 * 나란한조를 짝지어 후보 특징의 "정답에서만 참 / 나란한조에서만 참" 빈도를
 * 세면, 그 특징이 실제로 판별자인지 바로 드러난다(scratchpad 의 relstudy).
 *
 * 시도했다가 **되돌린** 것(같은 실수를 반복하지 않도록):
 *   · 세컨더리 도미넌트의 ii 를 설명으로 인정 → 83.4% (오답 키도 똑같이 사면돼
 *     설명력의 판별력이 무뎌진다).
 *   · 정격종지(V7→I) 가점 → 83.6% 이하. 토닉화된 ii 도 자기 V7→ii 를 갖기에
 *     오답 키를 같이 밀어올린다.
 *   · 케이던스 '개수'에서도 피벗 제외 → 변화 없음(불필요한 복잡도).
 *   · 종지를 '마지막 마디 안 어디든'으로 완화 → 84.0%. 나란한조 쌍만 보면
 *     엄격히 우월한 특징이었지만(정밀도 98% 동일, 발동률 32%→41%), 전체로는
 *     다른 혼동에서 오답 키도 함께 발동시켜 손해였다.
 *   · 프레이즈머리(1·9·17·25마디) 토닉 가점 → 전 가중치에서 하락. 재즈에선
 *     ii 가 프레이즈를 시작하는 일이 잦아 오답 키를 같이 밀어올린다.
 *   · 전조 보정(8마디 구획 중 가장 안 맞는 하나를 설명력에서 제외) → 83.4%.
 *   · 근음 전용 프로파일 추가 → 변화 0(구성음 프로파일과 정보가 겹친다).
 *   · 가중치 좌표하강 튜닝 → **과적합**. 곡 절반으로 튜닝하니 그 절반은
 *     84.25→86.16% 로 올랐지만 나머지 절반은 84.25% 그대로였다(개별 가중치
 *     변경을 하나씩 재도 검증셋 개선 0). 위 가중치는 손대지 않은 원래 값이다.
 *     정확도를 더 올리려면 가중치가 아니라 **새로운 신호**가 필요하다.
 *
 * ── 물러서야 하는 경우 ─────────────────────────────────────────────────
 *  · 블루스(I7 IV7 V7 전부 도미넌트): 어느 장조에도 맞지 않는다.
 *  · 모달 곡: 기능 화성이 없다.
 *  · 곡 중간 전조: 애초에 곡 전체를 한 개 키로 표현할 수 없다.
 *  → 최선 후보조차 설명력이 낮고 으뜸 케이던스도 없으면 modal=true 로 반환하고
 *    억지로 키를 제안하지 않는다.
 */

import type { LeadSheetChord, LeadSheetData } from '../../data/leadSheetTypes';
import { analyzeHarmony, parseKey, QUALITY_INTERVALS } from '../../lib/harmonyAnalyzer';
import { ALL_MAJOR_KEYS, ALL_MINOR_KEYS } from '../../components/leadsheet/leadSheetTranspose';

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

/** '마지막 완결 케이던스'로 인정할 구간 — 곡의 뒤쪽 이 비율 안에 있어야 한다.
 *
 *  이 신호는 30점 all-or-nothing 이라 한 번 잘못 잡히면 곧바로 오답이 된다.
 *  곡 중간의 부차 토닉화(브리지가 IV·vi 로 닫히는 등)가 '마지막 케이던스'로
 *  집히면 그 30점을 엉뚱한 조성이 통째로 가져간다 — 오답 269곡을 분해했을 때
 *  이 항목 단독으로 평균 +14.9점, 다른 모든 항목을 합친 것보다 컸다.
 *  32마디 곡이면 뒤 15% 는 마지막 네 마디쯤으로, 재즈 스탠다드의 구조적 종지가
 *  실제로 놓이는 자리다. 이 구간에 완결 케이던스가 없으면 아무도 가점을 받지
 *  않는다(엉뚱한 키에 주는 것보다 신호 없음이 낫다).
 *  실측(iReal 1460곡): 게이트 없음 81.6% → 0.85 82.6%. 0.80~0.90 이 고원이고
 *  0.95 부터는 케이던스를 너무 놓쳐 80.3% 로 급락한다. */
const FINAL_CADENCE_ZONE = 0.85;

/** 으뜸화음이 곡 전체에서 차지하는 시간 비중. 진짜 으뜸조는 오래 머물고,
 *  토닉화된 부차 조성(Dm)은 스쳐 지나간다. Krumhansl 키 프로파일이 포착하는
 *  것과 같은 신호를, 코드 차트에선 이렇게 직접 잴 수 있다. */
const W_TONIC_TIME = 80;

/** 음고류 프로파일 상관(-1~1)의 가중치.
 *
 *  케이던스 신호와 직교하는 '음계 적합도'라, 같은 다이아토닉 집합을 쓰는
 *  나란한조나 3음만 다른 동주조에서 특히 힘을 쓴다.
 *  실측(iReal 1460곡): 없음 82.6% → 도입 83.8%. 25~120 이 전부 83.4~83.8%
 *  인 넓은 고원이라 정확한 값에 민감하지 않다 — 화성 신호가 주도권을 갖도록
 *  고원의 낮은 쪽을 골랐다. */
const W_PROFILE = 30;

const W_FINAL_TONIC = 24;
/** 첫 코드가 으뜸화음. 오래 '약한 보조 증거'로 6점이었지만, 정답 라벨로 재보니
 *  나란한조를 95% 정확히 가르고 67% 발동하는 최강 판별자였다. ii 로 기능하는
 *  첫 코드를 제외하고 나서야 안전하게 올릴 수 있었다.
 *  실측: 6점 84.25% → 20점 84.52%(홀·짝 양쪽 동일하게 상승). 30점부터는 과해져
 *  83%대로 떨어진다. */
const W_FIRST_TONIC = 20;

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
/* `minMaj7`(i△7) 은 재즈 단조의 대표적 으뜸화음이다(라인 클리셰 i → i△7 →
 * i7 → i6). 코퍼스에 186회 나오는데 빠져 있어 단조 정확도를 깎고 있었다
 * (실측: 단조 77.0% → 77.7%). */
const MINOR_TONIC_QUALITIES = new Set(['min', 'min7', 'min6', 'minMaj7']);

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

/* ── 음고류 프로파일 상관 (Krumhansl–Schmuckler) ───────────────────────
 *
 * 케이던스·으뜸화음 신호는 '어디로 해결되는가'를 본다. 그것만으로는 같은
 * 다이아토닉 집합을 공유하는 조성(나란한조)이나 3음만 다른 조성(동주조)을
 * 가르기 어렵다. 프로파일 상관은 '이 곡이 어느 음계에 사는가'를 직접 재는
 * 직교 신호라, 그 빈틈을 메운다.
 *
 * 프로파일은 Krumhansl–Kessler(1982) 원본 값. 코드 심볼밖에 없으므로 음표
 * 대신 **코드 구성음**을 지속(박)으로 가중해 히스토그램을 만든다. */
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 코드 구성음을 지속으로 가중한 12차원 음고류 히스토그램. */
function pitchClassProfile(chords: LeadSheetChord[]): number[] {
  const pcp = new Array(12).fill(0);
  for (const c of chords) {
    const a = c.analysis;
    if (!a || a.rootPc == null) continue;
    const ivs = QUALITY_INTERVALS[a.normalizedQuality ?? ''] ?? [0, 4, 7];
    const w = c.durationBeats ?? 1;
    for (const iv of ivs) pcp[(a.rootPc + iv) % 12] += w;
  }
  return pcp;
}

/** 피어슨 상관 — 프로파일을 keyPc 만큼 회전해 맞춰 본다. 결과는 -1~1. */
function profileCorrelation(pcp: number[], keyPc: number, isMinor: boolean): number {
  const ref = isMinor ? KK_MINOR : KK_MAJOR;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < 12; i++) {
    x.push(pcp[(keyPc + i) % 12]);
    y.push(ref[i]);
  }
  const mx = x.reduce((s, v) => s + v, 0) / 12;
  const my = y.reduce((s, v) => s + v, 0) / 12;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < 12; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
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
   * 고정 앵커이므로, 후보 키마다 "그게 내 으뜸화음인가"만 물으면 된다.
   *
   * 단, 한 그룹의 I 이면서 곧바로 다음 ii-V 의 ii 로 넘어가는 코드(피벗)는
   * 쉬어가는 종지가 아니라 통과점이다. 그런 코드를 종지로 인정하면 토닉화된
   * ii 가 진짜 으뜸조에게서 30점을 통째로 빼앗는다 — 오답 분석에서 이 항목이
   * 단독 최대 원인이었다(ii 오답 54곡 평균 +18.3점). 그래서 피벗이 아닌
   * 종지를 우선하고, 그런 게 하나도 없을 때만 피벗을 쓴다. */
  let lastCadenceI: { chord: LeadSheetChord; minorVariant: boolean } | null = null;
  let lastCadenceIPivot: { chord: LeadSheetChord; minorVariant: boolean } | null = null;

  /* 세컨더리 도미넌트는 **실제로 해결될 때만** 설명으로 인정한다.
   *
   *  어떤 dom7 이든 "무언가의 V7"로 해석될 여지가 있어서(근음 4도 위가 그 조성의
   *  다이아토닉이기만 하면 성립), 해결을 요구하지 않으면 엉뚱한 조성도 거의 모든
   *  도미넌트를 설명해 버린다 — 설명력 점수의 판별력이 그만큼 무뎌진다.
   *  실측(iReal 1460곡): 느슨 83.8% → 해결 요구 84.2%. */
  const resolves = (i: number): boolean => {
    const a = chords[i].analysis, nx = chords[i + 1]?.analysis;
    if (!a || a.rootPc == null) return false;
    if (!a.secondaryDominant) return true;           // 세컨더리 도미넌트가 아니면 무관
    if (!nx || nx.rootPc == null) return false;
    return ((a.rootPc + 5) % 12) === nx.rootPc       // 정상 해결(4도 위)
      || ((a.rootPc + 6) % 12) === nx.rootPc;        // 트라이톤 서브로의 대리 해결
  };
  for (let ci = 0; ci < chords.length; ci++) {
    const chord = chords[ci];
    const nearEnd = ci >= chords.length * FINAL_CADENCE_ZONE;
    const w = chord.durationBeats ?? 1;
    totalW += w;
    if (isUnexplained(chord) || !resolves(ci)) unexplainedW += w;
    if (isTonicChord(chord, keyPc, isMinor, blues)) tonicW += w;

    const isPivot = (chord.analysis?.groupMemberships ?? [])
      .some((g) => g.groupType === 'ii-V-I' && g.role === 'ii');
    if (isPivot && isTonicChord(chord, keyPc, isMinor, blues)) tonicW -= w;
    for (const g of chord.analysis?.groupMemberships ?? []) {
      if (g.groupType === 'ii-V-I' && g.role === 'I' && g.variant !== 'incomplete' && nearEnd) {
        const entry = { chord, minorVariant: g.variant === 'minor' };
        if (isPivot) lastCadenceIPivot = entry;
        else lastCadenceI = entry;
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

  /* 곡의 '실질 마지막 코드' — 맨 뒤에 붙은 턴어라운드는 건너뛴다.
   *
   * 재즈 리드시트는 반복을 위해 종지(I) 뒤에 ii-V 를 덧붙이는 게 보통이라,
   * 차트의 물리적 마지막 코드는 종지가 아니라 되돌아가는 딸림화음이다. 이를
   * 그대로 '끝 코드'로 보면 진짜 으뜸조가 finalTonic 점수를 통째로 잃고, 그
   * 점수를 턴어라운드가 겨냥하는 ii 가 wrap 규칙으로 가져간다 — 위 wrap 보정이
   * '첫 코드가 토닉인 키'만 구제해 주는 비대칭이 여기서 생긴다.
   * (실측: Tea For Two 는 `… Ab6 | Cm7b5 F7b9` 로 끝나 진짜 종지 Ab6 가 뒤에서
   *  셋째다. 보정 전 Ab 116.6 < Bbm 128.6 으로 ii 인 Bbm 이 1위였다.)
   *
   * 건너뛰는 조건은 '되돌아가는 V7'(wrapResolvesToFirst)일 때뿐이고, 그 V7 의
   * ii 한 개까지만 함께 건너뛴다. 블루스처럼 도미넌트가 연달아 오는 진행에서
   * 무한정 거슬러 올라가지 않도록 범위를 좁게 잡았다. */
  let finalIdx = chords.length - 1;
  if (wrapResolvesToFirst && finalIdx > 0) {
    finalIdx--;                                   // 되돌아가는 V7 건너뛰기
    const prev = chords[finalIdx]?.analysis;
    const vRoot = lastCh.analysis?.rootPc;
    const prevIsItsII =
      prev?.rootPc != null && vRoot != null &&
      ((prev.rootPc + 5) % 12) === vRoot &&
      (prev.normalizedQuality === 'min7'
        || prev.normalizedQuality === 'min7b5'
        || prev.normalizedQuality === 'min');
    if (prevIsItsII && finalIdx > 0) finalIdx--;   // 그 V7 의 ii 도 턴어라운드의 일부
  }

  /* 첫 코드가 으뜸화음 — 정답 라벨로 재보니 나란한조를 95% 정확히 가르고 67%
   * 발동하는 최강 판별자였다. 그런데 낮게 잡혀 있었던 이유가 있다: 첫 코드가
   * ii 인 곡(Tea For Two 의 Bbm7)에서 그 ii 를 으뜸조로 밀어올린다. 그래서
   * **ii 로 기능하지 않을 때만** 인정한다 — 판별력은 살리고 부작용만 뺀다. */
  const firstIsII = (firstCh.analysis?.groupMemberships ?? [])
    .some((g) => g.groupType === 'ii-V-I' && g.role === 'ii');
  const firstTonic = !firstIsII && isTonicChord(firstCh, keyPc, isMinor, blues);
  const finalTonic = isTonicChord(chords[finalIdx], keyPc, isMinor, blues);

  const anchor = lastCadenceI ?? lastCadenceIPivot;
  const lastCadenceTonic =
    (anchor != null &&
      isTonicChord(anchor.chord, keyPc, isMinor, blues) &&
      anchor.minorVariant === isMinor) ||
    wrapCadenceTonic;

  const score =
    100 * (1 - unexplainedRatio) +
    W_TONIC_TIME * tonicTimeRatio +
    W_TONIC_CADENCE * Math.min(tonicCadences, MAX_TONIC_CADENCE_CREDIT) +
    (lastCadenceTonic ? W_LAST_CADENCE : 0) +
    (finalTonic ? W_FINAL_TONIC : 0) +
    (firstTonic ? W_FIRST_TONIC : 0) +
    (blues ? W_BLUES : 0) +
    W_PROFILE * profileCorrelation(pitchClassProfile(chords), keyPc, isMinor);

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
