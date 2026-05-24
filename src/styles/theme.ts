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
} as const;

export type Theme = typeof theme;
