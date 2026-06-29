# Jazzify — 프로젝트 마스터 문서 (AI 온보딩용)

> **이 문서의 목적**: 다른 AI(웹 Claude, 다른 에이전트 등)가 이 한 문서만 읽고도 Jazzify
> 프로젝트의 전체 그림 — 무엇을 만드는지, 기술 스택, 코드 구조, 데이터, 핵심 알고리즘,
> 진행 상황, 주의사항 — 을 파악하고 바로 작업에 투입될 수 있게 하는 단일 진입점.
> 세부는 `frontend/docs/` 하위 문서들로 링크한다(맨 아래 "참고 문서" 참조).
>
> 작성 기준일: 2026-06. 최종 발표 자료(기말) + 현재 코드베이스 + 작업 세션 종합.

---

## 0. 한 줄 요약

**Jazzify = AI 기반 재즈 악보 화성 분석 & 즉흥연주 학습 서비스.**
프로 연주자의 솔로 라인(릭)과 자동 화성 분석으로, 재즈 즉흥연주 학습을 몇 배 빠르게 만드는 AI 학습 튜터. (`jazzify.ai`, 재즈 스탠다드 1,460곡)

- 소속: 중앙대학교 캡스톤디자인(2) 8분반 1팀
- 팀: **최영현**(Frontend, AI/LLM/RAG) · **황민**(Vision/OMR) · **안필온**(Backend)
- 핵심 thesis: **Symbolic-Neural Hybrid** — LLM 단독의 환각/비일관성을 규칙 기반 엔진(정확·결정론)과 RAG(설명 깊이·근거)로 보강한다. "AI에 모든 걸 맡기지 않고 역할을 분리한다."

---

## 1. 제품: 무엇을, 왜

### 1.1 해결하는 문제
재즈 입문자(예: 색소폰/클라리넷 연주자)는 "이 곡을 내가 좋아하는 연주자(예: 찰리 파커)처럼 연주하고 싶다"는 욕구가 있지만:
1. 관련 자료(악보/전사)를 찾기 어렵다.
2. 악보가 없으면 음원을 듣고 일일이 채보해야 한다.
3. 채보해도 키가 다르면 자기 악기 키로 옮겨야 한다.
4. 결국 ChatGPT 같은 LLM에 물어보면 → **그럴듯하지만 실제와 다른 가짜 라인**을 만들고, 악보/코드 기호도 출력 못 하며, 같은 질문에 매번 다른 답(비일관성)을 낸다.

### 1.2 Jazzify의 답
악보 사진을 올리면 → 코드 자동 분석 → 원하는 구간 선택 → "여기서 찰리파커처럼?" 질문 →
**실제 프로 연주자의 라인(릭)을 검색해 내 악보 키로 변환**해서 악보 + 화성학 설명과 함께 제시 → 바로 연습.

### 1.3 분석에 동시에 필요한 3가지 (제품 철학)
1. **정확성** — 틀린 답을 말하면 안 된다.
2. **일관성** — 같은 질문엔 같은 답이 나와야 한다(LLM 단독은 매번 달라짐).
3. **설명의 깊이와 근거** — 모호한 화성도 여러 해석을 근거와 함께 설명.

---

## 2. 핵심 파이프라인 (4단계)

```
① OMR (악보 인식 AI)        PDF/PNG/JPEG → .mid + 코드/마디
        ↓
② Rule-based Engine         코드 역할·관계·패턴 직접 분석 + 모호성(ambiguity) 점수
        ↓
③ RAG (검색 증강 생성)       화성학 DB·릭 DB에서 관련 개념·설명·연주자 라인 검색
        ↓
④ LLM (자연어 설명)          Rule + RAG 지식을 종합한 input → 자연어 설명/악보 생성
```

핵심 통찰: **악보를 LLM에 그냥 넣으면 틀린다.** 먼저 Rule-based Engine으로 음악적 파싱·모호구간을 처리하고, LLM은 "설명"에만 집중시키면 정확하고 풍부한 분석이 가능하다.

---

## 3. 기술 스택 (전체)

### 3.1 Frontend (이 레포 = `frontend/`)
- **React 19 + Vite + TypeScript**, **styled-components**, **react-router-dom**(HashRouter)
- 악보 렌더: **vexflow** / OSMD 계열. PDF: **pdfjs-dist**, **jspdf**
- 오디오: **smplr**(soundfont 샘플러, 피아노 SplendidGrandPiano·드럼 DrumMachine 등), **soundtouchjs**(타임스트레치)
- 채팅 렌더: **react-markdown** + **remark-gfm**
- 압축: **fflate**
- 네이티브: **Capacitor**(iOS 래핑) — `capacitor.config.ts`, `ios/`
- 배포: **Netlify** (프론트 정적 호스팅)
- 빌드: `tsc -b && vite build` (타입체크 후 번들)

### 3.2 Backend (별도 — 이 레포엔 코드 없음, `docs/`에 통합 가이드)
- **Spring (Java) Backend API** — `Nginx`(reverse proxy) 뒤
- 내부: **Rule-Based Engine** + **Claude API Client**(Anthropic LLM 호출)
- 데이터: **MySQL**(user/app data), **Redis**(cache/session), **PostgreSQL + pgvector**(RAG 벡터 DB, cosine sim, HNSW index)
- 인프라: **Oracle Cloud Infrastructure** + **Docker**

### 3.3 AI/Vision 서비스 (AWS EC2, Docker)
- **FastAPI Music Vision Service** — OMR(악보 인식)
- **FastAPI Embedding Service** — 임베딩(768-d 벡터)
- **Claude API (Anthropic)** — 외부 LLM (RAG·설명·악보 생성). 모델: **Claude Sonnet 4.6**(주력), Haiku 4.5(경량 비교군)
- 벡터스토어: **ChromaDB / pgvector**

### 3.4 데이터 계층
- **WjazzD**(Weimar Jazz Database, `frontend/data/wjazzd.db`) — 프로 솔로 전사(음정/onset/마디/박 단위)
- **Omnibook**(`frontend/data/omnibook_xml.zip`) — Charlie Parker 50곡 MusicXML 전사
- 릭 코퍼스: `licks.json`(8088개 검색용), `user_licks.json`(앱 수록 릭)
- 화성학 지식 베이스(자체 문서 + YouTube 강의 전사)

---

## 4. 레포 구조 (모노톤; 실제로는 frontend가 메인)

```
jazzify/
├─ frontend/              ← 메인 작업 디렉터리 (React 앱 + 데이터 + 파이썬 도구)
│  ├─ src/                ← 앱 소스 (227개 .ts/.tsx)
│  ├─ public/data/licks/  ← user_licks.json, licks.json(8088)
│  ├─ data/               ← wjazzd.db, omnibook_xml.zip, mid 등 (가공 원천)
│  ├─ rule-based/         ← Python 규칙 기반 화성 분석 엔진 (stdlib only)
│  ├─ tools/              ← 매칭/마이그레이션 파이썬·노드 도구
│  ├─ scripts/            ← 데이터 변환/검증 스크립트 (ireal, esac, wjazzd, 1460곡 등)
│  ├─ docs/               ← 상세 기술 문서 (이 문서 포함)
│  ├─ ios/                ← Capacitor iOS 프로젝트
│  └─ 기능명세서.md        ← 전체 기능 카탈로그 (M1~M14)
├─ capstone/ , spec-share/ , 사업계획서/   ← 문서/기획
└─ .env.local
```

### 4.1 `src/` 레이아웃
- `src/api/` (12) — 서버 통신: `auth.ts`, `chat.ts`, `claude.ts`, `harmorag.ts`, `chordProjects.ts`, `sheetProjects.ts`, `licks.ts`, `solos.ts`, `chordContext.ts`, `onsetSuggest.ts`, `storageFiles.ts`, `apiError.ts`
- `src/components/` (~76) — UI. 주요 폴더: `backing/`, `chat/`, `layout/`, `leadsheet/`, `notesheet/`, `chord/`, `score/`, `common/`, `auth/`, `projects/`, `yamaha-sty/`
- `src/lib/` (~100) — 순수 로직 (아래 §6에서 상세)
- `src/pages/` (17) — 라우트 화면
- `src/data/` (13) — 정적 데이터·타입 (`sampleMelody.ts`, `allOfMe.ts`, `leadSheetTypes.ts`, `lickVideos.ts`, `lickData.ts` 등)
- `src/hooks/` (9) — `useCountInIntro.tsx`, `useGlobalPlayer`, `useCompactLayout` 등
- `src/contexts/` (3) — `PlayerBarPositionContext`, `AppPreviewContext`, `NotificationContext`
- `src/styles/` — styled-components 테마(`theme.ts`, `global.ts`)

### 4.2 라우트 맵 (`src/App.tsx`, HashRouter)
- `/` HomePage · `/intro` IntroPage(마케팅) · `/login`
- `/chord` ChordPage(코드 차트 분석) · `/mychord`(내 차트 모드)
- `/note` NotePage(악보/노트시트 분석)
- `/licks` LicksPage · `/lick-practice/:id` Lick12KeyPage(12키 연습)
- `/solos` SolosPage
- `/input` InputPage · `/youtube-onset` YoutubeOnsetPage(YouTube 채보, 예정)
- `/editor` EditorPage (mode=solo|lick 통합; 구 SoloGeneratorPage/LickInputPage는 리다이렉트)
- `/my-licks`, `/my-charts`, `/my-sheets` (내 라이브러리)
- `/preview/*` (디자인 프리뷰), `/shared/*`(공유 차트)

---

## 5. 프론트 핵심 서브시스템

### 5.1 재생 엔진 (`src/lib/backing/`, `src/lib/player/`) — 가장 복잡, 가장 자주 건드림

**오케스트레이터: `GlobalPlayer`** (`src/lib/player/GlobalPlayer.ts`, lazy 프록시 `GlobalPlayerLazy.ts`)
- 앱 루트 `GlobalPlayerProvider`에 단일 인스턴스. `useGlobalPlayer()`로 접근.
- `play(input)`을 입력 종류로 라우팅: `kind: 'chart' | 'sheet' | 'lick' | 'solo'`.
  - `chart` → 코드차트 백킹(룰 엔진). `sheet/lick/solo` → 멜로디 백킹 엔진(별도 인스턴스).
- 통합 이벤트 버스: `bar`, `chord`, `note`, `done`, `error`.
- `isReady(input)` — 엔진 로드 완료 여부(콜드/웜 판정). `preload(input)` — 미리 로드.
- `AnacrusisPlayer`(픽업음) 별도.

**룰 기반 백킹: `BackingPlayer`** (`src/lib/backing/player.ts`)
- AudioContext 소유, smplr 악기 lazy 로드, 차트→이벤트 스트림 렌더 후 lookahead RAF 스케줄.
- `isReady()` = piano/bass/drums(+loop 모드면 drumLoop) 로드 완료.
- **콜드스타트 게이트("준비 중")**: 첫 재생 시 악기 미로드면 카운트인 "1 2 3 4"를 **로딩 후에** 시작 → "준비 중…" 스피너 노출(`useCountInIntro` + `CountInOverlay`). 로드 후엔 즉시 재생.

**장르 → 그루브 체인** (장르 선택이 그루브/필/스윙을 결정):
```
UI 장르 라벨 ──genreToStyleId(player.ts)──▶ StyleId
            ──resolveFeel(engine.ts)─────▶ FeelId
            ──renderDrumBar(drums.ts)────▶ 드럼 패턴
            ──(engine.ts) 베이스/컴프 라우팅
            ──getSwingRatio(note/swing.ts)▶ 스윙 비율
```
- **15개 장르** (`GENRES` in `components/backing/BackingPlayerBar.tsx`):
  Ballad, Medium Swing, Up-Tempo Swing, Bebop, Shuffle, New Orleans Swing,
  Straight 8ths, Bossa Nova, Samba, Latin, Latin Swing, **Cha-Cha**, **Afro-Cuban**, Funk, Jazz Waltz
- 드럼 렌더러: `drums.ts`에 장르별 함수(`mediumSwingBar`, `bebopBar`, `shuffleBar`, `bossaBar`, `latinBar`, `sambaBar`, `funkBar`, `waltzBar`, `chaChaBar`, `afroCubanBar` …) + `renderDrumBar(feel)` 디스패치. 패턴은 iReal Pro 트랙에서 채보.
- 베이스: `bass.ts` — `walkChord`(워킹), `twoFeelBass`(발라드), `bossaBass`(latin 계열), **`funkBass`**(펑크 싱코페이션 리프).
- 피아노 컴프: `engine.ts`
  - 스윙 계열 → `renderPsBasePianoComping` (psBase.sst에서 추출한 베이크된 스윙 패턴 = `jazz-piano-pattern.ts::PSBASE_CH0_PATTERN`)
  - bossa/latin/samba/cha-cha/afro-cuban + **funk/straight-8ths** → `renderLegacyPianoComping`(보이싱 기반, raw 오프셋=straight). ⚠️ straight 장르에 스윙 컴프가 얹히면 어긋나므로 분리됨.
- 보이싱 라이브러리: `src/lib/yamaha-sty/`의 `fit-phrase`, `quality-map`, `chord-voicing`, `source-phrase-ops`, `style-part`, `ctab/ctb2-channel-settings`, `acc-type`, `yam-chord` — **rule 엔진이 코드 보이싱에 재사용**(지우면 안 됨).
- 사운드폰트: `soundfont.ts` (smplr). 베이스 = Smolken Pizzicato(실제 더블베이스), 드럼킷 프리셋(`drumKitPresets.ts`, `sampledDrumKit.ts`), 리버브(`reverb.ts`).
- 믹서: `BackingPlayerBar.tsx`의 `BackingMixer` — 볼륨/드럼킷/메트로놈/장르/BPM/리버브, 인라인 릭 토글. (엔진 선택 UI는 .sty 제거로 사라짐 — 항상 rule.)

### 5.2 채팅 / RAG 프론트 (`src/components/chat/`, `src/components/layout/RightChatPanel.tsx`, `src/api/`)
- `RightChatPanel.tsx` — AI 채팅 패널(코드차트/노트시트 양쪽). 선택 코드 구간을 컨텍스트로 첨부.
- `api/chat.ts` — 백엔드 `POST /v1/chat/stream`(useRag) 스트리밍. `api/harmorag.ts` — RAG 응답 shape 타입(RagChunk, RagDebugInfo: video_id/start_sec 포함).
- `ChatMessage.tsx` — 마크다운 렌더 + 인용 칩 + `[LICK:id]` 태그를 VexFlow 릭 카드로 치환.
- `RagDebugPanel.tsx` — 회수된 청크/점수 디버그.
- 릭 추천: 채팅이 코드/연주자/진행을 매칭해 실제 DB 릭을 카드로 제시.

### 5.3 릭 시스템 (`src/lib/lickMatcher.ts`, `src/data/lickVideos.ts`, `components/notesheet/LickCard.tsx`)
- 데이터: `public/data/licks/user_licks.json`(앱 수록) + `licks.json`(8088, WjazzD 기반 검색 코퍼스). 각 릭: performer/title(곡)/album/key/chords/tempo/sheetData(전사) + 유사도 핑거프린트(intervals/parsons/fuzzyIntervals).
- `lickMatcher.ts` — 코드/진행/연주자 기반 매칭(`findMatchingLicks`, `findLicksByPerformerAndProgression`, `findLicksByProgression`, `detectProgressionKeyword`).
- **유튜브 출처 링크**: `lickVideos.ts`
  - `getLickVideo(id)` — 핀된 영상(videoId+startSec) 조회(정적 registry + localStorage 오버라이드). onset parser(/admin)로 추가 가능.
  - `lickYoutubeSearchUrl(lick)` — 핀이 없을 때 `연주자+곡+앨범` 유튜브 **검색 URL**(환각 없는 폴백). LickCard에 핀 있으면 임베드, 없으면 "원곡 찾기" 버튼.
- 12키 연습: `Lick12KeyPage.tsx` (릭을 모든 키로 전조).

### 5.4 OMR / 코드 차트 (`ChordPage.tsx`, `components/leadsheet/`, `api/chordProjects.ts`)
- 악보 사진 업로드 → 백엔드 Vision(FastAPI) OMR → 코드/마디 추출 → `LeadSheetData`(`data/leadSheetTypes.ts`) → 차트 렌더(`LeadSheet.tsx`) + 화성 분석(역할 색상: Tonic/Subdominant/Dominant, ii-V-I 등).
- SWR 분석 캐시: `lib/analysisCache.ts` (즉시 캐시 렌더 후 백그라운드 재검증).

### 5.5 노트시트(멜로디 악보) (`NotePage.tsx`, `components/notesheet/NoteSheet.tsx`, `lib/note/`)
- VexFlow 악보 + 멜로디 재생(하이라이트 동기화). 파서: `midiMelodyParser.ts`(MIDI→그리드 양자화), `xmlMelodyParser.ts`(MusicXML).
- Break Editor(스톱타임 구간), 구간 반복, 멀티파트 악기.

### 5.6 기타
- iReal Pro import (`src/lib/ireal/`), 전조(`transpose.ts`, `transposeNoteSheet.ts`), 솔로 DB(`SolosPage`), 통합 에디터(`EditorPage` mode=solo|lick).

---

## 6. 백엔드 & 인증 (요약 — 상세는 `docs/backend-api.md`)
- 인증: 로그인 → 토큰(JWT 추정) → 인증 호출. `.env`엔 프론트 직접호출용 키가 있으나 **백엔드 경유로 마이그레이션 중**(`docs/CLAUDE_BACKEND_INTEGRATION.md`).
- Claude 호출: 백엔드 새 엔드포인트로 통일, 카테고리별 system 프롬프트 조립, 스트리밍 passthrough, RAG_DEBUG 블록을 프론트가 파싱.
- 스펙은 라이브로 받음(복붙 금지) — `docs/backend-api.md` 참조.

---

## 7. Rule-Based 화성 분석 엔진 (`frontend/rule-based/`, Python stdlib only)
- 입력: 코드 진행 → 출력: Key, ii-V-I index, 각 코드 Role/function, 패턴(modal interchange 등), **ambiguity 점수**, 다중 해석(interp_1/2).
- 구조: `main.py::analyze`, `analyzers/`, `parsers/`, `rules/`, `aggregator.py`, `rule_report.py`, `batch.py`(코퍼스 일괄), `version_tracker.py`(`VERSION.md`).
- 현재 통합: offline pre-compute(배치). 옵션 B = FastAPI 래핑(`server.py`) 추천. 상세 `docs/RULE_BASED_BACKEND_INTEGRATION.md`.
- 벤치마크 효과: 구조 분석 정확성을 LLM 단독 67~83% → **100%** 로 끌어올림.

---

## 8. RAG / HarmRAG 파이프라인 (핵심 차별점)

### 8.1 데이터셋 구축 (Dataset Construction)
```
YouTube 재즈 강의 (한국어 100 / 영어 380)        자체 화성학 문서
        │ Whisper ASR (전사·검증)                      │ Plain Text
        ▼                                              ▼
     Chunking (512 tokens, overlap 50)            Chunking
        ▼                                              ▼
     Metadata Tagging (섹션제목 + 질문유형)        Metadata Tagging
        └───────────────┬──────────────────────────────┘
                  Embedding (768-d vector)
                        ▼
              ChromaDB / pgvector (cosine sim, HNSW)
```
- Jazz-Harm Benchmark: Train/Val/Test = 8:1:1, Test 질문 정제, 재즈 전문가 검증.

### 8.2 추론 파이프라인 (HarmRAG)
```
User Question
   ▼ Rule-based Engine  (chord_name, chord_function, patterns, song, ambiguity, interp_1/2 태깅)
   ▼ Ambiguity ≥ 0.5 ?
      NO → Single Interpretation
      YES → Query Decomposition (4~8개 Sub Query 생성)
   ▼ ChromaDB Vector Search (sub-query별)
   ▼ RRF Fusion (여러 쿼리에 걸쳐 일관 상위 문서 선별)
   ▼ Context Assembly = ① system prompt ② rule engine output ③ top-5 RAG chunks + scores
                        + Lick Database + Knowledge Base
   ▼ Claude Sonnet 4.6
   ▼ Response to User (설명 + [LICK:id] 카드 + 유튜브 타임스탬프 인용)
```
- 서브쿼리는 **LLM이 아닌 규칙 기반**으로 분해 → 결정론적·저비용·재현 가능.
- 유튜브 출처는 video_id + start_sec 저장 → 인용이 정확한 시점으로 딥링크.
- 환각 방지: 정보가 거짓이면 RAG 검색 결과가 없으므로 Raw LLM로 판단 → 게이팅.

---

## 9. Jazz-Harmony Benchmark (Ablation Study) — 평가가 개선을 견인

비교군: **Claude Haiku 4.5 / Sonnet 4.6** × **RAW / +Rule-Based Engine / +Embedding RAG**.
채점: 자동(LLM-as-judge 등) + 컴퓨터 평가 불가 항목은 **재즈 전문가·연주자 30인 블라인드 점수 평가**.

| 축 | 문항 | 지표 | Haiku(RAW→+Rule→+RAG) | Sonnet(RAW→+Rule→+RAG) |
|---|---|---|---|---|
| A 구조 분석 정확성 | 500 | 정답률 | 67.3% → **100%** | 82.7% → **100%** |
| B 이론 사실성(단답) | 300 | 정답률 | 89.2 → 89.2 → **99.3%** | 92.4 → 92.4 → **99.3%** |
| C 이론 사실성(서술) | 300 | 1~5점(전문가) | 2.1 → 2.1 → **4.5** | 3.4 → 3.4 → **4.8** |
| D 할루시네이션(거짓 전제 거부) | 100 | 정확도 | 65.2%(flat) | 97.0%(flat) |
| E 곡별 심층분석 | 200 | 0~5점(전문가) | 0.3 → 2.4 → **4.4** | 1.2 → 2.9 → **4.7** |
| F 악보 생성 | 50 | 성공률 | Claude 0% vs **Jazzify 100%** |

해석: 구조 정확성은 **Rule Engine**이, 설명 깊이·곡별 심층은 **RAG**가 끌어올린다. 악보 생성은 LLM 단독 불가, Jazzify만 가능.

### 9.1 OMR/OCR Benchmark (Vision)
- 코드 탐지(인쇄체): raw OMR+Naive OCR 66.1% → **Jazzify 90.2%**
- 코드 탐지(손글씨/필기체): 23.3% → **80.3%**
- 코드 탐지(차트): Naive OCR 5.0% → **97.1%** (재즈 코드 구성요소를 분리 처리)
- 마디 지정: 0% → **100%** (OMR + CV 기반)
- 방식: 페이지 전체 스캔 대신 **국소 OCR + 후보정**, 재즈 특유 글씨체 탐지.

---

## 10. Omnibook 릭-마디 매칭 (이 세션에서 구축 — 출처 정밀화)

목표: 릭(특히 Charlie Parker)을 **Omnibook 전사와 음정 매칭**해 어느 곡 몇 번째 마디인지 환각 없이 찾기.

- 데이터: `frontend/data/omnibook_xml.zip` (Parker 50곡 MusicXML), `licks.json`의 릭별 `interval`/`pitch`/`bar`.
- 도구:
  - `tools/match_omnibook.py` — 단일 스니펫 → Omnibook 음정 윈도우 매칭(조옮김 불변, 곡·마디·점수).
  - `tools/match_parker_licks.py` — **(세션 산출물)** 전체 Parker 릭 195개 배치 매칭. 같은 곡 Omnibook 파일에서 best 음정 윈도우 → 마디 + 신뢰도(%).
- 결과(195개): 정확(100%) 37 / 근접(70~99%) ~36 / 낮음(<70%) 55 / Omnibook 미수록 67(Don't Blame Me·Out of Nowhere·Embraceable You·Star Eyes·How Deep — 이 책엔 없음).
- 주의: WjazzD 릭과 Omnibook은 **다른 테이크**일 수 있어, 즉흥 구간은 점수가 낮다(=마디 미확정). 짧은 릭(≤4음)의 100%는 증거력 약함. → **100% & 충분한 길이만 신뢰**, 나머지는 "추정/미검증" 라벨 권장.
- 미수록 곡은 `lickYoutubeSearchUrl` + WjazzD 솔로 정보로 대체.

---

## 11. 도구 & 스크립트 인벤토리

`frontend/tools/` — `match_omnibook.py`, `match_parker_licks.py`, `match_dorothy*.py`, `lick-migrate/`
`frontend/scripts/` — `convert_omnibook.py`, `extract_wjazzd_chords.py`, `extract_esac.py`, `export_esac_midi.py`, `convert-ireal.cjs`, `build_chord_match_index.py`, `e2e-1460.ts`, `validate-1460*.mjs`, `restore-lick-videos.mjs`, `restore_backend_licks.mjs`, `wipe_and_restore_licks.mjs`, `fix-parker-performers.mjs`, `smoketest-leadSheetToChart.ts` 등
`frontend/rule-based/` — Python 규칙 엔진(§7)

---

## 12. 빌드 / 개발 / 환경

```bash
cd frontend
npm run dev        # vite dev 서버
npm run build      # tsc -b && vite build (타입체크 포함)
npx vite build     # 번들만(타입체크 X, 빠른 import 검증)
npx tsc -p tsconfig.app.json --noEmit   # 타입체크만
npm run lint       # eslint
npm run ios        # build + cap sync + open (iOS)
python3 tools/match_parker_licks.py     # Parker→Omnibook 매칭
```

- **환경변수(`.env`)**: `VITE_ANTHROPIC_API_KEY`(프론트 직접호출용, 백엔드 마이그레이션 대상). `VITE_RAG_*` 등 RAG 토큰류. **값은 비밀 — 절대 노출/커밋 금지.** `.env.local`도 존재.
- git: 브랜치 `feat/initial`, origin = `github.com/2026-1-CAU-Capstone/frontend`. 최근 커밋 `f84cf4d`.
- 응답 언어: 기본 한국어.

---

## 13. 현재 상태 / 최근 변경 (이 세션 작업, 상당수 미커밋)

> `f84cf4d` 이후 미커밋. 커밋 시 사용자 WIP(rag-removal 리팩터·share 기능 등)와 섞여 있어 **우리 작업분만 선별 스테이징** 필요.

- **.sty / Hybrid 엔진 완전 제거** — 이제 백킹은 rule 단일. 믹서 엔진 선택 UI 삭제. `yamaha-sty/`의 보이싱 라이브러리만 유지(rule 의존). 데모 페이지(`StyDemoPage`/`StyPocPage`) + `public/styles/psBase.sst` 삭제.
- **장르 추가/수정**: Cha-Cha·Afro-Cuban 신설(총 15). bebop 드럼 과밀/밤 폭주 버그 수정. Funk·Straight 8ths의 스윙 컴프 충돌 수정(→ straight legacy 컴프). Funk 전용 베이스.
- **베이스 볼륨**: 디폴트 0.5 유지하되 `soundfont.ts`의 `bassAmp` 게인 3.2→1.2(소스 과출력 완화).
- **"준비 중" 콜드스타트 게이트** + 페이지 진입 시 백그라운드 preload(곡 바뀌면 재로드).
- **데모 하드코딩 제거**: "All of Me→C Jam Blues 강제" 핀, "ChatGPT Generated Lick" 핀, 죽은 데이터(mockResponses/autumnLeaves/love) 삭제.
- **릭 유튜브 출처**: 핀 없으면 `lickYoutubeSearchUrl` 검색 링크 폴백(LickCard "원곡 찾기").
- **Parker→Omnibook 매처**(`tools/match_parker_licks.py`).
- 빌드 상태: `tsc` 0 에러, `vite build` 성공.

### 13.1 알려진 미해결 / 보류
- **Jazz Waltz 컴프**: 4/4 psBase 패턴을 3/4로 슬라이스 → 프레이즈 액센트 미세 어긋남(스윙 자체는 맞음). legacy로 돌리면 스윙이 죽어 더 나빠지므로 보류. 3/4 전용 컴프 소스 필요.
- 사용자 WIP(rag-removal, share modal 등)가 작업 트리에 섞여 있음.

---

## 14. 작업 시 주의사항 (Gotchas / 컨벤션)

- **환각 = 1순위 적이다.** 마디 번호·영상 ID·이론 사실을 *지어내지 말 것*. 근거(매칭/검색/규칙) 없으면 "추정/미검증"으로 라벨하거나 보류. (이 프로젝트의 존재 이유 자체가 환각 억제)
- **저작권**: Omnibook 악보 *재현* 금지(인용·마디 지정은 가능). 가사·악보 전문 복제 금지.
- **`yamaha-sty/`를 통째로 지우지 말 것** — rule 엔진이 보이싱(fit-phrase 등)을 재사용.
- 스윙 vs straight 분리: straight 장르(funk/even-8ths)에 스윙 psBase 컴프를 쓰면 어긋남.
- 파일이 린터/사용자에 의해 동시 수정될 수 있음 → Edit 전 재-Read.
- 커밋: 사용자 WIP와 섞이면 우리 변경분만 path 지정 스테이징.
- 비밀키(.env) 노출/커밋 금지.

---

## 15. 기능 카탈로그 (M1~M14, 상세는 `기능명세서.md`)
인증·계정(M1) / 홈·AI채팅(M2) / 코드차트 분석(M3) / 노트시트 분석(M4) / 릭 DB·12키 연습(M5) / 솔로 DB(M6) / 에디터(M7) / OMR(M8) / 내 라이브러리(M9) / 재생 엔진(M10) / YouTube 채보(M11, 예정) / 백킹 엔진 R&D(M12) / 마케팅·온보딩(M13) / 플랫폼·iOS(M14).

---

## 16. 참고 문서 (이 레포)
- `frontend/기능명세서.md` — 전체 기능 명세(액터/Tier/구현상태)
- `frontend/docs/PROJECT_STRUCTURE.md` — 폴더 구조 가이드
- `frontend/docs/backend-api.md` — 백엔드 API 참조·테스트(라이브 스펙)
- `frontend/docs/CLAUDE_BACKEND_INTEGRATION.md` — Claude 호출 백엔드 마이그레이션
- `frontend/docs/RULE_BASED_BACKEND_INTEGRATION.md` — 룰 엔진 통합
- `frontend/docs/sty-format.md` — (.sty 포맷; 엔진은 제거됐으나 포맷 참고)
- `frontend/rule-based/VERSION.md` — 룰 엔진 버전/지원 기능
- 기말 발표 자료 PDF — 본 문서가 종합한 원천(제품 서사·벤치마크·아키텍처)

---

_이 문서는 프로젝트 전반의 단일 진입점이다. 세부가 바뀌면 이 문서와 위 참고 문서를 함께 갱신할 것._
