---
title: 2026-08-09 · Lead Sheet Database 백엔드 1건
type: 백엔드 요구사항
targets: [백엔드]
status: 제안
owner: 최영현
updated: 2026-08-09
---

# 2026-08-09 · Lead Sheet Database 백엔드 1건

🏷 **범주(태그):** 콘텐츠·라이브러리·스토리지

리드시트(코드 진행 차트)를 모으는 **큐레이션 DB** 가 필요하다. Comping Database(#57)와 같은 구조로 가고, 저장하는 데이터만 다르다 — 컴핑은 기보(`sheetData`), 리드시트는 **코드 진행**이다.

## 진행 현황
범례: ✅ 완료 · 🟡 진행중 · ⬜ 미시작
- ⬜ 1. LeadSheet 저장소 — Comping 과 같은 결의 CRUD

---

## 1. LeadSheet 저장소 — Comping 과 같은 결의 CRUD  ⬜ 미시작

### 기능 요약
스튜디오에서 리드시트를 등록·조회·삭제한다. 릭·솔로·컴핑과 같은 결.

### 상황 설명

**무엇을 모으는가**: 스탠더드의 코드 진행 차트(리얼북 같은 것). 사내에서 검수해 쌓고, 나중에 사용자에게 제공하거나 커뮤니티가 올리는 자리가 된다.

**기존 것들과 어떻게 다른가** — 셋과 헷갈리기 쉬워 명확히 구분한다.

| | 무엇 | 데이터 | 소유 |
|---|---|---|---|
| **Lead Sheet DB** (이 문서) | 큐레이션 리드시트 | **코드 진행** | 사내(전역) |
| 내 코드 차트 (`chord-projects`) | 사용자 개인 차트 | 코드 진행 | 사용자별 |
| Note Analysis (`/note`) | 기보 분석 워크벤치 | 음표(`sheetData`) | 화면(저장소 아님) |
| Comping DB (#57) | 컴핑 자료 | 기보(`sheetData`) | 사내(전역) |

⚠️ **Note Analysis 와 다르다.** 그쪽은 음표가 적힌 악보를 분석하는 화면이고 저장소가 아니다. 리드시트는 음표가 없고 **마디별 코드 심볼**이 본체다.

⚠️ **내 코드 차트와도 다르다.** `chord-projects` 는 `findAllByUserAndDeletedAtIsNull` 로 소유자별로 좁혀지는 개인 저장소다. 리드시트 DB 는 사내 전역 큐레이션이라 소유자 개념이 없고 관리자만 읽고 쓴다.

**지금 상태**: 화면이 아직 없다(Comping 은 화면이 있고 백엔드만 없는 상태였다). 백엔드 계약이 정해지면 프론트가 Comping 화면과 같은 구조로 만든다 — 좌: 분류 사이드바 · 우: 목록 + 차트 미리보기.

### 기능 상세
- **사용자**: 관리자(내부 스튜디오)
- **권한**: `ADMIN` 또는 `MANAGE` — 릭·솔로·컴핑 쓰기와 같은 규칙. 실서비스에는 이 화면이 없다
- **시나리오**: 스튜디오에서 리드시트를 등록(직접 입력 · iReal 붙여넣기 · OMR) → 목록에서 조회·검수 → 필요 시 삭제
- **동작 조건**:

  **엔드포인트** — Comping(#57)과 같은 모양으로 제안한다. 프론트가 한 패턴을 재사용한다.
  ```
  GET    /v1/lead-sheets?style=SWING&page=0&size=20
  POST   /v1/lead-sheets
  GET    /v1/lead-sheets/{publicId}
  PUT    /v1/lead-sheets/{publicId}
  DELETE /v1/lead-sheets/{publicId}
  → { data: { content: [...], totalElements, ... } }   // 기존 페이지 봉투
  ```

  **레코드** — 프론트의 `LeadSheetData` 를 그대로 옮기면 변환이 없다.
  ```
  publicId     서버 발급
  title        String                     ← 필수
  composer     String?
  style        String?                    ← 분류축(Swing / Bossa / Ballad …). 목록 필터에 쓴다
  key          String?                    ← 'C' · 'Bb' 등
  timeSignature String?                   ← '4/4' · '3/4'
  chords       ChordInfoResponse[]        ← **코드 진행 본체**
  createdAt / updatedAt
  ```

  **`chords` 는 새로 만들 필요가 없다.** `chord-projects` 가 이미 `ChordInfoResponse`
  로 진행을 저장한다 — `bar` · `beat` · `chord` · `durationBeats` · `analysis`.
  같은 스키마를 쓰면 프론트가 코드차트 렌더러(`LeadSheet`)를 그대로 재사용하고,
  화성 분석 결과(`analysis`)도 같은 모양으로 붙는다.

  다만 프론트의 `LeadSheetData` 에는 `chords` 평면 배열로는 안 담기는 것이 있다.
  **어떻게 담을지는 백엔드 판단**에 맡기되, 아래는 잃으면 리드시트가 리드시트가
  아니게 되는 것들이다:
  - **형식(form) 구획** — 섹션 라벨(A · A' · B · Intro · Coda). 리드시트의 골격이다
  - **반복 기호** — 도돌이, 볼타(`ending: 1|2|3`), 겹세로줄/끝세로줄
  - **가사**(선택) — 프론트는 `LeadSheetBar.lyrics: string[]`(절 순서, **마디 단위**)로
    둔다. 코드차트는 음표가 없어 음절을 음에 붙일 수 없기 때문이다

  `chord-projects` 가 이 셋을 어떻게 다루는지 확인해 같은 방식으로 가면 좋겠다 —
  다르게 두면 프론트가 렌더러를 두 벌 유지해야 한다.

  **`style` 은 enum 으로 둘지 문자열로 둘지 정해 주면 좋겠다.** 컴핑은 4종 고정
  enum(`SWING`·`BLUES`·`BOSSA`·`LATIN`)을 제안했는데, 리드시트는 스탠더드 스타일이
  더 다양해서(Ballad · Waltz · Modal · Funk …) 문자열이 나을 수 있다. 대신 오타가
  들어오면 목록이 갈라지므로 **어느 쪽이든 한쪽으로 통일**되면 된다.

- **검증 조건**:
  - 등록 후 목록·단건 조회에 나온다. `style` 필터가 그 스타일만 반환
  - 일반 사용자 토큰으로 `GET /v1/lead-sheets` → 403
  - **왕복 무손실** — 저장 후 되받아 대조: 코드 심볼·마디·비트·`durationBeats`,
    그리고 섹션 라벨·도돌이·볼타가 그대로인가. `Dm(2) Bdim(1) Bb(1)` 처럼 한 마디에
    길이가 다른 코드가 섞인 경우도 확인(프론트가 `durationBeats` 로 재생 길이를 낸다)
  - 수정(PUT) 후 조회 — 바뀐 것만 바뀌고 나머지가 유지되는가
  - 삭제 후 목록·단건에서 사라진다
- **기대 결과 및 완료 기준**:
  - [ ] 리드시트 CRUD 가 서버에 남는다
  - [ ] `ADMIN`·`MANAGE` 전용
  - [ ] `chords` 가 `chord-projects` 와 같은 스키마
  - [ ] 섹션 라벨·도돌이·볼타가 왕복에서 유실되지 않는다
  - [ ] `style` 로 목록 필터

---

## 참고 — 프론트가 함께 할 일

백엔드 요청은 아니고 순서 맞추기용 기록.

- 스튜디오에 `/lead-sheets` 화면 신설 — Comping 화면과 같은 구조(좌: 스타일 사이드바 · 우: 목록 + 차트 미리보기). 렌더는 기존 `LeadSheet` 컴포넌트 재사용
- 스튜디오 사이드바 '데이터' 묶음에 항목 추가
- 등록 경로 세 가지: 직접 입력(에디터) · **iReal 붙여넣기**(`lib/ireal/irealLoader` 가 이미 있다) · OMR(문서 #57 의 2번 경로가 생기면 그걸 쓴다)
- 번들에 있는 리드시트 자료(`public/data/sjs/*.json` · `data-jazzstandards-main` · `stablemates.json`)를 이 DB 로 올릴지는 **저작권 확인 후 별도 판단** — 이 문서 범위 밖이다
