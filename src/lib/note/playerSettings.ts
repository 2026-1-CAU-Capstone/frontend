/**
 * Global player settings — single source of truth for mixer/transport state
 * shared across every player instance (NoteSheet, LickCard, LickRecommend,
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

/** Melody lead-line instrument. 'piano' uses the SplendidGrandPiano (Salamander
 * grand) — every other id is a General-MIDI instrument name loaded from the
 * MusyngKite soundfont (same high-quality free kit the bass uses). */
export type MelodyInstrumentId =
  | 'piano'
  | 'flute'
  | 'alto_sax'
  | 'tenor_sax'
  | 'trumpet'
  | 'electric_guitar_jazz'
  | 'vibraphone'
  | 'clarinet';

/** Display lineup for the mixer's melody-instrument picker (order = UI order). */
export const MELODY_INSTRUMENTS: { id: MelodyInstrumentId; label: string }[] = [
  { id: 'piano',                label: '🎹 피아노' },
  { id: 'flute',                label: '🎶 플룻' },
  { id: 'alto_sax',             label: '🎷 알토 색소폰' },
  { id: 'tenor_sax',            label: '🎷 테너 색소폰' },
  { id: 'trumpet',              label: '🎺 트럼펫' },
  { id: 'electric_guitar_jazz', label: '🎸 재즈 기타' },
  { id: 'vibraphone',           label: '🔔 비브라폰' },
  { id: 'clarinet',             label: '🪈 클라리넷' },
];

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
  /** Which instrument plays the melody lead line. Default 'piano'. */
  melodyInstrument: MelodyInstrumentId;
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
  /** Display label shown in the transport genre dropdown (one of GENRES in
   *  BackingPlayerBar, e.g. "Bossa Nova"). The engine only acts on `style`
   *  (swing|bossa); `genre` keeps the richer name so the UI reflects the
   *  loaded song's actual genre. Set alongside `style` on song load and on
   *  manual genre selection. */
  genre: string;
  /** Loop chorus continuously. Backing tracks default to looping for
   *  practice; flip off for a single-chorus playthrough. */
  loop: boolean;
  /** Chord-chart transposing instrument (display only — shifts the written
   *  chart by a fixed interval). 'C' = concert pitch. */
  transposingInstrument: TransposingInstrument;
}

const DEFAULTS: PlayerSettings = {
  melodyVolume: 1.0,
  melodyInstrument: 'piano',
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
  genre: 'Medium Swing',
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

/**
 * Map a free-form genre/style string (iReal style string or a chart's
 * StyleId) to one of the labels shown in the transport genre dropdown
 * (see GENRES in BackingPlayerBar). Parallel to inferPlayStyle, but keeps
 * the richer genre name for display. Returns null on empty input so callers
 * leave the user's current choice alone.
 */
export function inferGenre(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('new orleans') || s.includes('nola')) return 'New Orleans Swing';
  if (s.includes('bossa')) return 'Bossa Nova';
  if (s.includes('samba') || s.includes('calypso')) return 'Samba';
  // "Latin:Swing" / "Latin Swing" alternates feel — check before plain latin.
  if (s.includes('latin') && s.includes('swing')) return 'Latin Swing';
  if (
    s.includes('latin') || s.includes('afro') || s.includes('mambo') ||
    s.includes('songo') || s.includes('cha') || s.includes('6/8')
  ) return 'Latin';
  if (
    s.includes('funk') || s.includes('even 8') || s.includes('even 16') ||
    s.includes('8ths') || s.includes('16ths')
  ) return 'Funk';
  if (s.includes('waltz')) return 'Jazz Waltz';
  if (s.includes('bebop') || s.includes('bop')) return 'Bebop';
  if (s.includes('ballad')) return 'Ballad';
  if (s.includes('up') && s.includes('swing')) return 'Up-Tempo Swing';
  return 'Medium Swing';
}
