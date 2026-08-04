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

/**
 * Letters whose natural pitch is altered by the key signature.
 * F major (sf=-1) → {'b'}; Bb major (sf=-2) → {'b','e'}; G major (sf=1) → {'f'}.
 * Used to decide when an unaltered note needs an explicit ♮ to override key sig.
 */
function keySignatureLetters(sf: number): Set<string> {
  const FLAT_LETTERS  = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
  const SHARP_LETTERS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
  const out = new Set<string>();
  if (sf < 0) {
    for (let i = 0; i < Math.min(-sf, 7); i++) out.add(FLAT_LETTERS[i]);
  } else {
    for (let i = 0; i < Math.min(sf, 7); i++) out.add(SHARP_LETTERS[i]);
  }
  return out;
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
  { beats: 0.375, vf: '16', dot: true },
  { beats: 0.25, vf: '16', dot: false },
];

/**
 * Snap a beat-duration to the LARGEST grid value that fits within `beats`
 * (round DOWN, not nearest). Onsets are already on a straight-8th grid, so
 * single-note durations (½/1/1½/2/3/4) map exactly; the only values that
 * differ are non-single ones like 2½ — rounding down (→2) keeps the note
 * inside its bar and lets the leftover ½ become a rest, instead of rounding
 * up (→3) and overflowing the measure. Guarantees every bar sums correctly.
 */
function quantise(beats: number): { vf: string; dot: boolean; beats: number } {
  for (const d of DUR_GRID) {
    if (d.beats <= beats + 1e-6) return { vf: d.vf, dot: d.dot, beats: d.beats };
  }
  const smallest = DUR_GRID[DUR_GRID.length - 1];
  return { vf: smallest.vf, dot: smallest.dot, beats: smallest.beats };
}

/** Break a duration (in beats) into standard rest values */
function fillRests(beats: number): NoteInfo[] {
  if (beats < 0.12) return [];
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

function parseKey(track: MidiEvent[]): { key: string; preferSharps: boolean; sf: number } {
  const ev = track.find(e => e.type === 'meta' && e.metaType === 0x59) as Extract<MidiEvent,{type:'meta'}> | undefined;
  if (!ev || ev.data.length < 2) return { key: 'C', preferSharps: true, sf: 0 };
  const sf = (ev.data[0] << 24) >> 24;
  const mi = ev.data[1];
  const key = (mi === 1 ? MIN_KEYS : MAJ_KEYS)[sf + 7] ?? 'C';
  return { key, preferSharps: sf >= 0, sf };
}

function parseTimeSig(track: MidiEvent[]): string {
  const ev = track.find(e => e.type === 'meta' && e.metaType === 0x58) as Extract<MidiEvent,{type:'meta'}> | undefined;
  if (!ev || ev.data.length < 2) return '4/4';
  return `${ev.data[0]}/${2 ** ev.data[1]}`;
}

/** Extract tempo from MIDI meta event 0x51 (Set Tempo). Returns BPM or undefined. */
function parseTempo(track: MidiEvent[]): number | undefined {
  const ev = track.find(e => e.type === 'meta' && e.metaType === 0x51) as Extract<MidiEvent,{type:'meta'}> | undefined;
  if (!ev || ev.data.length < 3) return undefined;
  const uspb = (ev.data[0] << 16) | (ev.data[1] << 8) | ev.data[2];
  return Math.round(60_000_000 / uspb);
}

/* ─── Note event extraction ──────────────────────────────────────────── */

interface NoteEv {
  midi: number;
  start: number;   // tick
  end: number;      // tick
}

/** 양자화된 음 — 3연음 격자에 붙었는지(`trip`)를 함께 들고 다닌다. */
interface QNote extends NoteEv {
  trip?: boolean;
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

/**
 * Extract the top-voice melody from a polyphonic note stream.
 *
 * 1. Simultaneous notes (same onset) → keep only the highest pitch.
 * 2. Skyline: if a note starts while a higher note is still sounding, drop it.
 * 3. Outlier removal: notes >12 semitones below the local pitch context are
 *    likely left-hand / comping artefacts — remove them.
 */
function extractMelodyLine(notes: NoteEv[]): NoteEv[] {
  if (notes.length === 0) return [];

  // Step 1 — collapse simultaneous onsets to highest pitch
  const topped: NoteEv[] = [];
  let i = 0;
  while (i < notes.length) {
    let top = notes[i];
    while (i + 1 < notes.length && Math.abs(notes[i + 1].start - notes[i].start) < 5) {
      i++;
      if (notes[i].midi > top.midi) top = notes[i];
    }
    topped.push(top);
    i++;
  }

  // Step 2 — skyline: drop notes that start while a higher note is still ringing
  const skyline: NoteEv[] = [];
  for (const n of topped) {
    const blocked = skyline.some(s => s.end > n.start + 5 && s.midi > n.midi);
    if (!blocked) skyline.push(n);
  }

  // Step 3 — remove pitch outliers (>octave below local window average)
  const W = 4; // half-window size
  const filtered: NoteEv[] = [];
  for (let j = 0; j < skyline.length; j++) {
    const lo = Math.max(0, j - W);
    const hi = Math.min(skyline.length, j + W + 1);
    let sum = 0, cnt = 0;
    for (let k = lo; k < hi; k++) {
      if (k === j) continue;
      sum += skyline[k].midi; cnt++;
    }
    if (cnt > 0 && skyline[j].midi < sum / cnt - 14) continue; // skip outlier
    filtered.push(skyline[j]);
  }

  return filtered;
}

/**
 * Quantise an expressive performance line onto a musical grid.
 *
 * WjazzD(바이마르 재즈 DB)류 MIDI 는 **연주 실황을 그대로 찍은 것**이지 조판된
 * 악보가 아니다: 온셋이 박에서 밀려 있고, 길이는 아티큘레이션(스타카토·레가토)
 * 을 반영하며, 8분음표는 스윙(길게 ≈0.66 / 짧게 ≈0.33)으로 친다.
 *
 * 예전엔 **직선 8분 한 종류**로만 스냅했다. 그래서 실측상 3연음 91개·16분 48개가
 * 전부 8분으로 뭉개져(같은 곡 MusicXML 과 A/B 비교) 리듬이 통째로 뭉개졌다.
 *
 * 이제 두 격자를 함께 본다:
 *   · 직선 격자 — 16분(¼박) 단위
 *   · 3연음 격자 — ⅓박 단위 (스윙 8분·8분 3연음)
 * 온셋마다 **더 가까운 쪽**을 고르고, 3연음 격자에 붙은 음은 `tuplet: 3` 을 달아
 * 렌더러가 3연음으로 조판하게 한다.
 *
 * 스윙은 '느낌'이지 점8분+16분이 아니므로, 한 박 안에서 3연음 격자에 붙은 음이
 * **딱 2개(0, ⅔)** 면 스윙 8분 쌍으로 보고 직선 8분 2개로 되돌린다 — 재즈 조판
 * 관례. 3개(0, ⅓, ⅔)가 모이면 진짜 3연음으로 남긴다.
 *
 * 앞의 빈 마디는 잘라낸다(10번째 마디에 들어오는 솔로가 9마디 쉼표로 시작하지
 * 않게).
 */
function quantizeToGrid(notes: NoteEv[], tpb: number, numBeats: number): QNote[] {
  if (notes.length === 0) return [];
  const eighth = tpb / 2;                    // 8분  (가장 흔한 단위)
  const trip = tpb / 3;                      // 8분 3연음
  const sixteenth = tpb / 4;                 // 16분 (마지막 수단)
  const barTicks = numBeats * tpb;
  const shift = Math.floor(notes[0].start / barTicks) * barTicks;

  /* 1) 온셋 스냅 — **거친 격자 우선**. 가장 가까운 격자를 그냥 고르면 연주의
   *    미세한 흔들림이 전부 16분으로 떨어져 리듬이 잘게 부서진다(실측: 16분
   *    173개 vs 정답 38개). 8분 → 3연음 → 16분 순으로, 허용 오차 안에 들어오는
   *    **가장 거친** 격자를 쓴다. */
  const TOL_EIGHTH = tpb * 0.15;             // 8분 격자 허용 오차(≈0.15박)
  const TOL_TRIP = tpb * 0.12;
  let prevOn = -1;
  const snapped = notes.map((n) => {
    const t = n.start - shift;
    const e8 = Math.round(t / eighth) * eighth;
    const e3 = Math.round(t / trip) * trip;
    let on: number; let step: number; let useTrip = false;
    if (Math.abs(t - e8) <= TOL_EIGHTH) { on = e8; step = eighth; }
    else if (Math.abs(t - e3) <= TOL_TRIP) { on = e3; step = trip; useTrip = true; }
    else { on = Math.round(t / sixteenth) * sixteenth; step = sixteenth; }
    if (on <= prevOn) on = prevOn + step;     // 두 음이 같은 자리에 겹치지 않게
    prevOn = on;
    const rawLen = n.end - n.start;
    const len = Math.max(step, Math.round(rawLen / step) * step);
    return { midi: n.midi, start: on, len, trip: useTrip };
  });

  /* 2) 스윙 8분 쌍 되돌리기 — 한 박에 3연음 격자 음이 정확히 2개면 직선으로. */
  const beatOf = (tick: number) => Math.floor(tick / tpb);
  const tripPerBeat = new Map<number, number[]>();
  snapped.forEach((n, i) => {
    if (!n.trip) return;
    const b = beatOf(n.start);
    (tripPerBeat.get(b) ?? tripPerBeat.set(b, []).get(b)!).push(i);
  });
  for (const idxs of tripPerBeat.values()) {
    if (idxs.length !== 2) continue;          // 3개면 진짜 3연음 — 그대로 둔다
    for (const i of idxs) {
      const n = snapped[i];
      n.trip = false;
      n.start = Math.round(n.start / eighth) * eighth;       // 0 · ½박 으로
      n.len = Math.max(eighth, Math.round(n.len / eighth) * eighth);
    }
  }

  /* 3) 표기 길이는 다음 음까지의 간격(inter-onset)으로 — 실제 쉼은 쉼표가 되고,
   *    이어 붙은 음은 레가토로 읽힌다. */
  const out: QNote[] = [];
  for (let i = 0; i < snapped.length; i++) {
    const cur = snapped[i];
    const step = cur.trip ? trip : sixteenth;
    const gap = i < snapped.length - 1 ? snapped[i + 1].start - cur.start : cur.len;
    const dur = Math.max(step, Math.min(cur.len, gap));
    out.push({ midi: cur.midi, start: cur.start, end: cur.start + dur, trip: cur.trip });
  }
  return out;
}

/** Score a track for "melody-likeness": prefer monophonic, non-drum, reasonable range. */
function melodyTrack(midi: ParsedMidi): MidiEvent[] {
  let best = midi.tracks[0] ?? [];
  let bestScore = -Infinity;

  // Extract track names for filtering
  const SKIP_NAMES = /bass|drum|cymbal|conga|kick|snare|hi[\s-]?hat|percussion|hit/i;

  for (const tr of midi.tracks) {
    const noteOns = tr.filter(e => e.type === 'noteOn');
    if (noteOns.length === 0) continue;

    // Skip drum channel (channel 9, 0-indexed)
    if (noteOns.every(e => e.type === 'noteOn' && e.channel === 9)) continue;

    // Skip tracks named as bass/drums (only when other tracks exist)
    const nameMeta = tr.find(e => e.type === 'meta' && e.metaType === 0x03) as Extract<MidiEvent,{type:'meta'}> | undefined;
    const trackName = nameMeta ? new TextDecoder().decode(nameMeta.data).trim() : '';
    if (trackName && SKIP_NAMES.test(trackName) && midi.tracks.length > 2) continue;

    // Count simultaneous notes (polyphony) — group by tick
    const byTick = new Map<number, number>();
    for (const e of noteOns) { byTick.set(e.tick, (byTick.get(e.tick) ?? 0) + 1); }
    const avgPoly = [...byTick.values()].reduce((a, b) => a + b, 0) / byTick.size;

    // Average pitch — melody tends to be in a mid-high range (60-84)
    const avgPitch = noteOns.reduce((s, e) => s + (e.type === 'noteOn' ? e.note : 0), 0) / noteOns.length;
    const pitchScore = avgPitch >= 55 && avgPitch <= 90 ? 20 : avgPitch < 50 ? -20 : 0;

    // Mono tracks score high, polyphonic tracks score low
    const monoScore = 20 / avgPoly;

    // Some note count is needed but don't favor the most dense track
    const countScore = Math.min(noteOns.length, 200) / 20;

    const score = monoScore + pitchScore + countScore;
    if (score > bestScore) { bestScore = score; best = tr; }
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
  return parseMidiArrayBuffer(await res.arrayBuffer(), title, composer);
}

/** SMF **버퍼**를 파싱한다 — 파일 업로드 경로용(fetch 없음). 멜로디 트랙 자동
 *  선별 → 스카이라인 단선율 추출 → 8분 그리드 양자화까지 동일 파이프라인. */
export function parseMidiArrayBuffer(
  buf: ArrayBuffer,
  title: string,
  composer: string,
): NoteSheetData {
  const midi = parseMidi(buf);

  // Metadata may live in track 0 or the melody track
  const meta = midi.tracks[0] ?? [];
  const melody = melodyTrack(midi);
  const { key, preferSharps, sf } = parseKey(meta.length ? meta : melody);
  const keySigLetters = keySignatureLetters(sf);
  const timeSig = parseTimeSig(meta.length ? meta : melody);
  const tempo = parseTempo(meta.length ? meta : melody);

  const [numBeats] = timeSig.split('/').map(Number);
  const tpb = midi.division;                      // ticks per beat
  const tpm = tpb * numBeats;                     // ticks per measure

  const noteEvents = extractNotes(melody);
  if (!noteEvents.length) return { title, composer, key, timeSignature: timeSig, tempo, measures: [] };

  // Extract single melody line (skyline top-voice extraction), then quantise
  // the expressive performance onto a straight-8th grid (swing → straight 8ths,
  // articulation jitter removed, leading empty bars trimmed). Without this the
  // raw note-off durations render as dotted-16th clutter.
  const melodyNotes = quantizeToGrid(extractMelodyLine(noteEvents), tpb, numBeats);

  const lastTick = Math.max(...melodyNotes.map(n => n.end));
  const totalMeasures = Math.max(1, Math.ceil(lastTick / tpm));

  const measures: MeasureInfo[] = [];

  for (let m = 0; m < totalMeasures; m++) {
    const mStart = m * tpm;
    const mEnd = mStart + tpm;

    const mNotes = melodyNotes.filter(n => n.start >= mStart && n.start < mEnd);
    const notes: NoteInfo[] = [];
    let cur = mStart;

    for (const ev of mNotes) {
      const onset = ev.start;

      // Rest before this note
      if (onset > cur + tpb * 0.05) {
        const gapBeats = (onset - cur) / tpb;
        notes.push(...fillRests(gapBeats));
      }

      // Duration clamped to barline
      const rawBeats = Math.min(ev.end - onset, mEnd - onset) / tpb;
      /* 3연음 격자 음은 실제 길이가 ⅓·⅔박이라 직선 격자(quantise)로는 표기할 수
       * 없다 — 표기는 8분(또는 4분)으로 하고 tuplet:3 을 달아 렌더러·플레이어가
       * 3분할로 해석하게 한다. */
      const q = ev.trip
        ? (rawBeats >= 0.55
            ? { vf: 'q', dot: false, beats: 2 / 3 }
            : { vf: '8', dot: false, beats: 1 / 3 })
        : quantise(rawBeats);

      const { key: vk, accidental } = midiToVex(ev.midi, preferSharps);
      // Convention: keys[0] + accidentals[0] together encode the absolute pitch.
      // The player's vexToMidi does consult the key signature when no explicit
      // accidental is given, but we still always emit an explicit accidental so
      // playback doesn't depend on the key field being correct. The NoteSheet
      // renderer dedupes it against the key sig so we don't get redundant
      // glyphs. When a note's letter is altered by the key sig but the note is
      // the natural, emit 'n' so player and renderer agree on the override.
      const ni: NoteInfo = { keys: [vk], duration: q.vf, dotted: q.dot || undefined };
      if (ev.trip) { ni.tuplet = 3; ni.tupletNormal = 2; }
      const letter = vk.split('/')[0];
      if (accidental) {
        ni.accidentals = { 0: accidental };
      } else if (keySigLetters.has(letter)) {
        ni.accidentals = { 0: 'n' };
      }
      notes.push(ni);

      // Advance cursor using actual onset + quantised duration (stay in tick space)
      cur = onset + q.beats * tpb;
    }

    // Trailing rest
    if (cur < mEnd - tpb * 0.05) {
      notes.push(...fillRests((mEnd - cur) / tpb));
    }

    if (notes.length === 0) {
      notes.push({ keys: ['b/4'], duration: 'wr' });
    }

    measures.push({ notes });
  }

  return { title, composer, key, timeSignature: timeSig, tempo, measures };
}
