/**
 * 프로젝트 생성 전처리 API 레이어(문서서버 #32) 계약 테스트.
 *
 * 검증 대상은 네트워크가 아니라 **분기 규칙**이다 — 세션 만료/충돌 판별,
 * projectType 별 상태 endpoint, 폴링 종료 조건. 문서 §7·§8 이 요구하는
 * "message 가 아니라 code 로 분기" 를 실제로 지키는지 확인한다.
 *
 * 실행: npx tsx src/api/__tests__/projectPreprocess.test.ts
 */
/* 규칙 모듈만 import 한다 — projectPreprocess.ts 는 auth.ts 를 타고
 * `import.meta.env`(Vite 전용)를 건드려 tsx 에서 로드되지 않는다. */
import { ApiError } from '../apiError';
import {
  PREPROCESS_ERROR,
  isPreprocessExpired,
  isPreprocessInvalidState,
  isPreprocessNotFound,
  isTerminalOmrStatus,
  isValidTimeSignature,
  omrStatusPath,
  type OmrStatus,
} from '../projectPreprocessRules';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    failures.push(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

/* ── 1. 세션 만료(410 / PROJECT_PREPROCESS_002) ──────────────────────────
 * 만료면 preprocessId 를 버리고 업로드부터 다시 시작해야 한다. */
check('만료: code 로 판별', isPreprocessExpired(new ApiError('만료', 410, PREPROCESS_ERROR.EXPIRED)), true);
check('만료: status 410 만 있어도 판별', isPreprocessExpired(new ApiError('gone', 410, null)), true);
check('만료: 다른 코드는 false', isPreprocessExpired(new ApiError('없음', 404, PREPROCESS_ERROR.NOT_FOUND)), false);
check('만료: 일반 Error 는 false', isPreprocessExpired(new Error('network')), false);
check('만료: null 안전', isPreprocessExpired(null), false);

/* ── 2. 세션 없음(404 / _001) ─────────────────────────────────────────── */
check('없음: code 로 판별', isPreprocessNotFound(new ApiError('없음', 404, PREPROCESS_ERROR.NOT_FOUND)), true);
check('없음: status 404 만 있어도 판별', isPreprocessNotFound(new ApiError('nf', 404, null)), true);
check('없음: 409 는 false', isPreprocessNotFound(new ApiError('충돌', 409, PREPROCESS_ERROR.INVALID_STATE)), false);

/* ── 3. 상태 전이 충돌(409 / _003) ────────────────────────────────────────
 * 이미 확정/취소된 세션 — GET 으로 재동기화해야 하는 신호다. */
check('충돌: code 로 판별', isPreprocessInvalidState(new ApiError('충돌', 409, PREPROCESS_ERROR.INVALID_STATE)), true);
check('충돌: status 409 만 있어도 판별', isPreprocessInvalidState(new ApiError('conflict', 409, null)), true);
check('충돌: 410 은 false', isPreprocessInvalidState(new ApiError('만료', 410, PREPROCESS_ERROR.EXPIRED)), false);

/* 세 판별식이 서로 배타적이어야 한다 — 하나의 에러가 둘로 분기되면
 * "만료인데 재동기화" 같은 잘못된 복구를 하게 된다. */
const expired = new ApiError('만료', 410, PREPROCESS_ERROR.EXPIRED);
check('배타성: 만료는 만료로만 분류', [
  isPreprocessExpired(expired), isPreprocessNotFound(expired), isPreprocessInvalidState(expired),
], [true, false, false]);

/* ── 4. projectType 별 상태 endpoint(문서 §7) ─────────────────────────────
 * 여기서 잘못 분기하면 확정 후 폴링이 통째로 404 난다. */
check('경로: sheet_project → sheet-projects',
  omrStatusPath('sheet_project', 'abc-123'), '/v1/sheet-projects/abc-123/omr-status');
check('경로: chord_project → chord-projects',
  omrStatusPath('chord_project', 'abc-123'), '/v1/chord-projects/abc-123/omr-status');
/* publicId 는 서버가 준 UUID 지만, 경로 조립 시 인코딩을 빠뜨리면 특수문자가
 * 들어왔을 때 경로가 깨진다. */
check('경로: publicId 인코딩',
  omrStatusPath('chord_project', 'a/b?c'), '/v1/chord-projects/a%2Fb%3Fc/omr-status');

/* ── 5. 폴링 종료 조건(문서 §7) ───────────────────────────────────────────
 * COMPLETED/FAILED 에서 멈추지 않으면 타이머가 영원히 돈다. */
const statuses: OmrStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];
check('폴링 종료 판정', statuses.map(isTerminalOmrStatus), [false, false, true, true]);

/* ── 5b. 박자표 검증(PROJECT_PREPROCESS_005) ─────────────────────────────
 * 서버 왕복 전에 폼에서 거르는 규칙. 빈 값은 "미입력"이라 유효(백엔드 기본 4/4). */
check('박자표: 정상', ['4/4', '3/4', '12/8', '7/16'].map(isValidTimeSignature), [true, true, true, true]);
check('박자표: 빈 값은 미입력이라 유효', [isValidTimeSignature(''), isValidTimeSignature('   ')], [true, true]);
check('박자표: 0 은 양의 정수 아님', ['0/4', '4/0'].map(isValidTimeSignature), [false, false]);
check('박자표: 형식 위반', ['4', '4/', '/4', 'a/b', '4/4/4', '-1/4'].map(isValidTimeSignature),
  [false, false, false, false, false, false]);

/* ── 6. 에러 코드 상수가 백엔드 enum 과 일치하는지 ────────────────────────
 * backend ProjectPreprocessErrorCode 와 문자열이 어긋나면 모든 분기가 죽는다. */
check('에러 코드 상수', PREPROCESS_ERROR, {
  NOT_FOUND: 'PROJECT_PREPROCESS_001',
  EXPIRED: 'PROJECT_PREPROCESS_002',
  INVALID_STATE: 'PROJECT_PREPROCESS_003',
  DOCUMENT_TYPE_REQUIRED: 'PROJECT_PREPROCESS_004',
  INVALID_TIME_SIGNATURE: 'PROJECT_PREPROCESS_005',
});

/* ── 7. ApiError 가 code 를 보존하는지 ───────────────────────────────────
 * readApiErrorMessage 는 message 만 돌려줘서 분기가 불가능했다 — 그래서
 * ApiError 를 도입했다. detail 은 절대 노출하지 않는다(apiError.ts 규칙). */
const err = new ApiError('세션이 만료되었습니다.', 410, 'PROJECT_PREPROCESS_002');
check('ApiError: instanceof Error', err instanceof Error, true);
check('ApiError: 필드 보존', [err.message, err.status, err.code],
  ['세션이 만료되었습니다.', 410, 'PROJECT_PREPROCESS_002']);
check('ApiError: name', err.name, 'ApiError');

console.log('\n=== project-preprocess api test ===');
console.log(`${pass} pass / ${fail} fail (${pass + fail} total)\n`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
} else {
  console.log('✓ All tests passed');
}

process.exit(fail > 0 ? 1 : 0);
