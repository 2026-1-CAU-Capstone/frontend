import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jazzify.app',
  appName: 'Jazzify',
  webDir: 'dist',
  ios: {
    /* WebView가 인라인 비디오(YouTube iframe 포함)를 풀스크린 강제 없이
     * 재생할 수 있게 함. iOS는 기본적으로 모바일 비디오를 풀스크린으로
     * 띄우는데, 우리는 릭 카드 안에 임베드해서 보여주므로 inline 필수. */
    allowsInlineMediaPlayback: true,

    /* WebView를 안전영역 가장자리까지 확장 (notch / Dynamic Island 영역까지).
     * GlobalStyle에서 정의한 --safe-* 변수가 정상 동작하려면 이 값이 'never'
     * 여야 함 (기본 'always'면 시스템이 자동 inset 적용해서 두 번 들여짐). */
    contentInset: 'never',

    /* 키보드가 떴을 때 입력창이 가려지지 않도록 WebView를 위로 스크롤 */
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      /* 'none' = 키보드가 떠도 WebView 사이즈/스크롤 안 건드림. 그래야 인트로
       *  레이아웃이 키보드 때문에 위로 밀려 올라가지 않고 화면 중앙에 그대로
       *  머문다 (Claude / ChatGPT 패턴). 키보드 위에 가려지는 영역은 자체
       *  CSS (env(keyboard-inset-height)) 로 보정 가능. */
      resize: 'none',
    },
  },
  /* ── ⚠️ 라이브 리로드 모드 (현재 활성) — "Expo Go 식" 개발 ─────────────
   * WebView가 dist/ 번들 대신 Mac 의 Vite dev 서버를 직접 로드한다.
   * 최초 1회만 Xcode 로 기기에 설치하면, 이후엔 파일 저장 즉시 기기에서
   * HMR 반영 (재빌드·재설치 불필요).
   *
   * 조건: `npm run dev` 실행 중(host:true)
   * - cleartext: true 가 있어야 iOS WebView가 http:// 로드 허용 (ATS 우회)
   *
   * ⚠️ iOS 시뮬레이터는 Mac과 네트워크를 공유하므로 localhost 사용 (실기기는
   *    LAN IP 필요 — `ipconfig getifaddr en0`). localhost:5173 은 백엔드
   *    CORS 허용 목록에 있지만 LAN IP는 없어서 192.168.x.x 로 두면 로그인 시
   *    403 Invalid CORS request 가 난다.
   *
   * ⚠️ 배포(앱스토어/TestFlight) 빌드 전 반드시 이 블록을 다시 주석 처리!
   *    (주석 처리 = 번들 모드: cap sync 로 복사된 dist/ 를 독립 실행.
   *    단, capacitor://localhost 오리진도 아직 백엔드 CORS 허용 목록에
   *    없어서 지금은 번들 모드에서도 로그인이 막힌다 — 백엔드 조치 필요)
   */
  server: {
    url: 'http://localhost:5173',
    cleartext: true,
  },
};

export default config;
