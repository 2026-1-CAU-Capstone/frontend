import { useState, useCallback } from 'react';
import type { ChordOverlay } from '../data/types';

interface ChordSelection {
  selectedChordId: string | null;
  selectedGroupId: number | null;
  selectChord: (chord: ChordOverlay) => void;
  clearSelection: () => void;
}

export function useChordSelection(): ChordSelection {
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const selectChord = useCallback((chord: ChordOverlay) => {
    setSelectedChordId(chord.id);
    setSelectedGroupId(chord.analysis.group?.id ?? null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedChordId(null);
    setSelectedGroupId(null);
  }, []);

  return { selectedChordId, selectedGroupId, selectChord, clearSelection };
}
