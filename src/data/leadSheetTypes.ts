export interface LeadSheetChord {
  root?: string;
  accidental?: 'b' | '#';
  quality?: string;
  isRepeat?: boolean;
}

export interface LeadSheetBar {
  chords: LeadSheetChord[];
}

export interface LeadSheetSystem {
  sectionLabel?: string;
  hasRepeatStart?: boolean;
  hasRepeatEnd?: boolean;
  bars: LeadSheetBar[];
}

export interface LeadSheetData {
  title: string;
  style: string;
  composer: string;
  timeSignature: string;
  systems: LeadSheetSystem[];
}
