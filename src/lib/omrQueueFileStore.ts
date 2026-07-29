/* 대량 OMR 큐의 **원본 파일 보관소** (IndexedDB) — 새로고침/탭 종료 후 자동 재개용.
 *
 * localStorage 는 Blob 을 못 담으므로 파일은 IndexedDB 에 둔다(omrImageStore 와
 * 같은 패턴). 항목이 터미널 상태(업로드 완료·실패·사용자 제거)에 도달하면 즉시
 * 지워서 용량이 쌓이지 않게 한다 — 90개×20MB 급도 "대기 중인 것만" 남는다. */
import type { OMRMetadata } from '../api/licks';

const DB_NAME = 'jazzify-omr-queue';
const STORE = 'files';
const DB_VERSION = 1;

export interface StoredQueueFile {
  jobId: string;
  name: string;      // 원본 파일명 (재개 시 표시/제목용)
  type: string;      // MIME
  blob: Blob;
  meta: OMRMetadata; // candidate 규칙이 이미 적용된 최종 메타
  addedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'jobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    t.oncomplete = () => db.close();
  }));
}

export async function queueFilePut(jobId: string, file: File, meta: OMRMetadata): Promise<void> {
  const rec: StoredQueueFile = {
    jobId, name: file.name, type: file.type, blob: file, meta, addedAt: Date.now(),
  };
  await tx('readwrite', (s) => s.put(rec));
}

export async function queueFileGet(jobId: string): Promise<StoredQueueFile | null> {
  const rec = await tx<StoredQueueFile | undefined>('readonly', (s) => s.get(jobId) as IDBRequest<StoredQueueFile | undefined>);
  return rec ?? null;
}

export async function queueFileDelete(jobId: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(jobId));
}

export async function queueFileKeys(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  return keys.map(String);
}
