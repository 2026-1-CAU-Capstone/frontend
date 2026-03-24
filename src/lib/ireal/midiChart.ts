import type { LeadSheetBar, LeadSheetChord, LeadSheetData, LeadSheetSystem } from '../../data/leadSheetTypes';

type MidiEvent =
  | { type: 'meta'; tick: number; metaType: number; data: Uint8Array }
  | { type: 'noteOn'; tick: number; note: number; velocity: number; channel: number }
  | { type: 'noteOff'; tick: number; note: number; velocity: number; channel: number };

type ParsedMidi = {
  format: number;
  tracks: MidiEvent[][];
  division: number;
};

type ChordTemplate = {
  quality: string;
  normalizedQuality: string;
  intervals: number[];
};

type InferredChord = {
  rootPc: number;
  quality: string;
  normalizedQuality: string;
  bassPc?: number;
};

const CHORD_TEMPLATES: ChordTemplate[] = [
  { quality: '^7', normalizedQuality: 'maj7', intervals: [0, 4, 7, 11] },
  { quality: '7', normalizedQuality: 'dom7', intervals: [0, 4, 7, 10] },
  { quality: '-7', normalizedQuality: 'min7', intervals: [0, 3, 7, 10] },
  { quality: 'h7', normalizedQuality: 'min7b5', intervals: [0, 3, 6, 10] },
  { quality: 'o7', normalizedQuality: 'dim7', intervals: [0, 3, 6, 9] },
  { quality: '7sus', normalizedQuality: 'dom7sus4', intervals: [0, 5, 7, 10] },
  { quality: '6', normalizedQuality: 'maj6', intervals: [0, 4, 7, 9] },
  { quality: '-6', normalizedQuality: 'min6', intervals: [0, 3, 7, 9] },
  { quality: '+7', normalizedQuality: 'aug7', intervals: [0, 4, 8, 10] },
  { quality: '^', normalizedQuality: 'maj', intervals: [0, 4, 7] },
  { quality: '-', normalizedQuality: 'min', intervals: [0, 3, 7] },
  { quality: 'sus', normalizedQuality: 'sus4', intervals: [0, 5, 7] },
  { quality: '+', normalizedQuality: 'aug', intervals: [0, 4, 8] },
];

const PC_TO_NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_TO_NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR_KEY_BY_SIG = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR_KEY_BY_SIG = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR_SCALE = [0, 2, 3, 5, 7, 9, 11];

const QUALITY_INTERVALS: Record<string, number[]> = {
  maj7: [0, 4, 7, 11],
  maj: [0, 4, 7],
  min7: [0, 3, 7, 10],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  aug7: [0, 4, 8, 10],
  sus4: [0, 5, 7],
  dom7sus4: [0, 5, 7, 10],
  min6: [0, 3, 7, 9],
  maj6: [0, 4, 7, 9],
};

const MAJOR_DEGREE_LABELS: Record<number, string> = {
  0: 'I', 1: 'bII', 2: 'ii', 3: 'bIII', 4: 'iii', 5: 'IV', 6: '#IV', 7: 'V', 8: 'bVI', 9: 'vi', 10: 'bVII', 11: 'vii',
};

const MINOR_DEGREE_LABELS: Record<number, string> = {
  0: 'i', 1: 'bII', 2: 'ii', 3: 'bIII', 4: 'III', 5: 'iv', 6: '#iv', 7: 'v', 8: 'bVI', 9: 'vi', 10: 'bVII', 11: 'vii',
};

function readVarLen(view: DataView, offset: number): [number, number] {
  let value = 0;
  let next = offset;
  while (true) {
    const byte = view.getUint8(next++);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [value, next];
}

function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const view = new DataView(buffer);
  let offset = 0;

  const readString = (length: number) => {
    const bytes = new Uint8Array(buffer, offset, length);
    offset += length;
    return new TextDecoder().decode(bytes);
  };

  const header = readString(4);
  if (header !== 'MThd') {
    throw new Error('Invalid MIDI header');
  }

  const headerLength = view.getUint32(offset);
  offset += 4;
  const format = view.getUint16(offset);
  offset += 2;
  const trackCount = view.getUint16(offset);
  offset += 2;
  const division = view.getUint16(offset);
  offset += 2;
  offset += headerLength - 6;

  const tracks: MidiEvent[][] = [];

  for (let t = 0; t < trackCount; t++) {
    const chunkType = readString(4);
    if (chunkType !== 'MTrk') {
      throw new Error(`Unexpected MIDI chunk: ${chunkType}`);
    }
    const trackLength = view.getUint32(offset);
    offset += 4;
    const endOffset = offset + trackLength;
    const events: MidiEvent[] = [];
    let tick = 0;
    let runningStatus = 0;

    while (offset < endOffset) {
      let delta;
      [delta, offset] = readVarLen(view, offset);
      tick += delta;

      let status = view.getUint8(offset);
      if ((status & 0x80) !== 0) {
        offset += 1;
        runningStatus = status;
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = view.getUint8(offset);
        offset += 1;
        let length;
        [length, offset] = readVarLen(view, offset);
        const data = new Uint8Array(buffer, offset, length);
        offset += length;
        events.push({ type: 'meta', tick, metaType, data });
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        let length;
        [length, offset] = readVarLen(view, offset);
        offset += length;
        continue;
      }

      const eventType = status >> 4;
      const channel = status & 0x0f;
      const note = view.getUint8(offset);
      const velocity = view.getUint8(offset + 1);

      if (eventType === 0x9 && velocity > 0) {
        events.push({ type: 'noteOn', tick, note, velocity, channel });
      } else if (eventType === 0x8 || (eventType === 0x9 && velocity === 0)) {
        events.push({ type: 'noteOff', tick, note, velocity, channel });
      }

      offset += eventType === 0xc || eventType === 0xd ? 1 : 2;
    }

    tracks.push(events);
  }

  return { format, tracks, division };
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/\.mid$/i, '')
    .replace(/--/g, "'")
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function noteName(pc: number, preferSharps: boolean): string {
  return (preferSharps ? PC_TO_NOTE_SHARP : PC_TO_NOTE_FLAT)[((pc % 12) + 12) % 12];
}

function splitNoteName(name: string): { root: string; accidental?: 'b' | '#' } {
  if (name.length > 1 && (name[1] === 'b' || name[1] === '#')) {
    return { root: name[0], accidental: name[1] as 'b' | '#' };
  }
  return { root: name[0] };
}

function parseKeySignature(track: MidiEvent[]): { key: string; preferSharps: boolean; mode: 'major' | 'minor'; keyRootPc: number } {
  const keyEvent = track.find((event) => event.type === 'meta' && event.metaType === 0x59) as Extract<MidiEvent, { type: 'meta' }> | undefined;
  if (!keyEvent || keyEvent.data.length < 2) {
    return { key: 'C', preferSharps: true, mode: 'major', keyRootPc: 0 };
  }

  const sf = (keyEvent.data[0] << 24) >> 24;
  const mi = keyEvent.data[1];
  const index = sf + 7;
  const key = mi === 1 ? MINOR_KEY_BY_SIG[index] : MAJOR_KEY_BY_SIG[index];
  const mode = mi === 1 ? 'minor' : 'major';
  const preferSharps = sf >= 0;
  const rootName = key.replace(/m$/, '');
  const NOTE_TO_PC: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
    'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };
  const keyRootPc = NOTE_TO_PC[rootName] ?? 0;

  return { key, preferSharps, mode, keyRootPc };
}

function parseTimeSignature(track: MidiEvent[]): string {
  const ts = track.find((event) => event.type === 'meta' && event.metaType === 0x58) as Extract<MidiEvent, { type: 'meta' }> | undefined;
  if (!ts || ts.data.length < 2) return '4/4';
  const numerator = ts.data[0];
  const denominator = 2 ** ts.data[1];
  return `${numerator}/${denominator}`;
}

function collectChordOnsets(track: MidiEvent[]): Map<number, number[]> {
  const grouped = new Map<number, number[]>();
  for (const event of track) {
    if (event.type !== 'noteOn') continue;
    const existing = grouped.get(event.tick);
    if (existing) existing.push(event.note);
    else grouped.set(event.tick, [event.note]);
  }
  for (const [tick, notes] of grouped) {
    grouped.set(tick, Array.from(new Set(notes)).sort((a, b) => a - b));
  }
  return grouped;
}

function inferChord(notes: number[]): InferredChord | null {
  const pcs = Array.from(new Set(notes.map((note) => note % 12)));
  const bassPc = notes[0] % 12;
  let best: { score: number; inferred: InferredChord } | null = null;

  for (const rootPc of pcs) {
    const intervals = pcs.map((pc) => (pc - rootPc + 12) % 12);
    for (const template of CHORD_TEMPLATES) {
      const missing = template.intervals.filter((interval) => !intervals.includes(interval)).length;
      if (missing > 0) continue;

      const extras = intervals.filter((interval) => !template.intervals.includes(interval));
      const bassBonus = bassPc === rootPc ? 0.5 : 0;
      const score = template.intervals.length * 3 - extras.length + bassBonus;

      if (!best || score > best.score) {
        best = {
          score,
          inferred: {
            rootPc,
            quality: template.quality,
            normalizedQuality: template.normalizedQuality,
            bassPc: bassPc !== rootPc ? bassPc : undefined,
          },
        };
      }
    }
  }

  return best?.inferred ?? null;
}

function intervalToDegree(interval: number, quality: string, mode: 'major' | 'minor'): string {
  const labels = mode === 'minor' ? MINOR_DEGREE_LABELS : MAJOR_DEGREE_LABELS;
  let label = labels[interval] ?? '?';
  if (['min7', 'min', 'min6', 'min7b5', 'dim7', 'dim'].includes(quality)) {
    if (label.startsWith('b') || label.startsWith('#')) label = label[0] + label.slice(1).toLowerCase();
    else label = label.toLowerCase();
  }
  if (['min7b5', 'dim7', 'dim'].includes(quality) && !label.endsWith('°')) {
    label += '°';
  }
  return label;
}

function checkDiatonic(rootPc: number, quality: string, keyRootPc: number, scale: number[]): boolean {
  const scalePcs = new Set(scale.map((interval) => (keyRootPc + interval) % 12));
  const intervals = QUALITY_INTERVALS[quality] ?? [0, 4, 7];
  return intervals.every((interval) => scalePcs.has((rootPc + interval) % 12));
}

function analyzeHarmony(chords: LeadSheetChord[], keyRootPc: number, mode: 'major' | 'minor', preferSharps: boolean) {
  const primaryScale = mode === 'minor' ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  for (const chord of chords) {
    if (chord.isRepeat || chord.analysis?.rootPc == null || !chord.analysis.normalizedQuality) continue;
    const interval = (chord.analysis.rootPc - keyRootPc + 12) % 12;
    const degree = intervalToDegree(interval, chord.analysis.normalizedQuality, mode);
    let isDiatonic = checkDiatonic(chord.analysis.rootPc, chord.analysis.normalizedQuality, keyRootPc, primaryScale);
    if (!isDiatonic && mode === 'minor') {
      isDiatonic = checkDiatonic(chord.analysis.rootPc, chord.analysis.normalizedQuality, keyRootPc, HARMONIC_MINOR_SCALE)
        || checkDiatonic(chord.analysis.rootPc, chord.analysis.normalizedQuality, keyRootPc, MELODIC_MINOR_SCALE);
    }
    chord.isDiatonic = isDiatonic;
    chord.analysis.degree = degree;
  }

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const analysis = chord.analysis;
    const quality = analysis?.normalizedQuality;
    const rootPc = analysis?.rootPc;
    if (chord.isRepeat || rootPc == null || !quality || !['dom7', 'dom7sus4', 'aug7'].includes(quality)) continue;
    if (chord.isDiatonic && analysis?.degree === 'V') continue;

    const targetRootPc = (rootPc + 5) % 12;
    let targetChordId: string | undefined;
    let resolved = false;

    for (let j = i + 1; j < Math.min(i + 5, chords.length); j++) {
      const candidate = chords[j];
      if (candidate.isRepeat || candidate.analysis?.rootPc == null) continue;
      if (candidate.analysis.rootPc === targetRootPc) {
        targetChordId = candidate.id;
        resolved = j === i + 1;
        break;
      }
    }

    if (!analysis) continue;
    analysis.secondaryDominant = {
      targetRootPc,
      targetKey: noteName(targetRootPc, preferSharps),
      resolved,
      targetChordId,
    };
  }
}

function groupIntoSystems(bars: LeadSheetBar[]): LeadSheetSystem[] {
  const systems: LeadSheetSystem[] = [];
  for (let i = 0; i < bars.length; i += 4) {
    systems.push({ bars: bars.slice(i, i + 4) });
  }
  return systems;
}

export async function loadMidiLeadSheet(
  url: string,
  fallbackId: string,
  meta?: { composer?: string; style?: string },
): Promise<LeadSheetData> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const midi = parseMidi(buffer);
  const metadataTrack = midi.tracks[0] ?? [];
  const chordTrack = midi.tracks.find((track) =>
    track.some((event) => event.type === 'meta' && event.metaType === 0x03 && bytesToString(event.data).includes('Chord track'))
  ) ?? midi.tracks[2] ?? [];

  const title = slugToTitle(fallbackId);
  const timeSignature = parseTimeSignature(metadataTrack);
  const { key, preferSharps, mode, keyRootPc } = parseKeySignature(metadataTrack);

  const measureStarts = Array.from(
    metadataTrack
      .filter((event): event is Extract<MidiEvent, { type: 'meta' }> => event.type === 'meta' && event.metaType === 0x06)
      .map((event) => ({ tick: event.tick, text: bytesToString(event.data) }))
      .filter(({ text }) => text.startsWith('Measure:'))
      .sort((a, b) => a.tick - b.tick)
      .map(({ tick }) => tick)
  );

  const chordOnsets = collectChordOnsets(chordTrack);
  const bars: LeadSheetBar[] = [];
  const flatChords: LeadSheetChord[] = [];

  for (let measureIndex = 0; measureIndex < measureStarts.length; measureIndex++) {
    const start = measureStarts[measureIndex];
    const end = measureStarts[measureIndex + 1] ?? Number.MAX_SAFE_INTEGER;
    const ticks = Array.from(chordOnsets.keys()).filter((tick) => tick >= start && tick < end).sort((a, b) => a - b);

    const chords: LeadSheetChord[] = ticks.map((tick, chordIndex) => {
      const notes = chordOnsets.get(tick) ?? [];
      const inferred = inferChord(notes);
      if (!inferred) {
        return { id: `m${measureIndex + 1}-c${chordIndex + 1}` };
      }

      const rootName = noteName(inferred.rootPc, preferSharps);
      const bassName = inferred.bassPc != null ? noteName(inferred.bassPc, preferSharps) : undefined;
      const root = splitNoteName(rootName);
      const bass = bassName ? splitNoteName(bassName) : undefined;

      return {
        id: `m${measureIndex + 1}-c${chordIndex + 1}`,
        root: root.root,
        accidental: root.accidental,
        quality: inferred.quality,
        bass,
        analysis: {
          rootPc: inferred.rootPc,
          bassPc: inferred.bassPc,
          normalizedQuality: inferred.normalizedQuality,
        },
      };
    });

    bars.push({
      measureNumber: measureIndex + 1,
      chords,
    });
    flatChords.push(...chords);
  }

  analyzeHarmony(flatChords, keyRootPc, mode, preferSharps);

  for (let i = 1; i < bars.length; i++) {
    const current = JSON.stringify(
      bars[i].chords.map((chord) => ({ root: chord.root, accidental: chord.accidental, quality: chord.quality, bass: chord.bass }))
    );
    const previous = JSON.stringify(
      bars[i - 1].chords.map((chord) => ({ root: chord.root, accidental: chord.accidental, quality: chord.quality, bass: chord.bass }))
    );
    if (current !== '[]' && current === previous) {
      bars[i].chords = [{ isRepeat: true, id: `m${i + 1}-repeat` }];
    }
  }

  return {
    id: fallbackId,
    title,
    composer: meta?.composer ?? 'Unknown',
    style: meta?.style ?? 'Swing',
    key,
    timeSignature,
    systems: groupIntoSystems(bars),
  };
}
