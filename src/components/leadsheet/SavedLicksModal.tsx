import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import type { LickMatch } from '../../lib/lickMatcher';
import { deleteUserLick, loadLicks, type LickEntry } from '../../data/lickData';
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
  background: rgba(0, 0, 0, 0.6);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
`;

const Card = styled.div`
  background: #fff;
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
  border-bottom: 1px solid #e8e8e8;
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
  color: #1a1a1a;
  white-space: nowrap;
`;

const ProgLabel = styled.span`
  font-size: 13px;
  font-weight: 400;
  color: #999;
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
  background: #f0f0f0;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  &:hover { background: #e0e0e0; color: #1a1a1a; }
`;

const ScrollBody = styled.div`
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding: 0 20px 8px;
`;

const ItemWrap = styled.div`
  & + & {
    border-top: 1px solid #efefef;
  }
`;

const Empty = styled.div`
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: #aaa;
`;

export function SavedLicksModal({ spanLabel, matches, onClose, songTempo, onShowInline, activeInlineLickId }: Props) {
  const [localMatches, setLocalMatches] = useState(matches);

  // ── DEMO-HARDCODE (임시 시연용): "ChatGPT Generated Lick"을 무조건 모달 맨 앞에.
  //    시연 후 이 effect를 `setLocalMatches(matches)` 한 줄로 되돌리면 됨. ──
  useEffect(() => {
    let cancelled = false;
    const CHATGPT_LICK_ID = '747a25a6-5aed-4f04-8e51-b93df8757c79'; // [Unknown] ChatGPT Generated Lick
    loadLicks()
      .then((all) => {
        if (cancelled) return;
        const gpt = all.find((l) => String(l.id) === CHATGPT_LICK_ID);
        if (gpt && !matches.some((m) => String(m.lick.id) === CHATGPT_LICK_ID)) {
          setLocalMatches([{ lick: gpt, tier: 1 as const }, ...matches]);
        } else {
          setLocalMatches(matches);
        }
      })
      .catch(() => { if (!cancelled) setLocalMatches(matches); });
    return () => { cancelled = true; };
  }, [matches]);

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
