/**
 * Final cross-validation: replay the actual leadSheetToChart logic (including
 * slash stripping and prefix matching) over jazz1460.json and report any
 * chord still hitting the warn/fallback path.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const QUALITY_MAP = {
  maj:"maj", maj6:"maj6", maj7:"maj7", maj9:"maj9",
  min:"min", min6:"min6", min7:"min7", min9:"min9", min11:"min11", minmaj7:"minmaj7",
  dom7:"dom7", dom9:"dom9", dom13:"dom13", dom7sus4:"7sus4",
  min7b5:"min7b5", dim:"dim", dim7:"dim7",
  aug:"aug", aug7:"aug7",
  sus2:"sus2", sus4:"sus4",
  "^":"maj","^7":"maj7","^9":"maj9","^6":"maj6","Δ":"maj","Δ7":"maj7",
  "6":"maj6","6/9":"maj6","69":"maj6",
  "^7#11":"maj7","^9#11":"maj9","^7#5":"maj7","^13":"maj9",
  add9:"maj",
  "-":"min","-7":"min7","-6":"min6","-9":"min9","-11":"min11",
  "-^7":"minmaj7","-Δ7":"minmaj7","-^9":"minmaj7", minmaj:"minmaj7",
  "-69":"min6","-b6":"min","-#5":"min",
  "7":"dom7","9":"dom9","13":"dom13",
  "7sus":"7sus4","9sus":"7sus4","13sus":"7sus4","7susadd3":"7sus4",
  "7alt":"7alt", alt:"7alt",
  "7b9":"7b9","7#9":"7#9","7#11":"7#11","7b13":"7b13",
  "7#5":"7b13","7b5":"7alt","9#11":"7#11","9#5":"aug7","9b5":"7alt",
  "13#11":"dom13","13b9":"7b9","13#9":"7#9",
  "7b9b5":"7b9","7b9#5":"7b9","7b9b13":"7b9","7b9#11":"7b9","7b9sus":"7b9","7b9#9":"7alt",
  "7#9b5":"7alt","7#9#5":"7alt","7#9#11":"7#9","7b13sus":"7b13",
  h:"min7b5", h7:"min7b5", h9:"min7b5", ø:"min7b5","ø7":"min7b5",
  o:"dim", o7:"dim7","°":"dim","°7":"dim7","o^7":"dim",
  "+":"aug","+7":"aug7",
  sus:"sus4","2":"sus2",
};

function resolveQuality(rawIn) {
  let raw = (rawIn ?? "").trim().replace(/\*/g, "");
  const slash = raw.indexOf("/");
  if (slash >= 0) raw = raw.slice(0, slash).trim();
  if (raw && QUALITY_MAP[raw]) return { quality: QUALITY_MAP[raw], how: "exact" };
  if (raw) {
    for (let len = raw.length; len > 0; len--) {
      const cand = raw.slice(0, len);
      if (QUALITY_MAP[cand]) return { quality: QUALITY_MAP[cand], how: `prefix:${cand}` };
    }
    return { quality: "maj", how: "FALLBACK_WARN", raw };
  }
  return { quality: "maj", how: "empty-default" };
}

const data = JSON.parse(readFileSync(`${ROOT}/public/jazz1460.json`, "utf8"));
const counts = { exact: 0, prefix: 0, fallback: 0, emptyDefault: 0 };
const fallbacks = new Map();
const prefixSamples = new Map();

for (const song of data) {
  for (const sys of song.systems ?? []) {
    for (const bar of sys.bars ?? []) {
      for (const c of bar.chords ?? []) {
        if (c.isRepeat) continue;
        if (c.root === "N.C.") continue;
        if (c.root == null) continue;
        const r = resolveQuality(c.quality);
        if (r.how === "exact") counts.exact++;
        else if (r.how.startsWith("prefix")) {
          counts.prefix++;
          const key = `${c.quality} → ${r.how}`;
          prefixSamples.set(key, (prefixSamples.get(key) ?? 0) + 1);
        }
        else if (r.how === "FALLBACK_WARN") {
          counts.fallback++;
          fallbacks.set(r.raw, (fallbacks.get(r.raw) ?? 0) + 1);
        }
        else counts.emptyDefault++;
      }
    }
  }
}

console.log("=== RESOLUTION BREAKDOWN ===");
console.log(JSON.stringify(counts, null, 2));
console.log(`\nCoverage: ${((counts.exact + counts.prefix + counts.emptyDefault) / (counts.exact + counts.prefix + counts.fallback + counts.emptyDefault) * 100).toFixed(3)}%`);

console.log("\n=== REMAINING FALLBACKS (would log warn) ===");
for (const [q, n] of [...fallbacks.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n} ×  "${q}"`);
}

console.log("\n=== PREFIX RESOLUTIONS (top 15 — lossy but tolerated) ===");
const sortedPrefix = [...prefixSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [k, n] of sortedPrefix) console.log(`  ${n.toString().padStart(4)} ×  ${k}`);
