import styled from 'styled-components';

/**
 * CompactButton — "fit the whole chart into one screen" toggle.
 *
 * Mirrors FullscreenButton's geometry (30x30, border-radius 6, dark
 * translucent fill) so the cluster of corner buttons looks uniform. The
 * caller (e.g. LeadSheet) computes the target zoom and passes a click
 * handler in; this button just holds the visual.
 *
 * Default position sits between ZoomControls (right: 80px when shifted to
 * make room) and FullscreenButton (right: 8px), so all three corner tools
 * end up evenly spaced with a 6px gap between siblings.
 */

const Btn = styled.button`
  position: absolute;
  top: 8px;
  right: 44px;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.border};
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.scrim};
  }
`;

/* The icon evokes "squeeze tall content into one page" — a small rectangle
 * (page) with chevrons pressing down from above and up from below. Distinct
 * from FullscreenButton's outward-facing corner brackets. */
const Icon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {/* top chevron pointing down into the page */}
    <polyline points="5 2 9 5 13 2" />
    {/* page outline (compressed) */}
    <rect x="4" y="6.5" width="10" height="5" rx="0.6" />
    {/* bottom chevron pointing up into the page */}
    <polyline points="5 16 9 13 13 16" />
  </svg>
);

interface CompactButtonProps {
  onClick: () => void;
}

export function CompactButton({ onClick }: CompactButtonProps) {
  return (
    <Btn
      className="compact-btn"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="한 화면에 맞추기"
    >
      <Icon />
    </Btn>
  );
}
