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
  functions?: { function: string; confidence: number; note?: string }[];
  groupMemberships?: { groupId: number; groupType: string; role: string; variant: string }[];
  modalInterchange?: { sourceMode: string; borrowedDegree: string };
  subV?: { targetDegree: string; targetRootPc: number; originalVLabel: string };
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
  /** Chord duration in beats within its bar (from OMR `durationBeats`). When
   *  present, playback uses it instead of splitting the bar evenly across the
   *  bar's chords. Lets a bar like `Dm(2) Bdim(1) Bb(1)` play with the right
   *  lengths instead of three equal thirds. */
  durationBeats?: number;
}

export interface LeadSheetBar {
  measureNumber?: number;
  ending?: number;           // volta bracket starts at this bar (1, 2, 3)
  chords: LeadSheetChord[];
  /** 이 마디에 붙는 가사 — 절 순서대로 한 줄씩(0번=1절). 코드차트는 음표가
   *  없어 음절을 음에 붙일 수 없으므로, 악보(NoteSheet)의 음절 단위와 달리
   *  **마디 단위 텍스트**로 둔다(보컬이 코드차트를 보며 부를 때의 실제 쓰임). */
  lyrics?: string[];
}

export interface LeadSheetSystem {
  sectionLabel?: string;
  label?: string;
  hasRepeatStart?: boolean;
  hasRepeatEnd?: boolean;
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
