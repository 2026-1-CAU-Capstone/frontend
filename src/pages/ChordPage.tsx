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
import { BackingPlayerBar, type MixChannel } from '../components/backing/BackingPlayerBar';
import { withLeadSheetSelectionIds } from '../lib/leadSheetSelection';
import type { LeadSheetChordSelection } from '../components/leadsheet/LeadSheet';
import { loadUserLicksSync } from '../data/lickData';
import { findMatchingLicks } from '../lib/lickMatcher';

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
  const [activeBar, setActiveBar] = useState(-1);
  const [selectedChordIds, setSelectedChordIds] = useState<string[]>([]);
  const [selectedChordsData, setSelectedChordsData] = useState<ChordOverlay[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  // ★ 저장된 릭 있는 마디 번호 세트 (B안)
  const [savedLickBarNums, setSavedLickBarNums] = useState<Set<number>>(new Set());
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

  const [volumes, setVolumes] = useState<Record<MixChannel, number>>({
    piano: 1,
    bass: 1,
    drums: 0.9,
  });

  const handleVolumeChange = useCallback((channel: MixChannel, volume: number) => {
    setVolumes((prev) => ({ ...prev, [channel]: volume }));
  }, []);

  // Load song index on mount
  useEffect(() => {
    getSongIndex().then(setSongIndex).catch(() => {});
  }, []);

  // (Re)create backing player whenever the loaded sheet changes
  useEffect(() => {
    if (!sheet) return;
    const chart = leadSheetToChart(sheet);
    setTempo(chart.bpm);
    setActiveBar(-1);
    const player = createBackingPlayer(chart);
    player.on('onBar', (bar) => setActiveBar(bar));
    player.on('onDone', () => setIsPlaying(false));
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
      setIsPlaying(false);
      setActiveBar(-1);
    };
  }, [sheet]);

  // Push tempo changes into the live player config
  useEffect(() => {
    playerRef.current?.setConfig({ bpm: tempo });
  }, [tempo]);

  // Push mixer volume changes into the live player config
  useEffect(() => {
    playerRef.current?.setConfig({ volume: volumes });
  }, [volumes]);

  const handlePlayPause = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    try {
      await player.play();
    } catch (err) {
      console.error('[backing] play failed:', err);
      setIsPlaying(false);
    }
  }, [isPlaying]);

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
    // 각 시스템의 ii-V-I 시작 마디 탐지
    for (const system of sheet.systems) {
      for (const bar of system.bars) {
        const firstChord = bar.chords[0];
        if (!firstChord?.analysis?.groupMemberships) continue;
        const isIIStart = firstChord.analysis.groupMemberships.some(
          (g) => g.groupType === 'ii-V-I' && g.role === 'ii' && g.variant !== 'incomplete'
        );
        if (!isIIStart) continue;
        // 이 마디부터 ii-V-I 패턴 — 저장된 릭과 매칭되는지 확인
        const overlay = { id: String(bar.measureNumber), symbol: `${firstChord.root ?? ''}${firstChord.quality ?? ''}`, bar: bar.measureNumber ?? 0, pageNumber: 1, position: { x: 0, y: 0, width: 0, height: 0 }, analysis: { degree: '', func: 'SD' as const, diatonic: true } };
        const matches = findMatchingLicks([overlay], sheet.title, songKey, saved, 1);
        if (matches.length > 0) barNums.add(bar.measureNumber ?? 0);
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

  const [rightPanelWidth, setRightPanelWidth] = useState(480);
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
              onSavedLickBadgeClick={(_bar, x, y) => {
                setSelectionBubblePos({ x, y });
                window.dispatchEvent(new CustomEvent('jazzify:requestLicks'));
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
            top: selectionBubblePos.y - 12,
            transform: 'translate(-50%, -100%)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{
            background: '#1a1a1a',
            color: '#fff',
            padding: '7px 14px',
            borderRadius: '10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
            onClick={() => {
              setSelectionBubblePos(null);
              // RightChatPanel의 handleRequestLicks 와 연동하기 위해
              // 선택 상태가 이미 있으므로 커스텀 이벤트로 트리거
              window.dispatchEvent(new CustomEvent('jazzify:requestLicks'));
            }}
          >
            💡 릭 추천받기
          </div>
          {/* 말풍선 꼬리 */}
          <div style={{
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '7px solid #1a1a1a',
          }} />
        </div>
      )}

      <BackingPlayerBar
        playing={isPlaying}
        tempo={tempo}
        onTempoChange={setTempo}
        onPlayPause={handlePlayPause}
        volumes={volumes}
        onVolumeChange={handleVolumeChange}
        disabled={!sheet || loading}
      />
    </PageContainer>
  );
}
