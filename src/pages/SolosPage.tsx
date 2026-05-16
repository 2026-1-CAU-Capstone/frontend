import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import type { TocEntry } from '../data/types';
import {
  loadAllSolos,
  invalidateSolosCache,
  removeSoloFromCache,
  updateSoloInCache,
} from '../data/soloData';
import {
  deleteSolo,
  updateSolo,
  toWeimarKey,
  type SoloDraft,
  type SoloResponse,
} from '../api/solos';
import {
  transposeLick,
  normalizeKeyInput,
  formatKeyDisplay,
} from '../lib/transpose';
import {
  ALL_KEYS_MAJOR,
  ALL_KEYS_MINOR,
  noteKeyIsMinor,
  normalizeNoteKeyDisplay,
  transposeNoteSheet,
} from '../lib/note/transposeNoteSheet';

/* ─── styled ─────────────────────────────────────────────────────────── */

const PageContainer = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
`;

const RightSection = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const MainArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const CenterColumn = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`;

const ToolBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  flex-wrap: wrap;

  ${mq.mobile} {
    gap: 6px;
    padding: 6px 10px;
  }
`;

const FilterSelect = styled.select`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  padding: 2px 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const FilterLabel = styled.label`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.78rem;
`;

const SearchInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.6; }
`;

const CountText = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: auto;
  font-size: 0.78rem;
`;

const RefreshBtn = styled.button`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  padding: 3px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const SplitArea = styled.div`
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  ${mq.mobile} {
    grid-template-columns: 1fr;
  }
`;

const ListCard = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
`;

const ListBody = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const Row = styled.div<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 9px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ $active, theme }) => ($active ? theme.colors.bgPrimary : 'transparent')};
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  &:hover {
    background: ${({ theme }) => theme.colors.bgPrimary};
  }
  &:last-child { border-bottom: 0; }
`;

const RowMain = styled.div`
  min-width: 0;
`;

const RowTitle = styled.div`
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowSub = styled.div`
  font-size: 0.74rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowActions = styled.div`
  display: flex;
  gap: 6px;
`;

const RowBtn = styled.button<{ $color?: string }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  padding: 4px 8px;
  border: 1px solid ${({ $color }) => $color ?? '#bbb'};
  background: transparent;
  color: ${({ $color }) => $color ?? '#444'};
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: rgba(0, 0, 0, 0.04); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PreviewCard = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
`;

const PreviewHeader = styled.div`
  padding: 10px 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const PreviewTitle = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PreviewMeta = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PreviewBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const EmptyState = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ErrorBanner = styled.div`
  margin: 10px 16px 0;
  padding: 8px 12px;
  border: 1px solid #e08080;
  border-radius: 6px;
  background: #fdecea;
  color: #a03022;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
`;

/* ─── component ─────────────────────────────────────────────────────── */

export default function SolosPage() {
  const navigate = useNavigate();

  const [solos, setSolos] = useState<SoloResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'user' | 'curated' | 'weimar'>('all');
  const [filterInstrument, setFilterInstrument] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState('C');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      if (force) invalidateSolosCache();
      const list = await loadAllSolos(force);
      setSolos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(false); }, [refresh]);

  const instruments = useMemo(
    () => [...new Set(solos.map((s) => s.instrument).filter(Boolean))].sort(),
    [solos],
  );

  const filtered = useMemo(() => {
    let list = solos;
    if (filterSource !== 'all') list = list.filter((s) => s.source === filterSource);
    if (filterInstrument) list = list.filter((s) => s.instrument === filterInstrument);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.performer || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [solos, filterSource, filterInstrument, searchQuery]);

  const selected = useMemo(
    () => (selectedId ? solos.find((s) => s.publicId === selectedId) ?? null : null),
    [solos, selectedId],
  );

  // Auto-select first row when filter/initial load changes
  useEffect(() => {
    if (!selected && filtered.length > 0) {
      setSelectedId(filtered[0].publicId);
    }
  }, [filtered, selected]);

  const originalDisplayKey = normalizeNoteKeyDisplay(selected?.sheetData.key ?? selected?.key ?? 'C');
  const allKeys = noteKeyIsMinor(originalDisplayKey) ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;

  useEffect(() => {
    setPreviewKey(originalDisplayKey);
  }, [selected?.publicId, originalDisplayKey]);

  const previewSheet = useMemo(() => {
    if (!selected) return null;
    const sheet = {
      ...selected.sheetData,
      title: selected.sheetData.title || selected.title,
      composer: selected.sheetData.composer || selected.performer || '',
      key: originalDisplayKey,
      tempo: selected.sheetData.tempo ?? selected.tempo ?? undefined,
      timeSignature: selected.sheetData.timeSignature ?? selected.timeSignature ?? '4/4',
    };
    return previewKey === sheet.key ? sheet : transposeNoteSheet(sheet, previewKey);
  }, [selected, previewKey, originalDisplayKey]);

  const handleDelete = useCallback(async (solo: SoloResponse) => {
    if (!window.confirm(`"${solo.performer ?? '—'} — ${solo.title}" 솔로를 삭제할까요?`)) return;
    try {
      await deleteSolo(solo.publicId);
      removeSoloFromCache(solo.publicId);
      setSolos((prev) => prev.filter((s) => s.publicId !== solo.publicId));
      if (selectedId === solo.publicId) setSelectedId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '삭제 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    }
  }, [selectedId]);

  /* Destructive transpose — change the stored key + every note + every chord
   * and PUT to backend. Mirrors LicksPage.handleTransposeLick. */
  const handleTranspose = useCallback(async (solo: SoloResponse) => {
    const fromWeimar = toWeimarKey(solo.key ?? solo.sheetData.key ?? 'C') ?? 'C-maj';
    const currentDisplay = formatKeyDisplay(fromWeimar);
    const input = window.prompt(
      `"${solo.performer ?? '—'} — ${solo.title}"\n` +
      `Original key: ${currentDisplay}\n` +
      `New key (e.g. Ab, F#m, Bb-maj):`,
      currentDisplay,
    );
    if (input === null) return;
    const newWeimar = normalizeKeyInput(input);
    if (!newWeimar) {
      alert(`Invalid key: "${input}"`);
      return;
    }
    if (newWeimar === fromWeimar) return;

    const result = transposeLick(solo.sheetData, solo.chords ?? [], fromWeimar, newWeimar);
    if (!result) {
      alert('Transpose failed (could not parse keys).');
      return;
    }

    setBusy(solo.publicId);
    try {
      const draft: SoloDraft = {
        source: solo.source,
        title: solo.title,
        instrument: solo.instrument,
        sheetData: result.sheetData,
        userId: solo.userId ?? null,
        sourceUrl: solo.sourceUrl ?? undefined,
        performer: solo.performer ?? undefined,
        album: solo.album ?? undefined,
        style: solo.style ?? undefined,
        tempo: solo.tempo ?? undefined,
        key: result.key,
        rhythmFeel: solo.rhythmFeel ?? undefined,
        timeSignature: solo.timeSignature ?? undefined,
        chords: result.chords.length > 0 ? result.chords : undefined,
        chordsPerNote: solo.chordsPerNote ?? undefined,
        harmonicContext: solo.harmonicContext ?? undefined,
        targetChord: solo.targetChord ?? undefined,
      };
      const updated = await updateSolo(solo.publicId, draft);
      updateSoloInCache(updated);
      setSolos((prev) => prev.map((s) => (s.publicId === solo.publicId ? updated : s)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transpose 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, []);

  const toc = useMemo<TocEntry[]>(
    () => [
      { title: 'Lick Database', page: 1 },
      { title: 'Solo Database', page: 2 },
    ],
    [],
  );

  const handleTocSelect = useCallback((page: number) => {
    if (page === 1) navigate('/licks');
  }, [navigate]);

  return (
    <PageContainer>
      <IconSidebar />
      <RightSection>
        <TopToolbar />

        <MainArea>
          <LeftSidebar toc={toc} activePage={2} onPageSelect={handleTocSelect} />

          <CenterColumn>
            <ToolBar>
              <FilterLabel>Source</FilterLabel>
              <FilterSelect
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
              >
                <option value="all">All</option>
                <option value="user">user</option>
                <option value="curated">curated</option>
                <option value="weimar">weimar</option>
              </FilterSelect>

              <FilterLabel>Instrument</FilterLabel>
              <FilterSelect
                value={filterInstrument}
                onChange={(e) => setFilterInstrument(e.target.value)}
              >
                <option value="">All ({instruments.length})</option>
                {instruments.map((i) => <option key={i} value={i}>{i}</option>)}
              </FilterSelect>

              <SearchInput
                style={{ width: 220 }}
                placeholder="제목 / 연주자 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <RefreshBtn onClick={() => refresh(true)} disabled={loading}>
                {loading ? '불러오는 중…' : '새로고침'}
              </RefreshBtn>

              <CountText>
                {loading
                  ? 'Loading...'
                  : `${filtered.length.toLocaleString()} / ${solos.length.toLocaleString()} solos`}
              </CountText>
            </ToolBar>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <SplitArea>
              <ListCard>
                <ListBody>
                  {loading && solos.length === 0 ? (
                    <EmptyState>불러오는 중…</EmptyState>
                  ) : filtered.length === 0 ? (
                    <EmptyState>조건에 맞는 솔로가 없습니다.</EmptyState>
                  ) : (
                    filtered.map((s) => (
                      <Row
                        key={s.publicId}
                        $active={s.publicId === selectedId}
                        onClick={() => setSelectedId(s.publicId)}
                      >
                        <RowMain>
                          <RowTitle title={s.title}>{s.title}</RowTitle>
                          <RowSub>
                            {(s.performer ?? '—')} · {s.instrument} · {formatKeyDisplay(toWeimarKey(s.key ?? s.sheetData.key ?? 'C') ?? 'C-maj')} · {s.source}
                          </RowSub>
                        </RowMain>
                        <RowActions>
                          <RowBtn
                            $color="#7b1fa2"
                            disabled={busy === s.publicId}
                            onClick={(e) => { e.stopPropagation(); handleTranspose(s); }}
                            title="Transpose (change original key & PUT to backend)"
                          >
                            {busy === s.publicId ? '⏳' : '⇋ Transpose'}
                          </RowBtn>
                          <RowBtn
                            $color="#c62828"
                            onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
                          >
                            🗑
                          </RowBtn>
                        </RowActions>
                      </Row>
                    ))
                  )}
                </ListBody>
              </ListCard>

              <PreviewCard>
                {selected ? (
                  <>
                    <PreviewHeader>
                      <PreviewTitle title={selected.title}>{selected.title}</PreviewTitle>
                      <PreviewMeta>
                        {(selected.performer ?? '—')} · {selected.instrument} · original {originalDisplayKey} · {selected.sheetData.measures.length} bars
                      </PreviewMeta>
                    </PreviewHeader>
                    <PreviewBody>
                      {previewSheet && (
                        <NoteSheet
                          data={previewSheet}
                          selectedKey={previewKey}
                          allKeys={allKeys}
                          onKeyChange={setPreviewKey}
                          showMeasureNumbers
                          forceAutoStem
                        />
                      )}
                    </PreviewBody>
                  </>
                ) : (
                  <EmptyState>왼쪽에서 솔로를 선택해주세요.</EmptyState>
                )}
              </PreviewCard>
            </SplitArea>
          </CenterColumn>
        </MainArea>
      </RightSection>
    </PageContainer>
  );
}
