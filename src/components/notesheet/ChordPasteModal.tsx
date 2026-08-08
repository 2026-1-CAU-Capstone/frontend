/* ─────────────────────────────────────────────────────────────────────────
 * 코드 붙여넣기 모달.
 *
 * MusicXML 솔로 채보에 코드가 안 적혀 있을 때, 아는 곡의 코드 진행(jazz1460
 * 1,460곡)을 골라 얹는다. 흐름은 3단계다.
 *
 *   ① 곡 검색 — 제목/작곡가로 좁힌다(악보 제목이 있으면 자동으로 미리 채운다).
 *   ② 시작 마디 지정 — 차트 격자에서 **솔로 첫 마디에 해당하는 칸**을 클릭한다.
 *      격자는 도돌이·볼타를 **전개한 뒤**의 순서라, 화면에 보이는 순서가 곧
 *      실제 연주 순서다(2회차 칸은 흐리게 + 회차 배지로 구분).
 *   ③ 미리보기 확인 후 적용 — 코드는 마디 수만큼 순환해서 채워진다.
 *
 * 표기 교정(이명동음)은 기본 ON — C♯-7 마디의 음은 C♯ 으로 쓰고 D♭ 로 쓰지
 * 않는다. 소리는 바뀌지 않는다(`respellToChordContext`).
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import type { LeadSheetData } from '../../data/leadSheetTypes';
import {
  getSongIndex,
  getSong,
  normalizeIRealComposer,
  normalizeIRealTitle,
  type SongEntry,
} from '../../lib/ireal/irealLoader';
import { expandLeadSheetChordCells, type ChordCell } from '../../lib/note/chordPaste';

export interface ChordPasteResult {
  cells: ChordCell[];
  startCell: number;
  respell: boolean;
  overwrite: boolean;
  /** 고른 곡 — 호출부가 안내 문구에 쓴다. */
  song: { title: string; composer: string; key: string };
}

interface Props {
  /** 코드를 채울 대상 마디 수 — 미리보기·요약에 쓴다. */
  measureCount: number;
  /** 악보 제목 — 검색어 초기값. */
  initialQuery?: string;
  onApply: (result: ChordPasteResult) => void;
  onClose: () => void;
}

export function ChordPasteModal({ measureCount, initialQuery, onApply, onClose }: Props) {
  const [songs, setSongs] = useState<SongEntry[] | null>(null);
  const [query, setQuery] = useState(initialQuery?.trim() ?? '');
  const [picked, setPicked] = useState<{ entry: SongEntry; lead: LeadSheetData } | null>(null);
  const [cells, setCells] = useState<ChordCell[]>([]);
  const [startCell, setStartCell] = useState(0);
  const [respell, setRespell] = useState(true);
  const [overwrite, setOverwrite] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSongIndex()
      .then(setSongs)
      .catch(() => setError('코드 진행 데이터를 불러오지 못했습니다.'));
  }, []);

  useEffect(() => { searchRef.current?.focus(); }, [songs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* 제목·작곡가 부분일치. 곡이 1,460개라 상위 40개만 보여준다(그 이상은 검색어로). */
  const matches = useMemo(() => {
    if (!songs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return songs.slice(0, 40);
    const scored = songs
      .map((s) => {
        const title = normalizeIRealTitle(s.title).toLowerCase();
        const composer = normalizeIRealComposer(s.composer).toLowerCase();
        if (title === q) return { s, rank: 0 };
        if (title.startsWith(q)) return { s, rank: 1 };
        if (title.includes(q)) return { s, rank: 2 };
        if (composer.includes(q)) return { s, rank: 3 };
        return null;
      })
      .filter((x): x is { s: SongEntry; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank || a.s.title.localeCompare(b.s.title));
    return scored.slice(0, 40).map((x) => x.s);
  }, [songs, query]);

  async function pick(entry: SongEntry) {
    setLoading(true);
    setError(null);
    try {
      const lead = await getSong(entry.index);
      if (!lead) { setError('이 곡의 코드 진행을 읽지 못했습니다.'); return; }
      const c = expandLeadSheetChordCells(lead);
      if (c.length === 0) { setError('이 곡에는 코드가 없습니다.'); return; }
      setPicked({ entry, lead });
      setCells(c);
      setStartCell(0);
    } finally {
      setLoading(false);
    }
  }

  /* 미리보기: 실제로 채워질 앞 8마디. */
  const preview = useMemo(() => {
    if (cells.length === 0) return [];
    const n = cells.length;
    return Array.from({ length: Math.min(8, measureCount) }, (_, i) => ({
      measure: i + 1,
      chord: cells[(startCell + i) % n].chord,
    }));
  }, [cells, startCell, measureCount]);

  const chorusText = cells.length
    ? `${cells.length}마디 순환 · ${measureCount}마디 채움 (${(measureCount / cells.length).toFixed(1)}코러스)`
    : '';

  return (
    <Backdrop onMouseDown={onClose}>
      <Panel onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="코드 붙여넣기">
        <Head>
          <h3>코드 붙여넣기</h3>
          <CloseBtn type="button" onClick={onClose} aria-label="닫기">✕</CloseBtn>
        </Head>

        {error && <Warn>{error}</Warn>}

        {!picked ? (
          <>
            <Hint>아는 곡의 코드 진행을 골라 이 악보에 얹습니다. 도돌이·볼타는 자동으로 전개됩니다.</Hint>
            <Search
              ref={searchRef}
              value={query}
              placeholder="곡 제목 또는 작곡가 (예: giant steps / coltrane)"
              onChange={(e) => setQuery(e.target.value)}
            />
            {!songs ? (
              <Hint>불러오는 중…</Hint>
            ) : (
              <SongList>
                {matches.map((s) => (
                  <SongRow key={s.index} type="button" disabled={loading} onClick={() => pick(s)}>
                    <span className="t">{normalizeIRealTitle(s.title)}</span>
                    <span className="c">{normalizeIRealComposer(s.composer)}</span>
                    <span className="k">{s.key}</span>
                  </SongRow>
                ))}
                {matches.length === 0 && <Hint>일치하는 곡이 없습니다.</Hint>}
              </SongList>
            )}
          </>
        ) : (
          <>
            <PickedBar>
              <b>{normalizeIRealTitle(picked.entry.title)}</b>
              <span>{normalizeIRealComposer(picked.entry.composer)} · {picked.entry.key}</span>
              <button type="button" onClick={() => { setPicked(null); setCells([]); }}>다른 곡</button>
            </PickedBar>

            <Hint>
              <b>솔로가 시작하는 마디</b>를 클릭하세요. 아래 격자는 도돌이·볼타를 전개한
              실제 연주 순서입니다.
            </Hint>

            <Grid>
              {cells.map((c, i) => (
                <Cell
                  key={i}
                  type="button"
                  $on={i === startCell}
                  $dim={c.secondPass}
                  onClick={() => setStartCell(i)}
                  title={`원본 ${c.sourceBar}마디${c.secondPass ? ' · 2회차' : ''}${c.ending ? ` · ${c.ending}절` : ''}`}
                >
                  <em>{c.sourceBar}{c.secondPass && <sup>2</sup>}</em>
                  {c.ending && <Volta>{c.ending}.</Volta>}
                  <span>{c.chord ?? '—'}</span>
                </Cell>
              ))}
            </Grid>

            <PreviewBox>
              <legend>이렇게 채워집니다 — {chorusText}</legend>
              <PreviewRow>
                {preview.map((p) => (
                  <span key={p.measure}><i>{p.measure}</i>{p.chord ?? '—'}</span>
                ))}
                {measureCount > 8 && <span className="more">…</span>}
              </PreviewRow>
            </PreviewBox>

            <OptRow>
              <label>
                <input type="checkbox" checked={respell} onChange={(e) => setRespell(e.target.checked)} />
                코드에 맞춰 임시표 다시 쓰기 <small>(C♯-7 마디는 C♯ 로 — 소리는 불변)</small>
              </label>
              <label>
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                이미 적힌 코드도 덮어쓰기
              </label>
            </OptRow>

            <Foot>
              <GhostBtn type="button" onClick={onClose}>취소</GhostBtn>
              <PrimaryBtn
                type="button"
                onClick={() => onApply({
                  cells,
                  startCell,
                  respell,
                  overwrite,
                  song: {
                    title: normalizeIRealTitle(picked.entry.title),
                    composer: normalizeIRealComposer(picked.entry.composer),
                    key: picked.entry.key,
                  },
                })}
              >붙여넣기</PrimaryBtn>
            </Foot>
          </>
        )}
      </Panel>
    </Backdrop>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modalHigh};
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;
const Panel = styled.div`
  width: min(880px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 16px;
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
`;
const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  h3 { margin: 0; font-size: 1.05rem; font-family: 'Pretendard', sans-serif; }
`;
const CloseBtn = styled.button`
  border: none; background: none; cursor: pointer; font-size: 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const Hint = styled.p`
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const Warn = styled.div`
  padding: 8px 10px; border-radius: 8px; font-size: 0.82rem;
  background: rgba(190, 60, 60, 0.12); color: #b23b3b;
`;
const Search = styled.input`
  padding: 8px 11px; font-size: 0.9rem; border-radius: 9px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const SongList = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  max-height: 46vh; overflow-y: auto;
`;
const SongRow = styled.button`
  display: grid; grid-template-columns: 1fr auto 44px; gap: 10px; align-items: center;
  padding: 7px 10px; border: none; border-radius: 8px; cursor: pointer;
  background: none; text-align: left; font-size: 0.86rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { background: rgba(107, 164, 255, 0.13); }
  &:disabled { opacity: 0.5; cursor: default; }
  .c { font-size: 0.78rem; color: ${({ theme }) => theme.colors.textSecondary}; }
  .k { font-size: 0.78rem; text-align: right; color: ${({ theme }) => theme.colors.textSecondary}; }
`;
const PickedBar = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 7px 10px; border-radius: 9px;
  background: rgba(107, 164, 255, 0.11);
  font-size: 0.86rem;
  span { font-size: 0.78rem; color: ${({ theme }) => theme.colors.textSecondary}; }
  button {
    margin-left: auto; border: 1px solid ${({ theme }) => theme.colors.border};
    background: ${({ theme }) => theme.colors.surface}; border-radius: 7px;
    padding: 3px 9px; font-size: 0.76rem; cursor: pointer;
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 2px;
`;
const Cell = styled.button<{ $on: boolean; $dim: boolean }>`
  position: relative;
  min-height: 46px;
  padding: 14px 6px 5px;
  cursor: pointer;
  border-radius: 8px;
  border: 2px solid ${({ $on, theme }) => ($on ? '#ef6c00' : theme.colors.border)};
  background: ${({ $on }) => ($on ? 'rgba(239, 108, 0, 0.13)' : 'transparent')};
  opacity: ${({ $dim, $on }) => ($dim && !$on ? 0.5 : 1)};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.84rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { border-color: #ef6c00; }
  em {
    position: absolute; top: 2px; left: 5px;
    font-style: normal; font-size: 0.63rem; font-weight: 500;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
  span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
const Volta = styled.span`
  position: absolute !important; top: 2px; right: 5px;
  font-size: 0.63rem; font-weight: 700; color: #ef6c00;
`;
const PreviewBox = styled.fieldset`
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 4px 10px 8px;
  legend {
    padding: 0 6px; font-size: 0.74rem; font-weight: 700;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;
const PreviewRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px;
  font-size: 0.82rem; font-weight: 600;
  span {
    padding: 3px 7px; border-radius: 6px;
    background: rgba(0, 0, 0, 0.05);
    white-space: nowrap;
  }
  i {
    font-style: normal; margin-right: 5px; font-weight: 500; font-size: 0.7rem;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
  .more { background: none; }
`;
const OptRow = styled.div`
  display: flex; flex-direction: column; gap: 5px;
  font-size: 0.82rem;
  label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
  small { color: ${({ theme }) => theme.colors.textSecondary}; }
`;
const Foot = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
`;
const GhostBtn = styled.button`
  padding: 7px 14px; border-radius: 9px; cursor: pointer; font-size: 0.86rem;
  border: 2px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const PrimaryBtn = styled.button`
  padding: 7px 16px; border-radius: 9px; cursor: pointer; font-size: 0.86rem;
  border: 2px solid #ef6c00; background: #ef6c00; color: #fff; font-weight: 700;
`;
