import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
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
import type { OMRMetadata } from '../api/licks';
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
import { bakeExplicitAccidentals } from '../lib/note/resolvePitches';
import type { LickEntry } from '../data/lickData';


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

/* 구간 선택 토글 — 켜져 있는 동안 마디 클릭이 선택으로 동작. */
const SelModeBtn = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 4px 12px;
  border: 1.5px solid ${({ $on }) => ($on ? '#1f9a52' : 'rgba(0,0,0,0.18)')};
  border-radius: 5px;
  background: ${({ $on }) => ($on ? 'rgba(31,154,82,0.12)' : 'transparent')};
  color: ${({ $on }) => ($on ? '#17773e' : '#444')};
  cursor: pointer;
  white-space: nowrap;
  &:hover { border-color: #1f9a52; }
`;

/* 구간 선택 모드 안내줄 — 프리뷰 헤더 바로 아래. */
const SelHintBar = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  color: #17773e;
  background: rgba(31, 154, 82, 0.08);
  border-bottom: 1px solid rgba(31, 154, 82, 0.25);
  padding: 5px 12px;
  flex-shrink: 0;
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

/** Monospace publicId chip under the sub-line. Click to copy the full key. */
const SoloIdChip = styled.button<{ $copied?: boolean }>`
  margin-top: 3px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 0.68rem;
  line-height: 1.2;
  color: ${({ $copied, theme }) => ($copied ? '#1f9a52' : theme.colors.textSecondary)};
  opacity: 0.85;
  &:hover { color: ${({ theme }) => theme.colors.gold}; opacity: 1; }
  & > span.id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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

/* ─── OMR status panel ──────────────────────────────────────────────────
 * A persistent, always-visible panel (bottom-right) that shows every
 * in-flight / just-finished OMR solo job in real time: 인식 중 → 완료 / 오류.
 * Fed by the background OMR flow (createSoloViaOMR promise) and, when the
 * backend /omr-status endpoint is available, live progress polling. */

const spin = keyframes`to { transform: rotate(360deg); }`;
/* Indeterminate sweep for the progress track while OMR is running and the
 * backend reports no numeric progress (0). */
const indeterminate = keyframes`
  0%   { left: -35%; width: 35%; }
  60%  { left: 100%; width: 35%; }
  100% { left: 100%; width: 35%; }
`;

const OmrPanel = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: ${({ theme }) => theme.zIndex.toast};
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(340px, calc(100vw - 32px));
  ${mq.mobile} { right: 10px; bottom: 10px; }
`;

const OmrCard = styled.div<{ $status: 'PROCESSING' | 'COMPLETED' | 'FAILED' }>`
  border: 1px solid
    ${({ $status }) =>
      $status === 'FAILED' ? '#e0a0a0' : $status === 'COMPLETED' ? '#a3d9b8' : '#e6d3a0'};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: ${({ theme }) => theme.shadows.md};
  padding: 12px 14px;
  font-family: 'Pretendard', sans-serif;
`;

const OmrTop = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const OmrIcon = styled.span<{ $status: 'PROCESSING' | 'COMPLETED' | 'FAILED' }>`
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  ${({ $status }) =>
    $status === 'PROCESSING' &&
    css`
      border: 2px solid rgba(180, 134, 11, 0.25);
      border-top-color: #B8860B;
      border-radius: 50%;
      animation: ${spin} 0.8s linear infinite;
    `}
  color: ${({ $status }) => ($status === 'FAILED' ? '#c0392b' : $status === 'COMPLETED' ? '#1f9a52' : 'inherit')};
`;

const OmrLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OmrDismiss = styled.button`
  flex: none;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const OmrStatusText = styled.div<{ $status: 'PROCESSING' | 'COMPLETED' | 'FAILED' }>`
  margin-top: 6px;
  font-size: 0.78rem;
  color: ${({ $status, theme }) =>
    $status === 'FAILED' ? '#c0392b' : $status === 'COMPLETED' ? '#17773e' : theme.colors.textSecondary};
  word-break: break-word;
`;

const OmrBar = styled.div`
  position: relative;
  margin-top: 8px;
  height: 5px;
  border-radius: 3px;
  background: rgba(180, 134, 11, 0.14);
  overflow: hidden;
`;

const OmrBarFill = styled.div<{ $progress: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: #B8860B;
  ${({ $progress }) =>
    $progress > 0
      ? css`left: 0; width: ${Math.min(100, Math.max(0, $progress))}%; transition: width 0.4s ease;`
      : css`animation: ${indeterminate} 1.3s ease-in-out infinite;`}
`;

const OmrOpenBtn = styled.button`
  margin-top: 10px;
  width: 100%;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  background: #1f9a52;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #18803f; }
`;

/** One OMR job tracked by the status panel. `progress` 0 ⇒ indeterminate bar. */
interface SoloOmrJob {
  id: string;
  label: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  failureReason?: string | null;
  publicId?: string;
  solo?: SoloResponse;
}

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

  const refreshPerformers = useCallback(() => {
    setPerformersLoading(true);
    return listSoloPerformers()
      .then((facets) => {
        // backend already counts; sort by count desc then name for a stable directory
        const sorted = [...facets].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        setPerformers(sorted);
      })
      .catch(() => { /* 실패 시 빈 목록 유지 */ })
      .finally(() => setPerformersLoading(false));
  }, []);

  useEffect(() => { void refreshPerformers(); }, [refreshPerformers]);

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyId = useCallback((id: string) => {
    const done = () => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    };
    // navigator.clipboard needs a secure context; fall back to a temp textarea.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(id).then(done).catch(() => {
        try {
          const ta = document.createElement('textarea');
          ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy');
          document.body.removeChild(ta); done();
        } catch { /* ignore */ }
      });
    }
  }, []);
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
  /* Live OMR status panel: one card per in-flight / just-finished job. */
  const [omrJobs, setOmrJobs] = useState<SoloOmrJob[]>([]);
  /* Merge mode: pick solos in click order (numbered 1,2,3…) → concatenate
   * their measures into one new solo. */
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const previewBodyRef = useRef<HTMLDivElement>(null);
  /* 구간 선택 → 릭 저장: NoteSheet 의 selectable/selectedRanges 프리미티브에
   * 연결. 인덱스는 현재 표시 중인 previewSheet.measures 기준(이조돼도 마디
   * 수는 불변이라 유지 가능; 솔로가 바뀌면 초기화). */
  const [lickSelectMode, setLickSelectMode] = useState(false);
  const [lickRanges, setLickRanges] = useState<Array<[number, number]>>([]);
  const [lickSaving, setLickSaving] = useState(false);

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

  const originalDisplayKey = normalizeNoteKeyDisplay(selected?.sheetData?.key ?? selected?.key ?? 'C');
  const allKeys = noteKeyIsMinor(originalDisplayKey) ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;

  // The list endpoint returns metadata-only rows (no sheetData). When a solo is
  // selected for preview, fetch the full record and merge it into `solos` so the
  // preview/transpose has measures to work with. Re-running after the merge is a
  // no-op (sheetData now present), so this self-terminates without a loop.
  useEffect(() => {
    if (!selected || (selected.sheetData?.measures?.length ?? 0) > 0) return;
    let cancelled = false;
    getSolo(selected.publicId)
      .then((full) => {
        if (cancelled || !full?.sheetData) return;
        setSolos((prev) => prev.map((s) => (s.publicId === full.publicId ? full : s)));
      })
      .catch(() => { /* preview stays empty until retry; non-fatal */ });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    setPreviewKey(originalDisplayKey);
  }, [selected?.publicId, originalDisplayKey]);

  /* 다른 솔로로 이동하면 진행 중이던 구간 선택은 무효 — 초기화. */
  useEffect(() => {
    setLickSelectMode(false);
    setLickRanges([]);
  }, [selected?.publicId]);

  const previewSheet = useMemo(() => {
    // List items arrive metadata-only (no sheetData) — the selection effect
    // below fetches the full solo and merges it in, after which this recomputes.
    if (!selected?.sheetData) return null;
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

  /* 선택된 마디 수(중복 제거) — 저장 버튼 라벨/활성화용. */
  const lickSelCount = useMemo(() => {
    if (lickRanges.length === 0 || !previewSheet) return 0;
    const seen = new Set<number>();
    for (const [a, b] of lickRanges) {
      const lo = Math.max(0, Math.min(a, b));
      const hi = Math.min(previewSheet.measures.length - 1, Math.max(a, b));
      for (let i = lo; i <= hi; i++) seen.add(i);
    }
    return seen.size;
  }, [lickRanges, previewSheet]);

  /** 선택 구간을 "지금 화면에 보이는 그대로"(이조 반영) 릭으로 백엔드에 저장.
   *  악보(score) 임시표 의미론을 explicit 으로 구운 뒤 저장 — 릭 렌더러/플레이어
   *  (LickCard, non-courtesy)와 데이터 의미가 정확히 일치해야 반음이 안 틀린다. */
  const handleSaveLickFromSelection = useCallback(async () => {
    if (!selected || !previewSheet || lickSaving) return;
    // 범위 병합 → 오름차순 마디 인덱스 (Cmd/Ctrl 다중 구간도 순서대로 이어붙임)
    const seen = new Set<number>();
    const idxs: number[] = [];
    const sorted = [...lickRanges]
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    for (const [lo, hi] of sorted) {
      for (let i = Math.max(0, lo); i <= Math.min(previewSheet.measures.length - 1, hi); i++) {
        if (!seen.has(i)) { seen.add(i); idxs.push(i); }
      }
    }
    if (idxs.length === 0) return;
    const LICK_MAX_BARS = 8;
    if (idxs.length > LICK_MAX_BARS) {
      notify({ kind: 'error', title: '릭 저장 불가', message: `릭은 최대 ${LICK_MAX_BARS}마디예요 — 지금 ${idxs.length}마디가 선택돼 있어요.` });
      return;
    }
    // 마디 통째 슬라이스 + 경계 정리: 구조 마커(도돌이/볼타/내비/브래킷)와
    // 구간 밖으로 이어지던 tie/gliss 는 릭에서 무의미하므로 제거.
    const sliced = idxs.map((i) => {
      const m = previewSheet.measures[i];
      const { repeatStart, repeatEnd, volta, navigation, bracket, anacrusis, ...rest } = m;
      void repeatStart; void repeatEnd; void volta; void navigation; void bracket; void anacrusis;
      return { ...rest, notes: m.notes.map((n) => ({ ...n })) };
    });
    const firstNotes = sliced[0].notes;
    if (firstNotes.length > 0) delete firstNotes[0].tieContinuation;
    const lastNotes = sliced[sliced.length - 1].notes;
    if (lastNotes.length > 0) {
      delete lastNotes[lastNotes.length - 1].tie;
      delete lastNotes[lastNotes.length - 1].gliss;
    }
    const baked = bakeExplicitAccidentals(sliced, previewSheet.key);
    const totalN = baked.reduce((s, m) => s + m.notes.filter((n) => !n.duration.endsWith('r')).length, 0);
    if (totalN === 0) {
      notify({ kind: 'error', title: '릭 저장 불가', message: '선택 구간에 음표가 없어요.' });
      return;
    }
    const rangeLabel = idxs.length === 1 ? `m.${idxs[0] + 1}` : `m.${idxs[0] + 1}–${idxs[idxs.length - 1] + 1}`;
    const title = `${selected.title} (${rangeLabel})`;
    const chords = baked.map((m) => m.chord ?? '');
    setLickSaving(true);
    try {
      const { computeLickFeatures, saveUserLick, invalidateLicksCache } = await import('../data/lickData');
      const { createLick } = await import('../api/licks');
      const entry: LickEntry = {
        id: Date.now(),
        performer: selected.performer || 'Unknown',
        title,
        album: selected.album ?? '',
        instrument: selected.instrument || '',
        style: selected.style ?? '',
        tempo: selected.tempo ?? previewSheet.tempo ?? null,
        key: previewSheet.key,
        rhythmfeel: selected.rhythmFeel ?? '',
        tag: 'solo-excerpt',
        chords,
        nEvents: totalN,
        label: `${selected.performer || 'Unknown'} — ${title}${chords.filter(Boolean).length ? ` (${chords.filter(Boolean).join(' → ')})` : ''}`,
        sheetData: {
          title,
          composer: selected.performer ?? '',
          key: previewSheet.key,
          timeSignature: previewSheet.timeSignature || '4/4',
          tempo: previewSheet.tempo,
          measures: baked,
        },
        ...computeLickFeatures(baked),
      };
      const persisted = await createLick(entry);
      invalidateLicksCache();
      saveUserLick(persisted);
      notify({ kind: 'success', title: '릭 저장 완료', message: `${selected.title} ${rangeLabel} · ${idxs.length}마디를 릭으로 저장했어요.` });
      setLickRanges([]);
      setLickSelectMode(false);
    } catch (e) {
      notify({ kind: 'error', title: '릭 저장 실패', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLickSaving(false);
    }
  }, [selected, previewSheet, lickRanges, lickSaving, notify]);

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

  /** Row "Edit" — the row may be metadata-only (no sheetData), so fetch the
   *  full solo first, then open the Editor prefilled (composer ← performer so
   *  re-save updates the same record). */
  const editRow = useCallback(async (row: SoloResponse) => {
    let s = row;
    if (!s.sheetData?.measures?.length) {
      try {
        const full = await getSolo(s.publicId);
        if (full?.sheetData) s = full;
      } catch { /* guarded below */ }
    }
    if (!s.sheetData) { alert('악보 데이터를 불러오지 못했습니다.'); return; }
    navigate('/editor?mode=solo', {
      state: {
        prefillSheet: {
          ...s.sheetData,
          composer: s.performer ?? s.sheetData.composer ?? '',
          tempo: s.tempo ?? s.sheetData.tempo,
          key: s.sheetData.key,
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

  /* ── OMR status panel: background jobs ─────────────────────────────────
   * OMR runs in the background (modal closes on submit) and each job shows a
   * live status card via the panel at the bottom-right. The authoritative
   * terminal signal is the createSoloViaOMR promise; /omr-status polling only
   * fills in progress % / early completion when the backend supports it
   * (currently the solos endpoint may 500 — handled gracefully). */

  // setState guard: the detached upload promise can resolve after the page
  // unmounts (user navigated away) — don't setState then.
  const mountedRef = useRef(true);
  // Set true in the effect BODY (not just useRef's initial value): React
  // StrictMode runs mount effects setup→cleanup→setup, so relying on the
  // initial value leaves mountedRef stuck at false after the first cleanup,
  // which made upsertOmrJob bail out and the panel never appear.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const upsertOmrJob = useCallback((id: string, patch: Partial<SoloOmrJob>) => {
    if (!mountedRef.current) return;
    setOmrJobs((prev) => {
      const i = prev.findIndex((j) => j.id === id);
      if (i === -1) {
        return [...prev, { id, label: '새 솔로', status: 'PROCESSING', progress: 0, ...patch }];
      }
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  /* publicId → pending timeout. 동일 솔로 중복 폴러 방지 + 정리 가능하게 추적. */
  const omrPollersRef = useRef<Map<string, number>>(new Map());
  const dismissOmrJob = useCallback((id: string) => {
    setOmrJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.publicId) {
        const t = omrPollersRef.current.get(job.publicId);
        if (t) { window.clearTimeout(t); omrPollersRef.current.delete(job.publicId); }
      }
      return prev.filter((j) => j.id !== id);
    });
  }, []);
  useEffect(() => () => {
    // 언마운트: 모든 폴러 정지
    omrPollersRef.current.forEach((t) => window.clearTimeout(t));
    omrPollersRef.current.clear();
  }, []);

  /** Best-effort poll of /v1/solos/{id}/omr-status → updates the job card's
   *  progress/status. The solos endpoint may be unavailable (500); such errors
   *  are swallowed and the card stays "인식 중" until the promise or MAX_MS
   *  resolves it — so a broken status endpoint never hangs a card forever. */
  const pollSoloOmrIntoJob = useCallback((jobId: string, publicId: string) => {
    const INTERVAL_MS = 5000; // OMR takes tens of seconds — slow poll keeps the request rate low
    const MAX_MS = 5 * 60_000;
    if (omrPollersRef.current.has(publicId)) return; // 중복 폴러 방지
    const startedAt = Date.now();
    const tick = async () => {
      omrPollersRef.current.delete(publicId);
      try {
        const st = await getSoloOmrStatus(publicId);
        if (st.status === 'COMPLETED') {
          upsertOmrJob(jobId, { status: 'COMPLETED', progress: 100, publicId });
          void refreshPerformers();
          return;
        }
        if (st.status === 'FAILED') {
          upsertOmrJob(jobId, { status: 'FAILED', failureReason: st.failureReason ?? '악보 인식에 실패했어요.' });
          return;
        }
        if (st.progress > 0) upsertOmrJob(jobId, { progress: st.progress });
      } catch (e) {
        // 인증 만료(401/403)면 더 폴링해도 영원히 실패 — 즉시 종료.
        const msg = e instanceof Error ? e.message : '';
        if (/\b401\b|\b403\b/.test(msg)) return;
        /* 그 외(엔드포인트 500 등) — 무시하고 계속: 완료는 아래 MAX_MS 또는 promise가 확정한다 */
      }
      if (Date.now() - startedAt > MAX_MS) {
        upsertOmrJob(jobId, {
          status: 'FAILED',
          failureReason: '처리 상태를 확인하지 못했어요. 목록에서 다시 확인해 주세요.',
        });
        return;
      }
      const t = window.setTimeout(() => void tick(), INTERVAL_MS);
      omrPollersRef.current.set(publicId, t);
    };
    void tick();
  }, [upsertOmrJob, refreshPerformers]);

  /* Kick off a background OMR job from the modal's onBackgroundStart. */
  const omrJobSeq = useRef(0);
  const startSoloOmrJob = useCallback(async (file: File, metadata: OMRMetadata) => {
    const id = `omr-${Date.now()}-${omrJobSeq.current++}`;
    const label = metadata.title?.trim() || metadata.performer?.trim() || file.name || '새 솔로';
    upsertOmrJob(id, { id, label, status: 'PROCESSING', progress: 0 });
    try {
      const solo = await createSoloViaOMR(file, metadata);
      if (solo?.sheetData?.measures?.length) {
        upsertOmrJob(id, { status: 'COMPLETED', progress: 100, publicId: solo.publicId, solo });
        void refreshPerformers(); // 새 솔로가 연주자 목록에 바로 반영되게
        return;
      }
      if (solo?.publicId) {
        // Response minimal — one full fetch to catch "done, just trimmed",
        // else OMR is in flight → poll (best-effort).
        try {
          const full = await getSolo(solo.publicId);
          if (full?.sheetData?.measures?.length) {
            upsertOmrJob(id, { status: 'COMPLETED', progress: 100, publicId: full.publicId, solo: full });
            void refreshPerformers();
            return;
          }
        } catch { /* fall through to poll */ }
        upsertOmrJob(id, { publicId: solo.publicId });
        pollSoloOmrIntoJob(id, solo.publicId);
        return;
      }
      upsertOmrJob(id, { status: 'FAILED', failureReason: '서버 응답에 악보 데이터가 없어요.' });
    } catch (e) {
      upsertOmrJob(id, { status: 'FAILED', failureReason: e instanceof Error ? e.message : 'OMR 인식 실패' });
    }
  }, [upsertOmrJob, pollSoloOmrIntoJob, refreshPerformers]);

  /* Panel "에디터로 열기" — open the finished solo, then clear its card. */
  const openOmrJob = useCallback((job: SoloOmrJob) => {
    if (job.solo?.sheetData?.measures?.length) openSoloInEditor(job.solo);
    else if (job.publicId) void fetchAndOpenSolo(job.publicId);
    dismissOmrJob(job.id);
  }, [openSoloInEditor, fetchAndOpenSolo, dismissOmrJob]);

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
      // 1) sheetData 보장 — 목록 행은 metadata-only일 수 있다. 고정 350ms 대기는
      //    fetch+렌더가 그보다 느리면 실패했고, 이미 선택된 행이라도 getSolo가
      //    아직 머지 전이면(분기 미진입) 거의 항상 실패했다. 직접 await로 해소.
      if (!solo.sheetData) {
        const full = await getSolo(solo.publicId);
        setSolos((prev) => prev.map((s) => (s.publicId === full.publicId ? full : s)));
        solo = full;
      }
      if (selectedId !== solo.publicId) setSelectedId(solo.publicId);
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }

      // 2) 악보 SVG가 실제로 그려질 때까지 폴링 (최대 ~5s). "가장 큰 svg"가
      //    아이콘 수준 크기면 아직 악보가 아니다 — 최소 면적으로 검증.
      const MIN_SCORE_AREA = 40_000; // px² — 아이콘(수백)과 악보(수십만)의 중간
      const findScoreSvg = (): SVGSVGElement | null => {
        const all = Array.from(
          previewBodyRef.current?.querySelectorAll('svg') ?? [],
        ) as SVGSVGElement[];
        if (all.length === 0) return null;
        const best = all.reduce((b, s) => {
          const r = s.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return r.width * r.height > rb.width * rb.height ? s : b;
        });
        const br = best.getBoundingClientRect();
        return br.width * br.height >= MIN_SCORE_AREA ? best : null;
      };
      let scoreSvg = findScoreSvg();
      for (let i = 0; i < 50 && !scoreSvg; i++) {
        await new Promise((r) => setTimeout(r, 100));
        scoreSvg = findScoreSvg();
      }
      if (!scoreSvg) throw new Error('악보가 준비되지 않았습니다.');

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

  const handleTranspose = useCallback(async (row: SoloResponse) => {
    // Row may be metadata-only (no sheetData) — fetch the full solo first.
    let solo = row;
    if (!solo.sheetData?.measures?.length) {
      try {
        const full = await getSolo(solo.publicId);
        if (full?.sheetData) solo = full;
      } catch { /* fall through — guarded below */ }
    }
    if (!solo.sheetData) { alert('악보 데이터를 불러오지 못했습니다.'); return; }
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
                              {(s.performer ?? '—')} · {s.instrument} · {formatKeyDisplay(toWeimarKey(s.key ?? s.sheetData?.key ?? 'C') ?? 'C-maj')}
                            </RowSub>
                            <SoloIdChip
                              type="button"
                              $copied={copiedId === s.publicId}
                              title="고유 키 복사"
                              onClick={(e) => { e.stopPropagation(); copyId(String(s.publicId)); }}
                            >
                              <span className="id">{s.publicId}</span>
                              <span aria-hidden>{copiedId === s.publicId ? '✓ 복사됨' : '📋'}</span>
                            </SoloIdChip>
                          </RowMain>
                          {!mergeMode && (
                          <RowActions>
                            <RowBtn
                              $color="#1976d2"
                              onClick={(e) => { e.stopPropagation(); void editRow(s); }}
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
                        {(selected.performer ?? '—')} · {selected.instrument} · original {originalDisplayKey}{selected.sheetData?.measures?.length ? ` · ${selected.sheetData.measures.length} bars` : ''}
                      </PreviewMeta>
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SelModeBtn
                          type="button"
                          $on={lickSelectMode}
                          onClick={() => {
                            setLickSelectMode((v) => {
                              if (v) setLickRanges([]); // 끌 때 선택도 정리
                              return !v;
                            });
                          }}
                        >
                          {lickSelectMode ? '구간 선택 종료' : '구간 선택'}
                        </SelModeBtn>
                        {lickSelectMode && lickSelCount > 0 && (
                          <>
                            <MergeDoBtn
                              type="button"
                              disabled={lickSaving}
                              onClick={() => { void handleSaveLickFromSelection(); }}
                            >
                              {lickSaving ? '저장 중…' : `릭으로 저장 (${lickSelCount}마디)`}
                            </MergeDoBtn>
                            <RefreshBtn type="button" onClick={() => setLickRanges([])}>
                              선택 해제
                            </RefreshBtn>
                          </>
                        )}
                        <BpmControl tempo={soloTempo} onTempoChange={handleSoloTempo} />
                        <TransportButtons
                          playing={soloPlaying}
                          onPlayPause={handleSoloPlayPause}
                          onStop={handleSoloStop}
                        />
                      </div>
                    </PreviewHeader>
                    {lickSelectMode && (
                      <SelHintBar>
                        마디를 클릭해 구간을 선택하세요 — Shift+클릭: 범위 확장 · 다시 클릭: 해제 · 최대 8마디
                      </SelHintBar>
                    )}
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
                          lockSwing
                          onPlayingChange={setSoloPlaying}
                          onTempoChange={setSoloTempo}
                          selectable={lickSelectMode}
                          selectedRanges={lickRanges}
                          onSelectionChange={setLickRanges}
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
        submitLabel="인식 시작 (백그라운드)"
        upload={createSoloViaOMR}
        onBackgroundStart={startSoloOmrJob}
      />

      {omrJobs.length > 0 && (
        <OmrPanel role="status" aria-live="polite">
          {omrJobs.map((job) => (
            <OmrCard key={job.id} $status={job.status}>
              <OmrTop>
                <OmrIcon $status={job.status} aria-hidden>
                  {job.status === 'COMPLETED' ? '✓' : job.status === 'FAILED' ? '!' : ''}
                </OmrIcon>
                <OmrLabel title={job.label}>{job.label}</OmrLabel>
                <OmrDismiss onClick={() => dismissOmrJob(job.id)} aria-label="닫기">×</OmrDismiss>
              </OmrTop>
              <OmrStatusText $status={job.status}>
                {job.status === 'PROCESSING'
                  ? (job.progress > 0 ? `악보 인식 중… ${Math.round(job.progress)}%` : '악보 인식 중…')
                  : job.status === 'COMPLETED'
                    ? '인식 완료'
                    : (job.failureReason || '악보 인식에 실패했어요.')}
              </OmrStatusText>
              {job.status === 'PROCESSING' && (
                <OmrBar>
                  <OmrBarFill $progress={job.progress} />
                </OmrBar>
              )}
              {job.status === 'COMPLETED' && (
                <OmrOpenBtn onClick={() => openOmrJob(job)}>에디터로 열기</OmrOpenBtn>
              )}
            </OmrCard>
          ))}
        </OmrPanel>
      )}
    </PageContainer>
  );
}
