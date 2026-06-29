import type { MeasureInfo, NoteSheetData } from '../../data/sampleMelody';

export const ALL_KEYS_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const ALL_KEYS_MINOR = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const FLAT_KEYS = new Set(['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

const PC_FLAT: [string, 'b' | '#' | undefined][] = [
  ['C', undefined], ['D', 'b'], ['D', undefined], ['E', 'b'], ['E', undefined],
  ['F', undefined], ['G', 'b'], ['G', undefined], ['A', 'b'], ['A', undefined],
  ['B', 'b'], ['B', undefined],
];

const PC_SHARP: [string, 'b' | '#' | undefined][] = [
  ['C', undefined], ['C', '#'], ['D', undefined], ['D', '#'], ['E', undefined],
  ['F', undefined], ['F', '#'], ['G', undefined], ['G', '#'], ['A', undefined],
  ['A', '#'], ['B', undefined],
];

const KEY_SIG_NOTES: Record<string, Set<string>> = {
  C: new Set(),
  G: new Set(['F#']), D: new Set(['F#', 'C#']), A: new Set(['F#', 'C#', 'G#']),
  E: new Set(['F#', 'C#', 'G#', 'D#']), B: new Set(['F#', 'C#', 'G#', 'D#', 'A#']),
  'F#': new Set(['F#', 'C#', 'G#', 'D#', 'A#', 'E#']),
  F: new Set(['Bb']), Bb: new Set(['Bb', 'Eb']), Eb: new Set(['Bb', 'Eb', 'Ab']),
  Ab: new Set(['Bb', 'Eb', 'Ab', 'Db']), Db: new Set(['Bb', 'Eb', 'Ab', 'Db', 'Gb']),
  Gb: new Set(['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']),
};

const MINOR_TO_MAJOR: Record<string, string> = {
  Cm: 'Eb', 'C#m': 'E', Dbm: 'E', Dm: 'F', 'D#m': 'F#', Ebm: 'Gb',
  Em: 'G', Fm: 'Ab', 'F#m': 'A', Gm: 'Bb', 'G#m': 'B', Abm: 'B',
  Am: 'C', 'A#m': 'Db', Bbm: 'Db', Bm: 'D',
};

const CHORD_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const CHORD_NAME_TO_SEMI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

export function normalizeNoteKeyDisplay(key: string | undefined | null): string {
  if (!key) return 'C';
  const trimmed = key.trim();
  const weimar = trimmed.match(/^([A-G][b#]?)-(maj|min)$/i);
  if (weimar) return weimar[2].toLowerCase() === 'min' ? `${weimar[1]}m` : weimar[1];
  return trimmed || 'C';
}

export function noteKeyIsMinor(key: string | undefined | null): boolean {
  return /m$/i.test(normalizeNoteKeyDisplay(key));
}

export function keyToPc(key: string): number {
  const clean = normalizeNoteKeyDisplay(key).replace(/m$/i, '');
  const root = clean[0]?.toUpperCase() ?? 'C';
  const acc = clean.length > 1 ? clean[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function transposeNoteKey(
  vexKey: string,
  accidental: '#' | 'b' | 'n' | undefined,
  semitones: number,
  useFlats: boolean,
): { key: string; acc?: '#' | 'b' | 'n' } {
  const [notePart, octStr] = vexKey.split('/');
  const noteName = notePart.toUpperCase();

  let origPc = NOTE_TO_PC[noteName] ?? 0;
  if (accidental === '#') origPc += 1;
  else if (accidental === 'b') origPc -= 1;
  const origMidi = parseInt(octStr, 10) * 12 + origPc;
  const newMidi = origMidi + semitones;
  const newOctave = Math.floor(newMidi / 12);
  const newPcInOctave = ((newMidi % 12) + 12) % 12;

  const table = useFlats ? PC_FLAT : PC_SHARP;
  const [newNote, newAcc] = table[newPcInOctave];

  let finalOctave = newOctave;
  const finalMidi = finalOctave * 12 + newPcInOctave;
  if (finalMidi >= 84) finalOctave -= 1;
  else if (finalMidi < 48) finalOctave += 1;

  return { key: `${newNote.toLowerCase()}/${finalOctave}`, acc: newAcc };
}

function transposeChord(chord: string, semitones: number): string {
  if (!chord) return chord;
  return chord.replace(/([A-G][b#]?)/g, (match) => {
    const rootSemi = CHORD_NAME_TO_SEMI[match] ?? 0;
    const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;
    return CHORD_KEY_NAMES[newSemi];
  });
}

function transposeMeasure(measure: MeasureInfo, semitones: number, targetKey: string): MeasureInfo {
  const useFlats = FLAT_KEYS.has(targetKey.replace(/m$/i, ''));
  const majorKey = MINOR_TO_MAJOR[targetKey] ?? targetKey.replace(/m$/i, '');
  const keySigNotes = KEY_SIG_NOTES[majorKey] ?? new Set();

  return {
    ...measure,
    key: measure.key ? normalizeNoteKeyDisplay(transposeSheetKey(measure.key, semitones)) : measure.key,
    chord: measure.chord ? transposeChord(measure.chord, semitones) : measure.chord,
    notes: measure.notes.map((n) => {
      if (n.duration.endsWith('r')) return n;
      const origAcc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
      const { key: newKey, acc: newAcc } = transposeNoteKey(n.keys[0], origAcc, semitones, useFlats);
      const noteName = newKey.split('/')[0].toUpperCase();
      const fullNote = newAcc ? `${noteName}${newAcc}` : noteName;
      let finalAcc: Record<number, '#' | 'b' | 'n'> | undefined;
      if (newAcc && keySigNotes.has(fullNote)) {
        finalAcc = undefined;
      } else if (newAcc) {
        finalAcc = { 0: newAcc };
      } else if (keySigNotes.has(`${noteName}b`) || keySigNotes.has(`${noteName}#`)) {
        finalAcc = { 0: 'n' };
      }
      return { ...n, keys: [newKey], accidentals: finalAcc };
    }),
  };
}

function transposeSheetKey(key: string, semitones: number): string {
  const normalized = normalizeNoteKeyDisplay(key);
  const isMinor = noteKeyIsMinor(normalized);
  const roots = isMinor ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;
  const pc = ((keyToPc(normalized) + semitones) % 12 + 12) % 12;
  return roots.find((k) => keyToPc(k) === pc) ?? normalized;
}

export function transposeNoteSheet(data: NoteSheetData, targetKeyRaw: string): NoteSheetData {
  const originalKey = normalizeNoteKeyDisplay(data.key);
  const targetKey = normalizeNoteKeyDisplay(targetKeyRaw);
  const semitones = (keyToPc(targetKey) - keyToPc(originalKey) + 12) % 12;
  if (semitones === 0 && data.key === targetKey) return data;

  return {
    ...data,
    key: targetKey,
    measures: data.measures.map((m) => transposeMeasure(m, semitones, targetKey)),
  };
}
