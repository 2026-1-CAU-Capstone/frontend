/**
 * MyLicksPage — "내 릭".
 *
 * A standalone clone of LicksPage (the admin "Lick Database"). The user
 * asked for the 내 릭 entry to behave exactly like Lick Database — same
 * design, same toolbar, same melody search, same OMR/filter/infinite-scroll
 * — built as its own page rather than sharing code, so it can diverge into
 * a per-user library later without touching the admin database page.
 *
 * For now it is a faithful duplicate: identical data sources (backend /
 * frontend snapshot / static) and identical behaviour. Per-user scoping
 * (showing only the signed-in user's own licks) is a future step.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { useIsNativeUi } from '../contexts/AppPreviewContext';
import {
  DetailHeader,
  DetailHeaderRow,
  DetailBackBtn,
  DetailTitle,
} from '../components/projects/sharedStyles';
import { LickCard } from '../components/notesheet/LickCard';
import { PianoKeyboard, type PianoNote } from '../components/notesheet/PianoKeyboard';
import { MelodyPreview } from '../components/notesheet/MelodyPreview';
import { loadMyLicks, invalidateLicksCache, type LickEntry } from '../data/lickData';
import { transposeLick, normalizeKeyInput, formatKeyDisplay } from '../lib/transpose';
import { OMRUploadModal } from '../components/common/OMRUploadModal';
import { createLickViaOMR } from '../api/licks';
import { openPerformanceSettings } from '../lib/settingsBus';
import { SettingsGearIcon } from '../components/common/SettingsGearIcon';

const PAGE_SIZE = 30;

/* ─── styled ─────────────────────────────────────────────────────────── */

const BackArrow = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const GearBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.04); color: ${({ theme }) => theme.colors.textPrimary}; }
`;

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
  background: ${({ theme }) => theme.colors.barBelow}; /* 최상단 회색 바 아래는 전부 흰색 */
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

const OMRBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 4px 12px;
  border: 1px solid #1a1a1a;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: opacity 0.12s, transform 0.1s;
  &:hover { opacity: 0.85; }
  &:active { transform: scale(0.97); }
`;

/* "추가하기" 드롭다운 — 트리거(OMRBtn 재사용) + 메뉴를 감싸는 앵커. */
const AddWrap = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
`;

const Caret = styled.span<{ $open?: boolean }>`
  font-size: 0.7rem;
  line-height: 1;
  transform: rotate(${({ $open }) => ($open ? '180deg' : '0deg')});
  transition: transform 0.14s;
`;

const AddMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 230px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const AddMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textPrimary};
  transition: background 0.12s;

  &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }

  span { font-size: 1.05rem; line-height: 1; flex-shrink: 0; }
  div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  strong { font-size: 0.85rem; font-weight: 600; }
  small { font-size: 0.72rem; color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const MelodyBtn = styled.button<{ $active?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 3px 12px;
  border: 1px solid ${({ $active }) => ($active ? '#3070a0' : '#bbb')};
  border-radius: 4px;
  background: ${({ $active }) => ($active ? '#deeaf5' : 'transparent')};
  color: ${({ $active }) => ($active ? '#3070a0' : '#666')};
  cursor: pointer;
  font-weight: 600;
  &:hover { background: #e8f0f8; }
`;

const MelodyPanel = styled.div`
  padding: 8px 16px 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const MelodyInfoRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  flex-wrap: wrap;
`;

const MelodyHint = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.6;
  font-size: 0.75rem;
`;

const NoteBadge = styled.span`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.7rem;
  padding: 1px 5px;
  background: #f0ebe0;
  border-radius: 3px;
  color: #8B6914;
`;

const IvBadge = styled.span<{ $pos: boolean }>`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: ${({ $pos }) => ($pos ? '#e8f0e8' : '#f0e8e8')};
  color: ${({ $pos }) => ($pos ? '#2a8040' : '#c04040')};
`;

const SmallBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  padding: 4px 14px;
  border: 1px solid #bbb;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
  color: #555;
  font-weight: 600;
  &:hover { background: #e8e8e8; }
  &:disabled { opacity: 0.35; cursor: default; }
`;

const SearchBtnRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
`;

const PianoRow = styled.div`
  overflow-x: auto;
  display: flex;
  justify-content: center;

  ${mq.compactLayout} {
    display: none;
  }
`;

const ScoreBadge = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.66rem;
  color: #2a7040;
  padding: 2px 10px 0;
  margin: 6px 20px -2px;
  opacity: 0.8;
`;

const Feed = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const LoadingState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const Sentinel = styled.div`
  height: 1px;
`;


/* ─── melody similarity ──────────────────────────────────────────────── */

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function midiToName(midi: number) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/* ── query feature computation from MIDI sequence ────────────────── */

function toFuzzy(iv: number): number {
  const abs = Math.abs(iv);
  const sign = iv > 0 ? 1 : iv < 0 ? -1 : 0;
  if (abs === 0) return 0;
  if (abs <= 2) return sign;       // step
  if (abs <= 4) return 2 * sign;   // small leap
  if (abs <= 7) return 3 * sign;   // medium leap
  return 4 * sign;                 // large leap
}

interface QueryFeatures {
  intervals: number[];
  parsons: number[];
  fuzzy: number[];
}

function buildQueryFeatures(midis: number[]): QueryFeatures {
  const intervals: number[] = [];
  for (let i = 1; i < midis.length; i++) intervals.push(midis[i] - midis[i - 1]);
  const parsons = intervals.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0));
  const fuzzy = intervals.map(toFuzzy);
  return { intervals, parsons, fuzzy };
}

/* ── sliding-window sub-score ────────────────────────────────────── */

function slideScore(query: number[], lick: number[] | undefined, tolerance: number): number {
  const qLen = query.length;
  if (qLen === 0 || !lick || lick.length < qLen) return 0;
  let best = 0;
  for (let s = 0; s <= lick.length - qLen; s++) {
    let score = 0;
    for (let i = 0; i < qLen; i++) {
      const diff = Math.abs(query[i] - lick[s + i]);
      if (diff === 0) score += 1;
      else if (diff <= tolerance) score += 0.5;
    }
    best = Math.max(best, score);
  }
  return best / qLen;
}

/**
 * Multi-criteria melody similarity.
 * Weights: interval 40%, parsons contour 25%, fuzzy interval 20%, duration pattern 15%.
 * Returns 0–1.
 */
function melodySimilarity(query: QueryFeatures, lick: LickEntry): number {
  if (query.intervals.length === 0) return 0;

  const ivScore      = slideScore(query.intervals, lick.intervals, 1);
  const parsonsScore = slideScore(query.parsons, lick.parsons, 0);
  const fuzzyScore   = slideScore(query.fuzzy, lick.fuzzyIntervals, 1);

  // Duration: compare lick's duration_class pattern (per-note, not per-interval)
  // We don't have duration from the search piano, so use a flat bonus for contour match
  // to avoid penalizing — duration is only used when lick data exists
  const durBonus = (ivScore + parsonsScore) > 0.8 ? 1.0 : (ivScore + parsonsScore) > 0.4 ? 0.5 : 0;

  return ivScore * 0.40 + parsonsScore * 0.25 + fuzzyScore * 0.20 + durBonus * 0.15;
}

/* ─── visibility wrapper ─────────────────────────────────────────────── */

function VisibleLickCard({ lick, width, displayId, fitToWidth, onDelete, onEdit, onTranspose, onPractice }: { lick: LickEntry; width: number; displayId: number; fitToWidth?: boolean; onDelete?: () => void; onEdit?: () => void; onTranspose?: () => void; onPractice?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <LickCard lick={lick} width={width} visible={visible} compact displayId={displayId} fitToWidth={fitToWidth} onDelete={onDelete} onEdit={onEdit} onTranspose={onTranspose} onPractice={onPractice} />
    </div>
  );
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function MyLicksPage() {
  const navigate = useNavigate();
  const isNativeUi = useIsNativeUi();
  const [melodySearch, setMelodySearch] = useState(false);
  const [searchMidis, setSearchMidis] = useState<number[]>([]);

  /* lick source toggle. 3 sources:
   *   backend  — live /v1/licks (현재 비어있음, 복구 대기)
   *   frontend — 백엔드 wipe 직전 snapshot 145개 (public/data/licks/backend_backup_licks.json)
   *   static   — WJazzD 정적 ~8000개 + user_licks.json (브라우저용 폴백 풀) */
  /* 생성/삭제/수정 후 목록을 다시 읽기 위한 트리거. */
  const [reloadKey, setReloadKey] = useState(0);

  /* lick data */
  const [allLicks, setAllLicks] = useState<LickEntry[]>([]);
  const [loadingLicks, setLoadingLicks] = useState(true);

  /* "내 릭"은 백엔드 전체 DB가 아니라 내가 만든 릭만 담는다 — 처음엔 비어
   * 있고, 에디터 저장·OMR 생성·채팅 카드 저장으로만 채워진다. 전체 릭 목록은
   * 릭 데이터베이스(LicksPage) 쪽이 담당한다. */
  useEffect(() => {
    setLoadingLicks(true);
    setAllLicks([]);
    setFilterPerformer('');
    setFilterStyle('');
    setFilterChord('');
    setSearchQuery('');
    loadMyLicks()
      .then((licks) => { setAllLicks(licks); setLoadingLicks(false); })
      .catch((err) => { console.error('Failed to load my licks:', err); setLoadingLicks(false); });
  }, [reloadKey]);

  /* OMR modal state — click "OMR로 생성하기" → opens LickOMRModal. On
   * successful upload the modal returns the persisted LickEntry; we drop
   * the cached list (to refetch on next visit), then jump straight into
   * the unified Editor (lick mode) pre-loaded with the OMR result so the
   * user can review/edit immediately. */
  const [omrOpen, setOmrOpen] = useState(false);
  /* "추가하기" 드롭다운 — 에디터 직접 입력 / OMR 생성 두 갈래. */
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);
  const handleOMRCreated = useCallback((lick: LickEntry) => {
    invalidateLicksCache();
    setReloadKey((k) => k + 1);
    setOmrOpen(false);
    navigate('/editor?mode=lick', { state: { editingLick: lick } });
  }, [navigate]);

  /* edit (backend only) — open unified Editor in lick mode with prefilled data + editingId */
  const handleEditLick = useCallback((lick: LickEntry) => {
    navigate('/editor?mode=lick', { state: { editingLick: lick } });
  }, [navigate]);

  /* delete (backend only) — DELETE /api/v1/licks/{publicId} */
  const handleDeleteLick = useCallback(async (lick: LickEntry) => {
    const ok = window.confirm(`"${lick.performer} — ${lick.title}" 릭을 삭제할까요?`);
    if (!ok) return;
    try {
      const { deleteLick } = await import('../api/licks');
      await deleteLick(String(lick.id));
      invalidateLicksCache();
      setAllLicks((prev) => prev.filter((l) => l.id !== lick.id));
    } catch (err) {
      console.error('Delete failed', err);
      alert(err instanceof Error ? err.message : '삭제 실패');
    }
  }, []);

  /* transpose (backend only, TEMP TOOL) — change the lick's original key.
   * Shifts every note, every chord change, and the top-level chord/key fields,
   * then PUTs the updated lick. This is a maintenance shortcut and is expected
   * to be removed before public release. */
  const handleTransposeLick = useCallback(async (lick: LickEntry) => {
    const currentDisplay = formatKeyDisplay(lick.key);
    const input = window.prompt(
      `"${lick.performer} — ${lick.title}"\n` +
      `Original key: ${currentDisplay}\n` +
      `New key (e.g. Ab, F#m, Bb-maj):`,
      currentDisplay,
    );
    if (input === null) return;
    const newKey = normalizeKeyInput(input);
    if (!newKey) {
      alert(`Invalid key: "${input}"`);
      return;
    }
    if (newKey === lick.key) return;

    const result = transposeLick(lick.sheetData, lick.chords, lick.key, newKey);
    if (!result) {
      alert('Transpose failed (could not parse keys).');
      return;
    }

    try {
      const { updateLick } = await import('../api/licks');
      const updated = await updateLick(String(lick.id), {
        ...lick,
        key: result.key,
        chords: result.chords,
        sheetData: result.sheetData,
      });
      invalidateLicksCache();
      setAllLicks((prev) => prev.map((l) => (l.id === lick.id ? updated : l)));
    } catch (err) {
      console.error('Transpose failed', err);
      alert(err instanceof Error ? err.message : 'Transpose 실패');
    }
  }, []);

  /* filters */
  const [filterPerformer, setFilterPerformer] = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [filterChord, setFilterChord] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const performers = useMemo(() => [...new Set(allLicks.map((l) => l.performer))].sort(), [allLicks]);
  const styles = useMemo(() => [...new Set(allLicks.map((l) => l.style))].sort(), [allLicks]);

  const filteredLicks = useMemo(() => {
    let list = allLicks;
    if (filterPerformer) list = list.filter((l) => l.performer === filterPerformer);
    if (filterStyle) list = list.filter((l) => l.style === filterStyle);
    if (filterChord) {
      const q = filterChord.toLowerCase();
      list = list.filter((l) => l.chords.some((c) => c.toLowerCase().includes(q)));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((l) =>
        (l.performer || '').toLowerCase().includes(q) ||
        (l.title || '').toLowerCase().includes(q) ||
        l.chords.some((c) => (c || '').toLowerCase().includes(q)) ||
        (l.tag || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allLicks, filterPerformer, filterStyle, filterChord, searchQuery]);

  /* ── melody search similarity ────────────────────────────────────── */
  const queryFeatures = useMemo(() => buildQueryFeatures(searchMidis), [searchMidis]);

  const rankedLicks = useMemo<{ lick: LickEntry; score: number }[]>(() => {
    if (queryFeatures.intervals.length === 0) {
      return filteredLicks.map((l) => ({ lick: l, score: 0 }));
    }
    return [...filteredLicks]
      .map((l) => ({ lick: l, score: melodySimilarity(queryFeatures, l) }))
      .sort((a, b) => b.score - a.score);
  }, [filteredLicks, queryFeatures]);

  /* infinite scroll */
  const [shown, setShown] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // reset shown count when filters or melody search change
  useEffect(() => { setShown(PAGE_SIZE); }, [filterPerformer, filterStyle, filterChord, searchQuery, searchMidis]);

  useEffect(() => {
    const el = sentinelRef.current;
    const feed = feedRef.current;
    if (!el || !feed) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown((prev) => Math.min(prev + PAGE_SIZE, rankedLicks.length));
        }
      },
      { root: feed, rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rankedLicks.length]);

  const visibleLicks = useMemo(() => rankedLicks.slice(0, shown), [rankedLicks, shown]);

  /* track feed width for notation rendering */
  const [feedWidth, setFeedWidth] = useState(800);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setFeedWidth(w - 40);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── melody search handlers ──────────────────────────────────────── */
  const handleSearchNote = useCallback((pn: PianoNote) => {
    setSearchMidis((prev) => [...prev, pn.midi]);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchMidis([]);
  }, []);

  // backspace = undo last search note
  useEffect(() => {
    if (!melodySearch) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        setSearchMidis((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [melodySearch]);

  return (
    <PageContainer>
      {!isNativeUi && <IconSidebar />}
      <RightSection>
        <DetailHeader>
          {/* 한 줄: 뒤로가기(좌) · 제목(가운데) — 내 코드/악보 차트와 동일 */}
          <DetailHeaderRow>
            <DetailBackBtn type="button" aria-label="뒤로" onClick={() => navigate(-1)}>
              <BackArrow />
            </DetailBackBtn>
            <DetailTitle>내 릭</DetailTitle>
          </DetailHeaderRow>
        </DetailHeader>

        <MainArea>
        <CenterColumn>
              <ToolBar>
                <AddWrap ref={addMenuRef}>
                  <OMRBtn
                    onClick={() => setAddMenuOpen((v) => !v)}
                    title="새 릭 추가"
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                  >
                    ＋ 추가하기
                    <Caret $open={addMenuOpen} aria-hidden>▾</Caret>
                  </OMRBtn>
                  {addMenuOpen && (
                    <AddMenu role="menu">
                      <AddMenuItem
                        role="menuitem"
                        onClick={() => { setAddMenuOpen(false); navigate('/editor?mode=lick'); }}
                      >
                        <span aria-hidden>🎼</span>
                        <div>
                          <strong>에디터로 추가하기</strong>
                          <small>악보를 직접 입력해 만듭니다</small>
                        </div>
                      </AddMenuItem>
                      <AddMenuItem
                        role="menuitem"
                        onClick={() => { setAddMenuOpen(false); setOmrOpen(true); }}
                      >
                        <span aria-hidden>📄</span>
                        <div>
                          <strong>OMR로 생성하기</strong>
                          <small>악보 이미지를 올려 자동 변환합니다</small>
                        </div>
                      </AddMenuItem>
                    </AddMenu>
                  )}
                </AddWrap>

                <GearBtn type="button" aria-label="설정" title="설정" onClick={() => openPerformanceSettings('myLicks')}>
                  <SettingsGearIcon />
                </GearBtn>

                <MelodyBtn
                  $active={melodySearch}
                  onClick={() => { setMelodySearch((v) => !v); if (melodySearch) setSearchMidis([]); }}
                >
                  {melodySearch ? '✖ Close Piano' : '\u{1F3B9} Search by Melody'}
                </MelodyBtn>

                <FilterLabel>Performer</FilterLabel>
                <FilterSelect value={filterPerformer} onChange={(e) => setFilterPerformer(e.target.value)}>
                  <option value="">All ({performers.length})</option>
                  {performers.map((p) => <option key={p} value={p}>{p}</option>)}
                </FilterSelect>

                <FilterLabel>Style</FilterLabel>
                <FilterSelect value={filterStyle} onChange={(e) => setFilterStyle(e.target.value)}>
                  <option value="">All ({styles.length})</option>
                  {styles.map((s) => <option key={s} value={s}>{s}</option>)}
                </FilterSelect>

                <FilterLabel>Chord</FilterLabel>
                <SearchInput
                  style={{ width: 100 }}
                  placeholder="e.g. Dm7"
                  value={filterChord}
                  onChange={(e) => setFilterChord(e.target.value)}
                />

                <SearchInput
                  style={{ width: 180 }}
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                <CountText>
                  {loadingLicks
                    ? 'Loading...'
                    : queryFeatures.intervals.length > 0
                      ? `${rankedLicks.filter((r) => r.score > 0.3).length} matches / ${filteredLicks.length.toLocaleString()}`
                      : `${filteredLicks.length.toLocaleString()} licks`}
                </CountText>
              </ToolBar>

              {melodySearch && (
                <MelodyPanel>
                  {/* Undo / Clear buttons — always visible */}
                  <SearchBtnRow>
                    <SmallBtn
                      onClick={() => setSearchMidis((p) => p.slice(0, -1))}
                      disabled={searchMidis.length === 0}
                    >
                      ↩ Undo
                    </SmallBtn>
                    <SmallBtn
                      onClick={handleSearchClear}
                      disabled={searchMidis.length === 0}
                    >
                      ✕ Clear
                    </SmallBtn>
                    {searchMidis.length > 0 && (
                      <MelodyHint>{searchMidis.length} notes — Backspace to undo</MelodyHint>
                    )}
                    {searchMidis.length === 0 && (
                      <MelodyHint>Play a melody on the piano below to find similar licks...</MelodyHint>
                    )}
                  </SearchBtnRow>

                  {/* Note / interval badges */}
                  {searchMidis.length > 0 && (
                    <MelodyInfoRow>
                      {searchMidis.map((m, i) => (
                        <span key={i} style={{ display: 'contents' }}>
                          {i > 0 && <span style={{ color: '#ccc' }}>{'→'}</span>}
                          <NoteBadge>{midiToName(m)}</NoteBadge>
                        </span>
                      ))}
                      {queryFeatures.intervals.length > 0 && (
                        <>
                          <span style={{ color: '#bbb', margin: '0 4px' }}>|</span>
                          <span style={{ color: '#999', fontSize: '0.7rem' }}>Intervals:</span>
                          {queryFeatures.intervals.map((iv, i) => (
                            <IvBadge key={i} $pos={iv >= 0}>
                              {iv > 0 ? `+${iv}` : String(iv)}
                            </IvBadge>
                          ))}
                        </>
                      )}
                    </MelodyInfoRow>
                  )}

                  {/* Sheet music preview of played notes */}
                  {searchMidis.length > 0 && (
                    <MelodyPreview midis={searchMidis} width={feedWidth} />
                  )}

                  <PianoRow>
                    <PianoKeyboard onNotePress={handleSearchNote} />
                  </PianoRow>
                </MelodyPanel>
              )}

              {loadingLicks ? (
                <LoadingState>Loading 8,000+ jazz licks...</LoadingState>
              ) : filteredLicks.length === 0 ? (
                <LoadingState>No licks match current filters</LoadingState>
              ) : (
                <Feed ref={feedRef}>
                  {visibleLicks.map(({ lick, score }, i) => (
                    <div key={lick.id}>
                      {melodySearch && queryFeatures.intervals.length > 0 && score > 0 && (
                        <ScoreBadge>{Math.round(score * 100)}% match</ScoreBadge>
                      )}
                      <VisibleLickCard
                        lick={lick}
                        width={feedWidth}
                        fitToWidth
                        displayId={rankedLicks.length - i}
                        onDelete={() => handleDeleteLick(lick)}
                        onEdit={() => handleEditLick(lick)}
                        onTranspose={() => handleTransposeLick(lick)}
                        onPractice={() => navigate(`/lick-practice/${lick.id}`, { state: { lick } })}
                      />
                    </div>
                  ))}
                  {shown < rankedLicks.length && <Sentinel ref={sentinelRef} />}
                </Feed>
              )}
        </CenterColumn>
        </MainArea>
      </RightSection>

      <OMRUploadModal
        open={omrOpen}
        onClose={() => setOmrOpen(false)}
        title="OMR로 릭 생성"
        upload={createLickViaOMR}
        onCreated={handleOMRCreated}
      />
    </PageContainer>
  );
}
