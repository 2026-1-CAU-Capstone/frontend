---
title: 2026-07-15 · RAG·화성 검색 요구사항 3건
type: 기능 명세
targets: [백엔드]
status: 제안
owner: 최영현
updated: 2026-07-15
---

# 2026-07-15 · RAG·화성 검색 요구사항 3건

🏷 **범주(태그):** RAG·화성 검색(HarmoRAG)
코드 컨텍스트 기반 쿼리 분해·검색 융합·진단 계약. Jazzify의 핵심 차별점(모호한 코드의 복수 해석).

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ⬜ 1. `chordContext` 객체 전달 → 모호성 기반 쿼리 분해 활성화 (← BR-18)
- ⬜ 2. RAG 진단 마커 옵트인화 (← BR-13)
- ⬜ 3. RAG 디버그 필드 계약 확정 (← BR-21)

---

## 1. `chordContext` 객체 전달 → 쿼리 분해 활성화  ⬜ 미시작  (← BR-18)

### 기능 요약
채팅 요청의 **구조화된 `chordContext` 객체**를 받아 RAG agent에 넘기고, 모호성 게이팅 기반 sub-query 분해를 실제로 켠다.

### 상황 설명
설계상 HarmoRAG는 룰엔진 태깅 → `ambiguity ≥ 0.5`면 질문을 4~8개 sub-query로 분해 → 벡터 검색 → RRF 융합 → Claude로 흐른다. 그런데 RAG agent의 `decompose_query`는 `function`·`secondary_dominant`·`patterns_detected` 같은 **구조화 필드**를 읽어야 하는데, 프론트는 지금 사람이 읽는 긴 문자열(`chordContextText`) 하나만 보낸다 → agent가 읽을 필드가 없어 **코드 특화 쿼리 분해가 사실상 죽어 있다**(단일 쿼리 검색에 가깝게 동작). 프론트는 이미 객체(`chordContext`)를 보낼 준비가 돼 있다.

### 기능 상세
- **사용자**: 로그인 사용자
- **권한**: 로그인
- **시나리오**: 모호한 코드(장조 진행 속 차용 `iv` 등)로 질문 → 서버가 `chordContext` 객체 수신 → ambiguity 게이팅 → sub-query 분해 → 복수 해석 답변
- **동작 조건**
  1. `/v1/chat/*/stream` 요청 body의 `chordContext`(객체)를 받아 RAG agent에 그대로 전달. `제안`:
     ```jsonc
     POST /v1/chat/chord-project/stream
     {
       "message": "여기 F-7은 왜 나온 거야?",
       "useRag": true,
       "chordContextText": "Bar 21: F-7 | degree=iv | ...",   // 지금도 보냄 (유지)
       "chordContext": {                                        // ★ 새로 수용
         "song": "Autumn Leaves",
         "focus": { "bar": 21, "symbol": "F-7" },
         "function": "SD", "secondaryDominant": null,
         "patternsDetected": ["modal_interchange"],
         "ambiguityScore": 0.89,
         "interpretations": ["subdominant minor", "color chord"]
       }
     }
     ```
  2. `ambiguityScore ≥ 0.5` 게이팅 + sub-query 분해(4~8개)를 실제로 켠다.
  3. 분해된 쿼리를 `RAG_DEBUG.queries`에 실어 보낸다(디버그 패널 검증용).
- **검증 조건**: `ambiguityScore < 0.5` 평범한 코드는 단일 쿼리로 동작(불필요 비용 없음).
- **기대 결과 및 완료 기준**
  - [ ] 모호한 코드로 질문 시 디버그 패널에 sub-query 2개 이상 표시
  - [ ] 답변이 복수 해석을 근거와 함께 제시
  - [ ] 저모호도 코드는 단일 쿼리 유지

> 문서 정합성: 발표·사업계획서의 HarmoRAG 도식은 이 흐름이 **런타임에 돈다**고 그려져 있다. 본 항목 + 음악분석 온라인 API를 구현하면 도식이 사실이 되고, 아니면 문서를 "사전 분석 결과 활용"으로 고쳐야 한다.

---

## 2. RAG 진단 마커 옵트인화  ⬜ 미시작  (← BR-13)

### 기능 요약
`RAG_DEBUG` 진단 블록을 기본 미포함(요청 시에만)으로 바꾼다.

### 상황 설명
`/v1/chat/global/stream` 응답 앞에 `RAG_DEBUG` 블록이 **항상** 포함된다(초기엔 본문 노출 사고도 있었고 지금은 프론트 파서가 분리). 대역폭 낭비 + 파서 없는 외부 클라이언트에서 **다시 노출될 위험**.

### 기능 상세
- **사용자**: 로그인 사용자, 외부 API 소비자
- **권한**: —
- **시나리오**: 일반 요청 → 진단 블록 없음 / 디버그 요청 → 진단 블록 포함
- **동작 조건**: 요청 플래그/헤더로 **옵트인**(기본 미포함). 예: `?debug=true` 또는 `X-Rag-Debug: 1`.
- **검증 조건**: 기본 응답에 `RAG_DEBUG` 미포함, 플래그 시 포함.
- **기대 결과 및 완료 기준**
  - [ ] 진단 마커 기본 off, 옵트인 시 on

---

## 3. RAG 디버그 필드 계약 확정  ⬜ 미시작  (← BR-21)

### 기능 요약
진단 블록을 넣을 때 그 안의 필드를 항상 채워 내려보내고 스키마를 고정한다. (BR-13은 "넣을지", 이 항목은 "넣는다면 무엇을")

### 상황 설명
프론트(`api/harmorag.ts`)는 아래 필드를 전부 optional로 선언해 뒀다(백엔드가 채워주는지 미확정). 비면 디버그 패널의 쿼리 분해·RRF 시각화가 반쯤 빈다. 유튜브 인용 딥링크는 `source_type='youtube'`+`video_id`+`start_sec`이 채워져야 동작.

### 기능 상세
- **사용자**: 로그인 사용자(디버그 패널)
- **권한**: —
- **시나리오**: 디버그 켠 응답 → 아래 필드가 채워져 옴
- **동작 조건**: 다음 필드를 항상 채워 내려보내고 스키마를 API 문서에 고정:
  | 필드 | 의미 |
  |---|---|
  | `status` | `connected`/`offline` — 이번 턴 RAG 실제 동작 여부 |
  | `top_k`, `total_retrieved` | 검색 파라미터·결과 수 |
  | `fusion`, `rrf_k` | 융합 방식·파라미터 |
  | `rrf_score` (청크별) | 정렬 기준 점수 |
  | `matched_queries[]` (청크별) | 그 청크를 회수한 모든 sub-query |
  | (youtube) `source_type`,`video_id`,`start_sec` | 인용 딥링크용 |
  - RAG 미실행 턴은 `status: "offline"` 명시.
- **검증 조건**: 디버그 패널의 쿼리 분해·RRF 시각화·유튜브 딥링크가 모두 채워짐.
- **기대 결과 및 완료 기준**
  - [ ] 위 필드 항상 포함 + 스키마 API 문서 고정
