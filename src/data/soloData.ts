/**
 * Solo data layer — thin cache around the Solo backend API plus a one-shot
 * migration helper for users who saved into the legacy `jazzify_user_solos`
 * localStorage list (before the backend existed).
 */

import {
  createSolo,
  fetchAllSolos,
  type SoloDraft,
  type SoloResponse,
  type SoloInstrument,
  type SoloSource,
} from '../api/solos';
import type { NoteSheetData, MeasureInfo, SheetStaff } from './sampleMelody';

/** Legacy localStorage key — pre-backend SoloGenerator wrote here. */
export const LEGACY_SOLOS_KEY = 'jazzify_user_solos';
/** Sentinel so we don't re-attempt migration every page load. */
const MIGRATION_DONE_KEY = 'jazzify_user_solos_migrated_v1';

/* ── cache ─────────────────────────────────────────────────────────────────── */

let cached: SoloResponse[] | null = null;

export async function loadAllSolos(force = false): Promise<SoloResponse[]> {
  if (cached && !force) return cached;
  cached = await fetchAllSolos();
  return cached;
}

export function invalidateSolosCache(): void {
  cached = null;
}

/** Mutate the cache in-place when we already know the persisted result —
 *  avoids one extra GET after a POST/DELETE. */
export function pushSoloToCache(s: SoloResponse): void {
  if (cached) cached = [s, ...cached];
}

export function removeSoloFromCache(publicId: string): void {
  if (cached) cached = cached.filter((s) => s.publicId !== publicId);
}

export function updateSoloInCache(s: SoloResponse): void {
  if (cached) cached = cached.map((c) => (c.publicId === s.publicId ? s : c));
}

/* ── legacy localStorage migration ─────────────────────────────────────────── */

interface LegacySoloEntry {
  id: number | string;
  title: string;
  composer: string;
  genre?: string;
  key: string;
  timeSignature: string;
  tempo: number;
  measures: MeasureInfo[];
  createdAt: number;
}

export function readLegacyLocalSolos(): LegacySoloEntry[] {
  try {
    const raw = localStorage.getItem(LEGACY_SOLOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function legacyToDraft(entry: LegacySoloEntry): SoloDraft {
  const sheetData: NoteSheetData = {
    title: entry.title || 'Untitled',
    composer: entry.composer || 'Unknown',
    key: entry.key || 'C',
    timeSignature: entry.timeSignature || '4/4',
    tempo: entry.tempo,
    ...(entry.genre ? { genre: entry.genre } : {}),
    measures: entry.measures || [],
  };
  return {
    source: 'user',
    title: entry.title || 'Untitled',
    instrument: 'p',
    performer: entry.composer || undefined,
    tempo: entry.tempo,
    key: entry.key,
    timeSignature: entry.timeSignature,
    sheetData,
  };
}

export function isLegacyMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_DONE_KEY) === '1';
}

export function markLegacyMigrationDone(): void {
  try { localStorage.setItem(MIGRATION_DONE_KEY, '1'); } catch { /* noop */ }
}

/**
 * Push every legacy localStorage solo to the backend. Returns counts of
 * successful + failed POSTs. Idempotent in the sense that you can call it
 * again, but the same entries will be re-posted unless you delete the
 * legacy key — which we do after a fully-successful run.
 */
export async function migrateLegacySolos(): Promise<{ ok: number; failed: number; errors: string[] }> {
  const legacy = readLegacyLocalSolos();
  if (legacy.length === 0) {
    markLegacyMigrationDone();
    return { ok: 0, failed: 0, errors: [] };
  }
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const entry of legacy) {
    try {
      const persisted = await createSolo(legacyToDraft(entry));
      pushSoloToCache(persisted);
      ok++;
    } catch (e) {
      failed++;
      errors.push(`${entry.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Only wipe the legacy list if every entry was migrated. Otherwise keep it
  // so the user can retry the failed ones.
  if (failed === 0) {
    try { localStorage.removeItem(LEGACY_SOLOS_KEY); } catch { /* noop */ }
    markLegacyMigrationDone();
  }
  return { ok, failed, errors };
}

/* ── helpers used by the editor when saving ────────────────────────────────── */

/**
 * Build a Solo POST draft from the SoloGenerator editor state. Mirrors the
 * legacyToDraft shape so the same backend handler accepts both.
 */
export function buildUserSoloDraft(opts: {
  title: string;
  composer: string;
  genre?: string;
  key: string;
  timeSignature: string;
  tempo: number;
  measures: MeasureInfo[];
  bassMeasures?: MeasureInfo[];
  /** 다중 스태프(자유 조합) — 있으면 sheetData.staves 로 그대로 실린다.
   *  measures/bassMeasures 는 staves[0] 미러(stavesToSheetFields 규약). */
  staves?: SheetStaff[];
  instrument?: SoloInstrument;
  source?: SoloSource;
  accidentalStyle?: 'explicit' | 'score';
}): SoloDraft {
  const sheetData: NoteSheetData = {
    title: opts.title || 'Untitled',
    composer: opts.composer || 'Unknown',
    key: opts.key || 'C',
    timeSignature: opts.timeSignature || '4/4',
    tempo: opts.tempo,
    ...(opts.genre ? { genre: opts.genre } : {}),
    measures: opts.measures,
    ...(opts.staves ? { staves: opts.staves } : {}),
    ...(opts.bassMeasures ? { bassMeasures: opts.bassMeasures } : {}),
    ...(opts.accidentalStyle ? { accidentalStyle: opts.accidentalStyle } : {}),
  };
  return {
    source: opts.source ?? 'user',
    title: opts.title || 'Untitled',
    instrument: opts.instrument ?? 'p',
    performer: opts.composer || undefined,
    tempo: opts.tempo,
    key: opts.key,
    timeSignature: opts.timeSignature,
    sheetData,
  };
}
