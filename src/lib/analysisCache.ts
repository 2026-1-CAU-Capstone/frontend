/* ─────────────────────────────────────────────────────────────────────────
 * Analysis (lead-sheet) cache — frontend-only speed-up for "내 코드 차트".
 *
 * The backend owns chord analysis: GET /v1/chord-projects/{id}/analysis →
 * analysisToLeadSheet() → the render-ready LeadSheetData. That round-trip runs
 * once PER CARD on the grid (N+1) and again every time a chart is opened, so
 * revisiting was always slow.
 *
 * This caches the *converted* LeadSheetData per project, VERSION-KEYED by the
 * project's `updatedAt`. Because the backend bumps `updatedAt` whenever the
 * project changes (chord edit, re-analyze, OMR completion), a matching
 * `updatedAt` GUARANTEES the cached sheet is current — so a hit needs NO
 * revalidation at all (0 backend calls). A mismatch (or miss) → the caller
 * fetches fresh and writes it back here.
 *
 * Storage: one localStorage key per project (`jazzify.analysisCache.<id>`), so
 * writing one chart never rewrites the whole blob. On quota errors we prune
 * every cache key and retry once (the cache is purely derived data — safe to
 * drop). NOT used for analysis itself; this is a transport cache only.
 * ──────────────────────────────────────────────────────────────────────── */

import type { LeadSheetData } from '../data/leadSheetTypes';

const PREFIX = 'jazzify.analysisCache.';

interface CacheEntry {
  /** Project.updatedAt this sheet was built from — the version key. */
  updatedAt: string;
  sheet: LeadSheetData;
}

/** Read the cached entry for a project (any version), or null. */
export function getCachedAnalysisEntry(publicId: string): CacheEntry | null {
  if (!publicId) return null;
  try {
    const raw = localStorage.getItem(PREFIX + publicId);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    if (e && typeof e.updatedAt === 'string' && e.sheet) return e;
    return null;
  } catch {
    return null;
  }
}

/** Cached sheet ONLY when it matches `updatedAt` (fresh). Else null — caller
 *  must fetch. Use when the caller already knows the current version (e.g. the
 *  project list carries updatedAt). */
export function getFreshCachedSheet(publicId: string, updatedAt: string | undefined): LeadSheetData | null {
  if (!updatedAt) return null;
  const e = getCachedAnalysisEntry(publicId);
  return e && e.updatedAt === updatedAt ? e.sheet : null;
}

/** Store the converted sheet for a project, stamped with its `updatedAt`. */
export function setCachedAnalysis(publicId: string, updatedAt: string | undefined, sheet: LeadSheetData): void {
  if (!publicId || !updatedAt) return;
  const payload = JSON.stringify({ updatedAt, sheet } satisfies CacheEntry);
  try {
    localStorage.setItem(PREFIX + publicId, payload);
  } catch {
    // Quota hit — drop all analysis-cache keys and retry once.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
      }
      localStorage.setItem(PREFIX + publicId, payload);
    } catch { /* give up — cache is best-effort */ }
  }
}

/** Drop a project's cached sheet (e.g. on delete). */
export function clearCachedAnalysis(publicId: string): void {
  try { localStorage.removeItem(PREFIX + publicId); } catch { /* ignore */ }
}
