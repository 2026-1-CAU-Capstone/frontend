import styled from 'styled-components';

const EmbedFrame = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 8px 0 4px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;

  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
`;

interface Props {
  videoId: string;
  startSec?: number;
  /** 공통 너비 제한이 필요하면 지정 (px), 없으면 부모 폭 100% */
  maxWidth?: number;
  autoplay?: boolean;
}

export function YoutubeEmbed({ videoId, startSec, maxWidth, autoplay }: Props) {
  const params = new URLSearchParams();
  if (startSec && startSec > 0) params.set('start', String(Math.floor(startSec)));
  if (autoplay) {
    params.set('autoplay', '1');
    params.set('mute', '0');
  }
  const qs = params.toString();
  const allow = `accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture${autoplay ? '; autoplay' : ''}`;
  return (
    <EmbedFrame style={maxWidth ? { maxWidth } : undefined}>
      <iframe
        src={`https://www.youtube.com/embed/${videoId}${qs ? `?${qs}` : ''}`}
        title="YouTube video"
        loading="lazy"
        allow={allow}
        allowFullScreen
      />
    </EmbedFrame>
  );
}
