import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { theme } from './styles/theme';
import { GlobalStyle } from './styles/global';
import App from './App';
import { warmupPlayerAssets } from './lib/note/playerWarmup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// 페이지 로드 직후 idle 시간에 player 자산 HTTP 캐시 적재.
// 사용자가 재생 클릭할 즈음엔 soundfont + drum 샘플이 모두 캐시에 있어
// 플레이어 preload() 가 거의 즉시 끝남 → 첫 재생 카운트인 끝 대기 사라짐.
const kick = () => warmupPlayerAssets();
if ('requestIdleCallback' in window) {
  (window as Window & typeof globalThis).requestIdleCallback(kick, { timeout: 2000 });
} else {
  setTimeout(kick, 200);
}
