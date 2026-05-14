/* ─────────────────────────────────────────────────────────────────────────
 * Parser for ```chart fenced blocks emitted by the AI.
 *
 * Format (JSON inside the fence):
 *
 *   ```chart
 *   {
 *     "title": "It Could Happen to You",
 *     "composer": "Burke / Van Heusen",
 *     "key": "F",
 *     "timeSig": "4/4",
 *     "sections": [
 *       {
 *         "label": "A",
 *         "bars": ["FΔ7", "D7", "G-7", "C7", "A-7", "D7", "G-7 C7", "FΔ7"]
 *       },
 *       ...
 *     ]
 *   }
 *   ```
 *
 * Each "bar" is a string; multiple chords inside the same bar are separated
 * by whitespace ("G-7 C7"). The renderer doesn't need to parse chord
 * symbols semantically — the original text is preserved and displayed.
 * ──────────────────────────────────────────────────────────────────────── */

export interface ChatChartSection {
  label?: string;
  bars: string[];
}

export interface ChatChart {
  title?: string;
  composer?: string;
  key?: string;
  timeSig?: string;
  sections: ChatChartSection[];
}

export function parseChatChart(raw: string): ChatChart | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.sections)) return null;

  const sections: ChatChartSection[] = [];
  for (const s of o.sections) {
    if (!s || typeof s !== "object") continue;
    const sec = s as Record<string, unknown>;
    if (!Array.isArray(sec.bars)) continue;
    sections.push({
      label: sec.label != null ? String(sec.label) : undefined,
      bars: sec.bars.map((b) => String(b)),
    });
  }

  if (sections.length === 0) return null;

  return {
    title: o.title != null ? String(o.title) : undefined,
    composer: o.composer != null ? String(o.composer) : undefined,
    key: o.key != null ? String(o.key) : undefined,
    timeSig: o.timeSig != null ? String(o.timeSig) : "4/4",
    sections,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Fallback: markdown chord-table → ChatChart.
 *
 * The system prompt instructs the model to emit ```chart blocks, but it
 * sometimes slips back into a "| 마디 | 코드 | 기능 | 비고 |" GFM table.
 * To keep the chat reading consistently we detect *specifically* a chord-
 * progression table (must have both a bar/measure column AND a chord column)
 * and convert it to a ChatChart so it renders as the clean lead-sheet card.
 *
 * Any other table (scale comparisons, concept tables, …) returns null and
 * is left as a normal markdown table — we never hijack a non-chord table.
 * ──────────────────────────────────────────────────────────────────────── */

const BAR_COL_RE = /^\s*(마디|bar|measure|mm?\.?|소절)\s*$/i;
const CHORD_COL_RE = /(코드|chord|화음|harmony)/i;

function tableCells(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|") && /\S/.test(line);
}

function isSeparatorRow(line: string): boolean {
  return line.includes("|") && line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

/** Parse a single GFM table block. Returns a ChatChart only if it's a chord
 *  progression table; null otherwise. */
export function parseMarkdownChordTable(block: string): ChatChart | null {
  const rows = block.split("\n").map((r) => r.trim()).filter(Boolean);
  if (rows.length < 3) return null;                    // header + separator + ≥1 body row
  if (!isSeparatorRow(rows[1])) return null;

  const header = tableCells(rows[0]);
  const barCol = header.findIndex((h) => BAR_COL_RE.test(h));
  const chordCol = header.findIndex((h) => CHORD_COL_RE.test(h));
  if (barCol < 0 || chordCol < 0) return null;          // not a chord table

  const bars: string[] = [];
  for (let i = 2; i < rows.length; i++) {
    const cells = tableCells(rows[i]);
    // strip bold markers / arrows the model likes to add ("**Dm7**", "A-7 → D7")
    const chord = (cells[chordCol] ?? "")
      .replace(/\*\*/g, "")
      .replace(/\s*[→\->]+\s*/g, " ")
      .trim();
    if (chord && chord !== "-" && chord !== "—") bars.push(chord);
  }
  if (bars.length < 2) return null;

  return { timeSig: "4/4", sections: [{ bars }] };
}

/** Split a markdown string into alternating plain-text and chord-table
 *  segments. Plain-text stays a string; chord tables become a ChatChart.
 *  Non-chord tables are kept inside the surrounding text string untouched. */
export function splitChordTables(md: string): Array<string | ChatChart> {
  const lines = md.split("\n");
  const out: Array<string | ChatChart> = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) { out.push(buf.join("\n")); buf = []; }
  };

  let i = 0;
  while (i < lines.length) {
    // A table starts where line i is a row and line i+1 is the separator.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]) && !isSeparatorRow(lines[j])) j++;
      const block = lines.slice(i, j).join("\n");
      const chart = parseMarkdownChordTable(block);
      if (chart) {
        flush();
        out.push(chart);
      } else {
        buf.push(block);                                // leave non-chord tables as-is
      }
      i = j;
      continue;
    }
    buf.push(lines[i]);
    i++;
  }
  flush();
  return out.length ? out : [md];
}
