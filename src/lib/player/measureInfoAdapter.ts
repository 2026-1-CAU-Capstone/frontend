/* ─────────────────────────────────────────────────────────────────────────
 * MeasureInfo → NoteSheetData adapter.
 *
 * Three pages today hand-roll a NoteSheetData wrapper around their internal
 * `MeasureInfo[]` state before handing it to a Soundfont scheduler:
 *
 *   • `pages/EditorPage.tsx`        — solo editor
 *   • `pages/SoloGeneratorPage.tsx` — AI solo generator
 *   • `pages/Lick12KeyPage.tsx`     — 12-key lick player (single instrument)
 *   • `pages/LickInputPage.tsx`     — lick input form
 *
 * Each page duplicates the same wrapper logic inline. This adapter
 * centralizes it so the Phase 5 migration (replace hand-rolled schedulers
 * with `useGlobalPlayer().play({ kind, data })`) is one call per page.
 *
 * Out of scope:
 *   • Note-level transformation (transposition, articulation stripping).
 *     If a page needs those, it should preprocess its `MeasureInfo[]`
 *     BEFORE passing to this adapter.
 * ──────────────────────────────────────────────────────────────────── */

import type { MeasureInfo, NoteSheetData } from "../../data/sampleMelody";

export interface MeasureInfoAdapterOpts {
  /** Display title (default ""). */
  title?: string;
  /** Display composer (default ""). */
  composer?: string;
  /** Key signature, e.g. "C", "Eb", "F#m" (default "C"). */
  key?: string;
  /** Time signature, e.g. "4/4" (default "4/4"). */
  timeSignature?: string;
  /** Initial tempo. Optional — when omitted, the player falls back to the
   *  `tempo` arg passed to `play()`. */
  tempo?: number;
  /** Genre tag forwarded to NoteSheetData (default "Jazz"). */
  genre?: string;
}

/**
 * Build a `NoteSheetData` from a flat `MeasureInfo[]`. Pure function —
 * no side effects, no mutation of the input array. Use the same input
 * array reference if you want React to skip re-rendering.
 *
 * Note: this is intentionally a thin shaper. The player's own parser
 * handles ties, tuplets, ottava brackets, repeats, D.C./D.S./Fine,
 * anacrusis — none of that needs to be replicated here.
 */
export function measureInfoToNoteSheet(
  measures: MeasureInfo[],
  opts: MeasureInfoAdapterOpts = {},
): NoteSheetData {
  return {
    title: opts.title ?? "",
    composer: opts.composer ?? "",
    key: opts.key ?? "C",
    timeSignature: opts.timeSignature ?? "4/4",
    tempo: opts.tempo,
    genre: opts.genre ?? "Jazz",
    measures,
  };
}
