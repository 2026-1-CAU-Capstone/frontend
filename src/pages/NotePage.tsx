import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { sampleMelody } from '../data/sampleMelody';
import type { NoteSheetData } from '../data/sampleMelody';
import type { TocEntry } from '../data/types';
import { noteSongs } from '../data/noteSongs';
import { loadMidiMelody } from '../lib/note/midiMelodyParser';
import { loadXmlMelody, loadMxlMelody } from '../lib/note/xmlMelodyParser';

const SAMPLE_ID = '__sample__';

/* ─── styled ─────────────────────────────────────────────────────────── */

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
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

const StatusText = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
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
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 6px;
`;

const CollectionTag = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 4px;
  font-size: 0.72rem;
  opacity: 0.7;
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
`;

/* ─── component ──────────────────────────────────────────────────────── */

export default function NotePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);

  /* song state */
  const [songId, setSongId] = useState(SAMPLE_ID);
  const [sheet, setSheet] = useState<NoteSheetData | null>(sampleMelody);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const data =
          song.fileType === 'midi'
            ? await loadMidiMelody(url, song.title, song.composer)
            : song.fileType === 'mxl'
              ? await loadMxlMelody(url, song.title)
              : await loadXmlMelody(url, song.title);
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
    return noteSongs
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery]);

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

  /* toc */
  const toc = useMemo<TocEntry[]>(() => {
    if (!sheet) return [];
    return [{ title: sheet.title, page: 1 }];
  }, [sheet]);

  /* resizable right panel */
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
      <TopToolbar
        autoHighlight={autoHighlight}
        onToggleHighlight={toggleAutoHighlight}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <MainArea>
        <LeftSidebar
          open={sidebarOpen}
          toc={toc}
          activePage={1}
          onPageSelect={() => {}}
        />

        <CenterColumn>
          <SongPickerBar>
            <span>Note {noteSongs.length}</span>
            <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value={SAMPLE_ID}>Blues for Alice (Sample)</option>
              {noteSongs.map((song) => (
                <option key={song.id} value={song.id}>
                  {song.title} -- {song.composer} [{song.collection}]
                </option>
              ))}
            </SongSelect>
            <StatusText>
              {loading
                ? 'Loading...'
                : sheet
                  ? `${sheet.key ?? '?'} / ${sheet.timeSignature}`
                  : error ?? ''}
            </StatusText>
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
                          setSongId(song.id);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        {song.title}
                        <SearchComposer>-- {song.composer}</SearchComposer>
                        <CollectionTag>[{song.collection}]</CollectionTag>
                      </SearchItem>
                    ))
                  )}
                </SearchResults>
              )}
            </SearchWrap>
          </SongPickerBar>

          {sheet && !loading ? (
            <NoteSheet data={sheet} />
          ) : (
            <LoadingState>
              {error ?? (loading ? 'Loading...' : 'Loading song list...')}
            </LoadingState>
          )}
        </CenterColumn>

        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />

        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
          />
        </RightPanelWrapper>
      </MainArea>
    </PageContainer>
  );
}
