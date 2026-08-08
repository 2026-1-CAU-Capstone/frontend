import { createPref, type Pref } from '../prefsStore';

/* ─────────────────────────────────────────────────────────────────────────
 * 기타 코드 다이어그램 표시 설정.
 *
 * 예전엔 ChordPage 의 `useState(false)` 였다 — 페이지를 떠나면 꺼졌고, 켤 때마다
 * 다시 눌러야 했다. 표기 설정은 사용자가 한 번 정하면 유지되는 게 맞다.
 *
 * 기본값은 **꺼짐**이다. 기타를 치지 않는 사람에게 코드마다 프렛 그리드가 붙으면
 * 악보가 복잡해지고, 데이터 청크 232KB 도 그때만 내려받으면 된다.
 * ──────────────────────────────────────────────────────────────────────── */

/** 코드심볼 아래에 기타 프렛 다이어그램을 그리는가. */
export const chordDiagramsOn: Pref<boolean> = createPref<boolean>(
  'notation.chordDiagrams',
  false,
  (raw) => (raw === '1' ? true : raw === '0' ? false : null),
  (v) => (v ? '1' : '0'),
);

/* 세션=기타 로 바꿨을 때 "다이어그램 켤까요?" 를 **한 번만** 권한다.
 * 매번 물으면 잔소리가 되고, 한 번도 안 물으면 기능을 모른 채 지나간다.
 * 사용자가 직접 켜거나 껐으면 그것도 답한 것으로 보고 다시 묻지 않는다. */
export const diagramSuggestSeen: Pref<boolean> = createPref<boolean>(
  'notation.chordDiagramSuggestSeen',
  false,
  (raw) => (raw === '1' ? true : raw === '0' ? false : null),
  (v) => (v ? '1' : '0'),
);
