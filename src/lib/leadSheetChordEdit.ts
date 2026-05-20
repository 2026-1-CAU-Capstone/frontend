import type { LeadSheetChord, LeadSheetData } from '../data/leadSheetTypes';

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

/** Parse a typed chord symbol into a LeadSheetChord. Empty input → empty chord. */
export function parseChordInput(raw: string): LeadSheetChord {
  const s = raw.trim();
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
