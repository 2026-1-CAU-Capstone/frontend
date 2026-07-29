/* 대량 OMR **전역 직렬 큐** — React 라우트 밖(모듈)에서 돈다.
 *
 * 왜 전역인가: 러너가 SolosPage 안에 있으면 앱 내 다른 페이지로 이동만 해도
 * 언마운트와 함께 큐가 조용히 죽는다(2026-07-25 실측: 93개 중 32개 처리 후 중단
 * — beforeunload 는 SPA 라우트 이동에는 뜨지 않는다). 이 모듈은 페이지와 무관하게
 * 탭이 살아있는 한 계속 돌고, 화면(SolosPage)은 useSyncExternalStore 로 구독만 한다.
 *
 * 직렬 보장: 한 항목이 터미널(COMPLETED/FAILED)에 도달해야 다음을 업로드한다
 * (OMR 서버 동시요청 보호). 실패해도 큐는 다음 항목으로 계속.
 *
 * 재개: 원본 파일은 IndexedDB(omrQueueFileStore)에 보관 → 새로고침/탭 종료 후
 * 다시 열면 남은 항목을 이어서 처리한다. 업로드까지 끝난(=publicId 확보) 항목은
 * 파일 없이 폴링만 재개한다. 재개된 항목은 영속 로그를 '입양'해 '중단' 오표시를 막는다.
 *
 * candidate 규칙: 제목=파일명(확장자 제거), performer/composer='candidate' 강제.
 */
import { createSoloViaOMR, getSoloOmrStatus, type SoloResponse } from '../api/solos';
import type { OMRMetadata } from '../api/licks';
import { getCachedUser, onAuthChange } from '../api/auth';
import {
  logQueueAdd, logQueueUpdate, logQueueRemove, logQueueAdopt, listQueueLog,
  QUEUE_SESSION_ID,
} from './soloOmrQueueLog';
import { queueFilePut, queueFileGet, queueFileDelete } from './omrQueueFileStore';

export type OmrQueueItemStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface OmrQueueItem {
  id: string;
  title: string;
  status: OmrQueueItemStatus;
  progress: number;
  totalPages: number | null;
  completedPages: number | null;
  failureReason: string | null;
  publicId?: string;
  solo?: SoloResponse;
  /** 실패 항목 재시도 가능 여부 힌트(파일 보관 or publicId 보유). */
  retryable?: boolean;
}

export interface OmrQueueState {
  items: OmrQueueItem[];
  running: boolean;
  paused: boolean;
  /** 이번 러너 사이클에서 끝난(성공+실패) 수 — 알림 문구용. */
  lastRunDone: number;
}

/* ── 내부 상태 ─────────────────────────────────────────────────────────── */
let state: OmrQueueState = { items: [], running: false, paused: false, lastRunDone: 0 };
const listeners = new Set<() => void>();
/** 업로드 전 원본 파일(메모리) — IDB 가 원본, 이건 캐시. */
const memFiles = new Map<string, { file: File; meta: OMRMetadata }>();
/** 카드에서 닫힌(취소된) 항목 — 진행 중이던 폴러가 이후 상태 갱신을 버리게 한다. */
const cancelled = new Set<string>();
let seq = 0;
let resumedOnce = false;
let pendingAuthStart = false;
let lastBaseMeta: OMRMetadata = { source: 'user' };

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* listener error must not break the queue */ } });
}
function setState(patch: Partial<OmrQueueState>) {
  state = { ...state, ...patch };
  emit();
}
function patchItem(id: string, patch: Partial<OmrQueueItem>) {
  if (cancelled.has(id)) return; // 닫힌 카드 부활 방지(버그 2)
  state = { ...state, items: state.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
  emit();
}

export function subscribeOmrQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function getOmrQueueState(): OmrQueueState {
  return state;
}

/* ── 알림 ──────────────────────────────────────────────────────────────── */
function requestNotifyPermission(): void {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch { /* unsupported */ }
}
function notifyQueueDone(done: number, failed: number): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const body = failed > 0 ? `성공 ${done - failed} · 실패 ${failed}` : `${done}개 모두 성공`;
    new Notification('Jazzify — OMR 큐 완료', { body, tag: 'jazzify-omr-queue' });
  } catch { /* ignore */ }
}

/* ── 탭 닫기/새로고침 경고(진행·대기 항목이 있을 때만) ─────────────────── */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const active = state.items.some((i) => i.status === 'QUEUED' || i.status === 'PROCESSING');
    if (active) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ── 등록 ──────────────────────────────────────────────────────────────── */
export function enqueueOmrFiles(files: File[], baseMeta: OMRMetadata): void {
  lastBaseMeta = baseMeta;
  requestNotifyPermission();
  const newItems: OmrQueueItem[] = [];
  for (const file of files) {
    const id = `omrq-${Date.now()}-${seq++}`;
    const title = file.name.replace(/\.(pdf|png|jpe?g)$/i, '');
    const meta: OMRMetadata = {
      ...baseMeta,
      title,                    // 제목 = 파일명 (강제)
      performer: 'candidate',   // 검수 전 표시 (강제)
      composer: 'candidate',
      source: 'user',
    };
    memFiles.set(id, { file, meta });
    void queueFilePut(id, file, meta).catch(() => { /* 보관 실패 시 재개만 불가 — 진행은 계속 */ });
    logQueueAdd(id, title);
    newItems.push({ id, title, status: 'QUEUED', progress: 0, totalPages: null, completedPages: null, failureReason: null });
  }
  setState({ items: [...state.items, ...newItems] });
  startRunner();
}

/** 큐 카드의 "＋ 추가" — 마지막 시작 때의 공통 메타(악기 등)를 물려받는다. */
export function enqueueMoreFiles(files: File[]): void {
  enqueueOmrFiles(files, lastBaseMeta);
}

/* ── 제거/취소 ─────────────────────────────────────────────────────────── */
export function dismissOmrQueueItem(id: string): void {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  if (it.status === 'QUEUED') {
    logQueueRemove(id);            // 처리 대상이 아니었으므로 기록도 정리
    void queueFileDelete(id).catch(() => {});
    memFiles.delete(id);
  } else if (it.status === 'PROCESSING') {
    cancelled.add(id);             // 폴러가 이후 갱신을 버린다(서버는 계속 처리)
  }
  setState({ items: state.items.filter((i) => i.id !== id) });
}

export function dismissOmrQueueAll(): void {
  for (const it of state.items) {
    if (it.status === 'QUEUED') {
      logQueueRemove(it.id);
      void queueFileDelete(it.id).catch(() => {});
      memFiles.delete(it.id);
    } else if (it.status === 'PROCESSING') {
      cancelled.add(it.id);
    }
  }
  setState({ items: [] });
}

/* ── 일시정지/재개 — 다음 항목부터 적용(진행 중인 항목은 마무리한다) ───── */
export function pauseOmrQueue(): void { setState({ paused: true }); }
export function resumeOmrQueue(): void {
  setState({ paused: false });
  startRunner();
}

/** 실패 항목 재시도 — 파일이 보관돼 있으면 재업로드, publicId 만 있으면 재폴링. */
export function retryOmrQueueItem(id: string): void {
  const it = state.items.find((i) => i.id === id);
  if (!it || it.status !== 'FAILED') return;
  logQueueUpdate(id, { status: 'QUEUED', failureReason: null });
  patchItem(id, { status: 'QUEUED', progress: 0, failureReason: null });
  startRunner();
}

/* ── 러너 ──────────────────────────────────────────────────────────────── */
function startRunner(): void {
  if (state.running) return;
  if (!getCachedUser()) {
    // 로그인 전(재개 시나리오) — 로그인되면 자동 시작.
    if (!pendingAuthStart) {
      pendingAuthStart = true;
      const off = onAuthChange((loggedIn) => {
        if (loggedIn) { off(); pendingAuthStart = false; startRunner(); }
      });
    }
    return;
  }
  void runLoop();
}

async function runLoop(): Promise<void> {
  setState({ running: true, lastRunDone: 0 });
  let done = 0;
  let failed = 0;
  try {
    for (;;) {
      if (state.paused) return;
      const next = state.items.find((i) => i.status === 'QUEUED' && !cancelled.has(i.id));
      if (!next) return;
      const ok = await processItem(next.id);
      done += 1;
      if (!ok) failed += 1;
      setState({ lastRunDone: done });
    }
  } finally {
    setState({ running: false });
    if (done > 0 && !state.paused) notifyQueueDone(done, failed);
  }
}

/** 한 항목을 터미널까지 처리. 성공이면 true. */
async function processItem(id: string): Promise<boolean> {
  patchItem(id, { status: 'PROCESSING', progress: 0 });
  logQueueUpdate(id, { status: 'PROCESSING', startedAt: Date.now() });

  const current = () => state.items.find((i) => i.id === id);

  try {
    let publicId = current()?.publicId;
    if (!publicId) {
      // 파일 확보: 메모리 → IndexedDB(재개 시)
      let entry = memFiles.get(id) ?? null;
      if (!entry) {
        const stored = await queueFileGet(id);
        if (stored) {
          entry = {
            file: new File([stored.blob], stored.name, { type: stored.type }),
            meta: stored.meta,
          };
        }
      }
      if (!entry) {
        const reason = '원본 파일을 찾을 수 없어요(보관 실패) — 파일을 다시 추가해 주세요.';
        patchItem(id, { status: 'FAILED', failureReason: reason });
        logQueueUpdate(id, { status: 'FAILED', failureReason: reason, endedAt: Date.now() });
        return false;
      }
      const solo = await createSoloViaOMR(entry.file, entry.meta);
      memFiles.delete(id);
      void queueFileDelete(id).catch(() => {}); // 업로드 완료 — 원본 보관 해제
      if (solo?.sheetData?.measures?.length) {
        patchItem(id, { status: 'COMPLETED', progress: 100, publicId: solo.publicId, solo });
        logQueueUpdate(id, { status: 'COMPLETED', publicId: solo.publicId, endedAt: Date.now() });
        return true;
      }
      if (!solo?.publicId) {
        const reason = '서버 응답에 악보 데이터가 없어요.';
        patchItem(id, { status: 'FAILED', failureReason: reason });
        logQueueUpdate(id, { status: 'FAILED', failureReason: reason, endedAt: Date.now() });
        return false;
      }
      publicId = solo.publicId;
      patchItem(id, { publicId });
      logQueueUpdate(id, { publicId });
    }
    return await pollUntilTerminal(id, publicId);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'OMR 인식 실패';
    patchItem(id, { status: 'FAILED', failureReason: reason });
    logQueueUpdate(id, { status: 'FAILED', failureReason: reason, endedAt: Date.now() });
    return false;
  }
}

/** omr-status 폴링 — 터미널까지. 문서 #23 규칙대로 섣불리 실패 처리하지 않고
 *  상한(15분)을 넘기면 표시만 하고 다음으로 넘어간다. */
async function pollUntilTerminal(id: string, publicId: string): Promise<boolean> {
  const INTERVAL_MS = 5000;
  const MAX_MS = 15 * 60_000;
  const startedAt = Date.now();
  for (;;) {
    if (cancelled.has(id)) return false; // 카드 닫힘 — 조용히 종료(로그는 그대로)
    try {
      const st = await getSoloOmrStatus(publicId);
      if (st.status === 'COMPLETED') {
        patchItem(id, { status: 'COMPLETED', progress: 100, publicId });
        logQueueUpdate(id, { status: 'COMPLETED', publicId, endedAt: Date.now() });
        return true;
      }
      if (st.status === 'FAILED') {
        const reason = st.failureReason ?? '악보 인식에 실패했어요.';
        patchItem(id, { status: 'FAILED', failureReason: reason });
        logQueueUpdate(id, { status: 'FAILED', failureReason: reason, endedAt: Date.now() });
        return false;
      }
      patchItem(id, {
        ...(st.progress > 0 ? { progress: st.progress } : {}),
        totalPages: st.totalPages,
        completedPages: st.completedPages,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/\b401\b|\b403\b/.test(msg)) {
        const reason = '로그인이 만료됐어요. 다시 로그인 후 재시도해 주세요.';
        patchItem(id, { status: 'FAILED', failureReason: reason, retryable: true });
        logQueueUpdate(id, { status: 'FAILED', failureReason: '로그인 만료(401/403)', endedAt: Date.now() });
        return false;
      }
      /* 일시 오류(500 등) — 계속 폴링 */
    }
    if (Date.now() - startedAt > MAX_MS) {
      const reason = '처리 상태를 확인하지 못했어요(15분). 재시도하면 이어서 확인합니다.';
      patchItem(id, { status: 'FAILED', failureReason: reason, retryable: true });
      logQueueUpdate(id, { status: 'FAILED', failureReason: '상태 확인 시간 초과(15분)', endedAt: Date.now() });
      return false;
    }
    await new Promise<void>((r) => { window.setTimeout(r, INTERVAL_MS); });
  }
}

/* ── 재개 — 앱/페이지가 다시 열렸을 때 이전 세션의 잔여 큐를 이어받는다 ── */
export async function resumeOmrQueueFromDisk(): Promise<void> {
  if (resumedOnce) return;
  resumedOnce = true;
  try {
    const leftovers = listQueueLog().filter(
      (e) => e.sessionId !== QUEUE_SESSION_ID && (e.status === 'QUEUED' || e.status === 'PROCESSING'),
    );
    if (leftovers.length === 0) return;
    const revived: OmrQueueItem[] = [];
    for (const e of leftovers.reverse()) { // queuedAt 오름차순(원래 순서)으로 복원
      if (state.items.some((i) => i.id === e.id)) continue;
      if (e.status === 'PROCESSING' && e.publicId) {
        // 업로드는 끝났던 항목 — 파일 필요 없이 폴링만 이어받으면 된다.
        logQueueAdopt(e.id);
        revived.push({
          id: e.id, title: e.title, status: 'QUEUED', progress: 0,
          totalPages: null, completedPages: null, failureReason: null, publicId: e.publicId,
        });
        continue;
      }
      const stored = await queueFileGet(e.id).catch(() => null);
      if (stored) {
        logQueueAdopt(e.id);
        revived.push({
          id: e.id, title: e.title, status: 'QUEUED', progress: 0,
          totalPages: null, completedPages: null, failureReason: null,
        });
      }
      // 파일도 publicId 도 없으면 복구 불가 — 로그에 '중단'으로 남는다(재추가 안내).
    }
    if (revived.length > 0) {
      setState({ items: [...state.items, ...revived] });
      startRunner();
    }
  } catch { /* 재개는 best-effort — 실패해도 새 큐 사용에는 지장 없다 */ }
}
