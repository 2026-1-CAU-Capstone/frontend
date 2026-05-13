#!/usr/bin/env node
/**
 * Cross-validate jazz1460.json against leadSheetToChart's QUALITY_MAP.
 * Reports unknown qualities, missing roots, suspicious values, and
 * coverage of chord-symbol parsing.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const QUALITY_MAP_KEYS = new Set([
  // canonical
  "maj", "maj6", "maj7", "maj9",
  "min", "min6", "min7", "min9", "min11", "minmaj7",
  "dom7", "dom9", "dom13", "dom7sus4",
  "min7b5", "dim", "dim7",
  "aug", "aug7",
  "sus2", "sus4",
  // major shorthand
  "^", "^7", "^9", "^6", "Δ", "Δ7",
  "6", "6/9", "69",
  "^7#11", "^9#11", "^7#5", "^13",
  "add9",
  // minor shorthand
  "-", "-7", "-6", "-9", "-11",
  "-^7", "-Δ7", "-^9", "minmaj",
  "-69", "-b6", "-#5",
  // dominant
  "7", "9", "13",
  "7sus", "9sus", "13sus", "7susadd3",
  "7alt", "alt",
  "7b9", "7#9", "7#11", "7b13",
  "7#5", "7b5", "9#11", "9#5", "9b5",
  "13#11", "13b9", "13#9",
  "7b9b5", "7b9#5", "7b9b13", "7b9#11", "7b9sus", "7b9#9",
  "7#9b5", "7#9#5", "7#9#11", "7b13sus",
  // half-dim / dim
  "h", "h7", "h9", "ø", "ø7",
  "o", "o7", "°", "°7", "o^7",
  // aug
  "+", "+7",
  // sus
  "sus", "2",
]);

function prefixMatch(raw) {
  for (let len = raw.length; len > 0; len--) {
    if (QUALITY_MAP_KEYS.has(raw.slice(0, len))) return raw.slice(0, len);
  }
  return null;
}

const data = JSON.parse(readFileSync(`${ROOT}/public/jazz1460.json`, "utf8"));
console.log(`Loaded ${data.length} songs`);

const unknownQualityCounts = new Map();
const unknownNormalizedCounts = new Map();
const fallbackResolutions = new Map(); // raw → matched prefix
const stats = {
  totalChords: 0,
  realChords: 0,
  repeatChords: 0,
  emptyQualityCount: 0,
  withAnalysis: 0,
  withoutRoot: 0,
  bothAnalysisAndRaw: 0,
  unknownTimeSignatures: new Set(),
  unknownStyles: new Set(),
  unknownKeys: new Set(),
};

const STYLE_KEYWORDS = [
  "ballad", "up", "slow", "swing", "medium", "shuffle",
  "bossa", "samba", "afro", "6/8", "songo", "mambo", "cha",
  "waltz", "funk", "rock", "rubato",
];

const songIssues = [];

for (const song of data) {
  const issues = [];
  if (!song.timeSignature) issues.push("missing timeSignature");
  else if (!/^\d+\/\d+$/.test(song.timeSignature)) {
    stats.unknownTimeSignatures.add(song.timeSignature);
    issues.push(`weird timeSignature ${song.timeSignature}`);
  }
  if (song.style) {
    const s = song.style.toLowerCase();
    const matched = STYLE_KEYWORDS.some((k) => s.includes(k));
    if (!matched) stats.unknownStyles.add(song.style);
  }
  if (!song.key) issues.push("missing key");

  for (const system of song.systems ?? []) {
    for (const bar of system.bars ?? []) {
      for (const chord of bar.chords ?? []) {
        stats.totalChords++;
        if (chord.isRepeat) { stats.repeatChords++; continue; }
        stats.realChords++;

        const hasRoot = chord.root != null;
        const hasAnalysisRoot = chord.analysis?.rootPc != null;
        if (!hasRoot && !hasAnalysisRoot) {
          stats.withoutRoot++;
          issues.push(`chord without root`);
          continue;
        }
        if (chord.analysis) stats.withAnalysis++;
        if (chord.analysis && chord.quality) stats.bothAnalysisAndRaw++;

        // Quality coverage check
        const canonical = chord.analysis?.normalizedQuality;
        const raw = (chord.quality ?? "").trim();

        if (!canonical && !raw) {
          stats.emptyQualityCount++;
          // empty quality → leadSheetToChart returns "maj" silently (no warn)
          continue;
        }

        let resolved = false;
        if (canonical && QUALITY_MAP_KEYS.has(canonical)) resolved = true;
        else if (raw && QUALITY_MAP_KEYS.has(raw)) resolved = true;
        else if (raw) {
          const pm = prefixMatch(raw);
          if (pm) {
            resolved = true;
            fallbackResolutions.set(raw, (fallbackResolutions.get(raw) ?? new Map()));
            fallbackResolutions.get(raw).set(pm, (fallbackResolutions.get(raw).get(pm) ?? 0) + 1);
          }
        }

        if (!resolved) {
          if (canonical) unknownNormalizedCounts.set(canonical, (unknownNormalizedCounts.get(canonical) ?? 0) + 1);
          if (raw) unknownQualityCounts.set(raw, (unknownQualityCounts.get(raw) ?? 0) + 1);
        }
      }
    }
  }

  if (issues.length > 0) songIssues.push({ title: song.title, issues });
}

console.log("\n=== STATS ===");
console.log(JSON.stringify({
  totalChords: stats.totalChords,
  realChords: stats.realChords,
  repeatChords: stats.repeatChords,
  emptyQualityCount: stats.emptyQualityCount,
  withAnalysis: stats.withAnalysis,
  withoutRoot: stats.withoutRoot,
  bothAnalysisAndRaw: stats.bothAnalysisAndRaw,
  unknownTimeSignatures: [...stats.unknownTimeSignatures],
  unknownStyles: [...stats.unknownStyles],
  unknownKeys: [...stats.unknownKeys],
}, null, 2));

console.log("\n=== UNKNOWN RAW QUALITIES (top 50 by frequency) ===");
const sortedRaw = [...unknownQualityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
for (const [q, n] of sortedRaw) console.log(`  ${n.toString().padStart(6)} ×  "${q}"`);

console.log("\n=== UNKNOWN NORMALIZED QUALITIES ===");
for (const [q, n] of [...unknownNormalizedCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(6)} ×  "${q}"`);
}

console.log("\n=== TOP FALLBACK (prefix-match) RESOLUTIONS (samples) ===");
const flatFallback = [];
for (const [raw, map] of fallbackResolutions) {
  for (const [pref, count] of map) flatFallback.push({ raw, pref, count });
}
flatFallback.sort((a, b) => b.count - a.count);
for (const { raw, pref, count } of flatFallback.slice(0, 40)) {
  console.log(`  ${count.toString().padStart(5)} × "${raw}"  →  "${pref}"`);
}

console.log(`\n=== SONG-LEVEL ISSUES (${songIssues.length} songs) ===`);
for (const s of songIssues.slice(0, 25)) {
  console.log(`  ${s.title}: ${s.issues.join("; ")}`);
}
if (songIssues.length > 25) console.log(`  ... and ${songIssues.length - 25} more`);
