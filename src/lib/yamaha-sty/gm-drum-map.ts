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
  // 51 / 59 / 53 = standard ride / ride / ride-bell. The iReal corpus also
  // (ab)uses 60/71/72 as ride substitutes — see additions below.
  51: 'ride',
  59: 'ride',           // iReal Latin patterns pair 51 + 59 as paired ride hits
  53: 'ride-bell',      // iReal Latin uses Side Stick (37) + Ride Bell (53)
  55: 'splash',
  // Toms
  41: 'tom-low', 43: 'tom-low', 45: 'tom-low',  // 41 = iReal Ballad ride substitute (Low Floor Tom)
  47: 'tom-mid', 48: 'tom-mid',
  50: 'tom-high',
  // Less common
  39: 'clap',
  54: 'tambourine',
  56: 'cowbell',        // iReal click track
  60: 'ride',           // iReal CUSTOM (Billie's Bounce variant) — Hi Bongo as ride
  61: 'low-bongo',
  62: 'mute-high-conga', 63: 'open-high-conga', 64: 'low-conga',
  // Stage-1 additions — iReal CUSTOM uses GM whistles as the primary ride
  // because the source MIDI library lacks dedicated jazz-ride samples.
  // These pitches were previously unmapped (silenced). CRITICAL for the
  // Stage-1 iReal corpus to play back with audible cymbal work.
  71: 'ride',           // GM Short Whistle → ride (iReal CUSTOM primary ride)
  72: 'ride',           // GM Long Whistle  → ride (iReal CUSTOM variant)
};

/** Returns the drum-piece group name for a GM drum note, or null if unmapped. */
export function gmNoteToDrumGroup(noteNumber: number): string | null {
  return GM_TO_DRUM_GROUP[noteNumber] ?? null;
}
