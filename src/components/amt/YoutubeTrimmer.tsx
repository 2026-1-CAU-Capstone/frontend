import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { loadYouTubeApi, formatTime } from './amtYoutube';
import { TrimTimeline } from './TrimTimeline';

/* ─────────────────────────────────────────────────────────────────────────
 * YoutubeTrimmer — embeds a YouTube video via the IFrame Player API and lets
 * the user set precise in/out points (a "trim") for the AMT clip. YouTube's
 * ToS/CORS make client-side download+cut impossible, so "trim" here means
 * capturing [startSec, endSec]; the actual cut happens server-side when the
 * clip is sent to the model. Reports the current selection to the parent via
 * onTrimChange.
 *
 * Controls: Space = play/pause, ←/→ = seek ±2s (matches YoutubeOnsetParser),
 * IN/OUT buttons record the current time, 구간 반복 loops the selection.
 * ──────────────────────────────────────────────────────────────────────── */

export interface TrimState {
  startSec: number | null;
  endSec: number | null;
  duration: number;
}

interface Props {
  videoId: string;
  onTrimChange: (t: TrimState) => void;
}

export function YoutubeTrimmer({ videoId, onTrimChange }: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  // RAF reads live state via refs (the tick closure is created once). Refs are
  // synced in an effect — writing them during render is disallowed.
  const loopRef = useRef(loop);
  const startRef = useRef(startSec);
  const endRef = useRef(endSec);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { startRef.current = startSec; }, [startSec]);
  useEffect(() => { endRef.current = endSec; }, [endSec]);

  /* Notify parent whenever the selection changes. */
  useEffect(() => {
    onTrimChange({ startSec, endSec, duration });
  }, [startSec, endSec, duration, onTrimChange]);

  /* Mount/destroy the player when videoId changes. */
  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let player: YTPlayer | null = null;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;
      containerRef.current.innerHTML = '';
      const innerDiv = document.createElement('div');
      containerRef.current.appendChild(innerDiv);
      player = new window.YT.Player(innerDiv, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            try { setDuration(e.target.getDuration()); } catch { /* not ready */ }
          },
          onStateChange: (e) => setPlaying(e.data === 1),
        },
      });
    });

    return () => {
      cancelled = true;
      try { player?.destroy(); } catch { /* gone */ }
      playerRef.current = null;
    };
  }, [videoId]);

  /* RAF: sync time/duration + enforce loop within the selection. */
  useEffect(() => {
    const tick = () => {
      const p = playerRef.current;
      if (p?.getCurrentTime) {
        try {
          const t = p.getCurrentTime();
          setCurrentTime(t);
          const d = p.getDuration();
          if (d > 0) setDuration((prev) => (prev !== d ? d : prev));
          // Loop the trimmed region during preview.
          const s = startRef.current, e = endRef.current;
          if (loopRef.current && s != null && e != null && t >= e) {
            p.seekTo(s, true);
          }
        } catch { /* not ready */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* Keyboard: Space play/pause, ←/→ ±2s. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const p = playerRef.current;
      if (!p) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        p.seekTo(Math.max(0, p.getCurrentTime() - 2), true);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        p.seekTo(p.getCurrentTime() + 2, true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const seek = (sec: number) => { playerRef.current?.seekTo(sec, true); setCurrentTime(sec); };
  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
  };
  const playRegion = () => {
    const p = playerRef.current;
    if (!p || startSec == null) return;
    p.seekTo(startSec, true);
    p.playVideo();
    setLoop(true);
  };

  const trimmed = startSec != null && endSec != null && endSec > startSec;

  return (
    <Wrap>
      <PlayerBox>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </PlayerBox>

      <TrimTimeline
        duration={duration}
        currentTime={currentTime}
        startSec={startSec}
        endSec={endSec}
        onSeek={seek}
        onChangeStart={setStartSec}
        onChangeEnd={setEndSec}
      />

      <Controls>
        <Btn onClick={togglePlay}>{playing ? '❚❚ 일시정지' : '▶ 재생'}</Btn>
        <Btn onClick={() => seek(Math.max(0, currentTime - 2))}>← 2초</Btn>
        <Btn onClick={() => seek(currentTime + 2)}>2초 →</Btn>
        <Divider />
        <Btn onClick={() => setStartSec(currentTime)}>
          IN 기록 <Mono>{startSec != null ? formatTime(startSec) : '—'}</Mono>
        </Btn>
        <Btn onClick={() => setEndSec(currentTime)}>
          OUT 기록 <Mono>{endSec != null ? formatTime(endSec) : '—'}</Mono>
        </Btn>
        <Divider />
        <Btn onClick={playRegion} disabled={!trimmed}>구간 재생</Btn>
        <Btn $active={loop} onClick={() => setLoop((v) => !v)}>🔁 반복 {loop ? 'ON' : 'OFF'}</Btn>
      </Controls>

      <Summary>
        {trimmed
          ? <>선택 구간 <b>{formatTime(startSec!)} → {formatTime(endSec!)}</b> · 길이 <b>{formatTime(endSec! - startSec!)}</b></>
          : <span style={{ opacity: 0.7 }}>영상을 재생하며 IN / OUT 지점을 기록하거나, 타임라인의 핸들을 드래그해 정확히 맞추세요.</span>}
      </Summary>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const PlayerBox = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
`;

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const Btn = styled.button<{ $active?: boolean }>`
  padding: 8px 12px;
  border: 1.5px solid ${({ $active, theme }) => ($active ? theme.colors.gold : theme.colors.border)};
  border-radius: 8px;
  background: ${({ $active, theme }) => ($active ? theme.colors.gold + '22' : theme.colors.bgPrimary)};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.86rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.gold}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const Divider = styled.span`
  width: 1px;
  align-self: stretch;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 2px;
`;

const Mono = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.8em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Summary = styled.div`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  b { color: ${({ theme }) => theme.colors.gold}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
`;
