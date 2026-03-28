import type { NoteSheetData } from '../../data/sampleMelody';
import Soundfont from 'soundfont-player';

/* ─── pitch helpers ──────────────────────────────────────────────────── */

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function vexToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI[n] ?? 0;
  if (acc === '#') s += 1;
  if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

/* ─── duration helpers ───────────────────────────────────────────────── */

const DUR_BEATS: Record<string, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125,
};

/* ─── chord symbol → MIDI voicing ────────────────────────────────────── */

const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** Map quality suffix → intervals from root (rootless or shell voicings in mid register) */
const VOICINGS: Record<string, number[]> = {
  // Major
  'maj7':  [0, 4, 7, 11],
  'maj6':  [0, 4, 7, 9],
  'maj':   [0, 4, 7],
  '6':     [0, 4, 7, 9],
  // Minor
  'min7':  [0, 3, 7, 10],
  'min6':  [0, 3, 7, 9],
  'min':   [0, 3, 7],
  'minmaj7': [0, 3, 7, 11],
  // Dominant
  'dom7':  [0, 4, 7, 10],
  '7':     [0, 4, 7, 10],
  '9':     [0, 4, 7, 10, 14],
  '13':    [0, 4, 7, 10, 21],
  '7sus':  [0, 5, 7, 10],
  '7alt':  [0, 4, 6, 10],
  '7#9':   [0, 4, 7, 10, 15],
  '7b9':   [0, 4, 7, 10, 13],
  // Half-dim & dim
  'min7b5': [0, 3, 6, 10],
  'dim7':  [0, 3, 6, 9],
  'dim':   [0, 3, 6],
  // Aug
  'aug7':  [0, 4, 8, 10],
  'aug':   [0, 4, 8],
  // Sus
  'sus4':  [0, 5, 7],
  'sus2':  [0, 2, 7],
};

/** Parse a chord symbol like "CΔ7", "D-7", "Bb7#9", "F#-7b5" → root PC + intervals */
function parseChordSymbol(raw: string): { root: number; intervals: number[] } | null {
  const s = raw.trim();
  if (!s) return null;

  // Extract root: 1-2 chars (letter + optional # or b)
  let rootStr = s[0].toUpperCase();
  let rest = s.slice(1);
  if (rest[0] === '#' || rest[0] === 'b') {
    rootStr += rest[0];
    rest = rest.slice(1);
  }
  const root = NOTE_PC[rootStr];
  if (root == null) return null;

  // Normalize quality suffix
  const q = rest
    .replace(/\u0394|Δ|M(?=aj|7)/g, 'maj')   // Δ → maj
    .replace(/^-/, 'min')                       // - → min
    .replace(/^m(?!aj|in)/, 'min')              // m → min (but not maj/min)
    .replace(/^o/, 'dim')                       // o → dim
    .replace(/^ø/, 'min7b5')                    // ø → min7b5
    .replace(/^\+/, 'aug')                      // + → aug
    .replace(/^h/, 'min7b5')                    // h → min7b5 (iReal)
    .replace(/sus$/, 'sus4');

  // Try increasingly shorter prefixes
  for (let len = q.length; len > 0; len--) {
    const candidate = q.slice(0, len);
    if (VOICINGS[candidate]) return { root, intervals: VOICINGS[candidate] };
  }

  // Fallback: major triad
  return { root, intervals: [0, 4, 7] };
}

/** Build MIDI notes for a comping chord in the C3-C5 range */
function chordToMidi(raw: string): number[] {
  // Handle multi-chord measures like "D-7  G7" → use first chord
  const first = raw.split(/\s{2,}/)[0];
  const parsed = parseChordSymbol(first);
  if (!parsed) return [];

  const BASE_OCTAVE = 3; // C3 = MIDI 48
  const base = 12 * (BASE_OCTAVE + 1) + parsed.root; // root in octave 3
  return parsed.intervals.map((iv) => base + iv);
}

/* ─── scheduled note ─────────────────────────────────────────────────── */

interface SchedNote {
  time: number;
  dur: number;
  midi: number;
  measure: number;
  track: 'melody' | 'comp';
}

/* ─── player ─────────────────────────────────────────────────────────── */

export class NotePlayer {
  private ctx: AudioContext | null = null;
  private saxInst: Soundfont.Player | null = null;
  private pianoInst: Soundfont.Player | null = null;
  private loading: Promise<void> | null = null;
  private sched: SchedNote[] = [];
  private origin = 0;
  private elapsed = 0;
  private nextIdx = 0;
  private raf = 0;
  private _playing = false;
  private activeNodes: { stop(): void }[] = [];

  onMeasure?: (idx: number) => void;
  onDone?: () => void;

  get playing() { return this._playing; }

  /* ── public API ──────────────────────────────────────────────────── */

  async play(data: NoteSheetData, tempo: number) {
    if (this._playing) return;
    this.ensureCtx();
    await this.ensureInstruments();
    this.build(data, tempo);
    this._playing = true;
    this.origin = this.ctx!.currentTime - this.elapsed;

    // skip past notes on resume
    this.nextIdx = 0;
    for (let i = 0; i < this.sched.length; i++) {
      if (this.sched[i].time >= this.elapsed - 0.01) { this.nextIdx = i; break; }
    }

    this.tick();
  }

  pause() {
    if (!this._playing || !this.ctx) return;
    this._playing = false;
    cancelAnimationFrame(this.raf);
    this.elapsed = this.ctx.currentTime - this.origin;
    this.killNotes();
  }

  stop() {
    this._playing = false;
    cancelAnimationFrame(this.raf);
    this.elapsed = 0;
    this.nextIdx = 0;
    this.killNotes();
    this.onMeasure?.(-1);
  }

  dispose() {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
    this.saxInst = null;
    this.pianoInst = null;
    this.loading = null;
  }

  /* ── internals ───────────────────────────────────────────────────── */

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private ensureInstruments(): Promise<void> {
    if (this.saxInst && this.pianoInst) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = Promise.all([
      Soundfont.instrument(this.ctx!, 'alto_sax' as Soundfont.InstrumentName, { gain: 2.5 }),
      Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 1.8 }),
    ]).then(([sax, piano]) => {
      this.saxInst = sax;
      this.pianoInst = piano;
    });
    return this.loading;
  }

  private build(data: NoteSheetData, tempo: number) {
    const bs = 60 / tempo; // seconds per beat
    const [tsNum] = (data.timeSignature || '4/4').split('/').map(Number);
    const measSec = tsNum * bs; // fixed measure duration (e.g. 4 beats)
    this.sched = [];

    // Flatten all notes with measure index and timing info
    interface FlatNote { mi: number; note: typeof data.measures[0]['notes'][0]; beats: number }
    const flat: FlatNote[] = [];
    for (let mi = 0; mi < data.measures.length; mi++) {
      for (const n of data.measures[mi].notes) {
        const base = n.duration.replace(/[dr]/g, '');
        let beats = DUR_BEATS[base] ?? 1;
        if (n.dotted) beats *= 1.5;
        if (n.tuplet === 3) beats *= 2 / 3;
        flat.push({ mi, note: n, beats });
      }
    }

    // Schedule melody, merging tied notes
    let fi = 0;
    let mt = 0; // global melody time cursor
    let currentMi = 0;
    while (fi < flat.length) {
      const f = flat[fi];
      // Advance measure time cursor when measure changes
      // Use Math.max to preserve time consumed by cross-bar ties
      if (f.mi !== currentMi) {
        mt = Math.max(mt, f.mi * measSec);
        currentMi = f.mi;
      }

      const isRest = f.note.duration.endsWith('r');
      let totalBeats = f.beats;

      // If this note has a tie, merge duration with following tied notes
      if (!isRest && f.note.tie) {
        let look = fi + 1;
        while (look < flat.length) {
          totalBeats += flat[look].beats;
          // Stop merging after a note that doesn't have tie
          if (!flat[look].note.tie) { look++; break; }
          look++;
        }
        // Schedule the merged note
        const dur = totalBeats * bs;
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc);
          this.sched.push({ time: mt, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.mi, track: 'melody' });
        }
        mt += dur;
        fi = look;
        continue;
      }

      const dur = totalBeats * bs;
      if (!isRest) {
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc);
          this.sched.push({ time: mt, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.mi, track: 'melody' });
        }
      }
      mt += dur;
      fi++;
    }

    // Schedule comping (piano) — beat 1 only
    for (let mi = 0; mi < data.measures.length; mi++) {
      const measure = data.measures[mi];
      if (measure.chord) {
        const midiNotes = chordToMidi(measure.chord);
        if (midiNotes.length > 0) {
          const measStart = mi * measSec;
          const compDur = bs * 0.6;
          for (const midi of midiNotes) {
            this.sched.push({ time: measStart, dur: compDur, midi, measure: mi, track: 'comp' });
          }
        }
      }
    }

    // Sort by time for the scheduling loop
    this.sched.sort((a, b) => a.time - b.time || a.track.localeCompare(b.track));
  }

  private tick = () => {
    if (!this._playing || !this.ctx || !this.saxInst) return;
    const now = this.ctx.currentTime - this.origin;
    const LA = 0.2;

    // schedule upcoming notes
    while (this.nextIdx < this.sched.length) {
      const n = this.sched[this.nextIdx];
      if (n.time > now + LA) break;
      if (n.time >= now - 0.05) {
        const inst = n.track === 'comp' ? this.pianoInst : this.saxInst;
        if (inst) {
          const node = inst.play(String(n.midi), this.origin + n.time, {
            duration: n.dur,
            gain: n.track === 'comp' ? 1.5 : 2.5,
          });
          if (node) this.activeNodes.push(node as unknown as { stop(): void });
        }
      }
      this.nextIdx++;
    }

    // current measure
    let cm = -1;
    for (let i = this.sched.length - 1; i >= 0; i--) {
      if (this.sched[i].time <= now + 0.05) { cm = this.sched[i].measure; break; }
    }
    this.onMeasure?.(cm);

    // done?
    if (this.nextIdx >= this.sched.length) {
      const last = this.sched[this.sched.length - 1];
      if (last && now > last.time + last.dur + 0.3) {
        this.stop();
        this.onDone?.();
        return;
      }
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private killNotes() {
    for (const n of this.activeNodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.activeNodes = [];
  }
}
