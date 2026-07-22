/* ─── Types ─────────────────────────────────────────────────────────────── */

export type Articulation =
  | 'staccato'        // ·  short
  | 'staccatissimo'   // very short (filled wedge)
  | 'accent'          // >
  | 'tenuto'          // –
  | 'marcato'         // ^  strong accent
  | 'detached-legato'; // –· tenuto + staccato

export type Ornament =
  | 'trill'           // tr
  | 'mordent'         // ✱
  | 'inverted-mordent'
  | 'turn'
  | 'inverted-turn'
  | 'tremolo';

export type Dynamic =
  | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'
  | 'sfz' | 'fp';

export interface NoteInfo {
  keys: string[];                               // VexFlow keys e.g. ['c/5']
  duration: string;                             // 'w','h','q','8','16' or 'wr','hr','qr','8r'
  dotted?: boolean;
  accidentals?: Record<number, '#' | 'b' | 'n' | '##' | 'bb'>;
  tie?: boolean;                                // tie to the NEXT note of same pitch
  tieContinuation?: boolean;                    // this note is the receiving end of a tie — visually rendered but absorbed into prev note's sound by the player
  gliss?: boolean;                              // glissando to the NEXT note
  scoop?: boolean;                              // 스쿱 — 음표 앞에서 아래→위로 끌어올려 진입하는 곡선(재즈 슬라이드)
  fall?: boolean;                               // 폴 — 음표 뒤에서 아래로 떨어지는 곡선(재즈 슬라이드)
  tuplet?: number;                              // actual-notes (e.g. 3 = triplet, 5 = quintuplet)
  tupletNormal?: number;                        // normal-notes — denominator in N:M ratio (e.g. 3:2, 5:4, 7:6). Inferred from `tuplet` when absent.
  tupletBracket?: boolean;                      // set on the FIRST note of a tuplet group; whether to draw the bracket (XML <tuplet bracket="yes|no">). Default true.
  beamBreak?: boolean;                          // force beam break AFTER this note (= XML <beam>end</beam>)
  noBeam?: boolean;                             // render as a standalone flagged note (= XML beamable note with no <beam>)
  restInBeam?: boolean;                         // rest that sits inside an open beam group — keep the beam line going over it instead of flushing

  stem?: 'up' | 'down';                         // explicit stem direction (= XML <stem>); overrides autoStem
  chord?: string;                               // chord change at this note position
  ghost?: boolean;                              // ghost note — rendered in parentheses ()
  ottavaStart?: '8va' | '8vb';                 // start of ottava bracket at this note
  ottavaEnd?: boolean;                          // end of ottava bracket at this note

  // ── Phrasing & expression (MusicXML import) ─────────────────────────────
  slurStart?: boolean;                          // <slur type="start"/> at this note
  slurStop?: boolean;                           // <slur type="stop"/> at this note
  articulations?: Articulation[];               // staccato/accent/tenuto/...
  fermata?: boolean;                            // fermata 𝄐 over the note
  ornaments?: Ornament[];                       // trill/mordent/turn/...
  dynamics?: Dynamic;                           // dynamic marking placed at this note onset
  hairpinStart?: 'cresc' | 'dim';               // start of < or > hairpin
  hairpinStop?: boolean;                        // end of an active hairpin
  grace?: boolean;                              // grace note (small/acciaccatura)
  graceSlash?: boolean;                         // acciaccatura slash (true) vs appoggiatura (false)
}

export type NavigationMarker =
  | 'segno' | 'coda' | 'fine' | 'toCoda'
  | 'dc' | 'dcAlCoda' | 'dcAlFine'
  | 'ds' | 'dsAlCoda' | 'dsAlFine';

export interface MeasureInfo {
  notes: NoteInfo[];
  chord?: string;
  repeatStart?: boolean;   // 𝄆 repeat begin barline
  repeatEnd?: boolean;     // 𝄇 repeat end barline
  volta?: number;          // volta bracket ending number (1, 2, 3, ...)
  navigation?: NavigationMarker;  // D.C., D.S., Coda, Fine, etc.
  bracket?: boolean;              // intro bracket — skipped on loop, jumps to first chord measure

  // ── Mid-piece changes from MusicXML <attributes> mid-stream ─────────────
  timeSignature?: string;         // override at this measure (e.g. '3/4' switch)
  key?: string;                   // override key (display name like 'F' / 'Eb')
  clef?: 'treble' | 'bass' | 'alto' | 'tenor'; // mid-piece clef change
  anacrusis?: boolean;            // pickup measure — fewer beats than time sig
  tempo?: number;                 // mid-piece tempo change (BPM, quarter=N)
}

export interface NoteSheetData {
  title: string;
  composer: string;
  key: string;
  timeSignature: string;
  tempo?: number;
  genre?: string;
  measures: MeasureInfo[];
  /** Multi-part scores: MusyngKite instrument name for THIS part's timbre
   *  (resolved from its GM program). Drives per-part playback timbre.
   *  Omitted → default melody instrument. */
  instrument?: string;
  /** True when this part is a channel-10 percussion staff — its notes are GM
   *  percussion keys played through the drum sampler, not pitched. */
  isDrum?: boolean;
  /** 양손(그랜드 스태프) 악보의 왼손(낮은음자리표) 파트. `measures`와 같은
   *  인덱스로 마디가 1:1 정렬된다(모자라면 빈 마디). 존재하면 양손 악보. */
  bassMeasures?: MeasureInfo[];
  /** 임시표 의미론. 'explicit'이면 조표를 무시하고 마디 안의 ♯/♭(마디 내 상속
   *  포함)만으로 음정을 판단·표기한다(조표를 안 그린 악보 전용). 생략/'score'면
   *  조표+마디 상속(기본). 렌더러(NoteSheet)·플레이어(GlobalPlayer) 공통 소비. */
  accidentalStyle?: 'explicit' | 'score';
}

/* ─── Sample: 16-bar jazz melody in C major ─────────────────────────────── */

export const sampleMelody: NoteSheetData = {
  title: 'Blues for Alice',
  composer: 'Charlie Parker',
  key: 'C',
  timeSignature: '4/4',
  measures: [
    // ── Line 1 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
      ],
    },
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['g/5'], duration: '8' },
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q', dotted: true },
        { keys: ['e/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['a/5'], duration: 'q' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/5'], duration: 'h' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
      ],
    },

    // ── Line 2 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['e/5'], duration: 'q' },
        { keys: ['b/4'], duration: 'qr' },
        { keys: ['d/5'], duration: '8' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['c/5'], duration: 'q' },
      ],
    },
    {
      chord: 'A-7',
      notes: [
        { keys: ['a/4'], duration: '8' },
        { keys: ['b/4'], duration: '8' },
        { keys: ['c/5'], duration: '8' },
        { keys: ['d/5'], duration: '8' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['c/5'], duration: 'q' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['d/5'], duration: 'h' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/4'], duration: 'w' },
      ],
    },

    // ── Line 3 ──
    {
      chord: 'E-7',
      notes: [
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['b/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
      ],
    },
    {
      chord: 'A7',
      notes: [
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q', accidentals: { 0: '#' } },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['f/5'], duration: 'q' },
      ],
    },
    {
      chord: 'G7',
      notes: [
        { keys: ['g/5'], duration: 'h' },
        { keys: ['b/4'], duration: 'hr' },
      ],
    },

    // ── Line 4 ──
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'q' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['c/6'], duration: 'q' },
      ],
    },
    {
      chord: 'FΔ7',
      notes: [
        { keys: ['a/5'], duration: '8' },
        { keys: ['g/5'], duration: '8' },
        { keys: ['f/5'], duration: 'q' },
        { keys: ['e/5'], duration: 'h' },
      ],
    },
    {
      chord: 'D-7  G7',
      notes: [
        { keys: ['d/5'], duration: 'q' },
        { keys: ['e/5'], duration: '8' },
        { keys: ['f/5'], duration: '8' },
        { keys: ['g/5'], duration: 'q' },
        { keys: ['b/4'], duration: 'q' },
      ],
    },
    {
      chord: 'CΔ7',
      notes: [
        { keys: ['c/5'], duration: 'w' },
      ],
    },
  ],
};
