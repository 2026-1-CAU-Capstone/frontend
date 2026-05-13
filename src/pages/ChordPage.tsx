import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { MobileChatFab } from '../components/layout/MobileChatFab';
import { LeadSheet } from '../components/leadsheet/LeadSheet';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { allOfMe } from '../data/allOfMe';
import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordOverlay, TocEntry } from '../data/types';
import { getSongIndex, getSong, type SongEntry } from '../lib/ireal/irealLoader';
import { buildChordContext } from '../api/chordContext';
import { createBackingPlayer, leadSheetToChart, type BackingPlayer } from '../lib/backing';
import { createStyBackingPlayer } from '../lib/yamaha-sty';
import { getPlayerSettings, inferPlayStyle, setPlayerSetting } from '../lib/note/playerSettings';
import { BackingPlayerBar } from '../components/backing/BackingPlayerBar';
import { withLeadSheetSelectionIds } from '../lib/leadSheetSelection';
import type { LeadSheetChordSelection } from '../components/leadsheet/LeadSheet';
import { loadUserLicksSync } from '../data/lickData';
import { findMatchingLicks, type LickMatch } from '../lib/lickMatcher';
import { SavedLicksModal } from '../components/leadsheet/SavedLicksModal';
import { useCountInIntro } from '../hooks/useCountInIntro';

const ANALYZED_SONG_ID = '__analyzed_all-of-me__';

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

const SongPickerBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;

  ${mq.mobile} {
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
  }
`;

const SongSelect = styled.select`
  font-family: 'DM Sans', sans-serif;
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
  margin-left: auto;
`;

const SearchInput = styled.input`
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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

const FilterBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
`;

const AnalysisControl = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const AnalysisDropdownTrigger = styled.button<{ $open: boolean }>`
  height: 32px;
  min-width: 112px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 11px 0 13px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ $open, theme }) => ($open ? theme.colors.bgSecondary : theme.colors.bgPrimary)};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: ${({ $open }) => ($open ? '0 2px 8px rgba(0, 0, 0, 0.08)' : 'none')};
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
    border-color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

const AnalysisChevron = styled.span<{ $open: boolean }>`
  width: 7px;
  height: 7px;
  border-right: 1.7px solid ${({ theme }) => theme.colors.textSecondary};
  border-bottom: 1.7px solid ${({ theme }) => theme.colors.textSecondary};
  transform: rotate(${({ $open }) => ($open ? '225deg' : '45deg')});
  margin-top: ${({ $open }) => ($open ? '4px' : '-3px')};
  transition: transform 0.15s, margin-top 0.15s;
`;

const AnalysisMasterSwitch = styled.button<{ $active: boolean }>`
  position: relative;
  width: 48px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: ${({ $active, theme }) => ($active ? '#2D8F5E' : theme.colors.border)};
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: background 0.18s;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $active }) => ($active ? '23px' : '3px')};
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
    transition: left 0.18s;
  }
`;

const AnalysisDropdownMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 250;
  width: 184px;
  padding: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
`;

const AnalysisDropdownTitle = styled.div`
  padding: 5px 8px 7px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const AnalysisOption = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const AnalysisOptionSwitch = styled.span<{ $active: boolean; $color: string }>`
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 999px;
  background: ${({ $active, $color, theme }) => ($active ? $color : theme.colors.border)};
  transition: background 0.15s;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $active }) => ($active ? '15px' : '3px')};
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s;
  }
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
  const leadSheetAnalysisFilters = useMemo(() => ({
    ...effective,
    showDegree: effective.showAnalysis,
  }), [effective]);
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

  const playerRef = useRef<BackingPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState(140);
  const [engineBackend, setEngineBackend] = useState<'rule' | 'sty'>(() => {
    if (typeof window === 'undefined') return 'rule';
    return window.localStorage.getItem('jazzify.engine') === 'sty' ? 'sty' : 'rule';
  });
  const [activeBar, setActiveBar] = useState(-1);
  const [selectedChordIds, setSelectedChordIds] = useState<string[]>([]);
  const [selectedChordsData, setSelectedChordsData] = useState<ChordOverlay[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  // ★ 저장된 릭 있는 마디 번호 세트
  const [savedLickBarNums, setSavedLickBarNums] = useState<Set<number>>(new Set());
  const [savedLicksModal, setSavedLicksModal] = useState<{ label: string; matches: LickMatch[] } | null>(null);
  const analysisMenuRef = useRef<HTMLDivElement>(null);

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
    const player = engineBackend === 'sty' ? createStyBackingPlayer(chart) : createBackingPlayer(chart);
    player.on('onBar', (bar) => setActiveBar(bar));
    player.on('onDone', () => setIsPlaying(false));
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
      setIsPlaying(false);
      setActiveBar(-1);
    };
  }, [sheet, engineBackend]);

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
  }, [isPlaying, tempo, countIn]);

  // Load selected song
  useEffect(() => {
    if (songId === ANALYZED_SONG_ID) {
      setSheet(withLeadSheetSelectionIds(allOfMe, ANALYZED_SONG_ID));
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
        setSheet(data);
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

  const toc = useMemo<TocEntry[]>(() => {
    if (!sheet) return [];
    return [{ title: sheet.title, page: 1 }];
  }, [sheet]);

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

  const [rightPanelWidth, setRightPanelWidth] = useState(620);
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
        />

        <MainArea>
          <LeftSidebar
            toc={toc}
            activePage={1}
            onPageSelect={() => {}}
          />

        <CenterColumn>
          <SongPickerBar>
            <span>iRealPro {songIndex.length || '...'}</span>
            <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value={ANALYZED_SONG_ID}>All of Me (Analyzed)</option>
              {songIndex.map((song) => (
                <option key={song.index} value={String(song.index)}>
                  {song.title} -- {song.composer}
                </option>
              ))}
            </SongSelect>
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
          </SongPickerBar>

          {sheet && !loading ? (
            <LeadSheet
              data={sheet}
              analysisFilters={leadSheetAnalysisFilters}
              activeBar={activeBar}
              onChordClick={handleChordClick}
              onChordRangeSelect={handleChordRangeSelect}
              selectedChordIds={selectedChordIds}
              selectionMode={isSelectionMode}
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
          <FilterBar>
            <AnalysisControl ref={analysisMenuRef}>
              <AnalysisDropdownTrigger
                type="button"
                $open={analysisMenuOpen}
                aria-label="분석 세부 옵션"
                aria-expanded={analysisMenuOpen}
                onClick={() => setAnalysisMenuOpen((open) => !open)}
              >
                분석 보기
                <AnalysisChevron $open={analysisMenuOpen} />
              </AnalysisDropdownTrigger>
              {analysisMenuOpen && (
                <AnalysisDropdownMenu>
                  <AnalysisDropdownTitle>세부 표시</AnalysisDropdownTitle>
                  <AnalysisOption
                    type="button"
                    onClick={() => toggleFilter('showIIVI')}
                  >
                    <span>2-5-1</span>
                    <AnalysisOptionSwitch $active={filters.showIIVI} $color="#B8860B" />
                  </AnalysisOption>
                  <AnalysisOption
                    type="button"
                    onClick={() => toggleFilter('showArrows')}
                  >
                    <span>화살표</span>
                    <AnalysisOptionSwitch $active={filters.showArrows} $color="#C45C5C" />
                  </AnalysisOption>
                  <AnalysisOption
                    type="button"
                    onClick={() => toggleFilter('showColors')}
                  >
                    <span>색상</span>
                    <AnalysisOptionSwitch $active={filters.showColors} $color="#7B5EA7" />
                  </AnalysisOption>
                </AnalysisDropdownMenu>
              )}
            </AnalysisControl>
            <AnalysisMasterSwitch
              type="button"
              $active={filters.showAnalysis}
              aria-label={filters.showAnalysis ? '분석 보기 끄기' : '분석 보기 켜기'}
              onClick={() => toggleFilter('showAnalysis')}
            />
          </FilterBar>
          <RightChatPanel
            selectedChords={selectedChordsData}
            groupExplanation={selectedChordsData.length > 0 ? "이 구간이 다음 질문의 분석 대상으로 포함됩니다." : null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
            chordContext={chordContext}
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={toggleSelectionMode}
            onClearSelectedChords={clearSelectedChords}
            songTempo={tempo}
          />
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
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            💡 릭 추천받기
          </div>
        </div>
      )}

      <EngineToggle
        backend={engineBackend}
        onChange={(b) => {
          setEngineBackend(b);
          window.localStorage.setItem('jazzify.engine', b);
        }}
      />

      <BackingPlayerBar
        playing={isPlaying}
        tempo={tempo}
        onTempoChange={setTempo}
        onPlayPause={handlePlayPause}
        disabled={!sheet || loading}
      />

      {savedLicksModal && (
        <SavedLicksModal
          spanLabel={savedLicksModal.label}
          matches={savedLicksModal.matches}
          onClose={() => setSavedLicksModal(null)}
          songTempo={tempo}
        />
      )}
    </PageContainer>
  );
}

/** Floating toggle to swap the backing-track engine between the legacy
 *  rule-based generator and the new .sty / YamJJazz-port engine. Persists
 *  to localStorage so the choice survives a reload. */
function EngineToggle({
  backend,
  onChange,
}: {
  backend: 'rule' | 'sty';
  onChange: (b: 'rule' | 'sty') => void;
}) {
  return (
    <div style={{
      position: 'fixed',
      top: 8,
      right: 12,
      zIndex: 1000,
      background: 'rgba(20, 20, 20, 0.85)',
      border: '1px solid #333',
      borderRadius: 999,
      padding: '4px',
      display: 'flex',
      gap: 0,
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {(['rule', 'sty'] as const).map((b) => (
        <button
          key={b}
          onClick={() => onChange(b)}
          style={{
            padding: '6px 12px',
            border: 'none',
            borderRadius: 999,
            cursor: 'pointer',
            background: backend === b ? '#3a7' : 'transparent',
            color: backend === b ? '#fff' : '#aaa',
            fontWeight: backend === b ? 600 : 400,
          }}
        >
          {b === 'rule' ? 'Rule engine' : '.sty (psBase)'}
        </button>
      ))}
    </div>
  );
}
