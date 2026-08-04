/* ─────────────────────────────────────────────────────────────────────────
 * useNoteNameStyle — 지금 이 화면에서 음이름을 어떻게 그릴지 확정한다.
 *
 * 전역 설정 + 현재 라우트의 페이지별 덮어쓰기를 합쳐 하나의 스타일로 준다.
 * 렌더러(NoteSheet·EditorPage·LickCard…)는 이 값을 그리기 effect 의 의존성에
 * 넣기만 하면, 설정을 바꾼 순간 열려 있는 악보가 다시 그려진다.
 *
 * 페이지 판정을 라우트로 하는 이유: 악보 컴포넌트는 여러 페이지가 공유해서
 * 쓰는데, 페이지 키를 prop 으로 내리면 호출부를 전부 고쳐야 한다. 라우트는
 * 이미 전역 정보라 컴포넌트를 건드리지 않는다.
 * ──────────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { usePref } from '../lib/prefsStore';
import type { NoteNameStyle } from '../lib/note/noteNameLabels';
import {
  noteNamesOn, noteNameLang, noteNameColor, noteNameSize,
  noteNamesForPage, resolveSheetPage, type SheetPageKey,
} from '../lib/note/noteNamePrefs';

/**
 * @param pageOverride 라우트로 판정할 수 없는 곳(모달 미리보기 등)에서 페이지를
 *                     직접 지정하고 싶을 때만 넘긴다.
 */
export function useNoteNameStyle(pageOverride?: SheetPageKey): NoteNameStyle {
  const { pathname } = useLocation();
  const page = pageOverride ?? resolveSheetPage(pathname);

  const [globalOn] = usePref(noteNamesOn);
  const [lang] = usePref(noteNameLang);
  const [color] = usePref(noteNameColor);
  const [size] = usePref(noteNameSize);
  const [override] = usePref(noteNamesForPage(page));

  return useMemo<NoteNameStyle>(() => ({
    on: override === 'inherit' ? globalOn : override === 'on',
    lang, color, size,
  }), [override, globalOn, lang, color, size]);
}
