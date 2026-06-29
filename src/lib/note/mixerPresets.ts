/**
 * Mixer presets — save/recall a named snapshot of the musical mixer state
 * (volumes, kit, instrument, swing, genre, …) to localStorage. Lets a user
 * keep e.g. a "조용한 연습" or "풀 밴드" mix and switch instantly.
 *
 * Only a musically-relevant SUBSET of PlayerSettings is captured — transient
 * flags (mutes/solos) and per-song state are intentionally excluded.
 */

import {
  getPlayerSettings,
  setPlayerSettings,
  type PlayerSettings,
} from './playerSettings';

const LS_KEY = 'jazzify.mixerPresets.v1';

/** Settings keys a preset captures/restores. */
const PRESET_KEYS = [
  'masterVolume', 'melodyVolume', 'pianoVolume', 'bassVolume', 'drumVolume', 'metroVolume',
  'pianoReverb', 'drumKit', 'melodyInstrument', 'bassMode',
  'genre', 'style', 'loop', 'countInEnabled', 'countInBars',
] as const satisfies readonly (keyof PlayerSettings)[];

export type MixerPresetData = Partial<Pick<PlayerSettings, (typeof PRESET_KEYS)[number]>>;

export interface MixerPreset {
  name: string;
  data: MixerPresetData;
}

function read(): MixerPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as MixerPreset[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list: MixerPreset[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* quota/private */ }
}

/** All saved presets (newest changes kept; order = insertion). */
export function listMixerPresets(): MixerPreset[] {
  return read();
}

/** Snapshot the current mixer subset under `name` (overwrites a same-name preset). */
export function saveMixerPreset(name: string): MixerPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return read();
  const s = getPlayerSettings();
  const data = {} as Record<string, unknown>;
  for (const k of PRESET_KEYS) data[k] = s[k];
  const list = read().filter((p) => p.name !== trimmed);
  list.push({ name: trimmed, data: data as MixerPresetData });
  write(list);
  return list;
}

/** Apply a preset's captured settings to the live mixer. */
export function applyMixerPreset(name: string): void {
  const p = read().find((x) => x.name === name);
  if (p) setPlayerSettings(p.data);
}

/** Delete a preset by name. */
export function deleteMixerPreset(name: string): MixerPreset[] {
  const list = read().filter((p) => p.name !== name);
  write(list);
  return list;
}
