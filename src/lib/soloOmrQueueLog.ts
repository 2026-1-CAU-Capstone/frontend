/* 대량 OMR 큐 **영속 기록** (localStorage) — admin 전용 열람.
 *
 * 왜: 큐는 React 메모리에만 있어서 탭을 닫거나 새로고침하면(또는 노트북이 잠들면)
 * 남은 항목이 조용히 증발하고, 무엇이 됐고 무엇이 안 됐는지 기록도 사라졌다
 * (2026-07-25 실측: 93개 중 32개 처리 후 11:50 중단 — 서버 실패 0건, 순수 프론트 중단).
 * 이 로그는 항목별 결과(성공/실패 사유/중단)를 localStorage 에 남겨, 자리를 비웠다
 * 돌아와도 어디까지 됐는지 확인할 수 있게 한다.
 *
 * 세션 판정: 각 항목에 기록 당시의 sessionId 를 심는다. 페이지가 새로 뜨면
 * sessionId 가 바뀌므로, **다른 세션의 QUEUED/PROCESSING 항목 = 중단된 것**으로
 * 표시할 수 있다(그 세션의 러너는 이미 죽었음이 보장된다). */

export type QueueLogStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface QueueLogEntry {
  id: string;             // 잡 id (SolosPage omr job id)
  title: string;          // 파일명 기반 제목
  status: QueueLogStatus;
  sessionId: string;      // 기록 당시 페이지 세션
  failureReason?: string | null;
  publicId?: string;      // 생성된 솔로 (업로드 성공 시)
  queuedAt: number;       // epoch ms
  startedAt?: number;
  endedAt?: number;
}

const KEY = 'jazzify.soloOmrQueue.log';
const MAX_ENTRIES = 1000; // 폭주 방지 — 넘치면 오래된 것부터 버린다.

/** 이 페이지 로드(세션)의 식별자 — 모듈 로드 시 1회 생성. */
export const QUEUE_SESSION_ID = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function read(): QueueLogEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(entries: QueueLogEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* quota/private mode — 로그는 best-effort */ }
}

/** 새 항목 기록(큐 등록 시). */
export function logQueueAdd(id: string, title: string): void {
  const entries = read();
  entries.push({ id, title, status: 'QUEUED', sessionId: QUEUE_SESSION_ID, queuedAt: Date.now() });
  write(entries);
}

/** 항목 갱신(시작/완료/실패). 없는 id 는 무시. */
export function logQueueUpdate(
  id: string,
  patch: Partial<Pick<QueueLogEntry, 'status' | 'failureReason' | 'publicId' | 'startedAt' | 'endedAt'>>,
): void {
  const entries = read();
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) return;
  entries[i] = { ...entries[i], ...patch };
  write(entries);
}

/** 큐에서 사용자가 직접 뺀 항목은 기록에서도 제거(처리 대상이 아니었으므로). */
export function logQueueRemove(id: string): void {
  write(read().filter((e) => e.id !== id));
}

/** 이전 세션 항목을 현재 세션이 **입양**한다 — 재개된 항목이 '중단'으로
 *  표시되지 않도록 sessionId 를 현재 세션으로 바꾼다. */
export function logQueueAdopt(id: string): void {
  const entries = read();
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) return;
  entries[i] = { ...entries[i], sessionId: QUEUE_SESSION_ID };
  write(entries);
}

/** 전체 기록 — 최신 등록 순. */
export function listQueueLog(): QueueLogEntry[] {
  return read().sort((a, b) => b.queuedAt - a.queuedAt);
}

/** 표시용 상태 — 다른 세션의 미종결 항목은 '중단'으로 승격해 보여준다. */
export function effectiveStatus(e: QueueLogEntry): QueueLogStatus | 'INTERRUPTED' {
  if ((e.status === 'QUEUED' || e.status === 'PROCESSING') && e.sessionId !== QUEUE_SESSION_ID) {
    return 'INTERRUPTED';
  }
  return e.status;
}

export function clearQueueLog(): void {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
