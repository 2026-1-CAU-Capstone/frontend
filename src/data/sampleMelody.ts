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
  doubleDotted?: boolean;                       // 겹점 — 원래 길이의 1.75배 (dotted 와 배타)
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
  /** TAB 수동 운지 — keys 인덱스별 강제 현 번호(1=가는 줄). 프렛은 음정에서
   *  자동 계산되므로 표기·소리가 어긋날 수 없다. 해당 현에서 그 음이 안 나면
   *  렌더러가 조용히 무시하고 자동 운지로 돌아간다(이조 후 안전). */
  tabStrings?: Record<number, number>;
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
  /** 대체(리하모니제이션) 코드 — 이 마디 위에 괄호로 감싸 표시되는 슬롯들.
   *  배열이 있으면 "활성화", 없으면 비활성. 빈 문자열 슬롯은 빈칸으로 렌더된다.
   *  (에디터에서 코드 칸 우클릭 → 대체 코드 추가/제거) */
  altChords?: string[];
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
  /** 다중 스태프 악보(에디터 Staff 자유 조합). **존재하면 이것이 진실**이고,
   *  `measures`/`bassMeasures`는 staves[0]의 미러다(구버전 리더·백엔드 feature
   *  계산 호환용 — pack 헬퍼가 항상 함께 채운다). 없으면 기존 단일/양손 해석. */
  staves?: SheetStaff[];
}

/* ─── 다중 스태프(보표) 모델 ──────────────────────────────────────────────
 * 에디터 정보 탭 Staff 박스의 자유 조합이 이 배열로 저장된다. 각 스태프는
 * 독립 파트(자기 마디·자기 악기)이며, 렌더 시 위에서 아래로 쌓인다.
 * 정규화/직렬화는 lib/note/sheetStaves.ts 헬퍼만 사용할 것. */

export type StaffKind =
  | 'treble'      // 높은음자리표 단일
  | 'treble-8vb'  // 높은음자리표 8vb (기타·테너 보컬 관례 — 소리는 표기보다 한 옥타브 아래)
  | 'bass'        // 낮은음자리표 단일
  | 'alto'        // 알토(C) 음자리표 — 비올라
  | 'tenor'       // 테너(C) 음자리표 — 첼로·트롬본·바순 고음역
  | 'grand'       // 피아노 양손 (measures=오른손, bassMeasures=왼손)
  | 'guitar-tab'  // 기타 TAB 6현 — keys 는 일반 음정, 운지는 렌더 시 자동 계산
  | 'bass-tab'    // 베이스 TAB 4현
  | 'bass5-tab'   // 베이스 TAB 5현 (Low B)
  | 'ukulele-tab' // 우쿨렐레 TAB 4현 (High-G 리엔트런트)
  | 'drum';       // 드럼 — keys 의 MIDI 값이 곧 GM 퍼커션 키(채널 10 재생 호환)

export interface SheetStaff {
  kind: StaffKind;
  measures: MeasureInfo[];
  /** kind='grand' 전용 — 왼손(낮은음자리표). measures 와 인덱스 1:1. */
  bassMeasures?: MeasureInfo[];
  /** 이 파트의 재생 음색(MusyngKite 악기명). 드럼 파트는 무시된다. */
  instrument?: string;
  /** TAB 전용: 위에 표준 오선도 함께 표기(같은 음 자동 동기). */
  withNotation?: boolean;
  /** TAB 전용 — 카포 프렛(0=없음). 개방현이 이만큼 올라가고 프렛 숫자는 카포
   *  기준 0부터 센다(실제 TAB 관행). 재생 음정은 데이터 keys 그대로. */
  capo?: number;
  /** TAB 전용 — 튜닝 프리셋. 생략 = 표준. drop-d 는 기타 6번줄만 D로. */
  tuningPreset?: 'standard' | 'drop-d';
  /** 기타·우쿨렐레 TAB 전용 — 마디 코드심볼로 프렛 다이어그램을 함께 표기. */
  chordDiagrams?: boolean;
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
