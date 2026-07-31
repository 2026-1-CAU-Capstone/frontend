export const BP = {
  mobile: 600,
  tablet: 960,
  desktop: 1280,
} as const;

/** Media query helpers — usage: ${mq.mobile} { ... }
 *
 *   phone         — phones only (≤ BP.mobile). Excludes every iPad, including
 *                   iPad mini portrait (744pt). Use this for "swap to a
 *                   bottom-tab-bar / hamburger style" rules so iPad portrait
 *                   keeps the desktop layout instead of inheriting a phone UI.
 *   mobile        — phones + iPad portrait (≤ BP.tablet, 960). Historical
 *                   "small device" bucket; consider migrating to `phone` for
 *                   anything that should not apply to iPad portrait.
 *   compactLayout — anything with limited screen real-estate OR touch input
 *                   (narrow web, all iPads, hybrid laptops). Used for
 *                   "hide secondary panels / pad less" rules.
 *   desktop       — large mouse-driven displays (≥ BP.desktop + 1, 1281). */
export const mq = {
  phone: `@media (max-width: ${BP.mobile}px)`,
  mobile: `@media (max-width: ${BP.tablet}px)`,
  tablet: `@media (max-width: ${BP.tablet}px)`,
  compactLayout: `@media (max-width: ${BP.desktop}px), (hover: none), (pointer: coarse)`,
  desktop: `@media (min-width: ${BP.desktop + 1}px)`,
} as const;

export const theme = {
  colors: {
    // 브랜드
    gold: '#D4A843',
    goldDark: '#B8860B',

    // 기능별
    tonic: '#2D8F5E',
    subdominant: '#7B5EA7',
    dominant: '#C45C5C',

    // 하이라이트
    highlightIiVI: 'rgba(45, 143, 94, 0.15)',
    highlightSecDom: 'rgba(196, 92, 92, 0.12)',
    highlightModal: 'rgba(123, 94, 167, 0.12)',
    highlightSelected: 'rgba(212, 168, 67, 0.25)',

    // UI
    bgPrimary: '#FFFFFF',
    bgSecondary: '#FAFAFA',

    /* ── 페이지 배경 규칙 (2026-07-29 확정) ──────────────────────────────
     * 모든 페이지는 **맨 위 바 하나만** 연한 회색(barTop)이고,
     * 그 아래는 툴바·탭·본문 할 것 없이 **전부 흰색(barBelow)** 이다.
     * 새 페이지·새 바를 만들 때도 이 두 토큰만 쓴다 — 임의의 #fcfcfc /
     * #fafafa 를 직접 적지 말 것. */
    /** 페이지 최상단 바 배경. */
    barTop: '#F3F2EF',
    /** 최상단 바 아래 모든 영역(툴바·탭·본문). */
    barBelow: '#FFFFFF',
    /** Warm soft gray used as the chat surface across HomePage / Chord / Note. */
    bgChat: '#F1F0EC',
    border: '#EEEEEE',
    textPrimary: '#1A1A1A',
    textSecondary: '#888888',
  },
  fonts: {
    ui: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
    chord: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
  },
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.06)',
    md: '0 4px 12px rgba(0,0,0,0.08)',
    xl: '0 16px 48px rgba(0,0,0,0.12)',
  },
  /* 전역 레이어 z-index 단일 스케일 (§8 9-3). 숫자는 기존 산재 값과 동일하게
   * 유지해 시각 변화 없이 의미만 부여 — 신규 레이어는 반드시 이 토큰을 쓸 것.
   * (컴포넌트 내부 스태킹용 0~650은 지역 맥락이라 토큰화 대상이 아님)
   * 이미 발생했던 충돌(검색모달 vs 채팅오버레이 동값 1200)의 재발 방지 장치. */
  zIndex: {
    /** 차트 위 부유 요소 — 채팅 FAB 버튼, 인라인 릭 클로즈 등 */
    floating: 900,
    /** 표준 모달/사이드바 레이어 */
    modal: 1000,
    /** 모달 위 모달 — 설정, 세션 픽커, 삭제 확인 */
    modalHigh: 1100,
    /** 풀스크린 오버레이 — 모바일 채팅, 네이티브 플레이어 */
    overlay: 1200,
    /** 오버레이 위 최상위 팝업 — Cmd+K 검색, 코드 팝업 */
    popover: 1300,
    /** 토스트/피드백 */
    toast: 2000,
    /** 인트로 스플래시·앱 프리뷰 — 모든 것 위 */
    max: 9999,
  },
} as const;

export type Theme = typeof theme;
