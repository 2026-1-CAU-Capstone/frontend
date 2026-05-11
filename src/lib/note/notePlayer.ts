import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
import Soundfont from 'soundfont-player';
import { loadSampledDrumKit } from '../backing/sampledDrumKit';
import { createReverbBus, type ReverbBus } from '../backing/reverb';
import type { TriggerableInstrument } from '../backing/soundfont';
import type { DrumPiece } from '../backing/types';
import { loadDrumLoopPlayer, type DrumLoopPlayer } from '../backing/drumLoopPlayer';
import { DRUM_KIT_PRESETS, type DrumKitId } from '../backing/drumKitPresets';
import {
  getPlayerSettings,
  setPlayerSetting,
  subscribePlayerSettings,
  type BassMode,
  type PlayerSettings,
} from './playerSettings';
import { swungBeats, SWING_RATIO } from './swing';

/* ─── pitch helpers ──────────────────────────────────────────────────── */

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/* NoteInfo.keys 는 letter+accidental 이 곧 절대음정인 컨벤션 (LickInputPage 의
 * 피아노 입력, computeLickFeatures 모두 동일). 키 시그니처는 LickCard 의
 * ♮ 자동 표시에만 쓰이고, 재생 음높이는 letter+acc 만으로 결정한다. */
function vexToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI[n] ?? 0;
  if (acc === '#') s += 1;
  else if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

/* ─── duration helpers ───────────────────────────────────────────────── */

const DUR_BEATS: Record<string, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125,
};

// Shared swing helpers — see src/lib/note/swing.ts for the canonical impl.

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
  track: 'melody' | 'comp' | 'bass';
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

export interface NotePlayerOptions {
  /**
   * Lick-audition mode. Forces a "melody + comp only" mix regardless of the
   * shared mixer settings: drums and bass are silenced, melody is boosted so
   * it sits clearly above the chord pad, and the piano reverb send is maxed
   * to give the comp a lush tail. Used by LickCard / LickRecommend / LickInputPage
   * / LickCreator where the goal is to hear the line over a soft pad.
   */
  lickMode?: boolean;
}

/** Melody gain multiplier applied on top of melodyVolume when lickMode is on. */
const LICK_MODE_MELODY_BOOST = 1.6;

export class NotePlayer {
  private ctx: AudioContext | null = null;
  private melodyInst: Soundfont.Player | null = null;
  private compInst: Soundfont.Player | null = null;    private bassInst: Soundfont.Player | null = null;
    private pianoReverbSend: GainNode | null = null;  private drumKit: TriggerableInstrument | null = null;
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
  /* Per-source-measure start time in seconds (computed during build).
   * Indexed by source measure index; for measures that appear multiple times
   * in the expanded timeline (repeats / D.C.), holds the FIRST occurrence. */
  private measureStartTimes: number[] = [];
  private totalDuration = 0;
  private raf = 0;
  private _playing = false;
  private activeNodes: { stop(): void }[] = [];
  /** Standalone notes scheduled via scheduleStandaloneNote (e.g. anacrusis
   *  pickup notes that need to sound during the count-in, before play() begins).
   *  Tracked so cancelStandaloneNotes() can abort them if the user hits stop
   *  mid-count-in. */
  private standaloneNodes: { stop(): void }[] = [];
  /** Optional measure-index shift applied when invoking onMeasure / onNote
   *  callbacks. Used when play() is handed a measures-sliced copy of the data
   *  (e.g. anacrusis-stripped) but external state (NoteSheet highlights) still
   *  indexes by the ORIGINAL measure positions. */
  private measureOffset = 0;

  /* drum-loop state (kit !== 'synth') */
  private drumLoop: DrumLoopPlayer | null = null;
  private drumLoopUrl: string | null = null;
  private currentBpm = 120;

  /* Last build inputs — kept so applySettings can rebuild the schedule when
   * a setting that affects scheduling (e.g. bassMode) changes mid-playback. */
  private lastData: NoteSheetData | null = null;
  private lastTempo = 120;

  /* user-controllable mix — values mirror the global playerSettings store so any
   * change made through the mixer UI propagates to every active NotePlayer. */
  drumEnabled = true;
  metroEnabled = false;
  melodyVolume = 1.0;
  pianoVolume = 1.0;
  bassVolume = 1.0;
  drumVolume = 1.0;
  metroVolume = 0.6;
  pianoReverb = 0.45;
  bassMode: BassMode = 'two-feel';
  /**
   * Drum source kit. "synth" uses the per-hit Gretsch kit; "brushes"/"sticks"
   * replace per-hit drums with a continuous real-recording loop. Defaults to
   * "synth"; owners can sync this with the global localStorage preference
   * via DRUM_KIT_PRESETS / loadDrumKitPref.
   */
  drumKitId: DrumKitId = 'synth';

  /** Melody swing — always on globally (jazz feel is the project default).
   *  Ratio is the on-beat 8th's share of the beat (0.5 = straight, 0.667 =
   *  strong triplet swing, ~0.62 = medium swing). */
  swingEnabled = true;
  swingRatio = SWING_RATIO;

  private unsubSettings: (() => void) | null = null;
  private readonly lickMode: boolean;

  constructor(opts: NotePlayerOptions = {}) {
    this.lickMode = !!opts.lickMode;
    // Hydrate from the global store and stay in sync with any mixer change.
    this.applySettings(getPlayerSettings());
    this.unsubSettings = subscribePlayerSettings((s) => this.applySettings(s));
  }

  private applySettings(s: PlayerSettings) {
    const drumKitChanged = this.drumKitId !== s.drumKit;
    const bassModeChanged = this.bassMode !== s.bassMode;

    if (this.lickMode) {
      // Lick audition: silence rhythm section, boost melody, max piano reverb.
      // Mixer changes still drive piano/melody base levels (so the user keeps
      // some control) but bass/drums stay muted and reverb stays wide open.
      this.drumEnabled = false;
      this.metroEnabled = false;
      this.melodyVolume = s.melodyVolume * LICK_MODE_MELODY_BOOST;
      this.pianoVolume = s.pianoVolume;
      this.bassVolume = 0;
      this.drumVolume = 0;
      this.metroVolume = 0;
      this.bassMode = s.bassMode;
      this.setPianoReverb(1.0);
    } else {
      this.drumEnabled = s.drumEnabled;
      this.metroEnabled = s.metroEnabled;
      this.melodyVolume = s.melodyVolume;
      this.pianoVolume = s.pianoVolume;
      this.bassVolume = s.bassVolume;
      this.drumVolume = s.drumVolume;
      this.metroVolume = s.metroVolume;
      this.bassMode = s.bassMode;
      this.setPianoReverb(s.pianoReverb);
    }

    if (drumKitChanged) {
      // setDrumKit is async; fire-and-forget — playback transitions are handled internally.
      this.setDrumKit(s.drumKit).catch(() => { /* logged in setDrumKit */ });
    }
    // Bass pattern changed mid-playback → rebuild schedule from current position so
    // the new feel (half / two-feel / four-feel) takes effect on the very next beat.
    if (bassModeChanged && this._playing && this.lastData && this.ctx) {
      this.rebuildScheduleFromElapsed();
    }
  }

  /** Recompute sched/drumSched/metroSched at the current elapsed position so a
   *  scheduling-affecting setting change (bass mode, etc.) takes effect on the
   *  next tick. Cancels already-queued notes (LA = 200ms ahead) so the old
   *  pattern doesn't keep playing after the change. */
  private rebuildScheduleFromElapsed(): void {
    if (!this.lastData || !this.ctx) return;
    this.killNotes();
    this.build(this.lastData, this.lastTempo);

    const t = this.elapsed;
    this.nextIdx = this.sched.length;
    for (let i = 0; i < this.sched.length; i++) {
      if (this.sched[i].time >= t - 0.01) { this.nextIdx = i; break; }
    }
    this.nextDrumIdx = this.drumSched.length;
    for (let i = 0; i < this.drumSched.length; i++) {
      if (this.drumSched[i].time >= t - 0.01) { this.nextDrumIdx = i; break; }
    }
    this.nextMetroIdx = this.metroSched.length;
    for (let i = 0; i < this.metroSched.length; i++) {
      if (this.metroSched[i].time >= t - 0.01) { this.nextMetroIdx = i; break; }
    }
  }

  setPianoReverb(vol: number) {
    this.pianoReverb = vol;
    if (this.pianoReverbSend && this.ctx) {
      // smooth transition to avoid clicks
      this.pianoReverbSend.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }
  }

  onMeasure?: (idx: number) => void;
  onNote?: (mi: number, ni: number) => void;
  onDone?: () => void;
  /** Fires when a non-synth drum kit can't load its audio loop (e.g. the file
   *  is missing from /public). The kit silently falls back to "synth" — callers
   *  can use this to surface a UI warning. Cleared with onDrumKitError(null). */
  onDrumKitError?: (msg: string | null) => void;

  get playing() { return this._playing; }

  /* ── public API ──────────────────────────────────────────────────── */

  /**
   * AudioContext + soundfont 인스트루먼트 + drum 자원을 미리 로드.
   * play() 가 내부적으로 같은 ensure* 들을 호출하지만 모두 idempotent (캐시)
   * 라서, 카운트인 인트로와 병렬로 호출해두면 첫 재생 지연이 사라진다.
   */
  async preload(): Promise<void> {
    await this.ensureCtx();
    await this.ensureInstruments();
    await this.ensureDrumLoop();
  }

  /** Audio-context time (seconds), for callers that need to schedule events
   *  alongside the player's own clock (e.g. anacrusis pickup notes during a
   *  count-in). Returns 0 if the context hasn't been created yet — call
   *  `preload()` first to ensure a stable clock. */
  ctxNow(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Fire a single melody-instrument note at audio time `when` (in this
   *  player's ctx clock). Used for anacrusis pickup notes that must sound
   *  DURING the count-in intro, before the full transport starts in play().
   *  The note is registered so cancelStandaloneNotes() can stop it if the
   *  user aborts the count-in. */
  scheduleStandaloneNote(midi: number, when: number, durationSec: number, gain = 2.5 * this.melodyVolume): void {
    if (!this.melodyInst) return;
    const node = this.melodyInst.play(String(midi), when, { duration: durationSec, gain });
    if (node) this.standaloneNodes.push(node);
  }

  /** Abort any pending scheduleStandaloneNote() events — e.g. on count-in
   *  cancellation. Safe to call repeatedly. */
  cancelStandaloneNotes(): void {
    for (const n of this.standaloneNodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.standaloneNodes = [];
  }

  async play(data: NoteSheetData, tempo: number, opts: { startAt?: number; measureOffset?: number } = {}) {
    if (this._playing) return;
    await this.ensureCtx();
    await this.ensureInstruments();
    await this.ensureDrumLoop();
    this.currentBpm = tempo;
    this.measureOffset = opts.measureOffset ?? 0;
    this.build(data, tempo);
    this._playing = true;
    // Lead the audio origin a little into the future to keep t=0 strictly in
    // the future (some soundfont libs drop / clip past-time events). With a
    // caller-supplied `startAt` (count-in's exact downbeat) we trust the audio
    // clock and use a tight 5 ms margin so the first note lands essentially
    // ON the beat. Without it we keep the wider 50 ms margin that covers
    // post-count-in setTimeout slop.
    const now = this.ctx!.currentTime;
    const SCHED_LEAD = opts.startAt != null ? 0.005 : 0.05;
    const desiredOrigin = opts.startAt != null
      ? Math.max(opts.startAt, now + SCHED_LEAD)
      : now + SCHED_LEAD;
    this.origin = desiredOrigin - this.elapsed;

    // Start the drum loop in sync with playback if a loop kit is selected.
    if (this.drumKitId !== 'synth' && this.drumLoop && this.drumEnabled) {
      this.drumLoop.setGain(this.drumVolume);
      this.drumLoop.start(this.origin + this.elapsed, tempo);
    }

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
    this.drumLoop?.stop();
  }

  stop() {
    this._playing = false;
    cancelAnimationFrame(this.raf);
    this.elapsed = 0;
    this.nextIdx = 0;
    this.nextDrumIdx = 0;
    this.nextMetroIdx = 0;
    this.killNotes();
    this.cancelStandaloneNotes();
    this.drumLoop?.stop();
    this.onNote?.(-1, -1);
    this.onMeasure?.(-1);
  }

  dispose() {
    this.stop();
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.drumKit?.stopAll();
    this.drumLoop?.dispose();
    this.drumLoop = null;
    this.drumLoopUrl = null;
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

  /**
   * Jump playback to the start of the given source-measure index.
   * Works whether the player is currently playing or paused; in both cases the
   * internal time cursor moves so the next tick (or the next play()) picks up
   * from that measure. Out-of-range / never-played measures (no entry in the
   * expanded timeline) are a no-op.
   */
  seekToMeasure(srcMi: number): void {
    if (!this.measureStartTimes.length) return;
    if (srcMi < 0 || srcMi >= this.measureStartTimes.length) return;
    const t = this.measureStartTimes[srcMi];
    if (t < 0) return;

    // Cancel any currently sounding notes so they don't bleed across the jump.
    this.killNotes();
    this.elapsed = t;

    // Fast-forward all schedule cursors to the new position.
    this.nextIdx = this.sched.length;
    for (let i = 0; i < this.sched.length; i++) {
      if (this.sched[i].time >= t - 0.01) { this.nextIdx = i; break; }
    }
    this.nextDrumIdx = this.drumSched.length;
    for (let i = 0; i < this.drumSched.length; i++) {
      if (this.drumSched[i].time >= t - 0.01) { this.nextDrumIdx = i; break; }
    }
    this.nextMetroIdx = this.metroSched.length;
    for (let i = 0; i < this.metroSched.length; i++) {
      if (this.metroSched[i].time >= t - 0.01) { this.nextMetroIdx = i; break; }
    }

    // If currently playing, realign the audio clock so the next tick keeps going.
    if (this._playing && this.ctx) {
      this.origin = this.ctx.currentTime - this.elapsed;
      // Re-anchor the drum loop too — loop kits run on their own absolute clock.
      if (this.drumKitId !== 'synth' && this.drumLoop && this.drumEnabled) {
        this.drumLoop.stop();
        this.drumLoop.setGain(this.drumVolume);
        this.drumLoop.start(this.ctx.currentTime, this.currentBpm);
      }
    }
  }

  /**
   * Switch drum kit. By policy this never hot-swaps during playback — the
   * Brushes/Sticks loops have to be re-time-stretched to match the current
   * BPM, which would create a perceptible gap; instead we fully stop the
   * player so the user explicitly hits play again on the new kit. The loop
   * file is still pre-fetched here so the next play() doesn't wait on IO.
   */
  async setDrumKit(id: DrumKitId): Promise<void> {
    if (this.drumKitId === id) return;
    if (this._playing) {
      this.stop();
      // Notify the UI that playback has ended so its play/stop button resyncs.
      this.onDone?.();
    }
    this.drumKitId = id;
    if (!this.ctx) return;          // applied on next play()
    await this.ensureDrumLoop();
    // Intentional: do not auto-resume. The user must press play.
  }

  /** Load (or unload) the drum loop matching the current kit selection. */
  private async ensureDrumLoop(): Promise<void> {
    if (this.drumKitId === 'synth') {
      // Synth mode doesn't need a loop, but we keep the loaded buffer cached
      // so toggling back to brushes/sticks doesn't re-download. Only stop it.
      this.drumLoop?.stop();
      this.onDrumKitError?.(null);
      return;
    }
    const cfg = DRUM_KIT_PRESETS[this.drumKitId].toConfig();
    if (cfg.drumMode !== 'loop' || !cfg.drumLoop) return;
    if (this.drumLoop && this.drumLoopUrl === cfg.drumLoop.url) {
      this.onDrumKitError?.(null);
      return;
    }
    this.drumLoop?.dispose();
    this.drumLoop = null;
    this.drumLoopUrl = null;
    const failedKitId = this.drumKitId;
    try {
      this.drumLoop = await loadDrumLoopPlayer(
        this.ctx!,
        this.drumAmp ?? this.ctx!.destination,
        cfg.drumLoop,
      );
      this.drumLoopUrl = cfg.drumLoop.url;
      this.onDrumKitError?.(null);
    } catch (err) {
      console.warn('[NotePlayer] drum loop load failed, falling back to synth:', err);
      this.drumKitId = 'synth';
      // Propagate the fallback to the global settings so the mixer UI's selected kit
      // matches what's actually playing (otherwise the user sees "Sticks (live)" selected
      // but synth is playing — confusing).
      setPlayerSetting('drumKit', 'synth');
      const label = DRUM_KIT_PRESETS[failedKitId]?.label ?? failedKitId;
      this.onDrumKitError?.(`"${label}" 오디오 파일을 찾을 수 없어 Synth로 재생합니다.`);
    }
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
      this.pianoReverbSend = pianoSend;
      pianoSend.gain.value = this.pianoReverb;
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
    if (this.melodyInst && this.compInst && this.bassInst && this.drumKit) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = Promise.all([
      Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 2.5 }),
      Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 1.8 }),
      Soundfont.instrument(this.ctx!, 'acoustic_bass' as Soundfont.InstrumentName, { gain: 2.5 }),
      loadSampledDrumKit(this.ctx!, this.drumAmp ?? undefined),
    ]).then(([melody, comp, bass, drums]) => {
      // Route piano through the reverb bus so the comp/melody get a small room.
      // soundfont-player exposes destination via `.connect()`, not via options.
      if (this.pianoAmp) {
        melody.connect(this.pianoAmp);
        comp.connect(this.pianoAmp);
      }
      this.melodyInst = melody;
      this.compInst = comp;
      this.bassInst = bass;
      this.drumKit = drums;
    });
    return this.loading;
  }

  private build(data: NoteSheetData, tempo: number) {
    this.lastData = data;
    this.lastTempo = tempo;
    const bs = 60 / tempo; // seconds per beat
    const [tsNum] = (data.timeSignature || '4/4').split('/').map(Number);
    const measSec = tsNum * bs; // fixed measure duration (e.g. 4 beats)
    this.sched = [];

    // Expand repeats/volta/navigation from the very first measure
    const srcMeasures = data.measures;
    const miOffset = 0;
    const expanded = expandMeasures(srcMeasures);

    // First-occurrence start time per source measure — used by seekToMeasure.
    this.measureStartTimes = new Array(srcMeasures.length).fill(-1);
    for (let ei = 0; ei < expanded.length; ei++) {
      const oi = expanded[ei].origMi;
      if (this.measureStartTimes[oi] < 0) this.measureStartTimes[oi] = ei * measSec;
    }
    this.totalDuration = expanded.length * measSec;

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
        if (n.tuplet && n.tuplet >= 2) {
          // N-tuplet: occupies the time of the largest power of 2 strictly less than N
          const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
          beats *= denom / n.tuplet;
        }
        flat.push({ origMi: origMi + miOffset, ni, note: n, beats, expandIdx: ei });
      }
    }

    // Schedule melody, merging tied notes. The cursor `mt` lives in BEATS so we
    // can apply swing as a non-linear beat→time mapping at schedule time. The
    // straight-time cursor stays linear in beats; only the seconds projection
    // is bent.
    const swingRatio = this.swingEnabled ? this.swingRatio : 0.5;
    const toSec = (beatPos: number) => swungBeats(beatPos, swingRatio) * bs;

    let fi = 0;
    let mt = 0; // global melody time cursor (BEATS)
    let currentEi = -1;
    let measCount = 0;
    while (fi < flat.length) {
      const f = flat[fi];
      // Advance measure time cursor when expanded measure changes
      if (f.expandIdx !== currentEi) {
        if (currentEi !== -1) measCount++;
        if (currentEi === -1) measCount = 1; // first measure
        currentEi = f.expandIdx;
        // 마디 경계 catch-up — 부분 채움 마디에서 mt 가 새 마디보다 뒤쳐졌으면
        // 다음 마디 시작 박자로 끌어올린다. (drum/comp 는 절대 마디 위치라
        // 멜로디만 swing 변환 후 약간 어긋날 수 있으니 catch-up 도 beats 단위.)
        const newMeasStartBeats = f.expandIdx * tsNum;
        if (mt < newMeasStartBeats) mt = newMeasStartBeats;
      }

      const isRest = f.note.duration.endsWith('r');
      let totalBeats = f.beats;

      // tieContinuation 음표: 앞 tie 음이 이미 흡수해서 재생했음 → 절대 다시 치지 않는다.
      // (예전엔 prev.tie + 음정 일치 조건이 모두 맞아야 skip 했지만, 임시표가 한쪽 음에만
      //  붙은 edge case 로 음정 비교가 어긋나면 attack 이 새는 버그가 있었음 — Omnibook
      //  의 fifths=0 데이터에서 같은 음을 두 번 치는 증상의 원인. 플래그를 신뢰하고 무조건 skip.)
      if (f.note.tieContinuation && !f.note.tie && !isRest) {
        mt += f.beats;
        fi++;
        continue;
      }

      // tie chain absorption — when this note has tie=true, swallow every following
      // note that's flagged as a continuation (parser-provided) OR matches in pitch
      // (fallback for hand-authored data without tieContinuation). The chain ends
      // on a rest, on a tie target that itself has tie=false AND no continuation
      // flag, or on a pitch mismatch when there's no continuation flag to override.
      if (!isRest && f.note.tie) {
        const leadMidi = vexToMidi(f.note.keys[0], f.note.accidentals?.[0]);
        let look = fi + 1;
        while (look < flat.length) {
          const nxt = flat[look].note;
          if (nxt.duration.endsWith('r')) break;
          const nxtMidi = vexToMidi(nxt.keys[0], nxt.accidentals?.[0]);
          const continuationFlag = !!nxt.tieContinuation;
          // Trust the explicit continuationFlag over pitch comparison — pitch
          // checks can drift on edge-case accidental encodings (the Omnibook bug).
          if (!continuationFlag && nxtMidi !== leadMidi) break;
          totalBeats += flat[look].beats;
          look++;
          // Continue absorbing only if the just-consumed target itself extends
          // the chain (its own tie=true). Otherwise this was the final target.
          if (!nxt.tie) break;
        }
        const onsetSec = toSec(mt);
        const dur = toSec(mt + totalBeats) - onsetSec;
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc);
          this.sched.push({ time: onsetSec, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.origMi, noteIndex: f.ni, track: 'melody' });
        }
        mt += totalBeats;
        fi = look;
        continue;
      }

      const onsetSec = toSec(mt);
      const dur = toSec(mt + totalBeats) - onsetSec;
      if (!isRest) {
        for (let ki = 0; ki < f.note.keys.length; ki++) {
          const acc = f.note.accidentals?.[ki];
          const midi = vexToMidi(f.note.keys[ki], acc);
          this.sched.push({ time: onsetSec, dur: Math.max(dur * 0.85, 0.04), midi, measure: f.origMi, noteIndex: f.ni, track: 'melody' });
        }
      }
      mt += totalBeats;
      fi++;
    }

    // ── Build a flat chord progression (beat-aligned), then schedule comp + bass
    //    with the same swing mapping as the melody. The bass pattern depends on
    //    this.bassMode:
    //      'half'      → one sustained root for the whole chord
    //      'two-feel'  → root on beat 1, fifth at chord midpoint (no walking)
    //      'four-feel' → walking line: root, 3rd, 5th, chromatic approach to next chord's root
    interface ChordHit {
      startBeat: number;
      beats: number;
      rootMidi: number;
      thirdMidi: number;
      fifthMidi: number;
      voicingMidis: number[];
      measureIdx: number;
    }

    /** Place a pitch class in the bass register (E2..E3). Mirrors lib/backing/bass.ts. */
    const bassRegister = (pc: number): number => {
      const norm = ((pc % 12) + 12) % 12;
      let n = 36 + norm;        // C2 (36) … B2 (47)
      if (n < 40) n += 12;      // below low E → up an octave
      return n;
    };

    const chordList: ChordHit[] = [];
    for (let ei = 0; ei < expanded.length; ei++) {
      const { m, origMi } = expanded[ei];
      if (!m.chord) continue;
      const chordTokens = m.chord.split(/\s{2,}/);
      const measStartBeat = ei * tsNum;
      const slotCount = Math.min(chordTokens.length, 2); // 1 or 2 chords per measure
      const slotBeats = tsNum / slotCount;
      for (let ci = 0; ci < slotCount; ci++) {
        const parsed = parseChordSymbol(chordTokens[ci]);
        if (!parsed) continue;
        const root = parsed.root;
        const thirdInterval = parsed.intervals[1] ?? 4;
        const fifthInterval = parsed.intervals[2] ?? 7;
        const voicing = chordToMidi(chordTokens[ci]);
        chordList.push({
          startBeat: measStartBeat + ci * slotBeats,
          beats: slotBeats,
          rootMidi: bassRegister(root),
          thirdMidi: bassRegister(root + thirdInterval),
          fifthMidi: bassRegister(root + fifthInterval),
          voicingMidis: voicing,
          measureIdx: origMi + miOffset,
        });
      }
    }

    /** Walking pattern: root, 3rd, 5th, then chromatic approach to next chord's root. */
    const walkPattern = (
      beats: number, root: number, third: number, fifth: number, approach: number,
    ): number[] => {
      const b = Math.max(1, Math.round(beats));
      if (b === 1) return [root];
      if (b === 2) return [root, approach];
      if (b === 3) return [root, fifth, approach];
      const out = [root, third, fifth, approach];
      for (let i = 4; i < b; i++) out.push(root);
      return out;
    };

    const bassMode = this.lickMode ? null : this.bassMode;
    const compDurBeats = 0.45; // chord-stab length, in beats
    for (let i = 0; i < chordList.length; i++) {
      const c = chordList[i];
      const startSec = toSec(c.startBeat);
      const endSec   = toSec(c.startBeat + c.beats);

      // ── Bass ──
      if (bassMode) {
        if (bassMode === 'half') {
          this.sched.push({
            time: startSec, dur: (endSec - startSec) * 0.95,
            midi: c.rootMidi, measure: c.measureIdx, noteIndex: -1, track: 'bass',
          });
        } else if (bassMode === 'two-feel') {
          const midBeat = c.startBeat + c.beats / 2;
          const midSec = toSec(midBeat);
          this.sched.push({
            time: startSec, dur: (midSec - startSec) * 0.92,
            midi: c.rootMidi, measure: c.measureIdx, noteIndex: -1, track: 'bass',
          });
          this.sched.push({
            time: midSec, dur: (endSec - midSec) * 0.92,
            midi: c.fifthMidi, measure: c.measureIdx, noteIndex: -1, track: 'bass',
          });
        } else {
          // four-feel walking — chromatic approach to next chord's root if available
          const next = chordList[i + 1];
          const nextRootPc = next ? ((next.rootMidi % 12) + 12) % 12 : ((c.rootMidi % 12) + 12) % 12;
          const approachMidi = bassRegister(nextRootPc - 1);
          const beatsCount = Math.max(1, Math.round(c.beats));
          const pattern = walkPattern(beatsCount, c.rootMidi, c.thirdMidi, c.fifthMidi, approachMidi);
          for (let b = 0; b < beatsCount; b++) {
            const beatStart = c.startBeat + b;
            const beatEnd = c.startBeat + b + 1;
            const t = toSec(beatStart);
            const dur = toSec(beatEnd) - t;
            this.sched.push({
              time: t, dur: dur * 0.92,
              midi: pattern[b], measure: c.measureIdx, noteIndex: -1, track: 'bass',
            });
          }
        }
      }

      // ── Comp (piano voicing on the chord downbeat) ──
      const compEndSec = toSec(c.startBeat + compDurBeats);
      const compDur = compEndSec - startSec;
      for (const midi of c.voicingMidis) {
        this.sched.push({
          time: startSec, dur: compDur, midi,
          measure: c.measureIdx, noteIndex: -1, track: 'comp',
        });
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
          let inst: any = this.melodyInst;
          let vol = 2.5 * this.melodyVolume;
          if (n.track === 'comp') { inst = this.compInst; vol = 1.8 * this.pianoVolume; }
          else if (n.track === 'bass') { inst = this.bassInst; vol = 2.5 * this.bassVolume; }
          
          if (inst) {
            const node = inst.play(String(n.midi), this.origin + n.time, {
              duration: n.dur,
              gain: vol,
            }) as any;
            this.activeNodes.push(node);
          }
        }
      this.nextIdx++;
    }

    // schedule upcoming drum hits — sampled Gretsch kit, routed through the
    // reverb bus so the ride and hi-hat get a club-room tail.
    // In loop kits (brushes/sticks) the continuous loop owns the drum part,
    // so we skip per-hit scheduling and just advance the cursor.
    if (this.drumEnabled && this.drumKit && this.drumKitId === 'synth') {
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
    } else if (this.drumKitId !== 'synth') {
      // Keep nextDrumIdx in sync so the "done?" check stays accurate
      while (this.nextDrumIdx < this.drumSched.length &&
             this.drumSched[this.nextDrumIdx].time <= now + LA) {
        this.nextDrumIdx++;
      }
      // Track drum volume + enabled changes for the running loop.
      if (this.drumLoop) {
        this.drumLoop.setGain(this.drumEnabled ? this.drumVolume : 0);
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
    this.onMeasure?.(cm < 0 ? cm : cm + this.measureOffset);
    if (cm >= 0 && cni >= 0) this.onNote?.(cm + this.measureOffset, cni);

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
