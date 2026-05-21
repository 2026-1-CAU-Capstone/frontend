import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { MobileChatFab } from '../components/layout/MobileChatFab';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { SettingsGearButton } from '../components/auth/SettingsGearButton';
import { KeyControl } from '../components/leadsheet/LeadSheet';
import { SessionPicker, type SessionInstrument } from '../components/chord/SessionPicker';
import {
  GenreSelect, MetronomeToggle, BpmControl, RepeatControl, TransportButtons,
  BackingMixer, type EngineBackend,
} from '../components/backing/BackingPlayerBar';
import { createBackingPlayer, leadSheetToChart, type BackingPlayer } from '../lib/backing';
import { createStyBackingPlayer, createHybridBackingPlayer } from '../lib/yamaha-sty';
import { BUILTIN_STYLE, type StyleSelectorChoice } from '../components/yamaha-sty/StyleSelector';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { sampleMelody } from '../data/sampleMelody';
import type { NoteSheetData, MeasureInfo, NoteInfo } from '../data/sampleMelody';
import type { LeadSheetData, LeadSheetChord } from '../data/leadSheetTypes';
import type { ChordOverlay } from '../data/types';
import { noteSongs, externalSongs, manualSongs } from '../data/noteSongs';
import type { SongGroup } from '../data/noteSongs';
import { loadMidiMelody } from '../lib/note/midiMelodyParser';
import { loadXmlMelody, loadMxlMelody } from '../lib/note/xmlMelodyParser';
import { injectChordsFromLeadSheet } from '../lib/note/jazz1460ChordInject';
import { getPlayerSettings, inferPlayStyle, setPlayerSetting, subscribePlayerSettings, TRANSPOSING_INSTRUMENT_OFFSET } from '../lib/note/playerSettings';
import { getSong } from '../lib/ireal/irealLoader';

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
  let pc = NOTE_TO_PC[noteName] ?? 0;
  if (accidental === '#') pc += 1;
  else if (accidental === 'b') pc -= 1;
  pc = ((pc + semitones) % 12 + 12) % 12;

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
        if (newAcc && keySigNotes.has(fullNote)) {
          // Accidental is part of key signature — don't show it explicitly
          finalAcc = undefined;
        } else if (newAcc) {
          finalAcc = { 0: newAcc };
        } else if (!newAcc && (keySigNotes.has(`${noteName}b`) || keySigNotes.has(`${noteName}#`))) {
          // Natural note but key sig has an altered version → need natural sign
          finalAcc = { 0: 'n' };
        }
        return {
          ...n,
          keys: [newKey],
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

/* ─── note sheet → backing chart ─────────────────────────────────────────
 *  ChordPage feeds LeadSheetData straight into leadSheetToChart. NotePage's
 *  native format is a melody sheet whose chords live as display symbols
 *  ("CΔ7", "D-7  G7") per measure. We split those tokens into LeadSheetChord
 *  cells and reuse leadSheetToChart so the backing engine, style detection and
 *  quality mapping stay shared with ChordPage. */
function parseChordToken(token: string): LeadSheetChord | null {
  const t = token.trim();
  if (!t) return null;
  const m = t.match(/^([A-G])([b#]?)(.*)$/);
  if (!m) return null;
  return {
    root: m[1],
    accidental: (m[2] || undefined) as 'b' | '#' | undefined,
    quality: m[3] || undefined,
  };
}

function noteSheetToChart(data: NoteSheetData) {
  const bars = data.measures.map((mm, i) => ({
    measureNumber: i + 1,
    // Double-space separates two chords sharing a bar (e.g. "D-7  G7").
    chords: mm.chord
      ? mm.chord.split(/\s{2,}/).map(parseChordToken).filter((c): c is LeadSheetChord => c != null)
      : [],
  }));
  const lead: LeadSheetData = {
    title: data.title,
    composer: data.composer ?? '',
    style: data.genre ?? '',
    timeSignature: data.timeSignature ?? '4/4',
    key: data.key,
    systems: [{ bars }],
  };
  return leadSheetToChart(lead);
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

const SearchWrap = styled.div`
  position: relative;
`;

const SearchInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 3px 8px 3px 24px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  width: 220px;
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.6; }

  ${mq.mobile} {
    width: 100%;
  }
`;

const SearchIcon = styled.span`
  position: absolute;
  left: 7px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  pointer-events: none;
`;

const SearchResults = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 200;
`;

const SearchItem = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: ${({ $active, theme }) => $active ? theme.colors.bgSecondary : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }
`;

const SearchComposer = styled.span`
  display: block;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.75rem;
  margin-top: 2px;
`;

const CollectionTag = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 4px;
  font-size: 0.72rem;
  opacity: 0.7;
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

const ToolWrap = styled.div`
  position: relative;
  display: inline-flex;
`;

const AnalysisDrop = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 90;
  width: 248px;
  background: #fff;
  border: 1px solid #e6e6e6;
  border-radius: 14px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.2);
  padding: 6px 16px 12px;
  font-family: 'Pretendard', sans-serif;
`;

const ToggleRow = styled.label<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 2px;
  border-top: 1px solid #f0f0f0;
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  opacity: ${({ $disabled }) => ($disabled ? 0.4 : 1)};

  &:first-of-type { border-top: none; }
`;

const ToggleLabel = styled.span`
  font-size: 0.95rem;
  color: #2a2a2a;
`;

const Switch = styled.span<{ $on?: boolean }>`
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: ${({ $on }) => ($on ? '#3b82f6' : '#d4d4d8')};
  transition: background 0.18s;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${({ $on }) => ($on ? '20px' : '2px')};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: left 0.18s;
  }
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
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);
  /* Mirror the toolbar's 분석 보기 toggle into the settings 디스플레이 tab. */
  const displaySettings = useMemo(() => [
    { id: 'autoHighlight', label: '분석 보기', active: autoHighlight, onToggle: toggleAutoHighlight },
  ], [autoHighlight, toggleAutoHighlight]);

  /* song state */
  const [songGroup, setSongGroup] = useState<SongGroup | '__sample__'>('__sample__');
  const [songId, setSongId] = useState(SAMPLE_ID);
  const [sheet, setSheet] = useState<NoteSheetData | null>(sampleMelody);

  const filteredSongs = useMemo(() => {
    if (songGroup === '__sample__') return [];
    return songGroup === 'manual' ? manualSongs : externalSongs;
  }, [songGroup]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  /* ── backing playback (mirrors ChordPage) ──────────────────────────────
   *  NotePage's melody sheet carries chord symbols per measure; noteSheetToChart
   *  turns those into the same Chart the backing engine plays on ChordPage. */
  const playerRef = useRef<BackingPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [repeatCount, setRepeatCount] = useState(3);
  const [tempo, setTempo] = useState(140);
  const [session, setSession] = useState<SessionInstrument>('piano');
  const [engineBackend, setEngineBackend] = useState<EngineBackend>(() => {
    if (typeof window === 'undefined') return 'rule';
    const stored = window.localStorage.getItem('jazzify.engine');
    if (stored === 'sty' || stored === 'hybrid') return stored;
    return 'rule';
  });
  const [styleChoice, setStyleChoice] = useState<StyleSelectorChoice>(BUILTIN_STYLE);
  const [lightMenuOpen, setLightMenuOpen] = useState(false);
  const lightMenuRef = useRef<HTMLDivElement>(null);
  const countIn = useCountInIntro();

  // (Re)create the backing player whenever the loaded sheet / engine changes.
  useEffect(() => {
    if (!sheet) return;
    const chart = noteSheetToChart(sheet);
    setTempo(chart.bpm);
    const inferred = inferPlayStyle(chart.defaultStyle ?? sheet.genre);
    if (inferred && inferred !== getPlayerSettings().style) {
      setPlayerSetting('style', inferred);
    }
    const styOpts = { styleUrl: styleChoice.url, styleData: styleChoice.buffer };
    const player =
      engineBackend === 'sty' ? createStyBackingPlayer(chart, {}, styOpts) :
      engineBackend === 'hybrid' ? createHybridBackingPlayer(chart, {}, styOpts) :
      createBackingPlayer(chart);
    player.on('onDone', () => setIsPlaying(false));
    playerRef.current = player;
    void player.preload().catch(() => { /* retried at play time */ });
    return () => {
      player.dispose();
      playerRef.current = null;
      setIsPlaying(false);
    };
  }, [sheet, engineBackend, styleChoice]);

  // Push tempo changes into the live player config.
  useEffect(() => {
    playerRef.current?.setConfig({ bpm: tempo });
  }, [tempo]);

  const handlePlayPause = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying || countIn.active) {
      if (isPlaying) player.pause();
      countIn.cancel();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    player.setConfig({ repeatCount });
    const preload = player.preload();
    const cin = await countIn.run({ bpm: tempo });
    if (!cin.ok) { setIsPlaying(false); return; }
    try {
      await preload;
      await player.play({ startAt: player.ctxNow() + cin.downbeatInSec });
    } catch (err) {
      console.error('[backing] play failed:', err);
      setIsPlaying(false);
    }
  }, [isPlaying, tempo, countIn, repeatCount]);

  const handleStop = useCallback(() => {
    playerRef.current?.stop();
    countIn.cancel();
    setIsPlaying(false);
  }, [countIn]);

  // Close the analysis (lightbulb) dropdown on outside click.
  useEffect(() => {
    if (!lightMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (lightMenuRef.current && !lightMenuRef.current.contains(e.target as Node)) {
        setLightMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [lightMenuOpen]);

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

  /* search state */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  /* load selected song */
  useEffect(() => {
    if (songId === SAMPLE_ID) {
      setSheet(sampleMelody);
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
        let data =
          song.fileType === 'json'
            ? await fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }) as NoteSheetData
            : song.fileType === 'midi'
              ? await loadMidiMelody(url, song.title, song.composer)
              : song.fileType === 'mxl'
                ? await loadMxlMelody(url, song.title)
                : await loadXmlMelody(url, song.title);
        if (song.chordJazzIndex !== undefined) {
          const lead = await getSong(song.chordJazzIndex);
          if (lead) data = injectChordsFromLeadSheet(data, lead);
        }
        if (!cancelled) setSheet(data);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load song:', err);
          setError(err instanceof Error ? err.message : 'Failed to load song.');
          setSheet(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [songId]);

  /* search filter */
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const pool = songGroup === '__sample__' ? noteSongs : filteredSongs;
    return pool
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery, songGroup, filteredSongs]);

  /* close search on outside click */
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  /* resizable right panel */
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [panelTab, setPanelTab] = useState<'mixer' | 'chat'>('chat');

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
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  return (
    <PageContainer>
      {countIn.overlay}
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
                  else {
                    const list = g === 'manual' ? manualSongs : externalSongs;
                    if (list.length > 0) setSongId(list[0].id);
                  }
                }}
              >
                <option value="__sample__">Sample</option>
                <option value="manual">Manual</option>
                <option value="external">External</option>
              </SongSelect>
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
          rightExtra={
            <SearchWrap ref={searchRef}>
              <SearchIcon>&#128269;</SearchIcon>
              <SearchInput
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
              {searchOpen && searchQuery.trim() && (
                <SearchResults>
                  {searchResults.length === 0 ? (
                    <SearchItem as="div">No results</SearchItem>
                  ) : (
                    searchResults.map((song) => (
                      <SearchItem
                        key={song.id}
                        onClick={() => {
                          setSongGroup(song.group);
                          setSongId(song.id);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        {song.title}
                        <SearchComposer>{song.composer}</SearchComposer>
                        <CollectionTag>[{song.collection}]</CollectionTag>
                      </SearchItem>
                    ))
                  )}
                </SearchResults>
              )}
            </SearchWrap>
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
              <BpmControl tempo={tempo} onTempoChange={setTempo} disabled={!sheet || loading} />
              <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} disabled={!sheet || loading} />
              <TransportButtons playing={isPlaying} onPlayPause={handlePlayPause} onStop={handleStop} disabled={!sheet || loading} />
            </BarCenter>
            <BarRight>
              <ToolBtn type="button" title="공유" onClick={() => {/* TODO: 공유 기능 */}}>
                <ShareIcon />
              </ToolBtn>
              <ToolBtn type="button" title="Editor에서 수정" onClick={() => navigate('/editor?mode=solo')}>
                <PencilIcon />
              </ToolBtn>
              <ToolWrap ref={lightMenuRef}>
                <ToolBtn
                  type="button"
                  title="분석 보기"
                  $lit={autoHighlight}
                  onClick={() => setLightMenuOpen((v) => !v)}
                >
                  <LightbulbIcon lit={autoHighlight} />
                </ToolBtn>
                {lightMenuOpen && (
                  <AnalysisDrop>
                    <ToggleRow onClick={toggleAutoHighlight}>
                      <ToggleLabel style={{ fontWeight: 700 }}>분석 보기</ToggleLabel>
                      <Switch $on={autoHighlight} />
                    </ToggleRow>
                  </AnalysisDrop>
                )}
              </ToolWrap>
              <SettingsGearButton displaySettings={displaySettings} />
            </BarRight>
          </TransportBar>

          {transposedSheet && !loading ? (
            <NoteSheet
              data={transposedSheet}
              selectedKey={writtenKey}
              allKeys={allKeys}
              onKeyChange={setWrittenKey}
              forceAutoStem
              lineStartMeasureNumbers
              selectable={isNoteSelectionMode}
              selectedRanges={noteSelectedRanges}
              onSelectionChange={setNoteSelectedRanges}
            />
          ) : (
            <LoadingState>
              {error ?? (loading ? 'Loading...' : 'Loading song list...')}
            </LoadingState>
          )}
        </CenterColumn>

        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />

        <RightPanelWrapper $width={rightPanelWidth}>
          <PanelTabs>
            <PanelTab type="button" $on={panelTab === 'mixer'} onClick={() => setPanelTab('mixer')}>믹서</PanelTab>
            <PanelTab type="button" $on={panelTab === 'chat'} onClick={() => setPanelTab('chat')}>AI 채팅</PanelTab>
          </PanelTabs>
          {panelTab === 'mixer' ? (
            <BackingMixer
              engine={{
                backend: engineBackend,
                onBackendChange: (b) => {
                  setEngineBackend(b);
                  window.localStorage.setItem('jazzify.engine', b);
                },
                styleChoice,
                onStyleChange: setStyleChoice,
              }}
            />
          ) : (
            <RightChatPanel
              hideHeader
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
        </MainArea>
      </RightSection>

      <MobileChatFab
        songTitle={sheet?.title ?? 'Jazzify AI'}
        selectedChords={noteSelectionData.selectedChords}
        isSelectionMode={isNoteSelectionMode}
        onToggleSelectionMode={toggleNoteSelectionMode}
        onClearSelectedChords={clearNoteSelection}
        notesContext={noteSelectionData.notesContext}
      />
    </PageContainer>
  );
}
