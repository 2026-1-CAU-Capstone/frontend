import { useMemo } from 'react';
import type { ChordOverlay as ChordOverlayType } from '../../data/types';
import { ChordHighlight } from './ChordHighlight';
import { GroupBracket } from './GroupBracket';

interface ChordOverlayLayerProps {
  chords: ChordOverlayType[];
  autoHighlight: boolean;
  selectedChordId: string | null;
  selectedGroupId: number | null;
  onChordClick: (chord: ChordOverlayType) => void;
}

export function ChordOverlayLayer({
  chords,
  autoHighlight,
  selectedChordId,
  selectedGroupId,
  onChordClick,
}: ChordOverlayLayerProps) {
  const groups = useMemo(() => {
    const map = new Map<number, ChordOverlayType[]>();
    for (const chord of chords) {
      const gid = chord.analysis.group?.id;
      if (gid != null) {
        if (!map.has(gid)) map.set(gid, []);
        map.get(gid)!.push(chord);
      }
    }
    return map;
  }, [chords]);

  return (
    <>
      {/* Group brackets */}
      {Array.from(groups.entries()).map(([gid, groupChords]) => (
        <GroupBracket
          key={`group-${gid}`}
          chords={groupChords}
          groupType={groupChords[0]?.analysis.group?.type ?? ''}
          selected={selectedGroupId === gid}
          visible={autoHighlight}
        />
      ))}

      {/* Individual chord highlights */}
      {chords.map((chord) => {
        const isGrouped = chord.analysis.group != null;
        const isSelected =
          selectedChordId === chord.id ||
          (selectedGroupId != null && chord.analysis.group?.id === selectedGroupId);

        return (
          <ChordHighlight
            key={chord.id}
            chord={chord}
            selected={isSelected}
            grouped={isGrouped}
            visible={autoHighlight}
            onClick={onChordClick}
          />
        );
      })}
    </>
  );
}
