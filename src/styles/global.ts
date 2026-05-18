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

  /* PDF / 인쇄 — SolosPage 의 PDF 버튼은 window.print() 를 호출하고,
   * 그 직전에 캡쳐 대상 엘리먼트에 .pdf-print-target 클래스를 붙인다.
   * 인쇄 시점에는 그 엘리먼트만 보이게 하고 나머지 UI 는 visibility:hidden
   * 으로 숨김. (display:none 으로 끊으면 부모 chain 이 함께 사라져
   * 레이아웃이 깨지므로 visibility 트릭을 쓴다.) */
  @media print {
    body { background: #ffffff; overflow: visible; }
    body * { visibility: hidden; }
    .pdf-print-target,
    .pdf-print-target * { visibility: visible; }
    .pdf-print-target {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: auto;
      overflow: visible;
      background: #ffffff;
    }
    @page { margin: 12mm; }
  }
`;
