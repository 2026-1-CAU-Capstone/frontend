export interface LeadSheetChordAnalysis {
  rootPc?: number;
  bassPc?: number;
  normalizedQuality?: string;
  isDiatonic?: boolean;
  degree?: string;
  secondaryDominant?: {
    targetRootPc?: number;
    targetKey?: string;
    resolved?: boolean;
    targetChordId?: string;
    label?: string;
    targetDegree?: string;
  };
  functions?: { function: string; confidence: number }[];
  groupMemberships?: { groupId: number; groupType: string; role: string; variant: string }[];
  modalInterchange?: { sourceMode: string; borrowedDegree: string };
  deceptiveResolution?: { expected: string; actual: string };
  modeSegment?: string;
  ambiguityScore?: number;
}

export interface LeadSheetChord {
  id?: string;
  root?: string;
  accidental?: 'b' | '#';
  quality?: string;
  bass?: {
    root: string;
    accidental?: 'b' | '#';
  };
  isRepeat?: boolean;
  isDiatonic?: boolean;
  analysis?: LeadSheetChordAnalysis;
}

export interface LeadSheetBar {
  measureNumber?: number;
  chords: LeadSheetChord[];
}

export interface LeadSheetSystem {
  sectionLabel?: string;
  hasRepeatStart?: boolean;
  hasRepeatEnd?: boolean;
  ending?: number;           // volta: 1, 2, 3 (numbered endings)
  bars: LeadSheetBar[];
}

export interface LeadSheetData {
  id?: string;
  title: string;
  style: string;
  composer: string;
  timeSignature: string;
  key?: string;
  systems: LeadSheetSystem[];
}
