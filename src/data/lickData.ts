import type { NoteSheetData, MeasureInfo, NoteInfo } from './sampleMelody';

/* ─── Raw lick JSON shape (from extract_licks.py) ─────────────────── */

interface RawLick {
  id: number;
  melid: number;
  start_idx: number;
  end_idx: number;
  n_events: number;
  tag: string;
  base_tag: string;
  performer: string;
  title: string;
  instrument: string;
  style: string;
  tempo: number | null;
  key: string;
  rhythmfeel: string;
  chords: string[];
  chords_per_event: (string | null)[];
  pitch: number[];
  onset: number[];
  duration: number[];
  bar: number[];
  beat: number[];
  tatum: number[];
  interval: number[];
  parsons: number[];
  fuzzy_interval: number[];
  pitch_class: number[];
  chordal_pc: (number | null)[];
  chordal_diatonic_pc: (string | null)[];
  duration_class: number[];
}

export interface LickEntry {
  id: number;
  performer: string;
  title: string;
  instrument: string;
  style: string;
  tempo: number | null;
  key: string;
  rhythmfeel: string;
  tag: string;
  chords: string[];
  nEvents: number;
  label: string;           // display label
  sheetData: NoteSheetData;
  intervals: number[];     // signed semitone intervals between consecutive pitches
  parsons: number[];       // contour: 1=up, -1=down, 0=same
  fuzzyIntervals: number[];// categorised intervals (±1 step, ±2 small leap, etc.)
  durationClasses: number[];// quantised duration per note
}

/* ─── Pitch helpers ───────────────────────────────────────────────── */

const SHARP_TABLE: { letter: string; acc?: '#' | 'b' }[] = [
  { letter: 'c' },           { letter: 'c', acc: '#' },
  { letter: 'd' },           { letter: 'd', acc: '#' },
  { letter: 'e' },           { letter: 'f' },
  { letter: 'f', acc: '#' }, { letter: 'g' },
  { letter: 'g', acc: '#' }, { letter: 'a' },
  { letter: 'a', acc: '#' }, { letter: 'b' },
];

const FLAT_TABLE: { letter: string; acc?: '#' | 'b' }[] = [
  { letter: 'c' },           { letter: 'd', acc: 'b' },
  { letter: 'd' },           { letter: 'e', acc: 'b' },
  { letter: 'e' },           { letter: 'f' },
  { letter: 'g', acc: 'b' }, { letter: 'g' },
  { letter: 'a', acc: 'b' }, { letter: 'a' },
  { letter: 'b', acc: 'b' }, { letter: 'b' },
];

function midiToVex(midi: number, useFlats: boolean): { key: string; acc?: '#' | 'b' } {
  const pc = midi % 12;
  const oct = Math.floor(midi / 12) - 1;
  const t = (useFlats ? FLAT_TABLE : SHARP_TABLE)[pc];
  return { key: `${t.letter}/${oct}`, acc: t.acc };
}

/* Key signature accidentals (same as midiMelodyParser) */
/**
 * Returns the set of pitch-classes (0–11) that are altered by the key signature.
 * For flats: Bb=10, Eb=3, Ab=8, Db=1, Gb=6, Cb=11, Fb=4
 * For sharps: F#=6, C#=1, G#=8, D#=3, A#=10, E#=5, B#=0
 */
function keySigPitchClasses(keyStr: string): Set<number> {
  const FLAT_ORDER  = [10, 3, 8, 1, 6, 11, 4]; // Bb Eb Ab Db Gb Cb Fb
  const SHARP_ORDER = [6, 1, 8, 3, 10, 5, 0];  // F# C# G# D# A# E# B#
  const sf = keySigFromName(keyStr);
  const s = new Set<number>();
  if (sf < 0) {
    for (let i = 0; i < Math.min(-sf, 7); i++) s.add(FLAT_ORDER[i]);
  } else {
    for (let i = 0; i < Math.min(sf, 7); i++) s.add(SHARP_ORDER[i]);
  }
  return s;
}

function keySigFromName(keyStr: string): number {
  // wjazzd key format: "Bb-maj", "F-min", "C-maj", etc.
  const parts = keyStr.split('-');
  const root = parts[0];
  const mode = parts[1] || 'maj';

  const majorSigMap: Record<string, number> = {
    'Cb': -7, 'Gb': -6, 'Db': -5, 'Ab': -4, 'Eb': -3, 'Bb': -2, 'F': -1,
    'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
  };
  // minor key uses same sig as its relative major (minor root + 3 semitones)
  const minorSigMap: Record<string, number> = {
    'Ab': -7, 'Eb': -6, 'Bb': -5, 'F': -4, 'C': -3, 'G': -2, 'D': -1,
    'A': 0, 'E': 1, 'B': 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  };
  if (mode === 'min' || mode === 'minor') return minorSigMap[root] ?? 0;
  return majorSigMap[root] ?? 0;
}

function normalizeKey(keyStr: string): string {
  // "Bb-maj" → "Bb", "F-min" → "Fm", "C-dor" → "C"
  const parts = keyStr.split('-');
  const root = parts[0] || 'C';
  const mode = parts[1] || '';
  if (mode === 'min' || mode === 'minor') return root + 'm';
  return root;
}

/* ─── Duration quantisation ───────────────────────────────────────── */

const DUR_GRID = [
  { beats: 4.0,  vf: 'w',  dot: false },
  { beats: 3.0,  vf: 'h',  dot: true  },
  { beats: 2.0,  vf: 'h',  dot: false },
  { beats: 1.5,  vf: 'q',  dot: true  },
  { beats: 1.0,  vf: 'q',  dot: false },
  { beats: 0.75, vf: '8',  dot: true  },
  { beats: 0.5,  vf: '8',  dot: false },
  { beats: 0.25, vf: '16', dot: false },
];

function quantise(beats: number): { vf: string; dot: boolean; beats: number } {
  let best = DUR_GRID[DUR_GRID.length - 1];
  let diff = Infinity;
  for (const d of DUR_GRID) {
    const dd = Math.abs(d.beats - beats);
    if (dd < diff) { diff = dd; best = d; }
  }
  return best;
}

/* ─── Convert raw lick → NoteSheetData ────────────────────────────── */

function lickToSheet(lick: RawLick): NoteSheetData {
  const nKey = normalizeKey(lick.key);
  const useFlats = true; // always use flats for lick display
  const keySigPcs = keySigPitchClasses(lick.key);

  // Group events by bar
  const barMap = new Map<number, number[]>();
  for (let i = 0; i < lick.pitch.length; i++) {
    const b = lick.bar[i];
    if (!barMap.has(b)) barMap.set(b, []);
    barMap.get(b)!.push(i);
  }

  const measures: MeasureInfo[] = [];

  // Estimate beat duration from onset gaps (fallback 0.375s ≈ 160bpm)
  let avgBeatDur = 0.375;
  if (lick.tempo && lick.tempo > 0) {
    avgBeatDur = 60 / lick.tempo;
  }

  for (const [, indices] of [...barMap.entries()].sort((a, b) => a[0] - b[0])) {
    const notes: NoteInfo[] = [];

    // Chord for this measure (first event's chord)
    const chordStr = lick.chords_per_event[indices[0]] ?? undefined;

    for (const idx of indices) {
      const midi = lick.pitch[idx];
      const dur = lick.duration[idx];
      const beats = dur / avgBeatDur;
      const q = quantise(beats);
      const { key: vk, acc } = midiToVex(midi, useFlats);

      const ni: NoteInfo = { keys: [vk], duration: q.vf, dotted: q.dot || undefined };
      if (acc && !keySigPcs.has(midi % 12)) {
        ni.accidentals = { 0: acc };
      }
      notes.push(ni);
    }

    if (notes.length === 0) {
      notes.push({ keys: ['b/4'], duration: 'wr' });
    }

    measures.push({ notes, chord: chordStr });
  }

  return {
    title: `${lick.performer} — ${lick.title}`,
    composer: lick.performer,
    key: nKey,
    timeSignature: '4/4',
    tempo: lick.tempo ?? undefined,
    measures,
  };
}

/* ─── Load and parse ──────────────────────────────────────────────── */

let cachedLicks: LickEntry[] | null = null;

export async function loadLicks(): Promise<LickEntry[]> {
  if (cachedLicks) return cachedLicks;

  const res = await fetch('/data/licks/licks.json');
  const raw: RawLick[] = await res.json();

  cachedLicks = raw
    .filter((l) => l.n_events >= 8)  // skip short fragments — real licks are 8+ notes
    .map((l) => ({
      id: l.id,
      performer: l.performer,
      title: l.title,
      instrument: l.instrument,
      style: l.style,
      tempo: l.tempo,
      key: l.key,
      rhythmfeel: l.rhythmfeel,
      tag: l.tag,
      chords: l.chords,
      nEvents: l.n_events,
      label: `#${l.id} ${l.performer} — ${l.title} [${l.style}] (${l.chords.join(' → ')})`,
      sheetData: lickToSheet(l),
      intervals: l.interval,
      parsons: l.parsons,
      fuzzyIntervals: l.fuzzy_interval,
      durationClasses: l.duration_class,
    }));

  return cachedLicks;
}

/* ─── User-created lick persistence (localStorage) ───────────────── */

const STORAGE_KEY = 'jazzify_user_licks';

export function loadUserLicks(): LickEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LickEntry[];
  } catch {
    return [];
  }
}

export function saveUserLick(lick: LickEntry): void {
  const existing = loadUserLicks();
  existing.unshift(lick);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function deleteUserLick(id: number): void {
  const existing = loadUserLicks().filter((l) => l.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}
