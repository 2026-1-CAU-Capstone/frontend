/**
 * Symbolic Jazz Standards 데이터셋 뷰어.
 *
 * SJS의 stem별 음표 데이터를 NoteSheetData 포맷으로 변환해서
 * 기존 NoteSheet 컴포넌트로 렌더링 — Note 페이지와 동일한 스타일.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLickRegionPicker, LickRegionControls } from './lickRegionPicker';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { NoteSheet } from '../notesheet/NoteSheet';
import type { NoteInfo, MeasureInfo, NoteSheetData } from '../../data/sampleMelody';

/* ── 원본 SJS 데이터 타입 ─────────────────────────────────────────────────── */

interface SjsNote {
  pos: number;   // 32분음표 그리드 0~31
  midi: number;
  dur: number;   // 32분음표 단위
}

interface SjsStem {
  bars: SjsNote[][];
  chords: { bar: number; pos: number; label: string }[];
}

interface SjsSong {
  title: string;
  slug: string;
  stems: Record<string, SjsStem>;
}

interface SjsIndexEntry {
  title: string;
  slug: string;
  stems: string[];
}

interface IRealMatch {
  sjs_slug: string;
  sjs_title: string;
  ireal_id: string | null;
  ireal_title?: string;
  match_method: 'exact' | 'exact-normalized' | 'sjs-in-ireal' | 'ireal-in-sjs' | 'fuzzy' | 'none';
  confidence: number;
}

/* ── 변환 헬퍼 ────────────────────────────────────────────────────────────── */

const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** MIDI 번호 → { key: "c/5", acc?: "#" } */
function midiToVexKey(midi: number): { key: string; acc?: '#' } {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const name = PITCH_NAMES[pc];
  if (name.length === 2) return { key: `${name[0]}/${oct}`, acc: '#' };
  return { key: `${name}/${oct}` };
}

/** 32분음표 단위 → vex duration. 정확히 표현 불가하면 가장 가까운 길이로. */
function unitsToDuration(units: number): { dur: string; dotted: boolean; consumed: number } {
  // 우선순위 큰 길이부터: dotted half(24) → half(16) → dotted quarter(12) → quarter(8)
  // → dotted 8th(6) → 8th(4) → dotted 16th(3) → 16th(2) → 32nd(1)
  const map: [number, string, boolean][] = [
    [32, 'w', false],
    [24, 'h', true],
    [16, 'h', false],
    [12, 'q', true],
    [8,  'q', false],
    [6,  '8', true],
    [4,  '8', false],
    [3,  '16', true],
    [2,  '16', false],
    [1,  '32', false],
  ];
  for (const [u, dur, dotted] of map) {
    if (units >= u) return { dur, dotted, consumed: u };
  }
  return { dur: '32', dotted: false, consumed: 1 };
}

/**
 * SJS stem (32분음표 그리드 기반) → MeasureInfo[].
 *
 * 같은 pos의 다중음은 chord(keys 배열)로 묶는다.
 * 빈 구간은 적절한 길이의 쉼표로 채운다.
 */
/**
 * 양자화 — AMT가 뽑은 비정형 pos/duration을 그리드에 맞춰 라운딩.
 * gridUnits: 2 = 16th note 그리드, 4 = 8th note 그리드, 0/1 = raw (off)
 */
function quantizeNotes(notes: SjsNote[], gridUnits: number): SjsNote[] {
  if (gridUnits < 2) return notes;
  const snap = (v: number) => Math.round(v / gridUnits) * gridUnits;
  return notes
    .map((n) => {
      const pos = Math.max(0, Math.min(30, snap(n.pos)));
      const dur = Math.max(gridUnits, snap(n.dur));
      return { ...n, pos, dur };
    })
    // 같은 pos·midi 중복 제거 (양자화 후 충돌)
    .filter((n, i, arr) => arr.findIndex((m) => m.pos === n.pos && m.midi === n.midi) === i);
}

function stemToMeasures(stem: SjsStem, octaveShift = 0, quantize = 0): MeasureInfo[] {
  const bars = quantize > 0
    ? stem.bars.map((notes) => quantizeNotes(notes, quantize))
    : stem.bars;
  return bars.map((notes, barIdx) => {
    // pos별로 그룹화 (chord)
    const groups = new Map<number, SjsNote[]>();
    for (const n of notes) {
      if (!groups.has(n.pos)) groups.set(n.pos, []);
      groups.get(n.pos)!.push(n);
    }
    const sortedPositions = [...groups.keys()].sort((a, b) => a - b);

    const result: NoteInfo[] = [];
    let cursor = 0;
    for (const pos of sortedPositions) {
      // 앞 빈 공간 → 쉼표
      while (cursor < pos) {
        const gap = pos - cursor;
        const r = unitsToDuration(gap);
        result.push({ keys: ['b/4'], duration: r.dur + 'r' });
        cursor += r.consumed;
      }
      // 같은 pos의 음들 = 한 chord
      const grp = groups.get(pos)!;
      // 첫 음의 duration을 chord 길이로 사용 (다중음은 보통 같은 길이)
      const refDur = grp[0].dur;
      const d = unitsToDuration(refDur);
      const keys: string[] = [];
      const accidentals: Record<number, '#'> = {};
      // pitch 중복 제거 + octave shift 적용
      const seen = new Set<string>();
      grp
        .map((n) => n.midi + octaveShift * 12)
        .filter((m) => m >= 21 && m <= 108)
        .sort((a, b) => a - b)
        .forEach((shifted, idx) => {
          const { key, acc } = midiToVexKey(shifted);
          if (seen.has(key)) return;
          seen.add(key);
          keys.push(key);
          if (acc) accidentals[idx] = acc;
        });
      if (keys.length === 0) {
        // shift로 사라진 음 → 쉼표로 채움
        result.push({ keys: ['b/4'], duration: d.dur + 'r' });
      } else {
        const note: NoteInfo = {
          keys,
          duration: d.dur,
          ...(d.dotted ? { dotted: true } : {}),
          ...(Object.keys(accidentals).length > 0 ? { accidentals } : {}),
        };
        result.push(note);
      }
      cursor += d.consumed;
    }
    // 마디 끝까지 남은 공간 → 쉼표
    while (cursor < 32) {
      const gap = 32 - cursor;
      const r = unitsToDuration(gap);
      result.push({ keys: ['b/4'], duration: r.dur + 'r' });
      cursor += r.consumed;
    }

    // 코드 라벨 (첫 chord at this bar)
    const barChords = stem.chords.filter((c) => c.bar === barIdx).sort((a, b) => a.pos - b.pos);
    const chord = barChords[0]?.label;

    return { notes: result, ...(chord ? { chord } : {}) };
  });
}

/** 자동 옥타브 시프트: 음 분포 중앙값을 treble clef 중심(MIDI 67 ≈ G4)으로 이동. */
function autoOctaveShift(stem: SjsStem): number {
  const pitches: number[] = [];
  for (const bar of stem.bars) for (const n of bar) pitches.push(n.midi);
  if (pitches.length === 0) return 0;
  pitches.sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)];
  const TARGET = 67;
  return Math.round((TARGET - median) / 12);
}

function stemToSheetData(title: string, stemName: string, stem: SjsStem, octaveShift: number, quantize: number): NoteSheetData {
  return {
    title: `${title} — ${stemName}`,
    composer: 'Symbolic Jazz Standards',
    key: 'C',
    timeSignature: '4/4',
    tempo: 120,
    measures: stemToMeasures(stem, octaveShift, quantize),
  };
}

/* ── styled ───────────────────────────────────────────────────────────────── */

const Layout = styled.div`
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
`;

const Sidebar = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const SearchInput = styled.input`
  margin: 10px;
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SongList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
`;

const SongItem = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  background: ${({ $active, theme }) => $active ? theme.colors.gold + '22' : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 12.5px;
  cursor: pointer;
  border-radius: 4px;
  margin-bottom: 2px;
  font-family: 'DM Sans', sans-serif;
  &:hover { background: ${({ theme }) => theme.colors.gold + '15'}; }
`;

const Main = styled.div`
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-right: 8px;
`;

const Heading = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const FilterRow = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 10px 4px;
  flex-wrap: wrap;
`;

const FilterChip = styled.button<{ $active: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid ${({ $active, theme }) => $active ? theme.colors.gold : theme.colors.border};
  background: ${({ $active, theme }) => $active ? theme.colors.gold + '22' : theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const MatchStar = styled.span`
  color: #B8860B;
  margin-right: 4px;
  font-size: 11px;
`;

const MatchBanner = styled.div<{ $matched: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ $matched }) => $matched ? 'rgba(184, 134, 11, 0.12)' : 'rgba(0,0,0,0.04)'};
  border: 1px solid ${({ $matched }) => $matched ? 'rgba(184, 134, 11, 0.4)' : 'rgba(0,0,0,0.1)'};
`;

const OpenChartBtn = styled.button`
  padding: 4px 10px;
  font-family: 'DM Sans', sans-serif;
  font-size: 11.5px;
  background: #B8860B;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  &:hover { background: #8B6914; }
`;

const GlobalControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  margin-bottom: 4px;
`;

const StemSection = styled.section`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: #fff;
  padding: 12px 14px 6px;
`;

const StemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
`;

const StemTitle = styled.span`
  font-weight: 700;
  font-size: 14px;
  color: #1a1a1a;
  font-family: 'DM Sans', sans-serif;
  text-transform: capitalize;
`;

const StemMeta = styled.span`
  font-size: 11px;
  color: #888;
  font-family: 'DM Sans', sans-serif;
`;

const Spacer = styled.div`flex: 1;`;

const OctaveCtrl = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: 'DM Sans', sans-serif;
  color: #555;
`;

const OctaveBtn = styled.button`
  width: 22px;
  height: 22px;
  border: 1px solid #d0d0d0;
  background: #fafafa;
  color: #333;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  font-weight: 700;
  &:hover { background: #f0f0f0; border-color: #999; }
  &:disabled { opacity: 0.4; cursor: default; }
`;


const ChordRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
`;

const ChordChip = styled.span`
  background: rgba(180, 130, 10, 0.15);
  color: #8B6914;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
`;

const Empty = styled.div`
  padding: 40px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
`;

const Status = styled.div`
  padding: 8px 12px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
`;

/* ── 컴포넌트 ─────────────────────────────────────────────────────────────── */

const STEM_ORDER: readonly string[] = ['vocals', 'bass', 'other', 'drums'];

export function SymbolicJazzViewer() {
  const navigate = useNavigate();
  const [index, setIndex] = useState<SjsIndexEntry[]>([]);
  const [matches, setMatches] = useState<Record<string, IRealMatch>>({});
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [song, setSong] = useState<SjsSong | null>(null);
  const [loadingSong, setLoadingSong] = useState(false);
  const [search, setSearch] = useState('');
  // 매칭된 것만 / 안 된 것만 / 전체 필터
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  // stem별 옥타브 시프트 (semitones / 12)
  const [octaveShifts, setOctaveShifts] = useState<Record<string, number>>({});
  // 전역 양자화 (0=raw faithful / 2=16th grid / 4=8th grid)
  const [quantize, setQuantize] = useState<number>(2);

  useEffect(() => {
    Promise.all([
      fetch('/data/sjs/index.json').then((r) => r.json()),
      fetch('/data/sjs/ireal-matches.json').then((r) => r.json()).catch(() => []),
    ])
      .then(([idx, matchList]: [SjsIndexEntry[], IRealMatch[]]) => {
        setIndex(idx);
        const map: Record<string, IRealMatch> = {};
        for (const m of matchList) map[m.sjs_slug] = m;
        setMatches(map);
        setLoadingIndex(false);
      })
      .catch((e) => { console.error('Failed to load SJS index', e); setLoadingIndex(false); });
  }, []);

  useEffect(() => {
    if (!selectedSlug) { setSong(null); return; }
    setLoadingSong(true);
    fetch(`/data/sjs/${selectedSlug}.json`)
      .then((r) => r.json())
      .then((data: SjsSong) => {
        setSong(data);
        // 로드 시 각 stem의 자동 옥타브 시프트 계산 (treble 중심으로 정렬)
        const autoShifts: Record<string, number> = {};
        for (const [name, stem] of Object.entries(data.stems)) {
          autoShifts[name] = autoOctaveShift(stem as SjsStem);
        }
        setOctaveShifts(autoShifts);
        setLoadingSong(false);
      })
      .catch((e) => { console.error('Failed to load song', e); setLoadingSong(false); });
  }, [selectedSlug]);

  const filtered = useMemo(() => {
    let list = index;
    if (matchFilter === 'matched') {
      list = list.filter((e) => matches[e.slug]?.ireal_id);
    } else if (matchFilter === 'unmatched') {
      list = list.filter((e) => !matches[e.slug]?.ireal_id);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.title.toLowerCase().includes(q));
    }
    return list;
  }, [index, search, matches, matchFilter]);

  const matchedCount = useMemo(
    () => index.filter((e) => matches[e.slug]?.ireal_id).length,
    [index, matches],
  );

  return (
    <Layout>
      <Sidebar>
        <SearchInput
          placeholder={`Search ${index.length} songs…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterRow>
          <FilterChip $active={matchFilter === 'all'} onClick={() => setMatchFilter('all')}>
            All ({index.length})
          </FilterChip>
          <FilterChip $active={matchFilter === 'matched'} onClick={() => setMatchFilter('matched')}>
            ★ iReal ({matchedCount})
          </FilterChip>
          <FilterChip $active={matchFilter === 'unmatched'} onClick={() => setMatchFilter('unmatched')}>
            no match ({index.length - matchedCount})
          </FilterChip>
        </FilterRow>
        <Status>{loadingIndex ? 'Loading…' : `${filtered.length} / ${index.length} songs`}</Status>
        <SongList>
          {filtered.map((e) => {
            const m = matches[e.slug];
            const matched = !!m?.ireal_id;
            return (
              <SongItem
                key={e.slug}
                $active={e.slug === selectedSlug}
                onClick={() => setSelectedSlug(e.slug)}
              >
                {matched && <MatchStar title={`iRealPro: ${m.ireal_title} (${m.match_method} ${(m.confidence * 100).toFixed(0)}%)`}>★</MatchStar>}
                {e.title}
                <span style={{ display: 'block', fontSize: '10px', color: '#999', marginTop: 2 }}>
                  {e.stems.join(' · ')}
                </span>
              </SongItem>
            );
          })}
        </SongList>
      </Sidebar>

      <Main>
        {!selectedSlug && <Empty>왼쪽에서 곡을 선택하세요.</Empty>}
        {selectedSlug && loadingSong && <Empty>Loading…</Empty>}
        {song && (
          <>
            <Heading>{song.title}</Heading>
            {(() => {
              const m = matches[song.slug];
              if (!m?.ireal_id) {
                return (
                  <MatchBanner $matched={false}>
                    iRealPro 1460에서 매칭된 곡 없음
                  </MatchBanner>
                );
              }
              return (
                <MatchBanner $matched={true}>
                  <span>
                    <strong>iRealPro:</strong> {m.ireal_title}
                    <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>
                      ({m.match_method} · {(m.confidence * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <OpenChartBtn
                    onClick={() => navigate(`/chord?song=${m.ireal_id}`)}
                    title="iRealPro 코드 차트 열기"
                  >
                    차트 열기 →
                  </OpenChartBtn>
                </MatchBanner>
              );
            })()}
            <GlobalControls>
              <span>Quantize:</span>
              <select
                value={quantize}
                onChange={(e) => setQuantize(Number(e.target.value))}
                style={{ padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #ccc' }}
              >
                <option value={0}>Off (raw, faithful)</option>
                <option value={2}>16th-note grid</option>
                <option value={4}>8th-note grid</option>
              </select>
              <span style={{ fontSize: 11, color: '#888' }}>
                AMT 추출 timing이 비정형이라 raw는 잔여 쉼표가 많음. 16th 권장.
              </span>
            </GlobalControls>
            {STEM_ORDER.map((stemName) => {
              const stem = song.stems[stemName];
              if (!stem) return null;
              const octaveShift = octaveShifts[stemName] ?? 0;
              const autoShift = autoOctaveShift(stem);
              return (
                <StemRenderer
                  key={stemName + selectedSlug}
                  title={song.title}
                  name={stemName}
                  stem={stem}
                  octaveShift={octaveShift}
                  autoShift={autoShift}
                  quantize={quantize}
                  onOctaveShift={(delta) => {
                    setOctaveShifts((prev) => ({
                      ...prev,
                      [stemName]: (prev[stemName] ?? autoShift) + delta,
                    }));
                  }}
                  onResetOctave={() => {
                    // "0" = 자동 fit (treble 중심)으로 복귀
                    setOctaveShifts((prev) => ({ ...prev, [stemName]: autoShift }));
                  }}
                />
              );
            })}
          </>
        )}
      </Main>
    </Layout>
  );
}

function StemRenderer({
  title, name, stem, octaveShift, autoShift, quantize, onOctaveShift, onResetOctave,
}: {
  title: string;
  name: string;
  stem: SjsStem;
  octaveShift: number;
  autoShift: number;
  quantize: number;
  onOctaveShift: (delta: number) => void;
  onResetOctave: () => void;
}) {
  const sheetData = useMemo(
    () => stemToSheetData(title, name, stem, octaveShift, quantize),
    [title, name, stem, octaveShift, quantize],
  );

  /* ── Lick region selection (admin) — global helper ──────────────────── */
  const picker = useLickRegionPicker({
    sheetData,
    performer: name,
    title,
    tag: 'sjs-region',
  });

  const totalNotes = stem.bars.reduce((s, b) => s + b.length, 0);
  const chordPreview = stem.chords.slice(0, 12);

  return (
    <StemSection>
      <StemHeader>
        <StemTitle>{name}</StemTitle>
        <StemMeta>
          {stem.bars.length} bars · {totalNotes} notes
          {stem.chords.length > 0 && ` · ${stem.chords.length} chord tags`}
          {octaveShift !== 0 && ` · shift ${octaveShift > 0 ? '+' : ''}${octaveShift} oct`}
          {octaveShift !== autoShift && ` (auto: ${autoShift > 0 ? '+' : ''}${autoShift})`}
        </StemMeta>
        <Spacer />
        <LickRegionControls picker={picker} />
        <OctaveCtrl>
          <span>Octave:</span>
          <OctaveBtn onClick={() => onOctaveShift(-1)} title="옥타브 내림">▼</OctaveBtn>
          <OctaveBtn
            onClick={onResetOctave}
            title="자동 fit으로 복귀"
            disabled={octaveShift === autoShift}
            style={{ width: 'auto', padding: '0 6px', fontSize: 10 }}
          >
            auto
          </OctaveBtn>
          <OctaveBtn onClick={() => onOctaveShift(1)} title="옥타브 올림">▲</OctaveBtn>
        </OctaveCtrl>
      </StemHeader>
      {chordPreview.length > 0 && (
        <ChordRow>
          {chordPreview.map((c, i) => (
            <ChordChip key={i}>bar{c.bar + 1}:{c.label}</ChordChip>
          ))}
          {stem.chords.length > chordPreview.length && (
            <ChordChip style={{ background: '#eee', color: '#666' }}>
              +{stem.chords.length - chordPreview.length} more
            </ChordChip>
          )}
        </ChordRow>
      )}
      <NoteSheet
        data={sheetData}
        selectable={picker.selectMode}
        selectedRanges={picker.selectedRanges}
        onSelectionChange={picker.setSelectedRanges}
      />
    </StemSection>
  );
}
