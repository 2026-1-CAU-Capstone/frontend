/* Wipes the current backend lick DB and re-uploads from the backup snapshot
 * in REVERSE iteration order so the resulting createdAt ordering matches the
 * original chronology (newest original = latest createdAt = top of DESC list).
 *
 * The backup file (rag/scratch/backend_licks.json) was dumped via /v1/licks
 * with sort=createdAt,desc → index 0 is the NEWEST original, index 144 is the
 * OLDEST. Posting in i: 144→0 order means the oldest gets posted first and
 * the newest gets posted last → newest ends up with the latest restore-time
 * createdAt → tops the DESC list.
 *
 * Run:  node scripts/wipe_and_restore_licks.mjs
 *       node scripts/wipe_and_restore_licks.mjs --dry   # plan only, no writes
 *       node scripts/wipe_and_restore_licks.mjs --skip-wipe  # only re-upload
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const API_BASE = 'https://jazzify.p-e.kr/api';
const DELAY_MS = 200;
const DRY = process.argv.includes('--dry');
const SKIP_WIPE = process.argv.includes('--skip-wipe');

const HARMONIC_ENUM = new Set(['blues', 'other', 'major', 'minor']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toCreateRequest(r) {
  const harmonicContext = r.harmonicContext && HARMONIC_ENUM.has(r.harmonicContext) ? r.harmonicContext : null;
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

async function listAll() {
  const res = await fetch(`${API_BASE}/v1/licks?page=0&size=300&sort=createdAt,desc`);
  if (!res.ok) throw new Error(`list ${res.status}`);
  const j = await res.json();
  return j.data?.content ?? [];
}

async function deleteOne(publicId) {
  const res = await fetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try { const j = await res.json(); detail = j.detail || j.message || ''; } catch { /* ignore */ }
    return { ok: false, status: res.status, detail };
  }
  return { ok: true };
}

async function postOne(body) {
  const res = await fetch(`${API_BASE}/v1/licks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const j = await res.json();
    return { ok: true, publicId: j.data?.publicId };
  }
  let detail = {};
  try { detail = await res.json(); } catch { /* ignore */ }
  return { ok: false, status: res.status, code: detail.code, message: detail.message || detail.detail };
}

async function wipe() {
  console.log('\n── Phase 1: WIPE ────────────────────────────');
  const existing = await listAll();
  console.log(`현재 backend 보유: ${existing.length}개`);
  if (DRY) {
    console.log(`(dry) 삭제 예정 ${existing.length}개 — skip actual DELETE`);
    return existing.length;
  }
  let okCount = 0, failCount = 0;
  for (let i = 0; i < existing.length; i++) {
    const l = existing[i];
    const r = await deleteOne(l.publicId);
    const label = `[${i + 1}/${existing.length}] ${l.publicId.slice(0, 8)} · ${l.performer} — ${l.title}`.slice(0, 100);
    if (r.ok) {
      okCount++;
      if ((i + 1) % 20 === 0 || i === existing.length - 1) process.stdout.write(`  ✓ ${label}\n`);
    } else {
      failCount++;
      process.stdout.write(`  ✗ ${label}  HTTP ${r.status} ${r.detail}\n`);
    }
    if (i < existing.length - 1) await sleep(DELAY_MS);
  }
  console.log(`wipe 결과: 삭제 ${okCount} · 실패 ${failCount}`);

  // verify
  const after = await listAll();
  if (after.length > 0) {
    console.warn(`⚠ 잔여 ${after.length}개 — 두 번째 패스 진행`);
    for (const l of after) { await deleteOne(l.publicId); await sleep(DELAY_MS); }
  }
  const final = await listAll();
  console.log(`wipe 완료. 남은 항목: ${final.length}`);
  return final.length;
}

async function restoreReverse() {
  console.log('\n── Phase 2: RESTORE (역순 iteration) ────────────────────');
  const src = JSON.parse(readFileSync(join(ROOT, 'rag/scratch/backend_licks.json'), 'utf8'));
  console.log(`백업: ${src.length}개 (index 0=newest original → 144=oldest)`);
  console.log(`POST 순서: index 144→0 (oldest first → newest last)`);
  console.log(`→ 결과: 백엔드 DESC 정렬 시 index 0(newest)이 맨 위로\n`);

  if (DRY) {
    console.log(`(dry) 업로드 예정 ${src.length}개 — skip actual POST`);
    return { ok: 0, fail: 0 };
  }

  const stats = { ok: 0, fail: 0 };
  for (let i = src.length - 1; i >= 0; i--) {
    const r = src[i];
    const body = toCreateRequest(r);
    const progress = `[${src.length - i}/${src.length}]`;
    const label = `${progress} src[${i}] ${r.performer} — ${r.title}`.slice(0, 100);
    try {
      const result = await postOne(body);
      if (result.ok) {
        stats.ok++;
        if (stats.ok % 20 === 0 || i === 0 || i === src.length - 1) process.stdout.write(`  ✓ ${label} → ${result.publicId?.slice(0, 8)}\n`);
      } else {
        stats.fail++;
        process.stdout.write(`  ✗ ${label}  HTTP ${result.status} ${result.code || ''} ${result.message || ''}\n`);
      }
    } catch (e) {
      stats.fail++;
      process.stdout.write(`  ✗ ${label}  ${String(e).slice(0, 120)}\n`);
    }
    if (i > 0) await sleep(DELAY_MS);
  }
  return stats;
}

async function verifyOrder() {
  console.log('\n── Phase 3: VERIFY 정렬 ───────────────────');
  const list = await listAll();
  if (list.length === 0) { console.log('(empty)'); return; }
  const src = JSON.parse(readFileSync(join(ROOT, 'rag/scratch/backend_licks.json'), 'utf8'));
  const expectedTop3 = src.slice(0, 3).map((x) => `${x.performer} — ${x.title}`);
  const actualTop3 = list.slice(0, 3).map((x) => `${x.performer} — ${x.title}`);
  console.log('백엔드 DESC 정렬 TOP 3:');
  list.slice(0, 3).forEach((x, i) => console.log(`  ${i + 1}. ${x.performer} — ${x.title}`));
  console.log('\n백업 원본 TOP 3 (기대값):');
  expectedTop3.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  const match = JSON.stringify(actualTop3) === JSON.stringify(expectedTop3);
  console.log(`\n매치: ${match ? '✓ 정렬 일치' : '✗ 불일치'}`);
  console.log(`총 ${list.length}개 / 백업 ${src.length}개`);
}

async function main() {
  console.log(`Target: ${API_BASE}/v1/licks${DRY ? ' (DRY)' : ''}`);
  if (!SKIP_WIPE) await wipe();
  else console.log('--skip-wipe 지정 — wipe 건너뜀');
  const stats = await restoreReverse();
  console.log(`\nrestore 결과: 성공 ${stats.ok} · 실패 ${stats.fail}`);
  if (!DRY) await verifyOrder();
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
