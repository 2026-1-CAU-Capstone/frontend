/* §8 R7.2 — LeadSheet에서 분리한 이조(transpose) 순수 모듈.
 * 키 스펠링 테이블·keyToPc·shiftKey·차트 전체 이조. UI 의존 없음. */
import type { LeadSheetChord, LeadSheetData } from '../../data/leadSheetTypes';

/* ─── transposition ──────────────────────────────────────────────────────── */

export const ALL_MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const ALL_MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const FLAT_KEYS = new Set(['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

// pitch-class → [root, accidental]
const PC_FLAT:  [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['D','b'],['D',undefined],['E','b'],['E',undefined],
  ['F',undefined],['G','b'],['G',undefined],['A','b'],['A',undefined],
  ['B','b'],['B',undefined],
];
const PC_SHARP: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['C','#'],['D',undefined],['D','#'],['E',undefined],
  ['F',undefined],['F','#'],['G',undefined],['G','#'],['A',undefined],
  ['A','#'],['B',undefined],
];

function keyToPc(key: string): number {
  // handle e.g. "Bb", "F#", "C", "Cm", "F#m", "Bb-"
  const cleaned = key.replace(/[-m]$/, '');
  const root = cleaned[0];
  const acc = cleaned.length > 1 ? cleaned[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

export function isMinorKey(key: string): boolean {
  return key.endsWith('-') || key.endsWith('m');
}

/** Shift a key string up by `semitones`, preserving major/minor and using the
 *  canonical spelling from ALL_MAJOR_KEYS / ALL_MINOR_KEYS. Used to fold the
 *  transposing-instrument offset into the chart's target key. */
export function shiftKey(key: string, semitones: number): string {
  if (semitones === 0) return key;
  const newPc = (keyToPc(key) + semitones + 12) % 12;
  return isMinorKey(key) ? ALL_MINOR_KEYS[newPc] : ALL_MAJOR_KEYS[newPc];
}

export function transposeChord(chord: LeadSheetChord, semitones: number, useFlats: boolean): LeadSheetChord {
  if (!chord.root || chord.isRepeat) return chord;

  const table = useFlats ? PC_FLAT : PC_SHARP;
  const rootPc = ((NOTE_TO_PC[chord.root] ?? 0) + (chord.accidental === '#' ? 1 : chord.accidental === 'b' ? -1 : 0) + 12) % 12;
  const newPc = (rootPc + semitones + 12) % 12;
  const [newRoot, newAcc] = table[newPc];

  const result: LeadSheetChord = { ...chord, root: newRoot, accidental: newAcc };

  if (chord.bass) {
    const bassPc = ((NOTE_TO_PC[chord.bass.root] ?? 0) + (chord.bass.accidental === '#' ? 1 : chord.bass.accidental === 'b' ? -1 : 0) + 12) % 12;
    const newBassPc = (bassPc + semitones + 12) % 12;
    const [bRoot, bAcc] = table[newBassPc];
    result.bass = { root: bRoot, accidental: bAcc };
  }

  if (chord.analysis) {
    result.analysis = {
      ...chord.analysis,
      rootPc: newPc,
      bassPc: chord.analysis.bassPc != null ? (chord.analysis.bassPc + semitones + 12) % 12 : undefined,
    };
  }

  return result;
}

export function transposeData(data: LeadSheetData, targetKey: string): LeadSheetData {
  const origPc = keyToPc(data.key ?? 'C');
  const targetPc = keyToPc(targetKey);
  const semitones = (targetPc - origPc + 12) % 12;

  // No pitch change needed — just update key label (e.g. relative key switch)
  if (semitones === 0) return { ...data, key: targetKey };

  const cleanTarget = targetKey.replace(/[-m]$/, '');
  const useFlats = FLAT_KEYS.has(cleanTarget);
  return {
    ...data,
    key: targetKey,
    systems: data.systems.map((sys) => ({
      ...sys,
      bars: sys.bars.map((bar) => ({
        ...bar,
        chords: bar.chords.map((ch) => transposeChord(ch, semitones, useFlats)),
      })),
    })),
  };
}
