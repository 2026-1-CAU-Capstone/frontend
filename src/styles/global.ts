import { createGlobalStyle } from 'styled-components';
import { mq } from './theme';

export const GlobalStyle = createGlobalStyle`
  /* iOS safe-area: 컨테이너에서 env(safe-area-inset-*) 사용 가능하게 */
  :root {
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* iOS WebView: 가로 회전 시 글자 자동 확대 방지, 더블탭 줌 방지 */
  html {
    -webkit-text-size-adjust: 100%;
    touch-action: manipulation;
  }

  body {
    font-family: ${({ theme }) => theme.fonts.ui};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgPrimary};
    overflow: hidden;
    /* iOS rubber-band overscroll 방지 (피아노/악보 영역에서 의도치 않은 페이지 바운스) */
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;

    ${mq.mobile} {
      overflow: auto;
    }
  }
  #root {
    width: 100%;
    height: 100vh;
    height: 100dvh;
  }
`;
