#!/usr/bin/env node
/**
 * One-shot admin: set performer="Charlie Parker" on every backend solo whose
 * title matches a Charlie Parker Omnibook file.
 *
 * Identification:
 *   - Lists data/omnibook/Omnibook xml/*.xml
 *   - For each file, builds candidate titles from:
 *       (a) filename → strip .xml, replace _ with space
 *       (b) <work-title> or <movement-title> tag inside the XML
 *   - A backend solo matches if its title (case-insensitive) equals one of
 *     those candidate titles AND the solo's current performer is not already
 *     "Charlie Parker".
 *
 * Usage:
 *   node scripts/fix-parker-performers.mjs [--apply]
 *   - default: dry-run, prints what would change
 *   - --apply: actually PUTs to backend
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OMNIBOOK_DIR = join(REPO_ROOT, 'data', 'omnibook', 'Omnibook xml');

const API_BASE = 'https://jazzify.p-e.kr/api';
const TARGET_PERFORMER = 'Charlie Parker';
const APPLY = process.argv.includes('--apply');

function normalize(s) {
  return (s ?? '').trim().toLowerCase();
}

async function buildExpectedTitles() {
  const files = await readdir(OMNIBOOK_DIR);
  const xmlFiles = files.filter((f) => f.toLowerCase().endsWith('.xml'));
  const titles = new Set();

  for (const fn of xmlFiles) {
    const fromName = fn.replace(/\.xml$/i, '').replace(/_/g, ' ').trim();
    titles.add(normalize(fromName));

    try {
      const xml = await readFile(join(OMNIBOOK_DIR, fn), 'utf8');
      const work = xml.match(/<work-title>\s*([^<]+?)\s*<\/work-title>/i);
      const mov = xml.match(/<movement-title>\s*([^<]+?)\s*<\/movement-title>/i);
      if (work?.[1]) titles.add(normalize(work[1]));
      if (mov?.[1]) titles.add(normalize(mov[1]));
    } catch (e) {
      console.warn(`  ! couldn't read ${fn}:`, e.message);
    }
  }

  console.log(`Built ${titles.size} candidate titles from ${xmlFiles.length} Omnibook files.`);
  return titles;
}

async function fetchAllSolos() {
  const all = [];
  let page = 0;
  const PAGE_SIZE = 200;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${API_BASE}/v1/solos?page=${page}&size=${PAGE_SIZE}&sort=createdAt%2Casc`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`list page ${page} failed: ${res.status}`);
    const json = await res.json();
    const data = json.data ?? json;
    all.push(...(data.content ?? []));
    if (data.last || (data.content ?? []).length === 0) break;
    page++;
    if (page > 50) throw new Error('safety: bailing after 50 pages');
  }
  console.log(`Fetched ${all.length} total solos.`);
  return all;
}

function buildPutBody(solo, newPerformer) {
  const body = {
    source: solo.source,
    title: solo.title || 'Untitled',
    instrument: solo.instrument,
    sheetData: solo.sheetData,
    features: null,
    performer: newPerformer,
  };
  if (solo.userId != null) body.userId = solo.userId;
  if (solo.sourceUrl) body.sourceUrl = solo.sourceUrl;
  if (solo.album) body.album = solo.album;
  if (solo.style) body.style = solo.style;
  if (solo.tempo != null) body.tempo = solo.tempo;
  if (solo.key) body.key = solo.key;
  if (solo.rhythmFeel) body.rhythmFeel = solo.rhythmFeel;
  if (solo.timeSignature) body.timeSignature = solo.timeSignature;
  if (Array.isArray(solo.chords) && solo.chords.length > 0) body.chords = solo.chords;
  if (Array.isArray(solo.chordsPerNote) && solo.chordsPerNote.length > 0) body.chordsPerNote = solo.chordsPerNote;
  if (solo.harmonicContext) body.harmonicContext = solo.harmonicContext;
  if (solo.targetChord) body.targetChord = solo.targetChord;
  return body;
}

async function putSolo(publicId, body) {
  const res = await fetch(`${API_BASE}/v1/solos/${encodeURIComponent(publicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* */ }
    throw new Error(`PUT ${publicId} -> ${res.status} ${detail}`);
  }
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will PUT to backend)' : 'DRY RUN (no changes)'}\n`);

  const expected = await buildExpectedTitles();
  const solos = await fetchAllSolos();

  const targets = solos.filter(
    (s) => expected.has(normalize(s.title)) && normalize(s.performer) !== normalize(TARGET_PERFORMER),
  );

  console.log(`\nMatched ${targets.length} solos to fix:\n`);
  for (const s of targets) {
    console.log(`  ${s.publicId.slice(0, 8)}  "${s.title}"  ${JSON.stringify(s.performer ?? null)} -> "${TARGET_PERFORMER}"`);
  }

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to PUT these changes.`);
    return;
  }
  if (targets.length === 0) {
    console.log(`\nNothing to do.`);
    return;
  }

  console.log(`\nApplying ${targets.length} updates...`);
  let ok = 0;
  let failed = 0;
  for (const s of targets) {
    try {
      await putSolo(s.publicId, buildPutBody(s, TARGET_PERFORMER));
      ok++;
      process.stdout.write('.');
    } catch (e) {
      failed++;
      console.error(`\n  ✗ ${s.publicId} (${s.title}): ${e.message}`);
    }
  }
  console.log(`\n\nDone: ${ok} ok, ${failed} failed.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exitCode = 1;
});
