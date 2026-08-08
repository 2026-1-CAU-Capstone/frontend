/* ─────────────────────────────────────────────────────────────────────────
 * 코드 붙여넣기 — 리드시트(jazz1460)의 코드 진행을 채보 악보에 얹는다.
 *
 * 쓰는 상황: MusicXML 솔로 채보를 가져왔는데 코드가 안 적혀 있을 때. 아는 곡이면
 * 그 곡의 코드 차트를 골라, **솔로가 시작하는 마디**를 지정해 순환으로 채운다.
 * (예: Giant Steps 16마디 차트에서 m16 `C#-7 F#7` 을 시작점으로 고르면
 *  솔로 1마디=C#-7 F#7, 2마디=B△7 D7 … 16마디마다 한 바퀴.)
 *
 * 두 가지가 핵심이다.
 *   1) **도돌이·볼타 전개** — `leadSheetExpand` 의 공용 전개기를 쓴다. 차트에 적힌
 *      마디 수와 실제 연주 길이는 다르다(A Foggy Day: 44 → 52마디). 전개하지 않으면
 *      코러스가 한 바퀴 돌 때마다 코드가 밀린다.
 *   2) **이명동음** — 코드가 정해지면 그 자리의 음이름도 코드를 따라야 한다
 *      (C♯-7 마디의 검은건반은 C♯ 이지 D♭ 이 아니다). 코드 루트의 ♯/♭ 만 보고
 *      **검은건반의 표기 방향**을 뒤집는다. 소리는 불변. 자세한 근거는
 *      `spellDirectional` 주석 참고 — 도수 스펠링을 쓰면 B♯ 이 나와서 못 쓴다.
 * ──────────────────────────────────────────────────────────────────────── */
import type { LeadSheetChord, LeadSheetData } from '../../data/leadSheetTypes';
import type { MeasureInfo, NoteInfo } from '../../data/sampleMelody';
import { expandRepeatOrder, flattenLeadSheetBars } from './leadSheetExpand';
import { noteMetricBeats } from './melodyTiming';
import {
  emitExplicitAccidentals,
  emitScoreAccidentals,
  resolveSheetMidis,
  type AccGlyph,
  type AccidentalStyle,
} from './resolvePitches';

/* ─── 1. 차트 → 전개된 코드 칸 ──────────────────────────────────────────── */

/** 전개된 마디 한 칸. `chord` 가 없으면 코드 없는 마디(빈칸)다. */
export interface ChordCell {
  /** 마디의 코드 문자열. 한 마디에 둘 이상이면 두 칸 공백으로 잇는다("D-7  G7"). */
  chord?: string;
  /** 원본 차트에서 몇 번째 마디였나(1-based). 미리보기 라벨용. */
  sourceBar: number;
  /** 볼타 번호(있으면). */
  ending?: number;
  /** 도돌이로 두 번째 지나가는 칸인가 — 미리보기에서 회차를 구분한다. */
  secondPass: boolean;
}

function chordSymbol(ch: LeadSheetChord, prev: string | undefined): string | undefined {
  if (ch.isRepeat) return prev;              // `%` 반복 — 앞 코드를 그대로
  if (!ch.root) return undefined;
  const acc = ch.accidental ?? '';
  const quality = (ch.quality ?? '').replace(/\^/g, '△');
  const bass = ch.bass ? `/${ch.bass.root}${ch.bass.accidental ?? ''}` : '';
  return `${ch.root}${acc}${quality}${bass}`;
}

/**
 * 리드시트를 **도돌이·볼타까지 전개한** 코드 칸 배열로 편다.
 *
 * `%` 반복 코드는 전개 **전** 읽기 순서로 해석한다 — 악보를 눈으로 읽는 순서가
 * 곧 "앞 마디"의 정의이기 때문이다. 그 다음 전개 순서로 인덱싱한다.
 * 맨 뒤의 빈 마디(레이아웃용 여백)는 잘라낸다 — 남겨두면 순환 주기가 늘어나
 * 코러스마다 빈 마디가 끼어든다.
 */
export function expandLeadSheetChordCells(lead: LeadSheetData): ChordCell[] {
  const flat = flattenLeadSheetBars(lead);

  // 읽기 순서로 코드 문자열 확정(`%` 반복 해석 포함).
  let last: string | undefined;
  const linear: (string | undefined)[] = flat.map(({ systemIndex, barIndex }) => {
    const bar = lead.systems[systemIndex].bars[barIndex];
    const syms: string[] = [];
    for (const ch of bar.chords ?? []) {
      const sym = chordSymbol(ch, last);
      if (sym) { syms.push(sym); last = sym; }
    }
    return syms.length ? syms.join('  ') : undefined;
  });

  const order = expandRepeatOrder(flat.map((f) => f.flags));
  const seen = new Set<number>();
  const cells: ChordCell[] = order.map((srcIdx) => {
    const secondPass = seen.has(srcIdx);
    seen.add(srcIdx);
    return {
      chord: linear[srcIdx],
      sourceBar: srcIdx + 1,
      ending: flat[srcIdx].flags.ending,
      secondPass,
    };
  });

  // 끝쪽 빈 칸만 제거(중간의 빈 마디는 의도된 쉼일 수 있으므로 보존).
  let end = cells.length;
  while (end > 0 && !cells[end - 1].chord) end--;
  return cells.slice(0, end);
}

/* ─── 2. 코드 주입 ─────────────────────────────────────────────────────── */

/**
 * 전개된 코드 칸을 악보 마디에 순환으로 채운다.
 *
 * @param startCell 코드 칸 배열에서 **솔로 첫 마디에 해당하는** 인덱스.
 * @param overwrite 이미 코드가 있는 마디도 덮어쓸지. false 면 빈 마디만 채운다.
 */
export function pasteChordCells(
  measures: MeasureInfo[],
  cells: ChordCell[],
  startCell: number,
  overwrite = true,
): MeasureInfo[] {
  const n = cells.length;
  if (n === 0) return measures;
  const start = ((startCell % n) + n) % n;
  return measures.map((m, i) => {
    if (!overwrite && m.chord) return m;
    const chord = cells[(start + i) % n].chord;
    if (chord === m.chord) return m;
    const out: MeasureInfo = { ...m };
    if (chord) out.chord = chord; else delete out.chord;
    return out;
  });
}

/* ─── 3. 코드에 맞춘 이명동음 재표기 ───────────────────────────────────── */

/** "C#-7  F#7" → ["C#", "F#"] — 마디 안 코드들의 **루트**만 순서대로. */
export function chordRootsOf(chord: string | undefined): string[] {
  if (!chord) return [];
  return chord
    .split(/\s+/)
    .filter(Boolean)
    .map((sym) => {
      const m = sym.match(/^([A-G])([#b])?/);
      return m ? `${m[1]}${m[2] ?? ''}` : '';
    })
    .filter(Boolean);
}

/** 마디를 코드 개수만큼 균등 분할해, 박 위치에 해당하는 코드 루트를 고른다.
 *  (한 마디에 코드가 하나면 전부 그 코드 — 분할 계산이 필요 없다.) */
function contextAtBeat(roots: string[], beat: number, barBeats: number): string {
  if (roots.length <= 1) return roots[0] ?? '';
  const slot = Math.min(roots.length - 1, Math.floor((beat / barBeats) * roots.length));
  return roots[slot];
}

/* 자연음 음높이 클래스 → 글자. 검은건반(1·3·6·8·10)은 여기 없다. */
const NATURAL_LETTER: Record<number, string> = {
  0: 'c', 2: 'd', 4: 'e', 5: 'f', 7: 'g', 9: 'a', 11: 'b',
};

/** vex 옥타브 역산 — `midi = 12*(oct+1) + naturalPc + alter`. */
function octaveOf(midi: number, naturalPc: number, alter: number): number {
  return (midi - alter - naturalPc) / 12 - 1;
}

/**
 * 소리 피치를 **♯/♭ 방향**에 맞춰 표기한다.
 *
 * ⚠️ 여기서 "코드 루트를 조성으로 넘겨 도수 스펠링" 을 하면 안 된다. C♯ **조성**에는
 * 실제로 B♯·E♯ 가 있어서, C♯-7 마디의 C♮ 이 B♯ 로, F♮ 이 E♯ 로 나온다 — 도수로는
 * 맞지만 채보에 쓰는 표기가 아니다. 필요한 규칙은 그보다 좁다:
 *
 *   • **자연음은 건드리지 않는다** (C♮ 은 C♮ 이다).
 *   • **검은건반만** 방향에 맞춰 뒤집는다 (샵 마디의 D♭ → C♯).
 *
 * 그래서 겹임시표나 B♯/C♭ 같은 옥타브 경계 표기가 아예 생기지 않는다.
 */
function spellDirectional(midi: number, dir: '#' | 'b'): { vexKey: string; acc: AccGlyph | undefined } {
  const pc = ((midi % 12) + 12) % 12;
  const nat = NATURAL_LETTER[pc];
  if (nat) return { vexKey: `${nat}/${octaveOf(midi, pc, 0)}`, acc: undefined };

  if (dir === '#') {
    const lowerPc = pc - 1;                       // 검은건반의 아래는 항상 자연음
    return { vexKey: `${NATURAL_LETTER[lowerPc]}/${octaveOf(midi, lowerPc, 1)}`, acc: '#' };
  }
  const upperPc = (pc + 1) % 12;
  return { vexKey: `${NATURAL_LETTER[upperPc]}/${octaveOf(midi, upperPc, -1)}`, acc: 'b' };
}

/** 코드 심볼의 루트 임시표로 표기 방향을 정한다. 루트가 자연음이면 판단하지 않는다. */
function directionOfRoot(root: string | undefined): '#' | 'b' | null {
  if (!root) return null;
  if (root.endsWith('#')) return '#';
  if (root.endsWith('b')) return 'b';
  return null;
}

/**
 * 각 음의 **표기**를 그 자리 코드의 ♯/♭ 방향에 맞춰 다시 쓴다. 소리(MIDI)는 100% 불변.
 *
 * 절차는 `respellNoteSheetKey` 와 같은 안전 규칙을 따른다:
 *   1) 현재 조표·임시표 의미론으로 각 음의 **소리 피치**를 확정하고,
 *   2) 피치는 그대로 둔 채 표기(글자·임시표)만 다시 계산한다.
 *
 * 방향은 **코드 루트의 임시표**로만 정한다. 루트가 자연음이라 방향을 알 수 없는
 * 마디(예: `G△7`)와 코드가 없는 마디는 **손대지 않는다** — 근거 없이 표기를 흔들지
 * 않는 편이 안전하다.
 */
export function respellToChordContext(
  measures: MeasureInfo[],
  sheetKey: string | undefined,
  style: AccidentalStyle,
  barBeats = 4,
): MeasureInfo[] {
  const midis = resolveSheetMidis(measures, sheetKey, style);

  /* 방향이 정해지지 않은 음은 현재 표기를 그대로 소리 정보로 되돌려 넣는다
   * (emit* 이 마디 단위로 전체를 다시 쓰므로 건너뛸 음도 값은 채워야 한다). */
  const touched: boolean[] = [];
  const sounding = measures.map((m, mi) => {
    const roots = chordRootsOf(m.chord);
    let beat = 0;
    let any = false;
    const row = m.notes.map((n, ni) => {
      const here = beat;
      beat += noteMetricBeats(n);
      const rowMidis = midis[mi]?.[ni];
      if (!rowMidis) return [];                          // 쉼표
      const dir = directionOfRoot(contextAtBeat(roots, here, barBeats));
      if (!dir) {
        return n.keys.map((k, ki) => ({
          vexKey: k,
          acc: n.accidentals?.[ki] as AccGlyph | undefined,
        }));
      }
      any = true;
      return rowMidis.map((midi) => spellDirectional(midi, dir));
    });
    touched[mi] = any;
    return row;
  });

  const emitted = style === 'explicit'
    ? emitExplicitAccidentals(sounding, measures)
    : emitScoreAccidentals(sounding, measures, sheetKey ?? 'C');

  /* 방향을 정할 수 없던 마디는 **원본 그대로** 되돌린다. emit* 는 조표가 주는
   * 임시표를 생략하는 등 표기를 정규화하는데(소리는 보존), 코드가 근거를 주지 않은
   * 마디에서까지 글리프가 사라지면 "손대지 않는다"는 약속이 깨진다. */
  return emitted.map((m, mi) => (touched[mi] ? m : measures[mi]));
}

/* ─── 4. 한 번에 적용 ──────────────────────────────────────────────────── */

export interface PasteChordsOptions {
  /** 코드 칸 배열에서 솔로 첫 마디에 해당하는 인덱스. */
  startCell: number;
  /** 코드에 맞춰 임시표를 다시 쓸지(소리 불변). */
  respell: boolean;
  /** 이미 코드가 있는 마디도 덮어쓸지. */
  overwrite?: boolean;
  /** 한 마디의 박 수(박자표에서 파생). 기본 4. */
  barBeats?: number;
}

/** 코드 주입 + (선택) 이명동음 재표기를 한 번에. 순수 함수 — 입력은 안 건드린다. */
export function applyChordPaste(
  measures: MeasureInfo[],
  cells: ChordCell[],
  sheetKey: string | undefined,
  style: AccidentalStyle,
  opts: PasteChordsOptions,
): MeasureInfo[] {
  const withChords = pasteChordCells(measures, cells, opts.startCell, opts.overwrite ?? true);
  return opts.respell
    ? respellToChordContext(withChords, sheetKey, style, opts.barBeats ?? 4)
    : withChords;
}

export type { NoteInfo };
