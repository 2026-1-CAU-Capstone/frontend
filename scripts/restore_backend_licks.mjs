/* Restores the 145 backup licks (rag/scratch/backend_licks.json) to the
 * backend via POST /v1/licks. Sequential, polite delay, per-row error
 * tolerance. 409 (duplicate) → skip with note. Other errors → log and
 * continue so a single bad row doesn't kill the run.
 *
 * Run:  node scripts/restore_backend_licks.mjs
 *       node scripts/restore_backend_licks.mjs --dry      # validate body shape
 *       node scripts/restore_backend_licks.mjs --limit=5  # first N only
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const API_BASE = 'https://jazzify.p-e.kr/api';
const DELAY_MS = 200;
const DRY = process.argv.includes('--dry');
const limitArg = (process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

const HARMONIC_ENUM = new Set(['blues', 'other', 'major', 'minor']);

function toCreateRequest(r) {
  const harmonicContext = r.harmonicContext && HARMONIC_ENUM.has(r.harmonicContext)
    ? r.harmonicContext
    : null;
  return {
    performer: r.performer,
    title: r.title,
    album: r.album ?? '',
    instrument: r.instrument,
    style: r.style || null,
    tempo: r.tempo,
    key: r.key,
    rhythmFeel: r.rhythmFeel || null,
    timeSignature: r.timeSignature || r.sheetData?.timeSignature || '4/4',
    chords: (r.chords || []).filter((c) => typeof c === 'string' && c.length > 0),
    harmonicContext,
    sheetData: r.sheetData,
    nEvents: r.nEvents ?? 0,
    intervals: r.intervals ?? [],
    parsons: r.parsons ?? [],
    fuzzyIntervals: r.fuzzyIntervals ?? [],
    durationClasses: r.durationClasses ?? [],
  };
}

async function postOne(body) {
  const res = await fetch(`${API_BASE}/v1/licks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const json = await res.json();
    return { ok: true, publicId: json.data?.publicId };
  }
  let detail = {};
  try { detail = await res.json(); } catch { /* ignore */ }
  return {
    ok: false,
    status: res.status,
    code: detail.code,
    message: detail.message || detail.detail || '',
    isDup: res.status === 409 || detail.code === 'LICK_002',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const src = JSON.parse(readFileSync(join(ROOT, 'rag/scratch/backend_licks.json'), 'utf8'));
  const total = Math.min(src.length, LIMIT);
  console.log(`Source: ${src.length} licks · uploading ${total}${DRY ? ' (DRY RUN — no POST)' : ''}`);
  console.log(`Target: ${API_BASE}/v1/licks · delay ${DELAY_MS}ms\n`);

  const stats = { ok: 0, dup: 0, fail: 0 };
  const failures = [];

  for (let i = 0; i < total; i++) {
    const r = src[i];
    const body = toCreateRequest(r);
    const label = `[${i + 1}/${total}] ${r.performer} — ${r.title}`.slice(0, 90);

    if (DRY) {
      const sanity = body.performer && body.title && body.sheetData && body.chords;
      console.log(`${sanity ? '✓' : '✗'} ${label}  · chords=${body.chords.length} measures=${body.sheetData?.measures?.length ?? 0}`);
      if (sanity) stats.ok++; else { stats.fail++; failures.push({ i, label, reason: 'shape' }); }
      continue;
    }

    try {
      const result = await postOne(body);
      if (result.ok) {
        stats.ok++;
        process.stdout.write(`✓ ${label} → ${result.publicId?.slice(0, 8)}\n`);
      } else if (result.isDup) {
        stats.dup++;
        process.stdout.write(`= ${label}  (이미 존재)\n`);
      } else {
        stats.fail++;
        failures.push({ i, label, status: result.status, code: result.code, message: result.message });
        process.stdout.write(`✗ ${label}  HTTP ${result.status} ${result.code || ''} ${result.message || ''}\n`);
      }
    } catch (e) {
      stats.fail++;
      failures.push({ i, label, error: String(e) });
      process.stdout.write(`✗ ${label}  ${String(e).slice(0, 120)}\n`);
    }
    if (i < total - 1) await sleep(DELAY_MS);
  }

  console.log(`\n=== 결과 ===`);
  console.log(`성공: ${stats.ok}`);
  console.log(`중복(skip): ${stats.dup}`);
  console.log(`실패: ${stats.fail}`);
  if (failures.length) {
    console.log(`\n실패 상세 (최대 10):`);
    for (const f of failures.slice(0, 10)) console.log(' ', JSON.stringify(f));
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
