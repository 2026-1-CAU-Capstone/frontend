import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import {
  deleteSolo,
  listSolos,
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


/* Large page size because the backend currently ignores the `performer`
 * query filter — we have to receive every solo and filter client-side, so
 * smaller pages would leave the target performer's rows on later pages
 * and show "no results" by accident. Safe while the catalog is small. */
const PAGE_SIZE = 500;

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
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  flex-wrap: wrap;

  ${mq.mobile} {
    gap: 6px;
    padding: 6px 10px;
  }
`;

const FilterSelect = styled.select`
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PreviewMeta = styled.div`
  font-family: 'Pretendard', sans-serif;
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
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Sentinel = styled.div`
  height: 1px;
`;

const ErrorBanner = styled.div`
  margin: 10px 16px 0;
  padding: 8px 12px;
  border: 1px solid #e08080;
  border-radius: 6px;
  background: #fdecea;
  color: #a03022;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
`;

/* ─── component ─────────────────────────────────────────────────────── */

export default function SolosPage() {
  const navigate = useNavigate();
  /* selectedPerformer: '' = none chosen (nothing fetched). Picking from the
   * dropdown triggers the first page fetch. */
  const [performers, setPerformers] = useState<string[]>([]);
  const [selectedPerformer, setSelectedPerformer] = useState('');
  const [filterInstrument, setFilterInstrument] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    listSolos({ size: 200, sort: 'performer,asc' })
      .then((data) => {
        const unique = [...new Set(
          data.content.map((s) => s.performer).filter((p): p is string => !!p),
        )].sort();
        setPerformers(unique);
      })
      .catch(() => { /* 실패 시 빈 목록 유지 */ });
  }, []);

  const [solos, setSolos] = useState<SoloResponse[]>([]);
  const [page, setPage] = useState(0);
  const [isLast, setIsLast] = useState(true);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState('C');
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const previewBodyRef = useRef<HTMLDivElement>(null);

  /* token so concurrent fetches (e.g. fast performer-switching) can be
   * discarded when stale. */
  const fetchTokenRef = useRef(0);

  const loadPage = useCallback(async (performer: string, nextPage: number) => {
    if (!performer) return;
    const myToken = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listSolos({
        page: nextPage,
        size: PAGE_SIZE,
        sort: 'title,asc',
        performer,
      });
      if (myToken !== fetchTokenRef.current) return;  // stale
      /* Defensive client-side filter — the backend may ignore `performer`,
       * in which case we still want only the picked performer's rows. */
      const filtered = data.content.filter((s) => s.performer === performer);
      setSolos((prev) => (nextPage === 0 ? filtered : [...prev, ...filtered]));
      setPage(nextPage + 1);
      setIsLast(data.last);
      setTotalElements(data.totalElements);
    } catch (e) {
      if (myToken !== fetchTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myToken === fetchTokenRef.current) setLoading(false);
    }
  }, []);

  /* Switch performer: reset list + fetch first page. Empty value = clear. */
  const handlePerformerChange = useCallback((p: string) => {
    setSelectedPerformer(p);
    setSolos([]);
    setPage(0);
    setIsLast(true);
    setTotalElements(0);
    setSelectedId(null);
    if (p) void loadPage(p, 0);
  }, [loadPage]);

  /* Client-side filters applied on top of the loaded (per-performer) pages. */
  const instruments = useMemo(
    () => [...new Set(solos.map((s) => s.instrument).filter(Boolean))].sort(),
    [solos],
  );

  const visibleList = useMemo(() => {
    let list = solos;
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
  }, [solos, filterInstrument, searchQuery]);

  const selected = useMemo(
    () => (selectedId ? solos.find((s) => s.publicId === selectedId) ?? null : null),
    [solos, selectedId],
  );

  useEffect(() => {
    if (!selected && visibleList.length > 0) {
      setSelectedId(visibleList[0].publicId);
    }
  }, [visibleList, selected]);

  /* Infinite scroll — fetch next page when sentinel enters viewport. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = listBodyRef.current;
    if (!el || !root || !selectedPerformer || isLast || loading) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading) {
          void loadPage(selectedPerformer, page);
        }
      },
      { root, rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [selectedPerformer, isLast, loading, page, loadPage]);

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
      setSolos((prev) => prev.filter((s) => s.publicId !== solo.publicId));
      setTotalElements((n) => Math.max(0, n - 1));
      if (selectedId === solo.publicId) setSelectedId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '삭제 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    }
  }, [selectedId]);

  /* PDF 다운로드 — 브라우저의 native print → "PDF 로 저장" 우회.
   *
   * html2canvas / SVG→Image→canvas 두 방식 모두 VexFlow 의 <use>/외부 폰트
   * reference 를 정확히 캡쳐 못 해서 음표가 깨지거나 빈 이미지가 나옴.
   * 대신 window.print() 는 브라우저 자체 렌더러가 화면 그대로를 PDF 로
   * 떨궈주므로 결과 100% 정확. UX 상 사용자가 인쇄 대화상자에서
   * "PDF 로 저장"을 선택해야 한다는 추가 단계는 있음.
   *
   * 동작:
   *   1) 해당 솔로 select → NoteSheet 렌더 대기
   *   2) document.fonts.ready 대기
   *   3) PreviewBody 에 .pdf-print-target 클래스 토글
   *   4) document.title 을 파일명으로 임시 변경 → 인쇄 다이얼로그 기본 파일명에 반영
   *   5) window.print() → afterprint 에서 원복 */
  const handlePdfDownload = useCallback(async (solo: SoloResponse) => {
    setPdfBusy(solo.publicId);
    try {
      if (selectedId !== solo.publicId) {
        setSelectedId(solo.publicId);
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        await new Promise((r) => setTimeout(r, 300));
      }
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }

      const target = previewBodyRef.current;
      if (!target) throw new Error('미리보기가 준비되지 않았습니다.');

      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim();
      const filename = `${safe(solo.performer ?? 'Unknown')} - ${safe(solo.title)}`;
      const originalTitle = document.title;

      target.classList.add('pdf-print-target');
      document.title = filename;

      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        target.classList.remove('pdf-print-target');
        document.title = originalTitle;
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);

      /* trigger native print dialog */
      window.print();

      /* Fallback — 일부 브라우저(특히 Safari)는 afterprint 가 늦거나 안 뜸 */
      setTimeout(cleanup, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF 생성 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setPdfBusy(null);
    }
  }, [selectedId]);

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
      setSolos((prev) => prev.map((s) => (s.publicId === solo.publicId ? updated : s)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transpose 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <PageContainer>
      <IconSidebar />
      <RightSection>
        <TopToolbar />

        <MainArea>
          <CenterColumn>
            <ToolBar>
              <FilterLabel>Performer</FilterLabel>
              <FilterSelect
                value={selectedPerformer}
                onChange={(e) => handlePerformerChange(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {performers.map((p) => <option key={p} value={p}>{p}</option>)}
              </FilterSelect>

              <FilterLabel>Instrument</FilterLabel>
              <FilterSelect
                value={filterInstrument}
                onChange={(e) => setFilterInstrument(e.target.value)}
                disabled={!selectedPerformer}
              >
                <option value="">All ({instruments.length})</option>
                {instruments.map((i) => <option key={i} value={i}>{i}</option>)}
              </FilterSelect>

              <SearchInput
                style={{ width: 220 }}
                placeholder="제목 / 연주자 / 앨범 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={!selectedPerformer}
              />

              <RefreshBtn
                onClick={() => selectedPerformer && loadPage(selectedPerformer, 0)}
                disabled={loading || !selectedPerformer}
              >
                {loading ? '불러오는 중…' : '새로고침'}
              </RefreshBtn>

              <CountText>
                {!selectedPerformer
                  ? '연주자를 선택하세요'
                  : `${visibleList.length.toLocaleString()} / ${totalElements.toLocaleString()} solos${isLast ? '' : ' (스크롤로 더 불러오기)'}`}
              </CountText>
            </ToolBar>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <SplitArea>
              <ListCard>
                <ListBody ref={listBodyRef}>
                  {!selectedPerformer ? (
                    <EmptyState>위에서 연주자를 선택해주세요.</EmptyState>
                  ) : visibleList.length === 0 && loading ? (
                    <EmptyState>불러오는 중…</EmptyState>
                  ) : visibleList.length === 0 ? (
                    <EmptyState>조건에 맞는 솔로가 없습니다.</EmptyState>
                  ) : (
                    <>
                      {visibleList.map((s) => (
                        <Row
                          key={s.publicId}
                          $active={s.publicId === selectedId}
                          onClick={() => setSelectedId(s.publicId)}
                        >
                          <RowMain>
                            <RowTitle title={s.title}>{s.title}</RowTitle>
                            <RowSub>
                              {(s.performer ?? '—')} · {s.instrument} · {formatKeyDisplay(toWeimarKey(s.key ?? s.sheetData.key ?? 'C') ?? 'C-maj')}
                            </RowSub>
                          </RowMain>
                          <RowActions>
                            <RowBtn
                              $color="#1976d2"
                              onClick={(e) => {
                                e.stopPropagation();
                                /* Hand the solo's NoteSheetData to EditorPage
                                 * via location.state.prefillSheet.
                                 *
                                 * IMPORTANT: backend stores `performer` at the
                                 * solo's top level, but its `sheetData.composer`
                                 * may be null. EditorPage.handleSave matches
                                 * existing solos by (sheetTitle + composer);
                                 * if composer ends up empty the save creates a
                                 * fresh "Unknown" copy instead of updating
                                 * this row. Override composer with performer
                                 * so re-save updates the SAME solo. */
                                const prefill = {
                                  ...s.sheetData,
                                  composer: s.performer ?? s.sheetData.composer ?? '',
                                  tempo: s.tempo ?? s.sheetData.tempo,
                                  key: s.sheetData.key,
                                };
                                navigate('/editor?mode=solo', {
                                  state: { prefillSheet: prefill },
                                });
                              }}
                              title="Open this solo in the Editor"
                            >
                              ✏ Edit
                            </RowBtn>
                            <RowBtn
                              $color="#388e3c"
                              disabled={pdfBusy === s.publicId}
                              onClick={(e) => { e.stopPropagation(); handlePdfDownload(s); }}
                              title="Download this solo as PDF"
                            >
                              {pdfBusy === s.publicId ? '⏳' : '📄 PDF'}
                            </RowBtn>
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
                      ))}
                      {!isLast && <Sentinel ref={sentinelRef} />}
                      {loading && visibleList.length > 0 && (
                        <EmptyState>더 불러오는 중…</EmptyState>
                      )}
                    </>
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
                    <PreviewBody ref={previewBodyRef}>
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
