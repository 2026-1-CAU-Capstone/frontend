# Jazzify 백엔드 API — 참조 & 테스트 가이드

> **이 문서의 목적**: API 스펙을 추가/수정하거나 백엔드 호출을 테스트할 때, 매번 복붙받지 않고
> **이 `.md` + `.env.local`만 보고** 바로 진행하기 위한 캐논. (사람·에이전트 공용)

## 1. 스펙은 라이브로 직접 받는다 (복붙 불필요)

백엔드는 OpenAPI(springdoc)를 **무인증**으로 노출한다. 스펙은 항상 최신을 받아서 본다.

| 용도 | URL |
|---|---|
| OpenAPI JSON (파싱용) | `https://jazzify.p-e.kr/api/v3/api-docs` |
| Swagger UI (사람용) | `https://jazzify.p-e.kr/api/swagger-ui/index.html` |

```bash
# 스펙 받기
curl -s https://jazzify.p-e.kr/api/v3/api-docs -o /tmp/jazzify_openapi.json

# 엔드포인트 전체 (METHOD  PATH)
jq -r '.paths|to_entries[]|.key as $p|(.value|to_entries[]|"\(.key|ascii_upcase)\t\($p)")' /tmp/jazzify_openapi.json | sort -k2

# 특정 스키마 properties
jq -r '.components.schemas.ChordProjectResponse.properties' /tmp/jazzify_openapi.json
```

- API base: dev는 vite proxy `/api` → `https://jazzify.p-e.kr`, prod는 `https://jazzify.p-e.kr/api`. 경로는 `/v1/...`.
- **스펙 문서만 무인증**이고, 실제 데이터 엔드포인트는 Bearer 토큰 필요(아래).

## 2. 로그인 → 토큰 (인증 호출용)

자격증명은 **`.env.local`** 에 있다 (절대 커밋 금지, `VITE_` 접두사 없음 → 브라우저 번들에 안 실림):

```
JAZZIFY_ADMIN_USER=...
JAZZIFY_ADMIN_PASS=...
```

로그인 후 `accessToken`을 받아 `Authorization: Bearer <token>` 로 호출한다.
**비밀번호·토큰은 절대 출력/로그에 남기지 않는다.**

```bash
cd <repo>
set -a; source .env.local; set +a
BODY=$(jq -nc --arg u "$JAZZIFY_ADMIN_USER" --arg p "$JAZZIFY_ADMIN_PASS" '{username:$u,password:$p}')
TOKEN=$(curl -s -X POST https://jazzify.p-e.kr/api/v1/auth/login \
  -H 'Content-Type: application/json' -d "$BODY" | jq -r '.data.accessToken')

# 이제 인증 호출 (예시)
curl -s -H "Authorization: Bearer $TOKEN" https://jazzify.p-e.kr/api/v1/chord-projects | jq .
```

- 로그인 응답: `{ data: { accessToken, publicId, username } }` (`ApiResponseTokenResponse` / `TokenResponse`).
- 토큰은 단기 만료 → 테스트 세션마다 새로 로그인.
- 모든 응답은 `{ data: ... }` 봉투(`ApiResponse*`)로 감싸진다.

## 3. 스펙에서 확인된 핵심 (자주 헷갈리는 것)

- `ChordProjectResponse`: `omrStatus` enum `[PENDING, PROCESSING, COMPLETED, FAILED]` + `omrProgress`(int) + `omrFailureReason`(string) + **`chords` 배열까지 포함** → 목록 GET이 chords를 이미 실어줌.
- `ChordProjectOmrStatusResponse`(`/{id}/omr-status`): `{ publicId, status(enum), progress, failureReason }`.
- OMR 완료는 `/.../omr/callback`(push 콜백) 기반, `omr-status` 폴링은 폴백.
- 태그(14): Auth, User, ChordProject, SheetProject, Solo, Lick, Analysis, Chat, Rag, Embedding, StorageFile, + 각 OMR Callback. (총 47 paths)

## 4. 보안 규칙 (이 레포)

- **`.env`, `.env.local` 둘 다 `.gitignore`** → 절대 git 추적 금지. 커밋되는 건 `.env.example`(시크릿 없는 템플릿)뿐.
- 프런트는 **무엇도 진짜로 숨길 수 없다** — `VITE_` 변수는 빌드 시 브라우저 번들에 박혀 공개됨. 그러니:
  - `.env`(VITE_): 공개돼도 되는 설정만 (API URL 등).
  - `.env.local`(non-VITE_): 로컬 도구/테스트용 시크릿 (이 가이드의 admin 계정). 번들에 안 실림.
  - 진짜 시크릿(관리자 PW, 외부 API 키): **백엔드에만**.
- ⚠️ 알려진 노출: `VITE_RAG_TOKEN`은 `VITE_` 라서 배포 시 공개됨 → 추후 백엔드 프록시로 가리는 게 숙제.
