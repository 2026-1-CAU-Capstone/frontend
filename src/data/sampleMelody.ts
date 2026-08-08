/* ─── Types ─────────────────────────────────────────────────────────────── */

export type Articulation =
  | 'staccato'        // ·  short
  | 'staccatissimo'   // very short (filled wedge)
  | 'accent'          // >
  | 'tenuto'          // –
  | 'marcato'         // ^  strong accent
  | 'detached-legato' // –· tenuto + staccato
  | 'harmonic'        // ○  natural harmonic
  | 'lh-pizz'         // +  left-hand pizzicato
  | 'snap-pizz'       // ◦| snap(Bartók) pizzicato
  | 'up-bow'          // V  up bow / up stroke
  | 'down-bow';       // ⊓  down bow / down stroke

export type Ornament =
  | 'trill'           // tr
  | 'mordent'         // ✱
  | 'inverted-mordent'
  | 'turn'
  | 'inverted-turn'
  | 'tremolo';

export type Dynamic =
  | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'
  | 'fp' | 'pf' | 'sf' | 'sfz' | 'sff' | 'sffz' | 'sfp'
  | 'rfz' | 'rf' | 'fz';

/** 한 음표에 붙는 가사 음절 하나(= MusicXML `<lyric>` 하나). */
export interface LyricSyllable {
  /** 절 번호 — MusicXML `<lyric number>`. 1절, 2절… (기본 1) */
  verse: number;
  /** 음절 텍스트 ('Beau', 'ti', 'ful', 'love,') */
  text: string;
  /** 낱말 안에서의 위치 — 하이픈을 그릴지 판단한다.
   *  `begin`/`middle` 뒤에는 다음 음절로 이어지는 하이픈이 붙는다. */
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  /** 멜리스마 — 한 음절이 다음 음표들까지 이어진다(`<extend/>`). 밑줄로 그린다. */
  extend?: boolean;
}

export interface NoteInfo {
  keys: string[];                               // VexFlow keys e.g. ['c/5']
  duration: string;                             // 'w','h','q','8','16' or 'wr','hr','qr','8r'
  dotted?: boolean;
  doubleDotted?: boolean;                       // 겹점 — 원래 길이의 1.75배 (dotted 와 배타)
  accidentals?: Record<number, '#' | 'b' | 'n' | '##' | 'bb'>;
  tie?: boolean;                                // tie to the NEXT note of same pitch
  tieContinuation?: boolean;                    // this note is the receiving end of a tie — visually rendered but absorbed into prev note's sound by the player
  /** 화음에서 **일부 음만** 타이로 묶일 때의 keys[] 인덱스 목록(예: 베이스만
   *  붙잡고 윗성부는 움직이는 보이싱). 생략하면 keys 전체가 타이 대상이다.
   *  타이로 넘어온 음은 임시표를 다시 찍지 않으므로, 이 구분이 없으면 안 묶인
   *  음의 ♭/♯ 까지 함께 사라진다(MusicXML 원본 대조에서 실제로 발견). */
  tieKeys?: number[];
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
  /** 노트헤드 모양 — MusicXML `<notehead>`. 생략하면 일반 머리.
   *  재즈 채보에서 가장 흔한 건 `slash`(리듬 슬래시 = 컴핑 지시)다. 이건 음정이
   *  아니라 리듬만 뜻하므로 **소리 나지 않는다**(고정 자리음 D3 등이 그대로
   *  울리면 멜로디 밑에 엉뚱한 저음이 계속 깔린다). */
  notehead?: 'slash' | 'x' | 'diamond' | 'triangle-up' | 'triangle-down' | 'square' | 'circle-x';
  /** 큐 음표(MusicXML `<cue>`) — 참고용 작은 음표. 규격상 연주하지 않는다. */
  cue?: boolean;
  /** TAB 수동 운지 — keys 인덱스별 강제 현 번호(1=가는 줄). 프렛은 음정에서
   *  자동 계산되므로 표기·소리가 어긋날 수 없다. 해당 현에서 그 음이 안 나면
   *  렌더러가 조용히 무시하고 자동 운지로 돌아간다(이조 후 안전). */
  tabStrings?: Record<number, number>;
  /** 음표 위 텍스트(연주 지시 — pizz./arco/mute/legato 등 자유 문자열). */
  textAbove?: string;
  /** 가사 음절 — 이 음표에 붙는 절(verse)별 음절. MusicXML `<lyric>` 1:1 대응.
   *  보컬용 리드시트에서 음표 아래에 절 순서대로 쌓여 그려진다. */
  lyrics?: LyricSyllable[];
  /** 서스테인 페달 시작(Ped.) / 끝(*) — 같은 줄 안에서만 그려진다. */
  pedalStart?: boolean;
  pedalEnd?: boolean;
  ottavaStart?: '8va' | '8vb' | '15ma' | '15mb'; // start of ottava/quindicesima bracket at this note
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
  /** 이 마디의 끝 세로줄 오버라이드 — 겹줄·끝줄·숨김. 도돌이 표시가 있으면 그쪽 우선. */
  barline?: 'double' | 'end' | 'none';
  /** 리허설 마크(A, B1 …) — 마디 시작 위에 네모 상자로 표기. */
  rehearsal?: string;
  /** 이 마디 뒤에서 줄바꿈 강제(시스템 브레이크). */
  lineBreak?: boolean;
  /** 보이스 2 — 같은 보표의 두 번째 성부(기둥 아래 방향). notes(보이스 1)와
   *  독립 타임라인이며 재생 시 별도 파트로 합쳐진다. */
  voice2?: NoteInfo[];
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
  /** 이조 악기 파트의 **적힌 음 → 울리는 음** 반음 차(MusicXML `<transpose>`).
   *  B♭ 트럼펫 = −2, E♭ 알토색소폰 = −9. 악보는 적힌 음 그대로 그리고(연주자가
   *  그렇게 읽는다) **재생할 때만** 이 값을 더한다. 없으면 조옮김 없음(C 악기). */
  transposeSemis?: number;
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
