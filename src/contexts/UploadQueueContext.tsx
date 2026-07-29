/* 업로드(자동 인식) 큐 — 앱 루트에 한 번만 마운트되는 전역 백그라운드 작업자.
 *
 * 왜 페이지가 아니라 여기 있나: 예전엔 "내 코드 차트" 페이지가 useProjectPreprocess
 * 를 직접 들고 전체 화면 모달로 진행 상황을 보여줬다. 그래서 (1) 분석이 끝날 때까지
 * 화면이 막히고 (2) 다른 메뉴로 이동하면 페이지가 언마운트되며 업로드가 취소됐다.
 * 전처리는 MusicVision 동기 호출 2개라 수십 초 걸리므로, 사용자가 그동안 이탈하면
 * 작업이 통째로 날아갔다. 라우트보다 위(App.tsx)에 두면 화면을 옮겨도 살아남는다.
 *
 * 흐름:  enqueue(file) → uploading → review(확인 필요) → confirming → done
 * 진행 상황은 우측 상단 독(UploadQueueDock)에 칩으로 표시된다. 모달은 사용자가
 * "확인" 을 눌렀을 때만 열린다 — 자동으로 띄우면 다시 화면을 막는 셈이라서.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  cancelProjectPreprocess,
  confirmProjectPreprocess,
  createProjectPreprocess,
  getProjectPreprocess,
  isPreprocessExpired,
  isPreprocessInvalidState,
  isPreprocessNotFound,
  type ConfirmPreprocessBody,
  type ConfirmedProject,
  type ProjectPreprocess,
} from '../api/projectPreprocess';
import { saveOmrSourceImage } from '../lib/omrImageStore';

export type UploadPhase = 'uploading' | 'review' | 'confirming' | 'done' | 'error';

export interface UploadItem {
  id: string;
  fileName: string;
  phase: UploadPhase;
  preprocess: ProjectPreprocess | null;
  error: string | null;
  /** 확정 결과 — done 일 때만. 페이지가 카드를 즉시 그릴 때 쓴다. */
  created: ConfirmedProject | null;
  /** 사용자가 review 폼에 입력한 값(카드 즉시 표시용). */
  form: { title: string; key: string } | null;
}

/** 확정되어 프로젝트가 만들어졌을 때 페이지들이 받는 알림. */
export interface ProjectCreatedEvent {
  created: ConfirmedProject;
  form: { title: string; key: string };
}

interface UploadQueueApi {
  items: UploadItem[];
  /** 파일을 큐에 넣고 즉시 백그라운드 분석을 시작한다. */
  enqueue: (file: File) => void;
  /** review 단계 항목의 확인 폼을 연다(모달). */
  openReview: (id: string) => void;
  closeReview: () => void;
  /** 지금 모달로 열려 있는 항목 id. */
  reviewingId: string | null;
  confirm: (id: string, body: ConfirmPreprocessBody) => void;
  /** 진행 중이면 요청을 끊고, 서버 세션도 정리한 뒤 큐에서 제거. */
  cancel: (id: string) => void;
  /** 완료/실패 칩을 큐에서 치운다. */
  dismiss: (id: string) => void;
  /** 프로젝트 생성 구독 — 목록 페이지가 카드를 즉시 넣거나 새로고침할 때. */
  onProjectCreated: (cb: (e: ProjectCreatedEvent) => void) => () => void;
}

const UploadQueueContext = createContext<UploadQueueApi | null>(null);

export function useUploadQueue(): UploadQueueApi {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error('useUploadQueue must be used within <UploadQueueProvider>');
  return ctx;
}

let seq = 0;
const nextId = (): string => `up_${++seq}_${Math.random().toString(36).slice(2, 8)}`;

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  /** 항목별 업로드 중단 컨트롤러 + 원본 파일(확정 후 로컬 보관용). */
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  const filesRef = useRef<Map<string, File>>(new Map());
  const listenersRef = useRef<Set<(e: ProjectCreatedEvent) => void>>(new Set());

  useEffect(() => () => {
    // 앱 종료(전체 언마운트) 시에만 정리 — 라우트 이동으로는 여기 오지 않는다.
    abortsRef.current.forEach((ac) => ac.abort());
  }, []);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  const enqueue = useCallback((file: File) => {
    const id = nextId();
    filesRef.current.set(id, file);
    setItems((prev) => [
      ...prev,
      { id, fileName: file.name, phase: 'uploading', preprocess: null, error: null, created: null, form: null },
    ]);
    const ac = new AbortController();
    abortsRef.current.set(id, ac);
    void (async () => {
      try {
        const p = await createProjectPreprocess(file, ac.signal);
        if (ac.signal.aborted) return;
        patch(id, { phase: 'review', preprocess: p, error: null });
      } catch (e) {
        if (ac.signal.aborted) return;   // 사용자가 취소 — 에러 아님
        patch(id, {
          phase: 'error',
          error: e instanceof Error ? e.message : '파일 분석에 실패했어요.',
        });
      } finally {
        abortsRef.current.delete(id);
      }
    })();
  }, [patch]);

  const removeItem = useCallback((id: string) => {
    abortsRef.current.get(id)?.abort();
    abortsRef.current.delete(id);
    filesRef.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setReviewingId((cur) => (cur === id ? null : cur));
  }, []);

  const cancel = useCallback((id: string) => {
    const item = items.find((it) => it.id === id);
    const preprocessId = item?.preprocess?.preprocessId;
    removeItem(id);
    // best-effort: 서버 READY 세션도 정리(실패해도 TTL 로 정리된다).
    if (preprocessId) void cancelProjectPreprocess(preprocessId).catch(() => {});
  }, [items, removeItem]);

  const finishConfirmed = useCallback((id: string, created: ConfirmedProject, form: { title: string; key: string }) => {
    /* 업로드한 원본 이미지를 publicId 로 로컬(IndexedDB) 보관 — best-effort. */
    const src = filesRef.current.get(id);
    if (src) void saveOmrSourceImage(created.projectPublicId, src);
    filesRef.current.delete(id);
    patch(id, { phase: 'done', created, form, error: null });
    setReviewingId((cur) => (cur === id ? null : cur));
    listenersRef.current.forEach((cb) => { try { cb({ created, form }); } catch { /* 구독자 오류 무시 */ } });
  }, [patch]);

  const confirm = useCallback((id: string, body: ConfirmPreprocessBody) => {
    const item = items.find((it) => it.id === id);
    const current = item?.preprocess;
    if (!current) return;
    const form = { title: body.title, key: body.key || 'C_MAJOR' };
    patch(id, { phase: 'confirming', error: null });
    void (async () => {
      try {
        const created = await confirmProjectPreprocess(current.preprocessId, body);
        finishConfirmed(id, created, form);
      } catch (e) {
        /* 409(이미 확정/취소)는 실패가 아니라 상태 불일치 — GET 으로 재동기화해
         * 이미 만들어진 프로젝트가 있으면 성공으로 처리한다(문서 §8). */
        if (isPreprocessInvalidState(e)) {
          try {
            const synced = await getProjectPreprocess(current.preprocessId);
            if (synced.project) { finishConfirmed(id, synced.project, form); return; }
          } catch { /* 재동기화 실패 → 아래 공통 처리 */ }
        }
        if (isPreprocessExpired(e) || isPreprocessNotFound(e)) {
          patch(id, { phase: 'error', error: '세션이 만료됐어요. 파일을 다시 올려 주세요.' });
          return;
        }
        patch(id, { phase: 'review', error: e instanceof Error ? e.message : '프로젝트 생성에 실패했어요.' });
      }
    })();
  }, [items, patch, finishConfirmed]);

  const onProjectCreated = useCallback((cb: (e: ProjectCreatedEvent) => void) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);

  const api = useMemo<UploadQueueApi>(() => ({
    items,
    enqueue,
    openReview: (id) => setReviewingId(id),
    closeReview: () => setReviewingId(null),
    reviewingId,
    confirm,
    cancel,
    dismiss: removeItem,
    onProjectCreated,
  }), [items, enqueue, reviewingId, confirm, cancel, removeItem, onProjectCreated]);

  return <UploadQueueContext.Provider value={api}>{children}</UploadQueueContext.Provider>;
}
