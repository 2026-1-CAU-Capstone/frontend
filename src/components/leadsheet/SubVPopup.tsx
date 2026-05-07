import styled from 'styled-components';
import { useEffect } from 'react';

const GREEN = '#1E8A56';

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
  border: 2px solid ${GREEN};
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
  font-family: 'MuseJazz Text', 'DM Sans', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: ${GREEN};
`;

const Tag = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  background: rgba(30, 138, 86, 0.12);
  color: ${GREEN};
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
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 8px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const ShortDesc = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 14px;
`;

const LongDesc = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.88rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

interface SubVPopupProps {
  chordSymbol: string;
  targetDegree: string;
  originalVLabel: string;
  onClose: () => void;
}

export function SubVPopup({ chordSymbol, targetDegree, originalVLabel, onClose }: SubVPopupProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <HeaderLeft>
            <ChordName>{chordSymbol}</ChordName>
            <Tag>Tritone Sub</Tag>
          </HeaderLeft>
          <CloseBtn onClick={onClose} aria-label="Close">×</CloseBtn>
        </Header>
        <Body>
          <SubLabel>SubV/{targetDegree} — {originalVLabel}의 트리톤 대리</SubLabel>
          <ShortDesc>
            {originalVLabel} 대신 반음계적으로 접근하는 대리 도미넌트
          </ShortDesc>
          <LongDesc>
            서브스티튜티드 도미넌트(SubV)는 원래의 {originalVLabel}과 루트가 트리톤(증4도, 6반음) 관계인 도미넌트 코드입니다.
            두 코드는 같은 트리톤(장7도와 단3도)을 공유하기 때문에 동일한 해결감을 만들면서,
            반음 하행하는 베이스 라인으로 더 부드럽게 {targetDegree}으로 이동합니다.
            이 기법은 비밥과 모던 재즈에서 매우 흔하게 사용됩니다.
          </LongDesc>
        </Body>
      </Modal>
    </Backdrop>
  );
}
