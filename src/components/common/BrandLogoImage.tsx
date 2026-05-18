import styled from 'styled-components';

/**
 * The combined Jazzify logo+wordmark — a single PNG that replaces the
 * older `<img/> + <span>Jazzify</span>` pattern across the app's top-left
 * brand slots (sidebars, mobile bar, drawer, login).
 *
 * Source asset is /Jazzify.png, auto-trimmed of its transparent padding
 * via `magick -trim`. Aspect ratio is roughly 0.95 (almost square), so the
 * default sizing is height-driven and the parent should let the width be
 * `auto`.
 *
 *   <BrandLogoImage height={28} onClick={() => navigate('/')} />
 */

interface Props {
  /** Rendered height in px. Default 28 — close to a 1.15rem text baseline. */
  height?: number;
  /** Click handler — usually navigate('/'). When set, cursor + role applied. */
  onClick?: () => void;
  /** Optional aria-label override. */
  alt?: string;
  className?: string;
}

const Img = styled.img<{ $clickable: boolean }>`
  display: inline-block;
  width: auto;
  user-select: none;
  -webkit-user-drag: none;
  ${({ $clickable }) => ($clickable ? 'cursor: pointer;' : '')}
`;

export function BrandLogoImage({ height = 28, onClick, alt = 'Jazzify', className }: Props) {
  return (
    <Img
      src="/Jazzify-trimmed.png"
      alt={alt}
      style={{ height }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      $clickable={!!onClick}
      className={className}
    />
  );
}
