import type { LeadSheetChord, LeadSheetData } from '../data/leadSheetTypes';
import { isMinorKey } from '../components/leadsheet/leadSheetTranspose';

/* Frontend-only chord-chart editing helpers.
 *
 * There's no per-user backend yet, so user edits to a chart are parsed from a
 * plain text input (e.g. "Cmaj7", "F#7", "Em7b5/A") into the structured
 * LeadSheetChord shape, and persisted to localStorage keyed by song id. */

/** Build the editable text for a chord, e.g. { root:'E', quality:'m7', bass:{root:'A'} } → "Em7/A". */
export function chordToInputString(chord: LeadSheetChord): string {
  if (!chord.root) return '';
  const acc = chord.accidental === '#' ? '#' : chord.accidental === 'b' ? 'b' : '';
  const bass = chord.bass
    ? `/${chord.bass.root}${chord.bass.accidental === '#' ? '#' : chord.bass.accidental === 'b' ? 'b' : ''}`
    : '';
  return `${chord.root}${acc}${chord.quality ?? ''}${bass}`;
}

const ACC = (c?: string): 'b' | '#' | undefined =>
  c === '#' || c === '♯' ? '#' : c === 'b' || c === '♭' ? 'b' : undefined;

/** Parse a typed chord symbol into a LeadSheetChord. Empty/null input → empty
 *  chord. OMR analysis rows can carry `chord: null` for unrecognized slots, so
 *  this must tolerate null/undefined rather than calling `.trim()` on it. */
export function parseChordInput(raw: string | null | undefined): LeadSheetChord {
  const s = (raw ?? '').trim();
  if (!s) return {};

  const [main, bassRaw] = s.split('/');
  const m = main.match(/^([A-Ga-g])([b#♭♯])?(.*)$/);
  if (!m) return { quality: s };

  const chord: LeadSheetChord = {
    root: m[1].toUpperCase(),
    accidental: ACC(m[2]),
    quality: m[3].trim() || undefined,
  };

  if (bassRaw) {
    const bm = bassRaw.trim().match(/^([A-Ga-g])([b#♭♯])?/);
    if (bm) chord.bass = { root: bm[1].toUpperCase(), accidental: ACC(bm[2]) };
  }
  return chord;
}

/** Backend ChordProject key enum, e.g. "F#m" → "F_SHARP_MINOR", "Bb" → "B_FLAT_MAJOR". */
export function displayKeyToProjectKey(key: string): string {
  const minor = isMinorKey(key);
  const root = key.replace(/m$/, '').replace(/-$/, '');
  const normalizedRoot = root
    .replace('#', '_SHARP')
    .replace('b', '_FLAT')
    .replace(/^([A-G])$/, '$1');
  return `${normalizedRoot}_${minor ? 'MINOR' : 'MAJOR'}`.toUpperCase();
}

/** Flatten a lead sheet into the backend's bar-delimited progression string,
 *  e.g. "Cmaj7 | Am7 Dm7 | G7 | N.C.". Trailing empty bars are trimmed. */
export function leadSheetToProgression(data: LeadSheetData): string {
  const bars = data.systems.flatMap((system) =>
    system.bars.map((bar) => {
      const symbols = bar.chords
        .map(chordToInputString)
        .map((s) => s.trim())
        .filter(Boolean);
      return symbols.length > 0 ? symbols.join(' ') : 'N.C.';
    }),
  );

  while (bars.length > 1 && bars[bars.length - 1] === 'N.C.') {
    bars.pop();
  }
  return bars.join(' | ') || 'N.C.';
}

/* ─── localStorage persistence (interim, until a user backend exists) ───── */

const STORAGE_PREFIX = 'jazzify.chartEdit.';

export function loadChartEdit(songId: string): LeadSheetData | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + songId);
    return raw ? (JSON.parse(raw) as LeadSheetData) : null;
  } catch {
    return null;
  }
}

export function saveChartEdit(songId: string, data: LeadSheetData): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + songId, JSON.stringify(data));
  } catch {
    /* ignore quota / serialization errors */
  }
}
