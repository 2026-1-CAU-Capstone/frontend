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
