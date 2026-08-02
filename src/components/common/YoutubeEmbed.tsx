import { useEffect, useRef } from 'react';
import styled from 'styled-components';

const EmbedFrame = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 8px 0 4px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;

  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
`;

interface Props {
  videoId: string;
  startSec?: number;
  endSec?: number;
  /** 공통 너비 제한이 필요하면 지정 (px), 없으면 부모 폭 100% */
  maxWidth?: number;
  autoplay?: boolean;
}

/* ─── IFrame Player API loader (singleton) ──────────────────────────
 *  YT / YTPlayer types come from src/youtube-iframe.d.ts. */

let apiReady: Promise<YTNamespace> | null = null;

/** CopyPage(카피하기) 등 다른 화면도 같은 싱글턴 로더를 쓴다. */
export function loadYTApi(): Promise<YTNamespace> {
  if (apiReady) return apiReady;
  apiReady = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return apiReady;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function YoutubeEmbed({ videoId, startSec, endSec, maxWidth, autoplay }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    loadYTApi().then((YT) => {
      if (cancelled || !mountRef.current) return;

      // YT.Player replaces the given element with an <iframe>. Use an inner div
      // so the outer EmbedFrame keeps its absolute-positioned iframe styling.
      const inner = document.createElement('div');
      mountRef.current.appendChild(inner);

      playerRef.current = new YT.Player(inner, {
        videoId,
        playerVars: {
          // start/end here are integer-second fallbacks; we re-seek + JS-pause below for ms precision
          start: startSec ? Math.floor(startSec) : 0,
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (startSec && startSec > 0) e.target.seekTo(startSec, true);
            if (autoplay) e.target.playVideo();
          },
          onStateChange: (e) => {
            const PLAYING = YT.PlayerState.PLAYING;
            cancelAnimationFrame(rafRef.current);
            if (e.data !== PLAYING || !endSec || endSec <= 0) return;

            const tick = () => {
              const p = playerRef.current;
              if (!p) return;
              const t = p.getCurrentTime();
              if (t >= endSec) {
                p.pauseVideo();
                return;
              }
              rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      try { playerRef.current?.destroy(); } catch { /* already destroyed */ }
      playerRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [videoId, startSec, endSec, autoplay]);

  return (
    <EmbedFrame style={maxWidth ? { maxWidth } : undefined}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
    </EmbedFrame>
  );
}
