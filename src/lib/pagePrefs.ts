import { createPref, oneOf, type Pref } from './prefsStore';
import type { ProjectViewMode } from '../hooks/useViewModePref';
import type { StemPresetId } from './stems/mockSeparate';

/* 페이지별 설정값 — 전체 설정 모달(악보/연주 탭)과 각 페이지가 함께 쓴다.
 *
 * 보기 방식(viewMode) 키는 기존에 쓰던 것을 그대로 유지한다. 키를 바꾸면
 * 이미 그리드/리스트를 골라둔 사용자의 선택이 초기화된다. */

const VIEW_MODES = ['grid', 'list'] as const;

/** 'true'/'false' 문자열 → boolean. 그 외는 null(기본값 사용). */
const boolPref = (raw: string): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null);

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

/** 가사 표시 **기본값** — 악보에 가사가 있을 때 처음에 펼쳐 둘지.
 *  보컬을 '내 악기'로 고른 사용자는 켜는 게 자연스러워, 최초 1회 그 값으로
 *  초기화된다(`lyricsDefaultSeeded`). 그 뒤로는 사용자가 정한 값이 그대로 남는다.
 *  개별 악보의 켜짐/꺼짐은 이 값을 **덮어쓰는 차트별 오버라이드**로 따로 기억한다
 *  (`lyricsByChart`) — 곡마다 가사가 필요할 수도, 아닐 수도 있기 때문. */
export const showLyricsDefault: Pref<boolean> =
  createPref('jazzify.lyrics.showDefault.v1', false, boolPref);

/** 위 기본값을 '내 악기'로 한 번 초기화했는지 — 사용자가 끈 걸 되살리지 않기 위한 표식. */
export const lyricsDefaultSeeded: Pref<boolean> =
  createPref('jazzify.lyrics.seeded.v1', false, boolPref);

/** 에디터 '조표 무시' — 조표를 그리지 않고 마디 안 임시표로만 판단한다.
 *  전엔 세션 한정이라 에디터를 다시 열 때마다 꺼졌다. */
export const editorExplicitAcc: Pref<boolean> =
  createPref('jazzify.editor.explicitAcc.v1', false, boolPref);

/* ── 차트별 가사 표시 오버라이드 ──────────────────────────────────────────
 * 전역 기본값(showLyricsDefault)을 곡 단위로 덮어쓴다. 곡마다 가사가 필요할
 * 수도, 아닐 수도 있어서 — 사용자가 그 악보에서 직접 끄고 켠 값만 기억한다.
 * 값이 없으면(대부분) 전역 기본값을 따른다. 백엔드가 가사를 아직 저장하지
 * 못하므로(BR-47) 이 설정도 기기 단위 localStorage 에 둔다. */
const LYRICS_BY_CHART_KEY = 'jazzify.lyrics.byChart.v1';

function readLyricsMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LYRICS_BY_CHART_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' ? o as Record<string, boolean> : {};
  } catch { return {}; }
}

/** 이 악보의 가사 표시 여부 — 오버라이드가 있으면 그것, 없으면 `undefined`. */
export function getChartLyrics(chartId: string | undefined | null): boolean | undefined {
  if (!chartId) return undefined;
  const v = readLyricsMap()[chartId];
  return typeof v === 'boolean' ? v : undefined;
}

/** 이 악보만의 가사 표시 여부를 기억한다. `undefined` 면 오버라이드를 지운다. */
export function setChartLyrics(chartId: string | undefined | null, on: boolean | undefined): void {
  if (!chartId) return;
  const m = readLyricsMap();
  if (on === undefined) delete m[chartId]; else m[chartId] = on;
  try { localStorage.setItem(LYRICS_BY_CHART_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
