/* ─────────────────────────────────────────────────────────────────────────
 * copyStore — 카피하기 곡별 상태(저장 루프·북마크·마지막 설정) localStorage 영속.
 *
 * ASD 처럼 "곡을 다시 열면 루프/북마크가 그대로" 를 목표로 한다.
 * 키: 파일은 `file:이름|바이트수`, 유튜브는 `yt:videoId`.
 * ──────────────────────────────────────────────────────────────────────── */

export interface SavedLoop {
  id: string;
  name: string;
  a: number;
  b: number;
}

export interface SavedBookmark {
  id: string;
  name: string;
  t: number;
}

export interface TrackSettings {
  tempoPct?: number;
  semitones?: number;
  cents?: number;
  eqLow?: number;
  eqHigh?: number;
  mixMode?: string;
  balance?: number;
}

export interface TrackState {
  loops: SavedLoop[];
  bookmarks: SavedBookmark[];
  settings: TrackSettings;
  /** 정리(오래된 곡 삭제)용 */
  updatedAt: number;
}

const LS_KEY = 'jazzify_copy_tracks_v1';
const MAX_TRACKS = 60;

type StoreShape = Record<string, TrackState>;

function readAll(): StoreShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoreShape;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(store: StoreShape) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* 용량 초과 등 — 연습 보조 데이터라 조용히 무시 */
  }
}

export function fileTrackKey(name: string, size: number): string {
  return `file:${name}|${size}`;
}

export function youtubeTrackKey(videoId: string): string {
  return `yt:${videoId}`;
}

export function loadTrackState(key: string): TrackState {
  const s = readAll()[key];
  return s ?? { loops: [], bookmarks: [], settings: {}, updatedAt: 0 };
}

export function saveTrackState(key: string, state: Omit<TrackState, 'updatedAt'>) {
  const store = readAll();
  store[key] = { ...state, updatedAt: Date.now() };
  // 오래된 곡부터 정리해 용량 폭주 방지.
  const keys = Object.keys(store);
  if (keys.length > MAX_TRACKS) {
    keys
      .sort((a, b) => (store[a].updatedAt ?? 0) - (store[b].updatedAt ?? 0))
      .slice(0, keys.length - MAX_TRACKS)
      .forEach((k) => delete store[k]);
  }
  writeAll(store);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
