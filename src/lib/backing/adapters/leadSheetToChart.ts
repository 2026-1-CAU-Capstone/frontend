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
 *   5. Map LeadSheetSystem 1:1 to Chart.Section, preserving repeat flags.
 *
 * Phase 0 scope: flat conversion, no repeat/volta expansion for playback.
 * Phase 2+: expand repeats into a flat playable sequence.
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
      const chords = convertBarChords(srcBar.chords, beatsPerBar, previousBarChords);
      if (chords.length > 0) {
        previousBarChords = chords;
      }
      bars.push({
        chords,
        measureNumber: srcBar.measureNumber,
      });
    }
    sections.push({
      label: sys.sectionLabel,
      bars,
      repeatStart: sys.hasRepeatStart,
      repeatEnd: sys.hasRepeatEnd,
      ending: sys.ending,
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
    sections,
  };
}

/* ─── bar-level conversion ───────────────────────────────────────────── */

function convertBarChords(
  sources: LeadSheetChord[],
  beatsPerBar: number,
  previousBarChords: Chord[],
): Chord[] {
  const real = sources.filter((c) => !c.isRepeat && (c.root != null || c.analysis?.rootPc != null));

  // Empty or repeat-only bar → clone previous bar's chords
  if (real.length === 0) {
    return previousBarChords.map((c) => ({ ...c }));
  }

  // Equal-beat distribution across the bar (Phase 0)
  const beatsEach = beatsPerBar / real.length;
  const out: Chord[] = [];
  for (const src of real) {
    const chord = convertChord(src, beatsEach);
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
  if (!src.bass) return undefined;
  const pc = letterAccToPc(src.bass.root, src.bass.accidental);
  return pc == null ? undefined : pc;
}

/* ─── quality mapping ────────────────────────────────────────────────── */

/**
 * Unified map accepting both canonical analysis.normalizedQuality values and
 * raw LeadSheet/iReal shorthand. Order-insensitive lookup.
 */
const QUALITY_MAP: Record<string, ChordQuality> = {
  // canonical (from analysis.normalizedQuality)
  maj: "maj", maj6: "maj6", maj7: "maj7", maj9: "maj9",
  min: "min", min6: "min6", min7: "min7", min9: "min9", min11: "min11", minmaj7: "minmaj7",
  dom7: "dom7", dom9: "dom9", dom13: "dom13", dom7sus4: "7sus4",
  min7b5: "min7b5", dim: "dim", dim7: "dim7",
  aug: "aug", aug7: "aug7",
  sus2: "sus2", sus4: "sus4",

  // raw iReal / common shorthand
  "^": "maj", "^7": "maj7", "^9": "maj9", "^6": "maj6", "Δ": "maj", "Δ7": "maj7",
  "6": "maj6", "6/9": "maj6",
  "-": "min", "-7": "min7", "-6": "min6", "-9": "min9", "-11": "min11",
  "-^7": "minmaj7", "-Δ7": "minmaj7", "minmaj": "minmaj7",
  "7": "dom7", "9": "dom9", "13": "dom13",
  "7sus": "7sus4", "9sus": "7sus4",
  "7alt": "7alt", alt: "7alt",
  "7b9": "7b9", "7#9": "7#9", "7#11": "7#11", "7b13": "7b13",
  h: "min7b5", h7: "min7b5", ø: "min7b5", "ø7": "min7b5",
  o: "dim", o7: "dim7", "°": "dim", "°7": "dim7",
  "+": "aug", "+7": "aug7",
  sus: "sus4",
};

function resolveQuality(src: LeadSheetChord): ChordQuality {
  const canonical = src.analysis?.normalizedQuality;
  if (canonical && QUALITY_MAP[canonical]) return QUALITY_MAP[canonical];

  const raw = (src.quality ?? "").trim();
  if (raw && QUALITY_MAP[raw]) return QUALITY_MAP[raw];

  // Best-effort prefix match for extended shorthand like "9b13", "13#11" etc.
  if (raw) {
    for (let len = raw.length; len > 0; len--) {
      const candidate = raw.slice(0, len);
      if (QUALITY_MAP[candidate]) return QUALITY_MAP[candidate];
    }
  }

  // Final fallback: major triad
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

  if (s.includes("waltz")) return { style: "waltz-jazz", bpm: 180 };
  if (s.includes("funk")) return { style: "funk", bpm: 100 };
  if (s.includes("rock")) return { style: "rock", bpm: 110 };
  if (s.includes("rubato")) return { style: "rubato", bpm: 72 };

  return { style: "medium-swing", bpm: 140 };
}
