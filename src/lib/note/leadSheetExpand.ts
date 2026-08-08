/* ─────────────────────────────────────────────────────────────────────────
 * 리드시트(`LeadSheetData`) 의 도돌이 `|: :|` · 볼타(1./2.) 전개 — **단일 소스**.
 *
 * 원래 `backing/adapters/leadSheetToChart.ts` 안에 private 으로 있던 것을 꺼냈다.
 * 백킹 재생과 "코드 붙여넣기"가 **같은 전개기**를 써야 두 화면의 마디 수가
 * 어긋나지 않는다(전개기를 복제하면 한쪽만 고쳐지는 사고가 난다).
 *
 * iReal 인코딩 규약 (jazz1460.json 이 이 형태로 저장돼 있다):
 *   - `hasRepeatStart` 는 **시스템(행)** 에 붙는다 → 그 시스템의 **첫 마디**가 `|:`
 *   - `hasRepeatEnd`   는 **시스템(행)** 에 붙는다 → 그 시스템의 **마지막 마디**가 `:|`
 *   - `bar.ending = 1|2|3` 이 볼타 괄호. 1절 괄호는 `ending=1` 마디에서 시작해
 *     `:|` 마디까지(포함), 2절 괄호는 `ending=2` 마디부터 다음 구조 경계까지.
 *   - `:|` 와 `ending=2` **사이의 빈 마디**는 레이아웃용 패딩이다(2절을 1절 아래에
 *     시각적으로 맞추려고 넣은 빈칸). 전개에서 반드시 건너뛴다.
 *
 * 1회차: 모든 마디를 선형으로 지나간다(1절 괄호 포함).
 * 2회차: `|:` 로 돌아간 뒤, 1절 괄호(ending=1 ~ `:|`)와 패딩 마디를 건너뛰어
 *        2절 괄호부터 이어간다.
 * ──────────────────────────────────────────────────────────────────────── */
import type { LeadSheetData } from '../../data/leadSheetTypes';

/** 전개기가 필요로 하는 최소 정보 — 소비처가 무엇을 담고 있든 이 형태로만 준다. */
export interface RepeatFlags {
  /** 볼타 괄호 번호(1·2·3). 없으면 undefined. */
  ending?: number;
  /** 원본에 코드가 하나도 없던 마디인가(레이아웃 패딩 판정에 쓰인다). */
  wasEmpty: boolean;
  /** 이 마디가 `|:` 인가. */
  repeatStart: boolean;
  /** 이 마디가 `:|` 인가. */
  repeatEnd: boolean;
}

/**
 * 도돌이·볼타를 전개해 **원본 인덱스의 재생 순서**를 돌려준다.
 * 반환값의 각 원소는 입력 배열의 인덱스라, 호출부가 원하는 타입으로 매핑하면 된다.
 */
export function expandRepeatOrder(bars: RepeatFlags[]): number[] {
  // 패딩 판정: `:|` 뒤에서 볼타 마커를 만나기 전까지 나오는 빈 마디들.
  // 스캔이 실제로 볼타 마커에 **도달했을 때만** 패딩으로 친다 — 그렇지 않으면
  // 차트 중간의 의도적인 빈 마디(쉼)까지 지워진다.
  const isPadding = new Array<boolean>(bars.length).fill(false);
  for (let i = 0; i < bars.length; i++) {
    if (!bars[i].repeatEnd) continue;
    const candidates: number[] = [];
    let foundEnding = false;
    for (let j = i + 1; j < bars.length; j++) {
      if (bars[j].ending != null) { foundEnding = true; break; }
      if (bars[j].wasEmpty) candidates.push(j);
    }
    if (foundEnding) for (const j of candidates) isPadding[j] = true;
  }

  const order: number[] = [];
  let i = 0;
  let repeatStartIdx: number | null = null;
  let havePlayedOnce = false;

  while (i < bars.length) {
    const t = bars[i];

    // 새 도돌이 블록 진입 — 돌아올 지점을 기억한다.
    if (t.repeatStart && repeatStartIdx !== i) {
      repeatStartIdx = i;
      havePlayedOnce = false;
    }

    // 2회차: 1절 괄호 전체(이 마디 ~ `:|`)를 건너뛴다.
    if (havePlayedOnce && t.ending === 1) {
      let j = i;
      while (j < bars.length && !bars[j].repeatEnd) j++;
      i = j + 1;
      continue;
    }

    // 2회차: 2절 괄호 아래의 레이아웃 패딩 마디를 건너뛴다.
    if (havePlayedOnce && isPadding[i]) {
      i++;
      continue;
    }

    order.push(i);

    // 처음 `:|` 에 닿았을 때 `|:` 로 되돌아간다.
    if (t.repeatEnd && !havePlayedOnce && repeatStartIdx !== null) {
      i = repeatStartIdx;
      havePlayedOnce = true;
      continue;
    }

    i++;
  }

  return order;
}

/* ─── LeadSheetData 용 헬퍼 ──────────────────────────────────────────────── */

/** 시스템/마디 구조를 평평한 마디 배열로 편다(도돌이 플래그를 마디로 내린다). */
export function flattenLeadSheetBars(lead: LeadSheetData): {
  flags: RepeatFlags;
  systemIndex: number;
  barIndex: number;
}[] {
  const out: { flags: RepeatFlags; systemIndex: number; barIndex: number }[] = [];
  lead.systems.forEach((sys, si) => {
    sys.bars.forEach((bar, bi) => {
      out.push({
        systemIndex: si,
        barIndex: bi,
        flags: {
          ending: bar.ending,
          wasEmpty: (bar.chords?.length ?? 0) === 0,
          repeatStart: !!sys.hasRepeatStart && bi === 0,
          repeatEnd: !!sys.hasRepeatEnd && bi === sys.bars.length - 1,
        },
      });
    });
  });
  return out;
}
