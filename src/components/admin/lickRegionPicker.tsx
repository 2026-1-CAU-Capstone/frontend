/**
 * Reusable region-selection + "Save Lick" controls for admin tools.
 *
 * Multiple disjoint regions are treated as a SINGLE lick — the measures from
 * each region are concatenated in document order to form one lick.
 *
 * Click          → toggle a single-measure region (add/remove)
 * Shift+click    → extend the last region's range
 *
 *   const picker = useLickRegionPicker({ sheetData, performer, title });
 *   <LickRegionControls picker={picker} />
 *   <NoteSheet
 *     data={sheetData}
 *     selectable={picker.selectMode}
 *     selectedRanges={picker.selectedRanges}
 *     onSelectionChange={picker.setSelectedRanges}
 *   />
 */

import { useCallback, useState } from 'react';
import styled from 'styled-components';
import type { NoteSheetData } from '../../data/sampleMelody';

interface UseLickPickerArgs {
  sheetData: NoteSheetData;
  performer: string;
  title: string;
  instrument?: string;
  tag?: string;
}

export interface LickRegionPicker {
  selectMode: boolean;
  toggleSelectMode: () => void;
  selectedRanges: Array<[number, number]>;
  setSelectedRanges: (r: Array<[number, number]>) => void;
  saving: boolean;
  saveResult: { ok: boolean; msg: string } | null;
  handleSaveLick: () => Promise<void>;
}

export function useLickRegionPicker({
  sheetData,
  performer,
  title,
  instrument = 'sax',
  tag = 'admin-region',
}: UseLickPickerArgs): LickRegionPicker {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRanges, setSelectedRanges] = useState<Array<[number, number]>>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => {
      const next = !v;
      if (!next) setSelectedRanges([]);
      return next;
    });
  }, []);

  const handleSaveLick = useCallback(async () => {
    if (selectedRanges.length === 0) return;
    setSaving(true);
    setSaveResult(null);

    // Concat measures from all regions (sorted in document order so the
    // resulting lick reads left-to-right just like the source).
    const sorted = [...selectedRanges].sort((a, b) => Math.min(...a) - Math.min(...b));
    const allMeasures = sorted.flatMap(([lo, hi]) =>
      sheetData.measures.slice(Math.min(lo, hi), Math.max(lo, hi) + 1),
    );
    if (allMeasures.length === 0) { setSaving(false); return; }

    const barsLabel = sorted
      .map(([lo, hi]) => {
        const a = Math.min(lo, hi) + 1;
        const b = Math.max(lo, hi) + 1;
        return a === b ? `${a}` : `${a}-${b}`;
      })
      .join(', ');

    try {
      const { createLick } = await import('../../api/licks');
      const { invalidateLicksCache, computeLickFeatures } = await import('../../data/lickData');
      const features = computeLickFeatures(allMeasures);
      const totalN = allMeasures.reduce(
        (s, m) => s + m.notes.filter((n) => !n.duration.endsWith('r')).length,
        0,
      );
      const lickKey = sheetData.key && sheetData.key !== 'C' ? sheetData.key : 'C';

      const persisted = await createLick({
        id: Date.now(),
        performer,
        title,
        instrument,
        album: '',
        style: '',
        tempo: sheetData.tempo ?? 120,
        key: lickKey,
        rhythmfeel: '',
        tag,
        chords: allMeasures.map((m) => m.chord ?? '').filter(Boolean),
        nEvents: totalN,
        label: `${title} — bars ${barsLabel}`,
        sheetData: {
          title,
          composer: performer,
          key: lickKey,
          timeSignature: sheetData.timeSignature ?? '4/4',
          tempo: sheetData.tempo,
          measures: allMeasures,
        },
        ...features,
      });
      invalidateLicksCache();
      setSaveResult({
        ok: true,
        msg: `✓ Saved (id: ${String(persisted.id).slice(0, 8)}…, ${totalN} notes)`,
      });
      setSelectedRanges([]);
    } catch (e) {
      setSaveResult({ ok: false, msg: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
    }
  }, [selectedRanges, sheetData, performer, title, instrument, tag]);

  return {
    selectMode,
    toggleSelectMode,
    selectedRanges,
    setSelectedRanges,
    saving,
    saveResult,
    handleSaveLick,
  };
}

/* ── styled ──────────────────────────────────────────────────────────── */

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-family: 'DM Sans', sans-serif;
`;

const SelectBtn = styled.button<{ $active: boolean }>`
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid ${({ $active }) => ($active ? '#136f41' : '#bbb')};
  background: ${({ $active }) => ($active ? '#229558' : '#fff')};
  color: ${({ $active }) => ($active ? '#fff' : '#333')};
  border-radius: 5px;
  cursor: pointer;
  &:hover { opacity: 0.9; }
`;

const ClearBtn = styled.button`
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid #bbb;
  background: #fff;
  color: #555;
  border-radius: 5px;
  cursor: pointer;
  &:hover { background: #f4f4f4; }
`;

const SaveBtn = styled.button`
  padding: 5px 12px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid #1565c0;
  background: #1976d2;
  color: #fff;
  border-radius: 5px;
  cursor: pointer;
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: default; }
`;

const Info = styled.span`
  font-size: 11px;
  color: #555;
  max-width: 280px;
`;

const ResultMsg = styled.span<{ $err?: boolean }>`
  font-size: 11px;
  color: ${({ $err }) => ($err ? '#c62828' : '#2a8040')};
`;

/* ── controls component ───────────────────────────────────────────────── */

export function LickRegionControls({ picker }: { picker: LickRegionPicker }) {
  const { selectMode, toggleSelectMode, selectedRanges, setSelectedRanges, saving, saveResult, handleSaveLick } = picker;
  const n = selectedRanges.length;
  const summary = [...selectedRanges]
    .sort((a, b) => Math.min(...a) - Math.min(...b))
    .map(([lo, hi]) => {
      const a = Math.min(lo, hi) + 1;
      const b = Math.max(lo, hi) + 1;
      return a === b ? `${a}` : `${a}–${b}`;
    })
    .join(', ');

  return (
    <Row>
      <SelectBtn
        $active={selectMode}
        onClick={toggleSelectMode}
        title="구간 선택 모드 — 클릭(영역 토글), Shift+클릭(범위 확장). 여러 영역은 하나의 릭으로 합쳐집니다."
      >
        {selectMode ? '✓ Select Region' : 'Select Region'}
      </SelectBtn>
      <SaveBtn
        onClick={handleSaveLick}
        disabled={n === 0 || saving}
        title={n === 0 ? '먼저 구간을 선택하세요' : `선택한 ${n}개 영역을 하나의 lick으로 합쳐서 저장`}
      >
        {saving ? 'Saving…' : '💾 Save Lick'}
      </SaveBtn>
      {n > 0 && (
        <>
          <Info title={summary}>
            bars {summary}{n > 1 ? ` (${n} sections)` : ''}
          </Info>
          <ClearBtn onClick={() => setSelectedRanges([])} title="모든 선택 해제">
            Clear
          </ClearBtn>
        </>
      )}
      {saveResult && <ResultMsg $err={!saveResult.ok}>{saveResult.msg}</ResultMsg>}
    </Row>
  );
}
