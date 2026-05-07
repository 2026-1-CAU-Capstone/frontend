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
