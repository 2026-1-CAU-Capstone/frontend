import { useEffect, useState } from 'react';
import { BP } from '../styles/theme';

const COMPACT_LAYOUT_QUERY = `(max-width: ${BP.desktop}px), (hover: none), (pointer: coarse)`;

export function useCompactLayout() {
  const [isCompactLayout, setIsCompactLayout] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(COMPACT_LAYOUT_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = () => setIsCompactLayout(mediaQuery.matches);

    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isCompactLayout;
}
