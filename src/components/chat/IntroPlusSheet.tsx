import { useState, useRef, type TouchEvent } from 'react';
import styled, { keyframes } from 'styled-components';

/* iOS-style bottom sheet that opens when the user taps the [+] button on
 * the intro chat input. Mirrors the Claude iOS attach-sheet layout:
 *   - drag handle bar
 *   - close X (top-left) + centered title
 *   - three large square actions (Camera / Photo / File)
 *   - list rows with trailing value + chevron
 *   - toggle rows with switches
 * All items are placeholders for now — wire to real handlers later. */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function IntroPlusSheet({ open, onClose }: Props) {
  const [research, setResearch] = useState(false);
  const [webSearch, setWebSearch] = useState(true);

  /* Swipe-down to dismiss. Tracks the initial touch Y and closes the
   * sheet on any downward drag/flick > ~70px. Native iOS gesture parity. */
  const touchStartYRef = useRef<number | null>(null);
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };
  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current == null) return;
    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const dy = endY - touchStartYRef.current;
    touchStartYRef.current = null;
    if (dy > 70) onClose();
  };

  if (!open) return null;

  return (
    <>
      <Backdrop onClick={onClose} />
      <Sheet
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Handle />
        <Header>
          <CloseBtn onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </CloseBtn>
          <Title>채팅에 추가</Title>
          <span style={{ width: 36 }} /> {/* spacer for title centering */}
        </Header>

        <Squares>
          <Square>
            <CameraIcon />
            <SquareLabel>카메라</SquareLabel>
          </Square>
          <Square>
            <PhotoIcon />
            <SquareLabel>사진</SquareLabel>
          </Square>
          <Square>
            <FileIcon />
            <SquareLabel>파일</SquareLabel>
          </Square>
        </Squares>

        <Divider />

        <Row>
          <RowIcon><FolderIcon /></RowIcon>
          <RowLabel>프로젝트에 추가</RowLabel>
          <RowValue>없음</RowValue>
          <ChevronRight />
        </Row>
        <Row>
          <RowIcon><StyleIcon /></RowIcon>
          <RowLabel>스타일 선택</RowLabel>
          <RowValue>일반</RowValue>
          <ChevronRight />
        </Row>
        <Row>
          <RowIcon><ToolIcon /></RowIcon>
          <RowLabel>도구 액세스</RowLabel>
          <RowValue>Auto</RowValue>
          <ChevronRight />
        </Row>

        <Divider />

        <Row>
          <RowIcon><ResearchIcon /></RowIcon>
          <RowLabel>연구</RowLabel>
          <Switch $on={research} onClick={() => setResearch((v) => !v)} />
        </Row>
        <Row>
          <RowIcon $color="#3978f7"><WebIcon /></RowIcon>
          <RowLabel>웹 검색</RowLabel>
          <Switch $on={webSearch} onClick={() => setWebSearch((v) => !v)} />
        </Row>
      </Sheet>
    </>
  );
}

/* ── icons ───────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CameraIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </svg>
);

const PhotoIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
    <path d="M3 17 L9 12 L14 17 L17 14 L21 18" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

const FileIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 3 h8 l4 4 v14 a1 1 0 0 1-1 1 H6 a1 1 0 0 1-1-1 V4 a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    <path d="M14 3 v4 h4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    <path d="M12 17 V11 M9 14 L12 11 L15 14" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FolderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M3 7 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v9 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
  </svg>
);

const StyleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M5 19 c1-5 3-9 7-13 l3 3 c-4 4-8 6-13 7 z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    <path d="M14 6 l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ToolIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M9 7 V5 a2 2 0 0 1 2-2 h2 a2 2 0 0 1 2 2 v2" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </svg>
);

const ResearchIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M7 10 L9.5 13 L15 8" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const WebIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const ChevronRight = styled.span`
  width: 10px;
  height: 10px;
  border-right: 1.7px solid rgba(0, 0, 0, 0.3);
  border-bottom: 1.7px solid rgba(0, 0, 0, 0.3);
  transform: rotate(-45deg);
  margin-left: 6px;
  flex-shrink: 0;
`;

/* ── animations ──────────────────────────────────────────── */

const fadeBg = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const slideUp = keyframes`from { transform: translateY(100%) } to { transform: translateY(0) }`;

/* ── styles ──────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 200;
  animation: ${fadeBg} 0.18s ease both;
`;

const Sheet = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 201;
  background: #fbfaf6;
  border-radius: 22px 22px 0 0;
  padding: 8px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.12);
  animation: ${slideUp} 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  max-height: 88vh;
  overflow-y: auto;
`;

const Handle = styled.div`
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.2);
  margin: 6px auto 12px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 14px;
`;

const CloseBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #fff;
  color: rgba(0, 0, 0, 0.75);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);

  &:active { transform: scale(0.94); }
`;

const Title = styled.div`
  flex: 1;
  text-align: center;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
`;

const Squares = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 4px 0 14px;
`;

const Square = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 8px 16px;
  border: none;
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.04);
  color: #1a1a1a;
  cursor: pointer;
  transition: background 0.12s, transform 0.08s;

  &:active {
    background: rgba(0, 0, 0, 0.08);
    transform: scale(0.97);
  }
`;

const SquareLabel = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
`;

const Divider = styled.hr`
  margin: 8px 12px;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 6px;
  cursor: pointer;
  transition: background 0.12s;
  border-radius: 10px;

  &:active { background: rgba(0, 0, 0, 0.03); }
`;

const RowIcon = styled.div<{ $color?: string }>`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $color }) => $color || 'rgba(0, 0, 0, 0.75)'};
  flex-shrink: 0;
`;

const RowLabel = styled.div`
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 500;
  color: #1a1a1a;
`;

const RowValue = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  color: rgba(0, 0, 0, 0.45);
`;

/* iOS-style toggle switch */
const Switch = styled.button<{ $on: boolean }>`
  width: 50px;
  height: 30px;
  border-radius: 999px;
  border: none;
  position: relative;
  cursor: pointer;
  background: ${({ $on }) => ($on ? '#3978f7' : 'rgba(0, 0, 0, 0.18)')};
  transition: background 0.18s;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${({ $on }) => ($on ? '22px' : '2px')};
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: left 0.18s;
  }
`;
