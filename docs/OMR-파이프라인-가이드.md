---
title: 2026-07-29 · OMR 파이프라인 정리 및 사용 가이드
type: 기술 정리
targets: [OMR, 백엔드, 프론트]
status: 작성완료
owner: 최영현
updated: 2026-07-29
---

# OMR 파이프라인 정리 및 사용 가이드

> 악보 이미지를 올려서 Jazzify 안의 데이터(솔로·릭·악보 프로젝트·코드 프로젝트)가
> 되기까지, **어디를 거쳐 어떻게 흘러가고 무엇을 보고 확인하는지**를 정리한 문서다.
>
> MusicVision(내부 OMR 엔진)의 상세 API 계약은 이 문서 범위가 아니다 —
> **「OMR 스펙 & 컨트랙트」(문서 #28)** 를 본다. 이 문서는 그 위에서
> **제품 전체 흐름 + 실제 사용/확인 방법**을 다룬다.
>
> ℹ️ 이 문서서버는 여러 줄 코드블록을 제대로 렌더링하지 못한다(줄바꿈이 뭉개짐).
> 그래서 다이어그램·예시를 표와 목록으로 풀어 썼다.

## 1. 한눈에 보기

OMR은 **3계층**이고, 각 계층이 서로 다른 방식으로 대화한다.

| # | 계층 | 하는 일 | 다음 계층과의 통신 |
| --- | --- | --- | --- |
| 1 | **브라우저 프론트엔드** | 업로드 UI, 진행률 표시 | ① `multipart` 업로드 → `publicId` 수신 ② `omr-status` **폴링**(4~5초) |
| 2 | **Spring Boot 백엔드** (`https://jazzify.p-e.kr/api`) | API 경계, 파일 보관, 상태·결과 관리 | ③ server-to-server 호출(`X-OMR-API-Key`) ④ `job_id` 수신 후 콜백 대기 |
| 3 | **MusicVision** (Python/FastAPI) | 실제 OMR 인식 엔진 | ⑤ 처리 끝나면 백엔드로 **콜백 POST** |

핵심 원칙 3가지:

| 원칙 | 내용 |
| --- | --- |
| **API 경계는 Spring Boot 하나** | 브라우저는 MusicVision을 **직접 호출하지 않는다.** OMR API 키가 프론트에 노출되면 안 되기 때문이다. |
| **프론트는 폴링만 한다** | SSE·WebSocket 없음. `omr-status`를 주기적으로 GET 한다. |
| **콜백은 서버 내부 통신** | MusicVision → Spring 콜백은 프론트에서 관측 불가하다. 프론트가 보는 건 그 결과가 반영된 `status`뿐이다. |

## 2. 리소스 4종 — 같은 패턴, 다른 경로

OMR은 만들어지는 결과물에 따라 **4갈래**로 나뉜다. 경로만 다르고 흐름은 동일하다.

| 리소스 | 제출 | 상태 조회 | 콜백(내부) |
| --- | --- | --- | --- |
| 솔로 | `POST /v1/solos/omr` | `GET /v1/solos/{publicId}/omr-status` | `POST /v1/solos/omr/callback` |
| 악보 프로젝트 | `POST /v1/sheet-projects/omr` | `GET /v1/sheet-projects/{publicId}/omr-status` | `POST /v1/sheet-projects/omr/callback` |
| 코드 프로젝트 | `POST /v1/chord-projects/omr` | `GET /v1/chord-projects/{publicId}/omr-status` | `POST /v1/chord-projects/omr/callback` |
| 릭 | `POST /v1/licks/omr` | `GET /v1/licks/{publicId}/omr-status` | `POST /v1/licks/omr/callback` |

모두 `multipart/form-data`(파일 + JSON 메타데이터 파트)이고 **Bearer 토큰이 필요**하다.
응답은 Jazzify 공통 봉투 `{ data: ... }` 로 감싸진다.

> ⚠️ **프론트 미반영 사항**: 릭의 `omr-status` 엔드포인트는 **백엔드에 이미 존재**하지만,
> 프론트(`api/licks.ts`)는 아직 이를 쓰지 않고 `GET /v1/licks/{publicId}` 의
> `omrStatus` 필드를 폴링한다(4초 간격, 3분 상한). 정리 대상.

## 3. 작업 수명주기 (job lifecycle)

1. **제출** — `POST /v1/{리소스}/omr` (multipart: 파일 + 메타데이터)
   → `publicId` 확보, 상태는 `PENDING`
2. **폴링 시작** — `GET /v1/{리소스}/{publicId}/omr-status` 를 **4~5초 간격**으로 호출
3. **진행 중** — `PROCESSING`. `progress` 0~100, 다중 페이지면 페이지 단위 진행률
4. **종료** — `COMPLETED` 또는 `FAILED`(+ `failureReason`). 여기서 폴링을 멈춘다
5. **결과 수령** — `COMPLETED`인 경우에만 **해당 엔티티를 다시 GET** 하여
   실제 인식 결과(MusicXML / 코드 JSON)를 받는다

> **중요**: `omr-status`는 **진행률만** 준다. **결과 데이터는 들어있지 않다.**
> 완료 후 엔티티를 재조회해야 실제 악보·코드 데이터를 받는다.

### 상태 값

프론트·백엔드가 쓰는 상태와 MusicVision 내부 상태는 **다르다.** 헷갈리지 말 것.

| 계층 | 상태 값 |
| --- | --- |
| **Jazzify (프론트·백엔드)** | `PENDING` · `PROCESSING` · `COMPLETED` · `FAILED` |
| **MusicVision (내부)** | `queued` · `processing` · `completed` · `failed` · `not_found` |

> ⛔ Jazzify 쪽 4개 상수는 **DB에 영속**되어 있다. 이름 변경·삭제 금지(추가는 가능).
> 백엔드 `OmrProcessingStatus` enum 계약이며, 바꾸면 기존 데이터가 깨진다.

### omr-status 응답 필드

| 필드 | 예시 값 | 설명 |
| --- | --- | --- |
| `publicId` | `…uuid…` | 조회 대상 리소스 식별자 |
| `status` | `PROCESSING` | `PENDING` / `PROCESSING` / `COMPLETED` / `FAILED` |
| `progress` | `62` | 0~100 정수. 백엔드가 안 주면 0으로 취급한다 |
| `totalPages` | `5` | **다중 페이지 PDF** 전체 페이지 수 |
| `completedPages` | `3` | 처리 끝난 페이지 수. `completedPages / totalPages` 로 표시 |
| `failureReason` | `null` | `FAILED`일 때 사용자에게 보여줄 실패 사유 |

> 📄 **PDF 주의**: MusicVision은 래스터 이미지(`.png` · `.jpg` · `.jpeg` · `.webp`)만 받는다.
> PDF는 **Spring 단계에서 페이지 분해·래스터라이즈**된 뒤 페이지별로 처리되고,
> 그 진행이 `totalPages` / `completedPages` 로 올라온다. (문서 #23 참조)

## 4. 결과 데이터 형태

| 산출물 | 언제 | 내용 |
| --- | --- | --- |
| `score.musicxml` | full OMR | 음표·기보 인식 결과(MusicXML) |
| `chord_assignments.json` | 악보 계열 | 인쇄된 코드 심볼을 **시각적 마디에 배정**한 JSON |
| `chord_chart.json` | 코드 차트 | 그리드·코드·반복·ending·navigation 구조 |

백엔드는 이를 페이지 단위로 묶어 내려준다 — `OmrResultResponse`:

| 필드 | 설명 |
| --- | --- |
| `version` | 결과 포맷 버전 (정수) |
| `pages[]` | 페이지 배열 |
| `pages[].page` | 페이지 번호 (1부터) |
| `pages[].musicXml` | 해당 페이지의 MusicXML 문자열 |
| `pages[].chordAssignmentsJson` | 해당 페이지의 코드 배정 JSON 문자열 |
| `pages[].chordChartJson` | 해당 페이지의 코드 차트 JSON 문자열 |

### 마디 정합(alignment) — 코드 붙일 때 반드시 확인

`chord_assignments.json` 안의 `measure_alignment.status` 를 보고 처리해야 한다.
**인덱스 순서만 믿고 강제로 붙이면 안 된다.**

| 값 | 의미 | 처리 |
| --- | --- | --- |
| `aligned` | 시각 마디 = MusicXML 마디 전부 일치 | 전부 연결 가능 |
| `partial` | 일부 시스템만 일치 | `musicxml_measure_number` 있는 마디만 연결 |
| `mismatch` | 안전한 대응 없음 | 자동 연결 **금지**, 검수 대상으로 표시 |
| `visual_only` | MusicXML 없이 시각 결과만 | 시각 마디 기준으로만 사용 |

## 5. 사용 방법

### 5-1. 앱에서 OMR 돌리기

| 하고 싶은 것 | 화면 | 비고 |
| --- | --- | --- |
| 솔로 1개 인식 | `/solos` (Solo Database) | 업로드 모달 |
| **솔로 대량 인식** | `/solos` | **직렬 큐**. 아래 5-2 참조 |
| 릭 인식 | `/licks`, `/my-licks` | |
| 코드/악보 프로젝트 | 내 코드차트·악보 목록 | 전역 업로드 독(UploadQueueDock)이 진행 표시 |
| 컴핑 수집 | `/comping` (admin) | 솔로 OMR 재사용 |

### 5-2. 솔로 대량 OMR 큐 (중요)

대량 업로드는 **전역 직렬 큐**(`lib/soloOmrQueue.ts`)가 처리한다. 특징:

- **직렬 처리** — 한 건이 끝나야(`COMPLETED`/`FAILED`) 다음을 올린다. OMR 서버 동시요청 보호.
- **페이지 이동해도 계속 돈다** — 러너가 React 밖(모듈 레벨)에 산다.
  (과거에 페이지 안에 있어서 라우트 이동만으로 큐가 조용히 죽은 사고가 있었다.)
- **새로고침 후 재개** — 원본 파일을 IndexedDB에 보관해 두었다가 이어서 처리한다.
  업로드까지 끝난 항목(`publicId` 보유)은 파일 없이 **폴링만** 재개한다.
- **폴링 상한 15분** — 넘으면 "실패(재시도 가능)"로 표시만 하고 다음으로 넘어간다.
- **처리 기록이 남는다** — localStorage에 항목별 성공/실패/중단이 기록된다.

> 탭을 닫거나 노트북이 잠들면 큐는 멈춘다. 브라우저 탭이 살아 있어야 한다.

### 5-3. OMR 모니터 (admin) — `/admin/omr`

관리자용 모니터링 페이지. 우하단 admin 독 → **"OMR 모니터"**.

| 탭 | 보여주는 것 |
| --- | --- |
| **실행 중** | 지금 이 탭이 돌리는 큐의 실시간 진행률 바, `%`, 페이지 `n/총`, job id, `publicId`, 실패 사유 |
| **처리 기록** | localStorage 영속 이력 (상태·제목·`publicId`·등록시각·소요시간·실패사유). `전체` / `COMPLETED` / `FAILED` / `INTERRUPTED` 필터 |
| **publicId 조회** | 리소스 4종 중 선택 → `publicId` 입력 → **5초 폴링**(터미널 상태에서 자동 중단) + **받은 JSON 원본 보기·복사** |

가장 많이 쓰는 흐름은 **"publicId 조회"** 다. 사용자가 "이 악보가 안 된다"고 하면
그 `publicId`를 넣어 `status` / `failureReason` / 실제 받은 JSON을 바로 확인한다.

> `INTERRUPTED`는 서버 실패가 아니라 **프론트 중단**(탭 종료·새로고침)이다.
> 서버는 계속 처리했을 수 있으니, `publicId`가 있으면 조회 탭에서 실제 상태를 확인한다.

### 5-4. curl 로 직접 확인

자격증명은 `.env.local` 에 있다. **값은 절대 출력하거나 커밋하지 않는다.**

1. 자격증명 로드 — `set -a; source .env.local; set +a`
2. 토큰 발급 — `BODY=$(jq -nc --arg u "$JAZZIFY_ADMIN_USER" --arg p "$JAZZIFY_ADMIN_PASS" '{username:$u,password:$p}')`
3. 토큰 추출 — `TOKEN=$(curl -s -X POST https://jazzify.p-e.kr/api/v1/auth/login -H 'Content-Type: application/json' -d "$BODY" | jq -r '.data.accessToken')`
4. **진행 상태 조회** — `curl -s -H "Authorization: Bearer $TOKEN" https://jazzify.p-e.kr/api/v1/sheet-projects/<publicId>/omr-status | jq .`
5. **완료 후 실제 결과** — `curl -s -H "Authorization: Bearer $TOKEN" https://jazzify.p-e.kr/api/v1/sheet-projects/<publicId> | jq .`

최신 계약이 궁금하면 **스펙을 직접 본다**(무인증):

- 스펙 내려받기 — `curl -s https://jazzify.p-e.kr/api/v3/api-docs -o /tmp/jazzify_openapi.json`
- OMR 경로만 보기 — `jq -r '.paths | keys[] | select(test("omr"))' /tmp/jazzify_openapi.json`
- Swagger UI(사람용) — `https://jazzify.p-e.kr/api/swagger-ui/index.html`

### 5-5. 로컬 백엔드로 붙여서 테스트

프론트는 항상 `localhost:5173`, **백엔드만** 바뀐다.

- 운영 백엔드(기본, `https://jazzify.p-e.kr`) — `npm run dev`
- 로컬 백엔드(IntelliJ, `http://localhost:8080`) — `npm run dev:local`

주의:

- 전환하려면 **dev 서버를 껐다 켠다**. vite config는 부팅 시 1회만 로드되어 HMR로는 안 바뀐다.
- **로컬은 계정 DB가 운영과 별개** — 전환 직후 401은 정상이다. 로컬에선 회원가입부터.

## 6. 문제 생겼을 때 확인 순서

| 증상 | 확인 |
| --- | --- |
| 진행률이 안 움직인다 | `/admin/omr` 조회 탭에서 실제 `status` 확인. 프론트 표시만 멈춘 건지 서버가 멈춘 건지 구분. |
| 계속 `PROCESSING` 인 채로 끝나지 않음 | MusicVision → Spring **콜백 유실** 가능성. 프론트에는 안 보이므로 백엔드 로그 확인 필요. |
| `FAILED` 인데 이유를 모르겠다 | `failureReason` 확인 → 없으면 백엔드 `shared/omr` 로그. |
| 큐가 중간에 멈췄다 | 탭이 닫혔거나 새로고침됨(`INTERRUPTED`). 다시 열면 재개된다. |
| 401 / 403 | 토큰 만료. 재로그인 후 재시도(큐는 "실패-재시도 가능"으로 표시). |
| 코드가 엉뚱한 마디에 붙는다 | `measure_alignment.status` 확인. `partial` / `mismatch`면 정상 동작(강제 연결 금지). |

## 7. 현재 한계 — 프론트에서 볼 수 없는 것

`/admin/omr` 로도 **볼 수 없는** 항목이다. 백엔드가 API로 노출하지 않기 때문이다.

| 항목 | 이유 |
| --- | --- |
| 전체 사용자의 OMR 작업 **목록** | 전역 목록 엔드포인트 없음 (`publicId`를 알아야 조회 가능) |
| MusicVision **`job_id`** | 서버 내부에만 존재. 프론트로 내려오지 않음 |
| OMR → 백엔드 **콜백 로그** / 전송 성공 여부 | 서버 간 통신이라 관측 불가 |
| OMR **설정값** (API 키·콜백 URL 등) | 설정 엔드포인트 없음. MusicVision 환경변수로만 관리 |

> 이걸 admin에서 보려면 백엔드에 **신규 엔드포인트가 필요**하다
> (예: `GET /v1/admin/omr/jobs` 목록, job 상세 + 콜백 이력).
> 별도 요구사항 문서로 올릴 사항이다.

## 8. 참고

| 문서 | 내용 |
| --- | --- |
| #28 「OMR 스펙 & 컨트랙트」 | MusicVision 내부 API 전체 계약 (엔드포인트·인증·JSON 스키마·오류) |
| #23 다중 페이지 PDF OMR | PDF 페이지 분해 및 SheetProject 파일 계약 |
| #16 · #19 · #20 · #33 | OMR 관련 요구사항(파이프라인·메타데이터·그랜드스태프·양손 유실) |
