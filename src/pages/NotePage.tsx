import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { MobileChatFab } from '../components/layout/MobileChatFab';
import { setActiveChat } from '../api/chat';
import { NoteSheet, type NoteSheetHandle } from '../components/notesheet/NoteSheet';
import { openPerformanceSettings } from '../lib/settingsBus';
import { KeyControl } from '../components/leadsheet/LeadSheet';
import { SessionPicker, type SessionInstrument } from '../components/chord/SessionPicker';
import {
  GenreSelect, MetronomeToggle, BpmControl, RepeatControl, TransportButtons,
  BackingMixer,
} from '../components/backing/BackingPlayerBar';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { sampleMelody } from '../data/sampleMelody';
import type { NoteSheetData, MeasureInfo, NoteInfo } from '../data/sampleMelody';
import type { ChordOverlay } from '../data/types';
import { noteSongs, externalSongs, externalCollections, manualSongs, leadsheetSongs } from '../data/noteSongs';
import type { SongGroup } from '../data/noteSongs';
import { loadMidiMelody } from '../lib/note/midiMelodyParser';
import { loadXmlParts, loadMxlParts, sortPartsByMelody, type ScorePart } from '../lib/note/xmlMelodyParser';
import { injectChordsFromLeadSheet } from '../lib/note/jazz1460ChordInject';
import { getPlayerSettings, subscribePlayerSettings, TRANSPOSING_INSTRUMENT_OFFSET } from '../lib/note/playerSettings';
import { getSong } from '../lib/ireal/irealLoader';
import { useGlobalPlayer } from '../lib/player';
import { loadBreakPoints, saveBreakPoints, toggleBreakPoint, type BreakPoint } from '../lib/breakPoints';
import { buildNoteShareUrl, tryNativeShare } from '../lib/share/chartShare';
import { ShareLinkModal } from '../components/common/ShareLinkModal';

const SAMPLE_ID = '__sample__';

/* ─── transposition ──────────────────────────────────────────────────── */

const ALL_KEYS_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const ALL_KEYS_MINOR = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const FLAT_KEYS = new Set(['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

const PC_FLAT: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['D','b'],['D',undefined],['E','b'],['E',undefined],
  ['F',undefined],['G','b'],['G',undefined],['A','b'],['A',undefined],
  ['B','b'],['B',undefined],
];
const PC_SHARP: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['C','#'],['D',undefined],['D','#'],['E',undefined],
  ['F',undefined],['F','#'],['G',undefined],['G','#'],['A',undefined],
  ['A','#'],['B',undefined],
];

function keyToPc(key: string): number {
  const clean = key.replace(/m$/i, '');
  const root = clean[0].toUpperCase();
  const acc = clean.length > 1 ? clean[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

/** Shift a key name up by `semitones`, preserving major/minor and using the
 *  canonical note-key spelling. Folds the transposing-instrument offset into
 *  the displayed key. */
function shiftNoteKey(key: string, semitones: number): string {
  if (semitones === 0) return key;
  const newPc = (keyToPc(key) + semitones + 12) % 12;
  return /m$/i.test(key) ? ALL_KEYS_MINOR[newPc] : ALL_KEYS_MAJOR[newPc];
}

function transposeNoteKey(vexKey: string, accidental: '#' | 'b' | 'n' | undefined, semitones: number, useFlats: boolean): { key: string; acc?: '#' | 'b' | 'n' } {
  // vexKey e.g. "c/4", "f/5"
  const [notePart, octStr] = vexKey.split('/');
  const noteName = notePart.toUpperCase();

  // Compute new octave
  let origPc = NOTE_TO_PC[noteName] ?? 0;
  if (accidental === '#') origPc += 1;
  else if (accidental === 'b') origPc -= 1;
  const origMidi = parseInt(octStr) * 12 + origPc;
  const newMidi = origMidi + semitones;
  const newOctave = Math.floor(newMidi / 12);
  const newPcInOctave = ((newMidi % 12) + 12) % 12;

  const table = useFlats ? PC_FLAT : PC_SHARP;
  const [newNote, newAcc] = table[newPcInOctave];

  // Clamp octave to playable range: if above C6 (midi 84) → octave down, below C3 (midi 48) → octave up
  let finalOctave = newOctave;
  const finalMidi = finalOctave * 12 + newPcInOctave;
  if (finalMidi >= 84) finalOctave -= 1;   // above C6 → drop octave
  else if (finalMidi < 48) finalOctave += 1; // below C3 → raise octave

  const newKey = `${newNote.toLowerCase()}/${finalOctave}`;
  return { key: newKey, acc: newAcc === undefined ? undefined : newAcc };
}

// Notes altered by each key signature (sharps/flats in the key)
const KEY_SIG_NOTES: Record<string, Set<string>> = {
  'C': new Set(),
  'G': new Set(['F#']), 'D': new Set(['F#','C#']), 'A': new Set(['F#','C#','G#']),
  'E': new Set(['F#','C#','G#','D#']), 'B': new Set(['F#','C#','G#','D#','A#']),
  'F#': new Set(['F#','C#','G#','D#','A#','E#']),
  'F': new Set(['Bb']), 'Bb': new Set(['Bb','Eb']), 'Eb': new Set(['Bb','Eb','Ab']),
  'Ab': new Set(['Bb','Eb','Ab','Db']), 'Db': new Set(['Bb','Eb','Ab','Db','Gb']),
  'Gb': new Set(['Bb','Eb','Ab','Db','Gb','Cb']),
};

const CHORD_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const CHORD_NAME_TO_SEMI: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

function transposeChord(chord: string, semitones: number): string {
  if (!chord) return chord;
  // Handle multi-chord (e.g. "Dm7  G7")
  return chord.replace(/([A-G][b#]?)/g, (match) => {
    const rootSemi = CHORD_NAME_TO_SEMI[match] ?? 0;
    const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;
    return CHORD_KEY_NAMES[newSemi];
  });
}

/* Minor key → relative major for key sig lookup */
const MINOR_TO_MAJOR: Record<string, string> = {
  'Cm': 'Eb', 'C#m': 'E', 'Dbm': 'E', 'Dm': 'F', 'D#m': 'F#', 'Ebm': 'Gb',
  'Em': 'G', 'Fm': 'Ab', 'F#m': 'A', 'Gm': 'Bb', 'G#m': 'B', 'Abm': 'B',
  'Am': 'C', 'A#m': 'Db', 'Bbm': 'Db', 'Bm': 'D',
};

function transposeNoteData(data: NoteSheetData, targetKey: string): NoteSheetData {
  const origPc = keyToPc(data.key ?? 'C');
  const targetPc = keyToPc(targetKey);
  const semitones = (targetPc - origPc + 12) % 12;

  const useFlats = FLAT_KEYS.has(targetKey.replace(/m$/i, ''));
  const majorKey = MINOR_TO_MAJOR[targetKey] ?? targetKey.replace(/m$/i, '');
  const keySigNotes = KEY_SIG_NOTES[majorKey] ?? new Set();

  return {
    ...data,
    key: targetKey,
    measures: data.measures.map((m) => ({
      ...m,
      chord: m.chord ? transposeChord(m.chord, semitones) : m.chord,
      notes: m.notes.map((n) => {
        if (n.duration.endsWith('r')) return n; // rests don't transpose
        const origAcc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
        const { key: newKey, acc: newAcc } = transposeNoteKey(n.keys[0], origAcc, semitones, useFlats);
        // Check if this accidental is already in the key signature → omit it
        const noteName = newKey.split('/')[0].toUpperCase();
        const fullNote = newAcc ? `${noteName}${newAcc}` : noteName;
        let finalAcc: Record<number, '#' | 'b' | 'n'> | undefined;
        let finalKey = newKey;
        if (newAcc && keySigNotes.has(fullNote)) {
          // Accidental is part of the key signature — don't DRAW it explicitly
          // (the staff's key signature already implies it), but BAKE it into the
          // key string so the audio path resolves the right pitch. extractMelody/
          // vexKeyToMidi are key-signature-UNAWARE and read only the explicit
          // accidental; without baking, e.g. Eb in Eb-major lost its flat and
          // played back as E natural — transposed solos sounded a key off.
          finalAcc = undefined;
          finalKey = `${noteName.toLowerCase()}${newAcc}/${newKey.split('/')[1]}`;
        } else if (newAcc) {
          finalAcc = { 0: newAcc };
        } else if (!newAcc && (keySigNotes.has(`${noteName}b`) || keySigNotes.has(`${noteName}#`))) {
          // Natural note but key sig has an altered version → need natural sign
          finalAcc = { 0: 'n' };
        }
        return {
          ...n,
          keys: [finalKey],
          accidentals: finalAcc,
        };
      }),
    })),
  };
}

/* ─── selection → chat context ───────────────────────────────────────── */

/** Pretty-print a single note for LLM consumption. e.g. `c#/5 [8.]`, `e/4 [q]`,
 *  `rest [h]`. Duration is kept in VexFlow shorthand so the model sees the
 *  same rhythmic vocabulary it would in the score. */
function formatNote(n: NoteInfo): string {
  const isRest = n.duration.endsWith('r');
  if (isRest) return `rest [${n.duration}]`;
  const acc = n.accidentals?.[0];
  const pitch = acc ? `${n.keys[0]}${acc}` : n.keys[0];
  const dotted = n.dotted ? '.' : '';
  const tuplet = n.tuplet ? ` (${n.tuplet}-tuplet)` : '';
  const tie = n.tie ? ' ~' : '';
  return `${pitch} [${n.duration}${dotted}]${tuplet}${tie}`;
}

/** Build the data the chat panel needs from a set of selected measure ranges.
 *  - `selectedChords` reuses the ChordOverlay pipeline already wired into
 *    RightChatPanel / ChatInput (so the UI shows the chord chips for free).
 *  - `notesContext` is a separate string the panel attaches ONLY when the
 *    user asks a solo / note-level question (heuristic in RightChatPanel),
 *    so casual "analyze this chord progression" queries don't waste tokens
 *    on per-note dumps. */
function buildNoteSelectionData(
  sheet: NoteSheetData,
  ranges: Array<[number, number]>,
): { selectedChords: ChordOverlay[]; notesContext: string } {
  const measures = sheet.measures;
  // Collect unique measure indices preserving order across multiple disjoint
  // ranges. Sorted within a range, ranges in click order.
  const indices: number[] = [];
  const seen = new Set<number>();
  for (const [a, b] of ranges) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(measures.length - 1, Math.max(a, b));
    for (let i = lo; i <= hi; i++) {
      if (!seen.has(i)) { seen.add(i); indices.push(i); }
    }
  }
  if (indices.length === 0) return { selectedChords: [], notesContext: '' };

  /* Chord overlays — minimal stub so RightChatPanel's chord pipeline reuses
   *  unchanged. Most fields are intentionally empty because NotePage has no
   *  per-chord harmonic analysis the way ChordPage does. */
  const selectedChords: ChordOverlay[] = [];
  let lastChord = '';
  for (const i of indices) {
    const m = measures[i];
    const symbol = m.chord ?? lastChord; // carry the last labelled chord through unlabelled measures
    if (m.chord) lastChord = m.chord;
    if (!symbol) continue;
    selectedChords.push({
      id: `note-sel-${i}`,
      symbol,
      bar: i + 1,
      pageNumber: 1,
      position: { x: 0, y: 0, width: 0, height: 0 },
      analysis: { degree: '', func: 'SD', diatonic: true },
    });
  }

  /* Per-measure note dump. Format optimised for an LLM: one bar per line,
   *  notes joined with ` · ` so rhythmic groupings are visually distinct
   *  from chord boundaries. */
  const summarizeMeasure = (m: MeasureInfo, idx: number): string => {
    const chord = m.chord ? ` (${m.chord})` : '';
    const notesStr = m.notes.length === 0
      ? 'empty'
      : m.notes.map(formatNote).join(' · ');
    return `Bar ${idx + 1}${chord}: ${notesStr}`;
  };

  const lines = [
    '=== Selected Solo Section (notes) ===',
    'These are the exact notes the player chose to play in the user-selected bars.',
    'Use them when the user asks about WHY a particular note / line / approach was chosen,',
    'or for any line-level (rhythmic, melodic, voice-leading) discussion.',
    ...indices.map((i) => summarizeMeasure(measures[i], i)),
  ];
  const notesContext = lines.join('\n');

  return { selectedChords, notesContext };
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const PageContainer = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
`;

const RightSection = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const MainArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const CenterColumn = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
`;

/* White transport bar above the sheet — mirrors ChordPage's TransportBar so
 * the two analysis pages share one look. Holds the note-page controls (editor,
 * key, convert, analysis toggle, gear). */
const TransportBar = styled.div`
  position: relative;
  z-index: 60;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 5px 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
  min-width: 0;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;

  ${mq.mobile} {
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
  }
`;

const BarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const BarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
`;

/* "Note N" label shown in the toolbar's leftExtra slot (matches ChordPage). */
const SongPickerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

const SongSelect = styled.select`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 3px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  max-width: 420px;
`;

/* In-flow center group (transport controls) — mirrors ChordPage's BarCenter. */
const BarCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
`;

const ToolBtn = styled.button<{ $lit?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: ${({ $lit }) => ($lit ? '#e8a838' : '#5b5b5b')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  ${({ $lit }) => $lit && 'filter: drop-shadow(0 0 4px rgba(232, 168, 56, 0.55));'}

  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

/* ─── tool icons (Lucide, 24×24 stroke) — copied from ChordPage ─────────── */
const ShareIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const PencilIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const LightbulbIcon = ({ lit }: { lit: boolean }) => (
  <svg width="27" height="27" viewBox="0 0 24 24" fill={lit ? 'rgba(232, 168, 56, 0.22)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
  </svg>
);

/* 톱니 = 고급 설정 모달(F3.17). ChordPage 와 동일한 아이콘. */
const GearIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

/* 전체 보기 — vertical stack of all parts, each shrunk via `zoom` so multiple
 * independent staves fit ("아주 작게"). zoom reflows layout height (unlike
 * transform:scale) so the stacked parts don't overlap. */
const AllPartsStack = styled.div`
  flex: 1;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bgSecondary};
  padding: 12px 0 40px;
`;

const AllPartsPicker = styled.select`
  margin: 4px 0 10px 16px;
  padding: 6px 12px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  background: #1a1a1a;
  color: #fff;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
`;

const PartScale = styled.div`
  zoom: 0.6;
  margin-bottom: 6px;
`;

const PartScaleLabel = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  color: #555;
  margin: 0 0 2px 18px;
`;

const LoadingState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const RightPanelWrapper = styled.div<{ $width: number }>`
  width: ${({ $width }) => $width}px;
  min-width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;

  ${mq.compactLayout} {
    display: none;
  }
`;

/* Tab strip splitting the right panel into 믹서 / AI 채팅 (matches ChordPage). */
const PanelTabs = styled.div`
  display: flex;
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  flex-shrink: 0;
`;

const PanelTab = styled.button<{ $on?: boolean }>`
  flex: 1;
  padding: 9px 0;
  border: none;
  background: transparent;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  color: ${({ $on }) => ($on ? '#2b8aef' : '#888')};
  border-bottom: 2px solid ${({ $on }) => ($on ? '#2b8aef' : 'transparent')};
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  &:hover { color: ${({ $on }) => ($on ? '#2b8aef' : '#555')}; }
`;

const ResizeDivider = styled.div`
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  transition: background 0.15s;

  &:hover, &.dragging {
    background: ${({ theme }) => theme.colors.border};
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }

  ${mq.compactLayout} {
    display: none;
  }
`;

/* ─── component ──────────────────────────────────────────────────────── */

export default function NotePage() {
  const navigate = useNavigate();
  // Entering a sheet/note chart starts a FRESH AI-chat session (song switches
  // within the page are handled by RightChatPanel's songTitle effect).
  // EXCEPTION: arriving via a Recent-Chats click (?chat=<id>) RESTORES that
  // chat so its conversation reopens with this chart.
  const [searchParams] = useSearchParams();
  const [restoreChatId] = useState<string | undefined>(
    () => searchParams.get('chat') ?? undefined,
  );
  useEffect(() => {
    if (restoreChatId) setActiveChat(restoreChatId);
    else setActiveChat(null);
  }, []);
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);

  /* song state */
  const [songGroup, setSongGroup] = useState<SongGroup | '__sample__'>('__sample__');
  /* External은 데이터셋(PDMX/McKenzie/…)별로 나눠서 본다 — 하나의 거대한
   * 드롭다운에 전부 섞어 보여주지 않는다. */
  const [externalCollection, setExternalCollection] = useState<string>(externalCollections[0].id);
  const [songId, setSongId] = useState(SAMPLE_ID);
  const [sheet, setSheet] = useState<NoteSheetData | null>(sampleMelody);
  /* Multi-part scores (PDMX etc.): every part parsed separately. `parts[0]`
   * is the most melody-like (default view). selectedPartId === 'all' shows
   * every part stacked + plays them together. */
  const [parts, setParts] = useState<ScorePart[]>([{ id: 'P1', name: 'Part 1', data: sampleMelody }]);
  const [selectedPartId, setSelectedPartId] = useState<string>('P1');

  const filteredSongs = useMemo(() => {
    if (songGroup === '__sample__') return [];
    if (songGroup === 'manual') return manualSongs;
    if (songGroup === 'leadsheet') return leadsheetSongs;
    // external → 선택된 데이터셋(collection) 안으로만 좁힌다.
    const coll = externalCollections.find((c) => c.id === externalCollection);
    return coll ? coll.songs : externalSongs;
  }, [songGroup, externalCollection]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  /* key transposition */
  const originalKey = sheet?.key ?? 'C';
  const isMinorKey = /m$/i.test(originalKey);
  const allKeys = isMinorKey ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;
  const [selectedKey, setSelectedKey] = useState(originalKey);

  /* Transposing instrument (global '악보/연주' setting) — shifts only the
   * DISPLAYED key by a fixed interval; selectedKey stays the concert source of
   * truth. Dropdowns edit in WRITTEN terms, so convert picks back to concert. */
  const [instrumentOffset, setInstrumentOffset] = useState(
    () => TRANSPOSING_INSTRUMENT_OFFSET[getPlayerSettings().transposingInstrument],
  );
  useEffect(
    () => subscribePlayerSettings((s) =>
      setInstrumentOffset(TRANSPOSING_INSTRUMENT_OFFSET[s.transposingInstrument])),
    [],
  );
  const writtenKey = shiftNoteKey(selectedKey, instrumentOffset);
  const setWrittenKey = useCallback(
    (k: string) => setSelectedKey(shiftNoteKey(k, -instrumentOffset)),
    [instrumentOffset],
  );

  // Reset key when song changes
  useEffect(() => { setSelectedKey(sheet?.key ?? 'C'); }, [sheet]);

  /* ── melody playback handoff ──────────────────────────────────────────
   *  Playback (count-in, anacrusis pickup, measure/note highlights, player
   *  scheduling) lives inside NoteSheet — we just expose its imperative handle
   *  here so the top transport can drive it. `isPlaying` and `tempo` mirror
   *  NoteSheet's internal state via callback props. */
  const noteSheetRef = useRef<NoteSheetHandle | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState(sampleMelody.tempo ?? 120);
  const [repeatCount, setRepeatCount] = useState(3);  // globalPlayer.setConfig({repeatCount})로 반영(아래 effect).
  const [session, setSession] = useState<SessionInstrument>('piano');

  /* Break Editor (고급 기능) — backing rests while the melody keeps playing.
   * NoteSheet plays through the global player singleton, so we reach the same
   * instance here to push breakBeats. Persisted per-song by songId. */
  const { player: globalPlayer } = useGlobalPlayer();
  // compact에선 MobileChatFab가 패널을 소유 — 데스크톱 패널은 언마운트 (이중
  // 마운트로 인한 이벤트 중복 처리/중복 fetch 방지; ChordPage와 동일 처리).
  const isCompactLayout = useCompactLayout();
  const [breakEditMode, setBreakEditMode] = useState(false);
  const [breakPoints, setBreakPoints] = useState<BreakPoint[]>([]);

  // 곡 전환 commit에서 save effect가 "새 songId + 이전 breakPoints"로 한 번
  // 돌아 이전 곡 데이터를 새 곡 키에 쓰던 오염 가드 (ChordPage와 동일 패턴).
  const persistedBreakSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    setBreakPoints(loadBreakPoints(songId));
    persistedBreakSongIdRef.current = songId;
  }, [songId]);
  useEffect(() => {
    globalPlayer.setConfig({ breakBeats: breakPoints });
    if (persistedBreakSongIdRef.current !== songId) return;
    saveBreakPoints(songId, breakPoints);
  }, [globalPlayer, breakPoints, songId]);

  // RepeatControl → 실제 반복 반영. ChordPage(globalPlayer.setConfig({repeatCount}))와
  // 동일하게 배선 — 이전엔 UI만 있고 재생에 미반영이었다(Fable §4 489). setConfig는
  // 두 엔진(코드/멜로디)에 모두 fan-out되므로 NotePage의 sheet 재생에도 적용된다.
  useEffect(() => {
    globalPlayer.setConfig({ repeatCount });
  }, [globalPlayer, repeatCount]);

  // Stop the GlobalPlayer when this page unmounts — same guard ChordPage has.
  // Without it, navigating away mid-playback left the melody/backing running
  // (engines are app-wide singletons; nothing else stops them on leave).
  useEffect(() => () => { globalPlayer.stop(); }, [globalPlayer]);

  const handleToggleBreak = useCallback((bar: number, clickedBeat: number) => {
    const beatsPerBar = parseInt((sheet?.timeSignature ?? '4/4').split('/')[0], 10) || 4;
    const restStart = clickedBeat + 1;
    setBreakPoints((prev) => {
      if (restStart > beatsPerBar) return prev.filter((p) => p.bar !== bar);
      return toggleBreakPoint(prev, bar, restStart);
    });
  }, [sheet]);
  /* 고급 설정 모달(F3.17) — ChordPage 와 동일. 악보 분석은 코드 분석 필터가
   * 없으므로 filters 를 넘기지 않아 '악기 이조' 탭만 열린다. */

  const handlePlayPause = useCallback(() => {
    noteSheetRef.current?.togglePlay();
  }, []);

  const handleStop = useCallback(() => {
    noteSheetRef.current?.stop();
  }, []);

  const handleShare = useCallback(async () => {
    if (!sheet) return;
    const url = buildNoteShareUrl(sheet);
    if (await tryNativeShare(sheet.title || '악보', url)) return;
    setShareUrl(url);
    setShareModalOpen(true);
  }, [sheet]);

  const handleTempoChange = useCallback((n: number) => {
    noteSheetRef.current?.setTempo(n);
  }, []);

  /* ── measure-range selection (for note-chat) ───────────────────────────
   *  Mirrors ChordPage's chord-selection flow: user toggles selection mode
   *  from the ChatInput, clicks measures on the NoteSheet to build disjoint
   *  ranges, and the selected region's chord progression + notes are sent
   *  with the next LLM question. */
  const [isNoteSelectionMode, setIsNoteSelectionMode] = useState(false);
  const [noteSelectedRanges, setNoteSelectedRanges] = useState<Array<[number, number]>>([]);

  const toggleNoteSelectionMode = useCallback(() => {
    setIsNoteSelectionMode((prev) => {
      const next = !prev;
      if (!next) setNoteSelectedRanges([]);
      return next;
    });
  }, []);

  const clearNoteSelection = useCallback(() => {
    setNoteSelectedRanges([]);
  }, []);

  // Reset selection on song change.
  useEffect(() => {
    setNoteSelectedRanges([]);
    setIsNoteSelectionMode(false);
  }, [sheet?.title]);

  // Transposed sheet data
  const transposedSheet = useMemo(() => {
    if (!sheet) return null;
    if (writtenKey === sheet.key) return sheet;
    return transposeNoteData(sheet, writtenKey);
  }, [sheet, writtenKey]);

  /* Selection-derived data fed into the chat panel. ChordOverlay[] keeps the
   * existing chord-progression UI/serialisation; notesContext is a separate
   * string so the panel can choose to include it only for solo questions. */
  const noteSelectionData = useMemo(() => {
    if (!transposedSheet || noteSelectedRanges.length === 0) {
      return { selectedChords: [] as ChordOverlay[], notesContext: '' };
    }
    return buildNoteSelectionData(transposedSheet, noteSelectedRanges);
  }, [transposedSheet, noteSelectedRanges]);


  /* load selected song */
  useEffect(() => {
    if (songId === SAMPLE_ID) {
      setSheet(sampleMelody);
      setParts([{ id: 'P1', name: 'Part 1', data: sampleMelody }]);
      setSelectedPartId('P1');
      setLoading(false);
      setError(null);
      return;
    }

    const song = noteSongs.find((s) => s.id === songId);
    if (!song) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = await song.loadUrl();
        // XML/MXL → ALL parts (multi-part scores). MIDI/JSON → single synthetic part.
        let loadedParts: ScorePart[];
        if (song.fileType === 'json') {
          const d = await fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }) as NoteSheetData;
          loadedParts = [{ id: 'P1', name: 'Part 1', data: d }];
        } else if (song.fileType === 'midi') {
          const d = await loadMidiMelody(url, song.title, song.composer);
          loadedParts = [{ id: 'P1', name: 'Part 1', data: d }];
        } else if (song.fileType === 'mxl') {
          loadedParts = sortPartsByMelody(await loadMxlParts(url, song.title, song.pianoPerformance ? { pianoPerformance: true } : undefined));
        } else {
          loadedParts = sortPartsByMelody(await loadXmlParts(url, song.title, song.pianoPerformance ? { pianoPerformance: true } : undefined));
        }
        // Manual-clone chord overlay applies to the primary (displayed) part.
        if (song.chordJazzIndex !== undefined && loadedParts[0]) {
          const lead = await getSong(song.chordJazzIndex);
          if (lead) loadedParts = [
            { ...loadedParts[0], data: injectChordsFromLeadSheet(loadedParts[0].data, lead) },
            ...loadedParts.slice(1),
          ];
        }
        if (!cancelled) {
          setParts(loadedParts);
          setSelectedPartId(loadedParts[0]?.id ?? 'P1');
          setSheet(loadedParts[0]?.data ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load song:', err);
          setError(err instanceof Error ? err.message : 'Failed to load song.');
          setSheet(null);
          setParts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [songId]);

  /* Switch displayed part. 'all' shows every part stacked; the displayed
   * staff (sheet) tracks the primary part either way so chat-selection /
   * transpose logic keeps working. */
  const handleSelectPart = useCallback((id: string) => {
    setSelectedPartId(id);
    const p = id === 'all' ? parts[0] : parts.find((x) => x.id === id);
    if (p) setSheet(p.data);
  }, [parts]);

  /* Each part transposed to the current written key (so 전체 보기 shows every
   * part in the same key, and playback merges them consistently). */
  const partsTransposed = useMemo(() =>
    parts.map((p) => ({
      ...p,
      data: p.data.key === writtenKey ? p.data : transposeNoteData(p.data, writtenKey),
    })),
    [parts, writtenKey],
  );

  /* Dropdown options: only for multi-part scores. Prepend "전체 보기". */
  const partOptions = useMemo(() =>
    parts.length > 1
      ? [{ id: 'all', name: '전체 보기' }, ...parts.map((p) => ({ id: p.id, name: p.name }))]
      : [],
    [parts],
  );

  /* In 전체 보기, all non-primary parts sound alongside the primary. */
  const extraPartsForPlay = useMemo(() =>
    selectedPartId === 'all' ? partsTransposed.slice(1).map((p) => p.data) : undefined,
    [selectedPartId, partsTransposed],
  );


  /* resizable right panel */
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [panelTab, setPanelTab] = useState<'mixer' | 'chat'>('chat');

  /* 드래그 중 unmount(빠른 네비게이션)나 창 밖 mouseup 유실 시 window 리스너가
   * 잔존하던 것 — 해제 함수를 ref에 보관해 unmount cleanup에서도 정리한다. */
  const dividerCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { dividerCleanupRef.current?.(); }, []);
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    dividerRef.current?.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setRightPanelWidth(Math.max(180, Math.min(720, startWidth + delta)));
    };
    const onUp = () => {
      dividerRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dividerCleanupRef.current = null;
    };
    dividerCleanupRef.current = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  return (
    <PageContainer>
      <IconSidebar />
      <RightSection>
        <TopToolbar
          title={sheet?.title ?? 'Note'}
          subtitle={sheet ? `${writtenKey} | ${sheet.timeSignature}` : undefined}
          leftExtra={
            <>
              <SongPickerLabel>Note</SongPickerLabel>
              <SongSelect
                value={songGroup}
                onChange={(e) => {
                  const g = e.target.value as SongGroup | '__sample__';
                  setSongGroup(g);
                  if (g === '__sample__') setSongId(SAMPLE_ID);
                  else if (g === 'external') {
                    // 데이터셋 선택은 그대로 두고, 그 안의 첫 곡으로.
                    const coll = externalCollections.find((c) => c.id === externalCollection);
                    const list = coll ? coll.songs : externalSongs;
                    if (list.length > 0) setSongId(list[0].id);
                  } else {
                    const list = g === 'manual' ? manualSongs : leadsheetSongs;
                    if (list.length > 0) setSongId(list[0].id);
                  }
                }}
              >
                <option value="__sample__">Sample</option>
                <option value="manual">Manual</option>
                <option value="leadsheet">Lead Sheet</option>
                <option value="external">External</option>
              </SongSelect>
              {songGroup === 'external' && (
                <SongSelect
                  value={externalCollection}
                  onChange={(e) => {
                    const collId = e.target.value;
                    setExternalCollection(collId);
                    const coll = externalCollections.find((c) => c.id === collId);
                    if (coll && coll.songs.length > 0) setSongId(coll.songs[0].id);
                  }}
                >
                  {externalCollections.map((c) => (
                    <option key={c.id} value={c.id}>{c.label} ({c.songs.length})</option>
                  ))}
                </SongSelect>
              )}
              {songGroup !== '__sample__' && (
                <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
                  {filteredSongs.map((song) => (
                    <option key={song.id} value={song.id}>
                      {song.title} — {song.composer}
                    </option>
                  ))}
                </SongSelect>
              )}
            </>
          }
        />

        <MainArea>
        <CenterColumn>
          <TransportBar>
            <BarLeft>
              <GenreSelect />
              <KeyControl selectedKey={writtenKey} onChange={setWrittenKey} isMinor={/m$/i.test(writtenKey)} />
              <SessionPicker value={session} onChange={setSession} />
            </BarLeft>
            <BarCenter>
              <MetronomeToggle />
              <BpmControl tempo={tempo} onTempoChange={handleTempoChange} disabled={!sheet || loading} />
              <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} disabled={!sheet || loading} />
              <TransportButtons playing={isPlaying} onPlayPause={handlePlayPause} onStop={handleStop} disabled={!sheet || loading} />
            </BarCenter>
            <BarRight>
              <ToolBtn type="button" title="공유" onClick={handleShare} disabled={!sheet || loading}>
                <ShareIcon />
              </ToolBtn>
              <ToolBtn
                type="button"
                title="Editor에서 수정"
                onClick={() => navigate('/editor?mode=solo', sheet ? { state: { prefillSheet: sheet } } : undefined)}
              >
                <PencilIcon />
              </ToolBtn>
              {/* 전구 = 분석 보기 ON/OFF 마스터 토글만. 세부 설정은 톱니 모달.
               * ChordPage(F3.17) 와 동일한 패턴 — 드롭다운 없이 즉시 토글한다. */}
              <ToolBtn
                type="button"
                title={autoHighlight ? '분석 보기 끄기' : '분석 보기 켜기'}
                $lit={autoHighlight}
                onClick={toggleAutoHighlight}
              >
                <LightbulbIcon lit={autoHighlight} />
              </ToolBtn>
              <ToolBtn type="button" title="고급 설정" onClick={() => openPerformanceSettings('transpose')}>
                <GearIcon />
              </ToolBtn>
            </BarRight>
          </TransportBar>

          {transposedSheet && !loading ? (
            selectedPartId === 'all' && partsTransposed.length > 1 ? (
              /* 전체 보기 — every part as its own small independent staff, stacked.
                 The FIRST sheet drives playback (ref) and merges all other parts
                 via extraParts so everything sounds together; the rest are
                 display-only (noPreload). A NotePage-level part picker sits above
                 the stack so the user can switch back to a single part. */
              <AllPartsStack>
                <AllPartsPicker
                  value="all"
                  onChange={(e) => handleSelectPart(e.target.value)}
                >
                  {partOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </AllPartsPicker>
                {partsTransposed.map((p, i) => (
                  <PartScale key={p.id}>
                    <PartScaleLabel>{p.name}</PartScaleLabel>
                    <NoteSheet
                      ref={i === 0 ? noteSheetRef : undefined}
                      data={p.data}
                      forceAutoStem
                      lineStartMeasureNumbers
                      hideTransport
                      noPreload={i !== 0}
                      onPlayingChange={i === 0 ? setIsPlaying : undefined}
                      onTempoChange={i === 0 ? setTempo : undefined}
                      extraParts={i === 0 ? extraPartsForPlay : undefined}
                    />
                  </PartScale>
                ))}
              </AllPartsStack>
            ) : (
            <NoteSheet
              ref={noteSheetRef}
              data={transposedSheet}
              selectedKey={writtenKey}
              allKeys={allKeys}
              onKeyChange={setWrittenKey}
              partOptions={partOptions}
              selectedPartId={selectedPartId}
              onSelectPart={handleSelectPart}
              forceAutoStem
              lineStartMeasureNumbers
              selectable={isNoteSelectionMode}
              selectedRanges={noteSelectedRanges}
              onSelectionChange={setNoteSelectedRanges}
              hideTransport
              onPlayingChange={setIsPlaying}
              onTempoChange={setTempo}
              breakEditMode={breakEditMode}
              breakPoints={breakPoints}
              onToggleBreak={handleToggleBreak}
            />
            )
          ) : (
            <LoadingState>
              {error ?? (loading ? 'Loading...' : 'Loading song list...')}
            </LoadingState>
          )}
        </CenterColumn>

        {!isCompactLayout && <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />}

        {!isCompactLayout && (
        <RightPanelWrapper $width={rightPanelWidth}>
          <PanelTabs>
            <PanelTab type="button" $on={panelTab === 'mixer'} onClick={() => setPanelTab('mixer')}>믹서</PanelTab>
            <PanelTab type="button" $on={panelTab === 'chat'} onClick={() => setPanelTab('chat')}>AI 채팅</PanelTab>
          </PanelTabs>
          {panelTab === 'mixer' ? (
            /* Engine prop is intentionally omitted — backing-chord engine
             *  selection only applies to ChordPage's BackingPlayer, not the
             *  player (melody) that drives NotePage. The volume / reverb /
             *  bass-mode / drum-kit controls all still apply via global
             *  playerSettings, which the player subscribes to. */
            <BackingMixer
              breakEditMode={breakEditMode}
              onToggleBreakEdit={() => setBreakEditMode((v) => !v)}
            />
          ) : (
            <RightChatPanel
              hideHeader
              chartKind="sheet"
              restoreChatId={restoreChatId}
              selectedChords={noteSelectionData.selectedChords}
              groupExplanation={
                noteSelectionData.selectedChords.length > 0
                  ? '이 구간의 코드 진행과 선택한 음표가 다음 질문의 분석 대상으로 포함됩니다.'
                  : null
              }
              songTitle={sheet?.title ?? 'Jazzify AI'}
              isSelectionMode={isNoteSelectionMode}
              onToggleSelectionMode={toggleNoteSelectionMode}
              onClearSelectedChords={clearNoteSelection}
              notesContext={noteSelectionData.notesContext}
            />
          )}
        </RightPanelWrapper>
        )}
        </MainArea>
      </RightSection>

      <MobileChatFab
        songTitle={sheet?.title ?? 'Jazzify AI'}
        chartKind="sheet"
        restoreChatId={restoreChatId}
        selectedChords={noteSelectionData.selectedChords}
        isSelectionMode={isNoteSelectionMode}
        onToggleSelectionMode={toggleNoteSelectionMode}
        onClearSelectedChords={clearNoteSelection}
        notesContext={noteSelectionData.notesContext}
      />

      {shareModalOpen && (
        <ShareLinkModal url={shareUrl} onClose={() => setShareModalOpen(false)} />
      )}

      {/* 고급 설정 — filters 미전달 → '악기 이조' 탭만 표시(악보 분석엔 코드 분석 필터가 없음). */}
    </PageContainer>
  );
}
