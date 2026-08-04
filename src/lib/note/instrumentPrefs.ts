/* ─────────────────────────────────────────────────────────────────────────
 * instrumentPrefs — "내 악기".
 *
 * 이조 악기(`transposingInstrument`)와는 **다른 값**이다. 이조는 조(調)라서
 * 기타·피아노가 둘 다 'C' 로 같다 — 즉 이조값으로는 "이 사용자가 기타리스트다"
 * 를 알 수 없다. 기타면 TAB·코드 다이어그램을 기본으로 제안하려면 이 값이
 * 따로 있어야 한다.
 *
 * 코드는 **백엔드 릭·솔로의 instrument 코드와 같은 것**을 쓴다(as·ts·tp·p·g·b
 * ·voc·cl). 나중에 "내 악기 릭 먼저 보여주기" 같은 걸 붙일 때 그대로 맞물린다.
 *
 * 어디까지나 **기본값 제안용**이다 — 실제 표시 여부는 표기 설정이 최종 결정한다
 * (피아니스트가 기타 다이어그램을 보고 싶을 수 있다).
 * ──────────────────────────────────────────────────────────────────────── */

import { createPref, type Pref } from '../prefsStore';

/* 그리드에 4×2 로 놓이는 8개. 'unset'(미선택)은 저장 기본값일 뿐 칸으로 두지
 * 않는다 — 아무 칸도 선택되지 않은 상태가 곧 미선택이다. */
/* icon = public/icons/sessions 의 슬러그(직접 디자인한 56종 아이콘 세트).
 *
 * transpose = 이 악기를 고르면 **제안**할 이조 조(調). 값은 지어낸 게 아니라
 * 설정창의 이조 목록(TRANSPOSING_INSTRUMENTS)에 이미 적혀 있던 예시를 그대로
 * 옮긴 것이다: C=피아노·기타·베이스·보컬 / B♭=테너 색소폰·트럼펫 / E♭=알토 색소폰.
 * 클라리넷은 그 목록에 없어서 null(건드리지 않음) — 임의로 정하지 않았다.
 * 제안일 뿐이라, 사용자가 이조를 직접 바꾸면 그 값이 유지된다. */
export const MY_INSTRUMENTS = [
  { id: 'p',   label: '피아노',      icon: 'piano',           transpose: 'C'  },
  { id: 'g',   label: '기타',        icon: 'electric-guitar', transpose: 'C'  },
  { id: 'b',   label: '베이스',      icon: 'electric-bass',   transpose: 'C'  },
  { id: 'as',  label: '알토 색소폰',  icon: 'alto-saxophone',  transpose: 'Eb' },
  { id: 'ts',  label: '테너 색소폰',  icon: 'tenor-saxophone', transpose: 'Bb' },
  { id: 'tp',  label: '트럼펫',      icon: 'trumpet',         transpose: 'Bb' },
  { id: 'cl',  label: '클라리넷',    icon: 'clarinet',        transpose: null },
  { id: 'voc', label: '보컬',        icon: 'vocal',           transpose: 'C'  },
] as const;

export type MyInstrumentId = typeof MY_INSTRUMENTS[number]['id'];

const IDS = MY_INSTRUMENTS.map((i) => i.id) as readonly string[];

/** 저장된 값이 없을 때의 기본 악기 — 피아노. 재즈 학습에서 가장 흔한 출발점이고,
 *  "아무것도 안 고른 상태"로 두면 이조·표기 기본값을 정할 근거가 없다. */
export const MY_INSTRUMENT_DEFAULT: MyInstrumentId[] = ['p'];

/** 내 악기 — **복수 선택**. 여러 악기를 하는 사람이 흔하다. */
export const myInstruments: Pref<MyInstrumentId[]> = createPref<MyInstrumentId[]>(
  'user.myInstruments', MY_INSTRUMENT_DEFAULT,
  (raw) => {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      const ok = arr.filter((x): x is MyInstrumentId => typeof x === 'string' && IDS.includes(x));
      return ok.length === arr.length ? ok : ok;   // 모르는 값은 조용히 버린다
    } catch { return null; }
  },
  (v) => JSON.stringify(v),
);

/**
 * 선택된 악기들로부터 제안할 이조 조.
 *
 * **단독 선택일 때만** 제안한다. 알토 색소폰 하나만 골랐으면 E♭ 이 맞지만,
 * 알토와 피아노를 함께 고른 사람에게는 어느 쪽이 맞는지 알 수 없다 — 그럴 때
 * 임의로 바꾸면 사용자가 맞춰둔 값을 망가뜨린다. 그래서 건드리지 않는다.
 */
export function suggestedTranspose(ids: readonly MyInstrumentId[]): 'C' | 'Bb' | 'Eb' | null {
  if (ids.length !== 1) return null;
  return MY_INSTRUMENTS.find((i) => i.id === ids[0])?.transpose ?? null;
}

