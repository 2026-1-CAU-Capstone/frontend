/**
 * 릭 ID → 원본 영상 매핑.
 *
 * The built-in registry below holds entries that ship with the codebase.
 * Admin users can record additional / override entries via the YouTube
 * onset parser at /admin; those overrides live in localStorage and are
 * merged on lookup. Use `getLickVideo(id)` rather than `LICK_VIDEOS[id]`
 * directly so callers always see the merged result.
 *
 * Key: lick id (frontend = number, backend = publicId string).
 */

export interface LickVideo {
  videoId: string;       // YouTube video id (e.g. "MV8wWjVqCng")
  startSec: number;      // start time in seconds (may include fractional ms)
  endSec?: number;       // optional end time — if set, YouTube stops here
  url?: string;          // original input URL, kept for debugging
}

/** Hardcoded entries shipped with the codebase. */
export const LICK_VIDEOS: Record<string | number, LickVideo> = {
  // Rusty Bryant — That Old Black Magic (lick id 2) → 2:17
  2: { videoId: 'MV8wWjVqCng', startSec: 137 },
};

const LS_OVERRIDES_KEY = 'lick_videos_overrides';

/** Read all admin-recorded overrides from localStorage. */
export function loadLickVideoOverrides(): Record<string, LickVideo> {
  try {
    const raw = localStorage.getItem(LS_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LickVideo>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist a single lick → video mapping (admin tool). */
export function saveLickVideoOverride(id: string | number, video: LickVideo): void {
  const current = loadLickVideoOverrides();
  current[String(id)] = video;
  try {
    localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn('[lickVideos] failed to persist override:', err);
  }
}

/** Look up a lick's video, with localStorage overrides taking precedence. */
export function getLickVideo(id: number | string): LickVideo | undefined {
  const overrides = loadLickVideoOverrides();
  return overrides[String(id)] ?? LICK_VIDEOS[id];
}

/**
 * Pull a YouTube video ID out of a URL or a bare ID string. Supports the
 * standard watch URL, youtu.be short URL, /embed/ form, and a raw 11-char
 * ID. Returns null if no plausible ID is found.
 */
export function parseYoutubeId(input: string): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;

  const watchMatch = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  const shortMatch = s.match(/(?:youtu\.be\/|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  return null;
}
