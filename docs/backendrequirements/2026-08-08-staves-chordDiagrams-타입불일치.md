---
title: 2026-08-08 · staves.chordDiagrams 타입 불일치로 다중 보표 저장이 400 1건
type: 백엔드 요구사항
targets: [백엔드]
status: 제안
owner: 최영현
updated: 2026-08-08
---

# 2026-08-08 · staves.chordDiagrams 타입 불일치로 다중 보표 저장이 400

🏷 **범주(태그):** 솔로·릭 저장 스키마

**오늘(2026-08-08 19:01 KST) BR-40~46 배포 직후부터, 코드 다이어그램을 켠 다중 보표 악보의
저장이 400 으로 막혔다.** `StaveRequest.chordDiagrams` 가 배열(`List<Object>`)로 선언돼 있는데
프론트 모델은 **표시 여부 불리언**이라, `true`/`false` 를 보내면 JSON 바인딩 자체가 실패한다.

배포 전에는 `staves` 가 통째로 무시돼(구 스키마) 오류가 없었다 — **이번 배포로 새로 생긴 증상**이다.

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ⬜ 1. `StaveRequest`·`StaveResponse` 의 `chordDiagrams` 를 `Boolean` 으로 정정 (← BR-51)

---

## 0. 실측 근거 — 2026-08-08 운영 서버

**① 프로브** — 존재하지 않는 `publicId` 로 `PUT /v1/solos/{id}` 를 호출해 **바디 검증만** 통과시켰다.
검증을 통과하면 404(솔로 없음), 바디가 안 읽히면 400 이다.

| 요청 `staves[0].chordDiagrams` | 응답 |
|---|---|
| 필드 없음 | `404` · `SOLO_001 솔로를 찾을 수 없습니다` |
| `false` | **`400`** · `GLOBAL_002` · detail `요청 본문 JSON 형식이 올바르지 않습니다` |
| `true` | **`400`** · 위와 동일 |
| `[]` | `404` (통과) |

**② 스키마** — `GET /api/v3/api-docs`

```json
"StaveRequest": { "properties": { "chordDiagrams": { "type": "array", "items": { "type": "object" } } } }
"StaveResponse": { "properties": { "chordDiagrams": { "type": "array", "items": { "type": "object" } } } }
```

**③ 다른 필드는 정상** — 같은 방식으로 확인한 결과 `kind`·`measures`·`bassMeasures`·`instrument`·
`withNotation`·`capo`·`tuningPreset` 은 전부 통과했고, 전체 왕복 대조에서 **유실 0**이었다
(마디 메타 17종·음표 35필드·`bassMeasures`·`accidentalStyle` 포함). 문제는 이 한 필드뿐이다.

**④ 릭도 동일** — `LickCreateRequest.sheetData` 가 같은 `SheetDataRequest` 를 참조하므로
릭 저장에도 그대로 재현된다.

---

## 1. `chordDiagrams` 를 `Boolean` 으로 정정  ⬜ 미시작  (← BR-51)

### 기능 요약
`StaveRequest`·`StaveResponse` 의 `chordDiagrams` 타입을 배열에서 **불리언**으로 바꿔, 다중 보표
악보 저장을 복구하고 사용자의 표시 설정이 보존되게 한다.

### 상황 설명
`chordDiagrams` 는 **"이 보표 위에 코드 다이어그램(기타 프렛 그림)을 그릴지"** 를 뜻하는
**표시 토글**이다. 다이어그램의 내용(운지)은 저장하지 않는다 — 코드 심볼과 튜닝·카포에서
프론트가 매번 계산하기 때문이다(`lib/note/chordDiagram.ts`). 그래서 담을 값이 없고, 프론트 모델도
처음부터 불리언이다:

```ts
// data/sampleMelody.ts — SheetStaff
chordDiagrams?: boolean;   // 코드 다이어그램 표시 여부
```

에디터는 이 값을 켠 보표에서만 필드를 싣는다(`chordDiagrams ? { chordDiagrams: true } : {}`).
즉 **토글을 켠 사용자만 400** 을 맞는다.

### 기능 상세
- **사용자**: 다중 보표(특히 기타 TAB) 악보를 만드는 로그인 사용자
- **권한**: 현행 유지
- **시나리오**: 에디터에서 기타 TAB 보표 추가 → '코드 다이어그램' 체크 → 저장 → 성공, 다시 열면
  체크가 유지된다
- **동작 조건** (`제안`)
  - `StaveRequest.chordDiagrams` : `@Nullable List<Object>` → **`@Nullable Boolean`**
  - `StaveResponse.chordDiagrams` : 같은 방식으로 정정
  - 기존 저장분에 배열이 들어간 행은 없다(오늘 배포 후 이 필드는 400 으로만 끝났고, 프론트는
    현재 우회로 아예 보내지 않는다) — **마이그레이션 불필요**로 판단하나, DB 확인은 백엔드 몫이다
- **검증 조건**
  1. `staves[0].chordDiagrams: true` 로 `POST /v1/solos` → **201**
  2. `GET /v1/solos/{publicId}` → `sheetData.staves[0].chordDiagrams === true`
  3. `false` 로 저장 → 응답에 `false` 가 그대로 온다(`NON_NULL` 이라 의미 있는 false 는 유지)
  4. 릭(`POST /v1/licks`)도 1~3 과 동일
- **기대 결과 및 완료 기준**:
  - [ ] `chordDiagrams: true/false` 저장이 400 없이 성공
  - [ ] 왕복 후 값이 보존됨
  - [ ] 스펙(`/v3/api-docs`)의 타입이 `boolean` 으로 표시됨

---

## 참고 — 프론트 쪽 임시 조치 (백엔드 수정 후 되돌림)

저장 전체가 막히는 것보다 표시 토글 하나를 못 싣는 쪽이 낫다고 보고, 프론트에 **임시 가드**를
넣었다(`lib/note/sheetStaves.ts::normalizeSheetNotes`):

- **보낼 때**: `chordDiagrams` 가 불리언이면 **필드를 뺀다** → 저장은 성공하고, 표시 설정만 유실된다
- **받을 때**: 배열이 오면 `length > 0` 으로 읽는다 — JS 에서 `[]` 는 truthy 라 그냥 두면
  "빈 배열 = 켜짐"으로 오독된다

**백엔드가 타입을 고치면 이 분기는 삭제한다.** 그때까지는 사용자가 체크해도 다시 열면 꺼져 있다.
