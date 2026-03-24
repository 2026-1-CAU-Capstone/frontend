// ─── Barlines ────────────────────────────────────────────────────────────────

/** Barline types that appear in iRealPro charts */
export type Barline =
  | 'single'       // |  LZ  Kcl
  | 'double'       // [  ]
  | 'repeatStart'  // {
  | 'repeatEnd'    // }
  | 'final';       // Z

// ─── Chord ───────────────────────────────────────────────────────────────────

export interface IRealChord {
  root: string;              // A–G
  accidental?: 'b' | '#';
  quality: string;           // raw iReal quality string (^7, -7, h, o, sus, …)
  bass?: {
    root: string;
    accidental?: 'b' | '#';
  };
}

// ─── Cells (contents of a measure) ──────────────────────────────────────────

export type IRealCell =
  | { type: 'chord';   chord: IRealChord; size?: 'small' | 'large'; fermata?: true }
  | { type: 'noChord' }           // n  → N.C.
  | { type: 'repeat' }            // x  → single-bar repeat sign (%)
  | { type: 'doubleRepeat' }      // r  → two-bar repeat sign
  | { type: 'spacer' };           // W  → invisible / implied chord

// ─── Measure ─────────────────────────────────────────────────────────────────

export interface IRealMeasure {
  chords: IRealCell[];
  timeSignature?: string;    // "4/4", "3/4", "6/8", …
  section?: string;          // A, B, C, D, i, v, …
  ending?: number;           // 1, 2, 3  (volta bracket)
  segno?: true;
  coda?: true;
  fermata?: true;            // U — fermata on barline (Fine)
  openBarline: Barline;
  closeBarline: Barline;
  comments: string[];        // <text> annotations
}

// ─── Song ────────────────────────────────────────────────────────────────────

export interface IRealSong {
  title: string;
  composer: string;
  style: string;
  key: string;
  transpose?: number;
  bpm?: number;
  repeats?: number;
  compStyle?: string;
  measures: IRealMeasure[];
}

// ─── Playlist ────────────────────────────────────────────────────────────────

export interface IRealPlaylist {
  name?: string;
  songs: IRealSong[];
}
