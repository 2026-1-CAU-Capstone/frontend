/* ─────────────────────────────────────────────────────────────────────────
 * Structural-analysis scorer.
 *
 * Compares a model's predicted {key, iiVi, romans} against the gold answer and
 * returns per-item + aggregate metrics:
 *   - keyHit      : predicted key ∈ gold keys (normalized)
 *   - iiVi P/R/F1 : set of [ii,V,I] index triples (exact triple match)
 *   - romanAcc    : fraction of chords with the correct Roman numeral
 *
 * Pure JS, no deps. Run `node benchmark/scorer.mjs --selftest` for a demo.
 * ──────────────────────────────────────────────────────────────────────── */

/** Normalize a key string so "C", "C major", "Cmaj", "C-maj" all match. */
export function normKey(k) {
  return String(k ?? '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\bmajor\b/g, '')
    .replace(/\bmaj\b/g, '')
    .replace(/\bminor\b/g, 'm')
    .replace(/\bmin\b/g, 'm')
    .replace(/\s+/g, '')
    .trim();
}

/** Normalize a Roman numeral token for loose comparison. */
export function normRoman(r) {
  return String(r ?? '')
    .toLowerCase()
    .replace(/[\s.]/g, '')
    .replace(/△|Δ|maj7|ma7/g, 'maj7')
    .replace(/ø|m7b5|min7b5|halfdim/g, 'ø7')
    .replace(/[-]/g, '') // strip the "-" jazz minor marker so ii-7 == ii7
    .replace(/dom7?/g, '7');
}

const tripleKey = (t) => `${t[0]}-${t[1]}-${t[2]}`;

/** Score one item. pred = { key, iiVi, romans }, gold = item from gold set. */
export function scoreItem(pred, gold) {
  // ── key — gold.keys is a list of ACCEPTABLE answers, each an array of key
  // names. A modulation needs all keys in one set ([["C","Bb"]]); alternative
  // spellings are separate sets ([["D minor"],["D dorian"]]). keyHit if the
  // predicted set exactly equals any acceptable set. "C, Bb" answers split. ──
  const splitKeys = (s) => String(s ?? '').split(/[,/&]|\band\b|\bor\b/i).map(normKey).filter(Boolean);
  const predKeys = new Set(splitKeys(pred.key));
  const accepts = (gold.keys ?? []).map((set) => new Set((Array.isArray(set) ? set : [set]).map(normKey)));
  const keyHit = accepts.some((g) => g.size === predKeys.size && [...g].every((k) => predKeys.has(k))) ? 1 : 0;

  // ── ii-V-I (set of index triples) ──
  const goldSet = new Set((gold.iiVi ?? []).map(tripleKey));
  const predTriples = Array.isArray(pred.iiVi) ? pred.iiVi.filter((t) => Array.isArray(t) && t.length === 3) : [];
  const predSet = new Set(predTriples.map(tripleKey));
  let tp = 0;
  for (const t of predSet) if (goldSet.has(t)) tp++;
  const precision = predSet.size === 0 ? (goldSet.size === 0 ? 1 : 0) : tp / predSet.size;
  const recall = goldSet.size === 0 ? (predSet.size === 0 ? 1 : 0) : tp / goldSet.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // ── Roman numerals (per-chord accuracy, only if lengths line up) ──
  let romanAcc = null;
  if (Array.isArray(gold.romans) && Array.isArray(pred.romans) && pred.romans.length === gold.romans.length) {
    let correct = 0;
    for (let i = 0; i < gold.romans.length; i++) {
      if (normRoman(pred.romans[i]) === normRoman(gold.romans[i])) correct++;
    }
    romanAcc = correct / gold.romans.length;
  }

  return { id: gold.id, keyHit, precision, recall, f1, romanAcc, tp, predN: predSet.size, goldN: goldSet.size };
}

/** Aggregate per-item scores into headline numbers. */
export function aggregate(scores) {
  const n = scores.length || 1;
  const mean = (sel) => scores.reduce((s, x) => s + sel(x), 0) / n;
  const romanScores = scores.filter((s) => s.romanAcc != null);
  // Micro-averaged ii-V-I over the whole set (truer than averaging F1s).
  const TP = scores.reduce((s, x) => s + x.tp, 0);
  const P = scores.reduce((s, x) => s + x.predN, 0);
  const G = scores.reduce((s, x) => s + x.goldN, 0);
  const microP = P === 0 ? 1 : TP / P;
  const microR = G === 0 ? 1 : TP / G;
  const microF1 = microP + microR === 0 ? 0 : (2 * microP * microR) / (microP + microR);
  return {
    items: scores.length,
    keyAcc: mean((x) => x.keyHit),
    iiViMacroF1: mean((x) => x.f1),
    iiViMicroP: microP,
    iiViMicroR: microR,
    iiViMicroF1: microF1,
    romanAcc: romanScores.length ? romanScores.reduce((s, x) => s + x.romanAcc, 0) / romanScores.length : null,
  };
}

/* ── Task B: theory facts ──────────────────────────────────────────────── */

/** Normalize a short factual answer for matching. */
export function normFact(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\bflat\b/g, 'b').replace(/\bsharp\b/g, '#')
    .replace(/\bmajor\b/g, 'maj').replace(/\bminor\b/g, 'm').replace(/\bmin\b/g, 'm')
    .replace(/[\s,.'"`/–—→-]/g, ''); // also strip dashes/arrows/slashes
}

/** pred = { answer }, gold = { id, q, accept:[...] }. Hit if the normalized
 *  answer equals or contains an accepted form. */
export function scoreTheory(pred, gold) {
  const ans = normFact(pred.answer);
  const accept = (gold.accept ?? []).map(normFact);
  const hit = ans.length > 0 && accept.some((a) => a.length > 0 && (ans === a || ans.includes(a))) ? 1 : 0;
  return { id: gold.id, hit };
}

export function aggregateTheory(scores) {
  const n = scores.length || 1;
  return { items: scores.length, accuracy: scores.reduce((s, x) => s + x.hit, 0) / n };
}

/* ── Task D: hallucination probes ──────────────────────────────────────── */

/** pred = { answer } (full reply text). gold trap items have goodSignals
 *  (phrases that show the model correctly refused/corrected); control items
 *  have accept (the real answer). */
export function scoreHallucination(pred, gold) {
  const ans = String(pred.answer ?? '').toLowerCase();
  if (gold.type === 'control') {
    const accept = (gold.accept ?? []).map((s) => normFact(s));
    const a2 = normFact(ans);
    const correct = accept.some((a) => a.length > 0 && a2.includes(a)) ? 1 : 0;
    return { id: gold.id, type: 'control', correct, hallucinated: 0 };
  }
  const signals = (gold.goodSignals ?? []).map((s) => s.toLowerCase());
  const abstained = signals.some((s) => ans.includes(s)) ? 1 : 0;
  return { id: gold.id, type: 'trap', abstained, hallucinated: abstained ? 0 : 1 };
}

export function aggregateHallucination(scores) {
  const traps = scores.filter((s) => s.type === 'trap');
  const ctrls = scores.filter((s) => s.type === 'control');
  return {
    items: scores.length,
    hallucinationRate: traps.length ? traps.reduce((a, s) => a + s.hallucinated, 0) / traps.length : null,
    controlAcc: ctrls.length ? ctrls.reduce((a, s) => a + s.correct, 0) / ctrls.length : null,
  };
}

const pct = (x) => (x == null ? '  —  ' : `${(x * 100).toFixed(1)}%`);

/** Markdown for Task B. */
export function theoryCardMarkdown(byCondition) {
  let md = '| 조건 | 이론 팩트 정확도 |\n|---|---|\n';
  for (const [name, a] of Object.entries(byCondition)) md += `| ${name} | ${pct(a.accuracy)} |\n`;
  return md;
}

/** Markdown for Task D (lower hallucination = better). */
export function hallucinationCardMarkdown(byCondition) {
  let md = '| 조건 | 할루시네이션율 (낮을수록 ↑) | 컨트롤 정확도 |\n|---|---|---|\n';
  for (const [name, a] of Object.entries(byCondition)) md += `| ${name} | ${pct(a.hallucinationRate)} | ${pct(a.controlAcc)} |\n`;
  return md;
}

/* ── Task C: explanatory (LLM-judge, 1-5 → 0-1) ────────────────────────── */

export function aggregateExplanatory(scores) {
  const n = scores.length || 1;
  const mean5 = scores.reduce((s, x) => s + (x.score5 ?? 0), 0) / n;
  return { items: scores.length, meanScore5: mean5, normalized: (mean5 - 1) / 4 };
}

export function explanatoryCardMarkdown(byCondition) {
  let md = '| 조건 | 평균 점수 (1-5) | 정규화 |\n|---|---|---|\n';
  for (const [name, a] of Object.entries(byCondition)) md += `| ${name} | ${a.meanScore5.toFixed(2)} | ${pct(a.normalized)} |\n`;
  return md;
}

/** Render a markdown scorecard from { conditionName: aggregate } map. */
export function scorecardMarkdown(byCondition) {
  const rows = Object.entries(byCondition);
  let md = '| 조건 | key 정확도 | ii-V-I F1 (micro) | ii-V-I P | ii-V-I R | Roman 정확도 |\n';
  md += '|---|---|---|---|---|---|\n';
  for (const [name, a] of rows) {
    md += `| ${name} | ${pct(a.keyAcc)} | ${pct(a.iiViMicroF1)} | ${pct(a.iiViMicroP)} | ${pct(a.iiViMicroR)} | ${pct(a.romanAcc)} |\n`;
  }
  return md;
}

/* ── self-test ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  // Three fake "model outputs" for p01 (Dm7 G7 Cmaj7) to show the scorer works.
  const gold = { id: 'p01', keys: ['C'], iiVi: [[0, 1, 2]], romans: ['ii-7', 'V7', 'Imaj7'] };
  const perfect = { key: 'C major', iiVi: [[0, 1, 2]], romans: ['ii7', 'V7', 'Imaj7'] };
  const wrongKey = { key: 'G', iiVi: [[0, 1, 2]], romans: ['ii-7', 'V7', 'Imaj7'] };
  const missedIIVI = { key: 'C', iiVi: [], romans: ['ii-7', 'V7', 'Imaj7'] };
  const overClaim = { key: 'C', iiVi: [[0, 1, 2], [1, 2, 0]], romans: ['ii-7', 'V7', 'Imaj7'] };

  for (const [label, pred] of [['perfect', perfect], ['wrong key', wrongKey], ['missed ii-V-I', missedIIVI], ['over-claim', overClaim]]) {
    const s = scoreItem(pred, gold);
    console.log(`${label.padEnd(14)} keyHit=${s.keyHit} P=${s.precision.toFixed(2)} R=${s.recall.toFixed(2)} F1=${s.f1.toFixed(2)} roman=${(s.romanAcc * 100).toFixed(0)}%`);
  }

  console.log('\n--- aggregate demo (3 mock conditions) ---');
  const raw = [scoreItem(missedIIVI, gold), scoreItem(wrongKey, gold)];
  const rule = [scoreItem(perfect, gold), scoreItem(perfect, gold)];
  const rag = [scoreItem(perfect, gold), scoreItem(wrongKey, gold)];
  console.log(scorecardMarkdown({ 'Raw': aggregate(raw), '+Rule': aggregate(rule), '+RAG': aggregate(rag) }));
}
