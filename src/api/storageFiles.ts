/**
 * StorageFile API client — wraps /v1/storage-files endpoints.
 *
 * Spec covered:
 *   POST /v1/storage-files               — multipart upload (field: file)
 *   GET  /v1/storage-files/{publicId}    — metadata lookup
 *
 * Used as a prerequisite for SheetProject creation: the backend requires a
 * non-empty `storageFileIds` array, so we upload a file (or a tiny dummy
 * blob) here first and pass the returned publicId into createSheetProject.
 */

import { authFetch } from './auth';

export interface StorageFile {
  publicId: string;
  originalFileName: string;
  fileSize: number;
  contentType: string;
  createdAt: string;
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

/**
 * Upload a file (or Blob) and return the persisted metadata.
 *
 * IMPORTANT: do NOT set Content-Type yourself — the browser populates
 * `multipart/form-data; boundary=...` from the FormData instance, and
 * overriding it breaks the multipart parser on the server. authFetch
 * passes headers through verbatim, so we just leave them empty.
 */
export async function uploadStorageFile(
  file: Blob,
  filename?: string,
): Promise<StorageFile> {
  const fd = new FormData();
  const name = filename ?? (file instanceof File ? file.name : 'upload.bin');
  fd.append('file', file, name);
  const res = await authFetch('/v1/storage-files', {
    method: 'POST',
    body: fd,
  });
  return jsonOrThrow<StorageFile>(res, '파일 업로드');
}

export async function getStorageFile(publicId: string): Promise<StorageFile> {
  const res = await authFetch(`/v1/storage-files/${encodeURIComponent(publicId)}`);
  return jsonOrThrow<StorageFile>(res, '파일 정보 조회');
}
