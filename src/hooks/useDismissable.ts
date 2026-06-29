import { useEffect, useRef, type RefObject } from 'react';

/* §8 R6 — 두 프로젝트 페이지에 5벌 복붙돼 있던 "바깥 클릭/Escape로 닫기"
 * effect의 공통화. anchor ref 내부 클릭은 무시하고, 그 외 mousedown 또는
 * Escape에서 onDismiss를 호출한다.
 *
 * onDismiss는 ref로 미러링해 deps에서 제외 — 호출부가 인라인 화살표를 넘겨도
 * (관용적 사용) 활성 상태 동안 매 렌더 재구독하지 않는다 (원본 effect들의
 * deps가 [open] 하나였던 것과 동일한 구독 수명). */
export function useDismissable(
  active: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const cbRef = useRef(onDismiss);
  // 렌더 중 ref 쓰기는 react-compiler가 금지 — effect에서 최신값 미러.
  useEffect(() => { cbRef.current = onDismiss; });
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      cbRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cbRef.current(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, anchorRef]);
}
