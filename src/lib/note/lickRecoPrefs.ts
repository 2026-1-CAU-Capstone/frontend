/* ─────────────────────────────────────────────────────────────────────────
 * lickRecoPrefs — "릭 추천을 어느 악기까지 받을지".
 *
 * 기본은 **내 악기 따라가기**다(설정 › 계정 › 주 악기). 그 상태면 주 악기를
 * 바꾸는 것만으로 추천 범위가 함께 움직여서, 대부분의 사용자는 이 설정을 열
 * 필요가 없다. 직접 고르고 싶으면 따라가기를 끄고 복수 선택한다.
 *
 * 악기 코드는 백엔드 릭 enum 과 **같은 것**을 쓴다(실측:
 * `as·ts·tp·p·g·b·voc·cl·unknown`). 즉 이 파일의 목록이 곧 필터 키다.
 *
 * ⚠️ 리듬 악기(드럼·퍼커션)는 **선택 대상에서 제외**한다 — 릭은 선율 프레이즈라
 * 리듬 악기에는 의미가 없다. 지금 백엔드 enum 에는 드럼이 아예 없지만, 나중에
 * 추가되더라도 RHYTHM_INSTRUMENT_IDS 에 코드만 넣으면 목록에서 자동으로 빠진다.
 * ──────────────────────────────────────────────────────────────────────── */

import { createPref, type Pref } from '../prefsStore';
import { MY_INSTRUMENTS, type MyInstrumentId } from './instrumentPrefs';

/** 릭이 성립하지 않는 리듬·퍼커션 악기 코드. 선택 목록에서 제외된다. */
export const RHYTHM_INSTRUMENT_IDS: readonly string[] = ['dr', 'drums', 'perc', 'percussion'];

/** 악기가 지정되지 않은 릭(백엔드 enum 의 `unknown`). 실측상 전체의 절반이라
 *  기본 포함이다 — 빼면 추천 풀이 반토막 난다. */
export const UNKNOWN_INSTRUMENT_ID = 'unknown';

export interface LickInstrumentOption {
  id: string;
  label: string;
}

/** 선택 가능한 악기 목록 — 선율 악기 + '미지정'. 리듬 악기는 빠진다. */
export const LICK_INSTRUMENT_OPTIONS: readonly LickInstrumentOption[] = [
  ...MY_INSTRUMENTS
    .filter((m) => !RHYTHM_INSTRUMENT_IDS.includes(m.id))
    .map((m) => ({ id: m.id as string, label: m.label as string })),
  { id: UNKNOWN_INSTRUMENT_ID, label: '악기 미지정' },
];

const ALL_IDS: readonly string[] = LICK_INSTRUMENT_OPTIONS.map((o) => o.id);

/* ── 저장값 ──────────────────────────────────────────────────────────── */

/** 주 악기(설정 › 계정)를 따라갈지. 기본 켬. */
export const lickFollowMyInstrument: Pref<boolean> =
  createPref('chat.lickReco.followMyInstrument', true, (raw) =>
    raw === 'true' ? true : raw === 'false' ? false : null);

/** 따라가기를 껐을 때 쓰는 직접 선택 목록. 기본은 전체.
 *  ⚠️ 알 수 없는 코드(구버전·리듬 악기)는 읽을 때 걸러낸다. */
export const lickInstruments: Pref<string[]> = createPref<string[]>(
  'chat.lickReco.instruments',
  [...ALL_IDS],
  (raw) => {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      const clean = arr.filter((v): v is string => typeof v === 'string' && ALL_IDS.includes(v));
      return clean;   // 빈 배열도 유효 — "아무것도 안 받음"은 사용자의 선택이다
    } catch { return null; }
  },
  (v) => JSON.stringify(v),
);

/* ── 해석 ────────────────────────────────────────────────────────────── */

/**
 * 실제로 적용될 악기 집합.
 *
 * 따라가기 ON:
 *   - 주 악기가 하나라도 있으면 `[...주 악기들, 미지정]` — 미지정을 함께 넣는
 *     이유는 릭 DB 의 절반이 악기 미지정이라, 빼면 "내 악기만" 이 사실상 빈손이
 *     되기 때문이다.
 *   - 주 악기가 비어 있으면 전체(아직 아무것도 못 좁힌다).
 * 따라가기 OFF: 사용자가 고른 목록 그대로.
 */
export function resolveLickInstruments(
  follow: boolean,
  custom: string[],
  myInsts: readonly MyInstrumentId[],
): string[] {
  if (!follow) return custom;
  const mine = myInsts.filter((id) => ALL_IDS.includes(id as string)) as string[];
  if (mine.length === 0) return [...ALL_IDS];
  return [...mine, UNKNOWN_INSTRUMENT_ID];
}

/** 릭 목록을 허용 악기로 거른다. 전체 허용이면 원본을 그대로 돌려준다
 *  (불필요한 새 배열·리렌더 방지). */
export function filterLicksByInstrument<T extends { instrument?: string | null }>(
  licks: T[],
  allowed: string[],
): T[] {
  if (allowed.length >= ALL_IDS.length) return licks;   // 전체 선택 = 필터 없음
  const set = new Set(allowed);
  return licks.filter((l) => {
    const raw = (l.instrument ?? '').trim().toLowerCase();
    /* 빈 값·목록 밖 코드는 '미지정' 으로 취급 — 백엔드가 새 코드를 추가해도
     * 추천에서 조용히 사라지지 않는다. */
    const id = raw && ALL_IDS.includes(raw) ? raw : UNKNOWN_INSTRUMENT_ID;
    return set.has(id);
  });
}

/** 전체 선택 목록(전체 선택 버튼용). */
export function allLickInstrumentIds(): string[] {
  return [...ALL_IDS];
}
