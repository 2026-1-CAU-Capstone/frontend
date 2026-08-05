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
  /** 라이트/다크 판별용 표시. 조건부 CSS(global.ts 악보 잉크 등)가 이걸 본다. */
  mode: 'light',
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
    /* ── 다크 모드 대응 의미 토큰 (2026-08-05) ────────────────────────
     * 컴포넌트에 하드코딩된 색을 이 토큰들로 옮긴다. 특히 hover/scrim 은
     * `rgba(0,0,0,…)` 로 박아두면 어두운 배경에서 아무것도 안 보인다. */
    /** 모달·메뉴처럼 배경 위에 떠 있는 면. */
    surface: '#FFFFFF',
    /** 그 위에 한 단계 더 얹히는 면(입력칸·코드블록 등). */
    surfaceSunken: '#F5F5F7',
    /** hover 시 덮는 옅은 막. */
    hover: 'rgba(0, 0, 0, 0.05)',
    /** 선택/활성 상태의 옅은 막. */
    activeFill: 'rgba(0, 0, 0, 0.06)',
    /** 모달 뒤를 덮는 어두운 막. */
    scrim: 'rgba(20, 20, 24, 0.45)',
    /** 파괴적 동작(삭제·로그아웃). */
    danger: '#C0392B',
    dangerBorder: '#E3B5B0',
    dangerFill: '#FDF3F2',
    /** 강조(링크·포커스). */
    accent: '#2F6FE0',

    /* 검은 알약 버튼(배경 #1a1a1a + 흰 글자) 짝. 배경만 밝히면 흰 글자가 사라지므로
     * 둘을 한 짝으로 뒤집는다 — 다크에서는 밝은 면 + 어두운 글자가 된다. */
    inkSurface: '#1a1a1a',
    /* 따뜻한 페이지 배경(로그인·네이티브 홈). 하드코딩 상수로 흩어져 있던 것을 모았다. */
    pageWarm: '#F5F1E9',
    /* 카드 hover 의 크림 틴트 — 내 코드 차트·내 악보 차트가 공유한다. */
    cardHover: '#FAF6E9',
    /* 본문보다 한 단 연한 잉크(코드 다이어그램 격자 등). */
    inkSoft: '#3A3A3A',
    onInk: '#FFFFFF',
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
    /** admin 도구 독 — 문자 그대로 **모든 것 위**. 어느 페이지의 모달·오버레이·
     *  재생 바(BackingPlayerBar 가 10000 을 직접 씀) 위에서도 열 수 있어야 한다. */
    adminDock: 12000,
  },
} as const;

/* 리터럴 타입을 문자열로 넓힌다 — 다크 테마(styles/darkTheme.ts)가 같은 토큰에
 * 다른 색 문자열을 담아야 하는데, `as const` 리터럴 그대로면 '#D4A843' 만 허용돼
 * 대입이 막힌다. 숫자(zIndex 등)는 그대로 둔다. */
type WidenStrings<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string
    : T[K] extends object ? WidenStrings<T[K]>
    : T[K];
};

/**
 * 옅은 틴트 배경 — 라이트 값은 **그대로 보존**하고 다크만 갈아끼운다.
 *
 * `#fdecea`(분홍 경고) · `#fff7e6`(골드 강조) · `#e9f1fb`(파랑 정보) 처럼 거의 흰
 * 틴트는 토큰 하나로 뭉갤 수 없다. 중립 회색으로 바꿔버리면 **라이트 모드에서**
 * 경고·정보의 색 신호가 사라진다(실제로 한 번 그렇게 만들었다가 되돌렸다).
 * 그래서 값을 두 개 받아 모드로 고른다.
 *
 *   background: ${tint('#fdecea', 'rgba(240, 113, 103, 0.13)')};
 */
export function tint(light: string, dark: string) {
  return ({ theme }: { theme: Theme }) => (theme.mode === 'dark' ? dark : light);
}

export type Theme = WidenStrings<typeof theme>;
