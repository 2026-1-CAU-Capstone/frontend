/* 프로젝트 생성 전처리(문서서버 #32)의 **순수 규칙** — 에러 분기, 경로 조립,
 * 폴링 종료 판정.
 *
 * `projectPreprocess.ts`(HTTP 호출)와 분리해 둔 이유: 그쪽은 auth.ts →
 * `import.meta.env`(Vite 전용)를 타서 Vite 밖에서는 로드조차 되지 않는다.
 * 규칙만 여기 두면 다른 순수 모듈들처럼 `npx tsx` 로 바로 검증할 수 있다. */
import { ApiError } from './apiError';

/** 백엔드 `ProjectDocumentType` — @JsonValue 로 snake_case 직렬화. */
export type ProjectDocumentType = 'sheet_music' | 'chord_chart' | 'unknown';
/** 확정 시 지정 가능한 유형 — `unknown` 으로는 확정할 수 없다(PROJECT_PREPROCESS_004). */
export type ConfirmableDocumentType = Exclude<ProjectDocumentType, 'unknown'>;
/** 백엔드 `ProjectType`. */
export type CreatedProjectType = 'sheet_project' | 'chord_project';
export type PreprocessStatus = 'READY' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
export type OmrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** backend `ProjectPreprocessErrorCode` 와 1:1. */
export const PREPROCESS_ERROR = {
  NOT_FOUND: 'PROJECT_PREPROCESS_001',
  EXPIRED: 'PROJECT_PREPROCESS_002',
  INVALID_STATE: 'PROJECT_PREPROCESS_003',
  DOCUMENT_TYPE_REQUIRED: 'PROJECT_PREPROCESS_004',
  INVALID_TIME_SIGNATURE: 'PROJECT_PREPROCESS_005',
} as const;

/** 세션이 만료돼 처음(파일 업로드)부터 다시 해야 하는가. */
export function isPreprocessExpired(e: unknown): boolean {
  return e instanceof ApiError && (e.code === PREPROCESS_ERROR.EXPIRED || e.status === 410);
}

/** 세션이 없거나 다른 사용자 소유 — 업로드 화면으로 되돌린다. */
export function isPreprocessNotFound(e: unknown): boolean {
  return e instanceof ApiError && (e.code === PREPROCESS_ERROR.NOT_FOUND || e.status === 404);
}

/** 잘못된 상태 전이(이미 확정/취소) — GET 으로 상태를 재동기화한다. */
export function isPreprocessInvalidState(e: unknown): boolean {
  return e instanceof ApiError && (e.code === PREPROCESS_ERROR.INVALID_STATE || e.status === 409);
}

/** 확정 후 폴링할 상태 endpoint — projectType 으로 분기한다(문서 §7). */
export function omrStatusPath(projectType: CreatedProjectType, projectPublicId: string): string {
  const id = encodeURIComponent(projectPublicId);
  return projectType === 'sheet_project'
    ? `/v1/sheet-projects/${id}/omr-status`
    : `/v1/chord-projects/${id}/omr-status`;
}

/** 폴링을 멈춰야 하는 종료 상태. */
export function isTerminalOmrStatus(status: OmrStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/** 박자표 검증 — 백엔드는 "양의 정수/양의 정수"만 받는다(PROJECT_PREPROCESS_005).
 *  서버 왕복 전에 폼에서 걸러 준다. 빈 값은 미입력(백엔드 기본 4/4)이라 유효. */
export function isValidTimeSignature(value: string): boolean {
  const v = value.trim();
  return v === '' || /^[1-9]\d*\/[1-9]\d*$/.test(v);
}
