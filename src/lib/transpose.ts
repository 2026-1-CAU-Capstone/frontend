import type { NoteSheetData, MeasureInfo, NoteInfo } from '../data/sampleMelody';
import { keySigLetterMap } from './note/resolvePitches';
import { spellMidi, spellChordRoot } from './note/spelling';

/* ─── pitch helpers ──────────────────────────────────────────────────── */

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** 대상 키의 조표가 플랫 계열이면 true. 조표 없음(C/Am)은 재즈 관례상 플랫. */
export function keyPrefersFlats(key: string): boolean {
  for (const v of keySigLetterMap(key).values()) return v === 'b';
  return true;
}
const NAME_TO_SEMI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function noteToMidi(key: string, acc?: 'b' | '#' | 'n'): number {
  const [letter, oct] = key.split('/');
  let semi = SEMI_MAP[letter] ?? 0;
  if (acc === 'b') semi -= 1;
  if (acc === '#') semi += 1;
  return (parseInt(oct) + 1) * 12 + semi;
}

/** 대상 조성의 **도수**로 스펠링(옥타브는 글자 기준 역산). */
function midiToNote(midi: number, targetKey: string): { key: string; acc?: 'b' | '#' } {
  const sp = spellMidi(midi, targetKey);
  return { key: sp.vexKey, acc: (sp.acc === '#' || sp.acc === 'b') ? sp.acc : undefined };
}

/* ─── chord transpose ────────────────────────────────────────────────── */

/** Transpose a chord symbol like "G-7", "F△7", "C7/E" by N semitones. */
export function transposeChord(chord: string, semitones: number, targetKey = 'C'): string {
  if (!chord) return chord;
  const m = chord.match(/^([A-G][b#]?)(.*)/);
  if (!m) return chord;
  const rootSemi = NAME_TO_SEMI[m[1]] ?? 0;
  const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;

  // Also transpose slash bass note if present (e.g. "Dm7/G")
  let suffix = m[2];
  const slash = suffix.match(/^(.*?)\/([A-G][b#]?)(.*)$/);
  if (slash) {
    const bassSemi = NAME_TO_SEMI[slash[2]];
    if (bassSemi !== undefined) {
      const newBass = ((bassSemi + semitones) % 12 + 12) % 12;
      suffix = `${slash[1]}/${spellChordRoot(newBass, targetKey)}${slash[3]}`;
    }
  }
  return spellChordRoot(newSemi, targetKey) + suffix;
}

/** Transpose a measure-level chord field which may contain multiple chords
 *  separated by 2+ spaces (e.g. "G-7  C7"). */
function transposeMeasureChord(chord: string, semitones: number, targetKey: string): string {
  // Keep separators by using a capturing group split
  return chord
    .split(/(\s{2,})/)
    .map((p) => (/^\s+$/.test(p) ? p : transposeChord(p, semitones, targetKey)))
    .join('');
}

/* ─── measure transpose with octave clamp ───────────────────────────── */

const MIDI_F6 = 89; // upper soft bound
const MIDI_F3 = 53; // lower soft bound

function transposeMeasures(measures: MeasureInfo[], semitones: number, targetKey: string): MeasureInfo[] {
  if (semitones === 0) return measures.map((m) => ({ ...m }));

  const midiValues: number[] = [];
  const transposed: MeasureInfo[] = measures.map((m) => ({
    ...m,
    chord: m.chord ? transposeMeasureChord(m.chord, semitones, targetKey) : m.chord,
    notes: m.notes.map((n) => {
      if (n.duration.endsWith('r')) return { ...n };
      const acc = n.accidentals?.[0] as 'b' | '#' | 'n' | undefined;
      const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc) + semitones;
      midiValues.push(midi);
      const tr = midiToNote(midi, targetKey);
      const next: NoteInfo = { ...n, keys: [tr.key], accidentals: undefined };
      if (tr.acc) next.accidentals = { 0: tr.acc };
      return next;
    }),
  }));

  if (midiValues.length === 0) return transposed;

  // Octave adjustment: use median pitch to decide
  const sorted = [...midiValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let octShift = 0;
  if (median > MIDI_F6) octShift = -12;
  else if (median < MIDI_F3) octShift = 12;
  if (octShift === 0) return transposed;

  return transposed.map((m) => ({
    ...m,
    notes: m.notes.map((n) => {
      if (n.duration.endsWith('r')) return n;
      const acc = n.accidentals?.[0] as 'b' | '#' | 'n' | undefined;
      const midi = noteToMidi(n.keys[0], acc === 'n' ? undefined : acc) + octShift;
      const tr = midiToNote(midi, targetKey);
      const next: NoteInfo = { ...n, keys: [tr.key], accidentals: undefined };
      if (tr.acc) next.accidentals = { 0: tr.acc };
      return next;
    }),
  }));
}

/* ─── key parsing ────────────────────────────────────────────────────── */

/** Parse user input → backend "Root-maj" / "Root-min" format. Returns null if invalid. */
export function normalizeKeyInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Already in backend format
  const direct = s.match(/^([A-G][b#]?)-(maj|min)$/);
  if (direct) {
    if (!(direct[1] in NAME_TO_SEMI)) return null;
    return s;
  }
  const m = s.match(/^([A-Ga-g])([b#B]?)(m|min|minor|maj|major)?$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  let acc = '';
  if (m[2]) {
    // 'B' or 'b' both mean flat; '#' means sharp
    acc = m[2] === '#' ? '#' : 'b';
  }
  const root = letter + acc;
  if (!(root in NAME_TO_SEMI)) return null;
  const modeTok = (m[3] || '').toLowerCase();
  const mode = modeTok === 'm' || modeTok === 'min' || modeTok === 'minor' ? 'min' : 'maj';
  return `${root}-${mode}`;
}

/** Format a backend key string into a display form (e.g. "F-maj" → "F", "Bb-min" → "Bbm"). */
export function formatKeyDisplay(key: string): string {
  if (key.endsWith('-min')) return key.slice(0, -4) + 'm';
  if (key.endsWith('-maj')) return key.slice(0, -4);
  return key;
}

function keyRootSemi(key: string): number | null {
  const root = key.split('-')[0];
  return NAME_TO_SEMI[root] ?? null;
}

/** Shortest-direction semitone offset between two keys (range −6..+6). */
export function semitonesBetween(fromKey: string, toKey: string): number | null {
  const from = keyRootSemi(fromKey);
  const to = keyRootSemi(toKey);
  if (from === null || to === null) return null;
  let diff = (to - from) % 12;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
}

/* ─── high-level lick transpose ──────────────────────────────────────── */

export interface TransposedLick {
  key: string;            // new backend key string
  chords: string[];       // top-level chord array, transposed
  sheetData: NoteSheetData;
}

/**
 * Transpose a lick's notes, chord-per-measure, top-level chord list, and key field.
 * Mode (maj/min) of the original key is preserved in the new key.
 * Returns null if either key is unparseable.
 */
export function transposeLick(
  sheet: NoteSheetData,
  chords: string[],
  fromKey: string,
  toKey: string,
): TransposedLick | null {
  const semis = semitonesBetween(fromKey, toKey);
  if (semis === null) return null;

  // Preserve original mode (maj/min) but use new root from the requested key
  const oldMode = fromKey.endsWith('-min') ? 'min' : 'maj';
  const newRoot = toKey.split('-')[0];
  const newKey = `${newRoot}-${oldMode}`;

  // 실제 기보 관례: 대상 조표가 샵 계열이면 샵으로, 플랫 계열이면 플랫으로 스펠링.

  return {
    key: newKey,
    chords: chords.map((c) => transposeChord(c, semis, newKey)),
    sheetData: {
      ...sheet,
      key: newKey,
      measures: transposeMeasures(sheet.measures, semis, newKey),
    },
  };
}
