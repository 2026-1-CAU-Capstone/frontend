import type { NoteSheetData, MeasureInfo, NoteInfo } from '../../data/sampleMelody';

/* ─────────────────────────────────────────────────────────────────────────
 * Convert Basic Pitch note events → a NoteSheetData the app's VexFlow
 * NoteSheet can render (bass clef). This is a pragmatic quantizer, not a full
 * rhythm engine: notes are snapped to an 8th-note grid at the given BPM, laid
 * into bars of the time signature, gaps filled with rests, and notes that
 * cross a barline are split + tied. Good enough for walking-bass readouts;
 * 16th-note detail is intentionally rounded away.
 * ──────────────────────────────────────────────────────────────────────── */

export interface TimedNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

interface BuildOpts {
  bpm: number;
  timeSignature: string; // e.g. '4/4'
  title: string;
  key: string;
  maxBars?: number;
  /** Per-bar chord labels from the picked song, cycled onto the result bars
   *  so the transcribed bass reads against the changes. Alignment assumes the
   *  clip starts on the progression's first bar. */
  barChords?: string[];
}

/** MIDI → VexFlow key + optional accidental, using a sharp spelling. */
function midiToVexKey(midi: number): { key: string; acc?: '#' } {
  const names = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
  const sharp = [false, true, false, true, false, false, true, false, true, false, true, false];
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { key: `${names[pc]}/${octave}`, acc: sharp[pc] ? '#' : undefined };
}

/** Decompose an 8th-note-unit length (≤ one bar) into note-value tokens. */
function unitsToTokens(units: number): Array<{ dur: string; dotted: boolean }> {
  const table: Array<[number, string, boolean]> = [
    [8, 'w', false], [6, 'h', true], [4, 'h', false],
    [3, 'q', true], [2, 'q', false], [1, '8', false],
  ];
  const out: Array<{ dur: string; dotted: boolean }> = [];
  let rem = units;
  for (const [val, dur, dotted] of table) {
    while (rem >= val) { out.push({ dur, dotted }); rem -= val; }
  }
  return out;
}

const REST_KEY = 'd/3'; // centred rest position for bass clef

export function buildBassNoteSheet(
  notes: TimedNote[],
  { bpm, timeSignature, title, key, maxBars = 64, barChords }: BuildOpts,
): NoteSheetData {
  const [numRaw, denRaw] = timeSignature.split('/').map((n) => parseInt(n, 10));
  const num = Number.isFinite(numRaw) && numRaw > 0 ? numRaw : 4;
  const den = Number.isFinite(denRaw) && denRaw > 0 ? denRaw : 4;
  // One "unit" = an 8th note. For x/4 a beat is a quarter (2 units); for x/8 a
  // beat is an 8th (1 unit). secPerUnit derives from the quarter-note BPM.
  const unitsPerBeat = den === 8 ? 1 : 2;
  const unitsPerBar = num * unitsPerBeat;
  const secPerUnit = 60 / bpm / 2;

  // Snap to the grid; enforce monophonic (no overlaps) by truncation.
  const snapped = notes
    .map((n) => ({
      startUnit: Math.round(n.startTimeSeconds / secPerUnit),
      durUnit: Math.max(1, Math.round(n.durationSeconds / secPerUnit)),
      midi: Math.round(n.pitchMidi),
    }))
    .sort((a, b) => a.startUnit - b.startUnit);
  for (let i = 0; i < snapped.length - 1; i++) {
    const end = snapped[i].startUnit + snapped[i].durUnit;
    if (end > snapped[i + 1].startUnit) snapped[i].durUnit = Math.max(0, snapped[i + 1].startUnit - snapped[i].startUnit);
  }
  const clean = snapped.filter((n) => n.durUnit > 0);

  // Build a flat piece list (notes + rest gaps).
  type Piece = { midi: number | null; units: number };
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const n of clean) {
    if (n.startUnit > cursor) pieces.push({ midi: null, units: n.startUnit - cursor });
    pieces.push({ midi: n.midi, units: n.durUnit });
    cursor = n.startUnit + n.durUnit;
  }
  // Pad the final bar with a rest so the last measure is complete.
  const tail = cursor % unitsPerBar;
  if (tail !== 0) pieces.push({ midi: null, units: unitsPerBar - tail });

  // Lay pieces into bars, splitting at barlines and tying split notes.
  const measures: MeasureInfo[] = [];
  let bar: NoteInfo[] = [];
  let barUnits = 0;
  const flushBar = () => { measures.push({ notes: bar }); bar = []; barUnits = 0; };

  for (const piece of pieces) {
    if (measures.length >= maxBars) break;
    const pieceRefs: NoteInfo[] = [];
    let rem = piece.units;
    while (rem > 0) {
      const take = Math.min(unitsPerBar - barUnits, rem);
      for (const tk of unitsToTokens(take)) {
        if (piece.midi == null) {
          bar.push({ keys: [REST_KEY], duration: `${tk.dur}r`, dotted: tk.dotted });
        } else {
          const { key: vk, acc } = midiToVexKey(piece.midi);
          const ni: NoteInfo = { keys: [vk], duration: tk.dur, dotted: tk.dotted };
          if (acc) ni.accidentals = { 0: acc };
          bar.push(ni);
          pieceRefs.push(ni);
        }
      }
      barUnits += take;
      rem -= take;
      if (barUnits >= unitsPerBar) flushBar();
    }
    // Tie the tokens of a single (multi-token / split) note together.
    if (piece.midi != null && pieceRefs.length > 1) {
      pieceRefs.forEach((ni, i) => {
        if (i < pieceRefs.length - 1) ni.tie = true;
        if (i > 0) ni.tieContinuation = true;
      });
    }
  }
  if (bar.length) flushBar();
  if (measures.length === 0) measures.push({ notes: [{ keys: [REST_KEY], duration: 'wr' }] });

  // Attach cycled chord labels from the picked progression, if provided.
  if (barChords && barChords.length > 0) {
    measures.forEach((m, i) => {
      const c = barChords[i % barChords.length];
      if (c) m.chord = c;
    });
  }

  measures[0].clef = 'bass';

  return {
    title,
    composer: 'AMT · Basic Pitch',
    key,
    timeSignature,
    tempo: bpm,
    instrument: 'acoustic_bass',
    measures,
  };
}
