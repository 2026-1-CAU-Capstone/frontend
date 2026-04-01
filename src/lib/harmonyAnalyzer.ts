/**
 * Standalone harmony analyzer: auto-detects isDiatonic and degree
 * for any LeadSheetData, using the song's key.
 */
import type { LeadSheetData, LeadSheetChord } from '../data/leadSheetTypes';

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR_SCALE = [0, 2, 3, 5, 7, 9, 11];

/** iReal quality string → normalized quality for interval lookup */
const QUALITY_MAP: [RegExp, string][] = [
  [/^\^7/, 'maj7'], [/^7/, 'dom7'], [/^-7b5/, 'min7b5'], [/^h7?/, 'min7b5'],
  [/^-7/, 'min7'], [/^o7/, 'dim7'], [/^o/, 'dim'], [/^7sus/, 'dom7sus4'],
  [/^\+7/, 'aug7'], [/^\+/, 'aug'], [/^-6/, 'min6'], [/^6/, 'maj6'],
  [/^\^/, 'maj'], [/^-/, 'min'], [/^sus/, 'sus4'],
];

const QUALITY_INTERVALS: Record<string, number[]> = {
  maj7: [0, 4, 7, 11], maj: [0, 4, 7], dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10], min: [0, 3, 7], min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9], dim: [0, 3, 6], aug: [0, 4, 8], aug7: [0, 4, 8, 10],
  sus4: [0, 5, 7], dom7sus4: [0, 5, 7, 10], min6: [0, 3, 7, 9], maj6: [0, 4, 7, 9],
};

function normalizeQualityForAnalysis(raw: string): string {
  if (!raw) return 'maj';
  for (const [re, norm] of QUALITY_MAP) {
    if (re.test(raw)) return norm;
  }
  return 'maj';
}

function chordRootPc(chord: LeadSheetChord): number | null {
  if (!chord.root) return null;
  const base = NOTE_TO_PC[chord.root];
  if (base == null) return null;
  const acc = chord.accidental === '#' ? 1 : chord.accidental === 'b' ? -1 : 0;
  return (base + acc + 12) % 12;
}

/** Parse key string like "C", "Bb-", "F#-" into { pc, isMinor } */
export function parseKey(key: string): { pc: number; isMinor: boolean } {
  const isMinor = key.endsWith('-') || key.endsWith('m');
  const cleaned = key.replace(/[-m]$/, '');
  return { pc: keyToPc(cleaned), isMinor };
}

function keyToPc(key: string): number {
  const root = key[0];
  const acc = key.length > 1 ? key[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function checkDiatonic(rootPc: number, quality: string, keyRootPc: number, scale: number[]): boolean {
  const scalePcs = new Set(scale.map((iv) => (keyRootPc + iv) % 12));
  const intervals = QUALITY_INTERVALS[quality] ?? [0, 4, 7];
  return intervals.every((iv) => scalePcs.has((rootPc + iv) % 12));
}

/** Display key: "Bb-" → "Bbm", "C" → "C" */
export function formatKeyDisplay(key: string): string {
  if (key.endsWith('-')) return key.slice(0, -1) + 'm';
  return key;
}

/** Get relative key: C → Am, Am → C, Bb → Gm, etc. */
export function getRelativeKey(key: string): string {
  const { pc, isMinor } = parseKey(key);
  if (isMinor) {
    // relative major = minor root + 3 semitones
    const majPc = (pc + 3) % 12;
    return pcToKeyName(majPc, false);
  } else {
    // relative minor = major root - 3 semitones
    const minPc = (pc + 9) % 12;
    return pcToKeyName(minPc, true);
  }
}

const PC_TO_FLAT_KEY = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_TO_SHARP_KEY = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_PCS = new Set([0, 1, 3, 5, 8, 10]); // C, Db, Eb, F, Ab, Bb prefer flats

function pcToKeyName(pc: number, isMinor: boolean): string {
  const name = FLAT_PCS.has(pc) ? PC_TO_FLAT_KEY[pc] : PC_TO_SHARP_KEY[pc];
  return isMinor ? name + 'm' : name;
}

/**
 * Analyze all chords in a LeadSheetData for isDiatonic.
 * Mutates chords in place (sets chord.isDiatonic and chord.analysis).
 * Returns the same data reference.
 */
export function analyzeIsDiatonic(data: LeadSheetData): LeadSheetData {
  const rawKey = data.key ?? 'C';
  const { pc: keyRootPc, isMinor } = parseKey(rawKey);
  const primaryScale = isMinor ? NATURAL_MINOR_SCALE : MAJOR_SCALE;

  for (const system of data.systems) {
    for (const bar of system.bars) {
      for (const chord of bar.chords) {
        if (chord.isRepeat || !chord.root) continue;

        const rootPc = chordRootPc(chord);
        if (rootPc == null) continue;

        const quality = chord.quality ?? '';
        const normQuality = normalizeQualityForAnalysis(quality);

        let isDiatonic = checkDiatonic(rootPc, normQuality, keyRootPc, primaryScale);
        if (!isDiatonic && isMinor) {
          isDiatonic = checkDiatonic(rootPc, normQuality, keyRootPc, HARMONIC_MINOR_SCALE)
            || checkDiatonic(rootPc, normQuality, keyRootPc, MELODIC_MINOR_SCALE);
        }

        chord.isDiatonic = isDiatonic;

        // Ensure analysis object exists with rootPc
        if (!chord.analysis) {
          chord.analysis = { rootPc, normalizedQuality: normQuality };
        } else if (chord.analysis.rootPc == null) {
          chord.analysis.rootPc = rootPc;
          chord.analysis.normalizedQuality = normQuality;
        }
      }
    }
  }

  return data;
}
