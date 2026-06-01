/* Builds benchmark/index.html — a self-contained, no-dependency dashboard
 * embedding every gold QA, every model response (haiku + sonnet), and every
 * per-condition score. Regenerate after a fresh responses.json or any gold/*
 * change:
 *
 *     node benchmark/buildSite.mjs
 *
 * Response layout (new, multi-model):
 *   { task, id, model: 'haiku'|'sonnet', condition: 'raw'|'+Rule'|'+Rule+RAG',
 *     label: '<model>/<condition>', reply, score }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  aggregate as aggA,
  aggregateTheory as aggBE,
  aggregateExplanatory as aggC,
  aggregateHallucination as aggD,
  aggregateRubric as aggF,
  aggregateConsistency as aggG,
} from './scorer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tryRead = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const gold = {
  A: tryRead(join(HERE, 'gold/structural.json')),
  B: tryRead(join(HERE, 'gold/theory.json')),
  C: tryRead(join(HERE, 'gold/explanatory.json')),
  D: tryRead(join(HERE, 'gold/hallucination.json')),
  E: tryRead(join(HERE, 'gold/song-grounded.json')),
  F: tryRead(join(HERE, 'gold/song-deep.json')),
  G: tryRead(join(HERE, 'gold/structural.json')),   // consistency reuses A's progressions
};
const data = tryRead(join(HERE, 'results/responses.json')) || { responses: [] };
const responses = data.responses;
const runMeta = {
  models: data.models || (data.model ? [{ id: 'default', model: data.model }] : []),
  judge: data.judge || '(?)',
  rag: data.rag || {},
  timestamp: data.timestamp || '',
};

/* Each response stored under label `<model>/<cond>`. For legacy responses
 * without a `model` field, treat as model='legacy'. */
const labelOf = (r) => r.label || `${r.model || 'legacy'}/${r.condition}`;

const byKey = {};
for (const r of responses) byKey[`${r.task}::${r.id}::${labelOf(r)}`] = r;

/* Collect all labels observed per task, then order: model groups (haiku, sonnet)
 * × cond order (raw, +Rule, +Rule+RAG). */
const labelsByTask = {};
for (const r of responses) (labelsByTask[r.task] ??= new Set()).add(labelOf(r));

const MODEL_ORDER = ['haiku', 'sonnet'];
const COND_ORDER = ['raw', '+Rule', '+Rule+RAG'];
function orderedLabels(t) {
  const set = labelsByTask[t] || new Set();
  const out = [];
  for (const m of MODEL_ORDER) for (const c of COND_ORDER) if (set.has(`${m}/${c}`)) out.push(`${m}/${c}`);
  for (const lbl of set) if (!out.includes(lbl)) out.push(lbl); // catch legacy/unknown
  return out;
}
const parseLabel = (lbl) => { const i = lbl.indexOf('/'); return i < 0 ? { model: '?', cond: lbl } : { model: lbl.slice(0, i), cond: lbl.slice(i + 1) }; };

/* JSON extractor (mirrors run.mjs for parsing model replies). */
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

/* Aggregate every (task, label). */
const agg = {};
for (const t of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
  if (!gold[t]) continue;
  agg[t] = {};
  for (const lbl of orderedLabels(t)) {
    const items = gold[t].items.map((it) => byKey[`${t}::${it.id}::${lbl}`]?.score).filter(Boolean);
    if (t === 'A') agg[t][lbl] = aggA(items);
    else if (t === 'C') agg[t][lbl] = aggC(items);
    else if (t === 'D') agg[t][lbl] = aggD(items);
    else if (t === 'F') agg[t][lbl] = aggF(items);
    else if (t === 'G') agg[t][lbl] = aggG(items);
    else agg[t][lbl] = aggBE(items);   // B and E share the {hit} schema
  }
}

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d));
const escHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const escJson = (o) => escHTML(JSON.stringify(o));

/* Label badge: model in colored chip, then condition. */
function labelChip(lbl) {
  const { model, cond } = parseLabel(lbl);
  return `<span class="lbl"><span class="lbl-m m-${model}">${escHTML(model)}</span><span class="lbl-c">${escHTML(cond)}</span></span>`;
}

/* ── per-task aggregate row HTML ─────────────────────────────────────── */
function aggrowsForTask(t) {
  const labels = orderedLabels(t);
  if (!labels.length) return `<tr><td colspan="2"><i>응답 없음</i></td></tr>`;
  if (t === 'A') {
    return labels.map((lbl) => `<tr>
      <th>${labelChip(lbl)}</th>
      <td>${pct(agg.A[lbl].keyAcc)}</td>
      <td>${pct(agg.A[lbl].iiViMicroF1)}</td>
      <td>${pct(agg.A[lbl].iiViMicroP)}</td>
      <td>${pct(agg.A[lbl].iiViMicroR)}</td>
      <td>${pct(agg.A[lbl].romanAcc)}</td>
    </tr>`).join('');
  }
  if (t === 'C') {
    return labels.map((lbl) => `<tr>
      <th>${labelChip(lbl)}</th>
      <td>${num(agg.C[lbl].meanScore5, 2)} / 5</td>
      <td>${pct(agg.C[lbl].normalized)}</td>
    </tr>`).join('');
  }
  if (t === 'D') {
    return labels.map((lbl) => `<tr>
      <th>${labelChip(lbl)}</th>
      <td>${pct(agg.D[lbl].hallucinationRate)}</td>
      <td>${pct(agg.D[lbl].controlAcc)}</td>
    </tr>`).join('');
  }
  if (t === 'F') {
    return labels.map((lbl) => {
      const a = agg.F[lbl];
      return `<tr>
        <th>${labelChip(lbl)}</th>
        <td><b>${num(a.overall5, 2)}</b> / 5</td>
        <td>${pct(a.normalized)}</td>
        <td>${num(a.coverage5, 2)}</td>
        <td>${num(a.specificity5, 2)}</td>
        <td>${num(a.pedagogy5, 2)}</td>
        <td>${num(a.groundedness5, 2)}</td>
        <td>${num(a.faithfulness5, 2)}</td>
      </tr>`;
    }).join('');
  }
  if (t === 'G') {
    return labels.map((lbl) => `<tr>
      <th>${labelChip(lbl)}</th>
      <td><b>${pct(agg.G[lbl].allAgreeRate)}</b></td>
      <td>${pct(agg.G[lbl].meanAgreement)}</td>
    </tr>`).join('');
  }
  /* B / E */
  return labels.map((lbl) => `<tr>
    <th>${labelChip(lbl)}</th>
    <td>${pct(agg[t][lbl].accuracy)}</td>
    <td>${agg[t][lbl].items} 문항</td>
  </tr>`).join('');
}
function aggHeaderForTask(t) {
  if (t === 'A') return `<tr><th>조건</th><th>key</th><th>ii-V-I F1</th><th>P</th><th>R</th><th>Roman</th></tr>`;
  if (t === 'C') return `<tr><th>조건</th><th>평균 점수</th><th>정규화</th></tr>`;
  if (t === 'D') return `<tr><th>조건</th><th>할루시네이션율</th><th>컨트롤 정확도</th></tr>`;
  if (t === 'F') return `<tr><th>조건</th><th>종합</th><th>정규화</th><th>coverage</th><th>specificity</th><th>pedagogy</th><th>groundedness</th><th>faithfulness</th></tr>`;
  if (t === 'G') return `<tr><th>조건</th><th>완전일치율</th><th>평균 일치도</th></tr>`;
  return `<tr><th>조건</th><th>정확도</th><th>N</th></tr>`;
}

/* ── per-item rendering ──────────────────────────────────────────────── */
function predTextA(reply) {
  const j = extractJson(reply) || {};
  return `key=<code>${escHTML(Array.isArray(j.key) ? j.key.join(',') : (j.key ?? ''))}</code> · iiVi=<code>${escJson(j.iiVi ?? [])}</code> · romans=<code>${escJson(j.romans ?? [])}</code>`;
}
function predTextSimple(reply) {
  const j = extractJson(reply);
  if (j?.answer != null) return escHTML(j.answer);
  return escHTML((reply ?? '').slice(0, 240));
}
function scoreCellA(s) {
  if (!s) return '<td class="miss" colspan="3"><i>응답 없음</i></td>';
  return `<td>${s.keyHit ? '✓' : '✗'}</td>
    <td>P ${num(s.precision)} · R ${num(s.recall)} · F1 ${num(s.f1)}</td>
    <td>${s.romanAcc == null ? '—' : Math.round(s.romanAcc * 100) + '%'}</td>`;
}

function renderTaskA() {
  const labels = orderedLabels('A');
  let html = '';
  for (const item of gold.A.items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`A::${item.id}::${lbl}`];
      const reply = r?.reply ?? '';
      const sc = scoreCellA(r?.score);
      return `<tr>
        <th>${labelChip(lbl)}</th>
        <td class="reply">${r ? predTextA(reply) : '<i>응답 없음</i>'}</td>
        ${sc}
      </tr>`;
    }).join('');
    html += `<details class="item"${item.iiVi?.length === 0 ? ' data-negative="1"' : ''}>
      <summary>
        <span class="id">${escHTML(item.id)}</span>
        <span class="chords">${escHTML(item.chords.join('  '))}</span>
        <span class="gold">키 ${escHTML(JSON.stringify(item.keys))} · ii-V-I ${escHTML(JSON.stringify(item.iiVi))}${item.romans ? ' · romans' : ''}</span>
      </summary>
      <div class="body">
        <p class="rule"><b>Rule context (주입):</b> ${escHTML(item.ruleContext || '')}</p>
        <table class="cond"><thead><tr><th>조건</th><th>모델 답 (parsed)</th><th>key</th><th>ii-V-I</th><th>Roman</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </details>`;
  }
  return html;
}

function renderTaskBE(taskId) {
  const labels = orderedLabels(taskId);
  let html = '';
  for (const item of gold[taskId].items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`${taskId}::${item.id}::${lbl}`];
      const hit = r?.score?.hit;
      return `<tr>
        <th>${labelChip(lbl)}</th>
        <td class="reply">${r ? predTextSimple(r.reply) : '<i>응답 없음</i>'}</td>
        <td class="${hit ? 'ok' : (r ? 'bad' : 'miss')}">${r ? (hit ? '✓' : '✗') : '—'}</td>
      </tr>`;
    }).join('');
    html += `<details class="item">
      <summary>
        <span class="id">${escHTML(item.id)}</span>
        <span class="q">${escHTML(item.q)}</span>
      </summary>
      <div class="body">
        <p class="gold"><b>Accept:</b> ${item.accept.map((a) => `<code>${escHTML(a)}</code>`).join(' / ')}</p>
        <table class="cond"><thead><tr><th>조건</th><th>답</th><th>채점</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </details>`;
  }
  return html;
}

function renderTaskC() {
  const labels = orderedLabels('C');
  let html = '';
  for (const item of gold.C.items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`C::${item.id}::${lbl}`];
      return `<div class="creply">
        <div class="head">${labelChip(lbl)}<span class="score">judge ${r ? r.score.score5 : '—'}/5</span></div>
        <pre class="long">${r ? escHTML(r.reply) : '<i>응답 없음</i>'}</pre>
      </div>`;
    }).join('');
    html += `<details class="item">
      <summary><span class="id">${escHTML(item.id)}</span><span class="q">${escHTML(item.q)}</span></summary>
      <div class="body">
        <p class="gold"><b>Key points (judge 기준):</b></p>
        <ul>${(item.points || []).map((p) => `<li>${escHTML(p)}</li>`).join('')}</ul>
        ${rows}
      </div>
    </details>`;
  }
  return html;
}

function renderTaskD() {
  const labels = orderedLabels('D');
  if (!labels.length) {
    return gold.D.items.map((item) => `<details class="item">
      <summary><span class="id">${escHTML(item.id)}</span><span class="badge ${item.type}">${item.type}</span><span class="q">${escHTML(item.q)}</span></summary>
      <div class="body">
        ${item.type === 'control'
          ? `<p><b>Accept:</b> ${(item.accept || []).map((a) => `<code>${escHTML(a)}</code>`).join(' / ')}</p>`
          : `<p><b>좋은 답 신호:</b> ${(item.goodSignals || []).slice(0, 4).map((s) => `<code>${escHTML(s)}</code>`).join(', ')}…</p>`}
        <p class="miss"><i>이 태스크는 최신 런에서 미실행 — 응답 미동기화</i></p>
      </div>
    </details>`).join('');
  }
  let html = '';
  for (const item of gold.D.items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`D::${item.id}::${lbl}`];
      const ok = r && (item.type === 'control' ? r.score?.correct : !r.score?.hallucinated);
      return `<div class="creply">
        <div class="head">${labelChip(lbl)}<span class="score ${ok ? 'ok' : 'bad'}">${r ? (ok ? '✓' : '✗') : '—'}</span></div>
        <pre class="long">${r ? escHTML(r.reply) : '<i>응답 없음</i>'}</pre>
      </div>`;
    }).join('');
    html += `<details class="item">
      <summary><span class="id">${escHTML(item.id)}</span><span class="badge ${item.type}">${item.type}</span><span class="q">${escHTML(item.q)}</span></summary>
      <div class="body">
        ${item.type === 'control'
          ? `<p><b>Accept:</b> ${(item.accept || []).map((a) => `<code>${escHTML(a)}</code>`).join(' / ')}</p>`
          : `<p><b>좋은 답 신호:</b> ${(item.goodSignals || []).slice(0, 4).map((s) => `<code>${escHTML(s)}</code>`).join(', ')}…</p>`}
        ${rows}
      </div>
    </details>`;
  }
  return html;
}

function renderTaskF() {
  const labels = orderedLabels('F');
  const dimChip = (s) => {
    if (!s) return '<span class="score">—</span>';
    const d = (k) => (s[k] == null ? '—' : s[k]);
    return `<span class="score">cov ${d('coverage5')} · spec ${d('specificity5')} · ped ${d('pedagogy5')} · grnd ${d('groundedness5')}${s.faithfulness5 != null ? ` · faith ${s.faithfulness5}` : ''}</span>`;
  };
  let html = '';
  for (const item of gold.F.items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`F::${item.id}::${lbl}`];
      return `<div class="creply">
        <div class="head">${labelChip(lbl)}${dimChip(r?.score)}</div>
        <pre class="long">${r ? escHTML(r.reply) : '<i>응답 없음</i>'}</pre>
      </div>`;
    }).join('');
    html += `<details class="item">
      <summary><span class="id">${escHTML(item.id)}</span><span class="q">${escHTML(item.q)}</span></summary>
      <div class="body">
        <p class="gold"><b>${escHTML(item.song)}</b> · <span class="src">${escHTML(item.source || '')}</span>${item.corpusOnly === false ? ' · <span class="badge control">대조군</span>' : ''} · <code>${escHTML(item.sourceChunkId || '')}</code></p>
        <p class="gold"><b>Key points (judge 기준):</b></p>
        <ul>${(item.points || []).map((p) => `<li>${escHTML(p)}</li>`).join('')}</ul>
        ${rows}
      </div>
    </details>`;
  }
  return html;
}

function renderTaskG() {
  const labels = orderedLabels('G');
  let html = '';
  for (const item of gold.G.items) {
    const rows = labels.map((lbl) => {
      const r = byKey[`G::${item.id}::${lbl}`];
      const reps = r?.replies || (r?.reply ? [r.reply] : []);
      const agreeTxt = r?.score ? `${r.score.allAgree ? '완전일치' : '불일치'} · ${Math.round((r.score.agreement || 0) * 100)}%` : '—';
      const samples = reps.length
        ? reps.map((rp, i) => { const j = extractJson(rp) || {}; return `<div class="sample">#${i + 1} key=<code>${escHTML(Array.isArray(j.key) ? j.key.join(',') : (j.key ?? ''))}</code> · iiVi=<code>${escJson(j.iiVi ?? [])}</code></div>`; }).join('')
        : '<i>응답 없음</i>';
      return `<div class="creply">
        <div class="head">${labelChip(lbl)}<span class="score ${r?.score?.allAgree ? 'ok' : 'bad'}">${agreeTxt}</span></div>
        <div class="samples">${samples}</div>
      </div>`;
    }).join('');
    html += `<details class="item">
      <summary><span class="id">${escHTML(item.id)}</span><span class="q">${escHTML(item.chords.join('  '))}</span></summary>
      <div class="body">
        <p class="gold"><b>Gold:</b> 키 ${escHTML(JSON.stringify(item.keys))} · ii-V-I ${escHTML(JSON.stringify(item.iiVi))} <span class="src">(K=4 샘플 @ temp 0.8 — 일치할수록 deterministic)</span></p>
        ${rows}
      </div>
    </details>`;
  }
  return html;
}

/* ── HTML page ───────────────────────────────────────────────────────── */
const taskMeta = {
  A: { label: '구조 분석', contrib: '정확성 → Rule', n: gold.A?.items.length ?? 0, body: () => renderTaskA() },
  G: { label: '일관성 (self-consistency)', contrib: '일관성 → Rule', n: gold.G?.items.length ?? 0, body: () => renderTaskG() },
  F: { label: '곡 심층 분석 (rubric)', contrib: '설명품질·근거제시 → RAG', n: gold.F?.items.length ?? 0, body: () => renderTaskF() },
  C: { label: '설명',     contrib: '설명품질 → RAG', n: gold.C?.items.length ?? 0, body: () => renderTaskC() },
  B: { label: '이론 팩트', contrib: '사실성 (포화)', n: gold.B?.items.length ?? 0, body: () => renderTaskBE('B') },
  D: { label: '할루시네이션', contrib: '거부 (포화)', n: gold.D?.items.length ?? 0, body: () => renderTaskD() },
  E: { label: '곡 특화 (RAG-favored)', contrib: '근거제시 → RAG', n: gold.E?.items.length ?? 0, body: () => renderTaskBE('E') },
};

const summaryRows = Object.entries(taskMeta).map(([t, m]) => `<tr>
  <td><a href="#task-${t}"><b>${t}</b> · ${m.label}</a></td>
  <td>${m.contrib || ''}</td>
  <td>${m.n}</td>
  <td>${orderedLabels(t).map((lbl) => labelChip(lbl)).join(' ') || '<i>응답 없음</i>'}</td>
</tr>`).join('');

const modelsHeader = runMeta.models.length
  ? runMeta.models.map((m) => `<code>${escHTML(m.id)}=${escHTML(m.model)}</code>`).join(' · ')
  : '<code>(unknown)</code>';
const ragHeader = runMeta.rag.enabled
  ? `on (n=${runMeta.rag.n}${runMeta.rag.min_score ? `, min_score=${runMeta.rag.min_score}` : ''})`
  : 'off';

const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Jazzify 벤치마크 · 결과</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" />
<style>
:root {
  --gold: #D4A843; --gold-dark: #B8860B; --ink: #13110D; --ink-soft: #2A2620;
  --teal: #163239; --cream: #F8F5EF; --cream-card: #FFFFFF; --line: #E7E0D4;
  --muted: #6e6a62; --ok: #2D8F5E; --bad: #C45C5C;
  --haiku: #1F6FA8; --sonnet: #B8860B;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--ink); background: var(--cream); letter-spacing: -0.01em;
  line-height: 1.5; }
code, pre { font-family: 'JetBrains Mono', 'Menlo', Consolas, monospace; font-size: 12.5px; }
pre { margin: 0; }
a { color: var(--gold-dark); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap { max-width: 1100px; margin: 0 auto; padding: 40px 28px 80px; }
header { border-bottom: 1px solid var(--line); padding-bottom: 24px; margin-bottom: 28px; }
header h1 { margin: 0 0 6px; font-size: 32px; font-weight: 800; letter-spacing: -0.025em; }
header .sub { color: var(--muted); font-size: 14.5px; }
header .sub code { color: var(--ink); background: rgba(0,0,0,0.04); padding: 2px 7px; border-radius: 5px; }
header .sub-line + .sub-line { margin-top: 4px; }

h2 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin: 40px 0 12px; padding-top: 8px; border-top: 1px solid var(--line); }
h2 .small { font-weight: 600; color: var(--muted); font-size: 14px; margin-left: 8px; }
h3 { font-size: 16px; font-weight: 700; margin: 28px 0 10px; }

table { width: 100%; border-collapse: collapse; }
.summary table, .agg table { background: var(--cream-card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.summary th, .summary td, .agg th, .agg td { padding: 9px 14px; font-size: 14px; text-align: left; }
.summary thead th, .agg thead th { background: rgba(0,0,0,0.03); font-weight: 700; color: var(--ink-soft); border-bottom: 1px solid var(--line); }
.summary tbody tr + tr td, .agg tbody tr + tr th, .agg tbody tr + tr td { border-top: 1px solid var(--line); }
.agg { margin-bottom: 14px; }

/* Model + condition chip */
.lbl { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 700; }
.lbl-m { padding: 2px 7px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; color: #fff; font-size: 11.5px; letter-spacing: 0.02em; }
.lbl-m.m-haiku { background: var(--haiku); }
.lbl-m.m-sonnet { background: var(--sonnet); }
.lbl-c { color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; font-size: 12px; }

details.item { background: var(--cream-card); border: 1px solid var(--line); border-radius: 10px; margin: 8px 0; padding: 0; }
details.item summary { padding: 12px 16px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
details.item summary::-webkit-details-marker { display: none; }
details.item summary::before { content: "▸"; color: var(--muted); margin-right: 4px; }
details.item[open] summary::before { content: "▾"; }
details.item .id { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--gold-dark); font-weight: 700; }
details.item .chords { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--ink); }
details.item .q { color: var(--ink-soft); }
details.item .gold { color: var(--muted); font-size: 12.5px; font-family: 'JetBrains Mono', monospace; }
details.item .badge { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; }
details.item .badge.trap { background: rgba(196,92,92,0.12); color: var(--bad); }
details.item .badge.control { background: rgba(45,143,94,0.12); color: var(--ok); }
details.item .body { padding: 6px 18px 16px; border-top: 1px solid var(--line); }
details.item .body p { margin: 10px 0 6px; font-size: 13.5px; }
details.item .body ul { margin: 6px 0 14px 18px; padding: 0; font-size: 13.5px; color: var(--ink-soft); }
details.item .rule { background: rgba(212,168,67,0.07); padding: 10px 12px; border-radius: 8px; font-size: 13px; }

table.cond { width: 100%; border-collapse: collapse; margin-top: 10px; }
table.cond th, table.cond td { padding: 8px 10px; font-size: 13px; vertical-align: top; border-bottom: 1px solid var(--line); }
table.cond th { font-weight: 700; color: var(--ink-soft); white-space: nowrap; background: rgba(0,0,0,0.02); }
table.cond td.reply { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--ink-soft); }
table.cond td.reply code { background: rgba(0,0,0,0.04); padding: 1px 6px; border-radius: 4px; color: var(--ink); }
.ok { color: var(--ok); font-weight: 800; }
.bad { color: var(--bad); font-weight: 800; }
.miss { color: var(--muted); }

.creply { background: rgba(0,0,0,0.02); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
.creply .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13.5px; }
.creply .score { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--muted); }
.creply pre.long { white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; padding: 10px 12px; background: var(--cream-card); border-radius: 6px; border: 1px solid var(--line); font-size: 12.5px; line-height: 1.55; }

.toolbar { display: flex; align-items: center; gap: 12px; margin: 10px 0 8px; font-size: 13.5px; color: var(--muted); flex-wrap: wrap; }
.toolbar input[type="search"] { font-family: inherit; font-size: 13.5px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--cream-card); color: var(--ink); width: 240px; outline: none; }
.toolbar input[type="search"]:focus { border-color: var(--gold); }
.toolbar label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
footer code { background: rgba(0,0,0,0.04); padding: 1px 6px; border-radius: 4px; }
</style>
</head><body><div class="wrap">

<header>
  <h1>Jazzify 벤치마크 · 전체 결과</h1>
  <p class="sub sub-line">models: ${modelsHeader} · judge <code>${escHTML(runMeta.judge)}</code></p>
  <p class="sub sub-line">conditions: <code>raw</code> · <code>+Rule</code> · <code>+Rule+RAG</code> · RAG ${ragHeader} · 응답 ${responses.length}건${runMeta.timestamp ? ' · ' + escHTML(runMeta.timestamp) : ''}</p>
</header>

<section class="summary">
  <h2>요약</h2>
  <table>
    <thead><tr><th>태스크</th><th>기여 분해 (A=raw · B=+Rule · C=+Rule+RAG)</th><th>문항 수</th><th>측정된 조건</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
</section>

${Object.entries(taskMeta).map(([t, m]) => `
<section id="task-${t}">
  <h2>${t} · ${m.label} <span class="small">(${m.n}문항)</span></h2>
  <div class="agg"><table>
    <thead>${aggHeaderForTask(t)}</thead>
    <tbody>${aggrowsForTask(t)}</tbody>
  </table></div>
  <div class="toolbar">
    <input type="search" placeholder="필터 (id·질문·코드)…" data-filter="${t}" />
    <label><input type="checkbox" data-only-fail="${t}" /> 오답/실패만</label>
    <span data-count="${t}"></span>
  </div>
  ${m.body()}
</section>
`).join('')}

<footer>
  파일: <code>gold/*.json</code> · <code>results/responses.json</code> · <code>scorer.mjs</code> ·
  세부 마크다운: <code>DISCLOSURE.md</code>
</footer>

</div>
<script>
function isFail(detail) {
  const t = detail.innerText || '';
  return /✗|응답 없음/.test(t);
}
function applyFilter(task) {
  const filterEl = document.querySelector('input[data-filter="' + task + '"]');
  const failEl   = document.querySelector('input[data-only-fail="' + task + '"]');
  const countEl  = document.querySelector('[data-count="' + task + '"]');
  const q = (filterEl?.value || '').trim().toLowerCase();
  const onlyFail = !!failEl?.checked;
  const items = document.querySelectorAll('#task-' + task + ' details.item');
  let visible = 0, total = items.length;
  items.forEach((d) => {
    const text = (d.innerText || '').toLowerCase();
    const matchQ = !q || text.includes(q);
    const matchFail = !onlyFail || isFail(d);
    const ok = matchQ && matchFail;
    d.style.display = ok ? '' : 'none';
    if (ok) visible++;
  });
  if (countEl) countEl.textContent = visible + ' / ' + total;
}
document.querySelectorAll('input[data-filter]').forEach((el) => {
  const t = el.dataset.filter;
  el.addEventListener('input', () => applyFilter(t));
  applyFilter(t);
});
document.querySelectorAll('input[data-only-fail]').forEach((el) => {
  el.addEventListener('change', () => applyFilter(el.dataset.onlyFail));
});
</script>
</body></html>
`;

const out = join(HERE, 'index.html');
writeFileSync(out, html);
console.log(`Wrote ${out} — ${html.length.toLocaleString()} chars`);
