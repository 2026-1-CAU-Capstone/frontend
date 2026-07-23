# 백엔드 요구사항 문서 작성·업로드 지침 (단일)

> 백엔드 요구사항 문서를 **쓰고 → 문서서버(`doc.jazzify.p-e.kr`)에 올리는** 데 필요한 모든 것.
> 백엔드 요구사항은 **프론트(최영현) 혼자** 올린다. 새 문서는 날짜별로 계속 쌓인다.
> (전역 `CLAUDE.md`가 백엔드 요구사항 문서를 쓸 때 이 파일을 참조한다.)

---

## 1. 파일 위치·이름
- 위치: `docs/backendrequirements/`
- 파일명: 자유(예: `2026-08-01-인증-kakao.md`). 서버 제목은 front-matter `title`에서 온다.

## 2. front-matter (필수)

```yaml
---
title: YYYY-MM-DD · <설명적 제목> N건   # ★ 생성날짜 맨 앞 + 내용 설명(예: "인증 관련 요구사항 2건"). 범주명을 제목으로 쓰지 말 것.
type: 백엔드 요구사항                     # 요구사항 = 항상 "백엔드 요구사항" (documentTypeId=5). 기능 명세(4)가 아님
targets: [백엔드]                       # OMR 연동 포함 시 [백엔드, OMR]
status: 제안                            # 제안 → 합의 → 구현중 → 완료 / 폐기
owner: 최영현
updated: YYYY-MM-DD
---
```

- **제목**: 날짜가 맨 앞, 그 뒤는 "무엇에 대한 몇 건"인지 설명. 범주는 제목이 아니라 **본문 태그(§4)** 로 단다.
- front-matter는 업로드 시 API 필드로 매핑된다(§6).

## 3. 지켜야 할 규칙
1. **문서 먼저.** 백엔드에 요청할 게 있으면 코드가 아니라 이 문서로 남긴다.
2. **본문 형식(§5)을 지킨다.** 기능마다 6개 항목을 채운다.
3. **제외**: ① 백엔드 요청과 무관한 프론트 구현 내용, ② 백엔드 코드/DB 구현 지시, ③ 미합의 기술 선택·구현 방식. (외부 API 요청/응답 **계약**은 프론트가 호출할 인터페이스이므로 `제안`으로 명시해 유지 가능)
4. **상태(§4)를 항목마다 단다.** 백엔드가 진행하며 갱신.
5. 정해지지 않은 내용은 생략하되 **"미정"이라 명시**한다.

## 4. 본문 상단 (범주 태그 + 진행 현황)

```markdown
# YYYY-MM-DD · <설명적 제목> N건

🏷 **범주(태그):** <범주명>
<한 줄 요약>

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ⬜ 1. <기능> (← BR-x)
- ⬜ 2. <기능> (← BR-y)
```

**범주(태그) 목록** — grouping용. 필요하면 새로 추가:
`인증·계정` · `AI 채팅·LLM` · `RAG·화성 검색` · `음악 분석 파이프라인` · `미디어 추론` · `콘텐츠·라이브러리·스토리지`

## 5. 기능별 본문 형식 (필수 6항목)

기능(항목)마다 아래를 채운다. (출처: 백엔드 양식 = 서버 문서 #2)

```markdown
## 1. <기능명>  ⬜ 미시작  (← BR-x)

### 기능 요약
한 줄로 무엇을 만드는가.

### 상황 설명
지금 무슨 일이 벌어지고 있고, 왜 문제인가.

### 기능 상세
- **사용자**: 일반 사용자 / 관리자 / 비로그인 등
- **권한**: 로그인 필요 / 본인 것 / 불필요
- **시나리오**: 사용자 행동 → 기대 흐름
- **동작 조건**: 충족돼야 하는 조건. (외부 API 계약이 있으면 `제안` JSON으로)
- **검증 조건**: 어떻게 테스트/판정하는가
- **기대 결과 및 완료 기준**:
  - [ ] 완료 판정 체크리스트
```

## 6. 자동 업로드 (문서서버 API)

세션 로그인 + POST는 **`X-CSRF-TOKEN` 헤더**, 생성은 **multipart/form-data**.

**스크립트 사용** (`scripts/doc-upload.sh` — front-matter 파싱해 업로드):
```bash
# 새 문서 생성
JAZZIFY_DOCS_ID=.. JAZZIFY_DOCS_PW=.. scripts/doc-upload.sh docs/backendrequirements/<파일>.md
# 기존 문서 수정 (마지막 인자 = 서버 문서 id)
JAZZIFY_DOCS_ID=.. JAZZIFY_DOCS_PW=.. scripts/doc-upload.sh docs/backendrequirements/<파일>.md <id>
```
(자격증명은 `.env.local`의 `JAZZIFY_DOCS_ID` / `JAZZIFY_DOCS_PW`)

**DocumentForm 필드** (multipart): `title`★ · `markdownContent`★(본문, front-matter 제외) · `documentTypeId`★ · `targetTeamIds[]`

**ID 매핑 (확정)**
| documentTypeId | 팀 ID(targetTeamIds) |
|---|---|
| 1 = AI 문서 · 2 = 기술 정리 · 3 = 기타 · 4 = 기능 명세 · **5 = 백엔드 요구사항** ← 요구사항 | 1 = 백엔드 · 2 = 프론트 · 3 = AI · 4 = OMR |

front-matter 매핑: `type→documentTypeId`(**요구사항=5 "백엔드 요구사항"**), `targets→targetTeamIds`, 본문→`markdownContent`.

**엔드포인트**: 생성 `POST /documents/new` · 수정 `POST /documents/{id}/edit` · 원문 `GET /documents/{id}/markdown` · 로그인 `POST /auth/login`(form: email/password/_csrf).

**주의(스크립트에 반영됨)**: ① CSRF는 `X-CSRF-TOKEN` **헤더**로. ② 본문은 `-F "markdownContent=<파일"`(커맨드라인 값이면 잘림). ③ front-matter 제거 awk는 플래그식(`f{print} /^---$/{c++; if(c==2) f=1}`).

---

## 7. 참고
- 초기 6개 예시: `docs/backendrequirements/01~06`(서버 #6~#11). 이 지침의 양식 그대로 따른 샘플.
- 원본 상세(레거시): `docs/백엔드_요구사항_상세.md`(BR-1~22, 위 6개로 재편).
- 이 파일은 옛 `AI_COLLAB_GUIDE.md`(협업 규칙) + `Backend_AI_Docs.md`(본문 양식)를 합쳐 **대체한 단일본**이다. 원본 2개는 `docs/archive/`로 이동. 백엔드 본문 양식의 원천 오너는 **문서서버 문서 #2(안필온)**.
