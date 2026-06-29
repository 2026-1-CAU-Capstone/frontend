# Jazzify 프론트엔드 — 폴더 구조 가이드

> 이 문서는 `frontend/` 전체 폴더·파일의 **역할**과 **꼭 필요한지 여부**를
> 처음 보는 사람도 알 수 있게 정리한 지도입니다.
> (자동 생성된 폴더 `node_modules/`는 제외.)
>
> **필요 여부 범례**
> - 🟢 **필수** — 앱이 빌드·실행되려면 반드시 있어야 함
> - 🟡 **개발용** — 데이터 가공·평가·도구. 앱 런타임과는 무관, 지워도 앱은 돈다
> - 🔵 **재생성 가능** — 빌드/설치 산출물. 명령 한 번이면 다시 만들어짐
> - ⚪ **부가/기록** — 문서·홍보 등. 있으면 좋지만 없어도 무방

---

## 1. 최상위 (`frontend/`)

| 항목 | 크기 | 역할 | 필요 |
|------|------|------|------|
| `src/` | 3.4M | **앱 소스코드 전부** (React + TypeScript). 화면·로직·API 클라이언트 | 🟢 필수 |
| `public/` | 73M | 빌드 시 그대로 복사되는 **정적 자산** (악보 JSON, 릭 데이터, 색소폰 애니메이션 PNG, 로고 등) | 🟢 필수 |
| `index.html` | — | Vite 진입 HTML (앱이 매달리는 `#root`) | 🟢 필수 |
| `package.json` / `package-lock.json` | — | 의존성·스크립트 정의 | 🟢 필수 |
| `vite.config.ts` | — | 빌드/dev 서버 설정 (`/api` 프록시 → 백엔드, polling watch 등) | 🟢 필수 |
| `tsconfig*.json` | — | TypeScript 설정 (`app`/`node` 분리) | 🟢 필수 |
| `capacitor.config.ts` | — | iOS 앱 래핑(Capacitor) 설정 | 🟢 필수 (iOS 빌드 시) |
| `ios/` | 141M | **Capacitor iOS 네이티브 프로젝트** (Xcode). `App/App/public/`엔 웹 빌드 복사본 | 🟢 필수 (iOS 배포 시) |
| `dist/` | 133M | `npm run build` **산출물**. gitignore됨 | 🔵 재생성 가능 |
| `data/` | **11G** | 원본 데이터셋 (MIDI/MusicXML/iRealPro/omnibook 등). 앱이 직접 안 읽고 `scripts/`가 가공해 `public/`·백엔드로 보냄 | 🟡 개발용 (대용량, 배포 불필요) |
| `scripts/` | 305M | 데이터 가공 **일회성 스크립트** + `.venv`(파이썬 가상환경). 앱 런타임 무관 | 🟡 개발용 |
| `tools/` | 73M | 일회성 마이그레이션·매칭 도구 (`lick-migrate`, `pdf2midi`, omnibook 매칭 등) | 🟡 개발용 |
| `rule-based/` | 664K | 파이썬 **rule-based 화성 분석 엔진**(현재 백엔드로 이관됨). 로컬 leftover | 🟡 개발용 (앱 무관) |
| `benchmark/` | 4.6M | RAG/분석 품질 평가용 스크립트·페이지 | 🟡 개발용 |
| `promo/` | 1.9M | 인스타 등 홍보 자산 | ⚪ 부가 |
| `pdf/` | 0B | 빈 작업 폴더 | ⚪ 비어있음 (지워도 무방) |
| `docs/` | 92K | 백엔드 연동·포맷 문서들 (이 파일 포함) | ⚪ 기록 |
| `README.md` | — | 거의 비어있음 | ⚪ 부가 |
| `Fable.md` / `Fable_ios.md` | — | 작업 메모 | ⚪ 부가 |

> 💡 **앱 실행에 진짜 필요한 건** `src/` + `public/` + 설정파일들 + (iOS는 `ios/`)뿐입니다.
> `data/` `scripts/` `tools/` `rule-based/` `benchmark/`는 전부 **개발·데이터 준비용**이라
> 배포 번들에는 들어가지 않습니다.

---

## 2. `src/` — 앱 소스 (핵심)

```
src/
├── main.tsx          앱 부트스트랩 (React 마운트)
├── App.tsx           라우팅 (/chord, /note, /licks, /solos, /mychord, ...)
├── api/              백엔드·외부 API 클라이언트
├── components/       재사용 UI 컴포넌트 (도메인별 폴더)
├── pages/            라우트별 페이지 컴포넌트
├── lib/              순수 로직(음악 이론·플레이어·파서) — UI 없음
├── data/             정적 데이터 + 타입 정의
├── hooks/            공용 React 훅
├── contexts/         전역 React 컨텍스트
├── styles/           테마·전역 스타일
├── assets/           (비어있음)
└── *.d.ts            앰비언트 타입 선언 (styled-components, youtube 등)
```

### `src/api/` — 서버 통신 (13개) 🟢
| 파일 | 역할 |
|------|------|
| `auth.ts` | 로그인/회원가입/토큰 갱신 + `authFetch`(공용 fetch 래퍼) |
| `chat.ts` | 채팅 스트리밍(`/v1/chat/stream`, **RAG 포함**) + 채팅 목록/상세/활성 상태 |
| `claude.ts` | Claude 직접 호출(폴백/익명용, RAG 없음) |
| `harmorag.ts` | RAG 응답 **타입만** (RagChunk/RagDebugInfo). ⚠️ 옛 mac-mini 서버는 제거됨 |
| `chordProjects.ts` / `sheetProjects.ts` | 코드/악보 프로젝트 CRUD + OMR 업로드·상태 |
| `analysis.ts` / `chordContext.ts` | 화성 분석 요청·컨텍스트 |
| `licks.ts` / `solos.ts` | 릭·솔로 DB CRUD |
| `storageFiles.ts` | 파일 업로드 |
| `onsetSuggest.ts` | YouTube onset 추출 |
| `apiError.ts` | 에러 포맷 공용 |

### `src/components/` — UI (76개 파일, 11개 폴더) 🟢
| 폴더 | 역할 |
|------|------|
| `layout/` | 사이드바(`IconSidebar`), 우측 채팅 패널, 상단 툴바, 최근 채팅 목록 |
| `chat/` | 채팅 메시지·인라인 코드차트·릭 추천 카드·RAG 디버그 패널 |
| `leadsheet/` | **코드 차트 렌더러**(`LeadSheet`) — chord/내코드차트 공용, Break Editor 마커 |
| `notesheet/` | **악보(멜로디) 렌더러**(`NoteSheet`, VexFlow) — note analysis·솔로 |
| `backing/` | 백킹 플레이어 바·믹서(BPM/장르/메트로놈/Break Editor 토글) |
| `chord/` | 세션 악기 선택 등 코드 페이지 보조 UI |
| `yamaha-sty/` | Yamaha .sty 스타일 선택기 |
| `auth/` | 로그인 모달·유저 메뉴·설정 버튼 |
| `common/` | 공용(브랜드 로고, 카운트인 오버레이, 전체화면 버튼 등) |
| `projects/` | 프로젝트 관련 보조 UI |
| `score/` | (구) 점수 뷰어 — 사용 적음, 정리 후보 |

### `src/lib/` — 순수 로직 (100개 파일) 🟢
| 항목 | 역할 |
|------|------|
| `player/` | **전역 오디오 플레이어 싱글톤**(GlobalPlayer) + 컨텍스트. 모든 페이지가 공유 |
| `backing/` | 룰 기반 백킹 엔진(피아노/베이스/드럼 스케줄링, Break 게이팅) + 차트 어댑터 |
| `note/` | MIDI/XML 멜로디 파서, 플레이어 설정 스토어, 스윙 등 |
| `yamaha-sty/` | .sty 파일 파서·백킹(실험적) |
| `jazz-harmony/` | 코드 기호·도수 표기 변환 |
| `ireal/` | iRealPro 포맷 파서 (현재 사용 적음, 정리 후보) |
| `chat/` | `runChatStream` — 채팅 전송 디스패처(백엔드 RAG / 폴백 Claude) |
| `breakPoints.ts` | Break Editor 곡별 저장 |
| `leadSheetChordEdit.ts` | 코드 차트 편집/저장 |
| `harmonyAnalyzer.ts` | 프론트 화성 분석 |
| `lickMatcher.ts` | 코드 진행 ↔ 릭 매칭 |
| `transpose.ts` / `chordProjectToLeadSheet.ts` / `modalInterchangeTemplates.ts` 등 | 변환·유틸 |

### `src/pages/` — 라우트 화면 (18개) 🟢
주요: `ChordPage`(코드 분석·내 코드차트 공용), `NotePage`(노트 분석), `LicksPage`/`SolosPage`(DB), `MyChordChartsPage`/`MySheetProjectsPage`(내 차트), `LoginPage`, `HomePage`, `IntroPage`, `EditorPage`, `YoutubeOnsetPage`.
> ⚠️ `LickInputPage`/`SoloGeneratorPage`/`StyPocPage`/`StyDemoPage` 등은 라우트 통합·실험 잔재로 **정리 후보**(이전 knip 스캔 참고).

### `src/data/` — 정적 데이터·타입 (13개) 🟢
타입(`types.ts`, `leadSheetTypes.ts`), 노트/릭/솔로 인덱스(`noteSongs.ts`, `lickData.ts`, `soloData.ts`), 샘플 곡(`sampleMelody.ts`, `allOfMe.ts`), 코드매칭 인덱스 등.
> ⚠️ `irealMeta.ts`/`irealSongs.ts`/`lickVideos.ts` 일부는 미사용(정리 후보).

### `src/hooks/` (9개) 🟢
`useAnalysisFilters`, `useAutoHighlight`, `useCountInIntro`, `useCompactLayout`, `useIsNativeLandscape`, `useViewModePref` 등 공용 훅.

### `src/contexts/` (3개) 🟢
`PlayerBarPositionContext`, `AppPreviewContext` 등 전역 상태.

### `src/styles/` 🟢
테마 토큰(`theme`)·전역 스타일.

---

## 3. 한눈에 — "지워도 되나?"

| 폴더 | 지우면? |
|------|---------|
| `src/`, `public/`, `index.html`, `*config*`, `package*.json` | ❌ 앱이 안 돈다 |
| `ios/` | iOS 앱만 못 만듦 (웹은 정상) |
| `dist/` | OK — `npm run build`로 재생성 |
| `data/` (11G) | OK — 원본 데이터셋. 데이터 재가공 안 할 거면 백업 후 정리 가능 |
| `scripts/`, `tools/`, `rule-based/`, `benchmark/` | OK — 개발 도구. 앱 런타임 무관 |
| `promo/`, `pdf/`(빈 폴더), 작업메모 `*.md` | OK — 부가 |

---

## 4. 데이터 흐름 요약 (큰 그림)

```
[원본 데이터셋]            [가공 도구]              [앱이 읽는 곳]
 data/ (MIDI/XML/iReal) → scripts//tools/ 가공 → public/data/ (JSON 등)
                                                  ↓
                                        src/ (React 앱) ── /api 프록시 ──▶ 백엔드(jazzify.p-e.kr)
                                                                            ├─ RAG 채팅 (/v1/chat/stream, /v1/rag/*)
                                                                            ├─ 화성 분석 (/v1/analysis)
                                                                            └─ 프로젝트·릭·솔로·OMR
                                        src/lib/player ──▶ 오디오(샘플=public, 합성=smplr)
```

> **RAG 메모**: RAG는 100% 백엔드에서 동작합니다. 과거의 자체호스팅
> (mac-mini / Tailscale Funnel / cloudflared / 로컬 FastAPI) 서버와 그 부산물
> (ChromaDB 벡터스토어 등)은 모두 제거되었습니다.
