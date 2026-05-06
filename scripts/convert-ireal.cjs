#!/usr/bin/env node
/**
 * Fetches jazz1460.txt from the chirp demo, parses the iReal Pro URI format,
 * and writes public/jazz1460.json containing ALL songs as LeadSheetData[].
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
 * Each bar: { chords, section, ending, repeatStart, repeatEnd }
 */
function parseChart(decoded) {
  const bars = [];
  let chords       = [];
  let section      = null;
  let ending       = null;
  let repeatStart  = false;
  let pendingRepeatEnd = false;
  let pendingAnnotations = [];
  let timeSignature = '4/4';

  function commitBar() {
    bars.push({ chords, section, ending, repeatStart, repeatEnd: pendingRepeatEnd });
    chords = [];
    section = null;
    ending = null;
    repeatStart = false;
    pendingRepeatEnd = false;
    pendingAnnotations = []; // discard unconsumed annotations
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

    // ── N1 N2 N3 = numbered endings (volta) ─────────────────────────────
    const endM = rest.match(/^N(\d)/);
    if (endM) {
      ending = parseInt(endM[1], 10);
      i += 2; continue;
    }

    // ── XyQ = empty cell spacer (represents an empty measure slot) ────────
    // When XyQ is followed by Kcl, the chord occupies 2 bars (e.g. C^7XyQKcl = 2 bars of C^7)
    // When XyQ is followed by | or other, the chord occupies 1 bar (e.g. F^7XyQ| = 1 bar of F^7)
    // When XyQ appears with no pending chords, it represents a genuinely empty bar (e.g. volta padding).
    if (rest.startsWith('XyQ')) {
      if (chords.length > 0) {
        commitBar();
        if (decoded.substring(i + 3, i + 6) === 'Kcl') {
          chords.push({ isRepeat: true });
          commitBar();
        }
      } else {
        const run = rest.match(/^(?:XyQ)+/)[0];
        const afterRun = decoded.slice(i + run.length);

        // iReal uses a full XyQ row before N2/N3 to align the next volta
        // under the matching N1 slot. The ending bar itself occupies the
        // final slot, so only count N-1 blanks as real empty bars.
        if (/^(?:\s|Y)*\|[fpsl]*N\d/.test(afterRun)) {
          const emptyBars = Math.max(0, run.length / 3 - 1);
          for (let n = 0; n < emptyBars; n++) commitBar();
          i += run.length;
          continue;
        }

        // Empty bar slot (no chords) — commit an empty bar so it takes up space
        commitBar();
      }
      i += 3; continue;
    }

    // ── LZ = barline ──────────────────────────────────────────────────────
    if (rest.startsWith('LZ')) {
      if (chords.length > 0 || section || repeatStart || ending != null) commitBar();
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
      if (chords.length > 0) {
        pendingRepeatEnd = true;
        commitBar();
      } else if (bars.length > 0) {
        // No pending chords — attach repeat-end to the last committed bar
        bars[bars.length - 1].repeatEnd = true;
      }
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
      else pendingAnnotations = [];
      i++; continue;
    }

    // ── Z = final barline ─────────────────────────────────────────────────
    if (decoded[i] === 'Z') {
      if (chords.length > 0) commitBar();
      else pendingAnnotations = [];
      i++; continue;
    }

    // ── x = repeat previous bar ───────────────────────────────────────────
    // When x is surrounded by (...) annotations like (Eh7)x(A7b9),
    // the annotations are the actual chords for this bar — use them
    // instead of isRepeat.
    if (decoded[i] === 'x') {
      // Look ahead past 'x' for more (...) annotations
      let j = i + 1;
      while (j < decoded.length) {
        if (decoded[j] === ' ' || 'XyQKcl'.includes(decoded[j])) { j++; continue; }
        if (decoded[j] === '(') {
          const ce = decoded.indexOf(')', j);
          if (ce !== -1) {
            const inner = decoded.slice(j + 1, ce);
            const cm = inner.match(/^([A-G])(b|#)?(.*)/);
            if (cm) {
              const c = { root: cm[1] };
              if (cm[2]) c.accidental = cm[2];
              if (cm[3]) c.quality = cm[3];
              pendingAnnotations.push(c);
            }
            j = ce + 1;
            continue;
          }
        }
        break;
      }
      if (pendingAnnotations.length > 0) {
        chords.push(...pendingAnnotations);
        pendingAnnotations = [];
        i = j; // skip past consumed look-ahead annotations
      } else {
        chords.push({ isRepeat: true });
        i++;
      }
      commitBar();
      continue;
    }

    // ── r = two-bar repeat (treat as two repeat bars) ─────────────────────
    if (decoded[i] === 'r') {
      chords.push({ isRepeat: true });
      commitBar();
      chords.push({ isRepeat: true });
      commitBar();
      i++; continue;
    }

    // ── navigation markers ────────────────────────────────────────────────
    if ('SQU'.includes(decoded[i])) { i++; continue; }

    // ── size / decoration markers: f p s l ───────────────────────────────
    if ('fpsl'.includes(decoded[i])) { i++; continue; }

    // ── n = N.C. (no chord) ───────────────────────────────────────────────
    if (decoded[i] === 'n') {
      chords.push({ root: 'N.C.' });
      i++; continue;
    }

    // ── comment <...> ─────────────────────────────────────────────────────
    if (decoded[i] === '<') {
      const end = decoded.indexOf('>', i);
      i = end !== -1 ? end + 1 : i + 1;
      continue;
    }

    // ── small chord annotation (...) — buffer for possible use by 'x' ────
    // In iReal Pro, (Eh7)x(A7b9) means "repeat bar, chords are Eh7 A7b9".
    // Buffer these so the 'x' handler can use them as real chords.
    // If no 'x' follows, they are discarded (purely visual hints).
    if (decoded[i] === '(') {
      const end = decoded.indexOf(')', i);
      if (end !== -1) {
        const inner = decoded.slice(i + 1, end);
        const cm = inner.match(/^([A-G])(b|#)?(.*)/);
        if (cm) {
          const c = { root: cm[1] };
          if (cm[2]) c.accidental = cm[2];
          if (cm[3]) c.quality = cm[3];
          pendingAnnotations.push(c);
        }
        i = end + 1;
      } else {
        i++;
      }
      continue;
    }

    // ── W = invisible chord (same as prev bar) ────────────────────────────
    // iReal Pro omits the chord name visually, but the bar still exists.
    // Push isRepeat so the bar is not filtered out; resolveRepeats() in
    // LeadSheet.tsx will substitute the actual previous chord at render time.
    if (decoded[i] === 'W') {
      chords.push({ isRepeat: true });
      i++;
      while (i < decoded.length && /[+\-\^0-9hob#suadlt]/.test(decoded[i])) i++;
      continue;
    }

    // ── chord ─────────────────────────────────────────────────────────────
    // Pattern: [A-G][b#]?[quality]*(\/[A-G][#b]?)?
    // quality chars: + - ^ 0-9 h o b # s u a d l t
    const chordM = rest.match(/^([A-G])(b|#)?((?:[+\-\^0-9hob#suadlt]|\(.*?\))*)(\/([A-G])([#b])?)?/);
    if (chordM) {
      const root     = chordM[1];
      const acc      = chordM[2];       // 'b', '#', or undefined
      let   quality  = (chordM[3] || '').replace(/\(.*?\)/g, '').trim();
      const bassRoot = chordM[5];       // slash bass root
      const bassAcc  = chordM[6];       // slash bass accidental

      const chord = { root };
      if (acc) chord.accidental = acc;
      if (quality) chord.quality = quality;
      if (bassRoot) {
        chord.bass = { root: bassRoot };
        if (bassAcc) chord.bass.accidental = bassAcc;
      }

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
    while (sysBars.length < 4) sysBars.push({ chords: [], ending: null });
    systems.push({
      ...sysMeta,
      bars: sysBars.map(b => {
        const out = { chords: b.chords };
        if (b.ending != null) out.ending = b.ending;
        return out;
      }),
    });
    sysBars = [];
    sysMeta = {};
  }

  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi];

    // A section marker or repeat-start on a bar that would begin mid-system
    // forces a system break (so labels always appear at system start).
    // Volta endings (N1/N2) do NOT force a break — they attach to the bar.
    if ((bar.section || bar.repeatStart) && sysBars.length > 0) {
      flush();
    }

    // Apply first-bar metadata to the current system
    if (sysBars.length === 0) {
      if (bar.section)        sysMeta.sectionLabel   = bar.section;
      if (bar.repeatStart)    sysMeta.hasRepeatStart = true;
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
  const keyRaw = (parts[musicIdx - 1] || parts[musicIdx - 2] || 'C').trim();
  const key = keyRaw || 'C';

  if (!title) return null;

  const encoded = parts[musicIdx].slice(MUSIC_PREFIX.length);
  const decoded = unscramble(encoded);

  const { bars, timeSignature } = parseChart(decoded);
  const systems = groupSystems(bars);

  if (systems.length === 0) return null;

  return { title, style, composer, timeSignature, key, systems };
}

// ─── fetch helper ─────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`Fetching ${DATA_URL} …\n`);
  const raw     = await fetchUrl(DATA_URL);
  const content = decodeURIComponent(raw.trim()).replace(/^irealb:\/\//, '');

  const songStrings = content.split(SONG_SEP).filter(s => s.trim().length > 0);
  process.stderr.write(`Found ${songStrings.length} song entries.\n`);

  const songs = [];

  for (const s of songStrings) {
    try {
      const song = parseSong(s);
      if (song) songs.push(song);
    } catch (e) {
      // skip broken entries
    }
  }

  process.stderr.write(`Parsed ${songs.length} songs.\n`);

  const outPath = path.join(__dirname, '..', 'public', 'jazz1460.json');
  fs.writeFileSync(outPath, JSON.stringify(songs), 'utf8');
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  process.stderr.write(`Written to ${outPath} (${sizeMB} MB)\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
