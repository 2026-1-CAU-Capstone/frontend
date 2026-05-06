import { useRef } from 'react';
import type { ChordOverlay as ChordOverlayType } from '../../data/types';
import { ChordOverlayLayer } from './ChordOverlayLayer';
import { FullscreenButton, useFullscreen } from '../common/FullscreenButton';
import { ZoomControls, useZoom } from '../common/ZoomControls';
import { useCompactLayout } from '../../hooks/useCompactLayout';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle } = useFullscreen(containerRef);
  const { zoom, zoomIn, zoomOut, setZoomLevel } = useZoom(100);
  const isCompactLayout = useCompactLayout();
  const effectiveZoom = isCompactLayout ? 100 : zoom;

  return (
    <ViewerContainer ref={containerRef}>
      <ScorePage onClick={onBackgroundClick} style={{ width: `${effectiveZoom}%`, maxWidth: 'none' }}>
        <FullscreenButton isFullscreen={isFullscreen} onClick={toggle} />
        {!isCompactLayout && (
          <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onSetZoom={setZoomLevel} />
        )}
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
