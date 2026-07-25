import styled from 'styled-components';

/**
 * 앱 전체 공통 "뒤로(`<`)" 버튼 — **단일 소스**.
 *
 * 기준 디자인은 Solo Database 의 연주자별 화면에 있던 사각 chevron 버튼이다.
 * 예전엔 페이지마다 제각각(원형 투명 버튼, `← Back` 텍스트, `←` 글자 등)이라
 * 화면을 옮길 때마다 뒤로 버튼의 모양·크기가 바뀌었다. 새 화면을 만들 땐 이
 * 컴포넌트를 쓰고, 자체 back 버튼을 새로 만들지 않는다.
 *
 * 상단바(가로 여백)는 `BAR_PAD_X` 를 함께 맞춘다.
 */

/** 상단바 표준 가로 여백 — Solo Database 상단바 기준. */
export const BAR_PAD_X = '16px';
/** 모바일 상단바 표준 가로 여백. */
export const BAR_PAD_X_MOBILE = '10px';

export interface BackButtonProps {
  onClick: () => void;
  /** 접근성 라벨 + 툴팁. 기본 '뒤로'. */
  label?: string;
  className?: string;
}

export function BackButton({ onClick, label = '뒤로', className }: BackButtonProps) {
  return (
    <BackSquare type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      <svg
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </BackSquare>
  );
}

/** 버튼 껍데기 — 위치 조정이 필요한 곳에서 styled(BackSquare) 로 확장할 수 있게 export. */
export const BackSquare = styled.button`
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
  &:active { transform: scale(0.94); }
`;
