/**
 * Tokenizer for decoded iRealPro chart strings.
 *
 * Converts the raw character stream into a flat list of typed tokens
 * that the parser can consume.
 */

// ─── Token types ─────────────────────────────────────────────────────────────

export type Token =
  | { type: 'barline';        style: 'single' | 'double' | 'repeatStart' | 'repeatEnd' | 'final' }
  | { type: 'timeSignature';  top: number; bottom: number; raw: string }
  | { type: 'section';        label: string }
  | { type: 'ending';         number: number }           // N1, N2, N3
  | { type: 'chord';          root: string; accidental?: 'b' | '#'; quality: string; bass?: string }
  | { type: 'noChord' }                                  // n
  | { type: 'repeat' }                                   // x
  | { type: 'doubleRepeat' }                              // r
  | { type: 'spacer' }                                   // W  (invisible chord)
  | { type: 'emptyCell' }                                // XyQ (empty measure placeholder)
  | { type: 'segno' }                                    // S
  | { type: 'coda' }                                     // Q
  | { type: 'fermata' }                                  // U  (on barline)
  | { type: 'chordAnnotation'; kind: 'fermata' | 'small' | 'large' }  // f, p/s, l
  | { type: 'comment';        text: string }              // <...>
  | { type: 'newline' }                                  // Y+ (row break hint)
  ;

// ─── Quality character class ─────────────────────────────────────────────────
// iReal Pro quality tokens use:  + - ^ 0-9 h o b # s u a d l t
// plus parenthesised extensions like (b9,#11)

const QUALITY_RE = /^((?:[+\-\^0-9hob#suadlt]|\([^)]*\))*)/;

// Full chord regex:  Root  Accidental?  Quality*  (/Bass)?
const CHORD_RE =
  /^([A-G])(b|#)?((?:[+\-\^0-9hob#suadlt]|\([^)]*\))*)(\/([A-G])([#b]?))?/;

// ─── tokenize ────────────────────────────────────────────────────────────────

export function tokenize(chart: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < chart.length) {
    const ch = chart[i];

    // ── whitespace ─────────────────────────────────────────────────────────
    if (ch === ' ' || ch === '\r' || ch === '\n') { i++; continue; }

    const rest = chart.slice(i);

    // ── time signature: T44, T34, T68, T54, … ─────────────────────────────
    const tsM = rest.match(/^T(\d)(\d)/);
    if (tsM) {
      const top = Number(tsM[1]);
      const raw2 = Number(tsM[2]);
      const bottom = raw2 === 8 ? 8 : raw2 === 2 ? 2 : 4;
      tokens.push({ type: 'timeSignature', top, bottom, raw: `${top}/${bottom}` });
      i += 3;
      continue;
    }

    // ── section marker: *A *B *C *D *i *v … ───────────────────────────────
    const secM = rest.match(/^\*([A-Za-z])/);
    if (secM) {
      tokens.push({ type: 'section', label: secM[1] });
      i += 2;
      continue;
    }

    // ── XyQ = empty cell (placeholder measure) ────────────────────────────
    if (rest.startsWith('XyQ')) {
      tokens.push({ type: 'emptyCell' });
      i += 3;
      continue;
    }

    // ── LZ = barline ──────────────────────────────────────────────────────
    if (rest.startsWith('LZ')) {
      tokens.push({ type: 'barline', style: 'single' });
      i += 2;
      continue;
    }

    // ── Kcl = barline variant ─────────────────────────────────────────────
    if (rest.startsWith('Kcl')) {
      tokens.push({ type: 'barline', style: 'single' });
      i += 3;
      continue;
    }

    // ── Y+ = row break (vertical spacer) ──────────────────────────────────
    if (ch === 'Y') {
      while (i < chart.length && chart[i] === 'Y') i++;
      tokens.push({ type: 'newline' });
      continue;
    }

    // ── barlines ──────────────────────────────────────────────────────────
    if (ch === '{') { tokens.push({ type: 'barline', style: 'repeatStart' });  i++; continue; }
    if (ch === '}') { tokens.push({ type: 'barline', style: 'repeatEnd' });    i++; continue; }
    if (ch === '[') { tokens.push({ type: 'barline', style: 'double' });       i++; continue; }
    if (ch === ']') { tokens.push({ type: 'barline', style: 'double' });       i++; continue; }
    if (ch === '|') { tokens.push({ type: 'barline', style: 'single' });       i++; continue; }
    if (ch === 'Z') { tokens.push({ type: 'barline', style: 'final' });        i++; continue; }

    // ── N1 N2 N3 = volta / numbered ending ────────────────────────────────
    const endM = rest.match(/^N(\d)/);
    if (endM) {
      tokens.push({ type: 'ending', number: Number(endM[1]) });
      i += 2;
      continue;
    }

    // ── navigation markers ────────────────────────────────────────────────
    if (ch === 'S') { tokens.push({ type: 'segno' });   i++; continue; }
    if (ch === 'Q') { tokens.push({ type: 'coda' });    i++; continue; }
    if (ch === 'U') { tokens.push({ type: 'fermata' }); i++; continue; }

    // ── x = single-bar repeat ─────────────────────────────────────────────
    if (ch === 'x') { tokens.push({ type: 'repeat' });       i++; continue; }

    // ── r = two-bar repeat ────────────────────────────────────────────────
    if (ch === 'r') { tokens.push({ type: 'doubleRepeat' }); i++; continue; }

    // ── n = No Chord (N.C.) ───────────────────────────────────────────────
    if (ch === 'n') { tokens.push({ type: 'noChord' }); i++; continue; }

    // ── W = invisible / implied chord ─────────────────────────────────────
    if (ch === 'W') {
      i++;
      // consume trailing quality characters that belong to W
      const wRest = chart.slice(i);
      const wM = wRest.match(QUALITY_RE);
      if (wM && wM[0].length > 0) i += wM[0].length;
      tokens.push({ type: 'spacer' });
      continue;
    }

    // ── chord annotations: f (fermata), p/s (small), l (large) ───────────
    if (ch === 'f') { tokens.push({ type: 'chordAnnotation', kind: 'fermata' }); i++; continue; }
    if (ch === 'p') { tokens.push({ type: 'chordAnnotation', kind: 'small' });   i++; continue; }
    if (ch === 's') { tokens.push({ type: 'chordAnnotation', kind: 'small' });   i++; continue; }
    if (ch === 'l') { tokens.push({ type: 'chordAnnotation', kind: 'large' });   i++; continue; }

    // ── comment <...> ─────────────────────────────────────────────────────
    if (ch === '<') {
      const end = chart.indexOf('>', i);
      if (end !== -1) {
        tokens.push({ type: 'comment', text: chart.slice(i + 1, end) });
        i = end + 1;
      } else {
        i++;
      }
      continue;
    }

    // ── chord: [A-G][b#]?[quality](/[A-G][#b]?)? ─────────────────────────
    const chM = rest.match(CHORD_RE);
    if (chM) {
      const tok: Token & { type: 'chord' } = {
        type: 'chord',
        root: chM[1],
        quality: chM[3] || '',
      };
      if (chM[2]) tok.accidental = chM[2] as 'b' | '#';
      if (chM[5]) tok.bass = `${chM[5]}${chM[6] || ''}`;
      tokens.push(tok);
      i += chM[0].length;
      continue;
    }

    // ── unknown character — skip ──────────────────────────────────────────
    i++;
  }

  return tokens;
}
