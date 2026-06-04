/* Public API surface for the unified player.
 *
 * Pages should import from here:
 *   import { useGlobalPlayer, GlobalPlayerProvider } from '@/lib/player';
 *
 * Internal modules (lib/note, lib/backing) are unchanged and continue to
 * be used directly by the orchestrator. This barrel is purely a
 * convenience entry point for React consumers. */

export {
  GlobalPlayerProvider,
  useGlobalPlayer,
  useOptionalGlobalPlayer,
} from "./GlobalPlayerContext";

export {
  createGlobalPlayer,
  getGlobalPlayerSingleton,
  disposeGlobalPlayerSingleton,
} from "./GlobalPlayer";

export { measureInfoToNoteSheet } from "./measureInfoAdapter";

export { stopAllAudio, registerAudioStopper } from "./audioStopRegistry";

export type {
  PlayerInput,
  SheetInput,
  LickInput,
  SoloInput,
  ChartInput,
  ChordSymbol,
  EngineBackend,
  GlobalPlayer,
  GlobalPlayerConfig,
  GlobalPlayerEvents,
  AnacrusisNote,
} from "./types";

export type { MeasureInfoAdapterOpts } from "./measureInfoAdapter";

export type { GlobalPlayerEngineFactories } from "./GlobalPlayer";
