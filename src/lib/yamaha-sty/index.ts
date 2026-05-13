/**
 * Public API for the Yamaha .sty parser + data model.
 *
 * Ported from JJazzLab (LGPL v2.1) — see docs/sty-format.md for the
 * accompanying Korean format notes.
 */

export {
  type StylePartType, STYLE_PART_TYPES,
  stylePartTypeToString, stylePartTypeFromString,
  isFillOrBreak, isIntro, isEnding, isMain, getFill,
} from './style-part-type';

export {
  type AccType, type AccTypeInfo, ACC_TYPES,
  getAccTypeInfo, accTypeToString, accTypeFromChannel, accTypeOrdinal,
  isDrums, isAuthorisedNote, getAuthorisedDegree,
} from './acc-type';

export {
  YAM_CHORD_NAMES, YAM_CHORD_ALIASES,
  chordTypeFromYamIndex, yamChordNameAt,
  yamIndexFromSourceByte, chordTypeFromSourceByte,
} from './yam-chord';

export {
  type NoteTranspositionRule, type NoteTranspositionTable,
  type RetriggerRule, type SFFType, type Ctb2ChannelSettings,
  NTR_BY_INDEX, NTT_BY_INDEX, RTR_BY_INDEX,
  ntrFromByte, nttFromByte, rtrFromByte,
} from './ctb2-channel-settings';

export {
  type CtabChannelSettings, type CommonFirstPartFields,
  decodeMutedNotes, decodeMutedChords,
  createCtab, isSingleCtb2, isNoteMuted, isChordMuted,
} from './ctab-channel-settings';

export {
  type StylePart, type SourcePhrase, type SourceNoteEvent,
  createStylePart, setCtabFor, getCtabFor, addNoteEvent,
  setSizeInBeats, activeChannels, totalNoteCount,
} from './style-part';

export {
  type Style, type SFFVersion, type TimeSignature, type ChannelInstrument,
  createStyle, addStylePart, getStylePart,
  setChannelInstrument, getChannelInstrument, presentPartTypes,
} from './style';

export { parseStyleFile } from './parser';

export {
  getClosestPitch, fitMelodyPhraseToChord, fitBassPhraseToChord, fitChordPhraseToChord,
} from './fit-phrase';
export { transformPhrase, type DestChord } from './transform';
export { sourceUsedDegrees, destDegreesMelody } from './source-phrase-ops';
