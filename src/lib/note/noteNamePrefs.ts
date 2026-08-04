/* ─────────────────────────────────────────────────────────────────────────
 * noteNamePrefs — "음표에 음 표시하기" 설정.
 *
 * 전역 설정 한 벌(켜기·언어·색·크기)을 두고, **페이지별로 덮어쓸 수 있게** 한다.
 * 같은 악보라도 에디터에서는 켜고 내 릭에서는 끄고 싶을 수 있어서다.
 *
 *   페이지 설정 = 'inherit' → 전역값을 따른다 (기본)
 *                'on'/'off' → 그 페이지에서만 강제
 *
 * 색·크기·언어는 전역 한 벌만 둔다. 페이지마다 다른 색을 쓸 이유는 없고,
 * 설정 화면만 복잡해진다.
 * ──────────────────────────────────────────────────────────────────────── */

import { createPref, oneOf, type Pref } from '../prefsStore';
import type { NoteNameLang } from './noteNameLabels';

/** 악보를 그리는 화면들. 라우트에서 이 키로 해석한다(resolveSheetPage). */
export const SHEET_PAGES = [
  'editor', 'myCharts', 'mySheets', 'myLicks',
  'solos', 'licks', 'comping', 'lickPractice', 'other',
] as const;
export type SheetPageKey = typeof SHEET_PAGES[number];

/** 설정 화면에 노출하는 페이지(라벨 포함). 'other' 는 전역만 따른다. */
export const SHEET_PAGE_LABELS: ReadonlyArray<{ key: SheetPageKey; label: string }> = [
  { key: 'editor', label: '에디터' },
  { key: 'myCharts', label: '내 코드 차트' },
  { key: 'mySheets', label: '내 악보 차트' },
  { key: 'myLicks', label: '내 릭' },
  { key: 'solos', label: 'Solo Database' },
  { key: 'licks', label: 'Lick Database' },
  { key: 'comping', label: 'Comping Database' },
  { key: 'lickPractice', label: '릭 12키 연습' },
];

export type PageOverride = 'inherit' | 'on' | 'off';
const OVERRIDES = ['inherit', 'on', 'off'] as const;

/* ── 전역 ─────────────────────────────────────────────────────────────── */

export const noteNamesOn: Pref<boolean> =
  createPref('sheet.noteNames.on', false, (r) => (r === 'true' ? true : r === 'false' ? false : null));

export const noteNameLang: Pref<NoteNameLang> =
  createPref('sheet.noteNames.lang', 'ko', oneOf(['ko', 'en'] as const));

/** 기본 색 — 악보의 검정과 확실히 구분되면서 튀지 않는 파랑. */
export const NOTE_NAME_COLOR_DEFAULT = '#2f6fe0';

export const noteNameColor: Pref<string> =
  createPref('sheet.noteNames.color', NOTE_NAME_COLOR_DEFAULT,
    (r) => (/^#[0-9a-fA-F]{6}$/.test(r) ? r : null));

export const NOTE_NAME_SIZE_MIN = 6;
export const NOTE_NAME_SIZE_MAX = 18;
export const NOTE_NAME_SIZE_DEFAULT = 9;

export const noteNameSize: Pref<number> =
  createPref('sheet.noteNames.size', NOTE_NAME_SIZE_DEFAULT, (r) => {
    const n = Number(r);
    return Number.isFinite(n) && n >= NOTE_NAME_SIZE_MIN && n <= NOTE_NAME_SIZE_MAX ? n : null;
  });

/* ── 페이지별 덮어쓰기 ────────────────────────────────────────────────── */

const overrideCache = new Map<SheetPageKey, Pref<PageOverride>>();

export function noteNamesForPage(page: SheetPageKey): Pref<PageOverride> {
  const hit = overrideCache.get(page);
  if (hit) return hit;
  const p = createPref<PageOverride>(
    `sheet.noteNames.page.${page}`, 'inherit', oneOf(OVERRIDES),
  );
  overrideCache.set(page, p);
  return p;
}

/** 라우트 경로 → 페이지 키. 목록에 없는 화면은 전역 설정만 따른다. */
export function resolveSheetPage(pathname: string): SheetPageKey {
  if (pathname.startsWith('/editor')) return 'editor';
  if (pathname.startsWith('/my-charts')) return 'myCharts';
  if (pathname.startsWith('/my-sheets')) return 'mySheets';
  if (pathname.startsWith('/my-licks')) return 'myLicks';
  if (pathname.startsWith('/solos')) return 'solos';
  if (pathname.startsWith('/licks')) return 'licks';
  if (pathname.startsWith('/comping')) return 'comping';
  if (pathname.startsWith('/lick-practice')) return 'lickPractice';
  return 'other';
}
