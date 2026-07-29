import { useCallback, useEffect, useRef, useState } from 'react';
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

/* ─────────────────────────────────────────────────────────────────────────
 * useProjectPreprocess — 프로젝트 생성 전처리 흐름(문서서버 #32)의 상태 기계.
 *
 *   idle → uploading → review → confirming → done
 *                        ↑        (실패 시 review 로 복귀)
 *                        └── 새로고침 시 sessionStorage 의 preprocessId 로 복구
 *
 * UI(모달)와 페이지(목록 갱신·네비게이션)가 이 훅을 공유한다. 페이지마다
 * 업로드/확정 로직을 복붙하지 않도록 여기서 한 번만 구현한다.
 * ──────────────────────────────────────────────────────────────────────── */

export type PreprocessPhase = 'idle' | 'uploading' | 'review' | 'confirming';

/** 새로고침 후 review 폼을 되살리기 위한 세션 키. 탭 단위(sessionStorage)로 둔다
 *  — 다른 탭에서 만든 세션을 물려받으면 엉뚱한 파일을 확정하게 된다. */
const STORAGE_KEY = 'jazzify.preprocessId';

function readStoredId(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStoredId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* private 모드 등 — 복구 기능만 포기하고 흐름은 계속된다. */ }
}

interface Options {
  /** 확정 성공 — 페이지가 목록 갱신·폴링 시작·네비게이션을 처리한다. */
  onConfirmed: (project: ConfirmedProject, preprocess: ProjectPreprocess) => void;
}

export function useProjectPreprocess({ onConfirmed }: Options) {
  const [phase, setPhase] = useState<PreprocessPhase>('idle');
  const [preprocess, setPreprocess] = useState<ProjectPreprocess | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 진행 중인 업로드를 취소하기 위한 컨트롤러(전처리 POST 는 수십 초 걸릴 수 있다). */
  const abortRef = useRef<AbortController | null>(null);
  /** 언마운트 후 setState 방지 — 업로드가 길어 화면을 떠날 수 있다. */
  const aliveRef = useRef(true);
  /* 콜백을 ref 로 들고 있어야 start/confirm 이 매 렌더마다 새로 만들어지지
   * 않는다(호출부가 인라인 함수를 넘기므로). 갱신은 렌더 중이 아니라 effect
   * 에서 한다 — 렌더 중 ref 쓰기는 concurrent 렌더에서 안전하지 않다. */
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => { onConfirmedRef.current = onConfirmed; }, [onConfirmed]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setPreprocess(null);
    setError(null);
    writeStoredId(null);
  }, []);

  /* 새로고침·뒤로가기 복귀 시 review 폼 복구(문서 §4).
   * 만료(410)·없음(404)이면 조용히 버린다 — 사용자는 그냥 업로드부터 다시 한다. */
  useEffect(() => {
    const id = readStoredId();
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProjectPreprocess(id);
        if (cancelled || !aliveRef.current) return;
        if (p.status === 'READY') {
          setPreprocess(p);
          setPhase('review');
        } else {
          // 이미 확정/취소/만료된 세션은 되살리지 않는다.
          writeStoredId(null);
        }
      } catch {
        writeStoredId(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** 파일 업로드 → 자동 인식 → review 단계로. */
  const start = useCallback(async (file: File) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setPhase('uploading');
    try {
      const p = await createProjectPreprocess(file, ac.signal);
      if (!aliveRef.current || ac.signal.aborted) return;
      setPreprocess(p);
      writeStoredId(p.preprocessId);
      setPhase('review');
    } catch (e) {
      if (!aliveRef.current || ac.signal.aborted) return;   // 사용자가 취소 — 에러 아님
      setPhase('idle');
      setError(e instanceof Error ? e.message : '파일 분석에 실패했어요.');
    }
  }, []);

  /** 업로드 취소 — 진행 중 요청을 끊는다. */
  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setError(null);
  }, []);

  /** review 취소 — 서버의 READY 세션과 임시 페이지도 정리한다(문서 §6). */
  const cancel = useCallback(() => {
    const id = preprocess?.preprocessId;
    reset();
    // best-effort: 실패해도 사용자 흐름을 막지 않는다(서버가 TTL 로도 정리한다).
    if (id) void cancelProjectPreprocess(id).catch(() => {});
  }, [preprocess, reset]);

  /** 사용자 확정 → 프로젝트 + OMR 배치 생성. */
  const confirm = useCallback(async (body: ConfirmPreprocessBody) => {
    const current = preprocess;
    if (!current) return;
    setError(null);
    setPhase('confirming');
    try {
      const created = await confirmProjectPreprocess(current.preprocessId, body);
      if (!aliveRef.current) return;
      writeStoredId(null);
      setPhase('idle');
      setPreprocess(null);
      onConfirmedRef.current(created, current);
    } catch (e) {
      if (!aliveRef.current) return;
      /* 409(이미 확정/취소)는 실패가 아니라 상태 불일치다 — GET 으로 재동기화해
       * 이미 만들어진 프로젝트가 있으면 그대로 성공 처리한다(문서 §8 권장 처리).
       * confirm 은 멱등이지만 취소된 세션 등에서도 409 가 오므로 확인이 필요하다. */
      if (isPreprocessInvalidState(e)) {
        try {
          const synced = await getProjectPreprocess(current.preprocessId);
          if (!aliveRef.current) return;
          if (synced.project) {
            writeStoredId(null);
            setPhase('idle');
            setPreprocess(null);
            onConfirmedRef.current(synced.project, synced);
            return;
          }
        } catch { /* 재동기화도 실패 — 아래 공통 에러 처리로 */ }
      }
      if (isPreprocessExpired(e) || isPreprocessNotFound(e)) {
        reset();
        setError('세션이 만료됐어요. 파일을 다시 올려 주세요.');
        return;
      }
      setPhase('review');
      setError(e instanceof Error ? e.message : '프로젝트 생성에 실패했어요.');
    }
  }, [preprocess, reset]);

  return { phase, preprocess, error, start, cancel, cancelUpload, confirm, reset };
}
