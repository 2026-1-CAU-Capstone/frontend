import { useState, useMemo, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { TopToolbar } from './components/layout/TopToolbar';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { RightChatPanel } from './components/layout/RightChatPanel';
import { LeadSheet } from './components/leadsheet/LeadSheet';
import { useAutoHighlight } from './hooks/useAutoHighlight';
import { useChordSelection } from './hooks/useChordSelection';
import { autumnLeaves } from './data/autumnLeaves';
import { love } from './data/love';
import { jazzSongs } from './data/jazzSongs';
import type { LeadSheetData } from './data/leadSheetTypes';

const AppContainer = styled.div`
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
  max-width: 320px;
`;

/* ─── resizable right panel ─────────────────────────────────────────────── */

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
    inset: 0 -4px; /* wider hit area */
  }
`;

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);
  const { selectedChordId, selectedGroupId } = useChordSelection();

  const song = autumnLeaves;
  const totalPages = song.toc.length || 1;

  // ─── Lead-sheet song picker ────────────────────────────────────────────
  // -1 = L.O.V.E. (built-in); 0-99 = jazzSongs index
  const ALL_SONGS: { label: string; data: LeadSheetData }[] = [
    { label: 'L.O.V.E. (Gabler-Kaempfert)', data: love },
    ...jazzSongs.map(s => ({
      label: `${s.title} — ${s.composer}`,
      data: s,
    })),
  ];
  const [songIdx, setSongIdx] = useState(0);
  const activeSheet = ALL_SONGS[songIdx]?.data ?? love;

  // ─── right panel resize ────────────────────────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const dividerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = rightPanelWidth;
    dividerRef.current?.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;          // drag left = wider panel
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

  const selectedChords = useMemo(() => {
    if (selectedGroupId != null) {
      return song.chords.filter(
        (c) => c.analysis.group?.id === selectedGroupId,
      );
    }
    if (selectedChordId != null) {
      const found = song.chords.find((c) => c.id === selectedChordId);
      return found ? [found] : [];
    }
    return [];
  }, [selectedChordId, selectedGroupId, song.chords]);

  const groupExplanation = useMemo(() => {
    if (selectedGroupId != null) {
      return song.groupExplanations[selectedGroupId] ?? null;
    }
    if (selectedChordId != null) {
      const chord = song.chords.find((c) => c.id === selectedChordId);
      if (chord) {
        const { analysis } = chord;
        let desc = `**${chord.symbol}** (${analysis.degree}) — `;
        desc += analysis.diatonic ? '다이아토닉 코드' : '논다이아토닉 코드';
        if (analysis.secDom) desc += ` (Secondary Dominant → ${analysis.secDom})`;
        if (analysis.modal) desc += ` (Modal Interchange: ${analysis.modal})`;
        return desc;
      }
    }
    return null;
  }, [selectedChordId, selectedGroupId, song.chords, song.groupExplanations]);

  return (
    <AppContainer>
      <TopToolbar
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        autoHighlight={autoHighlight}
        onToggleHighlight={toggleAutoHighlight}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <SongPickerBar>
        <span>곡 선택</span>
        <SongSelect
          value={songIdx}
          onChange={e => setSongIdx(Number(e.target.value))}
        >
          {ALL_SONGS.map((s, idx) => (
            <option key={idx} value={idx}>{s.label}</option>
          ))}
        </SongSelect>
        <span style={{ color: '#888' }}>
          ({activeSheet.timeSignature} · {activeSheet.style})
        </span>
      </SongPickerBar>
      <MainArea>
        <LeftSidebar
          open={sidebarOpen}
          toc={song.toc}
          activePage={currentPage}
          onPageSelect={setCurrentPage}
        />
        <LeadSheet data={activeSheet} />
        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />
        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            selectedChords={selectedChords}
            groupExplanation={groupExplanation}
            songTitle={song.title}
          />
        </RightPanelWrapper>
      </MainArea>
    </AppContainer>
  );
}

export default App;
