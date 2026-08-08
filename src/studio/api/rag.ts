/* RAG 문서 관리 API (admin 전용) — /v1/rag/documents CRUD + 청크 조회.
 *
 * 타입 원천 = 백엔드 스펙(생성 `schema.d.ts`). 손으로 응답 모양을 적지 않는다.
 * openapi-typescript 가 전부 optional 로 뽑으므로, "백엔드가 항상 주는 필드"만
 * Required 로 좁혀 사용성을 유지한다(chordProjects.ts 와 동일 브릿지 패턴).
 *
 * 경로 게이팅: 이 엔드포인트들은 백엔드에서 ADMIN/MANAGE 로 막혀 있다
 * (일반 유저 접근 시 403). 화면도 AdminRoute 로 감싼다. */
import { authFetch } from '../../api/auth';
import { readApiErrorMessage } from '../../api/apiError';
import type { components } from '../../api/schema';

type Schemas = components['schemas'];

/** 분류 — 검수 확정 시 standard/lesson 중 하나. candidate 는 아직 null. */
export type RagSourceType = 'standard' | 'lesson';
/** 검수 상태 — candidate(대기)/confirmed(확정, 색인됨)/rejected(반려). */
export type RagStatus = 'candidate' | 'confirmed' | 'rejected';

/** 목록 아이템 (content 전문 제외 — 청크 수만).
 *  ⚠️ sourceType 은 candidate 문서에서 null 이다(미분류). status 로 검수 단계 구분. */
export type RagDocumentSummary = Required<Omit<Schemas['RagDocumentSummaryResponse'], 'sourceType' | 'status'>> & {
  sourceType: RagSourceType | null;
  status: RagStatus;
};
/** 상세 (원본 전사문 content + metadata 포함). */
export type RagDocument = Required<Omit<Schemas['RagDocumentResponse'], 'sourceType' | 'status' | 'sourceUrl'>> & {
  sourceType: RagSourceType | null;
  status: RagStatus;
  sourceUrl: string | null; // 원본 링크 없으면 null (standard 문서)
};
/** 문서 하나가 쪼개진 개별 청크(섹션). candidate/rejected 는 색인 전이라 빈 배열. */
export type RagDocumentChunk = Required<Omit<Schemas['RagDocumentChunkResponse'], 'sourceUrl' | 'instruction'>> & {
  sourceUrl: string | null;
  instruction: string | null;
};
export type RagDocumentInput = Schemas['RagDocumentCreateRequest'];
/** confirm 요청 — sourceType 필수(standard|lesson), 나머지는 검수자가 정리한 값(선택). */
export type RagConfirmInput = Schemas['RagDocumentConfirmRequest'];

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
    throw new Error(`${what} 실패 (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return (json as ApiEnvelope<T>).data ?? (json as T);
}

/** 문서 목록. `sourceType`(분류)·`status`(검수 상태) 필터, `q` 제목/slug 검색.
 *  status 를 생략하면 반려(rejected) 문서는 자동 제외된다(백엔드 규칙). */
export async function listRagDocuments(opts: {
  page?: number;
  size?: number;
  sort?: string;
  sourceType?: string;
  status?: RagStatus;
  q?: string;
} = {}): Promise<PageData<RagDocumentSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(opts.page ?? 0));
  qs.set('size', String(opts.size ?? 50));
  qs.set('sort', opts.sort ?? 'title,asc');
  if (opts.sourceType) qs.set('sourceType', opts.sourceType);
  if (opts.status) qs.set('status', opts.status);
  if (opts.q) qs.set('q', opts.q);
  const res = await authFetch(`/v1/rag/documents?${qs.toString()}`);
  return jsonOrThrow<PageData<RagDocumentSummary>>(res, 'RAG 문서 목록 조회');
}

export async function getRagDocument(publicId: string): Promise<RagDocument> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}`);
  return jsonOrThrow<RagDocument>(res, 'RAG 문서 조회');
}

/** 문서가 색인되며 쪼개진 청크(섹션)들. sectionId 순서. */
export async function getRagDocumentChunks(publicId: string): Promise<RagDocumentChunk[]> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}/chunks`);
  return jsonOrThrow<RagDocumentChunk[]>(res, 'RAG 청크 조회');
}

export async function createRagDocument(body: RagDocumentInput): Promise<RagDocument> {
  const res = await authFetch(`/v1/rag/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<RagDocument>(res, 'RAG 문서 생성');
}

export async function updateRagDocument(publicId: string, body: RagDocumentInput): Promise<RagDocument> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<RagDocument>(res, 'RAG 문서 수정');
}

export async function deleteRagDocument(publicId: string): Promise<void> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`RAG 문서 삭제 실패 (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
  }
}

/** 후보/반려 문서를 확정한다. sourceType 지정 시점에 청킹·임베딩·색인이 실행되므로
 *  응답이 수 초 걸릴 수 있다(호출부에서 로딩 표시). 임베딩 실패 시 롤백되어 상태 유지. */
export async function confirmRagDocument(publicId: string, body: RagConfirmInput): Promise<RagDocument> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<RagDocument>(res, 'RAG 문서 확정');
}

/** 문서를 반려한다(삭제 아님, 상태 전환). 확정 문서를 반려하면 색인에서도 제거. 멱등. */
export async function rejectRagDocument(publicId: string): Promise<RagDocument> {
  const res = await authFetch(`/v1/rag/documents/${encodeURIComponent(publicId)}/reject`, { method: 'POST' });
  return jsonOrThrow<RagDocument>(res, 'RAG 문서 반려');
}
