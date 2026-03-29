/* ─── Types ─────────────────────────────────────────────────────────────── */

export interface NoteInfo {
  keys: string[];                               // VexFlow keys e.g. ['c/5']
  duration: string;                             // 'w','h','q','8','16' or 'wr','hr','qr','8r'
  dotted?: boolean;
  accidentals?: Record<number, '#' | 'b' | 'n'>;
  tie?: boolean;                                // tie to the NEXT note of same pitch
  gliss?: boolean;                              // glissando to the NEXT note
  tuplet?: number;                              // e.g. 3 = triplet (3 notes in time of 2)
  beamBreak?: boolean;                          // force beam break AFTER this note
  chord?: string;                               // chord change at this note position
}

export interface MeasureInfo {
  notes: NoteInfo[];
  chord?: string;
}

export interface NoteSheetData {
  title: string;
  composer: string;
  key: string;
  timeSignature: string;
  tempo?: number;
  measures: MeasureInfo[];
}

/* ─── Sample: 16-bar jazz melody in C major ─────────────────────────────── */

export const sampleMelody: NoteSheetData = {
  title: 'Blues for Alice',
  composer: 'Charlie Parker',
  key: 'C',
  timeSignature: '4/4',
  measures: [
    // ── Line 1 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
      ],
    },
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['g/5'], duration: '8' },
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q', dotted: true },
        { keys: ['e/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['a/5'], duration: 'q' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/5'], duration: 'h' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
      ],
    },

    // ── Line 2 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['e/5'], duration: 'q' },
        { keys: ['b/4'], duration: 'qr' },
        { keys: ['d/5'], duration: '8' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['c/5'], duration: 'q' },
      ],
    },
    {
      chord: 'A-7',
      notes: [
        { keys: ['a/4'], duration: '8' },
        { keys: ['b/4'], duration: '8' },
        { keys: ['c/5'], duration: '8' },
        { keys: ['d/5'], duration: '8' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['c/5'], duration: 'q' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['d/5'], duration: 'h' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/4'], duration: 'w' },
      ],
    },

    // ── Line 3 ──
    {
      chord: 'E-7',
      notes: [
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['b/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
      ],
    },
    {
      chord: 'A7',
      notes: [
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q', accidentals: { 0: '#' } },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['f/5'], duration: 'q' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/5'], duration: 'h' },
        { keys: ['b/4'], duration: 'hr' },
      ],
    },

    // ── Line 4 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['c/6'], duration: 'q' },
      ],
    },
    {
      chord: 'FΔ7',
      notes: [
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7  G7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['b/4'], duration: 'q' },
      ],
    },
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'w' },
      ],
    },
  ],
};
