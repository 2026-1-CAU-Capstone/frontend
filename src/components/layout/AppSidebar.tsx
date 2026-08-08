import { useContext } from 'react';
import { SidebarSlot, type AppSidebarProps } from './sidebarSlot';

/** 페이지가 렌더하는 사이드바 자리. 실제 내용은 셸이 주입한다(sidebarSlot 참조). */
export function AppSidebar(props: AppSidebarProps) {
  const render = useContext(SidebarSlot);
  /* 주입이 없으면 아무것도 그리지 않는다 — 사이드바가 없는 화면(공유 링크 뷰어,
   * 네이티브 셸)에서도 페이지를 그대로 쓸 수 있어야 하므로 예외를 던지지 않는다. */
  return <>{render ? render(props) : null}</>;
}
