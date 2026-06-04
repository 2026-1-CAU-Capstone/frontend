/**
 * Convert a backend ChordProject + its analysis into the LeadSheetData shape the
 * chord-chart UI renders. Shared by MyChordChartsPage (card preview) and
 * ChordPage (opening a saved chart via `/mychord?project=<publicId>`), so both
 * render a saved chart identically.
 */

import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordAnalysisResult, ChordProject } from '../api/chordProjects';
import { parseChordInput } from './leadSheetChordEdit';

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
  const maxBar = Math.max(0, ...Array.from(byBar.keys()));
  const bars = Array.from({ length: maxBar }, (_, index) => {
    const measureNumber = index + 1;
    const chords = (byBar.get(measureNumber) ?? [])
      .sort((a, b) => Number(a.beat) - Number(b.beat))
      .map((info) => ({
        ...parseChordInput(info.chord),
        id: info.publicId,
        isDiatonic: typeof info.analysis?.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
        analysis: info.analysis ? {
          degree: typeof info.analysis.degree === 'string' ? info.analysis.degree : undefined,
          normalizedQuality: typeof info.analysis.normalizedQuality === 'string' ? info.analysis.normalizedQuality : undefined,
          isDiatonic: typeof info.analysis.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
          ambiguityScore: typeof info.analysis.ambiguityScore === 'number' ? info.analysis.ambiguityScore : undefined,
        } : undefined,
      }));
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
