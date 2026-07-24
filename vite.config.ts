import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { exec } from 'node:child_process'
import { resolve } from 'node:path'

/* dev 전용: 서버가 준비되면 크롬(외부 브라우저)에서 자동으로 연다.
 * Vite의 `--open`/`BROWSER` 경로는 macOS + VSCode 통합 터미널에서 조용히
 * 실패(내부 Simple Browser로 빠지거나 아무것도 안 열림)하는 경우가 있어,
 * 확실한 `open -a "Google Chrome"` 로 직접 띄운다. 실제 리슨 포트를 읽으므로
 * 5173→5174 처럼 포트가 밀려도 맞는 URL을 연다. 프로세스당 1회만(재시작 시
 * 중복 탭 방지). build에는 영향 없음(apply:'serve'). */
function openInChrome(): Plugin {
  let opened = false
  return {
    name: 'open-in-chrome',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        if (opened) return
        opened = true
        const addr = server.httpServer!.address()
        const port = typeof addr === 'object' && addr ? addr.port : (server.config.server.port ?? 5173)
        exec(`open -a "Google Chrome" "http://localhost:${port}/"`, (err) => {
          if (err) server.config.logger.warn(`[open-in-chrome] ${err.message}`)
        })
      })
    },
  }
}

/* 지금 어느 백엔드에 붙어 있는지 부팅 로그에 찍는다. 운영/로컬 전환은 눈에
 * 안 보이는 설정이라, 띄워놓고 "왜 로컬 수정이 반영 안 되지" 로 헤매는 걸 막는다. */
function logApiTarget(target: string): Plugin {
  return {
    name: 'log-api-target',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const local = /localhost|127\.0\.0\.1/.test(target)
      server.httpServer?.once('listening', () => {
        server.config.logger.info(`  ➜  API 프록시:  /api → ${target}${local ? '  (로컬 백엔드)' : '  (운영 서버)'}`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  /* 백엔드 전환 스위치 — JAZZIFY_API_TARGET.
   *   미설정                  → 운영 서버 https://jazzify.p-e.kr  (기본값)
   *   http://localhost:8080  → IntelliJ 로 띄운 로컬 백엔드
   * repo 루트 `.env.local`(기존 JAZZIFY_* 관례)과 `frontend/.env.local` 을 모두
   * 읽고 frontend 쪽이 우선. 셸 환경변수도 그대로 반영된다.
   * ⚠️ 값은 호스트까지만 — `/api` 를 붙이지 말 것(경로는 프록시가 그대로 넘긴다). */
  const env = {
    ...loadEnv(mode, resolve(process.cwd(), '..'), ''),
    ...loadEnv(mode, process.cwd(), ''),
  }
  const apiTarget = env.JAZZIFY_API_TARGET || 'https://jazzify.p-e.kr'

  return {
    /* 현재 dev proxy 백엔드 대상을 클라이언트에 노출 (admin 전용 백엔드 배지용).
     * JAZZIFY_API_TARGET 은 VITE_ 접두사가 아니라 기본으론 번들에 안 실리므로
     * 여기서 명시적으로 주입한다. dev 서버 부팅 시점 값이 그대로 박힌다. */
    define: {
      'import.meta.env.VITE_API_TARGET': JSON.stringify(apiTarget),
    },
    plugins: [react(), openInChrome(), logApiTarget(apiTarget)],
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
       *     현재 dev 호스트(localhost)에 바인딩
       * ⚠️ rewrite 를 넣지 말 것 — 백엔드 context-path 가 `/api` 라 경로를 그대로
       *    넘겨야 `/api/v1/...` 에 맞는다. `/api` 를 떼면 전부 404. */
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          cookieDomainRewrite: '',
        },
      },
    },
    optimizeDeps: {
      include: ['smplr'],
    },
  }
})
