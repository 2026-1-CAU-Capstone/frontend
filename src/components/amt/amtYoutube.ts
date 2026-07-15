/* AMT 전용 YouTube 헬퍼 — YoutubeOnsetParser 와 동일한 IFrame Player API
 * 로딩/oEmbed 제목 조회 패턴을 독립적으로 재현한다 (기존 파서를 리팩터링하지
 * 않고 AMT 페이지가 자체적으로 쓰기 위함). YT / YTPlayer 타입은
 * src/youtube-iframe.d.ts 전역 선언에서 온다. */

let ytApiPromise: Promise<void> | null = null;

/** YouTube IFrame Player API 스크립트를 <head> 에 1회 주입하고 준비되면 resolve.
 *  이미 로드돼 있으면 즉시 resolve. play/pause/seek/getCurrentTime 같은 프로그램
 *  제어를 하려면 단순 embed 가 아니라 이 API 가 필요하다. */
export function loadYouTubeApi(): Promise<void> {
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

/** YouTube oEmbed 로 영상 제목 fetch. CORS-friendly, API 키 불필요.
 *  실패 시 (지역 제한, 비공개 영상 등) null 반환. */
export async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
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

/** 초 → `m:ss.mmm` 표기. 트림 마커 표시에 사용. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
