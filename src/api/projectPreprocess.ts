/* 프로젝트 생성 전처리 (POST /v1/project-preprocesses …) — 문서서버 #32 계약.
 *
 * 흐름: 파일 업로드 → 백엔드가 문서 유형/메타데이터를 제안 → 사용자가 review 폼에서
 * 확인·정정 → confirm → 실제 SheetProject/ChordProject + 비동기 OMR 배치 생성.
 *
 * 주의: MusicVision(`/documents/classify`, `/metadata/extract`)은 백엔드가
 * server-to-server로 호출한다. 브라우저에서 직접 부르거나 OMR API Key를 갖지 않는다.
 *
 * 타입을 손으로 적는 이유: 이 엔드포인트는 아직 운영 서버(jazzify.p-e.kr) 스펙에
 * 배포되지 않아 `npm run api:types`로 생성할 수 없다. 배포되면 schema.d.ts의
 * 생성 타입으로 교체할 것(그때까지 이 파일이 유일한 계약 사본이며, 백엔드
 * `domain/projectpreprocess/dto` 와 1:1 대응한다). */
import { authFetch } from './auth';
import { readApiError } from './apiError';
import {
  omrStatusPath,
  type ConfirmableDocumentType,
  type CreatedProjectType,
  type OmrStatus,
  type PreprocessStatus,
  type ProjectDocumentType,
} from './projectPreprocessRules';

/* 순수 규칙(에러 분기·경로·폴링 판정)은 projectPreprocessRules 에 있다 —
 * 이 파일은 auth.ts 를 타서 Vite 밖에서 로드되지 않으므로, 테스트 가능한
 * 로직을 그쪽에 두고 여기서 되-export 해 호출부는 한 곳만 import 하게 한다. */
export {
  PREPROCESS_ERROR,
  isPreprocessExpired,
  isPreprocessNotFound,
  isPreprocessInvalidState,
  isTerminalOmrStatus,
  isValidTimeSignature,
  omrStatusPath,
} from './projectPreprocessRules';
export type {
  ProjectDocumentType,
  ConfirmableDocumentType,
  CreatedProjectType,
  PreprocessStatus,
  OmrStatus,
} from './projectPreprocessRules';

/** 자동 인식 제안값 — 전부 nullable. 편집 폼의 초기값으로만 쓴다. */
export interface ProjectMetadataSuggestion {
  title: string | null;
  composer: string | null;
  performer: string | null;
  key: string | null;
  timeSignature: string | null;
}

/** 각 제안값의 신뢰도 0~1. null 이어도 오류가 아니다(문서 §3 규칙 4). */
export interface ProjectMetadataConfidence {
  title: number | null;
  composer: number | null;
  performer: number | null;
  key: number | null;
  timeSignature: number | null;
}

export interface DocumentTypeCandidate {
  documentType: ProjectDocumentType;
  confidence: number | null;
}

/** 경고 분기는 `message` 문자열이 아니라 반드시 `code` 로 한다(문서 §3 규칙 6). */
export type PreprocessWarningCode =
  | 'CLASSIFICATION_UNAVAILABLE'
  | 'METADATA_UNAVAILABLE'
  | 'CLASSIFICATION_WARNING'
  | 'METADATA_WARNING';

export interface PreprocessWarning {
  /** 알려진 코드 외 값이 와도 죽지 않도록 string 을 함께 허용한다. */
  code: PreprocessWarningCode | string;
  message: string;
}

/** confirm 결과 — 전처리 GET 응답의 `project` 로도 동일 모양이 실린다. */
export interface ConfirmedProject {
  projectType: CreatedProjectType;
  projectPublicId: string;
  omrStatus: OmrStatus;
  omrProgress: number;
}

export interface ProjectPreprocess {
  preprocessId: string;
  status: PreprocessStatus;
  originalFilename: string;
  pageCount: number;
  /** ISO LocalDateTime (Asia/Seoul, offset 없음) — 표시용으로만 쓴다. */
  expiresAt: string;
  documentType: ProjectDocumentType;
  documentTypeConfidence: number | null;
  documentTypeCandidates: DocumentTypeCandidate[];
  metadata: ProjectMetadataSuggestion;
  confidence: ProjectMetadataConfidence;
  warnings: PreprocessWarning[];
  /** 확정 전 null. 확정된 세션을 GET 하면 채워진다. */
  project: ConfirmedProject | null;
}

export interface ConfirmPreprocessBody {
  documentType: ConfirmableDocumentType;
  title: string;
  composer?: string | null;
  performer?: string | null;
  /** MusicKey enum 이름 또는 일반 표기(`C_MAJOR`, `Bb`, `F#m`). 미입력 시 백엔드가 `C_MAJOR`. */
  key?: string | null;
  /** `4/4` 형식. 미입력 시 백엔드가 `4/4`. */
  timeSignature?: string | null;
}

/* ── 호출 ──────────────────────────────────────────────────────────────── */

interface ApiEnvelope<T> { data: T }

async function dataOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await readApiError(res, `${what} 실패 (${res.status})`);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return (json as ApiEnvelope<T>).data ?? (json as T);
}

/** 파일 업로드 → 유형·메타데이터 자동 제안.
 *
 *  MusicVision 동기 호출 2개를 포함해 **수십 초** 걸릴 수 있다. 호출부는 짧은
 *  timeout 을 두지 말고 로딩/취소 UI 를 제공한다(문서 §3). `signal` 로 취소한다. */
export async function createProjectPreprocess(
  file: File,
  signal?: AbortSignal,
): Promise<ProjectPreprocess> {
  const fd = new FormData();
  // Content-Type(boundary)은 브라우저가 정하도록 둔다 — 직접 세팅하면 파싱 실패.
  fd.append('file', file, file.name);
  const res = await authFetch('/v1/project-preprocesses', { method: 'POST', body: fd, signal });
  return dataOrThrow<ProjectPreprocess>(res, '파일 전처리');
}

/** 세션 복구 — 새로고침·뒤로가기·재연결 후 review 폼을 되살릴 때. */
export async function getProjectPreprocess(preprocessId: string): Promise<ProjectPreprocess> {
  const res = await authFetch(`/v1/project-preprocesses/${encodeURIComponent(preprocessId)}`);
  return dataOrThrow<ProjectPreprocess>(res, '전처리 세션 조회');
}

/** 사용자 확정 → 프로젝트 + OMR 배치 생성.
 *
 *  세션 단위로 **멱등**이다 — 중복 클릭이나 응답 유실 후 같은 preprocessId 로
 *  다시 호출해도 최초 생성 프로젝트를 돌려준다(body 가 달라도 최초가 우선). */
export async function confirmProjectPreprocess(
  preprocessId: string,
  body: ConfirmPreprocessBody,
): Promise<ConfirmedProject> {
  const res = await authFetch(`/v1/project-preprocesses/${encodeURIComponent(preprocessId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return dataOrThrow<ConfirmedProject>(res, '프로젝트 확정');
}

/** READY 세션과 임시 페이지 정리 — 모달을 닫거나 파일 선택을 취소할 때. */
export async function cancelProjectPreprocess(preprocessId: string): Promise<void> {
  const res = await authFetch(`/v1/project-preprocesses/${encodeURIComponent(preprocessId)}`, {
    method: 'DELETE',
  });
  // 이미 취소된 세션(404)은 성공으로 취급한다 — 정리가 목적이라 재호출이 안전해야 한다.
  if (res.ok || res.status === 404) return;
  throw await readApiError(res, `전처리 취소 실패 (${res.status})`);
}

export interface ProjectOmrStatus {
  publicId: string;
  status: OmrStatus;
  progress: number;
  totalPages: number | null;
  completedPages: number | null;
  failureReason: string | null;
}

export async function getProjectOmrStatus(
  projectType: CreatedProjectType,
  projectPublicId: string,
): Promise<ProjectOmrStatus> {
  const res = await authFetch(omrStatusPath(projectType, projectPublicId));
  return dataOrThrow<ProjectOmrStatus>(res, 'OMR 상태 조회');
}
