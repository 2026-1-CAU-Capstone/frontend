---
title: 2026-07-15 · API 계약·스키마 위생 요구사항 1건
type: 기능 명세
targets: [백엔드]
status: 제안
owner: 최영현
updated: 2026-07-15
---

# 2026-07-15 · API 계약·스키마 위생 요구사항 1건

🏷 **범주(태그):** API 계약·스키마 위생
OpenAPI 스펙이 프론트 타입 생성의 유일 원천이 되도록, Response DTO의 `required`/`nullable`을 정확히 선언한다.

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ⬜ 1. Response DTO `required`/`nullable` 스펙 선언 (← BR-23)

---

## 1. Response DTO `required`/`nullable` 스펙 선언  ⬜ 미시작  (← BR-23)

### 기능 요약
`/api/v3/api-docs`의 응답 스키마에 "항상 오는 필드(`required`)"와 "null일 수 있는 필드(`nullable`)"를 정확히 표기한다.

### 상황 설명
프론트는 `openapi-typescript`로 스펙에서 타입을 자동 생성(`src/api/schema.d.ts`)해 **백엔드 스펙을 타입의 유일 원천**으로 삼으려 한다(손으로 타입을 적으면 드리프트로 실제 버그가 남 — 예: `ChordInfo.chord`를 `string`으로 적어 뒀는데 백엔드가 `null`을 보내 런타임 오류).

그런데 현재 스펙은 **110개 스키마 중 8개에만 `required` 배열**이 있고, Response DTO(`ChordProjectResponse`·`ChordInfoResponse`·`AnalysisResultResponse` 등)는 `required`도 `nullable`도 없다. 결과로 생성 타입이 **모든 필드를 optional(`?:`)로** 뽑는다:

- `publicId`(기본키)·`title`·`keySignature`처럼 **항상 오는 필드**조차 `string | undefined`가 되어, 프론트가 값을 쓸 때마다 불필요한 `!`/`?? ''` 방어를 강요당한다(실측: 코드차트 한 모듈만 생성 타입으로 바꿔도 소비처에서 대부분 false-positive인 컴파일 에러 26건).
- 반대로 **진짜 null인 필드**(`chord`, `omrFailureReason`, `lastAnalyzedAt` 등)와 "항상 오는 필드"를 스펙만 봐선 구분할 수 없어, 진짜 null 시그널이 노이즈에 묻힌다.

즉 스펙 품질(`required`/`nullable` 미표기) 때문에 생성 타입을 신뢰할 수 없어, 자동 타입 생성의 이점이 죽어 있다.

### 기능 상세
- **사용자**: 프론트(스펙 소비자), 외부 API 소비자
- **권한**: —
- **시나리오**: 백엔드가 Response DTO에 `required`/`nullable`을 정확히 표기 → 프론트 `npm run api:types` → 생성 타입이 실제 계약과 일치 → 손글씨 타입 폐기·자동 타입으로 강제 전환
- **동작 조건**
  1. **항상 존재하는 응답 필드**는 스펙에 `required`로 표기. (springdoc `제안`: 필드에 `@Schema(requiredMode = REQUIRED)`, 또는 non-null 기본값을 required로 취급하도록 springdoc 설정)
  2. **null 가능 필드**는 `nullable: true`로 표기. (`제안`: `@Schema(nullable = true)` / `@Nullable`) — 최소한 아래 확인된 것들:
     - `ChordInfoResponse.chord` (코드 없는 마디), `.analysis` (분석 전)
     - `ChordProjectResponse.omrFailureReason` (실패 없을 때)
     - `AnalysisResultResponse.lastAnalyzedAt` (분석 전)
  3. 결과 스펙에서 `required` 배열이 각 Response DTO에 존재하고, null 가능 필드는 `nullable: true`를 가진다.
- **검증 조건**
  - `GET /api/v3/api-docs` → `ChordProjectResponse` 등 Response DTO에 `required: [...]`가 있고, 위 null 필드에 `nullable: true`가 있다.
  - 프론트 `npm run api:types` 후 생성 타입에서 `title: string`(required, `?` 없음)이고 `chord?: string | null`(nullable)로 나온다.
- **기대 결과 및 완료 기준**
  - [ ] Response DTO의 항상 오는 필드가 스펙 `required`에 포함
  - [ ] null 가능 필드가 스펙 `nullable: true`로 표기
  - [ ] 프론트가 손글씨 API 타입을 폐기하고 생성 타입으로 전환 가능

> 프론트 후속(이 요구사항 완료 시): `src/api/*.ts`의 손글씨 인터페이스를 생성 타입(`components['schemas']['*Response']`) alias로 교체. 완료 전까지는 손글씨 타입을 유지한다(스펙 품질이 낮은 지금 강제 전환하면 기본키까지 `undefined`가 되어 오히려 안전성이 떨어짐).
