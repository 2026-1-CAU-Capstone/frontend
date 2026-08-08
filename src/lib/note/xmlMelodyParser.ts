import { unzipSync } from 'fflate';
import type {
  NoteSheetData, NoteInfo, MeasureInfo, StaffKind,
  Articulation, Ornament, Dynamic, NavigationMarker, LyricSyllable } from '../../data/sampleMelody';
import { gmProgramToInstrument, DRUM_INSTRUMENT } from './gmInstruments';
import { DRUM_PALETTE, gmToVexKey } from './drumNotation';

/* ─── MusicXML → NoteSheetData parser ────────────────────────────────── */
/*
 * Supported MusicXML elements (single-voice extraction, voice 1 only):
 *
 *   attributes:   key/fifths, time, divisions (mid-piece changes supported)
 *   barline:      repeat (forward/backward), ending (start/stop) → volta
 *   direction:    segno, coda, words (D.C./D.S./Fine/To Coda variants),
 *                 octave-shift, dynamics
 *   note:         pitch, rest, duration/type, dotted, accidental,
 *                 time-modification (tuplet), grace
 *   notations:    tied, slur, articulations (staccato/accent/tenuto/
 *                 strong-accent/detached-legato), fermata, ornaments
 *                 (trill-mark/mordent/inverted-mordent/turn/inverted-turn),
 *                 glissando, slide
 *   harmony:      root + kind → chord symbol on measure
 *
 * Single-voice limitation: <chord> sub-notes (simultaneous lower voices)
 * are skipped — only the top melody line is rendered. Cross-voice merging
 * is out of scope for lead-sheet display.
 */

const TYPE_TO_VF: Record<string, string> = {
  whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64', '128th': '128',
};

const BEAMABLE_XML_TYPES = new Set(['eighth', '16th', '32nd', '64th', '128th']);

const ACC_MAP: Record<string, '#' | 'b' | 'n' | '##' | 'bb'> = {
  sharp: '#', flat: 'b', natural: 'n',
  'double-sharp': '##', 'sharp-sharp': '##',
  'double-flat': 'bb', 'flat-flat': 'bb',
};

const KEY_NAMES = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];

const ARTICULATION_TAGS: Record<string, Articulation> = {
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  accent: 'accent',
  tenuto: 'tenuto',
  'strong-accent': 'marcato',
  'detached-legato': 'detached-legato',
};

const ORNAMENT_TAGS: Record<string, Ornament> = {
  'trill-mark': 'trill',
  mordent: 'mordent',
  'inverted-mordent': 'inverted-mordent',
  turn: 'turn',
  'inverted-turn': 'inverted-turn',
  'tremolo': 'tremolo',
};

const DYNAMIC_TAGS: Set<Dynamic> = new Set([
  'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp',
]);

/* ─── helpers ────────────────────────────────────────────────────────── */

function text(el: Element | null | undefined, sel: string): string | null {
  return el?.querySelector(sel)?.textContent ?? null;
}

function keySigLettersFor(fifths: number): Set<string> {
  const FLAT_LETTERS  = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
  const SHARP_LETTERS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
  const out = new Set<string>();
  if (fifths < 0) for (let i = 0; i < Math.min(-fifths, 7); i++) out.add(FLAT_LETTERS[i]);
  else for (let i = 0; i < Math.min(fifths, 7); i++) out.add(SHARP_LETTERS[i]);
  return out;
}

type AccGlyph = '#' | 'b' | 'n' | '##' | 'bb';

/**
 * `<attributes><transpose>` → 적힌 음 → 울리는 음 반음 차.
 *
 * `<chromatic>` 이 반음 차이고, `<octave-change>` 가 옥타브를 더한다.
 * B♭ 트럼펫 = −2, E♭ 알토색소폰 = −9, 테너색소폰 = −2 + (−1 옥타브) = −14.
 * 표기는 적힌 음 그대로 두고(이조 악기 연주자가 그렇게 읽는다) 재생에만 쓴다.
 */
function readTransposeSemis(scope: Element | Document): number | undefined {
  const t = scope.querySelector('transpose');
  if (!t) return undefined;
  const chromatic = parseInt(t.querySelector('chromatic')?.textContent ?? '0', 10) || 0;
  const octave = parseInt(t.querySelector('octave-change')?.textContent ?? '0', 10) || 0;
  const semis = chromatic + octave * 12;
  return semis === 0 ? undefined : semis;
}

/** 조표가 그 글자에 주는 기본 임시표. 조표에 없는 글자는 내추럴. */
function keySigDefaultFor(step: string, letters: Set<string>, fifths: number): AccGlyph {
  if (!letters.has(step)) return 'n';
  return fifths > 0 ? '#' : 'b';
}

/**
 * 한 <note> 의 임시표를 **소리**와 **표기** 두 값으로 나눠 읽는다.
 *
 * MusicXML 의 `<pitch>` 는 조표와 무관한 절대 음이다 — `<alter>` 가 없으면 그
 * 글자의 내추럴이다(E♭ 조표라도 `<alter>-1</alter>` 이 없으면 E 내추럴). 반면
 * `<accidental>` 은 **조판자가 실제로 찍은 기호**이고, 조표가 이미 주는 변화음
 * 에는 붙지 않는다.
 *
 * 예전엔 `<alter>` 만 보고 임시표를 무조건 저장해서, E♭ 조표의 E♭·A♭ 마다
 * ♭ 이 한 번 더 그려졌다(실측: 전 파일에서 원본의 2~3배). 반대로 `<alter>` 가
 * 없는 조표 글자(= 내추럴)는 아무 표기도 남기지 않아, 렌더러·플레이어가 조표를
 * 적용해 **반음 틀린 소리**가 났다(실측 205개).
 *
 * 그래서 저장 규칙을 `emitScoreAccidentals`(resolvePitches) 와 같은
 * "조표 기준 최소 표기" 로 통일한다:
 *   조판자가 찍었거나(courtesy 포함) 소리가 조표 기본값과 다르면 명시, 아니면 생략.
 * 생략된 음은 렌더러·플레이어 모두 조표 기본값으로 읽으므로 표시·소리가 일치한다.
 */
function readAccidental(
  nEl: Element,
  pitchEl: Element,
  step: string,
  keySigLetters: Set<string>,
  fifths: number,
): { sounding: AccGlyph; print: AccGlyph | undefined } {
  const accText = text(nEl, 'accidental');
  const printedGlyph = accText ? ACC_MAP[accText] : undefined;
  const alterTxt = text(pitchEl, 'alter');
  let sounding: AccGlyph;
  if (alterTxt !== null) {
    const a = parseInt(alterTxt, 10) || 0;
    sounding = a === 1 ? '#' : a === -1 ? 'b' : a === 2 ? '##' : a === -2 ? 'bb' : 'n';
  } else {
    // <alter> 없음 = 내추럴. 단 <accidental> 만 있고 <alter> 를 빠뜨린 비정상
    // 파일은 찍힌 기호를 소리로 믿는다(그게 조판자의 의도다).
    sounding = printedGlyph ?? 'n';
  }
  const ks = keySigDefaultFor(step, keySigLetters, fifths);
  return { sounding, print: (printedGlyph || sounding !== ks) ? sounding : undefined };
}

/** 임시표 글리프 → 반음 변화(소리 계산용). */
const ACC_SEMIS: Record<AccGlyph, number> = { '#': 1, b: -1, n: 0, '##': 2, bb: -2 };

/**
 * 주 빔(<beam number="1">) 을 읽어 음표에 표시한다.
 *   begin → 빔 시작 · end → beamBreak · 없음 → noBeam(홀로 깃발)
 * 2·3차 빔(16·32분음표 꼬리)은 VexFlow 가 음표 길이로 알아서 그린다.
 * 문서 어디에도 <beam> 이 없으면 조판자가 지정을 안 한 것이므로 렌더러의
 * 자동 빔에 맡긴다(`docHasBeams`).
 */
function applyPrimaryBeam(
  nEl: Element, ni: NoteInfo, typeStr: string, isGrace: boolean, docHasBeams: boolean,
  setOpen: (open: boolean) => void,
): void {
  if (!(BEAMABLE_XML_TYPES.has(typeStr) && !isGrace && docHasBeams)) return;
  let primaryBeam: string | null = null;
  for (const be of nEl.querySelectorAll('beam')) {
    if ((be.getAttribute('number') ?? '1') === '1') {
      primaryBeam = (be.textContent ?? '').trim();
      break;
    }
  }
  if (primaryBeam === null) { ni.noBeam = true; setOpen(false); }
  else if (primaryBeam === 'begin') setOpen(true);
  else if (primaryBeam === 'end') { ni.beamBreak = true; setOpen(false); }
  // 'continue' / hooks keep the current beam state.
}

/* ─── 무음정 타악기(드럼) ─────────────────────────────────────────────── */

/** `<score-part>` 의 `<midi-instrument id><midi-unpitched>` → GM 퍼커션 음.
 *  MusicXML 의 midi-unpitched 는 **1-based** 라 GM = 값 − 1 이다. */
function readUnpitchedMap(doc: Document, partId: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!partId) return map;
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    if (sp.getAttribute('id') !== partId) continue;
    for (const mi of sp.querySelectorAll('midi-instrument')) {
      const id = mi.getAttribute('id');
      const raw = mi.querySelector('midi-unpitched')?.textContent;
      if (!id || !raw) continue;
      const v = parseInt(raw, 10);
      if (Number.isFinite(v)) map.set(id, v - 1);
    }
  }
  return map;
}

/** 표기 위치(display-step/octave) + 노트헤드로 GM 을 되짚는 폴백 표.
 *  `<instrument>` 참조가 없거나 매핑에 없는 파일에서 쓴다. */
const DISPLAY_TO_GM = new Map<string, number>(
  DRUM_PALETTE.map((p) => [`${p.displayKey}|${p.head ?? ''}`, p.gm]),
);

function unpitchedGm(nEl: Element, unpitchedEl: Element, map: Map<string, number>): number {
  const ref = nEl.querySelector('instrument')?.getAttribute('id');
  const byRef = ref ? map.get(ref) : undefined;
  if (byRef !== undefined) return byRef;
  const step = (text(unpitchedEl, 'display-step') ?? 'C').toLowerCase();
  const oct = text(unpitchedEl, 'display-octave') ?? '5';
  const head = (text(nEl, 'notehead') ?? '').trim();
  return DISPLAY_TO_GM.get(`${step}/${oct}|${head === 'normal' ? '' : head}`)
    ?? DISPLAY_TO_GM.get(`${step}/${oct}|`)
    ?? 38;   // 최후 폴백: 스네어
}

/** MusicXML `<notehead>` → 모델 값. 'normal'·미지원 모양은 남기지 않는다. */
const NOTEHEAD_MAP: Record<string, NonNullable<NoteInfo['notehead']>> = {
  slash: 'slash', x: 'x', diamond: 'diamond',
  'triangle-up': 'triangle-up', 'triangle-down': 'triangle-down',
  square: 'square', 'circle-x': 'circle-x',
};

/** `<notehead>` · `<cue>` 를 음표에 옮긴다.
 *
 *  재즈 채보의 컴핑 구간은 음정 대신 **리듬 슬래시**로 적힌다(실측: 한 파일에
 *  184개, 전부 고정 자리음 D3). 예전엔 이 표기를 무시해 멜로디 아래 D3 음표가
 *  줄줄이 그려지고 재생에서도 그 음이 울렸다. */
function applyNoteheadCue(nEl: Element, ni: NoteInfo): void {
  const head = (text(nEl, 'notehead') ?? '').trim();
  const mapped = NOTEHEAD_MAP[head];
  if (mapped) ni.notehead = mapped;
  if (nEl.querySelector('cue')) ni.cue = true;
}


/**
 * `<barline>` → 세로줄 모양 · 도돌이 · 볼타. 단선율/양손 파서 공용.
 * 반환값은 갱신된 볼타 상태(다음 마디로 이어진다).
 */
function applyBarline(
  child: Element, measure: MeasureInfo, currentVolta: number | undefined,
): number | undefined {
  const location = child.getAttribute('location');
  /* 겹줄·끝줄. 도돌이가 함께 오면 렌더러가 도돌이를 우선하므로 그냥 둔다. */
  if (location !== 'left') {
    const style = text(child, 'bar-style');
    if (style === 'light-light') measure.barline = 'double';
    else if (style === 'light-heavy') measure.barline = 'end';
    else if (style === 'none') measure.barline = 'none';
  }
  const repeatEl = child.querySelector('repeat');
  if (repeatEl) {
    const dir = repeatEl.getAttribute('direction');
    if (dir === 'forward') measure.repeatStart = true;
    else if (dir === 'backward') measure.repeatEnd = true;
  }
  // A single barline may carry several <ending> elements — homr emits a
  // combined volta as separate numbers (…number="4"…number="1"). The model
  // holds one volta int, so represent the span by its LOWEST number.
  const endingEls = child.querySelectorAll('ending');
  if (endingEls.length > 0) {
    let startNum: number | undefined;
    let hasStop = false;
    for (const e of endingEls) {
      const num = parseInt(e.getAttribute('number') ?? '0', 10);
      const type = e.getAttribute('type');
      if (type === 'start' && num >= 1) {
        startNum = startNum === undefined ? num : Math.min(startNum, num);
      } else if (type === 'stop' || type === 'discontinue') {
        hasStop = true;
      }
    }
    if (startNum !== undefined) {
      measure.volta = startNum;
      return startNum;
    }
    if (hasStop && location !== 'left') {
      // ending stops at the right barline of THIS measure → clear after
      // this iteration so next measure has no volta.
      return undefined;
    }
  }
  return currentVolta;
}

/** `<direction-type>` 의 리허설 마크와 내비게이션(세뇨·코다·D.C./D.S. 텍스트).
 *  기호(세뇨·코다)가 텍스트보다 우선한다 — 보표당 하나만 그릴 수 있어서다. */
function applyRehearsalNav(dirType: Element, measure: MeasureInfo): void {
  const rehearsalEl = dirType.querySelector('rehearsal');
  if (rehearsalEl) {
    const label = (rehearsalEl.textContent ?? '').trim();
    if (label) measure.rehearsal = label;
  }
  if (dirType.querySelector('segno')) { measure.navigation = 'segno'; return; }
  if (dirType.querySelector('coda')) { measure.navigation = 'coda'; return; }
  if (measure.navigation === 'segno' || measure.navigation === 'coda') return;
  for (const w of dirType.querySelectorAll('words')) {
    const nav = parseNavigationWords(w.textContent ?? '');
    if (nav) { measure.navigation = nav; return; }
  }
}

/** 이 <note> 가 타이를 **받는** 쪽인지(시작만 하는 음은 false). */
function noteTieStop(nEl: Element): boolean {
  let stop = false, start = false;
  for (const t of nEl.querySelectorAll(':scope > tie')) {
    const tt = t.getAttribute('type');
    if (tt === 'stop') stop = true;
    if (tt === 'start') start = true;
  }
  return stop && !start;
}

/** Map common "D.C./D.S./Coda/Fine/To Coda" textual variants → NavigationMarker. */
function parseNavigationWords(raw: string): NavigationMarker | null {
  const t = raw.toLowerCase().replace(/[.\s]+/g, '');
  if (t === 'fine') return 'fine';
  if (t === 'tocoda' || t === 'tothecoda') return 'toCoda';
  if (t === 'dcalfine') return 'dcAlFine';
  if (t === 'dcalcoda') return 'dcAlCoda';
  if (t === 'dc' || t === 'dacapo') return 'dc';
  if (t === 'dsalfine') return 'dsAlFine';
  if (t === 'dsalcoda') return 'dsAlCoda';
  if (t === 'ds' || t === 'dalsegno') return 'ds';
  return null;
}

/* Greedy power-of-two rest decomposition. `gapTicks` is a duration in MusicXML
 * <divisions> ticks; returns the rest NoteInfos that fill it (w/h/q/8/16),
 * snapped to a 16th grid. Used to pad the melody line when the chosen voice is
 * silent for part of a bar (the other staff carries the time in a grand-staff
 * transcription). Matches lickData.beatsToRests' non-dotted convention. */
const REST_UNITS: [number, string][] = [[4, 'wr'], [2, 'hr'], [1, 'qr'], [0.5, '8r'], [0.25, '16r']];
function ticksToRests(gapTicks: number, divisions: number): NoteInfo[] {
  if (!(divisions > 0)) return [];
  let beats = Math.round((gapTicks / divisions) * 4) / 4; // snap to 16th grid
  const out: NoteInfo[] = [];
  let guard = 0;
  while (beats > 0.001 && guard++ < 64) {
    const unit = REST_UNITS.find(([b]) => beats >= b - 1e-6);
    if (!unit) break;
    out.push({ keys: ['b/4'], duration: unit[1] });
    beats -= unit[0];
  }
  return out;
}

/* ─── core parser ────────────────────────────────────────────────────── */

interface ParserState {
  fifths: number;
  keySigLetters: Set<string>;
  /** Ticks per quarter note (MusicXML <divisions>). */
  divisions: number;
  /** Beats per measure (from current time signature numerator). */
  beatsPerMeasure: number;
  /** Pending dynamic to attach to the next note. */
  pendingDynamic?: Dynamic;
  /** Pending ottava state — applied to subsequent notes until stopped. */
  ottava?: '8va' | '8vb' | '15ma' | '15mb';
  /** 브래킷 시작 대기 — 다음에 나오는 **음표**에 `ottavaStart` 를 붙인다.
   *  종전엔 시작 지점을 `flatNoteIdx` 로 고정했는데, 지시와 첫 음 사이에 쉼표가
   *  끼면(이 파일의 3개 구간 중 2개) 인덱스가 쉼표에 소모돼 표시를 놓쳤다. */
  ottavaPending?: boolean;
  /** 브래킷 구간에서 `keys`(적히는 음)에 더할 옥타브. 8va=-1 · 8vb=+1 · 15ma=-2 · 15mb=+2. */
  ottavaOctDelta?: number;
  /** Pending hairpin start; flushes on next emitted note. */
  pendingHairpinStart?: 'cresc' | 'dim';
  /** Pending hairpin stop; flushes on next emitted note. */
  pendingHairpinStop?: boolean;
}

/**
 * Parse one part of a MusicXML document into a NoteSheetData.
 *
 * `partEl` scopes the measure walk + initial <attributes> to a SINGLE <part>
 * element. Multi-part scores (PDMX often has 7-16 instrument parts) MUST pass
 * it — otherwise `part > measure` concatenates every part's bars into one
 * monstrous line. When omitted (single-part files: omnibook), it falls back to
 * the whole document, preserving the original behaviour.
 */
/** 파싱 동작 옵션. */
export interface XmlParseOpts {
  /** music21로 MIDI→MusicXML 변환된 풀 피아노 "연주" 악보(맥켄지 정량화본 등).
   *  이런 파일은 (a) voice 번호가 마디 단위로 재배정돼 "voice 1 고정" 추출이
   *  왼손 베이스를 집어오고, (b) 저음 컴핑이 멜로디 줄에 섞인다. 켜면:
   *  마디마다 평균 피치가 가장 높은 voice를 멜로디로 선택하고, C3(옥타브 3)
   *  미만 노트는 쉼표로 치환한다. 리드시트/singe-voice 악보(Omnibook 등)에는
   *  켜지 말 것. */
  pianoPerformance?: boolean;
  /** Grand-staff (piano, 2-stave) mode: keep BOTH staves and ALL chord tones.
   *  staff 1 → `measures` (treble/RH), staff 2 → `bassMeasures` (bass/LH); each
   *  chord group becomes one multi-key NoteInfo. Auto-enabled when a part has
   *  `<staves>2</staves>` and pianoPerformance is off. */
  grandStaff?: boolean;
  /** @internal 이 voice 만 뽑는다 — 한 보표의 **두 번째 성부**를 같은 코드로 한 번
   *  더 훑기 위한 스위치다(voice2 채우기). 외부에서 쓰지 않는다. */
  onlyVoice?: string;
}

/** 이 파트에 실제 음표가 있는 voice 들을 **많은 순서**로 돌려준다.
 *  단일 보표에 두 성부가 겹쳐 적힌 악보(왼손 컴핑 위 멜로디 등)를 찾아낸다. */
function partVoices(scope: Element | Document): string[] {
  const count = new Map<string, number>();
  for (const nEl of scope.querySelectorAll('measure > note')) {
    if (!nEl.querySelector('pitch') && !nEl.querySelector('unpitched')) continue;
    const v = nEl.querySelector('voice')?.textContent ?? '1';
    count.set(v, (count.get(v) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([v]) => v);
}

/* 피치 근사용 반음 오프셋 (voice 평균 피치 비교에만 사용 — alter 무시). */
const STEP_SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseXmlDoc(doc: Document, fallbackTitle: string, partEl?: Element, opts?: XmlParseOpts): NoteSheetData {

  /* ── metadata ────────────────────────────────────────────────────── */
  const xmlTitle = text(doc.documentElement, 'work-title')
                ?? text(doc.documentElement, 'movement-title');
  // music21이 제목 메타데이터 없이 변환한 파일은 movement-title이 placeholder
  // "Music21 Fragment"다 — 실제 제목이 아니므로 파일명 기반 fallback을 쓴다.
  const title = (xmlTitle && xmlTitle !== 'Music21 Fragment') ? xmlTitle : fallbackTitle;
  const composer = text(doc.documentElement, 'creator[type="composer"]') ?? 'Unknown';

  // Initial attributes (key/divisions/time) — scoped to THIS part when given,
  // since transposing instruments carry their own key/divisions.
  //
  // homr (and some other engravers) SPLIT the opening <attributes> into several
  // blocks in the first measure — e.g. divisions+staves in one block, key+time+
  // clef in the next. Reading a single `querySelector('attributes')` then drops
  // the key/time entirely (→ wrong key signature, wrong metre). Read each field
  // from the FIRST MEASURE's descendants instead: querySelector returns the
  // first occurrence in document order = the initial value (a later mid-piece
  // change is still handled per-measure below).
  const firstMeasure = (partEl ?? doc).querySelector('measure');
  const attrScope: Element = firstMeasure ?? partEl ?? doc.documentElement;
  const initialFifths = parseInt(text(attrScope, 'fifths') ?? '0', 10);
  const beats    = text(attrScope, 'time > beats') ?? '4';
  const beatType = text(attrScope, 'time > beat-type') ?? '4';
  const timeSig  = `${beats}/${beatType}`;
  const initialKey = KEY_NAMES[initialFifths + 7] ?? 'C';
  // <divisions>N</divisions> = ticks per quarter note. Needed for inferring
  // a note's type (whole/half/quarter/…) when <type> is missing.
  const initialDivisions = parseInt(text(attrScope, 'divisions') ?? '1', 10) || 1;
  const initialBeatsPerMeasure = parseInt(beats, 10) || 4;

  // Tempo: prefer <sound tempo="N"/>; fall back to <metronome><per-minute>N</per-minute></metronome>.
  // Many engravers include both for compat; <sound> is the playback hint while
  // <metronome> is the printed marking. Either tells us "♩=N".
  const soundEl = doc.querySelector('sound[tempo]');
  let tempo: number | undefined;
  if (soundEl) {
    tempo = Math.round(parseFloat(soundEl.getAttribute('tempo')!));
  } else {
    const metroPerMin = doc.querySelector('metronome per-minute');
    const parsed = metroPerMin ? parseFloat(metroPerMin.textContent ?? '') : NaN;
    if (Number.isFinite(parsed) && parsed > 0) tempo = Math.round(parsed);
  }

  // Does this document engrave beam decisions anywhere? Well-engraved scores
  // (Parker Omnibook) carry <beam> elements throughout; a measure that omits
  // them is INTENTIONALLY unbeamed (commonly happens around tied eighths so
  // the tie curve reads clearly). A bare transcription (e.g. miles_davis_xml/
  // Airegin) carries no beam info at all and expects the renderer to auto-beam.
  // File-level detection picks the right interpretation in each case.
  const docHasBeams = doc.querySelector('beam') !== null;

  /* 드럼 보표용 <instrument id> → GM 표(무음정 음표 해석). 음정 파트에선 빈 맵. */
  const unpitchedMap = readUnpitchedMap(doc, partEl?.getAttribute('id') ?? null);

  /* 뽑아낼 성부. 지정이 없으면 이 파트에서 음표가 가장 많은 voice 다 — 예전엔
   * '1' 고정이라, 조판자가 voice 2·5 로만 적은 파트가 통째로 빈 악보가 됐다. */
  const defaultVoice = opts?.onlyVoice ?? partVoices(partEl ?? doc)[0] ?? '1';

  /* ── parse measures in order, tracking running state ─────────────── */
  const measures: MeasureInfo[] = [];
  const state: ParserState = {
    fifths: initialFifths,
    keySigLetters: keySigLettersFor(initialFifths),
    divisions: initialDivisions,
    beatsPerMeasure: initialBeatsPerMeasure,
  };

  // Volta tracking: an <ending number="1"> spans one or more measures
  // until <ending type="stop"/>. We mark each measure inside the span.
  let currentVolta: number | undefined;

  // Scope to a single part when given (multi-part scores); else whole doc.
  const partMeasures = partEl
    ? partEl.querySelectorAll(':scope > measure')
    : doc.querySelectorAll('part > measure');

  for (let measureIdx = 0; measureIdx < partMeasures.length; measureIdx++) {
    const mEl = partMeasures[measureIdx];
    const measure: MeasureInfo = { notes: [] };

    // Pickup detection: implicit="yes" attribute on <measure>
    if (mEl.getAttribute('implicit') === 'yes') {
      measure.anacrusis = true;
    }

    // Carry volta from previous measure (volta spans multiple bars
    // until ending type="stop" arrives).
    if (currentVolta !== undefined) {
      measure.volta = currentVolta;
    }

    const measureChords: string[] = [];

    /* pianoPerformance: 이 마디의 멜로디 voice 선택 — 평균 피치가 가장 높은
     * voice. music21은 voice 번호를 마디 단위로 재배정하므로 "voice 1 고정"은
     * 멜로디가 쉬는 마디에서 왼손 베이스를 멜로디로 집어온다(레저라인 저음이
     * 랜덤하게 섞이던 버그의 원인). */
    let melodyVoice = defaultVoice;
    if (opts?.pianoPerformance && !opts.onlyVoice) {
      const acc = new Map<string, { sum: number; n: number }>();
      for (const nEl of Array.from(mEl.children)) {
        if (nEl.tagName !== 'note') continue;
        const pitchEl = nEl.querySelector('pitch');
        if (!pitchEl) continue;
        const step = (text(pitchEl, 'step') ?? 'C').toUpperCase();
        const oct = parseInt(text(pitchEl, 'octave') ?? '4', 10);
        const midi = (oct + 1) * 12 + (STEP_SEMIS[step] ?? 0);
        const v = text(nEl, 'voice') ?? '1';
        const e = acc.get(v) ?? { sum: 0, n: 0 };
        e.sum += midi; e.n += 1;
        acc.set(v, e);
      }
      let bestAvg = -Infinity;
      for (const [v, { sum, n }] of acc) {
        const avg = sum / n;
        if (avg > bestAvg) { bestAvg = avg; melodyVoice = v; }
      }
    }

    // Beam-open tracker: turns true on <beam>begin</beam>, false after the
    // matching <beam>end</beam>. Used to flag rests that sit inside a beam
    // group (XML encoding: rests carry no <beam> element, but the engraver
    // wants the beam line to extend over them — common in 16th-rest patterns).
    let beamOpen = false;

    // Per-measure parser context for slur/ottava etc.
    let pendingFermata = false;
    let pendingArticulations: Articulation[] = [];
    let pendingOrnaments: Ornament[] = [];
    let pendingGliss = false;
    let pendingSlurStart = false;
    let pendingSlurStop = false;

    // Time cursor (in <divisions> ticks) so we can (a) honour <backup>/<forward>
    // and (b) rest-pad gaps where the melody voice is silent. emitTimes[k] is the
    // {startTick,durTicks} of measure.notes[k], filled in lockstep with each push.
    let curTick = 0;
    const emitTimes: { startTick: number; durTicks: number }[] = [];
    /* 직전에 방출한 음표와 그 화음 구성음 — 뒤따르는 <chord> 가 여기에 쌓인다.
     * 화음은 마디를 넘지 않으므로 마디마다 새로 만든다. */
    let chordGroup: { ni: NoteInfo; tones: ChordTone[] } | null = null;

    // Walk measure children in document order.
    for (const child of Array.from(mEl.children)) {
      const tag = child.tagName;

      /* ── <backup>/<forward>: move the time cursor (voice layering) ──── */
      if (tag === 'backup') {
        curTick -= parseInt(text(child, 'duration') ?? '0', 10) || 0;
        continue;
      }
      if (tag === 'forward') {
        curTick += parseInt(text(child, 'duration') ?? '0', 10) || 0;
        continue;
      }

      /* ── <attributes>: mid-piece time/key change ─────────────────── */
      if (tag === 'attributes') {
        const fifthsTxt = text(child, 'fifths');
        if (fifthsTxt !== null) {
          const f = parseInt(fifthsTxt, 10);
          if (!Number.isNaN(f) && f !== state.fifths) {
            state.fifths = f;
            state.keySigLetters = keySigLettersFor(f);
            if (measureIdx > 0) measure.key = KEY_NAMES[f + 7] ?? 'C';
          }
        }
        const beatsTxt = text(child, 'time > beats');
        const beatTypeTxt = text(child, 'time > beat-type');
        if (beatsTxt && beatTypeTxt) {
          const ts = `${beatsTxt}/${beatTypeTxt}`;
          if (measureIdx > 0 && ts !== timeSig) measure.timeSignature = ts;
          state.beatsPerMeasure = parseInt(beatsTxt, 10) || state.beatsPerMeasure;
        }
        // <divisions> can change mid-piece (rare but valid).
        const divTxt = text(child, 'divisions');
        if (divTxt) {
          const d = parseInt(divTxt, 10);
          if (Number.isFinite(d) && d > 0) state.divisions = d;
        }
        // Mid-piece clef change: <clef><sign>F</sign><line>4</line></clef>.
        // Treble (G2), bass (F4), alto (C3), tenor (C4). Only set when changing.
        const clefEl = child.querySelector('clef');
        if (clefEl && measureIdx > 0) {
          const sign = text(clefEl, 'sign');
          const line = text(clefEl, 'line');
          let newClef: 'treble' | 'bass' | 'alto' | 'tenor' | undefined;
          if (sign === 'G' && (line === '2' || line === null)) newClef = 'treble';
          else if (sign === 'F' && (line === '4' || line === null)) newClef = 'bass';
          else if (sign === 'C' && line === '3') newClef = 'alto';
          else if (sign === 'C' && line === '4') newClef = 'tenor';
          if (newClef) measure.clef = newClef;
        }
        continue;
      }

      /* ── <print>: 시스템/페이지 브레이크 → 줄바꿈 ─────────────────
       * 조판자가 정한 줄바꿈 위치다. 예전엔 무시해서 원본과 줄 구성이 달라졌다
       * (마디 배열이 밀려 "어디가 어디인지" 대조가 안 됨). `lineBreak` 는 **앞
       * 마디 뒤**에서 끊으라는 뜻이라 직전 마디에 표시한다. */
      if (tag === 'print') {
        const brk = child.getAttribute('new-system') === 'yes'
          || child.getAttribute('new-page') === 'yes';
        if (brk && measureIdx > 0) measures[measureIdx - 1].lineBreak = true;
        continue;
      }

      /* ── <barline>: repeat + volta endings + 세로줄 모양 ──────────── */
      if (tag === 'barline') {
        currentVolta = applyBarline(child, measure, currentVolta);
        continue;
      }

      /* ── <direction>: segno/coda/words/octave-shift/dynamics ─────── */
      if (tag === 'direction') {
        const dirType = child.querySelector('direction-type');
        if (!dirType) continue;
        /* 리허설 마크(A · B1 · Solo …)와 내비게이션. 예전엔 리허설을 아예 읽지
         * 않아 전부 사라지고 있었다(실측: 10개 파일 55개). */
        applyRehearsalNav(dirType, measure);
        /* ── Octave-shift (8va·8vb·15ma·15mb) ─────────────────────────────
         * ⚠️ 두 가지를 뒤집으면 안 된다.
         *
         * ① **방향**: MusicXML 의 type 은 "적힌 음이 울리는 음에서 어느 쪽으로
         *    옮겨졌나"다. 따라서 `type="down"` = 적힌 음이 한 옥타브 **아래** =
         *    화면에는 **8va** 브래킷이다(`up` 이 8vb). 종전 코드가 이걸 반대로
         *    매핑해, 8va 자리에 8vb 가 붙어 재생이 두 옥타브 어긋났다.
         *
         * ② **피치**: MusicXML `<pitch>` 는 **울리는 음**이고, 우리 모델은
         *    `keys` = **적히는 음** + `ottavaStart` 가 재생을 ±12/±24 옮긴다
         *    (noteSheetToChart). 그래서 브래킷 구간의 음은 옥타브를 되돌려
         *    적어야 한다 — 안 그러면 덧줄이 5~6개 쌓인 채 그려지고, 재생은
         *    한 옥타브 더 올라간다.
         *
         * 실측 근거: 이 구간의 음이 Eb7(=99)인데, 이게 '적힌 음'이라면 울림은
         * 111 로 피아노 최고음(108)을 넘어 불가능하다 → 저장된 값이 울림음이다. */
        const oct = dirType.querySelector('octave-shift');
        if (oct) {
          const ot = oct.getAttribute('type');
          const size = oct.getAttribute('size') ?? '8';
          if (ot === 'down' || ot === 'up') {
            const two = size === '15';
            state.ottava = ot === 'down'
              ? (two ? '15ma' : '8va')
              : (two ? '15mb' : '8vb');
            // 적히는 음 = 울리는 음 − 재생 시프트. (8va → −1옥타브)
            state.ottavaOctDelta = (ot === 'down' ? -1 : 1) * (two ? 2 : 1);
            state.ottavaPending = true;   // 다음 음표에 붙인다
          } else if (ot === 'stop') {
            // 마지막으로 나온 **음표**(쉼표 아님)에 끝 표시를 붙인다.
            for (let k = measure.notes.length - 1; k >= 0; k--) {
              if (!measure.notes[k].duration.endsWith('r')) { measure.notes[k].ottavaEnd = true; break; }
            }
            state.ottava = undefined;
            state.ottavaOctDelta = undefined;
            state.ottavaPending = undefined;
          }
        }
        // Dynamics
        const dyn = dirType.querySelector('dynamics');
        if (dyn) {
          for (const dn of Array.from(dyn.children)) {
            const name = dn.tagName.toLowerCase();
            if (DYNAMIC_TAGS.has(name as Dynamic)) {
              state.pendingDynamic = name as Dynamic;
              break;
            }
          }
        }
        // Hairpin (crescendo/diminuendo wedge). Attaches to NEXT/PREV note.
        //   <wedge type="crescendo"/>  → start of <
        //   <wedge type="diminuendo"/> → start of >
        //   <wedge type="stop"/>       → end either
        const wedgeEl = dirType.querySelector('wedge');
        if (wedgeEl) {
          const wt = wedgeEl.getAttribute('type');
          if (wt === 'crescendo') state.pendingHairpinStart = 'cresc';
          else if (wt === 'diminuendo') state.pendingHairpinStart = 'dim';
          else if (wt === 'stop') state.pendingHairpinStop = true;
        }
        // Mid-piece tempo change: prefer <sound tempo="N"/>; fall back to
        // <direction-type><metronome><per-minute>N</per-minute></metronome>.
        if (measureIdx > 0 && measure.tempo === undefined) {
          const soundTempoEl = child.querySelector('sound[tempo]');
          if (soundTempoEl) {
            const t = parseFloat(soundTempoEl.getAttribute('tempo') ?? '');
            if (Number.isFinite(t) && t > 0) measure.tempo = Math.round(t);
          } else {
            const mpm = dirType.querySelector('metronome per-minute');
            const t = mpm ? parseFloat(mpm.textContent ?? '') : NaN;
            if (Number.isFinite(t) && t > 0) measure.tempo = Math.round(t);
          }
        }
        continue;
      }

      /* ── <harmony>: chord change at this position ───────────────── */
      if (tag === 'harmony') {
        const sym = harmonySymbol(child);
        if (sym && measureChords[measureChords.length - 1] !== sym) measureChords.push(sym);
        continue;
      }

      /* ── <note> ─────────────────────────────────────────────────── */
      if (tag !== 'note') continue;
      const nEl = child;

      // Time bookkeeping: only the FIRST note of a chord group and standalone
      // notes/rests advance the cursor; <chord> sub-notes are simultaneous and
      // grace notes steal no metric time. `advance` is added to curTick at every
      // exit of this note branch (0 for chord/grace).
      const advDurTxt = text(nEl, 'duration');
      const advDurTicks = advDurTxt ? (parseInt(advDurTxt, 10) || 0) : 0;
      const isChordTone = !!nEl.querySelector('chord');
      const isGraceTone = !!nEl.querySelector('grace');
      const advance = (isChordTone || isGraceTone) ? 0 : advDurTicks;
      const startTick = curTick;

      /* 화음(<chord>) 처리.
       *
       * 기본은 **음을 모두 보존**한다 — 재즈 피아노 채보(Red Garland 등)는 한
       * 줄짜리 보표에도 옥타브·더블스톱·블록보이싱이 흔한데, 예전엔 그룹의
       * 최고음만 남기고 나머지를 버려서 화음이 통째로 사라졌다(실측: 한 파일에서
       * 80개). NoteInfo 는 keys[] + 인덱스별 임시표로 화음을 이미 표현할 수 있고
       * 두 렌더러(에디터·뷰어)도 그대로 그린다.
       *
       * pianoPerformance(멜로디 추출) 모드에서만 예전처럼 최고음 하나로 줄인다 —
       * 그 모드의 목적이 "왼손 컴핑을 걷어낸 멜로디 한 줄"이기 때문이다. */
      if (isChordTone) {
        const chordVoice = text(nEl, 'voice');
        // Only merge into the melody line if this chord tone belongs to the
        // melody voice — otherwise a left-hand chord would corrupt the last
        // melody note.
        if (chordVoice && chordVoice !== melodyVoice) { curTick += advance; continue; }
        /* 드럼 동시타(킥+하이햇 등)도 <chord> 로 온다 — 음정이 아니라 GM 번호를
         * 담는 것만 다르다. 예전엔 <pitch> 가 없어 그냥 버려졌다. */
        const subUnpitched = nEl.querySelector('unpitched');
        if (chordGroup && subUnpitched) {
          const gm = unpitchedGm(nEl, subUnpitched, unpitchedMap);
          chordGroup.tones.push({ key: gmToVexKey(gm), midi: gm });
          applyChordTones(chordGroup.ni, chordGroup.tones);
          curTick += advance;
          continue;
        }
        const subPitch = nEl.querySelector('pitch');
        if (chordGroup && subPitch) {
          const sStep = (text(subPitch, 'step') ?? 'C').toLowerCase();
          const sOct = parseInt(text(subPitch, 'octave') ?? '4', 10);
          const sAcc = readAccidental(nEl, subPitch, sStep, state.keySigLetters, state.fifths);
          const tone: ChordTone = {
            key: `${sStep}/${sOct + (state.ottavaOctDelta ?? 0)}`,
            acc: sAcc.print,
            midi: (sOct + 1) * 12 + (STEP_SEMIS[sStep.toUpperCase()] ?? 0) + ACC_SEMIS[sAcc.sounding],
          };
          if (noteTieStop(nEl)) tone.tieStop = true;
          if (opts?.pianoPerformance) {
            // 멜로디 추출: 더 높은 음이면 대표음을 교체(예전 동작).
            if (tone.midi > chordGroup.tones[0].midi) chordGroup.tones = [tone];
          } else {
            chordGroup.tones.push(tone);
          }
          applyChordTones(chordGroup.ni, chordGroup.tones);
        }
        curTick += advance;
        continue;
      }
      // 화음이 아닌 요소가 나오면 직전 화음 그룹은 닫힌다.
      chordGroup = null;

      // Single-voice extraction — 기본은 voice 1, pianoPerformance 모드에선
      // 위에서 마디별로 고른 최고-평균-피치 voice. 다른 voice도 시간은 흐르므로
      // curTick 은 advance 시키고 건너뛴다.
      const voiceText = text(nEl, 'voice');
      if (voiceText && voiceText !== melodyVoice) { curTick += advance; continue; }

      // ── Tie / Slur handling
      const tieEls = nEl.querySelectorAll('tie');
      let tieStart = false;
      let tieStop = false;
      for (const t of tieEls) {
        const tt = t.getAttribute('type');
        if (tt === 'start') tieStart = true;
        if (tt === 'stop')  tieStop = true;
      }

      // Notations: slur, articulations, fermata, ornaments, glissando.
      const notations = nEl.querySelector('notations');
      const noteArticulations: Articulation[] = [];
      const noteOrnaments: Ornament[] = [];
      let noteFermata = false;
      let noteGliss = false;
      let noteScoop = false;
      let noteFall = false;
      let noteSlurStart = false;
      let noteSlurStop = false;
      if (notations) {
        // Slurs (track by number; here we just propagate start/stop flags).
        const slurs = notations.querySelectorAll('slur');
        for (const sl of slurs) {
          const sType = sl.getAttribute('type');
          if (sType === 'start') noteSlurStart = true;
          if (sType === 'stop')  noteSlurStop = true;
        }
        // Articulations
        const artEl = notations.querySelector('articulations');
        if (artEl) {
          for (const a of Array.from(artEl.children)) {
            const mapped = ARTICULATION_TAGS[a.tagName];
            if (mapped) noteArticulations.push(mapped);
          }
          /* 재즈 슬라이드 — 표준 <scoop/> · <falloff/>. 모델에 필드가 있는데
           * 읽지 않아 수입 시 사라지고 있었다(양쪽 경로 모두 보강). */
          if (artEl.querySelector('scoop')) noteScoop = true;
          if (artEl.querySelector('falloff')) noteFall = true;
        }
        // Fermata
        if (notations.querySelector('fermata')) noteFermata = true;
        // Ornaments
        const ornEl = notations.querySelector('ornaments');
        if (ornEl) {
          for (const o of Array.from(ornEl.children)) {
            const mapped = ORNAMENT_TAGS[o.tagName];
            if (mapped) noteOrnaments.push(mapped);
          }
        }
        // Glissando / slide
        const glissEl = notations.querySelector('glissando, slide');
        if (glissEl && glissEl.getAttribute('type') === 'start') {
          noteGliss = true;
        }
      }

      // Pure tie continuation (just <tie type="stop"/>, no start): keep the
      // note in data so the visual renderer can pair it with the previous
      // tie=true note and draw a StaveTie. Mark tieContinuation so the
      // PLAYER absorbs its duration into the previous note's sound instead
      // of re-attacking. Slurs/articulations attached to this note remain
      // valid (they belong here).
      const isPureTieContinuation = tieStop && !tieStart;

      const restEl = nEl.querySelector('rest');
      const isRest = !!restEl;
      // <rest measure="yes"/> = whole-measure rest, regardless of duration value
      // or current time signature (modern convention: hanging from 4th line).
      // Also auto-detect: a rest with duration matching the measure's total
      // and no <type> element is a full-measure rest (common XML simplification).
      const isMeasureAttr = restEl?.getAttribute('measure') === 'yes';
      const restDurationTicks = restEl ? parseInt(text(nEl, 'duration') ?? '0', 10) : 0;
      const noTypeYet = !text(nEl, 'type');
      const isFullMeasureRest = isMeasureAttr
        || (restEl !== null && noTypeYet && state.divisions > 0
            && Math.abs(restDurationTicks / state.divisions - state.beatsPerMeasure) < 0.01);
      const isGrace = !!nEl.querySelector('grace');
      const graceSlash = isGrace
        ? nEl.querySelector('grace')?.getAttribute('slash') === 'yes'
        : false;

      // <type> may be omitted — particularly common for full-measure rests
      // (e.g. <note><rest/><duration>48</duration></note> in a 4/4 piece
      // with divisions=12). When missing, derive the type from <duration> /
      // <divisions> so we don't fall through to the 'quarter' default.
      let typeStr = text(nEl, 'type');
      const durationTxt = text(nEl, 'duration');
      const durationTicks = durationTxt ? parseInt(durationTxt, 10) : NaN;
      if (!typeStr && Number.isFinite(durationTicks) && state.divisions > 0) {
        // Beats this note occupies (relative to a quarter note).
        const noteBeats = durationTicks / state.divisions;
        // Whole-measure rest: duration matches the measure's total beat count.
        if (Math.abs(noteBeats - state.beatsPerMeasure) < 0.01) {
          typeStr = 'whole';
        } else if (noteBeats >= 6) typeStr = 'whole';      // approximate
        else if (noteBeats >= 3) typeStr = 'half';         // dotted half handled via <dot>
        else if (noteBeats >= 1.5) typeStr = 'quarter';
        else if (noteBeats >= 0.75) typeStr = 'eighth';
        else if (noteBeats >= 0.375) typeStr = '16th';
        else if (noteBeats >= 0.1875) typeStr = '32nd';
        else typeStr = '64th';
      }
      typeStr = typeStr ?? 'quarter';
      const vf = TYPE_TO_VF[typeStr] ?? 'q';
      const isDotted = !!nEl.querySelector('dot');

      // Tuplet detection — keep BOTH actual & normal (XML may use unusual
      // ratios like 7:6, 5:3 that can't be inferred from 'actual' alone).
      const tmEl = nEl.querySelector('time-modification');
      let tuplet: number | undefined;
      let tupletNormal: number | undefined;
      if (tmEl) {
        const actual = parseInt(text(tmEl, 'actual-notes') ?? '0', 10);
        const normal = parseInt(text(tmEl, 'normal-notes') ?? '0', 10);
        if (actual > normal && actual > 1) {
          tuplet = actual;
          tupletNormal = normal;
        }
      }
      // Tuplet bracket — appears on <tuplet type="start"> inside <notations>.
      // bracket="no" means draw just the "3" / "5" / … without a horizontal
      // bracket (idiomatic for beamed tuplets in jazz lead sheets).
      let tupletBracketAttr: boolean | undefined;
      const tupletStartEl = notations?.querySelector('tuplet[type="start"]');
      if (tupletStartEl) {
        const br = tupletStartEl.getAttribute('bracket');
        if (br === 'no') tupletBracketAttr = false;
        else if (br === 'yes') tupletBracketAttr = true;
      }

      if (isRest) {
        // <rest measure="yes"/> overrides the type-derived duration with
        // a whole-rest glyph (standard for full-bar rests in any time sig).
        const restDur = isFullMeasureRest ? 'wr' : (vf + 'r');
        const restNote: NoteInfo = { keys: ['b/4'], duration: restDur };
        if (isDotted) restNote.dotted = true;
        if (tuplet) restNote.tuplet = tuplet;
        if (tupletNormal) restNote.tupletNormal = tupletNormal;
        if (tupletBracketAttr !== undefined) restNote.tupletBracket = tupletBracketAttr;
        if (noteFermata) restNote.fermata = true;
        // If we're inside an open beam group (between <beam>begin</beam> and
        // its matching <beam>end</beam>), the rest sits visually under the beam.
        if (docHasBeams && beamOpen && BEAMABLE_XML_TYPES.has(typeStr)) {
          restNote.restInBeam = true;
        }
        measure.notes.push(restNote);
        emitTimes.push({ startTick, durTicks: advDurTicks });
        curTick += advance;
        continue;
      }

      /* 무음정 타악기(<unpitched>) — 드럼 보표. 예전엔 <pitch> 가 없다는 이유로
       * 통째로 버려서 드럼 파트가 전부 쉼표로 나왔다(실측: 한 파일 538개).
       * 드럼 데이터 계약은 keys 에 **GM 퍼커션 음**을 담는 것이라
       * (drumNotation.gmToVexKey), 표기 위치는 렌더러가 그 GM 으로 다시 정한다. */
      const unpitchedEl = nEl.querySelector('unpitched');
      if (unpitchedEl) {
        const gm = unpitchedGm(nEl, unpitchedEl, unpitchedMap);
        const dn: NoteInfo = { keys: [gmToVexKey(gm)], duration: vf };
        if (isDotted) dn.dotted = true;
        if (tuplet) dn.tuplet = tuplet;
        if (tupletNormal) dn.tupletNormal = tupletNormal;
        if (tupletBracketAttr !== undefined) dn.tupletBracket = tupletBracketAttr;
        if (isGrace) { dn.grace = true; if (graceSlash) dn.graceSlash = true; }
        if (tieStart) dn.tie = true;
        if (isPureTieContinuation) dn.tieContinuation = true;
        if (noteArticulations.length > 0) dn.articulations = [...noteArticulations];
        if (noteFermata) dn.fermata = true;
        if (state.pendingDynamic) { dn.dynamics = state.pendingDynamic; state.pendingDynamic = undefined; }
        applyNoteheadCue(nEl, dn);
        applyPrimaryBeam(nEl, dn, typeStr, isGrace, docHasBeams, (open) => { beamOpen = open; });
        const stemTxtD = text(nEl, 'stem');
        if (stemTxtD === 'up' || stemTxtD === 'down') dn.stem = stemTxtD;
        measure.notes.push(dn);
        emitTimes.push({ startTick, durTicks: advDurTicks });
        // 뒤따르는 <chord> 동시타가 이 음표에 쌓이도록 그룹을 연다.
        chordGroup = { ni: dn, tones: [{ key: dn.keys[0], midi: gm }] };
        curTick += advance;
        continue;
      }

      const pitchEl = nEl.querySelector('pitch');
      if (!pitchEl) { curTick += advance; continue; }

      const step   = (text(pitchEl, 'step') ?? 'C').toLowerCase();
      const octave = text(pitchEl, 'octave') ?? '4';

      /* pianoPerformance: C3 미만(옥타브 ≤ 2)은 멜로디가 아니라 왼손 베이스 —
       * 리듬 자리는 지키도록 쉼표로 치환한다(삭제하면 마디 박자가 무너짐). */
      if (opts?.pianoPerformance && parseInt(octave, 10) < 3) {
        const bassRest: NoteInfo = { keys: ['b/4'], duration: vf + 'r' };
        if (isDotted) bassRest.dotted = true;
        if (tuplet) bassRest.tuplet = tuplet;
        if (tupletNormal) bassRest.tupletNormal = tupletNormal;
        measure.notes.push(bassRest);
        emitTimes.push({ startTick, durTicks: advDurTicks });
        curTick += advance;
        continue;
      }

      /* 옥타브 브래킷 구간이면 적히는 음으로 되돌린다(위 ② 참고). */
      const writtenOctave = state.ottavaOctDelta
        ? String(parseInt(octave, 10) + state.ottavaOctDelta)
        : octave;

      const ni: NoteInfo = {
        keys: [`${step}/${writtenOctave}`],
        duration: vf,
      };
      if (isDotted) ni.dotted = true;
      if (tuplet) ni.tuplet = tuplet;
      if (tupletNormal) ni.tupletNormal = tupletNormal;
      if (tupletBracketAttr !== undefined) ni.tupletBracket = tupletBracketAttr;
      if (isGrace) {
        ni.grace = true;
        if (graceSlash) ni.graceSlash = true;
      }

      // Accidental — 조표 기준 최소 표기(readAccidental 주석 참조). 조표가 이미
      // 주는 변화음은 생략하고, 조표와 다른 소리(내추럴 취소 포함)만 명시한다.
      const acc = readAccidental(nEl, pitchEl, step, state.keySigLetters, state.fifths);
      if (acc.print) ni.accidentals = { 0: acc.print };

      // Tie (visualization): mark tie=true on this note if it ties to the
      // next note. We keep BOTH notes (start + stop) — the renderer draws
      // the StaveTie curve between them. Pure tie-stop notes were already
      // skipped above, so we only mark the start side here.
      if (tieStart) ni.tie = true;
      if (isPureTieContinuation) ni.tieContinuation = true;

      // Slur propagation
      if (noteSlurStart || pendingSlurStart) ni.slurStart = true;
      if (noteSlurStop || pendingSlurStop) ni.slurStop = true;
      pendingSlurStart = false;
      pendingSlurStop = false;

      // Expression attachments
      if (noteArticulations.length > 0 || pendingArticulations.length > 0) {
        ni.articulations = [...pendingArticulations, ...noteArticulations];
      }
      pendingArticulations = [];
      if (noteFermata || pendingFermata) ni.fermata = true;
      pendingFermata = false;
      if (noteOrnaments.length > 0 || pendingOrnaments.length > 0) {
        ni.ornaments = [...pendingOrnaments, ...noteOrnaments];
      }
      pendingOrnaments = [];
      if (noteGliss || pendingGliss) ni.gliss = true;
      if (noteScoop) ni.scoop = true;
      if (noteFall) ni.fall = true;
      pendingGliss = false;

      // Dynamic attaches to NEXT real note onset.
      if (state.pendingDynamic) {
        ni.dynamics = state.pendingDynamic;
        state.pendingDynamic = undefined;
      }
      // Hairpin start/stop attaches to NEXT real note onset.
      if (state.pendingHairpinStart) {
        ni.hairpinStart = state.pendingHairpinStart;
        state.pendingHairpinStart = undefined;
      }
      if (state.pendingHairpinStop) {
        ni.hairpinStop = true;
        state.pendingHairpinStop = undefined;
      }

      // Ottava — 구간의 첫 음표에 시작 표시.
      if (state.ottava && state.ottavaPending) {
        ni.ottavaStart = state.ottava;
        state.ottavaPending = undefined;
      }

      // ── Explicit beam grouping (primary <beam number="1">).
      // MusicXML encodes per-note beam membership:
      //   begin    → first note of a beam group
      //   continue → interior note
      //   end      → last note of a beam group → beamBreak = true
      //   (absent in an engraved measure) → standalone flagged note → noBeam = true
      // We only handle the primary beam; secondary/tertiary beams (16th/32nd
      // tails) are drawn automatically by VexFlow's Beam from the note types.
      // Non-beamable types (whole/half/quarter) never carry a beam element and
      // need no annotation. We only consult <beam> when the surrounding measure
      // has ANY beam markup — otherwise the engraver simply didn't specify and
      // we hand off to the renderer's heuristic auto-beamer.
      applyPrimaryBeam(nEl, ni, typeStr, isGrace, docHasBeams, (open) => { beamOpen = open; });

      applyNoteheadCue(nEl, ni);

      // ── Explicit stem direction (<stem>up|down</stem>).
      // VexFlow's autoStem picks per-note based on pitch position alone, which
      // diverges from the engraver's choice on the staff-middle line (B4) and
      // for stem-flipped phrases. Honour the XML directly when present.
      const stemTxt = text(nEl, 'stem');
      if (stemTxt === 'up' || stemTxt === 'down') ni.stem = stemTxt;

      // ── 가사 <lyric> — 절(number)별 음절. 한 음표에 여러 절이 붙을 수 있다.
      // syllabic 은 하이픈 판단('begin'/'middle' 뒤에 하이픈), extend 는 멜리스마.
      // 화음의 둘째 음(<chord/>)에는 가사가 붙지 않으므로 여기서만 읽으면 된다.
      const lyricEls = nEl.querySelectorAll(':scope > lyric');
      if (lyricEls.length > 0) {
        const syllables: LyricSyllable[] = [];
        for (const lEl of lyricEls) {
          // <text> 가 여러 개면(엘리전: "don't" 같은 결합) 사이를 이어 붙인다.
          const parts = [...lEl.querySelectorAll(':scope > text')].map((t) => t.textContent ?? '');
          const txt = parts.join('').trim();
          if (!txt) continue;
          const rawNum = lEl.getAttribute('number');
          const verse = Number.parseInt(rawNum ?? '1', 10);
          const syl = (text(lEl, 'syllabic') ?? '').trim();
          const syllable: LyricSyllable = {
            verse: Number.isFinite(verse) && verse > 0 ? verse : 1,
            text: txt,
          };
          if (syl === 'single' || syl === 'begin' || syl === 'middle' || syl === 'end') syllable.syllabic = syl;
          if (lEl.querySelector(':scope > extend')) syllable.extend = true;
          syllables.push(syllable);
        }
        if (syllables.length > 0) {
          syllables.sort((x, y) => x.verse - y.verse);
          ni.lyrics = syllables;
        }
      }

      measure.notes.push(ni);
      emitTimes.push({ startTick, durTicks: advDurTicks });
      /* 뒤따르는 <chord> 구성음이 이 음표에 쌓이도록 그룹을 연다. */
      chordGroup = {
        ni,
        tones: [{
          key: ni.keys[0],
          acc: acc.print,
          midi: (parseInt(octave, 10) + 1) * 12
            + (STEP_SEMIS[step.toUpperCase()] ?? 0) + ACC_SEMIS[acc.sounding],
          ...(isPureTieContinuation ? { tieStop: true as const } : {}),
        }],
      };
      curTick += advance;
    }

    // ── Rest-pad the melody line so the bar sums to a full measure ────────
    // The chosen voice is often silent for part of a grand-staff bar (the other
    // staff carries the time via <backup>). Rebuild measure.notes from the
    // time-positioned emissions, inserting rests for every gap (leading /
    // interior / trailing). Well-formed single-voice bars have no gaps → the
    // output is identical to the emitted sequence.
    // Pickup (anacrusis) bars are intentionally short — never pad them.
    const measureTicks = state.beatsPerMeasure * state.divisions;
    if (measure.notes.length > 0 && measureTicks > 0 && !measure.anacrusis) {
      const rebuilt: NoteInfo[] = [];
      let filled = 0;
      for (let k = 0; k < measure.notes.length; k++) {
        const st = emitTimes[k]?.startTick ?? filled;
        const dt = emitTimes[k]?.durTicks ?? 0;
        if (st > filled) {
          for (const r of ticksToRests(st - filled, state.divisions)) rebuilt.push(r);
          filled = st;
        }
        rebuilt.push(measure.notes[k]);
        filled = Math.max(filled, st + dt);
      }
      if (measureTicks > filled) {
        for (const r of ticksToRests(measureTicks - filled, state.divisions)) rebuilt.push(r);
      }
      measure.notes = rebuilt;
    }

    // Empty measure → whole rest (preserves bar count).
    if (measure.notes.length === 0) {
      measure.notes.push({ keys: ['b/4'], duration: 'wr' });
    }
    // Chord changes — join multiple with double space so renderer auto-splits.
    if (measureChords.length > 0) measure.chord = measureChords.join('  ');

    measures.push(measure);
  }

  const transposeSemis = readTransposeSemis(partEl ?? doc);
  return {
    title,
    composer,
    key: initialKey,
    timeSignature: timeSig,
    tempo,
    measures,
    ...(transposeSemis !== undefined ? { transposeSemis } : {}),
  };
}

/* ─── <harmony> → chord symbol ────────────────────────────────────────
 * 단일 라인(parseXmlDoc)과 양손(parseGrandStaff) 파서가 **같은 규칙**으로 코드
 * 심볼을 만들도록 공용화한 헬퍼. 예전엔 parseXmlDoc 안에만 있어서 그랜드스태프
 * (OMR 피아노 악보) 결과에는 코드 심볼이 아예 붙지 않았다. */
export function harmonySymbol(harmonyEl: Element): string {
  const root  = text(harmonyEl, 'root-step') ?? '';
  const alter = text(harmonyEl, 'root-alter');
  const kindEl = harmonyEl.querySelector('kind');
  const kind  = (kindEl?.textContent ?? '').trim();
  const acc   = alter === '1' ? '#' : alter === '-1' ? 'b' : '';
  // text="…" 처리에는 두 가지 관례가 있다:
  //  · use-symbols="no"(기본): text 가 품질 전체의 표기 힌트 (예: text="m7b5").
  //    그대로 쓴다.
  //  · use-symbols="yes"(MuseScore 재즈 스타일): 품질 기호(-, △, °, ø, +)는
  //    **렌더러가 kind 로 그리라**는 뜻이고 text 에는 나머지 텍스트 조각만 남는다
  //    (minor-seventh 인데 text="7", major-minor 인데 text="t7" 등). 이때 text 를
  //    그대로 쓰면 B-7→"B7", C-△7→"Ct7" 처럼 품질이 통째로 사라진다 — kind 를
  //    기호로 변환한 kindToSymbol 결과를 쓴다.
  //  · text="" (빈 문자열): 기호로 그리는 품질을 text 로는 비워 둔 것이므로
  //    그대로 쓰면 품질이 사라진다("Eb"). kind 변환으로 넘긴다.
  const kindText = kindEl?.getAttribute('text');
  const useSymbols = kindEl?.getAttribute('use-symbols') === 'yes';
  const baseSuffix = (!useSymbols && kindText)
    ? kindText
    : kindToSymbol(kind, useSymbols);

  // <degree>: added/altered/subtracted tones (e.g. add9, b5, #11).
  // Append to chord symbol so e.g. C7 + degree(#11) → "C7#11".
  let degreeSuffix = '';
  for (const dEl of Array.from(harmonyEl.querySelectorAll('degree'))) {
    const dVal = text(dEl, 'degree-value') ?? '';
    const dAlt = text(dEl, 'degree-alter') ?? '0';
    const dType = (text(dEl, 'degree-type') ?? 'add').toLowerCase();
    const altSign = dAlt === '1' ? '#' : dAlt === '-1' ? 'b' : '';
    if (dType === 'subtract' || dType === 'remove') {
      degreeSuffix += `(no${dVal})`;
    } else {
      // 'add' / 'alter' → just append "altSign + value" (e.g. "#11", "b5").
      degreeSuffix += `${altSign}${dVal}`;
    }
  }

  // <bass>: slash chord — e.g. C/G.
  const bassStep = text(harmonyEl, 'bass-step');
  const bassAlter = text(harmonyEl, 'bass-alter');
  let bassPart = '';
  if (bassStep) {
    const bAcc = bassAlter === '1' ? '#' : bassAlter === '-1' ? 'b' : '';
    bassPart = `/${bassStep}${bAcc}`;
  }

  return root + acc + baseSuffix + degreeSuffix + bassPart;
}

/* ─── MusicXML chord kind → symbol ───────────────────────────────────── */

function kindToSymbol(kind: string, useSymbols = false): string {
  // Used only when <kind> has no text="…" attribute. Use U+25B3 △ (white
  // up-pointing triangle) for the maj-7 symbol — NoteSheet's formatChord /
  // LickCard's appendChordSVG both expect this exact codepoint. The visually
  // similar U+0394 Δ (Greek capital delta) renders as a Greek letter in the
  // chord font, not the music glyph.

  /* ⚠️ `major` + use-symbols="yes" 는 **장7화음(△7)** 이다.
   *
   * `use-symbols="yes"` 는 "품질을 **기호로** 그려라"는 뜻인데, 순수 장3화음은
   * 그릴 기호가 아예 없다(루트 글자만 쓴다). 즉 이 조합은 그릴 기호가 있을 때만
   * 의미가 있고, 장화음 계열에서 그 기호는 △ 하나뿐이다.
   *
   * 실측 근거 (`it-could-happen-to-you-red-garlands-solo.mxl`):
   *   · `major`+use-symbols 14개가 전부 text 속성 없음
   *   · 같은 파일의 `dominant` 는 use-symbols 없이 text="7" — 즉 이 파일은
   *     기호로 그리는 품질(-, ø, △)에만 use-symbols 를 붙인다
   *   · jazz1460 의 실제 진행과 대조: 1마디 Eb△7 · 6마디 Ab△7 이 바로 이 조합
   * 이 예외가 없으면 `Eb△7` 이 루트만 남아 **"Eb"** 로 들어온다. */
  if (kind === 'major' && useSymbols) return '△7';

  const MAP: Record<string, string> = {
    major: '',                  // plain major triad → just the root letter
    minor: '-',
    dominant: '7',
    'major-seventh': '△7',
    'minor-seventh': '-7',
    'dominant-seventh': '7',
    'half-diminished': 'ø7',
    diminished: '°',             // plain diminished triad → root + °
    'diminished-seventh': '°7',
    augmented: '+',
    'augmented-seventh': '+7',
    suspended: 'sus',
    'suspended-fourth': 'sus4',
    'major-sixth': '6',
    'minor-sixth': '-6',
    'major-minor': '-△7',
    'major-ninth': '△9',
    'dominant-ninth': '9',
    'minor-ninth': '-9',
    'dominant-11th': '11',
    'dominant-13th': '13',
    'major-11th': '△11',
    'major-13th': '△13',
    'minor-11th': '-11',
    'minor-13th': '-13',
    'suspended-second': 'sus2',
    'minor-major': '-△7',
    power: '5',
  };
  return MAP[kind] ?? kind;
}

/* ─── <note> 표현 정보 추출 (단선율·양손 공용) ──────────────────────────
 * 잇단음표·아티큘레이션·꾸밈기호·페르마타·이음줄·글리산도를 NoteInfo 필드로
 * 옮긴다. 예전엔 단선율 파서에만 있어서 **피아노 양손(그랜드스태프) 악보를
 * 수입하면 이 정보가 통째로 사라졌다**(실측: Red Garland 잇단음표 24개·
 * 페르마타 2개 → 0개). 두 파서가 같은 함수를 쓰게 해 다시 갈리지 않게 한다. */
export function applyNoteExpressions(nEl: Element, ni: NoteInfo): void {
  // 잇단음표 — 비율(actual:normal)을 그대로 보존한다(7:6, 5:3 같은 변칙 포함).
  const tmEl = nEl.querySelector('time-modification');
  if (tmEl) {
    const actual = parseInt(text(tmEl, 'actual-notes') ?? '0', 10);
    const normal = parseInt(text(tmEl, 'normal-notes') ?? '0', 10);
    if (actual > normal && actual > 1) { ni.tuplet = actual; ni.tupletNormal = normal; }
  }
  const notations = nEl.querySelector('notations');
  if (!notations) return;

  const tupletStartEl = notations.querySelector('tuplet[type="start"]');
  if (tupletStartEl) {
    const br = tupletStartEl.getAttribute('bracket');
    if (br === 'no') ni.tupletBracket = false;
    else if (br === 'yes') ni.tupletBracket = true;
  }
  for (const sl of notations.querySelectorAll('slur')) {
    const t = sl.getAttribute('type');
    if (t === 'start') ni.slurStart = true;
    if (t === 'stop') ni.slurStop = true;
  }
  const artEl = notations.querySelector('articulations');
  if (artEl) {
    const arts: Articulation[] = [];
    for (const a of Array.from(artEl.children)) {
      const mapped = ARTICULATION_TAGS[a.tagName];
      if (mapped) arts.push(mapped);
    }
    if (arts.length) ni.articulations = arts;
    /* 재즈 슬라이드 — MusicXML 표준 <scoop/> · <falloff/> 는 articulations 안에
     * 들어온다. 우리 모델에 scoop/fall 필드가 이미 있는데 여기서 안 읽어서,
     * 에디터로 그린 건 되는데 수입한 악보에서는 사라지고 있었다. */
    if (artEl.querySelector('scoop')) ni.scoop = true;
    if (artEl.querySelector('falloff')) ni.fall = true;
  }
  if (notations.querySelector('fermata')) ni.fermata = true;
  const ornEl = notations.querySelector('ornaments');
  if (ornEl) {
    const orns: Ornament[] = [];
    for (const o of Array.from(ornEl.children)) {
      const mapped = ORNAMENT_TAGS[o.tagName];
      if (mapped) orns.push(mapped);
    }
    if (orns.length) ni.ornaments = orns;
  }
  const glissEl = notations.querySelector('glissando, slide');
  if (glissEl && glissEl.getAttribute('type') === 'start') ni.gliss = true;
}

/* ─── Grand-staff (piano) parser ─────────────────────────────────────────
 * A focused two-stave parser that preserves polyphony the single-line
 * parseXmlDoc intentionally drops: it keeps BOTH staves and ALL chord tones.
 *
 *   staff 1 (voice 1, treble/RH) → NoteSheetData.measures
 *   staff 2 (voice 5, bass/LH)   → NoteSheetData.bassMeasures  (1:1 by index)
 *   a <chord> group → one NoteInfo with keys[] (sorted low→high) + per-index
 *                     accidentals
 *
 * Time is tracked in <divisions> ticks (honouring <backup>/<forward>) so each
 * stave's line is rebuilt with rests for gaps — the same technique as the
 * single-line path. Kept separate so the lead-sheet/pianoPerformance paths are
 * untouched. Covers what OMR piano output needs: pitch, chord, duration/dot,
 * tie, beam, accidental, rest. (slur/ornament/dynamics/tuplet are out of scope
 * here — add if a source needs them.) */

interface ChordTone {
  key: string;
  acc?: AccGlyph;
  midi: number;
  /** 이 구성음이 앞 음에서 타이로 이어받았는지(<tie type="stop">). 화음의 일부만
   *  묶이는 경우를 `NoteInfo.tieKeys` 로 남기기 위해 필요하다. */
  tieStop?: boolean;
  /** TAB 보표의 현 번호(<technical><string>). MusicXML 도 1 = 가장 높은(가는) 현
   *  이라 `NoteInfo.tabStrings` 와 규약이 같다 — 그대로 옮긴다. */
  str?: number;
}
interface StaffEvent { startTick: number; durTicks: number; ni: NoteInfo; tones: ChordTone[] }

/** Read one <note>'s pitch → a ChordTone (key string + accidental + midi for
 *  sorting). Mirrors the single-line accidental rules. */
function readChordTone(
  nEl: Element, pitchEl: Element, keySigLetters: Set<string>, fifths: number,
  /** 옥타브 브래킷 보정 — MusicXML `<pitch>` 는 **울리는 음**이라, 8va 구간에서는
   *  **적히는 음**으로 되돌려야 한다(우리 모델은 keys=적히는 음 + ottava 가 재생을 옮김). */
  octDelta = 0,
): ChordTone {
  const step = (text(pitchEl, 'step') ?? 'C').toLowerCase();
  const octave = text(pitchEl, 'octave') ?? '4';
  const acc = readAccidental(nEl, pitchEl, step, keySigLetters, fifths);
  const midi = (parseInt(octave, 10) + 1) * 12
    + (STEP_SEMIS[step.toUpperCase()] ?? 0) + ACC_SEMIS[acc.sounding];
  const written = String(parseInt(octave, 10) + octDelta);
  const tone: ChordTone = { key: `${step}/${written}`, acc: acc.print, midi };
  if (noteTieStop(nEl)) tone.tieStop = true;
  const strTxt = nEl.querySelector('notations > technical > string')?.textContent;
  const strNum = strTxt ? parseInt(strTxt, 10) : NaN;
  if (Number.isFinite(strNum) && strNum > 0) tone.str = strNum;
  return tone;
}

/** Sort a note's accumulated chord tones low→high and bake keys[] + accidentals. */
/** 화음 구성음을 낮은음→높은음으로 정렬해 keys[] + 인덱스별 임시표로 굽는다.
 *  단선율·양손 파서가 **같은 헬퍼**를 쓴다(표기가 갈리지 않도록). */
function applyChordTones(ni: NoteInfo, tones: ChordTone[]): void {
  if (tones.length === 0) return; // rest
  const sorted = tones.slice().sort((a, b) => a.midi - b.midi);
  ni.keys = sorted.map((t) => t.key);
  const acc: Record<number, AccGlyph> = {};
  let has = false;
  sorted.forEach((t, i) => { if (t.acc) { acc[i] = t.acc; has = true; } });
  if (has) ni.accidentals = acc; else delete ni.accidentals;

  /* 조판자가 적어 둔 현 번호는 그대로 존중한다 — 자동 운지가 원본과 다른 자리를
   * 고르면 같은 음이라도 TAB 그림이 달라진다. */
  const strs: Record<number, number> = {};
  let hasStr = false;
  sorted.forEach((t, i) => { if (t.str) { strs[i] = t.str; hasStr = true; } });
  if (hasStr) ni.tabStrings = strs; else delete ni.tabStrings;

  /* 화음의 일부만 타이로 넘어왔으면 그 인덱스를 남긴다 — 전부/전무면 note 단위
   * 플래그만으로 충분하므로 필드를 만들지 않는다(구버전 데이터와 동일 형태). */
  const tiedIdx = sorted.map((t, i) => (t.tieStop ? i : -1)).filter((i) => i >= 0);
  if (tiedIdx.length > 0 && tiedIdx.length < sorted.length) ni.tieKeys = tiedIdx;
  else delete ni.tieKeys;
}

function finalizeChord(ev: StaffEvent): void {
  applyChordTones(ev.ni, ev.tones);
}

/** Rebuild one stave's measure notes from time-positioned events, padding gaps
 *  with rests so the bar sums to a full measure. */
function reconstructStave(events: StaffEvent[], measureTicks: number, divisions: number): NoteInfo[] {
  const out: NoteInfo[] = [];
  let filled = 0;
  for (const e of events) {
    if (e.startTick > filled) {
      for (const r of ticksToRests(e.startTick - filled, divisions)) out.push(r);
      filled = e.startTick;
    }
    finalizeChord(e);
    out.push(e.ni);
    filled = Math.max(filled, e.startTick + e.durTicks);
  }
  if (measureTicks > filled) {
    for (const r of ticksToRests(measureTicks - filled, divisions)) out.push(r);
  }
  if (out.length === 0) out.push({ keys: ['b/4'], duration: 'wr' });
  return out;
}

/**
 * 한 보표의 성부 통들을 마디 하나로 조립한다.
 *
 * 주 성부(가장 많은 시간을 채운 voice, 동률이면 번호가 작은 쪽)가 `notes`,
 * 그다음이 `voice2` 다. 모델이 보표당 두 성부까지만 담으므로 3번째 이후 성부는
 * 버린다 — 실측 코퍼스에서 3번째 성부는 마디당 한두 음의 장식 성부뿐이고,
 * 억지로 합치면 시간이 겹쳐 마디 길이가 다시 망가진다.
 */
function buildVoicedMeasure(
  ev: Map<string, StaffEvent[]>, staff: 1 | 2, measureTicks: number, divisions: number,
): MeasureInfo {
  const lanes = [...ev.entries()]
    .filter(([k]) => k.startsWith(`${staff}|`))
    .map(([k, events]) => ({
      voice: k.slice(k.indexOf('|') + 1),
      events,
      ticks: events.reduce((s, e) => s + e.durTicks, 0),
      /* 실제 음이 있는 성부를 우선한다 — 조판자가 다른 성부의 시간을 채우려고
       * 넣은 "쉼표만 있는 성부"가 주 성부로 뽑히면 보표가 통째로 빈다. */
      sounds: events.some((e) => e.tones.length > 0),
    }))
    .sort((a, b) => Number(b.sounds) - Number(a.sounds)
      || (b.ticks - a.ticks)
      || a.voice.localeCompare(b.voice, undefined, { numeric: true }));

  const out: MeasureInfo = {
    notes: reconstructStave(lanes[0]?.events ?? [], measureTicks, divisions),
  };
  /* 두 번째 성부가 실제 음을 가질 때만 붙인다 — 쉼표뿐인 통을 voice2 로 넣으면
   * 빈 성부의 쉼표가 보표에 겹쳐 그려진다. */
  if (lanes[1]?.events.some((e) => e.tones.length > 0)) {
    out.voice2 = reconstructStave(lanes[1].events, measureTicks, divisions);
  }
  return out;
}

function parseGrandStaff(doc: Document, fallbackTitle: string, partEl?: Element): NoteSheetData {
  const xmlTitle = text(doc.documentElement, 'work-title') ?? text(doc.documentElement, 'movement-title');
  const title = (xmlTitle && xmlTitle !== 'Music21 Fragment') ? xmlTitle : fallbackTitle;
  const composer = text(doc.documentElement, 'creator[type="composer"]') ?? 'Unknown';

  const firstMeasure = (partEl ?? doc).querySelector('measure');
  const attrScope: Element = firstMeasure ?? partEl ?? doc.documentElement;
  const initialFifths = parseInt(text(attrScope, 'fifths') ?? '0', 10);
  const beats = text(attrScope, 'time > beats') ?? '4';
  const beatType = text(attrScope, 'time > beat-type') ?? '4';
  const timeSig = `${beats}/${beatType}`;
  const initialKey = KEY_NAMES[initialFifths + 7] ?? 'C';

  const state = {
    divisions: parseInt(text(attrScope, 'divisions') ?? '1', 10) || 1,
    beatsPerMeasure: parseInt(beats, 10) || 4,
    fifths: initialFifths,
    keySigLetters: keySigLettersFor(initialFifths),
  };

  const soundEl = doc.querySelector('sound[tempo]');
  const tempo = soundEl ? Math.round(parseFloat(soundEl.getAttribute('tempo')!)) : undefined;
  const docHasBeams = doc.querySelector('beam') !== null;

  const partMeasures = partEl
    ? partEl.querySelectorAll(':scope > measure')
    : doc.querySelectorAll('part > measure');

  const measures: MeasureInfo[] = [];
  const bassMeasures: MeasureInfo[] = [];
  /* 볼타(1·2번 괄호)는 <ending type="stop"> 까지 여러 마디에 걸친다. */
  let currentVolta: number | undefined;
  /* 옥타브 브래킷(8va·8vb·15ma·15mb) — 보표별로 따로, **마디를 넘어** 이어진다.
   * 예전엔 양손 경로에 이 처리가 통째로 없어서, <staff> 가 붙은 octave-shift 가
   * 전부 무시됐다(실측: 2개 파일 12개 전멸). 단선율 경로와 같은 규칙을 쓴다 —
   * type="down" = 적힌 음이 한 옥타브 아래 = 화면엔 8va. */
  const ottavaState: Record<1 | 2, { label: NonNullable<NoteInfo['ottavaStart']> ; octDelta: number } | undefined> = { 1: undefined, 2: undefined };
  const ottavaPending: Record<1 | 2, boolean> = { 1: false, 2: false };
  /** 브래킷 종료 표시를 붙일 대상 — 보표별 마지막 실음. */
  const lastPitched: Record<1 | 2, NoteInfo | undefined> = { 1: undefined, 2: undefined };

  for (let mi = 0; mi < partMeasures.length; mi++) {
    const mEl = partMeasures[mi];
    /* 보표 × 성부별 이벤트 통. 예전엔 staff 로만 나눠서, 같은 보표의 voice 2 가
     * voice 1 뒤에 그대로 이어붙었다 — <backup> 으로 시간이 되감겼는데도 순서대로
     * 쌓이니 4박 마디가 8박이 되고, 에디터의 마디 자동분할이 그걸 쪼개 **없던
     * 마디가 늘어났다**(사용자 신고 그대로). 이제 성부별로 따로 재구성해 두 번째
     * 성부는 `voice2` 로 보낸다. */
    const ev = new Map<string, StaffEvent[]>();
    const evFor = (staff: 1 | 2, voice: string): StaffEvent[] => {
      const k = `${staff}|${voice}`;
      let list = ev.get(k);
      if (!list) { list = []; ev.set(k, list); }
      return list;
    };
    /* 코드 심볼은 오른손(트레블) 마디에만 붙인다 — 그랜드스태프에서 <harmony> 는
     * staff 지정 없이 마디 단위로 오고, 렌더러도 트레블 위에만 코드를 그린다. */
    const measureChords: string[] = [];
    /* 마디 단위 표기(세로줄·도돌이·볼타·리허설·내비게이션·줄바꿈)는 단선율 파서와
     * **같은 헬퍼**를 쓴다 — 예전엔 양손 악보에만 통째로 빠져 있었다. */
    const meta: MeasureInfo = { notes: [] };
    if (currentVolta !== undefined) meta.volta = currentVolta;
    let curTick = 0;
    /* 다음 음표에 붙일 셈여림/헤어핀 — <direction> 이 음표보다 먼저 온다. */
    let pendingDynamic: Dynamic | undefined;
    let pendingHairpinStart: 'cresc' | 'dim' | undefined;
    let pendingHairpinStop = false;

    for (const child of Array.from(mEl.children)) {
      const tag = child.tagName;
      if (tag === 'harmony') {
        const sym = harmonySymbol(child);
        if (sym && measureChords[measureChords.length - 1] !== sym) measureChords.push(sym);
        continue;
      }
      if (tag === 'attributes') {
        const f = text(child, 'fifths');
        if (f !== null) { const fi = parseInt(f, 10); if (!Number.isNaN(fi)) { state.fifths = fi; state.keySigLetters = keySigLettersFor(fi); } }
        const bt = text(child, 'time > beats'); if (bt) state.beatsPerMeasure = parseInt(bt, 10) || state.beatsPerMeasure;
        const dv = text(child, 'divisions'); if (dv) { const d = parseInt(dv, 10); if (d > 0) state.divisions = d; }
        continue;
      }
      if (tag === 'backup') { curTick -= parseInt(text(child, 'duration') ?? '0', 10) || 0; continue; }
      if (tag === 'forward') { curTick += parseInt(text(child, 'duration') ?? '0', 10) || 0; continue; }
      if (tag === 'print') {
        const brk = child.getAttribute('new-system') === 'yes'
          || child.getAttribute('new-page') === 'yes';
        if (brk && mi > 0) measures[mi - 1].lineBreak = true;
        continue;
      }
      if (tag === 'barline') { currentVolta = applyBarline(child, meta, currentVolta); continue; }
      /* <direction> 의 셈여림(p·mf·ff…)과 크레셴도/디미누엔도(wedge)는 음표가
       * 아니라 방향 지시로 오므로, 다음에 오는 음표에 붙여 준다(단선율 파서와
       * 같은 규칙). 이게 없어서 양손 악보는 셈여림이 통째로 사라졌다. */
      if (tag === 'direction') {
        const dirType = child.querySelector('direction-type');
        if (dirType) {
          applyRehearsalNav(dirType, meta);
          const dyn = dirType.querySelector('dynamics');
          if (dyn) {
            for (const dn of Array.from(dyn.children)) {
              const name = dn.tagName.toLowerCase();
              if (DYNAMIC_TAGS.has(name as Dynamic)) { pendingDynamic = name as Dynamic; break; }
            }
          }
          const wedgeEl = dirType.querySelector('wedge');
          if (wedgeEl) {
            const wt = wedgeEl.getAttribute('type');
            if (wt === 'crescendo') pendingHairpinStart = 'cresc';
            else if (wt === 'diminuendo') pendingHairpinStart = 'dim';
            else if (wt === 'stop') pendingHairpinStop = true;
          }
          /* 옥타브 브래킷 — <direction> 의 <staff> 가 어느 보표인지 정한다
           * (없으면 오른손). 단선율 경로와 방향·피치 규칙이 동일하다. */
          const oct = dirType.querySelector('octave-shift');
          if (oct) {
            const st: 1 | 2 = (text(child, 'staff') ?? '1') === '2' ? 2 : 1;
            const ot = oct.getAttribute('type');
            const two = (oct.getAttribute('size') ?? '8') === '15';
            if (ot === 'down' || ot === 'up') {
              ottavaState[st] = {
                label: ot === 'down' ? (two ? '15ma' : '8va') : (two ? '15mb' : '8vb'),
                octDelta: (ot === 'down' ? -1 : 1) * (two ? 2 : 1),
              };
              ottavaPending[st] = true;
            } else if (ot === 'stop') {
              if (lastPitched[st]) lastPitched[st]!.ottavaEnd = true;
              ottavaState[st] = undefined;
              ottavaPending[st] = false;
            }
          }
        }
        continue;
      }
      if (tag !== 'note') continue;

      const nEl = child;
      const staff: 1 | 2 = (text(nEl, 'staff') ?? '1') === '2' ? 2 : 1;
      const voice = text(nEl, 'voice') ?? '1';
      const isChordTone = !!nEl.querySelector('chord');
      const isGrace = !!nEl.querySelector('grace');
      const durTxt = text(nEl, 'duration');
      const durTicks = durTxt ? (parseInt(durTxt, 10) || 0) : 0;
      const advance = (isChordTone || isGrace) ? 0 : durTicks;
      const startTick = curTick;

      // Chord tone: fold this pitch into the last note of the SAME stave.
      if (isChordTone) {
        const list = evFor(staff, voice);
        const pitchEl = nEl.querySelector('pitch');
        const last = list.length ? list[list.length - 1] : null;
        if (last && last.tones.length > 0 && pitchEl) {
          last.tones.push(readChordTone(
            nEl, pitchEl, state.keySigLetters, state.fifths, ottavaState[staff]?.octDelta ?? 0));
        }
        curTick += advance; // 0
        continue;
      }

      // duration → VexFlow type (derive from ticks if <type> missing)
      let typeStr = text(nEl, 'type');
      if (!typeStr && Number.isFinite(durTicks) && state.divisions > 0) {
        const nb = durTicks / state.divisions;
        if (Math.abs(nb - state.beatsPerMeasure) < 0.01) typeStr = 'whole';
        else if (nb >= 6) typeStr = 'whole';
        else if (nb >= 3) typeStr = 'half';
        else if (nb >= 1.5) typeStr = 'quarter';
        else if (nb >= 0.75) typeStr = 'eighth';
        else if (nb >= 0.375) typeStr = '16th';
        else if (nb >= 0.1875) typeStr = '32nd';
        else typeStr = '64th';
      }
      typeStr = typeStr ?? 'quarter';
      const vf = TYPE_TO_VF[typeStr] ?? 'q';
      const isDotted = !!nEl.querySelector('dot');

      const restEl = nEl.querySelector('rest');
      if (restEl) {
        const isMeasureAttr = restEl.getAttribute('measure') === 'yes';
        const isFull = isMeasureAttr
          || (!text(nEl, 'type') && state.divisions > 0
              && Math.abs(durTicks / state.divisions - state.beatsPerMeasure) < 0.01);
        const rn: NoteInfo = { keys: ['b/4'], duration: isFull ? 'wr' : vf + 'r' };
        if (isDotted) rn.dotted = true;
        applyNoteExpressions(nEl, rn);   // 쉼표도 잇단음표·페르마타를 가질 수 있다
        evFor(staff, voice).push({ startTick, durTicks, ni: rn, tones: [] });
        curTick += advance;
        continue;
      }

      const pitchEl = nEl.querySelector('pitch');
      if (!pitchEl) { curTick += advance; continue; }

      const ni: NoteInfo = { keys: [], duration: vf };
      if (isDotted) ni.dotted = true;
      if (isGrace) {
        ni.grace = true;
        if (nEl.querySelector('grace')?.getAttribute('slash') === 'yes') ni.graceSlash = true;
      }
      // Tie
      let tieStart = false, tieStop = false;
      for (const t of nEl.querySelectorAll('tie')) {
        const tt = t.getAttribute('type');
        if (tt === 'start') tieStart = true;
        if (tt === 'stop') tieStop = true;
      }
      if (tieStart) ni.tie = true;
      if (tieStop && !tieStart) ni.tieContinuation = true;
      // Primary beam
      if (BEAMABLE_XML_TYPES.has(typeStr) && !isGrace && docHasBeams) {
        let pb: string | null = null;
        for (const be of nEl.querySelectorAll('beam')) {
          if ((be.getAttribute('number') ?? '1') === '1') { pb = (be.textContent ?? '').trim(); break; }
        }
        if (pb === null) ni.noBeam = true;
        else if (pb === 'end') ni.beamBreak = true;
      }
      // 잇단음표·아티큘레이션·꾸밈기호·페르마타·이음줄·글리산도 (단선율과 같은 규칙).
      applyNoteExpressions(nEl, ni);
      applyNoteheadCue(nEl, ni);
      if (pendingDynamic) { ni.dynamics = pendingDynamic; pendingDynamic = undefined; }
      if (pendingHairpinStart) { ni.hairpinStart = pendingHairpinStart; pendingHairpinStart = undefined; }
      if (pendingHairpinStop) { ni.hairpinStop = true; pendingHairpinStop = false; }
      // 스템 방향은 조판자의 선택 — 양손 악보에서 성부 구분의 핵심이라 보존한다.
      const stemTxt = text(nEl, 'stem');
      if (stemTxt === 'up' || stemTxt === 'down') ni.stem = stemTxt;
      /* 옥타브 브래킷: 구간의 첫 실음에 시작 표시를 붙이고, 구간 내내 적히는 음을
       * 되돌린다(장식음은 브래킷 시작 기준으로 삼지 않는다). */
      const ott = ottavaState[staff];
      if (ott && ottavaPending[staff] && !isGrace) {
        ni.ottavaStart = ott.label;
        ottavaPending[staff] = false;
      }
      if (!isGrace) lastPitched[staff] = ni;
      evFor(staff, voice).push({
        startTick,
        durTicks: isGrace ? 0 : durTicks,
        ni,
        tones: [readChordTone(
          nEl, pitchEl, state.keySigLetters, state.fifths, ott?.octDelta ?? 0)],
      });
      curTick += advance;
    }

    const measureTicks = state.beatsPerMeasure * state.divisions;
    const { notes: _drop, ...metaFields } = meta;
    const trebleMeasure = { ...buildVoicedMeasure(ev, 1, measureTicks, state.divisions), ...metaFields };
    // 마디 안 코드 변화는 공백 2칸으로 이어 붙인다(렌더러가 이걸로 분할한다).
    if (measureChords.length > 0) trebleMeasure.chord = measureChords.join('  ');
    measures.push(trebleMeasure);
    bassMeasures.push(buildVoicedMeasure(ev, 2, measureTicks, state.divisions));
  }

  const transposeSemis = readTransposeSemis(partEl ?? doc);
  const out: NoteSheetData = {
    title, composer, key: initialKey, timeSignature: timeSig, tempo, measures, bassMeasures,
    ...(transposeSemis !== undefined ? { transposeSemis } : {}),
  };

  /* 두 번째 보표가 **TAB** 이면(기타·베이스 파트) 양손 피아노가 아니라 다중
   * 스태프 악보다. `staves` 로 내보내야 뷰어·에디터가 TAB 보표로 그린다 —
   * 예전엔 그냥 낮은음자리표로 그려서 프렛이 음표로 둔갑했다. */
  const staffKinds = readStaffKinds(attrScope);
  if (staffKinds && isTabStaffKind(staffKinds[1])) {
    out.staves = [
      { kind: staffKinds[0], measures },
      { kind: staffKinds[1], measures: bassMeasures },
    ];
  }
  return out;
}

/* ─── Multi-part support ─────────────────────────────────────────────── */

export interface ScorePart {
  /** <part id="..."> identifier. */
  id: string;
  /** Human-readable name from <part-list><score-part><part-name>, else the id. */
  name: string;
  /** This part parsed as a standalone single-line sheet. */
  data: NoteSheetData;
}

/** Read id → display name from <part-list>. */
function readPartNames(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    const id = sp.getAttribute('id');
    if (!id) continue;
    const name = (sp.querySelector('part-name')?.textContent ?? '').trim();
    map.set(id, name || id);
  }
  return map;
}

/** Read id → { instrument timbre, isDrum } from <part-list>. Each <score-part>
 *  carries a <midi-instrument> with <midi-program> (GM, 1-based) and
 *  <midi-channel> (10 = percussion). We resolve the program to a MusyngKite
 *  instrument name so playback uses the part's real timbre. */
function readPartInstruments(doc: Document): Map<string, { instrument: string; isDrum: boolean }> {
  const map = new Map<string, { instrument: string; isDrum: boolean }>();
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    const id = sp.getAttribute('id');
    if (!id) continue;
    const mi = sp.querySelector('midi-instrument');
    const channel = parseInt(mi?.querySelector('midi-channel')?.textContent ?? '0', 10);
    const program = parseInt(mi?.querySelector('midi-program')?.textContent ?? '0', 10);
    const isDrum = channel === 10 || sp.querySelector('midi-unpitched') !== null;
    map.set(id, {
      instrument: isDrum ? DRUM_INSTRUMENT : gmProgramToInstrument(program || undefined),
      isDrum,
    });
  }
  return map;
}

/** Heuristic melody-likeness so the UI can default to the most tune-carrying
 *  part: prefer mid/high average pitch, penalise empty/very-low parts. */
function partMelodyScore(data: NoteSheetData): number {
  let sum = 0, cnt = 0;
  for (const m of data.measures) {
    for (const n of m.notes) {
      if (n.duration.endsWith('r')) continue;
      const oct = parseInt(n.keys[0]?.split('/')[1] ?? '4', 10);
      sum += oct; cnt++;
    }
  }
  if (cnt === 0) return -Infinity;        // silent part — never the default
  const avgOct = sum / cnt;
  return cnt * 0.1 + (avgOct >= 4 && avgOct <= 6 ? 30 : 0) - (avgOct < 3 ? 20 : 0);
}

/* ─── 보표 종류 판정(다중 스태프 파트) ────────────────────────────────── */

const TAB_KINDS = new Set<StaffKind>(['guitar-tab', 'bass-tab', 'bass5-tab', 'ukulele-tab']);
function isTabStaffKind(k: StaffKind | undefined): k is StaffKind {
  return !!k && TAB_KINDS.has(k);
}

/**
 * `<clef number="N">` · `<staff-details number="N">` 로 각 보표의 종류를 읽는다.
 *
 * 기타 파트는 보표 1 이 `G` 클레프 + `clef-octave-change -1`(= 소리가 표기보다
 * 한 옥타브 아래 — 기타 관례)이고, 보표 2 가 `TAB` 클레프 + `staff-lines` 6 이다.
 * 줄 수로 베이스 TAB(4·5줄)도 구분한다.
 */
function readStaffKinds(scope: Element): StaffKind[] | null {
  const clefs = [...scope.querySelectorAll('clef')];
  if (clefs.length < 2) return null;
  const linesFor = (num: string | null): number => {
    for (const sd of scope.querySelectorAll('staff-details')) {
      if ((sd.getAttribute('number') ?? '1') === (num ?? '1')) {
        return parseInt(sd.querySelector('staff-lines')?.textContent ?? '5', 10) || 5;
      }
    }
    return 5;
  };
  return clefs.map((c) => {
    const num = c.getAttribute('number');
    const sign = (text(c, 'sign') ?? 'G').toUpperCase();
    const line = text(c, 'line');
    const octChange = parseInt(text(c, 'clef-octave-change') ?? '0', 10) || 0;
    if (sign === 'TAB') {
      const n = linesFor(num);
      return n <= 4 ? 'bass-tab' : n === 5 ? 'bass5-tab' : 'guitar-tab';
    }
    if (sign === 'F') return 'bass';
    if (sign === 'C') return line === '3' ? 'alto' : 'tenor';
    return octChange === -1 ? 'treble-8vb' : 'treble';
  });
}

/**
 * 단일 보표 파트를 **두 성부까지** 읽는다.
 *
 * 한 보표에 두 성부가 겹쳐 적힌 악보(왼손 컴핑 위 멜로디, 드럼의 손/발 분리)는
 * 흔한데, 예전엔 주 성부만 남기고 나머지를 통째로 버렸다(실측: 드럼 한 파트에서
 * 218개). 두 번째 성부는 같은 파서를 `onlyVoice` 로 한 번 더 돌려 얻는다 —
 * 음표 해석 규칙이 갈리지 않는 가장 안전한 방법이다.
 *
 * 세 번째 이후 성부는 모델(`voice2`)이 담지 못해 남기지 않는다.
 */
function parseSingleStaffWithVoices(
  doc: Document, fallbackTitle: string, partEl: Element, opts?: XmlParseOpts,
): NoteSheetData {
  const data = parseXmlDoc(doc, fallbackTitle, partEl, opts);
  /* 멜로디 추출 모드는 "한 줄"이 목적이라 두 번째 성부를 만들지 않는다. */
  if (opts?.pianoPerformance || opts?.onlyVoice) return data;
  const voices = partVoices(partEl);
  if (voices.length < 2) return data;

  const second = parseXmlDoc(doc, fallbackTitle, partEl, { ...opts, onlyVoice: voices[1] });
  for (let i = 0; i < data.measures.length; i++) {
    const notes = second.measures[i]?.notes;
    // 쉼표뿐인 마디는 붙이지 않는다 — 빈 성부의 쉼표가 겹쳐 그려진다.
    if (notes?.some((n) => !n.duration.endsWith('r'))) data.measures[i].voice2 = notes;
  }
  return data;
}

/** Parse EVERY <part> into its own sheet. Falls back to a single whole-doc
 *  parse when the document has no discrete <part> elements. */
function parseAllParts(doc: Document, fallbackTitle: string, opts?: XmlParseOpts): ScorePart[] {
  const names = readPartNames(doc);
  const instruments = readPartInstruments(doc);
  const partEls = Array.from(doc.querySelectorAll('part')).filter(
    (p) => p.querySelector(':scope > measure') !== null,
  );
  if (partEls.length === 0) {
    return [{ id: 'P1', name: 'Part 1', data: parseXmlDoc(doc, fallbackTitle, undefined, opts) }];
  }
  return partEls.map((pEl, i) => {
    const id = pEl.getAttribute('id') ?? `P${i + 1}`;
    const inst = instruments.get(id);
    // Grand-staff (2-stave piano) → keep both hands + chords. Auto-detected from
    // <staves>2</staves>; the pianoPerformance melody-extraction mode opts out.
    const staves = parseInt(pEl.querySelector('staves')?.textContent ?? '1', 10) || 1;
    const useGrand = opts?.grandStaff || (staves >= 2 && !opts?.pianoPerformance);
    const data = useGrand
      ? parseGrandStaff(doc, fallbackTitle, pEl)
      : parseSingleStaffWithVoices(doc, fallbackTitle, pEl, opts);
    // Attach per-part timbre so playback uses the real instrument sound.
    if (inst) { data.instrument = inst.instrument; data.isDrum = inst.isDrum; }
    return { id, name: names.get(id) ?? `Part ${i + 1}`, data };
  });
}

/** Order parts so the most melody-like one is first (the UI's default view). */
export function sortPartsByMelody(parts: ScorePart[]): ScorePart[] {
  return [...parts].sort((a, b) => partMelodyScore(b.data) - partMelodyScore(a.data));
}

function extractXmlFromMxl(buf: Uint8Array): string {
  const files = unzipSync(buf);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('.xml') && !name.startsWith('META-INF') && name !== 'container.xml') {
      return new TextDecoder().decode(data);
    }
  }
  throw new Error('No MusicXML found in MXL archive');
}

/* ─── Public loaders ─────────────────────────────────────────────────── */

/** MusicXML **문자열**을 파싱한다 (URL fetch 없이). OMR 결과처럼 응답 본문으로
 *  받은 원문(`omrResult.pages[].musicXml`)을 그대로 넘기는 용도.
 *  `<staves>2</staves>` 면 parseAllParts 가 자동으로 그랜드스태프(양손)로 파싱한다. */
export function parseXmlString(xmlText: string, fallbackTitle: string, opts?: XmlParseOpts): ScorePart[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML 파싱에 실패했습니다.');
  return parseAllParts(doc, fallbackTitle, opts);
}

export async function loadXmlParts(url: string, fallbackTitle: string, opts?: XmlParseOpts): Promise<ScorePart[]> {
  const res = await fetch(url);
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
  return parseAllParts(doc, fallbackTitle, opts);
}

/** .mxl(압축 MusicXML) **버퍼**를 파싱한다 — 파일 업로드 경로용(fetch 없음). */
export function parseMxlArrayBuffer(buf: ArrayBuffer, fallbackTitle: string, opts?: XmlParseOpts): ScorePart[] {
  const xmlText = extractXmlFromMxl(new Uint8Array(buf));
  return parseXmlString(xmlText, fallbackTitle, opts);
}

export async function loadMxlParts(url: string, fallbackTitle: string, opts?: XmlParseOpts): Promise<ScorePart[]> {
  const res = await fetch(url);
  const xmlText = extractXmlFromMxl(new Uint8Array(await res.arrayBuffer()));
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return parseAllParts(doc, fallbackTitle, opts);
}

/* Single-line loaders kept for backward compatibility — return the primary
 * (most melody-like) part so existing single-part call sites are unaffected. */
export async function loadXmlMelody(url: string, fallbackTitle: string): Promise<NoteSheetData> {
  return sortPartsByMelody(await loadXmlParts(url, fallbackTitle))[0].data;
}

export async function loadMxlMelody(url: string, fallbackTitle: string): Promise<NoteSheetData> {
  return sortPartsByMelody(await loadMxlParts(url, fallbackTitle))[0].data;
}
