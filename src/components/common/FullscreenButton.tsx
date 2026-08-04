import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';

/* ─── expand / collapse SVG icons ───────────────────────────────────────── */

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 1 1 1 1 6" />
    <polyline points="12 1 17 1 17 6" />
    <polyline points="6 17 1 17 1 12" />
    <polyline points="12 17 17 17 17 12" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 6 6 6 6 1" />
    <polyline points="12 1 12 6 17 6" />
    <polyline points="1 12 6 12 6 17" />
    <polyline points="12 17 12 12 17 12" />
  </svg>
);

/* ─── styled button ─────────────────────────────────────────────────────── */

const Btn = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.border};
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.scrim};
  }
`;

/* ─── hook + component ──────────────────────────────────────────────────── */

export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === ref.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  const toggle = useCallback(() => {
    if (!ref.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      ref.current.requestFullscreen();
    }
  }, [ref]);

  return { isFullscreen, toggle };
}

interface FullscreenButtonProps {
  isFullscreen: boolean;
  onClick: () => void;
}

export function FullscreenButton({ isFullscreen, onClick }: FullscreenButtonProps) {
  return (
    <Btn
      className="fullscreen-btn"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={isFullscreen ? '축소' : '전체화면'}
    >
      {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
    </Btn>
  );
}
