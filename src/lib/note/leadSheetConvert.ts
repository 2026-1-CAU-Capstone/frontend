import type {
  LeadSheetBar, LeadSheetChord, LeadSheetData, LeadSheetSystem,
} from '../../data/leadSheetTypes';
import type { MeasureInfo } from '../../data/sampleMelody';
import { splitChordParts } from '../jazz-harmony';

/* ─────────────────────────────────────────────────────────────────────────
 * 에디터 마디 ↔ 리드시트 상호 변환.
 *
 * 에디터는 **기보 편집기**(`MeasureInfo[]` — 음표가 본체)이고 리드시트는 **코드
 * 진행**(`LeadSheetData` — 코드가 본체)이다. 둘을 오갈 때 무엇이 남고 무엇이
 * 버려지는지가 이 파일의 전부다.
 *
 *   에디터 → 리드시트 : 음표를 버리고 마디별 코드·형식(도돌이·볼타·가사)만 남긴다
 *   리드시트 → 에디터 : 코드를 얹은 **빈 마디**를 만든다(음표는 없다)
 *
 * ⚠️ 왕복이 무손실이 아니다. 에디터에서 리드시트로 저장하면 **음표가 사라진다** —
 * 리드시트에 음표를 담을 자리가 없기 때문이다(그게 리드시트의 정의다). 호출부는
 * 사용자에게 그 사실을 알려야 한다.
 *
 * 전개(`leadSheetExpand`·`chordPaste`)는 여기서 쓰지 않는다. 그쪽은 재생·붙여넣기용
 * 으로 도돌이를 **펼치고**, 에디터는 적힌 그대로를 편집하는 화면이다. 펼친 걸 편집
 * 하면 저장할 때 마디가 불어난다.
 * ──────────────────────────────────────────────────────────────────────── */

/** 도돌이로 끊기지 않은 구간에서 한 줄에 넣을 마디 수 — 리드시트 관례상 4마디. */
const BARS_PER_SYSTEM = 4;

/**
 * 코드 문자열 → `LeadSheetChord`.
 *
 * 렌더러(`LeadSheet`)는 `root`·`accidental`·`quality` 를 나눠 받아 글리프를 그리므로
 * 문자열 하나로 넘기면 안 된다. 쪼개는 규칙은 앱 공용 `splitChordParts` 를 쓴다 —
 * 여기서 따로 파싱하면 코드 차트와 리드시트의 표기가 갈린다(분수코드의 베이스가
 * 조용히 사라지는 게 그 함수가 생긴 이유다).
 */
export function toLeadSheetChord(text: string): LeadSheetChord | null {
  const t = text.trim();
  if (!t) return null;
  /* `%` 는 코드가 아니라 "앞 마디와 같다" 는 표시다. */
  if (t === '%') return { isRepeat: true };

  const { base, ext, tension, bass } = splitChordParts(t);
  const m = base.match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!m) return null;

  const chord: LeadSheetChord = { root: m[1].toUpperCase() };
  if (m[2] === '#' || m[2] === '♯') chord.accidental = '#';
  else if (m[2] === 'b' || m[2] === '♭') chord.accidental = 'b';

  const quality = `${m[3]}${ext}${tension}`;
  if (quality) chord.quality = quality;

  if (bass) {
    /* `splitChordParts` 는 선행 '/' 를 포함해 돌려준다. */
    const bm = bass.replace(/^\//, '').match(/^([A-Ga-g])([#♯b♭]?)/);
    if (bm) {
      chord.bass = { root: bm[1].toUpperCase() };
      if (bm[2] === '#' || bm[2] === '♯') chord.bass.accidental = '#';
      else if (bm[2] === 'b' || bm[2] === '♭') chord.bass.accidental = 'b';
    }
  }
  return chord;
}

/** `LeadSheetChord` → 에디터가 코드 칸에 담는 문자열. `toLeadSheetChord` 의 역. */
export function fromLeadSheetChord(c: LeadSheetChord): string | undefined {
  if (c.isRepeat) return '%';
  if (!c.root) return undefined;
  const bass = c.bass ? `/${c.bass.root}${c.bass.accidental ?? ''}` : '';
  return `${c.root}${c.accidental ?? ''}${c.quality ?? ''}${bass}`;
}

/** 한 마디의 음절들을 절(verse)별 한 줄로 합친다 — 리드시트 가사는 마디 단위다. */
function barLyrics(m: MeasureInfo): string[] | undefined {
  const byVerse = new Map<number, string[]>();
  for (const n of m.notes) {
    for (const s of n.lyrics ?? []) {
      const arr = byVerse.get(s.verse) ?? [];
      /* begin/middle 은 낱말이 이어지는 중이라 붙이고, 그 외는 띄어쓴다. */
      const prev = arr[arr.length - 1];
      if (prev !== undefined && /[-‐]$/.test(prev)) arr[arr.length - 1] = prev.slice(0, -1) + s.text;
      else arr.push(s.syllabic === 'begin' || s.syllabic === 'middle' ? `${s.text}-` : s.text);
      byVerse.set(s.verse, arr);
    }
  }
  if (byVerse.size === 0) return undefined;
  const maxVerse = Math.max(...byVerse.keys());
  const out: string[] = [];
  for (let v = 1; v <= maxVerse; v += 1) out.push((byVerse.get(v) ?? []).join(' ').trim());
  return out;
}

/**
 * 에디터 마디 → 리드시트.
 *
 * 마디의 코드는 두 곳에 있을 수 있다 — 마디 자체(`MeasureInfo.chord`)와 음표
 * 위치(`NoteInfo.chord`, 마디 중간 코드 체인지). **둘을 합쳐 순서대로** 담는다.
 * 마디 코드만 보면 `| Dm7  G7 |` 처럼 한 마디에 둘 이상인 진행이 통째로 날아간다.
 *
 * 줄바꿈은 **도돌이 기준**으로 끊는다. `LeadSheetSystem` 은 도돌이를 줄 단위
 * (`hasRepeatStart`/`hasRepeatEnd`)로만 담을 수 있어서, 4마디씩 기계적으로 자르면
 * 줄 중간의 도돌이가 표현할 자리를 잃는다.
 */
export function measuresToLeadSheet(
  measures: readonly MeasureInfo[],
  meta: { title: string; composer?: string; style?: string; key?: string; timeSignature?: string },
): LeadSheetData {
  const systems: LeadSheetSystem[] = [];
  let cur: LeadSheetSystem | null = null;

  measures.forEach((m, i) => {
    /* 도돌이 시작이거나 줄이 다 찼으면 새 줄. */
    if (!cur || m.repeatStart || cur.bars.length >= BARS_PER_SYSTEM) {
      cur = { bars: [] };
      systems.push(cur);
      if (m.repeatStart) cur.hasRepeatStart = true;
    }

    const texts: string[] = [];
    if (m.chord) texts.push(m.chord);
    for (const n of m.notes) {
      /* 마디 코드가 첫 음표에 또 붙어 있는 흔한 경우를 걸러낸다. */
      if (n.chord && n.chord !== texts[texts.length - 1]) texts.push(n.chord);
    }

    const bar: LeadSheetBar = {
      measureNumber: i + 1,
      chords: texts.map(toLeadSheetChord).filter((c): c is LeadSheetChord => c !== null),
    };
    if (m.volta) bar.ending = m.volta;
    const lyrics = barLyrics(m);
    if (lyrics) bar.lyrics = lyrics;
    cur.bars.push(bar);

    /* 도돌이 끝은 줄을 닫는다 — 다음 마디는 새 줄에서 시작한다. */
    if (m.repeatEnd) { cur.hasRepeatEnd = true; cur = null; }
  });

  return {
    title: meta.title.trim() || '무제',
    composer: meta.composer ?? '',
    style: meta.style ?? '',
    timeSignature: meta.timeSignature ?? '4/4',
    ...(meta.key ? { key: meta.key } : {}),
    systems,
  };
}

/**
 * 리드시트 → 에디터 마디(음표 없는 빈 마디에 코드만 얹음).
 *
 * 한 마디에 코드가 둘 이상이면 첫 코드는 마디 코드로, 나머지는 버린다 — 에디터의
 * 마디 중간 코드는 **음표에 붙는데** 여기엔 음표가 없어 얹을 자리가 없다. 저장 때
 * 되살아나지 않으므로, 호출부가 그 사실을 알려야 한다(`droppedMidBarChords`).
 */
export function leadSheetToMeasures(lead: LeadSheetData): {
  measures: MeasureInfo[];
  droppedMidBarChords: number;
} {
  const measures: MeasureInfo[] = [];
  let dropped = 0;

  for (const sys of lead.systems ?? []) {
    const bars = sys.bars ?? [];
    bars.forEach((bar, bi) => {
      const m: MeasureInfo = { notes: [] };
      const chords = bar.chords ?? [];
      const text = chords[0] ? fromLeadSheetChord(chords[0]) : undefined;
      if (text) m.chord = text;
      if (chords.length > 1) dropped += chords.length - 1;
      if (bar.ending) m.volta = bar.ending;
      if (sys.hasRepeatStart && bi === 0) m.repeatStart = true;
      if (sys.hasRepeatEnd && bi === bars.length - 1) m.repeatEnd = true;
      measures.push(m);
    });
  }
  return { measures, droppedMidBarChords: dropped };
}

/** 코드가 하나라도 적혀 있는가 — 리드시트로 저장하기 전 검사에 쓴다. */
export function hasAnyChord(measures: readonly MeasureInfo[]): boolean {
  return measures.some((m) => !!m.chord || m.notes.some((n) => !!n.chord));
}
