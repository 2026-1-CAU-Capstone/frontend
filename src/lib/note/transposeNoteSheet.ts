import type { MeasureInfo, NoteSheetData } from '../../data/sampleMelody';
import {
  keySigLetterMap,
  normalizeKeyName,
  soundingAccidental,
  midiFromKey,
  emitScoreAccidentals,
  type AccGlyph,
} from './resolvePitches';

export const ALL_KEYS_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const ALL_KEYS_MINOR = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/* 조표가 플랫 계열(또는 C/Am — 재즈 관례상 플랫 선호)인 키의 임시표 스펠링. */
const FLAT_SPELLING_KEYS = new Set([
  'C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm',
]);

const PC_FLAT: [string, AccGlyph | undefined][] = [
  ['c', undefined], ['d', 'b'], ['d', undefined], ['e', 'b'], ['e', undefined],
  ['f', undefined], ['g', 'b'], ['g', undefined], ['a', 'b'], ['a', undefined],
  ['b', 'b'], ['b', undefined],
];

const PC_SHARP: [string, AccGlyph | undefined][] = [
  ['c', undefined], ['c', '#'], ['d', undefined], ['d', '#'], ['e', undefined],
  ['f', undefined], ['f', '#'], ['g', undefined], ['g', '#'], ['a', undefined],
  ['a', '#'], ['b', undefined],
];

const CHORD_KEY_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const CHORD_KEY_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_NAME_TO_SEMI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

export function normalizeNoteKeyDisplay(key: string | undefined | null): string {
  if (!key) return 'C';
  const trimmed = key.trim();
  const weimar = trimmed.match(/^([A-G][b#]?)-(maj|min)$/i);
  if (weimar) return weimar[2].toLowerCase() === 'min' ? `${weimar[1]}m` : weimar[1];
  return trimmed || 'C';
}

export function noteKeyIsMinor(key: string | undefined | null): boolean {
  return /m$/i.test(normalizeNoteKeyDisplay(key));
}

export function keyToPc(key: string): number {
  const clean = normalizeNoteKeyDisplay(key).replace(/m$/i, '');
  const root = clean[0]?.toUpperCase() ?? 'C';
  const acc = clean.length > 1 ? clean[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  if (!chord) return chord;
  const names = useFlats ? CHORD_KEY_NAMES_FLAT : CHORD_KEY_NAMES_SHARP;
  return chord.replace(/([A-G][b#]?)/g, (match) => {
    const rootSemi = CHORD_NAME_TO_SEMI[match] ?? 0;
    const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;
    return names[newSemi];
  });
}

function transposeSheetKey(key: string, semitones: number): string {
  const normalized = normalizeNoteKeyDisplay(key);
  const isMinor = noteKeyIsMinor(normalized);
  const roots = isMinor ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;
  const pc = ((keyToPc(normalized) + semitones) % 12 + 12) % 12;
  return roots.find((k) => keyToPc(k) === pc) ?? normalized;
}

/**
 * 악보 전체 이조.
 *
 * 원 데이터는 'score' 임시표 의미론(조표 + 마디 내 상속)으로 해석해 각 음의
 * "진짜 소리 피치"를 먼저 구하고, 최단 방향(±6반음 이내)으로 균일 이동해
 * 멜로디 윤곽을 보존한 뒤, 대상 조성 관례(플랫/샤프 키)로 리스펠링하고
 * 최소 표기 임시표(조표·마디 상속으로 함의되면 생략, 필요 시 ♮)를 재-방출한다.
 *
 * 이전 구현의 세 가지 결함을 고친다:
 *  1) 마디 내 상속·조표 무시 → 이조 후 일부 음이 반음 틀림(b 누락처럼 보임)
 *  2) keys[0]만 이조 → 화음 음 유실
 *  3) 음표별 옥타브 클램프 → 멜로디 윤곽 파괴
 */
export function transposeNoteSheet(data: NoteSheetData, targetKeyRaw: string): NoteSheetData {
  const originalKey = normalizeNoteKeyDisplay(data.key);
  const targetKey = normalizeNoteKeyDisplay(targetKeyRaw);
  const up = (keyToPc(targetKey) - keyToPc(originalKey) + 12) % 12;
  if (up === 0 && data.key === targetKey) return data;
  // 최단 방향: +7 이 아니라 -5 로 — 전체 레지스터 이동을 최소화해 윤곽 보존.
  const semitones = up > 6 ? up - 12 : up;

  const useFlats = FLAT_SPELLING_KEYS.has(normalizeKeyName(targetKey));
  const table = useFlats ? PC_FLAT : PC_SHARP;

  /* 1) 소스 의미론으로 소리 피치 확정 → 이동 → 리스펠링. */
  let srcKeySig = keySigLetterMap(originalKey);
  type Sounding = { vexKey: string; acc: AccGlyph | undefined };
  const perNote: Sounding[][][] = [];
  const outMeasures: MeasureInfo[] = data.measures.map((m) => {
    if (m.key) srcKeySig = keySigLetterMap(m.key);
    const active = new Map<string, AccGlyph>();
    const soundRow: Sounding[][] = [];
    const notes = m.notes.map((n) => {
      if (n.duration.endsWith('r')) { soundRow.push([]); return n; }
      const per: Sounding[] = n.keys.map((k, ki) => {
        const srcAcc = soundingAccidental(
          active, srcKeySig, k, n.accidentals?.[ki] as AccGlyph | undefined, 'score',
        );
        const newMidi = midiFromKey(k, srcAcc) + semitones;
        const pc = ((newMidi % 12) + 12) % 12;
        const [letter, acc] = table[pc];
        // 스펠링된 글자의 내추럴 pc 로부터 옥타브 역산 — B/C 경계 안전
        // (테이블은 Cb/B# 를 만들지 않으므로 floor 로 충분).
        const octave = Math.floor((newMidi - (acc ? ({ '#': 1, b: -1, n: 0, '##': 2, bb: -2 } as const)[acc] : 0)) / 12) - 1;
        return { vexKey: `${letter}/${octave}`, acc };
      });
      soundRow.push(per);
      // keys 는 여기서 갈아끼우고, accidentals 는 아래 emit 단계가 다시 계산.
      return { ...n, keys: per.map((p) => p.vexKey) };
    });
    perNote.push(soundRow);
    return {
      ...m,
      key: m.key ? normalizeNoteKeyDisplay(transposeSheetKey(m.key, ((semitones % 12) + 12) % 12)) : m.key,
      chord: m.chord ? transposeChord(m.chord, ((semitones % 12) + 12) % 12, useFlats) : m.chord,
      notes: notes.map((n) => (
        n.chord ? { ...n, chord: transposeChord(n.chord, ((semitones % 12) + 12) % 12, useFlats) } : n
      )),
    };
  });

  /* 2) 대상 조성 기준 최소 표기 임시표 재-방출. */
  const emitted = emitScoreAccidentals(perNote, outMeasures, targetKey);

  return { ...data, key: targetKey, measures: emitted };
}

/**
 * 조표 표기만 바꾼다 — **소리는 절대 바뀌지 않는다**.
 *
 * 음표 데이터는 임시표가 없으면 조표로 음높이가 결정된다
 * (`soundingAccidental`: 마디 내 상속 → 조표 → 내추럴). 그래서 `key` 필드만
 * 갈아끼우면 같은 `f/4` 가 C장조에선 F, B장조에선 F♯ 로 **소리와 표시가 함께
 * 바뀌어 버린다**. 이 함수는 그 사고를 막는다:
 *
 *   1) 원래 조표 기준으로 각 음의 실제 소리(피치)를 확정한다.
 *   2) 피치는 그대로 둔 채, 새 조표에서 그 피치를 내려면 필요한 임시표를
 *      다시 계산해 붙인다(예: B장조로 바꾸면 F 음에 ♮ 가 붙는다).
 *
 * 결과적으로 조표만 바뀌고 들리는 음·음표 위치는 100% 보존된다. 코드 심볼과
 * 마디 중간 조성 변경(m.key)도 건드리지 않는다(이조가 아니므로).
 */
export function respellNoteSheetKey(data: NoteSheetData, targetKeyRaw: string): NoteSheetData {
  const originalKey = normalizeNoteKeyDisplay(data.key);
  const targetKey = normalizeNoteKeyDisplay(targetKeyRaw);
  if (!targetKey || targetKey === originalKey) return data;

  /* accidentalStyle='explicit' 악보는 조표를 아예 읽지 않는다(임시표 필드가 곧
   * 소리). 조표를 바꿔도 소리가 변하지 않으므로 표기만 교체하면 된다. 오히려
   * 여기서 score 규칙으로 임시표를 재방출하면 "조표와 같으니 생략" 처리가 일어나
   * explicit 독자에겐 내추럴로 읽혀 소리가 깨진다(예: E♭조 B♭ → A♭조로 바꾸면
   * ♭ 글리프가 생략돼 B 내추럴이 된다). 그래서 이 경우는 조기 반환. */
  if (data.accidentalStyle === 'explicit') return { ...data, key: targetKey };

  /* 1) 원 조표 의미론으로 소리 피치 확정 (이동 없음 — vexKey/acc 그대로 보존). */
  let srcKeySig = keySigLetterMap(originalKey);
  type Sounding = { vexKey: string; acc: AccGlyph | undefined };
  const perNote: Sounding[][][] = [];
  for (const m of data.measures) {
    if (m.key) srcKeySig = keySigLetterMap(m.key);
    const active = new Map<string, AccGlyph>();
    const soundRow: Sounding[][] = [];
    for (const n of m.notes) {
      if (n.duration.endsWith('r')) { soundRow.push([]); continue; }
      soundRow.push(n.keys.map((k, ki) => ({
        vexKey: k,
        acc: soundingAccidental(
          active, srcKeySig, k, n.accidentals?.[ki] as AccGlyph | undefined, 'score',
        ),
      })));
    }
    perNote.push(soundRow);
  }

  /* 2) 새 조표에서 같은 소리를 내는 데 필요한 임시표를 다시 방출. */
  const emitted = emitScoreAccidentals(perNote, data.measures, targetKey);

  return { ...data, key: targetKey, measures: emitted };
}
