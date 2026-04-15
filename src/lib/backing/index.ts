/* Public API surface for the backing-track engine.
 *
 * Consumers (ChordPage, NotePage, tests) should only import from here.
 * Internal modules are free to restructure as long as this surface holds. */

export type {
  // Core data
  Chart, Section, Bar, Chord, ChordQuality,
  // Style / feel axes
  StyleId, FeelId,
  // Differentiation features
  Figure, FigureHit, UnisonSpan, BarInstruction,
  // Instruments
  InstrumentId, InstrumentSet, DrumPiece,
  // Runtime
  BackingEvent, NoteEvent, DrumEvent,
  BackingConfig, BackingPlayerCallbacks, BackingPlayer,
  // Primitives
  PitchClass, MidiNote, BeatOffset, BeatDuration,
} from "./types";

export { createBackingPlayer } from "./player";
export { leadSheetToChart } from "./adapters/leadSheetToChart";
