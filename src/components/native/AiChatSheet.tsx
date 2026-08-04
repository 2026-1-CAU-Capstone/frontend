import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Keyboard } from '@capacitor/keyboard';
import { useIsNativeUi } from '../../contexts/AppPreviewContext';
import { useTransitionState } from '../../hooks/useTransitionState';
import { RightChatPanel } from '../layout/RightChatPanel';
import { onAiChatSheetRequest } from '../../lib/nativeShell';
import { setActiveChat } from '../../api/chat';

/* ─────────────────────────────────────────────────────────────────────────
 * AI 채팅 시트 — 네이티브 셸의 "제일 긴" 풀하이트 바텀시트.
 *
 * 하단 바의 "AI에게 질문하기" · + 메뉴의 "새 채팅" · (Phase 3) 홈 대시보드의
 * 채팅 항목이 lib/nativeShell 의 openAiChatSheet() 로 이 시트를 연다.
 * 내용물은 기존 RightChatPanel 그대로 — 채팅 UI 디자인은 불변(요구사항).
 *
 * App.tsx 전역 마운트. 하단 바와 달리 라우트 숨김 없이 항상 살아 있어
 * 채팅 중 페이지를 옮겨도 대화 상태(activeChat)가 유지된다.
 * ──────────────────────────────────────────────────────────────────────── */

export function AiChatSheet() {
  const isNativeUi = useIsNativeUi();
  const native = useIsNativeUi();

  const [open, setOpen] = useState(false);
  /* 'new' 요청 시 RightChatPanel 을 리마운트해 대화를 초기화한다 —
   * HomePage 의 chatKey 패턴 그대로. */
  const [chatKey, setChatKey] = useState(0);
  const t = useTransitionState(open, 280);

  useEffect(() => onAiChatSheetRequest((req) => {
    if (req.chat === 'new') {
      setActiveChat(null);
      setChatKey((k) => k + 1);
    } else if (req.chat) {
      setActiveChat(req.chat);
    }
    setOpen(true);
  }), []);

  /* iOS 키보드 높이 추적 — HomePage 와 동일한 수동 오프셋 방식
   * (KeyboardResize:'none' 이라 WebView 가 입력창을 올려주지 않는다). */
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!native) return;
    const showSub = Keyboard.addListener('keyboardWillShow', (info) => setKbHeight(info.keyboardHeight));
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    return () => {
      showSub.then((h) => h.remove());
      hideSub.then((h) => h.remove());
    };
  }, [native]);

  if (!isNativeUi || !t.mounted) return null;

  return (
    <Backdrop $entered={t.entered} onClick={() => setOpen(false)}>
      <Sheet $entered={t.entered} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="AI 채팅">
        <SheetHandle />
        <CloseBtn type="button" aria-label="닫기" onClick={() => setOpen(false)}>
          <CloseIcon />
        </CloseBtn>
        <PanelSlot>
          <RightChatPanel
            key={chatKey}
            selectedChords={[]}
            groupExplanation={null}
            songTitle="Jazzify"
            hideHeader
            hideSelectionQuickAction
            emptyState={
              <SheetEmpty>
                <EmptyLogo src="/jazzifylogo.png" alt="Jazzify" />
                <EmptyGreeting>무엇이든 물어보세요</EmptyGreeting>
                <EmptyHint>화성학 · 재즈 이론 · 연주자 스타일</EmptyHint>
              </SheetEmpty>
            }
            inputPlaceholder="화성학, 재즈 이론, 무엇이든 물어보세요."
            autoFocusInput
            /* 시트를 열자마자(누르자마자) 포커스 — 인풋은 이미 DOM에 존재하고
             * 슬라이드 트랜지션은 시각적 애니메이션일 뿐이라 지연 없이 focus
             * 해도 키보드가 시트와 함께 바로 올라온다. */
            autoFocusInputDelay={0}
            inputInIntro
            nativeIntroLayout={native}
            keyboardOffsetPx={native ? kbHeight : 0}
          />
        </PanelSlot>
      </Sheet>
    </Backdrop>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ── styled ──────────────────────────────────────────────────────────── */

const Backdrop = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 1100; /* 하단 바(100) 위 */
  background: rgba(0, 0, 0, ${({ $entered }) => ($entered ? 0.42 : 0)});
  transition: background 0.28s ease;
  display: flex;
  align-items: flex-end;
`;

const Sheet = styled.div<{ $entered: boolean }>`
  width: 100%;
  /* "제일 긴 모달" — 상단 그립만 남기고 화면을 거의 다 덮는다. dvh 로
   * iOS 주소바/홈 인디케이터 변동에도 실제 보이는 높이를 따른다.
   * 위쪽 여백을 조금 더 줘서 시트가 화면 꼭대기까지 닿지 않고 살짝
   * 내려와서 뜨게 한다. */
  height: calc(100dvh - max(env(safe-area-inset-top, 0px), 12px) - 8px - 56px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.22);
  transform: translateY(${({ $entered }) => ($entered ? '0%' : '100%')});
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
  overflow: hidden;
`;

const SheetHandle = styled.div`
  width: 40px;
  height: 4.5px;
  border-radius: 999px;
  background: #d9dce1;
  margin: 8px auto 4px;
  flex: 0 0 auto;
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 5;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #f1f3f6;
  color: #4a4f57;
  cursor: pointer;

  &:active { opacity: 0.6; }
`;

const PanelSlot = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* hideHeader 라 첫 메시지가 시트 맨 위부터 시작 — 우상단에 떠 있는
   * CloseBtn(top:14px + height:34px)과 겹치지 않게 여백 확보. */
  padding-top: 40px;

  /* RightChatPanel 은 자체적으로 100% 채우는 패널 — 그대로 흘려보낸다 */
  & > * { flex: 1 1 auto; min-height: 0; }
`;

const SheetEmpty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px 20px;
`;

const EmptyLogo = styled.img`
  width: 56px;
  height: 56px;
  object-fit: contain;
`;

const EmptyGreeting = styled.div`
  font-size: 1.12rem;
  font-weight: 700;
  color: #1d2129;
`;

const EmptyHint = styled.div`
  font-size: 0.85rem;
  color: #8a8f98;
`;
