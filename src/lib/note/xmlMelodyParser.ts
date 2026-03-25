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

export async function loadXmlMelody(
  url: string,
  fallbackTitle: string,
): Promise<NoteSheetData> {
  const res = await fetch(url);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

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
      // skip chord tones (simultaneous notes) — keep first only
      if (nEl.querySelector('chord')) continue;

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

      // accidental
      const accText = text(nEl, 'accidental');
      if (accText && ACC_MAP[accText]) {
        ni.accidentals = { 0: ACC_MAP[accText] };
      } else {
        const alter = parseInt(text(pitchEl, 'alter') ?? '0', 10);
        if (alter === 1)  ni.accidentals = { 0: '#' };
        if (alter === -1) ni.accidentals = { 0: 'b' };
      }

      notes.push(ni);
    }

    if (notes.length > 0) {
      measures.push({ notes, chord });
    }
  }

  return { title, composer, key, timeSignature: timeSig, measures };
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
