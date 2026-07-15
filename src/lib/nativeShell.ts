/* 네이티브 셸(하단 바 · AI 시트 · 홈 대시보드) 사이의 아주 작은 pub-sub.
 *
 * 하단 바는 App.tsx 에 전역 마운트되고, AI 시트를 열고 싶은 곳은 여러 군데다
 * (하단 바의 "AI에게 질문하기", + 메뉴의 "새 채팅", 홈 대시보드의 채팅 항목,
 * 상단 바의 채팅 버튼). props 로 꿰기엔 마운트 트리가 서로 떨어져 있어서,
 * api/chat.ts 의 setActiveChat 패턴을 그대로 따라 모듈 레벨 이벤트 버스로 푼다.
 * React context 를 쓰지 않는 이유도 동일 — 구독자가 전부 다른 트리에 있다.
 */

export interface AiSheetRequest {
  /** 열면서 로드할 대화. 생략하면 직전 상태 그대로, 'new' 면 새 대화로 리셋. */
  chat?: string | 'new';
}

type AiSheetListener = (req: AiSheetRequest) => void;

const aiListeners = new Set<AiSheetListener>();

/** AI 채팅 시트를 연다. 시트가 아직 마운트 전이면 조용히 무시된다
 *  (시트는 하단 바와 같은 컴포넌트에 상주하므로 실질적으로 항상 존재). */
export function openAiChatSheet(req: AiSheetRequest = {}): void {
  for (const cb of aiListeners) {
    try { cb(req); } catch { /* listener error must not break the caller */ }
  }
}

export function onAiChatSheetRequest(cb: AiSheetListener): () => void {
  aiListeners.add(cb);
  return () => { aiListeners.delete(cb); };
}
