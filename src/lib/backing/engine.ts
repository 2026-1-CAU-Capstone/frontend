import type { BackingEvent, Bar, Chart, Chord, FeelId, MidiNote, StyleId } from "./types";
import { renderDrumBar } from "./drums";
import { walkChord, twoFeelBass, funkBass, type WalkingBassBeat } from "./bass";
import { getSwingRatio } from "../note/swing";
import { voiceChord } from "./voicing";
import { PSBASE_CH0_PATTERN } from "./jazz-piano-pattern";
import { fitChordPhraseToChord } from "../yamaha-sty/fit-phrase";
import { chordTypeFromQuality } from "../yamaha-sty/quality-map";
import { ChordSymbol } from "../jazz-harmony";
import type { MelodyNote } from "./adapters/noteSheetToChart";

// Pre-resolve the source ChordType once (cached) — PSBASE_CH0_PATTERN was
// recorded against C Maj7 ("M7").
const PSBASE_SRC_CHORD_TYPE = ChordSymbol.parse('C' + PSBASE_CH0_PATTERN.sourceChordTypeName).chordType;
const PSBASE_PPQ = PSBASE_CH0_PATTERN.ticksPerQuarter;

/* ─────────────────────────────────────────────────────────────────────────
 * Engine — turns a Chart into a timed stream of BackingEvents.
 *
 * Phase 1 (current):
 *   - Walk sections/bars in order (no repeat expansion yet)
 *   - Medium-swing only; feel & style overrides ignored
 *   - Piano comping:
 *       * rhythm pattern pool with per-bar rotation (less mechanical)
 *       * voice-leading state (prev voicing → minimal-motion next voicing)
 *       * velocity jitter to humanize
 *   - Walking bass: delegated to bass.ts
 *   - Drums: delegated to drums.ts, then lightly humanized
 *
 * Later phases add figures, instruction handling, feel modifiers, etc.
 * ──────────────────────────────────────────────────────────────────────── */

export interface RenderOptions {
  /** Effective bpm after config override. */
  bpm: number;
  /** Effective style after config override. */
  style?: StyleId;
  /** Effective feel override. When omitted, falls back to `chart.defaultFeel`
   *  via `resolveFeel()`. Threading this through is what makes
   *  `BackingPlayer.setConfig({ feel })` actually take effect. */
  feel?: FeelId;
  /** Bass scheduling override (mixer "베이스 모드"). See BackingConfig.bassMode. */
  bassMode?: "half" | "two-feel" | "four-feel";
  /** Optional melody track (from `noteSheetToChart`'s `extractMelody`).
   *  Beat offsets are absolute from the start of the chart. */
  melody?: MelodyNote[];
  /** When false, suppress melody emission even if `melody` is provided.
   *  Defaults to `true` whenever `melody` is set. */
  playMelody?: boolean;
  /** Force a steady piano comp on beats 1 & 3 of every chord, bypassing the
   *  groove-based comping patterns. Used by the Editor's practice playback so
   *  the soloist hears the changes on a plain 1-&-3 pulse. */
  pianoComp1And3?: boolean;
  /** When false, emit **no piano comping at all** (default true).
   *
   *  양손 악보용이다. 그랜드스태프 악보의 왼손이 이미 **적힌 피아노 반주**이므로,
   *  엔진이 코드에서 만들어 낸 컴핑을 그 위에 얹으면 두 개의 다른 반주가 겹친다
   *  (실측: 왼손 보이싱과 엔진 보이싱이 서로 다른 전위를 쳐서 탁해진다).
   *  볼륨 0 으로 죽이지 않고 **이벤트를 만들지 않는다** — 볼륨은 믹서의
   *  피아노 슬라이더와 같은 값이라, 0 으로 덮으면 사용자가 되돌릴 수 없다. */
  pianoComp?: boolean;
  /** 루프 어웨어 어프로치 — 재생이 루프될 때 차트 마지막 코드의 베이스
   *  어프로치 톤이 첫 코드를 타겟해 코러스 이음새가 자연스럽게 이어진다.
   *  (기존: next=null → root 폴백 = "정지감". Player 연구 B5 검증) */
  loopSeam?: boolean;
}

/* ─── comping rhythm patterns ────────────────────────────────────────── */

/**
 * Each pattern is a list of (beatOffset, velocity) pairs inside a 4-beat
 * chord duration. Velocities are 0..1 and will be further jittered.
 *
 * These follow classic jazz piano comping — not just 2 & 4, but also
 * "and of 1 → 4", anticipations, and sparser pushes.
 */
/**
 * Comping rhythm patterns — kept deliberately simple so multiple chords
 * in flight don't pile up into a muddy wash. Each pattern is 2 hits
 * maximum over a 4-beat chord. Choose one per chord via selectCompingPattern.
 */
// 2-hit pool (existing patterns, preserved verbatim).
const COMPING_PATTERNS_2HIT: Array<Array<[number, number]>> = [
  // Classic 2 & 4
  [[1.0, 0.62], [3.0, 0.58]],
  // 2 + "and of 3" push
  [[1.0, 0.6], [2.5, 0.55]],
  // "And of 1" + 3
  [[0.5, 0.58], [2.0, 0.58]],
  // Anticipation on "and of 4" only
  [[1.0, 0.6], [3.5, 0.6]],
  // Downbeat + "and of 2"
  [[0.0, 0.55], [1.5, 0.6]],
];

// PATCH #8 — 3-hit pool. iReal Medium Swing averages 3.0–3.4 hits/bar; the
// engine previously capped at 2 hits/bar. Routing in selectCompingPattern
// picks from this pool ~60% of the time.
const COMPING_PATTERNS_3HIT: Array<Array<[number, number]>> = [
  [[0.0, 0.55], [1.5, 0.58], [3.5, 0.60]], // 1 + 2& + 4&
  [[0.0, 0.55], [2.5, 0.50], [3.5, 0.62]], // 1 + 3& + 4&
  [[0.5, 0.50], [2.0, 0.55], [3.5, 0.62]], // 1& + 3 + 4&
];

// 1-hit fallback pool — single downbeat-style stab. ~10% routing weight.
const COMPING_PATTERNS_1HIT: Array<Array<[number, number]>> = [
  [[0.0, 0.55]],
  [[1.5, 0.60]],
  [[3.5, 0.60]],
];

const COMPING_PATTERNS_2BEAT: Array<Array<[number, number]>> = [
  [[0.5, 0.58]],
  [[0.0, 0.58]],
  [[1.0, 0.6]],
];

/**
 * Bossa Nova piano comping — sparser, syncopated, no swing.
 * Each pattern is over a 4-beat chord. Sustain is longer so the chord rings.
 */
const COMPING_PATTERNS_BOSSA_4BEAT: Array<Array<[number, number]>> = [
  // Classic bossa: 1, "and of 2", 4
  [[0.0, 0.62], [1.5, 0.68], [3.0, 0.6]],
  // Partido alto variant: "and of 1", 3, "and of 4"
  [[0.5, 0.66], [2.0, 0.6], [3.5, 0.7]],
];

const COMPING_PATTERNS_BOSSA_2BEAT: Array<Array<[number, number]>> = [
  [[0.0, 0.62], [1.0, 0.6]],
  [[0.5, 0.66]],
];

/**
 * Bossa Nova bass — 2-feel, NOT walking. Root on beat 1, fifth on beat 3
 * for 4-beat chords; just the root for shorter chords. This is the surdo-
 * style bass line that gives bossa its characteristic "boom-boom" pulse.
 */
function bossaBass(current: Chord, beats: number): WalkingBassBeat[] {
  if (beats <= 0) return [];
  const rootPc = current.bass ?? current.root;
  const fifthPc = (current.root + 7) % 12;
  const rootMidi = bossaBassNote(rootPc);
  const fifthMidi = bossaBassNote(fifthPc);

  if (beats === 1) return [{ beatOffset: 0, midi: rootMidi }];
  if (beats === 2) return [{ beatOffset: 0, midi: rootMidi }, { beatOffset: 1, midi: fifthMidi }];
  if (beats === 3) {
    return [
      { beatOffset: 0, midi: rootMidi },
      { beatOffset: 2, midi: fifthMidi },
    ];
  }
  // 4+ beats: root on 1, fifth on 3.
  const out = [
    { beatOffset: 0, midi: rootMidi },
    { beatOffset: 2, midi: fifthMidi },
  ];
  return out;
}

function bossaBassNote(pc: number): MidiNote {
  const normalized = ((pc % 12) + 12) % 12;
  let n = 36 + normalized;
  if (n < 40) n += 12;
  return n;
}

/** Deterministic "random" in [0,1) from a seed int. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* ─── style → feel mapping ────────────────────────────────────────────── */

/**
 * Resolve a FeelId for drum/piano routing from a coarser StyleId. Chart-
 * level `defaultFeel` is honoured for the swing family (so an "up-swing"
 * style + "ballad-swing" feel override picks ballad). For Latin styles we
 * always force the matching latin feel regardless of override.
 */
function resolveFeel(style: StyleId, defaultFeel: FeelId): FeelId {
  switch (style) {
    case "bossa":
      return "bossa";
    case "samba":
      // Samba has its own surdo+caixa groove — distinct from the generic latin.
      return "samba";
    case "latin":
    case "mambo":
    case "songo":
      return "latin";
    case "cha-cha":
      return "cha-cha";
    case "afro-cuban-68":
      return "afro-cuban";
    case "latin-swing":
      return "latin-swing";
    case "ballad-swing":
    case "slow-swing":
      return "ballad-swing";
    case "up-swing":
      return "up-tempo-swing";
    case "new-orleans":
      return "new-orleans-swing";
    case "bebop":
      return "bebop-swing";
    case "shuffle":
      return "shuffle-blues";
    case "funk":
      // Funk has its own straight-16 backbeat — distinct from plain even-8ths.
      return "funk";
    case "rock":
    case "pop-ballad":
      return "even-8ths";
    case "waltz-jazz":
      // 3/4 swung waltz (own renderer; falls back to swing off-3 meter).
      return "waltz";
    case "medium-swing":
    case "rubato":
    case "none":
      return defaultFeel ?? "medium-swing";
    default:
      return defaultFeel ?? "medium-swing";
  }
}

/* ─── piano roll patterns (PATCH #6) ──────────────────────────────────── */

/**
 * Roll spread libraries — each entry is a tick offset (PPQ=480) per voicing
 * note. Mediums-swing pianists "roll" chords from low to high so the voicing
 * doesn't arrive as a block. Ballads roll even more slowly; bossa/latin
 * keep the chord blocked.
 */
const ROLL_PPQ = 480;
const ROLL_PATTERNS_SWING: number[][] = [
  [0, 0, 4, 6, 8],
  [0, 2, 8, 9, 13],
  [0, 4, 8, 10, 13],
  [0, 6, 9, 13],
  [0, 0, 2, 5, 11],
  [0, 3, 7, 11, 13],
  [0, 4, 7, 10, 12],
];

/**
 * Build a per-voice tick offset list for a chord-roll spread. Choice is
 * driven by the seeded `randDraw` so playback is deterministic.
 */
function pickRoll(feel: FeelId, voicingLen: number, randDraw: number): number[] {
  if (feel === "ballad-swing") {
    // 발라드는 진짜 느린 롤 — 노트당 16틱(480PPQ, 70bpm 기준 ≈29ms). 예전
    // "1틱/노트"(≈1ms)는 주석과 달리 사실상 블록코드였다. (Player 연구 B1 검증)
    return Array.from({ length: voicingLen }, (_, i) => i * 16);
  }
  if (
    feel === "even-8ths" ||
    feel === "bossa" ||
    feel === "latin" ||
    feel === "samba" ||
    feel === "cha-cha" ||
    feel === "afro-cuban" ||
    feel === "funk" ||
    feel === "new-orleans-swing"
  ) {
    // Block chord — no spread.
    return new Array(voicingLen).fill(0);
  }
  const pat =
    ROLL_PATTERNS_SWING[Math.floor(randDraw * ROLL_PATTERNS_SWING.length) % ROLL_PATTERNS_SWING.length];
  return Array.from({ length: voicingLen }, (_, i) => pat[Math.min(i, pat.length - 1)]);
}

/** Convert a roll tick offset → seconds at the current tempo. */
function rollTickToSec(tickOffset: number, secPerBeat: number): number {
  return (tickOffset / ROLL_PPQ) * secPerBeat;
}

/* ─── main render ────────────────────────────────────────────────────── */

/**
 * The 8th-note swing ratio the rhythm section will use for this chart+config —
 * exposed so melody callers (GlobalPlayer's sheet/lick/solo path) can pre-swing
 * the lead line to the IDENTICAL feel, locking it to the comp/bass/drums.
 * Mirrors the `style → resolveFeel → getSwingRatio` chain inside renderChart().
 */
export function melodySwingRatio(
  chart: Chart,
  opts: { bpm: number; style?: StyleId; feel?: FeelId },
): number {
  const style = opts.style ?? chart.defaultStyle;
  const feel = resolveFeel(style, opts.feel ?? chart.defaultFeel);
  return getSwingRatio(opts.bpm, feel);
}

export function renderChart(chart: Chart, opts: RenderOptions): BackingEvent[] {
  // bpm 입구 가드 — 0/NaN/Infinity가 들어오면 모든 이벤트 시간이 Infinity로
  // 무너진다 (조용한 무음). 120으로 폴백하고 경고만 남긴다.
  const bpm = Number.isFinite(opts.bpm) && opts.bpm > 0 ? opts.bpm : (console.warn('[engine] invalid bpm', opts.bpm), 120);
  const secPerBeat = 60 / bpm;
  const beatsPerBar = chart.timeSig[0];
  const secPerBar = beatsPerBar * secPerBeat;
  const style = opts.style ?? chart.defaultStyle;
  // `opts.feel` overrides the chart-default feel when provided so
  // `BackingPlayer.setConfig({ feel })` actually reaches piano/drum routing.
  const feel = resolveFeel(style, opts.feel ?? chart.defaultFeel);
  // Bossa AND the latin family share the "straight" rhythm-section treatment:
  // 2-feel bass + blocked/legacy piano comping (the per-feel comping helpers
  // below already special-case feel==='latin' the same way). Keyed off `feel`
  // so samba/mambo/songo/cha-cha/afro-cuban all route here, not just bossa.
  const isBossa = feel === "bossa" || feel === "latin" || feel === "samba" || feel === "cha-cha" || feel === "afro-cuban";

  // Piano comp routing: the psBase pattern has SWING baked into its recorded
  // MIDI ticks, so it must only drive swing feels. Straight feels (funk, rock/
  // even-8ths) need the legacy voicing comp, whose timing is computed from raw
  // beat offsets (no swing projection) — otherwise a swung piano floats over a
  // straight drum/bass groove. Bossa-family already routes to legacy.
  const usesLegacyComp =
    isBossa ||
    feel === "even-8ths" ||
    feel === "funk" ||
    feel === "straight-8" ||
    feel === "straight-16";

  // Flatten all bars across sections (no repeat expansion yet).
  const flatBars: Bar[] = [];
  for (const sec of chart.sections) flatBars.push(...sec.bars);

  const events: BackingEvent[] = [];
  // Beat position into the psBase piano pattern (length = sizeInBeats).
  // Advances by chord.beats per chord so the comping rhythm flows naturally
  // across the song instead of restarting every bar.
  let psBaseCycleBeats = 0;
  // PATCH #9 — running previous-voicing tracker for the legacy piano path
  // (bossa/latin). Carries across bars so voice leading actually works.
  let prevVoicing: MidiNote[] = [];
  // Last bass MIDI note, threaded across chords so the walking line keeps its
  // register continuity (each note placed in the octave nearest this one).
  let prevBassMidi: MidiNote | null = null;
  const swingRatio = getSwingRatio(bpm, feel);

  for (let bi = 0; bi < flatBars.length; bi++) {
    const bar = flatBars[bi];
    const barStart = bi * secPerBar;

    // Drums — per-bar pattern dispatched on FeelId, with light humanization.
    // Per-bar `bar.feel` override wins over the chart-wide feel so a bar
    // can switch (e.g. half-time tag).
    const barFeel = bar.feel ?? feel;
    const drumEvents = renderDrumBar(
      {
        secPerBeat,
        barStart,
        beatsInBar: beatsPerBar,
        barIndex: bi,
      },
      barFeel,
      bpm,
    );
    humanizeDrums(drumEvents, secPerBeat, bi);
    events.push(...drumEvents);

    // Chord-level events (bass + piano comping)
    let beatCursor = 0;
    for (let ci = 0; ci < bar.chords.length; ci++) {
      const chord = bar.chords[ci];
      // B5 — 루프 이음새: 마지막 코드는 next 가 없어 어프로치가 root 로
      // 퇴화한다. loopSeam(플레이어가 루프 예정일 때) 이면 첫 코드를 타겟.
      let next = nextChord(bar, ci, flatBars, bi);
      if (next === null && opts.loopSeam) {
        next = flatBars[0]?.chords[0] ?? null;
      }

      // Bass — bossa/latin: 2-feel surdo; ballad: 2-feel half notes; swing:
      // walking. Seed = stable hash of bar + chord index so the same chart
      // renders the same line every time (no autoplay drift). `prevBassMidi`
      // threads register continuity through the walking/two-feel generators.
      const bassSeed = bi * 1009 + ci * 17;
      // Bass routing. Latin (bossa/samba) and funk keep their dedicated bass.
      // For swing feels, the mixer "베이스 모드"(opts.bassMode) overrides the
      // feel default: four-feel→walking, two-feel/half→lighter root/fifth.
      // When unset, ballad walks 2-feel and everything else walks.
      const walk = () => walkChord(chord, next, chord.beats, bassSeed, prevBassMidi, swingRatio);
      const two = () => twoFeelBass(chord, chord.beats, prevBassMidi, bassSeed);
      const swingBass = (): WalkingBassBeat[] =>
        opts.bassMode === "four-feel" ? walk()
        : opts.bassMode === "two-feel" || opts.bassMode === "half" ? two()
        : feel === "ballad-swing" ? two()
        : walk();
      const bassNotes: WalkingBassBeat[] = isBossa
        ? bossaBass(chord, chord.beats)
        : feel === "funk"
          ? funkBass(chord, next, chord.beats, prevBassMidi)
          : swingBass();
      for (const bn of bassNotes) {
        const beatInBar = beatCursor + bn.beatOffset;
        // Walking bass: iReal Pro accents the BACKBEAT — beats 2 & 4 land
        // around vel 0.88 while beats 1 & 3 sit softer (~0.79). Swung-8th
        // ornaments (`accent`) push harder (~0.95). Bossa keeps its surdo
        // accent on beat 1.
        const onBackbeat = Math.round(beatInBar) % 2 === 1;
        const baseVel = isBossa
          ? (bn.beatOffset === 0 ? 0.9 : 0.82)
          : bn.accent
            ? 0.95
            : (onBackbeat ? 0.88 : 0.79);
        events.push({
          kind: "note",
          instrument: "bass",
          midi: bn.midi,
          time: barStart + beatInBar * secPerBeat,
          // Per-note length override (2-feel half notes, short ornaments) wins;
          // otherwise walking is legato (~0.96 beat) and bossa rings longer.
          duration: secPerBeat * (bn.durBeats ?? (isBossa ? 1.6 : 0.96)),
          velocity: baseVel + (rand(bi * 31 + ci * 7 + bn.beatOffset) - 0.5) * 0.08,
          bar: bi,
        });
      }
      // Carry the last on-beat (integer-offset) bass note forward for register
      // continuity — skip fractional ornament notes.
      for (let k = bassNotes.length - 1; k >= 0; k--) {
        if (Number.isInteger(bassNotes[k].beatOffset)) { prevBassMidi = bassNotes[k].midi; break; }
      }

      // Piano comping — use the pre-recorded psBase ch 0 pattern instead
      // of generating from scratch. The pattern is a Yamaha professional
      // pianist's 8-bar comping recorded against CMaj7; we slice the
      // current chord's beats out of it and re-fit to the chord via
      // fitChordPhraseToChord. Bossa still uses the legacy voicing-based
      // path because the psBase pattern is swing-specific.
      if (opts.pianoComp === false) {
        /* 양손 악보 — 왼손이 적힌 반주다. 컴핑을 만들지 않는다.
         * prevVoicing 도 건드리지 않는다(다음 마디 보이싱 연결에 쓰이는 상태). */
      } else if (opts.pianoComp1And3) {
        // Editor practice mode: a plain block-chord comp on beats 1 & 3,
        // overriding whatever the feel's groove would do.
        prevVoicing = renderOneAndThreeComping(
          chord, beatCursor, barStart, secPerBeat, bi, ci, events, prevVoicing,
        );
      } else if (usesLegacyComp) {
        prevVoicing = renderLegacyPianoComping(
          chord, beatCursor, bi, ci, barStart, secPerBeat, barFeel, events, prevVoicing,
        );
      } else {
        renderPsBasePianoComping(
          chord, beatCursor, ci, psBaseCycleBeats, bi, barStart, secPerBeat, barFeel, events, swingRatio,
        );
      }

      psBaseCycleBeats = (psBaseCycleBeats + chord.beats) % PSBASE_CH0_PATTERN.sizeInBeats;
      beatCursor += chord.beats;
    }
  }

  // Melody track — emitted after bass/piano/drums so the absolute timestamps
  // share the same secPerBeat / barIndex grid. `playMelody` defaults to true
  // whenever `melody` is provided; pass `playMelody: false` to mute the lead
  // line without rebuilding the chart.
  const playMelody = opts.playMelody ?? (opts.melody != null);
  if (playMelody && opts.melody && opts.melody.length > 0) {
    // Melody beatOffsets arrive already-shaped by the caller (the inline-lick
    // path pre-swings them in ChordPage so only the lick swings — not the
    // note-analysis sheet/solo melodies that share this loop).
    for (const m of opts.melody) {
      events.push({
        kind: "note",
        instrument: "melody",
        midi: m.midi,
        time: m.beatOffset * secPerBeat,
        duration: m.durationBeats * secPerBeat,
        velocity: m.velocity ?? 0.85,
        bar: Math.floor(m.beatOffset / beatsPerBar),
        srcMi: m.srcMi,
        srcNi: m.srcNi,
        // Multi-part per-note timbre / drum routing (single-part: undefined).
        ...(m.instrument ? { melodyInst: m.instrument } : {}),
        ...(m.drumPiece ? { drumPiece: m.drumPiece } : {}),
      });
    }
  }

  events.sort((a, b) => a.time - b.time);

  return events;
}

/* ─── psBase pattern-driven piano comping ────────────────────────────── */

/**
 * Emit piano comping events for one chord by slicing the psBase piano
 * pattern at the current cycle position and fitting it to the chord.
 *
 * Voice leading + register choice + rhythmic feel are all baked into the
 * recorded pattern, so we just need to translate the source notes (CMaj7-
 * relative) to the destination chord via fitChordPhraseToChord. That uses
 * the same voicing-optimisation logic as the .sty engine.
 *
 * Stage-2 additions ported from `renderLegacyPianoComping` so swing piano
 * comping receives the same human-feel treatment as bossa/latin:
 *   - PATCH #6 — chord-roll spread (group notes that share an onset tick
 *                and stagger them by ROLL_PATTERNS_SWING offsets).
 *   - PATCH #7 — 25% chance to anticipate strong-beat onsets by 0.5 beat
 *                (swing feels only). Underflow-guarded.
 *   - PATCH #8 — NOT applied: psBase is a pre-recorded MIDI slice, so the
 *                "3-hit pool routing" makes no sense here. The recorded
 *                pattern carries its own hit-density curve.
 */
function renderPsBasePianoComping(
  chord: Chord,
  beatCursor: number,
  ci: number,
  cycleBeats: number,
  bi: number,
  barStart: number,
  secPerBeat: number,
  feel: FeelId,
  events: BackingEvent[],
  /** 밀도 잽의 스윙 "&" 투사용 (renderChart 의 swingRatio). 0.5 = 직선. */
  swingRatio = 0.5,
): void {
  const sliceStartTick = cycleBeats * PSBASE_PPQ;
  const sliceEndTick = (cycleBeats + chord.beats) * PSBASE_PPQ;
  // Slice + clamp note durations to the slice (acts like Yamaha's STOP
  // RetriggerRule — avoids notes bleeding into the next chord).
  const sliced = PSBASE_CH0_PATTERN.notes
    .filter((n) => n.tick >= sliceStartTick && n.tick < sliceEndTick)
    .map((n) => {
      const relTick = n.tick - sliceStartTick;
      const maxDur = sliceEndTick - n.tick;
      return {
        channel: 0,
        pitch: n.pitch,
        velocity: n.velocity,
        tick: relTick,
        durationTicks: Math.max(1, Math.min(n.durationTicks, maxDur)),
      };
    });
  if (sliced.length === 0) return;

  const destType = chordTypeFromQuality(chord.quality);
  const transformed = fitChordPhraseToChord(
    { channel: 0, notes: sliced },
    PSBASE_CH0_PATTERN.sourceChordRootRelPitch,
    PSBASE_SRC_CHORD_TYPE,
    chord.root,
    destType,
  );

  // PATCH #6 — group transformed notes by their onset tick so we can apply
  // a chord-roll spread per onset cluster. Within each cluster, sort by
  // pitch (low → high) and stagger by the per-feel roll pattern. Single-
  // note onsets get no spread.
  type T = (typeof transformed)[number];
  const clusters = new Map<number, T[]>();
  for (const n of transformed) {
    const arr = clusters.get(n.tick);
    if (arr) arr.push(n);
    else clusters.set(n.tick, [n]);
  }

  // 밀도 보정 (Player 연구 Stage E 검증) — psBase 실측 밀도 ≈1.8 온셋/4박은
  // iReal(3.0~3.4)의 절반. 부족분을 "가이드톤 잽"(보이싱 하위 3음, 0.3박,
  // vel 0.45)으로 빈 약박에 보충한다. 녹음 특성상 한 타건의 노트들이 서로
  // 다른 틱에 흩어지므로, 온셋 수는 하프비트 양자화 집합(taken)으로 센다.
  // 검증 결과: blues 1.83→2.83, ii-V-I→2.9, static→3.0 클러스터/마디.
  {
    const TARGET_DENSITY = 3.2;
    const taken = new Set(
      [...clusters.keys()].map((tk) => Math.round((tk / PSBASE_PPQ) * 2) / 2),
    );
    const expected = TARGET_DENSITY * (chord.beats / 4);
    let deficit = Math.round(expected - taken.size);
    if (deficit > 0) {
      const JAB_SLOTS = [1.5, 3.5, 2.5, 0.5, 1.0, 3.0]; // 약박 우선, 온비트 보조
      const jabVoicing = voiceChord(chord).slice(0, 3);
      for (const slot of JAB_SLOTS) {
        if (deficit <= 0) break;
        if (slot >= chord.beats) continue;
        if (taken.has(slot)) continue;
        if (rand(bi * 101 + ci * 37 + slot * 11) > 0.75) continue;
        // "&" 슬롯은 스윙 위치로 투사(베이스 오너먼트와 동일 규약).
        const isAnd = slot % 1 !== 0;
        const effSlot = isAnd ? Math.floor(slot) + swingRatio : slot;
        const t = barStart + (beatCursor + effSlot) * secPerBeat;
        for (const midi of jabVoicing) {
          events.push({
            kind: "note", instrument: "piano", midi,
            time: t, duration: secPerBeat * 0.3,
            velocity: 0.45,
            bar: bi,
          });
        }
        taken.add(slot);
        deficit--;
      }
    }
  }

  // PATCH #7 — 25% anticipation toggle (swing feels only). Deterministic.
  const isSwingFeel =
    feel === "swing" ||
    feel === "medium-swing" ||
    feel === "medium-up-swing" ||
    feel === "up-tempo-swing" ||
    feel === "shuffle" ||
    feel === "half-time" ||
    feel === "double-time";

  for (const [tick, group] of clusters) {
    group.sort((a, b) => a.pitch - b.pitch);
    const offsetBeats = tick / PSBASE_PPQ;

    // PATCH #7 — only anticipate strong-beat onsets (integer-beat boundary).
    // B9 fix (Player 연구 이식) — psBase 실연 틱은 강박도 4.01/24.01 처럼 수 틱
    // 어긋나 있어 1e-6 허용오차로는 anticipation 후보가 32비트당 4개뿐이었다
    // (사실상 죽은 기능 — 실측 8마디 발화 0회). 0.06비트로 완화하면 후보 7개,
    // 스윙 오프비트(x.71)는 여전히 정확히 제외된다.
    let effOffsetBeats = offsetBeats;
    const isStrong = Math.abs(offsetBeats - Math.round(offsetBeats)) < 0.06;
    if (
      isSwingFeel &&
      isStrong &&
      rand(bi * 53 + ci * 29 + Math.round(offsetBeats) * 7 + tick) < 0.25
    ) {
      const candidate = offsetBeats - 0.5;
      // Guard: absolute time must remain ≥ 0 (no preceding the chart origin).
      if (barStart + (beatCursor + candidate) * secPerBeat >= 0) {
        effOffsetBeats = candidate;
      }
    }

    // PATCH #6 — per-cluster roll choice (deterministic draw per (bar, chord, tick)).
    const rollOffsets = pickRoll(
      feel,
      group.length,
      rand(bi * 41 + ci * 13 + tick * 3 + 7),
    );

    group.forEach((n, vi) => {
      const tickSpread = rollOffsets[vi] ?? 0;
      const t =
        barStart +
        (beatCursor + effOffsetBeats) * secPerBeat +
        rollTickToSec(tickSpread, secPerBeat);
      const dur = Math.max(0.05, (n.durationTicks / PSBASE_PPQ) * secPerBeat);
      events.push({
        kind: "note",
        instrument: "piano",
        midi: n.pitch,
        time: t,
        duration: dur,
        // Velocity clamp 0.15–0.95 matches iReal corpus stdev (~7 MIDI
        // → ~0.06 normalized).
        velocity: Math.max(0.15, Math.min(0.95, n.velocity / 127)),
        bar: bi,
      });
    });
  }
}

/**
 * Voicing-based piano comping. Used for every non-psBase feel (Bossa,
 * Latin, Ballad, etc.). The swing path still goes through the psBase
 * pattern. Stage-2 additions:
 *   - PATCH #6 — chord-roll spread via pickRoll(feel, ...)
 *   - PATCH #7 — 25% chance to anticipate the downbeat by 0.5 beat
 *                (swing-feel modes only)
 *   - PATCH #8 — picks from 3-hit / 2-hit / 1-hit pools weighted 60/30/10
 */
/**
 * Editor practice comp: block-chord on BAR beats 1 & 3, in straight time
 * (no swing anticipation, no groove pattern). Hits are bar-relative: a chord
 * only sounds if bar-beat 0 or 2 falls inside its span, so a 4×1-beat bar
 * plays exactly two stabs (beats 1 & 3) instead of four overlapping ones,
 * and uneven splits (1+3) still land on the bar's beats 1 & 3. Duration is
 * clamped to the chord's remaining span so a stab never rings across the
 * next chord's downbeat. Returns the full voicing for voice-leading.
 */
function renderOneAndThreeComping(
  chord: Chord,
  beatCursor: number,
  barStart: number,
  secPerBeat: number,
  bi: number,
  ci: number,
  events: BackingEvent[],
  prevVoicing: MidiNote[],
): MidiNote[] {
  const fullVoicing = voiceChord(chord, prevVoicing);
  const voicing = fullVoicing.slice(0, 4);
  if (voicing.length === 0) return fullVoicing;

  const chordStart = beatCursor;
  const chordEnd = beatCursor + chord.beats;
  for (const barBeat of [0, 2]) {
    if (barBeat < chordStart || barBeat >= chordEnd) continue;
    const t = barStart + barBeat * secPerBeat;
    // Ring ~2 beats, but never past the chord boundary (small 0.1 gap so the
    // release doesn't smear into the next voicing's attack).
    const durBeats = Math.min(1.9, Math.max(0.5, chordEnd - barBeat - 0.1));
    const vel = 0.6 + (rand(bi * 97 + ci * 11 + barBeat * 3) - 0.5) * 0.06;
    for (const midi of voicing) {
      events.push({
        kind: "note",
        instrument: "piano",
        midi,
        time: t,
        duration: secPerBeat * durBeats,
        velocity: Math.max(0.15, Math.min(0.9, vel)),
        bar: bi,
      });
    }
  }
  return fullVoicing;
}

function renderLegacyPianoComping(
  chord: Chord,
  beatCursor: number,
  bi: number,
  ci: number,
  barStart: number,
  secPerBeat: number,
  feel: FeelId,
  events: BackingEvent[],
  prevVoicing: MidiNote[],
): MidiNote[] {
  // PATCH #9 — pass the actual previous voicing so motionCost can do its job.
  // Previously this passed `[]`, which silently disabled voice leading.
  const fullVoicing = voiceChord(chord, prevVoicing);
  const phrase = Math.floor(bi / 4) % 3;
  const octaveShift = phrase === 0 ? 0 : phrase === 1 ? 12 : -12;
  const voicing = fullVoicing.slice(0, 3).map((n: MidiNote) => n + octaveShift);
  if (voicing.length === 0) return fullVoicing;

  const isBossa = feel === "bossa" || feel === "latin" || feel === "samba" || feel === "cha-cha" || feel === "afro-cuban";
  const pattern = selectCompingPattern(chord.beats, bi, ci, feel);
  const isSingleHit = pattern.length === 1;

  // PATCH #6 — per-chord roll choice (one draw per (bar, chord)).
  const rollOffsets = pickRoll(
    feel,
    voicing.length,
    rand(bi * 41 + ci * 13 + 7),
  );

  // PATCH #7 — 25% anticipation toggle (swing feels only). Deterministic.
  const isSwingFeel =
    feel === "swing" ||
    feel === "medium-swing" ||
    feel === "medium-up-swing" ||
    feel === "up-tempo-swing" ||
    feel === "shuffle" ||
    feel === "half-time" ||
    feel === "double-time";

  for (const [offset, velBase] of pattern) {
    if (offset >= chord.beats) continue;

    // Anticipation: if this is a strong-beat hit (integer) AND swing-feel
    // AND the deterministic draw < 0.25, pull the hit back by 0.5 beat.
    let effOffset = offset;
    const isStrong = Math.abs(offset - Math.round(offset)) < 1e-6;
    if (
      isSwingFeel &&
      isStrong &&
      rand(bi * 53 + ci * 29 + Math.round(offset) * 7) < 0.25
    ) {
      effOffset = offset - 0.5;
      // Allow effOffset to go slightly negative — caller computes absolute
      // time, so a beat-1 hit becoming beat 4& of the previous bar lands
      // correctly. (Skip if it would precede the chart origin.)
      if (barStart + (beatCursor + effOffset) * secPerBeat < 0) {
        effOffset = offset;
      }
    }

    const t = barStart + (beatCursor + effOffset) * secPerBeat;
    const vel = velBase + (rand(bi * 97 + ci * 11 + offset * 3) - 0.5) * 0.08;
    const duration = isSingleHit
      ? secPerBeat * chord.beats * 1.1
      : (isBossa ? secPerBeat * 1.1 : secPerBeat * 0.45);
    voicing.forEach((midi, vi) => {
      const tickSpread = rollOffsets[vi] ?? 0;
      events.push({
        kind: "note",
        instrument: "piano",
        midi,
        time: t + rollTickToSec(tickSpread, secPerBeat),
        duration,
        // PATCH #6 — widened clamp (was 0.3–0.78).
        velocity: Math.max(0.15, Math.min(0.95, vel)),
        bar: bi,
      });
    });
  }

  // PATCH #9 — return the (pre-octave-shift) full voicing so the caller can
  // feed it to the next chord's voiceChord() motionCost lookup.
  return fullVoicing;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function nextChord(bar: Bar, ci: number, flatBars: Bar[], bi: number): Chord | null {
  if (ci < bar.chords.length - 1) return bar.chords[ci + 1];
  const nb = flatBars[bi + 1];
  return nb?.chords[0] ?? null;
}

/**
 * Pick a comping rhythm pattern.
 *   - ≥ 4 beats: weighted routing — 60% 3-hit / 30% 2-hit / 10% 1-hit
 *     for swing-family feels; bossa/latin stay on their dedicated pool.
 *   - 2-3 beats: rotate through 2-beat pool
 *   - 1 beat:    a single downbeat hit
 */
function selectCompingPattern(
  beats: number,
  barIdx: number,
  chordIdx: number,
  feel: FeelId,
): Array<[number, number]> {
  const isBossa = feel === "bossa" || feel === "latin" || feel === "samba" || feel === "cha-cha" || feel === "afro-cuban";

  if (beats >= 4) {
    if (isBossa) {
      const pool4 = COMPING_PATTERNS_BOSSA_4BEAT;
      const idx = Math.floor(rand(barIdx * 13 + chordIdx * 17) * pool4.length);
      return pool4[idx];
    }
    // PATCH #8 — weighted 60/30/10 routing across hit-count pools.
    const draw = rand(barIdx * 13 + chordIdx * 17);
    const pool = draw < 0.6
      ? COMPING_PATTERNS_3HIT
      : draw < 0.9
        ? COMPING_PATTERNS_2HIT
        : COMPING_PATTERNS_1HIT;
    const idx = Math.floor(rand(barIdx * 71 + chordIdx * 19) * pool.length);
    return pool[idx];
  }

  if (beats >= 2) {
    const pool2 = isBossa ? COMPING_PATTERNS_BOSSA_2BEAT : COMPING_PATTERNS_2BEAT;
    const idx = Math.floor(rand(barIdx * 19 + chordIdx * 23) * pool2.length);
    return pool2[idx];
  }
  return [[0, 0.55]];
}

/**
 * Drum humanization — in-place perturbation of timing and velocity so the
 * ride stops feeling like a metronome. Kept small so the groove still locks.
 */
function humanizeDrums(drumEvents: BackingEvent[], _secPerBeat: number, barIdx: number): void {
  const VEL_JITTER = 0.06;

  for (let i = 0; i < drumEvents.length; i++) {
    const ev = drumEvents[i];
    if (ev.kind !== "drum") continue;
    const dv = (rand(barIdx * 59 + i * 17) - 0.5) * 2 * VEL_JITTER;
    drumEvents[i] = {
      ...ev,
      velocity: Math.max(0.15, Math.min(1, ev.velocity + dv)),
    };
  }
}
