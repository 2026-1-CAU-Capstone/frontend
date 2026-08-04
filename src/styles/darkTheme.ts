/* ─────────────────────────────────────────────────────────────────────────
 * darkTheme — 라이트 테마에서 **색만** 갈아끼운 다크 변형.
 *
 * 구조(fonts·zIndex·간격 등)는 라이트와 완전히 같아야 한다. 그래야 컴포넌트가
 * 테마를 바꿔도 레이아웃이 흔들리지 않는다. 그래서 spread 로 덮어쓴다.
 *
 * ⚠️ 알려진 한계: 앱의 색 중 상당수(약 78%)가 컴포넌트에 하드코딩돼 있어서
 * (hex 1713곳 · rgba 654곳 vs 토큰 668곳) 이 파일만으로는 화면 전체가 어두워
 * 지지 않는다. 토큰을 쓰는 곳부터 반응하고, 나머지는 하드코딩을 토큰으로 옮기는
 * 작업이 따라야 한다. 진행 상황은 기능명세서 참조.
 * ──────────────────────────────────────────────────────────────────────── */

import { theme } from './theme';

export const darkTheme = {
  ...theme,
  mode: 'dark',
  colors: {
    ...theme.colors,

    /* 브랜드 골드는 어두운 배경에서 탁해 보이므로 살짝 밝힌다. */
    gold: '#E0B858',
    goldDark: '#C79A3C',

    /* 기능색(화성 분석) — 어두운 배경에서 대비를 확보하려면 밝고 덜 탁해야 한다. */
    tonic: '#4CB782',
    subdominant: '#A588CC',
    dominant: '#E07A7A',

    /* 하이라이트는 어두운 면 위에 얹히므로 알파를 올린다. */
    highlightIiVI: 'rgba(76, 183, 130, 0.22)',
    highlightSecDom: 'rgba(224, 122, 122, 0.20)',
    highlightModal: 'rgba(165, 136, 204, 0.20)',
    highlightSelected: 'rgba(224, 184, 88, 0.30)',

    /* 면 — 순검정(#000)은 눈이 아프고 그림자가 안 보인다. 짙은 회색 계열로. */
    bgPrimary: '#1B1B1E',
    bgSecondary: '#212125',

    /* 페이지 배경 규칙(라이트와 같은 역할):
     *   barTop  = 맨 위 바 하나
     *   barBelow = 그 아래 전부 */
    barTop: '#171719',
    barBelow: '#1B1B1E',
    bgChat: '#202024',

    surface: '#26262B',
    surfaceSunken: '#2E2E34',
    /* 어두운 면 위에서는 흰색을 얹어야 밝아진다 — 검정 알파는 보이지 않는다. */
    hover: 'rgba(255, 255, 255, 0.07)',
    activeFill: 'rgba(255, 255, 255, 0.10)',
    scrim: 'rgba(0, 0, 0, 0.62)',
    danger: '#F07167',
    dangerBorder: 'rgba(240, 113, 103, 0.45)',
    dangerFill: 'rgba(240, 113, 103, 0.12)',
    accent: '#6BA4FF',

    /* 라이트의 검은 알약을 그대로 어둡게 두면 어두운 배경에 묻힌다 — 뒤집는다. */
    inkSurface: '#EDEDF0',
    pageWarm: '#1B1B1E',
    /* 어두운 면 위에서는 크림을 얹을 수 없다 — 골드 틴트를 옅게 깐다. */
    cardHover: 'rgba(224, 184, 88, 0.10)',
    inkSoft: '#D6D6DA',
    onInk: '#1B1B1E',

    border: 'rgba(255, 255, 255, 0.14)',
    textPrimary: '#ECECEE',
    textSecondary: '#9C9CA4',
  },
} as const;
