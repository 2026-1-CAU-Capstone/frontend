/* ─────────────────────────────────────────────────────────────────────────
 * Benchmark runner — tasks × conditions (Raw / +Rule / +RAG / +Rule+RAG).
 *
 *   A  structural-analysis  (key / ii-V-I / Roman)        rule + rag
 *   B  theory-facts         (objective short answer)      rag
 *   C  explanatory          (open answer, LLM-judge 1-5)  rag
 *   D  hallucination         (trap vs control, LLM-judge)  rag
 *
 * Same model & question per item; only injected context differs. D and C are
 * graded by an LLM judge (a separate Claude call) instead of keyword matching.
 * RAG context comes from the HarmoRAG server's GET /search endpoint.
 *
 * Env (auto-loaded from .env if present):
 *   VITE_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY   (required)
 *   VITE_RAG_BASE / RAG_BASE                      (enables +RAG / +Rule+RAG)
 *   MODEL, JUDGE_MODEL
 * Run:  node benchmark/run.mjs [--task=A,B,C,D] [--dry]
 * ──────────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scoreItem, aggregate, scorecardMarkdown,
  scoreTheory, aggregateTheory, theoryCardMarkdown,
  aggregateHallucination, hallucinationCardMarkdown,
  aggregateExplanatory, explanatoryCardMarkdown,
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

const MODEL = process.env.MODEL || 'claude-sonnet-4-20250514';
const JUDGE_MODEL = process.env.JUDGE_MODEL || MODEL;
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '';
const RAG_BASE = (process.env.RAG_BASE || process.env.VITE_RAG_BASE || '').trim().replace(/\/+$/, '');
const RAG_TOKEN = (process.env.RAG_TOKEN || process.env.VITE_RAG_TOKEN || '').trim();

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

async function anthropic(model, system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data.content?.map((b) => b.text).join('') ?? '';
}
const callModel = (system, user, max) => anthropic(MODEL, system, user, max);

/** Judge call → parsed JSON verdict (best-effort). */
async function judge(system, user) {
  const reply = await anthropic(JUDGE_MODEL, system, user, 80);
  return { json: extractJson(reply) || {}, raw: reply };
}

/** HarmoRAG GET /search → joined chunk text (title + instruction + response). */
async function retrieve(query) {
  if (!RAG_BASE) return null;
  const url = `${RAG_BASE}/search?q=${encodeURIComponent(query)}&n=5`;
  const res = await fetch(url, { headers: RAG_TOKEN ? { authorization: `Bearer ${RAG_TOKEN}` } : {} });
  if (!res.ok) throw new Error(`/search ${res.status}`);
  const data = await res.json();
  const results = data.results ?? data.chunks ?? [];
  const texts = results.map((r) => (typeof r === 'string' ? r : [r.title, r.instruction, r.response].filter(Boolean).join(' — ')));
  return texts.length ? texts.filter(Boolean).join('\n---\n') : null;
}

const ctxBlock = (rule, rag) =>
  (rule ? `Rule-based analysis (authoritative):\n${rule}\n\n` : '') +
  (rag ? `Reference theory:\n${rag}\n\n` : '');

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

/* ── task registry ─────────────────────────────────────────────────────── */

const TASKS = {
  A: {
    name: 'A · 구조 분석', gold: () => loadGold('structural.json'), augs: ['rule', 'rag'], maxTokens: 700,
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
    name: 'B · 이론 팩트', gold: () => loadGold('theory.json'), augs: ['rag'], maxTokens: 150,
    system: 'You are a precise jazz theory tutor. Answer with STRICT JSON only.',
    ragQuery: (it) => it.q,
    buildUser: (it, { ragCtx }) => ctxBlock(null, ragCtx) + `${it.q}\n\nReturn ONLY JSON: {"answer":"<concise answer>"}`,
    parse: (r) => { const j = extractJson(r); return { answer: j?.answer ?? r }; },
    score: scoreTheory, aggregate: aggregateTheory, card: theoryCardMarkdown,
  },
  C: {
    name: 'C · 설명 (LLM-judge)', gold: () => loadGold('explanatory.json'), augs: ['rag'], maxTokens: 400,
    system: 'You are a knowledgeable jazz theory teacher. Explain clearly and accurately in a short paragraph.',
    ragQuery: (it) => it.q,
    buildUser: (it, { ragCtx }) => ctxBlock(null, ragCtx) + it.q,
    parse: (r) => ({ answer: r }),
    score: (pred, item) => judgeC(item, pred.answer), aggregate: aggregateExplanatory, card: explanatoryCardMarkdown,
  },
  D: {
    name: 'D · 할루시네이션 (LLM-judge)', gold: () => loadGold('hallucination.json'), augs: ['rag'], maxTokens: 220,
    system: 'You are a jazz theory expert. If a question rests on a false premise or uses a non-standard term, say so plainly instead of inventing an answer. Answer in 1-3 sentences.',
    ragQuery: (it) => it.q,
    buildUser: (it, { ragCtx }) => ctxBlock(null, ragCtx) + it.q,
    parse: (r) => ({ answer: r }),
    score: (pred, item) => judgeD(item, pred.answer), aggregate: aggregateHallucination, card: hallucinationCardMarkdown,
  },
};

function conditionsFor(task) {
  const out = [{ name: 'Raw', rule: false, rag: false }];
  const hasRule = task.augs.includes('rule');
  const hasRag = task.augs.includes('rag') && !!RAG_BASE;
  if (hasRule) out.push({ name: '+Rule', rule: true, rag: false });
  if (hasRag) out.push({ name: '+RAG', rule: false, rag: true });
  if (hasRule && hasRag) out.push({ name: '+Rule+RAG', rule: true, rag: true });
  return out;
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  const ids = Object.keys(TASKS).filter((id) => !TASK_FILTER || TASK_FILTER.includes(id));

  if (DRY) {
    for (const id of ids) console.log(`[dry] ${id} ${TASKS[id].name} — items=${TASKS[id].gold().items.length}, conds=${conditionsFor(TASKS[id]).map((c) => c.name).join(', ')}`);
    console.log(`[dry] model=${MODEL}  judge=${JUDGE_MODEL}  rag=${RAG_BASE || '(off)'}`);
    return;
  }
  if (!API_KEY) { console.error('ANTHROPIC key not set.'); process.exit(1); }
  if (RAG_BASE) {
    try { await retrieve('test ii-V-I'); console.log(`RAG reachable: ${RAG_BASE}`); }
    catch (e) { console.warn(`RAG unreachable (${e.message}) — running without +RAG.`); process.env.__RAG_DOWN = '1'; }
  }
  const ragLive = RAG_BASE && !process.env.__RAG_DOWN;

  let report = `# Jazzify 벤치마크 결과\n\n- model: \`${MODEL}\`  ·  judge: \`${JUDGE_MODEL}\`  ·  ${new Date().toISOString()}  ·  RAG: ${ragLive ? 'on' : 'off'}\n\n`;
  const allResponses = [];

  for (const id of ids) {
    const task = TASKS[id];
    const gold = task.gold();
    const conditions = conditionsFor(task).filter((c) => !c.rag || ragLive);
    const scoresByCond = Object.fromEntries(conditions.map((c) => [c.name, []]));
    const ragCache = new Map();
    console.log(`\n=== ${id} ${task.name} (${gold.items.length}) ===`);

    for (const item of gold.items) {
      let ragCtx = null;
      if (ragLive) {
        const q = task.ragQuery(item);
        if (!ragCache.has(q)) ragCache.set(q, await retrieve(q).catch(() => null));
        ragCtx = ragCache.get(q);
      }
      for (const cond of conditions) {
        const user = task.buildUser(item, { ruleCtx: cond.rule ? task.ruleCtx?.(item) : null, ragCtx: cond.rag ? ragCtx : null });
        let reply = '';
        try { reply = await callModel(task.system, user, task.maxTokens); }
        catch (e) { console.error(`${item.id}/${cond.name}: ${e.message}`); }
        const pred = task.parse(reply);
        const s = await task.score(pred, item);
        scoresByCond[cond.name].push(s);
        allResponses.push({ task: id, id: item.id, condition: cond.name, reply, score: s });
      }
      process.stdout.write('.');
    }
    process.stdout.write('\n');

    const byCond = Object.fromEntries(conditions.map((c) => [c.name, task.aggregate(scoresByCond[c.name])]));
    report += `## ${task.name}  (n=${gold.items.length})\n\n${task.card(byCond)}\n`;
  }

  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(join(HERE, 'results', 'scorecard.md'), report);
  writeFileSync(join(HERE, 'results', 'responses.json'), JSON.stringify({ model: MODEL, responses: allResponses }, null, 2));
  console.log('\n' + report);
  console.log('→ benchmark/results/scorecard.md , responses.json');
}

main();
