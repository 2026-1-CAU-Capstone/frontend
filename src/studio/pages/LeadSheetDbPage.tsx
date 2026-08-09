import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { AppSidebar } from '../../components/layout/AppSidebar';
import { BackButton } from '../../components/common/BackButton';
import { LeadSheet } from '../../components/leadsheet/LeadSheet';
import {
  loadLeadSheets, createLeadSheet, deleteLeadSheet, exportLeadSheets,
  LEAD_SHEET_STYLES, LEAD_SHEET_STYLE_LABELS,
  type LeadSheetEntry, type LeadSheetStyle,
} from '../../data/leadSheetDbData';
import { getSongIndex, getSong, type SongEntry } from '../../lib/ireal/irealLoader';

/* ─────────────────────────────────────────────────────────────────────────
 * LeadSheetDbPage (/lead-sheets) — admin 전용 Lead Sheet Database.
 *
 * 리드시트(코드 진행 차트)를 **스타일별**로 수집한다. Comping Database 와 같은 결
 * (좌: 그룹 사이드바 · 우: 목록 + 미리보기)이고, 그쪽은 Solo Database 의 레이아웃을
 * 따랐으므로 셋이 같은 모양이다.
 *
 * ⚠️ Comping 과 **저장 데이터가 다르다** — 컴핑은 기보(NoteSheetData)를 담고
 * NoteSheet 로 그리는데, 리드시트는 **코드 진행(LeadSheetData)** 을 담고 LeadSheet 로
 * 그린다. 음표가 없고 마디별 코드 심볼이 본체다.
 *
 * ⚠️ 백엔드 미구현(요구사항 #60) — 데이터는 localStorage 에만 남는다.
 *
 * 등록 경로가 Comping 과 다르다: 컴핑은 OMR·MusicXML 로 기보를 받는데, 리드시트는
 * 코드 진행이라 **번들 iReal 곡(jazz1460.json, 1,460곡)에서 담기**와 에디터 직접
 * 입력이 자연스럽다. iReal URL 파서는 이 repo 에 없어서 만들지 않았다 — 없는 것을
 * 있는 척 하면 붙여넣기가 조용히 실패한다.
 * ──────────────────────────────────────────────────────────────────────── */

export default function LeadSheetDbPage() {
  const navigate = useNavigate();
  /* 스타일 탭과 선택 항목은 `?item=` 딥링크에서 파생하고, 사용자가 직접 고르면
   * 그 값이 덮는다(override). 효과로 setState 하면 렌더가 한 번 더 돌고, 사용자가
   * 탭을 바꾼 뒤에도 딥링크가 되돌려 버린다. */
  const [searchParams] = useSearchParams();
  const itemParam = searchParams.get('item');
  const [styleOverride, setStyle] = useState<LeadSheetStyle | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIdOverride, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LeadSheetEntry | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [songIndex, setSongIndex] = useState<SongEntry[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  /* 목록을 새로 읽어야 할 때 올린다 — localStorage 는 구독할 수 없어 명시적으로 튕긴다. */
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const all = useMemo(() => loadLeadSheets(), [tick]);

  /* 딥링크 대상. 스타일 탭까지 함께 옮겨야 목록 필터에 걸려 보인다. */
  const deepLinked = useMemo(
    () => (itemParam ? all.find((e) => e.id === itemParam) ?? null : null),
    [all, itemParam],
  );
  const style: LeadSheetStyle = styleOverride ?? deepLinked?.style ?? 'SWING';
  const selectedId = selectedIdOverride ?? deepLinked?.id ?? null;

  const counts = useMemo(() => {
    const c = {} as Record<LeadSheetStyle, number>;
    for (const s of LEAD_SHEET_STYLES) c[s] = 0;
    for (const e of all) if (c[e.style] !== undefined) c[e.style] += 1;
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((e) => e.style === style)
      .filter((e) => !q
        || e.title.toLowerCase().includes(q)
        || (e.composer ?? '').toLowerCase().includes(q));
  }, [all, style, query]);

  const selected = useMemo(
    () => visible.find((e) => e.id === selectedId) ?? null,
    [visible, selectedId],
  );

  /* ?item=<id> 딥링크 — 에디터에서 저장하면 방금 저장한 리드시트로 돌아온다. */

  /** 에디터에서 새로 만든다 — 타입 칩이 Lead Sheet 로 열린다. */
  const createInEditor = useCallback(() => {
    navigate('/editor?mode=leadsheet');
  }, [navigate]);

  const openInEditor = useCallback((entry: LeadSheetEntry) => {
    /* 코드 진행을 그대로 넘긴다. 에디터가 리드시트 모드로 받아 편집한다. */
    navigate('/editor?mode=leadsheet', { state: { prefillChart: entry.chart, leadSheetId: entry.id } });
  }, [navigate]);

  /** 곡 고르기 모달 열기 — 인덱스는 한 번만 받아 둔다(1,460곡 · 캐시됨). */
  const openPicker = useCallback(() => {
    setPickOpen(true);
    setPickError(null);
    if (songIndex) return;
    getSongIndex()
      .then(setSongIndex)
      .catch((e) => setPickError(e instanceof Error ? e.message : '곡 목록을 불러오지 못했습니다.'));
  }, [songIndex]);

  const pickResults = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!songIndex || !q) return [];
    /* 검색어 없이 1,460곡을 다 그리면 모달이 버벅인다 — 입력이 있을 때만 보여준다. */
    return songIndex
      .filter((e) => e.title.toLowerCase().includes(q) || (e.composer ?? '').toLowerCase().includes(q))
      .slice(0, 60);
  }, [songIndex, pickQuery]);

  /** 고른 곡을 현재 스타일로 담는다. */
  const addSong = useCallback(async (entry: SongEntry) => {
    setPickError(null);
    try {
      const chart = await getSong(entry.index);
      if (!chart) { setPickError('곡을 읽지 못했습니다.'); return; }
      createLeadSheet({
        title: chart.title || entry.title || '무제',
        style,
        composer: chart.composer || undefined,
        key: chart.key,
        chart,
        /* 어디서 왔는지 남긴다 — 나중에 백엔드로 이관할 때 출처를 알 수 있어야 한다. */
        irealSource: `jazz1460#${entry.index}`,
      });
      bump();
      setPickOpen(false);
      setPickQuery('');
    } catch (e) {
      setPickError(e instanceof Error ? e.message : '가져오기에 실패했습니다.');
    }
  }, [style, bump]);

  const handleExport = useCallback(() => {
    const blob = new Blob([exportLeadSheets()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lead-sheets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  return (
    <Page>
      <AppSidebar />
      <Body>
        <IntroHead>
          <BackButton onClick={() => navigate(-1)} label="이전 페이지" />
          <IntroTitle>Lead Sheet Database</IntroTitle>
          <LocalBadge title="백엔드 미구현(요구사항 #60) — 이 브라우저의 localStorage 에만 저장됩니다">
            로컬 저장
          </LocalBadge>
          <IntroActions>
            <ActionBtn onClick={openPicker} title="번들 iReal 곡(1,460곡)에서 검색해 현재 스타일에 추가">
              🔎 곡에서 담기
            </ActionBtn>
            <ActionBtn onClick={createInEditor} title="에디터에서 직접 리드시트 작성">
              ✏ Editor로 생성하기
            </ActionBtn>
            <ActionBtn onClick={handleExport} title="전체 데이터 JSON 내보내기 (백엔드 이관/백업용)">
              ⬇ 내보내기
            </ActionBtn>
          </IntroActions>
        </IntroHead>

        <Split>
          {/* ── 좌: 스타일 사이드바 ── */}
          <StylePane>
            {LEAD_SHEET_STYLES.map((s) => (
              <StyleRow key={s} $on={s === style} onClick={() => setStyle(s)}>
                <StyleName>{LEAD_SHEET_STYLE_LABELS[s]}</StyleName>
                <StyleCount>{counts[s]}</StyleCount>
              </StyleRow>
            ))}
            <StyleHint>
              스타일을 고르고 iReal·Editor 로 리드시트를 추가하세요. 저장은 이 브라우저에만
              남습니다(백엔드 예정 — 요구사항 #60).
            </StyleHint>
          </StylePane>

          {/* ── 중: 항목 목록 ── */}
          <ListPane>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${LEAD_SHEET_STYLE_LABELS[style]} 검색 (제목·작곡자)`}
            />
            {visible.length === 0 && (
              <EmptyNote>
                {query
                  ? '검색 결과가 없습니다.'
                  : `${LEAD_SHEET_STYLE_LABELS[style]} 리드시트가 아직 없습니다 — iReal 또는 Editor 로 추가하세요.`}
              </EmptyNote>
            )}
            {visible.map((e) => (
              <EntryRow key={e.id} $on={e.id === selectedId} onClick={() => setSelectedId(e.id)}>
                <EntryTitle>{e.title}</EntryTitle>
                <EntryMeta>
                  {e.composer ? `${e.composer} · ` : ''}{e.key ?? '—'}
                  {e.tempo ? ` · ${e.tempo}bpm` : ''}
                  {' · '}
                  {new Date(e.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                </EntryMeta>
              </EntryRow>
            ))}
          </ListPane>

          {/* ── 우: 미리보기 ── */}
          <PreviewPane>
            {!selected ? (
              <Placeholder>항목을 선택하면 코드 차트가 표시됩니다</Placeholder>
            ) : (
              <>
                <PreviewHead>
                  <PreviewTitle>{selected.title}</PreviewTitle>
                  <PreviewActions>
                    <SmallBtn onClick={() => openInEditor(selected)}>✏ 에디터로 열기</SmallBtn>
                    <SmallBtn $danger onClick={() => setDeleteTarget(selected)}>🗑 삭제</SmallBtn>
                  </PreviewActions>
                </PreviewHead>
                <SheetWrap>
                  {/* key: 항목 전환 시 완전 리마운트 — 이전 차트 상태가 남지 않게 */}
                  <LeadSheet key={selected.id} data={selected.chart} />
                </SheetWrap>
              </>
            )}
          </PreviewPane>
        </Split>
      </Body>

      {pickOpen && (
        <ConfirmBackdrop onClick={() => setPickOpen(false)}>
          <IRealCard onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>곡에서 담기 — {LEAD_SHEET_STYLE_LABELS[style]}</ConfirmTitle>
            <ConfirmText>
              번들된 iReal 스탠더드 <b>1,460곡</b>에서 검색해 현재 스타일로 담습니다.
              제목·작곡자로 찾을 수 있습니다.
            </ConfirmText>
            <SearchInput
              autoFocus
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder={songIndex ? '곡 제목 또는 작곡자' : '곡 목록을 불러오는 중…'}
              disabled={!songIndex}
            />
            {pickError && <ErrorNote>{pickError}</ErrorNote>}
            <PickList>
              {songIndex && pickQuery.trim() && pickResults.length === 0 && (
                <EmptyNote>검색 결과가 없습니다.</EmptyNote>
              )}
              {pickResults.map((e) => (
                <EntryRow key={e.index} onClick={() => void addSong(e)}>
                  <EntryTitle>{e.title}</EntryTitle>
                  <EntryMeta>
                    {e.composer ? `${e.composer} · ` : ''}{e.key}
                    {e.style ? ` · ${e.style}` : ''}
                  </EntryMeta>
                </EntryRow>
              ))}
            </PickList>
            <ConfirmActions>
              <SmallBtn onClick={() => setPickOpen(false)}>닫기</SmallBtn>
            </ConfirmActions>
          </IRealCard>
        </ConfirmBackdrop>
      )}

      {deleteTarget && (
        <ConfirmBackdrop onClick={() => setDeleteTarget(null)}>
          <ConfirmCard onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>리드시트를 삭제할까요?</ConfirmTitle>
            <ConfirmText><b>{deleteTarget.title}</b> — 이 브라우저에서 지워집니다.</ConfirmText>
            <ConfirmActions>
              <SmallBtn onClick={() => setDeleteTarget(null)}>취소</SmallBtn>
              <SmallBtn
                $danger
                onClick={() => {
                  deleteLeadSheet(deleteTarget.id);
                  if (selectedId === deleteTarget.id) setSelectedId(null);
                  setDeleteTarget(null);
                  bump();
                }}
              >
                삭제
              </SmallBtn>
            </ConfirmActions>
          </ConfirmCard>
        </ConfirmBackdrop>
      )}
    </Page>
  );
}

/* ─── styles — Comping/Solo Database 와 같은 치수 ────────────────────────── */

const Page = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.barBelow};
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const IntroHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barTop};
  flex-shrink: 0;
`;

const IntroTitle = styled.h1`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 17px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* 저장 위치를 화면에 드러낸다 — 로컬뿐이라는 걸 모르고 쌓으면 잃는다. */
const LocalBadge = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 10.5px;
  font-weight: 800;
  padding: 3px 7px;
  border-radius: 5px;
  color: #8a6d1a;
  background: rgba(184, 134, 11, 0.14);
  border: 1px solid rgba(184, 134, 11, 0.3);
  flex-shrink: 0;
`;

const IntroActions = styled.div`
  margin-left: auto;
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
`;

const ActionBtn = styled.button`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 11px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

const Split = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px 260px 1fr;
  ${mq.compactLayout} { grid-template-columns: 128px 210px 1fr; }
`;

const StylePane = styled.div`
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  overflow-y: auto;
  padding: 8px 0;
`;

const StyleRow = styled.button<{ $on?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: ${({ $on, theme }) => ($on ? theme.colors.activeFill : 'transparent')};
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  text-align: left;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

const StyleName = styled.span<{ $on?: boolean }>`
  font-size: 13.5px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const StyleCount = styled.span`
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StyleHint = styled.p`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 14px 14px 0;
`;

const ListPane = styled.div`
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  outline: none;
  flex-shrink: 0;
`;

const EmptyNote = styled.p`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 10px 4px;
`;

const EntryRow = styled.button<{ $on?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid ${({ $on, theme }) => ($on ? theme.colors.textSecondary : theme.colors.border)};
  background: ${({ $on, theme }) => ($on ? theme.colors.activeFill : theme.colors.surface)};
  cursor: pointer;
  text-align: left;
  font-family: ${({ theme }) => theme.fonts.ui};
  &:hover { border-color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const EntryTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const EntryMeta = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PreviewPane = styled.div`
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const PreviewHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const PreviewTitle = styled.h2`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const PreviewActions = styled.div`
  margin-left: auto;
  display: flex;
  gap: 7px;
`;

const SmallBtn = styled.button<{ $danger?: boolean; $primary?: boolean }>`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 700;
  padding: 5px 10px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid ${({ $danger, theme }) => ($danger ? theme.colors.dangerBorder : theme.colors.border)};
  color: ${({ $danger, $primary, theme }) =>
    $danger ? theme.colors.danger : $primary ? theme.colors.onInk : theme.colors.textPrimary};
  background: ${({ $danger, $primary, theme }) =>
    $danger ? theme.colors.dangerFill : $primary ? theme.colors.inkSurface : theme.colors.surface};
  &:hover { filter: brightness(0.97); }
`;

const SheetWrap = styled.div`
  padding: 14px 16px 40px;
  min-width: 0;
`;

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ConfirmBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.scrim};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: ${({ theme }) => theme.zIndex.modal};
`;

const ConfirmCard = styled.div`
  width: 340px;
  max-width: 92vw;
  padding: 18px;
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.26);
`;

const IRealCard = styled(ConfirmCard)`
  width: 520px;
`;

const ConfirmTitle = styled.h3`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 8px;
`;

const ConfirmText = styled.p`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 12px;
  code {
    font-size: 11.5px;
    padding: 1px 4px;
    border-radius: 4px;
    background: ${({ theme }) => theme.colors.activeFill};
  }
`;

/* 검색 결과 — 최대 60개만 그리므로 높이를 고정해도 스크롤로 충분하다. */
const PickList = styled.div`
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const ErrorNote = styled.p`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.danger};
  margin-top: 8px;
`;

const ConfirmActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
`;
