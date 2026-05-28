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
    /* macOS fsevents가 가끔 멈춰서 파일 변경 감지를 놓치는 경우가 있음
     * (특히 dev server를 오래 띄워두거나 watch 한도가 차면). polling으로
     * fallback 시키면 어떤 환경에서도 변경이 잡힘. interval 300ms는 체감
     * 즉시 반영 + CPU 부담 미미한 균형값. */
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  optimizeDeps: {
    include: ['smplr'],
  },
})
