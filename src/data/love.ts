import type { LeadSheetData } from './leadSheetTypes';

export const love: LeadSheetData = {
  title: 'L.O.V.E.',
  style: 'Medium Swing',
  composer: 'Gabler-Kaempfert',
  timeSignature: '4/4',
  systems: [
    // Row 1 — Section A, bars 1–4
    {
      sectionLabel: 'A',
      bars: [
        { chords: [{ root: 'F', quality: '6' }] },
        { chords: [{ root: 'F', quality: 'Δ7' }] },
        { chords: [{ root: 'G', quality: '-7' }] },
        { chords: [{ root: 'C', quality: '7' }] },
      ],
    },
    // Row 2 — bars 5–8
    {
      hasRepeatEnd: true,
      bars: [
        { chords: [{ root: 'C', quality: '7' }] },
        { chords: [{ isRepeat: true }] },
        { chords: [{ root: 'F', quality: 'Δ7' }] },
        { chords: [{ root: 'F', quality: '6' }] },
      ],
    },
    // Row 3 — Section B, bars 1–4
    {
      sectionLabel: 'B',
      hasRepeatStart: true,
      bars: [
        { chords: [{ root: 'F', quality: '7' }] },
        { chords: [{ isRepeat: true }] },
        { chords: [{ root: 'B', accidental: 'b', quality: 'Δ7' }] },
        { chords: [{ isRepeat: true }] },
      ],
    },
    // Row 4 — bars 5–8
    {
      hasRepeatEnd: true,
      bars: [
        { chords: [{ root: 'G', quality: '7' }] },
        { chords: [{ isRepeat: true }] },
        { chords: [{ root: 'C', quality: '7sus' }] },
        { chords: [{ root: 'C', quality: '7' }] },
      ],
    },
    // Row 5 — Section A (repeat), bars 1–4
    {
      sectionLabel: 'A',
      hasRepeatStart: true,
      bars: [
        { chords: [{ root: 'F', quality: '6' }] },
        { chords: [{ root: 'F', quality: 'Δ7' }] },
        { chords: [{ root: 'G', quality: '-7' }] },
        { chords: [{ root: 'C', quality: '7' }] },
      ],
    },
    // Row 6 — bars 5–8
    {
      hasRepeatEnd: true,
      bars: [
        { chords: [{ root: 'C', quality: '7' }] },
        { chords: [{ isRepeat: true }] },
        { chords: [{ root: 'F', quality: 'Δ7' }] },
        { chords: [{ root: 'F', quality: '6' }] },
      ],
    },
    // Row 7 — Section C, bars 1–4
    {
      sectionLabel: 'C',
      hasRepeatStart: true,
      bars: [
        { chords: [{ root: 'F', quality: '7' }] },
        { chords: [{ isRepeat: true }] },
        { chords: [{ root: 'B', accidental: 'b', quality: 'Δ7' }] },
        { chords: [{ root: 'B', quality: 'o7' }] },
      ],
    },
    // Row 8 — final bars
    {
      hasRepeatEnd: true,
      bars: [
        { chords: [{ root: 'F', quality: '6' }] },
        { chords: [{ root: 'C', quality: '7' }] },
        { chords: [{ root: 'F', quality: '6' }] },
        { chords: [{ root: 'G', quality: '-7' }, { root: 'C', quality: '7' }] },
      ],
    },
  ],
};
