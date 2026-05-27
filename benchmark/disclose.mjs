/* Generates benchmark/DISCLOSURE.md from gold/* + results/responses.json:
 * every QA pair shown alongside every (model, condition) cell's raw answer + score.
 * Run:  node benchmark/disclose.mjs
 *
 * Response layout (new, multi-model):
 *   { task, id, model, condition, label: '<model>/<condition>', reply, score }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const tryRead = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const gold = {
  A: tryRead(join(HERE, 'gold/structural.json')),
  B: tryRead(join(HERE, 'gold/theory.json')),
  C: tryRead(join(HERE, 'gold/explanatory.json')),
  D: tryRead(join(HERE, 'gold/hallucination.json')),
  E: tryRead(join(HERE, 'gold/song-grounded.json')),
};
const data = JSON.parse(readFileSync(join(HERE, 'results/responses.json'), 'utf8'));
const responses = data.responses || [];
const labelOf = (r) => r.label || `${r.model || 'legacy'}/${r.condition}`;

const byTask = { A: {}, B: {}, C: {}, D: {}, E: {} };
for (const r of responses) {
  if (!byTask[r.task]) continue;
  (byTask[r.task][r.id] ??= {});
  byTask[r.task][r.id][labelOf(r)] = r;
}

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

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const trunc = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const blockquote = (s, n = 1500) => trunc(s, n).split('\n').map((l) => '> ' + l).join('\n');

function fmtPredA(reply) {
  const j = extractJson(reply) || {};
  const k = Array.isArray(j.key) ? j.key.join(',') : (j.key ?? '');
  return `key=\`${esc(k)}\` · iiVi=\`${esc(JSON.stringify(j.iiVi ?? []))}\` · romans=\`${esc(JSON.stringify(j.romans ?? []))}\``;
}
function scoreLineA(s) {
  if (!s) return '—';
  return `key=${s.keyHit ? '✓' : '✗'} · P=${s.precision.toFixed(2)} R=${s.recall.toFixed(2)} F1=${s.f1.toFixed(2)} · Roman=${s.romanAcc == null ? '—' : Math.round(s.romanAcc * 100) + '%'}`;
}
function fmtPredB(reply) {
  const j = extractJson(reply);
  return j?.answer ?? trunc(reply, 120);
}
const scoreLineB = (s) => (s ? (s.hit ? '✓' : '✗') : '—');
function scoreLineD(s) {
  if (!s) return '—';
  if (s.type === 'control') return s.correct ? '✓ correct' : '✗ wrong';
  return s.hallucinated ? '✗ hallucinated' : '✓ correctly flagged';
}

const MODEL_ORDER = ['haiku', 'sonnet'];
const COND_ORDER = ['raw', '+Rule', '+Rule+RAG'];
const ALL_LABELS = [];
for (const m of MODEL_ORDER) for (const c of COND_ORDER) ALL_LABELS.push(`${m}/${c}`);

const have = {};
for (const r of responses) {
  const k = `${r.task} / ${labelOf(r)}`;
  have[k] = (have[k] || 0) + 1;
}
const haveLines = Object.keys(have).sort().map((k) => `  - ${k}: ${have[k]}건`).join('\n');

const modelsStr = (data.models || []).map((m) => `\`${m.id}\`=\`${m.model}\``).join(' · ') || '(unknown)';

let md = '';
md += '# Jazzify 벤치마크 — 전체 QA·응답 공개 (multi-model)\n\n';
md += '5개 태스크(A 구조분석 · B 이론팩트 · C 설명 · D 할루시네이션 · E 곡-grounded) × 모델 2개(haiku, sonnet) × 조건 3개(raw / +Rule / +Rule+RAG) — 합 6셀.\n\n';
md += `- **모델:** ${modelsStr}  ·  **judge:** \`${data.judge || '?'}\`  ·  **temperature:** 0\n`;
md += `- **조건:** ${COND_ORDER.join(' / ')}\n`;
md += `- **RAG:** ${data.rag?.enabled ? `on (n=${data.rag.n}${data.rag.min_score ? `, min_score=${data.rag.min_score}` : ''})` : 'off'}\n`;
md += `- **timestamp:** ${data.timestamp || '?'}\n`;
md += `- **이 머신에 있는 응답 (${responses.length}건):**\n${haveLines}\n\n---\n\n`;

/* ── A ───────────────────────────────────────────────────────────────── */
md += '## A · 구조 분석 (' + gold.A.items.length + '문항)\n\n';
md += '진행을 0-인덱스로 주고 `{"key":"...", "iiVi":[[i,j,k]], "romans":["..."]}` JSON 답을 받음. 채점: key 집합일치 / ii-V-I micro P·R·F1 / 코드별 로마숫자.\n\n';
for (const item of gold.A.items) {
  md += `### A · \`${item.id}\`\n`;
  md += `- **Chords:** \`${item.chords.join('  ')}\`\n`;
  md += `- **Gold:** keys=\`${JSON.stringify(item.keys)}\` · iiVi=\`${JSON.stringify(item.iiVi)}\``;
  if (item.romans) md += ` · romans=\`${JSON.stringify(item.romans)}\``;
  md += `\n- **Rule context (주입):** ${esc(item.ruleContext)}\n\n`;
  md += '| 모델/조건 | 모델 답 (parsed) | 채점 |\n|---|---|---|\n';
  for (const lbl of ALL_LABELS) {
    const r = byTask.A?.[item.id]?.[lbl];
    md += `| **${lbl}** | ${r ? fmtPredA(r.reply) : '_(응답 미동기화)_'} | ${scoreLineA(r?.score)} |\n`;
  }
  md += '\n';
}

/* ── B ───────────────────────────────────────────────────────────────── */
md += '## B · 이론 팩트 (' + gold.B.items.length + '문항)\n\n';
md += '단답. `{"answer":"..."}` JSON. normFact 정규화 후 accept[] 중 하나라도 매칭이면 정답.\n\n';
for (const item of gold.B.items) {
  md += `### B · \`${item.id}\`\n`;
  md += `- **Q:** ${esc(item.q)}\n- **Accept:** ${item.accept.map((a) => '`' + a + '`').join(' / ')}\n\n`;
  md += '| 모델/조건 | 답 | 채점 |\n|---|---|---|\n';
  for (const lbl of ALL_LABELS) {
    const r = byTask.B?.[item.id]?.[lbl];
    md += `| **${lbl}** | ${r ? esc(fmtPredB(r.reply)) : '_(응답 미동기화)_'} | ${scoreLineB(r?.score)} |\n`;
  }
  md += '\n';
}

/* ── C ───────────────────────────────────────────────────────────────── */
md += '## C · 설명 (' + gold.C.items.length + '문항, LLM-judge 1-5)\n\n';
md += 'LLM judge가 key-point 커버리지 + 정확성을 1~5점으로 채점.\n\n';
for (const item of gold.C.items) {
  md += `### C · \`${item.id}\`\n`;
  md += `- **Q:** ${esc(item.q)}\n- **Key points (judge 기준):**\n`;
  for (const p of (item.points || [])) md += `  - ${p}\n`;
  md += '\n';
  for (const lbl of ALL_LABELS) {
    const r = byTask.C?.[item.id]?.[lbl];
    md += `**${lbl}** — judge **${r ? r.score.score5 + '/5' : '—'}**\n\n`;
    md += (r ? blockquote(r.reply, 2000) : '> _(응답 미동기화)_') + '\n\n';
  }
  md += '---\n\n';
}

/* ── D ───────────────────────────────────────────────────────────────── */
md += '## D · 할루시네이션 (' + gold.D.items.length + '문항: trap + control, LLM-judge)\n\n';
md += 'trap = 거짓 전제/비표준 용어 — 모델이 거부/정정하면 정답(hallucinated=false). control = 정상 질문 — accept[] 중 하나로 답해야 정답.\n\n';
for (const item of gold.D.items) {
  md += `### D · \`${item.id}\` (${item.type})\n`;
  md += `- **Q:** ${esc(item.q)}\n`;
  if (item.type === 'control') md += `- **Accept:** ${(item.accept || []).map((a) => '`' + a + '`').join(' / ')}\n`;
  else md += `- **Trap — 좋은 답 신호 (참고):** ${(item.goodSignals || []).slice(0, 4).map((s) => '`' + s + '`').join(', ')}…\n`;
  md += '\n';
  for (const lbl of ALL_LABELS) {
    const r = byTask.D?.[item.id]?.[lbl];
    md += `**${lbl}** — ${scoreLineD(r?.score)}\n\n`;
    md += (r ? blockquote(r.reply, 900) : '> (no run)') + '\n\n';
  }
  md += '---\n\n';
}

/* ── E ───────────────────────────────────────────────────────────────── */
if (gold.E && gold.E.items?.length) {
  md += `## E · 곡 특화 (song-grounded, ${gold.E.items.length}문항)\n\n`;
  md += `_${gold.E.description || ''}_\n\n`;
  md += '코퍼스에 답이 직접 들어있는 곡 분석 질문 — RAG가 lift를 보여야 마땅한 통제 비교용 태스크.\n\n';
  for (const item of gold.E.items) {
    md += `### E · \`${item.id}\`\n`;
    md += `- **Q:** ${esc(item.q)}\n- **Accept:** ${(item.accept || []).map((a) => '`' + a + '`').join(' / ')}\n\n`;
    md += '| 모델/조건 | 답 | 채점 |\n|---|---|---|\n';
    for (const lbl of ALL_LABELS) {
      const r = byTask.E?.[item.id]?.[lbl];
      md += `| **${lbl}** | ${r ? esc(fmtPredB(r.reply)) : '_(응답 미동기화)_'} | ${scoreLineB(r?.score)} |\n`;
    }
    md += '\n';
  }
}

const out = join(HERE, 'DISCLOSURE.md');
writeFileSync(out, md);
console.log(`Wrote ${out} — ${md.length.toLocaleString()} chars, ${md.split('\n').length.toLocaleString()} lines`);
