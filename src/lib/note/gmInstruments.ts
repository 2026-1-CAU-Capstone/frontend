/* ─────────────────────────────────────────────────────────────────────────
 * General MIDI mappings for multi-part playback.
 *
 * MusicXML parts carry a GM program number (<midi-program>, 1-based) and, for
 * drums, MIDI channel 10. We map:
 *   - GM program  → a MusyngKite soundfont instrument name (smplr loads these
 *     by name; the same string the melody-instrument loader already accepts).
 *   - GM percussion note → the engine's DrumPiece enum so channel-10 parts
 *     play through the drum sampler instead of as pitched notes.
 * ──────────────────────────────────────────────────────────────────────── */

import type { DrumPiece } from '../backing/types';

/** Sentinel instrument name for channel-10 (percussion) parts. */
export const DRUM_INSTRUMENT = '__drums__';

/* Standard 128 GM melodic instrument names (MusyngKite / soundfont-player
 * naming). Index = program-1. Program 1 (acoustic grand) maps to 'piano',
 * which the loader special-cases to the high-quality SplendidGrandPiano. */
const GM_NAMES: string[] = [
  'piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
  'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
  'celesta', 'glockenspiel', 'music_box', 'vibraphone',
  'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
  'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
  'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
  'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
  'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
  'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
  'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
  'violin', 'viola', 'cello', 'contrabass',
  'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
  'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
  'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
  'trumpet', 'trombone', 'tuba', 'muted_trumpet',
  'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
  'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
  'oboe', 'english_horn', 'bassoon', 'clarinet',
  'piccolo', 'flute', 'recorder', 'pan_flute',
  'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
  'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
  'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass__lead',
  'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
  'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
  'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
  'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
  'sitar', 'banjo', 'shamisen', 'koto',
  'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
  'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
  'telephone_ring', 'helicopter', 'applause', 'gunshot',
];

/** GM program (1-based) → MusyngKite instrument name. Out-of-range → piano. */
export function gmProgramToInstrument(program: number | undefined): string {
  if (program == null || program < 1 || program > 128) return 'piano';
  return GM_NAMES[program - 1] ?? 'piano';
}

/** GM percussion key (MIDI note on channel 10) → the engine's DrumPiece.
 *  Unmapped percussion (shakers, etc.) returns null and is dropped. */
export function gmPercToDrumPiece(midi: number): DrumPiece | null {
  switch (midi) {
    case 35: case 36: return 'kick';
    case 37: return 'rim';
    case 38: case 40: return 'snare';
    case 39: return 'snare';                 // hand clap → snare
    case 41: case 43: return 'tom-low';
    case 45: case 47: return 'tom-mid';
    case 48: case 50: return 'tom-high';
    case 42: case 44: return 'hihat-closed';
    case 46: return 'hihat-open';
    case 49: case 57: return 'crash';
    case 55: return 'splash';
    case 51: case 59: return 'ride';
    case 53: return 'ride-bell';
    // Latin/aux percussion (bongos/maracas/congas) → closest kit voices so a
    // Latin chart still grooves rather than going silent.
    case 60: case 61: return 'tom-high';     // hi/lo bongo
    case 62: case 63: case 64: return 'tom-mid'; // congas
    case 70: case 69: return 'hihat-closed'; // maracas / cabasa
    case 75: case 76: case 77: return 'rim'; // claves / woodblocks
    default: return null;
  }
}
