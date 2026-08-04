/**
 * SMuFL 글리프 — 악보 기호의 **단일 소스**.
 *
 * 팔레트·툴바 버튼의 기호는 유니코드 잡문자(♯ ⊓ ✱ …)나 손으로 그린 SVG 가
 * 아니라 **Bravura**(SMuFL 표준 음악 폰트, `public/bravura.woff2`)의 정식
 * 코드포인트를 쓴다. 그래야 실제 악보에 찍히는 모양과 정확히 같고, 버튼마다
 * 크기·굵기가 제각각이 되지 않는다.
 *
 * ⚠ 코드포인트는 SMuFL 표준(https://w3c.github.io/smufl/)이라 폰트를 바꿔도
 * 유효하다. 아래 값은 실제 bravura.woff2 cmap 으로 존재를 검증했다.
 *
 * 렌더는 `<Smufl glyph="..." />`(components/common/Smufl.tsx) 하나만 쓴다.
 */

export const SMUFL = {
  /* ── 임시표 ── */
  flat: 0xe260,
  natural: 0xe261,
  sharp: 0xe262,
  doubleSharp: 0xe263,
  doubleFlat: 0xe264,

  /* ── 아티큘레이션 (위 방향 기준) ── */
  accent: 0xe4a0,
  staccato: 0xe4a2,
  tenuto: 0xe4a4,
  staccatissimo: 0xe4a6,
  marcato: 0xe4ac,
  tenutoStaccato: 0xe4b2,
  fermata: 0xe4c0,

  /* ── 현악/기타 주법 ── */
  downBow: 0xe610,
  upBow: 0xe612,
  harmonic: 0xe614,
  snapPizzicato: 0xe631,
  lhPizzicato: 0xe633,

  /* ── 장식음 ── */
  trill: 0xe566,
  mordent: 0xe56c,
  turn: 0xe567,
  turnInverted: 0xe568,
  tremolo1: 0xe220,
  tremolo3: 0xe222,

  /* ── 음자리표 ── */
  gClef: 0xe050,
  gClef8vb: 0xe052,
  gClef15ma: 0xe053,
  fClef: 0xe062,
  cClef: 0xe05c,
  percussionClef: 0xe069,

  /* ── 반복·내비게이션 ── */
  segno: 0xe047,
  coda: 0xe048,
  repeatLeft: 0xe040,
  repeatRight: 0xe041,
  repeat1Bar: 0xe500,

  /* ── 세로줄 ── */
  barlineSingle: 0xe030,
  barlineDouble: 0xe031,
  barlineFinal: 0xe032,

  /* ── 건반 ── */
  pedalPed: 0xe650,
  pedalUp: 0xe655,

  /* ── 음표·쉼표(툴바 길이 버튼) ── */
  noteWhole: 0xe1d2,
  noteHalfUp: 0xe1d3,
  noteQuarterUp: 0xe1d5,
  note8thUp: 0xe1d7,
  note16thUp: 0xe1d9,
  note32ndUp: 0xe1db,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  rest16th: 0xe4e7,
  augmentationDot: 0xe1e7,

  /* ── 기타(버튼 전용) ── */
  chordSymbolMaj: 0xe873,
  arrowUp: 0xeb60,
  arrowDown: 0xeb64,

  /* ── 노트헤드 ── */
  noteheadBlack: 0xe0a4,
  noteheadX: 0xe0a9,

  /* ── 재즈 관용 주법 ── */
  scoop: 0xe5d0,
  fall: 0xe5d7,

  /* ── 옥타브 ── */
  ottavaAlta: 0xe511,      // 8va
  quindicesimaAlta: 0xe514, // 15ma

  /* ── 박자표 ── */
  timeSigCommon: 0xe08a,
  timeSigCutCommon: 0xe08b,

  /* ── 셈여림 문자(조합해서 pp·mf·sfz … 를 만든다) ── */
  dynP: 0xe520,
  dynM: 0xe521,
  dynF: 0xe522,
  dynR: 0xe523,
  dynS: 0xe524,
  dynZ: 0xe525,
} as const;

export type SmuflGlyph = keyof typeof SMUFL;

/** 글리프 이름 → 실제 문자열. */
export function smuflChar(g: SmuflGlyph): string {
  return String.fromCodePoint(SMUFL[g]);
}

/** 셈여림 문자열(pp·sfz·rfz…) → Bravura 조합 글리프.
 *  SMuFL 은 셈여림 각 글자를 별도 글리프로 제공한다 — 이어붙이면 정식 표기가 된다. */
export function dynamicToSmufl(text: string): string {
  const MAP: Record<string, number> = {
    p: SMUFL.dynP, m: SMUFL.dynM, f: SMUFL.dynF,
    r: SMUFL.dynR, s: SMUFL.dynS, z: SMUFL.dynZ,
  };
  return [...text.toLowerCase()]
    .map((c) => (MAP[c] ? String.fromCodePoint(MAP[c]) : c))
    .join('');
}

/* ─── 광학 보정표 ───────────────────────────────────────────────────────
 * SMuFL 글리프는 원래 크기가 제각각이다(스타카토 점 84 유닛 vs 코다 1056 —
 * 12배 차이). 버튼에 같은 font-size 로 찍으면 어떤 건 점만 보이고 어떤 건
 * 넘쳐난다. 아래 표는 **실제 폰트 외곽선을 측정해 생성**했다:
 *   [0] 크기 배수 — 높이대별 목표(작은 표기 300 · 중간 520 · 큰 기호 700 유닛)로 정규화
 *   [1] 세로 중심(em 비율) — baseline 기준 글리프 중심. 버튼 정중앙에 놓는 데 쓴다.
 * 폰트를 바꾸면 scripts 없이 fontTools 로 다시 뽑는다(대화 기록 참조). */
export const GLYPH_FIT: Partial<Record<SmuflGlyph, [scale: number, center: number]>> = {
  flat: [1.14, 0.132],
  natural: [1.04, 0.003],
  sharp: [1.0, 0.001],
  doubleSharp: [1.19, 0.001],
  doubleFlat: [1.14, 0.131],
  accent: [1.23, 0.123],
  staccato: [2.2, 0.042],
  tenuto: [1.23, 0.024],
  staccatissimo: [1.76, 0.145],
  marcato: [1.18, 0.126],
  tenutoStaccato: [1.23, 0.12],
  fermata: [1.2, 0.164],
  downBow: [1.64, 0.159],
  upBow: [1.05, 0.248],
  harmonic: [1.5, 0.1],
  snapPizzicato: [1.73, 0.15],
  lhPizzicato: [1.91, 0.136],
  trill: [1.3, 0.19],
  mordent: [0.57, 0.122],
  turn: [0.91, 0.109],
  turnInverted: [0.91, 0.109],
  tremolo1: [1.39, 0.001],
  tremolo3: [0.93, -0.001],
  gClef: [0.4, 0.22],
  gClef8vb: [0.4, 0.11],
  gClef15ma: [0.4, 0.331],
  fClef: [0.78, -0.186],
  cClef: [0.69, 0.0],
  percussionClef: [1.04, 0.0],
  segno: [0.89, 0.366],
  coda: [0.66, 0.37],
  repeatLeft: [0.7, 0.5],
  repeatRight: [0.7, 0.5],
  repeat1Bar: [0.98, 0.015],
  barlineSingle: [0.7, 0.5],
  barlineDouble: [0.7, 0.5],
  barlineFinal: [0.7, 0.5],
  pedalPed: [0.71, 0.274],
  pedalUp: [1.16, 0.225],
  noteWhole: [1.57, -0.001],
  noteHalfUp: [0.69, 0.365],
  noteQuarterUp: [0.69, 0.367],
  note8thUp: [0.69, 0.367],
  note16thUp: [0.69, 0.367],
  note32ndUp: [0.6, 0.443],
  restWhole: [1.48, -0.063],
  restHalf: [1.48, 0.07],
  restQuarter: [0.94, -0.001],
  rest8th: [1.22, -0.038],
  rest16th: [1.03, -0.161],
  augmentationDot: [2.2, 0.0],
  noteheadBlack: [1.2, 0.0],
  noteheadX: [1.2, 0.0],
  chordSymbolMaj: [1.09, 0.239],
  arrowUp: [0.99, 0.264],
  arrowDown: [0.99, 0.264],
  scoop: [1.35, -0.18],
  fall: [1.34, -0.151],
  ottavaAlta: [0.82, 0.227],
  quindicesimaAlta: [1.08, 0.226],
  timeSigCommon: [1.04, 0.001],
  timeSigCutCommon: [0.97, 0.001],
  dynP: [1.25, 0.066],
  dynM: [1.55, 0.132],
  dynF: [0.87, 0.146],
  dynR: [1.9, 0.137],
  dynS: [1.84, 0.132],
  dynZ: [1.87, 0.129],
};

/** 글리프의 광학 보정값 — 표에 없으면 기본(배수 1, 중심 0.25). */
export function glyphFit(g: SmuflGlyph): [number, number] {
  return GLYPH_FIT[g] ?? [1, 0.25];
}
