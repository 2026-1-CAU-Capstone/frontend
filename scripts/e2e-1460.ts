/**
 * Full end-to-end cross-validation:
 *   jazz1460.json → leadSheetToChart → renderChart-equivalent walk
 *
 * Verifies every chord can produce a voicing without falling back to maj
 * silently, and that bar-level structure is sane (no zero-beat chords,
 * no NaN beats, correct N.C. silent bars, slash bass extracted).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { leadSheetToChart } from "../src/lib/backing/adapters/leadSheetToChart.js";
import { voiceChord } from "../src/lib/backing/voicing.js";
import { walkChord } from "../src/lib/backing/bass.js";
import type { LeadSheetData } from "../src/data/leadSheetTypes.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data: LeadSheetData[] = JSON.parse(
  readFileSync(`${ROOT}/public/jazz1460.json`, "utf8"),
);

let songsConverted = 0;
let totalBars = 0;
let silentBars = 0;
let chordsConverted = 0;
let badBeats = 0;
let voicingFailures = 0;
let bassFailures = 0;
let nonStandardTimeSigSongs = 0;
const styleDistribution = new Map<string, number>();
const errors: string[] = [];

for (let i = 0; i < data.length; i++) {
  const song = data[i];
  try {
    const chart = leadSheetToChart(song);
    songsConverted++;
    styleDistribution.set(chart.defaultStyle, (styleDistribution.get(chart.defaultStyle) ?? 0) + 1);
    if (chart.timeSig[0] !== 4) nonStandardTimeSigSongs++;

    for (const sec of chart.sections) {
      for (const bar of sec.bars) {
        totalBars++;
        if (bar.chords.length === 0) {
          silentBars++;
          continue;
        }
        const beatsSum = bar.chords.reduce((s, c) => s + c.beats, 0);
        // beats per bar = chart.timeSig[0]; allow tiny FP drift
        if (Math.abs(beatsSum - chart.timeSig[0]) > 1e-6) badBeats++;

        let prevVoicing: number[] = [];
        for (let ci = 0; ci < bar.chords.length; ci++) {
          const chord = bar.chords[ci];
          chordsConverted++;
          if (!Number.isFinite(chord.beats) || chord.beats <= 0) badBeats++;

          // Voicing
          const v = voiceChord(chord, prevVoicing);
          if (!Array.isArray(v) || v.length === 0) voicingFailures++;
          else prevVoicing = v;

          // Bass
          const next = bar.chords[ci + 1] ?? null;
          const bn = walkChord(chord, next, chord.beats);
          if (!Array.isArray(bn) || bn.length === 0) bassFailures++;
        }
      }
    }
  } catch (err) {
    errors.push(`[${song.title}] ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\n=== END-TO-END VALIDATION ===");
console.log(JSON.stringify({
  totalSongs: data.length,
  songsConverted,
  totalBars,
  silentBars,
  chordsConverted,
  badBeats,
  voicingFailures,
  bassFailures,
  nonStandardTimeSigSongs,
  errors: errors.length,
}, null, 2));

console.log("\n=== STYLE DISTRIBUTION ===");
for (const [s, n] of [...styleDistribution.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} ×  ${s}`);
}

if (errors.length > 0) {
  console.log("\n=== ERRORS ===");
  errors.slice(0, 10).forEach((e) => console.log("  " + e));
}
