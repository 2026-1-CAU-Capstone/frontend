/**
 * One-shot bulk rename + transpose for the "도로시 N" series of licks.
 *
 * Reads the table the user pasted (TRANSFORMS below), finds the matching
 * lick in the backend by current title ("도로시 4" etc.), and PUTs an
 * updated entry: title becomes "{song} m{measure}", key/notes/chords are
 * transposed from F to the target key (or kept if "F → F").
 *
 * Usage:
 *   npx tsx scripts/renameDorothyLicks.ts          # dry-run (prints diff, no mutation)
 *   npx tsx scripts/renameDorothyLicks.ts --apply  # actually PUT updates
 *
 * Title collisions (e.g. #10 and #18 both map to "Now's The Time 1 m46")
 * are auto-disambiguated by appending " #N" using the source dorothy number.
 */

import { fetchAllLicks } from "../src/api/licks";
import { transposeLick, semitonesBetween } from "../src/lib/transpose";
import type { LickEntry } from "../src/data/lickData";

interface Transform {
  /** dorothy number — matches existing title "도로시 N" */
  num: number;
  /** target song title */
  song: string;
  /** measure number where the matched lick starts */
  measure: number;
  /** chord at the matched position (for info only) */
  chord: string;
  /** original key — every lick in this set was generated in F major */
  fromKey: string;
  /** target key after transpose */
  toKey: string;
}

const TRANSFORMS: Transform[] = [
  { num: 4,  song: "Celerity",          measure: 23,  chord: "C-7",    fromKey: "F-maj", toKey: "Bb-maj" },
  { num: 5,  song: "Au Privave 1",      measure: 44,  chord: "D7",     fromKey: "F-maj", toKey: "F-maj" },
  { num: 6,  song: "Au Privave 2",      measure: 9,   chord: "G-7",    fromKey: "F-maj", toKey: "F-maj" },
  { num: 7,  song: "Laird Baird",       measure: 10,  chord: "C-7",    fromKey: "F-maj", toKey: "Bb-maj" },
  { num: 8,  song: "Donna Lee",         measure: 69,  chord: "Bb-7",   fromKey: "F-maj", toKey: "Ab-maj" },
  { num: 9,  song: "Marmaduke",         measure: 50,  chord: "C-7",    fromKey: "F-maj", toKey: "Bb-maj" },
  { num: 10, song: "Now's The Time 1",  measure: 46,  chord: "G-7",    fromKey: "F-maj", toKey: "F-maj" },
  { num: 11, song: "Billie's Bounce",   measure: 46,  chord: "G-7",    fromKey: "F-maj", toKey: "F-maj" },
  { num: 12, song: "Chasing The Bird",  measure: 55,  chord: "G-7",    fromKey: "F-maj", toKey: "F-maj" },
  { num: 13, song: "Card Board",        measure: 45,  chord: "D-7",    fromKey: "F-maj", toKey: "C-maj" },
  { num: 14, song: "Ko Ko",             measure: 15,  chord: "C-7",    fromKey: "F-maj", toKey: "Eb-maj" },
  { num: 15, song: "The Bird",          measure: 21,  chord: "F-7",    fromKey: "F-maj", toKey: "Eb-maj" },
  { num: 16, song: "Diverse",           measure: 53,  chord: "Eb-7",   fromKey: "F-maj", toKey: "Db-maj" },
  { num: 17, song: "Laird Baird",       measure: 27,  chord: "Am7b5",  fromKey: "F-maj", toKey: "G-maj" },
  { num: 18, song: "Now's The Time 1",  measure: 46,  chord: "G-7",    fromKey: "F-maj", toKey: "F-maj" },
  { num: 19, song: "Warming Up A Riff", measure: 122, chord: "A-7",    fromKey: "F-maj", toKey: "G-maj" },
  { num: 20, song: "Back Home Blues",   measure: 22,  chord: "D-7",    fromKey: "F-maj", toKey: "C-maj" },
];

const API_BASE = "https://jazzify.p-e.kr/api";
const HARMONIC_ENUM = new Set(["blues", "other", "major", "minor"]);

/** Build the new title — bare song title, no measure suffix. Collisions are
 *  intentionally left in place per user request ("무조건 그 곡 제목으로만"). */
function buildTitle(t: Transform, _takenTitles: Set<string>): string {
  return t.song;
}

/** Possible current titles a 도로시 N lick could have right now, in priority
 *  order. We try each when looking up the lick so re-runs work whether the
 *  previous rename was applied or not. */
function candidateCurrentTitles(t: Transform): string[] {
  return [
    t.song,                              // already at final state (re-run no-op)
    `${t.song} m${t.measure} #${t.num}`, // disambiguated form (#18 case)
    `${t.song} m${t.measure}`,           // standard m{measure} form
    `도로시 ${t.num}`,                    // original pre-rename form
  ];
}

/** Send a PUT /licks/{publicId} update with the transformed entry. */
async function pushUpdate(publicId: string, entry: LickEntry): Promise<void> {
  const harmonicContext = entry.tag && HARMONIC_ENUM.has(entry.tag) ? entry.tag : null;
  const body = {
    performer: entry.performer,
    title: entry.title,
    album: entry.album ?? "",
    instrument: entry.instrument,
    style: entry.style || null,
    tempo: entry.tempo,
    key: entry.key,
    rhythmFeel: entry.rhythmfeel || null,
    timeSignature: entry.sheetData.timeSignature || "4/4",
    chords: entry.chords.filter((c) => c.length > 0),
    harmonicContext,
    sheetData: entry.sheetData,
    nEvents: entry.nEvents,
    intervals: entry.intervals,
    parsons: entry.parsons,
    fuzzyIntervals: entry.fuzzyIntervals,
    durationClasses: entry.durationClasses,
  };
  const res = await fetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; detail?: string };
      detail = j.detail || j.message || "";
    } catch { /* ignore */ }
    throw new Error(`PUT ${publicId} failed: ${res.status} ${detail}`.trim());
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`mode: ${apply ? "APPLY (will mutate backend)" : "DRY-RUN (no mutation)"}`);
  console.log("fetching all licks ...");
  const all = await fetchAllLicks();
  console.log(`fetched ${all.length} licks total\n`);

  // Build a multi-value lookup since post-rename duplicate titles are allowed.
  const byTitle = new Map<string, LickEntry[]>();
  for (const l of all) {
    const arr = byTitle.get(l.title) ?? [];
    arr.push(l);
    byTitle.set(l.title, arr);
  }

  // Pre-compute titles + transposed payloads
  const takenTitles = new Set<string>();
  const plan: Array<{
    t: Transform;
    src: LickEntry;
    newTitle: string;
    newKey: string;
    newChords: string[];
    newSheet: LickEntry["sheetData"];
    semis: number;
  }> = [];
  const missing: number[] = [];

  const conflicts: string[] = [];

  // Track which publicIds we've already claimed in this run so two
  // TRANSFORMS targeting the same song (e.g. #10 and #18 → "Now's The Time 1")
  // don't both grab the same lick from byTitle.
  const claimedIds = new Set<string | number>();

  for (const t of TRANSFORMS) {
    let src: LickEntry | undefined;
    for (const candidate of candidateCurrentTitles(t)) {
      const matches = byTitle.get(candidate);
      if (!matches) continue;
      const free = matches.find((m) => !claimedIds.has(m.id));
      if (free) { src = free; break; }
    }
    if (!src) {
      missing.push(t.num);
      continue;
    }
    claimedIds.add(src.id);
    // Trust the backend's currently-stored key as the source of truth — the
    // user may have already used the /licks Transpose button on some licks.
    // If backend says it's already in the target key, no transposition is
    // applied (just a rename + instrument tag).
    const backendFromKey = src.key;
    const semis = semitonesBetween(backendFromKey, t.toKey);
    const semisExpected = semitonesBetween(t.fromKey, t.toKey);
    if (semis !== semisExpected) {
      const dispOld = backendFromKey.replace(/-maj$/, "").replace(/-min$/, "m");
      const dispExpected = t.fromKey.replace(/-maj$/, "");
      conflicts.push(
        `  ⚠ #${t.num}: 표는 "${dispExpected}"에서 시작한다고 했지만 백엔드 저장값은 "${dispOld}"입니다. ` +
        `백엔드 값을 신뢰해서 "${dispOld} → ${t.toKey.replace(/-maj$/, "")}"로 처리합니다 (이미 이조됐을 가능성).`,
      );
    }
    const transposed = transposeLick(src.sheetData, src.chords, backendFromKey, t.toKey);
    if (!transposed) {
      console.warn(`  #${t.num} transpose failed (key parse): ${backendFromKey} → ${t.toKey}`);
      continue;
    }
    const newTitle = buildTitle(t, takenTitles);
    plan.push({
      t,
      src,
      newTitle,
      newKey: transposed.key,
      newChords: transposed.chords,
      newSheet: transposed.sheetData,
      semis: 0,
    });
  }

  // Find any 도로시 N licks NOT covered by TRANSFORMS — those still need the
  // instrument='as' update even though we don't rename/transpose them.
  const extraDorothyLicks = all.filter(
    (l) => /^도로시 \d+$/.test(l.title) && !claimedIds.has(l.id),
  );

  if (conflicts.length > 0) {
    console.log("KEY CONFLICTS (table vs backend, root-pitch level — format diffs are ignored):");
    for (const c of conflicts) console.log(c);
    console.log();
  }

  // Print plan
  console.log("plan (rename + transpose + instrument='as'):");
  console.log("  #N | publicId             | old title       → new title             | key                | instrument");
  console.log("  ---|----------------------|-----------------------------------------|--------------------|-----------");
  for (const p of plan) {
    const oldKey = p.src.key.replace(/-maj$/, "").replace(/-min$/, "m");
    const newKey = p.newKey.replace(/-maj$/, "").replace(/-min$/, "m");
    const keyStr = oldKey === newKey ? `${newKey} (no change)` : `${oldKey} → ${newKey}`;
    const pid = String(p.src.id).slice(0, 20).padEnd(20);
    const instr = `${p.src.instrument || "?"} → as`;
    console.log(
      `  #${String(p.t.num).padStart(2)} | ${pid} | ` +
      `"${p.src.title}" → "${p.newTitle}" | ${keyStr.padEnd(18)} | ${instr}`,
    );
  }
  if (missing.length > 0) {
    console.log(`\n  MISSING (no "도로시 N" match in backend): ${missing.join(", ")}`);
  }
  if (extraDorothyLicks.length > 0) {
    console.log(`\n도로시 N (TRANSFORMS 미포함, instrument만 'as'로 변경):`);
    for (const l of extraDorothyLicks) {
      const pid = String(l.id).slice(0, 20).padEnd(20);
      console.log(`  · ${pid} | "${l.title}" | instrument: ${l.instrument || "?"} → as`);
    }
  }
  console.log();

  if (!apply) {
    console.log("dry-run: nothing was modified.");
    console.log("re-run with --apply to commit the changes.");
    return;
  }

  console.log("applying updates ...");
  let ok = 0;
  let fail = 0;
  // Phase 1: full rename + transpose + instrument
  for (const p of plan) {
    try {
      const updated: LickEntry = {
        ...p.src,
        title: p.newTitle,
        instrument: "as",
        key: p.newKey,
        chords: p.newChords,
        sheetData: { ...p.newSheet, key: p.newKey },
        // intervals/parsons/fuzzyIntervals/durationClasses are transposition-invariant
      };
      await pushUpdate(String(p.src.id), updated);
      console.log(`  ✓ #${p.t.num}  "${p.src.title}" → "${p.newTitle}"  (instrument=as)`);
      ok++;
    } catch (err) {
      console.error(`  ✗ #${p.t.num}  ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  // Phase 2: instrument-only update for 도로시 N licks not in TRANSFORMS
  for (const l of extraDorothyLicks) {
    try {
      const updated: LickEntry = { ...l, instrument: "as" };
      await pushUpdate(String(l.id), updated);
      console.log(`  ✓ "${l.title}" instrument → as`);
      ok++;
    } catch (err) {
      console.error(`  ✗ "${l.title}" ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  console.log(`\ndone: ${ok} succeeded, ${fail} failed.`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
