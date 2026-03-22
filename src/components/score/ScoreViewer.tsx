import type { ChordOverlay as ChordOverlayType } from '../../data/types';
import { ChordOverlayLayer } from './ChordOverlayLayer';
import {
  ViewerContainer,
  ScorePage,
  ScoreBackground,
  ScoreTitle,
  ScoreSubtitle,
  StaffLine,
  StaffGroup,
} from './ScoreViewer.styles';

interface ScoreViewerProps {
  songTitle: string;
  songKey: string;
  chords: ChordOverlayType[];
  autoHighlight: boolean;
  selectedChordId: string | null;
  selectedGroupId: number | null;
  onChordClick: (chord: ChordOverlayType) => void;
  onBackgroundClick: () => void;
}

export function ScoreViewer({
  songTitle,
  songKey,
  chords,
  autoHighlight,
  selectedChordId,
  selectedGroupId,
  onChordClick,
  onBackgroundClick,
}: ScoreViewerProps) {
  return (
    <ViewerContainer>
      <ScorePage onClick={onBackgroundClick}>
        <ScoreBackground>
          <ScoreTitle>{songTitle}</ScoreTitle>
          <ScoreSubtitle>Key: {songKey}</ScoreSubtitle>
          <StaffGroup>
            {/* Mock staff lines to simulate sheet music */}
            {Array.from({ length: 8 }).map((_, i) => (
              <StaffLine key={i} />
            ))}
          </StaffGroup>
        </ScoreBackground>

        {/* Chord overlay layer */}
        <div
          style={{ position: 'absolute', inset: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onBackgroundClick();
          }}
        >
          <ChordOverlayLayer
            chords={chords}
            autoHighlight={autoHighlight}
            selectedChordId={selectedChordId}
            selectedGroupId={selectedGroupId}
            onChordClick={onChordClick}
          />
        </div>
      </ScorePage>
    </ViewerContainer>
  );
}
