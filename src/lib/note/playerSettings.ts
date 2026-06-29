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

/** Mixer channel-strip tracks (volume + solo/mute). */
export type MixTrack = 'melody' | 'piano' | 'bass' | 'drums';
export type TrackFlags = Record<MixTrack, boolean>;
const NO_TRACK_FLAGS: TrackFlags = { melody: false, piano: false, bass: false, drums: false };

/** Overall feel/genre for the rhythm section. Switching this overrides
 * swing, comping rhythms, drum patterns, and bass behavior wholesale so
 * the whole rhythm section reads as that style. */
export type PlayStyle = 'swing' | 'bossa';

/** Melody lead-line instrument. 'piano' uses the SplendidGrandPiano (Salamander
 * grand) — every other id is a General-MIDI instrument name loaded from the
 * MusyngKite soundfont (same high-quality free kit the bass uses). */
export type MelodyInstrumentId =
  | 'piano'
  | 'electric_piano_1'
  | 'drawbar_organ'
  | 'accordion'
  | 'soprano_sax'
  | 'alto_sax'
  | 'tenor_sax'
  | 'baritone_sax'
  | 'trumpet'
  | 'trombone'
  | 'clarinet'
  | 'flute'
  | 'piccolo'
  | 'violin'
  | 'cello'
  | 'orchestral_harp'
  | 'harmonica'
  | 'electric_guitar_jazz'
  | 'vibraphone'
  | 'marimba'
  | 'glockenspiel'
  | 'tubular_bells';

/** Display lineup for the mixer's melody-instrument picker (order = UI order).
 *  Every id is a GM soundfont name (MusyngKite), so each plays its real timbre;
 *  the matching icon comes from MELODY_ICON_SLUG in data/instrumentIcons.ts. */
export const MELODY_INSTRUMENTS: { id: MelodyInstrumentId; label: string }[] = [
  { id: 'piano',                label: '🎹 피아노' },
  { id: 'soprano_sax',          label: '🎷 소프라노 색소폰' },
  { id: 'alto_sax',             label: '🎷 알토 색소폰' },
  { id: 'tenor_sax',            label: '🎷 테너 색소폰' },
  { id: 'baritone_sax',         label: '🎷 바리톤 색소폰' },
  { id: 'trumpet',              label: '🎺 트럼펫' },
  { id: 'trombone',             label: '🎺 트롬본' },
  { id: 'clarinet',             label: '🪈 클라리넷' },
  { id: 'flute',                label: '🎶 플룻' },
  { id: 'piccolo',              label: '🪈 피콜로' },
  { id: 'violin',               label: '🎻 바이올린' },
  { id: 'cello',                label: '🎻 첼로' },
  { id: 'orchestral_harp',      label: '🎵 하프' },
  { id: 'harmonica',            label: '🎵 하모니카' },
  { id: 'vibraphone',           label: '🔔 비브라폰' },
  { id: 'marimba',              label: '🔔 마림바' },
  { id: 'glockenspiel',         label: '🔔 글로켄슈필' },
  { id: 'tubular_bells',        label: '🔔 튜뷸러 벨' },
];

/** Comping (left-hand/keyboard) instruments for the PIANO track. The engine
 *  loads the chosen timbre as the comp instrument (loadMelodyInstrument). */
export const COMP_INSTRUMENTS: { id: string; label: string }[] = [
  { id: 'piano',                label: '🎹 피아노' },
  { id: 'electric_piano_1',     label: '🎹 로즈 (일렉트릭 피아노)' },
  { id: 'drawbar_organ',        label: '🎹 해먼드 오르간' },
  { id: 'accordion',            label: '🪗 아코디언' },
  { id: 'electric_guitar_jazz', label: '🎸 재즈 기타' },
  { id: 'vibraphone',           label: '🔔 비브라폰' },
];

/** Bass instruments for the BASS track. acoustic/contrabass use the sampled
 *  upright (Smolken); electric/fretless use their GM timbre. */
export const BASS_INSTRUMENTS: { id: string; label: string }[] = [
  { id: 'acoustic_bass',        label: '🎻 콘트라베이스 (어쿠스틱)' },
  { id: 'electric_bass_finger', label: '🎸 일렉트릭 베이스' },
  { id: 'fretless_bass',        label: '🎸 프렛리스 베이스' },
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
  /** Comping instrument timbre for the piano track (GM id; 'piano' = grand). */
  compInstrument: string;
  /** 0–1, send level into the shared reverb bus for piano (comp + melody). */
  pianoReverb: number;
  bassVolume: number;
  /** Bass instrument timbre (acoustic_bass = sampled upright; electric/fretless = GM). */
  bassInstrument: string;
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
  /** Play the inline lick's melody over the chord chart when one is shown.
   *  Off = the lick is still drawn under the bars but stays silent. */
  playInlineLick: boolean;
  /** Master output gain (0–1+) — multiplies every per-track volume. */
  masterVolume: number;
  /** Per-track mute. A muted track is silenced regardless of its slider. */
  mutes: TrackFlags;
  /** Per-track solo. If ANY track is soloed, only soloed (and un-muted)
   *  tracks sound — the classic mixer solo. */
  solos: TrackFlags;
  /** Play the "1 2 3 4" count-in before playback. Off = start immediately. */
  countInEnabled: boolean;
  /** Count-in length in bars (1 or 2). */
  countInBars: number;
}

/** Default for every volume slider — 0–100 UI scale, 50 = 0.5 gain.
 *  50 was chosen as a moderate listening level (the old default 1.0 = full
 *  velocity ran hot, and the sliders used to reach 200%). All five volumes
 *  share this so the mix balance is set purely by the per-instrument amp
 *  gains in soundfont.ts, not by uneven slider defaults. */
const DEFAULT_VOLUME = 0.5;

const DEFAULTS: PlayerSettings = {
  melodyVolume: DEFAULT_VOLUME,
  melodyInstrument: 'piano',
  pianoVolume: DEFAULT_VOLUME,
  compInstrument: 'piano',
  pianoReverb: 0.45,
  bassVolume: DEFAULT_VOLUME,
  bassInstrument: 'acoustic_bass',
  bassMode: 'two-feel',
  drumVolume: DEFAULT_VOLUME,
  drumKit: 'synth',
  drumEnabled: true,
  metroEnabled: false,
  metroVolume: DEFAULT_VOLUME,
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
  playInlineLick: true,
  masterVolume: 1,
  mutes: { ...NO_TRACK_FLAGS },
  solos: { ...NO_TRACK_FLAGS },
  countInEnabled: true,
  countInBars: 1,
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
    return {
      ...DEFAULTS, drumKit: legacyDrumKit, ...parsed,
      // 볼륨은 매 앱 시작마다 디폴트(50)로 강제 — 저장값을 무시한다.
      // 사용자가 슬라이더를 0으로 내려놓고 잊어 "소리가 안 난다"고 헷갈리는 일을
      // 막기 위함(무슨 일이 있어도 항상 50으로 시작). 다른 설정(킷/장르/스타일/
      // 스윙/루프 등)은 그대로 유지되고, 세션 중 볼륨 조절도 정상 동작한다 —
      // 다음 새로고침에서만 50으로 돌아온다.
      melodyVolume: DEFAULTS.melodyVolume,
      pianoVolume: DEFAULTS.pianoVolume,
      bassVolume: DEFAULTS.bassVolume,
      drumVolume: DEFAULTS.drumVolume,
      metroVolume: DEFAULTS.metroVolume,
      // 마스터/뮤트/솔로도 매 시작 초기화 — "어제 켜둔 뮤트/솔로로 소리가 안 난다"는
      // 혼란을 막는다(볼륨과 동일 정책).
      masterVolume: DEFAULTS.masterVolume,
      mutes: { ...NO_TRACK_FLAGS },
      solos: { ...NO_TRACK_FLAGS },
    };
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

/** Reset the MIXER controls to their defaults (volumes, kit, instrument,
 *  bass mode, reverb, transposing instrument, metronome, count-in, mute/solo).
 *  Leaves transport/song state (genre/style/loop) untouched. */
export function resetMixerToDefaults(): void {
  setPlayerSettings({
    masterVolume: DEFAULTS.masterVolume,
    melodyVolume: DEFAULTS.melodyVolume,
    pianoVolume: DEFAULTS.pianoVolume,
    bassVolume: DEFAULTS.bassVolume,
    drumVolume: DEFAULTS.drumVolume,
    metroVolume: DEFAULTS.metroVolume,
    pianoReverb: DEFAULTS.pianoReverb,
    drumKit: DEFAULTS.drumKit,
    melodyInstrument: DEFAULTS.melodyInstrument,
    bassMode: DEFAULTS.bassMode,
    transposingInstrument: DEFAULTS.transposingInstrument,
    countInEnabled: DEFAULTS.countInEnabled,
    countInBars: DEFAULTS.countInBars,
    mutes: { ...NO_TRACK_FLAGS },
    solos: { ...NO_TRACK_FLAGS },
  });
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
