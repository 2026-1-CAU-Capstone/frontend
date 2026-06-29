/* §8 R7.3 — LeadSheet의 코드 드래그/클릭 선택 로직 분리 훅.
 *
 * 감사에서 포인터 이벤트 버그가 2회 발생한 핫스팟. 4,000줄 렌더 컴포넌트에
 * 얽혀 있던 선택 상태(드래그 앵커/프리뷰/shift-범위/토글-해제)를 그대로
 * 옮겼다 — 동작 변경 없음, 경계만 분리. 입력은 resolved 차트 + 콜백,
 * 출력은 타겟 인덱스/프리뷰 id/포인터 핸들러.
 *
 * 알려진 제약(별도 finding, 여기서 미해결): 터치 포인터는 implicit pointer
 * capture 때문에 pointerenter가 안 와서 모바일 드래그 범위 선택이 안 된다. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { LeadSheetChord, LeadSheetData } from '../../data/leadSheetTypes';

export interface LeadSheetChordSelection {
  id: string;
  chordKey: string;
  chord: LeadSheetChord;
  measureNumber: number;
  systemIndex: number;
  barIndex: number;
  chordIndex: number;
  order: number;
}

interface UseLeadSheetSelectionArgs {
  resolvedData: LeadSheetData;
  selectionMode: boolean;
  selectedChordIds?: string[];
  onChordClick?: (chord: LeadSheetChord, measureNumber: number, target?: LeadSheetChordSelection) => void;
  onChordRangeSelect?: (targets: LeadSheetChordSelection[], pos?: { x: number; y: number }) => void;
}

export function useLeadSheetSelection({
  resolvedData,
  selectionMode,
  selectedChordIds,
  onChordClick,
  onChordRangeSelect,
}: UseLeadSheetSelectionArgs) {
  const selectionTargets = useMemo<LeadSheetChordSelection[]>(() => {
    const targets: LeadSheetChordSelection[] = [];

    resolvedData.systems.forEach((system, systemIndex) => {
      system.bars.forEach((bar, barIndex) => {
        bar.chords.forEach((chord, chordIndex) => {
          if (!chord.root) return;
          const chordKey = `${systemIndex}-${barIndex}-${chordIndex}`;
          targets.push({
            id: chord.id ?? chordKey,
            chordKey,
            chord,
            measureNumber: bar.measureNumber ?? targets.length + 1,
            systemIndex,
            barIndex,
            chordIndex,
            order: targets.length,
          });
        });
      });
    });

    return targets;
  }, [resolvedData]);

  const selectionTargetByKey = useMemo(() => {
    const map = new Map<string, LeadSheetChordSelection>();
    selectionTargets.forEach((target) => {
      map.set(target.chordKey, target);
      map.set(target.id, target);
    });
    return map;
  }, [selectionTargets]);

  const dragStartTargetRef = useRef<LeadSheetChordSelection | null>(null);
  const dragCurrentTargetRef = useRef<LeadSheetChordSelection | null>(null);
  const clickAnchorTargetRef = useRef<LeadSheetChordSelection | null>(null);
  const dragMovedRef = useRef(false);
  const draggingSelectionRef = useRef(false);
  const [draggingSelection, setDraggingSelection] = useState(false);
  const [dragPreviewChordIds, setDragPreviewChordIds] = useState<string[]>([]);
  const visibleSelectionChordIds = useMemo(
    () => dragPreviewChordIds.length > 0 ? dragPreviewChordIds : (selectedChordIds ?? []),
    [dragPreviewChordIds, selectedChordIds],
  );

  const getSelectionRange = (start: LeadSheetChordSelection, end: LeadSheetChordSelection) => {
    const from = Math.min(start.order, end.order);
    const to = Math.max(start.order, end.order);
    return selectionTargets.filter((target) => target.order >= from && target.order <= to);
  };

  const handleSelectionPointerDown = (target: LeadSheetChordSelection, event: PointerEvent<HTMLDivElement>) => {
    if (!selectionMode) return;
    event.preventDefault();
    event.stopPropagation();
    // 터치 포인터는 pointerdown을 받은 요소에 '암시적 pointer capture'가 걸려,
    // 드래그 중 다른 ChordColumn에서 pointerenter가 발생하지 않는다 → 모바일에서
    // 범위 드래그가 첫 코드 1개로만 끝났다(Fable §3). 캡처를 풀어 손가락 아래
    // 요소로 pointerenter가 전달되게 한다. (마우스 등 미캡처 시 throw → 무시)
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    dragStartTargetRef.current = target;
    dragCurrentTargetRef.current = target;
    dragMovedRef.current = false;
    draggingSelectionRef.current = true;
    setDraggingSelection(true);
    setDragPreviewChordIds([target.id]);
  };

  const handleSelectionPointerEnter = (target: LeadSheetChordSelection) => {
    if (!draggingSelectionRef.current || !dragStartTargetRef.current) return;
    dragCurrentTargetRef.current = target;
    if (target.id !== dragStartTargetRef.current.id) dragMovedRef.current = true;
    setDragPreviewChordIds(getSelectionRange(dragStartTargetRef.current, target).map((item) => item.id));
  };

  useEffect(() => {
    if (!draggingSelection) return;

    const handlePointerUp = (e: globalThis.PointerEvent) => {
      if (!draggingSelectionRef.current) return;
      draggingSelectionRef.current = false;
      const start = dragStartTargetRef.current;
      const end = dragCurrentTargetRef.current ?? start;
      if (start && end) {
        if (dragMovedRef.current) {
          clickAnchorTargetRef.current = start;
          onChordRangeSelect?.(getSelectionRange(start, end), { x: e.clientX, y: e.clientY });
        } else {
          const anchor = clickAnchorTargetRef.current;
          const selectedIdSet = new Set(selectedChordIds ?? []);

          if (selectedIdSet.has(start.id)) {
            const remainingTargets = selectionTargets.filter((target) =>
              selectedIdSet.has(target.id) && target.order < start.order
            );
            clickAnchorTargetRef.current = remainingTargets[0] ?? null;
            onChordRangeSelect?.(remainingTargets);
          } else if (!anchor || !selectedChordIds?.length) {
            clickAnchorTargetRef.current = start;
            onChordClick?.(start.chord, start.measureNumber, start);
          } else {
            onChordRangeSelect?.(getSelectionRange(anchor, start), { x: e.clientX, y: e.clientY });
          }
        }
      }

      dragStartTargetRef.current = null;
      dragCurrentTargetRef.current = null;
      dragMovedRef.current = false;
      setDraggingSelection(false);
      setDragPreviewChordIds([]);
    };

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingSelection, onChordClick, onChordRangeSelect, selectedChordIds, selectionTargets]);

  useEffect(() => {
    if (selectionMode) return;
    dragStartTargetRef.current = null;
    dragCurrentTargetRef.current = null;
    clickAnchorTargetRef.current = null;
    dragMovedRef.current = false;
    draggingSelectionRef.current = false;
    setDraggingSelection(false);
    setDragPreviewChordIds([]);
  }, [selectionMode]);

  useEffect(() => {
    if (selectedChordIds?.length) return;
    clickAnchorTargetRef.current = null;
  }, [selectedChordIds]);

  return {
    selectionTargetByKey,
    visibleSelectionChordIds,
    dragPreviewChordIds,
    handleSelectionPointerDown,
    handleSelectionPointerEnter,
  };
}
