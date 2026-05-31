import type {
  LeadSheetBar,
  LeadSheetChord,
  LeadSheetData,
  LeadSheetSystem,
} from "../../../data/leadSheetTypes";
import type { NoteInfo, NoteSheetData } from "../../../data/sampleMelody";
import type { Chart } from "../types";
import { leadSheetToChart } from "./leadSheetToChart";

/* ─────────────────────────────────────────────────────────────────────────
 * Adapter: NoteSheetData (per-note melody data with bar-level chord strings)
 * → Chart for the BackingPlayer engine + parallel MelodyNote[] stream for
 * scheduling the lead line.
 *
 * Strategy:
 *   1. noteSheetToChart()    — Re-uses leadSheetToChart() by translating
 *      NoteSheetData into a one-system LeadSheetData. The chord string on
 *      each MeasureInfo (e.g. "D-7  G7") is split on 2+ spaces and each
 *      token parsed into a LeadSheetChord. This avoids duplicating the
 *      ~150-entry iReal QUALITY_MAP.
 *
 *   2. extractMelody()       — Walks every measure → note in order,
 *      accumulating a beat cursor. VexFlow keys ("c#/5") are resolved to
 *      MIDI numbers (with accidental + ottava overrides honoured). Rests
 *      ("qr", "hr", …) advance the cursor without emitting a note. Tuplets
 *      and dotted durations are applied multiplicatively (matches
 *      notePlayer.ts's beat-length math at recon §5).
 * ──────────────────────────────────────────────────────────────────────── */

/* ─── Public API ─────────────────────────────────────────────────────── */

export interface MelodyNote {
  /** MIDI pitch (resolved from VexFlow "c#/4" → 61). */
  midi: number;
  /** Beats elapsed from the start of the chart. */
  beatOffset: number;
  /** Length of the note in beats. */
  durationBeats: number;
  /** 0..1; defaults to undefined (caller supplies a default). */
  velocity?: number;
  /** True when this note ties INTO the next note (sustained, no re-attack). */
  tie?: boolean;
}

/**
 * Convert a NoteSheetData into a Chart, treating each measure as one Bar
 * containing 1–N Chords. Multiple chords per bar are encoded in the source
 * `chord` string by separating tokens with 2+ spaces (matching the
 * convention used by notePlayer.ts::build, recon §1).
 *
 * Bars without a chord token clone the previous bar's chords (delegated to
 * leadSheetToChart). Time signature comes from sheet.timeSignature; tempo
 * (when present) overrides the style-derived default BPM.
 *
 * @example
 * const sheet: NoteSheetData = {
 *   title: 'demo', composer: '', key: 'C', timeSignature: '4/4', tempo: 120,
 *   measures: [
 *     { chord: 'CΔ7',       notes: [{ keys: ['c/5'], duration: 'q' }] },
 *     { chord: 'D-7  G7',   notes: [{ keys: ['d/5'], duration: 'h' }] },
 *   ],
 * };
 * const chart = noteSheetToChart(sheet);
 * // chart.timeSig === [4,4], chart.bpm === 120
 * // chart.sections[0].bars[0].chords ≈ [{root:0, quality:'maj7', beats:4}]
 * // chart.sections[0].bars[1].chords ≈ [
 * //   {root:2, quality:'min7', beats:2}, {root:7, quality:'dom7', beats:2}
 * // ]
 */
export function noteSheetToChart(sheet: NoteSheetData): Chart {
  const leadSheet = toLeadSheetData(sheet);
  return leadSheetToChart(leadSheet, sheet.tempo ? { bpm: sheet.tempo } : {});
}

/**
 * Extract a flat MelodyNote stream from a NoteSheetData. Rests advance the
 * beat cursor without emitting a note. Chords (NoteInfo.keys.length > 1)
 * emit one MelodyNote per key at the same beatOffset.
 *
 * @example
 * extractMelody({
 *   title:'', composer:'', key:'C', timeSignature:'4/4',
 *   measures: [{ chord:'C', notes: [
 *     { keys:['c/5'], duration:'q' },
 *     { keys:['r/5'], duration:'qr' },          // rest – skipped
 *     { keys:['e/5'], duration:'8', dotted:true },
 *   ]}],
 * });
 * // → [
 * //   { midi: 72, beatOffset: 0,    durationBeats: 1   },
 * //   { midi: 76, beatOffset: 2,    durationBeats: 0.75 },
 * // ]
 */
export function extractMelody(sheet: NoteSheetData): MelodyNote[] {
  const out: MelodyNote[] = [];
  let beatCursor = 0;
  let ottavaShift = 0; // ±12 while inside an 8va/8vb bracket

  for (const measure of sheet.measures) {
    for (const note of measure.notes) {
      const beats = noteBeats(note);

      if (note.ottavaStart === "8va") ottavaShift = 12;
      else if (note.ottavaStart === "8vb") ottavaShift = -12;

      const isRest = isRestNote(note);
      if (!isRest && !note.tieContinuation) {
        for (let i = 0; i < note.keys.length; i++) {
          const midi = vexKeyToMidi(note.keys[i], note.accidentals?.[i]);
          if (midi == null) continue;
          out.push({
            midi: midi + ottavaShift,
            beatOffset: beatCursor,
            durationBeats: beats,
            tie: note.tie,
          });
        }
      }

      beatCursor += beats;

      if (note.ottavaEnd) ottavaShift = 0;
    }
  }
  return out;
}

/* ─── NoteSheetData → LeadSheetData (chord-only re-projection) ───────── */

function toLeadSheetData(sheet: NoteSheetData): LeadSheetData {
  const bars: LeadSheetBar[] = sheet.measures.map((m, i) => ({
    measureNumber: i + 1,
    chords: parseMeasureChords(m.chord),
  }));

  const system: LeadSheetSystem = { bars };

  return {
    title: sheet.title,
    composer: sheet.composer,
    style: sheet.genre ?? "",
    timeSignature: sheet.timeSignature,
    key: sheet.key,
    systems: [system],
  };
}

/**
 * Split a measure's chord string into 1–N LeadSheetChord tokens.
 * Convention (matches notePlayer.ts::build, recon §1): tokens separated by
 * 2+ whitespace characters denote chord changes within the bar.
 */
function parseMeasureChords(raw: string | undefined): LeadSheetChord[] {
  if (!raw || !raw.trim()) return [];
  const tokens = raw.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  return tokens.map(parseChordToken).filter((c): c is LeadSheetChord => c !== null);
}

/**
 * Parse a single chord symbol like "D-7", "F#m7b5", "Eb/G", "CΔ7" into a
 * LeadSheetChord. The quality string is left verbatim so the downstream
 * QUALITY_MAP in leadSheetToChart() handles iReal shorthand normalisation.
 */
function parseChordToken(token: string): LeadSheetChord | null {
  if (!token) return null;

  const letter = token[0]?.toUpperCase();
  if (!"ABCDEFG".includes(letter)) return null;

  let i = 1;
  let accidental: "b" | "#" | undefined;
  if (token[i] === "b" || token[i] === "#") {
    accidental = token[i] as "b" | "#";
    i++;
  }

  const rest = token.slice(i);
  const slashIdx = rest.indexOf("/");
  const quality = (slashIdx >= 0 ? rest.slice(0, slashIdx) : rest).trim();

  let bass: LeadSheetChord["bass"];
  if (slashIdx >= 0) {
    const bassPart = rest.slice(slashIdx + 1).trim();
    const bLetter = bassPart[0]?.toUpperCase();
    if (bLetter && "ABCDEFG".includes(bLetter)) {
      const bAcc = bassPart[1] === "b" || bassPart[1] === "#"
        ? (bassPart[1] as "b" | "#")
        : undefined;
      bass = { root: bLetter, accidental: bAcc };
    }
  }

  return { root: letter, accidental, quality, bass };
}

/* ─── Note duration → beats (mirrors notePlayer.ts::noteBeats) ───────── */

const DUR_BEATS: Record<string, number> = {
  w: 4, h: 2, q: 1, "8": 0.5, "16": 0.25, "32": 0.125,
};

function noteBeats(n: NoteInfo): number {
  // Strip trailing 'r' (rest) and 'd' (dotted shorthand) before lookup —
  // dotted-ness is also conveyed by the explicit `dotted` flag.
  const code = n.duration.replace(/[rd]+$/, "");
  let beats = DUR_BEATS[code];
  if (beats == null) {
    // TODO: extend DUR_BEATS if exotic durations appear (e.g. "64").
    beats = 1;
  }
  if (n.dotted) beats *= 1.5;
  if (n.tuplet) {
    const normal = n.tupletNormal ?? largestPow2LessThan(n.tuplet);
    beats *= normal / n.tuplet;
  }
  return beats;
}

function largestPow2LessThan(n: number): number {
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

function isRestNote(n: NoteInfo): boolean {
  // Convention in NoteSheetData: rest marker is the 'r' suffix on duration.
  // (The keys array can still contain a placeholder like 'b/4' — it's just
  // the staff position for the rest glyph, not a pitch.)
  return /r$/.test(n.duration);
}

/* ─── VexFlow key string → MIDI ──────────────────────────────────────── */

const PITCH_CLASS: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

/**
 * Convert a VexFlow key string "c#/5" + optional accidental override into
 * a MIDI number. Returns null on malformed input.
 *
 * Examples:
 *   "c/5"             → 72
 *   "c#/5"            → 73
 *   "c/5"  + acc='#'  → 73   (explicit accidental override wins)
 *   "c/5"  + acc='b'  → 71
 *   "c/5"  + acc='##' → 74
 */
function vexKeyToMidi(
  key: string,
  accidental?: "#" | "b" | "n" | "##" | "bb",
): number | null {
  const m = /^([a-gA-G])(#{1,2}|b{1,2}|n)?\/(-?\d+)$/.exec(key);
  if (!m) return null;
  const [, letter, baked, octStr] = m;
  const pc = PITCH_CLASS[letter.toLowerCase()];
  if (pc == null) return null;

  let semitones = 0;
  // Accidental priority: explicit `accidental` field overrides any baked
  // accidental in the key string (matches the renderer's own behaviour).
  const acc = accidental ?? baked;
  if (acc === "#") semitones = 1;
  else if (acc === "##") semitones = 2;
  else if (acc === "b") semitones = -1;
  else if (acc === "bb") semitones = -2;
  // 'n' (natural) explicitly cancels — leave semitones at 0.

  const oct = parseInt(octStr, 10);
  // MIDI convention: C4 = 60.
  return (oct + 1) * 12 + pc + semitones;
}
