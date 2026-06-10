# Fable_ios.md — iOS (Capacitor) 검증 보고서

> 2026-06-10. iPhone 17 시뮬레이터(iOS 26.3)에 **실제 앱을 빌드·설치·실행**해 검증 + HTTP 레이어 실험 + 코드 감사.
> 원칙: 보고만, 수정 없음. 여기 항목을 고치면 해당 줄에 체크 표시할 것.

## 검증 방법

1. `vite build` + `npx cap sync ios` (번들 최신화)
2. Xcode 26.5 + iOS 플랫폼 설치 → `xcodebuild`로 시뮬레이터 빌드
3. iPhone 17 시뮬레이터(iOS 26.3)에 설치·실행, 스크린샷·로그 수집
4. `curl`로 백엔드/RAG 서버에 `Origin: capacitor://localhost` CORS 실험
5. 코드 감사 (오디오/인증/네트워크/레이아웃/스토리지/네이티브 설정/보안/수명주기 8개 차원)

## ✅ 잘 되는 것

- **앱 부팅·렌더 정상**: 네이티브 인트로(로고·히어로·채팅 입력·모델 셀렉터) 완벽 렌더. 한글 정상, **세이프영역(노치) 정상**, 키보드 자동 팝업(의도된 설계) 정상.
- **RAG 서버(HarmoRAG)는 iOS에서 동작 가능**: `Origin: capacitor://localhost` 프리플라이트 **200 허용** (allow-origin: `*`, authorization 헤더 허용). → 비로그인 채팅 경로는 살아 있음.
- API 모듈 4개(auth/chat/solos/licks) 모두 `import.meta.env.DEV ? '/api' : 'https://jazzify.p-e.kr/api'` 패턴 → 번들 모드에서 상대경로 404 위험 없음.
- `viewport-fit=cover`(index.html) + `100dvh`(global.ts) 처리돼 있어 노치/뷰포트 기본기 OK.
- (해소됨) iOS 번들이 13일 묵은 상태 + 동기화된 config에 dev `server.url` 잔존 → **2026-06-10 `cap sync`로 해소**. 단, 구조적 재발 위험 있음(아래 #12).

---

## 🔴 치명 (iOS에서 서비스 동작 불가 / 보안)

### 1. 백엔드 CORS가 `capacitor://localhost`를 403 거부 — **iOS에서 백엔드 API 전부 불가**
- 실험: 프리플라이트(OPTIONS)·실제 POST(login) 모두 `403 "Invalid CORS request"`.
- 백엔드 allowlist: `http://localhost:5173` → 200 (dev 허용), capacitor 오리진 → 403.
- WKWebView는 cross-origin fetch에 항상 `Origin: capacitor://localhost`를 보내고 CORS를 강제하므로, **로그인 포함 모든 백엔드 호출이 실패**한다.
- **조치**: 백엔드 CORS 설정에 `capacitor://localhost` 추가 (Android 대비 `https://localhost`, `http://localhost`도 함께).
- 참고: 쿠키는 이미 `SameSite=None; Secure; HttpOnly; Path=/api`라 CORS만 풀리면 refresh(RTR)도 갈 가능성 높음. 단 WKWebView 서드파티 쿠키(ITP) 정책은 CORS 해결 후 재검증 필요 — 안 되면 Capacitor CapacitorHttp(네이티브 fetch 브리지) 또는 refresh 토큰 body 전달 방식 검토.

### 2. 앱 번들에 시크릿 평문 포함 — **배포 시 키 유출**
- 확인: 설치되는 `App.app/public/assets/index-*.js` 안에 **Anthropic API 키(`sk-ant…`)와 RAG Bearer 토큰** 포함 (grep으로 실물 확인).
- 출처: `.env`의 `VITE_ANTHROPIC_API_KEY`, `VITE_RAG_TOKEN` — `VITE_` 접두사라 빌드 시 번들에 박힘.
- 앱스토어 배포 = 바이너리 영구 보존 → 누구나 추출 가능. (웹도 동일 문제지만 앱이 더 심각)
- **조치**: 두 키 모두 프런트에서 제거 → 백엔드 프록시 경유(백엔드가 서버에서 키를 붙여 호출). Anthropic 키는 **회전(폐기·재발급)** 필수 — 이미 노출된 상태.

### 3. Info.plist 권한 문자열 누락 — **카메라 선택 시 즉시 크래시 + 심사 리젝**
- `ios/App/App/Info.plist`에 `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` 없음 (실물 확인).
- OMR 업로드 `<input type="file" accept="image/...">`에서 사용자가 **"사진 찍기"를 고르면 앱 즉시 크래시**. 앱스토어 심사 리젝 사유.
- **조치**: 두 키 + 용도 설명 문자열 추가 (예: "악보를 촬영해 코드 차트로 변환하기 위해 카메라를 사용합니다").

---

## 🟠 높음 (핵심 기능 저하)

### 4. 무음(사일런트) 스위치 ON이면 모든 소리 안 남
- `AppDelegate.swift`에 `AVAudioSession` 설정 없음 (확인) → WebAudio가 ambient 카테고리 기본값.
- 연주 앱인데 무음 스위치(대부분 사용자가 ON)에서 백킹·카운트인·메트로놈 전부 무음.
- **조치**: AppDelegate에서 `AVAudioSession.sharedInstance().setCategory(.playback)` 설정.

### 5. 화면 잠금/앱 전환 시 재생 즉시 끊김
- `Info.plist`에 `UIBackgroundModes(audio)` 없음 + `AudioLifecycleGuard`(src/components/common/AudioLifecycleGuard.tsx)가 `visibilitychange: hidden`에서 의도적으로 `stopAllAudio()`.
- 연습 중 화면이 자동 잠금되면 백킹이 끊긴다.
- **조치(선택)**: 백그라운드 재생을 원하면 UIBackgroundModes audio + AVAudioSession + 가드 예외. 현 설계(끊김)를 유지한다면 최소한 자동 잠금 동안 재생 유지만이라도 검토.

### 6. `a.download` 파일 다운로드 무동작
- PDF 저장(`src/lib/note/scoreToPdf.ts`)·채팅 내보내기(`src/components/layout/RightChatPanel.tsx`)가 앵커 `download` 속성 방식 → **iOS WKWebView에서 동작 안 함/이상 동작**.
- **조치**: Capacitor `Filesystem` + `Share` 플러그인으로 분기 (iOS면 공유 시트로).

### 7. AudioContext 동시 개수 경계 (iOS 제한 ~4개)
- 생성 지점: backing 차트 엔진(`lib/backing/player.ts`) + 멜로디 엔진(GlobalPlayer가 별도 인스턴스) + 카운트인(`lib/note/countInClick.ts`) + GlobalKeyboard(`lib/player/GlobalKeyboard.ts`) + sty 엔진(`lib/yamaha-sty/sty-backing-player.ts`).
- 동시에 4개를 정확히 걸치는 구조 → 페이지 전환 반복/엔진 전환 시 새 ctx 생성 실패(무음 ctx) 가능.
- **조치**: 공유 AudioContext 싱글톤로 통합(장기) 또는 dispose 시 close 보장 점검(단기).

---

## 🟡 중간 / 낮음

### 8. ATS 전역 우회 잔존
- `Info.plist`의 `NSAllowsArbitraryLoadsInWebContent=true` — 번들+HTTPS 구조에선 불필요. 심사 시 사유 요구 가능. 제거 권장.

### 9. StatusBar / SplashScreen 플러그인 미설치
- 다크 배경 페이지에서 상태바 글자 안 보일 수 있음. 첫 페인트 전 흰 화면 플래시. `@capacitor/status-bar`, `@capacitor/splash-screen` 추가 권장.

### 10. `@capacitor/app` 설치만 되고 사용 코드 0건
- `appStateChange`로 오디오/폴링 정리 안 함 → OMR 폴링 `setInterval`이 백그라운드에서도 유지될 수 있음(iOS가 타이머를 동결하지만 복귀 시 몰아침). 수명주기 연동 권장.

### 11. (시뮬레이터 Safari 한정 글리치로 판정) 이모지 아이콘 두부
- 시뮬레이터 **Safari**에서 인트로 카드 이모지(🎷🎺📄✎)와 로그인 텍스트가 "?"로 깨졌으나, **실제 앱에서는 재현 안 됨**. 실기기에서 1회 확인 권장. (HomePage.tsx TOOLS 배열이 이모지 아이콘 사용)

### 12. 번들 동기화 재발 위험 (프로세스)
- `cap sync`를 빼먹고 Xcode에서 바로 빌드하면 **묵은 웹 번들**이 실리고, 라이브 리로드용 `server.url` 주석을 해제한 채 sync하면 **기기에서 dev 서버를 찾다 흰 화면**.
- **조치**: 배포 전 체크리스트화 (`npm run ios:build` 필수 경유), server.url 블록은 사용 후 즉시 재주석.

---

## 검증 한계 (정직 고지)

- **탭/재생 조작 불가**: macOS 접근성 권한이 없어 시뮬레이터에 키·클릭 주입 거부됨(`osascript not allowed`). "플레이어 빠릿함"·실재생·카운트인 체감은 직접 못 눌렀고, HTTP 실험+코드 검증으로 대체. → 시스템 설정 > 개인정보 보호 > 손쉬운 사용에서 터미널에 권한을 주면 자동 조작 검증 가능.
- 일부 코드 감사 차원(오디오/네트워크/레이아웃/스토리지/보안/수명주기)은 세션 한도로 에이전트가 끊겨 **인라인 재검증으로 보완**했음 — 핵심 항목은 전부 실물 확인 기반.
- 시뮬레이터는 무음 스위치·전화 인터럽트·실기기 성능을 재현하지 못함 → #4·#5·#7은 실기기 확인 필요.

## 권장 우선순위

1. **#1 백엔드 CORS** — 이것 없이는 iOS 앱이 성립 안 함 (백엔드 한 줄)
2. **#3 Info.plist 권한 문자열** — 크래시 + 심사 리젝 (plist 두 줄)
3. **#4 AVAudioSession(.playback)** — 연주 앱의 기본기 (AppDelegate 몇 줄)
4. **#2 시크릿 분리 + Anthropic 키 회전** — 보안 (구조 작업)
5. #6 다운로드 → 공유 시트, #7 AudioContext 통합, #9 StatusBar/Splash, #8 ATS 제거, #10 수명주기, #12 프로세스 체크리스트
