import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useDismissable } from '../hooks/useDismissable';
import { useViewModePref } from '../hooks/useViewModePref';
import {
  CardMeta,
  Header,
  HeaderActions,
  IconOnlyBtn,
  Kebab,
  KebabDot,
  KebabMenuIcon,
  KebabMenuItem,
  KeyChip,
  List,
  ListMain,
  ListNewRow,
  ListRow,
  ListSubtitle,
  ListTitle,
  MetaRow,
  ModalLabel,
  Page,
  PillBtn,
  SbBtn,
  SelectionBar,
  SheetCardInner,
  SortItem,
  SortLabel,
  SortWrap,
  TimeChip,
  Title,
  ViewToggle,
  ViewToggleBtn,
  Grid,
  KebabMenu,
  SortMenu,
  PageBody,
  ListThumb,
} from '../components/projects/sharedStyles';
import { isComposingEvent } from '../lib/ime';
import styled from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import type { NoteSheetData } from '../data/sampleMelody';
import { leadsheetSongs, type NoteSongEntry } from '../data/noteSongs';
import {
  KEY_SIGNATURES,
  createSheetProject,
  deleteSheetProject,
  listSheetProjects,
  updateSheetProject,
  type KeySignature,
  type SheetProject,
} from '../api/sheetProjects';
import { getCachedUser } from '../api/auth';
import { uploadStorageFile } from '../api/storageFiles';

type SortMode = 'recent' | 'old' | 'name' | 'type';

interface UploadedSheetProject {
  id: string;
  title: string;
  key: string;
  fileName: string;
  createdAt: string;
}

const VIEW_MODE_STORAGE_KEY = 'jazzify.mySheets.viewMode.v1';
const UPLOADED_STORAGE_KEY = 'jazzify.mySheets.uploaded.v1';


function loadUploadedProjects(): UploadedSheetProject[] {
  try {
    const raw = localStorage.getItem(UPLOADED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUploadedProjects(items: UploadedSheetProject[]): void {
  try { localStorage.setItem(UPLOADED_STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatKeyLabel(key: string | undefined): string {
  if (!key) return '';
  return key
    .replace(/_MAJOR$/, '')
    .replace(/_MINOR$/, 'm')
    .replace(/_FLAT/g, 'b')
    .replace(/_SHARP/g, '#')
    .replace(/_/g, ' ');
}

function formatComposer(composer: string | undefined): string {
  return composer?.trim() || 'Unknown Composer';
}

export default function MySheetProjectsPage() {
  const [viewMode, setViewMode] = useViewModePref(VIEW_MODE_STORAGE_KEY);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const [kebabMenuId, setKebabMenuId] = useState<string | null>(null);
  const [uploadedProjects, setUploadedProjects] = useState<UploadedSheetProject[]>(loadUploadedProjects);

  /* ── 서버 목록 동기화 ──
   * localStorage만 쓰던 이전 구현은 (a) 다른 기기/브라우저의 프로젝트가 안
   * 보이고, (b) localStorage가 지워지면 서버에 살아있는 프로젝트가 UI에서
   * 영영 사라졌으며, (c) 이름 변경이 서버에 반영되지 않았다. 마운트 시
   * GET /v1/sheet-projects 를 단일 진실 원천으로 로드하고 localStorage는
   * 캐시(즉시 페인트 + 오프라인 폴백)로만 유지한다. */
  const serverToLocal = (sp: SheetProject): UploadedSheetProject => ({
    id: sp.publicId,
    title: sp.title,
    key: String(sp.keySignature ?? ''),
    fileName: '',
    createdAt: (sp.createdAt ?? '').slice(0, 10) || today(),
  });
  useEffect(() => {
    if (!getCachedUser()) return; // 비로그인: 서버 목록 없음 — 로컬 캐시 유지
    let cancelled = false;
    listSheetProjects({ size: 100, sort: 'createdAt,desc' })
      .then((page) => {
        if (cancelled) return;
        setUploadedProjects((prev) => {
          const server = page.content.map(serverToLocal);
          // 로컬에만 있는 항목(방금 업로드해 목록 반영 전 등)은 보존하며 병합.
          const serverIds = new Set(server.map((x) => x.id));
          const localOnly = prev.filter((x) => !serverIds.has(x.id));
          // fileName은 서버 응답에 없으므로 로컬 캐시 값을 이어받는다.
          const byId = new Map(prev.map((x) => [x.id, x]));
          return [
            ...server.map((x) => ({ ...x, fileName: byId.get(x.id)?.fileName ?? x.fileName })),
            ...localOnly,
          ];
        });
      })
      .catch((e) => {
        // 네트워크/만료 — 로컬 캐시로 계속 동작 (조용한 폴백, 콘솔만)
        console.warn('[MySheetProjects] 서버 목록 로드 실패 — 로컬 캐시 사용:', e);
      });
    return () => { cancelled = true; };
  }, []);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newKey, setNewKey] = useState<KeySignature>('C_MAJOR');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortWrapRef = useRef<HTMLDivElement>(null);
  const kebabMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveUploadedProjects(uploadedProjects); }, [uploadedProjects]);

  useDismissable(sortMenuOpen, sortWrapRef, () => setSortMenuOpen(false));

  useDismissable(!!kebabMenuId, kebabMenuRef, () => setKebabMenuId(null));

  const visibleSongs = useMemo(() => {
    const list = [...leadsheetSongs];
    if (sortBy === 'name') return list.sort((a, b) => a.title.localeCompare(b.title));
    if (sortBy === 'old') return list.reverse();
    return list;
  }, [sortBy]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectMode = () => {
    setSelectMode((v) => {
      const next = !v;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setNewFile(f);
    if (f && !newTitle.trim()) {
      const dot = f.name.lastIndexOf('.');
      setNewTitle(dot > 0 ? f.name.slice(0, dot) : f.name);
    }
  };

  const resetCreateForm = () => {
    setNewTitle('');
    setNewKey('C_MAJOR');
    setNewFile(null);
    setError(null);
  };

  const openCreateModal = () => {
    resetCreateForm();
    setCreateOpen(true);
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
    resetCreateForm();
  };

  // 업로드 성공 후 createSheetProject가 실패하면, 재시도 때 같은 파일을 또 올려
  // 서버에 고아 파일이 누적된다(스토리지엔 delete API가 없음). 동일 File이면 직전
  // 업로드 결과를 재사용해 누적을 막는다(Fable §4 399). 성공 시 캐시를 비운다.
  const uploadedRef = useRef<{ file: File; publicId: string } | null>(null);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newFile) return;
    setCreating(true);
    setError(null);
    try {
      let storedId = uploadedRef.current?.file === newFile ? uploadedRef.current.publicId : null;
      if (!storedId) {
        const stored = await uploadStorageFile(newFile, newFile.name);
        storedId = stored.publicId;
        uploadedRef.current = { file: newFile, publicId: storedId };
      }
      const created = await createSheetProject({
        title: newTitle.trim(),
        key: newKey,
        storageFileIds: [storedId],
      });
      uploadedRef.current = null;
      setUploadedProjects((prev) => [{
        id: created.publicId,
        title: created.title,
        key: String(created.keySignature ?? newKey),
        fileName: newFile.name,
        createdAt: created.createdAt?.slice(0, 10) || today(),
      }, ...prev]);
      closeCreateModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : '악보 프로젝트 생성 실패');
    } finally {
      setCreating(false);
    }
  };

  const openKebab = (id: string) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    setKebabMenuId((prev) => (prev === id ? null : id));
  };

  const startRenameUploaded = (item: UploadedSheetProject) => {
    setKebabMenuId(null);
    setRenameTarget({ id: item.id, title: item.title });
    setRenameInput(item.title);
  };

  const confirmRename = () => {
    if (!renameTarget) return;
    const next = renameInput.trim();
    if (!next) return;
    const targetId = renameTarget.id;
    const prevTitle = renameTarget.title;
    // 낙관적 반영 후 서버 PUT — 실패 시 롤백 + 에러 배너. (이전엔 로컬만 바꿔
    // 서버 제목과 영구 불일치 — MyChordChartsPage의 confirmEdit와 비대칭이었다.)
    setUploadedProjects((prev) => prev.map((p) => (p.id === targetId ? { ...p, title: next } : p)));
    setRenameTarget(null);
    setRenameInput('');
    updateSheetProject(targetId, { title: next }).catch((e) => {
      setUploadedProjects((prev) => prev.map((p) => (p.id === targetId ? { ...p, title: prevTitle } : p)));
      setError(e instanceof Error ? e.message : '이름 변경 실패 (서버 반영 안 됨)');
    });
  };

  /* Single-item delete from the kebab menu. Calls the backend first; on
   * success the row is removed locally and the selection set is cleaned
   * up. Network failures surface via setError (existing pattern
   * used elsewhere on this page). */
  const deleteUploaded = async (id: string): Promise<void> => {
    setKebabMenuId(null);
    try {
      await deleteSheetProject(id);
      setUploadedProjects((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '악보 삭제 실패');
    }
  };

  /* Bulk-delete confirm modal (driven by the selection-bar 삭제 button).
   * `null` = closed; truthy = open showing the count. */
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const requestBulkDelete = (): void => {
    if (selectedIds.size === 0) return;
    setBulkDeleteOpen(true);
  };
  const confirmBulkDelete = async (): Promise<void> => {
    const ids = Array.from(selectedIds).filter((id) => uploadedProjects.some((p) => p.id === id));
    if (ids.length === 0) {
      setBulkDeleteOpen(false);
      exitSelect();
      return;
    }
    setBulkDeleting(true);
    /* Sequential — predictable error reporting and avoids slamming the
     * backend if the user selected dozens of rows. Each SUCCESS is applied
     * immediately: a failure at item k used to leave the already-deleted
     * 0..k-1 rows on screen (server/UI 불일치). */
    const okIds: string[] = [];
    let firstErr: unknown = null;
    for (const id of ids) {
      try {
        await deleteSheetProject(id);
        okIds.push(id);
      } catch (e) {
        firstErr = e;
        break; // 같은 원인(만료/네트워크)일 가능성이 높아 연쇄 404 방지 위해 중단
      }
    }
    if (okIds.length > 0) {
      setUploadedProjects((prev) => prev.filter((p) => !okIds.includes(p.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        okIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    if (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : '악보 일괄 삭제 실패';
      setError(`${msg} — ${okIds.length}/${ids.length}개 삭제됨`);
    } else {
      setBulkDeleteOpen(false);
      exitSelect();
    }
    setBulkDeleting(false);
  };

  /* Selection-bar handlers — mirror the chord-chart page so the bar reads
   * and behaves identically across both libraries. */
  const exitSelect = (): void => { setSelectMode(false); setSelectedIds(new Set()); };
  const selectAllCurrent = (): void => {
    const all = new Set<string>();
    uploadedProjects.forEach((p) => all.add(p.id));
    visibleSongs.forEach((s) => all.add(s.id));
    setSelectedIds(all);
  };
  /* Bulk delete from the selection bar. Only user-uploaded items can be
   * removed — bundled `visibleSongs` come from a static asset list and
   * have no delete API, so selected sample songs are simply ignored.
   * (Now routed through confirmBulkDelete after the confirm modal.) */


  return (
    <Page>
      <IconSidebar />
      <PageBody>
        <Header>
          <Title>내 악보 차트</Title>
          <HeaderActions>
            <PillBtn type="button" onClick={toggleSelectMode}>{selectMode ? '완료' : '선택'}</PillBtn>
            <ViewToggle>
              <ViewToggleBtn
                type="button"
                aria-label="그리드 보기"
                aria-pressed={viewMode === 'grid'}
                $active={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
              >
                <GridViewIcon />
              </ViewToggleBtn>
              <ViewToggleBtn
                type="button"
                aria-label="리스트 보기"
                aria-pressed={viewMode === 'list'}
                $active={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <ListViewIcon />
              </ViewToggleBtn>
            </ViewToggle>
            <SortWrap ref={sortWrapRef}>
              <IconOnlyBtn type="button" aria-label="정렬" onClick={() => setSortMenuOpen((v) => !v)}>
                <SortIcon />
              </IconOnlyBtn>
              {sortMenuOpen && (
                <SortMenu role="menu">
                  {([
                    ['recent', '최신순'],
                    ['old', '오래된순'],
                    ['name', '이름순'],
                    ['type', '유형순'],
                  ] as const).map(([id, label]) => (
                    <SortItem key={id} $active={sortBy === id} onClick={() => { setSortBy(id); setSortMenuOpen(false); }}>
                      <SortLabel $active={sortBy === id}>{label}</SortLabel>
                      {sortBy === id && <CheckTiny />}
                    </SortItem>
                  ))}
                </SortMenu>
              )}
            </SortWrap>
            <PillBtn type="button"><GearIcon /> 설정</PillBtn>
          </HeaderActions>
        </Header>

        {/* 페이지 레벨 에러 — 삭제/일괄삭제 실패는 생성 모달 밖에서 발생하므로
          * ModalError(모달 내부)만으론 사용자에게 아무 피드백이 없었다.
          * (MyChordChartsPage의 ErrorBanner와 동일 패턴) */}
        {error && !createOpen && (
          <PageErrorBanner>
            <span>{error}</span>
            <PageErrorClose type="button" onClick={() => setError(null)}>닫기</PageErrorClose>
          </PageErrorBanner>
        )}

        {viewMode === 'grid' ? (
          <Grid>
            <NewCard type="button" onClick={openCreateModal}>
              <PlusIcon />
              <NewLabel>신규</NewLabel>
            </NewCard>

            {uploadedProjects.map((item) => (
              <SheetCard
                key={item.id}
                $selected={selectedIds.has(item.id)}
                $menuOpen={kebabMenuId === item.id}
                onClick={() => selectMode && toggleSelect(item.id)}
              >
                {selectMode && (
                  <CardCheckbox
                    $checked={selectedIds.has(item.id)}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                    aria-label="선택"
                  >
                    {selectedIds.has(item.id) && <CheckMark />}
                  </CardCheckbox>
                )}
                <UploadedThumb>
                  <FileMusicIcon />
                  <UploadedThumbText>{item.fileName}</UploadedThumbText>
                </UploadedThumb>
                <CardMeta>
                  <CardTitleRow>
                    <CardTitle title={item.title}>{item.title}</CardTitle>
                    <KeyChip>{formatKeyLabel(item.key)}</KeyChip>
                    <TimeChip>4/4</TimeChip>
                  </CardTitleRow>
                  <MetaRow>
                    <ComposerText>{item.fileName}</ComposerText>
                  </MetaRow>
                </CardMeta>
                <Kebab aria-label="더보기" onClick={openKebab(item.id)}>
                  <KebabDot /><KebabDot /><KebabDot />
                </Kebab>
                {kebabMenuId === item.id && (
                  <KebabMenu ref={kebabMenuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                    <KebabMenuItem type="button" onClick={() => startRenameUploaded(item)}>
                      <KebabMenuIcon><RenameIcon /></KebabMenuIcon>
                      <span>이름 변경</span>
                    </KebabMenuItem>
                    <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('이동: 추후 구현'); }}>
                      <KebabMenuIcon><MoveIcon /></KebabMenuIcon>
                      <span>이동</span>
                    </KebabMenuItem>
                    <KebabMenuItem type="button" $danger onClick={() => void deleteUploaded(item.id)}>
                      <KebabMenuIcon><TrashIcon /></KebabMenuIcon>
                      <span>삭제</span>
                    </KebabMenuItem>
                  </KebabMenu>
                )}
              </SheetCard>
            ))}

            {visibleSongs.map((song) => (
              <SheetCard
                key={song.id}
                $selected={selectedIds.has(song.id)}
                $menuOpen={kebabMenuId === song.id}
                onClick={() => selectMode && toggleSelect(song.id)}
              >
                {selectMode && (
                  <CardCheckbox
                    $checked={selectedIds.has(song.id)}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(song.id); }}
                    aria-label="선택"
                  >
                    {selectedIds.has(song.id) && <CheckMark />}
                  </CardCheckbox>
                )}
                <SheetCardInner>
                  <SheetPreview song={song} />
                </SheetCardInner>
                <CardMeta>
                  <CardTitleRow>
                    <CardTitle title={song.title}>{song.title}</CardTitle>
                    <KeyChip>{extractKeyFromTitle(song.title)}</KeyChip>
                    <TimeChip>4/4</TimeChip>
                  </CardTitleRow>
                  <MetaRow>
                    <ComposerText>{formatComposer(song.composer)}</ComposerText>
                  </MetaRow>
                </CardMeta>
                <Kebab aria-label="더보기" onClick={openKebab(song.id)}>
                  <KebabDot /><KebabDot /><KebabDot />
                </Kebab>
                {kebabMenuId === song.id && (
                  <KebabMenu ref={kebabMenuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                    {/* Bundled sample songs aren't user-owned, so every
                     * action is informational — preserves the design's
                     * uniform menu while making it clear nothing
                     * destructive can happen here. */}
                    <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('기본 제공 곡은 이름을 변경할 수 없습니다.'); }}>
                      <KebabMenuIcon><RenameIcon /></KebabMenuIcon>
                      <span>이름 변경</span>
                    </KebabMenuItem>
                    <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('이동: 추후 구현'); }}>
                      <KebabMenuIcon><MoveIcon /></KebabMenuIcon>
                      <span>이동</span>
                    </KebabMenuItem>
                    <KebabMenuItem type="button" $danger onClick={() => { setKebabMenuId(null); alert('기본 제공 곡은 삭제할 수 없습니다.'); }}>
                      <KebabMenuIcon><TrashIcon /></KebabMenuIcon>
                      <span>삭제</span>
                    </KebabMenuItem>
                  </KebabMenu>
                )}
              </SheetCard>
            ))}
          </Grid>
        ) : (
          <List>
            <ListNewRow type="button" onClick={openCreateModal}>
              <ListThumb $tone="new"><PlusIcon /></ListThumb>
              <ListMain>
                <ListTitle>신규</ListTitle>
                <ListSubtitle>새 악보 프로젝트 추가</ListSubtitle>
              </ListMain>
            </ListNewRow>
            {uploadedProjects.map((item) => (
              <ListRow key={item.id} $selected={selectedIds.has(item.id)} onClick={() => selectMode && toggleSelect(item.id)}>
                <ListThumb><FileMusicIcon /></ListThumb>
                <ListMain>
                  <ListTitle>{item.title}</ListTitle>
                  <ListSubtitle>{formatKeyLabel(item.key)} · {item.fileName}</ListSubtitle>
                </ListMain>
              </ListRow>
            ))}
            {visibleSongs.map((song) => (
              <ListRow key={song.id} $selected={selectedIds.has(song.id)} onClick={() => selectMode && toggleSelect(song.id)}>
                <ListThumb $tone="sheet"><ListSheetMini /></ListThumb>
                <ListMain>
                  <ListTitle>{song.title}</ListTitle>
                  <ListSubtitle>{formatComposer(song.composer)}</ListSubtitle>
                </ListMain>
                <KeyChip>{extractKeyFromTitle(song.title)}</KeyChip>
              </ListRow>
            ))}
          </List>
        )}

        {createOpen && (
          <ModalBackdrop onClick={closeCreateModal}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>새 악보 프로젝트</ModalTitle>
              <ModalField>
                <ModalLabel>제목</ModalLabel>
                <ModalInput
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예: Autumn Leaves"
                />
              </ModalField>
              <ModalField>
                <ModalLabel>조성</ModalLabel>
                <ModalSelect value={newKey} onChange={(e) => setNewKey(e.target.value as KeySignature)}>
                  {KEY_SIGNATURES.map((k) => <option key={k} value={k}>{formatKeyLabel(k)}</option>)}
                </ModalSelect>
              </ModalField>
              <ModalField>
                <ModalLabel>파일 선택</ModalLabel>
                <FilePickLabel>
                  <FileMusicIcon />
                  <span>{newFile ? newFile.name : '악보 파일 선택'}</span>
                  <HiddenFileInput
                    type="file"
                    accept="image/*,application/pdf,.musicxml,.xml,.mxl"
                    onChange={onFileChange}
                  />
                </FilePickLabel>
              </ModalField>
              {error && <ModalError>{error}</ModalError>}
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={closeCreateModal} disabled={creating}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={handleCreate} disabled={creating || !newTitle.trim() || !newFile}>
                  {creating ? '생성 중...' : '생성'}
                </ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}

        {renameTarget && (
          <ModalBackdrop onClick={() => setRenameTarget(null)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>이름 변경</ModalTitle>
              <ModalInput
                autoFocus
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { if (isComposingEvent(e)) return; confirmRename(); }
                  else if (e.key === 'Escape') setRenameTarget(null);
                }}
              />
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setRenameTarget(null)}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={confirmRename}>변경</ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}

        {selectMode && (
          <SelectionBar>
            <SbBtn type="button" onClick={() => alert('이동 — 추후 구현')}>
              <MoveIcon /> 이동
            </SbBtn>
            <SbBtn $danger type="button" onClick={requestBulkDelete} disabled={selectedIds.size === 0}>
              <TrashIcon /> 삭제
            </SbBtn>
            <SbBtn type="button" onClick={selectAllCurrent}>
              <CheckSquareIcon /> 전체 선택
            </SbBtn>
            <SbBtn type="button" onClick={exitSelect}>
              <XIcon /> 취소
            </SbBtn>
          </SelectionBar>
        )}

        {bulkDeleteOpen && (
          <ModalBackdrop onClick={() => !bulkDeleting && setBulkDeleteOpen(false)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>선택한 악보 삭제</ModalTitle>
              <ModalBody>
                {/* Count only what will actually be deleted (uploaded items),
                 * so the user isn't surprised by selected sample songs being
                 * silently skipped. */}
                {(() => {
                  const deletableCount = Array.from(selectedIds).filter(
                    (id) => uploadedProjects.some((p) => p.id === id),
                  ).length;
                  const skipped = selectedIds.size - deletableCount;
                  return (
                    <>
                      <div>{deletableCount}개의 악보를 삭제합니다.</div>
                      {skipped > 0 && (
                        <SkippedNote>
                          기본 제공 곡 {skipped}개는 삭제되지 않습니다.
                        </SkippedNote>
                      )}
                      {error && <ModalError>{error}</ModalError>}
                      <ModalWarn>이 작업은 되돌릴 수 없습니다.</ModalWarn>
                    </>
                  );
                })()}
              </ModalBody>
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={() => void confirmBulkDelete()} disabled={bulkDeleting}>
                  {bulkDeleting ? '삭제 중…' : '삭제'}
                </ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}
      </PageBody>
    </Page>
  );
}

function extractKeyFromTitle(title: string): string {
  const m = title.match(/\(([^)]+)\)\s*$/);
  return m?.[1] ?? '';
}

function SheetPreview({ song }: { song: NoteSongEntry }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<NoteSheetData | null>(null);
  const [scale, setScale] = useState(0.12);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldRender(true);
        io.disconnect();
      }
    }, { rootMargin: '600px' });
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    (async () => {
      const url = await song.loadUrl();
      const json = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      }) as NoteSheetData;
      if (!cancelled) setData(json);
    })().catch(() => {
      if (!cancelled) setData(null);
    });
    return () => { cancelled = true; };
  }, [shouldRender, song]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !data) return;
    let raf: number | null = null;
    const measure = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const cw = wrap.clientWidth;
        if (cw <= 0) return;
        setScale(cw / NOTE_PREVIEW_WIDTH);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (scalerRef.current) ro.observe(scalerRef.current);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [data]);

  return (
    <ScoreThumbWrap ref={wrapRef}>
      {data ? (
        <ScoreThumbScaler ref={scalerRef} style={{ transform: `scale(${scale})` }}>
          <NoteSheet data={data} hideTransport noPreload forceAutoStem lineStartMeasureNumbers />
        </ScoreThumbScaler>
      ) : (
        <ScoreSkeleton>
          <SkeletonTitle />
          <SkeletonLine /><SkeletonLine /><SkeletonLine /><SkeletonLine />
        </ScoreSkeleton>
      )}
    </ScoreThumbWrap>
  );
}

const NOTE_PREVIEW_WIDTH = 900;

/* ── icons ───────────────────────────────────────────────────────────── */

const PlusIcon = () => (
  <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SortIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 4v16" /><path d="M3.5 7.5 7 4l3.5 3.5" />
    <path d="M17 20V4" /><path d="M13.5 16.5 17 20l3.5-3.5" />
  </svg>
);

const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </svg>
);

const CheckTiny = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function GridViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="2.6" cy="3.6" r="1.1" />
      <rect x="5.4" y="2.85" width="9.1" height="1.5" rx="0.6" />
      <circle cx="2.6" cy="8" r="1.1" />
      <rect x="5.4" y="7.25" width="9.1" height="1.5" rx="0.6" />
      <circle cx="2.6" cy="12.4" r="1.1" />
      <rect x="5.4" y="11.65" width="9.1" height="1.5" rx="0.6" />
    </svg>
  );
}

function FileMusicIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 18v-6l5-1v6" />
      <circle cx="8.5" cy="18" r="1.5" />
      <circle cx="13.5" cy="17" r="1.5" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/* Move icon (4-way arrows) for the selection bar's "이동" action. Matches
 * the chord-chart page's MoveIcon glyph 1-for-1. */
function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

/* Checkbox icon for the selection bar's "전체 선택" action. */
function CheckSquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function ListSheetMini() {
  return (
    <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden>
      <g stroke="#888" strokeWidth="1" strokeLinecap="round">
        <line x1="3" y1="7" x2="37" y2="7" />
        <line x1="3" y1="14" x2="37" y2="14" />
        <line x1="3" y1="21" x2="37" y2="21" />
      </g>
      <text x="6" y="13" fontSize="6.5" fontWeight="700" fill="#444">C</text>
      <text x="18" y="13" fontSize="6.5" fontWeight="700" fill="#444">F</text>
      <text x="30" y="13" fontSize="6.5" fontWeight="700" fill="#444">G</text>
    </svg>
  );
}

/* ── layout ──────────────────────────────────────────────────────────── */















const CARD_HOVER_BG = '#FAF6E9';

const CardBase = `
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: 4 / 5;
  width: 100%;
  max-width: 200px;
  justify-self: start;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  overflow: visible;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.1s, box-shadow 0.12s, background 0.15s;
  &:hover { border-color: rgba(0, 0, 0, 0.18); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06); background: ${CARD_HOVER_BG}; }
  &:active { transform: scale(0.985); }
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const NewCard = styled.button`
  ${CardBase}
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed rgba(0, 0, 0, 0.18);
  background: transparent;
  color: rgba(0, 0, 0, 0.55);
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const NewLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
`;

const SheetCard = styled.div<{ $selected?: boolean; $menuOpen?: boolean }>`
  ${CardBase}
  &:hover .sheet-hover-overlay { opacity: 1; }
  ${({ $selected }) =>
    $selected &&
    `border-color: #2b8aef; box-shadow: 0 0 0 2px rgba(43, 138, 239, 0.5);`}
  ${({ $menuOpen }) =>
    $menuOpen &&
    `background: ${CARD_HOVER_BG}; border-color: rgba(0, 0, 0, 0.18); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);`}
`;


const ScoreThumbWrap = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #fff;
  overflow: hidden;
  contain: layout paint style;
  isolation: isolate;
  pointer-events: none;
  user-select: none;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
`;

const ScoreThumbScaler = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: ${NOTE_PREVIEW_WIDTH}px;
  transform-origin: top left;
  & > div {
    width: ${NOTE_PREVIEW_WIDTH}px !important;
    height: auto !important;
    flex: none !important;
    overflow: visible !important;
    padding: 0 !important;
    background: #fff !important;
    box-shadow: none !important;
    display: block !important;
  }
  & > div > button {
    display: none !important;
  }
`;

const ScoreSkeleton = styled.div`
  height: 100%;
  padding: 12px 10px;
  background: #fff;
`;

const SkeletonTitle = styled.div`
  width: 36%;
  height: 5px;
  margin: 0 auto 14px;
  border-radius: 99px;
  background: rgba(0, 0, 0, 0.12);
`;

const SkeletonLine = styled.div`
  height: 1px;
  margin: 12px 0;
  background: rgba(0, 0, 0, 0.18);
`;

const UploadedThumb = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  margin: 10px 10px 0;
  width: calc(100% - 20px);
  background: #fff;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(0, 0, 0, 0.45);
`;

const UploadedThumbText = styled.span`
  max-width: 80%;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;


/* 제목 + 키칩 + 박자칩 한 줄. 제목(div)이 flex:1 로 남는 폭 전부 차지(길면
 * ellipsis), 칩(span)은 flex-shrink:0 이라 안 잘림. 내 코드 차트와 동일. */
// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const CardTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-right: 2px;

  & > div {
    flex: 1;
    min-width: 0;
  }
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const CardTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 0;
`;


const ComposerText = styled.span`
  display: block;
  /* Ellipsis-clip when the composer / filename overflows the meta row.
   * max-width:100% + min-width:0 + the card's overflow:hidden together
   * force a single-line clip even inside flex parents. */
  max-width: 100%;
  font-size: 12px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.55);
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

/* 키 칩(노랑) — 내 코드 차트와 동일 디자인 유지 (두 페이지 카드는 항상 같게). */

/* 박자 칩(파랑) — 코드 차트와 동일. 악보엔 박자 데이터가 없어 4/4 고정. */








// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const CardCheckbox = styled.button<{ $checked?: boolean }>`
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 5;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1.5px solid ${({ $checked }) => ($checked ? '#2b8aef' : 'rgba(0, 0, 0, 0.28)')};
  background: ${({ $checked }) => ($checked ? '#2b8aef' : 'rgba(255, 255, 255, 0.92)')};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

const CheckMark = styled.span`
  width: 10px;
  height: 6px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg) translateY(-1px);
`;








const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalCard = styled.div`
  width: min(420px, 100%);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalTitle = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1a1a1a;
`;

/* Bulk-delete confirm modal body — short, info-only stack of lines. */
const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  font-size: 14px;
  color: #1a1a1a;
`;
const ModalWarn = styled.div`
  font-size: 12.5px;
  color: rgba(0, 0, 0, 0.55);
`;
const SkippedNote = styled.div`
  font-size: 12.5px;
  color: rgba(0, 0, 0, 0.45);
`;

const ModalField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 7px;
`;


// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  padding: 11px 12px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  &:focus { border-color: #1a1a1a; }
`;

const ModalSelect = styled.select`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  padding: 11px 12px;
  font-family: inherit;
  font-size: 14px;
  background: #fff;
  outline: none;
  &:focus { border-color: #1a1a1a; }
`;

const FilePickLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  border: 1px dashed rgba(0, 0, 0, 0.22);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.62);
  cursor: pointer;
  overflow: hidden;
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const PageErrorBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 22px 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdecea;
  color: #a03022;
  font-size: 13px;
`;
const PageErrorClose = styled.button`
  border: none;
  background: transparent;
  color: inherit;
  font-weight: 700;
  cursor: pointer;
  font-size: 12px;
`;

const ModalError = styled.div`
  padding: 9px 11px;
  border-radius: 10px;
  background: #fdecea;
  color: #a03022;
  font-size: 12.5px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalBtn = styled.button<{ $variant?: 'ghost' | 'primary' }>`
  border: none;
  border-radius: 9px;
  padding: 9px 13px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  background: ${({ $variant }) => ($variant === 'primary' ? '#1a1a1a' : 'rgba(0, 0, 0, 0.05)')};
  color: ${({ $variant }) => ($variant === 'primary' ? '#fff' : 'rgba(0, 0, 0, 0.65)')};
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

/* Bottom floating selection-mode action bar (white pill). Matches the
 * chord-chart page's SelectionBar 1-for-1 so both libraries share the
 * exact same selection UX. */

