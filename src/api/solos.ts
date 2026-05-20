/**
 * Solo CRUD API client.
 *
 * Mirrors src/api/licks.ts shape but matches the backend Solo schema:
 *   - 'source' (user|weimar|curated) + 'instrument' are REQUIRED
 *   - 'style' / 'rhythmFeel' / 'harmonicContext' are enums (must be exact strings)
 *   - 'key' uses Weimar format ("Bb-maj" / "C-min") — see toWeimarKey() helper
 *   - 'features' can be null → backend computes from sheetData
 *   - 'chords' / 'chordsPerNote' optional → backend derives from sheetData
 *
 * Endpoints:
 *   POST   /v1/solos                — create
 *   GET    /v1/solos                — list (paginated)
 *   GET    /v1/solos/{publicId}     — one
 *   PUT    /v1/solos/{publicId}     — update
 *   DELETE /v1/solos/{publicId}     — delete
 *   PUT    /v1/solos/{publicId}/video   — set/replace video
 *   DELETE /v1/solos/{publicId}/video   — unlink video
 */

import type { NoteSheetData } from '../data/sampleMelody';

const API_BASE = 'https://jazzify.p-e.kr/api';

/* ── enums ─────────────────────────────────────────────────────────────────── */

export type SoloSource = 'user' | 'weimar' | 'curated';
export type SoloInstrument = 'as' | 'ts' | 'tp' | 'p' | 'g' | 'b' | 'voc' | 'cl';
export type SoloStyle = 'SWING' | 'BEBOP' | 'HARDBOP' | 'COOL' | 'MODAL' | 'FUSION';
export type SoloRhythmFeel = 'SWING' | 'STRAIGHT' | 'BOSSA' | 'LATIN';
export type SoloHarmonicContext = 'ii-V-I' | 'minor-ii-V' | 'blues' | 'modal' | 'turnaround' | 'other';

const INSTRUMENT_SET = new Set<SoloInstrument>(['as', 'ts', 'tp', 'p', 'g', 'b', 'voc', 'cl']);
const STYLE_SET = new Set<SoloStyle>(['SWING', 'BEBOP', 'HARDBOP', 'COOL', 'MODAL', 'FUSION']);
const RHYTHM_FEEL_SET = new Set<SoloRhythmFeel>(['SWING', 'STRAIGHT', 'BOSSA', 'LATIN']);
const HARMONIC_SET = new Set<SoloHarmonicContext>([
  'ii-V-I', 'minor-ii-V', 'blues', 'modal', 'turnaround', 'other',
]);

/* ── types ─────────────────────────────────────────────────────────────────── */

export interface SoloVideo {
  videoId: string;
  startSec: number;
  endSec?: number | null;
  url?: string | null;
}

/** Server response — what GET / POST / PUT all return. */
export interface SoloResponse {
  publicId: string;
  source: SoloSource;
  userId?: string | null;
  sourceUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  performer?: string | null;
  title: string;
  album?: string | null;
  instrument: SoloInstrument;
  style?: SoloStyle | null;
  tempo?: number | null;
  key?: string | null;
  rhythmFeel?: SoloRhythmFeel | null;
  timeSignature?: string | null;
  chords?: string[] | null;
  chordsPerNote?: string[] | null;
  harmonicContext?: SoloHarmonicContext | null;
  targetChord?: string | null;
  sheetData: NoteSheetData;
  nEvents?: number | null;
  pitches?: number[] | null;
  intervals?: number[] | null;
  parsons?: number[] | null;
  fuzzyIntervals?: number[] | null;
  durationClasses?: number[] | null;
  pitchMin?: number | null;
  pitchMax?: number | null;
  pitchRange?: number | null;
  pitchMean?: number | null;
  startPitch?: number | null;
  endPitch?: number | null;
  video?: SoloVideo | null;
}

/** Frontend-side draft used to construct a POST/PUT body. Most fields optional;
 *  the backend computes whatever we omit from sheetData. */
export interface SoloDraft {
  source: SoloSource;                  // REQUIRED
  title: string;                        // REQUIRED
  instrument: SoloInstrument;           // REQUIRED
  sheetData: NoteSheetData;             // REQUIRED
  userId?: string | null;
  sourceUrl?: string | null;
  performer?: string;
  album?: string;
  style?: SoloStyle;
  tempo?: number | null;
  /** Plain key like "C", "Bbm", "F#" — converted to Weimar inside createSolo. */
  key?: string;
  rhythmFeel?: SoloRhythmFeel;
  timeSignature?: string;
  chords?: string[];
  chordsPerNote?: string[];
  harmonicContext?: SoloHarmonicContext;
  targetChord?: string;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/**
 * Convert frontend key strings ("C", "Bb", "F#m", "Cm") to Weimar format
 * ("C-maj", "Bb-maj", "F#-min", "C-min"). Returns undefined on empty input.
 */
export function toWeimarKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  // Already in Weimar form?
  if (/-(maj|min)$/i.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    return lower.endsWith('-maj') ? `${trimmed.slice(0, -4)}-maj` : `${trimmed.slice(0, -4)}-min`;
  }
  const isMinor = /m$/i.test(trimmed) && !/^[A-G][b#]?$/.test(trimmed);
  const root = isMinor ? trimmed.slice(0, -1) : trimmed;
  return `${root}-${isMinor ? 'min' : 'maj'}`;
}

/** Inverse of toWeimarKey — for display in the editor. */
export function fromWeimarKey(weimar: string | undefined | null): string {
  if (!weimar) return 'C';
  const m = weimar.match(/^([A-G][b#]?)-(maj|min)$/i);
  if (!m) return weimar;
  return m[2].toLowerCase() === 'min' ? `${m[1]}m` : m[1];
}

function enumOrUndefined<T>(value: unknown, set: Set<T>): T | undefined {
  return typeof value === 'string' && set.has(value as T) ? (value as T) : undefined;
}

/** Build the POST/PUT request body from a draft. Drops undefined fields so the
 *  backend's auto-derivation kicks in for harmonic + features. */
function buildBody(draft: SoloDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    source: draft.source,
    title: draft.title || 'Untitled',
    instrument: enumOrUndefined(draft.instrument, INSTRUMENT_SET) ?? 'p',
    sheetData: draft.sheetData,
    // features=null → backend computes from sheetData
    features: null,
  };
  if (draft.userId != null) body.userId = draft.userId;
  if (draft.sourceUrl) body.sourceUrl = draft.sourceUrl;
  if (draft.performer) body.performer = draft.performer;
  if (draft.album) body.album = draft.album;
  const style = enumOrUndefined(draft.style, STYLE_SET);
  if (style) body.style = style;
  if (draft.tempo != null && Number.isFinite(draft.tempo)) body.tempo = draft.tempo;
  const weimarKey = toWeimarKey(draft.key);
  if (weimarKey) body.key = weimarKey;
  const rhythm = enumOrUndefined(draft.rhythmFeel, RHYTHM_FEEL_SET);
  if (rhythm) body.rhythmFeel = rhythm;
  if (draft.timeSignature) body.timeSignature = draft.timeSignature;
  if (draft.chords && draft.chords.length > 0) {
    body.chords = draft.chords.filter((c) => c.length > 0);
  }
  if (draft.chordsPerNote && draft.chordsPerNote.length > 0) body.chordsPerNote = draft.chordsPerNote;
  const harmonic = enumOrUndefined(draft.harmonicContext, HARMONIC_SET);
  if (harmonic) body.harmonicContext = harmonic;
  if (draft.targetChord) body.targetChord = draft.targetChord;
  return body;
}

async function readApiError(res: Response): Promise<string> {
  try {
    const j = await res.json() as { code?: string; message?: string; detail?: string };
    return j.detail || j.message || j.code || '';
  } catch {
    return '';
  }
}

/* ── Create / Update ───────────────────────────────────────────────────────── */

export async function createSolo(draft: SoloDraft): Promise<SoloResponse> {
  const res = await fetch(`${API_BASE}/v1/solos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(draft)),
  });
  if (!res.ok) {
    const detail = await readApiError(res);
    throw new Error(`Solo 저장 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: SoloResponse } = await res.json();
  return json.data;
}

export async function updateSolo(publicId: string, draft: SoloDraft): Promise<SoloResponse> {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(draft)),
  });
  if (!res.ok) {
    const detail = await readApiError(res);
    throw new Error(`Solo 수정 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: SoloResponse } = await res.json();
  return json.data;
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

export async function getSolo(publicId: string): Promise<SoloResponse> {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    const detail = await readApiError(res);
    throw new Error(`Solo 조회 실패 (${res.status}) ${detail}`.trim());
  }
  const json: { data: SoloResponse } = await res.json();
  return json.data;
}

interface SoloPage {
  content: SoloResponse[];
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  size: number;
  number: number;
}

/** Fetch a single page. Use fetchAllSolos() for full pagination.
 *  `performer` is best-effort: passed as a query param; backend filters when
 *  supported, otherwise ignored (caller should also filter client-side). */
export async function listSolos(opts: {
  page?: number;
  size?: number;
  sort?: string;
  performer?: string;
} = {}): Promise<SoloPage> {
  const params = new URLSearchParams();
  params.set('page', String(opts.page ?? 0));
  params.set('size', String(opts.size ?? 50));
  params.set('sort', opts.sort ?? 'createdAt,desc');
  if (opts.performer) params.set('performer', opts.performer);
  const res = await fetch(`${API_BASE}/v1/solos?${params.toString()}`);
  if (!res.ok) throw new Error(`solos list ${res.status}`);
  const json: { data: SoloPage } = await res.json();
  return json.data;
}

/** A performer/composer facet: name + how many solos belong to it. */
export interface SoloFacet {
  name: string;
  count: number;
}

/** Distinct performers with solo counts. Optionally narrowed to one composer.
 *  Backed by GET /v1/solos/performers — accurate across the whole catalog
 *  (unlike deriving from a single listSolos page). */
export async function listSoloPerformers(composer?: string): Promise<SoloFacet[]> {
  const params = new URLSearchParams();
  if (composer) params.set('composer', composer);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/v1/solos/performers${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`solo performers ${res.status}`);
  const json: { data: SoloFacet[] } = await res.json();
  return json.data ?? [];
}

/** Distinct composers with solo counts. Optionally narrowed to one performer.
 *  Backed by GET /v1/solos/composers. */
export async function listSoloComposers(performer?: string): Promise<SoloFacet[]> {
  const params = new URLSearchParams();
  if (performer) params.set('performer', performer);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/v1/solos/composers${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`solo composers ${res.status}`);
  const json: { data: SoloFacet[] } = await res.json();
  return json.data ?? [];
}

export async function fetchAllSolos(): Promise<SoloResponse[]> {
  const PAGE_SIZE = 200;
  const all: SoloResponse[] = [];
  let page = 0;
  let isLast = false;
  while (!isLast) {
    const p = await listSolos({ page, size: PAGE_SIZE });
    all.push(...p.content);
    isLast = p.last;
    page++;
    if (page > 100) break;  // safety
  }
  return all;
}

/* ── Delete ────────────────────────────────────────────────────────────────── */

export async function deleteSolo(publicId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    const detail = await readApiError(res);
    throw new Error(`Solo 삭제 실패 (${res.status}) ${detail}`.trim());
  }
}

/* ── Video link ────────────────────────────────────────────────────────────── */

export interface SoloVideoPayload {
  videoId: string;
  startSec: number;
  endSec?: number;
  url?: string;
}

export async function updateSoloVideo(publicId: string, video: SoloVideoPayload): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}/video`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(video),
  });
  if (!res.ok) {
    const detail = await readApiError(res);
    throw new Error(`Solo video 저장 실패 (${res.status}) ${detail}`.trim());
  }
}

export async function deleteSoloVideo(publicId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}/video`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    const detail = await readApiError(res);
    throw new Error(`Solo video 해제 실패 (${res.status}) ${detail}`.trim());
  }
}
