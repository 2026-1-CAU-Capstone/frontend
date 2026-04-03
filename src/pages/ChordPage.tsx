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
import { Toggle } from '../components/common/Toggle';
import { ToolbarButton } from '../components/layout/TopToolbar.styles';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { allOfMe } from '../data/allOfMe';
import type { LeadSheetData } from '../data/leadSheetTypes';
import type { TocEntry } from '../data/types';
import { getSongIndex, getSong, type SongEntry } from '../lib/ireal/irealLoader';
import { buildChordContext } from '../api/chordContext';
import analysisJson from '../data/allofme_analysis.json';
import { buildRawAnalysisContext } from '../api/chordContext';

const ANALYZED_SONG_ID = '__analyzed_all-of-me__';

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

  ${mq.mobile} {
    display: none;
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

  ${mq.mobile} {
    display: none;
  }
`;

export default function ChordPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);
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

  // Load song index on mount
  useEffect(() => {
    getSongIndex().then(setSongIndex).catch(() => {});
  }, []);

  // Load selected song
  useEffect(() => {
    if (songId === ANALYZED_SONG_ID) {
      setSheet(allOfMe);
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

  const toc = useMemo<TocEntry[]>(() => {
    if (!sheet) return [];
    return [{ title: sheet.title, page: 1 }];
  }, [sheet]);

  // Build chord context for AI: use raw analysis JSON for analyzed song, LeadSheet data for others
  const chordContext = useMemo(() => {
    if (songId === ANALYZED_SONG_ID) {
      return buildRawAnalysisContext(analysisJson as any);
    }
    if (sheet) return buildChordContext(sheet);
    return undefined;
  }, [songId, sheet]);

  const [rightPanelWidth, setRightPanelWidth] = useState(360);
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
    <PageContainer>
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
            <Toggle
              label="분석 보기"
              active={autoHighlight}
              onToggle={toggleAutoHighlight}
            />

            <ToolbarButton>자동 번역</ToolbarButton>
          </SongPickerBar>

          {sheet && !loading ? (
            <LeadSheet data={sheet} showAnalysis={autoHighlight} />
          ) : (
            <LoadingState>{error ?? (loading ? 'Loading chart...' : 'Loading song list...')}</LoadingState>
          )}
        </CenterColumn>

        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />

        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
            chordContext={chordContext}
          />
        </RightPanelWrapper>
        </MainArea>
      </RightSection>

      <MobileChatFab
        songTitle={sheet?.title ?? 'Jazzify AI'}
        chordContext={chordContext}
      />
    </PageContainer>
  );
}
