import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(`${ROOT}/public/jazz1460.json`, "utf8"));

const styleCounts = new Map();
const timeSigCounts = new Map();
const keyCounts = new Map();
const slashInQuality = []; // chord.quality containing "/"
const exampleByQuality = new Map(); // raw quality → list of example titles
const oddChord = []; // accidental issues etc.

for (const song of data) {
  styleCounts.set(song.style, (styleCounts.get(song.style) ?? 0) + 1);
  timeSigCounts.set(song.timeSignature, (timeSigCounts.get(song.timeSignature) ?? 0) + 1);
  keyCounts.set(song.key, (keyCounts.get(song.key) ?? 0) + 1);

  for (const sys of song.systems ?? []) {
    for (const bar of sys.bars ?? []) {
      for (const c of bar.chords ?? []) {
        if (c.isRepeat) continue;
        const q = c.quality ?? "";
        if (q.includes("/")) {
          if (slashInQuality.length < 20)
            slashInQuality.push({ title: song.title, root: c.root, quality: q, bass: c.bass });
        }
        if (q && !exampleByQuality.has(q)) exampleByQuality.set(q, song.title);
        if (c.root && !"ABCDEFG".includes(c.root)) {
          oddChord.push({ title: song.title, root: c.root, q });
        }
      }
    }
  }
}

console.log("=== ALL STYLES (count) ===");
for (const [s, n] of [...styleCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} ×  ${s}`);
}
console.log("\n=== TIME SIGS ===");
for (const [t, n] of [...timeSigCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} ×  ${t}`);
}
console.log("\n=== TOP KEYS ===");
for (const [k, n] of [...keyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${n.toString().padStart(4)} ×  ${k}`);
}
console.log("\n=== SLASH-IN-QUALITY (parser bugs?) ===");
for (const s of slashInQuality) console.log("  ", s);
console.log(`Total slash-in-quality chord cells: ${slashInQuality.length} (sample)`);

console.log("\n=== ODD ROOTS (non-ABCDEFG) ===");
for (const c of oddChord.slice(0, 20)) console.log("  ", c);
console.log(`Total odd roots: ${oddChord.length}`);
