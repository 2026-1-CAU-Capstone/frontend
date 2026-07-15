# CLAUDE.md — Jazzify 프로젝트 지침

## 백엔드 API: 항상 최신 스펙을 확인하고 적용한다

백엔드는 OpenAPI(springdoc)를 **무인증**으로 노출한다. 사용자가 백엔드 API 관련 작업(엔드포인트 추가/변경, 요청·응답 타입 확인, API 호출부 구현/수정)을 요청할 때는 **매번 먼저 최신 스펙을 직접 확인**한다. 사용자에게 스펙을 복붙받지 말 것.

| 용도 | URL |
|---|---|
| OpenAPI JSON (파싱용) | `https://jazzify.p-e.kr/api/v3/api-docs` |
| Swagger UI (사람용) | `https://jazzify.p-e.kr/api/swagger-ui/index.html` |

**작업 절차 (매 세션·매 요청):**

1. 프론트 타입을 스펙에서 재생성한다 — 손으로 타입 적지 말 것:
   ```bash
   npm run api:types   # → src/api/schema.d.ts (paths/components/operations)
   ```
2. 생성된 타입을 소비한다:
   ```ts
   import type { components } from './schema';
   type ChordProject = components['schemas']['ChordProjectResponse'];
   ```
3. 특정 부분만 빠르게 볼 때는 스펙을 직접 쿼리한다:
   ```bash
   curl -s https://jazzify.p-e.kr/api/v3/api-docs -o /tmp/jazzify_openapi.json
   # 엔드포인트 전체 (METHOD  PATH)
   jq -r '.paths|to_entries[]|.key as $p|(.value|to_entries[]|"\(.key|ascii_upcase)\t\($p)")' /tmp/jazzify_openapi.json | sort -k2
   # 특정 스키마
   jq -r '.components.schemas.ChordProjectResponse' /tmp/jazzify_openapi.json
   ```

- API base: dev는 vite proxy `/api` → `https://jazzify.p-e.kr`, prod는 `https://jazzify.p-e.kr/api`. 경로는 `/v1/...`.
- 모든 응답은 `{ data: ... }` 봉투(`ApiResponse*`)로 감싸진다.
- **스펙 문서만 무인증**이고, 실제 데이터 엔드포인트는 Bearer 토큰 필요(아래).

## 인증 호출 테스트 (로그인 → 토큰)

자격증명은 **`.env.local`** 에 있다 (커밋 금지, `VITE_` 접두사 없음):

```
JAZZIFY_ADMIN_USER=...
JAZZIFY_ADMIN_PASS=...
```

```bash
set -a; source .env.local; set +a
BODY=$(jq -nc --arg u "$JAZZIFY_ADMIN_USER" --arg p "$JAZZIFY_ADMIN_PASS" '{username:$u,password:$p}')
TOKEN=$(curl -s -X POST https://jazzify.p-e.kr/api/v1/auth/login \
  -H 'Content-Type: application/json' -d "$BODY" | jq -r '.data.accessToken')
curl -s -H "Authorization: Bearer $TOKEN" https://jazzify.p-e.kr/api/v1/chord-projects | jq .
```

- 로그인 응답: `{ data: { accessToken, publicId, username } }`. 토큰은 단기 만료 → 세션마다 새로 로그인.
- **비밀번호·토큰은 절대 출력/로그에 남기지 않는다.**

## 보안 규칙

- **`.env`, `.env.local` 둘 다 `.gitignore`** → git 추적 금지. 커밋되는 건 `.env.example`(시크릿 없는 템플릿)뿐.
- 프런트는 무엇도 진짜로 숨길 수 없다 — `VITE_` 변수는 빌드 시 브라우저 번들에 박혀 공개됨:
  - `.env`(VITE_): 공개돼도 되는 설정만 (API URL 등).
  - `.env.local`(non-VITE_): 로컬 도구/테스트용 시크릿 (admin 계정). 번들에 안 실림.
  - 진짜 시크릿(관리자 PW, 외부 API 키): **백엔드에만**.
- ⚠️ 알려진 노출: `VITE_RAG_TOKEN`은 `VITE_` 라서 배포 시 공개됨 → 추후 백엔드 프록시로 가리는 게 숙제.

## 백엔드 요구사항 문서 작성·업로드

백엔드에 넘길 요구사항을 문서서버(`doc.jazzify.p-e.kr`)에 올릴 때는 **`docs/backendrequirements/BACKEND_REQUIREMENTS.md` 를 먼저 읽고** 그 규칙을 그대로 따른다. 그 파일 하나에 양식·업로드 방법이 전부 있다.

- **제목**: `YYYY-MM-DD · <설명적 제목> N건` (생성날짜 맨 앞, 범주는 본문 `🏷 범주(태그):` 로). 문서는 날짜별로 계속 누적된다.
- **본문**: 기능마다 `기능 요약 / 상황 설명 / 기능 상세(사용자·권한·시나리오·동작조건·검증조건·기대결과)` + 상태(✅/🟡/⬜). 백엔드 코드/DB 구현 지시는 넣지 않는다(외부 API 계약만 `제안`으로).
- **업로드**: `.env.local`의 `JAZZIFY_DOCS_ID`/`JAZZIFY_DOCS_PW` 로 `scripts/doc-upload.sh <파일>` (신규) 또는 `scripts/doc-upload.sh <파일> <문서id>` (수정).

## 문서서버 업로드 규칙 — 신규 vs 수정 (필수)

문서서버(`doc.jazzify.p-e.kr`)에 올릴 때 **새 문서를 만들지, 기존 문서를 덮어쓸지**는 아래로 판단한다:

- **사용자가 "기존 문서를 수정하라"고 하면** → 그 문서의 서버 id를 마지막 인자로 붙여 **덮어쓴다**. `scripts/doc-upload.sh <파일> <id>`. 새 문서를 만들지 않는다.
- **별말이 없으면** → `scripts/doc-upload.sh <파일>` (id 없이) 로 **새 문서를 추가**한다.
- 애매하면(둘 다 그럴듯하면) 새로 만들기 전에 **먼저 물어본다**. id를 빠뜨려 의도치 않게 중복 문서를 만드는 것이 가장 흔한 실수다.
- 업로드 후에는 `GET /documents/{id}/markdown` 으로 되받아 반영을 **검증**한다(줄수·핵심 문자열).

**서버 문서 id 매핑 (확정):**

| id | 문서 | 로컬 파일 |
|---|---|---|
| #2 | 백엔드 본문 양식(안필온) | (미러) `docs/Backend_AI_Docs.md` |
| #6~#11 | 백엔드 요구사항 6범주 | `docs/backendrequirements/01~06-*.md` (01=#6 … **05-미디어추론=#10** … 06=#11) |
| #12 | Jazzify 기능 명세서 | `docs/기능명세서.md` |

## 기능 명세서 유지·동기화 (필수)

**단일 소스**: `docs/기능명세서.md` (문서서버 **#12**, `type: 기능 명세`). 과거의 `기능명세서.html`/루트 `기능명세서.md`는 **삭제됨** — 이 파일이 유일 소스다.

기능(화면·동작·상태·API 연동·결함·백엔드 요구사항 등) 명세에 영향을 주는 변경을 하면 **매번 다음 두 가지를 함께** 수행한다:

1. **로컬 문서 수정**: `docs/기능명세서.md` 를 고친다. front-matter의 `updated:` 를 오늘 날짜로 갱신한다. 기능표(M1~)·결함(§6)·백엔드 요구사항(BR-*)은 기존 표/섹션 양식을 그대로 유지한다.
2. **문서서버 재업로드**: 아래로 **#12 문서를 덮어쓴다**. (마지막 인자 `12` = 문서 id. 빼면 새 문서가 생기니 반드시 붙일 것.)
   ```bash
   set -a; source .env.local; set +a
   scripts/doc-upload.sh docs/기능명세서.md 12
   # 성공 시: HTTP/1.1 302 · Location: .../documents/12
   ```

- 문서 양식·업로드 함정은 `docs/backendrequirements/BACKEND_REQUIREMENTS.md` §6 참조(과거 `AI_COLLAB_GUIDE.md`는 `docs/archive/`로 이동). front-matter(`title/type/targets`)는 유지한다.
- "기능명세만 살짝 바꿨다"도 예외 없이 1+2를 함께 한다 — 로컬만 고치고 서버 업로드를 빠뜨리지 말 것.
