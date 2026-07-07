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
  /** Chat-typed lick request (e.g. "찰리파커 2-5-1 릭 추천"): render each
   *  matched DB lick INLINE (numbered intro line + VexFlow card), deterministically,
   *  without depending on the LLM emitting [LICK:id] tags. The 💡-button path
   *  uses lickProgressionLabel + the tab panel instead. */
  lickInline?: boolean;
  /** Per-lick intro lines for the inline mode (templated, parallel to lickMatches). */
  lickInlineLabel?: string;
  /** 스템 분리 카드 — 오디오 첨부 + rule-based 인텐트로 생성된 어시스턴트
   *  메시지에 붙는다. File 객체를 들고 있어 비영속(세션 한정, 새로고침 시
   *  카드 소멸). 렌더는 ChatMessage → StemSplitMessage. */
  stemRequest?: import('../components/chat/StemSplitMessage').StemChatRequest;
}
