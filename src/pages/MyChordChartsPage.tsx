import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { allOfMe } from '../data/allOfMe';

/* ─────────────────────────────────────────────────────────────────────────
 * MyChordChartsPage — document grid for "내 코드 차트".
 *
 * Real folder behavior, mocked content. Each item lives at a parentId (null
 * = root). Nav state moves through the tree; localStorage persists between
 * reloads so the mock feels real.
 *
 *   - Breadcrumbs (홈 › Jazz › 이지원재즈) appear when inside a folder
 *   - A dashed "drag here to move up" zone sits between breadcrumbs + grid
 *   - The "신규" tile opens a dropdown: 파일 업로드 / YouTube 링크 /
 *     이미지 업로드 / (divider) / 폴더 생성
 *   - Cards are draggable; drop on a folder card or on the parent-drop zone
 * ──────────────────────────────────────────────────────────────────────── */

type ItemKind = 'video' | 'file' | 'image' | 'sheet';

/* The single analyzed chart that opens chord-analysis (mychord) view. The card
 * stays a placeholder until per-user persistence lands. */
const SHEET_ANALYZED_ID = 'sheet-all-of-me';

interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

interface FileNode {
  id: string;
  parentId: string | null;
  kind: ItemKind;
  title: string;
  date: string;
  /** Stored gradient string for the (mock) thumbnail. Defaults to gray. */
  gradient?: string;
  status?: 'failed';
}

interface Store {
  folders: FolderNode[];
  files: FileNode[];
}

/* ── storage + seed ──────────────────────────────────────────────────── */

const STORAGE_KEY = 'jazzify.myCharts.v1';

const SEED: Store = {
  folders: [
    { id: 'jazz', parentId: null, name: 'Jazz', createdAt: '2026-03-02' },
    { id: 'f-3-1', parentId: null, name: '3-1', createdAt: '2026-03-02' },
    { id: 'f-2-2', parentId: null, name: '2-2', createdAt: '2026-03-02' },
    { id: 'leejiwonjazz', parentId: 'jazz', name: '이지원재즈', createdAt: '2026-03-15' },
  ],
  files: [
    {
      id: SHEET_ANALYZED_ID, parentId: null, kind: 'sheet',
      title: 'All of Me',
      date: '2026-05-20',
    },
    {
      id: 'v1', parentId: null, kind: 'video',
      title: 'I Used AI to Automate YouTube Shorts',
      date: '2026-05-19',
      gradient: 'linear-gradient(135deg, #6e2cd6 0%, #c44ad6 60%, #f06a8a 100%)',
      status: 'failed',
    },
    {
      id: 'v2', parentId: null, kind: 'video',
      title: '이 영상이 당신 인생을 바꿉니다. ...',
      date: '2026-05-15',
      gradient: 'linear-gradient(180deg, #1a1a1a 0%, #2a2a2a 100%)',
    },
    {
      id: 'v3', parentId: 'leejiwonjazz', kind: 'video',
      title: '이지리하모니제이션 #80-...',
      date: '2026-03-26',
    },
  ],
};

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed && Array.isArray(parsed.folders) && Array.isArray(parsed.files)) {
        /* Ensure the analyzed-sheet placeholder always exists for users who
         * created their store before the sheet card was introduced. */
        if (!parsed.files.some((f) => f.id === SHEET_ANALYZED_ID)) {
          const sheetSeed = SEED.files.find((f) => f.id === SHEET_ANALYZED_ID);
          if (sheetSeed) parsed.files = [sheetSeed, ...parsed.files];
        }
        return parsed;
      }
    }
  } catch { /* fallthrough */ }
  return SEED;
}

function saveStore(s: Store): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const today = (): string => new Date().toISOString().slice(0, 10);
const newId = (): string => {
  try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
};

const GRADIENTS = [
  'linear-gradient(135deg, #b8b8b8 0%, #d8d8d8 100%)',
  'linear-gradient(135deg, #6e2cd6 0%, #c44ad6 60%, #f06a8a 100%)',
  'linear-gradient(180deg, #1a1a1a 0%, #2a2a2a 100%)',
  'linear-gradient(135deg, #2c5f8d 0%, #4a90c2 100%)',
  'linear-gradient(135deg, #d6a72c 0%, #d65f2c 100%)',
] as const;
const pickGradient = (): string => GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];

/* ── component ───────────────────────────────────────────────────────── */

export default function MyChordChartsPage() {
  const navigate = useNavigate();
  const [store, setStore] = useState<Store>(loadStore);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [dragOverParent, setDragOverParent] = useState(false);

  /* Sort dropdown — visual only; actual sort wiring is deferred. */
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'old' | 'name' | 'type'>('recent');

  /* Multi-select mode: checkbox overlay on every card + bottom action bar. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const newWrapRef = useRef<HTMLDivElement>(null);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Persist on every change.
  useEffect(() => { saveStore(store); }, [store]);

  // Close the "신규" dropdown on outside click / Escape.
  useEffect(() => {
    if (!newMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (newWrapRef.current?.contains(e.target as Node)) return;
      setNewMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNewMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [newMenuOpen]);

  /* Close the sort dropdown on outside click / Escape. */
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortWrapRef.current?.contains(e.target as Node)) return;
      setSortMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSortMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [sortMenuOpen]);

  /* Escape exits select mode. */
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelectMode(false); setSelectedIds(new Set()); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectMode]);

  /* Computed: contents of the current folder. */
  const currentFolders = useMemo(
    () => store.folders.filter((f) => f.parentId === currentFolderId),
    [store.folders, currentFolderId],
  );
  const currentFiles = useMemo(
    () => store.files.filter((f) => f.parentId === currentFolderId),
    [store.files, currentFolderId],
  );

  /* Breadcrumb chain root→current (excluding the home root). */
  const breadcrumbs = useMemo(() => {
    const chain: FolderNode[] = [];
    let id = currentFolderId;
    while (id) {
      const f = store.folders.find((x) => x.id === id);
      if (!f) break;
      chain.unshift(f);
      id = f.parentId;
    }
    return chain;
  }, [currentFolderId, store.folders]);

  const parentOfCurrent: string | null = breadcrumbs.length >= 2
    ? breadcrumbs[breadcrumbs.length - 2].id
    : null;

  /* ── actions ───────────────────────────────────────────────────────── */

  const addFolder = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setStore((s) => ({
      ...s,
      folders: [...s.folders, { id: newId(), parentId: currentFolderId, name: trimmed, createdAt: today() }],
    }));
  };

  const addYouTube = (url: string): void => {
    const trimmed = url.trim();
    if (!trimmed) return;
    /* Heuristic title — use the URL fragment for the mock. Real flow would
     * fetch the video title from oEmbed / scrape the watch page. */
    const title = trimmed.replace(/^https?:\/\/(www\.)?(youtube\.com\/|youtu\.be\/)?/i, '').slice(0, 80) || 'YouTube';
    setStore((s) => ({
      ...s,
      files: [...s.files, {
        id: newId(), parentId: currentFolderId, kind: 'video', title, date: today(), gradient: pickGradient(),
      }],
    }));
  };

  const addUpload = (kind: 'file' | 'image', file: File): void => {
    setStore((s) => ({
      ...s,
      files: [...s.files, {
        id: newId(), parentId: currentFolderId, kind, title: file.name, date: today(), gradient: pickGradient(),
      }],
    }));
  };

  const moveTo = (itemId: string, targetParentId: string | null): void => {
    setStore((s) => ({
      folders: s.folders.map((f) => (f.id === itemId ? { ...f, parentId: targetParentId } : f)),
      files: s.files.map((f) => (f.id === itemId ? { ...f, parentId: targetParentId } : f)),
    }));
  };

  /* ── selection helpers ─────────────────────────────────────────────── */

  const exitSelect = (): void => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelect = (id: string): void => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllCurrent = (): void => {
    const all = new Set<string>();
    currentFolders.forEach((f) => all.add(f.id));
    currentFiles.forEach((f) => all.add(f.id));
    setSelectedIds(all);
  };
  /** Delete selected items. Selecting a folder deletes its descendants too. */
  const deleteSelected = (): void => {
    if (selectedIds.size === 0) return;
    setStore((s) => {
      const toDelete = new Set(selectedIds);
      const expand = (parentId: string): void => {
        s.folders.filter((f) => f.parentId === parentId).forEach((f) => {
          toDelete.add(f.id);
          expand(f.id);
        });
        s.files.filter((f) => f.parentId === parentId).forEach((f) => toDelete.add(f.id));
      };
      Array.from(selectedIds).forEach((id) => {
        if (s.folders.some((f) => f.id === id)) expand(id);
      });
      return {
        folders: s.folders.filter((f) => !toDelete.has(f.id)),
        files: s.files.filter((f) => !toDelete.has(f.id)),
      };
    });
    exitSelect();
  };

  /* Block dragging a folder into itself or its own descendant. */
  const isDescendant = (folderId: string, maybeDescendantId: string | null): boolean => {
    let id = maybeDescendantId;
    while (id) {
      if (id === folderId) return true;
      const f = store.folders.find((x) => x.id === id);
      id = f?.parentId ?? null;
    }
    return false;
  };

  /* ── drag handlers ─────────────────────────────────────────────────── */

  const onItemDragStart = (id: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onParentDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOverParent) setDragOverParent(true);
  };
  const onParentDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverParent(false);
  };
  const onParentDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverParent(false);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    moveTo(id, parentOfCurrent);
  };

  const onFolderDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onFolderDrop = (folderId: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id || id === folderId) return;
    if (isDescendant(id, folderId)) return; // don't allow folder→own descendant
    moveTo(id, folderId);
  };

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <Page>
      <IconSidebar />
      <PageBody>
        <Header>
          <Title>내 코드 차트</Title>
          <HeaderActions>
            {selectMode ? (
              <PillBtn type="button" onClick={exitSelect}>취소</PillBtn>
            ) : (
              <PillBtn type="button" onClick={() => setSelectMode(true)}>선택</PillBtn>
            )}
            <SortWrap ref={sortWrapRef}>
              <IconOnlyBtn type="button" aria-label="정렬" onClick={() => setSortMenuOpen((v) => !v)}>
                <SortIcon />
              </IconOnlyBtn>
              {sortMenuOpen && (
                <SortMenu role="menu">
                  {([
                    { id: 'recent', label: '최신순' },
                    { id: 'old', label: '오래된순' },
                    { id: 'name', label: '이름순' },
                    { id: 'type', label: '형식순' },
                  ] as const).map(({ id, label }) => {
                    const active = sortBy === id;
                    return (
                      <SortItem
                        key={id}
                        type="button"
                        $active={active}
                        onClick={() => { setSortBy(id); setSortMenuOpen(false); }}
                      >
                        <SortLabel $active={active}>{label}</SortLabel>
                        {active && <CheckIcon />}
                      </SortItem>
                    );
                  })}
                </SortMenu>
              )}
            </SortWrap>
            <PillBtn type="button"><GearIcon /> 설정</PillBtn>
          </HeaderActions>
        </Header>

        {breadcrumbs.length > 0 && (
          <BreadcrumbsRow>
            <CrumbBack type="button" aria-label="뒤로" onClick={() => setCurrentFolderId(parentOfCurrent)}>
              <BackChevron />
            </CrumbBack>
            <Crumb type="button" onClick={() => setCurrentFolderId(null)}>
              <HomeIcon /> 홈
            </Crumb>
            {breadcrumbs.map((f, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Fragment key={f.id}>
                  <Sep>›</Sep>
                  <Crumb
                    type="button"
                    $current={isLast}
                    onClick={() => setCurrentFolderId(f.id)}
                  >
                    <FolderGlyphSm /> {f.name}
                  </Crumb>
                </Fragment>
              );
            })}
          </BreadcrumbsRow>
        )}

        {currentFolderId !== null && !selectMode && (
          <ParentDropZone
            $active={dragOverParent}
            onDragOver={onParentDragOver}
            onDragEnter={onParentDragOver}
            onDragLeave={onParentDragLeave}
            onDrop={onParentDrop}
          >
            <DropIcon />
            <span>이곳으로 드래그하여 상위폴더로 이동할 수 있습니다.</span>
          </ParentDropZone>
        )}

        <Grid>
          <NewCardWrap ref={newWrapRef}>
            <NewCard type="button" onClick={() => setNewMenuOpen((v) => !v)}>
              <PlusIcon />
              <NewLabel>신규</NewLabel>
            </NewCard>
            {newMenuOpen && (
              <NewMenu role="menu">
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click(); }}
                >
                  <MenuIco><FileUpIcon /></MenuIco>
                  <span>파일 업로드</span>
                </NewMenuItem>
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); setYtUrl(''); setYoutubeOpen(true); }}
                >
                  <MenuIco><YoutubePlayIcon /></MenuIco>
                  <span>YouTube 링크</span>
                </NewMenuItem>
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); imageInputRef.current?.click(); }}
                >
                  <MenuIco><ImageIcon /></MenuIco>
                  <span>이미지 업로드</span>
                </NewMenuItem>
                <MenuDivider />
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); setFolderName(''); setCreateFolderOpen(true); }}
                >
                  <MenuIco><FolderPlusIcon /></MenuIco>
                  <span>폴더 생성</span>
                </NewMenuItem>
              </NewMenu>
            )}
          </NewCardWrap>

          {currentFolders.map((folder) => (
            <FolderCard
              key={folder.id}
              draggable={!selectMode}
              onDragStart={onItemDragStart(folder.id)}
              onDragOver={onFolderDragOver}
              onDrop={onFolderDrop(folder.id)}
              onClick={() => (selectMode ? toggleSelect(folder.id) : setCurrentFolderId(folder.id))}
              $selected={selectMode && selectedIds.has(folder.id)}
            >
              {selectMode && (
                <CardCheckbox
                  $checked={selectedIds.has(folder.id)}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(folder.id); }}
                  aria-label="선택"
                >
                  {selectedIds.has(folder.id) && <CheckMark />}
                </CardCheckbox>
              )}
              <FolderTop>
                <FolderGlyph aria-hidden>
                  <svg width="58" height="58" viewBox="0 0 24 24" fill="#5b5b5b" aria-hidden>
                    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .79.16 1.06.44L11.8 7H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11z" />
                  </svg>
                </FolderGlyph>
              </FolderTop>
              <CardMeta>
                <CardTitle title={folder.name}>{folder.name}</CardTitle>
                <MetaRow>
                  <Badge $tone="folder">폴더</Badge>
                  <DateText>{folder.createdAt}</DateText>
                </MetaRow>
              </CardMeta>
              <Kebab aria-label="더보기" onClick={(e) => e.stopPropagation()}>
                <KebabDot /><KebabDot /><KebabDot />
              </Kebab>
            </FolderCard>
          ))}

          {currentFiles.map((file) => (
            <VideoCard
              key={file.id}
              draggable={!selectMode}
              onDragStart={onItemDragStart(file.id)}
              onClick={() => {
                if (selectMode) toggleSelect(file.id);
                else if (file.kind === 'sheet') navigate('/mychord');
              }}
              $selected={selectMode && selectedIds.has(file.id)}
            >
              {selectMode && (
                <CardCheckbox
                  $checked={selectedIds.has(file.id)}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(file.id); }}
                  aria-label="선택"
                >
                  {selectedIds.has(file.id) && <CheckMark />}
                </CardCheckbox>
              )}
              {file.kind === 'sheet' ? (
                <SheetPreview title={file.title} />
              ) : (
                <Thumb style={{ background: file.gradient ?? GRADIENTS[0] }}>
                  {file.status === 'failed' && <StatusPill>⚠ 추출 실패</StatusPill>}
                  <PlayBadge>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden>
                      <polygon points="7,5 19,12 7,19" />
                    </svg>
                  </PlayBadge>
                </Thumb>
              )}
              <CardMeta>
                <CardTitle title={file.title}>{file.title}</CardTitle>
                <MetaRow>
                  <Badge $tone={file.kind === 'video' ? 'youtube' : file.kind === 'sheet' ? 'sheet' : 'folder'}>
                    {file.kind === 'video' ? 'YouTube'
                      : file.kind === 'sheet' ? '악보'
                      : file.kind === 'image' ? '이미지'
                      : '파일'}
                  </Badge>
                  <DateText>{file.date}</DateText>
                </MetaRow>
              </CardMeta>
              <Kebab aria-label="더보기">
                <KebabDot /><KebabDot /><KebabDot />
              </Kebab>
            </VideoCard>
          ))}
        </Grid>

        {/* Hidden file inputs driven by the dropdown items. */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) addUpload('file', f); e.target.value = ''; }}
        />
        <input
          ref={imageInputRef}
          type="file"
          hidden
          accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) addUpload('image', f); e.target.value = ''; }}
        />

        {createFolderOpen && (
          <ModalBackdrop onClick={() => setCreateFolderOpen(false)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>새 폴더</ModalTitle>
              <ModalInput
                autoFocus
                placeholder="폴더 이름"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { addFolder(folderName); setCreateFolderOpen(false); }
                  else if (e.key === 'Escape') setCreateFolderOpen(false);
                }}
              />
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setCreateFolderOpen(false)}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={() => { addFolder(folderName); setCreateFolderOpen(false); }}>생성</ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}

        {selectMode && (
          <SelectionBar>
            <SbBtn type="button" onClick={() => alert('이동 — 추후 구현')}>
              <MoveIcon /> 이동
            </SbBtn>
            <SbBtn $danger type="button" onClick={deleteSelected} disabled={selectedIds.size === 0}>
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

        {youtubeOpen && (
          <ModalBackdrop onClick={() => setYoutubeOpen(false)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>YouTube 링크 추가</ModalTitle>
              <ModalInput
                autoFocus
                placeholder="https://www.youtube.com/..."
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { addYouTube(ytUrl); setYoutubeOpen(false); }
                  else if (e.key === 'Escape') setYoutubeOpen(false);
                }}
              />
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setYoutubeOpen(false)}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={() => { addYouTube(ytUrl); setYoutubeOpen(false); }}>추가</ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}
      </PageBody>
    </Page>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */

const PlusIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SortIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 4v16" />
    <polyline points="3 8 7 4 11 8" />
    <path d="M17 20V4" />
    <polyline points="13 16 17 20 21 16" />
  </svg>
);

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const BackChevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const HomeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 12 L12 4 L21 12" />
    <path d="M5 10v9h14v-9" />
  </svg>
);

const FolderGlyphSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .79.16 1.06.44L11.8 7H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11z" />
  </svg>
);

const DropIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <polyline points="8 9 12 5 16 9" />
    <line x1="12" y1="5" x2="12" y2="16" />
  </svg>
);

const FileUpIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="14 3 14 9 20 9" />
    <polyline points="9 13 12 10 15 13" />
    <line x1="12" y1="10" x2="12" y2="18" />
  </svg>
);

const YoutubePlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
  </svg>
);

const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 17 L15 11 L7 19" />
  </svg>
);

const FolderPlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .79.16 1.06.44L11.8 7H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="5 12 10 17 19 7" />
  </svg>
);

const CheckMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="5 12 10 17 19 7" />
  </svg>
);

const MoveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="5 9 2 12 5 15" />
    <polyline points="9 5 12 2 15 5" />
    <polyline points="15 19 12 22 9 19" />
    <polyline points="19 9 22 12 19 15" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

const CheckSquareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

/* ── layout ──────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'Pretendard', sans-serif;
`;

const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 14px) 28px 12px;
  ${mq.mobile} {
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px;
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #1a1a1a;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const PillBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: 999px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: #1a1a1a;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.08); }
`;

const IconOnlyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #1a1a1a;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

/* Sort dropdown — anchored to the sort icon button. */
const SortWrap = styled.div`
  position: relative;
  display: inline-flex;
`;

const SortMenu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.14);
  padding: 6px;
  z-index: 50;
  animation: menuIn 0.12s ease both;
  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

const SortItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 9px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: ${({ $active }) => ($active ? '#1a1a1a' : 'rgba(0, 0, 0, 0.45)')};
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

const SortLabel = styled.span<{ $active?: boolean }>`
  font-size: 14.5px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
`;

/* ── breadcrumbs ─────────────────────────────────────────────────────── */

const BreadcrumbsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 28px 4px;
  ${mq.mobile} { padding: 2px 14px 4px; }
`;

const CrumbBack = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #1a1a1a;
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

const Crumb = styled.button<{ $current?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  padding: 6px 8px;
  border-radius: 7px;
  font-family: inherit;
  font-size: 14px;
  font-weight: ${({ $current }) => ($current ? 700 : 500)};
  color: ${({ $current }) => ($current ? '#1a1a1a' : 'rgba(0, 0, 0, 0.6)')};
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.04); color: #1a1a1a; }
  svg { color: ${({ $current }) => ($current ? '#1a1a1a' : 'rgba(0, 0, 0, 0.5)')}; }
`;

const Sep = styled.span`
  color: rgba(0, 0, 0, 0.35);
  font-size: 14px;
  padding: 0 2px;
`;

/* ── parent-drop zone ────────────────────────────────────────────────── */

const ParentDropZone = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 6px 28px 14px;
  padding: 16px 18px;
  border: 1.5px dashed ${({ $active }) => ($active ? '#2b8aef' : 'rgba(0, 0, 0, 0.18)')};
  border-radius: 12px;
  background: ${({ $active }) => ($active ? 'rgba(43, 138, 239, 0.06)' : 'transparent')};
  color: ${({ $active }) => ($active ? '#2b8aef' : 'rgba(0, 0, 0, 0.55)')};
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  ${mq.mobile} { margin: 6px 14px 12px; padding: 12px 14px; font-size: 12.5px; }
`;

/* ── grid ────────────────────────────────────────────────────────────── */

const Grid = styled.div`
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 18px;
  padding: 12px 28px 32px;
  ${mq.mobile} {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    padding: 8px 14px 24px;
  }
`;

/* Shared 1:1 card chrome (video + folder). */
const CardBase = `
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: 1 / 1;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.1s, box-shadow 0.12s;
  &:hover { border-color: rgba(0, 0, 0, 0.18); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06); }
  &:active { transform: scale(0.985); }
`;

/* "신규" tile — wrapper anchors the popover menu absolutely. */
const NewCardWrap = styled.div`
  position: relative;
`;

const NewCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: transparent;
  border: 1.5px dashed rgba(0, 0, 0, 0.18);
  border-radius: 14px;
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  &:hover { border-color: rgba(0, 0, 0, 0.32); color: #1a1a1a; background: rgba(0, 0, 0, 0.02); }
`;
const NewLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
`;

const NewMenu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 232px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.14);
  padding: 8px;
  z-index: 50;
  animation: menuIn 0.12s ease both;

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

const NewMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 9px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 500;
  color: #1a1a1a;
  text-align: left;
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

const MenuIco = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  color: rgba(0, 0, 0, 0.65);
  flex-shrink: 0;
`;

const MenuDivider = styled.div`
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 6px 4px;
`;

/* Video / file card. $selected highlights the card in multi-select mode. */
const VideoCard = styled.div<{ $selected?: boolean }>`
  ${CardBase}
  ${({ $selected }) =>
    $selected &&
    `border-color: #2b8aef; box-shadow: 0 0 0 2px rgba(43, 138, 239, 0.5);`}
`;
const Thumb = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background-size: cover;
  background-position: center;
`;
const PlayBadge = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(255, 80, 80, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
`;
const StatusPill = styled.span`
  position: absolute;
  top: 8px;
  left: 8px;
  background: #e74c3c;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 999px;
  letter-spacing: -0.01em;
`;

/* Folder card. */
const FolderCard = styled.div<{ $selected?: boolean }>`
  ${CardBase}
  ${({ $selected }) =>
    $selected &&
    `border-color: #2b8aef; box-shadow: 0 0 0 2px rgba(43, 138, 239, 0.5);`}
`;
const FolderTop = styled.div`
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #f2f2f3;
  display: flex;
  align-items: center;
  justify-content: center;
`;
const FolderGlyph = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
`;

const CardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
`;
const CardTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 22px;
`;
const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;
const Badge = styled.span<{ $tone: 'youtube' | 'folder' | 'sheet' }>`
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: ${({ $tone }) =>
    $tone === 'youtube' ? 'rgba(255, 60, 60, 0.12)'
      : $tone === 'sheet' ? 'rgba(43, 138, 239, 0.12)'
      : 'rgba(214, 152, 18, 0.14)'};
  color: ${({ $tone }) =>
    $tone === 'youtube' ? '#d93030'
      : $tone === 'sheet' ? '#2570c8'
      : '#a86a08'};
`;
const DateText = styled.span`
  font-size: 11.5px;
  color: rgba(0, 0, 0, 0.45);
`;

const Kebab = styled.button`
  position: absolute;
  right: 8px;
  bottom: 10px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;
const KebabDot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
`;

/* ── sheet (악보) preview thumbnail ───────────────────────────────────── */

const SheetThumbWrap = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #fdfdf9;
  display: flex;
  flex-direction: column;
  padding: 6px 8px 4px;
  overflow: hidden;
`;

const SheetTitleLine = styled.div`
  text-align: center;
  font-family: 'Times New Roman', 'Pretendard', serif;
  font-size: 10.5px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: -0.01em;
  padding: 2px 0 4px;
`;

const SheetSystems = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
`;

const SheetSystem = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-left: 1.5px solid rgba(0, 0, 0, 0.6);
  border-top: 1px solid rgba(0, 0, 0, 0.16);
  border-bottom: 1px solid rgba(0, 0, 0, 0.16);
`;

const SheetCell = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: 'Pretendard', sans-serif;
  font-size: 10px;
  font-weight: 700;
  color: #1a1a1a;
  border-right: 1.5px solid rgba(0, 0, 0, 0.6);
  padding: 2px 1px;
  white-space: nowrap;
  overflow: hidden;
`;

function formatChordSymbol(c: { root?: string; quality?: string }): string {
  return `${c.root ?? ''}${(c.quality ?? '').replace(/Δ/g, '△')}`;
}

/* Static, non-interactive preview of the first two systems of the chart so the
 * card communicates "this is the analyzed 'All of Me' chord sheet" at a glance. */
function SheetPreview({ title }: { title: string }) {
  const systems = allOfMe.systems.slice(0, 2);
  return (
    <SheetThumbWrap>
      <SheetTitleLine>{title}</SheetTitleLine>
      <SheetSystems>
        {systems.map((sys, si) => (
          <SheetSystem key={si}>
            {sys.bars.slice(0, 4).map((bar, bi) => (
              <SheetCell key={bi}>
                {bar.chords.map((c, ci) => (
                  <span key={ci}>{formatChordSymbol(c)}</span>
                ))}
              </SheetCell>
            ))}
          </SheetSystem>
        ))}
      </SheetSystems>
    </SheetThumbWrap>
  );
}

/* Checkbox overlay shown in the top-left of every card in select mode. */
const CardCheckbox = styled.button<{ $checked?: boolean }>`
  position: absolute;
  top: 8px;
  left: 8px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid ${({ $checked }) => ($checked ? '#2b8aef' : 'rgba(0, 0, 0, 0.3)')};
  background: ${({ $checked }) => ($checked ? '#2b8aef' : 'rgba(255, 255, 255, 0.92)')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  transition: background 0.12s, border-color 0.12s;
  &:hover { border-color: ${({ $checked }) => ($checked ? '#2b8aef' : 'rgba(0, 0, 0, 0.5)')}; }
`;

/* Bottom floating selection-mode action bar (white pill). */
const SelectionBar = styled.div`
  position: fixed;
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.14);
`;

const SbBtn = styled.button<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  border-radius: 999px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: ${({ $danger }) => ($danger ? '#e74c3c' : '#1a1a1a')};
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

/* ── modals (folder + youtube) ───────────────────────────────────────── */

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(20, 20, 20, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ModalCard = styled.div`
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.24);
  padding: 22px 22px 18px;
  font-family: inherit;
`;

const ModalTitle = styled.h2`
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 700;
  color: #1a1a1a;
`;

const ModalInput = styled.input`
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 14.5px;
  color: #1a1a1a;
  outline: none;
  &:focus { border-color: rgba(0, 0, 0, 0.4); }
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
`;

const ModalBtn = styled.button<{ $variant?: 'ghost' | 'primary' }>`
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: ${({ $variant }) => ($variant === 'primary' ? '#1a1a1a' : 'transparent')};
  color: ${({ $variant }) => ($variant === 'primary' ? '#fff' : 'rgba(0, 0, 0, 0.65)')};
  &:hover { opacity: ${({ $variant }) => ($variant === 'primary' ? 0.9 : 1)}; background: ${({ $variant }) => ($variant === 'primary' ? '#1a1a1a' : 'rgba(0, 0, 0, 0.05)')}; }
`;
