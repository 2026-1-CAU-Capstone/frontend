import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { BackButton } from '../components/common/BackButton';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { OMRUploadModal } from '../components/common/OMRUploadModal';
import { createSoloViaOMR, getSoloOmrStatus, getSolo, deleteSolo } from '../api/solos';
import { parseXmlString, loadMxlParts, type ScorePart } from '../lib/note/xmlMelodyParser';
import type { OMRMetadata } from '../api/licks';
import {
  loadCompings, createComping, deleteComping, exportCompings,
  COMPING_GENRES, COMPING_GENRE_LABELS,
  type CompingEntry, type CompingGenre,
} from '../data/compingData';

/* ─────────────────────────────────────────────────────────────────────────
 * CompingPage (/comping) — admin 전용 Comping Database.
 *
 * 피아노 컴핑 자료를 **장르별**(Swing/Blues/BossaNova/Latin)로 수집한다.
 * Solo Database 와 같은 결(좌: 그룹 사이드바 · 우: 목록+악보 미리보기)이지만,
 * ⚠️ 백엔드 미구현 — 데이터는 localStorage(data/compingData)에만 남는다.
 *
 * OMR: 컴핑 전용 백엔드가 없으므로 **솔로 OMR API 를 인식 엔진으로만 빌려 쓴다**
 * — 업로드→인식 완료→sheetData 를 로컬로 가져온 뒤, 서버에 생긴 임시 솔로는
 * 삭제해 Solo DB 를 오염시키지 않는다.
 * ──────────────────────────────────────────────────────────────────────── */

type OmrBanner =
  | { phase: 'uploading' | 'polling'; label: string }
  | { phase: 'error'; label: string; message: string }
  | null;

export default function CompingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [entries, setEntries] = useState<CompingEntry[]>(() => loadCompings());
  const [genre, setGenre] = useState<CompingGenre>('SWING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [omrOpen, setOmrOpen] = useState(false);
  const [omrBanner, setOmrBanner] = useState<OmrBanner>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompingEntry | null>(null);

  const reload = useCallback(() => setEntries(loadCompings()), []);

  /* 에디터에서 저장 후 `/comping?item=<id>` 로 돌아오면 그 항목을 자동 선택. */
  useEffect(() => {
    const item = searchParams.get('item');
    if (!item) return;
    const found = loadCompings().find((e) => e.id === item);
    if (found) {
      setGenre(found.genre);
      setSelectedId(found.id);
    }
  }, [searchParams]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(COMPING_GENRES.map((g) => [g, 0])) as Record<CompingGenre, number>;
    for (const e of entries) c[e.genre] = (c[e.genre] ?? 0) + 1;
    return c;
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => e.genre === genre)
      .filter((e) => !q || e.title.toLowerCase().includes(q) || (e.composer ?? '').toLowerCase().includes(q));
  }, [entries, genre, query]);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  /* 목록에서 항목이 사라졌으면(삭제 등) 첫 항목으로 선택 이동. */
  useEffect(() => {
    if (selected && selected.genre === genre) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [genre, visible, selected]);

  const openInEditor = useCallback((entry: CompingEntry) => {
    navigate('/editor?mode=comping', {
      state: { prefillSheet: entry.sheetData, compingId: entry.id, compingGenre: entry.genre },
    });
  }, [navigate]);

  const createInEditor = useCallback(() => {
    navigate('/editor?mode=comping', { state: { compingGenre: genre } });
  }, [navigate, genre]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteComping(deleteTarget.id);
    setDeleteTarget(null);
    reload();
  }, [deleteTarget, reload]);

  const handleExport = useCallback(() => {
    const blob = new Blob([exportCompings()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comping-database-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ── OMR — 솔로 API 로 인식 → sheetData 만 로컬 저장 → 임시 솔로 삭제 ── */
  const startOmr = useCallback(async (file: File, metadata: OMRMetadata) => {
    const title = metadata.title?.trim() || file.name.replace(/\.(pdf|png|jpe?g)$/i, '');
    setOmrBanner({ phase: 'uploading', label: title });
    try {
      const solo = await createSoloViaOMR(file, {
        ...metadata,
        title,
        // Solo DB 오염 방지 표식 — 인식 직후 삭제되지만, 혹시 남아도 걸러 보이게.
        performer: 'comping-temp',
        composer: 'comping-temp',
        source: 'user',
      });
      if (!solo?.publicId) throw new Error('서버 응답에 악보 데이터가 없어요.');
      setOmrBanner({ phase: 'polling', label: title });

      // 터미널까지 폴링 (5초 간격, 최대 15분 — 문서 #23 규칙)
      const startedAt = Date.now();
      for (;;) {
        const st = await getSoloOmrStatus(solo.publicId);
        if (st.status === 'COMPLETED') break;
        if (st.status === 'FAILED') throw new Error(st.failureReason ?? '악보 인식에 실패했어요.');
        if (Date.now() - startedAt > 15 * 60_000) throw new Error('처리 상태를 확인하지 못했어요(15분).');
        await new Promise<void>((r) => { window.setTimeout(r, 5000); });
      }

      const full = await getSolo(solo.publicId);
      if (!full?.sheetData?.measures?.length) throw new Error('인식 결과에 악보가 비어 있어요.');

      const entry = createComping({
        title,
        genre,
        composer: undefined,
        key: full.sheetData.key ?? 'C',
        tempo: full.sheetData.tempo ?? undefined,
        sheetData: full.sheetData,
      });
      // 인식용 임시 솔로 정리 — 실패해도 무시(comping-temp 표식으로 식별 가능).
      void deleteSolo(solo.publicId).catch(() => {});

      setOmrBanner(null);
      reload();
      setGenre(entry.genre);
      setSelectedId(entry.id);
    } catch (e) {
      setOmrBanner({
        phase: 'error',
        label: title,
        message: e instanceof Error ? e.message : 'OMR 인식 실패',
      });
    }
  }, [genre, reload]);

  /* ── MusicXML/MXL 직접 가져오기 — 백엔드를 안 거치므로 **양손이 유실되지 않는다**.
   * `<staves>2` 자동 감지(parseGrandStaff)로 bassMeasures 까지 그대로 보존되고,
   * 평문 XML 은 원본 문자열도 함께 저장한다(재파싱·이관 대비). OMR 왼손 유실
   * (#33) 의 프론트 측 우회로이기도 하다. */
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const importMusicXmlFiles = useCallback(async (files: File[]) => {
    let lastId: string | null = null;
    const failed: string[] = [];
    for (const file of files) {
      const base = file.name.replace(/\.(musicxml|xml|mxl)$/i, '');
      try {
        const isMxl = /\.mxl$/i.test(file.name);
        let parts: ScorePart[];
        let rawXml: string | undefined;
        if (isMxl) {
          // .mxl(zip) 은 기존 로더가 URL 로 받으므로 object URL 로 우회.
          const url = URL.createObjectURL(file);
          try { parts = await loadMxlParts(url, base); } finally { URL.revokeObjectURL(url); }
        } else {
          rawXml = await file.text();
          parts = parseXmlString(rawXml, base);
        }
        // 양손(grand staff) 파트 우선, 없으면 첫 파트.
        const part = parts.find((p) => (p.data.bassMeasures?.length ?? 0) > 0) ?? parts[0];
        if (!part?.data?.measures?.length) throw new Error('악보 파트를 찾지 못했어요.');
        const entry = createComping({
          title: part.data.title || base,
          genre,
          composer: part.data.composer || undefined,
          key: part.data.key ?? 'C',
          tempo: part.data.tempo ?? undefined,
          sheetData: part.data,
          ...(rawXml ? { musicXml: rawXml } : {}),
        });
        lastId = entry.id;
      } catch {
        failed.push(file.name);
      }
    }
    reload();
    if (lastId) setSelectedId(lastId);
    if (failed.length > 0) {
      setOmrBanner({ phase: 'error', label: 'MusicXML 가져오기', message: `실패: ${failed.join(', ')}` });
    }
  }, [genre, reload]);

  return (
    <Page>
      <IconSidebar />
      <Body>
        <IntroHead>
          <BackButton onClick={() => navigate(-1)} label="이전 페이지" />
          <IntroTitle>Comping Database</IntroTitle>
          <LocalBadge title="백엔드 미구현 — 이 브라우저의 localStorage 에만 저장됩니다">
            로컬 저장
          </LocalBadge>
          <IntroActions>
            <ActionBtn onClick={() => setOmrOpen(true)} title="악보 파일을 OMR 인식해 현재 장르에 추가">
              📄 OMR로 생성하기
            </ActionBtn>
            <ActionBtn onClick={createInEditor} title="에디터에서 직접 컴핑 작성">
              ✏ Editor로 생성하기
            </ActionBtn>
            <ActionBtn
              onClick={() => xmlInputRef.current?.click()}
              title="MusicXML/MXL 파일 직접 가져오기 — 백엔드를 거치지 않아 양손(그랜드 스태프)이 그대로 보존됩니다"
            >
              🎼 MusicXML 가져오기
            </ActionBtn>
            <HiddenInput
              ref={xmlInputRef}
              type="file"
              multiple
              accept=".xml,.musicxml,.mxl"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length > 0) void importMusicXmlFiles(files);
              }}
            />
            <ActionBtn onClick={handleExport} title="전체 데이터 JSON 내보내기 (백엔드 이관/백업용)">
              ⬇ 내보내기
            </ActionBtn>
          </IntroActions>
        </IntroHead>

        {omrBanner && (
          <OmrBannerBox $error={omrBanner.phase === 'error'}>
            {omrBanner.phase === 'error' ? (
              <>
                <b>{omrBanner.label}</b> — {omrBanner.message}
                <BannerClose type="button" onClick={() => setOmrBanner(null)}>×</BannerClose>
              </>
            ) : (
              <>
                <Spinner aria-hidden />
                <b>{omrBanner.label}</b> — {omrBanner.phase === 'uploading' ? '업로드 중…' : '악보 인식 중… (완료되면 현재 장르에 추가됩니다)'}
              </>
            )}
          </OmrBannerBox>
        )}

        <Split>
          {/* ── 좌: 장르 사이드바 ── */}
          <GenrePane>
            {COMPING_GENRES.map((g) => (
              <GenreRow key={g} $on={g === genre} onClick={() => setGenre(g)}>
                <GenreName>{COMPING_GENRE_LABELS[g]}</GenreName>
                <GenreCount>{counts[g]}</GenreCount>
              </GenreRow>
            ))}
            <GenreHint>
              장르를 고르고 OMR·Editor 로 자료를 추가하세요. 저장은 이 브라우저에만 남습니다(백엔드 예정).
            </GenreHint>
          </GenrePane>

          {/* ── 중: 항목 목록 ── */}
          <ListPane>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${COMPING_GENRE_LABELS[genre]} 검색 (제목·작곡자)`}
            />
            {visible.length === 0 && (
              <EmptyNote>
                {query ? '검색 결과가 없습니다.' : `${COMPING_GENRE_LABELS[genre]} 컴핑이 아직 없습니다 — OMR 또는 Editor 로 추가하세요.`}
              </EmptyNote>
            )}
            {visible.map((e) => (
              <EntryRow key={e.id} $on={e.id === selectedId} onClick={() => setSelectedId(e.id)}>
                <EntryTitle>{e.title}</EntryTitle>
                <EntryMeta>
                  {e.composer ? `${e.composer} · ` : ''}{e.key}
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
              <Placeholder>항목을 선택하면 악보가 표시됩니다</Placeholder>
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
                  {/* key: 항목 전환 시 완전 리마운트 — 이전 악보 상태가 남지 않게 */}
                  <NoteSheet key={selected.id} data={selected.sheetData} noPreload />
                </SheetWrap>
              </>
            )}
          </PreviewPane>
        </Split>
      </Body>

      <OMRUploadModal
        open={omrOpen}
        onClose={() => setOmrOpen(false)}
        title={`OMR로 컴핑 생성 — ${COMPING_GENRE_LABELS[genre]}`}
        submitLabel="인식 시작 (백그라운드)"
        upload={async () => { throw new Error('unreachable'); }}
        onBackgroundStart={(file, meta) => { void startOmr(file, meta); }}
      />

      {deleteTarget && (
        <ConfirmBackdrop onClick={() => setDeleteTarget(null)}>
          <ConfirmCard onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>컴핑을 삭제할까요?</ConfirmTitle>
            <ConfirmText>“{deleteTarget.title}” ({COMPING_GENRE_LABELS[deleteTarget.genre]}) — 로컬 저장이라 복구할 수 없습니다.</ConfirmText>
            <ConfirmActions>
              <GhostBtn type="button" onClick={() => setDeleteTarget(null)}>취소</GhostBtn>
              <DangerBtn type="button" onClick={handleDelete}>삭제</DangerBtn>
            </ConfirmActions>
          </ConfirmCard>
        </ConfirmBackdrop>
      )}
    </Page>
  );
}

/* ── styled — Solo Database 와 같은 결 ─────────────────────────────────── */
const GOLD = '#B8860B';

const Page = styled.div`
  display: flex;
  height: 100dvh;
  width: 100%;
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
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 14px) 18px 12px;
  /* 페이지 최상단 바 — 전 페이지 공통 회색. */
  background: ${({ theme }) => theme.colors.barTop};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-wrap: wrap;
`;
const IntroTitle = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.01em;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const LocalBadge = styled.span`
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  color: #8a6d1c;
  background: rgba(184, 134, 11, 0.12);
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const IntroActions = styled.div`
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;
const ActionBtn = styled.button`
  padding: 8px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; border-color: ${GOLD}; }
`;
const Split = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  ${mq.mobile} { flex-direction: column; overflow-y: auto; }
`;
const GenrePane = styled.div`
  width: 190px;
  flex: 0 0 auto;
  padding: 12px 10px;
  background: ${({ theme }) => theme.colors.surface};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: ${({ theme }) => theme.fonts.ui};
  ${mq.mobile} { width: 100%; flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid ${({ theme }) => theme.colors.border}; }
`;
const GenreRow = styled.button<{ $on: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.12)' : 'transparent')};
  box-shadow: ${({ $on }) => ($on ? `inset 3px 0 0 ${GOLD}` : 'none')};
  &:hover { background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.12)' : '#f6f6f4')}; }
`;
const GenreName = styled.span` font-size: 14px; font-weight: 700; color: ${({ theme }) => theme.colors.textPrimary}; `;
const GenreCount = styled.span`
  font-size: 11.5px;
  font-weight: 700;
  color: #8a6d1c;
  background: rgba(184, 134, 11, 0.12);
  padding: 1px 8px;
  border-radius: 999px;
`;
const GenreHint = styled.div`
  margin-top: auto;
  padding: 10px 11px;
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.surface};
  font-size: 11.5px;
  line-height: 1.55;
  color: ${({ theme }) => theme.colors.textSecondary};
  ${mq.mobile} { display: none; }
`;
const ListPane = styled.div`
  width: 290px;
  flex: 0 0 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: ${({ theme }) => theme.colors.surface};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: ${({ theme }) => theme.fonts.ui};
  ${mq.mobile} { width: 100%; border-right: none; border-bottom: 1px solid ${({ theme }) => theme.colors.border}; max-height: 40vh; }
`;
const SearchInput = styled.input`
  height: 36px;
  padding: 0 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 9px;
  outline: none;
  font-size: 13.5px;
  font-family: ${({ theme }) => theme.fonts.ui};
  &:focus { border-color: ${GOLD}; }
`;
const EntryRow = styled.button<{ $on: boolean }>`
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.10)' : 'transparent')};
  &:hover { background: ${({ $on }) => ($on ? 'rgba(184,134,11,0.10)' : '#f6f6f4')}; }
`;
const EntryTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const EntryMeta = styled.span` font-size: 11.5px; color: ${({ theme }) => theme.colors.textSecondary}; `;
const EmptyNote = styled.div` padding: 22px 8px; font-size: 13px; color: ${({ theme }) => theme.colors.textSecondary}; text-align: center; line-height: 1.6; `;
const PreviewPane = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;
const PreviewHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px 8px;
  flex-wrap: wrap;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const PreviewTitle = styled.h2`
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 17px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const PreviewActions = styled.div` display: flex; gap: 8px; `;
const SmallBtn = styled.button<{ $danger?: boolean }>`
  padding: 7px 13px;
  border-radius: 9px;
  border: 1px solid ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.4)' : '#e2e2e2')};
  background: ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.06)' : '#fff')};
  color: ${({ $danger }) => ($danger ? '#c04c4c' : '#444')};
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  &:hover { background: ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.12)' : '#f6f6f4')}; }
`;
const SheetWrap = styled.div` padding: 0 12px 24px; `;
const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const OmrBannerBox = styled.div<{ $error: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 18px 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ $error }) => ($error ? '#a03022' : '#8a6d1c')};
  background: ${({ $error }) => ($error ? 'rgba(160,48,34,0.08)' : 'rgba(184,134,11,0.10)')};
  b { font-weight: 700; }
`;
const BannerClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
`;
const Spinner = styled.span`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2.5px solid rgba(184, 134, 11, 0.25);
  border-top-color: ${GOLD};
  animation: cmpSpin 0.9s linear infinite;
  @keyframes cmpSpin { to { transform: rotate(360deg); } }
`;
const HiddenInput = styled.input`
  display: none;
`;
const ConfirmBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.scrim};
  z-index: ${({ theme }) => theme.zIndex.max};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;
const ConfirmCard = styled.div`
  width: min(380px, 100%);
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 14px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const ConfirmTitle = styled.h2` margin: 0; font-size: 16px; font-weight: 800; color: ${({ theme }) => theme.colors.textPrimary}; `;
const ConfirmText = styled.p` margin: 0; font-size: 13px; line-height: 1.6; color: ${({ theme }) => theme.colors.textSecondary}; `;
const ConfirmActions = styled.div` display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; `;
const GhostBtn = styled.button`
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 8px 14px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
`;
const DangerBtn = styled.button`
  border: none;
  background: #c04c4c;
  color: #fff;
  padding: 8px 18px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  &:hover { background: #a83e3e; }
`;
