import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

/* ─── preset zoom levels ──────────────────────────────────────────────── */

const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const STEP = 25;

/* ─── icons ───────────────────────────────────────────────────────────── */

const MinusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="7" x2="11" y2="7" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="7" y1="3" x2="7" y2="11" />
    <line x1="3" y1="7" x2="11" y2="7" />
  </svg>
);

/* ─── styled components ───────────────────────────────────────────────── */

const Wrapper = styled.div<{ $right: number }>`
  position: absolute;
  top: 8px;
  right: ${({ $right }) => $right}px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 2px;
`;

const ZoomBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 30px;
  border: none;
  background: rgba(0, 0, 0, 0.15);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;

  &:first-child {
    border-radius: 6px 0 0 6px;
  }

  &:last-child {
    border-radius: 0 6px 6px 0;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.3);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
    &:hover {
      background: rgba(0, 0, 0, 0.15);
    }
  }
`;

const PercentBtn = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 30px;
  border: none;
  background: rgba(0, 0, 0, 0.15);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.3);
  }
`;

const Dropdown = styled.ul`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  overflow: hidden;
`;

const DropdownItem = styled.li<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  padding: 8px 16px;
  font-size: 13px;
  color: #1a1a1a;
  cursor: pointer;
  background: ${({ $active }) => ($active ? '#e8f0fe' : 'transparent')};

  &:hover {
    background: ${({ $active }) => ($active ? '#d4e4fc' : '#f5f5f5')};
  }

  &::before {
    content: '${({ $active }) => ($active ? '✓' : '')}';
    width: 20px;
    font-size: 12px;
    color: #4285f4;
  }
`;

/* ─── hook ─────────────────────────────────────────────────────────────── */

export function useZoom(initial = 100) {
  const [zoom, setZoom] = useState(initial);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - STEP));
  }, []);

  const setZoomLevel = useCallback((level: number) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level)));
  }, []);

  return { zoom, zoomIn, zoomOut, setZoomLevel };
}

/* ─── component ────────────────────────────────────────────────────────── */

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (level: number) => void;
  /** Right offset (px) used to position the group. Pages that also render a
   *  CompactButton + FullscreenButton to the right pass a larger value so
   *  the trio doesn't overlap. Defaults to 44 (just-FullscreenButton). */
  rightPx?: number;
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onSetZoom, rightPx = 44 }: ZoomControlsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <Wrapper ref={ref} className="zoom-controls" $right={rightPx}>
      <ZoomBtn
        onClick={(e) => { e.stopPropagation(); onZoomOut(); }}
        disabled={zoom <= MIN_ZOOM}
        title="축소"
      >
        <MinusIcon />
      </ZoomBtn>

      <PercentBtn
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="확대/축소 비율"
      >
        {zoom}%
        {open && (
          <Dropdown onClick={(e) => e.stopPropagation()}>
            {ZOOM_PRESETS.map((p) => (
              <DropdownItem
                key={p}
                $active={p === zoom}
                onClick={() => { onSetZoom(p); setOpen(false); }}
              >
                {p}%
              </DropdownItem>
            ))}
          </Dropdown>
        )}
      </PercentBtn>

      <ZoomBtn
        onClick={(e) => { e.stopPropagation(); onZoomIn(); }}
        disabled={zoom >= MAX_ZOOM}
        title="확대"
      >
        <PlusIcon />
      </ZoomBtn>
    </Wrapper>
  );
}
