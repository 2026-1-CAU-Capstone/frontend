---
title: 2026-07-22 · 악보 sheetData 필드 보존(조표무시 등) 2건
type: 백엔드 요구사항
targets: [백엔드]
status: 완료
owner: 최영현
updated: 2026-08-08
---

# 2026-07-22 · 악보 sheetData 필드 보존(조표무시 등) 2건

🏷 **범주(태그):** 콘텐츠·라이브러리·스토리지

> 2026-08-08 정리: **2건 모두 완료.** 백엔드가 BR-40~46(문서 #44)으로 구현해 운영 배포까지 끝났고
> (2026-08-08 19:01 KST 머지 → 약 9분 뒤 반영), 프론트도 연동을 마쳤다(기능명세 F7.36·F7.37).
> 운영 왕복 실측: **유실·불일치 0건**, `sheetData` 안 `null` 0개(NON_NULL), 빈 마디 `{"notes":[]}` 왕복 성공,
> `accidentalStyle:"explicit"` 보존 확인(소리 `[[64,68,71,73],[64,63]]` 저장 전후 동일).
> 후속 결함 1건은 별도 문서로 분리했다 — **#54 (BR-51, P1) `staves.chordDiagrams` 타입 불일치**.

솔로/릭 저장 API의 `sheetData` 타입 스키마(`SheetDataRequest`/`Response`·`MeasureRequest`·`NoteInfoRequest`)가 프론트가 보내는 필드의 **일부만** 정의해, 나머지를 저장 시 **조용히 버린다**. 그 결과 조표무시(임시표 의미론)·꾸밈음·옥타브·아티큘레이션·도돌이/볼타·양손 파트 등이 왕복에서 유실된다. `sheetData`는 프론트 렌더러/플레이어가 그대로 소비하는 페이로드이므로, **보낸 필드를 손실 없이 저장·반환**해야 한다.

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ✅ 1. sheetData 임시표 의미론(accidentalStyle) 저장 (← BR-33)
- ✅ 2. sheetData/measure/note 스키마 전면 보존(pass-through) (← BR-34)

---

## 0. 실측 근거 — 2026-07-25 운영 서버 왕복 테스트

아래 두 요구사항(BR-33·BR-34)의 근거다. `POST /v1/solos` → `GET /v1/solos/{id}` 로 직접 확인했다(테스트 솔로는 삭제 완료). **요청은 HTTP 200 성공으로 응답하는데** 필드가 사라진다 — 에러가 없어 사용자는 나중에 다시 열어봐야 유실을 안다.

**보낸 값**
```jsonc
"sheetData": {
  "title":"__diag", "composer":"TestComposer", "genre":"Bebop",
  "key":"C", "timeSignature":"4/4", "tempo":120,
  "accidentalStyle":"explicit",
  "measures":[{ "chord":"D-7  G7",
    "notes":[{ "keys":["c/5"], "duration":"q",
               "chord":"Cmaj7", "articulations":["staccato"], "dynamics":"mf" }] }],
  "bassMeasures":[{ "notes":[{ "keys":["c/3"], "duration":"q" }] }]
}
```

**저장 후 결과**

| 항목 | 결과 |
|---|---|
| 마디 코드 `measures[].chord` (`"D-7  G7"`) | ✅ 보존 |
| **음표별 코드** `notes[].chord` (`"Cmaj7"`) | ❌ **유실** |
| 아티큘레이션 `["staccato"]` · 셈여림 `"mf"` | ❌ 유실 |
| **양손 왼손 파트** `bassMeasures` | ❌ **유실 (null)** |
| `composer` · `genre` · `accidentalStyle` | ❌ 유실 (null) |

저장 후 `sheetData` 최상위 키가 `["key","measures","tempo","timeSignature","title"]` 만 남는다.

> ⚠️ `bassMeasures` 유실은 **문서 #20**(OMR 그랜드스태프 파싱, BR-32)과 직결된다 — OMR이 대보표를 제대로 파싱해 왼손을 채워도, 아래 BR-34가 해결되지 않으면 **저장 단계에서 다시 버려진다.** BR-34를 먼저 처리해야 BR-32의 결과가 남는다.

---

## 1. sheetData 임시표 의미론(accidentalStyle) 저장  ✅ 완료  (← BR-33)

### 기능 요약
악보의 임시표 해석 방식(`sheetData.accidentalStyle`: `'explicit' | 'score'`)을 저장·반환한다.

### 상황 설명
어떤 원본 악보는 **C키가 아닌데도 조표를 그리지 않고** 마디 안의 ♯/♭만으로 음정을 해결한다(재즈 채보에 흔함). 프론트에 이를 위한 "조표 무시" 토글이 있고, 켜면 `sheetData.accidentalStyle='explicit'`로 직렬화된다 — 조표를 무시하고 마디 내 임시표(마디 내 상속 포함)만으로 **음정을 판단(소리·표기 양쪽)**한다. 이는 표시만이 아니라 **재생 피치가 달라지는** 값이라, 뷰어(학생용 포함)·플레이어가 같은 해석을 하려면 데이터와 함께 저장돼야 한다.
현재 `SheetDataRequest`/`SheetDataResponse`에 이 필드가 없어, PUT으로 보내도 역직렬화에서 **탈락**한다. 실측: 솔로 `Bolivia (1) (합본)`(publicId `94bf0632-74be-4477-b681-fc79f7ad0ea6`)에 `accidentalStyle:'explicit'`을 PUT → GET 하면 값이 사라진다(저장된 `sheetData` 키 = `key, measures, tempo, timeSignature, title`뿐). 이 솔로는 샵을 음표에 직접 표기한 explicit 인코딩이라, 조표무시가 붙지 않으면 조표가 bare음을 잘못 변조해 재생/표기가 어긋난다.

### 기능 상세
- **사용자**: 악보를 만들고 저장하는 사용자·관리자
- **권한**: 로그인 필요(본인/관리자 솔로·릭)
- **시나리오**: 에디터에서 조표무시 ON → 저장 → 다시 로드/뷰어 표시/재생 시에도 조표무시가 유지돼 동일하게 해석
- **동작 조건**: `sheetData`에 아래 필드를 그대로 저장·반환한다(해석은 프론트가 함, 백엔드는 보관만).
  - `제안` — `SheetDataRequest`/`SheetDataResponse`에 필드 추가:
    ```json
    { "accidentalStyle": "explicit" }   // 값: "explicit" | "score" | null(생략=기본 score)
    ```
- **검증 조건**: `PUT /v1/solos/{id}` 또는 `/v1/licks`에 `sheetData.accidentalStyle="explicit"` 포함 → `GET`으로 되받아 `sheetData.accidentalStyle === "explicit"` 확인. 값이 없거나 생략 시 `null`/부재로 반환(기본 score).
- **기대 결과 및 완료 기준**:
  - [ ] `SheetDataRequest`/`Response`에 `accidentalStyle`(nullable 문자열, `explicit`|`score`) 포함
  - [ ] PUT→GET 왕복에서 값 보존(빈 값이면 부재로 유지)
  - [ ] 기존 솔로(값 없음)는 영향 없음(하위호환)

---

## 2. sheetData/measure/note 스키마 전면 보존(pass-through)  ✅ 완료  (← BR-34)

### 기능 요약
`sheetData`의 **모든** 필드(악보/마디/음표 레벨)를 저장 시 손실 없이 보존·반환한다.

### 상황 설명
BR-33의 `accidentalStyle`은 빙산의 일각이다. 현재 타입 스키마가 프론트 대비 다수 필드를 정의하지 않아 **저장 시 통째로 버린다**(미지 필드 역직렬화 탈락). 아래 기능들이 솔로/릭 저장 왕복에서 **조용히 유실**된다 — 도돌이·볼타·D.C./D.S./Coda, 꾸밈음, 옥타브(8va/8vb), 아티큘레이션·꾸밈·강약·슬러·헤어핀, 스쿱/폴, 곡 중간 박자/조/클레프/템포 변화, 양손(그랜드 스태프) 왼손 파트, 멀티파트 음색 등. 재생·표기 정확도(명세 F7.11 양손, P-3 반복 전개, 꾸밈음 F7.12 등)와 직결된다.

현재 스키마가 **받는** 필드:
- `SheetDataRequest`: `key, measures, tempo, timeSignature, title`
- `MeasureRequest`: `chord, notes`
- `NoteInfoRequest`: `keys, duration, dotted, accidentals, tie, gliss, tuplet, beamBreak`

프론트가 **보내지만 버려지는** 필드:
- **sheetData**: `composer, genre, instrument, isDrum, bassMeasures`(+ BR-33의 `accidentalStyle`)
- **measure(반복·진행)**: `repeatStart, repeatEnd, volta, navigation, bracket`
- **measure(곡 중간 변화)**: `timeSignature, key, clef, anacrusis, tempo`
- **note(꾸밈·표현)**: `grace, graceSlash, ottavaStart, ottavaEnd, articulations, ornaments, dynamics, fermata, slurStart, slurStop, hairpinStart, hairpinStop, scoop, fall, ghost`
- **note(리듬·빔·스템·타이)**: `tupletNormal, tupletBracket, noBeam, restInBeam, stem, tieContinuation, chord`

### 기능 상세
- **사용자**: 악보를 저장·열람·재생하는 사용자·관리자
- **권한**: 로그인 필요
- **시나리오**: 반복/볼타/꾸밈음/옥타브/양손 등이 있는 악보를 저장 → 재로딩·뷰어·재생에서 원본 그대로 복원
- **동작 조건**: `sheetData`는 프론트 렌더러/플레이어 전용 페이로드다. 백엔드는 **해석하지 않고 보낸 구조 그대로 저장·반환**하면 된다.
  - `제안`(택1, 구현 방식은 백엔드 판단):
    - (A) `sheetData`를 **미지 필드 보존 JSON(pass-through)** 로 저장(프론트 타입이 단일 소스, 이후 필드 추가에도 무無수정).
    - (B) 타입 스키마를 위 "버려지는 필드" 전체로 확장해 1:1 미러링.
  - 프론트 타입 계약 원천: `frontend/src/data/sampleMelody.ts`의 `NoteSheetData`/`MeasureInfo`/`NoteInfo`.
- **검증 조건**: 각 기능 대표 필드를 포함한 `sheetData`를 PUT→GET 왕복해 바이트 동일 확인. 예) `measures[i].repeatStart`, `measures[i].notes[j].grace`, `measures[i].notes[j].ottavaStart`, `sheetData.bassMeasures[i].notes` 보존. 위 §0 페이로드를 그대로 재현해 5개 항목이 모두 ✅가 되면 완료로 본다.
- **기대 결과 및 완료 기준**:
  - [ ] 위 "버려지는 필드"가 PUT→GET 왕복에서 전부 보존(값 없으면 부재 유지)
  - [ ] 양손(`bassMeasures`) 포함 솔로 저장·복원 정상(F7.11)
  - [ ] 꾸밈음·옥타브·아티큘레이션 포함 솔로 저장·복원 정상
  - [ ] 기존 데이터 하위호환(누락 필드는 부재로 취급)

> ⚠️ 참고: 이 탈락은 **기존 저장 왕복에도 소급 적용**된다 — 위 필드를 가진 솔로를 프론트에서 다시 저장(PUT)하면 그 필드들이 사라진다. 스키마 확장 전까지 반복/꾸밈음/양손 포함 솔로의 재저장은 주의.
