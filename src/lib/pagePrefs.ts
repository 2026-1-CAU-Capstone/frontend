import { createPref, oneOf, type Pref } from './prefsStore';
import type { ProjectViewMode } from '../hooks/useViewModePref';
import type { StemPresetId } from './stems/mockSeparate';

/* 페이지별 설정값 — 전체 설정 모달(악보/연주 탭)과 각 페이지가 함께 쓴다.
 *
 * 보기 방식(viewMode) 키는 기존에 쓰던 것을 그대로 유지한다. 키를 바꾸면
 * 이미 그리드/리스트를 골라둔 사용자의 선택이 초기화된다. */

const VIEW_MODES = ['grid', 'list'] as const;

export const myChartsViewMode: Pref<ProjectViewMode> =
  createPref('jazzify.myCharts.viewMode.v1', 'grid', oneOf(VIEW_MODES));

export const mySheetsViewMode: Pref<ProjectViewMode> =
  createPref('jazzify.mySheets.viewMode.v1', 'grid', oneOf(VIEW_MODES));

/** 목록 정렬 — 지금까지는 페이지를 새로 열면 항상 '최신순'으로 돌아갔다.
 *  설정에서 기본값을 정해두면 그 순서로 열린다. */
export const SORT_MODES = ['recent', 'old', 'name', 'type'] as const;
export type SortMode = typeof SORT_MODES[number];

export const SORT_LABELS: Record<SortMode, string> = {
  recent: '최신순',
  old: '오래된순',
  name: '이름순',
  type: '형식순',
};

export const myChartsSort: Pref<SortMode> =
  createPref('jazzify.myCharts.sort.v1', 'recent', oneOf(SORT_MODES));

export const mySheetsSort: Pref<SortMode> =
  createPref('jazzify.mySheets.sort.v1', 'recent', oneOf(SORT_MODES));

/** 음원 분리 기본 프리셋 — 페이지를 열 때 이 갈래 수로 시작한다. */
export const stemPreset: Pref<StemPresetId> =
  createPref('jazzify.stems.preset.v1', '4', oneOf(['2', '4', '6'] as const));

/** 에디터 '조표 무시' — 조표를 그리지 않고 마디 안 임시표로만 판단한다.
 *  전엔 세션 한정이라 에디터를 다시 열 때마다 꺼졌다. */
export const editorExplicitAcc: Pref<boolean> =
  createPref('jazzify.editor.explicitAcc.v1', false, (raw) => (raw === 'true' ? true : raw === 'false' ? false : null));
