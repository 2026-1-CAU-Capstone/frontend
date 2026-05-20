import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { MobileChatFab } from '../components/layout/MobileChatFab';
import { LeadSheet, KeyControl, isMinorKey, shiftKey } from '../components/leadsheet/LeadSheet';
import { SessionPicker, type SessionInstrument } from '../components/chord/SessionPicker';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { allOfMe } from '../data/allOfMe';
import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordOverlay } from '../data/types';
import { getSongIndex, getSong, type SongEntry } from '../lib/ireal/irealLoader';
import { buildChordContext } from '../api/chordContext';
import { createBackingPlayer, leadSheetToChart, type BackingPlayer } from '../lib/backing';
import { createStyBackingPlayer, createHybridBackingPlayer } from '../lib/yamaha-sty';
import { BUILTIN_STYLE, type StyleSelectorChoice } from '../components/yamaha-sty/StyleSelector';
import { getPlayerSettings, inferPlayStyle, setPlayerSetting, subscribePlayerSettings, TRANSPOSING_INSTRUMENT_OFFSET } from '../lib/note/playerSettings';
import { GenreSelect, MetronomeToggle, BpmControl, RepeatControl, TransportButtons, BackingMixer, type EngineBackend } from '../components/backing/BackingPlayerBar';
import { withLeadSheetSelectionIds } from '../lib/leadSheetSelection';
import type { LeadSheetChordSelection } from '../components/leadsheet/LeadSheet';
import { loadUserLicksSync } from '../data/lickData';
import { findMatchingLicks, type LickMatch } from '../lib/lickMatcher';
import { SavedLicksModal } from '../components/leadsheet/SavedLicksModal';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { parseChordInput, loadChartEdit, saveChartEdit } from '../lib/leadSheetChordEdit';

const ANALYZED_SONG_ID = '__analyzed_all-of-me__';

/* Rule-based analysis is forced off while editing the chart. */
const ANALYSIS_OFF = {
  showAnalysis: false, showDegree: false, showIIVI: false, showArrows: false, showColors: false,
} as const;

const SELECTION_QUALITY_PREFIXES: [RegExp, string][] = [
  [/^(-7b5|-7\(b5\)|m7b5|m7♭5)/, 'ø7'],
  [/^h(?=\d)/, 'ø'],
  [/^h$/, 'ø'],
  [/^(dim7|o7|°7)/, '°7'],
  [/^(dim|o|°)(?!\d)/, '°'],
  [/^(-[Mm]aj7|-△7|-Δ7|-\^7|m[Mm]aj7|mM7)/, '-△7'],
  [/^(Δ7|△7|\^7|[Mm]aj7|M7)/, '△7'],
  [/^(Δ|△|\^|[Mm]aj(?!7)|M(?=[69]|$))/, '△'],
  [/^(-7(?!b5)|m7(?!b5)|min7)/, '-7'],
  [/^(-9|m9|min9)/, '-9'],
  [/^(-11|m11|min11)/, '-11'],
  [/^(-6|m6|min6)/, '-6'],
  [/^(-|m(?!aj|7|9|11|6|in)|min(?!7|9|11|6))/, '-'],
];

function normalizeSelectionQuality(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, replacement] of SELECTION_QUALITY_PREFIXES) {
    const match = trimmed.match(re);
    if (match) {
      return `${replacement}${trimmed.slice(match[0].length)}`.replace(/b/g, '♭').replace(/#/g, '♯');
    }
  }
  return trimmed.replace(/b/g, '♭').replace(/#/g, '♯');
}

function formatChordForSelection(chord: LeadSheetChordSelection['chord']): string {
  const accidental = chord.accidental === '#' ? '♯' : chord.accidental === 'b' ? '♭' : '';
  const quality = chord.quality ? normalizeSelectionQuality(chord.quality) : '';
  const bass = chord.bass
    ? `/${chord.bass.root}${chord.bass.accidental === '#' ? '♯' : chord.bass.accidental === 'b' ? '♭' : ''}`
    : '';
  return `${chord.root ?? ''}${accidental}${quality}${bass}` || '(empty)';
}

function selectionToOverlay(target: LeadSheetChordSelection): ChordOverlay {
  const fn = target.chord.analysis?.functions?.[0]?.function;
  const safeFunc: ChordOverlay['analysis']['func'] = fn === 'SD' || fn === 'D' ? fn : 'T';

  return {
    id: target.id,
    symbol: formatChordForSelection(target.chord),
    bar: target.measureNumber,
    pageNumber: 1,
    position: { x: 0, y: 0, width: 0, height: 0 },
    analysis: {
      degree: target.chord.analysis?.degree || '',
      func: safeFunc,
      diatonic: target.chord.analysis?.isDiatonic ?? target.chord.isDiatonic ?? true,
      secDom: target.chord.analysis?.secondaryDominant?.label,
      modal: target.chord.analysis?.modalInterchange?.borrowedDegree,
    },
  };
}

function uniqueOverlays(overlays: ChordOverlay[]): ChordOverlay[] {
  const seen = new Set<string>();
  return overlays.filter((overlay) => {
    if (seen.has(overlay.id)) return false;
    seen.add(overlay.id);
    return true;
  });
}

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
  /* Positioning context for the absolutely-placed BackingPlayerBar so it
   * anchors to the score section's bottom-left, not the viewport. */
  position: relative;
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
  /* Positioning context for the BackingPlayerBar dock so it spans only the
   * score column (not the chat panel on the right). */
  position: relative;
`;

/* White transport bar above the lead sheet (BPM/repeat/transport on the left,
 * key dropdown centered). Zoom & fullscreen stay inside the sheet. */
const TransportBar = styled.div`
  position: relative;
  /* Lift the bar (and therefore its dropdowns) above the lead sheet, which is
   * a later sibling and would otherwise paint over the open menus. */
  z-index: 60;
  display: flex;
  align-items: center;
  padding: 5px 14px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

/* Second toolbar row shown only in edit mode — the chord "modify tool".
 * For now it just holds the Save button. */
const EditBar = styled.div`
  position: relative;
  z-index: 59;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 14px;
  background: #fff7e6;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const EditBarLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  font-weight: 500;
  color: #9a6b00;
`;

const EditSaveBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: #fff;
  background: #1f9a52;
  border: none;
  border-radius: 7px;
  padding: 7px 18px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #18803f; }
`;

const BarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const BarCenter = styled.div`
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
`;

/* Right-aligned tool icons (share / edit / analysis / settings). */
const BarRight = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
`;

const ToolBtn = styled.button<{ $lit?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: ${({ $lit }) => ($lit ? '#e8a838' : '#5b5b5b')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  ${({ $lit }) => $lit && 'filter: drop-shadow(0 0 4px rgba(232, 168, 56, 0.55));'}

  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

/* Lightbulb popover — analysis master toggle + sub-filters. */
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

/* ─── tool icons (Lucide, 24×24 stroke) ───────────────────────────────── */
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

const GearIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

/* ─── settings modal (analysis sub-filters) ───────────────────────────── */
const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
`;

const ModalCard = styled.div`
  width: 340px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  padding: 22px 24px 24px;
  font-family: 'Pretendard', sans-serif;
`;

const ModalTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 1.1rem;
  font-weight: 700;
  color: #1a1a1a;
`;

const ModalSub = styled.p`
  margin: 0 0 16px;
  font-size: 0.82rem;
  color: #888;
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

/* "iRealPro 1460" label — now lives in the toolbar's leftExtra slot. */
const SongPickerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

const SongSelect = styled.select`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  max-width: 320px;
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

/* Tab strip splitting the right panel into 믹서 / AI 채팅. Sits right under
 * the always-visible BackingTransport. */
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

export default function ChordPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, effective, toggleFilter } = useAnalysisFilters();
  const [songIndex, setSongIndex] = useState<SongEntry[]>([]);
  const [songId, setSongIdRaw] = useState(() => searchParams.get('song') ?? ANALYZED_SONG_ID);

  const setSongId = useCallback((id: string) => {
    setSongIdRaw(id);
    if (id === ANALYZED_SONG_ID) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ song: id }, { replace: true });
    }
  }, [setSearchParams]);
  const [sheet, setSheet] = useState<LeadSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  /* Chord-chart edit mode (frontend-only; no per-user backend yet). Edits are
   * collected by source index ("system-bar-chord") and applied on save. */
  const [editMode, setEditMode] = useState(false);
  const editValuesRef = useRef<Map<string, string>>(new Map());

  const playerRef = useRef<BackingPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  /* How many times Play repeats the chart before stopping (default 3). */
  const [repeatCount, setRepeatCount] = useState(3);
  const [tempo, setTempo] = useState(140);
  const [engineBackend, setEngineBackend] = useState<EngineBackend>(() => {
    if (typeof window === 'undefined') return 'rule';
    const stored = window.localStorage.getItem('jazzify.engine');
    if (stored === 'sty' || stored === 'hybrid') return stored;
    return 'rule';
  });
  const [styleChoice, setStyleChoice] = useState<StyleSelectorChoice>(BUILTIN_STYLE);
  const [activeBar, setActiveBar] = useState(-1);
  const [selectedChordIds, setSelectedChordIds] = useState<string[]>([]);
  const [selectedChordsData, setSelectedChordsData] = useState<ChordOverlay[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const [lightMenuOpen, setLightMenuOpen] = useState(false);
  // ★ 저장된 릭 있는 마디 번호 세트
  const [savedLickBarNums, setSavedLickBarNums] = useState<Set<number>>(new Set());
  const [savedLicksModal, setSavedLicksModal] = useState<{ label: string; matches: LickMatch[] } | null>(null);
  const analysisMenuRef = useRef<HTMLDivElement>(null);
  const lightMenuRef = useRef<HTMLDivElement>(null);

  const handleChordClick = (_chord: any, _measureNumber: number, target?: LeadSheetChordSelection) => {
    if (!isSelectionMode) return;
    if (!target) return;
    const overlay = selectionToOverlay(target);
    setSelectedChordIds([overlay.id]);
    setSelectedChordsData([overlay]);
  };

  const [selectionBubblePos, setSelectionBubblePos] = useState<{ x: number; y: number } | null>(null);

  const handleChordRangeSelect = (targets: LeadSheetChordSelection[], pos?: { x: number; y: number }) => {
    if (!isSelectionMode) return;
    const overlays = uniqueOverlays(targets.map(selectionToOverlay));
    setSelectedChordIds(overlays.map((chord) => chord.id));
    setSelectedChordsData(overlays);
    if (pos && overlays.length > 0) {
      setSelectionBubblePos({ x: pos.x, y: pos.y });
    } else {
      setSelectionBubblePos(null);
    }
  };

  const toggleSelectionMode = () => {
    const nextMode = !isSelectionMode;
    setIsSelectionMode(nextMode);
    if (!nextMode) {
      setSelectedChordIds([]);
      setSelectedChordsData([]);
    }
  };

  const clearSelectedChords = useCallback(() => {
    setSelectedChordIds([]);
    setSelectedChordsData([]);
  }, []);

  useEffect(() => {
    setSelectedChordIds([]);
    setSelectedChordsData([]);
  }, [sheet?.id]);

  // Mixer state (volumes, drumKit, reverb, bassMode) lives in the global
  // playerSettings store — BackingPlayer subscribes directly, so this page
  // doesn't need to mirror or push those values. Only page-local state
  // (the chart, tempo) is owned here.

  // Load song index on mount
  useEffect(() => {
    getSongIndex().then(setSongIndex).catch(() => {});
  }, []);

  // (Re)create backing player whenever the loaded sheet changes. The player
  // hydrates from the global mixer store on construction so we don't need
  // to pass volumes/kit/reverb explicitly.
  useEffect(() => {
    if (!sheet) return;
    const chart = leadSheetToChart(sheet);
    setTempo(chart.bpm);
    setActiveBar(-1);
    // Auto-pick rhythm style from the chart — bossa charts default to bossa,
    // everything else swing. chart.defaultStyle comes from the iReal style
    // string (e.g. "Bossa Nova" → 'bossa', "Medium Swing" → 'medium-swing').
    const inferred = inferPlayStyle(chart.defaultStyle ?? sheet.style);
    if (inferred && inferred !== getPlayerSettings().style) {
      setPlayerSetting('style', inferred);
    }
    const styOpts = { styleUrl: styleChoice.url, styleData: styleChoice.buffer };
    const player =
      engineBackend === 'sty' ? createStyBackingPlayer(chart, {}, styOpts) :
      engineBackend === 'hybrid' ? createHybridBackingPlayer(chart, {}, styOpts) :
      createBackingPlayer(chart);
    player.on('onBar', (bar) => setActiveBar(bar));
    player.on('onDone', () => setIsPlaying(false));
    playerRef.current = player;
    // Warm up the audio context + instrument/drum samples in the background
    // the moment the player exists, so the FIRST Play doesn't stall after the
    // count-in waiting on the (network + decode) load. preload is idempotent
    // (ensure-cached / preloadPromise), so the play-time preload() resolves
    // instantly once this finishes — fixing the "1234 … long pause … sound"
    // first-play delay. Later plays already hit cache.
    void player.preload().catch(() => { /* will retry at play time */ });
    return () => {
      player.dispose();
      playerRef.current = null;
      setIsPlaying(false);
      setActiveBar(-1);
    };
  }, [sheet, engineBackend, styleChoice]);

  // Push tempo changes into the live player config (per-page state, not global)
  useEffect(() => {
    playerRef.current?.setConfig({ bpm: tempo });
  }, [tempo]);

  const countIn = useCountInIntro();

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
    // 카운트인과 병렬로 instruments + drum 자원 로드 — 첫 재생 지연 제거.
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
    setActiveBar(-1);
  }, [countIn]);

  // Load selected song
  useEffect(() => {
    if (songId === ANALYZED_SONG_ID) {
      setSheet(loadChartEdit(songId) ?? withLeadSheetSelectionIds(allOfMe, ANALYZED_SONG_ID));
      setLoading(false);
      setError(null);
      return;
    }

    const idx = parseInt(songId, 10);
    if (isNaN(idx)) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getSong(idx).then((data) => {
      if (cancelled) return;
      if (data) {
        setSheet(loadChartEdit(songId) ?? data);
      } else {
        setError('Song not found.');
        setSheet(null);
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load song.');
        setSheet(null);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [songId]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return songIndex
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery, songIndex]);

  // Close search on outside click
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

  useEffect(() => {
    if (!analysisMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (analysisMenuRef.current && !analysisMenuRef.current.contains(e.target as Node)) {
        setAnalysisMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [analysisMenuOpen]);

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

  const chordContext = useMemo(() => {
    if (sheet) return buildChordContext(sheet);
    return undefined;
  }, [sheet]);

  // B안: 저장된 릭이 있는 ii-V-I 시작 마디 감지
  // sheet가 바뀌거나 저장 릭이 바뀌면 재계산 (jazzify:lickSaved 이벤트로 갱신)
  const refreshSavedLickBars = useCallback(() => {
    if (!sheet) { setSavedLickBarNums(new Set()); return; }
    const saved = loadUserLicksSync();
    if (saved.length === 0) { setSavedLickBarNums(new Set()); return; }
    const keyMatch = chordContext?.match(/Key:\s*([A-G][b#]?)/);
    const songKey = keyMatch ? keyMatch[1] : 'C';
    const barNums = new Set<number>();

    // 모든 (chord, barNum) pair를 한 번에 평탄화 — groupId로 묶어서 ii-V-I 전체 진행을 모음
    const flat: { chord: NonNullable<typeof sheet.systems[0]['bars'][0]['chords'][0]>; barNum: number }[] = [];
    for (const system of sheet.systems) {
      for (const bar of system.bars) {
        for (const c of bar.chords) {
          if (c) flat.push({ chord: c, barNum: bar.measureNumber ?? 0 });
        }
      }
    }

    // groupId → [chords in that ii-V-I group] (role 순서: ii → V → I)
    const byGroup = new Map<number, { chord: typeof flat[0]['chord']; barNum: number; role: string }[]>();
    for (const fc of flat) {
      const memberships = fc.chord.analysis?.groupMemberships ?? [];
      for (const g of memberships) {
        if (g.groupType !== 'ii-V-I' || g.variant === 'incomplete') continue;
        if (!byGroup.has(g.groupId)) byGroup.set(g.groupId, []);
        byGroup.get(g.groupId)!.push({ ...fc, role: g.role });
      }
    }

    for (const group of byGroup.values()) {
      // role 순서대로 정렬: ii → V → I/i
      const ROLE_ORDER: Record<string, number> = { ii: 0, V: 1, I: 2, i: 2 };
      group.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
      if (group.length === 0) continue;
      const overlays = group.map(({ chord, barNum }) => ({
        id: String(barNum) + '-' + (chord.root ?? ''),
        symbol: `${chord.root ?? ''}${chord.quality ?? ''}`,
        bar: barNum,
        pageNumber: 1,
        position: { x: 0, y: 0, width: 0, height: 0 },
        analysis: { degree: '', func: 'SD' as const, diatonic: true },
      }));
      const matches = findMatchingLicks(overlays, sheet.title, songKey, saved, 1);
      if (matches.length > 0) {
        // ii 코드가 있는 첫 bar에 뱃지 표시
        const iiBarNum = group.find((g) => g.role === 'ii')?.barNum ?? group[0].barNum;
        barNums.add(iiBarNum);
      }
    }
    setSavedLickBarNums(barNums);
  }, [sheet, chordContext]);

  useEffect(() => { refreshSavedLickBars(); }, [refreshSavedLickBars]);
  useEffect(() => {
    const handler = () => refreshSavedLickBars();
    window.addEventListener('jazzify:lickSaved', handler);
    return () => window.removeEventListener('jazzify:lickSaved', handler);
  }, [refreshSavedLickBars]);

  const [rightPanelWidth, setRightPanelWidth] = useState(515);
  /* Right panel view: mixer (player controls) vs AI chat. */
  const [panelTab, setPanelTab] = useState<'mixer' | 'chat'>('chat');
  /* Transpose key, lifted out of LeadSheet so the player transport owns it. */
  const chartOriginalKey = sheet?.key ?? 'C';
  const [chartKey, setChartKey] = useState(chartOriginalKey);
  useEffect(() => { setChartKey(sheet?.key ?? 'C'); }, [sheet?.key]);

  /* Transposing instrument (global '악보/연주' setting) — shifts only the
   * DISPLAYED chart/key by a fixed interval; chartKey stays the concert source
   * of truth so backing playback is unaffected. The key dropdown/transport edit
   * in WRITTEN terms, so convert picks back to concert. */
  const [instrumentOffset, setInstrumentOffset] = useState(
    () => TRANSPOSING_INSTRUMENT_OFFSET[getPlayerSettings().transposingInstrument],
  );
  useEffect(
    () => subscribePlayerSettings((s) =>
      setInstrumentOffset(TRANSPOSING_INSTRUMENT_OFFSET[s.transposingInstrument])),
    [],
  );
  const writtenKey = shiftKey(chartKey, instrumentOffset);
  const setWrittenKey = useCallback(
    (k: string) => setChartKey(shiftKey(k, -instrumentOffset)),
    [instrumentOffset],
  );

  /* Enter/leave chord-chart edit mode. Entering clears any pending edits;
   * leaving via the pencil discards them (Save is the only commit path). */
  const toggleEditMode = useCallback(() => {
    editValuesRef.current.clear();
    setEditMode((on) => !on);
  }, []);

  const handleChordEdit = useCallback(
    (systemIndex: number, barIndex: number, chordIndex: number, value: string) => {
      editValuesRef.current.set(`${systemIndex}-${barIndex}-${chordIndex}`, value);
    },
    [],
  );

  const handleSaveEdit = useCallback(() => {
    if (!sheet) return;
    const next: LeadSheetData = structuredClone(sheet);
    editValuesRef.current.forEach((value, key) => {
      const [s, b, c] = key.split('-').map(Number);
      const chord = next.systems[s]?.bars[b]?.chords[c];
      if (!chord) return;
      next.systems[s].bars[b].chords[c] = { ...parseChordInput(value), id: chord.id };
    });
    setSheet(next);
    saveChartEdit(songId, next);
    editValuesRef.current.clear();
    setEditMode(false);
  }, [sheet, songId]);

  /* Which instrument the player is using this chart with. Display-only for now;
   * instrument-specific behaviours (vocal lyrics, sax transpose, drum sections)
   * come later. */
  const [session, setSession] = useState<SessionInstrument>('piano');
  const dividerRef = useRef<HTMLDivElement>(null);

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
    <PageContainer onClick={() => setSelectionBubblePos(null)}>
      {countIn.overlay}
      <IconSidebar />
      <RightSection>
        <TopToolbar
          title={sheet?.title ?? `iRealPro ${songIndex.length || '...'}`}
          subtitle={sheet ? `${(sheet.key ?? '?').replace(/-$/, 'm')} | ${sheet.timeSignature}` : undefined}
          leftExtra={
            <>
              <SongPickerLabel>iRealPro {songIndex.length || '...'}</SongPickerLabel>
              <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
                <option value={ANALYZED_SONG_ID}>All of Me (Analyzed)</option>
                {songIndex.map((song) => (
                  <option key={song.index} value={String(song.index)}>
                    {song.title} -- {song.composer}
                  </option>
                ))}
              </SongSelect>
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
                        key={song.index}
                        onClick={() => {
                          setSongId(String(song.index));
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        {song.title}
                        <SearchComposer>{song.composer}</SearchComposer>
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
          {/* White transport bar above the sheet (zoom/fullscreen stay inside
           *  the sheet at top-right). */}
          <TransportBar>
            <BarLeft>
              <GenreSelect />
              <KeyControl selectedKey={writtenKey} onChange={setWrittenKey} isMinor={isMinorKey(writtenKey)} />
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
              <ToolBtn
                type="button"
                title={editMode ? '수정 종료' : '직접 수정'}
                $lit={editMode}
                onClick={toggleEditMode}
              >
                <PencilIcon />
              </ToolBtn>
              <ToolWrap ref={lightMenuRef}>
                <ToolBtn
                  type="button"
                  title="분석 보기"
                  $lit={filters.showAnalysis}
                  onClick={() => setLightMenuOpen((v) => !v)}
                >
                  <LightbulbIcon lit={filters.showAnalysis} />
                </ToolBtn>
                {lightMenuOpen && (
                  <AnalysisDrop>
                    <ToggleRow onClick={() => toggleFilter('showAnalysis')}>
                      <ToggleLabel style={{ fontWeight: 700 }}>분석 보기</ToggleLabel>
                      <Switch $on={filters.showAnalysis} />
                    </ToggleRow>
                    {([
                      { key: 'showDegree', label: '도수 표시' },
                      { key: 'showIIVI', label: '2-5-1 하이라이트' },
                      { key: 'showArrows', label: '해결 화살표' },
                      { key: 'showColors', label: '비화성음 · 모달 색상' },
                    ] as const).map(({ key, label }) => (
                      <ToggleRow
                        key={key}
                        $disabled={!filters.showAnalysis}
                        onClick={() => filters.showAnalysis && toggleFilter(key)}
                      >
                        <ToggleLabel>{label}</ToggleLabel>
                        <Switch $on={filters.showAnalysis && filters[key]} />
                      </ToggleRow>
                    ))}
                  </AnalysisDrop>
                )}
              </ToolWrap>
              <ToolBtn type="button" title="분석 설정" onClick={() => setAnalysisMenuOpen(true)}>
                <GearIcon />
              </ToolBtn>
            </BarRight>
          </TransportBar>

          {editMode && (
            <EditBar>
              <EditBarLabel>코드 수정 모드 — 코드를 클릭해 직접 수정하세요</EditBarLabel>
              <EditSaveBtn type="button" onClick={handleSaveEdit}>저장</EditSaveBtn>
            </EditBar>
          )}

          {sheet && !loading ? (
            <LeadSheet
              data={sheet}
              analysisFilters={editMode ? ANALYSIS_OFF : effective}
              selectedKey={editMode ? chartOriginalKey : writtenKey}
              editMode={editMode}
              onChordEdit={handleChordEdit}
              activeBar={activeBar}
              onChordClick={handleChordClick}
              onChordRangeSelect={handleChordRangeSelect}
              selectedChordIds={selectedChordIds}
              selectionMode={!editMode && isSelectionMode}
              savedLickBarNums={savedLickBarNums.size > 0 ? savedLickBarNums : undefined}
              onSavedLickBadgeClick={(barNum, spanLabel) => {
                const saved = loadUserLicksSync();
                if (saved.length === 0) { setSavedLicksModal({ label: spanLabel, matches: [] }); return; }
                const keyMatch = chordContext?.match(/Key:\s*([A-G][b#]?)/);
                const songKey = keyMatch ? keyMatch[1] : 'C';
                if (!sheet) return;

                // spanLabel 예: "C Major 2-5-1" / "F minor 2-5-1" → 토닉 + 모드 추출
                const labelMatch = spanLabel.match(/^([A-G][b#]?)\s+(Major|minor)/i);
                const NOTE_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const PC_TO_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
                const PC_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const useFlats = (pc: number) => [0,5,10,3,8,1,6].includes(pc);
                const pcToName = (pc: number) => (useFlats(pc) ? PC_TO_FLAT : PC_TO_SHARP)[pc];

                let overlays: ChordOverlay[];
                if (labelMatch) {
                  const tonicRoot = labelMatch[1];
                  const isMinor = labelMatch[2].toLowerCase() === 'minor';
                  const tonicLetter = tonicRoot[0].toUpperCase() as keyof typeof NOTE_TO_PC;
                  const acc = tonicRoot[1];
                  let tonicPc = NOTE_TO_PC[tonicLetter] ?? 0;
                  if (acc === 'b') tonicPc = (tonicPc - 1 + 12) % 12;
                  else if (acc === '#') tonicPc = (tonicPc + 1) % 12;

                  const iiPc = (tonicPc + 2) % 12;
                  const vPc  = (tonicPc + 7) % 12;
                  const iiSym = `${pcToName(iiPc)}${isMinor ? 'ø7' : '-7'}`;
                  const vSym  = `${pcToName(vPc)}7`;
                  const iSym  = `${pcToName(tonicPc)}${isMinor ? '-7' : '△7'}`;

                  const mk = (id: string, sym: string): ChordOverlay => ({
                    id, symbol: sym, bar: barNum, pageNumber: 1,
                    position: { x: 0, y: 0, width: 0, height: 0 },
                    analysis: { degree: '', func: 'SD', diatonic: true },
                  });
                  overlays = [mk(`${barNum}-ii`, iiSym), mk(`${barNum}-v`, vSym), mk(`${barNum}-i`, iSym)];
                } else {
                  // fallback: 라벨 파싱 실패 시 기존 동작 (bar 첫 코드)
                  const bar = sheet.systems.flatMap((s) => s.bars).find((b) => b.measureNumber === barNum);
                  const firstChord = bar?.chords[0];
                  if (!firstChord) return;
                  overlays = [{
                    id: String(barNum),
                    symbol: `${firstChord.root ?? ''}${firstChord.quality ?? ''}`,
                    bar: barNum, pageNumber: 1,
                    position: { x: 0, y: 0, width: 0, height: 0 },
                    analysis: { degree: '', func: 'SD', diatonic: true },
                  }];
                }

                const all = findMatchingLicks(overlays, sheet.title, songKey, saved, 50);
                // tier 3은 임의 전조 결과라 제외, tier 1/2만 표시 (없으면 전체)
                const direct = all.filter((m) => m.tier <= 2);
                setSavedLicksModal({ label: spanLabel, matches: direct.length > 0 ? direct : all });
              }}
            />
          ) : (
            <LoadingState>{error ?? (loading ? 'Loading chart...' : 'Loading song list...')}</LoadingState>
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
            selectedChords={selectedChordsData}
            groupExplanation={selectedChordsData.length > 0 ? "이 구간이 다음 질문의 분석 대상으로 포함됩니다." : null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
            chordContext={chordContext}
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={toggleSelectionMode}
            onClearSelectedChords={clearSelectedChords}
            songTempo={tempo}
          />
          )}
        </RightPanelWrapper>
        </MainArea>
      </RightSection>

      <MobileChatFab
        selectedChords={selectedChordsData}
        groupExplanation={selectedChordsData.length > 0 ? "이 구간이 다음 질문의 분석 대상으로 포함됩니다." : null}
        songTitle={sheet?.title ?? 'Jazzify AI'}
        chordContext={chordContext}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={toggleSelectionMode}
        onClearSelectedChords={clearSelectedChords}
      />

      {/* 드래그 선택 후 뜨는 플로팅 말풍선 */}
      {selectionBubblePos && selectedChordsData.length > 0 && (
        <div
          style={{
            position: 'fixed',
            left: selectionBubblePos.x,
            top: selectionBubblePos.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 2000,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            setSelectionBubblePos(null);
            window.dispatchEvent(new CustomEvent('jazzify:requestLicks'));
          }}
        >
          <div style={{
            background: 'rgba(180, 130, 10, 0.9)',
            color: '#fff',
            padding: '3px 11px',
            borderRadius: '4px 4px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: "'Pretendard', sans-serif",
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            💡 릭 추천받기
          </div>
        </div>
      )}

      {savedLicksModal && (
        <SavedLicksModal
          spanLabel={savedLicksModal.label}
          matches={savedLicksModal.matches}
          onClose={() => setSavedLicksModal(null)}
          songTempo={tempo}
        />
      )}

      {analysisMenuOpen && (
        <ModalOverlay>
          <ModalCard ref={analysisMenuRef}>
            <ModalTitle>분석 설정</ModalTitle>
            <ModalSub>룰 기반 분석에 표시할 항목을 선택하세요.</ModalSub>
            {([
              { key: 'showDegree', label: '도수 표시' },
              { key: 'showIIVI', label: '2-5-1 하이라이트' },
              { key: 'showArrows', label: '해결 화살표' },
              { key: 'showColors', label: '비화성음 · 모달 색상' },
            ] as const).map(({ key, label }) => (
              <ToggleRow
                key={key}
                $disabled={!filters.showAnalysis}
                onClick={() => filters.showAnalysis && toggleFilter(key)}
              >
                <ToggleLabel>{label}</ToggleLabel>
                <Switch $on={filters.showAnalysis && filters[key]} />
              </ToggleRow>
            ))}
          </ModalCard>
        </ModalOverlay>
      )}
    </PageContainer>
  );
}

