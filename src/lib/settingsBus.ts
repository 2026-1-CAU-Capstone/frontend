/* 전체 설정 모달을 어디서든 특정 위치로 열기 위한 버스.
 *
 * 설정 모달은 App 최상단에 하나만 상주한다(예전엔 UserMenu 안에 있어서,
 * 사이드바가 숨는 네이티브 UI 에서는 열 방법이 아예 없었다). 페이지는 이
 * 모듈의 openSettings 만 호출하면 되고, 모달이 어디 붙어 있는지 알 필요가 없다.
 *
 * lib/nativeShell.ts 의 openAiChatSheet 와 같은 방식(모듈 리스너)이다. */

export type SettingsTabId =
  | 'general'
  | 'performance'
  | 'account'
  | 'privacy'
  | 'billing'
  | 'usage'
  | 'features'
  | 'connectors'
  | 'cli'
  | 'chrome';

/** 악보/연주 탭 안의 2차 사이드바 항목. */
export type PerformanceSectionId =
  | 'transpose'
  | 'mixer'
  | 'chordAnalysis'
  | 'editor'
  | 'myCharts'
  | 'mySheets'
  | 'myLicks'
  | 'stems';

export interface SettingsRequest {
  tab?: SettingsTabId;
  /** tab === 'performance' 일 때만 의미가 있다. */
  section?: PerformanceSectionId;
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

/** 페이지 → 설정 섹션 매핑. 각 페이지의 톱니바퀴가 이걸 그대로 쓴다. */
export function openPerformanceSettings(section: PerformanceSectionId): void {
  openSettings({ tab: 'performance', section });
}
