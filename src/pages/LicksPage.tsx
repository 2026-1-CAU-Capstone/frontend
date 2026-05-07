import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { LickCard } from '../components/notesheet/LickCard';
import { LickCreator } from '../components/notesheet/LickCreator';
import { PianoKeyboard, type PianoNote } from '../components/notesheet/PianoKeyboard';
import { MelodyPreview } from '../components/notesheet/MelodyPreview';
import type { TocEntry } from '../data/types';
import { loadLicks, loadFrontendLicks, loadUserLicks, saveUserLick, type LickEntry } from '../data/lickData';
import type { NoteSheetData } from '../data/sampleMelody';

const PAGE_SIZE = 30;

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

const CreateBtn = styled.button`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 12px;
  border: 1px solid #b8960a;
  border-radius: 4px;
  background: #f5ecd0;
  color: #8B6914;
  cursor: pointer;
  font-weight: 600;
  &:hover { background: #ede3c0; }
`;

const MelodyBtn = styled.button<{ $active?: boolean }>`
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const Sentinel = styled.div`
  height: 1px;
`;

const SourceToggleWrap = styled.div`
  display: flex;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  overflow: hidden;
  flex-shrink: 0;
`;

const SourceBtn = styled.button<{ $active?: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  padding: 2px 10px;
  border: none;
  background: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : theme.colors.bgPrimary)};
  color: ${({ $active, theme }) => ($active ? theme.colors.bgPrimary : theme.colors.textSecondary)};
  cursor: pointer;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  transition: background 0.12s, color 0.12s;
  &:hover {
    background: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : theme.colors.border)};
  }
`;

const RightPanelWrapper = styled.div<{ $width: number }>`
  width: ${({ $width }) => $width}px;
  min-width: 180px;
  flex-shrink: 0;
  display: flex;

  ${mq.compactLayout} {
    display: none;
  }
`;

const ResizeDivider = styled.div`
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  transition: background 0.15s;

  &:hover, &.dragging {
    background: ${({ theme }) => theme.colors.border};
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }

  ${mq.mobile} {
    display: none;
  }
`;

/* ─── pitch / duration helpers (for user-lick analysis) ──────────────── */

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function vexToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI_MAP[n] ?? 0;
  if (acc === '#') s += 1;
  if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

const DUR_BEATS_MAP: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

function durationClass(dur: string, dotted?: boolean): number {
  const base = dur.replace(/r$/, '');
  let beats = DUR_BEATS_MAP[base] ?? 1;
  if (dotted) beats *= 1.5;
  if (beats >= 2) return 2;
  if (beats >= 1) return 1;
  if (beats >= 0.5) return 0;
  if (beats >= 0.25) return -1;
  return -2;
}

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

function VisibleLickCard({ lick, width, displayId }: { lick: LickEntry; width: number; displayId: number }) {
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
      <LickCard lick={lick} width={width} visible={visible} compact displayId={displayId} />
    </div>
  );
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function LicksPage() {
  const [creating, setCreating] = useState(false);
  const [melodySearch, setMelodySearch] = useState(false);
  const [searchMidis, setSearchMidis] = useState<number[]>([]);

  /* lick source toggle */
  const [lickSource, setLickSource] = useState<'backend' | 'frontend'>('backend');

  /* lick data */
  const [allLicks, setAllLicks] = useState<LickEntry[]>([]);
  const [loadingLicks, setLoadingLicks] = useState(true);

  useEffect(() => {
    setLoadingLicks(true);
    setAllLicks([]);
    setFilterPerformer('');
    setFilterStyle('');
    setFilterChord('');
    setSearchQuery('');
    if (lickSource === 'backend') {
      loadLicks()
        .then((licks) => { setAllLicks(licks); setLoadingLicks(false); })
        .catch((err) => { console.error('Failed to load licks:', err); setLoadingLicks(false); });
    } else {
      loadFrontendLicks()
        .then((licks) =>
          loadUserLicks().then((userLicks) => {
            setAllLicks([...userLicks, ...licks]);
            setLoadingLicks(false);
          }),
        )
        .catch((err) => { console.error('Failed to load licks:', err); setLoadingLicks(false); });
    }
  }, [lickSource]);

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

  /* ── save created lick ────────────────────────────────────────────── */
  const handleSaveLick = useCallback((data: NoteSheetData) => {
    // Extract pitched notes from all measures
    const pitched = data.measures.flatMap((m) =>
      m.notes.filter((n) => !n.duration.endsWith('r')),
    );
    const noteCount = pitched.length;

    // Compute analysis arrays so the lick is searchable
    const pitches = pitched.map((n) => {
      const acc = n.accidentals ? (n.accidentals[0] as '#' | 'b' | 'n' | undefined) : undefined;
      return vexToMidi(n.keys[0], acc);
    });
    const intervals: number[] = [];
    for (let i = 1; i < pitches.length; i++) intervals.push(pitches[i] - pitches[i - 1]);
    const parsons = intervals.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0));
    const fuzzyIntervals = intervals.map(toFuzzy);
    const durationClasses = pitched.map((n) => durationClass(n.duration, n.dotted));

    // Convert display key ("Bb", "Gm") to LickEntry format ("Bb-maj", "G-min")
    const rawKey = data.key ?? 'C';
    const lickKey = rawKey.endsWith('m') && rawKey.length > 1
      ? rawKey.slice(0, -1) + '-min'
      : rawKey + '-maj';

    const newLick: LickEntry = {
      id: -(Date.now()),
      performer: 'Me',
      title: 'My Custom Lick',
      instrument: 'piano',
      style: 'custom',
      tempo: data.tempo ?? 120,
      key: lickKey,
      rhythmfeel: 'straight',
      tag: 'user-created',
      chords: [],
      nEvents: noteCount,
      label: `My Custom Lick (${rawKey})`,
      sheetData: data,
      intervals,
      parsons,
      fuzzyIntervals,
      durationClasses,
    };
    saveUserLick(newLick);
    setAllLicks((prev) => [newLick, ...prev]);
    setCreating(false);
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

  /* toc */
  const toc = useMemo<TocEntry[]>(() => [{ title: 'Lick Database', page: 1 }], []);

  /* resizable right panel */
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const dividerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    dividerRef.current?.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setRightPanelWidth(Math.max(180, Math.min(720, startWidth + delta)));
    };
    const onUp = () => {
      dividerRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  return (
    <PageContainer>
      <IconSidebar />
      <RightSection>
        <TopToolbar />

        <MainArea>
          <LeftSidebar
            toc={toc}
            activePage={1}
            onPageSelect={() => {}}
          />

        <CenterColumn>
          {creating ? (
            <LickCreator
              width={feedWidth}
              onSave={handleSaveLick}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <>
              <ToolBar>
                <SourceToggleWrap>
                  <SourceBtn $active={lickSource === 'backend'} onClick={() => setLickSource('backend')}>Backend</SourceBtn>
                  <SourceBtn $active={lickSource === 'frontend'} onClick={() => setLickSource('frontend')}>Frontend</SourceBtn>
                </SourceToggleWrap>

                <CreateBtn onClick={() => setCreating(true)}>+ Create Lick</CreateBtn>
                <MelodyBtn
                  $active={melodySearch}
                  onClick={() => { setMelodySearch((v) => !v); if (melodySearch) setSearchMidis([]); }}
                >
                  {melodySearch ? '\u2716 Close Piano' : '\u{1F3B9} Search by Melody'}
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
                          {i > 0 && <span style={{ color: '#ccc' }}>{'\u2192'}</span>}
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
                      <VisibleLickCard lick={lick} width={feedWidth} displayId={i + 1} />
                    </div>
                  ))}
                  {shown < rankedLicks.length && <Sentinel ref={sentinelRef} />}
                </Feed>
              )}
            </>
          )}
        </CenterColumn>

        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />

        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle="Jazzify Licks"
          />
        </RightPanelWrapper>
        </MainArea>
      </RightSection>
    </PageContainer>
  );
}
