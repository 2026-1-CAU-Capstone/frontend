#!/usr/bin/env node
/**
 * Restore lick → YouTube video (onset) mappings from the pre-wipe backup
 * snapshot to the live backend.
 *
 * Source: public/data/licks/backend_backup_licks.json (2026-06-01, taken
 * right before the backend wipe — 145 licks, 6 of which carry a `video`
 * field recorded via the /admin YouTube onset parser).
 *
 * Matching strategy, per backup entry with video:
 *   1. publicId — exact match against a live lick (survives if the wipe
 *      didn't reassign ids).
 *   2. title + performer — normalised (case/space-insensitive) match.
 *      Used when ids were reassigned by re-seeding.
 *   3. unmatched → reported, nothing written.
 *
 * Safety:
 *   - DRY RUN by default — prints the restore plan only. Add --apply to PUT.
 *   - Live licks that ALREADY have a video are skipped unless --force.
 *
 * Auth (PUT /v1/licks/{id}/video requires a logged-in user). Provide ONE of:
 *   - JAZZIFY_TOKEN=<accessToken>              (browser localStorage token)
 *   - JAZZIFY_USER=<username> JAZZIFY_PASS=<pw> (script logs in)
 *
 * Usage:
 *   node scripts/restore-lick-videos.mjs                 # dry-run plan
 *   JAZZIFY_TOKEN=... node scripts/restore-lick-videos.mjs --apply
 *   JAZZIFY_TOKEN=... node scripts/restore-lick-videos.mjs --apply --force
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_BASE = 'https://jazzify.p-e.kr/api';
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_PATH = join(__dirname, '../public/data/licks/backend_backup_licks.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');

/** Normalise a title/performer for fuzzy identity comparison. */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s'’"().,\-–—_/]+/g, '');
}

function matchKey(lick) {
  return `${norm(lick.title)}::${norm(lick.performer)}`;
}

/** Resolve a Bearer token: prefer JAZZIFY_TOKEN, else log in with USER/PASS. */
async function resolveToken() {
  if (process.env.JAZZIFY_TOKEN) return process.env.JAZZIFY_TOKEN.trim();
  const user = process.env.JAZZIFY_USER;
  const pass = process.env.JAZZIFY_PASS;
  if (!user || !pass) {
    throw new Error('No auth. Set JAZZIFY_TOKEN, or JAZZIFY_USER + JAZZIFY_PASS.');
  }
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login -> ${res.status} ${text}`);
  const data = JSON.parse(text).data ?? JSON.parse(text);
  if (!data.accessToken) throw new Error('login ok but no accessToken in response');
  console.log(`Logged in as ${data.username ?? user}.`);
  return data.accessToken;
}

/** Fetch every live lick (paged GET /v1/licks). */
async function fetchAllLiveLicks(token) {
  const all = [];
  let page = 0;
  for (;;) {
    const res = await fetch(`${API_BASE}/v1/licks?page=${page}&size=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET /v1/licks page=${page} -> ${res.status} ${text.slice(0, 200)}`);
    const body = JSON.parse(text);
    const pageData = body.data ?? body;
    const content = pageData.content ?? [];
    all.push(...content);
    if (pageData.last !== false || content.length === 0) break;
    page++;
  }
  return all;
}

async function putVideo(token, publicId, video) {
  const res = await fetch(`${API_BASE}/v1/licks/${encodeURIComponent(publicId)}/video`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(video),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT video ${publicId} -> ${res.status} ${text.slice(0, 200)}`);
  }
}

async function main() {
  /* 1. Load backup → keep only entries that carry a video. */
  const backup = JSON.parse(await readFile(BACKUP_PATH, 'utf8'));
  const withVideo = backup.filter((l) => l.video && l.video.videoId);
  console.log(`Backup: ${backup.length} licks, ${withVideo.length} with video.`);
  if (withVideo.length === 0) {
    console.log('Nothing to restore.');
    return;
  }

  /* 2. Pull the live lick list (auth needed even for dry-run, since the
   *    whole point is diffing against live state). */
  const token = await resolveToken();
  const live = await fetchAllLiveLicks(token);
  console.log(`Live backend: ${live.length} licks, ${live.filter((l) => l.video).length} with video.\n`);

  const liveById = new Map(live.map((l) => [l.publicId, l]));
  const liveByKey = new Map();
  for (const l of live) {
    const k = matchKey(l);
    /* First occurrence wins; ambiguous duplicates are flagged below. */
    if (!liveByKey.has(k)) liveByKey.set(k, l);
    else liveByKey.set(k, 'AMBIGUOUS');
  }

  /* 3. Build the restore plan. */
  const plan = [];      // { backupLick, target, how }
  const skipped = [];   // { backupLick, reason }
  for (const b of withVideo) {
    const byId = liveById.get(b.publicId);
    let target = null;
    let how = '';
    if (byId) {
      target = byId;
      how = 'publicId';
    } else {
      const byKey = liveByKey.get(matchKey(b));
      if (byKey === 'AMBIGUOUS') {
        skipped.push({ b, reason: 'title+performer matches MULTIPLE live licks — resolve manually' });
        continue;
      }
      if (byKey) {
        target = byKey;
        how = 'title+performer';
      }
    }
    if (!target) {
      skipped.push({ b, reason: 'no live match (deleted or renamed?)' });
      continue;
    }
    if (target.video && !FORCE) {
      skipped.push({ b, reason: `live lick already has video (${target.video.videoId}) — use --force to overwrite` });
      continue;
    }
    plan.push({ b, target, how });
  }

  /* 4. Report. */
  console.log(`Mode: ${APPLY ? 'APPLY (will PUT)' : 'DRY RUN'}${FORCE ? ' + FORCE' : ''}\n`);
  if (plan.length > 0) {
    console.log(`Will restore ${plan.length}:`);
    for (const { b, target, how } of plan) {
      const v = b.video;
      console.log(
        `  ✓ [${how}] ${b.performer ?? '—'} — ${b.title ?? '(untitled)'}\n` +
        `      ${b.publicId} -> ${target.publicId}\n` +
        `      video ${v.videoId} @ ${v.startSec}s${v.endSec != null ? ` → ${v.endSec}s` : ''}`,
      );
    }
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const { b, reason } of skipped) {
      console.log(`  ✗ ${b.performer ?? '—'} — ${b.title ?? '(untitled)'} (${b.publicId})\n      ${reason}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  /* 5. Apply sequentially (6-ish entries — no need for concurrency). */
  let ok = 0;
  let fail = 0;
  for (const { b, target } of plan) {
    const video = {
      videoId: b.video.videoId,
      startSec: b.video.startSec,
      ...(b.video.endSec != null ? { endSec: b.video.endSec } : {}),
      ...(b.video.url ? { url: b.video.url } : {}),
    };
    try {
      await putVideo(token, target.publicId, video);
      ok++;
      console.log(`PUT ok: ${target.publicId} (${b.title})`);
    } catch (err) {
      fail++;
      console.error(`PUT FAILED: ${target.publicId} (${b.title}) — ${err.message}`);
    }
  }
  console.log(`\nDone. ${ok} restored, ${fail} failed.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
