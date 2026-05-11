/**
 * Reusable region-selection + "Save Lick" controls for admin tools.
 *
 * Any admin viewer that shows a NoteSheet (Symbolic Jazz Standards, Charlie
 * Parker Omnibook, etc.) can plug this in:
 *
 *   const picker = useLickRegionPicker({ sheetData, performer, title });
 *   <LickRegionControls picker={picker} />
 *   <NoteSheet
 *     data={sheetData}
 *     selectable={picker.selectMode}
 *     selectedRange={picker.selectedRange}
 *     onSelectionChange={picker.setSelectedRange}
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
  selectedRange: [number, number] | null;
  setSelectedRange: (r: [number, number] | null) => void;
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
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => {
      const next = !v;
      if (!next) setSelectedRange(null);
      return next;
    });
  }, []);

  const handleSaveLick = useCallback(async () => {
    if (!selectedRange) return;
    const lo = Math.min(...selectedRange);
    const hi = Math.max(...selectedRange);
    const slicedMeasures = sheetData.measures.slice(lo, hi + 1);
    if (slicedMeasures.length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const { createLick } = await import('../../api/licks');
      const { invalidateLicksCache, computeLickFeatures } = await import('../../data/lickData');
      const features = computeLickFeatures(slicedMeasures);
      const totalN = slicedMeasures.reduce(
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
        chords: slicedMeasures.map((m) => m.chord ?? '').filter(Boolean),
        nEvents: totalN,
        label: `${title} — bars ${lo + 1}-${hi + 1}`,
        sheetData: {
          title,
          composer: performer,
          key: lickKey,
          timeSignature: sheetData.timeSignature ?? '4/4',
          tempo: sheetData.tempo,
          measures: slicedMeasures,
        },
        ...features,
      });
      invalidateLicksCache();
      setSaveResult({
        ok: true,
        msg: `✓ Saved (id: ${String(persisted.id).slice(0, 8)}…)`,
      });
      setSelectedRange(null);
    } catch (e) {
      setSaveResult({ ok: false, msg: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
    }
  }, [selectedRange, sheetData, performer, title, instrument, tag]);

  return {
    selectMode,
    toggleSelectMode,
    selectedRange,
    setSelectedRange,
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
`;

const ResultMsg = styled.span<{ $err?: boolean }>`
  font-size: 11px;
  color: ${({ $err }) => ($err ? '#c62828' : '#2a8040')};
`;

/* ── controls component ───────────────────────────────────────────────── */

export function LickRegionControls({ picker }: { picker: LickRegionPicker }) {
  const { selectMode, toggleSelectMode, selectedRange, saving, saveResult, handleSaveLick } = picker;
  return (
    <Row>
      <SelectBtn
        $active={selectMode}
        onClick={toggleSelectMode}
        title="구간 선택 모드 — 악보에서 마디 클릭(범위는 Shift+클릭)"
      >
        {selectMode ? '✓ Select Region' : 'Select Region'}
      </SelectBtn>
      <SaveBtn
        onClick={handleSaveLick}
        disabled={!selectedRange || saving}
        title={selectedRange ? '선택 구간을 백엔드에 lick으로 저장' : '먼저 구간을 선택하세요'}
      >
        {saving ? 'Saving…' : '💾 Save Lick'}
      </SaveBtn>
      {selectedRange && (
        <Info>
          bars {Math.min(...selectedRange) + 1}–{Math.max(...selectedRange) + 1}
        </Info>
      )}
      {saveResult && <ResultMsg $err={!saveResult.ok}>{saveResult.msg}</ResultMsg>}
    </Row>
  );
}
