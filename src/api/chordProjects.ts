import { authFetch } from './auth';

export const CHORD_PROJECT_KEYS = [
  'C_MAJOR', 'G_MAJOR', 'D_MAJOR', 'A_MAJOR', 'E_MAJOR', 'B_MAJOR', 'F_SHARP_MAJOR', 'C_SHARP_MAJOR',
  'F_MAJOR', 'B_FLAT_MAJOR', 'E_FLAT_MAJOR', 'A_FLAT_MAJOR', 'D_FLAT_MAJOR', 'G_FLAT_MAJOR', 'C_FLAT_MAJOR',
  'A_MINOR', 'E_MINOR', 'B_MINOR', 'F_SHARP_MINOR', 'C_SHARP_MINOR', 'G_SHARP_MINOR', 'D_SHARP_MINOR', 'A_SHARP_MINOR',
  'D_MINOR', 'G_MINOR', 'C_MINOR', 'F_MINOR', 'B_FLAT_MINOR', 'E_FLAT_MINOR', 'A_FLAT_MINOR',
] as const;

export type ChordProjectKey = typeof CHORD_PROJECT_KEYS[number];
export type ChordProjectOmrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;

export interface ChordProject {
  publicId: string;
  title: string;
  keySignature: ChordProjectKey | string;
  timeSignature: string;
  omrStatus: ChordProjectOmrStatus;
  omrProgress: number;
  omrFailureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChordProjectStatus {
  publicId: string;
  status: ChordProjectOmrStatus;
  progress: number;
  failureReason: string | null;
}

export interface ChordInfo {
  publicId: string;
  chord: string;
  bar: number;
  beat: number;
  durationBeats: number;
  analysis: Record<string, unknown> | null;
}

export interface ChordAnalysisResult {
  projectPublicId: string;
  title: string;
  keySignature: string;
  timeSignature: string;
  lastAnalyzedAt?: string;
  ambiguityStats?: Record<string, unknown>;
  chords: ChordInfo[];
  groups: Array<Record<string, unknown>>;
  sections: Array<Record<string, unknown>>;
}

export interface ChordExplanationResult {
  title: string;
  key: string;
  timeSignature: string;
  overview: string;
  chordExplanations: Array<Record<string, unknown>>;
  sectionExplanations: string[];
  notablePatterns: string[];
  harmonicSummary: string;
}

interface PageData<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
}

interface ApiEnvelope<T> { data: T }

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* not json */ }
    throw new Error(`${what} failed (${res.status}) ${detail}`.trim());
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return (json as ApiEnvelope<T>).data ?? (json as T);
}

export async function listChordProjects(opts: { page?: number; size?: number; sort?: string } = {}): Promise<PageData<ChordProject>> {
  const qs = new URLSearchParams();
  qs.set('page', String(opts.page ?? 0));
  qs.set('size', String(opts.size ?? 100));
  qs.set('sort', opts.sort ?? 'createdAt,desc');
  const res = await authFetch(`/v1/chord-projects?${qs.toString()}`);
  return jsonOrThrow<PageData<ChordProject>>(res, '코드 프로젝트 목록 조회');
}

export async function getChordProject(publicId: string): Promise<ChordProject> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}`);
  return jsonOrThrow<ChordProject>(res, '코드 프로젝트 조회');
}

export async function createChordProject(body: {
  title: string;
  key: ChordProjectKey | string;
  timeSignature?: string;
}): Promise<ChordProject> {
  const res = await authFetch('/v1/chord-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<ChordProject>(res, '코드 프로젝트 생성');
}

export async function updateChordProject(
  publicId: string,
  body: { title?: string; key?: ChordProjectKey | string },
): Promise<ChordProject> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<ChordProject>(res, '코드 프로젝트 수정');
}

export async function deleteChordProject(publicId: string): Promise<void> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* not json */ }
    throw new Error(`코드 프로젝트 삭제 실패 (${res.status}) ${detail}`.trim());
  }
}

export async function getChordProjectOmrStatus(publicId: string): Promise<ChordProjectStatus> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}/omr-status`);
  return jsonOrThrow<ChordProjectStatus>(res, '코드 프로젝트 OMR 상태 조회');
}

export async function addChordProjectChords(publicId: string, progression: string): Promise<ChordInfo[]> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}/chords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progression }),
  });
  return jsonOrThrow<ChordInfo[]>(res, '코드 프로젝트 코드 등록');
}

/* In-flight de-dup: the polling auto-analyze and the SheetPreview self-heal can
 * fire POST /analyze for the SAME project at nearly the same time. Sharing one
 * promise per publicId collapses those into a single backend call (avoids
 * double-analyze / result races when the backend isn't idempotent). */
const analyzeInFlight = new Map<string, Promise<ChordAnalysisResult>>();
export async function analyzeChordProject(publicId: string): Promise<ChordAnalysisResult> {
  const existing = analyzeInFlight.get(publicId);
  if (existing) return existing;
  const p = (async () => {
    const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}/analyze`, { method: 'POST' });
    return jsonOrThrow<ChordAnalysisResult>(res, '코드 프로젝트 분석 실행');
  })();
  analyzeInFlight.set(publicId, p);
  try {
    return await p;
  } finally {
    analyzeInFlight.delete(publicId);
  }
}

export async function getChordProjectAnalysis(publicId: string): Promise<ChordAnalysisResult> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}/analysis`);
  return jsonOrThrow<ChordAnalysisResult>(res, '코드 프로젝트 분석 결과 조회');
}

export async function explainChordProject(publicId: string): Promise<ChordExplanationResult> {
  const res = await authFetch(`/v1/chord-projects/${encodeURIComponent(publicId)}/explain`);
  return jsonOrThrow<ChordExplanationResult>(res, '코드 프로젝트 분석 설명 조회');
}

export async function createChordProjectFromOmr(
  file: File,
  request: { title?: string; key?: ChordProjectKey | string; timeSignature?: string } = {},
): Promise<{ project: ChordProject; chords: ChordInfo[] }> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  const res = await authFetch('/v1/chord-projects/omr', {
    method: 'POST',
    body: fd,
  });
  return jsonOrThrow<{ project: ChordProject; chords: ChordInfo[] }>(res, '코드 프로젝트 OMR 생성');
}
