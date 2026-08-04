/* ─────────────────────────────────────────────────────────────────────────
 * noteNamePrefs — "음표에 음 표시하기" 설정.
 *
 * **전역 한 벌만** 둔다(켜기·언어·색·크기). 페이지별로 다르게 켜는 기능은
 * 만들었다가 걷어냈다(2026-08-04) — 설정 화면이 복잡해지는 대가에 비해 실제
 * 니즈가 확인되지 않았다. 필요해지면 Pref 를 페이지 키로 늘리면 된다.
 * ──────────────────────────────────────────────────────────────────────── */

import { createPref, oneOf, type Pref } from '../prefsStore';
import type { NoteNameLang } from './noteNameLabels';

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
