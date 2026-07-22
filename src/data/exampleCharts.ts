import type { LeadSheetChord, LeadSheetBar, LeadSheetData } from './leadSheetTypes';
import { analyzeHarmony } from '../lib/harmonyAnalyzer';
import { allOfMe } from './allOfMe';

/* ─────────────────────────────────────────────────────────────────────────
 * 내 코드 차트 기본 예시 3곡.
 *
 * 모든 사용자에게 가입 직후 "내 코드 차트"에 디폴트로 보이는 저작권-안전 예시.
 * 튜토리얼/시연용이라 백엔드에 저장하지 않고 프론트 상수로만 둔다(모두에게 동일
 * 데이터라 유저마다 DB 행을 복제할 이유가 없음). 삭제는 localStorage 로만 기억한다
 * (기기 단위). 코드만 작성하고 화성 분석은 analyzeHarmony 로 채운다.
 *
 * 저작권: F 블루스=형식(저작권 대상 아님), I Got Rhythm=Gershwin(1937 몰,
 * 미국 2026 · 생명+70 이미 PD), All of Me=1931(미국 2027-01 PD). 참고용 기준.
 * ──────────────────────────────────────────────────────────────────────── */

/** 'Bb' / 'F#' / 'C' → LeadSheetChord (root 문자 + accidental 분리). */
function ch(note: string, quality: string): LeadSheetChord {
  const acc = note[1] === 'b' ? 'b' : note[1] === '#' ? '#' : undefined;
  return { root: note[0], ...(acc ? { accidental: acc as 'b' | '#' } : {}), quality };
}
const bar = (...chords: LeadSheetChord[]): LeadSheetBar => ({ chords });

/* ── F 재즈 블루스 (12마디) ─────────────────────────────────────────────── */
const F_BLUES_RAW: LeadSheetData = {
  title: '재즈 블루스 (F)',
  style: 'Medium Swing',
  composer: 'Traditional',
  timeSignature: '4/4',
  key: 'F',
  systems: [
    { sectionLabel: 'Blues', bars: [
      bar(ch('F', '7')), bar(ch('Bb', '7')), bar(ch('F', '7')), bar(ch('F', '7')),
    ] },
    { bars: [
      bar(ch('Bb', '7')), bar(ch('Bb', '7')), bar(ch('F', '7')), bar(ch('D', '7')),
    ] },
    { bars: [
      bar(ch('G', '-7')), bar(ch('C', '7')),
      bar(ch('F', '7'), ch('D', '7')), bar(ch('G', '-7'), ch('C', '7')),
    ] },
  ],
};

/* ── I Got Rhythm — 리듬 체인지스 (AABA, Bb) ────────────────────────────── */
const RC_A = (label?: string): LeadSheetData['systems'][number] => ({
  ...(label ? { sectionLabel: label } : {}),
  bars: [
    bar(ch('Bb', 'Δ7'), ch('G', '7')), bar(ch('C', '-7'), ch('F', '7')),
    bar(ch('D', '-7'), ch('G', '7')), bar(ch('C', '-7'), ch('F', '7')),
    bar(ch('Bb', '7')), bar(ch('Eb', '7')),
    bar(ch('Bb', 'Δ7'), ch('G', '7')), bar(ch('C', '-7'), ch('F', '7')),
  ],
});
const RHYTHM_CHANGES_RAW: LeadSheetData = {
  title: 'I Got Rhythm',
  style: 'Up Tempo Swing',
  composer: 'G. Gershwin',
  timeSignature: '4/4',
  key: 'Bb',
  systems: [
    RC_A('A'),
    RC_A('A'),
    { sectionLabel: 'B', bars: [
      bar(ch('D', '7')), bar(ch('D', '7')), bar(ch('G', '7')), bar(ch('G', '7')),
      bar(ch('C', '7')), bar(ch('C', '7')), bar(ch('F', '7')), bar(ch('F', '7')),
    ] },
    RC_A('A'),
  ],
};

export interface ExampleChart {
  /** 안정적 식별자 — dismiss 키 + `/mychord?example=<id>` 라우팅에 쓰인다. */
  id: string;
  title: string;
  /** KeyChip 표시용 (사람이 읽는 조성, 예: 'F' 'Bb' 'C'). */
  keySignature: string;
  timeSignature: string;
  composer: string;
  sheet: LeadSheetData;
}

/* analyzeHarmony 는 순수 함수 — 모듈 로드 시 1회 분석해 캐시한다. All of Me 는
 * 이미 분석된 allOfMe 를 그대로 쓴다(데모 차트와 동일 소스). */
export const EXAMPLE_CHARTS: ExampleChart[] = [
  { id: 'f-blues', title: '재즈 블루스 (F)', keySignature: 'F', timeSignature: '4/4', composer: 'Traditional', sheet: analyzeHarmony(F_BLUES_RAW) },
  { id: 'i-got-rhythm', title: 'I Got Rhythm', keySignature: 'Bb', timeSignature: '4/4', composer: 'G. Gershwin', sheet: analyzeHarmony(RHYTHM_CHANGES_RAW) },
  { id: 'all-of-me', title: 'All of Me', keySignature: 'C', timeSignature: '4/4', composer: 'Marks / Simons', sheet: allOfMe },
];

export function getExampleChart(id: string): ExampleChart | undefined {
  return EXAMPLE_CHARTS.find((e) => e.id === id);
}

/* ── 삭제(dismiss) 상태 — localStorage(기기 단위) ─────────────────────────
 * 모두에게 동일한 예시라 서버에 저장하지 않는다. "이 기기에서 안 보이게"만
 * 기억한다. 계정 단위 영구 삭제가 필요해지면 그때 백엔드 플래그로 승격한다. */
const DISMISS_KEY = 'jazzify.dismissedExampleCharts.v1';

export function getDismissedExamples(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch { return new Set(); }
}

export function dismissExample(id: string): void {
  const next = getDismissedExamples();
  next.add(id);
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
}
