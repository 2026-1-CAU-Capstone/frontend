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
  },
  optimizeDeps: {
    include: ['smplr'],
  },
})
