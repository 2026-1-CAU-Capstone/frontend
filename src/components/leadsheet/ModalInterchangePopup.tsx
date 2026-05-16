import styled from 'styled-components';
import { useEffect } from 'react';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  max-width: 480px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  border: 2px solid #7B3FB0;
`;

const Header = styled.div`
  padding: 18px 20px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
`;

const ChordName = styled.span`
  font-family: 'MuseJazz Text', 'Pretendard', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: #7B3FB0;
`;

const Tag = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.7rem;
  background: rgba(123, 63, 176, 0.12);
  color: #7B3FB0;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  font-size: 1.4rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  line-height: 1;
  padding: 4px 8px;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Body = styled.div`
  padding: 16px 20px 20px;
`;

const SubLabel = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 8px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const ShortDesc = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 14px;
`;

const LongDesc = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.88rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

interface ModalInterchangePopupProps {
  chordSymbol: string;
  sourceMode: string;
  borrowedDegree: string;
  shortText: string;
  longText: string;
  onClose: () => void;
}

export function ModalInterchangePopup({
  chordSymbol,
  sourceMode,
  borrowedDegree,
  shortText,
  longText,
  onClose,
}: ModalInterchangePopupProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <HeaderLeft>
            <ChordName>{chordSymbol}</ChordName>
            <Tag>Modal Interchange</Tag>
          </HeaderLeft>
          <CloseBtn onClick={onClose} aria-label="Close">×</CloseBtn>
        </Header>
        <Body>
          <SubLabel>{borrowedDegree} from {sourceMode}</SubLabel>
          <ShortDesc>{shortText}</ShortDesc>
          <LongDesc>{longText}</LongDesc>
        </Body>
      </Modal>
    </Backdrop>
  );
}
