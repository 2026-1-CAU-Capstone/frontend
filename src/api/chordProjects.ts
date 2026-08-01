import { authFetch } from './auth';
import { readApiErrorMessage } from './apiError';
import type { components } from './schema';

type Schemas = components['schemas'];

export const CHORD_PROJECT_KEYS = [
  'C_MAJOR', 'G_MAJOR', 'D_MAJOR', 'A_MAJOR', 'E_MAJOR', 'B_MAJOR', 'F_SHARP_MAJOR', 'C_SHARP_MAJOR',
  'F_MAJOR', 'B_FLAT_MAJOR', 'E_FLAT_MAJOR', 'A_FLAT_MAJOR', 'D_FLAT_MAJOR', 'G_FLAT_MAJOR', 'C_FLAT_MAJOR',
  'A_MINOR', 'E_MINOR', 'B_MINOR', 'F_SHARP_MINOR', 'C_SHARP_MINOR', 'G_SHARP_MINOR', 'D_SHARP_MINOR', 'A_SHARP_MINOR',
  'D_MINOR', 'G_MINOR', 'C_MINOR', 'F_MINOR', 'B_FLAT_MINOR', 'E_FLAT_MINOR', 'A_FLAT_MINOR',
] as const;

export type ChordProjectKey = typeof CHORD_PROJECT_KEYS[number];
export type ChordProjectOmrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;

/* 타입 원천 = 백엔드 스펙(생성 `schema.d.ts`). 손으로 응답 모양을 적지 않는다.
 * openapi-typescript가 전부 optional로 뽑으므로(스펙에 required 미선언, BR-23),
 * "백엔드가 항상 주는 필드"만 Required로 좁혀 사용성을 유지하고, 진짜 nullable인
 * 필드만 경계에서 명시한다. 필드가 rename/삭제되면 여기서 컴파일 에러 → 드리프트 감지.
 * BR-23(스펙에 required/nullable 선언) 완료 시 이 브릿지는 순수 alias로 축소 가능. */
export type ChordProject =
  Required<Omit<Schemas['ChordProjectResponse'],
    'keySignature' | 'omrFailureReason' | 'chords' | 'omrResult'>>
  & {
      keySignature: ChordProjectKey | string;  // 프론트는 조성을 문자열로 다룸
      omrFailureReason: string | null;          // 실패 없으면 null
      omrResult?: Schemas['OmrResultResponse']; // 단건 조회에만 실린다(목록엔 없음)
    };

export type ChordProjectStatus = Required<Schemas['ChordProjectOmrStatusResponse']>;

export type ChordInfo =
  Required<Omit<Schemas['ChordInfoResponse'], 'chord' | 'analysis'>>
  & {
      chord: string | null;                     // 코드 없는 마디 → null (손글씨가 놓쳐 버그났던 필드)
      analysis: Record<string, unknown> | null; // 분석 전 → null
    };

export type ChordAnalysisResult = Required<Schemas['AnalysisResultResponse']>;
export type ChordExplanationResult = Required<Schemas['AnalysisExplanationResponse']>;

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
    // envelope 원문(JSON.stringify)을 그대로 UI에 노출하던 것 → 사용자용
    // message만. detail은 dev 콘솔로 (apiError.ts 규칙).
    throw new Error(`${what} failed (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
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
    throw new Error(`코드 프로젝트 삭제 실패 (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
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
