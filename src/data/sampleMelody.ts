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
  accidentals?: Record<number, '#' | 'b' | 'n'>;
  tie?: boolean;                                // tie to the NEXT note of same pitch
  tieContinuation?: boolean;                    // this note is the receiving end of a tie — visually rendered but absorbed into prev note's sound by the player
  gliss?: boolean;                              // glissando to the NEXT note
  tuplet?: number;                              // e.g. 3 = triplet (3 notes in time of 2)
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
