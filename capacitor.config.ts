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
  server: {
    /* iOS는 ATS 정책상 http://를 차단하므로 백엔드 호출은 모두 https.
     * 개발 중에 로컬 dev 서버를 WebView에서 띄우고 싶으면 아래 url 설정:
     * - 192.168.0.12 = Mac의 WiFi LAN IP (iPad가 같은 WiFi에 있어야 함)
     *   Tailscale 경유로 쓰려면 → http://100.92.49.85:5173 (iPad에도 Tailscale 켜야 함)
     * - cleartext: true 가 있어야 iOS WebView가 http:// 로드 허용
     * 배포(앱스토어/TestFlight) 빌드 전엔 반드시 이 두 줄 다시 주석 처리 또는 삭제할 것. */
    url: 'http://192.168.0.12:5173',
    cleartext: true,
  },
};

export default config;
