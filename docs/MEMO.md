# MEMO — API 타입: 손글씨 → 생성 스키마 브릿지 (2026-07-15)

## 왜
백엔드 응답 모양을 손으로 적은 타입(손글씨)이 실제와 어긋나면 TS가 못 잡고 런타임에 터진다.
실제 사고: `ChordInfo.chord`를 `string`으로 적어놨는데 백엔드가 코드 없는 마디에 `null`을 보내 OMR 화면이 깨짐.

## 왜 "그냥 생성 타입으로" 못 했나
스펙(`/api/v3/api-docs`)이 **110개 스키마 중 8개만 `required`** 선언 → `npm run api:types`가 **전 필드를 optional**로 뽑음.
그대로 alias하면 `publicId`(기본키)조차 `string | undefined`가 되어 모듈당 ~26개 false-positive(실측). 진짜 nullable(`chord`)이 노이즈에 묻힘.

## 결정: 지금 프론트 브릿지 + 나중 백엔드
- **지금(프론트 단독)**: 생성 스키마에서 파생하되 "백엔드가 항상 주는 필드"만 `Required`로 좁히고, 진짜 nullable만 경계에서 명시.
  → 스펙이 타입 원천(필드 rename/삭제 시 컴파일 에러 = 드리프트 감지) + 사용성 유지 + `chord` null 시그널 보존.
- **나중(백엔드 = 정배)**: nullability는 백엔드의 계약이라 프론트가 추측하는 건 잔여 리스크. → 요구사항 **BR-23**(문서서버 #13)으로 "Response DTO에 `required`/`nullable` 선언" 접수함.

## 한 일 (tsc -b 0 에러)
브릿지 적용(생성 스키마 파생) — 순수 응답-미러 모듈만:
- `chordProjects.ts` — ChordProject/ChordInfo/…. **`chord: string | null`로 버그 원인 타입 수정.**
- `sheetProjects.ts` — SheetProject/SheetProjectOmrStatus
- `chat.ts` — ChatSummary/ChatMessage/ChatDetail
- `auth.ts` — 내부 TokenResponse/SignUpResponse
- `storageFiles.ts` — StorageFile

손글씨 유지(의도적): `solos.ts`·`licks.ts`(프론트가 스펙보다 풍부한 뷰모델), `claude.ts`·`onsetSuggest.ts`·`harmorag.ts`(외부/모의 API), 각종 request·union·draft 타입.

## BR-23 완료되면 (후속 트리거)
백엔드가 스펙에 `required`/`nullable`을 넣으면:
1. `npm run api:types` 재생성
2. 브릿지의 `Required<Omit<…>> & { … }` override를 걷어내고 **순수 alias**(`type X = components['schemas']['XResponse']`)로 축소
3. 그러면 nullability 손판단까지 소멸 → 완전히 스펙 주도
