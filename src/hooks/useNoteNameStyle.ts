/* ─────────────────────────────────────────────────────────────────────────
 * useNoteNameStyle — 음이름을 어떻게 그릴지 확정한다(전역 설정 한 벌).
 *
 * 렌더러(NoteSheet·EditorPage·LickCard…)는 이 값을 그리기 effect 의 의존성에
 * 넣기만 하면, 설정을 바꾼 순간 열려 있는 악보가 다시 그려진다.
 * ──────────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import { usePref } from '../lib/prefsStore';
import type { NoteNameStyle } from '../lib/note/noteNameLabels';
import { noteNamesOn, noteNameLang, noteNameColor, noteNameSize } from '../lib/note/noteNamePrefs';

export function useNoteNameStyle(): NoteNameStyle {
  const [on] = usePref(noteNamesOn);
  const [lang] = usePref(noteNameLang);
  const [color] = usePref(noteNameColor);
  const [size] = usePref(noteNameSize);
  return useMemo<NoteNameStyle>(() => ({ on, lang, color, size }), [on, lang, color, size]);
}
