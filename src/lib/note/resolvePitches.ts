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
import type { MeasureInfo } from '../../data/sampleMelody';

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

/** score 의미론으로 최소 표기 임시표를 다시 계산해 붙인다.
 *  (조표·마디 상속으로 함의되는 글리프는 생략, 취소가 필요하면 'n'.) */
export function emitScoreAccidentals(
  perNoteSounding: SoundingNote[][][],  // [measure][note][keyIdx]
  measures: MeasureInfo[],
  sheetKey: string,
): MeasureInfo[] {
  let keySig = keySigLetterMap(sheetKey);
  return measures.map((m, mi) => {
    if (m.key) keySig = keySigLetterMap(m.key); // 곡 중간 조성 변경(이미 이조된 값)
    const active = new Map<string, AccGlyph>();
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
          const inherited = active.get(s.vexKey) ?? keySig.get(letter);
          const effInherited: AccGlyph | undefined = inherited === 'n' ? undefined : inherited;
          const wanted = s.acc; // undefined = natural
          if (wanted !== effInherited) {
            const glyph: AccGlyph = wanted ?? 'n';
            (accOut ??= {})[ki] = glyph;
            active.set(s.vexKey, glyph);
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
