/* ─────────────────────────────────────────────────────────────────────────
 * chordDb — 기타 코드 다이어그램의 **데이터 원천**.
 *
 * 운지를 계산하지 않는다. `@tombatossals/chords-db`(MIT) 의 사람이 검수한 폼을
 * 그대로 조회한다.
 *
 * 왜 계산을 버렸는가: 이전 구현(chordDiagram.ts 의 assignTabPositions)은 코드톤을
 * 셸 스택으로 쌓아 스팬이 가장 좁은 해를 골랐다. 그 방식은 관용 폼을 못 낸다 —
 * 실측으로 대표 16개(C·A·G·E·D·Am·Em·Dm·G7·C7·E7·A7·Cmaj7·Dm7·Am7·Fmaj7) 중
 * **0개**만 일치했다. C 가 `x320xx`(3음 없는 셸)로 나오는데, 기타리스트가 아는
 * C 는 `x32010` 이다. 잡을 수는 있어도 아는 폼이 아니면 다이어그램의 의미가 없다.
 *
 * 데이터에 없는 코드는 **다이어그램을 그리지 않는다**(null). 지어낸 운지를 보여주는
 * 것보다 아무것도 안 보여주는 게 맞다.
 *
 * 데이터는 **동적 import** 로 별도 청크에 둔다(guitar.json 238KB). 다이어그램을
 * 켜지 않은 사용자는 내려받지 않는다.
 * ──────────────────────────────────────────────────────────────────────── */

/** chords-db 의 한 폼. `frets` 는 **6번줄(굵은 E)부터** — `[-1,3,2,0,1,0]` = x32010. */
export interface DbPosition {
  /** 현별 프렛. -1 = 뮤트, 0 = 개방. 6번줄 → 1번줄 순서. */
  frets: number[];
  /** 손가락 번호(0 = 안 씀). frets 와 같은 순서. */
  fingers: number[];
  /** 그리드 왼쪽 라벨 프렛. 1이면 너트.
   *
   * ⚠️ 프렛 값 해석 규격(실측으로 확정) — `absoluteFret()` 를 반드시 경유한다:
   *   `0` = **개방현**(baseFret 과 무관한 절대값)
   *   그 외 = baseFret 상대 → 실제 프렛 = `f + baseFret - 1`
   *
   * "모든 값을 baseFret 상대로" 보면 2069개 중 193개(9.3%)가 데이터의 `midi` 와
   * 어긋난다. 이 규격으로는 **2069개 전부 일치**한다. 잘못 보면 바레 코드가
   * 엉뚱한 프렛에 그려진다. */
  baseFret: number;
  /** 바레 구간(해당 프렛 번호들). */
  barres: number[];
  /** 실제 울리는 음의 MIDI 번호 — 검증에 쓴다. */
  midi: number[];
}

interface DbFile {
  tunings: Record<string, string[]>;
  suffixes: string[];
  chords: Record<string, Array<{ key: string; suffix: string; positions: DbPosition[] }>>;
}

/* ── 루트 표기 변환 ─────────────────────────────────────────────────────
 * chords-db 는 루트를 `C · Csharp · D · Eb · E · F · Fsharp · G · Ab · A · Bb · B`
 * 로 쓴다(샵/플랫이 섞여 있다). 우리 심볼은 `C#`·`Db` 둘 다 나온다. 12음을
 * 음정 번호로 정규화한 뒤 데이터의 표기로 되돌린다 — 이름을 문자열로 맞추려 하면
 * 이명동음(C# = Db)에서 어긋난다. */
const PITCH: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
/** 음정 번호 → chords-db 의 루트 키. 데이터가 쓰는 표기를 그대로 옮긴 것이다. */
const DB_ROOT: readonly string[] = [
  'C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B',
];

/** `C#` · `Db` · `Bb` 같은 루트 문자열 → 음정 번호(0~11). 못 읽으면 null. */
export function rootToPitch(root: string): number | null {
  const m = root.match(/^([A-Ga-g])([#♯b♭]*)/);
  if (!m) return null;
  let p = PITCH[m[1].toUpperCase()];
  if (p === undefined) return null;
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') p += 1;
    else if (ch === 'b' || ch === '♭') p -= 1;
  }
  return ((p % 12) + 12) % 12;
}

/* ── 퀄리티 표기 변환 ───────────────────────────────────────────────────
 * 왼쪽은 **우리 앱이 쓰는 표기**, 오른쪽은 **데이터에 실제로 존재하는 suffix** 다.
 * 오른쪽 값은 guitar.json 의 `suffixes` 63개에서 그대로 가져왔다 — 없는 이름을
 * 지어내면 조회가 조용히 실패한다.
 *
 * 여기 없는 퀄리티는 다이어그램을 그리지 않는다. 임의로 가까운 폼을 갖다 붙이면
 * 사용자가 다른 코드를 짚게 된다. */
const SUFFIX_ALIAS: Readonly<Record<string, string>> = {
  /* 3화음 */
  '': 'major', 'M': 'major', 'maj': 'major',
  'm': 'minor', 'min': 'minor', '-': 'minor',
  'dim': 'dim', '°': 'dim', 'o': 'dim',
  'aug': 'aug', '+': 'aug',
  'sus': 'sus4', 'sus2': 'sus2', 'sus4': 'sus4',
  /* 6·7 계열 */
  '6': '6', '69': '69', '6/9': '69',
  '7': '7', '7sus4': '7sus4', '7b5': '7b5', '7#5': 'aug7', 'aug7': 'aug7',
  '7b9': '7b9', '7#9': '7#9', 'alt': 'alt',
  'dim7': 'dim7', '°7': 'dim7', 'o7': 'dim7',
  /* 메이저 7 계열 — △ 글리프도 받는다(앱 표기) */
  'maj7': 'maj7', 'M7': 'maj7', '△7': 'maj7', '△': 'maj7',
  'maj7b5': 'maj7b5', 'maj7#5': 'maj7#5',
  'maj9': 'maj9', '△9': 'maj9', 'maj11': 'maj11', 'maj13': 'maj13',
  /* 마이너 계열 */
  'm6': 'm6', 'm69': 'm69', 'm6/9': 'm69',
  'm7': 'm7', 'min7': 'm7', '-7': 'm7',
  'm7b5': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'm7-5': 'm7b5',
  'm9': 'm9', 'm11': 'm11',
  'mmaj7': 'mmaj7', 'mM7': 'mmaj7', 'm△7': 'mmaj7',
  'mmaj9': 'mmaj9', 'mmaj11': 'mmaj11', 'mmaj7b5': 'mmaj7b5',
  /* 텐션 */
  '9': '9', '9b5': '9b5', '9#11': '9#11', 'aug9': 'aug9', '11': '11', '13': '13',
  'add9': 'add9', 'madd9': 'madd9',
};

/**
 * 데이터의 프렛 값 → 실제 프렛 번호.
 *
 * `0`(개방현)은 baseFret 을 더하지 않는다. 예: Csus2 `frets=[2,-1,0,1,2,2] baseFret=7`
 * 에서 3번 값 `0` 은 7프렛이 아니라 **개방 D현**이다(데이터의 `midi` 가 그렇게 말한다).
 * 이 구분을 빼먹으면 데이터 2069개 중 193개가 틀리게 해석된다.
 *
 * @returns 실제 프렛(0 = 개방). 뮤트(-1)는 호출부가 걸러야 한다.
 */
export function absoluteFret(fret: number, baseFret: number): number {
  return fret === 0 ? 0 : fret + baseFret - 1;
}

/** 폼이 실제로 울리는 음(MIDI). 표준 튜닝 6→1번줄. 검증·재생에 쓴다. */
export function positionMidi(p: DbPosition, tuning: readonly number[] = GUITAR_STANDARD): number[] {
  return p.frets
    .map((f, i) => (f < 0 ? null : tuning[i] + absoluteFret(f, p.baseFret)))
    .filter((v): v is number => v !== null);
}

/** 표준 튜닝 — **6번줄(굵은 E)부터**. chords-db 의 frets 순서와 같다. */
export const GUITAR_STANDARD: readonly number[] = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

let cache: DbFile | null = null;
let loading: Promise<DbFile> | null = null;

/** 데이터 파일을 한 번만 받아 온다. 실패하면 throw — 호출부가 다이어그램을 끈다. */
export async function loadGuitarDb(): Promise<DbFile> {
  if (cache) return cache;
  if (!loading) {
    loading = import('@tombatossals/chords-db/lib/guitar.json')
      .then((m) => {
        cache = (m.default ?? m) as unknown as DbFile;
        return cache;
      });
  }
  return loading;
}

/** 이미 받아 둔 데이터(없으면 null). 렌더 중 동기 조회용. */
export function guitarDbSync(): DbFile | null {
  return cache;
}

/**
 * 루트 + 퀄리티 → 폼 목록. 데이터에 없으면 빈 배열.
 *
 * @param root  `C` · `C#` · `Bb` 같은 루트 문자열
 * @param qual  우리 앱 표기의 퀄리티(`m7` · `△7` · `7b9` …). 빈 문자열이면 메이저
 */
export function lookupPositions(db: DbFile, root: string, qual: string): DbPosition[] {
  const pitch = rootToPitch(root);
  if (pitch === null) return [];
  const suffix = SUFFIX_ALIAS[qual.trim()];
  if (!suffix) return [];                       // 모르는 퀄리티 — 지어내지 않는다
  const entries = db.chords[DB_ROOT[pitch]];
  if (!entries) return [];
  /* 데이터의 순서를 그대로 쓴다.
   *
   * "루트가 최저음인 폼을 앞으로" 라는 규칙을 넣어 봤는데 **측정해 보니 더 나빠졌다** —
   * Cmaj7 이 `332000`(관용형에 가까움) 대신 `xx10121212`(고포지션)로, Gm7 이
   * `355333`(관용 바레) 대신 `353333` 으로 바뀌었다. 관용 폼 일치가 17/20 → 17/20 인데
   * 내용이 나빠진 것이다.
   *
   * 데이터는 사람이 검수한 것이고 첫 폼이 그쪽의 추천이다. 내가 "관용형"이라 여기는
   * 기준으로 재정렬하는 건 결국 **선호를 발명하는 것**이라, 하지 않는다. 특정 코드의
   * 순서가 마음에 안 들면 그때 그 코드만 데이터를 보고 정하는 게 맞다. */
  return entries.find((e) => e.suffix === suffix)?.positions ?? [];
}

/** 데이터가 다루는 퀄리티인가 — 설정 화면에서 커버리지를 보여줄 때 쓴다. */
export function isSupportedQuality(qual: string): boolean {
  return SUFFIX_ALIAS[qual.trim()] !== undefined;
}
