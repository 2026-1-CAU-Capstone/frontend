/* ─────────────────────────────────────────────────────────────────────────
 * Benchmark runner — tasks × models × conditions.
 *
 *   Tasks:
 *     A  structural-analysis  (key / ii-V-I / Roman)
 *     B  theory-facts         (objective short answer)
 *     C  explanatory          (open answer, LLM-judge 1-5)
 *     D  hallucination        (trap vs control, LLM-judge)
 *     E  song-grounded        (corpus-covered factual)
 *
 *   Models × conditions (6 cells per item):
 *     haiku / raw           sonnet / raw
 *     haiku / +Rule         sonnet / +Rule
 *     haiku / +Rule+RAG     sonnet / +Rule+RAG
 *
 * Same question per item; only model + injected context differs. D and C are
 * graded by an LLM judge (a separate Claude call) instead of keyword matching.
 * RAG context comes from the HarmoRAG server's GET /search endpoint.
 *
 * Env (auto-loaded from .env if present):
 *   VITE_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY   (required)
 *   VITE_RAG_BASE / RAG_BASE                      (enables +Rule+RAG)
 *   JUDGE_MODEL  (defaults to sonnet for stable grading)
 * Run:  node benchmark/run.mjs [--task=A,B,C,D,E] [--model=haiku,sonnet] [--dry]
 * ──────────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scoreItem, aggregate, scorecardMarkdown,
  scoreTheory, aggregateTheory, theoryCardMarkdown,
  aggregateHallucination, hallucinationCardMarkdown,
  aggregateExplanatory, explanatoryCardMarkdown,
  aggregateRubric, rubricCardMarkdown,
  aggregateConsistency, consistencyCardMarkdown,
} from './scorer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* minimal .env loader — fills missing process.env keys only */
(function loadEnv() {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
})();

const DRY = process.argv.includes('--dry');
const taskArg = (process.argv.find((a) => a.startsWith('--task=')) || '').split('=')[1];
const TASK_FILTER = taskArg ? taskArg.split(',').map((s) => s.trim().toUpperCase()) : null;
const modelArg = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1];
const MODEL_FILTER = modelArg ? modelArg.split(',').map((s) => s.trim().toLowerCase()) : null;
const LIMIT = Math.max(0, parseInt((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10)) || 0;

const MODELS = [
  { id: 'haiku',  model: 'claude-haiku-4-5-20251001' },
  { id: 'sonnet', model: 'claude-sonnet-4-6' },
].filter((m) => !MODEL_FILTER || MODEL_FILTER.includes(m.id));

/* Judge: stable model so grading isn't itself a confound. Defaults to sonnet. */
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '';
const RAG_BASE = (process.env.RAG_BASE || process.env.VITE_RAG_BASE || '').trim().replace(/\/+$/, '');
const RAG_TOKEN = (process.env.RAG_TOKEN || process.env.VITE_RAG_TOKEN || '').trim();
const RAG_N = Math.max(1, parseInt(process.env.RAG_N || '5', 10));
const RAG_MIN_SCORE = Number.isFinite(parseFloat(process.env.RAG_MIN_SCORE)) ? parseFloat(process.env.RAG_MIN_SCORE) : 0;

const loadGold = (f) => JSON.parse(readFileSync(join(HERE, 'gold', f), 'utf8'));

/* ── api helpers ───────────────────────────────────────────────────────── */

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1] : text;
  const start = c.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < c.length; i++) {
    if (c[i] === '{') depth++;
    else if (c[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(c.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function anthropic(model, system, user, maxTokens, temperature = 0) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status} (${model}): ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data.content?.map((b) => b.text).join('') ?? '';
}

async function judge(system, user, maxTokens = 80) {
  const reply = await anthropic(JUDGE_MODEL, system, user, maxTokens);
  return { json: extractJson(reply) || {}, raw: reply };
}

/** HarmoRAG GET /search → joined chunk text (title + instruction + response).
 *  Honors RAG_N + minScore (override or global RAG_MIN_SCORE).
 *  Per-task minScore (passed in) lets abstract-theory tasks demand a strong
 *  match (e.g. 0.75) while song-grounded tasks accept moderate ones (~0.55).
 *  Returning null when nothing passes lets the model fall back to its own
 *  knowledge instead of being misled by a barely-relevant chunk. */
async function retrieve(query, minScoreOverride, sourceType) {
  if (!RAG_BASE) return null;
  const params = new URLSearchParams({ q: query, n: String(RAG_N) });
  if (sourceType) params.set('source_type', sourceType);
  const url = `${RAG_BASE}/search?${params.toString()}`;
  const res = await fetch(url, { headers: RAG_TOKEN ? { authorization: `Bearer ${RAG_TOKEN}` } : {} });
  if (!res.ok) throw new Error(`/search ${res.status}`);
  const data = await res.json();
  let results = data.results ?? data.chunks ?? [];
  const minScore = typeof minScoreOverride === 'number' ? minScoreOverride : RAG_MIN_SCORE;
  if (minScore > 0) {
    results = results.filter((r) => (typeof r === 'object' && r != null && typeof r.score === 'number') ? r.score >= minScore : true);
  }
  const texts = results.map((r) => (typeof r === 'string' ? r : [r.title, r.instruction, r.response].filter(Boolean).join(' — ')));
  return texts.length ? texts.filter(Boolean).join('\n---\n') : null;
}

const ctxBlock = (rule, rag) =>
  (rule ? `Rule-based analysis (authoritative):\n${rule}\n\n` : '') +
  (rag ? `Reference theory:\n${rag}\n\n` : '');

/* Shared rule preamble for B/C/D/E. Reminds the model of formal labeling
 * conventions and signals "use authoritative theory, not guesses". For A, the
 * gold items carry per-item ruleContext (deterministic local analysis). */
const RULE_PREAMBLE_THEORY = `Apply formal jazz-harmony analysis:
- Use Roman numerals with quality (Imaj7, ii-7, V7, iiø7, V7/V, subV7/V, German 6th, etc.).
- Identify function: tonic / subdominant / dominant / pivot / secondary dominant.
- Name scales by mode and parent (e.g., "7th mode of melodic minor = altered").
- For multi-chord questions, state the local key center first, then label each chord.
- If a premise is false or a term is non-standard, say so plainly.`;

/* ── judges for D and C ────────────────────────────────────────────────── */

async function judgeD(item, answer) {
  if (item.type === 'control') {
    const v = await judge(
      'You grade jazz-theory factual correctness. Output JSON {"correct": true|false} only.',
      `Question: ${item.q}\nAccepted correct answer(s): ${(item.accept || []).join(' / ')}\n\nModel answer:\n${answer}\n\nIs the model's answer correct?`,
    );
    return { id: item.id, type: 'control', correct: v.json.correct ? 1 : 0, hallucinated: 0 };
  }
  const v = await judge(
    'You grade whether a jazz-theory answer HALLUCINATED. The question rests on a FALSE premise or a NON-STANDARD term that does not exist in real music theory. A good answer flags it as false/non-standard and does NOT invent a confident definition. Output JSON {"hallucinated": true|false} only.',
    `Question (false premise): ${item.q}\n\nModel answer:\n${answer}\n\nDid the model fabricate/confidently explain the false concept (true) or correctly flag it as false/non-standard (false)?`,
  );
  const hallucinated = v.json.hallucinated === true ? 1 : 0;
  return { id: item.id, type: 'trap', hallucinated, abstained: hallucinated ? 0 : 1 };
}

async function judgeC(item, answer) {
  const v = await judge(
    'You are a strict jazz-theory grader. Score the explanation 1-5 for correctness and coverage of the key points (5 = all points correct & clear, 1 = wrong/empty). Output JSON {"score": <1-5>} only.',
    `Question: ${item.q}\nKey points expected:\n- ${(item.points || []).join('\n- ')}\n\nModel answer:\n${answer}\n\nScore 1-5.`,
  );
  let s = Number(v.json.score);
  if (!Number.isFinite(s)) { const m = v.raw.match(/[1-5]/); s = m ? Number(m[0]) : 1; }
  return { id: item.id, score5: Math.max(1, Math.min(5, s)) };
}

/* Task F — multi-dimension rubric judge for song-deep answers. Scores the
 * "human-like deep answer" qualities RAG is supposed to enable. faithfulness
 * is only scored when RAG context was injected (ragCtx non-empty); for raw /
 * +Rule cells it returns null so it doesn't unfairly drag those down. */
async function judgeF(item, answer, ragCtx) {
  const pts = (item.points || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const hasCtx = typeof ragCtx === 'string' && ragCtx.trim().length > 0;
  const dimList = ['coverage', 'specificity', 'pedagogy', 'groundedness', ...(hasCtx ? ['faithfulness'] : [])];
  const system =
    'You are a strict jazz-pedagogy grader for song-specific deep questions. Score the teacher answer on each dimension 1-5 (5=excellent, 1=poor/empty/wrong):\n' +
    '- coverage: how many of the EXPECTED KEY POINTS are correctly covered.\n' +
    '- specificity: concrete and song-specific (names the exact chords / functions / scales) vs generic textbook boilerplate.\n' +
    '- pedagogy: clear, well-organized, actionable like a real jazz teacher.\n' +
    '- groundedness: claims are musically correct and consistent with the expected key points; no fabrication.\n' +
    (hasCtx ? '- faithfulness: the answer\'s specific claims are actually supported by the PROVIDED REFERENCE material below (not merely plausible).\n' : '') +
    `Output JSON only: {${dimList.map((d) => `"${d}": <1-5>`).join(', ')}}.`;
  const ctxBlk = hasCtx ? `\n\n[Provided reference (retrieved)]\n${ragCtx}\n` : '';
  const user = `Question: ${item.q}\n곡: ${item.song}\n\nExpected key points:\n${pts}${ctxBlk}\n\nModel answer:\n${answer}\n\nScore each dimension 1-5. JSON only.`;
  const v = await judge(system, user, 120);
  const g = v.json || {};
  const cl = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : null; };
  return {
    id: item.id,
    coverage5: cl(g.coverage),
    specificity5: cl(g.specificity),
    pedagogy5: cl(g.pedagogy),
    groundedness5: cl(g.groundedness),
    faithfulness5: hasCtx ? cl(g.faithfulness) : null,
  };
}

/* Task G — canonicalize a structural reply's {key, ii-V-I} into a stable string
 * so K samples can be compared for agreement. (No judge; pure extraction.) */
function canonStructural(reply) {
  const j = extractJson(reply) || {};
  const keys = (Array.isArray(j.key) ? j.key : String(j.key ?? '').split(/[,/&]|\band\b|\bor\b/i))
    .map((s) => String(s).toLowerCase().replace(/major|maj|\s|-/g, '').trim()).filter(Boolean).sort();
  const iiVi = (Array.isArray(j.iiVi) ? j.iiVi : []).filter((t) => Array.isArray(t) && t.length === 3)
    .map((t) => t.join('-')).sort();
  return JSON.stringify({ keys, iiVi });
}

/* pred.replies = K samples. Score = how tightly they agree. */
function scoreConsistency(pred, item) {
  const reps = (pred.replies || []).filter((r) => r && r.trim());
  if (reps.length === 0) return { id: item.id, allAgree: 0, agreement: 0, n: 0 };
  const counts = {};
  for (const r of reps) { const c = canonStructural(r); counts[c] = (counts[c] || 0) + 1; }
  const top = Math.max(...Object.values(counts));
  return { id: item.id, allAgree: top === reps.length ? 1 : 0, agreement: top / reps.length, n: reps.length };
}

/* ── task registry ─────────────────────────────────────────────────────── */

const TASKS = {
  A: {
    name: 'A · 구조 분석', gold: () => loadGold('structural.json'), maxTokens: 700,
    minScore: 0.70,    // chord-string queries; only confident lesson matches
    system: 'You are a precise jazz harmony analyst. Answer with STRICT JSON only.',
    ragQuery: (it) => `jazz harmony: ${it.chords.join(' ')} — key, ii-V-I, Roman numerals`,
    ruleCtx: (it) => it.ruleContext,
    buildUser: (it, { ruleCtx, ragCtx }) =>
      ctxBlock(ruleCtx, ragCtx) +
      `Chord progression (0-indexed):\n${it.chords.map((c, i) => `${i}:${c}`).join('  ')}\n\n` +
      `Identify: 1) key (multiple only if it clearly modulates); 2) every ii-V-I/ii-V-i as [ii,V,I] index triples (P4-up then P5-down; NOT tritone subs, NOT V-I without a ii); 3) Roman numeral per chord.\n\n` +
      `Return ONLY JSON: {"key":"<key or comma-separated>","iiVi":[[i,j,k]],"romans":["..."]}`,
    parse: (r) => { const j = extractJson(r) || {}; return { key: Array.isArray(j.key) ? j.key.join(',') : j.key ?? '', iiVi: Array.isArray(j.iiVi) ? j.iiVi : [], romans: Array.isArray(j.romans) ? j.romans : [] }; },
    score: scoreItem, aggregate, card: scorecardMarkdown,
  },
  B: {
    name: 'B · 이론 팩트', gold: () => loadGold('theory.json'), maxTokens: 200,
    minScore: 0.65,    // theory facts — lesson chunks score higher than standards on abstract questions
    sourceType: 'lesson',  // restrict to lesson transcripts (theory-heavy; standard chunks are song-specific)
    system: 'You are a precise jazz theory tutor. Answer with STRICT JSON only.',
    ragQuery: (it) => it.q,
    ruleCtx: () => RULE_PREAMBLE_THEORY,
    buildUser: (it, { ruleCtx, ragCtx }) => ctxBlock(ruleCtx, ragCtx) + `${it.q}\n\nReturn ONLY JSON: {"answer":"<concise answer>"}`,
    parse: (r) => { const j = extractJson(r); return { answer: j?.answer ?? r }; },
    score: scoreTheory, aggregate: aggregateTheory, card: theoryCardMarkdown,
  },
  C: {
    name: 'C · 설명 (LLM-judge)', gold: () => loadGold('explanatory.json'), maxTokens: 400,
    minScore: 0.65,
    sourceType: 'lesson',
    system: 'You are a knowledgeable jazz theory teacher. Explain clearly and accurately in a short paragraph.',
    ragQuery: (it) => it.q,
    ruleCtx: () => RULE_PREAMBLE_THEORY,
    buildUser: (it, { ruleCtx, ragCtx }) => ctxBlock(ruleCtx, ragCtx) + it.q,
    parse: (r) => ({ answer: r }),
    score: (pred, item) => judgeC(item, pred.answer), aggregate: aggregateExplanatory, card: explanatoryCardMarkdown,
  },
  D: {
    name: 'D · 할루시네이션 (LLM-judge)', gold: () => loadGold('hallucination.json'), maxTokens: 220,
    system: 'You are a jazz theory expert. If a question rests on a false premise or uses a non-standard term, say so plainly instead of inventing an answer. Answer in 1-3 sentences.',
    ragQuery: (it) => it.q,
    ruleCtx: () => RULE_PREAMBLE_THEORY,
    buildUser: (it, { ruleCtx, ragCtx }) => ctxBlock(ruleCtx, ragCtx) + it.q,
    parse: (r) => ({ answer: r }),
    score: (pred, item) => judgeD(item, pred.answer), aggregate: aggregateHallucination, card: hallucinationCardMarkdown,
  },
  E: {
    /* Song-specific factual questions whose answers ARE in the RAG corpus.
     * Designed to test whether RAG helps when the corpus actually covers the
     * question (vs. B/C where the corpus has zero coverage of abstract theory
     * definitions). If RAG can't help here either, the pipeline itself is
     * broken; if it does help, the original B/C drop is a corpus/question
     * mismatch, not a logic bug. */
    name: 'E · 곡-grounded 단답', gold: () => loadGold('song-grounded.json'), maxTokens: 150,
    minScore: 0.50,        // song-grounded; lower threshold since lessons no longer compete
    sourceType: 'standard',// restrict to song-specific standard chunks
    system: 'You are a precise jazz theory tutor. Answer in Korean with STRICT JSON only.',
    ragQuery: (it) => it.q,
    ruleCtx: () => RULE_PREAMBLE_THEORY,
    buildUser: (it, { ruleCtx, ragCtx }) => ctxBlock(ruleCtx, ragCtx) + `${it.q}\n\nReturn ONLY JSON: {"answer":"<concise answer>"}`,
    parse: (r) => { const j = extractJson(r); return { answer: j?.answer ?? r }; },
    score: scoreTheory, aggregate: aggregateTheory, card: theoryCardMarkdown,
  },
  F: {
    /* Song-DEEP analysis — RAG-exclusive. Unlike E (short factual), these ask
     * for the corpus's specific teacher reasoning about a specific song that a
     * base LLM only answers generically. Judged on coverage of the corpus-
     * specific key points (reuses C's judge/aggregate/card). raw vs +Rule+RAG
     * isolates RAG lift (the rule engine has no song-deep content, so
     * +Rule ≈ raw here). gold carries provenance (sourceChunkId) for retrieval
     * ablation + faithfulness measurement. */
    name: 'F · 곡 심층 분석 (LLM-judge)', gold: () => loadGold('song-deep.json'), maxTokens: 500,
    minScore: 0.50,        // song-grounded retrieval; same threshold as E
    sourceType: 'standard',// restrict to song-specific standard chunks
    system: 'You are an expert jazz teacher. Answer in Korean: be specific to the named song and concrete (name the exact chords, functions, scales). Avoid generic textbook boilerplate that ignores the song.',
    ragQuery: (it) => `${it.song} ${it.q}`,
    ruleCtx: () => RULE_PREAMBLE_THEORY,
    buildUser: (it, { ruleCtx, ragCtx }) => ctxBlock(ruleCtx, ragCtx) + it.q,
    parse: (r) => ({ answer: r }),
    score: (pred, item) => judgeF(item, pred.answer, pred._ragCtx), aggregate: aggregateRubric, card: rubricCardMarkdown,
  },
  G: {
    /* Consistency — same structural question sampled K times at temperature>0.
     * Measures whether the answer is STABLE. Isolates the Rule layer: raw
     * wavers on ambiguous progressions, +Rule pins the answer (deterministic).
     * Reuses Task A's structural gold + prompt; only the execution (K samples)
     * and scoring (agreement, not correctness) differ. */
    name: 'G · 일관성 (self-consistency)', gold: () => loadGold('structural.json'), maxTokens: 700,
    samples: 4, temperature: 0.8,   // K=4 samples per cell at temp 0.8
    minScore: 0.70,
    system: 'You are a precise jazz harmony analyst. Answer with STRICT JSON only.',
    ragQuery: (it) => `jazz harmony: ${it.chords.join(' ')} — key, ii-V-I, Roman numerals`,
    ruleCtx: (it) => it.ruleContext,
    buildUser: (it, { ruleCtx, ragCtx }) =>
      ctxBlock(ruleCtx, ragCtx) +
      `Chord progression (0-indexed):\n${it.chords.map((c, i) => `${i}:${c}`).join('  ')}\n\n` +
      `Identify: 1) key; 2) every ii-V-I/ii-V-i as [ii,V,I] index triples; 3) Roman numeral per chord.\n\n` +
      `Return ONLY JSON: {"key":"<key or comma-separated>","iiVi":[[i,j,k]],"romans":["..."]}`,
    score: scoreConsistency, aggregate: aggregateConsistency, card: consistencyCardMarkdown,
  },
};

/* Conditions: 3 per task — raw / +Rule / +Rule+RAG. */
function conditionsFor() {
  const out = [
    { name: 'raw',          rule: false, rag: false },
    { name: '+Rule',        rule: true,  rag: false },
    { name: '+Rule+RAG',    rule: true,  rag: true  },
  ];
  return out;
}

/* Full label for storage & display: `<modelId>/<condName>` */
const condLabel = (modelId, condName) => `${modelId}/${condName}`;

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  const ids = Object.keys(TASKS).filter((id) => !TASK_FILTER || TASK_FILTER.includes(id));

  if (DRY) {
    for (const id of ids) console.log(`[dry] ${id} ${TASKS[id].name} — items=${TASKS[id].gold().items.length}`);
    console.log(`[dry] models=${MODELS.map((m) => `${m.id}(${m.model})`).join(', ')}`);
    console.log(`[dry] conditions=raw, +Rule, +Rule+RAG`);
    console.log(`[dry] judge=${JUDGE_MODEL}  rag=${RAG_BASE || '(off)'}  rag_n=${RAG_N}  rag_min_score=${RAG_MIN_SCORE}`);
    return;
  }
  if (!API_KEY) { console.error('ANTHROPIC key not set.'); process.exit(1); }
  let ragLive = false;
  if (RAG_BASE) {
    try { await retrieve('test ii-V-I'); ragLive = true; console.log(`RAG reachable: ${RAG_BASE}`); }
    catch (e) { console.warn(`RAG unreachable (${e.message}) — +Rule+RAG will degrade to +Rule.`); }
  }

  const taskMinScores = Object.entries(TASKS)
    .filter(([id]) => ids.includes(id))
    .map(([id, t]) => `${id}=${t.minScore ?? RAG_MIN_SCORE}`).join(', ');
  const ragSuffix = ragLive ? ` (n=${RAG_N}${RAG_MIN_SCORE > 0 ? `, min_score=${RAG_MIN_SCORE}` : ''}; per-task: ${taskMinScores})` : '';
  const modelsLabel = MODELS.map((m) => `${m.id}=\`${m.model}\``).join('  ·  ');
  let report = `# Jazzify 벤치마크 결과 (multi-model)\n\n- models: ${modelsLabel}\n- judge: \`${JUDGE_MODEL}\`\n- RAG: ${ragLive ? 'on' : 'off'}${ragSuffix}\n- timestamp: ${new Date().toISOString()}\n\n`;
  const allResponses = [];
  const conditions = conditionsFor();

  for (const id of ids) {
    const task = TASKS[id];
    const gold = task.gold();
    if (LIMIT > 0) gold.items = gold.items.slice(0, LIMIT);   // --limit=N: cost-capped smoke
    /* Build condition list: 6 cells (each model × each cond), skipping rag-only cells if RAG down. */
    const cells = [];
    for (const m of MODELS) {
      for (const c of conditions) {
        if (c.rag && !ragLive) continue;
        cells.push({ label: condLabel(m.id, c.name), modelId: m.id, model: m.model, condName: c.name, rule: c.rule, rag: c.rag });
      }
    }
    const scoresByLabel = Object.fromEntries(cells.map((x) => [x.label, []]));
    const ragCache = new Map();
    console.log(`\n=== ${id} ${task.name} (${gold.items.length} items × ${cells.length} cells = ${gold.items.length * cells.length} calls) ===`);

    for (const item of gold.items) {
      let ragCtx = null;
      if (ragLive) {
        const q = task.ragQuery(item);
        const cacheKey = `${task.sourceType || ''}|${q}`;
        if (!ragCache.has(cacheKey)) ragCache.set(cacheKey, await retrieve(q, task.minScore, task.sourceType).catch(() => null));
        ragCtx = ragCache.get(cacheKey);
      }
      for (const cell of cells) {
        const ruleCtx = cell.rule ? task.ruleCtx?.(item) : null;
        const user = task.buildUser(item, { ruleCtx, ragCtx: cell.rag ? ragCtx : null });
        const K = task.samples ?? 1;
        const temp = task.temperature ?? 0;
        let reply = '';
        let pred;
        if (K > 1) {
          // Multi-sample (Task G consistency): K draws at temperature>0.
          const replies = [];
          for (let k = 0; k < K; k++) {
            try { replies.push(await anthropic(cell.model, task.system, user, task.maxTokens, temp)); }
            catch (e) { console.error(`${item.id}/${cell.label} sample${k}: ${e.message}`); }
          }
          reply = replies[0] ?? '';
          pred = { replies };
        } else {
          try { reply = await anthropic(cell.model, task.system, user, task.maxTokens, temp); }
          catch (e) { console.error(`${item.id}/${cell.label}: ${e.message}`); }
          pred = task.parse(reply);
        }
        // Expose the RAG context the model actually saw to the scorer so the
        // rubric judge (Task F) can grade faithfulness against it. Null for
        // raw / +Rule cells (no context injected).
        pred._ragCtx = cell.rag ? ragCtx : null;
        /* Wrap score() — it may invoke the LLM judge which can fail. Treat
         * a judge failure as "skip this score" rather than abort the run. */
        let s = null;
        try { s = await task.score(pred, item); }
        catch (e) { console.error(`${item.id}/${cell.label} score/judge: ${e.message}`); }
        if (s) scoresByLabel[cell.label].push(s);
        allResponses.push({ task: id, id: item.id, model: cell.modelId, condition: cell.condName, label: cell.label, reply, replies: K > 1 ? pred.replies : undefined, score: s });
      }
      process.stdout.write('.');
    }
    process.stdout.write('\n');

    /* Incremental persistence: write after every task so a later crash
     * doesn't lose hours of earlier work. */
    mkdirSync(join(HERE, 'results'), { recursive: true });
    writeFileSync(join(HERE, 'results', 'responses.json'), JSON.stringify({
      models: MODELS, judge: JUDGE_MODEL, rag: { enabled: ragLive, base: RAG_BASE, n: RAG_N, min_score: RAG_MIN_SCORE },
      timestamp: new Date().toISOString(), responses: allResponses,
    }, null, 2));

    const byLabel = Object.fromEntries(cells.map((x) => [x.label, task.aggregate(scoresByLabel[x.label])]));
    report += `## ${task.name}  (n=${gold.items.length})\n\n${task.card(byLabel)}\n`;
  }

  /* responses.json was written incrementally above; only scorecard.md left. */
  writeFileSync(join(HERE, 'results', 'scorecard.md'), report);
  console.log('\n' + report);
  console.log('→ benchmark/results/scorecard.md , responses.json');
}

main();
