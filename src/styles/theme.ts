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
    border: '#EEEEEE',
    textPrimary: '#1A1A1A',
    textSecondary: '#888888',
  },
  fonts: {
    ui: "'Pretendard', 'DM Sans', -apple-system, sans-serif",
    chord: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
  },
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.06)',
    md: '0 4px 12px rgba(0,0,0,0.08)',
    xl: '0 16px 48px rgba(0,0,0,0.12)',
  },
} as const;

export type Theme = typeof theme;
