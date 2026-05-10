import type { LickEntry } from '../data/lickData';
import type { NoteSheetData } from '../data/sampleMelody';

const API_BASE = 'https://jazzify.p-e.kr/api';

/* ── API response types ───────────────────────────────────────────────────── */

interface LickResponse {
  publicId: string;
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

function toEntry(r: LickResponse): LickEntry {
  return {
    id: r.publicId,
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
  };
}

/* ── Create (POST) ────────────────────────────────────────────────────────── */

interface CreateLickRequest {
  performer: string;
  title: string;
  album: string | null;
  instrument: string;
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

/**
 * Create a new lick via POST. Returns the persisted entry (with backend
 * publicId as the new id).
 */
export async function createLick(entry: LickEntry): Promise<LickEntry> {
  // 백엔드 harmonicContext는 enum (blues / other / null만 안전). 임의값 보내면 500.
  // 임의 tag 값은 무시하고 null 전송 → 서버가 "other"로 자동 분류.
  const HARMONIC_ENUM = new Set(['blues', 'other', 'major', 'minor']);
  const harmonicContext = entry.tag && HARMONIC_ENUM.has(entry.tag) ? entry.tag : null;

  const body: CreateLickRequest = {
    performer: entry.performer,
    title: entry.title,
    album: entry.album ?? '',
    instrument: entry.instrument,
    style: entry.style || null,
    tempo: entry.tempo,
    key: entry.key,
    rhythmFeel: entry.rhythmfeel || null,
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

  const res = await fetch(`${API_BASE}/v1/licks`, {
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
      detail = j.detail || j.message || '';
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('이미')) throw e;
    }
    throw new Error(`저장 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  return toEntry(json.data);
}

/* ── Update (PUT) ─────────────────────────────────────────────────────────── */

export async function updateLick(publicId: string, entry: LickEntry): Promise<LickEntry> {
  const HARMONIC_ENUM = new Set(['blues', 'other', 'major', 'minor']);
  const harmonicContext = entry.tag && HARMONIC_ENUM.has(entry.tag) ? entry.tag : null;

  const body: CreateLickRequest = {
    performer: entry.performer,
    title: entry.title,
    album: entry.album ?? '',
    instrument: entry.instrument,
    style: entry.style || null,
    tempo: entry.tempo,
    key: entry.key,
    rhythmFeel: entry.rhythmfeel || null,
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

  const res = await fetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json() as { code?: string; message?: string; detail?: string };
      detail = j.detail || j.message || '';
    } catch {/* ignore */}
    throw new Error(`수정 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: LickResponse } = await res.json();
  return toEntry(json.data);
}

/* ── Delete ───────────────────────────────────────────────────────────────── */

export async function deleteLick(publicId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try {
      const j = await res.json() as { message?: string; detail?: string };
      detail = j.detail || j.message || '';
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

  while (!isLast) {
    const res = await fetch(
      `${API_BASE}/v1/licks?page=${page}&size=${PAGE_SIZE}&sort=createdAt,desc`,
    );
    if (!res.ok) throw new Error(`licks API ${res.status}`);
    const json: ApiResponse<LickResponse> = await res.json();
    all.push(...json.data.content.map(toEntry));
    isLast = json.data.last;
    page++;
  }

  return all;
}
