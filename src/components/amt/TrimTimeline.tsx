import { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { formatTime } from './amtYoutube';

/* ─────────────────────────────────────────────────────────────────────────
 * TrimTimeline — presentational scrub/trim bar shared by the YouTube and
 * audio trimmers. Shows the full clip as a track, shades the selected
 * [start, end] region, draws a playhead, and exposes two draggable in/out
 * handles. Clicking the bare track seeks. All time math is in seconds;
 * the parent owns playback (YT IFrame vs <audio>).
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  duration: number;
  currentTime: number;
  startSec: number | null;
  endSec: number | null;
  onSeek: (sec: number) => void;
  onChangeStart: (sec: number) => void;
  onChangeEnd: (sec: number) => void;
}

export function TrimTimeline({
  duration,
  currentTime,
  startSec,
  endSec,
  onSeek,
  onChangeStart,
  onChangeEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);

  const pct = (sec: number) => (duration > 0 ? Math.min(100, Math.max(0, (sec / duration) * 100)) : 0);

  const secAtClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  /* Global drag listeners attached once; `dragging` ref selects which handle
   * (if any) is live, so there's no add/remove churn or self-referencing
   * cleanup. Re-runs when the clamp bounds/callbacks change. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const which = dragging.current;
      if (!which) return;
      const sec = secAtClientX(e.clientX);
      if (which === 'start') onChangeStart(Math.min(sec, endSec ?? duration));
      else onChangeEnd(Math.max(sec, startSec ?? 0));
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [secAtClientX, onChangeStart, onChangeEnd, startSec, endSec, duration]);

  const beginDrag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    dragging.current = which;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragging.current) return;
    onSeek(secAtClientX(e.clientX));
  };

  const hasStart = startSec != null;
  const hasEnd = endSec != null;
  const regionLeft = hasStart ? pct(startSec) : 0;
  const regionRight = hasEnd ? pct(endSec) : 100;

  return (
    <Wrap>
      <Track ref={trackRef} onClick={handleTrackClick}>
        {/* selected region shading */}
        <Region style={{ left: `${regionLeft}%`, width: `${Math.max(0, regionRight - regionLeft)}%` }} />
        {/* playhead */}
        <Playhead style={{ left: `${pct(currentTime)}%` }} />
        {/* in / out handles */}
        {hasStart && (
          <Handle $side="start" style={{ left: `${regionLeft}%` }} onPointerDown={beginDrag('start')}>
            <HandleFlag>IN</HandleFlag>
          </Handle>
        )}
        {hasEnd && (
          <Handle $side="end" style={{ left: `${regionRight}%` }} onPointerDown={beginDrag('end')}>
            <HandleFlag>OUT</HandleFlag>
          </Handle>
        )}
      </Track>
      <Scale>
        <span>{formatTime(hasStart ? startSec : 0)}</span>
        <span style={{ color: 'inherit', opacity: 0.7 }}>{formatTime(currentTime)}</span>
        <span>{formatTime(hasEnd ? endSec : duration)}</span>
      </Scale>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Track = styled.div`
  position: relative;
  height: 40px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  cursor: pointer;
  overflow: visible;
`;

const Region = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  background: ${({ theme }) => theme.colors.gold}33;
  border-left: 2px solid ${({ theme }) => theme.colors.gold};
  border-right: 2px solid ${({ theme }) => theme.colors.gold};
  pointer-events: none;
`;

const Playhead = styled.div`
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: ${({ theme }) => theme.colors.textPrimary};
  transform: translateX(-1px);
  pointer-events: none;
`;

const Handle = styled.div<{ $side: 'start' | 'end' }>`
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 14px;
  transform: translateX(-7px);
  cursor: ew-resize;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  touch-action: none;
  &::after {
    content: '';
    position: absolute;
    top: 0; bottom: 0;
    left: 50%;
    width: 3px;
    transform: translateX(-50%);
    background: ${({ theme }) => theme.colors.gold};
    border-radius: 2px;
  }
`;

const HandleFlag = styled.span`
  position: absolute;
  top: -16px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: ${({ theme }) => theme.colors.gold};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
`;

const Scale = styled.div`
  display: flex;
  justify-content: space-between;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
