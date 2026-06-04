/* ─────────────────────────────────────────────────────────────────────────
 * Break Editor — per-song "stop-time" break points.
 *
 * A break point marks a single (bar, beat): from that beat to the END of that
 * bar, the BACKING (piano / bass / drums) is hard-cut to silence while the
 * clock keeps running (a musical rest, not a stop). The melody and metronome
 * keep playing. The next bar resumes normally. Multi-bar rests are expressed
 * by placing one break on each consecutive bar.
 *
 * Constraints (v1):
 *   - one break per bar (clicking a different beat moves it; the same beat
 *     toggles it off)
 *   - 4/4 only (beat ∈ 1..4)
 *
 * `bar`  = flat bar index across all systems/sections, 0-based.
 * `beat` = 1-based beat within the bar where silence BEGINS.
 *
 * Persistence is per-song in localStorage (mirrors leadSheetChordEdit). The
 * key is the chart/song id, so transposition (which doesn't change rhythm)
 * leaves break points intact.
 * ──────────────────────────────────────────────────────────────────────── */

export interface BreakPoint {
  /** Flat bar index across all systems, 0-based. */
  bar: number;
  /** 1-based beat within the bar where the rest begins (1 = whole bar silent). */
  beat: number;
}

const STORAGE_PREFIX = 'jazzify.breaks.';

export function loadBreakPoints(songId: string): BreakPoint[] {
  if (!songId) return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + songId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is BreakPoint =>
        !!p && typeof (p as BreakPoint).bar === 'number' && typeof (p as BreakPoint).beat === 'number')
      .map((p) => ({ bar: p.bar, beat: p.beat }));
  } catch {
    return [];
  }
}

export function saveBreakPoints(songId: string, points: BreakPoint[]): void {
  if (!songId) return;
  try {
    if (points.length === 0) {
      localStorage.removeItem(STORAGE_PREFIX + songId);
    } else {
      localStorage.setItem(STORAGE_PREFIX + songId, JSON.stringify(points));
    }
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Toggle a break at (bar, beat). One break per bar:
 *   - no break on this bar    → add it
 *   - break on a DIFFERENT beat → move it to this beat
 *   - break on THIS exact beat → remove it
 * Returns a new array (pure). */
export function toggleBreakPoint(points: BreakPoint[], bar: number, beat: number): BreakPoint[] {
  const existing = points.find((p) => p.bar === bar);
  if (existing && existing.beat === beat) {
    return points.filter((p) => p.bar !== bar);          // toggle off
  }
  const without = points.filter((p) => p.bar !== bar);    // drop any prior break on this bar
  return [...without, { bar, beat }].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
}

/** The break beat for a given bar, or null if none. */
export function breakBeatForBar(points: BreakPoint[], bar: number): number | null {
  const p = points.find((x) => x.bar === bar);
  return p ? p.beat : null;
}
