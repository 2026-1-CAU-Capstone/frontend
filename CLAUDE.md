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

- API base: dev는 vite proxy `/api` → 기본 `https://jazzify.p-e.kr`(전환은 아래 "로컬 백엔드"), prod는 `https://jazzify.p-e.kr/api`. 경로는 `/v1/...`.
- 모든 응답은 `{ data: ... }` 봉투(`ApiResponse*`)로 감싸진다.
- **스펙 문서만 무인증**이고, 실제 데이터 엔드포인트는 Bearer 토큰 필요(아래).

## ⛔ 이 작업공간에서 `../backend` 코드를 수정하지 않는다 (읽기 전용)

**여기(Claude Code)에서 하는 일은 프론트엔드 코드 + 백엔드 "요구사항 문서" 작성뿐이다.**
백엔드 구현은 사용자가 **옆의 IntelliJ 에서 직접** 수행한다.

- `../backend/**` 는 **읽기 전용**이다. Edit/Write 로 고치지 말 것 — 담당 영역(LLM/RAG/analysis/omr)이라도 마찬가지다.
- 백엔드에 변경이 필요하면 **코드를 고치는 대신** 요구사항 문서(`docs/backendrequirements/`)로 쓰거나, 무엇을 어떻게 고치면 되는지 **설명**한다.
- 예외: 사용자가 그 파일을 명시하며 "여기서 고쳐달라"고 직접 지시한 경우에만. 그때도 먼저 확인한다.
- 읽기(코드 확인·구조 파악·설정값 조회)와 로컬 기동/검증(gradlew bootRun, curl)은 자유롭게 해도 된다.

## 백엔드 소스는 `../backend` 에 있다 — 추측하지 말고 직접 읽는다

백엔드는 같은 repo의 **`../backend`** (Spring Boot / Gradle / Java, 패키지 `com.jazzify.backend`)에 있다.
백엔드 동작·구조가 궁금하면 **OpenAPI 스펙과 함께 실제 소스를 직접 확인**한다. 사용자에게 묻거나 추측하지 말 것.

- 요구사항 문서(`docs/backendrequirements/`)를 쓸 때도 **먼저 해당 도메인 코드를 읽고** 실제 구조·엔드포인트·에러코드에 맞춰 쓴다.
- 설정값(포트·context-path·CORS·외부 서버 주소)은 `../backend/src/main/resources/application-{dev,prod}.yml` 과 `.env.dev.example` 이 1차 출처다.
- 백엔드 자체 AI 지침은 `../backend/Agents.md` 에 있다(중복 작성 말고 그걸 참조).

**주요 위치**
| 영역 | 경로 (`../backend/src/main/java/com/jazzify/backend/`) |
|---|---|
| RAG | `domain/rag` |
| Rule-based 분석 | `domain/analysis` |
| LLM 채팅 | `domain/chat` · `shared/llm` |
| 임베딩 | `domain/embedding` · `shared/embedding` |
| OMR/AMT | `shared/omr` |

## 백엔드 담당 경계 — 3단계 (백엔드 담당자와 합의됨, 2026-07-22)

사용자가 직접 수정하는 영역은 **LLM · RAG · Rule-based Engine · AMT/OMR** 이다. 단 그 안에서도
**다른 사람 코드가 물고 있는 계약**이 있어 3단계로 나뉜다.

### 🟢 자유 — 마음대로 수정
`domain/rag` · `domain/chat` · `domain/embedding` · `shared/embedding` · `shared/llm`
→ 백엔드 담당자 코드가 의존하지 않는다. 조율 없이 진행.

### 🟡 조건부 — 내부 로직은 자유, **공개 계약은 변경 전 반드시 사용자에게 알린다**

**`domain/analysis`** — `chordproject`가 의존
| 건드리기 전 알릴 것 | 현재 형태 |
|---|---|
| `HarmonicAnalysisService` public 시그니처 | `analyze(String text, String key, String title, String timeSignature)` · `explain(...)` (동일 인자) |
| `AnalysisExplanationResponse` DTO 모양 | `domain/analysis/dto/response/` |

**`shared/omr`** — `chordproject`·`sheetproject`·`solo`(전부 백엔드 담당자 영역)가 의존
- ⛔ **`OmrProcessingStatus` enum 상수 `PENDING`·`PROCESSING`·`COMPLETED`·`FAILED` 는 이름 변경·삭제 절대 금지.**
  이 엔티티들에 **DB로 영속**되어 있어 리네임하면 기존 데이터가 깨진다. **추가는 OK.**
- ⚠️ `OmrClient` · `OmrProperties` · `OmrCallbackDomain` · `OmrFileValidator` 의 public API 변경도 조율 필요.

> 위 계약을 바꿔야 하는 변경을 제안할 때는, 코드를 고치기 전에 **"이건 백엔드 담당자와 조율이 필요하다"**고 먼저 말한다.

### 🔴 금지 — 수정 대상으로 제안하지 않는다
`domain/user` · `domain/chordproject` · `domain/sheetproject` · `domain/solo` · `domain/storagefile` · `core/security` 등
(백엔드 담당자 소유. 버그를 발견하면 고치지 말고 **보고만** 한다.)

## 백엔드 전환 — 운영 ↔ 로컬 (이 두 명령만 쓴다)

프론트는 **항상 `localhost:5173`** 이고, **백엔드만** 바뀐다. 전환은 npm script 두 개가 전부다.

```bash
npm run dev          # → 백엔드: https://jazzify.p-e.kr   (운영, 기본)
npm run dev:local    # → 백엔드: http://localhost:8080    (IntelliJ 로컬)
```

사용자에게 실행 방법을 안내할 때는 **이 두 명령으로 안내한다.** `JAZZIFY_API_TARGET=… npm run dev` 를 매번
치게 하지 말 것(그 방식은 8080 이 아닌 다른 주소를 쓸 때만).

**확인**: 부팅 로그 한 줄로 현재 대상이 보인다.
```
➜  API 프록시:  /api → http://localhost:8080  (로컬 백엔드)
➜  API 프록시:  /api → https://jazzify.p-e.kr  (운영 서버)
```

**주의**
- **전환하려면 dev 서버를 껐다 켠다**(`Ctrl+C` → 다른 명령). vite.config는 부팅 시 1회 로드라 HMR로는 안 바뀐다.
- **로컬은 계정 DB가 운영과 별개** — 운영 계정으로 로그인되지 않는다. 로컬에선 회원가입부터. 전환 직후 401은 정상.
- 값은 **호스트까지만** — `/api`를 붙이면 `/api/api/...` 가 되어 404.
- vite proxy에 **`rewrite`를 넣지 말 것** — 백엔드 context-path가 `/api`라 경로를 그대로 넘겨야 한다.

**동작 구조**: `dev:local` 은 `JAZZIFY_API_TARGET` 환경변수를 세팅해 vite proxy target 을 바꾼다.
`.env.local`(frontend/ 또는 repo 루트)에 `JAZZIFY_API_TARGET` 을 넣어두면 `npm run dev` 도 그쪽을 본다.
다른 포트·호스트가 필요할 때만 이 환경변수를 직접 쓴다. 상세는 `docs/로컬백엔드-전환.md`.

### 로컬 백엔드 기동 (참고)

IntelliJ `dev` 프로파일로 실행한다(설정은 `../backend/src/main/resources/.env` — 팀 통일 위치, gitignore됨).
사전 조건: docker `jazzify-db`(pgvector) · `jazzify-redis` 실행. 기동 시 `RagBootstrapRunner` 가
`../backend/data/explanation/` 의 22개 txt를 자동 색인한다(**22 docs / 285 chunks**, 재기동해도 중복 없음).

```bash
curl -s http://localhost:8080/api/v1/rag/health   # → documentCount 22 / chunkCount 285
```

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

## 문서서버 읽기/검색 — `jazzify-docs` MCP (읽기는 이걸 우선)

문서서버(`doc.jazzify.p-e.kr`)의 문서를 **읽거나 검색**할 때는 `jazzify-docs` MCP 도구를 쓴다. 백엔드 스펙·문서·업무 진행상황이 궁금하면 추측하거나 사용자에게 복붙받지 말고 MCP로 직접 확인한다.

- **조회 흐름**: `get_current_agent`(역할·`canWrite` 확인) → `list_document_types`/`list_document_tags`/`list_document_statuses`(입력용 ID·enum) → `search_documents`(제목·작성자·타입·태그·업무상태 기반, **본문 전문검색 불가** — 제목 키워드로 찾는다) → `get_document`(Markdown 본문·메타). 과거 버전은 `list_document_revisions`/`get_document_revision`.
- **쓰기 충돌 주의(중요)**: 아래 스크립트 흐름으로 관리하는 **추적 문서(기능명세서 #17, BR 문서 #6~#11 등)** 는 계속 `scripts/doc-upload.sh` + id 매핑으로만 갱신한다. MCP `create_document`는 **새 id·`AI 생성` 태그로 중복 문서**를 만드니, 추적 문서를 MCP로 새로 만들지 말 것. MCP 쓰기(`create_document`/`update_document`/`update_document_status`)는 **ADMIN 키**만 가능하고, 수정 시 `get_document`로 최신 `currentVersion`을 읽어 `expectedVersion`으로 넘겨야 한다(stale 오류 시 재조회·병합 후 재시도).

## 백엔드 요구사항 문서 작성·업로드

백엔드에 넘길 요구사항을 문서서버(`doc.jazzify.p-e.kr`)에 올릴 때는 **`docs/backendrequirements/BACKEND_REQUIREMENTS.md` 를 먼저 읽고** 그 규칙을 그대로 따른다. 그 파일 하나에 양식·업로드 방법이 전부 있다.

- **문서 타입**: front-matter `type:` 를 **항상 `백엔드 요구사항`**(documentTypeId=5)으로 둔다. `기능 명세`(4)가 아니다 — 그건 기능명세서(#17) 전용. (2026-07-23 사용자 지시)
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
| #17 | Jazzify 기능 명세서 (구 #12 — 서버에서 삭제돼 2026-07-17 재생성) | `docs/기능명세서.md` |
| #16 | 백엔드 요구사항 BR-24~29 (2026-07-17) | `docs/backendrequirements/2026-07-17-악보프로젝트-OMR파이프라인-프로필-릭.md` |

## 기능 명세서 유지·동기화 (필수)

**단일 소스**: `docs/기능명세서.md` (문서서버 **#17** — 구 #12가 서버에서 삭제되어 2026-07-17 재생성, `type: 기능 명세`). 과거의 `기능명세서.html`/루트 `기능명세서.md`는 **삭제됨** — 이 파일이 유일 소스다.

기능(화면·동작·상태·API 연동·결함·백엔드 요구사항 등) 명세에 영향을 주는 변경을 하면 **매번 다음 두 가지를 함께** 수행한다:

1. **로컬 문서 수정**: `docs/기능명세서.md` 를 고친다. front-matter의 `updated:` 를 오늘 날짜로 갱신한다. 기능표(M1~)·결함(§6)·백엔드 요구사항(BR-*)은 기존 표/섹션 양식을 그대로 유지한다.
2. **문서서버 재업로드**: 아래로 **#17 문서를 덮어쓴다**. (마지막 인자 `17` = 문서 id. 빼면 새 문서가 생기니 반드시 붙일 것. `.env.local`은 repo 루트(`../.env.local`)에 있음.)
   ```bash
   set -a; source ../.env.local; set +a
   scripts/doc-upload.sh docs/기능명세서.md 17
   # 성공 시: HTTP/1.1 302 · Location: .../documents/17
   ```

- 문서 양식·업로드 함정은 `docs/backendrequirements/BACKEND_REQUIREMENTS.md` §6 참조(과거 `AI_COLLAB_GUIDE.md`는 `docs/archive/`로 이동). front-matter(`title/type/targets`)는 유지한다.
- "기능명세만 살짝 바꿨다"도 예외 없이 1+2를 함께 한다 — 로컬만 고치고 서버 업로드를 빠뜨리지 말 것.
