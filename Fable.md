# Fable.md — Jazzify 전체 프로젝트 감사 보고서

> **생성**: 2026-06-10 · Claude (Fable 5) 멀티에이전트 감사
> **범위**: `src/` 전체(237파일·약 11만 줄), `vite.config.ts`, `capacitor.config.ts`, `index.html`, `package.json`, `rag/`, git 히스토리, 빌드 산출물(dist·iOS 번들)
> **방법**: 10개 영역 병렬 정밀 감사(영역별 전담 에이전트가 해당 코드 정독) + eslint/tsc 정적 분석 + npm audit. 핵심 보안 발견 2건(Anthropic 키·RAG 토큰)은 별도 검증 에이전트가 빌드 산출물 grep까지 재현해 적대적 검증 완료(✅ 표시). 나머지는 file:line 코드 근거 기반 1차 확정.
> **주의**: 이 보고서는 기록용이다. 미사용 변수는 지시에 따라 **수정하지 않고 기록만** 했다.

---

## 요약

| 심각도 | 건수 |
|---|---|
| 🔴 Critical | 1 |
| 🟠 High | 6 |
| 🟡 Medium | 31 |
| 🟢 Low | 34 |
| ℹ️ Info | 9 |
| **합계** | **81** |

카테고리: 버그 44건 · 기술적 결함 16건 · 보안 12건 · 데드코드 7건 · 의존성 2건 (+ 미사용 변수 15건은 §6에 별도 기록)

### 📋 조치 로그 (보고서 생성 후 수정 내역)

| 일자 | 항목 | 심각도 | 조치 |
|---|---|---|---|
| 06-11 | ensureInstruments 실패 프로미스 영구 캐시 | High | `.catch`에서 `loading=null` 리셋 후 rethrow — 다음 호출이 재시도 (player.ts) |
| 06-11 | Stop 버튼 무력화 (AbortError 오인) | High | streamClaudeMessage에 signal 추가·fetch 전달, harmorag catch에서 abort rethrow(서버사망 오염·폴백 차단), 폴백 3곳 signal 전파 |
| 06-11 | SoloGenerator 이탈 시 무한 재생 | High | unmount cleanup effect 추가 (abort + pauseResolve 해제 + kb.stopAll) |
| 06-11 | Load JSON notes 미검증 크래시 | High | splitMeasuresByBeats(전 로드 경로의 길목)에서 비객체 drop + `notes:[]` 정규화 재방출 |
| 06-11 | npm audit 7건 | High | `npm audit fix` → 취약점 0건 (vite/react-router/picomatch/postcss/brace-expansion) |
| 06-11 | claude@0.1.1 정체불명 패키지 | Medium | `npm uninstall claude` |
| 06-11 | 미사용 의존성 | Low | tslib·html2canvas·svg2pdf.js 제거 (@capacitor/app은 iOS 세트로 보류) |
| 06-11 | HomePage "새 채팅" 무동작 | Medium | resetChat에서 `setActiveChat(null)` 선행 호출 |
| 06-11 | NotePage 이탈 시 재생 지속 | Medium | unmount cleanup `globalPlayer.stop()` (ChordPage 패턴) |
| 06-11 | Editor 음표 없는 패스 탭 프리즈 + miOffset −1 | Medium | `flat.length===0 → break` 가드 + `Math.max(0, findIndex)` |
| 06-11 | Editor tie 빈 마디 `[-1]` 대입 | Low | `lastNotes.length===0 → skip` 가드 |
| 06-11 | Editor 클립보드 실패에도 Copied! | Info | writeText then/catch — 성공시에만 표시, 실패시 에러 배너 |
| 06-11 | engine.renderChart console.log | Info | 제거 |
| 06-11 | harmorag 마커 없으면 통버퍼링 | Low | `openIdx===-1 → debugParsed=true` (chat.ts 동일 처리) |
| 06-11 | loadSeedLicks 캐시 미사용 + 로더 res.ok 부재 | Low | 캐시 가드 + 3개 로더 `res.ok` 검사 + loadLocalLicks `Array.isArray` 가드 |
| 06-11 | saveUserLick/deleteUserLick setItem 무보호 | Low | try-catch + console.warn (QuotaExceeded 대비) |
| 06-11 | ChatSearchModal z-index 충돌 | Low | 1200 → 1300 |
| 06-11 | eslint `^_` ignorePattern | §6 | 의도적 미사용 마커 11건 정리 (lint 79→68) |
| 06-11 | preload/play 미캐치 → AudioLifecycleGuard 오발 | Medium | 5파일(.catch at creation + play try/catch) + useCountInIntro 훅 차원 백스톱(rawPrepare?.catch) |
| 06-11 | 한국어 IME Enter 전수 누락 | Medium | src/lib/ime.ts `isComposingEvent` 신설, 9파일 17곳 가드 (검색/이름변경/폴더/YouTube/코드셀/closeMeasure 등) |
| 06-11 | 로그아웃/계정전환 데이터 정리 누락 (2건) | Medium·보안 | USER_SCOPED_CACHE_KEYS 2→8종 + `jazzify.chartEdit.` prefix 전수 삭제 + IndexedDB omr-images 전체 clear(신규 clearAllOmrSourceImages, dynamic import) |
| 06-11 | LickInputPage 'done' 리스너 누수 | 기술결함(부분) | self-releasing 구독으로 교체 (LickCard 수동정지 경로는 잔존) |
| 06-11 | auth 모듈 초기화 TDZ — proactive refresh 무력화 | Medium | 초기화 블록을 refreshTimer/스케줄러 선언 뒤로 이동 + catch 로깅 |
| 06-11 | RightChatPanel 언마운트 abort 누락 | Medium | unmount cleanup `abortRef.abort()` |
| 06-11 | 채팅 전환 레이스 (히스토리 오염/늦은 응답 승리/loading 고착) | Medium | 전환 시 abort 선행 + historyEpoch 가드로 push 차단 + loadSeq 토큰으로 늦은 backendGetChat 폐기 |
| 06-11 | 이미지 재시도 TypeError | Medium | handleSend(text, files?, preImages?) — retryImages를 변환 없이 전달, 캐스트 제거, 큐에도 preImages 전파 |
| 06-11 | LickCard 리스너 누수 + 마운트 stop 오발 | Medium·기술결함 | unsub ref화(수동정지/실패/릭교체/언마운트 전부 해제) + prevLickId 비교로 첫 마운트 stop 제거 |
| 06-11 | play() await 구간 stop/pause 무시 레이스 | Medium | transportEpoch 도입 — play 진입 시 캡처, stop/pause(starting)/dispose가 증가, await 후 불일치 시 silent return |
| 06-11 | [A] 오디오 9건 | Medium×6·Low×3 | endingTail drumLoop.stop / sampledDrumKit stopAll 실구현(live Set) / 설정 브로드캐스트 callerOverrides 보존 / computeBackingSig 코드해시 / melodyInst in-flight dedup(부분) / GlobalKeyboard·countIn resume(+run 배선) / tempo0 가드×2 / anacrusis ctx 인스턴스 비교 / countIn 취소 재캡처+재진입 resolve |
| 06-11 | [B] 렌더·페이지 3건 | Medium | compact 이중마운트 → JS 조건부 렌더(Chord/Note) / NoteSheet renderTick으로 오버레이 5종 재실행 / break·loop persistedSongIdRef 가드(Chord 2쌍+Note 1쌍) |
| 06-11 | [C] 프로젝트 페이지 5건 | Medium·Low | MyChordCharts allSettled 일괄삭제+placeholder 보존 머지 / MySheetProjects 성공분 즉시 반영+페이지 에러배너+모달 에러 / SolosPage PDF sheetData 보장+SVG 폴링 / OMR 폴러 Map 추적·중복방지·401중단·언마운트 정리 / 직접입력 저장 createdId 재사용 |
| 06-11 | [D] 보안·소형 5건 | Low·보안 | safeVideoUrl(http/https만, 두 소비처) / authFetch origin allowlist(상대 base 보정 포함) / 캐시 형태검증+자가복구(chat·chartMeta) / h→ø·o→° 루트 직후로 제한 / autosave ref-미러 진짜 10초(Editor+SoloGen) |
| 06-11 | [E] 멀티탭 refresh 경쟁 | Medium | Web Locks 직렬화 + 락 후 exp 재확인(타 탭 갱신분 재사용) + storage 이벤트로 타이머 재스케줄/정지 |
| 06-11 | [E] fetchAllLicks 401 폴백 | 기술결함 | tryRefreshAccessToken(redirect 없음) 신설 — 1회 갱신 후 재시도 |
| 06-11 | [E] MySheetProjects 서버연동 | Medium | 마운트 시 listSheetProjects 단일 진실 원천(+로컬 캐시 병합), rename → updateSheetProject 낙관적+롤백 |
| 06-11 | [E] ChatHistoryModal 배선 | 데드코드 | 열 때 listChats 로드, onSelect → setActiveChat (빈 모달 해소) |
| 06-11 | [E] ireal 데드 파이프라인 | 데드코드 | 6파일 1,042줄 삭제 (의존 검증 후), README로 복원 경로 명시 |
| 06-11 | [E] Editor abort 리스너 누적 | Low | waitMs 헬퍼 — resolve 경로에서 removeEventListener |
| 06-11 | [E] CSP 메타(부분) | 보안 | index.html에 실용 정책 추가 — 외부 스크립트 차단(youtube만), frame/object 제한; SRI는 잔존 |
| 06-11 | [E] rules-of-hooks 가짜양성 2건 | §7 | useFlats* → prefersFlats* 리네임 |
| 06-12 | [F] 에러 원문 UI 노출 공통화 | Low·보안 | apiError.ts(readApiErrorMessage) 신설 — message 우선·detail은 dev 콘솔만; chordProjects/sheetProjects/storageFiles(JSON.stringify 제거)·licks×5·solos×2·chat·claude(상태코드 한국어) 적용 |
| 06-12 | [F] OMR /analyze 중복 POST | Low | 모듈 레벨 analyzeOnce(in-flight Map) — 폴러·SheetPreview 자가복구가 동일 Promise 공유 |
| 06-12 | [F] 디바이더 드래그 리스너 잔존 | Info | 해제 함수 ref 보관 + unmount cleanup (Chord/Note) |
| 06-12 | [F] MyChordCharts 데드코드(부분) | 데드코드 | YouTube 모달+addYouTube+상태, 죽은 hidden input·handleOmrFile alias·input ref 2개, 고아 pickGradient 제거 |
| 06-12 | [F] §6 잔여 정리 | §6 | 죽은 pc 블록×2·unused disable×3 제거 — lint 68→60 에러 |
| 06-14 | 추천 버그/데드코드 배치 (8건+부분2) | Med·Low·Info | F3.12 터치 드래그 releasePointerCapture(useLeadSheetSelection) / F4.8 NoteSheet deps(extraParts·forceAutoStem) / F4.9 자동스크롤 r.y 스케일 통일 / F4.10 NotePage RepeatControl→globalPlayer.setConfig 배선 / F7.5 autosave 내용기준 isEmpty+빈상태 removeItem / F9.6 시트 업로드 결과 ref 캐시 재사용(고아 누적 방지) / F9.7 거짓 '열기' HoverOverlay 제거+고아 import/함수 정리 / F10.13 melodyInstMap 캡 evict(비현재 항목 폐기) / I1 analysis.ts 삭제 / I3 capacitor 내부 IP 플레이스홀더화. L7(SRI)은 폰트 동적/미고정이라 보류(셀프호스팅이 정답). build 0 · lint 58E/17W→58E/15W |
| 06-20 | **코드차트 첫 재생 "1 2 3 4 후 무음"** (cross-ctx 클럭 불일치) | High·버그 | 앱루트 워밍업이 `preload({kind:"sheet"})`로 **active=시트 엔진** 고정 → 코드 재생 시 호출부가 `globalPlayer.ctxNow()`(=시트 ctx)로 startAt을 만들어 **다른 AudioContext(코드 엔진)** 기준 먼 미래 시각이 됨 → 이벤트 전부 미래 스케줄 → 무음. 첫 재생만 그런 건 play()가 이후 active를 코드 엔진으로 바꿔서. **수정**: play 옵션에 `downbeatInSec`(카운트인 제공 상대오프셋) 추가, GlobalPlayer.play가 **activate한 엔진의 ctxNow()** 로 startAt 계산 → 호출부 6곳(chord/sheet/lick) `ctxNow()+downbeatInSec` → `downbeatInSec` 전달로 통일. cross-ctx 불일치를 구조적으로 제거(최악도 SAFE_LEAD로 가청). NoteSheet anacrusis(절대 startAt)는 유지. build 0 · lint 56E/15W 유지 |

### ⚡ 최우선 조치 TOP 5

1. **Anthropic API 키 즉시 회전(rotate)** — iOS 배포 번들·dist에 평문 포함, IPA에서 추출해 무제한 과금 호출 가능 (Critical ✅검증완료)
2. **RAG 서버 Bearer 토큰 회전 + 백엔드 프록시 전환** — 번들에 평문 포함, RAG 서버가 Claude 프록시라 LLM 비용 악용 경로 (High ✅검증완료)
3. **`npm audit fix`** — Vite dev 서버 임의 파일 읽기(GHSA-p9ff-h696-f583) 등 high 4건·moderate 3건 (High)
4. **`ensureInstruments` 실패 프로미스 영구 캐시** — 일시적 네트워크 오류 한 번이면 새로고침 전까지 모든 재생 불능 (High)
5. **로그아웃/계정 전환 시 사용자 데이터 정리 누락** — 다음 사용자에게 이전 사용자의 차트 제목·업로드 목록·악보 사진(IndexedDB) 노출 (Medium)

---

## 1. 🔴 Critical — 즉시 조치 (1건)

### [보안] Anthropic API 키가 클라이언트 번들에 베이크되어 배포됨 ✅검증완료

- **위치**: `src/api/claude.ts:1`
- **설명**: src/api/claude.ts:1에서 `const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;`로 키를 읽어, 215행에서 `'x-api-key': ANTHROPIC_API_KEY` 헤더로, 217행에서 `'anthropic-dangerous-direct-browser-access': 'true'` 헤더와 함께 브라우저에서 직접 https://api.anthropic.com/v1/messages 를 호출한다. VITE_ 접두 환경변수는 빌드 시 번들에 평문으로 포함되므로 키가 누구에게나 노출된다. 실제 확인 결과: (1) .env의 VITE_ANTHROPIC_API_KEY는 길이 108의 실제 키 형식(sk-ant…)이며, (2) 동일 키가 로컬 빌드 산출물 dist/assets/index-BOfXtV_G.js 와 iOS 배포 번들 ios/App/App/public/assets/index-DFp_f0nU.js 에 각각 1회씩 그대로 포함되어 있다. 두 경로 모두 gitignore되어 저장소에는 커밋되지 않았으나, capacitor.config.ts 주석 기준 이 iOS 번들은 TestFlight/앱스토어 배포 대상이므로 IPA를 받은 누구나 키를 추출해 무제한 API 사용(과금 탈취)이 가능하다. 호출 경로: src/lib/chat/runChatStream.ts:136 (비로그인 사용자 및 백엔드 스트림 실패 시 폴백) → src/api/harmorag.ts:109,128,211 → streamClaudeMessage. 참고로 git 히스토리(-S "sk-ant")는 검사 결과 docs의 플레이스홀더만 매치되어 저장소 유출은 없었다.
- **권고**: 1) 해당 Anthropic API 키를 즉시 폐기(rotate)하고 새 키는 백엔드에만 보관한다. 2) 프론트의 직접 Anthropic 호출(streamClaudeMessage)을 제거하고, 이미 구현된 백엔드 스트림(/api/v1/chat/*/stream, src/api/chat.ts)으로 일원화한다. 비로그인 사용자는 백엔드에 익명/레이트리밋 엔드포인트를 두거나 로그인 유도로 처리한다. 3) 이미 배포된 TestFlight 빌드가 있다면 키 폐기 전까지 노출 상태이므로 폐기를 최우선으로 한다. 4) .env에서 VITE_ANTHROPIC_API_KEY를 삭제해 재발 방지(VITE_ 접두는 '공개되어도 되는 값' 전용으로 규칙화).
- **검증 노트**: 코드와 빌드 산출물을 직접 읽고 모든 주장을 재현 확인했다. src/api/claude.ts:1에서 `import.meta.env.VITE_ANTHROPIC_API_KEY`로 키를 읽고, :211에서 https://api.anthropic.com/v1/messages 로 직접 fetch, :215 `x-api-key: ANTHROPIC_API_KEY`, :217 `anthropic-dangerous-direct-browser-access: 'true'` 헤더 모두 존재. .env의 VITE_ANTHROPIC_API_KEY는 길이 108·sk-ant 접두의 실제 키 형식(값 미출력)이며, 동일 키가 dist/assets/index-BOfXtV_G.js와 ios/App/App/public/assets/index-BOfXtV_G.js에 각 1회 평문으로 포함됨을 grep로 실증했다. 두 파일 모두 gitignore되어 미추적이고, git 히스토리에서 실제 키 literal은 발견되지 않았…

---

## 2. 🟠 High — 우선 조치 (6건)

### ✅[수정완료 06-11] [버그] 로컬 HarmoRAG 경로에서 Stop(중단) 버튼 무력화 — AbortError를 서버 오류로 오인해 중단 불가능한 폴백 스트림 재시작

- **위치**: `src/api/harmorag.ts:199`
- **설명**: streamWithRAG의 catch 블록(harmorag.ts:199-212)이 AbortError를 일반 오류와 구분하지 않는다. 사용자가 스트리밍 중 Stop 버튼을 누르면(RightChatPanel.tsx:378-380 stopGeneration → abortRef.abort()) fetch가 AbortError로 reject되는데, catch는 이를 'RAG 서버 오류'로 간주하고 (1) serverAlive=false로 설정해 이후 모든 요청이 RAG를 건너뛰게 오염시키고 (2) streamClaudeMessage로 폴백하는데 이 함수는 signal 파라미터 자체가 없다(claude.ts:159-166). 즉 Stop을 눌렀는데 오히려 중단 불가능한 새 직접-Claude 스트림이 시작되고, onChunk가 계속 말풍선을 갱신하며, runChatStream(runChatStream.ts:147-153)의 signal.aborted 체크에도 도달하지 못해 aborted=false로 정상 완료 처리되어 historyRef에도 커밋된다. 이미지 첨부 경로(harmorag.ts:108-110)와 서버 다운 폴백(harmorag.ts:128)도 동일하게 signal 미전달. RightChatPanel의 릭 추천/glick 생성 턴은 forceLocal=true(RightChatPanel.tsx:828)라 로그인 여부와 무관하게 항상 이 경로를 타므로 발생 빈도가 높다.
- **권고**: streamWithRAG의 catch에서 `if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;`로 abort를 재던져 폴백을 막고, streamClaudeMessage에 signal 파라미터를 추가해 모든 폴백 호출에 전달할 것. serverAlive=false 설정도 abort 시에는 건너뛸 것.

### ✅[수정완료 06-11] [버그] ensureInstruments의 실패한 loading 프로미스가 영구 캐시되어 이후 모든 재생이 즉시 실패

- **위치**: `src/lib/backing/player.ts:213`
- **설명**: ensureInstruments()(player.ts:213-234)는 `if (loading) return loading;` 후 `loading = loadInstruments(getCtx()).then(...)` 으로 프로미스를 캐시하는데, loadInstruments가 reject되면(CDN/네트워크 일시 장애 — SplendidGrandPiano·MusyngKite는 외부 fetch) reject된 프로미스가 `loading`에 그대로 남는다. 같은 파일의 melodyLoading(261-263행 finally)과 drumLoopLoading(344-346행 finally)은 완료 시 null로 리셋하지만 `loading`만 리셋 경로가 없다. 리셋은 disposeCtxGraph()(161행)·dispose()(979행)뿐이라, ctx가 정상인 한 이후의 모든 play()/preload()가 동일한 reject 프로미스를 반환받아 즉시 실패한다 — 한 번의 네트워크 블립이 페이지 새로고침 전까지 재생을 영구적으로 망가뜨린다. 또한 이 reject는 GlobalPlayer.play()(GlobalPlayer.ts:599-601)에서 emit 후 재던져지므로 미캐치 호출부에서 unhandledrejection까지 유발한다.
- **권고**: loading 체인에 catch/finally를 붙여 실패 시 `loading = null`로 리셋하고(melodyLoading과 동일 패턴), 다음 ensureInstruments() 호출이 재시도하도록 변경. 실패를 onDrumKitError류 콜백이나 error 채널로 1회 알리는 것도 권장.

### ✅[수정완료 06-11] [버그] Load JSON/릭 데이터의 notes 미검증으로 렌더 단계 크래시

- **위치**: `src/pages/EditorPage.tsx:2246`
- **설명**: handleLoadJson(2087-2133)은 `data.measures`가 배열인지만 검사하고 각 measure에 `notes` 배열이 있는지는 검증하지 않는다. notes가 없는 measure는 splitMeasuresByBeats(88-97)에서 `srcNotes = Array.isArray(src.notes) ? src.notes : []`로 빈 배열 취급된 뒤 `out.push(src)`로 원본(notes: undefined) 그대로 통과한다. 이후 setMeasures가 커밋되면 렌더 단계의 `const totalNotes = measures.reduce((s, m) => s + m.notes.length, 0)`(2246, try 밖)에서 `m.notes.length`가 TypeError를 던져 페이지 전체가 화이트스크린으로 크래시한다. pushEditUndo(1741)의 `m.notes.map(...)`, 자동 BPM effect(1767-1771)의 `m.notes.some(...)`도 동일하게 크래시한다. renderSheet 호출부(2186-2192)에는 try/catch가 있지만 위 지점들은 보호되지 않는다. 트리거 경로: ① Load JSON 모달에 `{"measures":[{"chord":"C"}]}` 같은 JSON 붙여넣기(파일 주석 스스로 'LLM 생성 JSON이 비정상 measure를 만든다'고 인정하는 입력 경로), ② 백엔드에서 온 editingLick.sheetData.measures(1677-1679, 개별 measure 검증 없음).
- **권고**: 로드 경로(handleLoadJson, editingLick, localStorage draft)에서 각 measure를 `{ ...m, notes: Array.isArray(m.notes) ? m.notes : [] }`로 정규화하거나, splitMeasuresByBeats가 빈 srcNotes일 때 `out.push({ ...src, notes: [] })`로 채워서 내보내도록 수정. notes 항목 각각의 keys/duration 형태도 최소 검증 후 setLoadJsonError로 거부하는 것이 안전하다.

### ✅[수정완료 06-11] [버그] 재생 중 페이지 이탈 시 무한 재생 루프가 정리되지 않음

- **위치**: `src/pages/SoloGeneratorPage.tsx:2326`
- **설명**: handlePlay(2173~2490)의 재생 루프는 `while (!abort.signal.aborted)` (2326) 로 loopCount를 올리며 영원히 반복하는 구조인데, abort는 오직 handlePlay 내부의 Stop 클릭(2175 `playAbortRef.current?.abort()`)에서만 호출된다. 컴포넌트 unmount 시 abort/kb.stopAll()을 호출하는 cleanup useEffect가 파일 어디에도 없다(useEffect 전수 확인: 1569, 1625, 1672, 1770, 2056, 2073, 2096 — 모두 재생과 무관). 따라서 재생 중 헤더의 "← Note" 버튼(2558)으로 /note 로 이동하면 전역 키보드(getGlobalKeyboard, 페이지 수명과 무관)를 통한 kb.play() 호출과 setTimeout 체인이 페이지를 떠난 뒤에도 무한히 계속되어 음악이 계속 들리고, 루프 종료 시점의 setPlaying(false)/clearHighlight도 unmount 후 setState가 된다. SolosPage 등 다른 페이지의 NoteSheet는 핸들 기반 stop이 있는 것과 대조적.
- **권고**: 마운트 시 1회 등록되는 cleanup effect를 추가: `useEffect(() => () => { playAbortRef.current?.abort(); pauseResolveRef.current?.(); getGlobalKeyboard().stopAll(); }, [])`. 또한 무한 루프 대신 명시적 루프 토글이 없다면 1회 재생 후 종료를 검토.

### ✅[수정완료 06-11] [의존성] npm audit 취약 의존성 7건 (high 4, moderate 3)

- **위치**: `package.json:1`
- **설명**: npm audit 결과: total 7 (high 4, moderate 3, critical 0). high — react-router 7.0.0~7.14.2 (vendored turbo-stream 역직렬화로 임의 생성자 호출, 비인증 RCE; SSR/loader 미사용 SPA라 실질 노출은 제한적), react-router-dom 7.0.0-pre.0~7.14.1 (react-router 경유), vite 8.0.0~8.0.4 (optimized deps .map 처리 경로 순회 — dev 서버 취약점인데 vite.config.ts:11 의 host:true 로 dev 서버가 LAN/Tailscale에 노출되어 있어 실질 위험이 커짐), picomatch 4.0.0~4.0.3 (POSIX 문자클래스 메서드 인젝션). moderate — postcss <8.5.10 (styled-components 6.1.3~6.4.0 경유, </style> XSS), brace-expansion (프로세스 행/메모리 고갈). 7건 모두 fixAvailable=true 이며 semver-major 변경 없이 해결 가능.
- **권고**: `npm audit fix` 실행(전부 비-major 픽스 제공됨). 특히 vite는 dev 서버를 0.0.0.0으로 열어두는 워크플로우 특성상 우선 패치하고, react-router-dom도 7.14.2 이상으로 올릴 것. 패치 후 `npm run build` 와 기본 화면 회귀 확인.

### [보안] RAG 서버 Bearer 토큰(VITE_RAG_TOKEN)이 클라이언트 번들에 노출 ✅검증완료

- **위치**: `src/api/harmorag.ts:21`
- **설명**: src/api/harmorag.ts:21에서 `const RAG_TOKEN = (import.meta.env.VITE_RAG_TOKEN as string | undefined)?.trim() || '';`로 읽어 24행에서 `Authorization: Bearer ${RAG_TOKEN}` 헤더로 RAG 서버(VITE_RAG_BASE) 인증에 사용한다. VITE_ 접두라서 번들에 평문 포함되며, 실제 확인 결과 .env의 VITE_RAG_TOKEN(길이 48)이 iOS 배포 번들 ios/App/App/public/assets/index-DFp_f0nU.js 에 1회 그대로 포함되어 있다. 이 토큰은 RAG 서버(tmp-rag-server)의 RAG_AUTH_TOKEN과 동일한 서버 측 인증 시크릿(주석 9-11행 명시)이므로, 번들을 열어본 누구나 RAG 서버를 직접 호출할 수 있다. 클라이언트에 배포된 시점에서 접근 통제 수단으로서의 의미를 상실한다.
- **권고**: 토큰을 회전시키고, RAG 호출을 백엔드(jazzify.p-e.kr) 경유 프록시로 전환하거나 사용자별 JWT(authFetch)로 인증하도록 변경한다. 임시 데모 서버라 토큰을 유지해야 한다면 '공개 가능한 레이트리밋 키' 수준으로만 취급하고 서버 측에 IP/사용량 제한을 추가한다.
- **검증 노트**: 코드 직접 확인: src/api/harmorag.ts:21에서 import.meta.env.VITE_RAG_TOKEN을 읽고 23-25행 authHeaders()가 Authorization: Bearer 헤더로 부착, 80행(/health)·136행(/chat) fetch에 사용. 9-11행 주석이 이 값이 tmp-rag-server의 서버 측 RAG_AUTH_TOKEN과 동일하다고 명시. .env에 VITE_RAG_TOKEN이 길이 48 값으로 존재함을 확인(값 미출력). 발견사항이 지목한 index-DFp_f0nU.js는 리빌드로 교체됐으나, 현재 iOS 배포 번들 ios/App/App/public/assets/index-BOfXtV_G.js에 토큰이 평문으로 1회 포함됨을 grep으로 재현. VITE_RAG_BASE도 localhost가 아닌 공개 https 도메인이라 번들 추출만으로 서버 URL+토큰을 모두 획득해 즉시 호출 가능. /chat이 Claude 호출을 프록시하므로…

---

## 3. 🟡 Medium — 계획 조치 (31건)

### ✅[수정완료 06-11] [버그] auth.ts 모듈 초기화 시 proactive 토큰 갱신이 TDZ ReferenceError로 무력화

- **위치**: `src/api/auth.ts:53`
- **설명**: auth.ts 52-55행의 모듈 레벨 코드가 `scheduleProactiveRefresh(window.localStorage.getItem(ACCESS_TOKEN_KEY))`를 호출하는데, 이 함수가 내부에서 참조하는 `let refreshTimer`(71행)는 그 시점에 아직 초기화되지 않은 TDZ(temporal dead zone) 상태다. 따라서 호출 즉시 `ReferenceError: Cannot access 'refreshTimer' before initialization`이 발생하고, 53행을 감싼 `catch { /* private mode */ }`가 이를 조용히 삼킨다(tsx 재현 스크립트로 확인). 결과적으로 주석(50-51행)이 의도한 '이전 세션의 영속 토큰으로 탭을 다시 열었을 때 silent-refresh 타이머 재개' 기능이 전혀 동작하지 않는다. bootstrapAuth→fetchMe 경로는 토큰이 유효하면 setAccessToken을 호출하지 않으므로, 복귀 사용자는 첫 401이 발생할 때까지 proactive refresh 없이 동작하다가 작업 도중 토큰 만료를 맞는다(이 기능이 막으려던 바로 그 시나리오). 첫 로그인/refresh 이후에는 setAccessToken(61행)이 다시 스케줄하므로 그때부터는 정상.
- **권고**: `let refreshTimer ...` 선언(71행)과 `decodeJwtExpMs`/`scheduleProactiveRefresh` 정의를 모듈 레벨 초기화 블록(52-55행)보다 위로 이동하거나, 초기화 호출을 파일 하단(모든 선언 이후)으로 옮긴다. 또한 catch 주석이 '/* private mode */'라 실제 원인을 가리므로, 최소한 console.warn으로 예외를 로깅해 이런 silent failure가 재발하지 않게 한다.

### ✅[수정완료 06-11] [버그] 멀티탭 환경에서 proactive refresh 경쟁 — RTR 재사용 감지 시 세션 강제 만료 가능

- **위치**: `src/api/auth.ts:84`
- **설명**: 단일 탭 내 동시 401은 refreshInFlight(auth.ts:170-191)로 잘 dedup되고, authFetch의 401 재시도는 1회뿐이라 무한 루프도 없다(라인 210-227). 그러나 proactive refresh 타이머(라인 84-95)는 모듈 로드 시점(라인 52-55)에 탭마다 독립적으로 걸리고, refreshInFlight는 탭 내부 변수라 탭 간 dedup이 없다. 같은 토큰을 가진 탭 2개가 만료 60초 전 거의 동시에 POST /v1/auth/refresh를 보내면 동일한 refresh 쿠키를 중복 사용하게 된다. 코드 주석(라인 10-12)대로 백엔드가 RTR(Refresh Token Rotation)이라면, 회전 후 도착한 두 번째 요청이 '토큰 재사용'으로 감지되어 세션 패밀리 전체가 무효화 → 모든 탭이 강제 로그아웃될 수 있다(백엔드의 재사용 감지 정책에 따라 발현). 또한 logout() 후에도 다른 탭의 타이머는 계속 살아 refresh를 시도한다(실패만 하므로 부작용은 작음).
- **권고**: Web Locks API(navigator.locks)나 BroadcastChannel/storage 이벤트로 refresh를 탭 간 단일화하고, refresh 직전에 localStorage의 토큰 exp를 재확인해 다른 탭이 이미 갱신했으면 건너뛰도록 하라. storage 이벤트로 토큰 변경을 수신해 타이머를 재스케줄하면 logout 후 잔여 타이머 문제도 해결된다.

### ✅[수정완료 06-11] [버그] 한국어 IME Enter 버그 전수 — isComposing 체크가 IntroChatInput 한 곳에만 존재, 나머지 Enter 핸들러 전부 누락

- **위치**: `src/components/chat/ChatSearchModal.tsx:98`
- **설명**: grep 전수조사 결과 src/ 전체에서 isComposing 체크는 IntroChatInput.tsx:197 단 한 곳뿐이다. 한국어 조합 확정 Enter(keydown, isComposing=true)가 그대로 액션을 실행하는 곳: [채팅 영역] ChatSearchModal.tsx:98 — 검색어 조합을 확정하려고 Enter를 치는 순간 하이라이트된 채팅이 열리며 navigate('/')까지 실행되어 검색이 중단됨(한국어 제목 검색이 주 사용례라 빈발). [그 외 동일 패턴] MyChordChartsPage.tsx:1291(폴더 생성), 1324(이름 변경), 1375(YouTube URL); MySheetProjectsPage.tsx:546(이름 변경); BackingPlayerBar.tsx:136; YoutubeOnsetParser.tsx:384, 454; LeadSheet.tsx:1257; EditorPage.tsx:1330, 2139, 3438; SoloGeneratorPage.tsx:1348, 2060, 3195; LickInputPage.tsx:1022, 1742, 2732. 특히 한국어 제목을 입력하는 이름 변경/폴더 생성 input은 조합 중 Enter로 마지막 글자가 잘린 채 확정 커밋된다. 참고로 ChatMessage.tsx:936의 편집 textarea는 Cmd/Ctrl+Enter 저장이라 일반 조합 Enter와 충돌하지 않아 제외했다.
- **권고**: 공통 유틸(예: `const isComposingEvent = (e) => e.nativeEvent.isComposing || e.keyCode === 229`)을 만들어 위 모든 Enter 핸들러 첫 줄에서 가드할 것. 최소한 텍스트 input/textarea가 있는 ChatSearchModal·이름 변경·폴더 생성 input부터 적용.

### ✅[수정완료 06-11] [버그] compact 웹 레이아웃에서 RightChatPanel 이중 마운트 — 릭 추천 이벤트 중복 처리·중복 fetch·상태 분기

- **위치**: `src/components/layout/MobileChatFab.tsx:126`
- **설명**: ChordPage/NotePage는 데스크톱용 RightChatPanel을 `!isNativeUi` 조건으로만 렌더하고(ChordPage.tsx:1962-2004, panelTab 기본값 'chat' — ChordPage.tsx:1581), compact 레이아웃에서는 CSS `display:none`으로 숨길 뿐 언마운트하지 않는다(RightPanelWrapper, ChordPage.tsx:882-892). 동시에 MobileChatFab은 useCompactLayout()이 true면 자체 RightChatPanel을 항상 마운트 상태로 유지한다(MobileChatFab.tsx:123-150, 닫혀 있어도 display:none). 따라서 좁은 브라우저 창·iPad Safari 등 '네이티브 아님 + compact' 조합에서 RightChatPanel 인스턴스 2개가 동시에 살아 있다. 결과: (1) `jazzify:requestLicks` window 이벤트(RightChatPanel.tsx:596-600)를 두 인스턴스가 모두 수신해 릭 추천 user/assistant 쌍이 양쪽 패널에 각각 삽입되고 두 대화 상태가 분기함, (2) onActiveChatChange 구독도 2개라 사이드바 채팅 클릭 시 GET /v1/chat/{id}가 2번 발사됨, (3) 한쪽에서 새 채팅 생성 시 setActiveChat(newId)가 다른 쪽의 재로딩을 또 유발.
- **권고**: 데스크톱 패널도 CSS 숨김 대신 useCompactLayout() 값으로 조건부 렌더(JS 언마운트)하거나, MobileChatFab처럼 compact 여부를 한 곳에서 판정해 둘 중 하나만 마운트되도록 보장할 것.

### ✅[수정완료 06-11] [버그] 이미지 첨부 턴 재시도(Retry) 시 TypeError로 메시지 유실 — ClaudeImage[]를 File[]로 강제 캐스트

- **위치**: `src/components/layout/RightChatPanel.tsx:1212`
- **설명**: 에러 턴의 인라인 재시도 핸들러(RightChatPanel.tsx:1194-1213)가 `void handleSend(prompt, imgs as unknown as File[] | undefined)`로 retryImages(ClaudeImage[] — {mediaType, data} 형태)를 File[]인 척 넘긴다. handleSend는 이를 fileToClaudeImage(RightChatPanel.tsx:190-199)에 통과시키는데, 첫 줄 `file.type.startsWith('image/')`에서 file.type이 undefined라 TypeError가 발생 → Promise.all reject → handleSend 전체가 unhandled rejection으로 조용히 죽는다. 문제는 onRetry가 이미 setMessages로 실패한 user/assistant 말풍선을 제거한 뒤(1203-1211)라서, 재시도가 아무것도 보내지 못한 채 사용자의 원본 메시지+이미지가 화면에서 완전히 사라진다는 점이다.
- **권고**: handleSend가 File[] 대신 이미 변환된 ClaudeImage[]도 받을 수 있게 시그니처를 분리하거나(예: handleSend(text, {files?, images?})), onRetry 전용 내부 경로를 만들어 retryImages를 변환 없이 그대로 사용할 것. `as unknown as` 캐스트는 제거.

### ✅[수정완료 06-11] [버그] RightChatPanel 언마운트 시 AbortController 정리 누락 — 탭 전환/새 채팅/네비게이션 중 스트림이 백그라운드에 계속 흐름

- **위치**: `src/components/layout/RightChatPanel.tsx:377`
- **설명**: abortRef(RightChatPanel.tsx:377)는 stopGeneration(379)과 handleSend(820, 924)에서만 다뤄지고, 언마운트 시 abort하는 cleanup effect가 전혀 없다(grep으로 확인: 377/379/820/924가 전부). 실제 언마운트 경로가 흔하다: ChordPage/NotePage의 우측 패널 탭을 'AI 채팅'→'믹서'로 전환하면 조건부 렌더(ChordPage.tsx:1968-2004)로 패널이 즉시 언마운트되고, HomePage의 새 채팅은 chatKey 증가로 패널을 리마운트한다(HomePage.tsx:723-731). 이때 진행 중 스트림은 중단되지 않아 네트워크/토큰이 계속 소모되고, 완료 시 notifyChatListChanged 등 부수효과가 언마운트 후에도 실행되며, 비영속(미로그인) 대화는 그대로 유실된다.
- **권고**: RightChatPanel에 `useEffect(() => () => { abortRef.current?.abort(); }, [])` 언마운트 cleanup을 추가할 것. ChordPage/NotePage의 탭 전환은 언마운트 대신 display 토글로 패널을 유지하는 것도 함께 검토.

### ✅[수정완료 06-11] [버그] 스트리밍 도중 사이드바에서 다른 채팅 선택 시 레이스 — 진행 중 스트림 미중단 + 새 채팅 히스토리에 이전 채팅 턴 주입

- **위치**: `src/components/layout/RightChatPanel.tsx:893`
- **설명**: 두 가지 레이스가 있다. (1) onActiveChatChange 핸들러(RightChatPanel.tsx:428-470)는 채팅 전환 시 abortRef를 중단하지 않고 setMessages/historyRef.current를 새 채팅 내용으로 교체만 한다. 이전 턴의 스트림이 백그라운드에서 완료되면 893-898의 `historyRef.current.push({role:'user',...},{role:'assistant',...})`가 이미 새 채팅의 배열로 교체된 historyRef에 이전 채팅의 턴을 push한다 → 새 채팅에서 다음 질문을 보내면 LLM 컨텍스트에 남의 채팅 턴이 섞여 들어간다(화면에는 안 보여 디버깅도 어려움). 또한 loading이 이전 스트림 종료까지 true로 남아 새로 로드된 채팅의 마지막 assistant 말풍선이 isStreaming(1189)으로 잘못 표시된다. (2) 채팅 A 클릭 직후 B를 빠르게 클릭하면 두 backendGetChat이 동시에 날아가고 요청 토큰/취소 가드가 없어 늦게 도착한 쪽이 승리한다(440-462) — A가 늦으면 사이드바는 B를 하이라이트하는데 패널에는 A의 메시지와 chatPublicId가 로드되는 불일치가 생긴다.
- **권고**: (1) onActiveChatChange에서 채팅 전환 시 `abortRef.current?.abort()`를 먼저 호출하고, handleSend 쪽은 스트림 시작 시점의 chatPublicId를 캡처해 완료 시점에 동일할 때만 historyRef에 push할 것. (2) 로드 요청마다 증가하는 시퀀스 토큰(또는 AbortController)을 두고, 응답 도착 시 최신 요청이 아니면 결과를 폐기할 것.

### ✅[수정완료 06-14] [버그] LeadSheet: 터치 포인터의 implicit pointer capture로 모바일에서 드래그 범위 선택 불가

- **위치**: `src/components/leadsheet/LeadSheet.tsx:2549`
- **설명**: 코드 드래그 선택은 시작 코드의 onPointerDown(1227, handleSelectionPointerDown 2549-2559)과 다른 코드들의 onPointerEnter(1228, handleSelectionPointerEnter 2561-2566) 조합으로 동작한다. 그러나 터치 포인터는 Pointer Events 명세상 pointerdown을 받은 요소에 암시적 pointer capture가 걸리므로, 드래그 중 다른 ChordColumn에서 pointerenter가 발생하지 않는다. 파일 전체에 setPointerCapture/releasePointerCapture 호출이 없고 pointermove+elementFromPoint 대체 경로도 없다. 결과적으로 모바일(터치)에서는 dragMovedRef가 영원히 false라 범위 드래그가 첫 코드 1개 선택(클릭)으로만 끝난다. ChordColumn에 `touch-action: none`(1033)을 명시한 것으로 보아 터치 드래그를 의도한 설계인데 실제로는 동작하지 않는 상태다. (pointerup을 window에 거는 것(2606-2611)과 pointercancel 처리는 정상이라 stuck 문제는 없음.)
- **권고**: handleSelectionPointerDown에서 `event.currentTarget.releasePointerCapture(event.pointerId)`를 호출해 암시적 캡처를 해제하거나, window pointermove에서 `document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-chord-key]')`로 현재 타깃을 찾아 handleSelectionPointerEnter를 호출하는 방식으로 변경하라.

### ✅[수정완료 06-11] [버그] LickCard: 수동 정지 시 전역 플레이어 이벤트 리스너 누수 → 다른 재생이 정지된 카드에 하이라이트를 그림

- **위치**: `src/components/notesheet/LickCard.tsx:749`
- **설명**: togglePlay(726-762)는 재생 시작 시 `player.on('bar'/'note'/'done')` 3개 리스너를 구독하고(749-758) 해제는 오직 'done' 핸들러 내부의 `unsub.forEach(...)`(756)에서만 수행한다. 그런데 수동 정지 분기(727-734)와 lick 변경 effect(765-771)는 `player.stop()`만 호출하는데, GlobalPlayer.stop()→BackingPlayer.stop()(src/lib/backing/player.ts:852-871)은 `onDone`을 emit하지 않고 `onBar(-1)`만 발생시키며, GlobalPlayer의 wiring(src/lib/player/GlobalPlayer.ts:246-251, 275-279)은 `barIndex < 0`을 필터링한다. 결과: (1) play→수동 stop 사이클마다 리스너 3개가 전역 싱글톤 플레이어에 누적되고, (2) player는 앱 전역 공유 싱글톤이므로 이후 다른 릭 카드/악보 페이지가 재생되면 누수된 'note'/'bar' 핸들러가 정지된 카드의 noteElMapRef/measureRectsRef에 인덱스를 적용해 그 카드의 SVG에 파란 음표·마디 하이라이트를 잘못 그린다(입력 kind 가드도 없음). 누수 리스너는 미래의 임의 재생이 'done'을 emit해야 비로소 해제된다.
- **권고**: unsub 배열을 ref에 보관하고 수동 정지 분기·lick 변경 effect·컴포넌트 unmount cleanup에서 항상 해제하라. 추가로 InlineLickRow(257-265)처럼 `player.currentInput?.kind === 'lick'` 및 자기 lick 여부 가드를 두면 전역 버스 혼선을 원천 차단할 수 있다.

### ✅[수정완료 06-11] [버그] preload/play 미캐치 rejection → unhandledrejection → AudioLifecycleGuard가 stopAllAudio로 재생을 끊는 경로

- **위치**: `src/components/notesheet/NoteSheet.tsx:1125`
- **설명**: AudioLifecycleGuard(AudioLifecycleGuard.tsx:41)는 window 'unhandledrejection'에 stopAllAudio()로 반응한다. 그런데 (1) 카운트인과 병렬로 넘기는 prepare 프로미스는 useCountInIntro.run() 내부에서 카운트인이 끝난 뒤에야 await되므로(useCountInIntro.tsx:160), 그 사이(~2초) preload가 reject되면 핸들러 미부착 상태에서 unhandledrejection이 발생한다. 미캐치 prepare 위치: ChordPage.tsx:1364, NoteSheet.tsx:1125(1202에서 사용, 1152의 `await preload`도 try/catch 없음), LickCard.tsx:742, LickCreator.tsx:682, LickInputPage.tsx:1879. (2) GlobalPlayer.play()는 emit('error') 후 재던지는데(GlobalPlayer.ts:599-601) `await player.play(...)`를 try/catch 없이 호출하는 곳: NoteSheet.tsx:1192·1205, LickCard.tsx:761, LickCreator.tsx:685, LickInputPage.tsx:1884 — 실패 시 unhandledrejection + setPlaying(true)로 굳은 UI. 참고로 LickRecommendMessage.tsx:591(.catch 부착)과 621-628(try/catch)에는 동일 문제의 수정과 원인 주석이 이미 존재한다.
- **권고**: LickRecommendMessage와 동일하게 (a) prepare로 넘기는 preload 프로미스에 생성 즉시 `.catch(() => {})` 부착(또는 useCountInIntro.run() 진입부에서 prepare에 선제 catch 체인을 붙여 훅 차원에서 차단), (b) 모든 `await player.play(...)`를 try/catch로 감싸 실패 시 playing 상태를 리셋.

### ✅[수정완료 06-11] [버그] NoteSheet: 비동기 VexFlow 렌더와 SVG 오버레이 effect 간 실행 순서 역전(오버레이 유실 레이스)

- **위치**: `src/components/notesheet/NoteSheet.tsx:1516`
- **설명**: 메인 악보 렌더 effect(1512-1521)는 `__ensureVexflow().then(() => { elOuter.innerHTML = ''; renderNotation(elOuter); })`로 항상 마이크로태스크(비동기)에서 SVG를 새로 그린다. 반면 SVG에 직접 주입하는 오버레이 effect들 — 마디 하이라이트 .m-hl(1233-1252), 마디 번호 .m-num(1257-1284), Break 마커 .brk-mk/.brk-lbl(1298-1365), 선택 하이라이트 .m-sel(1368-1392), 행 시작 번호 .m-num-ls(2296-2324) — 는 같은 커밋의 동기 effect 플러시에서 먼저 실행된다. 따라서 data/width가 바뀔 때마다 (1) 오버레이는 이전 렌더의 낡은 SVG와 낡은 measureRectsRef 위에 그려지고, (2) 직후 비동기 renderNotation이 `innerHTML = ''`로 전부 지운 뒤 새 SVG를 그리지만 오버레이 effect를 다시 트리거할 메커니즘(렌더 완료 후 state bump 등)이 없어 새 SVG에는 오버레이가 없다. 2291-2295의 주석('Defined AFTER the main render effect above so measureRectsRef is already populated when this runs')은 렌더가 동기였던 시절의 가정으로, dynamic import 도입 후 깨졌다. 실제 영향: NotePage(1108,1129)/SolosPage(1082)/MySheetProjectsPage(683)의 lineStartMeasureNumbers, 키 전환 등 data 변경 후의 measure number/Break 라벨이 사라지거나 깜빡이며, 일시정지 중 리사이즈 시 .m-hl도 다음 bar 이벤트까지 유실된다.
- **권고**: renderNotation 완료 시점을 React에 알리는 renderTick state(예: `.then`에서 `setRenderTick(t => t + 1)`)를 추가하고 모든 오버레이 effect의 deps에 포함시키거나, 오버레이 그리기를 renderNotation 내부(렌더 완료 직후)로 이동해 동일 비동기 흐름에서 처리하라.

### ✅[수정완료 06-11] [버그] endingTail=false 종료 경로에서 drumLoop 미정지 — 릭 종료 후 드럼 루프가 무한 재생

- **위치**: `src/lib/backing/player.ts:552`
- **설명**: tick()의 endingTail===false 분기(player.ts:552-565)는 '마지막 음이 자체 엔벨로프로 울리게' playing=false·RAF 취소·onDone만 하고 killActiveNodes()를 의도적으로 생략하는데, 이때 drumLoop.stop()도 빠져 있다. 드럼 킷이 brushes/sticks(루프 모드, DRUM_KIT_PRESETS → drumMode:'loop')이면 play()에서 시작한 AudioBufferSourceNode(loop=true, drumLoopPlayer.ts:80)는 스스로 끝나지 않으므로, 릭(GlobalPlayer.ts:454에서 seed.endingTail=false) 한 패스가 끝나 UI가 ▶로 돌아온 뒤에도 드럼 루프가 영원히 계속 울린다. 루프 파일은 public/samples/drums/jazz/loops/에 실제 번들되어 있어 재현 가능한 경로다.
- **권고**: endingTail===false 분기에서도 `drumLoop?.stop()`은 호출(피치 악기의 잔향만 남기고 무한 루프 소스는 정지). 피아노/베이스/멜로디는 duration으로 자연 종료되므로 그대로 두면 된다.

### ✅[수정완료 06-11] [버그] play()의 await 구간에서 stop()/pause()가 무시되는 재진입 레이스 — 정지 후 재생이 시작됨

- **위치**: `src/lib/backing/player.ts:734`
- **설명**: play()(player.ts:734-809)의 `starting` 플래그는 이중 play만 막는다. play()가 `await ensureCtx()/ensureInstruments()/ensureDrumLoop()`(749-751행, 콜드 스타트 시 수 초) 대기 중에 stop()(852-871행)이 호출되면 stop은 정상 수행되지만(playing은 아직 false), 이후 play()가 awaits를 마치고 753행에서 `playing = true`를 세팅하고 tick()을 시작해 재생이 그대로 개시된다. pause()(816행)는 `if (!playing) return`이라 starting 구간에서 아예 무력화된다. 결과적으로 사용자가 카운트인/로딩 중 정지를 눌러도 로드 완료 후 음악이 시작되고, 페이지 UI(isPlaying=false)와 엔진 상태(playing=true)가 어긋난다. 같은 구간에서 dispose()가 끼어들면 getCtx()가 throw하여(182행) play()가 reject되는 경로도 존재한다.
- **권고**: play() 진입 시 세대 토큰(epoch)을 증가시키고 stop()/pause()/dispose()에서도 증가시켜, awaits 이후 `playing = true` 직전에 토큰이 변했으면 조용히 return하도록 가드. 또는 starting 중 stop 요청을 기록했다가 awaits 후 확인하는 stopRequested 플래그 추가.

### ✅[수정완료 06-11] [버그] 글로벌 설정 변경 시 per-player 오버라이드(릭 프리셋 등)가 통째로 덮어써짐

- **위치**: `src/lib/backing/player.ts:997`
- **설명**: createBackingPlayer 생성 시에는 mixSettingsIntoConfig(s, base)에서 `...base`(initialConfig)가 우선이지만(player.ts:65-79), 글로벌 설정 구독 콜백(997-999행)은 `setConfig(mixSettingsIntoConfig(next, {}))`로 빈 base를 전달한다. 그 결과 사용자가 믹서 슬라이더 하나만 움직여도 모든 살아있는 플레이어의 style·loop·melodyInstrument·pianoReverb가 글로벌 값으로 덮어써진다. 구체적 피해: 릭 엔진은 GlobalPlayer.ts:447-455에서 melodyInstrument:'piano'(고정)·pianoReverb:0.5·loop:false로 시드되는데, 글로벌 멜로디 악기가 sax인 상태에서 설정이 한 번이라도 브로드캐스트되면 릭이 sax로 재생되고, 재생 중이었다면 setConfig의 melodyInstChanged 분기(907-919행)로 릭이 중간에 stop된다. 오케스트레이터가 setConfig로 넣은 style/feel도 동일하게 클로버된다.
- **권고**: 플레이어가 생성 시 받은 initialConfig(콜러 오버라이드)를 보관해 두고 구독 콜백에서 `mixSettingsIntoConfig(next, savedInitialOverrides)`로 합치거나, 구독 콜백에서는 볼륨·드럼킷 등 순수 믹서 필드만 패치하고 style/loop/melodyInstrument/pianoReverb는 오버라이드가 없을 때만 반영하도록 분리.

### ✅[수정완료 06-11] [버그] sampledDrumKit.stopAll()이 no-op — 정지/일시정지/브레이크 시 드럼이 계속 울림

- **위치**: `src/lib/backing/sampledDrumKit.ts:164`
- **설명**: loadSampledDrumKit의 stopAll()(sampledDrumKit.ts:164-166)은 'AudioBufferSourceNodes clean themselves up automatically' 주석만 있는 빈 함수다. 그러나 BackingPlayer는 lookahead 0.2초(LOOKAHEAD_SEC, player.ts:30) 앞서 trigger하므로, stop()/pause()/seekToBar()의 killActiveNodes()(player.ts:631-638)와 브레이크 에디터의 하드컷(444-447행)이 드럼에 대해 전혀 듣지 않는다 — 이미 스케줄된 미래 히트가 그대로 발사되고, 라이드/크래시 같은 긴 샘플은 정지 후에도 수 초간 잔향이 계속된다. 피아노/베이스는 smplr의 stop()이 스케줄된 보이스까지 끊는 것과 대조적이다. 시작된 소스를 추적하지 않아 disconnect 수단 자체가 없다.
- **권고**: trigger에서 생성한 src/gain 노드를 Set에 보관하고 src.onended에서 제거, stopAll()에서 `try { src.stop(); src.disconnect(); gain.disconnect(); }`로 전부 정지하도록 구현.

### ✅[수정완료 06-11] [버그] GlobalKeyboard/countInClick — suspended AudioContext 복구 미보장 (iOS Safari)

- **위치**: `src/lib/player/GlobalKeyboard.ts:65`
- **설명**: GlobalKeyboard는 loadPiano()(GlobalKeyboard.ts:70-78)의 최초 1회만 resume을 시도하고, 이미 로드된 뒤에는 ensureReady()가 `if (_piano) return;`으로 조기 반환(67행), play()(86-105행)도 resume을 전혀 하지 않는다. iOS Safari/Capacitor에서 앱 백그라운드·전화 인터럽트 후 ctx가 suspended로 떨어지면 이후 모든 클릭 투 히어가 영구 무음이 된다(BackingPlayer는 statechange 자동 resume이 있는 것과 대조적, player.ts:173-178). 같은 패턴으로 countInClick.ensureCtx()(countInClick.ts:21-23)는 `void sharedCtx.resume()`으로 fire-and-forget만 하므로, suspended 상태에서 run()이 호출되면 frozen currentTime 기준으로 클릭이 스케줄되어 resume 완료 직후 첫 카운트인 클릭들이 뭉개지거나 늦게 시작될 수 있다.
- **권고**: GlobalKeyboard.play()/ensureReady()에서 `_ctx.state !== 'running'`이면 resume을 시도(사용자 제스처 안에서 호출되므로 성공 가능)하고, countInClick은 resume 완료를 기다린 뒤(또는 resume 후 currentTime을 다시 읽어) 클릭을 스케줄하도록 수정.

### ✅[수정완료 06-11] [버그] computeBackingSig의 약한 시그니처로 코드(차트) 수정이 재생에 반영되지 않는 stale 캐시

- **위치**: `src/lib/player/GlobalPlayer.ts:511`
- **설명**: ensureBackingPlayer(GlobalPlayer.ts:298-357)는 sig가 같으면 기존 엔진을 그대로 반환하는데, computeBackingSig(511-525행)는 title+style+systems.length만 본다. 같은 곡에서 코드 심볼을 수정해도(시스템 수 불변) sig가 동일해 leadSheetToChart 재변환 없이 이전 차트로 재생된다. 멜로디 경로는 동일 문제를 hashMeasures 콘텐츠 해시(464-509행, 주석에 '두 릭이 충돌해 이전 릭이 재생됐다'는 실사례 기록)로 이미 해결했지만 차트 경로엔 적용되지 않았다. 또한 305행 주석의 'stop()을 먼저 호출하면 강제 리빌드 가능'은 사실과 다르다 — stop()은 backingPlayerSig를 지우지 않는다.
- **권고**: 멜로디 경로처럼 차트의 코드 내용(시스템·바·코드 토큰)에 대한 롤링 해시를 sig에 포함시키거나, sig 일치 시에도 backingPlayer.setChart(chart) + barChordTable 재계산으로 콘텐츠만 스왑(멜로디 fast path와 동일 기법). 잘못된 주석도 함께 수정.

### ✅[수정완료 06-11] [버그] 재생 루프가 음표 없는 패스에서 동기 무한 루프 → 탭 프리즈 + miOffset -1 오프바이원

- **위치**: `src/pages/EditorPage.tsx:2439`
- **설명**: handlePlay의 외부 루프 `while (!abort.signal.aborted)`(2439)는 내부의 `while (i < flat.length)`(2540)에서만 await한다. flat이 빈 배열이면 expandMeasures/compChords 계산 후 즉시 loopCount++로 되돌아가 await가 전혀 없는 동기 무한 루프가 되어 메인 스레드가 완전히 멈춘다(정지 버튼 클릭조차 불가, 탭 강제 종료 필요). 트리거: 2번째 패스부터는 `srcMeasures = allMeasures.slice(firstChordIdx)`(2447-2449)인데, 첫 코드 보유 마디 이후 구간에 음표가 하나도 없으면 flat.length === 0이 된다. 예: 멜로디를 코드 없이 입력한 뒤 마지막(열린) 마디에 코드만 입력하고 재생 — 1회 재생 후 즉시 프리즈. 추가로 2455행 `const miOffset = loopCount === 0 ? 0 : (allMeasures.findIndex((m) => !!m.chord) || 0)`는 findIndex가 -1을 반환할 때 `-1 || 0`이 -1로 평가되어(−1은 truthy) 2번째 패스부터 하이라이트 마디 인덱스가 한 칸 어긋난다. 같은 함수의 startIdx 계산(2448)은 `firstChordIdx >= 0 ? firstChordIdx : 0`으로 올바르게 처리하고 있어 불일치다.
- **권고**: 루프 진입 전 또는 패스 시작 시 `if (flat.length === 0) break;` 가드를 추가하고, miOffset은 `Math.max(0, allMeasures.findIndex(...))` 또는 startIdx와 동일한 삼항식으로 수정.

### ✅[수정완료 06-11] [버그] HomePage '새 채팅'이 setActiveChat(null)을 누락 — 리마운트 직후 기존 채팅이 자동으로 되살아남

- **위치**: `src/pages/HomePage.tsx:723`
- **설명**: HomePage의 resetChat(HomePage.tsx:723-726)은 chatKey만 증가시켜 RightChatPanel을 리마운트할 뿐 전역 활성 채팅을 해제하지 않는다(IconSidebar 기본 핸들러는 `setActiveChat(null); navigate('/')`를 호출하지만 — IconSidebar.tsx:773 — HomePage가 onNewChat={handleNewChatClick}으로 덮어씀, HomePage.tsx:753). onActiveChatChange는 늦은 구독자에게 현재 _activeChatId를 즉시 콜백하므로(api/chat.ts:151-155), 사이드바에서 채팅을 열어둔 로그인 사용자가 '새 채팅'을 누르면 새로 마운트된 패널(RightChatPanel.tsx:428-470)이 그 즉시 같은 채팅을 backendGetChat으로 다시 로드한다 → '새 채팅' 버튼이 사실상 동작하지 않는다.
- **권고**: HomePage의 resetChat(또는 handleNewChatClick)에서 chatKey 증가 전에 `setActiveChat(null)`을 호출할 것.

### ✅[수정완료 06-11] [버그] 일괄 삭제 부분 실패 시 서버-UI 불일치(성공분 미반영, 재동기화 없음)

- **위치**: `src/pages/MyChordChartsPage.tsx:731`
- **설명**: deleteSelected(731~745)는 `Promise.all(projectIds.map(deleteChordProject))`로 병렬 삭제하는데, 일부만 실패하면 catch로 빠져 setProjects 갱신도 reloadProjects()도 하지 않는다. 서버에서 이미 삭제된 항목들이 화면에 그대로 남고, 재시도하면 이미 삭제된 id에 대해 404가 나 다시 전체 실패처럼 보인다. 단일 삭제 deleteItem(629~652)은 성공 후 `void reloadProjects()`(647)로 재동기화하는 것과 대조적으로 일괄 경로만 누락. 같은 패턴이 MySheetProjectsPage.tsx:249~271 confirmBulkDelete(순차 삭제)에도 있다 — k번째에서 실패하면 이미 삭제된 0..k-1 항목이 setUploadedProjects에 반영되지 않아 목록에 남는다.
- **권고**: Promise.allSettled로 전환해 성공한 id만 목록에서 제거하고, 실패 건수를 에러 메시지에 표기한 뒤 reloadProjects()로 재동기화. MySheetProjectsPage는 루프 안에서 성공한 id를 즉시 상태에서 제거(또는 성공 id 목록을 모아 finally에서 일괄 제거).

### ✅[수정완료 06-11] [버그] MySheetProjectsPage: 삭제 실패 에러가 화면에 전혀 표시되지 않음

- **위치**: `src/pages/MySheetProjectsPage.tsx:526`
- **설명**: `error` 상태를 렌더하는 곳은 생성 모달 내부의 `{error && <ModalError>{error}</ModalError>}`(526) 한 곳뿐이다. 그런데 deleteUploaded(237)와 confirmBulkDelete(267)도 실패 시 setError를 호출한다 — 이때 생성 모달(createOpen)은 닫혀 있으므로 사용자는 아무 피드백도 받지 못한다. 특히 일괄 삭제 확인 모달(575~609)에는 에러 표시가 없어, 실패 시 '삭제 중…'만 풀린 채 모달이 열려 있어 멈춘 것처럼 보인다. MyChordChartsPage는 페이지 레벨 ErrorBanner(924~929)로 표시하는 것과 비대칭(복붙 후 한쪽만 구현된 형태).
- **권고**: MyChordChartsPage와 동일하게 페이지 레벨 에러 배너를 추가해 삭제/일괄 삭제 실패를 표시하고, 일괄 삭제 확인 모달 내부에도 에러 텍스트를 렌더. 생성 전용 에러와 페이지 에러 상태를 분리하는 것도 방법.

### ✅[수정완료 06-11] [버그] MySheetProjectsPage가 서버 목록/수정 API를 쓰지 않고 localStorage만 사용 (이름 변경은 서버 미반영)

- **위치**: `src/pages/MySheetProjectsPage.tsx:82`
- **설명**: uploadedProjects는 localStorage 키 'jazzify.mySheets.uploaded.v1'(28, 42~54)로만 관리되고, src/api/sheetProjects.ts에 이미 존재하는 listSheetProjects(GET /v1/sheet-projects, 112행)와 updateSheetProject(PUT, 142행)를 전혀 사용하지 않는다. 결과: (a) 다른 기기/브라우저에서 만든 프로젝트가 안 보이고, localStorage가 지워지면 서버에 살아있는 프로젝트가 UI에서 영영 사라짐(생성 stale 캐시), (b) confirmRename(213~220)은 로컬 제목만 바꾸고 서버 PUT을 호출하지 않아 서버 제목과 영구 불일치 — MyChordChartsPage의 renameItem/confirmEdit(610, 698)가 updateChordProject로 서버 반영하는 것과 비대칭. 두 페이지를 "항상 동일하게" 유지하는 규칙에도 어긋난다.
- **권고**: MyChordChartsPage의 reloadProjects 패턴처럼 마운트 시 listSheetProjects로 서버 목록을 로드해 단일 진실 원천으로 삼고, 이름 변경은 updateSheetProject를 호출한 뒤 응답으로 상태를 갱신. localStorage는 캐시 용도로만 제한.

### ✅[수정완료 06-11] [버그] NotePage 이탈 시 GlobalPlayer 정지 누락 — 페이지를 떠나도 재생 지속

- **위치**: `src/pages/NotePage.tsx:732`
- **설명**: NotePage는 useGlobalPlayer 싱글톤(732)으로 breakBeats 설정만 푸시하고, 재생 제어는 NoteSheet의 imperative handle에 위임한다. 그러나 NotePage에도 NoteSheet에도 unmount 시 player.stop()을 호출하는 cleanup이 없다. NoteSheet.tsx의 정지 로직은 `useEffect(() => { player.stop(); ... }, [data])`(NoteSheet.tsx:1092-1099)로 data 변경 시 effect 본문에서만 실행되고 cleanup 함수를 반환하지 않으므로 unmount에서는 아무것도 실행되지 않는다. 결과: 악보 재생 중 사이드바로 다른 페이지로 이동하면 멜로디/반주가 계속 재생된다. 동일 상황을 ChordPage는 명시적으로 처리하고 있다(ChordPage.tsx:1261-1265, "Stop the GlobalPlayer when this page unmounts" 주석과 함께 unmount cleanup에서 globalPlayer.stop() 호출).
- **권고**: NotePage에 ChordPage와 동일한 `useEffect(() => () => globalPlayer.stop(), [globalPlayer])`를 추가하거나, NoteSheet의 [data] 정지 effect에 cleanup(`return () => player.stop();`)을 추가해 unmount에서도 정지되도록 수정.

### ✅[수정완료 06-11] [버그] PDF 다운로드가 악보 데이터 로드를 기다리지 않는 고정 350ms 레이스

- **위치**: `src/pages/SolosPage.tsx:787`
- **설명**: handlePdfDownload(787~823)는 미선택 행에 대해 setSelectedId 후 rAF 2회 + 고정 350ms(792~793)만 대기한다. 그러나 목록 행은 metadata-only(sheetData 없음)라서 별도 effect(564~574)가 getSolo()를 비동기로 fetch해 머지해야 NoteSheet가 렌더된다. 네트워크+렌더가 350ms를 넘으면 previewBody에 악보 SVG가 없어 '악보가 준비되지 않았습니다' 에러가 나거나, 다른 작은 SVG(아이콘 등)를 "가장 큰 svg"(799~808)로 오인해 엉뚱한 PDF를 만들 수 있다. 또한 이미 선택된 행(selectedId === solo.publicId)인데 getSolo fetch가 아직 진행 중인 경우에는 대기 자체가 없어(790 분기 미진입) 거의 항상 실패한다.
- **권고**: 고정 대기 대신 sheetData 존재를 기준으로 대기: PDF 진입 시 해당 솔로의 sheetData가 없으면 getSolo를 직접 await 해 머지한 뒤, 렌더 완료를 폴링(또는 NoteSheet 렌더 콜백)으로 확인하고 export를 진행. 선택된 SVG가 악보인지 최소 크기 검증도 추가.

### [기술적 결함] 메시지 편집/재생성 fork가 백엔드 영속 히스토리와 불일치 — 재로딩 시 삭제한 턴 부활·답변 중복

- **위치**: `src/components/layout/RightChatPanel.tsx:991`
- **설명**: handleEditAndResend(RightChatPanel.tsx:991-1002)와 handleRegenerate(973-985)는 로컬 messages/historyRef만 슬라이스하고 같은 chatPublicId로 재전송한다. 백엔드는 스트림 요청마다 메시지를 영속화하므로(api/chat.ts 주석 및 /v1/chat/{id} 상세 조회 구조), 서버에는 잘려나간 이전 user/assistant 턴이 그대로 남고 그 뒤에 새 턴이 append된다. 사이드바에서 그 채팅을 다시 열면(onActiveChatChange → backendGetChat, RightChatPanel.tsx:440-461) 편집으로 삭제했던 턴과 재생성 전의 옛 답변이 전부 부활해 '편집 fork' 의미가 깨진다. 부수 결함: 두 핸들러 모두 `handleSend(prompt)`로 텍스트만 재전송해 원 턴의 이미지 첨부(prevUser.images)가 유실된다(984, 1001).
- **권고**: 백엔드에 fork 지점 이후 메시지 삭제(또는 분기) API가 생기기 전까지는, 편집/재생성 시 새 chatPublicId로 새 채팅을 만들거나 최소한 재로딩 시 중복 턴을 안내해야 한다. 단기적으로는 편집/재생성 직전에 해당 publicId 뒤 메시지를 DELETE하는 엔드포인트 협의를 권장. 재전송 시 prevUser.images도 함께 전달할 것.

### ✅[수정완료 06-14: in-flight dedup(06-11) + 캡 기반 evict(06-14)] [기술적 결함] melodyInstMap 무한 누적 + 동일 악기 동시 중복 로드 레이스

- **위치**: `src/lib/backing/player.ts:272`
- **설명**: ensureMelodyInstruments()(player.ts:272-295)는 in-flight 로드를 추적하지 않고 `melodyInstMap.has(name)`만 검사한다. play()의 ensureInstruments 경로와 setConfig({melody}) 경로(927-942행)가 짧은 간격으로 겹치면(GlobalPlayer의 엔진 재사용 fast path, GlobalPlayer.ts:416-421에서 setChart+setConfig 직후 play) 같은 악기를 두 번 fetch하고, 나중 결과가 map을 덮어써 먼저 로드된 인스턴스(샘플 뱅크 + dest에 연결된 노드)가 정리 없이 버려진다. ensureMelodyInstrument(241-266행)가 in-flight 체이닝으로 막아둔 레이스가 멀티파트 경로에는 빠져 있다. 또한 melodyInstMap은 disposeCtxGraph/dispose 외엔 evict가 없는데, 멜로디 엔진은 같은 kind 간 재사용으로 세션 내내 살아남으므로 여러 멀티파트 악보를 열수록 GM 악기별 디코드된 샘플(악기당 수 MB)이 계속 누적된다. melodyMapLoading(104행)은 사실상 추적 용도로 쓰이지 못하고 있다.
- **권고**: 악기 이름별 in-flight 프로미스 맵(Map<string, Promise>)을 두어 동시 호출이 같은 로드를 공유하게 하고, setConfig({melody})로 멜로디가 교체될 때 더 이상 쓰이지 않는 timbre를 stopAll 후 map에서 제거(또는 LRU 상한)하는 evict 로직을 추가.

### [기술적 결함] "새 폴더" 버튼이 사실상 무동작 — 폴더 UI 전체가 렌더 불가

- **위치**: `src/pages/MyChordChartsPage.tsx:406`
- **설명**: `const currentFolders = useMemo<FolderNode[]>(() => [], []);`(406)로 폴더 목록이 항상 빈 배열로 고정되어 있다. 그런데 헤더의 "새 폴더" 버튼(826)은 여전히 활성이고, addFolder(528~535)는 store.folders에 항목을 추가하지만 그리드/리스트의 currentFolders.map(941, 1109)이 아무것도 렌더하지 않으므로 사용자가 폴더를 생성해도 화면에 아무 변화가 없다(localStorage에 보이지 않는 데이터만 쌓임). 그 결과 setCurrentFolderId 진입 경로가 없어 breadcrumbs(885), ParentDropZone(911), onFolderDrop/moveTo/isDescendant(594~813) 등 폴더 관련 코드 전체가 도달 불가 상태다.
- **권고**: 폴더 기능이 보류 상태라면 "새 폴더" 버튼과 createFolderOpen 모달을 함께 숨기고, 살릴 거라면 currentFolders를 `store.folders.filter(f => f.parentId === currentFolderId)`로 복원.

### ✅[수정완료 06-11] [의존성] 정체불명 빈 패키지 'claude@0.1.1' 의존성 — 공급망 위험

- **위치**: `package.json:22`
- **설명**: package.json:22 의 `"claude": "^0.1.1"` 은 Anthropic 공식 SDK가 아니다. node_modules/claude/ 내용을 확인한 결과 README.md 와 package.json 뿐이고, main으로 지정된 index.js 파일 자체가 존재하지 않는 빈 네임스쿼팅 패키지다(description/author 없음). src/, scripts/, tools/, rag/ 어디에서도 import 되지 않는다. ^0.1.1 범위는 0.1.x 신규 버전을 자동 수용하므로, 이 이름의 소유자가 악성 0.1.2 를 게시하면 다음 npm install 때 그대로 끌려 들어오는 공급망 공격 표면이 된다.
- **권고**: `npm uninstall claude` 로 즉시 제거. Anthropic SDK가 필요했던 것이라면 공식 패키지 @anthropic-ai/sdk 를 사용할 것.

### [보안] RAG 서버: 토큰 미설정 시 무인증 + Bearer 토큰이 클라이언트 번들에 포함

- **위치**: `rag/server.py:43`
- **설명**: rag/server.py:43-50 — RAG_AUTH_TOKEN 환경변수가 비어 있으면 require_auth 가 그냥 통과해 /chat, /search 가 완전 무인증으로 열린다. 서버는 204라인에서 host=0.0.0.0:8001 로 바인딩되고 CORS는 allow_origins=["*"] (29라인)이다. 또한 토큰이 설정되어 있어도 프론트는 src/api/harmorag.ts:21 에서 `import.meta.env.VITE_RAG_TOKEN` 으로 토큰을 읽어 Authorization 헤더에 넣는데, VITE_ 접두사라 이 토큰 역시 배포 번들에 평문으로 포함된다. 즉 앱 바이너리를 가진 누구나 토큰을 추출해 /chat 으로 Anthropic API 사용량을 소진시킬 수 있어, 주석(서버.py:37-42)이 전제하는 '공개 노출 시 토큰이 보호층' 가정이 성립하지 않는다.
- **권고**: 1) RAG_AUTH_TOKEN 미설정 시 기동 실패(또는 외부 바인딩 거부)하도록 변경해 무인증 공개 상태를 방지. 2) 클라이언트에 정적 토큰을 심는 대신 백엔드 JWT(jazzify.p-e.kr 로그인 토큰)를 RAG 서버에서 검증하는 방식으로 전환. 3) 임시로 유지한다면 토큰을 주기적으로 회전하고 요청 rate-limit 추가.

### ✅[수정완료 06-11] [보안] 로그아웃/계정 전환 시 사용자 범위 로컬 데이터 정리 누락

- **위치**: `src/api/auth.ts:134`
- **설명**: auth.ts:134의 USER_SCOPED_CACHE_KEYS는 'jazzify.chat.listCache', 'jazzify.chat.chartMeta' 두 개만 지우며, logout()(라인 281-285)·login 계정 전환(라인 268)·bootstrapAuth 실패(라인 320, 334)에서 이 둘만 정리된다. 그러나 다음 사용자 데이터가 localStorage/IndexedDB에 남는다: (1) src/pages/MyChordChartsPage.tsx:91 'jazzify.myCharts.mock-v4' — FileNode에 `project?: ChordProject`(백엔드 프로젝트 제목/키/OMR 상태) 포함, (2) src/pages/MySheetProjectsPage.tsx:28 'jazzify.mySheets.uploaded.v1' — 사용자가 업로드한 악보 프로젝트 목록, (3) src/lib/leadSheetChordEdit.ts:48 'jazzify.chartEdit.*' — 곡별 코드 편집본, (4) src/data/lickData.ts:315 'jazzify_user_licks' 및 src/data/soloData.ts:18 'jazzify_user_solos', (5) src/pages/LickInputPage.tsx:47 'lickInput.draft.v1', src/pages/EditorPage.tsx:31 'leadSheetGenerator.draft.v1' 초안, (6) src/lib/omrImageStore.ts의 IndexedDB 'jazzify-omr-images' — 사용자가 업로드한 악보 사진 원본. 같은 기기에서 다른 계정으로 로그인하면 이전 사용자의 차트 제목·업로드 목록·악보 이미지 등이 노출될 수 있다. auth.ts:122-128 주석 스스로 이 위험을 인지하고 있으나 적용 범위가 채팅 캐시 2종에 그쳤다. [보충] authFetch의 토큰 만료 → 로그인 리다이렉트 경로에서도 사용자 범위 캐시 정리가 호출되지 않으며, jazzify_user_licks 키도 정리 목록에 없다.
- **권고**: clearUserScopedCaches()에 위 키들을 추가하거나, 사용자 데이터 키에 publicId 네임스페이스(예: jazzify.<publicId>.myCharts)를 도입하라. IndexedDB omr-images도 로그아웃 시 clear하는 함수를 추가해 호출하라.

### ✅[수정완료 06-11] [보안] 계정 전환 시 이전 사용자의 악보 프로젝트 목록이 그대로 노출됨 (캐시 미초기화)

- **위치**: `src/pages/MySheetProjectsPage.tsx:28`
- **설명**: src/api/auth.ts:134의 USER_SCOPED_CACHE_KEYS는 ['jazzify.chat.listCache', 'jazzify.chat.chartMeta'] 두 개뿐이고, MySheetProjectsPage의 UPLOADED_STORAGE_KEY('jazzify.mySheets.uploaded.v1', 28행)는 포함되지 않는다(grep으로 다른 참조처 없음 확인). 로그아웃 후 다른 계정으로 로그인해도 이전 사용자가 업로드한 악보 프로젝트의 제목·파일명·publicId가 그대로 표시되고, 새 사용자가 해당 카드를 삭제하면 남의 publicId로 DELETE 요청이 나간다(서버 권한 체크로 403/404가 나겠지만 정보 노출 + 혼란). MyChordChartsPage의 mock STORAGE_KEY('jazzify.myCharts.mock-v4', 91행)도 비스코프이나 mock 데이터라 영향이 작다.
- **권고**: auth.ts의 USER_SCOPED_CACHE_KEYS에 'jazzify.mySheets.uploaded.v1'(및 필요 시 'jazzify.myCharts.mock-v4')을 추가하거나, 앞 finding대로 서버 목록 기반으로 전환해 localStorage 의존 자체를 제거.

---

## 4. 🟢 Low — 여유 시 조치 (34건)

### ✅[수정완료 06-11] [버그] harmorag 스트림 — RAG 디버그 마커가 안 오면 전체 응답이 종료 시점까지 버퍼링(스트리밍 무력화)

- **위치**: `src/api/harmorag.ts:181`
- **설명**: streamWithRAG의 디버그 블록 파싱 루프(harmorag.ts:166-185)는 RAG_OPEN 마커가 아직 없으면 무조건 `continue`로 버퍼링만 계속한다. 서버가 디버그 블록 없이 본문부터 보내는 경우(서버 설정 변경, 프록시 등) onChunk가 스트리밍 내내 한 번도 호출되지 않고 종료 후 잔여 버퍼 flush에서 통째로 표시된다 — 사용자는 그동안 '생각하는 중' 애니메이션만 본다. 동일 로직이던 api/chat.ts streamChat은 `openIdx === -1 → debugParsed = true`(chat.ts:319-321)로 이미 수정됐는데 harmorag 쪽만 미수정 상태로 남아 있다.
- **권고**: chat.ts:311-327과 동일하게 `openIdx === -1`이면 debugParsed=true로 전환해 즉시 flush하고, 열림 마커만 있고 닫힘이 없을 때만 대기하도록 수정할 것.

### ✅[수정완료 06-11] [버그] z-index 1200 충돌 — 모바일 채팅 오버레이가 열린 상태에서 Cmd+K 검색 모달이 아래에 깔림

- **위치**: `src/components/chat/ChatSearchModal.tsx:163`
- **설명**: ChatSearchModal Backdrop(ChatSearchModal.tsx:163)과 MobileChatFab의 풀스크린 Overlay(MobileChatFab.tsx:44)가 둘 다 z-index:1200이다. compact 웹 레이아웃에서 채팅 오버레이가 열려 있을 때 Cmd/Ctrl+K 전역 단축키(IconSidebar.tsx:799-808, document keydown이라 오버레이가 떠 있어도 동작)로 검색 모달을 열면, DOM 순서상(IconSidebar가 먼저, 페이지 본문의 MobileChatFab이 나중) 동일 z-index의 나중 요소인 오버레이가 위에 그려져 검색 모달이 보이지 않는다. 모달은 보이지 않는 채로 document keydown(Escape)을 점유한다.
- **권고**: 모달류 z-index를 상수로 일원화하고 ChatSearchModal을 오버레이(1200)보다 높게(예: 1300) 설정하거나, 채팅 오버레이가 열려 있는 동안 Cmd+K를 무시할 것.

### ✅[수정완료 06-14] [버그] NoteSheet: 의존성 배열 누락 — togglePlay의 extraParts, 렌더 effect의 forceAutoStem

- **위치**: `src/components/notesheet/NoteSheet.tsx:1207`
- **설명**: (1) togglePlay useCallback(1112-1207)은 본문에서 `extraParts`를 세 곳(1125 preload, 1192 anacrusis play, 1205 일반 play)에서 사용하지만 deps는 `[data, tempo, countIn, player, playing]`으로 extraParts가 빠져 있다. 멀티파트 악보에서 data 변경 없이 extraParts만 바뀌는 경우(파트 사운드 토글 등) 이전 파트 구성으로 재생되는 stale closure가 생긴다. 같은 데이터를 쓰는 preload effect(1107-1110)는 extraParts를 deps에 포함하고 있어 비대칭이다. (2) 메인 렌더 effect(1512-2289)는 `forceAutoStem`을 1723-1725(stem 방향)와 1921-1922(beam autoStem)에서 사용하지만 deps가 `[data, width]`뿐이라, forceAutoStem prop이 런타임에 바뀌어도 악보가 다시 그려지지 않는다(현재 페이지들은 정적으로 전달하지만 토글 UI가 생기면 즉시 stale 악보 버그가 된다).
- **권고**: togglePlay deps에 extraParts를, 렌더 effect deps에 forceAutoStem을 추가하라. eslint-plugin-react-hooks의 exhaustive-deps 규칙을 활성화하면 이런 누락을 빌드 시점에 잡을 수 있다.

### ✅[수정완료 06-14] [버그] NoteSheet: 자동 스크롤이 CSS scale 좌표와 실제 픽셀 좌표를 혼용 — 좁은 화면에서 오버스크롤

- **위치**: `src/components/notesheet/NoteSheet.tsx:1490`
- **설명**: 960px 이하 폭에서는 악보가 가상(unscaled) 크기로 렌더된 뒤 CSS `scale(layout.scale)`(1540-1547, scale 최소 0.42)로 축소된다. measureRectsRef의 r.y는 가상 좌표(1612 `rects[m] = { x, y, w }`)인데, 자동 스크롤 effect(1481-1493)는 `targetY = r.y + headerH`를 wrap.scrollTop/clientHeight(실제 CSS px)와 직접 비교·스크롤한다. scale<1이면 실제 화면상 y는 `r.y * scale`이므로 targetY가 최대 1/scale(≈2.4배)만큼 과대평가되어, 모바일 폭에서 재생 중 자동 스크롤이 현재 마디를 지나쳐 내려간다. 같은 effect 안에서 lineHRef.current는 스케일된 값(1526)이라 좌표계가 한 식 안에서 섞여 있다.
- **권고**: 비교·스크롤 전에 r.y에 layout.scale을 곱해 실제 픽셀 좌표로 통일하라(예: `const targetY = r.y * (lineHRef.current / unscaledLineHRef.current) + headerH`). lineH도 동일 좌표계(스케일된 값)로 일관되게 사용하면 된다.

### ✅[수정완료 06-11] [버그] useCountInIntro — 취소 플래그 조기 캡처 및 run() 재진입 시 promise 영구 pending

- **위치**: `src/hooks/useCountInIntro.tsx:155`
- **설명**: (1) run()은 `const cancelled = cancelRef.current;`(155행)를 prepare await(160행) **이전**에 캡처한다. 콜드 스타트로 prepare가 카운트인보다 오래 걸리는 동안 사용자가 cancel()(정지 버튼)을 눌러도 ok:true가 반환되어 호출부가 play()를 진행 — 정지를 눌렀는데 재생이 시작된다(player.ts의 starting-레이스와 결합 시 더 잘 드러남). (2) run()이 동시 재진입되면(빠른 더블클릭 — 호출부 가드는 React state라 리렌더 전엔 뚫림) 두 번째 run의 clearAll()(72-77행)이 첫 번째 run의 resolve용 타이머(146-151행)를 clearTimeout하고 resolveWaitRef를 덮어써, 첫 번째 run의 promise가 영원히 settle되지 않아 해당 호출부의 async 흐름이 영구 중단된다.
- **권고**: (1) prepare await 이후에 cancelRef.current를 다시 읽어 ok에 반영. (2) run 진입 시 기존 resolveWaitRef가 있으면 먼저 resolve해 주거나, run 세대 ID로 이전 호출을 명시적으로 cancelled-resolve 처리.

### ✅[수정완료 06-11] [버그] formatChordDisplay의 h/o 문자 치환 부작용 — 유효 alias "7th"가 "7tø"로 깨짐

- **위치**: `src/lib/jazz-harmony/jazz-notation.ts:154`
- **설명**: formatChordDisplay(145-172행)는 문자열 치환 기반이라 `.replace(/h(?!\d)/g, 'ø')`(154행)가 단어 중간의 'h'에도 적용된다. 코드 DB에 도미넌트 7의 alias로 ':7th:'가 등록되어 있어(chord-type-database.ts:41행) "C7th"는 파서 기준 유효 입력이지만, formatChordDisplay("C7th")는 "C7tø"를 반환한다(tsx 재현으로 확인: '7t' 뒤의 'h'가 숫자가 아닌 문자 앞이라 ø로 치환됨). 이 함수는 주석(131-133행)대로 NoteSheet/LickCard/Lick12KeyPage 등 SVG/텍스트 렌더러에서 raw 사용자 텍스트에 직접 적용되므로, 사용자가 '7th' 표기로 입력한 코드가 악보 위에 깨진 글리프로 표시된다. 파서 기반 normalizeChord 경로는 정상('C7' 반환).
- **권고**: h→ø 치환을 half-diminished 문맥으로 한정한다. 예: `(?<=[A-G][b#♭♯]?)h(?!\d)` 처럼 루트 음표 바로 뒤의 h만 매칭하거나, 치환 전에 '7th' 같은 알려진 alias를 먼저 정규화한다. o→° 치환(160행)도 같은 lookbehind 제한을 적용하면 안전하다.

### ✅[수정완료 06-11] [버그] AnacrusisPlayer가 BackingPlayer의 재생성된(닫힌) AudioContext를 계속 참조

- **위치**: `src/lib/player/GlobalPlayer.ts:688`
- **설명**: getAnacrusisPlayer()(GlobalPlayer.ts:688-739)는 `anacrusisCtxOwner !== active`일 때만 재구축한다. 그러나 BackingPlayer는 resume 실패(poisoned ctx) 시 같은 인스턴스 안에서 ctx를 close하고 새로 만들 수 있어(player.ts:196-204의 ensureCtx catch 경로, getCtx의 closed 재생성 184-188행), owner는 동일한 채 AnacrusisPlayer만 닫힌 ctx를 쥐게 된다. 이후 scheduleStandaloneNote는 닫힌 ctx에서 노드 생성이 실패해 픽업 노트가 조용히(또는 error emit으로) 사라진다. 또한 fallback ctx로 생성된 뒤 active가 생기면 '싱글톤 수명 동안 fallback ctx 유지'(707-712행 주석) 정책 때문에 p.ctxNow()(active의 클럭)와 AnacrusisPlayer 클럭이 서로 달라 픽업 타이밍이 미정의가 된다.
- **권고**: owner 비교 대신 `notePlayerAnacrusis가 쥔 ctx !== active.getCtx()`(인스턴스 비교)로 stale 판정하거나, AnacrusisPlayer에 ctx 교체 API를 두고 scheduleAnacrusis 시점에 active.getCtx()와 일치하는지 확인 후 재구축.

### ✅[수정완료 06-11] [버그] 곡 전환 commit에서 이전 곡의 break/loop 상태가 새 곡 localStorage 키에 기록됨

- **위치**: `src/pages/ChordPage.tsx:1280`
- **설명**: load/save effect 쌍이 같은 songId 의존성을 공유해 곡 전환 직후 한 commit 동안 '새 songId + 이전 곡 상태' 조합으로 save effect가 실행된다. 해당 위치: ① ChordPage.tsx:1273-1275(load) / 1280-1283(save) — `saveBreakPoints(songId, breakPoints)`가 새 songId에 이전 곡 breakPoints를 기록, ② ChordPage.tsx:1300-1310(load) / 1315-1321(save) — 이전 loopRegion을 새 곡 키 `jazzify.loop.<songId>`에 기록하거나(이전 값이 null이면) 새 곡의 저장된 루프를 removeItem으로 삭제, ③ NotePage.tsx:736(load) / 737-740(save) — 동일 패턴. load effect가 save보다 먼저 선언되어 저장소를 먼저 읽어두므로 다음 리렌더에서 올바른 값이 다시 써져 보통은 자가 복구되지만, 그 사이에 unmount/탭 종료가 끼면 이전 곡 데이터가 새 곡 키에 영구 잔류한다. 또한 같은 commit에서 `globalPlayer.setConfig({ breakBeats/loopRegion })`로 이전 곡의 브레이크/루프가 일시 적용된다.
- **권고**: 마지막으로 로드한 songId를 ref로 기억해 save effect에서 `if (loadedSongIdRef.current !== songId) return;`으로 곡 전환 직후의 저장을 건너뛰거나, 저장을 effect가 아닌 토글/편집 핸들러 내부로 옮겨 사용자 조작 시에만 persist하도록 변경.

### ✅[수정완료 06-11] [버그] tie 입력 시 마지막 마디가 빈 경우 가드 누락 (index -1 대입)

- **위치**: `src/pages/EditorPage.tsx:1998`
- **설명**: handleNotePress의 tieNext 분기(1998-2008)에서 curNotes가 비어 있으면 마지막 measure의 마지막 음표에 tie를 찍는데, `lastNotes[lastNotes.length - 1] = { ...lastNotes[lastNotes.length - 1], tie: true }`는 마지막 마디의 notes가 빈 배열일 때(insertMeasureBefore/After가 만드는 빈 마디(1886, 1899)나 모든 음표를 삭제한 마디) `lastNotes[-1]`에 `{tie:true}` 객체를 대입한다. 크래시는 없지만 배열에 '-1' 키가 오염되고 tie는 조용히 유실된다. 동일 패턴인 handleOttavaToggle(1804-1815)은 `if (lastNotes.length > 0)` 가드를 두고 있어 불일치.
- **권고**: handleOttavaToggle처럼 `if (lastNotes.length > 0)` 가드를 추가하고, 빈 마디면 tie 마킹을 건너뛴다.

### ✅[수정완료 06-11] [버그] 재생 중 AbortSignal 리스너 무한 누적 (메모리 누수)

- **위치**: `src/pages/EditorPage.tsx:2520`
- **설명**: handlePlay의 대기 헬퍼들은 매 호출마다 `abort.signal.addEventListener('abort', ..., { once: true })`를 등록한다(2317-2321, 2430-2433, 2520-2523, 2531-2534). `{ once: true }`는 abort가 실제 발생할 때만 리스너를 제거하므로, 타이머가 정상 resolve된 경우 리스너(및 clearTimeout 클로저)는 AbortController가 살아있는 동안 signal에 계속 남는다. 외부 루프가 무한 반복 재생이므로 음표 하나당 1개 이상의 리스너가 누적되어 장시간 재생 시 수천 개의 클로저가 유지된다(정지 시점에 abort가 발생해야 일괄 해제).
- **권고**: Promise resolve 경로에서 `abort.signal.removeEventListener('abort', onAbort)`를 호출하는 공용 `wait(ms, signal)` 헬퍼로 통합하거나, 리스너 등록 시 핸들러 참조를 보관해 finally에서 제거.

### ✅[수정완료 06-12] [버그] OMR 완료 직후 /analyze 중복 POST 레이스 (폴러 vs SheetPreview 자가복구)

- **위치**: `src/pages/MyChordChartsPage.tsx:312`
- **설명**: 페이지 레벨 OMR 폴러는 status가 COMPLETED로 바뀌면 analyzeChordProject를 호출한다(312~321, analyzedOmrIdsRef로 폴러 경로만 de-dup). 동시에 omrStatus 갱신으로 project 객체 참조가 바뀌면 SheetPreview의 effect(2261~2332)가 재실행되어 GET /analysis → CHORD_PROJECT_005 → POST /analyze(2298~2316)를 독자적으로 호출한다. 두 경로가 같은 시점에 동일 프로젝트에 /analyze를 동시 POST할 수 있다. 둘 다 best-effort라 치명적이진 않지만 서버 분석 비용 중복과 잠재적 경합이 발생한다.
- **권고**: analyzedOmrIdsRef(또는 in-flight Promise 맵)를 SheetPreview 경로와 공유하거나, SheetPreview는 자가복구 전 짧은 지연 후 GET /analysis를 1회 재시도해 폴러의 analyze 결과를 우선 활용하도록 변경.

### ✅[수정완료 06-11] [버그] 업로드 진행 중 정렬 변경 시 낙관적 placeholder 카드가 사라짐

- **위치**: `src/pages/MyChordChartsPage.tsx:474`
- **설명**: uploadOmrFile은 임시 placeholder를 setProjects로 prepend(474)하지만, 업로드 진행 중 사용자가 정렬을 바꾸면 projectSort 변경 → reloadProjects(261~272)가 `setProjects(page.content)`로 목록을 통째로 교체해 placeholder가 사라진다(서버에는 아직 해당 프로젝트가 없으므로 목록에도 없음). 업로드가 끝나면 created가 다시 prepend되어 복구되지만, 그동안 "업로드 중" 카드가 소실돼 사용자가 업로드가 취소된 것으로 오해할 수 있고, POST 실패 시 placeholder 제거 filter(488)는 이미 no-op이다.
- **권고**: reloadProjects에서 `setProjects(prev => [...prev.filter(p => p.publicId.startsWith(UPLOADING_ID_PREFIX)), ...page.content])`처럼 업로드 중 placeholder를 보존하며 병합.

### ✅[수정완료 06-14] [버그] 스토리지 파일 업로드 성공 후 프로젝트 생성 실패 시 고아 파일 (롤백 없음)

- **위치**: `src/pages/MySheetProjectsPage.tsx:181`
- **설명**: handleCreate(176~200)에서 uploadStorageFile(181)이 성공한 뒤 createSheetProject(182)가 실패하면 업로드된 storage file(stored.publicId)을 삭제하거나 재사용하지 않는다. 사용자가 재시도하면 같은 파일이 또 업로드되어 서버에 고아 파일이 누적된다.
- **권고**: catch에서 업로드된 storage file 삭제 API(존재 시)를 best-effort 호출하거나, stored.publicId를 상태에 보관해 재시도 시 재업로드 없이 createSheetProject만 다시 호출.

### ✅[수정완료 06-11] [버그] OMR 백그라운드 폴링(재귀 setTimeout)을 중단할 방법이 없음

- **위치**: `src/pages/SolosPage.tsx:664`
- **설명**: pollSoloOmr(664~702)은 의도적 fire-and-forget(주석 명시)으로 unmount 후에도 토스트를 띄우기 위한 설계지만, `window.setTimeout(() => void tick(), INTERVAL_MS)` (699)의 타이머 id를 어디에도 저장하지 않아 어떤 상황에서도 중단이 불가능하다. 로그아웃하거나 해당 솔로를 삭제해도 최대 5분(MAX_MS) 동안 5초 간격으로 getSoloOmrStatus 요청이 계속되고, 인증 만료 시에도 catch(688~690)가 에러를 삼키고 계속 폴링한다. 동일 파일을 연속 업로드하면 업로드 건마다 독립 폴러가 누적된다.
- **권고**: 모듈 레벨 Map<publicId, timeoutId>로 폴러를 추적해 동일 id 중복 폴링을 방지하고, 로그아웃(onAuthReset) 시 전부 clearTimeout. 또는 401/403 응답이면 즉시 폴링을 종료하도록 catch에서 에러 종류를 구분.

### 🔶[부분완료 06-11: tslib·html2canvas·svg2pdf.js 제거 / @capacitor/app은 iOS 플러그인 재검증 세트로 보류] [데드코드] 사용되지 않는 의존성 4건 (tslib, html2canvas, svg2pdf.js, @capacitor/app)

- **위치**: `package.json:24`
- **설명**: src/ 전체 grep(정적 import + 동적 import() 모두) 결과 import 0건인 dependencies: 1) html2canvas (package.json:24) — jspdf의 .html() 메서드용 선택 의존성인데 src/lib/note/scoreToPdf.ts 에서 .html() 을 쓰지 않음. 2) svg2pdf.js (package.json:35) — scoreToPdf.ts:4-5 주석에서 명시적으로 채택하지 않기로 한 라이브러리. 3) tslib (package.json:36) — tsconfig*.json 에 importHelpers 옵션이 없어 불필요. 4) @capacitor/app (package.json:17) — src/ 어디에서도 import 없음(반면 @capacitor/keyboard 는 사용 중). 위의 'claude' 패키지는 별도 finding으로 분리.
- **권고**: `npm uninstall html2canvas svg2pdf.js tslib @capacitor/app` 후 빌드(`npm run build`)와 iOS sync(`cap sync ios`)로 회귀 확인. @capacitor/app 은 추후 앱 상태/백버튼 이벤트가 필요해지면 그때 다시 추가하면 됨.

### ✅[수정완료 06-11] [데드코드] HomePage ChatHistoryModal이 죽은 통합 — 사이드바 '채팅' 버튼이 항상 빈 모달을 띄움

- **위치**: `src/pages/HomePage.tsx:706`
- **설명**: HomePage는 `chatConversations: ChatConversation[] = []`(HomePage.tsx:706)를 상수 빈 배열로 두고 ChatHistoryModal에 넘기며, onSelect는 `() => { /* TODO: load conversation into RightChatPanel */ }` no-op이다(898-904). 백엔드 채팅 영속화(/v1/chat)와 RecentChatsList가 이미 동작 중인데도, 사이드바 '채팅' 버튼(IconSidebar onOpenChatHistory → openChatHistory, HomePage.tsx:754, 708-711)을 누르면 로그인 사용자에게 항상 '아직 저장된 대화가 없습니다'만 보이는 빈 모달이 뜬다. ChatHistoryModal.tsx 전체(355줄)가 사실상 기능 없는 코드로 유지되고 있다.
- **권고**: ChatHistoryModal을 listChats() 데이터와 setActiveChat으로 연결하거나, RecentChatsList/ChatSearchModal이 동일 역할을 이미 하므로 모달과 '채팅' 버튼 경로를 제거·통합할 것.

### ✅[수정완료 06-11] [기술적 결함] localStorage 채팅 캐시 — JSON.parse 예외는 가드되나 형태(배열/객체) 검증 없음, 비배열 캐시 시 사이드바 크래시

- **위치**: `src/api/chat.ts:196`
- **설명**: getCachedChatList(chat.ts:196-201)는 try/catch로 파싱 예외는 막지만 결과를 `as ChatSummary[]`로 무검증 캐스트한다. 키 충돌·스키마 변경·수동 변조 등으로 비배열 값이 저장되면 RecentChatsList의 초기 state(RecentChatsList.tsx:414)로 들어가 mergedItems의 `items.map(...)`(656)에서 'items.map is not a function'으로 사이드바가 크래시한다. lib/chatChartMeta.ts readAll(34-41)도 동일하게 Record가 아닌 값(배열/문자열)이 들어오면 Object.entries가 비정상 동작한다. 참고: QuotaExceededError는 setCachedChatList(chat.ts:204)와 writeAll(chatChartMeta.ts:43-48) 모두 catch로 처리되어 있어 문제 없음을 확인했다.
- **권고**: 파싱 후 `Array.isArray(parsed)` (chat.ts) / `parsed && typeof parsed === 'object' && !Array.isArray(parsed)` (chatChartMeta.ts) 검증을 추가하고 불일치 시 null/{} 반환 + 해당 키 삭제로 자가 복구하게 할 것.

### ✅[수정완료 06-12] [기술적 결함] 백엔드/외부 API 에러 응답 원문을 UI에 그대로 노출

- **위치**: `src/api/chordProjects.ts:79`
- **설명**: 여러 클라이언트가 에러 응답 본문을 가공 없이 Error 메시지로 던지고, 이는 그대로 UI에 렌더링된다: (1) chordProjects.ts:79, sheetProjects.ts:91, storageFiles.ts:28 — `JSON.stringify(await res.json())`로 백엔드 에러 envelope 전체(code/message/detail)를 메시지에 포함. (2) licks.ts:148/193/221/262, solos.ts:179, chat.ts:183 — `j.detail || j.message`를 노출(detail은 백엔드 내부 예외 문자열일 수 있음). (3) claude.ts:222-226 — Anthropic 에러 응답 원문을 console.error와 채팅 말풍선(`[API Error ${res.status}] ${err}`)에 그대로 출력. 내부 구현 정보(스택, 내부 코드, 쿼리 흔적 등)가 사용자에게 노출될 수 있다.
- **권고**: 에러 code 기반으로 매핑된 한국어 사용자 메시지를 보여주고(licks.ts:146의 LICK_002 처리처럼), 원문 detail은 개발 모드에서만 console.debug로 남겨라. claude.ts는 상태 코드만 노출하고 본문은 로그로 제한하라.

### ✅[수정완료 06-11] [기술적 결함] bare fetch 전수 조사 결과 — fetchAllLicks만 refresh 미적용 (만료 토큰 시 불필요한 폴백)

- **위치**: `src/api/licks.ts:303`
- **설명**: src/api 내 bare fetch( ) 전수 분류: (1) auth.ts:175/209/215/233/248/275 — refresh·login·signup·logout 등 인증 플로우 자체로 정당. (2) claude.ts:211 — 외부 Anthropic 호출(별도 critical finding). (3) harmorag.ts:80/134 — 외부 RAG 서버 호출(별도 high finding). (4) analysis.ts:15/21 — 주석 속 예시일 뿐 실제 호출 아님. (5) licks.ts:303 — 유일하게 백엔드 인증 엔드포인트(/v1/licks)를 authFetch 없이 호출하는 곳. 라인 300-301에서 getAccessToken()으로 수동 Bearer를 붙이지만 401 시 refresh를 시도하지 않고 throw한다(라인 307). 주석(라인 295-299)에 따르면 authFetch의 /login 리다이렉트를 피하려는 의도적 설계지만, 그 결과 access token이 만료된 직후(refresh 쿠키는 유효한데) 백그라운드 풀 로드가 실패해 번들 백업 스냅샷으로 폴백 → 로그인 상태인데도 오래된 릭 데이터가 보일 수 있다.
- **권고**: 리다이렉트 없이 1회 refresh만 시도하는 경량 헬퍼(예: authFetch에 redirectOnFail:false 옵션)를 만들어 fetchAllLicks에 적용하라.

### ✅[수정완료 06-11] [기술적 결함] LickCard: 마운트 시 무조건 전역 player.stop() 호출 — 카드 추가 마운트가 진행 중 재생을 중단

- **위치**: `src/components/notesheet/LickCard.tsx:765`
- **설명**: 765-771의 effect(`player.stop(); setPlaying(false); ... renderedRef.current = false;`)는 deps가 `[lick.id, player, clearNoteHighlight, drawMeasureHL]`이지만 useEffect 특성상 모든 카드의 최초 마운트에서도 실행된다. player는 전역 싱글톤이므로, 릭 목록 페이지에서 한 카드를 재생 중일 때 새 LickCard가 마운트되는 순간(페이지네이션/필터 변경/목록 갱신 등) 재생이 즉시 끊긴다. 이 effect의 의도는 '같은 카드의 lick이 교체되었을 때 정지'인데, 마운트와 교체를 구분하지 않아 부작용 범위가 전역으로 넓어졌다.
- **권고**: 최초 마운트를 건너뛰도록 이전 lick.id를 ref로 기억해 실제로 바뀐 경우에만 stop을 호출하거나, 자신이 재생 중(playing===true)일 때만 정지하도록 조건을 좁혀라.

### ✅[수정완료 06-11] [기술적 결함] loadSeedLicks 캐시 변수 미사용 — 매 호출마다 user_licks.json 재요청

- **위치**: `src/data/lickData.ts:319`
- **설명**: lickData.ts 317행의 모듈 캐시 `let seedLicks: LickEntry[] | null = null`은 loadSeedLicks(319-328행)에서 쓰기만 하고(322, 325행) 읽는 곳이 없다. 같은 파일의 cachedFrontendLicks(197행), cachedBackupLicks(234행), cachedLicks(247행)는 모두 `if (cached) return cached` 가드가 있는데 loadSeedLicks에만 가드가 없어, loadUserLicks()가 호출될 때마다 `/data/licks/user_licks.json`을 매번 다시 fetch한다 — 캐시 변수가 사실상 데드 스토어다. 부수적으로 loadFrontendLicks(198행)·loadBackupLicks(235행)·loadSeedLicks(321행) 모두 `res.ok`를 확인하지 않아, SPA 정적 호스팅에서 파일 누락 시 index.html(200)이 반환되면 res.json()이 'Unexpected token <' SyntaxError로 실패해 원인 파악이 어려운 에러 메시지가 된다(호출부 LicksPage.tsx:380-392 등은 .catch로 크래시는 방지함).
- **권고**: loadSeedLicks 첫 줄에 `if (seedLicks) return seedLicks;` 가드를 추가하거나, 캐시가 불필요하면 seedLicks 변수를 제거해 의도를 명확히 한다. 세 로더에 `if (!res.ok) throw new Error(...)` 검사를 추가해 누락 파일 시 진단 가능한 에러를 던지게 한다.

### ✅[수정완료 06-11] [기술적 결함] saveUserLick/deleteUserLick의 localStorage.setItem 무보호 — QuotaExceeded 시 저장 플로우 크래시

- **위치**: `src/data/lickData.ts:381`
- **설명**: lickData.ts의 `saveUserLick`(381행)과 `deleteUserLick`(386행)은 `localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))`을 try-catch 없이 호출한다. 같은 코드베이스의 다른 모든 localStorage 쓰기(chatChartMeta.ts:43-48, lickVideos.ts:56-60, useAnalysisFilters.ts:29-33, soloData.ts:102, auth.ts:57-60)는 try-catch로 보호되어 있어 이 두 함수만 예외다. LickEntry는 measures 전체를 포함한 sheetData를 통째로 저장하므로 누적 시 용량이 커져 QuotaExceededError 가능성이 실재한다. 실제 영향: EditorPage.tsx:2706에서는 백엔드 createLick/updateLick이 이미 성공한 뒤 saveUserLick이 throw하면 외부 catch(2711-2714행)가 'Save failed' 에러를 표시하고 /licks로 이동하지 않아, 저장이 성공했는데 실패로 보이는 오동작이 된다. LickRecommendMessage.tsx:645, LickInputPage.tsx:2042에서도 동일하게 예외가 UI 핸들러로 전파된다. 부수적으로 `jazzify_user_licks`에는 스키마 버전 필드가 없고, loadLocalLicks(330-338행)는 JSON.parse만 try-catch할 뿐 파싱 결과가 LickEntry[] 형태인지(배열 여부조차) 검증하지 않는다 — soloData.ts:69의 `Array.isArray(parsed)` 가드와 대비된다.
- **권고**: 두 함수의 setItem을 try-catch로 감싸고 실패 시 console.warn 처리(lickVideos.ts:56-60 패턴과 동일하게)한다. EditorPage 쪽은 백엔드 저장 성공 후의 로컬 미러 실패가 전체 저장 실패로 표시되지 않도록 saveUserLick 호출을 개별 보호한다. loadLocalLicks에는 `Array.isArray` 가드를 추가하고, 장기적으로는 스키마 버전 키(예: jazzify_user_licks_v2)를 도입한다.

### ✅[수정완료 06-11] [기술적 결함] sheet tempo 0 값이 ?? 연산자를 통과해 60/0 나눗셈으로 이어질 수 있음

- **위치**: `src/lib/player/GlobalPlayer.ts:381`
- **설명**: ensureBackingPlayerForSheet의 `const tempo = config.bpm ?? input.data.tempo ?? chart.bpm;`(GlobalPlayer.ts:381)은 nullish 병합이라 data.tempo가 0이면 그대로 통과한다. 같은 데이터를 다루는 noteSheetToChart는 truthy 검사(`sheet.tempo ? { bpm: sheet.tempo } : {}`, noteSheetToChart.ts:84)로 0을 걸러내 두 경로가 불일치한다. tempo=0이 seed.bpm으로 들어가면 engine.renderChart의 `secPerBeat = 60 / opts.bpm`(engine.ts:272)이 Infinity가 되고 build()의 secPerBar도 Infinity가 되어 무음·바 하이라이트 고착으로 조용히 실패한다(0/NaN 가드는 tick·beatOfTime엔 있으나 renderChart 입구엔 없음). UI 입력은 20-400으로 클램프되지만(NoteSheet.tsx:2567) 서버/OMR 산 데이터의 tempo:0은 막지 못한다.
- **권고**: tempo 결정부에서 `Number.isFinite(t) && t > 0` 검증 후 폴백(chart.bpm)하도록 가드하고, renderChart 진입부에도 bpm 유효성 가드를 한 줄 추가.

### ✅[수정완료 06-11] [기술적 결함] 직접입력 차트 저장의 부분 실패 시 재시도하면 프로젝트 중복 생성

- **위치**: `src/pages/ChordPage.tsx:1655`
- **설명**: handleConfirmDirectInputSave(1646-1675)는 createChordProject → addChordProjectChords → analyzeChordProject를 순차 호출하는데, 1단계 성공 후 2·3단계가 실패하면 에러만 표시하고 생성된 프로젝트의 publicId를 기억하지 않는다. 사용자가 모달에서 '저장'을 다시 누르면 createChordProject가 또 호출되어 코드 없는 빈 프로젝트가 백엔드에 중복 누적된다.
- **권고**: 생성된 publicId를 state/ref에 보관해 재시도 시 create를 건너뛰고 addChords/analyze부터 재개하거나, 실패 시 생성된 프로젝트를 삭제(보상 트랜잭션)하는 처리를 추가.

### ✅[수정완료 06-14: 진짜 10초 주기(06-11) + 내용기준 isEmpty·빈 상태 removeItem(06-14)] [기술적 결함] autosave가 '10초마다'가 아닌 '10초 무입력 후'로 동작 + Clear 후 draft 재생성

- **위치**: `src/pages/EditorPage.tsx:1718`
- **설명**: autosave effect(1718-1737)는 deps에 measures, curNotes, curChord1/2, composer, genre, sheetTitle, sheetKey, bpm을 모두 넣고 setInterval을 생성하므로, 입력이 있을 때마다 interval이 해제·재생성되어 타이머가 0부터 다시 시작한다. 즉 10초간 아무 입력이 없어야만 저장되며, 연속 입력 중 크래시하면 마지막 10초 휴지기 이후의 모든 입력이 유실된다(주석의 '10초마다 저장' 의도와 불일치). 또한 handleClear(2079-2085)는 measures/curNotes/코드만 비우고 composer·genre·sheetTitle은 남기므로, 제목 등을 입력한 상태에서 Clear하면 isEmpty 검사(1721-1726)를 통과하지 못해 10초 뒤 삭제했던 DRAFT_KEY가 메타데이터만 담긴 채 재생성된다. 반대로 내용을 모두 비운 경우에는 early return만 하고 기존 draft를 삭제하지 않아 오래된 draft가 다음 마운트에서 부활한다.
- **권고**: 최신 상태를 ref에 미러링하고 interval은 마운트 시 1회만 생성해 ref를 읽어 저장하도록 변경(진짜 10초 주기). handleClear에서 메타데이터 state도 함께 초기화하거나 isEmpty 판정을 measures/curNotes 기준으로 단순화하고, 비어 있으면 localStorage.removeItem(DRAFT_KEY)을 수행.

### ✅[수정완료 06-11] [기술적 결함] player.on('done') 구독 해제 누락 — 싱글톤 이벤트 버스에 리스너 누적

- **위치**: `src/pages/LickInputPage.tsx:1883`
- **설명**: GlobalPlayer의 이벤트 버스는 앱 수명 동안 살아있는 싱글톤인데, LickInputPage.tsx:1883은 재생할 때마다 `player.on('done', () => setPlaying(false))`를 호출하고 반환된 unsubscribe를 버린다 — 재생 횟수만큼 done 리스너가 영구 누적된다(언마운트된 컴포넌트의 setState 클로저 포함). LickCard.tsx:749-760은 unsub 배열을 만들지만 해제가 natural 'done' 콜백 안에서만 실행되어, 수동 정지나 릭 변경 시(player.stop()은 onDone을 발화하지 않음, player.ts:852-871) bar/note/done 리스너 3개가 그대로 남아 다음 자연 종료까지(또는 영구히) 누적된다. 대조적으로 LickCreator.tsx:663-666과 GlobalPlayerContext는 useEffect cleanup으로 올바르게 해제한다.
- **권고**: 구독은 useEffect에서 1회 등록하고 cleanup에서 해제하는 패턴으로 통일(LickCreator 방식). 재생마다 등록해야 한다면 stop/언마운트 경로에서도 반드시 unsub을 호출.

### ✅[수정완료 06-14] [기술적 결함] 악보 카드 클릭이 무동작 (열기 호버 화살표는 표시됨) — 코드 차트 페이지와 비대칭

- **위치**: `src/pages/MySheetProjectsPage.tsx:352`
- **설명**: 그리드/리스트의 모든 카드 onClick이 `() => selectMode && toggleSelect(...)`(352, 409, 474, 483)라서 선택 모드가 아니면 클릭해도 아무 일도 일어나지 않는다. 그런데 비선택 모드에서 HoverOverlay 화살표(367~370, 423~426)가 "클릭하면 열림"을 시각적으로 약속한다. MyChordChartsPage는 동일 카드 클릭 시 navigate('/mychord?...')(1014, 1156)로 이동한다 — 두 페이지 카드 동작 동기화 규칙에 어긋나는 비대칭.
- **권고**: 악보 뷰어 라우트가 준비될 때까지 비선택 모드에서 HoverOverlay를 렌더하지 않거나(cursor: default 포함), 뷰어가 있다면 navigate를 연결.

### ✅[수정완료 06-14] [기술적 결함] NotePage RepeatControl이 UI만 있고 재생에 반영되지 않음

- **위치**: `src/pages/NotePage.tsx:726`
- **설명**: `const [repeatCount, setRepeatCount] = useState(3); // UI-only — player plays once through.`(726) 주석대로 repeatCount는 어떤 재생 경로에도 전달되지 않지만, 트랜스포트 바에는 RepeatControl(1053)이 정상 컨트롤처럼 렌더링되어 사용자가 값을 바꿔도 아무 효과가 없다. ChordPage는 동일 컨트롤을 `globalPlayer.setConfig({ repeatCount })`(ChordPage.tsx:1358)로 실제 반영하고 있어 두 페이지 간 동작이 불일치한다.
- **권고**: NoteSheet 재생 경로에 repeatCount를 전달해 실제 반복을 구현하거나, 구현 전까지 RepeatControl을 NotePage에서 숨기거나 disabled 처리해 동작하지 않는 UI를 노출하지 않는다.

### ✅[수정완료 06-11] [기술적 결함] autosave 인터벌이 편집할 때마다 리셋되어 연속 입력 중에는 저장이 안 됨

- **위치**: `src/pages/SoloGeneratorPage.tsx:1625`
- **설명**: autosave effect(1625~1644)의 deps가 [measures, curNotes, curChord1, ..., bpm] 전부라서 노트 하나 입력할 때마다 clearInterval + setInterval로 타이머가 0부터 다시 시작한다. 즉 "10초마다 저장"이 아니라 "마지막 편집 후 10초 동안 손을 떼야 첫 저장"이 된다. 10초 이내 간격으로 계속 입력하는 동안 크래시/탭 종료가 발생하면 드래프트가 한 번도 저장되지 않은 상태일 수 있어 자동복구 목적이 약화된다.
- **권고**: 최신 상태를 ref(예: draftRef)에 미러링하고 interval은 마운트 시 1회만 설정해 ref에서 읽어 저장하거나, beforeunload/visibilitychange에서 즉시 저장을 추가.

### 🔶[부분완료 06-11: CSP 메타 추가(스크립트 외부출처 차단·frame/object 제한) / SRI·폰트 셀프호스팅은 잔존] [보안] index.html에 CSP 부재 + 외부 CDN 리소스 SRI 없음

- **위치**: `index.html:33`
- **설명**: index.html 에 Content-Security-Policy 메타태그가 없고, 외부 출처에서 스타일시트를 무결성 검증(SRI) 없이 로드한다: 32라인 fonts.googleapis.com (Google Fonts), 33라인 cdn.jsdelivr.net (pretendard.css — GitHub 저장소를 jsdelivr가 미러링하는 `gh/orioncactus/...` 경로라 업스트림 변조 시 그대로 반영됨). 외부 <script> 로드는 없음. Capacitor WebView 앱 특성상 CSP가 없으면 XSS 발생 시 완화 장치가 전혀 없다.
- **권고**: 최소한의 CSP 메타태그 추가(예: default-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com cdn.jsdelivr.net; font-src 'self' fonts.gstatic.com; connect-src 백엔드/RAG 도메인 명시; styled-components 때문에 style-src 'unsafe-inline' 은 필요). pretendard는 가능하면 폰트 파일을 public/ 에 셀프호스팅하여 jsdelivr 의존 제거.

### [보안] Access Token을 localStorage에 저장 — XSS 시 탈취 가능

- **위치**: `src/api/auth.ts:20`
- **설명**: auth.ts:20 'jazzify.auth.accessToken' 키로 access token을 localStorage에 영속(라인 46-62)하고, 사용자 정보 캐시도 'jazzify.auth.userCache'(라인 21, 97-108)에 저장한다. XSS가 한 번이라도 발생하면 토큰을 그대로 탈취할 수 있다. 완화 요소: refresh token은 HTTP-only 쿠키(라인 4-9 설계 주석)라 직접 탈취 불가이고, access token은 단명(短命)이며 만료는 exp 디코딩 기반 선제 갱신(라인 73-95)과 401 반응형 갱신으로 처리되어 만료 처리 자체는 견고하다. SPA에서 흔한 트레이드오프이므로 심각도는 낮게 평가.
- **권고**: 가능하면 access token을 모듈 메모리에만 보관하고 새로고침 시 refresh 쿠키로 재발급받는 패턴으로 전환을 검토하라(이미 bootstrapAuth의 refresh 경로가 있어 전환 비용이 낮음). 유지한다면 CSP 강화로 XSS 면적을 줄여라.

### ✅[수정완료 06-11] [보안] authFetch가 임의의 절대 URL에 Bearer 토큰을 무조건 첨부 (도메인 allowlist 부재)

- **위치**: `src/api/auth.ts:202`
- **설명**: auth.ts:202-208에서 `input.startsWith('http')`이면 URL을 그대로 사용하면서 Authorization 헤더와 credentials:'include'를 붙인다. 어떤 도메인인지 검증이 없어, 향후 누군가 authFetch에 외부 URL(또는 서버 응답에서 온 URL)을 넘기면 JWT가 외부로 전송된다. 현재 호출처 전수 확인 결과(chat.ts, licks.ts, solos.ts, chordProjects.ts, sheetProjects.ts, storageFiles.ts) 모두 API_BASE(jazzify.p-e.kr) 경로만 사용하므로 현시점 실유출은 없음 — 잠재 리스크다.
- **권고**: authFetch에서 절대 URL일 경우 origin이 API_BASE의 origin과 일치할 때만 Authorization을 첨부하도록 검사를 추가하라.

### ✅[수정완료 06-11] [보안] 백엔드(RAG) 제공 video_url을 스킴 검증 없이 anchor href에 직접 사용

- **위치**: `src/components/chat/ChatMessage.tsx:181`
- **설명**: RAG 서버 응답(RagChunk, src/api/harmorag.ts:45의 `video_url?: string`)이 스킴/도메인 검증 없이 <a href>에 그대로 들어간다. 위치는 2곳: (1) src/components/chat/ChatMessage.tsx:181-186 — CitationChip에서 `const url = chunk.video_url || \`https://www.youtube.com/watch?v=${chunk.video_id}&t=${ts}s\`` 후 `<CiteVideoLink href={url} target="_blank" rel="noopener noreferrer">`. (2) src/components/chat/RagDebugPanel.tsx:160-162, 205 — 동일하게 `chunk.video_url`을 `<a href={videoUrl}>`에 사용. react-markdown(10.1.0)의 defaultUrlTransform이 javascript: 스킴을 차단하는 것과 달리, 이 인용 칩은 마크다운 파이프라인 밖의 일반 anchor라 해당 보호를 우회한다. RAG 코퍼스/서버가 javascript: 또는 data: URL을 내려보내면 클릭 시 스크립트 실행 가능성이 생긴다(target=_blank + noopener 덕에 최신 브라우저에서는 대부분 차단되지만 보장 사항은 아님). 또한 `chunk.video_id`를 encodeURIComponent 없이 watch URL에 보간하는 것도 같은 두 위치에 존재하나, 이 경우 origin이 youtube.com으로 고정되어 위험도는 낮다. 현재 데이터 출처가 자사 RAG 서버라 신뢰 경계 내부이긴 하나, 유튜브 메타데이터가 코퍼스로 인입되는 파이프라인 특성상 심층 방어가 필요하다.
- **권고**: href에 넣기 전에 URL을 검증하는 헬퍼를 두 곳에 공통 적용할 것. 예: `new URL(raw)`로 파싱해 protocol이 'http:'/'https:'인 경우에만 사용하고, 더 엄격하게는 hostname이 youtube.com/youtu.be 계열일 때만 허용. 검증 실패 시 `https://www.youtube.com/watch?v=${encodeURIComponent(chunk.video_id)}` 폴백을 사용하거나 링크를 렌더링하지 않는다. video_id 보간부에도 encodeURIComponent 적용.

### [보안] Vite dev 서버 0.0.0.0 바인딩 + /api 프록시 — 취약 버전과 결합 시 위험

- **위치**: `vite.config.ts:11`
- **설명**: vite.config.ts:11 `host: true` 로 dev 서버가 모든 인터페이스(LAN/Tailscale)에 노출되고, 27-33라인 프록시가 /api 요청을 https://jazzify.p-e.kr 로 중계한다(cookieDomainRewrite 로 RefreshToken 쿠키도 통과). iOS Capacitor 라이브 리로드를 위한 의도된 설정(주석에 명시)이지만, 현재 설치된 vite 8.0.1 에는 optimized deps .map 경로 순회 취약점(high)이 있어 같은 네트워크의 제3자가 dev 머신 파일에 접근할 수 있는 조합이 된다. 그 외 vite.config.ts 자체는 양호: 프로덕션 sourcemap 미설정(기본 off — dist/에 .map 파일 없음 확인), define 주입 없음. capacitor.config.ts 도 server.url/cleartext 블록이 주석 처리(40-43라인)되어 있고 allowNavigation 없음 — 배포 기준 안전.
- **권고**: vite를 8.0.5 이상으로 패치(위 dependency finding과 동일 조치)하면 대부분 해소. dev 서버를 띄울 때는 신뢰 네트워크(Tailscale)에서만 사용하고, 라이브 리로드가 필요 없는 날은 host:true 를 끄는 습관 권장.

---

## 5. ℹ️ Info — 참고/기록 (9건)

### ✅[수정완료 06-12] [버그] 패널 리사이즈 드래그 중 unmount 시 window 리스너 잔존

- **위치**: `src/pages/ChordPage.tsx:1683`
- **설명**: onDividerMouseDown(ChordPage.tsx:1683-1700, NotePage.tsx:947-964 동일 패턴)은 window에 mousemove/mouseup 리스너를 등록하고 mouseup에서만 해제한다. 드래그 도중 컴포넌트가 unmount되면(예: 단축 네비게이션) 다음 mouseup이 올 때까지 리스너가 남아 unmount된 컴포넌트의 setRightPanelWidth를 호출한다(React 18에서는 no-op이지만 클로저가 잔존). 브라우저 창 밖에서 버튼을 놓아 mouseup이 유실되는 엣지에서는 mousemove 리스너가 계속 남는다.
- **권고**: 드래그 등록/해제를 useEffect 기반으로 옮겨 unmount cleanup에서 removeEventListener를 보장하거나, 핸들러 참조를 ref에 보관해 unmount 시 제거. 또는 setPointerCapture 기반으로 전환.

### ✅[수정완료 06-11] [버그] 클립보드 복사 실패를 무시하고 'Copied!' 표시

- **위치**: `src/pages/EditorPage.tsx:2721`
- **설명**: handleCopy(2721-2726)는 `navigator.clipboard.writeText(jsonOutput)`의 Promise를 처리하지 않는다. 비보안 컨텍스트나 권한 거부 시 rejection이 발생해도(unhandled rejection) UI는 무조건 setCopied(true)로 '✓ Copied!'를 1.5초 표시해 복사가 된 것으로 오인하게 한다.
- **권고**: `navigator.clipboard.writeText(...).then(() => setCopied(true)).catch(() => setSaveError('복사 실패') 등 실패 피드백)` 형태로 성공 시에만 Copied 표시.

### ✅[수정완료 06-14] [데드코드] src/api/analysis.ts — 어디서도 import되지 않는 죽은 모듈

- **위치**: `src/api/analysis.ts:1`
- **설명**: analysis.ts의 export 3개(getLeadSheetData, getSongData, analyzeChords)를 src 전체에서 grep한 결과 import하는 곳이 한 곳도 없다. getSongData/analyzeChords는 null/[]만 반환하는 목업이고 fetch는 주석 속 예시뿐이다.
- **권고**: 사용 계획이 없으면 삭제 후보로 기록해 두라(읽기 전용 감사이므로 보고만 함).

### [데드코드] LeadSheet: SubV(트라이톤 대리) 장식 경로 전체가 의도적 하드코딩으로 사문화

- **위치**: `src/components/leadsheet/LeadSheet.tsx:1194`
- **설명**: `const isSubV = false;`(1194, 주석으로 의도 명시)로 인해 SubV 관련 렌더 경로가 모두 도달 불가능하다: subVLabel(1209), SubVHighlight/SubVBand/SubVBandText 렌더(1230-1236) 및 styled 정의(1082-1125), onSubVClick 전달 체인(1150, 1408, 1554, 3852), setSubVPopupChord/SubVPopup 렌더(2354, 4027-4038)와 SubVPopup import(21). 기능 보존 의도가 명확하므로 버그는 아니지만, 유지보수 시 살아있는 코드로 오인될 수 있는 분량이다.
- **권고**: 당장 제거할 필요는 없으나, 기능 복귀 계획이 없다면 SubV 경로를 별도 브랜치/커밋 기록에 남기고 본문에서 제거하거나, 최소한 isSubV를 feature flag 상수로 빼서 사문화 범위를 한 곳에서 추적 가능하게 하라.

### ✅[수정완료 06-11] [데드코드] engine.renderChart에 디버그 console.log 잔존

- **위치**: `src/lib/backing/engine.ts:415`
- **설명**: renderChart의 멜로디 트랙 분기에 `console.log("[unified] melody track →", { count: opts.melody.length })`(engine.ts:415)가 남아 있어, 멜로디가 있는 모든 build() 호출(매 play(), setConfig({melody})의 rebuildEventsInPlace 포함)마다 프로덕션 콘솔에 로그가 찍힌다.
- **권고**: 해당 console.log 제거(필요하면 개발 전용 디버그 플래그 뒤로 이동).

### ✅[수정완료 06-11] [데드코드] src/lib/ireal 파서 파이프라인 전체가 미사용 데드코드 (irealLoader.ts 제외)

- **위치**: `src/lib/ireal/midiChart.ts:1`
- **설명**: src/lib/ireal/ 디렉토리에서 앱이 실제로 임포트하는 파일은 irealLoader.ts뿐이다(ChordPage.tsx:16, NotePage.tsx:28). 나머지 — decode.ts(75행), tokenize.ts(179행), parse.ts(212행), types.ts(66행), index.ts(64행), midiChart.ts(446행, loadMidiLeadSheet) — 는 src/ 와 scripts/ 어디에서도 정적·동적 임포트가 없음을 grep으로 확인했다(scripts/convert-ireal.cjs는 자체 독립 구현을 사용). 총 약 1,000여 행이 유지보수 대상에 포함되어 있으나 빌드 산출물에는 트리셰이킹으로 빠질 가능성이 높고, midiChart.ts에는 도달 불가능한 잠재 결함(parseKeySignature 211-214행: 손상된 MIDI에서 sf가 -7..7 범위를 벗어나면 MAJOR_KEY_BY_SIG[index]가 undefined가 되어 217행 key.replace에서 TypeError)도 있다.
- **권고**: iReal URL 직접 파싱 기능을 향후 사용할 계획이 없다면 디렉토리에서 미사용 파일들을 제거하거나, 계획이 있다면 README 주석으로 '현재 미연결, scripts/convert-ireal.cjs가 빌드타임 대체' 상태를 명시한다. 유지한다면 midiChart.ts의 parseKeySignature에 sf 범위(−7..7) 가드를 추가한다.

### 🔶[부분완료 06-12: YouTube 모달·숨김 input·alias 제거(+고아 pickGradient) / 레거시 생성 모달·renameItem file 분기는 보존 주석 따라 유지] [데드코드] MyChordChartsPage 데드코드: YouTube 모달, 레거시 생성 모달, 숨김 파일 input, renameItem file 분기

- **위치**: `src/pages/MyChordChartsPage.tsx:1365`
- **설명**: grep으로 호출처 부재 확인: (a) youtubeOpen 모달(1365~1385)과 addYouTube(537~549) — setYoutubeOpen(true) 호출처가 없어 절대 열리지 않음. (b) createProjectOpen 모달(1206~1251)과 handleCreateProject(568~589) — setCreateProjectOpen(true)는 미사용 _openCreateProject(562~566, void 처리)에서만 호출. (c) 숨김 파일 input(1194~1204)과 fileInputRef — fileInputRef.current?.click() 호출처 없음(신규 드롭다운 제거 후 잔존), 이에 따라 handleOmrFile alias(592)의 이 진입 경로도 죽음. (d) renameItem의 'file' 분기(603~616) — 파일 카드는 openEdit/confirmEdit 경로(1080)만 사용하고 startRename은 폴더(985)에서만 호출되는데 폴더 자체가 렌더되지 않음(별도 finding 참조). 기능 동작에는 영향 없으나 2,872줄 파일의 유지보수 비용을 키운다.
- **권고**: 사용자 확인 후 일괄 제거 권장(읽기 전용 감사라 수정하지 않음). 폴더 기능 복원 계획이 있다면 (d)는 유지하되 나머지는 정리.

### ✅[수정완료 06-14] [보안] capacitor.config.ts 주석에 내부 네트워크 IP 노출

- **위치**: `capacitor.config.ts:40`
- **설명**: git에 추적되는 capacitor.config.ts의 35-43행 주석에 개발 Mac의 LAN IP(192.168.0.12:5173)와 Tailscale IP(100.92.49.85:5173)가 기재되어 있다. 시크릿은 아니지만 저장소가 공개되거나 공유될 경우 내부 네트워크 구조(Tailscale 테일넷 주소 포함)가 노출된다. 위험도는 낮음(Tailscale은 테일넷 멤버만 접근 가능).
- **권고**: 공개 저장소로 전환할 계획이 있다면 주석의 실 IP를 <MAC_LAN_IP> 같은 플레이스홀더로 치환한다. 사설 저장소 유지 시 현 상태로도 무방하다.

### [보안] JAZZIFY_ADMIN_* 자격증명 번들 노출 없음 (검증 완료)

- **위치**: `src/api/auth.ts:19`
- **설명**: 확인 결과 안전: .env.local의 JAZZIFY_ADMIN_USER / JAZZIFY_ADMIN_PASS(변수명만 확인, 값 미출력)는 src/ 및 vite.config 어디에서도 참조되지 않으며, VITE_ 접두사가 없어 Vite가 import.meta.env로 클라이언트에 노출하지도 않는다. src 전체의 import.meta.env 참조는 DEV 플래그(auth.ts:19, chat.ts:24, licks.ts:5, solos.ts:25)와 VITE_ANTHROPIC_API_KEY(claude.ts:1), VITE_RAG_BASE/VITE_RAG_TOKEN(harmorag.ts:18,21)이 전부다.
- **권고**: 현 상태 유지. 향후에도 admin 자격증명에 VITE_ 접두사를 붙이지 않도록 주의하라.

---

## 6. 미사용 변수 / 미사용 지시자 (기록만 — 수정하지 않음)

`tsconfig.app.json`에 `noUnusedLocals`/`noUnusedParameters`가 이미 켜져 있어 tsc 레벨 미사용 심볼은 **0건**이다(빌드가 게이트). 아래는 eslint(@typescript-eslint/no-unused-vars + 미사용 disable 지시자)가 잡은 15건 — 대부분 `_` 접두 의도적 표기지만 eslint 설정에 `argsIgnorePattern: "^_"`가 없어 에러로 집계된다.

| 위치 | 내용 |
|---|---|
| `src/api/analysis.ts:13` | '_songId' is defined but never used (죽은 모듈 — §Info 데드코드 참조) |
| `src/api/analysis.ts:19` | '_songId' is defined but never used |
| `src/api/onsetSuggest.ts:31` | '_lickNum' is defined but never used |
| `src/components/layout/RightChatPanel.tsx:405` | '_chatPublicId' is assigned a value but never used |
| `src/components/leadsheet/LeadSheet.tsx:997` | '_' is defined but never used |
| `src/components/leadsheet/LeadSheet.tsx:1008` | '_' is assigned a value but never used |
| `src/components/notesheet/NoteSheet.tsx:361` | '_acc' is defined but never used |
| `src/lib/note/countInPatterns.ts:59` | '_bpm' is defined but never used |
| `src/lib/note/transposeNoteSheet.ts:77` | 'pc' is assigned a value but never used |
| `src/lib/player/GlobalPlayer.ts:235` | Unused eslint-disable directive (no-console) |
| `src/lib/player/GlobalPlayer.ts:672` | '_m', '_lr' is assigned a value but never used (2건) |
| `src/lib/player/GlobalPlayerContext.tsx:142` | Unused eslint-disable directive (no-console) |
| `src/lib/yamaha-sty/parser.ts:471` | '_cf' is defined but never used |
| `src/pages/NotePage.tsx:79` | 'pc' is assigned a value but never used |

**권고**: eslint 설정에 `varsIgnorePattern/argsIgnorePattern: "^_"`를 추가하면 의도적 `_` 표기 11건이 정리되고, 실질 미사용 4건(`pc` 2건, `_chatPublicId`, 지시자 2건)만 남는다.

> ✅ **06-11 반영**: eslint.config.js에 vars/args/caughtErrors IgnorePattern `^_` 추가 — lint 에러 79→68. (`pc` 2건·지시자 2건은 잔존)
>
> ✅ **06-12**: 잔여 실질 미사용 전부 정리 — 죽은 `pc` 사전계산 블록 2곳 제거(transposeNoteSheet/NotePage), unused eslint-disable 지시자 3건 제거. §6 잔여 0건.

---

## 7. 기타 eslint 에러 분포 (총 99건: 에러 79 / 경고 20)

`npm run lint`가 빌드/CI 어디에도 연결되어 있지 않아 에러가 누적 방치 상태다.

| 룰 | 건수 | 비고 |
|---|---|---|
| react-refresh/only-export-components | 21 | HMR 무력화 — 컴포넌트 파일에서 유틸 함수 동시 export |
| react-hooks/exhaustive-deps | 18 | stale closure 위험 — NoteSheet/LeadSheet/ChordPage 집중 (§Medium 버그들과 동일 뿌리) |
| react-hooks/set-state-in-effect | 11 | 렌더 직후 동기 setState — 불필요 이중 렌더 |
| @typescript-eslint/no-explicit-any | 10 | ChordPage.tsx:1092 `handleChordClick(_chord: any)` 등 |
| no-useless-escape | 6 | 정규식 불필요 이스케이프 |
| react-hooks/immutability | 4 | ChatMessage.tsx 793/809/811 — props 배열 직접 push 의심 |
| no-empty | 4 | 빈 catch 블록 — 에러 삼킴 |
| prefer-const | 3 | |
| **react-hooks/rules-of-hooks** | **2** | **잠재 버그**: `src/lib/lickMatcher.ts:240`, `src/pages/ChordPage.tsx:1905` — 조건부/비컴포넌트 훅 호출 여부 확인 필요 |
| @typescript-eslint/no-unused-expressions | 2 | EditorPage.tsx:2657, SoloGeneratorPage.tsx:2533 — 무의미 표현식(의도된 호출 누락 의심) |
| 기타 | 3 | preserve-manual-memoization 1, no-useless-catch 1, no-empty-object-type 1 |

**권고**: `build` 스크립트 또는 CI에 `npm run lint -- --max-warnings 0` 게이트를 추가하고, rules-of-hooks 2건부터 확인하라.

> ✅ **06-11**: rules-of-hooks 2건 조사 — 둘 다 `use` 접두 이름의 일반 헬퍼(`useFlatsForPc`/`useFlats`)를 훅으로 오인한 가짜 양성. `prefersFlats*`로 리네임해 해소 (lint 68→62).

---

## 8. 리팩토링 추천

### 9-1. MyChordChartsPage ↔ MySheetProjectsPage 통합 (최우선)

- **근거**: 두 파일에서 **이름이 완전히 동일한 styled-components가 55개** (CardBase, KebabMenu, ModalCard, ListRow, HoverOverlay …). MyChordChartsPage 78개 / MySheetProjectsPage 65개 styled 정의 중 대부분이 복붙. 운영 규칙상 "두 페이지 카드는 항상 똑같이 수정"인데 코드가 분리되어 있어 비대칭 버그가 실제로 발생 중(§Low "악보 카드 클릭 무동작 — 코드 차트 페이지와 비대칭" 참조).
- **제안**: `src/components/projects/` 에 `ProjectCardGrid`·`ProjectListView`·`ProjectKebabMenu`·`ProjectPageShell` 컴포넌트와 `useProjectListPage(kind)` 훅을 추출하고, 두 페이지는 데이터 소스(chordProjects/sheetProjects API)와 라우팅만 주입. 예상 효과: 합계 4460줄 → 2500줄 수준, 비대칭 버그 원천 차단.

### 9-2. 거대 파일 분할

| 파일 | 줄수 | 분할 제안 |
|---|---|---|
| `src/components/leadsheet/LeadSheet.tsx` | 4037 | VexFlow 렌더 코어 / 드래그 선택(`useLeadSheetSelection`) / 코드 편집(`useLeadSheetEdit`) / ii-V 브래킷·장식 렌더러를 각각 분리. 선택 로직은 이미 포인터 이벤트 버그가 2회 발생한 핫스팟 |
| `src/pages/EditorPage.tsx` | 3522 | 재생 루프(§High 무한 루프 버그의 진원)를 GlobalPlayer로 위임하고, 입력 폼·악보 미리보기·JSON 입출력을 컴포넌트 분리 |
| `src/pages/SoloGeneratorPage.tsx` | 3268 | 동일 — 페이지 내장 재생 루프 제거(§High 이탈 시 무한 재생 버그의 원인), 생성 파이프라인을 lib로 |
| `src/data/jazzSongs.ts` | 33264 | TS 모듈에 박힌 정적 데이터 → `public/data/jazzSongs.json` + fetch lazy load. 번들 크기·타입체크·HMR 속도 모두 개선 |

### 9-3. 횡단 관심사

- **z-index 토큰화**: 15종 값(1~9999)이 산재하고 이미 충돌 버그 존재(§Low Cmd+K 모달이 모바일 오버레이 아래 깔림). `theme.zIndex = { base, dropdown, sticky, overlay, modal, toast }` 단일 스케일로 통일.
- **API 에러 처리 공통화**: §Low "에러 응답 원문 UI 노출"과 연결 — `src/api/` 6개 파일이 제각각 에러를 조립. 공통 `apiFetch` 래퍼(에러 code→한국어 메시지 매핑, detail은 dev 전용 로깅)로 통일.
- **타입 캐스트**: `as any` 10곳 + `as unknown as` 15곳으로 규모 대비 양호하나 오디오 어댑터(smplrAdapter, GlobalPlayerContext)에 집중 — smplr 어댑터 인터페이스를 정의하면 절반 제거 가능.
- **로컬 데이터 버전·네임스페이스**: localStorage 키가 `jazzify.*`, `jazzify_*`, `lickInput.*`, `leadSheetGenerator.*` 등 4가지 컨벤션 혼재 + 사용자 네임스페이스 없음(§Medium 계정 전환 노출 버그의 뿌리). `jazzify.<userId>.<domain>.<v>` 규칙으로 통일하고 중앙 키 레지스트리 모듈을 두라.

---

## 10. §8 리팩토링 로그 (2026-06-12 착수)

> **롤백 지점**: `../.snapshots/pre-refactor-20260612.tar.gz` (src + index.html + 설정 + 이 문서, 275파일).
> **롤백 절차**: `cd frontend && tar -xzf ../.snapshots/pre-refactor-20260612.tar.gz` → 빌드 확인. (git 미사용 — 커밋/푸시 금지 지시에 따라 파일시스템 스냅샷)
> 리팩토링의 모든 스텝을 아래에 시간순 기록한다. 각 스텝은 단독으로 `npm run build` 통과를 확인한 뒤에만 다음으로 진행.

| # | 스텝 | 변경 | 검증 |
|---|---|---|---|
| R0 | 스냅샷 백업 | 위 tar 생성 | 275파일 무결성 확인 |
| R1 | §10 로그 섹션 신설 | 롤백 지점/절차 명문화 | — |
| R2 | jazzSongs.ts 처리 | §8 제안은 'JSON lazy 분리'였으나 **분석 결과 소비자 0**(정적·동적 import 전무, 런타임은 public/jazz1460.json fetch, 번들에도 미포함=트리셰이킹 확인) → **33,264줄 파일 삭제**가 정답. tsc/HMR/에디터 그래프에서 제거 | build 0 ✓ |
| R3 | z-index 토큰화 | theme.zIndex 스케일 신설(floating 900/modal 1000/modalHigh 1100/overlay 1200/popover 1300/toast 2000/max 9999 — 기존 숫자 그대로라 시각 변화 0) + 전역 레이어 27곳/24파일 토큰 치환. 지역 스태킹(0~650)은 의도적으로 제외. LeadSheet 중첩 템플릿 1곳은 외부 보간으로 수정 | build 0 ✓ · lint 60/18 동일 |
| R4 | §9-1 공통 styled 추출 (1단계) | 두 페이지에서 **이름·본문 100% 동일** styled 31개를 `src/components/projects/sharedStyles.ts`(364줄)로 기계 추출 — 상호참조 클로저 검사로 외부 의존 없는 것만. 양 페이지는 정의 삭제+import로 교체. 이름 같고 본문 다른 17개(CardCheckbox/CardTitle/CardTitleRow/Grid/KebabMenu/ListThumb/Modal계 7종/NewCard/NewLabel/PageBody/SortMenu)는 의도 차이 검토 전까지 보류 — 통합 시 props 흡수 필요 | build 0 ✓ |
| R5 | 상이 17개 diff 검토 → 5개 추가 통일 | 차이가 주석/무해 superset/등장애니뿐인 Grid·KebabMenu·SortMenu·PageBody·ListThumb를 chord판 기준으로 shared 이동(사유 주석 명기). sheet의 고아 mq import 정리. **잔여 12개는 실제 디자인 차이**(Modal 6종 룩, NewCard/NewLabel, CardCheckbox/CardTitle/CardTitleRow, ModalActions) — 통합엔 디자인 결정 필요, 보류 목록 명기 | build 0 ✓ |
| R6 | 공통 로직 훅 추출 | `useDismissable`(바깥클릭/Escape 닫기 — 5벌 복붙 effect 통합: chord 3곳+sheet 2곳) + `useViewModePref`(그리드/리스트 영속화 — storageKey는 페이지별 유지로 기존 설정 보존). 고아가 된 로컬 ViewMode 타입 2곳 제거. react-compiler의 렌더중 ref 쓰기 지적은 effect-미러로 수정 | build 0 ✓ · lint 60/18 복귀 |
| R7.0 | 중간 스냅샷 | `../.snapshots/post-R6-20260612.tar.gz` — R6 시점으로도 롤백 가능 | — |
| R7.1~2 | LeadSheet 1차 분할 (4,037→3,529줄) | 순수 모듈 3개 추출: **leadSheetAnalysis.ts**(354줄 — ii-V 브래킷/ii-V-I 스팬/세컨더리 도미넌트 탐지 + ArrowSpec/BracketSpec/IIVISpan 타입; ResolvedBracket은 렌더 소속이라 잔류), **leadSheetTranspose.ts**(98줄 — 키 테이블·keyToPc·shiftKey·transposeData), **leadSheetQuality.ts**(79줄 — normalizeQuality/splitQuality, 렌더·분석 양쪽 소비). 외부 소비자(ChordPage/NotePage/NativeChordPlayer)의 import 경로는 LeadSheet re-export로 보존 — 호출부 변경 0 | build 0 ✓ · 새 모듈 lint 0 |
| R7.3 | 선택 로직 → useLeadSheetSelection (LeadSheet 3,529→3,401줄) | 포인터 버그 2회 발생 핫스팟인 드래그/클릭 선택 전체(타겟 인덱스 useMemo·드래그 앵커/프리뷰 ref·window pointerup/cancel·shift-범위·토글-해제·모드 off 리셋)를 180줄 훅으로 **동작 불변 이동**. `LeadSheetChordSelection` 타입도 훅으로 이전, LeadSheet가 re-export해 외부(ChordPage) import 경로 보존. 알려진 모바일 터치 제약(implicit pointer capture)은 훅 헤더에 명기 — 별도 finding으로 잔존. lint +1은 이동으로 가시화된 원본의 setState-in-effect 관용구(거대 파일에선 컴파일러 베일아웃으로 미표시) — 동작 불변 원칙상 수정하지 않고 기록 | build 0 ✓ |
| R8.0 | 분석 → 방향 전환 | 스냅샷 `../.snapshots/pre-R8-20260613.tar.gz`. **당초 "GlobalPlayer 위임"은 리팩토링이 아니라 동작 변경 재작성**임을 확인: 두 페이지는 `kb.play`로 **피아노 단독**(멜로디+2·4박 콤핑) 재생인데 GlobalPlayer solo경로는 **풀밴드**(베이스+드럼)+엔진 반복미전개라 사운드가 바뀜. 사용자 결정으로 **공유 훅 추출**(사운드 불변)로 선회 | 분석 only |
| R8.1 | melodyTiming.ts (68줄) | 두 페이지에 **글자까지 동일**(diff 확인) 복붙된 음표/코드 헬퍼 추출: DUR_BEATS/vexToMidi/getBeats/chordToMidi(+내부 SEMI_MAP). 두 페이지·훅이 공유. 원본의 no-useless-escape도 정리 | build 0 ✓ |
| R8.2 | useNoteSheetPlayback.ts (403줄) | 두 페이지가 ~330줄씩 복붙한 재생 루프(카운트인 정렬·반복/볼타/D.C./D.S./Coda 전개·2·4박 콤핑·스윙 타이밍·DOM 하이라이트·일시정지/재개·중단)를 훅으로 통합. **EditorPage 검증본을 라인 슬라이스로 그대로 이전**(재타이핑 0). 입력 {allMeasures,bpm,noteElMapRef}, 반환 {playing,paused,handlePlay,handlePause,countInOverlay} | build 0 ✓ |
| R8.3 | 두 페이지 위임 (Editor −421·Solo −408줄) | 로컬 헬퍼+재생 기계장치 제거 → 훅 호출로 대체. **부수효과: SoloGen이 옛 버그 사본이라 통합으로 잠복 버그 4종 자동 해소**(abort 리스너 누수 정리·miOffset Math.max 가드·빈패스 break·checkPause 정리). SoloGen 전용 중복 언마운트 effect·미사용 import·stale 주석 정리. 순 −358줄, lint 59E/18W→**58E/17W** | build 0 ✓ |
| R9 | 잔여 분기 styled 검토 → **의도적 분리 확정** | 이름만 같고 다른 10개(NewCard/NewLabel/CardTitle/CardTitleRow/CardCheckbox/ModalCard/ModalTitle/ModalInput/ModalActions/ModalBtn) 전수 diff: **시각적으로 다른 페이지별 디자인**(드리프트 아님 — NewCard는 Chord가 aspect-ratio 전용 카드/Sheet는 CardBase+점선, 모달 크기·버튼·입력 치수도 상이). props 흡수 시 프롭 10개짜리 과한 추상화라 **분리 유지가 정답**(R5 '시각차 없을 때만 통합' 기준과 일치). sharedStyles.ts 헤더에 정본 기록 + 양 페이지 10개 정의에 'point-of-edit 통합금지' 마커 → 비대칭-버그 재발 방지. **§8 styled 통합 항목 종료** | build 0 ✓ |

---

## 9. 저장소 위생 / 잔재 파일

| 항목 | 상태 | 권고 |
|---|---|---|
| `patch.js` (git 추적) | 대상 파일 `src/lib/note/notePlayer.ts`가 **이미 삭제됨** — 실행 불가능한 일회성 codemod 잔재 | 삭제 |
| `fix_highlight.patch`, `fix_lead.patch` (git 추적) | 적용 완료된 일회성 패치 잔재 | 삭제 |
| `frontend/` | gitignore 처리됐으나 디렉토리 잔존(README만) | 로컬 삭제 |
| `dist/` | gitignore — 미추적 확인 (단, 내부에 노출 API 키 포함 — §Critical 참조) | 키 회전 후 재빌드 |
| 미사용 의존성 | `tslib`, `html2canvas`, `svg2pdf.js`, `@capacitor/app` — src/index.html/설정 어디서도 참조 없음 (간접 플러그인 사용 여부만 최종 확인) | 확인 후 제거 |
| `claude@0.1.1` | **정체불명 빈 패키지** — §Medium 의존성 finding 참조 | 즉시 제거 |
