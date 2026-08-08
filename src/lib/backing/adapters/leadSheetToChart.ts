import { expandRepeatOrder, type RepeatFlags } from "../../note/leadSheetExpand";
import type { LeadSheetChord, LeadSheetData } from "../../../data/leadSheetTypes";
import type {
  Bar,
  Chart,
  Chord,
  ChordQuality,
  FeelId,
  PitchClass,
  Section,
  StyleId,
} from "../types";

/* ─────────────────────────────────────────────────────────────────────────
 * Adapter: LeadSheetData (ChordPage's native format) → normalized Chart.
 *
 * Strategy:
 *   1. When analysis fields (rootPc, normalizedQuality) are present, use them
 *      directly — they come from the upstream iReal/MIDI pipeline and are
 *      already canonical.
 *   2. Otherwise fall back to parsing the raw root letter + quality string.
 *   3. Expand whole-bar repeat markers by cloning the previous bar's chords.
 *   4. Split chords evenly across bar beats (Phase 0 simplification).
 *   5. Map LeadSheetSystem to Chart.Section, then RUN expansion over repeat
 *      brackets and 1st/2nd endings so the engine sees a linear sequence.
 * ──────────────────────────────────────────────────────────────────────── */

export interface AdapterOptions {
  /** Override detected BPM (adapter picks a sensible default per style). */
  bpm?: number;
  /** Override detected StyleId. */
  style?: StyleId;
  /** Override default feel. */
  feel?: FeelId;
}

export function leadSheetToChart(
  data: LeadSheetData,
  opts: AdapterOptions = {},
): Chart {
  const timeSig = parseTimeSig(data.timeSignature);
  const beatsPerBar = timeSig[0];
  const detected = detectStyleAndBpm(data.style);

  const sections: Section[] = [];
  let previousBarChords: Chord[] = [];

  for (const sys of data.systems) {
    const bars: Bar[] = [];
    for (const srcBar of sys.bars) {
      const wasEmpty = srcBar.chords.length === 0;
      const chords = convertBarChords(srcBar.chords, beatsPerBar, previousBarChords);
      if (chords.length > 0) {
        previousBarChords = chords;
      }
      bars.push({
        chords,
        measureNumber: srcBar.measureNumber,
        ending: srcBar.ending,
        wasEmpty,
      });
    }
    sections.push({
      label: sys.sectionLabel,
      bars,
      repeatStart: sys.hasRepeatStart,
      repeatEnd: sys.hasRepeatEnd,
    });
  }

  return {
    title: data.title,
    composer: data.composer,
    key: data.key,
    bpm: opts.bpm ?? detected.bpm,
    timeSig,
    defaultStyle: opts.style ?? detected.style,
    defaultFeel: opts.feel ?? "swing",
    sections: expandForPlayback(sections),
  };
}

/* ─── repeat / volta expansion ───────────────────────────────────────── */

/**
 * Expand `|: ... :|` repeats and 1st/2nd endings (volta brackets) into a
 * single linear bar sequence the engine can play straight through.
 *
 * iReal's encoding:
 *   - `hasRepeatStart` lives on a Section: the section's FIRST bar is the
 *     repeat-start marker (`|:`).
 *   - `hasRepeatEnd` lives on a Section: the section's LAST bar is the
 *     repeat-end marker (`:|`).
 *   - `bar.ending = 1 | 2` marks volta brackets. The 1st-ending bracket
 *     starts at the bar marked `ending=1` and runs up to (and includes) the
 *     bar at `:|`. The 2nd-ending bracket starts at the bar marked
 *     `ending=2` and runs to the next structural break (usually a new
 *     section without an ending marker).
 *   - Bars between `:|` and the `ending=2` marker are visual-layout
 *     padding (empty `chords:[]` cells in iReal JSON). They MUST be skipped
 *     in playback — they only exist so the lead sheet visually aligns the
 *     2nd ending under the 1st.
 *
 * Pass-1 semantics: linear walk through every bar (including ending=1).
 * Pass-2 semantics: jump back to the repeat-start, then on the way down,
 *   skip the entire 1st-ending bracket (ending=1 bar through `:|`) and
 *   skip the visual-padding bars, leaving ending=2 + everything after.
 */
function expandForPlayback(sections: Section[]): Section[] {
  // 전개 알고리즘 자체는 `lib/note/leadSheetExpand.ts` 가 단일 소스다 —
  // "코드 붙여넣기"(에디터)도 같은 함수를 써야 재생과 마디 수가 어긋나지 않는다.
  const flat: Bar[] = [];
  const flags: RepeatFlags[] = [];
  for (const sec of sections) {
    for (let bi = 0; bi < sec.bars.length; bi++) {
      const bar = sec.bars[bi];
      flat.push(bar);
      flags.push({
        ending: bar.ending,
        wasEmpty: !!bar.wasEmpty,
        repeatStart: !!sec.repeatStart && bi === 0,
        repeatEnd: !!sec.repeatEnd && bi === sec.bars.length - 1,
      });
    }
  }
  const output = expandRepeatOrder(flags).map((i) => flat[i]);
  return [{ label: "expanded", bars: output }];
}

/* ─── bar-level conversion ───────────────────────────────────────────── */

function convertBarChords(
  sources: LeadSheetChord[],
  beatsPerBar: number,
  previousBarChords: Chord[],
): Chord[] {
  // N.C. (no-chord) cells: jazz1460.json encodes these with root="N.C.".
  // They should be rendered as silence, NOT cloned-from-previous. Detect
  // these explicitly so a bar that's entirely N.C. stays empty.
  const hasNoChord = sources.some((c) => !c.isRepeat && c.root === "N.C.");
  const real = sources.filter((c) =>
    !c.isRepeat
    && c.root !== "N.C."
    && (c.root != null || c.analysis?.rootPc != null)
  );

  // Bar is entirely N.C. → silent bar (no chord events scheduled)
  if (real.length === 0 && hasNoChord) return [];

  // No real chords AND no N.C. marker → either a `%` bar (isRepeat:true)
  // or an empty visual cell. Both behave as "continue prior harmony" in
  // iReal Pro — clone previous chord. Padding bars under a 2nd-ending
  // bracket carry the same clone but get skipped at playback expansion
  // time via the `wasEmpty` flag set by the caller.
  if (real.length === 0) {
    return previousBarChords.map((c) => ({ ...c }));
  }

  // Per-chord duration when the source carries `durationBeats` (OMR analysis),
  // else equal-beat distribution across the bar (Phase 0 fallback). Lets a bar
  // like `Dm(2) Bdim(1) Bb(1)` play with the right lengths.
  const beatsEach = beatsPerBar / real.length;
  const out: Chord[] = [];
  for (const src of real) {
    const beats = typeof src.durationBeats === "number" && src.durationBeats > 0
      ? src.durationBeats
      : beatsEach;
    const chord = convertChord(src, beats);
    if (chord) out.push(chord);
  }
  return out;
}

function convertChord(src: LeadSheetChord, beats: number): Chord | null {
  const rootPc = resolveRootPc(src);
  if (rootPc == null) return null;
  return {
    root: rootPc,
    quality: resolveQuality(src),
    bass: resolveBassPc(src),
    beats,
    symbol: formatSymbol(src),
  };
}

/* ─── chord field resolution ─────────────────────────────────────────── */

const LETTER_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function letterAccToPc(letter: string | undefined, acc: "b" | "#" | undefined): PitchClass | null {
  if (!letter) return null;
  const base = LETTER_TO_PC[letter.toUpperCase()];
  if (base == null) return null;
  if (acc === "b") return (base + 11) % 12;
  if (acc === "#") return (base + 1) % 12;
  return base;
}

function resolveRootPc(src: LeadSheetChord): PitchClass | null {
  if (src.analysis?.rootPc != null) return src.analysis.rootPc;
  return letterAccToPc(src.root, src.accidental);
}

function resolveBassPc(src: LeadSheetChord): PitchClass | undefined {
  if (src.analysis?.bassPc != null) return src.analysis.bassPc;
  if (src.bass) {
    const pc = letterAccToPc(src.bass.root, src.bass.accidental);
    if (pc != null) return pc;
  }
  // Upstream data sometimes packs a slash bass into the quality string
  // itself (e.g. quality="-7/Eb"). Detect and recover.
  const q = src.quality ?? "";
  const slash = q.indexOf("/");
  if (slash >= 0) {
    const bassPart = q.slice(slash + 1).trim();
    const letter = bassPart[0]?.toUpperCase();
    const acc = bassPart[1] === "b" || bassPart[1] === "#"
      ? (bassPart[1] as "b" | "#")
      : undefined;
    const pc = letterAccToPc(letter, acc);
    if (pc != null) return pc;
  }
  return undefined;
}

/* ─── quality mapping ────────────────────────────────────────────────── */

/**
 * Unified map accepting both canonical analysis.normalizedQuality values and
 * raw LeadSheet/iReal shorthand. Order-insensitive lookup.
 *
 * Coverage: derived from a sweep over jazz1460.json (52,360 chord cells).
 * The extended-alteration entries (7#5, 13b9, 9#11, etc.) map to the closest
 * ChordQuality so voicing/voicing-leading remains musically defensible.
 * "Closest" means we preserve the most distinctive color (b9/#9/#11/b13)
 * even if one tension is lost.
 */
const QUALITY_MAP: Record<string, ChordQuality> = {
  // canonical (from analysis.normalizedQuality)
  maj: "maj", maj6: "maj6", maj7: "maj7", maj9: "maj9",
  min: "min", min6: "min6", min7: "min7", min9: "min9", min11: "min11", minmaj7: "minmaj7",
  dom7: "dom7", dom9: "dom9", dom13: "dom13", dom7sus4: "7sus4",
  min7b5: "min7b5", dim: "dim", dim7: "dim7",
  aug: "aug", aug7: "aug7",
  sus2: "sus2", sus4: "sus4",

  // raw iReal / common shorthand — major family
  "^": "maj", "^7": "maj7", "^9": "maj9", "^6": "maj6", "Δ": "maj", "Δ7": "maj7",
  // U+25B3 WHITE UP-POINTING TRIANGLE — the glyph our notation actually
  // renders/stores (jazz-notation formatChordDisplay normalises maj7 → "△").
  // Distinct codepoint from "Δ" (U+0394 Greek delta) above, so it needs its
  // own entries or every △7 cell falls back to a bare major triad.
  "△": "maj", "△7": "maj7", "△9": "maj9", "△6": "maj6", "△13": "maj9",
  "6": "maj6", "6/9": "maj6", "69": "maj6", "5": "maj",
  "^7#11": "maj7", "^9#11": "maj9", "^7#5": "maj7", "^13": "maj9",
  "△7#11": "maj7", "△9#11": "maj9", "△7#5": "maj7",
  add9: "maj",

  // minor family — both "-" and "m" spellings (input uses either).
  "-": "min", "-7": "min7", "-6": "min6", "-9": "min9", "-11": "min11",
  "-^7": "minmaj7", "-Δ7": "minmaj7", "-△7": "minmaj7", "-^9": "minmaj7", minmaj: "minmaj7",
  "-69": "min6", "-b6": "min", "-#5": "min",
  m: "min", m7: "min7", m6: "min6", m9: "min9", m11: "min11",
  m7b5: "min7b5", mmaj7: "minmaj7", "m△7": "minmaj7", "m^7": "minmaj7", m69: "min6",

  // dominant family — natural extensions
  "7": "dom7", "9": "dom9", "13": "dom13",
  "7sus": "7sus4", "9sus": "7sus4", "7susadd3": "7sus4",
  "7alt": "7alt", alt: "7alt",

  // dominant alterations — single
  "7b9": "7b9", "7#9": "7#9", "7#11": "7#11", "7b13": "7b13",
  "7#5": "7b13",      // #5 = b13 enharmonic — keep altered-fifth color
  "7b5": "7alt",      // b5 + 7 is canonical alt territory
  "9#11": "7#11",     // #11 is the more distinctive color
  "9#5": "aug7",      // #5 + dom = aug7
  "9b5": "7alt",
  "13#11": "dom13",   // 13 wins over #11
  "13b9": "7b9",      // b9 conflicts with natural 9 → drop the 9
  "13#9": "7#9",
  "13sus": "7sus4",   // duplicate above; harmless

  // dominant alterations — compound (always preserve b9/#9 over #5/b5)
  "7b9b5": "7b9", "7b9#5": "7b9", "7b9b13": "7b9",
  "7b9#11": "7b9", "7b9sus": "7b9", "7b9#9": "7alt",
  "7#9b5": "7alt", "7#9#5": "7alt", "7#9#11": "7#9",
  "7b13sus": "7b13",

  // half-dim / dim
  h: "min7b5", h7: "min7b5", h9: "min7b5",
  ø: "min7b5", "ø7": "min7b5",
  o: "dim", o7: "dim7", "°": "dim", "°7": "dim7",
  "o^7": "dim",

  // aug
  "+": "aug", "+7": "aug7",

  // sus
  sus: "sus4", "2": "sus2",
};

/**
 * Last-resort quality guesser. Scans a quality string for the few
 * distinctive harmony markers and maps to the closest playable ChordQuality.
 * This is intentionally lenient: ANY non-empty input yields a musically
 * defensible result rather than a bare major triad, so corrupted / exotic
 * cells (e.g. "m3179", "min7add11omit5", odd unicode) still play sensibly.
 * Returns null only for a truly empty string.
 *
 * Marker priority is most-distinctive-first so e.g. "m7b5" reads as
 * half-diminished, not plain minor.
 */
function guessQualityFromMarkers(raw: string): ChordQuality | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  const hasExt = /7|9|11|13|6/.test(s);          // any seventh/extension digit

  // half-diminished (ø, h7, m7b5, -7b5)
  if (raw.includes("ø") || /m7b5|m7♭5|-7b5|min7b5/.test(s) || (/\bh/.test(s) && hasExt)) {
    return "min7b5";
  }
  // diminished (°, dim, o / o7)
  if (raw.includes("°") || s.includes("dim") || /(^|[^a-z])o7?($|[^a-z])/.test(s)) {
    return hasExt ? "dim7" : "dim";
  }
  // augmented (+, aug, #5 with a dominant feel)
  if (raw.includes("+") || s.includes("aug")) {
    return hasExt ? "aug7" : "aug";
  }
  // suspended
  if (s.includes("sus")) {
    return s.includes("sus2") ? "sus2" : "sus4";
  }
  // minor-vs-major detection — evaluated on raw (case-sensitive) so a
  // capital "M7" reads as major, not minor.
  //   minor marker: a leading "-", a LOWERCASE "m" not starting "maj"/"ma",
  //                 or the word "min".
  //   major marker: △ Δ ^ , the word "maj" (any case), or a capital "M"
  //                 before a digit / "aj".
  const minorMark = raw.includes("-") || /^m(?!aj|a)/.test(raw) || /^min/i.test(raw);
  const majMark = /[△Δ^]/.test(raw) || /maj/i.test(raw) || /M(?=\d|aj)/.test(raw);
  if (minorMark && majMark) return "minmaj7";   // minMaj7 family
  if (minorMark) return hasExt ? "min7" : "min";
  if (majMark) return hasExt ? "maj7" : "maj";
  // dominant — leading digit or any seventh/extension with no quality letter
  if (hasExt) return "dom7";
  return null;
}

function resolveQuality(src: LeadSheetChord): ChordQuality {
  const canonical = src.analysis?.normalizedQuality;
  if (canonical && QUALITY_MAP[canonical]) return QUALITY_MAP[canonical];

  // Strip any slash-bass fragment baked into the quality (e.g. "-7/Eb" → "-7").
  // resolveBassPc handles the bass side separately. Also strip stray `*`
  // wrappers we've seen in a handful of corrupted cells (e.g. "*7us*").
  let raw = (src.quality ?? "").trim().replace(/\*/g, "");
  const slash = raw.indexOf("/");
  if (slash >= 0) raw = raw.slice(0, slash).trim();

  // Bare root (no quality at all) → major triad. This is the normal,
  // expected case (a "C" cell), so no warning.
  if (!raw && !canonical) return "maj";

  // 1. exact match
  if (raw && QUALITY_MAP[raw]) return QUALITY_MAP[raw];

  // 2. prefix match for extended shorthand like "9b13", "13#11" etc.
  if (raw) {
    for (let len = raw.length; len > 0; len--) {
      const candidate = raw.slice(0, len);
      if (QUALITY_MAP[candidate]) return QUALITY_MAP[candidate];
    }
  }

  // 3. marker-scan heuristic — guarantees a sensible playable quality for
  //    ANY garbage/exotic input so backing never silently plays the wrong
  //    chord AND the console isn't spammed with fallbacks.
  const guessed = guessQualityFromMarkers(raw) ?? guessQualityFromMarkers(canonical ?? "");
  if (guessed) return guessed;

  // 4. truly unparseable (e.g. quality was only punctuation) → major triad.
  //    Dev-only debug, not a warn, so production consoles stay clean.
  if (import.meta.env.DEV) {
    console.debug(
      `[leadSheetToChart] unrecognized chord quality → "maj":`,
      { quality: raw, normalizedQuality: canonical },
    );
  }
  return "maj";
}

/* ─── symbol formatting (for debugging / UI hover) ───────────────────── */

function formatSymbol(src: LeadSheetChord): string {
  const root = (src.root ?? "") + (src.accidental ?? "");
  const q = src.quality ?? "";
  const bass = src.bass ? `/${src.bass.root}${src.bass.accidental ?? ""}` : "";
  return `${root}${q}${bass}`;
}

/* ─── time signature parsing ─────────────────────────────────────────── */

function parseTimeSig(ts: string | undefined): [number, number] {
  if (!ts) return [4, 4];
  const parts = ts.split("/").map((s) => parseInt(s, 10));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return [4, 4];
  }
  return [parts[0], parts[1]];
}

/* ─── style / bpm detection from iReal's "style" string ──────────────── */

interface DetectedStyle {
  style: StyleId;
  bpm: number;
}

function detectStyleAndBpm(styleStr: string | undefined): DetectedStyle {
  const s = (styleStr ?? "").toLowerCase();

  if (!s) return { style: "medium-swing", bpm: 140 };

  if (s.includes("ballad")) return { style: "ballad-swing", bpm: 72 };
  if (s.includes("up") && s.includes("swing")) return { style: "up-swing", bpm: 220 };
  if (s.includes("slow") && s.includes("swing")) return { style: "slow-swing", bpm: 100 };
  if (s.includes("medium") || (s.includes("swing") && !s.includes("shuffle"))) {
    return { style: "medium-swing", bpm: 140 };
  }

  if (s.includes("bossa")) return { style: "bossa", bpm: 130 };
  if (s.includes("samba")) return { style: "samba", bpm: 160 };
  if (s.includes("afro") || s.includes("6/8")) return { style: "afro-cuban-68", bpm: 120 };
  if (s.includes("songo")) return { style: "songo", bpm: 160 };
  if (s.includes("mambo")) return { style: "mambo", bpm: 180 };
  if (s.includes("cha")) return { style: "cha-cha", bpm: 140 };
  if (s.includes("calypso")) return { style: "samba", bpm: 130 };
  if (s.includes("latin")) return { style: "bossa", bpm: 140 };

  if (s.includes("waltz")) return { style: "waltz-jazz", bpm: 180 };
  if (s.includes("funk")) return { style: "funk", bpm: 100 };
  if (s.includes("rock")) return { style: "rock", bpm: 110 };
  if (s.includes("rubato")) return { style: "rubato", bpm: 72 };

  // Straight-eighth / 16th feels — no dedicated style yet, treat as funk
  // family so the rhythm section stays straight rather than swung.
  if (s.includes("even 8") || s.includes("even 8ths") || s.includes("8ths")) {
    return { style: "funk", bpm: 120 };
  }
  if (s.includes("even 16") || s.includes("16ths")) {
    return { style: "funk", bpm: 110 };
  }

  return { style: "medium-swing", bpm: 140 };
}
