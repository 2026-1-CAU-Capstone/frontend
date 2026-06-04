import type { LeadSheetData, LeadSheetChord, LeadSheetBar } from '../../data/leadSheetTypes';
import type { NoteSheetData } from '../../data/sampleMelody';

function chordSymbol(ch: LeadSheetChord, prev: string | undefined): string | undefined {
  if (ch.isRepeat) return prev;
  if (!ch.root) return undefined;
  const acc = ch.accidental ?? '';
  const quality = (ch.quality ?? '').replace(/\^/g, '△');
  const bass = ch.bass
    ? `/${ch.bass.root}${ch.bass.accidental ?? ''}`
    : '';
  return `${ch.root}${acc}${quality}${bass}`;
}

function barToChordString(bar: LeadSheetBar, prev: { last?: string }): string | undefined {
  const syms: string[] = [];
  for (const ch of bar.chords ?? []) {
    const sym = chordSymbol(ch, prev.last);
    if (sym) {
      syms.push(sym);
      prev.last = sym;
    }
  }
  return syms.length ? syms.join('  ') : undefined;
}

export function flattenLeadSheetChords(lead: LeadSheetData): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  const state = { last: undefined as string | undefined };
  for (const sys of lead.systems) {
    for (const bar of sys.bars) {
      out.push(barToChordString(bar, state));
    }
  }
  return out;
}

export function injectChordsFromLeadSheet(
  sheet: NoteSheetData,
  lead: LeadSheetData,
): NoteSheetData {
  const flat = flattenLeadSheetChords(lead);
  const n = flat.length;
  return {
    ...sheet,
    // jazz1460 carries exactly ONE chorus of chords, but omnibook melodies run
    // the head plus several solo choruses. Cycle the progression (i % n) so
    // every chorus keeps its chord changes instead of going blank after the
    // first. (Chorus-1 alignment is unchanged: for i < n, i % n === i.)
    measures: sheet.measures.map((m, i) => ({
      ...m,
      chord: n > 0 ? flat[i % n] : undefined,
    })),
  };
}
