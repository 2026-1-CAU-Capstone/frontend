import { useState, useMemo, useCallback } from 'react';
import styled from 'styled-components';
import { TopToolbar } from './components/layout/TopToolbar';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { RightChatPanel } from './components/layout/RightChatPanel';
import { ScoreViewer } from './components/score/ScoreViewer';
import { useAutoHighlight } from './hooks/useAutoHighlight';
import { useChordSelection } from './hooks/useChordSelection';
import { autumnLeaves } from './data/autumnLeaves';
import type { ChordOverlay } from './data/types';

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

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);
  const { selectedChordId, selectedGroupId, selectChord, clearSelection } =
    useChordSelection();

  const song = autumnLeaves;
  const totalPages = song.toc.length || 1;

  const handleChordClick = useCallback(
    (chord: ChordOverlay) => {
      selectChord(chord);
    },
    [selectChord],
  );

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
      <MainArea>
        <LeftSidebar
          open={sidebarOpen}
          toc={song.toc}
          activePage={currentPage}
          onPageSelect={setCurrentPage}
        />
        <ScoreViewer
          scoreImageUrl={song.scoreImages[currentPage] ?? null}
          chords={song.chords.filter((c) => c.pageNumber === currentPage)}
          autoHighlight={autoHighlight}
          selectedChordId={selectedChordId}
          selectedGroupId={selectedGroupId}
          onChordClick={handleChordClick}
          onBackgroundClick={clearSelection}
        />
        <RightChatPanel
          selectedChords={selectedChords}
          groupExplanation={groupExplanation}
          songTitle={song.title}
        />
      </MainArea>
    </AppContainer>
  );
}

export default App;
