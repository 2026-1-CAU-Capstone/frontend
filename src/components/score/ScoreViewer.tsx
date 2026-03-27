import type { ChordOverlay as ChordOverlayType } from '../../data/types';
import { ChordOverlayLayer } from './ChordOverlayLayer';
import {
  ViewerContainer,
  ScorePage,
  ScoreImage,
  OverlayLayer,
  PlaceholderPage,
  PlaceholderIcon,
} from './ScoreViewer.styles';

interface ScoreViewerProps {
  scoreImageUrl: string | null;
  chords: ChordOverlayType[];
  autoHighlight: boolean;
  selectedChordId: string | null;
  selectedGroupId: number | null;
  onChordClick: (chord: ChordOverlayType) => void;
  onBackgroundClick: () => void;
}

export function ScoreViewer({
  scoreImageUrl,
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
        {/* 원본 악보 이미지 */}
        {scoreImageUrl ? (
          <ScoreImage src={scoreImageUrl} alt="악보" draggable={false} />
        ) : (
          <PlaceholderPage>
            <PlaceholderIcon>🎼</PlaceholderIcon>
            악보 이미지를 불러오는 중...
            <br />
            (public/scores/ 에 이미지를 추가하세요)
          </PlaceholderPage>
        )}

        {/* 코드 분석 오버레이 — 이미지 위에 도수/기능 표시 */}
        <OverlayLayer
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
        </OverlayLayer>
      </ScorePage>
    </ViewerContainer>
  );
}
