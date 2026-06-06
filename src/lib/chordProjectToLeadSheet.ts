/**
 * Convert a backend ChordProject + its analysis into the LeadSheetData shape the
 * chord-chart UI renders. Shared by MyChordChartsPage (card preview) and
 * ChordPage (opening a saved chart via `/mychord?project=<publicId>`), so both
 * render a saved chart identically.
 */

import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordAnalysisResult, ChordProject } from '../api/chordProjects';
import { parseChordInput } from './leadSheetChordEdit';

/* ── Degree → chord reconstruction ───────────────────────────────────────
 * OMR sometimes returns `chord: null` for a bar while still giving a degree +
 * quality (e.g. degree "bVII", quality "maj7"). Without this the bar renders
 * blank. Rebuild a chord SYMBOL from (degree, normalizedQuality) relative to
 * the song key, spelled diatonically (bVII in C → "Bb", not "A#"). */
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

function tonicInfo(keyDisplay: string): { letter: string; pc: number } | null {
  const m = keyDisplay.match(/^([A-G])([b#])?/);
  if (!m) return null;
  let pc = LETTER_PC[m[1]];
  if (m[2] === 'b') pc = (pc + 11) % 12;
  if (m[2] === '#') pc = (pc + 1) % 12;
  return { letter: m[1], pc };
}

/** Degree roman (with leading b/#, e.g. "bVII", "vii°", "II") → root spelling
 *  ("Bb", "B", "D") in `keyDisplay`'s key, or null if unparseable. */
function degreeToRoot(degree: string, keyDisplay: string): string | null {
  const tonic = tonicInfo(keyDisplay);
  if (!tonic) return null;
  let i = 0;
  let acc = 0;
  while (i < degree.length && (degree[i] === 'b' || degree[i] === '#')) {
    acc += degree[i] === 'b' ? -1 : 1;
    i++;
  }
  const roman = degree.slice(i).replace(/[^ivxIVX]/g, '').toLowerCase();
  const romanIdx = ROMAN.indexOf(roman);
  if (romanIdx < 0) return null;
  const degreePc = (((tonic.pc + MAJOR_OFFSETS[romanIdx] + acc) % 12) + 12) % 12;
  const letter = LETTERS[(LETTERS.indexOf(tonic.letter) + romanIdx) % 7];
  let diff = (((degreePc - LETTER_PC[letter]) % 12) + 12) % 12;
  if (diff > 6) diff -= 12;
  const accStr = diff === 0 ? '' : diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff);
  return letter + accStr;
}

/** Backend normalizedQuality → chord-symbol suffix parseChordInput understands. */
function qualitySuffix(q: unknown): string {
  switch (q) {
    case 'min': return 'm';
    case 'min7': return 'm7';
    case 'dom7': return '7';
    case 'maj7': return 'maj7';
    case 'maj6': return '6';
    case 'min6': return 'm6';
    case 'dim': return 'dim';
    case 'dim7': return 'dim7';
    case 'min7b5': case 'halfdim': return 'm7b5';
    case 'aug': return 'aug';
    case 'minMaj7': return 'mMaj7';
    case 'maj': default: return '';
  }
}

/** Rebuild a chord symbol from a null-chord's analysis, or null if not possible. */
function reconstructChordSymbol(
  analysis: Record<string, unknown> | null | undefined,
  keyDisplay: string,
): string | null {
  const degree = analysis?.degree;
  if (typeof degree !== 'string') return null;
  const root = degreeToRoot(degree, keyDisplay);
  if (!root) return null;
  return root + qualitySuffix(analysis?.normalizedQuality);
}

/** Backend key enum (e.g. "C_MAJOR", "E_FLAT_MINOR") → display ("C", "Ebm"). */
function musicKeyToDisplay(key: string | undefined): string {
  const raw = (key ?? '').trim();
  if (!raw) return '';
  const minor = raw.endsWith('_MINOR');
  return raw
    .replace(/_MAJOR$/, '')
    .replace(/_MINOR$/, '')
    .replace(/_FLAT/g, 'b')
    .replace(/_SHARP/g, '#')
    .replace(/_/g, '')
    + (minor ? 'm' : '');
}

export function analysisToLeadSheet(analysis: ChordAnalysisResult, project: ChordProject): LeadSheetData {
  const byBar = new Map<number, typeof analysis.chords>();
  for (const chord of analysis.chords ?? []) {
    const bar = Number(chord.bar || 1);
    const list = byBar.get(bar) ?? [];
    list.push(chord);
    byBar.set(bar, list);
  }
  const keyDisplay = musicKeyToDisplay(analysis.keySignature || project.keySignature);
  const maxBar = Math.max(0, ...Array.from(byBar.keys()));
  const bars = Array.from({ length: maxBar }, (_, index) => {
    const measureNumber = index + 1;
    const chords = (byBar.get(measureNumber) ?? [])
      .sort((a, b) => Number(a.beat) - Number(b.beat))
      .map((info) => {
        // `chord: null` (OMR read no symbol) → rebuild from the degree/quality
        // so the bar isn't blank. Falls back to {} only when even that fails.
        const symbol = (typeof info.chord === 'string' && info.chord.trim())
          ? info.chord
          : reconstructChordSymbol(info.analysis, keyDisplay);
        return {
        ...parseChordInput(symbol),
        durationBeats: typeof info.durationBeats === 'number' ? info.durationBeats : undefined,
        id: info.publicId,
        isDiatonic: typeof info.analysis?.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
        analysis: info.analysis ? {
          degree: typeof info.analysis.degree === 'string' ? info.analysis.degree : undefined,
          normalizedQuality: typeof info.analysis.normalizedQuality === 'string' ? info.analysis.normalizedQuality : undefined,
          isDiatonic: typeof info.analysis.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
          ambiguityScore: typeof info.analysis.ambiguityScore === 'number' ? info.analysis.ambiguityScore : undefined,
        } : undefined,
        };
      });
    return { measureNumber, chords: chords.length > 0 ? chords : [{}] };
  });

  const systems = [];
  for (let i = 0; i < bars.length; i += 4) {
    systems.push({ bars: bars.slice(i, i + 4) });
  }
  return {
    id: project.publicId,
    title: analysis.title || project.title,
    style: '',
    composer: '',
    key: musicKeyToDisplay(analysis.keySignature || project.keySignature),
    timeSignature: analysis.timeSignature || project.timeSignature || '4/4',
    systems,
  };
}
