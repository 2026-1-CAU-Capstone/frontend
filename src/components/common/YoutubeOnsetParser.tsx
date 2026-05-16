import { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import {
  parseYoutubeId,
  saveLickVideoOverride,
  loadLickVideoOverrides,
  type LickVideo,
} from '../../data/lickVideos';
import { loadLicks, invalidateLicksCache } from '../../data/lickData';
import { updateLickVideo, updateLick } from '../../api/licks';

/* ─────────────────────────────────────────────────────────────────────────
 * YouTube Onset Parser — admin-only tool for tagging lick start/end times.
 *
 * Workflow:
 *   1. Paste a YouTube URL (any standard form), Load.
 *   2. Use Space to play/pause, ←/→ to seek ±2s.
 *   3. Pause precisely on the lick boundary, click "시작 기록" / "끝 기록".
 *   4. Type the lick # (display number), click "전송" — fetches backend
 *      licks list, maps display # → publicId, calls PUT /v1/licks/{id}/video.
 *      Also cached in localStorage for immediate frontend use.
 *   5. Click "JSON 복사" to grab all overrides for permanent inclusion in
 *      src/data/lickVideos.ts.
 *
 * Implementation note: uses the YouTube IFrame Player API (loaded once)
 * for programmatic play/pause/seek/getCurrentTime — the embed alone can't
 * do that. The API script is appended to <head> the first time the parser
 * mounts; subsequent mounts reuse the loaded global.
 * ──────────────────────────────────────────────────────────────────────── */

/* ─── YouTube IFrame API loader ────────────────────────────────────────
 *  YT / YTPlayer types come from src/youtube-iframe.d.ts. */

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

/** YouTube oEmbed 로 영상 제목 fetch. CORS-friendly, API 키 불필요.
 *  실패 시 (지역 제한, 비공개 영상 등) null 반환 — caller 가 graceful fallback. */
async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string };
    return json.title?.trim() || null;
  } catch {
    return null;
  }
}

/* ─── component ──────────────────────────────────────────────────────── */

export function YoutubeOnsetParser() {
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [lickNumInput, setLickNumInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'err'>('ok');
  const [overwriteTitle, setOverwriteTitle] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, LickVideo>>(() =>
    loadLickVideoOverrides(),
  );

  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  /* Mount/destroy player whenever videoId changes */
  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let player: YTPlayer | null = null;
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

  const handleSubmit = async () => {
    if (!videoId) return setStatus('영상이 로드되지 않았습니다', 'err');
    if (startSec == null) return setStatus('시작 시간이 없습니다', 'err');
    if (endSec == null) return setStatus('끝 시간이 없습니다', 'err');
    if (endSec <= startSec) return setStatus('끝이 시작보다 빠릅니다', 'err');
    const numStr = lickNumInput.trim();
    if (!numStr) return setStatus('Lick # 번호가 없습니다', 'err');
    const num = parseInt(numStr, 10);
    if (!Number.isFinite(num) || num < 1) return setStatus('유효하지 않은 번호입니다', 'err');

    setSubmitting(true);
    setStatus('백엔드 릭 목록 조회 중…');
    try {
      // 백엔드는 createdAt desc로 정렬되어 옴 → licks[0] = 최신.
      // displayId 규칙: 맨 옛날 = #1, 최신 = #N. licks[i]의 displayId = N - i.
      // 즉 사용자가 입력한 num에 해당하는 배열 인덱스 = N - num.
      const licks = await loadLicks();
      const N = licks.length;
      if (num > N) {
        throw new Error(`#${num} 없음. 현재 총 ${N}개 릭 (#1 ~ #${N})`);
      }
      const idx = N - num;
      const target = licks[idx];
      if (!target || typeof target.id !== 'string') {
        throw new Error(`#${num}의 백엔드 publicId를 찾지 못함`);
      }

      const video = {
        videoId,
        startSec: Number(startSec.toFixed(3)),
        endSec: Number(endSec.toFixed(3)),
        url: urlInput,
      };
      await updateLickVideo(target.id, video);

      // 체크박스가 켜져있으면 영상 제목으로 lick title 도 갱신.
      // oEmbed 실패하거나 제목이 동일하면 skip — 불필요한 PUT 안 보냄.
      let displayTitle = target.title;
      let titleNote = '';
      if (overwriteTitle) {
        const ytTitle = await fetchYoutubeTitle(videoId);
        if (!ytTitle) {
          titleNote = ' · (영상 제목 조회 실패)';
        } else if (ytTitle === target.title) {
          titleNote = ' · (title 동일, skip)';
        } else {
          try {
            await updateLick(target.id, { ...target, title: ytTitle });
            displayTitle = ytTitle;
            titleNote = ` · title="${ytTitle}"`;
          } catch (err) {
            console.warn('title update failed', err);
            titleNote = ' · (title 업데이트 실패)';
          }
        }
      }

      invalidateLicksCache();
      // localStorage에도 즉시 캐시 (재로딩 시 즉시 반영)
      saveLickVideoOverride(target.id, video);
      setOverrides(loadLickVideoOverrides());
      setStatus(
        `✓ 저장됨 — #${num} (${target.performer} — ${displayTitle}) : ${formatTime(startSec)} → ${formatTime(endSec)}${titleNote}`,
      );
    } catch (err) {
      console.error('Submit video failed', err);
      setStatus(err instanceof Error ? err.message : '전송 실패', 'err');
    } finally {
      setSubmitting(false);
    }
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
          type="number"
          min={1}
          value={lickNumInput}
          onChange={(e) => setLickNumInput(e.target.value)}
          placeholder="Lick # (예: 64)"
          style={{ maxWidth: 200 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleSubmit(); }}
          disabled={submitting}
        />
        <BtnPrimary onClick={handleSubmit} disabled={submitting}>
          {submitting ? '전송 중…' : '전송'}
        </BtnPrimary>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={overwriteTitle}
            onChange={(e) => setOverwriteTitle(e.target.checked)}
            disabled={submitting}
          />
          영상 제목으로 곡 title 덮어쓰기
        </label>
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
