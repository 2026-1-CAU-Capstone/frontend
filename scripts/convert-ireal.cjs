#!/usr/bin/env node
/**
 * Fetches jazz1460.txt from the chirp demo, parses the iReal Pro URI format,
 * and writes src/data/jazzSongs.ts containing the first 100 songs as
 * LeadSheetData[].
 *
 * iReal Pro parsing references:
 *   https://github.com/pianosnake/ireal-reader
 *   https://github.com/infojunkie/ireal-musicxml
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── constants ───────────────────────────────────────────────────────────────

const DATA_URL      = 'https://blog.karimratib.me/demos/chirp/data/jazz1460.txt';
const MUSIC_PREFIX  = '1r34LbKcu7';
const SONG_SEP      = '===';
const MAX_SONGS     = 100;

// ─── iReal Pro unscramble (pianosnake algorithm) ─────────────────────────────

function obfusc50(s) {
  const a = s.split('');
  for (let i = 0; i < 5; i++)  [a[i], a[49-i]] = [a[49-i], a[i]];
  for (let i = 10; i < 24; i++) [a[i], a[49-i]] = [a[49-i], a[i]];
  return a.join('');
}

function unscramble(s) {
  let r = '';
  while (s.length > 50) {
    const chunk = s.slice(0, 50);
    s = s.slice(50);
    r += s.length < 2 ? chunk : obfusc50(chunk);
  }
  return r + s;
}

// ─── chart token parser ───────────────────────────────────────────────────────

/**
 * Parse a decoded chart string into a flat list of bar objects.
 * Returns { bars, timeSignature }
 *
 * Each bar: { chords, section, repeatStart, repeatEnd }
 */
function parseChart(decoded) {
  const bars = [];
  let chords       = [];
  let section      = null;
  let repeatStart  = false;
  let pendingRepeatEnd = false;
  let timeSignature = '4/4';

  function commitBar() {
    bars.push({ chords, section, repeatStart, repeatEnd: pendingRepeatEnd });
    chords = [];
    section = null;
    repeatStart = false;
    pendingRepeatEnd = false;
  }

  let i = 0;
  while (i < decoded.length) {
    // ── skip whitespace ───────────────────────────────────────────────────
    if (decoded[i] === ' ' || decoded[i] === '\r' || decoded[i] === '\n') {
      i++; continue;
    }

    const rest = decoded.slice(i);

    // ── time signature: T44, T34, T68, T98, T22, T32 ─────────────────────
    const tsM = rest.match(/^T(\d)(\d)/);
    if (tsM) {
      const bot = tsM[2] === '8' ? '8' : tsM[2] === '2' ? '2' : '4';
      timeSignature = `${tsM[1]}/${bot}`;
      i += 3; continue;
    }

    // ── section marker: *A *B *C *D *i *v ────────────────────────────────
    const secM = rest.match(/^\*([A-Za-z])/);
    if (secM) {
      const lbl = secM[1].toUpperCase();
      section = ['A','B','C','D','I','V','E','F','G','H'].includes(lbl) ? lbl : null;
      i += 2; continue;
    }

    // ── XyQ = empty cell spacer (represents an empty measure slot) ────────
    if (rest.startsWith('XyQ')) {
      // iReal Pro uses XyQ to represent an empty/invisible measure
      commitBar();  // commit as empty bar
      i += 3; continue;
    }

    // ── LZ = barline ──────────────────────────────────────────────────────
    if (rest.startsWith('LZ')) {
      if (chords.length > 0 || section || repeatStart) commitBar();
      i += 2; continue;
    }

    // ── Kcl = barline-like marker ─────────────────────────────────────────
    if (rest.startsWith('Kcl')) {
      if (chords.length > 0) commitBar();
      i += 3; continue;
    }

    // ── Y+ = vertical spacers, skip ───────────────────────────────────────
    if (decoded[i] === 'Y') {
      while (i < decoded.length && decoded[i] === 'Y') i++;
      continue;
    }

    // ── { = repeat start barline ──────────────────────────────────────────
    if (decoded[i] === '{') {
      if (chords.length > 0) commitBar();
      repeatStart = true;
      i++; continue;
    }

    // ── } = repeat end barline ────────────────────────────────────────────
    if (decoded[i] === '}') {
      pendingRepeatEnd = true;
      if (chords.length > 0) commitBar();
      i++; continue;
    }

    // ── [ = double barline (section start) ───────────────────────────────
    if (decoded[i] === '[') {
      if (chords.length > 0) commitBar();
      i++; continue;
    }

    // ── ] = double barline end ────────────────────────────────────────────
    if (decoded[i] === ']') {
      if (chords.length > 0) commitBar();
      i++; continue;
    }

    // ── | = regular barline ───────────────────────────────────────────────
    if (decoded[i] === '|') {
      if (chords.length > 0) commitBar();
      i++; continue;
    }

    // ── Z = final barline ─────────────────────────────────────────────────
    if (decoded[i] === 'Z') {
      if (chords.length > 0) commitBar();
      i++; continue;
    }

    // ── x = repeat previous bar ───────────────────────────────────────────
    if (decoded[i] === 'x') {
      chords.push({ isRepeat: true });
      commitBar();
      i++; continue;
    }

    // ── r = two-bar repeat (treat as two repeat bars) ─────────────────────
    if (decoded[i] === 'r') {
      chords.push({ isRepeat: true });
      commitBar();
      chords.push({ isRepeat: true });
      commitBar();
      i++; continue;
    }

    // ── N1 N2 N3 = numbered endings ───────────────────────────────────────
    if (rest.match(/^N\d/)) { i += 2; continue; }

    // ── navigation markers ────────────────────────────────────────────────
    if ('SQU'.includes(decoded[i])) { i++; continue; }

    // ── size / decoration markers: f p s l ───────────────────────────────
    if ('fpsl'.includes(decoded[i])) { i++; continue; }

    // ── n = N.C. (no chord) ───────────────────────────────────────────────
    if (decoded[i] === 'n') {
      // skip — empty chord slot
      i++; continue;
    }

    // ── comment <...> ─────────────────────────────────────────────────────
    if (decoded[i] === '<') {
      const end = decoded.indexOf('>', i);
      i = end !== -1 ? end + 1 : i + 1;
      continue;
    }

    // ── W = invisible chord (repeat same as prev, skip) ───────────────────
    if (decoded[i] === 'W') {
      i++;
      // consume any quality chars that might follow W
      while (i < decoded.length && /[+\-\^0-9hob#suadlt]/.test(decoded[i])) i++;
      continue;
    }

    // ── chord ─────────────────────────────────────────────────────────────
    // Pattern: [A-G][b#]?[quality]*(\/[A-G][#b]?)?
    // quality chars: + - ^ 0-9 h o b # s u a d l t
    const chordM = rest.match(/^([A-G])(b|#)?((?:[+\-\^0-9hob#suadlt]|\(.*?\))*)(\/[A-G][#b]?)?/);
    if (chordM) {
      const root     = chordM[1];
      const acc      = chordM[2];       // 'b', '#', or undefined
      let   quality  = (chordM[3] || '').replace(/\(.*?\)/g, '').trim();

      // iReal Pro uses ^ for major; keep as-is — normalizeQuality handles ^7 → △7
      // Remove slash bass for now (could be added later)

      const chord = { root };
      if (acc) chord.accidental = acc;
      if (quality) chord.quality = quality;

      chords.push(chord);
      i += chordM[0].length;
      continue;
    }

    // ── unknown char, skip ────────────────────────────────────────────────
    i++;
  }

  if (chords.length > 0) commitBar();
  return { bars, timeSignature };
}

// ─── group flat bars into 4-bar systems ───────────────────────────────────────

function groupSystems(bars) {
  const systems = [];
  let sysBars    = [];
  let sysMeta    = {};

  function flush() {
    if (sysBars.length === 0) return;
    // Pad to 4 bars
    while (sysBars.length < 4) sysBars.push({ chords: [] });
    systems.push({ ...sysMeta, bars: sysBars.map(b => ({ chords: b.chords })) });
    sysBars = [];
    sysMeta = {};
  }

  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi];

    // A section marker or repeat-start on a bar that would begin mid-system
    // forces a system break (so labels always appear at system start).
    if ((bar.section || bar.repeatStart) && sysBars.length > 0) {
      flush();
    }

    // Apply first-bar metadata to the current system
    if (sysBars.length === 0) {
      if (bar.section)     sysMeta.sectionLabel   = bar.section;
      if (bar.repeatStart) sysMeta.hasRepeatStart = true;
    }

    // A repeat-end decoration goes on the LAST bar of the current system
    if (bar.repeatEnd) {
      sysMeta.hasRepeatEnd = true;
    }

    sysBars.push(bar);

    // After 4 bars, flush the system
    if (sysBars.length === 4) flush();
  }

  flush();
  return systems;
}

// ─── parse one song string (split by ===) ────────────────────────────────────

function parseSong(raw) {
  const parts = raw.split('=');

  // Find the music field
  const musicIdx = parts.findIndex(p => p.startsWith(MUSIC_PREFIX));
  if (musicIdx === -1) return null;

  const title    = (parts[0]  || '').trim();
  const composer = (parts[1]  || '').trim();
  const style    = (parts[3]  || 'Swing').trim();
  // Key is the field immediately before the (empty) field before music,
  // i.e. two positions before musicIdx (parts[musicIdx-1] is empty, key is musicIdx-2)
  // fallback: musicIdx - 1
  const keyRaw = (parts[musicIdx - 1] || parts[musicIdx - 2] || 'C').trim();
  const key = keyRaw || 'C';

  if (!title) return null;

  const encoded = parts[musicIdx].slice(MUSIC_PREFIX.length);
  const decoded = unscramble(encoded);

  const { bars, timeSignature } = parseChart(decoded);
  const systems = groupSystems(bars.filter(b =>
    b.chords.length > 0 || b.section || b.repeatStart
  ));

  if (systems.length === 0) return null;

  return { title, style, composer, timeSignature, systems };
}

// ─── fetch helper ─────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── TypeScript serialiser ────────────────────────────────────────────────────

function toTS(songs) {
  // We emit the array as JSON (valid TS for literal objects).
  // JSON.stringify already escapes strings correctly.
  const json = JSON.stringify(songs, null, 2);
  return `// AUTO-GENERATED by scripts/convert-ireal.js – do not edit by hand.
// Source: jazz1460 playlist from https://blog.karimratib.me/demos/chirp/
// Quality strings are left in iReal Pro notation (^7, -7, h7, o7 …);
// LeadSheet.tsx's normalizeQuality() converts them on the fly.

import type { LeadSheetData } from './leadSheetTypes';

export const jazzSongs: LeadSheetData[] = ${json};
`;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`Fetching ${DATA_URL} …\n`);
  const raw     = await fetchUrl(DATA_URL);
  const content = decodeURIComponent(raw.trim()).replace(/^irealb:\/\//, '');

  const songStrings = content.split(SONG_SEP).filter(s => s.trim().length > 0);
  process.stderr.write(`Found ${songStrings.length} song entries.\n`);

  const songs = [];
  let tried = 0;

  for (const s of songStrings) {
    if (songs.length >= MAX_SONGS) break;
    tried++;
    try {
      const song = parseSong(s);
      if (song) songs.push(song);
    } catch (e) {
      // skip broken entries
    }
  }

  process.stderr.write(`Parsed ${songs.length} songs (tried ${tried}).\n`);

  const outPath = path.join(__dirname, '..', 'src', 'data', 'jazzSongs.ts');
  fs.writeFileSync(outPath, toTS(songs), 'utf8');
  process.stderr.write(`Written to ${outPath}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
