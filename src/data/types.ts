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
  /** 페이지별 악보 이미지 경로 (pageNumber → URL) */
  scoreImages: Record<number, string>;
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
  selectedChords?: ChordOverlay[];
  /** Attached images (base64, no data: prefix) shown as thumbnails in the
   *  user bubble. Matches the ClaudeImage shape sent to the vision API. */
  images?: { mediaType: string; data: string }[];
  /** 릭 추천 메시지일 때 매칭된 릭 목록 (LickMatch[]이지만 순환 참조 방지로 any) */
  lickMatches?: import('../lib/lickMatcher').LickMatch[];
  savedLickMatches?: import('../lib/lickMatcher').LickMatch[];
  lickProgressionLabel?: string;
}
