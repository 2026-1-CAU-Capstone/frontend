import type { SongData } from './types';

export const allOfMe: SongData = {
  id: 'all-of-me',
  title: 'All Of Me',
  key: 'C Major',
  scoreImages: {
    1: '/scores/all-of-me-p1.png',
    // 2: '/scores/autumn-leaves-p1.png',  // 향후 추가
    // 3: '/scores/blue-bossa-p1.png',
  },
  toc: [
    { title: 'All Of Me', page: 1 },
    { title: 'Autumn Leaves', page: 2 },
    { title: 'Blue Bossa', page: 3 },
  ],
  groupExplanations: {
    1: 'Dm7(ii) → G7(V)의 incomplete ii-V 진행입니다. A 섹션 마지막에서 B 섹션으로 넘어가면서 I(Cmaj7)로의 해결이 지연됩니다. 앞의 D7(V/V)이 이 ii-V를 준비하는 역할을 합니다.',
    2: 'Dm7(ii) → G7(V) → C6(I)의 완전한 ii-V-I 종지입니다. 곡의 마지막에서 tonic으로 확실하게 돌아오며, 전체 조성을 확립하는 핵심 순간입니다.',
  },
  chords: [
    // A Section (bars 1-8)
    {
      id: '1', symbol: 'C6', bar: 1, pageNumber: 1,
      position: { x: 0.12, y: 0.13, width: 0.18, height: 0.08 },
      analysis: { degree: 'I', func: 'T', diatonic: true },
    },
    {
      id: '2', symbol: 'E7', bar: 3, pageNumber: 1,
      position: { x: 0.52, y: 0.13, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/vi', func: 'D', diatonic: false, secDom: 'vi' },
    },
    {
      id: '3', symbol: 'A7', bar: 5, pageNumber: 1,
      position: { x: 0.12, y: 0.24, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/ii', func: 'D', diatonic: false, secDom: 'ii' },
    },
    {
      id: '4', symbol: 'Dm7', bar: 7, pageNumber: 1,
      position: { x: 0.52, y: 0.24, width: 0.18, height: 0.08 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true },
    },
    {
      id: '5', symbol: 'E7', bar: 9, pageNumber: 1,
      position: { x: 0.12, y: 0.34, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/vi', func: 'D', diatonic: false, secDom: 'vi' },
    },
    {
      id: '6', symbol: 'Am7', bar: 11, pageNumber: 1,
      position: { x: 0.52, y: 0.34, width: 0.18, height: 0.08 },
      analysis: { degree: 'vi', func: 'T', diatonic: true },
    },
    {
      id: '7', symbol: 'D7', bar: 13, pageNumber: 1,
      position: { x: 0.12, y: 0.44, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/V', func: 'D', diatonic: false, secDom: 'V' },
    },
    {
      id: '8', symbol: 'Dm7', bar: 15, pageNumber: 1,
      position: { x: 0.52, y: 0.44, width: 0.12, height: 0.08 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true, group: { id: 1, type: 'incomplete', role: 'ii' } },
    },
    {
      id: '9', symbol: 'G7', bar: 15.5, pageNumber: 1,
      position: { x: 0.65, y: 0.44, width: 0.12, height: 0.08 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 1, type: 'incomplete', role: 'V' } },
    },

    // B Section (bars 17-24)
    {
      id: '10', symbol: 'Bb6', bar: 17, pageNumber: 1,
      position: { x: 0.12, y: 0.55, width: 0.08, height: 0.08 },
      analysis: { degree: 'bVII', func: 'SD', diatonic: false, modal: 'mixolydian' },
    },
    {
      id: '11', symbol: 'C6', bar: 17.5, pageNumber: 1,
      position: { x: 0.22, y: 0.55, width: 0.08, height: 0.08 },
      analysis: { degree: 'I', func: 'T', diatonic: true },
    },
    {
      id: '12', symbol: 'E7', bar: 19, pageNumber: 1,
      position: { x: 0.52, y: 0.55, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/vi', func: 'D', diatonic: false, secDom: 'vi' },
    },
    {
      id: '13', symbol: 'A7', bar: 21, pageNumber: 1,
      position: { x: 0.12, y: 0.66, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/ii', func: 'D', diatonic: false, secDom: 'ii' },
    },
    {
      id: '14', symbol: 'Dm7', bar: 23, pageNumber: 1,
      position: { x: 0.52, y: 0.66, width: 0.18, height: 0.08 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true },
    },
    {
      id: '15', symbol: 'F6', bar: 25, pageNumber: 1,
      position: { x: 0.12, y: 0.76, width: 0.08, height: 0.08 },
      analysis: { degree: 'IV', func: 'SD', diatonic: true },
    },
    {
      id: '16', symbol: 'Fm6', bar: 25.5, pageNumber: 1,
      position: { x: 0.22, y: 0.76, width: 0.08, height: 0.08 },
      analysis: { degree: 'iv', func: 'SD', diatonic: false, modal: 'aeolian' },
    },
    {
      id: '17', symbol: 'Cmaj7', bar: 27, pageNumber: 1,
      position: { x: 0.42, y: 0.76, width: 0.10, height: 0.08 },
      analysis: { degree: 'I', func: 'T', diatonic: true },
    },
    {
      id: '18', symbol: 'Em7b5/Bb', bar: 27.5, pageNumber: 1,
      position: { x: 0.54, y: 0.76, width: 0.10, height: 0.08 },
      analysis: { degree: 'iii°/b7', func: 'D', diatonic: false },
    },

    // Final cadence
    {
      id: '19', symbol: 'A7', bar: 29, pageNumber: 1,
      position: { x: 0.12, y: 0.86, width: 0.18, height: 0.08 },
      analysis: { degree: 'V/ii', func: 'D', diatonic: false, secDom: 'ii' },
    },
    {
      id: '20', symbol: 'Dm7', bar: 31, pageNumber: 1,
      position: { x: 0.12, y: 0.94, width: 0.08, height: 0.06 },
      analysis: { degree: 'ii', func: 'SD', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'ii' } },
    },
    {
      id: '21', symbol: 'G7', bar: 31.5, pageNumber: 1,
      position: { x: 0.22, y: 0.94, width: 0.08, height: 0.06 },
      analysis: { degree: 'V', func: 'D', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'V' } },
    },
    {
      id: '22', symbol: 'C6', bar: 32, pageNumber: 1,
      position: { x: 0.32, y: 0.94, width: 0.08, height: 0.06 },
      analysis: { degree: 'I', func: 'T', diatonic: true, group: { id: 2, type: 'ii-V-I', role: 'I' } },
    },
  ],
};
