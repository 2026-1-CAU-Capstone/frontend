import type { SongData } from './types';

export const autumnLeaves: SongData = {
  id: 'autumn-leaves',
  title: 'Autumn Leaves',
  key: 'Gm',
  scoreImages: {
    1: '/scores/autumn leaves-gm.png',
  },
  toc: [
    { title: 'Autumn Leaves', page: 1 },
  ],
  groupExplanations: {
    1: 'Cm7(ii) → F7(V) → BbM7(I) — Bb 메이저의 ii-V-I 진행. Autumn Leaves는 이 밝은 메이저 진행과 뒤따르는 마이너 iiø-V-i의 교차로 이루어져 있으며, 이것이 곡의 핵심 화성 구조입니다.',
    2: 'Am7b5(iiø) → D7(V) → Gm(i) — Gm 마이너의 iiø-V-i 진행. Half-diminished 코드(Am7b5)가 서브도미넌트 역할을 하며, 직전 밝은 ii-V-I 이후 쓸쓸한 마이너로 전환됩니다.',
    3: 'Cm7(ii) → F7(V) → BbM7(I) — 두 번째 A 섹션의 ii-V-I. 동일한 화성 패턴이 새로운 가사와 함께 반복됩니다.',
    4: 'Am7b5(iiø) → D7(V) → Gm(i) — 두 번째 iiø-V-i 종지. Gm 해결 후 Cm으로 연결되어 브릿지를 준비합니다.',
    5: 'Am7b5(iiø) → D7(V) → Gm(i) — 브릿지(B 섹션)의 iiø-V-i. A 섹션과 달리 마이너 진행이 먼저 등장하여 곡의 구조를 전환합니다.',
    6: 'Cm7(ii) → F7(V) → BbM7(I) — 브릿지 후반의 ii-V-I. Gm에서 잠시 Bb 메이저의 밝은 사운드로 돌아갑니다.',
    7: 'Am7b5(iiø) → D7(V) → Gm(i) — 마지막 A 섹션의 iiø-V-i. 곡의 마무리를 향한 핵심 진행입니다.',
    8: 'Fm7(ii) → Bb7(V) → EbM7(I) — Eb 메이저로의 일시적 전조! 엔딩에서 ii-V-I 패턴이 Bb가 아닌 Eb에서 나타나며 새로운 색채를 더합니다.',
    9: 'Am7b5(iiø) → D7b5(V) → Gm(i) — 곡의 최종 종지. D7에 b5(altered dominant)를 추가하여 더 풍부한 긴장감을 만들고, Gm 토닉으로 해결됩니다.',
  },
  chords: [
    // ═══════════════════════════════════════════════════════
    // System 1 — A section, bars 1-4: ii-V-I in Bb (Group 1)
    // y=0.049 (box just below chord text at y≈0.041)
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-1', symbol: 'Cm7', bar: 1, pageNumber: 1,
      position: { x: 0.160, y: 0.049, width: 0.065, height: 0.035 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true, group: { id: 1, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-2', symbol: 'F7', bar: 3, pageNumber: 1,
      position: { x: 0.388, y: 0.049, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 1, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-3', symbol: 'BbM7', bar: 4, pageNumber: 1,
      position: { x: 0.691, y: 0.049, width: 0.065, height: 0.035 },
      analysis: { degree: 'I', func: 'T', diatonic: true, group: { id: 1, type: 'ii-V-I', role: 'I' } },
    },

    // ═══════════════════════════════════════════════════════
    // System 2 — bars 5-8: IV → iiø-V-i in Gm (Group 2)
    // y=0.159
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-4', symbol: 'EbM7', bar: 5, pageNumber: 1,
      position: { x: 0.068, y: 0.159, width: 0.065, height: 0.035 },
      analysis: { degree: 'IV', func: 'SD', diatonic: true },
    },
    {
      id: 'al-5', symbol: 'Am7b5', bar: 6, pageNumber: 1,
      position: { x: 0.326, y: 0.159, width: 0.075, height: 0.035 },
      analysis: { degree: 'iiø', func: 'SD', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-6', symbol: 'D7', bar: 7, pageNumber: 1,
      position: { x: 0.539, y: 0.159, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-7', symbol: 'Gm', bar: 8, pageNumber: 1,
      position: { x: 0.799, y: 0.159, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'I' } },
    },

    // ═══════════════════════════════════════════════════════
    // System 3 — A repeat, bars 9-12: ii-V-I in Bb (Group 3)
    // y=0.270
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-8', symbol: 'Cm7', bar: 9, pageNumber: 1,
      position: { x: 0.160, y: 0.270, width: 0.065, height: 0.035 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true, group: { id: 3, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-9', symbol: 'F7', bar: 11, pageNumber: 1,
      position: { x: 0.433, y: 0.270, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 3, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-10', symbol: 'BbM7', bar: 12, pageNumber: 1,
      position: { x: 0.708, y: 0.270, width: 0.065, height: 0.035 },
      analysis: { degree: 'I', func: 'T', diatonic: true, group: { id: 3, type: 'ii-V-I', role: 'I' } },
    },

    // ═══════════════════════════════════════════════════════
    // System 4 — bars 13-16: IV → iiø-V-i (Group 4) → Cm
    // y=0.381
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-11', symbol: 'EbM7', bar: 13, pageNumber: 1,
      position: { x: 0.068, y: 0.381, width: 0.065, height: 0.035 },
      analysis: { degree: 'IV', func: 'SD', diatonic: true },
    },
    {
      id: 'al-12', symbol: 'Am7b5', bar: 14, pageNumber: 1,
      position: { x: 0.308, y: 0.381, width: 0.075, height: 0.035 },
      analysis: { degree: 'iiø', func: 'SD', diatonic: true, group: { id: 4, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-13', symbol: 'D7', bar: 15, pageNumber: 1,
      position: { x: 0.518, y: 0.381, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 4, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-14', symbol: 'Gm', bar: 16, pageNumber: 1,
      position: { x: 0.683, y: 0.381, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true, group: { id: 4, type: 'ii-V-I', role: 'I' } },
    },
    {
      id: 'al-15', symbol: 'Cm', bar: 16.5, pageNumber: 1,
      position: { x: 0.803, y: 0.381, width: 0.055, height: 0.035 },
      analysis: { degree: 'iv', func: 'SD', diatonic: true },
    },

    // ═══════════════════════════════════════════════════════
    // System 5 — Bridge, bars 17-20: Gm → iiø-V-i (Group 5)
    // y=0.491
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-16', symbol: 'Gm', bar: 17, pageNumber: 1,
      position: { x: 0.038, y: 0.491, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true },
    },
    {
      id: 'al-17', symbol: 'Am7b5', bar: 18, pageNumber: 1,
      position: { x: 0.263, y: 0.491, width: 0.075, height: 0.035 },
      analysis: { degree: 'iiø', func: 'SD', diatonic: true, group: { id: 5, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-18', symbol: 'D7', bar: 19, pageNumber: 1,
      position: { x: 0.503, y: 0.491, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 5, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-19', symbol: 'Gm', bar: 20, pageNumber: 1,
      position: { x: 0.783, y: 0.491, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true, group: { id: 5, type: 'ii-V-I', role: 'I' } },
    },

    // ═══════════════════════════════════════════════════════
    // System 6 — Bridge cont., bars 21-24: ii-V-I in Bb (Group 6)
    // y=0.602
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-20', symbol: 'Cm7', bar: 21, pageNumber: 1,
      position: { x: 0.198, y: 0.602, width: 0.065, height: 0.035 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true, group: { id: 6, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-21', symbol: 'F7', bar: 22, pageNumber: 1,
      position: { x: 0.463, y: 0.602, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 6, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-22', symbol: 'BbM7', bar: 23, pageNumber: 1,
      position: { x: 0.718, y: 0.602, width: 0.065, height: 0.035 },
      analysis: { degree: 'I', func: 'T', diatonic: true, group: { id: 6, type: 'ii-V-I', role: 'I' } },
    },

    // ═══════════════════════════════════════════════════════
    // System 7 — Last A, bars 25-28: IV → iiø-V-i (Group 7) → C9
    // y=0.713
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-23', symbol: 'EbM7', bar: 25, pageNumber: 1,
      position: { x: 0.068, y: 0.713, width: 0.065, height: 0.035 },
      analysis: { degree: 'IV', func: 'SD', diatonic: true },
    },
    {
      id: 'al-24', symbol: 'Am7b5', bar: 26, pageNumber: 1,
      position: { x: 0.273, y: 0.713, width: 0.075, height: 0.035 },
      analysis: { degree: 'iiø', func: 'SD', diatonic: true, group: { id: 7, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-25', symbol: 'D7', bar: 27, pageNumber: 1,
      position: { x: 0.503, y: 0.713, width: 0.055, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 7, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-26', symbol: 'Gm', bar: 28, pageNumber: 1,
      position: { x: 0.673, y: 0.713, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true, group: { id: 7, type: 'ii-V-I', role: 'I' } },
    },
    {
      id: 'al-27', symbol: 'C9(D7/F#)', bar: 28.5, pageNumber: 1,
      position: { x: 0.823, y: 0.713, width: 0.095, height: 0.035 },
      analysis: { degree: 'V/V', func: 'D', diatonic: false },
    },

    // ═══════════════════════════════════════════════════════
    // System 8 — Ending, bars 29-32: ii-V-I in Eb (Group 8) → final iiø-V-i (Group 9)
    // y=0.824
    // ═══════════════════════════════════════════════════════
    {
      id: 'al-28', symbol: 'Fm7', bar: 29, pageNumber: 1,
      position: { x: 0.058, y: 0.824, width: 0.065, height: 0.035 },
      analysis: { degree: 'ii/IV', func: 'SD', diatonic: false, group: { id: 8, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-29', symbol: 'Bb7', bar: 29.5, pageNumber: 1,
      position: { x: 0.163, y: 0.824, width: 0.065, height: 0.035 },
      analysis: { degree: 'V/IV', func: 'D', diatonic: false, group: { id: 8, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-30', symbol: 'EbM7', bar: 30, pageNumber: 1,
      position: { x: 0.298, y: 0.824, width: 0.065, height: 0.035 },
      analysis: { degree: 'IV', func: 'T', diatonic: true, group: { id: 8, type: 'ii-V-I', role: 'I' } },
    },
    {
      id: 'al-31', symbol: 'Am7b5', bar: 31, pageNumber: 1,
      position: { x: 0.433, y: 0.824, width: 0.075, height: 0.035 },
      analysis: { degree: 'iiø', func: 'SD', diatonic: true, group: { id: 9, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: 'al-32', symbol: 'D7b5', bar: 31.5, pageNumber: 1,
      position: { x: 0.553, y: 0.824, width: 0.065, height: 0.035 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 9, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: 'al-33', symbol: 'Gm', bar: 32, pageNumber: 1,
      position: { x: 0.713, y: 0.824, width: 0.055, height: 0.035 },
      analysis: { degree: 'i', func: 'T', diatonic: true, group: { id: 9, type: 'ii-V-I', role: 'I' } },
    },
    {
      id: 'al-34', symbol: '(G7)', bar: 32.5, pageNumber: 1,
      position: { x: 0.863, y: 0.824, width: 0.055, height: 0.035 },
      analysis: { degree: 'V/iv', func: 'D', diatonic: false },
    },
  ],
};
