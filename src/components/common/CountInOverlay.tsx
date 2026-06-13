import styled, { keyframes } from 'styled-components';
import { maxRowLength, type Pattern } from '../../lib/note/countInPatterns';

interface Props {
  active: boolean;
  /** 콜드 스타트 — 악기 로딩 중. "1 2 3 4" 대신 "준비 중…" 스피너를 보여준다. */
  preparing?: boolean;
  pattern: Pattern;
  /** 1-indexed cell 글로벌 index (1..pattern.totalCells). 0 = pre-start. */
  currentBeat: number;
  /** scoped=true → 부모 컨테이너 안에서만 표시 (LickCard 등). false = 풀스크린. */
  scoped?: boolean;
  /** 백드롭 클릭 시 카운트인 취소 (선택). */
  onCancel?: () => void;
}

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const Preparing = styled.div<{ $scoped: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: ${({ $scoped }) => ($scoped ? '12px' : '22px')};
  color: #ffd54f;
  font-family: 'Pretendard', 'MuseJazz Text', sans-serif;
  font-weight: 700;
  font-size: ${({ $scoped }) =>
    $scoped ? 'clamp(0.85rem, 2.4vw, 1.2rem)' : 'clamp(1.1rem, 3vw, 2rem)'};
`;

const Spinner = styled.div<{ $scoped: boolean }>`
  width: ${({ $scoped }) => ($scoped ? '28px' : '52px')};
  height: ${({ $scoped }) => ($scoped ? '28px' : '52px')};
  border-radius: 50%;
  border: ${({ $scoped }) => ($scoped ? '3px' : '5px')} solid rgba(255, 213, 79, 0.25);
  border-top-color: #ffd54f;
  animation: ${spin} 700ms linear infinite;
`;

const Backdrop = styled.div<{ $scoped: boolean; $clickable: boolean }>`
  position: ${({ $scoped }) => ($scoped ? 'absolute' : 'fixed')};
  inset: 0;
  background: ${({ $scoped }) =>
    $scoped ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.6)'};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: ${({ $scoped }) => ($scoped ? 50 : 10000)};
  pointer-events: ${({ $clickable }) => ($clickable ? 'auto' : 'none')};
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'default')};
  border-radius: inherit;
  animation: ${fadeIn} 120ms ease-out;
`;

const Rows = styled.div<{ $scoped: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: ${({ $scoped }) =>
    $scoped ? 'clamp(12px, 2.5vw, 28px)' : 'clamp(16px, 3vw, 36px)'};
`;

const Row = styled.div<{ $scoped: boolean }>`
  display: flex;
  align-items: center;
  column-gap: ${({ $scoped }) =>
    $scoped ? 'clamp(6px, 1.2vw, 16px)' : 'clamp(10px, 2vw, 24px)'};
`;

/* 박스 크기 — pattern 의 max row width 가 8 (FAST 첫 행) 이면 더 작게,
 * 4 이면 크게. scoped (LickCard 안) 면 전체적으로 더 작게. */
function boxWidth(scoped: boolean, maxCells: number): string {
  if (scoped) {
    return maxCells > 4
      ? 'clamp(26px, 4.5vw, 50px)'
      : 'clamp(44px, 7vw, 80px)';
  }
  return maxCells > 4
    ? 'clamp(48px, 8vw, 130px)'
    : 'clamp(96px, 16vw, 220px)';
}

function boxFont(scoped: boolean, maxCells: number): string {
  if (scoped) {
    return maxCells > 4
      ? 'clamp(0.8rem, 2.2vw, 1.4rem)'
      : 'clamp(1.3rem, 4vw, 2.4rem)';
  }
  return maxCells > 4
    ? 'clamp(1.8rem, 4.5vw, 4.5rem)'
    : 'clamp(3.5rem, 9vw, 8rem)';
}

type BoxKind = 'silent' | 'snap' | 'numbered';

const Box = styled.div<{
  $active: boolean;
  $kind: BoxKind;
  $scoped: boolean;
  $maxCells: number;
}>`
  width: ${({ $scoped, $maxCells }) => boxWidth($scoped, $maxCells)};
  aspect-ratio: 1;
  border-radius: ${({ $scoped }) => ($scoped ? '10px' : '18px')};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Pretendard', 'MuseJazz Text', sans-serif;
  font-size: ${({ $scoped, $maxCells }) => boxFont($scoped, $maxCells)};
  font-weight: 800;
  transition:
    background 70ms ease-out,
    color 70ms ease-out,
    border-color 70ms ease-out,
    transform 80ms ease-out,
    box-shadow 80ms ease-out;

  ${({ $kind, $active, $scoped }) => {
    if ($kind === 'silent') {
      // 짝 — 완전 투명 spacer. 자리만 차지하고 시각 요소 없음.
      return `
        background: transparent;
        border: none;
        box-shadow: none;
        color: transparent;
      `;
    }
    if ($kind === 'snap') {
      // 손가락 틩김 — 빈 사각형 (border 만). 활성화되면 노란 border + 가벼운 glow.
      const border = $scoped ? '2px' : '3px';
      return `
        background: ${$active ? 'rgba(255, 213, 79, 0.18)' : 'transparent'};
        border: ${border} solid ${$active ? '#ffd54f' : 'rgba(255, 255, 255, 0.22)'};
        box-shadow: ${$active ? ($scoped ? '0 0 12px rgba(255, 213, 79, 0.45)' : '0 0 22px rgba(255, 213, 79, 0.45)') : 'none'};
        color: transparent;
        transform: ${$active ? 'scale(1.05)' : 'scale(1)'};
      `;
    }
    // numbered — 전체 박스, 활성화되면 노란 fill + 큰 glow + scale.
    const border = $scoped ? '2px' : '3px';
    return `
      color: ${$active ? '#1a1a1a' : 'rgba(255, 255, 255, 0.28)'};
      background: ${$active ? '#ffd54f' : 'rgba(255, 255, 255, 0.06)'};
      border: ${border} solid ${$active ? '#ffd54f' : 'rgba(255, 255, 255, 0.16)'};
      box-shadow: ${$active ? ($scoped ? '0 0 16px rgba(255, 213, 79, 0.55)' : '0 0 28px rgba(255, 213, 79, 0.55)') : 'none'};
      transform: ${$active ? 'scale(1.08)' : 'scale(1)'};
    `;
  }}
`;

export function CountInOverlay({
  active,
  preparing = false,
  pattern,
  currentBeat,
  scoped = false,
  onCancel,
}: Props) {
  if (!active) return null;
  const maxCells = maxRowLength(pattern);
  let globalIdx = 0;
  return (
    <Backdrop
      $scoped={scoped}
      $clickable={!!onCancel}
      onClick={
        onCancel
          ? (e) => {
              e.stopPropagation();
              onCancel();
            }
          : undefined
      }
    >
      {preparing ? (
        <Preparing $scoped={scoped}>
          <Spinner $scoped={scoped} />
          준비 중…
        </Preparing>
      ) : (
      <Rows $scoped={scoped}>
        {pattern.rows.map((row, ri) => (
          <Row key={ri} $scoped={scoped}>
            {row.map((cell, ci) => {
              const idx = globalIdx++;
              const kind: BoxKind =
                cell.audio === 'silent'
                  ? 'silent'
                  : cell.audio === 'snap'
                    ? 'snap'
                    : 'numbered';
              const isActive = kind !== 'silent' && idx + 1 === currentBeat;
              return (
                <Box
                  key={ci}
                  $active={isActive}
                  $kind={kind}
                  $scoped={scoped}
                  $maxCells={maxCells}
                >
                  {cell.label}
                </Box>
              );
            })}
          </Row>
        ))}
      </Rows>
      )}
    </Backdrop>
  );
}
