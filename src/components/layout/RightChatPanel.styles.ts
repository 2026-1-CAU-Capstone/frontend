import styled from 'styled-components';

export const PanelContainer = styled.aside`
  width: 100%;
  min-width: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgPrimary};
  overflow: hidden;
  position: relative;
`;

/* Floating "scroll to bottom" arrow — visible only when the user has scrolled
 * up from the latest message. Anchored just above the chat input (input height
 * roughly 70-150px. Keep extra clearance above the chord/note section picker
 * quick action so the arrow never competes with that target. */
export const ScrollToBottomBtn = styled.button`
  position: absolute;
  left: 50%;
  bottom: 224px;
  transform: translateX(-50%);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  z-index: 5;
  transition: transform 0.12s, background 0.15s;

  &:hover { background: ${({ theme }) => theme.colors.hover}; }
  &:active { transform: translateX(-50%) scale(0.95); }
`;

export const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

export const MessagesArea = styled.div`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  /* padding-bottom 을 늘려서 마지막 메시지와 IntroInputSlot 사이에 숨 쉴
   *  공간을 둠. 너무 빡빡하면 답변이 입력창에 붙어보여 어색. */
  padding: 16px 20px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  /* Cap conversation column width (Claude/ChatGPT pattern). Children stay
   *  full-width inside the cap so user-bubble right-align still works. */
  > * {
    width: 100%;
    max-width: 760px;
  }

  @media (max-width: 768px) {
    padding: 12px 14px 20px;
    > * { max-width: 100%; }
  }
`;

/* Wrapper for the chat input when it's rendered INSIDE the empty-state area
 * (ChatGPT / Claude pattern — input sits right under the hero, both centered
 * as a group, instead of input pinned to the bottom of the panel). Margin-top
 * negative pulls it up snug against the empty state; max-width keeps it from
 * stretching edge-to-edge on wide layouts. */
/* Wrapper around the IntroChatInput in intro mode. Centers it horizontally
 * and caps width so it stays Claude-proportioned on wide screens.
 * $hideFade hides the top fade strip — pass it on the empty-state intro
 * (nothing to fade out from above) so the input doesn't get a stray band
 * floating over plain background. */
export const IntroInputSlot = styled.div<{ $hideFade?: boolean }>`
  width: 100%;
  /* 메시지(max 760) 와 정확히 같은 가로 폭으로 통일. 둘 다 가운데 정렬
   *  이므로 viewport 중앙 기준 같은 컬럼에 정렬된다. */
  max-width: 760px;
  margin: 0 auto;
  padding: 0;
  align-self: center;
  position: relative;

  /* 메시지 영역 끝과 입력창 사이 fade — 마지막 답변이 입력창에 가까워질
   *  때 자연스럽게 사라지는 듯한 시각 효과. IntroInputSlot 의 위쪽 바깥
   *  공간에 그라데이션 띠를 띄움. */
  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -28px;
    height: 28px;
    background: linear-gradient(
      to bottom,
      transparent,
      ${({ theme }) => theme.colors.bgPrimary}
    );
    pointer-events: none;
    ${({ $hideFade }) => $hideFade && 'display: none;'}
  }

  /* Touch devices (iPad + iPhone): fill the available column width so the
   * input feels generously sized next to the persistent sidebar instead of
   * being capped at 760px. iPhones tighten padding further via the rule below. */
  @media (hover: none), (pointer: coarse) {
    max-width: 100%;
    padding: 0 24px;
  }

  /* Phones: tighter side padding + suppress the top fade (no scroll-room
   * above the input on the empty intro screen). */
  @media (max-width: 768px) {
    max-width: 100%;
    padding: 0 14px;
    &::before { display: none; }
  }
`;

export const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 1.6;
`;

/* Shown in place of the empty-state hero while a sidebar-clicked chat is
 * being fetched from GET /v1/chat/{id}. Gives the user visual feedback so
 * the panel never looks frozen during the network round-trip. */
export const ChatLoadingState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
`;

export const ChatLoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.border};
  animation: chatSpin 0.8s linear infinite;
  @keyframes chatSpin {
    to { transform: rotate(360deg); }
  }
`;

export const EmptyIcon = styled.img`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: cover;
  margin-bottom: 12px;
`;

export const EmptyActionGroup = styled.div`
  width: 100%;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 36px;
`;

export const EmptyActionButton = styled.button`
  width: 100%;
  margin: 0;
  padding: 9px 14px;
  border-radius: 18px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border};
    border-color: ${({ theme }) => theme.colors.textSecondary};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;
