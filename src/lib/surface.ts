import { createContext, useContext } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * 지금 이 페이지가 **어느 앱에서** 돌고 있는지.
 *
 * 공유 페이지(SolosPage · LicksPage · EditorPage · ChordPage …)는 실서비스와
 * 스튜디오 양쪽에서 쓰인다. 같은 화면인데 스튜디오에서만 있어야 하는 것들이
 * 있다 — 큐 기록, 응답값 원문 보기 같은 제작·디버그 도구.
 *
 * 예전엔 그걸 `isAdminUser(user)` 로 갈랐다. 그러면 **실서비스에서 admin 으로
 * 로그인해도 제작 도구가 뜬다** — "앱에는 어드민 기능이 없다"는 목표와 어긋난다.
 * 판정 기준이 애초에 틀렸다: 계정 등급이 아니라 **어느 앱인가**의 문제다.
 *
 * 스튜디오는 이미 라우트 전체가 AdminRoute 고 백엔드가 role 을 강제하므로,
 * 여기서 다시 등급을 볼 필요가 없다.
 * ──────────────────────────────────────────────────────────────────────── */

export type Surface = 'app' | 'studio';

/** 기본값은 'app' — 주입을 빼먹었을 때 제작 도구가 새어 나가지 않는 쪽으로 기운다. */
export const SurfaceContext = createContext<Surface>('app');

/** 스튜디오(내부 제작 도구)에서 돌고 있는가. */
export function useIsStudio(): boolean {
  return useContext(SurfaceContext) === 'studio';
}
