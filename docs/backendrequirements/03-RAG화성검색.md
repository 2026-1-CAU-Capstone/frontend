---
title: 2026-07-15 · RAG·화성 검색 요구사항 1건
type: 백엔드 요구사항
targets: [백엔드]
status: 제안
owner: 최영현
updated: 2026-07-29
---

# 2026-07-15 · RAG·화성 검색 요구사항 1건

> 2026-07-29 정리: 완료 확인된 2건(RAG 진단 마커 옵트인화 · RAG 디버그 필드 계약 확정)을 제거하고 미완료만 남김.

🏷 **범주(태그):** RAG·화성 검색(HarmoRAG)
코드 컨텍스트 기반 쿼리 분해·검색 융합·진단 계약. Jazzify의 핵심 차별점(모호한 코드의 복수 해석).

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- 🟡 1. `chordContext` 객체 전달 → 모호성 기반 쿼리 분해 활성화 (← BR-18) — 백엔드 로직은 배포 완료, **운영에서 HTTP 500 발생해 사용 불가**

> 항목 번호는 BR 추적성을 위해 원래 번호를 유지한다(제거된 2·3번은 결번).

---

## 1. `chordContext` 객체 전달 → 쿼리 분해 활성화  🟡 진행중(런타임 버그로 사용 불가)  (← BR-18)

### 기능 요약
채팅 요청의 **구조화된 `chordContext` 객체**를 받아 RAG agent에 넘기고, 모호성 게이팅 기반 sub-query 분해를 실제로 켠다.

### 상황 설명
설계상 HarmoRAG는 룰엔진 태깅 → `ambiguity ≥ 0.5`면 질문을 4~8개 sub-query로 분해 → 벡터 검색 → RRF 융합 → Claude로 흐른다. 프론트는 이미 객체(`chordContext`)를 보낼 준비가 돼 있다.

**2026-07-29 실측 — 구현은 됐으나 운영에서 못 쓴다.**
- ✅ **백엔드 로직은 구현·배포 완료**: `ChatStreamRequest` 가 `chordContext` 를 JsonNode 로 수용하고, `RagAgent` 에 `AMBIGUITY_GATE = 0.5` 게이팅이 들어가 있다(커밋 `824bbc3`).
- ❌ **그러나 운영에서 `chordContext` 를 실으면 HTTP 500 `GLOBAL_001` 이 난다.** 값 종류(객체 / 문자열 / snake_case 키)와 `useRag` 여부에 **무관**하게 재현된다. `chordContext: null` 로 보내면 200 정상 → 이 필드를 채우는 순간 요청이 죽는 것.
- 결과적으로 **런타임에서 이 기능을 사용할 수 없다.** 프론트도 아직 객체를 보내지 않는다(`src/lib/chat/runChatStream.ts:99` 가 `chordContextText` 만 전송).

**→ 남은 일은 이 500 버그 수정이다.** 수정되면 프론트에서 객체 전송으로 전환한다.

### 기능 상세
- **사용자**: 로그인 사용자
- **권한**: 로그인
- **시나리오**: 모호한 코드(장조 진행 속 차용 `iv` 등)로 질문 → 서버가 `chordContext` 객체 수신 → ambiguity 게이팅 → sub-query 분해 → 복수 해석 답변
- **동작 조건**
  1. `chordContext` 가 채워진 요청이 **500 없이 정상 처리**되어야 한다. 아래 페이로드로 재현·검증 가능:
     ```jsonc
     POST /v1/chat/chord-project/stream
     {
       "message": "여기 F-7은 왜 나온 거야?",
       "useRag": true,
       "chordContextText": "Bar 21: F-7 | degree=iv | ...",   // 지금도 보냄 (유지)
       "chordContext": {                                        // ★ 이 필드를 채우면 현재 500
         "song": "Autumn Leaves",
         "focus": { "bar": 21, "symbol": "F-7" },
         "function": "SD", "secondaryDominant": null,
         "patternsDetected": ["modal_interchange"],
         "ambiguityScore": 0.89,
         "interpretations": ["subdominant minor", "color chord"]
       }
     }
     ```
  2. 수용 가능한 키 표기(camelCase / snake_case)와 값 타입을 확정해 문서화한다 — 지금은 어떤 형태로 보내도 500이라 계약을 알 수 없다.
  3. 분해된 쿼리를 `RAG_DEBUG.queries`에 실어 보낸다(디버그 패널 검증용).
- **검증 조건**: `chordContext` 를 채운 요청이 200 스트림으로 응답. `ambiguityScore < 0.5` 평범한 코드는 단일 쿼리로 동작(불필요 비용 없음).
- **기대 결과 및 완료 기준**
  - [ ] `chordContext` 를 채운 요청이 500 `GLOBAL_001` 없이 200 응답
  - [ ] 모호한 코드로 질문 시 디버그 패널에 sub-query 2개 이상 표시
  - [ ] 답변이 복수 해석을 근거와 함께 제시
  - [ ] 저모호도 코드는 단일 쿼리 유지

> 문서 정합성: 발표·사업계획서의 HarmoRAG 도식은 이 흐름이 **런타임에 돈다**고 그려져 있다. 본 항목 + 음악분석 온라인 API를 구현하면 도식이 사실이 되고, 아니면 문서를 "사전 분석 결과 활용"으로 고쳐야 한다.

> 잔여: `RAG_DEBUG` 페이로드 스키마가 OpenAPI 에 정의돼 있지 않음. (필드 계약 자체는 구현·검증 완료 — 문서화만 미완)
