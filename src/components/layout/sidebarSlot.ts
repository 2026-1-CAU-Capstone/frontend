import { createContext, type ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * 사이드바 슬롯 — "어느 사이드바를 쓸지"를 셸이 정하게 하는 주입 지점.
 *
 * 원래는 17개 페이지가 각자 `<IconSidebar />` 를 직접 렌더했다. 그 상태로 스튜디오를
 * 분리하니 스튜디오의 Solo Database 화면에 **앱의 채팅 사이드바가 그대로 떴다**
 * (새 채팅 · 최근 채팅 · 내 코드 차트…). 채팅은 사용자 기능이고 스튜디오 것이 아니다.
 *
 * 이 파일이 IconSidebar 도 StudioSidebar 도 import 하지 않는 게 핵심이다 — import
 * 하면 그 컴포넌트가 양쪽 번들에 다 들어가 분리가 무의미해진다.
 *
 * 컴포넌트가 아니라 **렌더 함수**를 담는다. 컨텍스트에서 꺼낸 값을 `<C />` 로 쓰면
 * "렌더 중에 컴포넌트를 만든다"가 되어(react-hooks/static-components) 정체성이
 * 바뀔 때 subtree 가 리마운트될 위험이 있다. 함수를 호출해 JSX 를 받으면 그 문제가
 * 없다. 주입하는 함수는 **모듈 최상위**에 두어야 한다(렌더마다 새로 만들면 같은 문제).
 * ──────────────────────────────────────────────────────────────────────── */

export interface AppSidebarProps {
  /** "로그인하세요" 홍보 카드 숨김 (앱 전용 — 스튜디오는 무시). */
  hideAuthPromo?: boolean;
  /** "새 채팅" 클릭 (앱 전용 — 스튜디오는 무시). */
  onNewChat?: () => void;
  /** "채팅"(기록) 클릭 (앱 전용 — 스튜디오는 무시). */
  onOpenChatHistory?: () => void;
  /** 채팅 기록 버튼 활성 여부 (앱 전용 — 스튜디오는 무시). */
  isLoggedInUser?: boolean;
}

export type SidebarRenderer = (props: AppSidebarProps) => ReactNode;

export const SidebarSlot = createContext<SidebarRenderer | null>(null);
