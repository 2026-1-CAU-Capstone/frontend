/**
 * 다중 스태프(보표) — 정규화·직렬화·종류 메타데이터의 **단일 소스**.
 *
 * 데이터 규칙 (NoteSheetData):
 *  - `staves` 가 있으면 그것이 진실. `measures`/`bassMeasures` 는 staves[0] 의
 *    미러다 — 구버전 리더(뷰어·백엔드 feature 계산)가 첫 파트를 계속 읽도록.
 *  - `staves` 가 없으면 기존 해석: bassMeasures 있으면 피아노 양손, 없으면
 *    트레블 단일.
 *  - 저장 시 legacy 로 표현 가능한 구성(트레블 1개 · 양손 1개)은 `staves` 를
 *    아예 쓰지 않는다 → 기존 악보를 열었다 저장해도 포맷이 변하지 않는다.
 *
 * 에디터·뷰어·재생이 전부 이 헬퍼를 거친다. 직접 data.staves 를 해석하지 말 것.
 */
import type { NoteSheetData, SheetStaff, StaffKind } from '../../data/sampleMelody';
import { GUITAR_TUNING, BASS_TUNING, BASS5_TUNING, UKULELE_TUNING } from './tabFingering';

/* ─── 종류 메타데이터 (+ 모달 카드 문구) ─────────────────────────────── */

export interface StaffKindMeta {
  kind: StaffKind;
  label: string;
  /** + 모달 카드에 표시되는 설명. */
  desc: string;
  /** 파트 기본 재생 음색(MusyngKite). 드럼은 채널 10 이라 없음. */
  defaultInstrument?: string;
  /** 악기(음색) 선택 허용 여부 — grand 는 피아노 고정, drum 은 채널 10 고정. */
  instrumentLocked: boolean;
}

export const STAFF_KIND_META: Record<StaffKind, StaffKindMeta> = {
  'treble': {
    kind: 'treble', label: '높은음자리표',
    desc: '멜로디·색소폰·트럼펫 등 표준 단일 보표. 악기를 자유롭게 고를 수 있습니다.',
    defaultInstrument: 'acoustic_grand_piano', instrumentLocked: false,
  },
  'treble-8vb': {
    kind: 'treble-8vb', label: '높은음자리표 8vb',
    desc: '기타·테너 보컬 관례의 옥타브 클레프 — 소리보다 한 옥타브 위에 표기됩니다(클레프에 작은 8).',
    defaultInstrument: 'acoustic_guitar_nylon', instrumentLocked: false,
  },
  'bass': {
    kind: 'bass', label: '낮은음자리표',
    desc: '베이스·트롬본·첼로 등 저음역 단일 보표.',
    defaultInstrument: 'acoustic_bass', instrumentLocked: false,
  },
  'alto': {
    kind: 'alto', label: '알토 음자리표',
    desc: '비올라 표준 C 클레프 — 가운데 줄이 middle C 입니다.',
    defaultInstrument: 'viola', instrumentLocked: false,
  },
  'tenor': {
    kind: 'tenor', label: '테너 음자리표',
    desc: '첼로·트롬본·바순의 고음역 C 클레프 — 4번째 줄이 middle C 입니다.',
    defaultInstrument: 'cello', instrumentLocked: false,
  },
  'grand': {
    kind: 'grand', label: '피아노 양손',
    desc: '높은음자리표 + 낮은음자리표를 중괄호로 묶은 그랜드 스태프. 악기는 피아노로 고정됩니다.',
    defaultInstrument: 'acoustic_grand_piano', instrumentLocked: true,
  },
  'guitar-tab': {
    kind: 'guitar-tab', label: '기타 TAB (6현)',
    desc: '음을 입력하면 최적 현·프렛을 자동 계산해 6줄 TAB으로 표기합니다. 표준 오선을 위에 함께 표시할 수도 있습니다.',
    defaultInstrument: 'electric_guitar_clean', instrumentLocked: false,
  },
  'bass-tab': {
    kind: 'bass-tab', label: '베이스 TAB (4현)',
    desc: '4현 베이스 TAB. 음 입력 → 자동 운지. 표준 오선 동시 표시 옵션.',
    defaultInstrument: 'electric_bass_finger', instrumentLocked: false,
  },
  'bass5-tab': {
    kind: 'bass5-tab', label: '베이스 TAB (5현)',
    desc: 'Low B 를 포함한 5현 베이스 TAB — 저음역 확장.',
    defaultInstrument: 'electric_bass_finger', instrumentLocked: false,
  },
  'ukulele-tab': {
    kind: 'ukulele-tab', label: '우쿨렐레 TAB (4현)',
    desc: 'High-G 리엔트런트 표준 튜닝(gCEA)의 4줄 TAB.',
    defaultInstrument: 'acoustic_guitar_nylon', instrumentLocked: false,
  },
  'drum': {
    kind: 'drum', label: '드럼',
    desc: '퍼커션 보표 — 킥·스네어·하이햇 등을 팔레트로 입력합니다. 심벌류는 ✕ 머리로 표기되고 드럼 채널로 재생됩니다.',
    instrumentLocked: true,
  },
};

export const STAFF_KIND_ORDER: StaffKind[] = [
  'treble', 'treble-8vb', 'bass', 'alto', 'tenor', 'grand',
  'guitar-tab', 'bass-tab', 'bass5-tab', 'ukulele-tab', 'drum',
];

/** TAB 계열(운지 자동 계산 + TabStave 렌더) 여부. */
export function isTabKind(kind: StaffKind): boolean {
  return kind === 'guitar-tab' || kind === 'bass-tab' || kind === 'bass5-tab' || kind === 'ukulele-tab';
}

/* ─── 렌더 규약 — 에디터·뷰어가 같은 매핑을 쓴다 ─────────────────────── */


/** Drop-D — 표준 기타에서 6번줄만 한 음 내린 D2. */
const GUITAR_DROP_D: number[] = [64, 59, 55, 50, 45, 38];

/** TAB 종류 → 튜닝(1번줄부터). 줄 수 = 배열 길이 → TabStave numLines 로도 쓴다.
 *  staff 옵션을 주면 튜닝 프리셋(drop-d)과 카포(개방현 +capo)를 반영한다 —
 *  카포 기준으로 프렛을 0부터 세는 실제 TAB 관행이 자동으로 성립한다. */
export function tabTuningFor(kind: StaffKind, staff?: Pick<SheetStaff, 'capo' | 'tuningPreset'>): number[] {
  let base: number[];
  switch (kind) {
    case 'bass-tab': base = BASS_TUNING; break;
    case 'bass5-tab': base = BASS5_TUNING; break;
    case 'ukulele-tab': base = UKULELE_TUNING; break;
    default: base = staff?.tuningPreset === 'drop-d' ? GUITAR_DROP_D : GUITAR_TUNING;
  }
  const capo = staff?.capo ?? 0;
  return capo > 0 ? base.map((t) => t + capo) : base;
}

export type NotationClef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion';

/** 표기(비-TAB) 스태프의 클레프 + 옥타브 주석. grand 는 위 보표 기준(treble). */
export function clefForKind(kind: StaffKind): { clef: NotationClef; annotation?: '8vb' } {
  switch (kind) {
    case 'bass': return { clef: 'bass' };
    case 'alto': return { clef: 'alto' };
    case 'tenor': return { clef: 'tenor' };
    case 'drum': return { clef: 'percussion' };
    case 'treble-8vb': return { clef: 'treble', annotation: '8vb' };
    default: return { clef: 'treble' };
  }
}

/** 표기용 옥타브 이동 — treble-8vb 는 소리보다 한 옥타브 **위**에 적는다.
 *  (데이터 keys 는 항상 소리 기준 — 재생·이조·운지가 전부 그걸 읽는다.) */
export function displayOctaveShiftFor(kind: StaffKind): number {
  return kind === 'treble-8vb' ? 1 : 0;
}

/** 클레프별 쉼표 표기 위치(오선 가운데). */
export function restKeyForClef(clef: NotationClef): string {
  switch (clef) {
    case 'bass': return 'd/3';
    case 'alto': return 'c/4';
    case 'tenor': return 'a/3';
    default: return 'b/4';
  }
}

/** vex key 의 옥타브를 n 만큼 올린 표기용 key ('c#/4' → 'c#/5'). */
export function shiftKeyOctave(key: string, n: number): string {
  if (!n) return key;
  const [note, octStr] = key.split('/');
  return `${note}/${parseInt(octStr, 10) + n}`;
}

/** 표기용 NoteInfo 사본 — displayOctaveShift 가 0 이면 원본 그대로. */
export function displayNotesFor<T extends { keys: string[]; duration: string }>(kind: StaffKind, notes: T[]): T[] {
  const shift = displayOctaveShiftFor(kind);
  if (!shift) return notes;
  return notes.map((n) => (n.duration.endsWith('r') ? n : { ...n, keys: n.keys.map((k) => shiftKeyOctave(k, shift)) }));
}

/* ─── 정규화 · 직렬화 ─────────────────────────────────────────────────── */

/** 시트 → 스태프 배열. staves 가 없으면 legacy 필드에서 합성한다.
 *  반환 배열은 항상 길이 ≥ 1 (빈 시트도 트레블 1개). */
export function sheetToStaves(data: Pick<NoteSheetData, 'measures' | 'bassMeasures' | 'staves' | 'instrument' | 'isDrum'>): SheetStaff[] {
  if (data.staves && data.staves.length > 0) {
    return data.staves.map((s) => ({ ...s }));
  }
  const grand = Array.isArray(data.bassMeasures) && data.bassMeasures.length > 0;
  if (grand) {
    return [{ kind: 'grand', measures: data.measures ?? [], bassMeasures: data.bassMeasures, instrument: 'acoustic_grand_piano' }];
  }
  // legacy 단일 — 다중 파트 재생용으로 이미 존재하던 isDrum/instrument 존중.
  if (data.isDrum) return [{ kind: 'drum', measures: data.measures ?? [] }];
  return [{ kind: 'treble', measures: data.measures ?? [], ...(data.instrument ? { instrument: data.instrument } : {}) }];
}

/** legacy 필드만으로 표현 가능한 구성인가 — 트레블 1개 또는 양손 1개. */
function isLegacyRepresentable(staves: SheetStaff[]): boolean {
  if (staves.length !== 1) return false;
  const k = staves[0].kind;
  return k === 'treble' || k === 'grand';
}

/** 스태프 배열 → NoteSheetData 에 얹을 필드. 항상 measures/bassMeasures 를
 *  staves[0] 미러로 채우고, legacy 표현 가능하면 staves 를 생략한다. */
export function stavesToSheetFields(staves: SheetStaff[]): Pick<NoteSheetData, 'measures' | 'bassMeasures' | 'staves' | 'instrument' | 'isDrum'> {
  const first = staves[0] ?? { kind: 'treble' as const, measures: [] };
  const base: Pick<NoteSheetData, 'measures' | 'bassMeasures' | 'staves' | 'instrument' | 'isDrum'> = {
    measures: first.measures,
    ...(first.kind === 'grand' && first.bassMeasures && first.bassMeasures.some((m) => m.notes.length > 0)
      ? { bassMeasures: first.bassMeasures }
      : {}),
    ...(first.instrument && first.kind !== 'grand' ? { instrument: first.instrument } : {}),
    ...(first.kind === 'drum' ? { isDrum: true } : {}),
  };
  if (isLegacyRepresentable(staves)) return base;
  return { ...base, staves: staves.map((s) => ({ ...s })) };
}

/** 재생용: 각 스태프를 독립 NoteSheetData 파트로 편다(첫 파트 포함).
 *  grand 는 오른손/왼손 두 파트. TAB 은 음정 그대로(운지는 표기 전용).
 *  meta(제목·키 등)는 base 에서 상속. */
export function stavesToPlaybackParts(base: NoteSheetData, staves: SheetStaff[]): NoteSheetData[] {
  const parts: NoteSheetData[] = [];
  for (const s of staves) {
    const meta = STAFF_KIND_META[s.kind];
    if (s.kind === 'grand') {
      parts.push({ ...base, measures: s.measures, bassMeasures: undefined, staves: undefined, instrument: 'acoustic_grand_piano', isDrum: undefined });
      if (s.bassMeasures?.some((m) => m.notes.length > 0)) {
        parts.push({ ...base, measures: s.bassMeasures, bassMeasures: undefined, staves: undefined, instrument: 'acoustic_grand_piano', isDrum: undefined });
      }
      continue;
    }
    parts.push({
      ...base,
      measures: s.measures,
      bassMeasures: undefined,
      staves: undefined,
      instrument: s.kind === 'drum' ? undefined : (s.instrument ?? meta.defaultInstrument),
      isDrum: s.kind === 'drum' ? true : undefined,
      /* 드럼 keys 는 GM 퍼커션 절대값 — 조표가 글자를 변조하면(예: D장조의 c→c#)
       * 킥(36)이 림샷(37)으로 바뀐다. 항상 C(조표 없음)로 해석시킨다. */
      ...(s.kind === 'drum' ? { key: 'C' } : {}),
    });
    /* 보이스 2 — 같은 음색의 별도 파트. ⚠ 반드시 메인 파트 **뒤에** 넣는다:
     * parts[0] 은 '첫 파트 보이스1' 이라는 계약(에디터 buildSheet·slice(1))이 있다. */
    if (s.measures.some((m) => (m.voice2?.length ?? 0) > 0)) {
      parts.push({
        ...base,
        measures: s.measures.map((m) => ({ notes: m.voice2 ?? [] })),
        bassMeasures: undefined,
        staves: undefined,
        instrument: s.kind === 'drum' ? undefined : (s.instrument ?? meta.defaultInstrument),
        isDrum: s.kind === 'drum' ? true : undefined,
        ...(s.kind === 'drum' ? { key: 'C' } : {}),
      });
    }
  }
  return parts;
}

/* ── TAB 글리프 크기 보정 ────────────────────────────────────────────────
 * VexFlow 의 TabStave 는 'TAB' 글리프를 **6줄 탭 기준으로만** 그린다 — 크기
 * 30pt 고정, 세로 위치는 2.5번째 줄(6줄 보표의 한가운데). 그래서 4줄(우쿨렐레·
 * 베이스)·5줄 보표에서는 글자가 보표 위아래로 삐져나온다.
 *
 * draw() 직후 그 보표의 clef 글리프를 찾아 **보표 높이에 비례하도록 축소하고
 * 세로 중앙으로** 옮긴다. 이미 손본 글리프는 data 속성으로 표시해 두 번 건드리지
 * 않는다. (VexFlow 에 크기·위치 API 가 없어 그려진 SVG 를 직접 손본다.) */
const TAB_CLEF_GLYPH = '';      // SMuFL sixStringTabClef
const TAB_REF_HEIGHT = 65;            // 6줄 보표 높이(5칸 × 13px) — 30pt 기준

export function fitTabClefToStave(
  svgEl: SVGElement | null | undefined,
  stave: { getYForLine(line: number): number },
  numLines: number,
): void {
  if (!svgEl || numLines < 2) return;
  const top = stave.getYForLine(0);
  const bottom = stave.getYForLine(numLines - 1);
  // VexFlow 가 글리프를 놓은 baseline — 이 값으로 우리 보표의 글리프를 특정한다.
  const drawnY = stave.getYForLine(2.5);
  for (const el of Array.from(svgEl.querySelectorAll('g.vf-clef > text'))) {
    const t = el as SVGTextElement;
    if (t.textContent !== TAB_CLEF_GLYPH) continue;
    if (t.dataset.tabFit === '1') continue;
    if (Math.abs(Number(t.getAttribute('y')) - drawnY) > 0.75) continue;
    t.setAttribute('font-size', `${(30 * (bottom - top) / TAB_REF_HEIGHT).toFixed(2)}pt`);
    t.setAttribute('y', String((top + bottom) / 2));
    t.dataset.tabFit = '1';
  }
}
