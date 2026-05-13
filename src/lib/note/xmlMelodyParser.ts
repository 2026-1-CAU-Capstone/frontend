import { unzipSync } from 'fflate';
import type {
  NoteSheetData, NoteInfo, MeasureInfo,
  Articulation, Ornament, Dynamic, NavigationMarker,
} from '../../data/sampleMelody';

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

const ACC_MAP: Record<string, '#' | 'b' | 'n'> = {
  sharp: '#', flat: 'b', natural: 'n',
  'double-sharp': '#', 'sharp-sharp': '#',
  'double-flat': 'b', 'flat-flat': 'b',
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

/* ─── core parser ────────────────────────────────────────────────────── */

interface ParserState {
  fifths: number;
  keySigLetters: Set<string>;
  /** Pending dynamic to attach to the next note. */
  pendingDynamic?: Dynamic;
  /** Pending ottava state — applied to subsequent notes until stopped. */
  ottava?: '8va' | '8vb';
  /** Note index (within current measure) where ottava started, for end marker. */
  ottavaStartIdx?: number;
  /** Last emitted measure index, used for navigation/repeat fallback. */
}

function parseXmlDoc(doc: Document, fallbackTitle: string): NoteSheetData {

  /* ── metadata ────────────────────────────────────────────────────── */
  const title  = text(doc.documentElement, 'work-title')
              ?? text(doc.documentElement, 'movement-title')
              ?? fallbackTitle;
  const composer = text(doc.documentElement, 'creator[type="composer"]') ?? 'Unknown';

  const firstAttr = doc.querySelector('attributes');
  const initialFifths = parseInt(text(firstAttr, 'fifths') ?? '0', 10);
  const beats    = text(firstAttr, 'beats') ?? '4';
  const beatType = text(firstAttr, 'beat-type') ?? '4';
  const timeSig  = `${beats}/${beatType}`;
  const initialKey = KEY_NAMES[initialFifths + 7] ?? 'C';

  // Tempo from first <sound tempo="..."/>
  const soundEl = doc.querySelector('sound[tempo]');
  const tempo = soundEl ? Math.round(parseFloat(soundEl.getAttribute('tempo')!)) : undefined;

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
  };

  // Slur tracking across the whole piece: map slur number → flat note index
  // of the slur-start note. When a slur stop arrives, mark BOTH start and
  // stop notes (slurStart/slurStop) so the renderer can pair them later.
  // VexFlow renders slurs as Curve(s) between the start and stop notes.
  let flatNoteIdx = 0;

  // Volta tracking: an <ending number="1"> spans one or more measures
  // until <ending type="stop"/>. We mark each measure inside the span.
  let currentVolta: number | undefined;

  const partMeasures = doc.querySelectorAll('part > measure');

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

    // Walk measure children in document order.
    for (const child of Array.from(mEl.children)) {
      const tag = child.tagName;

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
        if (beatsTxt && beatTypeTxt && measureIdx > 0) {
          const ts = `${beatsTxt}/${beatTypeTxt}`;
          if (ts !== timeSig) measure.timeSignature = ts;
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
        const endingEl = child.querySelector('ending');
        if (endingEl) {
          const num = parseInt(endingEl.getAttribute('number') ?? '0', 10);
          const type = endingEl.getAttribute('type');
          if (type === 'start' && num >= 1) {
            currentVolta = num;
            measure.volta = num;
          } else if ((type === 'stop' || type === 'discontinue') && location !== 'left') {
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
        // Mid-piece tempo change: <direction><sound tempo="N"/></direction>.
        // Captured at the measure where the new tempo takes effect; only the
        // FIRST tempo of measureIdx>0 is stored (most XMLs declare once per change).
        const soundTempoEl = child.querySelector('sound[tempo]');
        if (soundTempoEl && measureIdx > 0 && measure.tempo === undefined) {
          const t = parseFloat(soundTempoEl.getAttribute('tempo') ?? '');
          if (Number.isFinite(t) && t > 0) measure.tempo = Math.round(t);
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
        const suffix = (kindText !== null && kindText !== undefined)
          ? kindText
          : kindToSymbol(kind);
        const sym = root + acc + suffix;
        if (sym && measureChords[measureChords.length - 1] !== sym) measureChords.push(sym);
        continue;
      }

      /* ── <note> ─────────────────────────────────────────────────── */
      if (tag !== 'note') continue;
      const nEl = child;

      // Skip simultaneous chord tones (top note only).
      if (nEl.querySelector('chord')) continue;

      // Voice 1 only.
      const voiceText = text(nEl, 'voice');
      if (voiceText && voiceText !== '1') continue;

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

      const isRest = !!nEl.querySelector('rest');
      const isGrace = !!nEl.querySelector('grace');
      const graceSlash = isGrace
        ? nEl.querySelector('grace')?.getAttribute('slash') === 'yes'
        : false;

      const typeStr = text(nEl, 'type') ?? 'quarter';
      const vf = TYPE_TO_VF[typeStr] ?? 'q';
      const isDotted = !!nEl.querySelector('dot');

      // Tuplet detection
      const tmEl = nEl.querySelector('time-modification');
      let tuplet: number | undefined;
      if (tmEl) {
        const actual = parseInt(text(tmEl, 'actual-notes') ?? '0', 10);
        const normal = parseInt(text(tmEl, 'normal-notes') ?? '0', 10);
        if (actual > normal && actual > 1) tuplet = actual;
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
        const restNote: NoteInfo = { keys: ['b/4'], duration: vf + 'r' };
        if (isDotted) restNote.dotted = true;
        if (tuplet) restNote.tuplet = tuplet;
        if (tupletBracketAttr !== undefined) restNote.tupletBracket = tupletBracketAttr;
        if (noteFermata) restNote.fermata = true;
        // If we're inside an open beam group (between <beam>begin</beam> and
        // its matching <beam>end</beam>), the rest sits visually under the beam.
        if (docHasBeams && beamOpen && BEAMABLE_XML_TYPES.has(typeStr)) {
          restNote.restInBeam = true;
        }
        measure.notes.push(restNote);
        flatNoteIdx++;
        continue;
      }

      const pitchEl = nEl.querySelector('pitch');
      if (!pitchEl) continue;

      const step   = (text(pitchEl, 'step') ?? 'C').toLowerCase();
      const octave = text(pitchEl, 'octave') ?? '4';

      const ni: NoteInfo = {
        keys: [`${step}/${octave}`],
        duration: vf,
      };
      if (isDotted) ni.dotted = true;
      if (tuplet) ni.tuplet = tuplet;
      if (tupletBracketAttr !== undefined) ni.tupletBracket = tupletBracketAttr;
      if (isGrace) {
        ni.grace = true;
        if (graceSlash) ni.graceSlash = true;
      }

      // Accidental — semantically the FLAT/SHARP/NATURAL on the actual sounding
      // pitch (NotePlayer.vexToMidi maps letter+accidental→MIDI without consulting
      // the key signature, so the parser MUST encode key-sig-implied alterations
      // here too). The NoteSheet renderer suppresses drawing the symbol when it
      // already matches the key signature / active accidental state.
      const isInKeySig = state.keySigLetters.has(step);
      const accText = text(nEl, 'accidental');
      const alterTxt = text(pitchEl, 'alter');
      const alterVal = alterTxt !== null ? parseInt(alterTxt, 10) : null;
      if (accText && ACC_MAP[accText]) {
        // Engraver drew an explicit accidental — that IS the sounding pitch.
        ni.accidentals = { 0: ACC_MAP[accText] };
      } else if (alterVal === 1) {
        // <alter>1</alter>: sharp pitch (key sig or not — the actual pitch is sharp).
        ni.accidentals = { 0: '#' };
      } else if (alterVal === -1) {
        // <alter>-1</alter>: flat pitch — e.g. F-major's Bb encoded as
        // <step>B<alter>-1 without <accidental> because the key sig handles
        // the visual. Player MUST see the flat to sound the correct pitch.
        ni.accidentals = { 0: 'b' };
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
      flatNoteIdx++;
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

/* ─── Public loaders ─────────────────────────────────────────────────── */

export async function loadXmlMelody(
  url: string,
  fallbackTitle: string,
): Promise<NoteSheetData> {
  const res = await fetch(url);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return parseXmlDoc(doc, fallbackTitle);
}

export async function loadMxlMelody(
  url: string,
  fallbackTitle: string,
): Promise<NoteSheetData> {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);

  let xmlText: string | null = null;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('.xml') && !name.startsWith('META-INF') && name !== 'container.xml') {
      xmlText = new TextDecoder().decode(data);
      break;
    }
  }
  if (!xmlText) throw new Error('No MusicXML found in MXL archive');

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return parseXmlDoc(doc, fallbackTitle);
}
