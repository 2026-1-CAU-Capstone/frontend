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
  type Tagged = {
    bar: Bar;
    repeatStart: boolean;
    repeatEnd: boolean;
  };

  const flat: Tagged[] = [];
  for (const sec of sections) {
    for (let bi = 0; bi < sec.bars.length; bi++) {
      const bar = sec.bars[bi];
      flat.push({
        bar,
        repeatStart: !!sec.repeatStart && bi === 0,
        repeatEnd: !!sec.repeatEnd && bi === sec.bars.length - 1,
      });
    }
  }

  // Padding detection: source-empty bars (wasEmpty=true) that sit between a
  // `:|` and a subsequent `ending` marker. Marked ONLY when the scan
  // actually reaches an ending marker — otherwise the empties are real
  // intentional rests/clones in the middle of the chart (e.g. "Hindsight").
  const isPadding = new Array<boolean>(flat.length).fill(false);
  for (let i = 0; i < flat.length; i++) {
    if (!flat[i].repeatEnd) continue;
    const candidates: number[] = [];
    let foundEnding = false;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].bar.ending != null) { foundEnding = true; break; }
      if (flat[j].bar.wasEmpty) candidates.push(j);
    }
    if (foundEnding) {
      for (const j of candidates) isPadding[j] = true;
    }
  }

  const output: Bar[] = [];
  let i = 0;
  let repeatStartIdx: number | null = null;
  let havePlayedOnce = false;

  while (i < flat.length) {
    const t = flat[i];

    // Entering a (new) repeat block — remember where to jump back to.
    if (t.repeatStart && repeatStartIdx !== i) {
      repeatStartIdx = i;
      havePlayedOnce = false;
    }

    // 2nd pass: skip the entire 1st-ending bracket (this bar → `:|`).
    if (havePlayedOnce && t.bar.ending === 1) {
      let j = i;
      while (j < flat.length && !flat[j].repeatEnd) j++;
      i = j + 1;
      continue;
    }

    // 2nd pass: skip layout-padding bars under the 2nd-ending bracket.
    if (havePlayedOnce && isPadding[i]) {
      i++;
      continue;
    }

    output.push(t.bar);

    // First time we hit `:|` — loop back to `|:`.
    if (t.repeatEnd && !havePlayedOnce && repeatStartIdx !== null) {
      i = repeatStartIdx;
      havePlayedOnce = true;
      continue;
    }

    i++;
  }

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
  "6": "maj6", "6/9": "maj6", "69": "maj6",
  "^7#11": "maj7", "^9#11": "maj9", "^7#5": "maj7", "^13": "maj9",
  add9: "maj",

  // minor family
  "-": "min", "-7": "min7", "-6": "min6", "-9": "min9", "-11": "min11",
  "-^7": "minmaj7", "-Δ7": "minmaj7", "-^9": "minmaj7", minmaj: "minmaj7",
  "-69": "min6", "-b6": "min", "-#5": "min",

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

function resolveQuality(src: LeadSheetChord): ChordQuality {
  const canonical = src.analysis?.normalizedQuality;
  if (canonical && QUALITY_MAP[canonical]) return QUALITY_MAP[canonical];

  // Strip any slash-bass fragment baked into the quality (e.g. "-7/Eb" → "-7").
  // resolveBassPc handles the bass side separately. Also strip stray `*`
  // wrappers we've seen in a handful of corrupted cells (e.g. "*7us*").
  let raw = (src.quality ?? "").trim().replace(/\*/g, "");
  const slash = raw.indexOf("/");
  if (slash >= 0) raw = raw.slice(0, slash).trim();

  if (raw && QUALITY_MAP[raw]) return QUALITY_MAP[raw];

  // Best-effort prefix match for extended shorthand like "9b13", "13#11" etc.
  if (raw) {
    for (let len = raw.length; len > 0; len--) {
      const candidate = raw.slice(0, len);
      if (QUALITY_MAP[candidate]) return QUALITY_MAP[candidate];
    }
  }

  // Final fallback: major triad. Warn so unrecognized inputs surface rather
  // than silently playing a wrong chord.
  if (raw || canonical) {
    console.warn(
      `[leadSheetToChart] unknown chord quality, falling back to "maj":`,
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
