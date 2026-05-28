import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { LeadSheet } from '../components/leadsheet/LeadSheet';
import type { LeadSheetData } from '../data/leadSheetTypes';
import { parseChordInput } from '../lib/leadSheetChordEdit';
import {
  CHORD_PROJECT_KEYS,
  addChordProjectChords,
  analyzeChordProject,
  createChordProject,
  createChordProjectFromOmr,
  deleteChordProject,
  getChordProjectAnalysis,
  getChordProjectOmrStatus,
  listChordProjects,
  updateChordProject,
  type ChordAnalysisResult,
  type ChordProject,
  type ChordProjectKey,
} from '../api/chordProjects';

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
  keySignature?: string;
  timeSignature?: string;
  omrStatus?: string;
  omrProgress?: number;
  omrFailureReason?: string | null;
  project?: ChordProject;
  /** Stored gradient string for the (mock) thumbnail. Defaults to gray. */
  gradient?: string;
  status?: 'failed';
}

interface Store {
  folders: FolderNode[];
  files: FileNode[];
}

/* ── storage + seed ──────────────────────────────────────────────────── */

/* Bumped from v1 → mock-v2 to force a fresh seed so the 100-card mockup
 * (sheetSeedMocks) shows up for users who already had the old seed in
 * localStorage. Bump again when changing the seed in a way that needs to
 * propagate to existing testers. */
const STORAGE_KEY = 'jazzify.myCharts.mock-v4';

/* Placeholder chord-chart cards for layout testing — same song each so
 * the grid density (and how the cream hover edge / arrow overlay reads at
 * scale) can be evaluated. All show the same All of Me preview; titles
 * are suffixed with an index so they're individually distinguishable.
 *
 * 100 instances rendered all the heavy <LeadSheet> internals 100 times
 * concurrently, which caused initial-paint layout thrashing visible as
 * "overlapping" cards. 25 is enough to see the design at scale without
 * the browser thrashing. Bump back up if you want stress-testing. */
const sheetSeedMocks: FileNode[] = Array.from({ length: 25 }, (_, i) => ({
  id: `mock-sheet-${i}`,
  parentId: null,
  kind: 'sheet' as const,
  title: `All of Me #${i + 1}`,
  date: '2026-05-20',
}));

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
    ...sheetSeedMocks,
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

/* Persisted grid/list toggle. Stored separately from the document store so
 * clearing the doc store doesn't reset the user's preferred view. */
type ViewMode = 'grid' | 'list';
const VIEW_MODE_STORAGE_KEY = 'jazzify.myCharts.viewMode.v1';
function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'list' || v === 'grid') return v;
  } catch { /* ignore */ }
  return 'grid';
}
function saveViewMode(v: ViewMode): void {
  try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, v); } catch { /* ignore */ }
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
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [dragOverParent, setDragOverParent] = useState(false);
  const [projects, setProjects] = useState<ChordProject[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectKey, setNewProjectKey] = useState<ChordProjectKey>('C_MAJOR');
  const [newProjectTimeSignature, setNewProjectTimeSignature] = useState('4/4');
  const [newProjectProgression, setNewProjectProgression] = useState('');

  /* Sort dropdown — visual only; actual sort wiring is deferred. */
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'old' | 'name' | 'type'>('recent');

  /* Grid vs list view toggle — persisted across sessions. */
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);

  /* Card kebab menu (이름 변경 / 이동 / 삭제). Single menu open at a time
   * — id of the card whose menu is open, or null. Rename target drives the
   * shared rename modal below. */
  const [kebabMenuId, setKebabMenuId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    { id: string; kind: 'folder' | 'file'; name: string } | null
  >(null);
  const [renameInput, setRenameInput] = useState('');

  /* Multi-select mode: checkbox overlay on every card + bottom action bar. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const newWrapRef = useRef<HTMLDivElement>(null);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kebabMenuRef = useRef<HTMLDivElement>(null);

  const projectSort = useMemo(() => {
    if (sortBy === 'old') return 'createdAt,asc';
    if (sortBy === 'name') return 'title,asc';
    return 'createdAt,desc';
  }, [sortBy]);

  const reloadProjects = useCallback(async () => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      const page = await listChordProjects({ size: 100, sort: projectSort });
      setProjects(page.content);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : '코드 프로젝트 목록 조회 실패');
    } finally {
      setProjectLoading(false);
    }
  }, [projectSort]);

  useEffect(() => { void reloadProjects(); }, [reloadProjects]);

  useEffect(() => {
    const active = projects.filter((p) => p.omrStatus === 'PENDING' || p.omrStatus === 'PROCESSING');
    if (active.length === 0) return;
    const timer = window.setInterval(() => {
      active.forEach((project) => {
        getChordProjectOmrStatus(project.publicId)
          .then((status) => {
            setProjects((prev) => prev.map((p) => (
              p.publicId === project.publicId
                ? {
                  ...p,
                  omrStatus: status.status,
                  omrProgress: status.progress,
                  omrFailureReason: status.failureReason,
                }
                : p
            )));
          })
          .catch(() => { /* best-effort polling */ });
      });
    }, 3500);
    return () => window.clearInterval(timer);
  }, [projects]);

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

  /* Close the per-card kebab menu on outside click / Escape. */
  useEffect(() => {
    if (kebabMenuId === null) return;
    const onDown = (e: MouseEvent) => {
      if (kebabMenuRef.current?.contains(e.target as Node)) return;
      setKebabMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setKebabMenuId(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [kebabMenuId]);

  /* Computed: contents of the current folder. */
  const currentFolders = useMemo<FolderNode[]>(() => [], []);
  const currentFiles = useMemo<FileNode[]>(
    () => currentFolderId === null
      ? projects.map((project) => ({
        id: project.publicId,
        parentId: null,
        kind: 'sheet' as const,
        title: project.title,
        date: project.createdAt?.slice(0, 10) || today(),
        keySignature: project.keySignature,
        timeSignature: project.timeSignature,
        omrStatus: project.omrStatus,
        omrProgress: project.omrProgress,
        omrFailureReason: project.omrFailureReason,
        project,
      }))
      : [],
    [projects, currentFolderId],
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

  const resetCreateProject = (): void => {
    setNewProjectTitle('');
    setNewProjectKey('C_MAJOR');
    setNewProjectTimeSignature('4/4');
    setNewProjectProgression('');
    setProjectError(null);
  };

  const openCreateProject = (): void => {
    resetCreateProject();
    setCreateProjectOpen(true);
  };

  const handleCreateProject = async (): Promise<void> => {
    const title = newProjectTitle.trim();
    const timeSignature = newProjectTimeSignature.trim() || '4/4';
    const progression = newProjectProgression.trim();
    if (!title) return;
    setCreatingProject(true);
    setProjectError(null);
    try {
      const created = await createChordProject({ title, key: newProjectKey, timeSignature });
      if (progression) {
        await addChordProjectChords(created.publicId, progression);
        await analyzeChordProject(created.publicId);
      }
      setCreateProjectOpen(false);
      resetCreateProject();
      await reloadProjects();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : '코드 프로젝트 생성 실패');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleOmrFile = async (file: File): Promise<void> => {
    setProjectError(null);
    try {
      const title = file.name.replace(/\.[^.]+$/, '');
      const created = await createChordProjectFromOmr(file, { title });
      setProjects((prev) => [created.project, ...prev.filter((p) => p.publicId !== created.project.publicId)]);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : '코드 프로젝트 OMR 생성 실패');
    }
  };

  const moveTo = (itemId: string, targetParentId: string | null): void => {
    setStore((s) => ({
      folders: s.folders.map((f) => (f.id === itemId ? { ...f, parentId: targetParentId } : f)),
      files: s.files.map((f) => (f.id === itemId ? { ...f, parentId: targetParentId } : f)),
    }));
  };

  /* Per-card rename. Folder name lives in `name`, file name in `title` —
   * branch on `kind` so both card types share the same modal flow. */
  const renameItem = async (id: string, kind: 'folder' | 'file', newName: string): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const project = projects.find((p) => p.publicId === id);
    if (kind === 'file' && project) {
      setProjectError(null);
      try {
        const updated = await updateChordProject(id, { title: trimmed, key: project.keySignature });
        setProjects((prev) => prev.map((p) => (p.publicId === id ? updated : p)));
      } catch (e) {
        setProjectError(e instanceof Error ? e.message : '코드 프로젝트 수정 실패');
      }
      return;
    }
    setStore((s) => ({
      folders: kind === 'folder'
        ? s.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
        : s.folders,
      files: kind === 'file'
        ? s.files.map((f) => (f.id === id ? { ...f, title: trimmed } : f))
        : s.files,
    }));
  };

  /* Delete a single item from the kebab menu. Folder delete cascades to
   * all descendants (mirrors deleteSelected's expand logic). */
  const deleteItem = async (id: string, kind: 'folder' | 'file'): Promise<void> => {
    const project = projects.find((p) => p.publicId === id);
    if (kind === 'file' && project) {
      setProjectError(null);
      try {
        await deleteChordProject(id);
        setProjects((prev) => prev.filter((p) => p.publicId !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (e) {
        setProjectError(e instanceof Error ? e.message : '코드 프로젝트 삭제 실패');
      }
      return;
    }
    setStore((s) => {
      if (kind === 'file') {
        return { ...s, files: s.files.filter((f) => f.id !== id) };
      }
      const toDelete = new Set<string>([id]);
      const expand = (parentId: string): void => {
        s.folders.filter((f) => f.parentId === parentId).forEach((f) => {
          toDelete.add(f.id);
          expand(f.id);
        });
        s.files.filter((f) => f.parentId === parentId).forEach((f) => toDelete.add(f.id));
      };
      expand(id);
      return {
        folders: s.folders.filter((f) => !toDelete.has(f.id)),
        files: s.files.filter((f) => !toDelete.has(f.id)),
      };
    });
  };

  /* Kebab menu handlers shared by all cards. */
  const openKebab = (id: string) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    setKebabMenuId((current) => (current === id ? null : id));
  };
  const startRename = (id: string, kind: 'folder' | 'file', currentName: string): void => {
    setKebabMenuId(null);
    setRenameTarget({ id, kind, name: currentName });
    setRenameInput(currentName);
  };
  const confirmRename = (): void => {
    if (!renameTarget) return;
    renameItem(renameTarget.id, renameTarget.kind, renameInput);
    setRenameTarget(null);
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
  const deleteSelected = async (): Promise<void> => {
    if (selectedIds.size === 0) return;
    const projectIds = Array.from(selectedIds).filter((id) => projects.some((p) => p.publicId === id));
    if (projectIds.length > 0) {
      setProjectError(null);
      try {
        await Promise.all(projectIds.map((id) => deleteChordProject(id)));
        setProjects((prev) => prev.filter((p) => !selectedIds.has(p.publicId)));
        exitSelect();
      } catch (e) {
        setProjectError(e instanceof Error ? e.message : '선택한 코드 프로젝트 삭제 실패');
      }
      return;
    }
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
            <ViewToggle role="group" aria-label="보기 방식">
              <ViewToggleBtn
                type="button"
                aria-label="격자"
                aria-pressed={viewMode === 'grid'}
                $active={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
              >
                <GridViewIcon />
              </ViewToggleBtn>
              <ViewToggleBtn
                type="button"
                aria-label="목록"
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

        {projectError && (
          <ErrorBanner>
            <span>{projectError}</span>
            <ErrorClose type="button" onClick={() => setProjectError(null)}>닫기</ErrorClose>
          </ErrorBanner>
        )}
        {projectLoading && <LoadingStrip>코드 프로젝트를 불러오는 중...</LoadingStrip>}

        {viewMode === 'grid' ? (
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
                  onClick={() => { setNewMenuOpen(false); openCreateProject(); }}
                >
                  <MenuIco><ChordGridIcon /></MenuIco>
                  <span>코드 직접 입력</span>
                </NewMenuItem>
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click(); }}
                >
                  <MenuIco><FileUpIcon /></MenuIco>
                  <span>OMR 파일 업로드</span>
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
              $menuOpen={kebabMenuId === folder.id}
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
                {!selectMode && (
                  <HoverOverlay className="folder-hover-overlay" aria-hidden>
                    <HoverArrowBox><ArrowRightIcon /></HoverArrowBox>
                  </HoverOverlay>
                )}
              </FolderTop>
              <CardMeta>
                <CardTitle title={folder.name}>{folder.name}</CardTitle>
                <MetaRow>
                  <Badge $tone="folder">폴더</Badge>
                  <DateText>{folder.createdAt}</DateText>
                </MetaRow>
              </CardMeta>
              <Kebab aria-label="더보기" onClick={openKebab(folder.id)}>
                <KebabDot /><KebabDot /><KebabDot />
              </Kebab>
              {kebabMenuId === folder.id && (
                <KebabMenu ref={kebabMenuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                  <KebabMenuItem type="button" onClick={() => startRename(folder.id, 'folder', folder.name)}>
                    <KebabMenuIcon><RenameIcon /></KebabMenuIcon>
                    <span>이름 변경</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('이동: 추후 구현'); }}>
                    <KebabMenuIcon><MoveIcon /></KebabMenuIcon>
                    <span>이동</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" $danger onClick={() => { setKebabMenuId(null); deleteItem(folder.id, 'folder'); }}>
                    <KebabMenuIcon><TrashIcon /></KebabMenuIcon>
                    <span>삭제</span>
                  </KebabMenuItem>
                </KebabMenu>
              )}
            </FolderCard>
          ))}

          {currentFiles.map((file) => (
            <VideoCard
              key={file.id}
              draggable={!selectMode}
              onDragStart={onItemDragStart(file.id)}
              onClick={() => {
                if (selectMode) toggleSelect(file.id);
                else if (file.kind === 'sheet') navigate(`/mychord?project=${encodeURIComponent(file.id)}`);
              }}
              $selected={selectMode && selectedIds.has(file.id)}
              $sheet={file.kind === 'sheet'}
              $menuOpen={kebabMenuId === file.id}
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
                <SheetCardInner>
                  <SheetPreview project={file.project} />
                  {!selectMode && (
                    <HoverOverlay className="sheet-hover-overlay" aria-hidden>
                      <HoverArrowBox><ArrowRightIcon /></HoverArrowBox>
                    </HoverOverlay>
                  )}
                </SheetCardInner>
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
                {file.kind === 'sheet' ? (
                  <CardTitleRow>
                    <CardTitle title={file.title} style={{ paddingRight: 0 }}>{file.title}</CardTitle>
                    <KeyChip>{formatProjectKey(file.keySignature)}</KeyChip>
                  </CardTitleRow>
                ) : (
                  <CardTitle title={file.title}>{file.title}</CardTitle>
                )}
                <MetaRow>
                  {file.kind === 'sheet' ? (
                    /* Chord-chart card: skip the badge/date pair and show the
                     * composer line instead (mock — sourced from allOfMe). */
                    <ComposerText>{formatProjectMeta(file)}</ComposerText>
                  ) : (
                    <>
                      <Badge $tone={file.kind === 'video' ? 'youtube' : 'folder'}>
                        {file.kind === 'video' ? 'YouTube'
                          : file.kind === 'image' ? '이미지'
                          : '파일'}
                      </Badge>
                      <DateText>{file.date}</DateText>
                    </>
                  )}
                </MetaRow>
              </CardMeta>
              <Kebab aria-label="더보기" onClick={openKebab(file.id)}>
                <KebabDot /><KebabDot /><KebabDot />
              </Kebab>
              {kebabMenuId === file.id && (
                <KebabMenu ref={kebabMenuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                  <KebabMenuItem type="button" onClick={() => startRename(file.id, 'file', file.title)}>
                    <KebabMenuIcon><RenameIcon /></KebabMenuIcon>
                    <span>이름 변경</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('이동: 추후 구현'); }}>
                    <KebabMenuIcon><MoveIcon /></KebabMenuIcon>
                    <span>이동</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" $danger onClick={() => { setKebabMenuId(null); deleteItem(file.id, 'file'); }}>
                    <KebabMenuIcon><TrashIcon /></KebabMenuIcon>
                    <span>삭제</span>
                  </KebabMenuItem>
                </KebabMenu>
              )}
            </VideoCard>
          ))}
        </Grid>
        ) : (
        <List>
          <ListNewRowWrap ref={newWrapRef}>
            <ListNewRow type="button" onClick={() => setNewMenuOpen((v) => !v)}>
              <ListThumb $tone="new"><PlusIcon /></ListThumb>
              <ListMain>
                <ListTitle>신규</ListTitle>
                <ListSubtitle>파일·YouTube·이미지·폴더 추가</ListSubtitle>
              </ListMain>
            </ListNewRow>
            {newMenuOpen && (
              <NewMenu role="menu">
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); openCreateProject(); }}
                >
                  <MenuIco><ChordGridIcon /></MenuIco>
                  <span>코드 직접 입력</span>
                </NewMenuItem>
                <NewMenuItem
                  type="button"
                  onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click(); }}
                >
                  <MenuIco><FileUpIcon /></MenuIco>
                  <span>OMR 파일 업로드</span>
                </NewMenuItem>
              </NewMenu>
            )}
          </ListNewRowWrap>

          {currentFolders.map((folder) => (
            <ListRow
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
                  style={{ position: 'static', marginRight: 4 }}
                >
                  {selectedIds.has(folder.id) && <CheckMark />}
                </CardCheckbox>
              )}
              <ListThumb $tone="folder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#5b5b5b" aria-hidden>
                  <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .79.16 1.06.44L11.8 7H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11z" />
                </svg>
              </ListThumb>
              <ListMain>
                <ListTitle title={folder.name}>{folder.name}</ListTitle>
                <ListSubtitle>{folder.createdAt}</ListSubtitle>
              </ListMain>
              <ListStar type="button" aria-label="즐겨찾기" onClick={(e) => e.stopPropagation()}>
                <StarOutlineIcon />
              </ListStar>
            </ListRow>
          ))}

          {currentFiles.map((file) => (
            <ListRow
              key={file.id}
              draggable={!selectMode}
              onDragStart={onItemDragStart(file.id)}
              onClick={() => {
                if (selectMode) toggleSelect(file.id);
                else if (file.kind === 'sheet') navigate(`/mychord?project=${encodeURIComponent(file.id)}`);
              }}
              $selected={selectMode && selectedIds.has(file.id)}
            >
              {selectMode && (
                <CardCheckbox
                  $checked={selectedIds.has(file.id)}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(file.id); }}
                  aria-label="선택"
                  style={{ position: 'static', marginRight: 4 }}
                >
                  {selectedIds.has(file.id) && <CheckMark />}
                </CardCheckbox>
              )}
              {file.kind === 'sheet' ? (
                <ListThumb $tone="sheet"><ListSheetMini /></ListThumb>
              ) : (
                <ListThumb style={{ background: file.gradient ?? GRADIENTS[0] }}>
                  <PlayBadgeSm>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden>
                      <polygon points="7,5 19,12 7,19" />
                    </svg>
                  </PlayBadgeSm>
                </ListThumb>
              )}
              <ListMain>
                <ListTitle title={file.title}>{file.title}</ListTitle>
                <ListSubtitle>{file.kind === 'sheet' ? formatProjectMeta(file) : formatListDate(file.date)}</ListSubtitle>
              </ListMain>
              <ListStar type="button" aria-label="즐겨찾기" onClick={(e) => e.stopPropagation()}>
                <StarOutlineIcon />
              </ListStar>
            </ListRow>
          ))}
        </List>
        )}

        {/* Hidden file inputs driven by the dropdown items. */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/jpg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleOmrFile(f);
            e.target.value = '';
          }}
        />

        {createProjectOpen && (
          <ModalBackdrop onClick={() => !creatingProject && setCreateProjectOpen(false)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>새 코드 프로젝트</ModalTitle>
              <ModalField>
                <ModalLabel>제목</ModalLabel>
                <ModalInput
                  autoFocus
                  placeholder="예: All of Me"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setCreateProjectOpen(false);
                  }}
                />
              </ModalField>
              <ModalField>
                <ModalLabel>조성</ModalLabel>
                <ModalSelect value={newProjectKey} onChange={(e) => setNewProjectKey(e.target.value as ChordProjectKey)}>
                  {CHORD_PROJECT_KEYS.map((key) => (
                    <option key={key} value={key}>{formatProjectKey(key)}</option>
                  ))}
                </ModalSelect>
              </ModalField>
              <ModalField>
                <ModalLabel>박자</ModalLabel>
                <ModalInput
                  placeholder="4/4"
                  value={newProjectTimeSignature}
                  onChange={(e) => setNewProjectTimeSignature(e.target.value)}
                />
              </ModalField>
              <ModalField>
                <ModalLabel>코드 진행</ModalLabel>
                <ModalTextarea
                  placeholder="Dm7 G7 | Cmaj7 | Am7 D7 | Gmaj7"
                  value={newProjectProgression}
                  onChange={(e) => setNewProjectProgression(e.target.value)}
                />
              </ModalField>
              <ModalHint>`|`로 마디를 나누고, 한 마디 안의 코드는 공백으로 구분합니다.</ModalHint>
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={() => void handleCreateProject()} disabled={creatingProject || !newProjectTitle.trim()}>
                  {creatingProject ? '생성 중...' : '생성'}
                </ModalBtn>
              </ModalActions>
            </ModalCard>
          </ModalBackdrop>
        )}

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

        {renameTarget && (
          <ModalBackdrop onClick={() => setRenameTarget(null)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>이름 변경</ModalTitle>
              <ModalInput
                autoFocus
                placeholder={renameTarget.kind === 'folder' ? '폴더 이름' : '파일 이름'}
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
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

const ChordGridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="5" width="16" height="14" rx="1.8" />
    <path d="M8 5v14" />
    <path d="M16 5v14" />
    <path d="M4 12h16" />
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
  top: calc(100% + 4px);
  /* Anchor under the sort icon button (36px wide) — shift right so the menu's
   * right edge lines up with the button's right edge. */
  right: 0;
  min-width: 180px;
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

const ErrorBanner = styled.div`
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
  ${mq.mobile} { margin: 0 14px 8px; }
`;

const ErrorClose = styled.button`
  border: none;
  border-radius: 999px;
  padding: 5px 9px;
  background: rgba(160, 48, 34, 0.08);
  color: #a03022;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
`;

const LoadingStrip = styled.div`
  margin: 0 22px 8px;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.55);
  font-size: 13px;
  ${mq.mobile} { margin: 0 14px 8px; }
`;

/* ── grid ────────────────────────────────────────────────────────────── */

const Grid = styled.div`
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
  /* align-items: start prevents the grid from stretching shorter cards
   * (folders, "신규") to match the tallest card in their row. Without it,
   * a tall chord-chart card would force every folder next to it to grow
   * non-square. With start, each card honors its own aspect-ratio. */
  align-items: start;
  align-content: start;
  gap: 16px 10px;
  padding: 10px 22px 24px;
  ${mq.mobile} {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px 8px;
    padding: 6px 14px 20px;
  }
`;

/* Shared 1:1 card chrome (video + folder). Hover lifts the card with a
 * soft cream tint (matches the folder-hover mock); the actual hover
 * overlay arrow is added per card type since only folders show it. */
const CARD_HOVER_BG = '#FAF6E9';
/* overflow:visible (was hidden) so the kebab menu can drop below the card
 * without being clipped. Top-corner rounding is therefore enforced on each
 * thumb child (Thumb / FolderTop / SheetThumbWrap) instead of relying on
 * the card's clip. */
/* All cards share the same aspect ratio + max-width so folders, "신규" and
 * chord-chart cards align as a uniform grid. 4:7 matches the sheet-card
 * silhouette (5:7 thumb + ~70px meta below). max-width caps every card at
 * the same compact width; justify-self:start keeps them left-aligned in
 * their grid cells rather than stretched. */
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
  max-width: 200px;
  justify-self: start;
  aspect-ratio: 4 / 5;
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

/* Video / file card. $selected highlights the card in multi-select mode.
 * $sheet drops the 1:1 lock and opts out of the grid's default `stretch`
 * align (which was pulling the card to whatever the tallest sibling row
 * height was). align-self:start makes the card hug its own content — thumb
 * (sized to the embedded LeadSheet's scaled height) + CardMeta below.
 * min-height:0 + height:fit-content close any residual auto-stretch path. */
const VideoCard = styled.div<{ $selected?: boolean; $sheet?: boolean; $menuOpen?: boolean }>`
  ${CardBase}
  ${({ $sheet }) => $sheet && `
    /* Reveal the centered arrow overlay (rendered by SheetCardInner) on
     * hover, matching the folder-card affordance. Width / aspect / align
     * inherited from CardBase so every card kind shares the same shape. */
    &:hover .sheet-hover-overlay { opacity: 1; }
  `}
  ${({ $selected }) =>
    $selected &&
    `border-color: #2b8aef; box-shadow: 0 0 0 2px rgba(43, 138, 239, 0.5);`}
  ${({ $menuOpen }) =>
    $menuOpen &&
    `background: ${CARD_HOVER_BG}; border-color: rgba(0, 0, 0, 0.18); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);`}
`;
const Thumb = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background-size: cover;
  background-position: center;
  border-top-left-radius: 13px;
  border-top-right-radius: 13px;
  overflow: hidden;
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

/* Folder card. Hover surfaces a centered dark arrow box over the folder
 * glyph (see HoverOverlay below) to reinforce "click to open". */
const FolderCard = styled.div<{ $selected?: boolean; $menuOpen?: boolean }>`
  ${CardBase}
  ${({ $selected }) =>
    $selected &&
    `border-color: #2b8aef; box-shadow: 0 0 0 2px rgba(43, 138, 239, 0.5);`}
  ${({ $menuOpen }) =>
    $menuOpen &&
    `background: ${CARD_HOVER_BG}; border-color: rgba(0, 0, 0, 0.18); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);`}
  /* Reveal the FolderTop hover overlay on card hover. The overlay lives
   * inside FolderTop with opacity:0 and pointer-events:none so it doesn't
   * intercept the card's click (the whole card already navigates on click). */
  &:hover .folder-hover-overlay { opacity: 1; }
`;
const FolderTop = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #f2f2f3;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top-left-radius: 13px;
  border-top-right-radius: 13px;
  overflow: hidden;
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

/* Composer credit shown under the title on chord-chart cards. Lighter weight
 * than the title so the eye reads "title → author" hierarchy at a glance. */
const ComposerText = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.55);
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

/* Flex row that puts the chord-chart key chip flush to the right of the
 * file title. min-width:0 lets the title ellipsis-clip if the filename is
 * long while the chip stays at its natural width. */
const CardTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-right: 22px; /* room for the absolutely-positioned Kebab */
`;

/* Neutral grey pill showing the chord chart's key (e.g. "C", "Cm"). Sits
 * to the right of the file title with a slight rounding — not a full pill,
 * just softened corners so it reads as a tag rather than a button. */
const KeyChip = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.07);
  color: #3a3a3a;
  letter-spacing: 0.01em;
`;

/* Normalise a key string into compact display form:
 *   "C", "C major", "Cmaj"   → "C"
 *   "Cm", "C-", "Cmin", "Am" → "Cm" / "Am"
 *
 * The leading note (root + optional accidental) is preserved and a trailing
 * "m" is appended only when the suffix indicates minor. */
function formatKey(key: string | undefined): string {
  const trimmed = (key ?? '').trim();
  const match = trimmed.match(/^([A-Ga-g][#b♯♭]?)\s*(.*)$/);
  if (!match) return trimmed;
  const root = match[1].toUpperCase().replace('♯', '#').replace('♭', 'b');
  const rest = match[2].toLowerCase();
  const isMinor = /^(m(in(or)?)?|-)/.test(rest);
  return isMinor ? `${root}m` : root;
}

function musicKeyToDisplay(key: string | undefined): string {
  const raw = (key ?? '').trim();
  if (!raw) return '';
  const minor = raw.endsWith('_MINOR');
  return raw
    .replace(/_MAJOR$/, '')
    .replace(/_MINOR$/, '')
    .replace(/_FLAT/g, 'b')
    .replace(/_SHARP/g, '#')
    .replace(/_/g, '')
    + (minor ? 'm' : '');
}

function formatProjectKey(key: string | undefined): string {
  return formatKey(musicKeyToDisplay(key) || key);
}

function formatProjectMeta(file: FileNode): string {
  const status = file.omrStatus;
  if (status === 'PENDING' || status === 'PROCESSING') {
    return `OMR ${file.omrProgress ?? 0}% · ${file.timeSignature ?? '4/4'}`;
  }
  if (status === 'FAILED') {
    return file.omrFailureReason ? `OMR 실패 · ${file.omrFailureReason}` : 'OMR 실패';
  }
  return `${file.timeSignature ?? '4/4'} · ${formatListDate(file.date)}`;
}

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

/* ── Chord-chart thumbnail ──────────────────────────────────────────────
 * Embeds the real <LeadSheet> component so the card preview matches the
 * /mychord page rendering exactly. Two key constraints from the user:
 *
 *   1. Thumb area is shaped EXACTLY like an A4 page (210 × 297) so the
 *      whole card reads as a real lead sheet at a glance.
 *   2. NO rule-based analysis decoration — no cadence arrows, no
 *      non-diatonic colouring, no ii-V/iv brackets, no roman-numeral
 *      labels. We pass an all-off filter set to suppress them. Section
 *      labels (A / A' / B) are part of the score data, not analysis,
 *      so they remain visible.
 *
 * LeadSheet child styles use `cqi` with `clamp()` floors that won't shrink
 * below ~24px, so we render at a fixed NOMINAL_W and let `transform:
 * scale()` (driven by ResizeObserver) shrink the whole thing to fit. */
/* Wider nominal layout = smaller rendered chord chart (more shrink applied
 * by `transform: scale(card_width / NOMINAL_PREVIEW_WIDTH)`). Bump this to
 * scale the preview down while keeping the LeadSheet's internal proportions
 * intact. 1500 ≈ ~73% the visual size of 1100 at the same card width. */
const NOMINAL_PREVIEW_WIDTH = 1500;

/* Rule-based analysis decorations OFF — only the bare chord chart shows
 * through (chord glyphs in black, plain bars, section labels from data). */
const PREVIEW_FILTERS = {
  showAnalysis: false,
  showDegree: false,
  showIIVI: false,
  showArrows: false,
  showColors: false,
} as const;

/* Padded wrapper around the SheetPreview — gives the chord chart a small
 * inset from the card edges (the card's own background colour shows in the
 * gap, going cream on hover via CARD_HOVER_BG). Also serves as the relative
 * positioning context for the absolutely-positioned hover overlay. */
/* Flex column that grows to fill whatever vertical room the card has left
 * after CardMeta. SheetThumbWrap inside is flex:1, so the chord-chart
 * thumb takes exactly the remaining height — no aspect-ratio lock, no
 * overflow. Reducing the card's overall aspect (CardBase) automatically
 * shrinks the thumb without any thumb-specific tweak needed. */
const SheetCardInner = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 10px 0 10px;
`;

/* The thumb has NO fixed aspect now — it flex-fills the SheetCardInner.
 * Containment + isolation still guarantee that LeadSheet's absolutely
 * positioned decorations can never paint outside this box. */
const SheetThumbWrap = styled.div`
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

/* Holds the un-scaled LeadSheet and shrinks it to fit the fixed-aspect
 * thumb above. Top-left anchored. The inner is positioned absolutely so
 * the LeadSheet's natural (un-scaled) height doesn't push the parent. */
const SheetThumbScaler = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: ${NOMINAL_PREVIEW_WIDTH}px;
  transform-origin: top left;
  /* FORCE the LeadSheet's outer container to render at exactly the nominal
   *  width — without this, its default flex:1 lets its width drift,
   *  which makes the cqi-based chord glyph sizes compute inconsistently
   *  across the card instances (the visual stacked/duplicated look).
   *  display:block bypasses any inherited flex behaviour. */
  & > div {
    width: ${NOMINAL_PREVIEW_WIDTH}px !important;
    flex: none !important;
    overflow: visible !important;
    padding: 0 !important;
    background: #fff !important;
    display: block !important;
  }
  /* Big row-spacing bump — pushes the chord chart's natural height well
   * above the thumb's height so the width-bound scale always FILLS the
   * thumb (any excess gets clipped by overflow:hidden). Without this the
   * scaled chart is shorter than the thumb and a white band appears at
   * the bottom of every card, which reads visually as a row gap. */
  & > div > div > div:nth-child(n+3) {
    margin-top: 80px !important;
  }
`;

const ProjectPreviewState = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: rgba(0, 0, 0, 0.42);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
`;

function SheetPreview({ project }: { project?: ChordProject }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState({ x: 0.13, y: 0.13 });
  const [data, setData] = useState<LeadSheetData | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');

  useEffect(() => {
    if (!project) {
      setPreviewState('empty');
      setData(null);
      return;
    }
    if (project.omrStatus === 'PENDING' || project.omrStatus === 'PROCESSING') {
      setPreviewState('loading');
      setData(null);
      return;
    }
    if (project.omrStatus === 'FAILED') {
      setPreviewState('failed');
      setData(null);
      return;
    }
    let cancelled = false;
    setPreviewState('loading');
    getChordProjectAnalysis(project.publicId)
      .then((analysis) => {
        if (cancelled) return;
        const sheet = analysisToLeadSheet(analysis, project);
        setData(sheet);
        setPreviewState(sheet.systems.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setPreviewState('empty');
        }
      });
    return () => { cancelled = true; };
  }, [project]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf: number | null = null;
    const measure = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const cw = wrap.clientWidth;
        const ch = wrap.clientHeight;
        const naturalHeight = scalerRef.current?.firstElementChild instanceof HTMLElement
          ? scalerRef.current.firstElementChild.offsetHeight
          : 0;
        if (cw <= 0 || ch <= 0 || naturalHeight <= 0) return;
        const scaleX = cw / NOMINAL_PREVIEW_WIDTH;
        const scaleY = Math.max(scaleX, ch / naturalHeight);
        setPreviewScale({ x: scaleX, y: scaleY });
      });
    };
    measure();
    /* Observe only the wrap; the embedded score is static, while the card
     * dimensions change with viewport / grid reflow. */
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [data]);

  return (
    <SheetThumbWrap ref={wrapRef}>
      {data ? (
        <SheetThumbScaler
          ref={scalerRef}
          style={{ transform: `scale(${previewScale.x}, ${previewScale.y})` }}
        >
          <LeadSheet data={data} analysisFilters={PREVIEW_FILTERS} />
        </SheetThumbScaler>
      ) : (
        <ProjectPreviewState>
          <ChordGridIcon />
          <span>
            {previewState === 'failed'
              ? 'OMR 실패'
              : previewState === 'empty'
                ? '코드 등록 필요'
                : `${project?.omrProgress ?? 0}% 처리 중`}
          </span>
        </ProjectPreviewState>
      )}
    </SheetThumbWrap>
  );
}

function analysisToLeadSheet(analysis: ChordAnalysisResult, project: ChordProject): LeadSheetData {
  const byBar = new Map<number, typeof analysis.chords>();
  for (const chord of analysis.chords ?? []) {
    const bar = Number(chord.bar || 1);
    const list = byBar.get(bar) ?? [];
    list.push(chord);
    byBar.set(bar, list);
  }
  const maxBar = Math.max(0, ...Array.from(byBar.keys()));
  const bars = Array.from({ length: maxBar }, (_, index) => {
    const measureNumber = index + 1;
    const chords = (byBar.get(measureNumber) ?? [])
      .sort((a, b) => Number(a.beat) - Number(b.beat))
      .map((info) => ({
        ...parseChordInput(info.chord),
        id: info.publicId,
        isDiatonic: typeof info.analysis?.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
        analysis: info.analysis ? {
          degree: typeof info.analysis.degree === 'string' ? info.analysis.degree : undefined,
          normalizedQuality: typeof info.analysis.normalizedQuality === 'string' ? info.analysis.normalizedQuality : undefined,
          isDiatonic: typeof info.analysis.isDiatonic === 'boolean' ? info.analysis.isDiatonic : undefined,
          ambiguityScore: typeof info.analysis.ambiguityScore === 'number' ? info.analysis.ambiguityScore : undefined,
        } : undefined,
      }));
    return { measureNumber, chords: chords.length > 0 ? chords : [{}] };
  });

  const systems = [];
  for (let i = 0; i < bars.length; i += 4) {
    systems.push({ bars: bars.slice(i, i + 4) });
  }
  return {
    id: project.publicId,
    title: analysis.title || project.title,
    style: '',
    composer: '',
    key: musicKeyToDisplay(analysis.keySignature || project.keySignature),
    timeSignature: analysis.timeSignature || project.timeSignature || '4/4',
    systems,
  };
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

const ModalSelect = styled.select`
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

const ModalTextarea = styled.textarea`
  width: 100%;
  min-height: 92px;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 14.5px;
  color: #1a1a1a;
  outline: none;
  resize: vertical;
  &:focus { border-color: rgba(0, 0, 0, 0.4); }
`;

const ModalField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
`;

const ModalLabel = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.55);
`;

const ModalHint = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.48);
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

/* ── view-mode toggle + list-view styled components ───────────────────── */

/* Segmented grid/list toggle that lives next to the sort button in the
 * header. Visually a single pill; the active half darkens to indicate
 * the selected mode. */
const ViewToggle = styled.div`
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
  background: #fff;
`;
const ViewToggleBtn = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: ${({ $active }) => ($active ? '#2a73d9' : 'rgba(0, 0, 0, 0.55)')};
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)')}; }
`;

/* 4-square grid icon. Filled when active (active color is driven by the
 * parent button's `color` via currentColor). */
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

/* 3-line list icon — dot + bar rows. */
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

/* Outline star icon used by the (mock) favorite button on each list row.
 * Wiring is deferred — the icon is visual only for now. */
function StarOutlineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a73d9" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.7l-5.4 2.7 1-6.1L3.2 10l6.1-.9z" />
    </svg>
  );
}

/* List container — stacked rows, scroll inside the page body. */
const List = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 22px 24px;
  ${mq.mobile} { padding: 2px 14px 20px; }
`;

const ListRow = styled.div<{ $selected?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  background: ${({ $selected }) => ($selected ? 'rgba(43, 138, 239, 0.07)' : 'transparent')};
  transition: background 0.1s;
  &:hover { background: ${({ $selected }) => ($selected ? 'rgba(43, 138, 239, 0.1)' : 'rgba(0, 0, 0, 0.03)')}; }
`;

/* "신규" row sits at the top of the list view; wrapper anchors the NewMenu
 * popover absolutely (mirrors NewCardWrap in grid mode). */
const ListNewRowWrap = styled.div`
  position: relative;
`;
const ListNewRow = styled.button`
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: rgba(0, 0, 0, 0.6);
  transition: background 0.1s, color 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.03); color: #1a1a1a; }
`;

/* Small leading thumbnail. $tone picks a default background tint for folder
 * / sheet / "new"; for plain files the inline `style.background` (gradient)
 * takes over via attribute precedence. */
const ListThumb = styled.div<{ $tone?: 'folder' | 'sheet' | 'new' }>`
  position: relative;
  flex-shrink: 0;
  width: 64px;
  height: 44px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: ${({ $tone }) =>
    $tone === 'folder' ? '#f2f2f3'
      : $tone === 'sheet' ? '#fff'
      : $tone === 'new' ? 'transparent'
      : '#e5e5e5'};
  ${({ $tone }) => $tone === 'new' && `
    border-style: dashed;
    border-color: rgba(0, 0, 0, 0.22);
  `}
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: rgba(0, 0, 0, 0.55);
`;

/* Tiny static lead-sheet glyph for sheet rows — three horizontal staff-like
 * lines with one chord mark. Cheap to render and reads as "sheet music" in
 * a 64×44 box without firing up the full LeadSheet+ResizeObserver stack. */
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

const PlayBadgeSm = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 80, 80, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const ListMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const ListTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const ListSubtitle = styled.div`
  font-size: 12px;
  color: rgba(0, 0, 0, 0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ListStar = styled.button`
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.35);
  &:hover { background: rgba(0, 0, 0, 0.05); color: #2a73d9; }
`;

/* Format an ISO date ("2026-05-20") as a localized row subtitle. Falls back
 * to the raw string if parsing fails so the row never goes blank. */
function formatListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/* ── card hover overlay (folder only) + per-card kebab menu ───────────── */

/* Sits absolutely inside FolderTop. Revealed by `${FolderCard}:hover` via
 * the `.folder-hover-overlay` class (see FolderCard above). pointer-events
 * off so the underlying card click still navigates into the folder. */
const HoverOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
`;
const HoverArrowBox = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
`;
function ArrowRightIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

/* Compact dropdown anchored just below the card, aligned to the kebab
 * button's right edge. Card uses overflow:visible so the menu can spill
 * down past the card's lower edge into the grid gap. */
const KebabMenu = styled.div`
  position: absolute;
  right: 6px;
  top: calc(100% + 4px);
  min-width: 132px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  padding: 6px;
  z-index: 20;
  animation: kebabIn 0.1s ease both;
  @keyframes kebabIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
const KebabMenuItem = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  color: ${({ $danger }) => ($danger ? '#e74c3c' : '#1a1a1a')};
  transition: background 0.1s;
  &:hover { background: ${({ $danger }) => ($danger ? 'rgba(231, 76, 60, 0.08)' : 'rgba(0, 0, 0, 0.04)')}; }
`;
const KebabMenuIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: currentColor;
  flex-shrink: 0;
`;
function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}
