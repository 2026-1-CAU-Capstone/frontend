import { unzipSync } from 'fflate';
import type {
  NoteSheetData, NoteInfo, MeasureInfo,
  Articulation, Ornament, Dynamic, NavigationMarker,
} from '../../data/sampleMelody';
import { gmProgramToInstrument, DRUM_INSTRUMENT } from './gmInstruments';

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
  ottava?: '8va' | '8vb';
  /** Note index (within current measure) where ottava started, for end marker. */
  ottavaStartIdx?: number;
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

  /* ── parse measures in order, tracking running state ─────────────── */
  const measures: MeasureInfo[] = [];
  const state: ParserState = {
    fifths: initialFifths,
    keySigLetters: keySigLettersFor(initialFifths),
    divisions: initialDivisions,
    beatsPerMeasure: initialBeatsPerMeasure,
  };

  // Slur tracking across the whole piece: map slur number → flat note index
  // of the slur-start note. When a slur stop arrives, mark BOTH start and
  // stop notes (slurStart/slurStop) so the renderer can pair them later.
  // VexFlow renders slurs as Curve(s) between the start and stop notes.
  let flatNoteIdx = 0;

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
    let melodyVoice = '1';
    if (opts?.pianoPerformance) {
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

      /* ── <barline>: repeat + volta endings ───────────────────────── */
      if (tag === 'barline') {
        const location = child.getAttribute('location');
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
            currentVolta = startNum;
            measure.volta = startNum;
          } else if (hasStop && location !== 'left') {
            // ending stops at the right barline of THIS measure → clear after
            // this iteration so next measure has no volta.
            currentVolta = undefined;
          }
        }
        continue;
      }

      /* ── <direction>: segno/coda/words/octave-shift/dynamics ─────── */
      if (tag === 'direction') {
        const dirType = child.querySelector('direction-type');
        if (!dirType) continue;
        // Navigation priority: destination markers (segno/coda) are anchors
        // referenced by text triggers (D.S./D.C./To Coda). When both appear
        // on the same measure, destination wins (we can only render one per
        // stave). Symbols also outrank text from a prior <direction> sibling.
        const segnoEl = dirType.querySelector('segno');
        const codaEl  = dirType.querySelector('coda');
        if (segnoEl) {
          measure.navigation = 'segno' as NavigationMarker;
        } else if (codaEl) {
          measure.navigation = 'coda' as NavigationMarker;
        } else {
          // Only consider text words if NO symbol marker was set on this measure.
          if (measure.navigation !== 'segno' && measure.navigation !== 'coda') {
            const wordsList = dirType.querySelectorAll('words');
            for (const w of wordsList) {
              const nav = parseNavigationWords(w.textContent ?? '');
              if (nav) {
                measure.navigation = nav;
                break;
              }
            }
          }
        }
        // Octave-shift (8va/8vb)
        const oct = dirType.querySelector('octave-shift');
        if (oct) {
          const ot = oct.getAttribute('type');
          const size = oct.getAttribute('size'); // '8' (one oct) typically
          if (ot === 'up' && (size === null || size === '8')) {
            state.ottava = '8va';
            state.ottavaStartIdx = flatNoteIdx; // mark for next note
          } else if (ot === 'down' && (size === null || size === '8')) {
            state.ottava = '8vb';
            state.ottavaStartIdx = flatNoteIdx;
          } else if (ot === 'stop') {
            // Mark the LAST emitted note as ottavaEnd.
            const lastIdx = measure.notes.length - 1;
            if (lastIdx >= 0) measure.notes[lastIdx].ottavaEnd = true;
            state.ottava = undefined;
            state.ottavaStartIdx = undefined;
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
        const root  = text(child, 'root-step') ?? '';
        const alter = text(child, 'root-alter');
        const kindEl = child.querySelector('kind');
        const kind  = (kindEl?.textContent ?? '').trim();
        const acc   = alter === '1' ? '#' : alter === '-1' ? 'b' : '';
        // Prefer the engraver-supplied text="…" hint when present (e.g. text="7"
        // for dominant, text="m7b5" for half-diminished). Otherwise fall back to
        // a kind-keyed default — using '' for plain major triads (Omnibook
        // convention: just the root letter) and '°' for plain diminished.
        const kindText = kindEl?.getAttribute('text');
        const baseSuffix = (kindText !== null && kindText !== undefined)
          ? kindText
          : kindToSymbol(kind);

        // <degree>: added/altered/subtracted tones (e.g. add9, b5, #11).
        // Append to chord symbol so e.g. C7 + degree(#11) → "C7#11".
        let degreeSuffix = '';
        for (const dEl of Array.from(child.querySelectorAll('degree'))) {
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
        const bassStep = text(child, 'bass-step');
        const bassAlter = text(child, 'bass-alter');
        let bassPart = '';
        if (bassStep) {
          const bAcc = bassAlter === '1' ? '#' : bassAlter === '-1' ? 'b' : '';
          bassPart = `/${bassStep}${bAcc}`;
        }

        const sym = root + acc + baseSuffix + degreeSuffix + bassPart;
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

      // Chord tones: keep only the HIGHEST-sounding note of the group on the
      // melody line. The first <note> of a MusicXML chord isn't always the top
      // (homr/OMR and music21 quantisations often list an inner/lower voice
      // first), so replace the group's representative note when a sub-tone is
      // higher. Single-line lead sheets have no <chord> groups → never runs.
      if (isChordTone) {
        const chordVoice = text(nEl, 'voice');
        // Only merge into the melody line if this chord tone belongs to the
        // melody voice — otherwise a left-hand chord would corrupt the last
        // melody note.
        if (chordVoice && chordVoice !== melodyVoice) { curTick += advance; continue; }
        const last = measure.notes[measure.notes.length - 1];
        const subPitch = nEl.querySelector('pitch');
        if (last && !last.duration.endsWith('r') && subPitch) {
          const sStep = (text(subPitch, 'step') ?? 'C').toUpperCase();
          const sOct = parseInt(text(subPitch, 'octave') ?? '4', 10);
          const sAlt = parseInt(text(subPitch, 'alter') ?? '0', 10) || 0;
          const subMidi = (sOct + 1) * 12 + (STEP_SEMIS[sStep] ?? 0) + sAlt;
          const [lStep, lOct] = last.keys[0].split('/');
          const lAcc = last.accidentals?.[0];
          const lAlt = lAcc === '#' ? 1 : lAcc === 'b' ? -1 : lAcc === '##' ? 2 : lAcc === 'bb' ? -2 : 0;
          const lastMidi = (parseInt(lOct, 10) + 1) * 12 + (STEP_SEMIS[lStep.toUpperCase()] ?? 0) + lAlt;
          if (subMidi > lastMidi) {
            last.keys[0] = `${sStep.toLowerCase()}/${sOct}`;
            if (sAlt === 1) last.accidentals = { 0: '#' };
            else if (sAlt === -1) last.accidentals = { 0: 'b' };
            else if (sAlt === 2) last.accidentals = { 0: '##' };
            else if (sAlt === -2) last.accidentals = { 0: 'bb' };
            else delete last.accidentals;
          }
        }
        curTick += advance;
        continue;
      }

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
        flatNoteIdx++;
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
        flatNoteIdx++;
        curTick += advance;
        continue;
      }

      const ni: NoteInfo = {
        keys: [`${step}/${octave}`],
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

      // Accidental — semantically the FLAT/SHARP/NATURAL on the actual sounding
      // pitch. vexToMidi falls back to the key signature when no
      // explicit accidental is present, but we still encode key-sig-implied
      // alterations here so playback doesn't hinge on data.key being right.
      // The NoteSheet renderer suppresses drawing the symbol when it already
      // matches the key signature / active accidental state.
      const isInKeySig = state.keySigLetters.has(step);
      const accText = text(nEl, 'accidental');
      const alterTxt = text(pitchEl, 'alter');
      const alterVal = alterTxt !== null ? parseInt(alterTxt, 10) : null;
      if (accText && ACC_MAP[accText]) {
        // Engraver drew an explicit accidental — that IS the sounding pitch.
        ni.accidentals = { 0: ACC_MAP[accText] };
      } else if (alterVal === 1) {
        ni.accidentals = { 0: '#' };
      } else if (alterVal === -1) {
        ni.accidentals = { 0: 'b' };
      } else if (alterVal === 2) {
        ni.accidentals = { 0: '##' };
      } else if (alterVal === -2) {
        ni.accidentals = { 0: 'bb' };
      } else if (alterVal === 0 && isInKeySig) {
        // <alter>0</alter> on a key-sig letter = explicit natural override.
        ni.accidentals = { 0: 'n' };
      }
      // alter absent / 0 outside key sig → no accidental flag; player reads
      // the natural pitch which is correct.

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

      // Ottava — apply current running state.
      if (state.ottava && state.ottavaStartIdx === flatNoteIdx) {
        ni.ottavaStart = state.ottava;
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
      if (BEAMABLE_XML_TYPES.has(typeStr) && !isGrace && docHasBeams) {
        let primaryBeam: string | null = null;
        for (const be of nEl.querySelectorAll('beam')) {
          if ((be.getAttribute('number') ?? '1') === '1') {
            primaryBeam = (be.textContent ?? '').trim();
            break;
          }
        }
        if (primaryBeam === null) {
          ni.noBeam = true;
          beamOpen = false;
        } else if (primaryBeam === 'begin') {
          beamOpen = true;
        } else if (primaryBeam === 'end') {
          ni.beamBreak = true;
          beamOpen = false;
        }
        // 'continue' / hooks keep beamOpen at its current value.
      }

      // ── Explicit stem direction (<stem>up|down</stem>).
      // VexFlow's autoStem picks per-note based on pitch position alone, which
      // diverges from the engraver's choice on the staff-middle line (B4) and
      // for stem-flipped phrases. Honour the XML directly when present.
      const stemTxt = text(nEl, 'stem');
      if (stemTxt === 'up' || stemTxt === 'down') ni.stem = stemTxt;

      measure.notes.push(ni);
      emitTimes.push({ startTick, durTicks: advDurTicks });
      flatNoteIdx++;
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

  return {
    title,
    composer,
    key: initialKey,
    timeSignature: timeSig,
    tempo,
    measures,
  };
}

/* ─── MusicXML chord kind → symbol ───────────────────────────────────── */

function kindToSymbol(kind: string): string {
  // Used only when <kind> has no text="…" attribute. Use U+25B3 △ (white
  // up-pointing triangle) for the maj-7 symbol — NoteSheet's formatChord /
  // LickCard's appendChordSVG both expect this exact codepoint. The visually
  // similar U+0394 Δ (Greek capital delta) renders as a Greek letter in the
  // chord font, not the music glyph.
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
  };
  return MAP[kind] ?? kind;
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
    const data = parseXmlDoc(doc, fallbackTitle, pEl, opts);
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

export async function loadXmlParts(url: string, fallbackTitle: string, opts?: XmlParseOpts): Promise<ScorePart[]> {
  const res = await fetch(url);
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
  return parseAllParts(doc, fallbackTitle, opts);
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
