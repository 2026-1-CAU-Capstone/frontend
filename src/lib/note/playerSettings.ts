/**
 * Global player settings — single source of truth for mixer/transport state
 * shared across every NotePlayer instance (NoteSheet, LickCard, LickRecommend,
 * etc.). Settings are persisted to localStorage so they survive reloads, and
 * any change is broadcast to subscribers (running players + live mixer UI).
 *
 * Usage:
 *   const s = getPlayerSettings();
 *   setPlayerSetting('pianoReverb', 0.5);
 *   const unsub = subscribePlayerSettings((next) => { ... });
 */

import { loadDrumKitPref, type DrumKitId } from '../backing/drumKitPresets';

/** Bass scheduling style. */
export type BassMode =
  | 'half'      // one sustained root per chord (current legacy behavior)
  | 'two-feel'  // root on beat 1, fifth on beat 3 (every chord half)
  | 'four-feel'; // walking — one hit per beat (root/5 alternating)

/** Overall feel/genre for the rhythm section. Switching this overrides
 * swing, comping rhythms, drum patterns, and bass behavior wholesale so
 * the whole rhythm section reads as that style. */
export type PlayStyle = 'swing' | 'bossa';

/** Transposing instrument for the chord-chart display. 'C' is concert pitch;
 * the others shift the written chart up by a fixed interval so a player reading
 * that instrument sees the correct fingering key (iReal-Pro "이조 악기"). */
export type TransposingInstrument = 'C' | 'Bb' | 'Eb' | 'F' | 'G';

/** Semitones to ADD to concert pitch to get the WRITTEN pitch for each
 * instrument. Bb +2 (M2), Eb +9 (M6), F +7 (P5), G +5 (P4). */
export const TRANSPOSING_INSTRUMENT_OFFSET: Record<TransposingInstrument, number> = {
  C: 0, Bb: 2, Eb: 9, F: 7, G: 5,
};

export interface PlayerSettings {
  melodyVolume: number;
  pianoVolume: number;
  /** 0–1, send level into the shared reverb bus for piano (comp + melody). */
  pianoReverb: number;
  bassVolume: number;
  bassMode: BassMode;
  drumVolume: number;
  drumKit: DrumKitId;
  drumEnabled: boolean;
  metroEnabled: boolean;
  metroVolume: number;
  /** 8th-note swing ratio. 0.5 = straight 8ths. 0.62 = old default ("medium
   *  swing"). 0.708 = corpus-calibrated medium swing (matches iReal Pro /
   *  classic recordings — the new default). 0.667 = strong triplet feel.
   *  Applied uniformly across all melody playback paths via lib/note/swing.ts.
   *  Forced to 0.5 when style='bossa'. Mixer slider lets the user override. */
  swingRatio: number;
  /** Overall feel — swing (default) vs bossa nova. Switches comping / drum /
   *  bass patterns AND forces straight 8ths when 'bossa'. */
  style: PlayStyle;
  /** Loop chorus continuously. Backing tracks default to looping for
   *  practice; flip off for a single-chorus playthrough. */
  loop: boolean;
  /** Chord-chart transposing instrument (display only — shifts the written
   *  chart by a fixed interval). 'C' = concert pitch. */
  transposingInstrument: TransposingInstrument;
}

const DEFAULTS: PlayerSettings = {
  melodyVolume: 1.0,
  pianoVolume: 1.0,
  pianoReverb: 0.45,
  bassVolume: 1.0,
  bassMode: 'two-feel',
  drumVolume: 1.0,
  drumKit: 'synth',
  drumEnabled: true,
  metroEnabled: false,
  metroVolume: 0.6,
  // 0.708 matches the corpus-calibrated medium-swing ratio used by drum
  // patterns via `getSwingRatio(bpm, 'medium-swing')`. Before this change,
  // drums used 0.708 but bass/piano timing used 0.62, producing audible
  // micro-drift between rhythm-section instruments. Mixer slider remains
  // user-overridable for ballads / up-tempo manual tuning.
  swingRatio: 0.708,
  style: 'swing',
  loop: true,
  transposingInstrument: 'C',
};

const LS_KEY = 'jazzify_player_settings_v1';

function loadFromStorage(): PlayerSettings {
  // Pick up the existing drum-kit preference so users keep their kit selection
  // when migrating to the unified settings module.
  const legacyDrumKit = (() => {
    try { return loadDrumKitPref(); } catch { return DEFAULTS.drumKit; }
  })();
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS, drumKit: legacyDrumKit };
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return { ...DEFAULTS, drumKit: legacyDrumKit, ...parsed };
  } catch {
    return { ...DEFAULTS, drumKit: legacyDrumKit };
  }
}

function saveToStorage(s: PlayerSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch { /* quota / private mode — non-fatal */ }
}

let current: PlayerSettings = loadFromStorage();
const listeners = new Set<(s: PlayerSettings) => void>();

export function getPlayerSettings(): PlayerSettings {
  return current;
}

export function setPlayerSetting<K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  saveToStorage(current);
  listeners.forEach((l) => l(current));
}

export function setPlayerSettings(patch: Partial<PlayerSettings>): void {
  let changed = false;
  for (const k in patch) {
    const key = k as keyof PlayerSettings;
    if (patch[key] !== undefined && current[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  current = { ...current, ...patch };
  saveToStorage(current);
  listeners.forEach((l) => l(current));
}

export function subscribePlayerSettings(fn: (s: PlayerSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* ─── style inference ────────────────────────────────────────────────── */

/**
 * Pick the rhythm-section style (swing|bossa) from a free-form genre / style
 * string carried on a chart or note-sheet. Anything that smells latin → bossa,
 * everything else → swing. Returns null when the input is empty so callers can
 * leave the user's last-chosen style alone instead of clobbering it.
 */
export function inferPlayStyle(raw: string | undefined | null): PlayStyle | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (
    s.includes('bossa') ||
    s.includes('samba') ||
    s.includes('latin') ||
    s.includes('afro')
  ) return 'bossa';
  return 'swing';
}
