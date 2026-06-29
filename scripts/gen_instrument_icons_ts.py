#!/usr/bin/env python3
"""Generate src/data/instrumentIcons.ts from the split manifest.json.
Single source of truth: slug -> {en, ko, file, cat}, the ordered category list,
and the app-key -> slug aliases used by the selectors."""
import json, os

base = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(base, "../public/icons/sessions/manifest.json")))

# slug -> category key
CAT = {}
for s in ["piano", "upright-piano", "rhodes-piano", "hammond-organ", "accordion"]:
    CAT[s] = "keyboard"
for s in ["soprano-saxophone", "alto-saxophone", "tenor-saxophone", "baritone-saxophone"]:
    CAT[s] = "sax"
for s in ["trumpet", "cornet", "flugelhorn", "trombone", "french-horn"]:
    CAT[s] = "brass"
for s in ["clarinet", "flute", "piccolo"]:
    CAT[s] = "woodwind"
for s in ["violin", "cello", "harp", "contrabass", "electric-bass"]:
    CAT[s] = "strings"
for s in ["electric-guitar", "archtop-guitar", "ukulele"]:
    CAT[s] = "guitar"
for s in ["vibraphone", "marimba", "glockenspiel", "tubular-bells", "handpan"]:
    CAT[s] = "mallet"
for s in ["drum-kit", "drum-kit-synth", "drum-kit-acoustic", "drum-kit-brushes", "drum-kit-latin",
          "bongos", "timbales", "cajon", "djembe", "tambourine", "maracas", "cowbell", "triangle",
          "cabasa", "shaker", "agogo-bells", "guiro", "claves", "pandeiro", "steelpan", "woodblock"]:
    CAT[s] = "percussion"
for s in ["vocal", "chromatic-harmonica", "whistling", "kazoo", "jug"]:
    CAT[s] = "voice"

CAT_ORDER = [
    ("keyboard", "건반"), ("sax", "색소폰"), ("brass", "금관"), ("woodwind", "목관"),
    ("strings", "현악"), ("guitar", "기타"), ("mallet", "말렛·멜로딕"),
    ("percussion", "타악기"), ("voice", "보컬·기타"),
]

missing = [m["slug"] for m in manifest if m["slug"] not in CAT]
if missing:
    raise SystemExit("No category for: " + ", ".join(missing))

def en(slug):
    return " ".join(w.capitalize() for w in slug.split("-"))

rows = ",\n".join(
    "  {{ slug: {s}, en: {e}, ko: {k}, file: {f}, cat: {c} }}".format(
        s=json.dumps(m["slug"]), e=json.dumps(en(m["slug"])),
        k=json.dumps(m["ko"], ensure_ascii=False), f=json.dumps(m["file"], ensure_ascii=False),
        c=json.dumps(CAT[m["slug"]]))
    for m in manifest
)
cats = ",\n".join(
    "  {{ key: {k}, label: {l} }}".format(k=json.dumps(k), l=json.dumps(l, ensure_ascii=False))
    for (k, l) in CAT_ORDER
)

ts = '''/* AUTO-GENERATED — do not edit by hand.
 * Regenerate: python3 scripts/gen_instrument_icons_ts.py
 *
 * Registry for the 56 line-art instrument icons in /public/icons/sessions/
 * (each square, transparent, named "<english-slug>_<한글>.png"). */

export interface InstrumentIcon {
  slug: string;
  en: string;
  ko: string;
  file: string;
  cat: string;
}

export interface InstrumentCategory {
  key: string;
  label: string;
}

export const INSTRUMENT_ICONS: InstrumentIcon[] = [
''' + rows + ''',
];

/** Display order for grouping icons into a categorized picker. */
export const CATEGORIES: InstrumentCategory[] = [
''' + cats + ''',
];

const FILE_BY_SLUG: Record<string, string> = Object.fromEntries(
  INSTRUMENT_ICONS.map((i) => [i.slug, i.file]),
);

/** Public URL for an icon slug, or null when the slug has no icon. */
export function instrumentIconUrl(slug: string | undefined | null): string | null {
  if (!slug) return null;
  const f = FILE_BY_SLUG[slug];
  return f ? `/icons/sessions/${f}` : null;
}

/* ── App instrument-key → icon slug aliases ──────────────────────────────── */

/** SessionPicker legacy ids → icon slug (back-compat for older saved values). */
export const SESSION_ICON_SLUG: Record<string, string> = {
  vocal: 'vocal',
  trumpet: 'trumpet',
  sax: 'alto-saxophone',
  piano: 'piano',
  drums: 'drum-kit',
  bass: 'contrabass',
  guitar: 'electric-guitar',
};

/** Mixer melody-instrument ids (MelodyInstrumentId). */
export const MELODY_ICON_SLUG: Record<string, string> = {
  piano: 'piano',
  electric_piano_1: 'rhodes-piano',
  drawbar_organ: 'hammond-organ',
  accordion: 'accordion',
  soprano_sax: 'soprano-saxophone',
  alto_sax: 'alto-saxophone',
  tenor_sax: 'tenor-saxophone',
  baritone_sax: 'baritone-saxophone',
  trumpet: 'trumpet',
  trombone: 'trombone',
  clarinet: 'clarinet',
  flute: 'flute',
  piccolo: 'piccolo',
  violin: 'violin',
  cello: 'cello',
  orchestral_harp: 'harp',
  harmonica: 'chromatic-harmonica',
  electric_guitar_jazz: 'archtop-guitar',
  vibraphone: 'vibraphone',
  marimba: 'marimba',
  glockenspiel: 'glockenspiel',
  tubular_bells: 'tubular-bells',
};

/** Drum-kit ids (DrumKitId). */
export const DRUMKIT_ICON_SLUG: Record<string, string> = {
  synth: 'drum-kit-synth',
  brushes: 'drum-kit-brushes',
  sticks: 'drum-kit-acoustic',
};
'''

out = os.path.join(base, "../src/data/instrumentIcons.ts")
open(out, "w").write(ts)
print("wrote src/data/instrumentIcons.ts with", len(manifest), "icons,", len(CAT_ORDER), "categories")
