import type { LickEntry } from '../data/lickData';
import type { NoteSheetData } from '../data/sampleMelody';
import { authFetch, getAccessToken, tryRefreshAccessToken } from './auth';

const API_BASE = import.meta.env.DEV ? '/api' : 'https://jazzify.p-e.kr/api';

/* ── API response types ───────────────────────────────────────────────────── */

interface LickResponse {
  publicId: string;
  /** 소유자 uuid + 출처. "내 릭"이 백엔드 전체에서 자기 것만 고를 때 쓴다
   *  (GET /v1/licks 에 owner 필터가 없어 클라에서 거른다 — BR-10). */
  userId?: string;
  source?: 'user' | 'weimar' | 'curated' | 'unknown';
  /** 비동기 OMR 진행 상태 — POST /v1/licks/omr 직후엔 PENDING/PROCESSING 셸이
   *  돌아오고, 완성본은 GET /v1/licks/{id} 재조회로 확인한다(릭엔 별도
   *  omr-status 엔드포인트가 없음). 일반 생성 릭에는 없을 수 있어 optional. */
  omrStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string | null;
  omrProgress?: number | null;
  omrFailureReason?: string | null;
  performer: string;
  title: string;
  album: string | null;
  instrument: string;
  style: string | null;
  tempo: number | null;
  key: string;
  rhythmFeel: string | null;
  timeSignature: string;
  chords: string[] | null;
  harmonicContext: string | null;
  sheetData: NoteSheetData;
  nEvents: number;
  intervals: number[] | null;
  parsons: number[] | null;
  fuzzyIntervals: number[] | null;
  durationClasses: number[] | null;
  video?: {
    videoId: string;
    startSec: number;
    endSec?: number | null;
    url?: string | null;
  } | null;
}

interface PageData<T> {
  content: T[];
  totalPages: number;
  last: boolean;
}

interface ApiResponse<T> {
  data: PageData<T>;
}

/* ── Mapper ───────────────────────────────────────────────────────────────── */

/** LickResponse → LickEntry. Exported so static fallback loaders (e.g.
 *  loadBackupLicks reading public/data/licks/backend_backup_licks.json) can
 *  reuse the same mapping. */
export function toLickEntry(r: LickResponse): LickEntry {
  return {
    id: r.publicId,
    // "내 릭" 필터용 — 소유자/출처를 그대로 실어 보낸다 (loadMyLicks 참조).
    ...(r.userId ? { userId: r.userId } : {}),
    ...(r.source ? { source: r.source } : {}),
    performer: r.performer,
    title: r.title,
    album: r.album ?? undefined,
    instrument: r.instrument,
    style: r.style ?? '',
    tempo: r.tempo,
    key: r.key,
    rhythmfeel: r.rhythmFeel ?? '',
    tag: r.harmonicContext ?? '',
    chords: r.chords ?? [],
    nEvents: r.nEvents,
    label: `${r.performer} — ${r.title}`,
    sheetData: r.sheetData,
    intervals: r.intervals ?? [],
    parsons: r.parsons ?? [],
    fuzzyIntervals: r.fuzzyIntervals ?? [],
    durationClasses: r.durationClasses ?? [],
    ...(r.video
      ? {
          video: {
            videoId: r.video.videoId,
            startSec: r.video.startSec,
            ...(r.video.endSec != null ? { endSec: r.video.endSec } : {}),
            ...(r.video.url ? { url: r.video.url } : {}),
          },
        }
      : {}),
  };
}

/* ── Create (POST) ────────────────────────────────────────────────────────── */

interface CreateLickRequest {
  performer: string;
  title: string;
  album: string | null;
  /* 백엔드 enum(as/ts/tp/p/g/b/voc/cl/unknown). 매칭 안 되면 null 로 보내
   * 서버 기본값에 맡긴다 — 빈 문자열은 enum 위반이라 400 이 난다. */
  instrument: string | null;
  style: string | null;
  tempo: number | null;
  key: string;
  rhythmFeel: string | null;
  timeSignature: string;
  chords: string[];
  harmonicContext: string | null;
  sheetData: NoteSheetData;
  nEvents: number;
  intervals: number[];
  parsons: number[];
  fuzzyIntervals: number[];
  durationClasses: number[];
}

/* ── 백엔드 enum 정규화 ─────────────────────────────────────────────
 *
 * LickCreateRequest 의 style/instrument/rhythmFeel/harmonicContext 는 서버에서
 * enum 으로 검증된다. 프론트 값은 자유 문자열이라(에디터의 장르 메뉴는
 * "Medium Swing"·"Bossa Nova" 같은 표시용 라벨) 그대로 보내면 400
 * "잘못된 입력값입니다" 로 튕긴다. 매칭되지 않으면 null 로 보내 서버 기본값에
 * 맡긴다 — 저장 자체가 실패하는 것보다 낫다. (스펙: GET /v3/api-docs) */
const STYLE_ENUM = new Set(['SWING', 'BEBOP', 'HARDBOP', 'COOL', 'MODAL', 'FUSION']);
const INSTRUMENT_ENUM = new Set(['as', 'ts', 'tp', 'p', 'g', 'b', 'voc', 'cl', 'unknown']);
const RHYTHM_ENUM = new Set(['SWING', 'STRAIGHT', 'BOSSA', 'LATIN']);
const HARMONIC_ENUM = new Set(['ii-V-I', 'minor-ii-V', 'blues', 'modal', 'turnaround', 'other']);

/** 에디터 장르 라벨("Medium Swing" 등) → 백엔드 style enum. 못 맞추면 null. */
function toStyleEnum(v?: string | null): string | null {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  if (STYLE_ENUM.has(u)) return u;
  if (u.includes('BEBOP')) return 'BEBOP';
  if (u.includes('HARD')) return 'HARDBOP';
  if (u.includes('COOL')) return 'COOL';
  if (u.includes('MODAL')) return 'MODAL';
  if (u.includes('FUSION') || u.includes('FUNK')) return 'FUSION';
  if (u.includes('SWING') || u.includes('BALLAD') || u.includes('SHUFFLE')) return 'SWING';
  return null;
}

/** 장르 라벨 → rhythmFeel enum. 라틴 계열은 BOSSA/LATIN, 나머지는 SWING. */
function toRhythmEnum(rhythm?: string | null, style?: string | null): string | null {
  const src = (rhythm || style || '').trim().toUpperCase();
  if (!src) return null;
  if (RHYTHM_ENUM.has(src)) return src;
  if (src.includes('BOSSA')) return 'BOSSA';
  if (src.includes('SAMBA') || src.includes('LATIN') || src.includes('CHA') || src.includes('AFRO')) return 'LATIN';
  if (src.includes('STRAIGHT')) return 'STRAIGHT';
  if (src.includes('SWING') || src.includes('BEBOP') || src.includes('BALLAD')) return 'SWING';
  return null;
}

function toInstrumentEnum(v?: string | null): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (INSTRUMENT_ENUM.has(s)) return s;
  const MAP: Record<string, string> = {
    sax: 'as', alto: 'as', 'alto sax': 'as', tenor: 'ts', 'tenor sax': 'ts',
    trumpet: 'tp', piano: 'p', guitar: 'g', bass: 'b', vocal: 'voc', voice: 'voc', clarinet: 'cl',
  };
  return MAP[s] ?? null;
}

/**
 * Create a new lick via POST. Returns the persisted entry (with backend
 * publicId as the new id).
 */
export async function createLick(entry: LickEntry): Promise<LickEntry> {
  const harmonicContext = entry.tag && HARMONIC_ENUM.has(entry.tag) ? entry.tag : null;

  const body: CreateLickRequest = {
    performer: entry.performer,
    title: entry.title,
    album: entry.album ?? '',
    instrument: toInstrumentEnum(entry.instrument),
    style: toStyleEnum(entry.style),
    tempo: entry.tempo,
    key: entry.key,
    rhythmFeel: toRhythmEnum(entry.rhythmfeel, entry.style),
    timeSignature: entry.sheetData.timeSignature || '4/4',
    chords: entry.chords.filter((c) => c.length > 0), // 빈 문자열 제거 (백엔드 검증)
    harmonicContext,
    sheetData: entry.sheetData,
    nEvents: entry.nEvents,
    intervals: entry.intervals,
    parsons: entry.parsons,
    fuzzyIntervals: entry.fuzzyIntervals,
    durationClasses: entry.durationClasses,
  };

  const res = await authFetch(`${API_BASE}/v1/licks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json() as { code?: string; message?: string; detail?: string };
      if (res.status === 409 || j.code === 'LICK_002') {
        throw new Error('이미 같은 제목과 연주자의 릭이 등록되어 있습니다.');
      }
      if (import.meta.env.DEV && j.detail) console.debug('[api] detail:', j.detail);
      detail = j.message || '';
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('이미')) throw e;
    }
    throw new Error(`저장 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  return toLickEntry(json.data);
}

/* ── Update (PUT) ─────────────────────────────────────────────────────────── */

export async function updateLick(publicId: string, entry: LickEntry): Promise<LickEntry> {
  // enum 정규화는 createLick 과 동일 규칙 (백엔드 검증에 400 나지 않도록).
  const harmonicContext = entry.tag && HARMONIC_ENUM.has(entry.tag) ? entry.tag : null;

  const body: CreateLickRequest = {
    performer: entry.performer,
    title: entry.title,
    album: entry.album ?? '',
    instrument: toInstrumentEnum(entry.instrument),
    style: toStyleEnum(entry.style),
    tempo: entry.tempo,
    key: entry.key,
    rhythmFeel: toRhythmEnum(entry.rhythmfeel, entry.style),
    timeSignature: entry.sheetData.timeSignature || '4/4',
    chords: entry.chords.filter((c) => c.length > 0),
    harmonicContext,
    sheetData: entry.sheetData,
    nEvents: entry.nEvents,
    intervals: entry.intervals,
    parsons: entry.parsons,
    fuzzyIntervals: entry.fuzzyIntervals,
    durationClasses: entry.durationClasses,
  };

  const res = await authFetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json() as { code?: string; message?: string; detail?: string };
      if (import.meta.env.DEV && j.detail) console.debug('[api] detail:', j.detail);
      detail = j.message || '';
    } catch {/* ignore */}
    throw new Error(`수정 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  return toLickEntry(json.data);
}

/* ── Update video (PUT /licks/{id}/video) ────────────────────────────────── */

export interface LickVideoPayload {
  videoId: string;
  startSec: number;
  endSec: number;
  url: string;
}

export async function updateLickVideo(publicId: string, video: LickVideoPayload): Promise<void> {
  const res = await authFetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}/video`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(video),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json() as { code?: string; message?: string; detail?: string };
      if (import.meta.env.DEV && j.detail) console.debug('[api] detail:', j.detail);
      detail = j.message || '';
    } catch {/* ignore */}
    throw new Error(`Video 저장 실패 (${res.status}) ${detail}`.trim());
  }
}

/* ── OMR — sheet image → Lick ─────────────────────────────────────────────── */

export interface OMRMetadata {
  title?: string;
  performer?: string;
  /** 백엔드 SoloOmrRequest 가 받는 작곡자 필드 (대량 큐 업로드의 'candidate' 표시에 사용). */
  composer?: string;
  album?: string;
  source?: 'user' | 'weimar' | 'curated';
  instrument?: string;
  style?: string;
  tempo?: number;
  key?: string;
  rhythmFeel?: 'SWING' | 'STRAIGHT' | 'BOSSA' | 'LATIN';
  userId?: string;
}

/** GET /v1/licks/{publicId} — 단건 조회 (비동기 OMR 완성 확인용). */
export async function getLickRaw(publicId: string): Promise<LickResponse> {
  const res = await authFetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json() as { message?: string };
      detail = j.message || '';
    } catch { /* ignore */ }
    throw new Error(`릭 조회 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  return json.data;
}

/* 비동기 OMR 폴링 파라미터 — OMR은 수십 초 걸리므로 4초 간격, 최대 3분. */
const LICK_OMR_POLL_INTERVAL_MS = 4_000;
const LICK_OMR_POLL_MAX_MS = 3 * 60_000;

/** POST /v1/licks/omr — upload a sheet PNG/JPG/JPEG.
 *
 *  백엔드가 OMR을 비동기로 전환함: POST 는 즉시 201 + `omrStatus:"PROCESSING"`
 *  셸(빈 sheetData)을 반환하고, 완성본은 릭 재조회로 확인해야 한다(릭엔
 *  omr-status 엔드포인트가 없어 GET /v1/licks/{id} 의 omrStatus 를 본다).
 *  이 함수가 내부에서 완료까지 폴링하므로 호출부(OMRUploadModal 등) 계약은
 *  기존 동기 시절 그대로 — resolve 시점에 완성된 LickEntry 를 준다.
 *  FAILED → omrFailureReason 으로 throw, 타임아웃(3분) → throw. */
export async function createLickViaOMR(file: File, metadata: OMRMetadata = {}): Promise<LickEntry> {
  const form = new FormData();
  form.append('file', file);
  // Backend expects metadata as a single JSON-encoded part named "metadata".
  // Empty object is fine; backend treats every field as optional.
  const metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
  form.append('metadata', metaBlob);

  const res = await authFetch(`${API_BASE}/v1/licks/omr`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    let code = '';
    try {
      const j = await res.json() as { message?: string; detail?: string; code?: string };
      if (import.meta.env.DEV && j.detail) console.debug('[api] detail:', j.detail);
      detail = j.message || '';
      code = j.code || '';
    } catch { /* ignore */ }
    throw new Error(`OMR 실패 (${res.status}${code ? ' · ' + code : ''}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  const shell = json.data;

  // 과거 동기 계약(omrStatus 없음) 또는 즉시 완료 → 그대로 반환.
  if (!shell.omrStatus || shell.omrStatus === 'COMPLETED') return toLickEntry(shell);
  if (shell.omrStatus === 'FAILED') {
    throw new Error(shell.omrFailureReason || '악보 인식(OMR)에 실패했습니다.');
  }

  // PENDING/PROCESSING → 완료까지 재조회 폴링.
  const startedAt = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, LICK_OMR_POLL_INTERVAL_MS));
    let cur: LickResponse;
    try {
      cur = await getLickRaw(shell.publicId);
    } catch (e) {
      // 인증 만료(401/403)는 더 기다려도 영원히 실패 — 즉시 중단.
      const msg = e instanceof Error ? e.message : '';
      if (/\b401\b|\b403\b/.test(msg)) throw e;
      cur = shell; // 일시 오류 — 다음 틱에 재시도
    }
    if (cur.omrStatus === 'COMPLETED') return toLickEntry(cur);
    if (cur.omrStatus === 'FAILED') {
      throw new Error(cur.omrFailureReason || '악보 인식(OMR)에 실패했습니다.');
    }
    if (Date.now() - startedAt > LICK_OMR_POLL_MAX_MS) {
      throw new Error('악보 인식이 시간 내에 끝나지 않았습니다(서버 지연). 잠시 후 다시 시도해 주세요.');
    }
  }
}

/* ── Delete ───────────────────────────────────────────────────────────────── */

export async function deleteLick(publicId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try {
      const j = await res.json() as { message?: string; detail?: string };
      if (import.meta.env.DEV && j.detail) console.debug('[api] detail:', j.detail);
      detail = j.message || '';
    } catch {/* ignore */}
    throw new Error(`삭제 실패 (${res.status}) ${detail}`.trim());
  }
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

export async function fetchAllLicks(): Promise<LickEntry[]> {
  const PAGE_SIZE = 200;
  const all: LickEntry[] = [];
  let page = 0;
  let isLast = false;

  // GET /v1/licks requires auth (401 unauthenticated). Attach the Bearer token
  // if we have one (soft auth) — but DON'T use authFetch here: this is a
  // background pool load, and authFetch's refresh-then-redirect-to-/login on
  // failure would be disruptive. On 401 we just throw so the caller can fall
  // back to the bundled backup snapshot.
  let token = getAccessToken();
  let triedRefresh = false;
  while (!isLast) {
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(
      `${API_BASE}/v1/licks?page=${page}&size=${PAGE_SIZE}&sort=createdAt,desc`,
      { headers: authHeader, credentials: 'include' },
    );
    // access token 만료 직후(refresh 쿠키는 유효) 백그라운드 로드가 통째로
    // 백업 스냅샷에 폴백되던 케이스 — redirect 없는 soft refresh 1회만 시도.
    if (res.status === 401 && !triedRefresh) {
      triedRefresh = true;
      const fresh = await tryRefreshAccessToken();
      if (fresh) { token = fresh; continue; }
    }
    if (!res.ok) throw new Error(`licks API ${res.status}`);
    const json: ApiResponse<LickResponse> = await res.json();
    all.push(...json.data.content.map(toLickEntry));
    isLast = json.data.last;
    page++;
  }

  // 1-based human-facing number — the real id is a UUID. Order = createdAt desc.
  all.forEach((e, i) => { e.displayNumber = i + 1; });
  return all;
}
