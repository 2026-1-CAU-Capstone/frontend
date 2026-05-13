/**
 * Map General-MIDI drum-note numbers to the high-level drum-piece names
 * that smplr's DrumMachine groups expose. Used when a .sty channel's
 * AccType is RHYTHM or SUBRHYTHM and we route note events through a
 * DrumMachine instance instead of a pitched Soundfont.
 *
 * GM drum map reference: https://en.wikipedia.org/wiki/General_MIDI#Percussion
 *
 * Not every GM note has a smplr equivalent (TR-808 / TR-909 kits are
 * leaner than the full GM set). Returning null falls through to a "skip
 * this note" path in the player.
 */

const GM_TO_DRUM_GROUP: Record<number, string> = {
  // Kick
  35: 'kick', 36: 'kick',
  // Snare
  37: 'snare', 38: 'snare', 40: 'snare',
  // Hi-hat
  42: 'hihat-closed', 44: 'hihat-foot', 46: 'hihat-open',
  // Cymbals
  49: 'crash', 57: 'crash',
  51: 'ride', 59: 'ride', 53: 'ride-bell',
  55: 'splash',
  // Toms
  41: 'tom-low', 43: 'tom-low', 45: 'tom-low',
  47: 'tom-mid', 48: 'tom-mid',
  50: 'tom-high',
  // Less common
  39: 'clap',
  54: 'tambourine', 56: 'cowbell',
  60: 'high-bongo', 61: 'low-bongo',
  62: 'mute-high-conga', 63: 'open-high-conga', 64: 'low-conga',
};

/** Returns the drum-piece group name for a GM drum note, or null if unmapped. */
export function gmNoteToDrumGroup(noteNumber: number): string | null {
  return GM_TO_DRUM_GROUP[noteNumber] ?? null;
}
