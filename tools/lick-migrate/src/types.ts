// Shape of entries in /public/data/licks/user_licks.json
export interface SourceLick {
  id: number;
  performer: string;
  title: string;
  album?: string | null;
  instrument: string;
  style?: string | null;
  tempo?: number | null;
  key: string;
  rhythmfeel?: string | null;
  tag?: string | null;
  chords: string[];
  nEvents?: number | null;
  label?: string | null;
  sheetData: SourceSheetData;
}

export interface SourceSheetData {
  title?: string;
  composer?: string;
  key?: string;
  timeSignature?: string;
  tempo?: number;
  measures: SourceMeasure[];
}

export interface SourceMeasure {
  chord?: string;
  notes: SourceNote[];
}

export interface SourceNote {
  keys: string[];
  duration: string;
  accidentals?: Record<string, string>;
  tuplet?: number;
  dotted?: boolean;
  tie?: boolean;
  gliss?: boolean;
  beamBreak?: boolean;
}

// Shape required by POST /v1/licks (LickCreateRequest)
export interface LickCreateRequest {
  source: "user" | "weimar" | "curated";
  userId: string | null;
  performer?: string | null;
  title: string;
  album?: string | null;
  instrument: "as" | "ts" | "tp" | "p" | "g" | "b" | "voc" | "cl";
  style?: "SWING" | "BEBOP" | "HARDBOP" | "COOL" | "MODAL" | "FUSION" | null;
  tempo?: number | null;
  key?: string | null;
  rhythmFeel?: "SWING" | "STRAIGHT" | "BOSSA" | "LATIN" | null;
  timeSignature?: string | null;
  chords?: string[];
  chordsPerNote?: string[] | null;
  harmonicContext?: string | null;
  targetChord?: string | null;
  sheetData: SheetDataRequest;
  features?: null;
}

export interface SheetDataRequest {
  title?: string;
  composer?: string;
  key?: string;
  timeSignature?: string;
  tempo?: number;
  measures: MeasureRequest[];
}

export interface MeasureRequest {
  chord?: string;
  notes: NoteInfoRequest[];
}

export interface NoteInfoRequest {
  keys: string[];
  duration: string;
  accidentals?: Record<string, string>;
  tuplet?: number;
  dotted?: boolean;
  tie?: boolean;
  gliss?: boolean;
  beamBreak?: boolean;
}

export interface SuccessRecord {
  id: number;
  title: string;
  performer: string;
  publicId: string;
  http_status: number;
}

export interface FailureRecord {
  id: number;
  title: string;
  performer: string;
  http_status: number | null;
  error: string;
  body_tail: string;
}
