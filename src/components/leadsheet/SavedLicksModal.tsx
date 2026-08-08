import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import type { LickMatch } from '../../lib/lickMatcher';
import { deleteUserLick, type LickEntry } from '../../data/lickData';
import { LickRecommendMessage } from '../chat/LickRecommendMessage';

interface Props {
  spanLabel: string;
  matches: LickMatch[];
  onClose: () => void;
  songTempo?: number;
  /** Render the lick inline (measure-aligned) under the chord chart. */
  onShowInline?: (lick: LickEntry) => void;
  /** Lick id currently shown inline (for the ↓ button active state). */
  activeInlineLickId?: string | number;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.scrim};
  z-index: ${({ theme }) => theme.zIndex.max};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  width: min(640px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 20px 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
  gap: 12px;
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
`;

const Title = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
`;

const ProgLabel = styled.span`
  font-size: 13px;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textSecondary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Count = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: #B8860B;
  white-space: nowrap;
`;

const CloseBtn = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const ScrollBody = styled.div`
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding: 0 20px 8px;
`;

const ItemWrap = styled.div`
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.border};
  }
`;

const Empty = styled.div`
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

export function SavedLicksModal({ spanLabel, matches, onClose, songTempo, onShowInline, activeInlineLickId }: Props) {
  const [localMatches, setLocalMatches] = useState(matches);

  useEffect(() => { setLocalMatches(matches); }, [matches]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDeleteLocal = useCallback((lick: LickEntry) => {
    deleteUserLick(lick.id);
    setLocalMatches((prev) => prev.filter((m) => String(m.lick.id) !== String(lick.id)));
    window.dispatchEvent(new CustomEvent('jazzify:lickSaved'));
  }, []);

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Header>
          <TitleGroup>
            <Title>저장된 릭</Title>
            <ProgLabel>{spanLabel}</ProgLabel>
            {localMatches.length > 0 && <Count>{localMatches.length}개</Count>}
          </TitleGroup>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </Header>
        <ScrollBody>
          {localMatches.length === 0 ? (
            <Empty>저장된 릭이 없습니다.</Empty>
          ) : (
            localMatches.map((m) => (
              <ItemWrap key={m.lick.id}>
                <LickRecommendMessage
                  match={m}
                  tempoOverride={songTempo}
                  onShowInline={onShowInline}
                  inlineActive={activeInlineLickId != null && m.lick.id === activeInlineLickId}
                  onDeleteLocal={handleDeleteLocal}
                />
              </ItemWrap>
            ))
          )}
        </ScrollBody>
      </Card>
    </Overlay>
  );
}
