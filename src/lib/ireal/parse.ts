/**
 * Parser: converts a token stream into a list of IRealMeasure objects.
 *
 * The parser groups tokens between barline boundaries into measures,
 * attaching metadata (section, ending, coda, segno, …) and tracking
 * per-chord annotations (size, fermata).
 */

import type { Token } from './tokenize';
import type { Barline, IRealCell, IRealChord, IRealMeasure } from './types';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Parse a bass string like "Bb", "G#", "F" into structured form. */
function parseBass(raw: string): IRealChord['bass'] {
  const root = raw[0];
  const acc  = raw.length > 1 ? raw[1] : undefined;
  return acc
    ? { root, accidental: acc as 'b' | '#' }
    : { root };
}

/**
 * Determine the close-barline type when a barline token ends a measure.
 *
 *   }  → repeatEnd
 *   Z  → final
 *   [] → double
 *   everything else → single
 */
function closeBarlineFor(style: (Token & { type: 'barline' })['style']): Barline {
  switch (style) {
    case 'repeatEnd': return 'repeatEnd';
    case 'final':     return 'final';
    case 'double':    return 'double';
    default:          return 'single';
  }
}

/**
 * Determine the open-barline type for the NEXT measure after a barline token.
 *
 *   {  → repeatStart
 *   [] → double
 *   everything else → single
 */
function openBarlineFor(style: (Token & { type: 'barline' })['style']): Barline {
  switch (style) {
    case 'repeatStart': return 'repeatStart';
    case 'double':      return 'double';
    default:            return 'single';
  }
}

// ─── parse ───────────────────────────────────────────────────────────────────

export function parse(tokens: Token[]): IRealMeasure[] {
  const measures: IRealMeasure[] = [];

  // ── accumulator state for the current measure ────────────────────────────
  let cells: IRealCell[]  = [];
  let openBarline: Barline = 'double';   // first measure defaults to double
  let section:       string | undefined;
  let ending:        number | undefined;
  let segno          = false;
  let coda           = false;
  let fermataBar     = false;            // U token (fermata on barline)
  let timeSignature: string | undefined;
  let comments:      string[] = [];

  // per-chord annotations that apply to the NEXT chord pushed
  let nextSize:    'small' | 'large' | undefined;
  let nextFermata  = false;

  // ── commit the current measure ───────────────────────────────────────────
  function commit(close: Barline) {
    measures.push({
      chords:         cells,
      timeSignature,
      section,
      ending,
      segno:          segno    || undefined,
      coda:           coda     || undefined,
      fermata:        fermataBar || undefined,
      openBarline:    openBarline,
      closeBarline:   close,
      comments:       comments.length > 0 ? [...comments] : [],
    });

    // reset for next measure
    cells         = [];
    section       = undefined;
    ending        = undefined;
    segno         = false;
    coda          = false;
    fermataBar    = false;
    timeSignature = undefined;
    comments      = [];
  }

  const hasContent = () => cells.length > 0;

  // ── main loop ────────────────────────────────────────────────────────────
  for (const tok of tokens) {
    switch (tok.type) {

      // ─ barline ────────────────────────────────────────────────────────────
      case 'barline': {
        if (hasContent()) {
          commit(closeBarlineFor(tok.style));
        }
        // set opening barline for the next measure
        openBarline = openBarlineFor(tok.style);
        break;
      }

      // ─ empty cell (XyQ) — force a measure boundary + empty measure ────────
      case 'emptyCell': {
        if (hasContent()) commit('single');
        // commit an empty measure
        commit('single');
        break;
      }

      // ─ metadata (queued until first chord arrives) ────────────────────────
      case 'timeSignature': timeSignature = tok.raw; break;
      case 'section':       section       = tok.label; break;
      case 'ending':        ending        = tok.number; break;
      case 'segno':         segno         = true; break;
      case 'coda':          coda          = true; break;
      case 'fermata':       fermataBar    = true; break;

      // ─ chord annotations (apply to the immediately following chord) ───────
      case 'chordAnnotation':
        if (tok.kind === 'fermata') nextFermata = true;
        else if (tok.kind === 'small') nextSize = 'small';
        else if (tok.kind === 'large') nextSize = 'large';
        break;

      // ─ chord ──────────────────────────────────────────────────────────────
      case 'chord': {
        const chord: IRealChord = {
          root:    tok.root,
          quality: tok.quality,
        };
        if (tok.accidental) chord.accidental = tok.accidental;
        if (tok.bass)       chord.bass = parseBass(tok.bass);

        const cell: IRealCell = { type: 'chord', chord };
        if (nextSize)    (cell as any).size = nextSize;
        if (nextFermata) (cell as any).fermata = true as const;

        cells.push(cell);
        nextSize    = undefined;
        nextFermata = false;
        break;
      }

      // ─ special cells ──────────────────────────────────────────────────────
      case 'noChord':      cells.push({ type: 'noChord' });      break;
      case 'repeat':       cells.push({ type: 'repeat' });       break;
      case 'doubleRepeat': cells.push({ type: 'doubleRepeat' }); break;
      case 'spacer':       cells.push({ type: 'spacer' });       break;

      // ─ comments ───────────────────────────────────────────────────────────
      case 'comment': comments.push(tok.text); break;

      // ─ newline (visual row hint) — ignored structurally ───────────────────
      case 'newline': break;
    }
  }

  // commit trailing measure
  if (hasContent()) commit('final');

  return measures;
}
