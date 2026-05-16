import { useState } from 'react';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { RightChatPanel } from './RightChatPanel';
import type { ChordOverlay } from '../../data/types';

/* ─── FAB button (only visible on mobile) ──────────────────────────────── */

const Fab = styled.button`
  display: none;
  ${mq.compactLayout} {
    display: flex;
  }
  position: fixed;
  bottom: 24px;
  right: 20px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 900;
  transition: transform 0.15s;
  &:active { transform: scale(0.92); }
`;

const FabIcon = styled.svg`
  width: 24px;
  height: 24px;
  fill: currentColor;
`;

/* ─── fullscreen chat overlay ──────────────────────────────────────────── */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: ${({ theme }) => theme.colors.bgPrimary};
  display: flex;
  flex-direction: column;
`;

const CloseBar = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const CloseBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  padding: 4px 0;
`;

const ChatArea = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
`;

/* ─── component ────────────────────────────────────────────────────────── */

interface MobileChatFabProps {
  selectedChords?: ChordOverlay[];
  groupExplanation?: string | null;
  songTitle: string;
  chordContext?: string;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onClearSelectedChords?: () => void;
  notesContext?: string;
}

export function MobileChatFab({
  selectedChords = [],
  groupExplanation = null,
  songTitle,
  chordContext,
  isSelectionMode = false,
  onToggleSelectionMode,
  onClearSelectedChords,
  notesContext,
}: MobileChatFabProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <Fab onClick={() => setOpen(true)} title="AI 채팅">
          <FabIcon viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z" />
          </FabIcon>
        </Fab>
      )}

      {open && (
        <Overlay>
          <CloseBar>
            <CloseBtn onClick={() => setOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
              뒤로
            </CloseBtn>
          </CloseBar>
          <ChatArea>
            <RightChatPanel
              selectedChords={selectedChords}
              groupExplanation={groupExplanation}
              songTitle={songTitle}
              chordContext={chordContext}
              isSelectionMode={isSelectionMode}
              onToggleSelectionMode={onToggleSelectionMode}
              onClearSelectedChords={onClearSelectedChords}
              notesContext={notesContext}
            />
          </ChatArea>
        </Overlay>
      )}
    </>
  );
}
