/**
 * TypeScript port of JJazzLab's StylePartType.java (LGPL v2.1).
 *
 * The 18 possible section types of a Yamaha style file. Section labels in
 * the CASM/Sdec data use space-separated form ("Main A", "Fill In AA"); the
 * enum identifiers use underscores so the names are valid TS identifiers.
 */

export type StylePartType =
  | 'Intro_A' | 'Intro_B' | 'Intro_C' | 'Intro_D'
  | 'Main_A' | 'Main_B' | 'Main_C' | 'Main_D'
  | 'Fill_In_AA' | 'Fill_In_BB' | 'Fill_In_CC' | 'Fill_In_DD'
  | 'Fill_In_BA' | 'Fill_In_AB'
  | 'Ending_A' | 'Ending_B' | 'Ending_C' | 'Ending_D';

export const STYLE_PART_TYPES: readonly StylePartType[] = [
  'Intro_A', 'Intro_B', 'Intro_C', 'Intro_D',
  'Main_A', 'Main_B', 'Main_C', 'Main_D',
  'Fill_In_AA', 'Fill_In_BB', 'Fill_In_CC', 'Fill_In_DD',
  'Fill_In_BA', 'Fill_In_AB',
  'Ending_A', 'Ending_B', 'Ending_C', 'Ending_D',
];

/** "Intro_A" → "Intro A".  Used when serialising to the .sty Sdec format. */
export function stylePartTypeToString(t: StylePartType): string {
  return t.replace(/_/g, ' ');
}

/** "Intro A" → "Intro_A".  Case-sensitive match against the Sdec form. */
export function stylePartTypeFromString(s: string): StylePartType | null {
  const candidate = s.replace(/ /g, '_') as StylePartType;
  return (STYLE_PART_TYPES as readonly string[]).includes(candidate) ? candidate : null;
}

export function isFillOrBreak(t: StylePartType): boolean {
  return t.includes('_In_');
}

export function isIntro(t: StylePartType): boolean {
  return t.startsWith('Intro_');
}

export function isEnding(t: StylePartType): boolean {
  return t.startsWith('Ending_');
}

export function isMain(t: StylePartType): boolean {
  return t.startsWith('Main');
}

/** Main_A → Fill_In_AA, etc.  Null for non-Main types. */
export function getFill(t: StylePartType): StylePartType | null {
  switch (t) {
    case 'Main_A': return 'Fill_In_AA';
    case 'Main_B': return 'Fill_In_BB';
    case 'Main_C': return 'Fill_In_CC';
    case 'Main_D': return 'Fill_In_DD';
    default: return null;
  }
}
