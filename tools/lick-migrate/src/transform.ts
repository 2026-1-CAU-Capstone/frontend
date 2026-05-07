import type {
  LickCreateRequest,
  MeasureRequest,
  NoteInfoRequest,
  SheetDataRequest,
  SourceLick,
  SourceMeasure,
  SourceNote,
} from "./types.js";

// Normalize key strings to Weimar format ("C-maj", "C-min").
// Inputs seen in user_licks.json:
//   "Ab", "Bb", "C", "Db", "Eb", "F", "G", "Gb"     -> append "-maj"
//   "Cm", "Dm", "Fm"                                 -> "C-min", "D-min", "F-min"
//   "Ab-maj", "C-maj", "Eb-min", ...                 -> already Weimar, keep
export function normalizeKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim();
  if (k.length === 0) return null;
  if (/^[A-G][b#]?-(maj|min)$/.test(k)) return k;
  const minorMatch = k.match(/^([A-G][b#]?)m$/);
  if (minorMatch) return `${minorMatch[1]}-min`;
  if (/^[A-G][b#]?$/.test(k)) return `${k}-maj`;
  // Anything else: pass through unchanged so the backend can reject it.
  return k;
}

function mapMeasureChord(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function transformNote(src: SourceNote): NoteInfoRequest {
  const out: NoteInfoRequest = {
    keys: src.keys,
    duration: src.duration,
  };
  if (src.accidentals && Object.keys(src.accidentals).length > 0) {
    out.accidentals = src.accidentals;
  }
  if (src.tuplet != null) out.tuplet = src.tuplet;
  if (src.dotted) out.dotted = true;
  if (src.tie) out.tie = true;
  if (src.gliss) out.gliss = true;
  if (src.beamBreak) out.beamBreak = true;
  return out;
}

function transformMeasure(src: SourceMeasure): MeasureRequest {
  const out: MeasureRequest = {
    notes: src.notes.map(transformNote),
  };
  const chord = mapMeasureChord(src.chord);
  if (chord) out.chord = chord;
  return out;
}

function transformSheetData(
  src: SourceLick["sheetData"],
  fallbackKey: string | null,
): SheetDataRequest {
  const out: SheetDataRequest = {
    measures: src.measures.map(transformMeasure),
  };
  if (src.title) out.title = src.title;
  if (src.composer) out.composer = src.composer;
  if (src.timeSignature) out.timeSignature = src.timeSignature;
  if (src.tempo != null) out.tempo = src.tempo;
  // sheetData.key is the *display* key (e.g. "Bb"), distinct from the
  // performance metadata key. Keep the raw form Audiveris-style (no "-maj").
  if (src.key) out.key = src.key;
  else if (fallbackKey) {
    const m = fallbackKey.match(/^([A-G][b#]?)/);
    if (m?.[1]) out.key = m[1];
  }
  return out;
}

const STYLE_VALUES = new Set([
  "SWING",
  "BEBOP",
  "HARDBOP",
  "COOL",
  "MODAL",
  "FUSION",
]);
const RHYTHM_FEEL_VALUES = new Set(["SWING", "STRAIGHT", "BOSSA", "LATIN"]);

function maybeStyle(raw: string | null | undefined): LickCreateRequest["style"] {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper.length === 0) return null;
  return STYLE_VALUES.has(upper)
    ? (upper as NonNullable<LickCreateRequest["style"]>)
    : null;
}

function maybeRhythmFeel(
  raw: string | null | undefined,
): LickCreateRequest["rhythmFeel"] {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper.length === 0) return null;
  return RHYTHM_FEEL_VALUES.has(upper)
    ? (upper as NonNullable<LickCreateRequest["rhythmFeel"]>)
    : null;
}

export interface TransformOptions {
  defaultInstrument: LickCreateRequest["instrument"];
  source: LickCreateRequest["source"];
}

export function transformLick(
  src: SourceLick,
  opts: TransformOptions,
): LickCreateRequest {
  const performanceKey = normalizeKey(src.key);
  const filteredChords = (src.chords ?? [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => c.length > 0);

  const out: LickCreateRequest = {
    source: opts.source,
    userId: null,
    title: src.title,
    instrument: opts.defaultInstrument,
    sheetData: transformSheetData(src.sheetData, performanceKey),
  };

  if (src.performer && src.performer.trim().length > 0) {
    out.performer = src.performer.trim();
  }
  if (src.album && src.album.trim().length > 0) {
    out.album = src.album.trim();
  }

  const style = maybeStyle(src.style);
  if (style) out.style = style;

  const rhythmFeel = maybeRhythmFeel(src.rhythmfeel);
  if (rhythmFeel) out.rhythmFeel = rhythmFeel;

  if (src.tempo != null && src.tempo > 0) out.tempo = src.tempo;
  if (performanceKey) out.key = performanceKey;
  if (src.sheetData?.timeSignature) out.timeSignature = src.sheetData.timeSignature;

  if (filteredChords.length > 0) out.chords = filteredChords;

  // harmonicContext, targetChord, chordsPerNote, features: omit -> backend auto-derives.

  return out;
}
