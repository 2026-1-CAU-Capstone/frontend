/* ─────────────────────────────────────────────────────────────────────────
 * IME(한국어 등 조합형 입력) Enter 가드.
 *
 * 한글을 입력하고 조합을 확정하려고 Enter를 치면, keydown 이벤트가
 * `isComposing=true`(또는 legacy keyCode 229) 상태로 한 번 더 발화한다.
 * 이걸 일반 Enter로 처리하면 "마지막 글자가 잘린 채 제출/이름변경/검색이동"
 * 이 일어난다. 모든 Enter 핸들러는 액션 전에 이 가드로 걸러야 한다:
 *
 *   if (e.key === 'Enter' && isComposingEvent(e)) return;
 *
 * React SyntheticEvent(e.nativeEvent.isComposing)와 raw KeyboardEvent
 * (e.isComposing) 모두 지원. keyCode 229는 구형 브라우저/웹뷰 폴백.
 * ──────────────────────────────────────────────────────────────────────── */

interface ComposingLike {
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
  keyCode?: number;
}

export function isComposingEvent(e: ComposingLike): boolean {
  const native = e.nativeEvent ?? e;
  return native.isComposing === true || e.keyCode === 229;
}
