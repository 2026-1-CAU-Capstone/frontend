import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
import Soundfont from 'soundfont-player';
import { loadSampledDrumKit } from '../backing/sampledDrumKit';
import { createReverbBus, type ReverbBus } from '../backing/reverb';
import type { TriggerableInstrument } from '../backing/soundfont';
import type { DrumPiece } from '../backing/types';

/* ─── pitch helpers ──────────────────────────────────────────────────── */

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/* Key signature → which note letters are altered */
const KEY_SIG_FLATS  = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

function buildKeySigMap(key: string | undefined): Map<string, 'b' | '#'> {
  const map = new Map<string, 'b' | '#'>();
  if (!key) return map;
  const nFlats = FLAT_KEYS[key];
  if (nFlats) { for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b'); }
  const nSharps = SHARP_KEYS[key];
  if (nSharps) { for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#'); }
  return map;
}

function vexToMidi(key: string, acc?: '#' | 'b' | 'n', keySigAcc?: Map<string, 'b' | '#'>): number {
  const [n, o] = key.split('/');
  let s = SEMI[n] ?? 0;
  if (acc === '#') s += 1;
  else if (acc === 'b') s -= 1;
  else if (acc === 'n') { /* natural — no alteration */ }
  else if (keySigAcc) {
    // No explicit accidental: apply key signature
    const ksAcc = keySigAcc.get(n);
    if (ksAcc === '#') s += 1;
    else if (ksAcc === 'b') s -= 1;
  }
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

/* ─── drum hits ──────────────────────────────────────────────────────── */

/**
 * Per-hit drum event in the schedule. Uses the same DrumPiece vocabulary
 * as the backing engine so we can share the sampled Gretsch kit + reverb bus.
 */
interface DrumHit {
  time: number;
  piece: DrumPiece;
  velocity: number;
}

/* ─── metronome click (woodblock-style) ─────────────────────────────── */

interface MetroHit { time: number; accent: boolean }

function synthMetro(ctx: AudioContext, when: number, accent: boolean, gain: number) {
  const freq = accent ? 1200 : 900;
  const len = 0.03;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * (accent ? 1.0 : 0.6), when);
  env.gain.exponentialRampToValueAtTime(0.001, when + len);
  const g = ctx.createGain();
  g.gain.value = 1;
  osc.connect(env).connect(g).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + len);
  return { stop() { try { osc.stop(); } catch { /* */ } } };
}

/* ─── scheduled note ─────────────────────────────────────────────────── */

interface SchedNote {
  time: number;
  dur: number;
  midi: number;
  measure: number;
  noteIndex: number; // index within measure (-1 for comp)
  track: 'melody' | 'comp';
}

/* ─── expand measures (repeats, volta, brackets, navigation) ────────── */

type ExpandedM = { m: MeasureInfo; origMi: number };

function expandMeasures(srcMeasures: MeasureInfo[]): ExpandedM[] {
  const expandedMeasures: ExpandedM[] = [];

  // Phase 1: expand repeats + volta
  const afterRepeats: ExpandedM[] = [];
  let repeatFromIdx = 0;
  let mi = 0;
  while (mi < srcMeasures.length) {
    const m = srcMeasures[mi];
    if (m.repeatStart) repeatFromIdx = mi;
    afterRepeats.push({ m, origMi: mi });

    if (m.repeatEnd) {
      for (let ri = repeatFromIdx; ri <= mi; ri++) {
        if (srcMeasures[ri].volta === 1) break;
        afterRepeats.push({ m: srcMeasures[ri], origMi: ri });
      }
      let vi = mi + 1;
      while (vi < srcMeasures.length && srcMeasures[vi].volta === 2) {
        afterRepeats.push({ m: srcMeasures[vi], origMi: vi });
        vi++;
      }
      mi = vi;
      continue;
    }
    mi++;
  }

  // Phase 2: expand D.C./D.S./Coda/Fine navigation
  const segnoIdx = afterRepeats.findIndex((e) => e.m.navigation === 'segno');
  const codaIdx = afterRepeats.findIndex((e) => e.m.navigation === 'coda');

  let jumped = false;
  for (let i = 0; i < afterRepeats.length; i++) {
    const entry = afterRepeats[i];
    expandedMeasures.push(entry);
    const nav = entry.m.navigation;
    if (!nav || jumped) continue;

    if (nav === 'fine') break;
    if (nav === 'toCoda' && !jumped) continue;
    if (nav === 'dc' || nav === 'dcAlCoda' || nav === 'dcAlFine' ||
        nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine') {
      jumped = true;
      const jumpTo = (nav === 'ds' || nav === 'dsAlCoda' || nav === 'dsAlFine')
        ? Math.max(0, segnoIdx) : 0;
      const alCoda = nav === 'dcAlCoda' || nav === 'dsAlCoda';
      const alFine = nav === 'dcAlFine' || nav === 'dsAlFine';

      for (let ri = jumpTo; ri < afterRepeats.length; ri++) {
        const re = afterRepeats[ri];
        expandedMeasures.push(re);
        if (alCoda && re.m.navigation === 'toCoda') {
          if (codaIdx >= 0) {
            for (let ci = codaIdx; ci < afterRepeats.length; ci++) {
              expandedMeasures.push(afterRepeats[ci]);
            }
          }
          break;
        }
        if (alFine && re.m.navigation === 'fine') break;
        if (!alCoda && !alFine && (nav === 'dc' || nav === 'ds') && ri === afterRepeats.length - 1) break;
      }
      break;
    }
  }
  return expandedMeasures;
}

/* ─── player ─────────────────────────────────────────────────────────── */

export class NotePlayer {
  private ctx: AudioContext | null = null;
  private melodyInst: Soundfont.Player | null = null;
  private compInst: Soundfont.Player | null = null;
  private drumKit: TriggerableInstrument | null = null;
  private reverb: ReverbBus | null = null;
  private pianoAmp: GainNode | null = null;
  private drumAmp: GainNode | null = null;
  private loading: Promise<void> | null = null;
  private sched: SchedNote[] = [];
  private drumSched: DrumHit[] = [];
  private metroSched: MetroHit[] = [];
  private nextDrumIdx = 0;
  private nextMetroIdx = 0;
  private origin = 0;
  private elapsed = 0;
  private nextIdx = 0;
  private raf = 0;
  private _playing = false;
  private activeNodes: { stop(): void }[] = [];

  /* user-controllable mix */
  drumEnabled = true;
  metroEnabled = false;
  pianoVolume = 1.0;  // 0–1
  drumVolume = 1.0;   // 0–1
  metroVolume = 0.6;  // 0–1

  onMeasure?: (idx: number) => void;
  onNote?: (mi: number, ni: number) => void;
  onDone?: () => void;

  get playing() { return this._playing; }

  /* ── public API ──────────────────────────────────────────────────── */

  async play(data: NoteSheetData, tempo: number) {
    if (this._playing) return;
    await this.ensureCtx();
    await this.ensureInstruments();
    this.build(data, tempo);
    this._playing = true;
    this.origin = this.ctx!.currentTime - this.elapsed;

    // skip past notes on resume
    this.nextIdx = 0;
    for (let i = 0; i < this.sched.length; i++) {
      if (this.sched[i].time >= this.elapsed - 0.01) { this.nextIdx = i; break; }
    }
    this.nextDrumIdx = 0;
    for (let i = 0; i < this.drumSched.length; i++) {
      if (this.drumSched[i].time >= this.elapsed - 0.01) { this.nextDrumIdx = i; break; }
    }
    this.nextMetroIdx = 0;
    for (let i = 0; i < this.metroSched.length; i++) {
      if (this.metroSched[i].time >= this.elapsed - 0.01) { this.nextMetroIdx = i; break; }
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
    this.nextDrumIdx = 0;
    this.nextMetroIdx = 0;
    this.killNotes();
    this.onNote?.(-1, -1);
    this.onMeasure?.(-1);
  }

  dispose() {
    this.stop();
    this.drumKit?.stopAll();
    this.ctx?.close();
    this.ctx = null;
    this.melodyInst = null;
    this.compInst = null;
    this.drumKit = null;
    this.reverb = null;
    this.pianoAmp = null;
    this.drumAmp = null;
    this.loading = null;
  }

  /* ── internals ───────────────────────────────────────────────────── */

  private async ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Shared "small jazz club" reverb bus. Piano + drums route through it;
      // metronome stays dry so it remains a clinical click reference.
      this.reverb = createReverbBus(this.ctx);

      // Piano amp → reverb dry + wet send (light room ambience on the comp/melody).
      this.pianoAmp = this.ctx.createGain();
      this.pianoAmp.gain.value = 1.0;
      this.pianoAmp.connect(this.reverb.dry);
      const pianoSend = this.ctx.createGain();
      pianoSend.gain.value = 0.18;
      this.pianoAmp.connect(pianoSend);
      pianoSend.connect(this.reverb.wet);

      // Drum amp → reverb dry + a stronger wet send so the ride tail lingers.
      this.drumAmp = this.ctx.createGain();
      this.drumAmp.gain.value = 1.0;
      this.drumAmp.connect(this.reverb.dry);
      const drumSend = this.ctx.createGain();
      drumSend.gain.value = 0.42;
      this.drumAmp.connect(drumSend);
      drumSend.connect(this.reverb.wet);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  private ensureInstruments(): Promise<void> {
    if (this.melodyInst && this.compInst && this.drumKit) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = Promise.all([
      Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 2.5 }),
      Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 1.8 }),
      loadSampledDrumKit(this.ctx!, this.drumAmp ?? undefined),
    ]).then(([melody, comp, drums]) => {
      // Route piano through the reverb bus so the comp/melody get a small room.
      // soundfont-player exposes destination via `.connect()`, not via options.
      if (this.pianoAmp) {
        melody.connect(this.pianoAmp);
        comp.connect(this.pianoAmp);
      }
      this.melodyInst = melody;
      this.compInst = comp;
      this.drumKit = drums;
    });
    return this.loading;
  }

  private build(data: NoteSheetData, tempo: number) {
    const bs = 60 / tempo; // seconds per beat
    const [tsNum] = (data.timeSignature || '4/4').split('/').map(Number);
    const measSec = tsNum * bs; // fixed measure duration (e.g. 4 beats)
    this.sched = [];
    const keySig = buildKeySigMap(data.key);

    // Expand repeats/volta/navigation from the very first measure
    const srcMeasures = data.measures;
    const miOffset = 0;
    const expanded = expandMeasures(srcMeasures);

    // Flatten all notes with expanded measure index and timing info
    interface FlatNote { origMi: number; ni: number; note: typeof data.measures[0]['notes'][0]; beats: number; expandIdx: number }
    const flat: FlatNote[] = [];
    for (let ei = 0; ei < expanded.length; ei++) {
      const { m, origMi } = expanded[ei];
      for (let ni = 0; ni < m.notes.length; ni++) {
        const n = m.notes[ni];
        const base = n.duration.replace(/[dr]/g, '');
        let beats = DUR_BEATS[base] ?? 1;
        if (n.dotted) beats *= 1.5;
        if (n.tuplet === 3) beats *= 2 / 3;
        flat.push({ origMi: origMi + miOffset, ni, note: n, beats, expandIdx: ei });
      }
    }

    // Schedule melody, merging tied notes
    let fi = 0;
    let mt = 0; // global melody time cursor
    let currentEi = -1;
    let measCount = 0;
    while (fi < flat.length) {
      const f = flat[fi];
      // Advance measure time cursor when expanded measure changes
      if (f.expandIdx !== currentEi) {
        if (currentEi !== -1) measCount++;
        if (currentEi === -1) measCount = 1; // first measure
        currentEi = f.expandIdx;
      }

      const isRest = f.note.duration.endsWith('r');
      let totalBeats = f.beats;

      // tieContinuation 음표: 앞 tie=true 음이 이미 흡수해서 재생했음.
      // 시간 커서만 진행, 자체 attack은 발생하지 않음. (그러나 만약 무슨
      // 이유로 단독으로 오면 아래 일반 분기에서 재생되도록 함)
      if (f.note.tieContinuation && !f.note.tie) {
        // 직전 음이 tie=true였는지 확인 — 그렇다면 이미 흡수됨.
        const prev = fi > 0 ? flat[fi - 1] : null;
        if (prev?.note.tie) {
          mt += f.beats;
          fi++;
          continue;
        }
        // 단독 tieContinuation (drop된 시작) → 일반 음으로 재생
      }

      // tie=true 음이면 연속된 tie 체인 (tie=true 또는 tieContinuation)만
      // 흡수해서 길이를 합산. 그 다음의 독립적 음(슬러 대상 등)은 절대
      // 흡수하지 않음 — 자기 attack을 가져야 함.
      if (!isRest && f.note.tie) {
        let look = fi + 1;
        while (look < flat.length) {
          const nxt = flat[look].note;
          if (!nxt.tie && !nxt.tieContinuation) break;
          totalBeats += flat[look].beats;
          // tieContinuation but not tie → 체인의 끝, 흡수 후 종료
          if (nxt.tieContinuation && !nxt.tie) { look++; break; }
          look++;
        }
        const dur = totalBeats * bs;
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc, keySig);
          this.sched.push({ time: mt, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.origMi, noteIndex: f.ni, track: 'melody' });
        }
        mt += dur;
        fi = look;
        continue;
      }

      const dur = totalBeats * bs;
      if (!isRest) {
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc, keySig);
          this.sched.push({ time: mt, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.origMi, noteIndex: f.ni, track: 'melody' });
        }
      }
      mt += dur;
      fi++;
    }

    // Schedule comping — one voicing per chord, at the chord's downbeat
    for (let ei = 0; ei < expanded.length; ei++) {
      const { m, origMi } = expanded[ei];
      if (m.chord) {
        const chords = m.chord.split(/\s{2,}/);
        const measStart = ei * measSec;
        const compDur = bs * 0.45;
        const beatOffsets = chords.length === 1 ? [0] : [0, measSec / 2];
        for (let ci = 0; ci < Math.min(chords.length, beatOffsets.length); ci++) {
          const midiNotes = chordToMidi(chords[ci]);
          const t = measStart + beatOffsets[ci];
          for (const midi of midiNotes) {
            this.sched.push({ time: t, dur: compDur, midi, measure: origMi + miOffset, noteIndex: -1, track: 'comp' });
          }
        }
      }
    }

    // Schedule swing drums — classic medium-swing "spang-a-lang" ride pattern.
    //   ride on every beat, plus swung "a" of 2 and "a" of 4 (no upbeats after 1/3)
    //   hi-hat foot chick on beats 2 & 4 (backbeat)
    //   feathered kick on every beat — felt more than heard
    // Velocities are humanized per bar so the ride doesn't sound like a metronome.
    this.drumSched = [];
    const swingOffset = bs * 2 / 3; // triplet-feel "a"
    // Deterministic pseudo-random in [-1, 1] per (bar, slot) so renders are stable.
    const jitter = (bar: number, slot: number) => {
      const x = Math.sin(bar * 12.9898 + slot * 78.233) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    };
    const VEL_JITTER = 0.08;
    const pushHit = (time: number, piece: DrumPiece, baseVel: number, bar: number, slot: number) => {
      const v = baseVel + jitter(bar, slot) * VEL_JITTER;
      this.drumSched.push({
        time,
        piece,
        velocity: Math.max(0.12, Math.min(1.0, v)),
      });
    };
    for (let ei = 0; ei < expanded.length; ei++) {
      const measStart = ei * measSec;
      if (tsNum === 4) {
        // Ride pattern — quarter notes on every beat, alternating accents.
        pushHit(measStart + 0 * bs, 'ride', 0.78, ei, 0);
        pushHit(measStart + 1 * bs, 'ride', 0.64, ei, 1);
        pushHit(measStart + 2 * bs, 'ride', 0.74, ei, 2);
        pushHit(measStart + 3 * bs, 'ride', 0.64, ei, 3);
        // Swung "a" of 2 and "a" of 4 — the iconic spang-a-lang ornaments.
        pushHit(measStart + 1 * bs + swingOffset, 'ride', 0.52, ei, 4);
        pushHit(measStart + 3 * bs + swingOffset, 'ride', 0.52, ei, 5);
        // Hi-hat foot on the backbeat (2 & 4) — a bit louder so it sits under the ride.
        pushHit(measStart + 1 * bs, 'hihat-foot', 0.88, ei, 6);
        pushHit(measStart + 3 * bs, 'hihat-foot', 0.88, ei, 7);
        // Feathered kick on every beat — bebop "four on the floor", very soft.
        pushHit(measStart + 0 * bs, 'kick', 0.34, ei, 8);
        pushHit(measStart + 1 * bs, 'kick', 0.28, ei, 9);
        pushHit(measStart + 2 * bs, 'kick', 0.34, ei, 10);
        pushHit(measStart + 3 * bs, 'kick', 0.28, ei, 11);
      } else {
        // Fallback for non-4/4: keep the legacy "ride on every beat + upbeat" feel
        // since dedicated patterns for other meters don't exist yet.
        for (let beat = 0; beat < tsNum; beat++) {
          const t = measStart + beat * bs;
          pushHit(t, 'ride', 0.72, ei, beat * 4);
          if (beat < tsNum - 1) {
            pushHit(t + swingOffset, 'ride', 0.5, ei, beat * 4 + 1);
          }
          if (beat === 1 || beat === 3) pushHit(t, 'hihat-foot', 0.85, ei, beat * 4 + 2);
          if (beat === 0 || beat === 2) pushHit(t, 'kick', 0.32, ei, beat * 4 + 3);
        }
      }
    }
    this.drumSched.sort((a, b) => a.time - b.time);

    // Schedule metronome clicks — accent on beat 1
    this.metroSched = [];
    for (let ei = 0; ei < expanded.length; ei++) {
      const measStart = ei * measSec;
      for (let beat = 0; beat < tsNum; beat++) {
        this.metroSched.push({ time: measStart + beat * bs, accent: beat === 0 });
      }
    }

    // Sort by time for the scheduling loop
    this.sched.sort((a, b) => a.time - b.time || a.track.localeCompare(b.track));
  }

  private tick = () => {
    if (!this._playing || !this.ctx || !this.melodyInst) return;
    const now = this.ctx.currentTime - this.origin;
    const LA = 0.2;

    // schedule upcoming notes
    while (this.nextIdx < this.sched.length) {
      const n = this.sched[this.nextIdx];
      if (n.time > now + LA) break;
      if (n.time >= now - 0.05) {
        const inst = n.track === 'comp' ? this.compInst : this.melodyInst;
        if (inst) {
          const node = inst.play(String(n.midi), this.origin + n.time, {
            duration: n.dur,
            gain: n.track === 'comp' ? 1.5 * this.pianoVolume : 2.5,
          });
          if (node) this.activeNodes.push(node as unknown as { stop(): void });
        }
      }
      this.nextIdx++;
    }

    // schedule upcoming drum hits — sampled Gretsch kit, routed through the
    // reverb bus so the ride and hi-hat get a club-room tail.
    if (this.drumEnabled && this.drumKit) {
      while (this.nextDrumIdx < this.drumSched.length) {
        const d = this.drumSched[this.nextDrumIdx];
        if (d.time > now + LA) break;
        if (d.time >= now - 0.05) {
          this.drumKit.trigger({
            note: d.piece,
            time: this.origin + d.time,
            duration: 0,
            velocity: d.velocity * this.drumVolume,
          });
        }
        this.nextDrumIdx++;
      }
    }

    // schedule upcoming metronome clicks
    if (this.metroEnabled) {
      while (this.nextMetroIdx < this.metroSched.length) {
        const m = this.metroSched[this.nextMetroIdx];
        if (m.time > now + LA) break;
        if (m.time >= now - 0.05) {
          const node = synthMetro(this.ctx!, this.origin + m.time, m.accent, this.metroVolume);
          this.activeNodes.push(node);
        }
        this.nextMetroIdx++;
      }
    }

    // current measure & note
    let cm = -1;
    let cni = -1;
    for (let i = this.sched.length - 1; i >= 0; i--) {
      if (this.sched[i].time <= now + 0.05) {
        cm = this.sched[i].measure;
        if (this.sched[i].track === 'melody' && this.sched[i].noteIndex >= 0) {
          cni = this.sched[i].noteIndex;
        }
        break;
      }
    }
    this.onMeasure?.(cm);
    if (cm >= 0 && cni >= 0) this.onNote?.(cm, cni);

    // done?
    const drumDone = !this.drumEnabled || this.nextDrumIdx >= this.drumSched.length;
    const metroDone = !this.metroEnabled || this.nextMetroIdx >= this.metroSched.length;
    if (this.nextIdx >= this.sched.length && drumDone && metroDone) {
      const last = this.sched[this.sched.length - 1];
      if (last && now > last.time + last.dur + 0.05) {
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
