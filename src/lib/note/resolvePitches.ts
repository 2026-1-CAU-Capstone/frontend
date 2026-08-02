/* ─────────────────────────────────────────────────────────────────────────
 * Sounding-pitch resolution — the PLAYBACK/TRANSPOSE twin of
 * measureAccidentals.ts (which decides what GLYPH to print).
 *
 * 데이터에는 두 가지 임시표 의미론이 공존한다:
 *
 *   • 'score'    — NoteSheet(courtesy) 로 렌더되는 악보 데이터(OMR/MusicXML
 *                  솔로). 표준 기보 규칙: 명시 임시표가 없으면 "같은 마디의
 *                  같은 글자+옥타브에 앞서 나온 임시표 → 조표 → 내추럴" 순으로
 *                  상속된다. (같은 마디의 두 번째 B♭은 글리프 없이 저장됨.)
 *   • 'explicit' — 릭/에디터 입력 데이터. 임시표 필드가 곧 소리: 명시가 없으면
 *                  그 글자의 내추럴이다. (LickCard 의 non-courtesy 렌더와 쌍.)
 *
 * 재생·이조가 이 규칙을 무시하고 글리프 필드만 읽으면, 조표가 있는 키나
 * 마디 내 반복 임시표에서 반음이 틀린다(예: 이조 후 "b 안 붙은" 음들).
 * 반드시 이 모듈을 경유해 소리 피치를 구할 것.
 * ──────────────────────────────────────────────────────────────────────── */
import type { MeasureInfo, NoteInfo } from '../../data/sampleMelody';

export type AccGlyph = '#' | 'b' | 'n' | '##' | 'bb';
export type AccidentalStyle = 'score' | 'explicit';

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACC_SEMI: Record<AccGlyph, number> = { '#': 1, b: -1, n: 0, '##': 2, bb: -2 };

/* ── key signature (letter-lowercase → 'b'|'#') — NoteSheet 과 동일 규칙 ── */
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const KS_FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const KS_SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

/** 'G-maj' / 'Eb-min' / 'Em' / 'C' 등 잡다한 표기 → 조표 조회용 정규형. */
export function normalizeKeyName(raw: string | undefined | null): string {
  const k = (raw ?? '').trim();
  if (!k) return 'C';
  const hy = k.match(/^([A-G][b#♭♯]?)-?(maj|min|major|minor)$/i);
  if (hy) {
    const root = hy[1].replace('♭', 'b').replace('♯', '#');
    const v = /min/i.test(hy[2]) ? root + 'm' : root;
    return (v in KS_FLAT_KEYS || v in KS_SHARP_KEYS || v === 'C' || v === 'Am') ? v : 'C';
  }
  const clean = k.replace('♭', 'b').replace('♯', '#');
  if (clean in KS_FLAT_KEYS || clean in KS_SHARP_KEYS || clean === 'C' || clean === 'Am') return clean;
  const stripped = clean.split('-')[0];
  if (stripped in KS_FLAT_KEYS || stripped in KS_SHARP_KEYS || stripped === 'C' || stripped === 'Am') return stripped;
  return 'C';
}

export function keySigLetterMap(rawKey: string | undefined | null): Map<string, 'b' | '#'> {
  const key = normalizeKeyName(rawKey);
  const map = new Map<string, 'b' | '#'>();
  const nFlats = KS_FLAT_KEYS[key];
  if (nFlats) for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b');
  const nSharps = KS_SHARP_KEYS[key];
  if (nSharps) for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#');
  return map;
}

/* ── per-note sounding accidental ────────────────────────────────────────
 * measureAccidentals.resolveMeasureAccidental 과 동일한 상태 전이를 쓰되
 * "인쇄할 글리프" 대신 "소리 나는 반음 변화"를 돌려준다. active 맵은 마디마다
 * 새로 만들어 음표 순서대로 호출한다(글자+옥타브 스코프 — Gould 규칙). */
export function soundingAccidental(
  active: Map<string, AccGlyph>,
  keySig: Map<string, 'b' | '#'>,
  vexKey: string,                 // 'e/4' (letter+octave; baked 'eb/4'는 그대로 키)
  dataAcc: AccGlyph | undefined,
  style: AccidentalStyle,
): AccGlyph | undefined {
  const letter = vexKey.split('/')[0];
  if (dataAcc) {
    active.set(vexKey, dataAcc);
    return dataAcc;
  }
  // baked 표기('eb/4')는 글자에 이미 임시표가 박혀 있다 — 그 자체가 소리
  // (midiFromKey/vexKeyToMidi 가 baked 를 읽으므로 여기선 추가 변화 없음).
  if (/^[a-gA-G](##?|bb?|n)$/.test(letter)) return undefined;
  if (style === 'explicit') return undefined; // 명시 없음 = 내추럴
  // score: 마디 내 상속 → 조표 → 내추럴
  const inherited = active.get(vexKey) ?? keySig.get(letter);
  return inherited === 'n' ? undefined : inherited;
}

export function midiFromKey(vexKey: string, acc: AccGlyph | undefined): number {
  const [notePart, octStr] = vexKey.split('/');
  let s = SEMI_MAP[notePart[0]] ?? 0;
  const baked = notePart.slice(1);
  if (baked && baked in ACC_SEMI) s += ACC_SEMI[baked as AccGlyph];
  if (acc) s += ACC_SEMI[acc];
  return (parseInt(octStr, 10) + 1) * 12 + s;
}

/** 마디별·음표별·keys 인덱스별 소리 MIDI (쉼표는 null). 옥타브(8va) 미적용 —
 *  호출자가 자기 ottava 상태로 ±12 를 더한다(어댑터/에디터 재생과 동일 계약). */
export function resolveSheetMidis(
  measures: MeasureInfo[],
  sheetKey: string | undefined,
  style: AccidentalStyle,
): (number[] | null)[][] {
  let keySig = keySigLetterMap(sheetKey);
  return measures.map((m) => {
    if (m.key) keySig = keySigLetterMap(m.key); // 곡 중간 조성 변경
    const active = new Map<string, AccGlyph>();
    return m.notes.map((n) => {
      if (n.duration.endsWith('r')) {
        // 쉼표도 상태에는 영향 없음 — null 반환만.
        return null;
      }
      const midis = n.keys.map((k, ki) => {
        const acc = soundingAccidental(active, keySig, k, n.accidentals?.[ki] as AccGlyph | undefined, style);
        return midiFromKey(k, acc);
      });
      return midis;
    });
  });
}

/* ── 임시표 재-방출 (이조 출력·릭 추출용) ──────────────────────────────── */

interface SoundingNote {
  /** 글자 기반 vex key ('e/4') — baked 없이 letter+octave 만. */
  vexKey: string;
  /** 소리 나는 반음 변화 (natural 이면 undefined). */
  acc: AccGlyph | undefined;
}

/** 소리 피치에 표기 임시표를 다시 붙인다 — **조표 기준** 명시.
 *
 *  규칙: 음의 소리 임시표가 그 글자의 조표 기본값과 다르면 항상 글리프를
 *  붙이고(비다이어토닉·조표 취소 내추럴 포함), 같으면 생략한다(조표가 제공).
 *
 *  마디 내 "상속"으로 생략하지 않는 이유: 이 데이터는 courtesy 렌더러
 *  (measureAccidentals, NoteSheet)와 score 플레이어가 함께 읽는다. 렌더러는
 *  "임시표 필드 없음"을 (조표에 없는 글자면) 내추럴 취소로 해석하므로, 상속
 *  최소화로 둘째 음의 글리프를 생략하면 조표 밖 임시표(예: C조의 반복 A♭)가
 *  화면에 내추럴로 잘못 그려진다. XML 파서도 <alter>마다 임시표를 명시
 *  저장하므로, 그 표현(조표 대비 명시)에 맞춘다 — 소리·표시 둘 다 정확. */
export function emitScoreAccidentals(
  perNoteSounding: SoundingNote[][][],  // [measure][note][keyIdx]
  measures: MeasureInfo[],
  sheetKey: string,
): MeasureInfo[] {
  let keySig = keySigLetterMap(sheetKey);
  return measures.map((m, mi) => {
    if (m.key) keySig = keySigLetterMap(m.key); // 곡 중간 조성 변경(이미 이조된 값)
    const active = new Map<string, AccGlyph>(); // 마디 내 pitch별 유효 임시표
    return {
      ...m,
      notes: m.notes.map((n, ni) => {
        if (n.duration.endsWith('r')) return n;
        const sounding = perNoteSounding[mi]?.[ni];
        if (!sounding) return n;
        const keys: string[] = [];
        let accOut: Record<number, AccGlyph> | undefined;
        sounding.forEach((s, ki) => {
          keys[ki] = s.vexKey;
          const letter = s.vexKey.split('/')[0];
          const keySigDefault = keySig.get(letter) ?? undefined; // 'b'|'#'|undefined(natural)
          const wanted = s.acc ?? undefined;                     // undefined = natural
          // 이 시점 독자의 기본 가정: 마디 내 앞선 임시표가 있으면 그것, 없으면 조표.
          const inBar = active.get(s.vexKey);
          const assumed = (inBar ?? keySigDefault) === 'n' ? undefined : (inBar ?? keySigDefault);
          // 명시 조건: (1) 조표와 다름 — 비다이어토닉은 반복돼도 매번 명시해야
          // courtesy 렌더러가 상속 취소로 오표시하지 않는다(중복은 렌더러가
          // 알아서 억제). (2) 마디 내 유효 상태와 다름 — 앞선 내추럴/임시표를
          // 덮어써 소리를 보존한다. 둘 중 하나면 글리프를 붙인다.
          if (wanted !== keySigDefault || wanted !== assumed) {
            (accOut ??= {})[ki] = wanted ?? 'n';
            active.set(s.vexKey, wanted ?? 'n');
          } else {
            // 생략해도 독자·플레이어가 같은 소리로 읽는 경우만 여기 온다.
            active.set(s.vexKey, wanted ?? 'n');
          }
        });
        return { ...n, keys, accidentals: accOut };
      }),
    };
  });
}

/** score 데이터(조표·마디 상속 의존)를 explicit 의미론으로 굽는다 —
 *  릭 추출·에디터 로드처럼 "필드가 곧 소리"여야 하는 곳에 넣기 전 반드시 통과.
 *  변경이 없으면 원본 객체를 그대로 반환한다(참조 안정). */
export function bakeExplicitAccidentals(
  measures: MeasureInfo[],
  sheetKey: string | undefined,
): MeasureInfo[] {
  let keySig = keySigLetterMap(sheetKey);
  let anyChanged = false;
  const out = measures.map((m) => {
    if (m.key) keySig = keySigLetterMap(m.key);
    const active = new Map<string, AccGlyph>();
    let measureChanged = false;
    const notes = m.notes.map((n) => {
      if (n.duration.endsWith('r')) return n;
      let noteChanged = false;
      let accOut: Record<number, AccGlyph> | undefined =
        n.accidentals ? { ...(n.accidentals as Record<number, AccGlyph>) } : undefined;
      n.keys.forEach((k, ki) => {
        const dataAcc = n.accidentals?.[ki] as AccGlyph | undefined;
        const sounding = soundingAccidental(active, keySig, k, dataAcc, 'score');
        const explicitAcc = dataAcc ?? undefined;
        // explicit 의미론에서 이 소리를 내려면: natural → 필드 없음, 그 외 → 명시.
        const want: AccGlyph | undefined = sounding;
        if (want !== explicitAcc && !(want === undefined && explicitAcc === 'n')) {
          // 'n' 명시는 explicit 의미론에서도 natural — 지울 필요 없음.
          noteChanged = true;
          if (want === undefined) { if (accOut) delete accOut[ki]; }
          else (accOut ??= {})[ki] = want;
        }
      });
      if (!noteChanged) return n;
      measureChanged = true;
      if (accOut && Object.keys(accOut).length === 0) accOut = undefined;
      return { ...n, accidentals: accOut };
    });
    if (!measureChanged) return m;
    anyChanged = true;
    return { ...m, notes };
  });
  return anyChanged ? out : measures;
}

/** 조표무시(explicit) 시트를 **기본 해석(score)으로 읽어도 같은 소리**가 나도록
 *  임시표를 다시 방출한다.
 *
 *  왜 필요한가: `accidentalStyle:'explicit'` 은 백엔드 `SheetDataRequest` 에 없는
 *  필드라 저장 시 버려진다(BR-33). 그래서 다시 불러오면 기본값 'score' 로 읽히고,
 *  ① 조표의 ♯/♭ 이 임시표 없는 음에 얹히고 ② 마디 내 임시표 상속이 적용돼
 *  **에디터에서 들리던 것과 다른 음이 재생·표시된다**. 저장 시 이 함수로 구워두면
 *  플래그가 사라져도 소리가 보존된다(표기는 표준 규칙대로 ♮ 등이 명시된다).
 *
 *  소리는 바뀌지 않는다 — explicit 해석의 음정을 그대로 score 표기로 옮길 뿐이다. */
export function bakeForScoreReading(
  measures: MeasureInfo[],
  sheetKey: string | undefined,
): MeasureInfo[] {
  let keySig = keySigLetterMap(sheetKey);
  let anyChanged = false;
  const out = measures.map((m) => {
    if (m.key) keySig = keySigLetterMap(m.key);
    // score 해석이 보게 될 마디 내 상태 — 우리가 방출한 표기로만 갱신된다.
    const active = new Map<string, AccGlyph>();
    let measureChanged = false;
    const notes = m.notes.map((n) => {
      if (n.duration.endsWith('r')) return n;
      let accOut: Record<number, AccGlyph> | undefined;
      let noteChanged = false;
      n.keys.forEach((k, ki) => {
        const dataAcc = n.accidentals?.[ki] as AccGlyph | undefined;
        const letter = k.split('/')[0];
        let want: AccGlyph | undefined;
        if (/^[a-gA-G](##?|bb?|n)$/.test(letter)) {
          want = undefined;          // baked 글자('eb/4') — 글자 자체가 소리다
        } else if (dataAcc) {
          // ★ 조표가 같은 임시표를 이미 준다고 해서 생략하지 않는다. 생략하면
          //   표기가 조표에 의존하게 되어, 조표무시로 읽을 때 소리가 달라진다
          //   (Eb 조표에서 E♭ 표기를 지우면 explicit 해석은 E내추럴이 됨).
          want = dataAcc;
        } else {
          // 내추럴 — score 해석에서 조표나 마디 내 상태가 바꾸려 들면 ♮ 를 명시.
          const wouldAlter = active.get(k) ?? keySig.get(letter);
          want = wouldAlter && wouldAlter !== 'n' ? 'n' : undefined;
        }
        if (want) { (accOut ??= {})[ki] = want; active.set(k, want); }
        if (want !== dataAcc) noteChanged = true;
      });
      if (!noteChanged) return n;
      measureChanged = true;
      const copy: NoteInfo = { ...n };
      if (accOut) copy.accidentals = accOut; else delete copy.accidentals;
      return copy;
    });
    if (!measureChanged) return m;
    anyChanged = true;
    return { ...m, notes };
  });
  return anyChanged ? out : measures;
}
