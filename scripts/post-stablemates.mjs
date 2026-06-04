#!/usr/bin/env node
/**
 * One-shot: POST a single NoteSheet JSON to the solo DB as a "Benny Golson" entry.
 *
 * The JSON file must be a full NoteSheetData object (title, composer, key,
 * timeSignature, tempo, measures) — i.e. exactly the shape pasted from the editor.
 *
 * Auth (POST /v1/solos requires a logged-in user). Provide ONE of:
 *   - JAZZIFY_TOKEN=<accessToken>                 (from browser localStorage
 *                                                  key 'jazzify.auth.accessToken')
 *   - JAZZIFY_USER=<username> JAZZIFY_PASS=<pw>    (script logs in for a token)
 *
 * Usage:
 *   node scripts/post-stablemates.mjs <path-to.json>            # dry-run, prints body summary
 *   JAZZIFY_TOKEN=... node scripts/post-stablemates.mjs <path-to.json> --apply
 */

import { readFile } from 'node:fs/promises';

const API_BASE = 'https://jazzify.p-e.kr/api';

const PERFORMER = 'Benny Golson';
const INSTRUMENT = 'ts';
const SOURCE = 'curated';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const jsonPath = args.find((a) => !a.startsWith('--'));

if (!jsonPath) {
  console.error('Usage: node scripts/post-stablemates.mjs <path-to.json> [--apply]');
  process.exit(1);
}

function buildBody(sheet) {
  const body = {
    source: SOURCE,
    title: sheet.title || 'Untitled',
    instrument: INSTRUMENT,
    sheetData: sheet,
    features: null,            // backend computes from sheetData
    performer: PERFORMER,
  };
  if (sheet.tempo != null && Number.isFinite(sheet.tempo)) body.tempo = sheet.tempo;
  if (sheet.key) body.key = sheet.key;                  // already Weimar form ("Bb-maj")
  if (sheet.timeSignature) body.timeSignature = sheet.timeSignature;
  return body;
}

/** Resolve a Bearer token: prefer JAZZIFY_TOKEN, else log in with USER/PASS. */
async function resolveToken() {
  if (process.env.JAZZIFY_TOKEN) return process.env.JAZZIFY_TOKEN.trim();
  const user = process.env.JAZZIFY_USER;
  const pass = process.env.JAZZIFY_PASS;
  if (!user || !pass) {
    throw new Error(
      'No auth. Set JAZZIFY_TOKEN, or JAZZIFY_USER + JAZZIFY_PASS.',
    );
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

async function main() {
  const raw = await readFile(jsonPath, 'utf8');
  const sheet = JSON.parse(raw);

  if (!Array.isArray(sheet.measures) || sheet.measures.length === 0) {
    throw new Error('JSON has no measures[] — is the file complete?');
  }

  const body = buildBody(sheet);

  console.log(`Mode: ${APPLY ? 'APPLY (will POST)' : 'DRY RUN'}`);
  console.log('Summary:');
  console.log(`  title        : ${body.title}`);
  console.log(`  performer    : ${body.performer}`);
  console.log(`  instrument   : ${body.instrument}`);
  console.log(`  source       : ${body.source}`);
  console.log(`  key          : ${body.key ?? '(none)'}`);
  console.log(`  timeSignature: ${body.timeSignature ?? '(none)'}`);
  console.log(`  tempo        : ${body.tempo ?? '(none)'}`);
  console.log(`  measures     : ${sheet.measures.length}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to POST.');
    return;
  }

  const token = await resolveToken();

  const res = await fetch(`${API_BASE}/v1/solos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST -> ${res.status} ${text}`);
  }
  let publicId = '(unknown)';
  try { publicId = (JSON.parse(text).data ?? JSON.parse(text)).publicId ?? publicId; } catch { /* */ }
  console.log(`\n✓ Created solo. publicId=${publicId}`);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exitCode = 1;
});
