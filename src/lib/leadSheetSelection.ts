import type { LeadSheetData } from '../data/leadSheetTypes';

function safeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sheet';
}

export function withLeadSheetSelectionIds(data: LeadSheetData, seed?: string): LeadSheetData {
  const sheetId = data.id ?? safeIdPart(seed ?? data.title);
  let barCounter = 0;

  return {
    ...data,
    id: sheetId,
    systems: data.systems.map((system, systemIndex) => ({
      ...system,
      bars: system.bars.map((bar, barIndex) => {
        barCounter += 1;
        const measureNumber = bar.measureNumber ?? barCounter;

        return {
          ...bar,
          measureNumber,
          chords: bar.chords.map((chord, chordIndex) => ({
            ...chord,
            id: chord.id ?? `${sheetId}-s${systemIndex + 1}-b${barIndex + 1}-m${measureNumber}-c${chordIndex + 1}`,
          })),
        };
      }),
    })),
  };
}
