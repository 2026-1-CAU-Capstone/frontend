/* Throwaway smoke test for the leadSheetToChart adapter.
 * Run: npx tsx scripts/smoketest-leadSheetToChart.ts
 * Not wired into any CI; delete when no longer useful. */

import { leadSheetToChart } from "../src/lib/backing/adapters/leadSheetToChart";
import { allOfMe } from "../src/data/allOfMe";

const chart = leadSheetToChart(allOfMe);

console.log("── Chart header ──");
console.log({
  title: chart.title,
  composer: chart.composer,
  key: chart.key,
  bpm: chart.bpm,
  timeSig: chart.timeSig,
  defaultStyle: chart.defaultStyle,
  defaultFeel: chart.defaultFeel,
  sectionCount: chart.sections.length,
});

console.log("\n── Section summary ──");
for (let si = 0; si < chart.sections.length; si++) {
  const sec = chart.sections[si];
  console.log(
    `[${si}] label=${sec.label ?? "-"}  bars=${sec.bars.length}  rs=${sec.repeatStart ?? false} re=${sec.repeatEnd ?? false}`
  );
}

console.log("\n── All bars (flat) ──");
let barIdx = 0;
for (const sec of chart.sections) {
  for (const bar of sec.bars) {
    const chordStrs = bar.chords.map(
      (c) => `${c.symbol}→(pc${c.root},${c.quality},b${c.beats})`
    );
    console.log(`m${String(bar.measureNumber ?? barIdx + 1).padStart(2)}  [${sec.label ?? ""}]  ${chordStrs.join("  |  ")}`);
    barIdx++;
  }
}

// Basic invariants
const errors: string[] = [];
for (const sec of chart.sections) {
  for (const bar of sec.bars) {
    if (bar.chords.length === 0) {
      errors.push(`empty bar: measure ${bar.measureNumber}`);
    }
    const totalBeats = bar.chords.reduce((s, c) => s + c.beats, 0);
    if (Math.abs(totalBeats - chart.timeSig[0]) > 0.001) {
      errors.push(
        `beat sum mismatch at measure ${bar.measureNumber}: got ${totalBeats}, want ${chart.timeSig[0]}`
      );
    }
    for (const c of bar.chords) {
      if (c.root < 0 || c.root > 11 || !Number.isInteger(c.root)) {
        errors.push(`bad root pc at measure ${bar.measureNumber}: ${c.root}`);
      }
    }
  }
}

console.log("\n── Invariants ──");
if (errors.length === 0) {
  console.log("OK (no issues)");
} else {
  console.log(`FAILED (${errors.length} issue${errors.length > 1 ? "s" : ""}):`);
  for (const e of errors) console.log("  -", e);
  process.exit(1);
}
