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

  /* ── 악보 잉크(VexFlow) ─────────────────────────────────────────────
   * VexFlow 5 는 루트 <svg> 에 fill/stroke="black" 을 얹고 자식이 그걸 상속한다
   * (자식은 fill="none" 처럼 예외만 직접 지정한다). 그래서 **CSS 한 줄로 악보
   * 잉크 전체를 뒤집을 수 있다** — 렌더러 수십 곳을 고칠 필요가 없다.
   * 선택자는 VexFlow 가 항상 넣는 font-family(Bravura)로 잡는다.
   *
   * 속성이 아니라 CSS 라는 점이 중요하다: PDF 내보내기는 SVG 를 **직렬화**하므로
   * (scoreToPdf) 이 규칙이 따라가지 않는다 — 인쇄물은 계속 흰 종이·검은 잉크다. */
  ${({ theme }) => theme.mode === 'dark' && `
    svg[font-family*='Bravura'] {
      fill: ${theme.colors.textPrimary};
      stroke: ${theme.colors.textPrimary};
    }
    /* 덧줄(ledger line)은 VexFlow 가 #444 로 직접 칠한다 — 상속이 아니라서
     * 따로 뒤집어야 한다. 원래 본선보다 살짝 연하므로 보조 글자색을 쓴다. */
    svg[font-family*='Bravura'] [stroke='#444'] {
      stroke: ${theme.colors.textSecondary};
    }
  `}

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
    /* Scale the score SVG down to the printable page width while keeping its
     *  aspect ratio (the SVG carries a viewBox). Without this the native-px
     *  score overflows A4 and prints oversized / clipped. transform:none
     *  drops any on-screen fit-scale so the print math is clean. */
    .pdf-print-target svg {
      transform: none !important;
      width: 100% !important;
      height: auto !important;
      max-width: 100% !important;
    }
    .pdf-print-target > div {
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
    }
    /* 다크 모드로 인쇄하면 흰 잉크가 흰 종이에 찍혀 아무것도 안 나온다.
     * 화면 테마와 무관하게 인쇄는 검은 잉크로 못박는다. */
    .pdf-print-target svg[font-family*='Bravura'] {
      fill: #000000 !important;
      stroke: #000000 !important;
    }
    .pdf-print-target svg[font-family*='Bravura'] [stroke='#444'] {
      stroke: #444444 !important;
    }
    @page { margin: 12mm; }
  }
`;
