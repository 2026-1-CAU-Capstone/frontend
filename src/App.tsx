import { useState, useMemo } from 'react';
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
