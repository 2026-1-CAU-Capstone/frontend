/* RAG 서버(harmorag)가 내려주는 video_url을 anchor href에 넣기 전 검증.
 * react-markdown의 defaultUrlTransform은 마크다운 파이프라인에만 적용되고,
 * 인용 칩/디버그 패널의 일반 <a>는 그 보호를 우회한다 — javascript:/data:
 * 스킴이 코퍼스에 섞여 들어오면 클릭 시 스크립트 실행 여지가 생긴다.
 * http(s)만 허용하고, 실패 시 video_id 기반 youtube watch URL로 폴백. */
export function safeVideoUrl(
  rawUrl: string | undefined | null,
  videoId: string | undefined | null,
  startSec: number,
): string | null {
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') return rawUrl;
    } catch { /* malformed — fall through */ }
  }
  if (videoId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(startSec))}s`;
  }
  return null;
}
