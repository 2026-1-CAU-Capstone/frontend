/* 전체 설정 모달을 어디서든 특정 위치로 열기 위한 버스.
 *
 * 설정 모달은 App 최상단에 하나만 상주한다(예전엔 UserMenu 안에 있어서,
 * 사이드바가 숨는 네이티브 UI 에서는 열 방법이 아예 없었다). 페이지는 이
 * 모듈의 openSettings 만 호출하면 되고, 모달이 어디 붙어 있는지 알 필요가 없다.
 *
 * lib/nativeShell.ts 의 openAiChatSheet 와 같은 방식(모듈 리스너)이다. */

/* 탭은 **설정의 성격**으로 나눈다(2026-08-04 재편). 예전엔 화면 이름으로
 * 나눠서, 같은 설정(음이름 표시 등)이 화면마다 중복 등장했다.
 * 화면별로 모아 보는 뷰는 'pages' 탭이 2차 사이드바로 담당한다. */
export type SettingsTabId =
  | 'general'    // 프로필 — 대공사 예정이라 그대로 둔다
  | 'notation'   // 표기: 음이름·코드분석·이조·조표무시
  | 'playback'   // 재생: 카운트인·세는 마디
  | 'chat'       // AI 채팅 전용
  | 'library'    // 목록 보기 방식·정렬
  | 'account'    // 계정 + 내 악기
  | 'pages';     // 화면별 모아 보기(2차 사이드바)

/** '화면별' 탭의 2차 사이드바 항목 = 실제 화면들. */
export type PageSectionId =
  | 'editor'
  | 'myCharts'
  | 'mySheets'
  | 'myLicks'
  | 'stems';

/** 기존 ⚙ 호출부 호환용 별칭 — 화면이 아닌 값(transpose 등)도 아직 넘어온다. */
export type PerformanceSectionId =
  | PageSectionId
  | 'sheetDisplay'
  | 'transpose'
  | 'mixer'
  | 'chordAnalysis';

export interface SettingsRequest {
  tab?: SettingsTabId;
  /** tab === 'pages' 일 때만 의미가 있다. */
  section?: PageSectionId;
}

type Listener = (req: SettingsRequest) => void;

const listeners = new Set<Listener>();

/** 설정 모달을 연다. 모달이 아직 마운트 전이면 조용히 무시된다. */
export function openSettings(req: SettingsRequest = {}): void {
  for (const cb of listeners) {
    try { cb(req); } catch { /* listener error must not break the caller */ }
  }
}

export function onSettingsRequest(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/* 화면이 아닌 옛 섹션 id → 새 탭 매핑. ⚙ 호출부를 한 곳도 고치지 않기 위한
 * 호환 계층이다(호출부는 10곳에 흩어져 있다). */
const LEGACY_TAB: Partial<Record<PerformanceSectionId, SettingsTabId>> = {
  transpose: 'notation',
  chordAnalysis: 'notation',
  sheetDisplay: 'notation',
  mixer: 'playback',
};

/** 페이지 → 설정 위치. 각 화면의 톱니바퀴가 이걸 그대로 쓴다. */
export function openPerformanceSettings(section: PerformanceSectionId): void {
  const tab = LEGACY_TAB[section];
  if (tab) { openSettings({ tab }); return; }
  openSettings({ tab: 'pages', section: section as PageSectionId });
}
