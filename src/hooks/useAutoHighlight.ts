import { useState, useCallback } from 'react';

export function useAutoHighlight(initialState = true) {
  const [autoHighlight, setAutoHighlight] = useState(initialState);
  const toggleAutoHighlight = useCallback(() => setAutoHighlight((v) => !v), []);
  return { autoHighlight, toggleAutoHighlight } as const;
}
