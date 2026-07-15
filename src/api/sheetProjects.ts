/**
 * SheetProject CRUD client — wraps the backend's /v1/sheet-projects endpoints.
 *
 * Spec covered (per the Swagger user shared):
 *   GET    /v1/sheet-projects                       — list (paginated)
 *   GET    /v1/sheet-projects/{publicId}            — single
 *   POST   /v1/sheet-projects                       — create (title + key + storageFileIds)
 *   PUT    /v1/sheet-projects/{publicId}            — update (title + key)
 *   DELETE /v1/sheet-projects/{publicId}            — delete (204)
 *   GET    /v1/sheet-projects/{publicId}/omr-status — OMR progress
 *
 * NOT covered (other endpoints — explicitly left alone per the user's request):
 *   POST /v1/sheet-projects/omr (multipart upload), the OMR callback, storage-files, etc.
 *   For "기능 테스트" we only need the simple create-from-metadata flow.
 *
 * All calls go through authFetch so a 401 triggers the usual refresh attempt
 * and the global auth state is kept consistent.
 */

import { authFetch } from './auth';
import { readApiErrorMessage } from './apiError';
import type { components } from './schema';

type Schemas = components['schemas'];

/* ── enums (mirroring the backend) ───────────────────────────────────────── */

/** All key signatures the backend's KeySignature enum accepts. Best-guess
 *  list from "C_MAJOR" in the example — the backend will reject any value
 *  outside its real set, so users can extend this if needed. */
export const KEY_SIGNATURES = [
  'C_MAJOR', 'G_MAJOR', 'D_MAJOR', 'A_MAJOR', 'E_MAJOR', 'B_MAJOR', 'F_SHARP_MAJOR', 'C_SHARP_MAJOR',
  'F_MAJOR', 'B_FLAT_MAJOR', 'E_FLAT_MAJOR', 'A_FLAT_MAJOR', 'D_FLAT_MAJOR', 'G_FLAT_MAJOR', 'C_FLAT_MAJOR',
  'A_MINOR', 'E_MINOR', 'B_MINOR', 'F_SHARP_MINOR', 'C_SHARP_MINOR', 'G_SHARP_MINOR', 'D_SHARP_MINOR', 'A_SHARP_MINOR',
  'D_MINOR', 'G_MINOR', 'C_MINOR', 'F_MINOR', 'B_FLAT_MINOR', 'E_FLAT_MINOR', 'A_FLAT_MINOR',
] as const;
export type KeySignature = typeof KEY_SIGNATURES[number];

export const OMR_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type OmrStatus = typeof OMR_STATUSES[number];

/* ── response types ──────────────────────────────────────────────────────── */

/* 타입 원천 = 생성 스키마(브릿지, BR-23 참조). 항상 오는 필드만 Required로 좁히고,
 * 진짜 nullable / 프론트가 문자열로 다루는 필드만 경계에서 명시. */
export type SheetProject =
  Required<Omit<Schemas['SheetProjectResponse'], 'keySignature' | 'omrStatus' | 'filePublicId' | 'omrFailureReason'>>
  & {
      keySignature: KeySignature | string;   // tolerate unknown enum values
      omrStatus: OmrStatus | string;
      filePublicId: string | null;
      omrFailureReason: string | null;
    };

export type SheetProjectOmrStatus =
  Required<Omit<Schemas['SheetProjectOmrStatusResponse'], 'status' | 'failureReason'>>
  & {
      status: OmrStatus | string;
      failureReason: string | null;
    };

/** Spring's Page<T> envelope (the backend uses the same shape as the licks list). */
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

/* ── request types ───────────────────────────────────────────────────────── */

export interface SheetProjectCreateRequest {
  title: string;
  key: KeySignature | string;
  /** Required by the spec — may be empty for now while we test the flow. */
  storageFileIds: string[];
}

export interface SheetProjectUpdateRequest {
  title?: string;
  key?: KeySignature | string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    // envelope 원문(JSON.stringify)을 그대로 UI에 노출하던 것 → 사용자용
    // message만. detail은 dev 콘솔로 (apiError.ts 규칙).
    throw new Error(`${what} failed (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
  }
  // 204 No Content has empty body — caller already handled that path.
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return (json as ApiEnvelope<T>).data ?? (json as T);
}

/* ── list ─────────────────────────────────────────────────────────────────── */

export interface ListSheetProjectsOptions {
  page?: number;
  size?: number;
  /** e.g. "createdAt,desc". Backend exposes Pageable so any field works. */
  sort?: string;
}

export async function listSheetProjects(
  opts: ListSheetProjectsOptions = {},
): Promise<PageData<SheetProject>> {
  const qs = new URLSearchParams();
  qs.set('page', String(opts.page ?? 0));
  qs.set('size', String(opts.size ?? 50));
  qs.set('sort', opts.sort ?? 'createdAt,desc');
  const res = await authFetch(`/v1/sheet-projects?${qs.toString()}`);
  return jsonOrThrow<PageData<SheetProject>>(res, '악보 프로젝트 목록 조회');
}

/* ── get one ──────────────────────────────────────────────────────────────── */

export async function getSheetProject(publicId: string): Promise<SheetProject> {
  const res = await authFetch(`/v1/sheet-projects/${encodeURIComponent(publicId)}`);
  return jsonOrThrow<SheetProject>(res, '악보 프로젝트 조회');
}

/* ── create ───────────────────────────────────────────────────────────────── */

export async function createSheetProject(
  body: SheetProjectCreateRequest,
): Promise<SheetProject> {
  const res = await authFetch('/v1/sheet-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<SheetProject>(res, '악보 프로젝트 생성');
}

/* ── update ───────────────────────────────────────────────────────────────── */

export async function updateSheetProject(
  publicId: string,
  body: SheetProjectUpdateRequest,
): Promise<SheetProject> {
  const res = await authFetch(`/v1/sheet-projects/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<SheetProject>(res, '악보 프로젝트 수정');
}

/* ── delete ───────────────────────────────────────────────────────────────── */

export async function deleteSheetProject(publicId: string): Promise<void> {
  const res = await authFetch(`/v1/sheet-projects/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`악보 프로젝트 삭제 실패 (${res.status}) ${await readApiErrorMessage(res, '')}`.trim());
  }
}

/* ── OMR status ───────────────────────────────────────────────────────────── */

export async function getOmrStatus(publicId: string): Promise<SheetProjectOmrStatus> {
  const res = await authFetch(`/v1/sheet-projects/${encodeURIComponent(publicId)}/omr-status`);
  return jsonOrThrow<SheetProjectOmrStatus>(res, 'OMR 상태 조회');
}
