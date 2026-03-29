import { unzipSync } from 'fflate';
import type { NoteSheetData, NoteInfo, MeasureInfo } from '../../data/sampleMelody';

/* ─── MusicXML → NoteSheetData parser ────────────────────────────────── */

const TYPE_TO_VF: Record<string, string> = {
  whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32',
};

const ACC_MAP: Record<string, '#' | 'b' | 'n'> = {
  sharp: '#', flat: 'b', natural: 'n',
  'double-sharp': '#', 'sharp-sharp': '#',
  'double-flat': 'b', 'flat-flat': 'b',
};

const KEY_NAMES = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];

function text(el: Element | null | undefined, sel: string): string | null {
  return el?.querySelector(sel)?.textContent ?? null;
}

function parseXmlDoc(doc: Document, fallbackTitle: string): NoteSheetData {

  /* ── metadata ────────────────────────────────────────────────────── */
  const title  = text(doc.documentElement, 'work-title')
              ?? text(doc.documentElement, 'movement-title')
              ?? fallbackTitle;
  const composer = text(doc.documentElement, 'creator[type="composer"]') ?? 'Charlie Parker';

  const firstAttr = doc.querySelector('attributes');
  const fifths = parseInt(text(firstAttr, 'fifths') ?? '0', 10);
  const beats    = text(firstAttr, 'beats') ?? '4';
  const beatType = text(firstAttr, 'beat-type') ?? '4';
  const timeSig  = `${beats}/${beatType}`;
  const key = KEY_NAMES[fifths + 7] ?? 'C';

  // Build set of note letters altered by key signature (to avoid redundant accidentals)
  const FLAT_LETTERS  = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
  const SHARP_LETTERS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
  const keySigLetters = new Set<string>();
  if (fifths < 0) {
    for (let i = 0; i < Math.min(-fifths, 7); i++) keySigLetters.add(FLAT_LETTERS[i]);
  } else {
    for (let i = 0; i < Math.min(fifths, 7); i++) keySigLetters.add(SHARP_LETTERS[i]);
  }

  // Tempo from <sound tempo="..."/>
  const soundEl = doc.querySelector('sound[tempo]');
  const tempo = soundEl ? Math.round(parseFloat(soundEl.getAttribute('tempo')!)) : undefined;

  /* ── parse measures ──────────────────────────────────────────────── */
  const measures: MeasureInfo[] = [];

  for (const mEl of doc.querySelectorAll('part > measure')) {
    const notes: NoteInfo[] = [];
    let chord: string | undefined;

    // chord symbol from <harmony>
    const harmEl = mEl.querySelector('harmony');
    if (harmEl) {
      const root  = text(harmEl, 'root-step') ?? '';
      const alter = text(harmEl, 'root-alter');
      const kind  = text(harmEl, 'kind') ?? '';
      const acc   = alter === '1' ? '#' : alter === '-1' ? 'b' : '';
      chord = root + acc + kindToSymbol(kind);
    }

    for (const nEl of mEl.querySelectorAll('note')) {
      // ── Skip chord tones (simultaneous notes) — keep top note only
      if (nEl.querySelector('chord')) continue;

      // ── Filter to voice 1 (avoid multi-voice overlap)
      const voiceText = text(nEl, 'voice');
      if (voiceText && voiceText !== '1') continue;

      // ── Skip tie continuations (tie type="stop" without type="start")
      const tieEls = nEl.querySelectorAll('tie');
      let tieStart = false;
      let tieStop = false;
      for (const t of tieEls) {
        const tt = t.getAttribute('type');
        if (tt === 'start') tieStart = true;
        if (tt === 'stop')  tieStop = true;
      }
      // Pure continuation — skip (the original note covers it)
      if (tieStop && !tieStart) continue;

      const isRest = !!nEl.querySelector('rest');
      const typeStr = text(nEl, 'type') ?? 'quarter';
      const vf = TYPE_TO_VF[typeStr] ?? 'q';
      const isDotted = !!nEl.querySelector('dot');

      if (isRest) {
        notes.push({ keys: ['b/4'], duration: vf + 'r', dotted: isDotted || undefined });
        continue;
      }

      const pitchEl = nEl.querySelector('pitch');
      if (!pitchEl) continue;

      const step   = (text(pitchEl, 'step') ?? 'C').toLowerCase();
      const octave = text(pitchEl, 'octave') ?? '4';

      const ni: NoteInfo = {
        keys: [`${step}/${octave}`],
        duration: vf,
        dotted: isDotted || undefined,
      };

      // accidental — skip if already covered by key signature
      const isInKeySig = keySigLetters.has(step);
      const accText = text(nEl, 'accidental');
      if (accText && ACC_MAP[accText]) {
        const acc = ACC_MAP[accText];
        // natural on a key-sig note IS meaningful (cancels the key sig)
        if (acc === 'n' && isInKeySig) {
          ni.accidentals = { 0: 'n' };
        } else if (!isInKeySig) {
          ni.accidentals = { 0: acc };
        }
      } else {
        const alter = parseInt(text(pitchEl, 'alter') ?? '0', 10);
        if (alter === 1 && !isInKeySig)  ni.accidentals = { 0: '#' };
        if (alter === -1 && !isInKeySig) ni.accidentals = { 0: 'b' };
        // natural cancellation on key-sig note
        if (alter === 0 && isInKeySig) ni.accidentals = { 0: 'n' };
      }

      // If this note starts a tie, extend its duration by summing tied notes
      if (tieStart) {
        const extDur = collectTiedDuration(nEl);
        if (extDur) {
          ni.duration = extDur.vf;
          ni.dotted = extDur.dot || undefined;
        }
      }

      notes.push(ni);
    }

    // Include measures even if empty (whole rest)
    if (notes.length === 0) {
      notes.push({ keys: ['b/4'], duration: 'wr' });
    }
    measures.push({ notes, chord });
  }

  return { title, composer, key, timeSignature: timeSig, tempo, measures };
}

/* ─── Tie duration merging ──────────────────────────────────────────── */

const DUR_DIVS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
};

const BEAT_TO_VF: { beats: number; vf: string; dot: boolean }[] = [
  { beats: 4.0,  vf: 'w',  dot: false },
  { beats: 3.0,  vf: 'h',  dot: true  },
  { beats: 2.0,  vf: 'h',  dot: false },
  { beats: 1.5,  vf: 'q',  dot: true  },
  { beats: 1.0,  vf: 'q',  dot: false },
  { beats: 0.75, vf: '8',  dot: true  },
  { beats: 0.5,  vf: '8',  dot: false },
  { beats: 0.25, vf: '16', dot: false },
];

/** Walk forward through tied notes and sum their durations. */
function collectTiedDuration(startNote: Element): { vf: string; dot: boolean } | null {
  let totalBeats = noteDurBeats(startNote);
  let current: Element | null = startNote;

  while (current) {
    // Check if this note has tie type="start"
    const ties = current.querySelectorAll('tie');
    let hasStart = false;
    for (const t of ties) {
      if (t.getAttribute('type') === 'start') hasStart = true;
    }
    if (!hasStart) break;

    // Find next <note> sibling (skip non-note elements)
    let next: Element | null = current.nextElementSibling;
    while (next && next.tagName !== 'note') next = next.nextElementSibling;
    if (!next) break;

    // Verify it has tie type="stop"
    const nextTies = next.querySelectorAll('tie');
    let hasStop = false;
    for (const t of nextTies) {
      if (t.getAttribute('type') === 'stop') hasStop = true;
    }
    if (!hasStop) break;

    totalBeats += noteDurBeats(next);
    current = next;
  }

  // Quantise total to nearest standard duration
  let best = BEAT_TO_VF[BEAT_TO_VF.length - 1];
  let diff = Infinity;
  for (const d of BEAT_TO_VF) {
    const dd = Math.abs(d.beats - totalBeats);
    if (dd < diff) { diff = dd; best = d; }
  }
  return best;
}

function noteDurBeats(el: Element): number {
  const typeStr = el.querySelector('type')?.textContent ?? 'quarter';
  let b = DUR_DIVS[typeStr] ?? 1;
  if (el.querySelector('dot')) b *= 1.5;
  return b;
}

/* ─── MusicXML chord kind → symbol ───────────────────────────────────── */

function kindToSymbol(kind: string): string {
  const MAP: Record<string, string> = {
    major: '\u0394', minor: '-', dominant: '7',
    'major-seventh': '\u03947', 'minor-seventh': '-7',
    'dominant-seventh': '7', 'half-diminished': '\u00f87',
    diminished: '\u00b07', 'diminished-seventh': '\u00b07',
    augmented: '+', 'augmented-seventh': '+7',
    suspended: 'sus', 'suspended-fourth': 'sus4',
    'major-sixth': '6', 'minor-sixth': '-6',
    'major-minor': '-\u03947', 'major-ninth': '\u03949',
    'dominant-ninth': '9', 'minor-ninth': '-9',
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

  // Find the MusicXML file inside the ZIP (skip META-INF, container.xml, etc.)
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
