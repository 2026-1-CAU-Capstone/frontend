import { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import {
  parseYoutubeId,
  saveLickVideoOverride,
  loadLickVideoOverrides,
  type LickVideo,
} from '../../data/lickVideos';

/* ─────────────────────────────────────────────────────────────────────────
 * YouTube Onset Parser — admin-only tool for tagging lick start/end times.
 *
 * Workflow:
 *   1. Paste a YouTube URL (any standard form), Load.
 *   2. Use Space to play/pause, ←/→ to seek ±2s.
 *   3. Pause precisely on the lick boundary, click "시작 기록" / "끝 기록".
 *   4. Type the lick id, click "전송" — saved to localStorage so the chat's
 *      YouTube button on that lick uses your custom onset/offset.
 *   5. Click "JSON 복사" to grab all overrides for permanent inclusion in
 *      src/data/lickVideos.ts.
 *
 * Implementation note: uses the YouTube IFrame Player API (loaded once)
 * for programmatic play/pause/seek/getCurrentTime — the embed alone can't
 * do that. The API script is appended to <head> the first time the parser
 * mounts; subsequent mounts reuse the loaded global.
 * ──────────────────────────────────────────────────────────────────────── */

/* ─── YouTube IFrame API loader ──────────────────────────────────────── */

type YtPlayerState = -1 | 0 | 1 | 2 | 3 | 5;

interface YtPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getPlayerState: () => YtPlayerState;
  destroy: () => void;
}

interface YtConstructor {
  new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: (e: { target: YtPlayer }) => void };
    },
  ): YtPlayer;
}

declare global {
  interface Window {
    YT?: { Player: YtConstructor; loaded: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const prevHandler = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevHandler?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/* ─── component ──────────────────────────────────────────────────────── */

export function YoutubeOnsetParser() {
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [lickIdInput, setLickIdInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'err'>('ok');
  const [overrides, setOverrides] = useState<Record<string, LickVideo>>(() =>
    loadLickVideoOverrides(),
  );

  const playerRef = useRef<YtPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  /* Mount/destroy player whenever videoId changes */
  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let player: YtPlayer | null = null;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;
      // Clear container before mounting (prevents stacking on re-loads)
      containerRef.current.innerHTML = '';
      const innerDiv = document.createElement('div');
      containerRef.current.appendChild(innerDiv);

      player = new window.YT.Player(innerDiv, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            try {
              setDuration(e.target.getDuration());
            } catch {
              // duration not yet known — RAF tick will pick it up later
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // already gone
      }
      playerRef.current = null;
    };
  }, [videoId]);

  /* RAF tick: keep currentTime + duration in sync */
  useEffect(() => {
    const tick = () => {
      const p = playerRef.current;
      if (p?.getCurrentTime) {
        try {
          setCurrentTime(p.getCurrentTime());
          const d = p.getDuration();
          if (d > 0 && d !== duration) setDuration(d);
        } catch {
          // player not ready yet
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [duration]);

  /* Keyboard shortcuts: Space = play/pause, ←/→ = seek ±2s */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const p = playerRef.current;
      if (!p) return;

      if (e.code === 'Space') {
        e.preventDefault();
        const state = p.getPlayerState();
        if (state === 1) p.pauseVideo();
        else p.playVideo();
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

  const setStatus = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setStatusMessage(msg);
    setStatusKind(kind);
  };

  const handleLoad = useCallback(() => {
    const id = parseYoutubeId(urlInput);
    if (!id) {
      setStatus('YouTube URL이 아닙니다', 'err');
      return;
    }
    setVideoId(id);
    setStartSec(null);
    setEndSec(null);
    setStatus(`로드됨: ${id}`);
  }, [urlInput]);

  const handleRecordStart = () => {
    setStartSec(currentTime);
    setStatus(`시작 = ${formatTime(currentTime)}`);
  };

  const handleRecordEnd = () => {
    setEndSec(currentTime);
    setStatus(`끝 = ${formatTime(currentTime)}`);
  };

  const handleSubmit = () => {
    if (!videoId) return setStatus('영상이 로드되지 않았습니다', 'err');
    if (startSec == null) return setStatus('시작 시간이 없습니다', 'err');
    if (endSec == null) return setStatus('끝 시간이 없습니다', 'err');
    if (endSec <= startSec) return setStatus('끝이 시작보다 빠릅니다', 'err');
    const id = lickIdInput.trim();
    if (!id) return setStatus('Lick ID가 없습니다', 'err');

    const video: LickVideo = {
      videoId,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      url: urlInput,
    };
    saveLickVideoOverride(id, video);
    setOverrides(loadLickVideoOverrides());
    setStatus(`저장됨 — Lick #${id} : ${formatTime(startSec)} → ${formatTime(endSec)}`);
  };

  const handleExport = async () => {
    const json = JSON.stringify(overrides, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('JSON이 클립보드에 복사되었습니다');
    } catch {
      setStatus('클립보드 접근 실패', 'err');
    }
  };

  const handleClearOverrides = () => {
    if (!confirm('localStorage 오버라이드를 모두 삭제할까요?')) return;
    localStorage.removeItem('lick_videos_overrides');
    setOverrides({});
    setStatus('오버라이드 초기화됨');
  };

  return (
    <Wrap>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.4rem' }}>YouTube Onset Parser</h2>
      <Hint>
        Space: 재생/일시정지 · ←/→: ±2초 · 일시정지한 시점에서 시작/끝을 기록.
      </Hint>

      <Row>
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="YouTube URL 또는 11자 ID"
          onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
        />
        <BtnPrimary onClick={handleLoad}>Load</BtnPrimary>
      </Row>

      {videoId && (
        <PlayerWrap>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </PlayerWrap>
      )}

      <TimeRow>
        <Big>{formatTime(currentTime)}</Big>
        <Sub>/ {formatTime(duration)}</Sub>
      </TimeRow>

      <Row>
        <Btn onClick={handleRecordStart}>
          시작 기록 <Mono>{startSec != null ? formatTime(startSec) : '—'}</Mono>
        </Btn>
        <Btn onClick={handleRecordEnd}>
          끝 기록 <Mono>{endSec != null ? formatTime(endSec) : '—'}</Mono>
        </Btn>
      </Row>

      <Row>
        <Input
          value={lickIdInput}
          onChange={(e) => setLickIdInput(e.target.value)}
          placeholder="Lick ID (예: 2)"
          style={{ maxWidth: 200 }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <BtnPrimary onClick={handleSubmit}>전송</BtnPrimary>
      </Row>

      {statusMessage && (
        <Status $err={statusKind === 'err'}>{statusMessage}</Status>
      )}

      <Section>
        <SectionTitle>저장된 오버라이드</SectionTitle>
        {Object.keys(overrides).length === 0 ? (
          <Empty>없음</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Video</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(overrides).map(([id, v]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td><Mono>{v.videoId}</Mono></td>
                  <td>{formatTime(v.startSec)}</td>
                  <td>{v.endSec != null ? formatTime(v.endSec) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Row style={{ marginTop: 8 }}>
          <Btn onClick={handleExport}>JSON 복사</Btn>
          <Btn onClick={handleClearOverrides}>오버라이드 초기화</Btn>
        </Row>
      </Section>
    </Wrap>
  );
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 880px;
  margin: 0 auto;
  padding: 24px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Hint = styled.div`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-radius: 8px;
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

const Input = styled.input`
  flex: 1;
  min-width: 200px;
  padding: 9px 12px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.92rem;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const Btn = styled.button`
  padding: 9px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.9rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const BtnPrimary = styled(Btn)`
  background: ${({ theme }) => theme.colors.gold};
  color: #fff;
  border-color: ${({ theme }) => theme.colors.gold};
  &:hover {
    background: ${({ theme }) => theme.colors.goldDark};
    border-color: ${({ theme }) => theme.colors.goldDark};
    color: #fff;
  }
`;

const PlayerWrap = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
`;

const TimeRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-radius: 8px;
`;

const Big = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 1.6rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Sub = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.95rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Mono = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.85em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Status = styled.div<{ $err?: boolean }>`
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.88rem;
  background: ${({ $err }) => ($err ? '#fde7e7' : '#e7f5ec')};
  color: ${({ $err }) => ($err ? '#a02323' : '#1f6f3f')};
  border: 1px solid ${({ $err }) => ($err ? '#f3b8b8' : '#b6dbc4')};
`;

const Section = styled.div`
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const SectionTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Empty = styled.div`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 6px 0;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;

  th, td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  }
  th {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;
