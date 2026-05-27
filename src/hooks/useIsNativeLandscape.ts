import { useEffect, useState } from 'react';
import { useIsNativeUi } from '../contexts/AppPreviewContext';

/* True when the native-UI gate is on (Capacitor shell OR /preview/* route)
 * AND the viewport is in landscape orientation. Drives the lead-sheet's
 * "fit to one page" mode. */

const LANDSCAPE_QUERY = '(orientation: landscape)';

export function useIsNativeLandscape(): boolean {
  const isNativeUi = useIsNativeUi();
  const [landscape, setLandscape] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(LANDSCAPE_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(LANDSCAPE_QUERY);
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return isNativeUi && landscape;
}
