import type { NoteSheetData, NoteInfo, MeasureInfo } from '../../data/sampleMelody';

/* ─── MIDI binary types ──────────────────────────────────────────────── */

type MidiEvent =
  | { type: 'meta'; tick: number; metaType: number; data: Uint8Array }
  | { type: 'noteOn'; tick: number; note: number; velocity: number; channel: number }
  | { type: 'noteOff'; tick: number; note: number; velocity: number; channel: number };

interface ParsedMidi {
  format: number;
  tracks: MidiEvent[][];
  division: number;
}

/* ─── Binary MIDI parser ─────────────────────────────────────────────── */

function readVarLen(view: DataView, offset: number): [number, number] {
  let value = 0;
  let next = offset;
  for (;;) {
    const byte = view.getUint8(next++);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [value, next];
}

function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const view = new DataView(buffer);
  let offset = 0;

  const readStr = (len: number) => {
    const bytes = new Uint8Array(buffer, offset, len);
    offset += len;
    return new TextDecoder().decode(bytes);
  };

  if (readStr(4) !== 'MThd') throw new Error('Invalid MIDI header');

  const headerLen = view.getUint32(offset); offset += 4;
  const format = view.getUint16(offset);    offset += 2;
  const trackCount = view.getUint16(offset); offset += 2;
  const division = view.getUint16(offset);   offset += 2;
  offset += headerLen - 6;

  const tracks: MidiEvent[][] = [];

  for (let t = 0; t < trackCount; t++) {
    if (readStr(4) !== 'MTrk') throw new Error('Bad MIDI chunk');
    const trackLen = view.getUint32(offset); offset += 4;
    const end = offset + trackLen;
    const events: MidiEvent[] = [];
    let tick = 0;
    let running = 0;

    while (offset < end) {
      let delta: number;
      [delta, offset] = readVarLen(view, offset);
      tick += delta;

      let status = view.getUint8(offset);
      if ((status & 0x80) !== 0) { offset++; running = status; }
      else { status = running; }

      if (status === 0xff) {
        const mt = view.getUint8(offset); offset++;
        let len: number;
        [len, offset] = readVarLen(view, offset);
        const data = new Uint8Array(buffer, offset, len);
        offset += len;
        events.push({ type: 'meta', tick, metaType: mt, data });
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        let len: number;
        [len, offset] = readVarLen(view, offset);
        offset += len;
        continue;
      }

      const evType = status >> 4;
      const channel = status & 0x0f;
      const note = view.getUint8(offset);
      const vel  = view.getUint8(offset + 1);

      if (evType === 0x9 && vel > 0) {
        events.push({ type: 'noteOn', tick, note, velocity: vel, channel });
      } else if (evType === 0x8 || (evType === 0x9 && vel === 0)) {
        events.push({ type: 'noteOff', tick, note, velocity: vel, channel });
      }

      offset += (evType === 0xc || evType === 0xd) ? 1 : 2;
    }

    tracks.push(events);
  }

  return { format, tracks, division };
}

/* ─── Pitch conversion ───────────────────────────────────────────────── */

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

function midiToVex(midi: number, preferSharps: boolean): { key: string; accidental?: '#' | 'b' } {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const t = (preferSharps ? SHARP_TABLE : FLAT_TABLE)[pc];
  return { key: `${t.letter}/${octave}`, accidental: t.acc };
}

/* ─── Duration quantisation ──────────────────────────────────────────── */

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
  return { vf: best.vf, dot: best.dot, beats: best.beats };
}

/** Break a duration (in beats) into standard rest values */
function fillRests(beats: number): NoteInfo[] {
  const rests: NoteInfo[] = [];
  let rem = beats;
  for (const d of DUR_GRID) {
    while (rem >= d.beats - 0.01) {
      rests.push({ keys: ['b/4'], duration: d.vf + 'r', dotted: d.dot || undefined });
      rem -= d.beats;
    }
  }
  return rests;
}

/* ─── Key / time signature helpers ───────────────────────────────────── */

const MAJ_KEYS = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const MIN_KEYS = ['Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m'];

function parseKey(track: MidiEvent[]): { key: string; preferSharps: boolean } {
  const ev = track.find(e => e.type === 'meta' && e.metaType === 0x59) as Extract<MidiEvent,{type:'meta'}> | undefined;
  if (!ev || ev.data.length < 2) return { key: 'C', preferSharps: true };
  const sf = (ev.data[0] << 24) >> 24;
  const mi = ev.data[1];
  const key = (mi === 1 ? MIN_KEYS : MAJ_KEYS)[sf + 7] ?? 'C';
  return { key, preferSharps: sf >= 0 };
}

function parseTimeSig(track: MidiEvent[]): string {
  const ev = track.find(e => e.type === 'meta' && e.metaType === 0x58) as Extract<MidiEvent,{type:'meta'}> | undefined;
  if (!ev || ev.data.length < 2) return '4/4';
  return `${ev.data[0]}/${2 ** ev.data[1]}`;
}

/* ─── Note event extraction ──────────────────────────────────────────── */

interface NoteEv {
  midi: number;
  start: number;   // tick
  end: number;      // tick
}

function extractNotes(track: MidiEvent[]): NoteEv[] {
  const pending = new Map<number, number>();
  const notes: NoteEv[] = [];
  for (const e of track) {
    if (e.type === 'noteOn')  { pending.set(e.note, e.tick); }
    if (e.type === 'noteOff') {
      const s = pending.get(e.note);
      if (s != null) { notes.push({ midi: e.note, start: s, end: e.tick }); pending.delete(e.note); }
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

function melodyTrack(midi: ParsedMidi): MidiEvent[] {
  let best = midi.tracks[0] ?? [];
  let max = 0;
  for (const tr of midi.tracks) {
    const c = tr.filter(e => e.type === 'noteOn').length;
    if (c > max) { max = c; best = tr; }
  }
  return best;
}

/* ─── Main entry point ───────────────────────────────────────────────── */

export async function loadMidiMelody(
  url: string,
  title: string,
  composer: string,
): Promise<NoteSheetData> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const midi = parseMidi(buf);

  // Metadata may live in track 0 or the melody track
  const meta = midi.tracks[0] ?? [];
  const melody = melodyTrack(midi);
  const { key, preferSharps } = parseKey(meta.length ? meta : melody);
  const timeSig = parseTimeSig(meta.length ? meta : melody);

  const [numBeats] = timeSig.split('/').map(Number);
  const tpb = midi.division;                      // ticks per beat
  const tpm = tpb * numBeats;                     // ticks per measure

  const noteEvents = extractNotes(melody);
  if (!noteEvents.length) return { title, composer, key, timeSignature: timeSig, measures: [] };

  const lastTick = Math.max(...noteEvents.map(n => n.end));
  const totalMeasures = Math.max(1, Math.ceil(lastTick / tpm));

  const measures: MeasureInfo[] = [];

  for (let m = 0; m < totalMeasures; m++) {
    const mStart = m * tpm;
    const mEnd = mStart + tpm;

    const mNotes = noteEvents.filter(n => n.start >= mStart && n.start < mEnd);
    const notes: NoteInfo[] = [];
    let cur = mStart;

    for (const ne of mNotes) {
      // rest before this note
      if (ne.start > cur + tpb * 0.05) {
        const gapBeats = (ne.start - cur) / tpb;
        notes.push(...fillRests(gapBeats));
      }

      // the note itself
      const rawBeats = Math.min(ne.end - ne.start, mEnd - ne.start) / tpb;
      const q = quantise(rawBeats);
      const { key: vk, accidental } = midiToVex(ne.midi, preferSharps);

      const ni: NoteInfo = { keys: [vk], duration: q.vf, dotted: q.dot || undefined };
      if (accidental) ni.accidentals = { 0: accidental };
      notes.push(ni);

      cur = ne.start + q.beats * tpb;
    }

    // trailing rest
    if (cur < mEnd - tpb * 0.05) {
      notes.push(...fillRests((mEnd - cur) / tpb));
    }

    if (notes.length === 0) {
      notes.push({ keys: ['b/4'], duration: 'wr' });
    }

    measures.push({ notes });
  }

  return { title, composer, key, timeSignature: timeSig, measures };
}
