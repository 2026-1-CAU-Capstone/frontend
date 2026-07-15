import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    /* host:true → 0.0.0.0 바인딩 (LAN/Tailscale 등 외부 인터페이스 노출).
     * iOS 디바이스의 Capacitor WebView가 capacitor.config.ts 의 dev url로
     * 접속할 수 있게 필요. localhost-only 면 WebView 는 흰 화면이 됨. */
    host: true,
    /* data/ 는 frontend/ 밖의 repo 루트에 있고 frontend/data 심링크로 참조된다.
     * noteSongs.ts 의 import.meta.glob('../../data/...') 가 심링크를 따라
     * 실제 경로(<repo>/data/…)로 resolve 되는데, 기본 fs.allow 는 Vite 루트
     * (frontend/)로 제한돼 있어 /@fs/<repo>/data/… 요청이 403 → "Failed to
     * fetch dynamically imported module" 가 났다. 상위(repo 루트)를 허용해
     * data/ 하위 에셋(mid/xml/mxl)을 dev 서버가 서빙하게 한다. */
    fs: {
      allow: ['..'],
    },
    /* macOS fsevents가 가끔 멈춰서 파일 변경 감지를 놓치는 경우가 있음
     * (특히 dev server를 오래 띄워두거나 watch 한도가 차면). polling으로
     * fallback 시키면 어떤 환경에서도 변경이 잡힘. interval 300ms는 체감
     * 즉시 반영 + CPU 부담 미미한 균형값. */
    watch: {
      usePolling: true,
      interval: 300,
    },
    /* dev-proxy: 프론트가 /api 상대경로로 요청하면 여기서 백엔드로 중계한다.
     * 브라우저 입장에선 same-origin(first-party) 요청이라 RefreshToken
     * HTTP-only 쿠키가 차단 없이 저장·전송된다. (cross-site 였다면 서드파티
     * 쿠키로 막혀 refresh 가 실패했음)
     *   - changeOrigin: Host 헤더를 target 으로 바꿔 백엔드 라우팅/TLS SNI 정상화
     *   - cookieDomainRewrite '': Set-Cookie 의 Domain 속성을 제거해 쿠키를
     *     현재 dev 호스트(localhost)에 바인딩 */
    proxy: {
      '/api': {
        target: 'https://jazzify.p-e.kr',
        changeOrigin: true,
        cookieDomainRewrite: '',
      },
    },
  },
  optimizeDeps: {
    include: ['smplr'],
  },
})
