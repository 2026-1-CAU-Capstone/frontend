export interface ChordPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChordGroup {
  id: number;
  type: 'ii-V-I' | 'incomplete' | 'turnaround';
  role: 'ii' | 'V' | 'I';
}

export interface ChordAnalysis {
  degree: string;
  func: 'T' | 'SD' | 'D';
  diatonic: boolean;
  group?: ChordGroup;
  secDom?: string;
  modal?: string;
}

export interface ChordOverlay {
  id: string;
  symbol: string;
  bar: number;
  pageNumber: number;
  position: ChordPosition;
  analysis: ChordAnalysis;
}

export interface TocEntry {
  title: string;
  page: number;
  children?: TocEntry[];
}

export interface SongData {
  id: string;
  title: string;
  key: string;
  chords: ChordOverlay[];
  toc: TocEntry[];
  groupExplanations: Record<number, string>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  relatedChordIds?: string[];
}
