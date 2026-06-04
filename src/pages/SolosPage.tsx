import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { exportScoreSvgToPdf } from '../lib/note/scoreToPdf';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { NoteSheet, type NoteSheetHandle } from '../components/notesheet/NoteSheet';
import { BpmControl, TransportButtons } from '../components/backing/BackingPlayerBar';
import {
  deleteSolo,
  listSolos,
  listSoloPerformers,
  getSolo,
  updateSolo,
  createSolo,
  createSoloViaOMR,
  getSoloOmrStatus,
  toWeimarKey,
  type SoloDraft,
  type SoloFacet,
  type SoloResponse,
} from '../api/solos';
import { useNotification } from '../contexts/NotificationContext';
import { buildMergedSoloDraft } from '../lib/mergeSolos';
import { OMRUploadModal } from '../components/common/OMRUploadModal';
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

const OMRBtn = styled.button`
  margin-left: auto;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  &:hover { opacity: 0.9; }
`;

const MergeDoBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 3px 12px;
  border: none;
  border-radius: 4px;
  background: #1f9a52;
  color: #fff;
  cursor: pointer;
  &:hover:not(:disabled) { background: #18803f; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;

/* Ordered pick indicator shown on each row while merging. */
const MergeCheck = styled.span<{ $picked?: boolean }>`
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 0.78rem;
  font-weight: 700;
  border: 2px solid ${({ $picked, theme }) => ($picked ? '#1f9a52' : theme.colors.border)};
  background: ${({ $picked }) => ($picked ? '#1f9a52' : 'transparent')};
  color: ${({ $picked }) => ($picked ? '#fff' : 'transparent')};
`;

const SplitArea = styled.div<{ $single?: boolean }>`
  display: grid;
  grid-template-columns: ${({ $single }) => ($single ? '1fr' : '380px minmax(0, 1fr)')};
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

const Row = styled.div<{ $active?: boolean; $merge?: boolean }>`
  display: grid;
  grid-template-columns: ${({ $merge }) => ($merge ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr) auto')};
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

/* Performer directory (shown before a performer is picked). */
const PerformerRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textPrimary};
  transition: background 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.bgPrimary}; }
  &:last-child { border-bottom: 0; }
`;

const PerformerName = styled.span`
  font-weight: 600;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CountBadge = styled.span`
  flex-shrink: 0;
  font-size: 0.74rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  padding: 2px 9px;
`;

const BackBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 3px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  white-space: nowrap;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const CurrentPerformer = styled.span`
  font-weight: 700;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textPrimary};
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
  const { notify } = useNotification();
  /* selectedPerformer: '' = none chosen → show the performer directory.
   * Clicking a performer fetches that performer's solos. */
  const [performers, setPerformers] = useState<SoloFacet[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);
  const [performerQuery, setPerformerQuery] = useState('');
  const [selectedPerformer, setSelectedPerformer] = useState('');
  const [filterInstrument, setFilterInstrument] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setPerformersLoading(true);
    listSoloPerformers()
      .then((facets) => {
        // backend already counts; sort by count desc then name for a stable directory
        const sorted = [...facets].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        setPerformers(sorted);
      })
      .catch(() => { /* 실패 시 빈 목록 유지 */ })
      .finally(() => setPerformersLoading(false));
  }, []);

  const visiblePerformers = useMemo(() => {
    const q = performerQuery.trim().toLowerCase();
    return q ? performers.filter((p) => p.name.toLowerCase().includes(q)) : performers;
  }, [performers, performerQuery]);

  const [solos, setSolos] = useState<SoloResponse[]>([]);
  const [page, setPage] = useState(0);
  const [isLast, setIsLast] = useState(true);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState('C');
  /* Solo preview playback — count-in + global player live inside NoteSheet;
   * we drive it via its imperative handle and mirror its play/tempo state so
   * the transport (Play/Stop + BPM) can sit in the preview header (same wiring
   * NotePage uses; NoteSheet's own floating bar is hidden via hideTransport). */
  const noteSheetRef = useRef<NoteSheetHandle | null>(null);
  const [soloPlaying, setSoloPlaying] = useState(false);
  const [soloTempo, setSoloTempo] = useState(120);
  const handleSoloPlayPause = useCallback(() => { noteSheetRef.current?.togglePlay(); }, []);
  const handleSoloStop = useCallback(() => { noteSheetRef.current?.stop(); }, []);
  const handleSoloTempo = useCallback((n: number) => { noteSheetRef.current?.setTempo(n); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [omrOpen, setOmrOpen] = useState(false);
  /* Merge mode: pick solos in click order (numbered 1,2,3…) → concatenate
   * their measures into one new solo. */
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
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
      // If the backend honored `performer`, filtered === content and we trust
      // its last/totalElements. If it ignored the filter (other performers
      // mixed in), fetching more pages would just repeat the situation — so
      // stop infinite scroll and count only what we actually kept, otherwise
      // the sentinel keeps pulling empty pages forever.
      const backendFiltered = filtered.length === data.content.length;
      setSolos((prev) => (nextPage === 0 ? filtered : [...prev, ...filtered]));
      setPage(nextPage + 1);
      setIsLast(data.last || !backendFiltered);
      setTotalElements((prev) =>
        backendFiltered
          ? data.totalElements
          : nextPage === 0 ? filtered.length : prev + filtered.length,
      );
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

  /* OMR upload → backend persists the Solo and returns it. Jump into the
   * Editor (solo mode) pre-loaded with the result so the user can review/edit
   * immediately, mirroring the lick OMR flow. (Same prefill shape as the row
   * "Edit" button — composer overridden with performer so re-save updates the
   * same solo rather than creating an "Unknown" copy.) */
  /** Open a fully-loaded solo in the Editor (solo mode), prefilled so re-save
   *  updates the same record. (composer ← performer mirrors the row Edit btn.) */
  const openSoloInEditor = useCallback((full: SoloResponse) => {
    const sheet = full.sheetData;
    navigate('/editor?mode=solo', {
      state: {
        prefillSheet: {
          ...sheet,
          composer: full.performer ?? sheet.composer ?? '',
          tempo: full.tempo ?? sheet.tempo,
          key: sheet.key,
        },
      },
    });
  }, [navigate]);

  /** Fetch a solo by id and open it; surfaces a toast on failure. Used by the
   *  "열기" action on the OMR-complete notification. */
  const fetchAndOpenSolo = useCallback(async (publicId: string) => {
    try {
      const full = await getSolo(publicId);
      if (!full?.sheetData?.measures?.length) {
        notify({ kind: 'error', title: '열기 실패', message: '악보 데이터를 받지 못했어요.' });
        return;
      }
      openSoloInEditor(full);
    } catch (e) {
      notify({
        kind: 'error',
        title: '열기 실패',
        message: e instanceof Error ? e.message : '솔로를 불러오지 못했어요.',
      });
    }
  }, [notify, openSoloInEditor]);

  /** Poll /v1/solos/{id}/omr-status in the background until OMR finishes, then
   *  raise a top-right toast. Fire-and-forget: the notification provider lives
   *  at the app root, so the toast still appears even if the user has navigated
   *  away from this page. Gives up after MAX_MS so a stuck job can't poll
   *  forever. */
  const pollSoloOmr = useCallback((publicId: string) => {
    const INTERVAL_MS = 2500;
    const MAX_MS = 5 * 60_000;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const st = await getSoloOmrStatus(publicId);
        if (st.status === 'COMPLETED') {
          notify({
            kind: 'success',
            title: 'OMR 완료',
            message: '솔로 악보 인식이 끝났어요.',
            action: { label: '열기', onClick: () => void fetchAndOpenSolo(publicId) },
          });
          return;
        }
        if (st.status === 'FAILED') {
          notify({
            kind: 'error',
            title: 'OMR 실패',
            message: st.failureReason ?? '악보 인식에 실패했어요.',
          });
          return;
        }
      } catch {
        /* best-effort — keep polling unless we've exceeded MAX_MS */
      }
      if (Date.now() - startedAt > MAX_MS) {
        notify({
          kind: 'info',
          title: 'OMR 지연',
          message: '처리가 오래 걸리고 있어요. 잠시 후 목록에서 확인해 주세요.',
        });
        return;
      }
      window.setTimeout(() => void tick(), INTERVAL_MS);
    };
    void tick();
  }, [notify, fetchAndOpenSolo]);

  const handleSoloOMRCreated = useCallback(async (solo: SoloResponse) => {
    setOmrOpen(false);
    // The OMR 201 response may be minimal (no sheetData yet) — either because
    // the response is trimmed OR because OMR is still running asynchronously on
    // the server. Re-fetch once by publicId to catch the "done, just trimmed"
    // case; if it's still empty, OMR is in flight → poll omr-status and toast
    // when it lands (no blocking alert).
    let full = solo;
    if ((!full?.sheetData || !full.sheetData.measures?.length) && solo?.publicId) {
      try {
        full = await getSolo(solo.publicId);
      } catch (e) {
        console.error('[solo OMR] getSolo로 전체 솔로 조회 실패:', e);
      }
    }
    if (full?.sheetData && full.sheetData.measures?.length) {
      openSoloInEditor(full);
      return;
    }
    if (!solo?.publicId) {
      notify({ kind: 'error', title: 'OMR 오류', message: '서버 응답에 식별자가 없어 진행 상태를 확인할 수 없어요.' });
      return;
    }
    // Still processing — let the user keep working; notify when finished.
    notify({
      kind: 'info',
      title: 'OMR 처리 중',
      message: '솔로 악보를 인식하고 있어요. 완료되면 알려드릴게요.',
    });
    pollSoloOmr(solo.publicId);
  }, [notify, openSoloInEditor, pollSoloOmr]);

  const toggleMergePick = useCallback((id: string) => {
    setMergeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitMergeMode = useCallback(() => {
    setMergeMode(false);
    setMergeIds([]);
  }, []);

  /* Concatenate the picked solos (in click order) into one new solo. Originals
   * are kept; the new merged solo is created via POST and surfaced at the top. */
  const handleMerge = useCallback(async () => {
    if (mergeIds.length < 2) return;
    const ordered = mergeIds
      .map((id) => solos.find((s) => s.publicId === id))
      .filter((s): s is SoloResponse => !!s);
    if (ordered.length < 2) return;
    setMergeBusy(true);
    setError(null);
    try {
      const created = await createSolo(buildMergedSoloDraft(ordered));
      exitMergeMode();
      await loadPage(selectedPerformer, 0);
      setSelectedId(created.publicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '솔로 합치기 실패');
      setTimeout(() => setError(null), 4000);
    } finally {
      setMergeBusy(false);
    }
  }, [mergeIds, solos, selectedPerformer, exitMergeMode, loadPage]);

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

  /* PDF 다운로드 — 화면에 렌더된 악보 SVG 를 고해상도 canvas 로 raster 한 뒤
   * jsPDF 페이지에 staff 단위로 배치해서 자동 다운로드한다 (scoreToPdf.ts).
   * 브라우저 렌더러가 음표/코드 폰트를 정확히 그리므로 깨지지 않고, 머리글·
   * 바닥글이 없으며, 빈 페이지 없이 1페이지부터 시작하고, 페이지 경계는 빈
   * 행에서 끊겨 staff 가 반토막 나지 않는다. */
  const handlePdfDownload = useCallback(async (solo: SoloResponse) => {
    setPdfBusy(solo.publicId);
    try {
      if (selectedId !== solo.publicId) {
        setSelectedId(solo.publicId);
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        await new Promise((r) => setTimeout(r, 350));
      }
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }

      // The score is the LARGEST <svg> in the preview (others are icons/glyphs).
      const allSvgs = Array.from(
        previewBodyRef.current?.querySelectorAll('svg') ?? [],
      ) as SVGSVGElement[];
      if (allSvgs.length === 0) throw new Error('악보가 준비되지 않았습니다.');
      const scoreSvg = allSvgs.reduce((best, s) => {
        const r = s.getBoundingClientRect();
        const b = best.getBoundingClientRect();
        return r.width * r.height > b.width * b.height ? s : best;
      });

      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim();
      const filename = `${safe(solo.performer ?? 'Unknown')} - ${safe(solo.title)}`;
      await exportScoreSvgToPdf(scoreSvg, filename, {
        title: solo.title,
        artist: solo.performer ?? undefined,
      });
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
              {!selectedPerformer ? (
                <>
                  <FilterLabel>연주자</FilterLabel>
                  <SearchInput
                    style={{ width: 220 }}
                    placeholder="연주자 검색..."
                    value={performerQuery}
                    onChange={(e) => setPerformerQuery(e.target.value)}
                  />
                  <CountText>
                    {performersLoading
                      ? '연주자 불러오는 중…'
                      : `${visiblePerformers.length.toLocaleString()} / ${performers.length.toLocaleString()} 연주자`}
                  </CountText>
                  <OMRBtn onClick={() => setOmrOpen(true)} title="악보 이미지를 업로드해 OMR로 솔로 생성">
                    📄 OMR로 생성하기
                  </OMRBtn>
                </>
              ) : (
                <>
                  <BackBtn onClick={() => handlePerformerChange('')}>← 전체 연주자</BackBtn>
                  <CurrentPerformer>{selectedPerformer}</CurrentPerformer>

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
                    placeholder="제목 / 앨범 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />

                  <RefreshBtn
                    onClick={() => loadPage(selectedPerformer, 0)}
                    disabled={loading}
                  >
                    {loading ? '불러오는 중…' : '새로고침'}
                  </RefreshBtn>

                  {mergeMode ? (
                    <>
                      <MergeDoBtn
                        onClick={handleMerge}
                        disabled={mergeIds.length < 2 || mergeBusy}
                      >
                        {mergeBusy ? '합치는 중…' : `합치기 (${mergeIds.length})`}
                      </MergeDoBtn>
                      <RefreshBtn onClick={exitMergeMode} disabled={mergeBusy}>취소</RefreshBtn>
                    </>
                  ) : (
                    <RefreshBtn onClick={() => setMergeMode(true)}>＋ 솔로 합치기</RefreshBtn>
                  )}

                  <CountText>
                    {mergeMode
                      ? '합칠 솔로를 순서대로 클릭하세요 (번호 순으로 이어붙임)'
                      : `${visibleList.length.toLocaleString()} / ${totalElements.toLocaleString()} solos${isLast ? '' : ' (스크롤로 더 불러오기)'}`}
                  </CountText>
                </>
              )}
            </ToolBar>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <SplitArea $single={!selectedPerformer}>
              <ListCard>
                <ListBody ref={listBodyRef}>
                  {!selectedPerformer ? (
                    performersLoading ? (
                      <EmptyState>연주자 목록 불러오는 중…</EmptyState>
                    ) : visiblePerformers.length === 0 ? (
                      <EmptyState>연주자가 없습니다.</EmptyState>
                    ) : (
                      visiblePerformers.map((p) => (
                        <PerformerRow key={p.name} onClick={() => handlePerformerChange(p.name)}>
                          <PerformerName title={p.name}>{p.name}</PerformerName>
                          <CountBadge>{p.count.toLocaleString()} solos</CountBadge>
                        </PerformerRow>
                      ))
                    )
                  ) : visibleList.length === 0 && loading ? (
                    <EmptyState>불러오는 중…</EmptyState>
                  ) : visibleList.length === 0 ? (
                    <EmptyState>조건에 맞는 솔로가 없습니다.</EmptyState>
                  ) : (
                    <>
                      {visibleList.map((s) => {
                        const mergeIdx = mergeIds.indexOf(s.publicId);
                        return (
                        <Row
                          key={s.publicId}
                          $active={mergeMode ? mergeIdx >= 0 : s.publicId === selectedId}
                          $merge={mergeMode}
                          onClick={() => (mergeMode ? toggleMergePick(s.publicId) : setSelectedId(s.publicId))}
                        >
                          {mergeMode && (
                            <MergeCheck $picked={mergeIdx >= 0}>
                              {mergeIdx >= 0 ? mergeIdx + 1 : ''}
                            </MergeCheck>
                          )}
                          <RowMain>
                            <RowTitle title={s.title}>{s.title}</RowTitle>
                            <RowSub>
                              {(s.performer ?? '—')} · {s.instrument} · {formatKeyDisplay(toWeimarKey(s.key ?? s.sheetData.key ?? 'C') ?? 'C-maj')}
                            </RowSub>
                          </RowMain>
                          {!mergeMode && (
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
                          )}
                        </Row>
                        );
                      })}
                      {!isLast && <Sentinel ref={sentinelRef} />}
                      {loading && visibleList.length > 0 && (
                        <EmptyState>더 불러오는 중…</EmptyState>
                      )}
                    </>
                  )}
                </ListBody>
              </ListCard>

              {selectedPerformer && (
              <PreviewCard>
                {selected ? (
                  <>
                    <PreviewHeader>
                      <PreviewTitle title={selected.title}>{selected.title}</PreviewTitle>
                      <PreviewMeta>
                        {(selected.performer ?? '—')} · {selected.instrument} · original {originalDisplayKey} · {selected.sheetData.measures.length} bars
                      </PreviewMeta>
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BpmControl tempo={soloTempo} onTempoChange={handleSoloTempo} />
                        <TransportButtons
                          playing={soloPlaying}
                          onPlayPause={handleSoloPlayPause}
                          onStop={handleSoloStop}
                        />
                      </div>
                    </PreviewHeader>
                    <PreviewBody ref={previewBodyRef}>
                      {previewSheet && (
                        <NoteSheet
                          ref={noteSheetRef}
                          data={previewSheet}
                          selectedKey={previewKey}
                          allKeys={allKeys}
                          onKeyChange={setPreviewKey}
                          lineStartMeasureNumbers
                          forceAutoStem
                          hideTransport
                          onPlayingChange={setSoloPlaying}
                          onTempoChange={setSoloTempo}
                        />
                      )}
                    </PreviewBody>
                  </>
                ) : (
                  <EmptyState>왼쪽에서 솔로를 선택해주세요.</EmptyState>
                )}
              </PreviewCard>
              )}
            </SplitArea>
          </CenterColumn>
        </MainArea>
      </RightSection>

      <OMRUploadModal
        open={omrOpen}
        onClose={() => setOmrOpen(false)}
        title="OMR로 솔로 생성"
        upload={createSoloViaOMR}
        onCreated={handleSoloOMRCreated}
      />
    </PageContainer>
  );
}
