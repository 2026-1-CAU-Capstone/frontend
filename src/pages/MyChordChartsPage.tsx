import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useDismissable } from '../hooks/useDismissable';
import { useViewModePref } from '../hooks/useViewModePref';
import {
  CardMeta,
  Header,
  HeaderActions,
  HoverArrowBox,
  HoverOverlay,
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
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { LeadSheet } from '../components/leadsheet/LeadSheet';
import type { LeadSheetData } from '../data/leadSheetTypes';
import { analysisToLeadSheet } from '../lib/chordProjectToLeadSheet';
import { getFreshCachedSheet, setCachedAnalysis, clearCachedAnalysis } from '../lib/analysisCache';
import { saveOmrSourceImage, deleteOmrSourceImage } from '../lib/omrImageStore';
import { ConfirmDeleteModal } from '../components/common/ConfirmDeleteModal';
import {
  addChordProjectChords,
  analyzeChordProject,
  createChordProject,
  createChordProjectFromOmr,
  deleteChordProject,
  getChordProjectAnalysis,
  getChordProjectOmrStatus,
  listChordProjects,
  updateChordProject,
  type ChordProject,
  type ChordProjectKey,
  type ChordAnalysisResult,
} from '../api/chordProjects';
import { ProjectCreateModal, type ProjectCreatePayload } from '../components/common/ProjectCreateModal';
import { KeyPicker } from '../components/common/KeyPicker';

/* ─────────────────────────────────────────────────────────────────────────
 * MyChordChartsPage — document grid for "내 코드 차트".
 *
 * Real folder behavior, mocked content. Each item lives at a parentId (null
 * = root). Nav state moves through the tree; localStorage persists between
 * reloads so the mock feels real.
 *
 *   - Breadcrumbs (홈 › Jazz › 이지원재즈) appear when inside a folder
 *   - A dashed "drag here to move up" zone sits between breadcrumbs + grid
 *   - The "신규" tile opens a dropdown: 직접 입력하기 /
 *     코드 차트 업로드 / (divider) / 폴더 생성
 *   - Cards are draggable; drop on a folder card or on the parent-drop zone
 * ──────────────────────────────────────────────────────────────────────── */

type ItemKind = 'video' | 'file' | 'image' | 'sheet';

/* The single analyzed chart that opens chord-analysis (mychord) view. The card
 * stays a placeholder until per-user persistence lands. */
const SHEET_ANALYZED_ID = 'sheet-all-of-me';

/* Prefix for the temporary client-side id assigned to an optimistic
 * "uploading" chord-project card. The OMR-status poller skips ids with this
 * prefix (they don't exist on the server yet). */
const UPLOADING_ID_PREFIX = '__uploading__';

/* OMR 완료 직후 /analyze 를 부르는 경로가 둘이다 — 페이지 폴러(완료 감지)와
 * SheetPreview 자가복구(GET /analysis 404→POST). 동시에 같은 프로젝트에 POST가
 * 두 발 나가던 레이스를 in-flight Promise 공유로 단일화한다. */
const analyzeInflight = new Map<string, Promise<ChordAnalysisResult>>();
function analyzeOnce(publicId: string): Promise<ChordAnalysisResult> {
  const inflight = analyzeInflight.get(publicId);
  if (inflight) return inflight;
  const job = analyzeChordProject(publicId).finally(() => {
    analyzeInflight.delete(publicId);
  });
  analyzeInflight.set(publicId, job);
  return job;
}

/** OMR status polling interval (ms). OMR takes tens of seconds, so a slow poll
 *  is plenty — keeps the GET /omr-status request rate low. */
const OMR_POLL_INTERVAL_MS = 8000;

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
const VIEW_MODE_STORAGE_KEY = 'jazzify.myCharts.viewMode.v1';

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

/* ── component ───────────────────────────────────────────────────────── */

export default function MyChordChartsPage() {
  const navigate = useNavigate();
  const [store, setStore] = useState<Store>(loadStore);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
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
  const [viewMode, setViewMode] = useViewModePref(VIEW_MODE_STORAGE_KEY);

  /* Card kebab menu (이름 변경 / 이동 / 삭제). Single menu open at a time
   * — id of the card whose menu is open, or null. Rename target drives the
   * shared rename modal below. */
  const [kebabMenuId, setKebabMenuId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    { id: string; kind: 'folder' | 'file'; name: string } | null
  >(null);
  const [renameInput, setRenameInput] = useState('');
  /* "정보 변경" modal for a chord chart (file) — edits title + key via PUT.
   * timeSignature is intentionally absent (backend forbids editing it). */
  const [editTarget, setEditTarget] = useState<{ id: string } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editKey, setEditKey] = useState<string>('C_MAJOR');
  const [editSaving, setEditSaving] = useState(false);
  /* Confirm-delete modal target for a chord chart (file). `null` = closed. */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  /* Multi-select mode: checkbox overlay on every card + bottom action bar. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const newWrapRef = useRef<HTMLDivElement>(null);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const kebabMenuRef = useRef<HTMLDivElement>(null);
  /* Tracks which projects we've already auto-analyzed after OMR completion
   * (the backend doesn't run analyze automatically after OMR; ChordInfo
   * lands but no AnalysisResult, so GET /analysis returns CHORD_PROJECT_005
   * until we POST /analyze once). Set-based de-dup prevents the same poll
   * cycle from firing analyze twice if the COMPLETED status flicks through. */
  const analyzedOmrIdsRef = useRef<Set<string>>(new Set());
  /* Per-id auto-analyze failure counter. We retry transient failures by
   * clearing the de-dup, but cap it so a PERMANENTLY failing project (bad
   * data, etc.) doesn't POST /analyze every poll cycle forever. */
  const analyzeFailCountRef = useRef<Map<string, number>>(new Map());
  const MAX_AUTO_ANALYZE_RETRIES = 3;

  /* ── Onboarding "새 프로젝트 생성" modal (replaces the old 신규 dropdown) ── */
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardFile, setOnboardFile] = useState<File | null>(null);
  const [onboardCreating, setOnboardCreating] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [pageDragOver, setPageDragOver] = useState(false);

  const openCreateModal = () => { setOnboardFile(null); setOnboardError(null); setOnboardOpen(true); };

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
      // 업로드 진행 중 placeholder(__uploading__*)는 서버 목록에 없다 — 정렬
      // 변경 등으로 reload가 끼어들 때 통째 교체하면 "업로드 중" 카드가
      // 사라져 취소된 것처럼 보였다. placeholder를 보존하며 병합.
      setProjects((prev) => [
        ...prev.filter((p) => p.publicId.startsWith(UPLOADING_ID_PREFIX)),
        ...page.content,
      ]);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : '코드 프로젝트 목록 조회 실패');
    } finally {
      setProjectLoading(false);
    }
  }, [projectSort]);

  useEffect(() => { void reloadProjects(); }, [reloadProjects]);

  /* 폴링 대상(서버에 존재하는 PENDING/PROCESSING) id 목록을 "정렬된 문자열"로
   * 만들어 effect deps 로 쓴다. 진행률(omrProgress)만 갱신될 땐 이 문자열이
   * 그대로라 effect 가 재실행되지 않으므로 setInterval 이 살아남아 "진짜 5초
   * 간격"이 유지된다.
   *   ⚠ 예전엔 deps 가 [projects] 였다 → 폴링→setProjects(진행률 갱신)→
   *   projects 새 참조→effect 재실행→clearInterval+즉시 재폴링 의 루프가 돌아
   *   5초 간격이 무력화되고 응답 오자마자 다시 요청(미친듯이 폴링)했다. */
  const activePollIds = projects
    .filter((p) => !p.publicId.startsWith(UPLOADING_ID_PREFIX)
      && (p.omrStatus === 'PENDING' || p.omrStatus === 'PROCESSING'))
    .map((p) => p.publicId)
    .sort()
    .join(',');

  useEffect(() => {
    if (!activePollIds) return;
    const ids = activePollIds.split(',');
    const pollOnce = () => {
      ids.forEach((id) => {
        getChordProjectOmrStatus(id)
          .then(async (status) => {
            setProjects((prev) => prev.map((p) => (
              p.publicId === id
                ? {
                  ...p,
                  omrStatus: status.status,
                  omrProgress: status.progress,
                  omrFailureReason: status.failureReason,
                }
                : p
            )));
            /* OMR just finished → kick off analysis once. ChordInfo is in
             * the DB at this point, but no AnalysisResult exists yet — the
             * SheetPreview's GET /analysis would 400 (CHORD_PROJECT_005)
             * until /analyze runs. Best-effort: failure is recoverable
             * via the per-card retry in SheetPreview (path B). */
            if (status.status === 'COMPLETED' && !analyzedOmrIdsRef.current.has(id)) {
              analyzedOmrIdsRef.current.add(id);
              try {
                await analyzeOnce(id);
                /* Bump updatedAt so SheetPreview's effect (keyed off the
                 * `project` reference) re-fires and pulls the freshly-
                 * computed analysis. */
                setProjects((prev) => prev.map((p) => (
                  p.publicId === id ? { ...p, updatedAt: new Date().toISOString() } : p
                )));
              } catch (e) {
                console.warn('[chord-project] auto-analyze after OMR failed:', e);
                /* Retry transient failures by clearing the de-dup — but only up
                 * to MAX_AUTO_ANALYZE_RETRIES. Past that we leave the id in the
                 * "analyzed" set so a permanently-failing project stops being
                 * re-POSTed every 8s. (SheetPreview's on-demand retry still
                 * exists as a manual fallback.) */
                const n = (analyzeFailCountRef.current.get(id) ?? 0) + 1;
                analyzeFailCountRef.current.set(id, n);
                if (n < MAX_AUTO_ANALYZE_RETRIES) {
                  analyzedOmrIdsRef.current.delete(id);
                }
              }
            }
          })
          .catch(() => { /* best-effort polling */ });
      });
    };
    // 즉시 한 번(마운트 시 진행 상태 바로 표시) + 이후 5초 간격.
    pollOnce();
    const timer = window.setInterval(pollOnce, OMR_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activePollIds]);

  // Persist on every change.
  useEffect(() => { saveStore(store); }, [store]);

  // Close the "신규" dropdown on outside click / Escape.
  useDismissable(newMenuOpen, newWrapRef, () => setNewMenuOpen(false));

  /* Close the sort dropdown on outside click / Escape. */
  useDismissable(sortMenuOpen, sortWrapRef, () => setSortMenuOpen(false));

  /* Escape exits select mode. */
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelectMode(false); setSelectedIds(new Set()); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectMode]);

  /* Close the per-card kebab menu on outside click / Escape. */
  useDismissable(kebabMenuId !== null, kebabMenuRef, () => setKebabMenuId(null));

  /* Computed: contents of the current folder. */
  const currentFolders = useMemo<FolderNode[]>(() => [], []);
  const currentFiles = useMemo<FileNode[]>(
    () => currentFolderId === null
      ? projects.map((project) => ({
        id: project.publicId,
        parentId: null,
        kind: 'sheet' as const,
        title: project.title,
        /* 전체 ISO 를 그대로 — formatListDate 가 날짜+시각까지 보여준다.
         * slice(0,10) 하면 시각이 잘려 항상 "오전 12:00"으로 죽었다. */
        date: project.createdAt || today(),
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

  /* Optimistic OMR upload. The server's POST /v1/chord-projects/omr returns
   * immediately with omrStatus=PENDING, but the multipart file upload itself
   * still takes time over the wire — during which the user would otherwise
   * stare at an unchanged grid. So we insert a placeholder card RIGHT AWAY
   * (temp id, PENDING, 0%), then swap it for the real project once the POST
   * resolves. On failure we drop the placeholder and surface the error.
   * The temp id is prefixed so the OMR-status poller skips it. */
  const uploadOmrFile = async (file: File, titleOverride?: string, keyOverride?: string): Promise<void> => {
    setProjectError(null);
    const tempId = `${UPLOADING_ID_PREFIX}${newId()}`;
    const title = titleOverride?.trim() || file.name.replace(/\.[^.]+$/, '');
    /* 온보딩에서 고른 조성을 placeholder 카드와 백엔드 양쪽에 그대로 반영한다.
     * (지정 없이 파일만 드롭한 경로는 C 장조로 시작.) */
    const key = keyOverride || 'C_MAJOR';
    const nowIso = new Date().toISOString();
    const placeholder: ChordProject = {
      publicId: tempId,
      title,
      keySignature: key,
      timeSignature: '4/4',
      omrStatus: 'PENDING',
      omrProgress: 0,
      omrFailureReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    // 즉시 카드 노출 (업로드 중 표시)
    setProjects((prev) => [placeholder, ...prev]);
    try {
      const created = await createChordProjectFromOmr(file, { title, key });
      // 업로드한 원본 악보 이미지를 publicId 로 로컬(IndexedDB) 보관.
      // 카드의 "원본" 토글 UI는 일단 제거했지만(후순위), 데이터는 계속 저장해
      // 두어 추후 토글을 되살릴 때 바로 쓸 수 있게 한다. best-effort.
      void saveOmrSourceImage(created.project.publicId, file);
      // 플레이스홀더를 실제 프로젝트로 교체 (중복 제거 포함)
      setProjects((prev) => [
        created.project,
        ...prev.filter((p) => p.publicId !== tempId && p.publicId !== created.project.publicId),
      ]);
    } catch (e) {
      // 실패 시 플레이스홀더 제거
      setProjects((prev) => prev.filter((p) => p.publicId !== tempId));
      setProjectError(e instanceof Error ? e.message : '코드 차트 업로드 실패');
    }
  };

  /** Onboarding modal submit. On 내 코드 차트 we ALWAYS create a chord chart via
   *  OMR and keep the result on THIS page — regardless of the modal's type
   *  selector. (Previously "악보" routed to a SheetProject and navigated away to
   *  내 악보 차트, which surprised users who just wanted a card here.) */
  const handleOnboardCreate = async (p: ProjectCreatePayload): Promise<void> => {
    setOnboardCreating(true);
    setOnboardError(null);
    try {
      setOnboardOpen(false);
      await uploadOmrFile(p.file, p.title, p.key);   // placeholder card + OMR (own error handling)
    } catch (e) {
      setOnboardError(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setOnboardCreating(false);
    }
  };

  /* ── Page-level drag-drop: dropping a file anywhere opens the onboarding
   *  modal with the file pre-loaded (per spec — not an immediate upload). ── */
  const onPageDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setPageDragOver(true); }
  };
  const onPageDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target) setPageDragOver(false);
  };
  const onPageDrop = (e: DragEvent) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    setPageDragOver(false);
    setOnboardError(null);
    setOnboardFile(f);
    setOnboardOpen(true);
  };

  const addFolder = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setStore((s) => ({
      ...s,
      folders: [...s.folders, { id: newId(), parentId: currentFolderId, name: trimmed, createdAt: today() }],
    }));
  };

  const resetCreateProject = (): void => {
    setNewProjectTitle('');
    setNewProjectKey('C_MAJOR');
    setNewProjectTimeSignature('4/4');
    setNewProjectProgression('');
    setProjectError(null);
  };

  // Legacy modal entry — kept while the create-project modal still exists
  // (now unused by the new-menu after the dropdown was re-aligned with the
  // 직접 입력하기 / 코드 차트 업로드 / 폴더 생성 set).
  const _openCreateProject = (): void => {
    resetCreateProject();
    setCreateProjectOpen(true);
  };
  void _openCreateProject;

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

  // 코드 차트 업로드는 OMR 경로로 처리.

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
    // A chord chart card always carries a backend project publicId, so a 'file'
    // delete must hit the backend even if `projects` momentarily lacks it
    // (e.g. a mid-poll state) — otherwise the click silently no-ops.
    if (kind === 'file' && (project || !id.startsWith(UPLOADING_ID_PREFIX))) {
      setProjectError(null);
      try {
        await deleteChordProject(id);
        void deleteOmrSourceImage(id); // drop the locally-cached source image
        clearCachedAnalysis(id);        // drop the cached lead-sheet
        setProjects((prev) => prev.filter((p) => p.publicId !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        // Reconcile with the server so a silent backend failure (item lingers)
        // is visible rather than masked by the optimistic removal.
        void reloadProjects();
      } catch (e) {
        console.error('[chord-project] delete failed:', e);
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
  /* Open the "정보 변경" modal seeded with the chart's current title + key. */
  const openEdit = (id: string, title: string, key: string): void => {
    setKebabMenuId(null);
    setEditTarget({ id });
    setEditTitle(title);
    setEditKey(key || 'C_MAJOR');
  };
  const confirmEdit = async (): Promise<void> => {
    if (!editTarget) return;
    const title = editTitle.trim();
    if (!title) return;
    setEditSaving(true);
    setProjectError(null);
    try {
      const updated = await updateChordProject(editTarget.id, { title, key: editKey });
      setProjects((prev) => prev.map((p) => (p.publicId === editTarget.id ? updated : p)));
      setEditTarget(null);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : '코드 프로젝트 수정 실패');
    } finally {
      setEditSaving(false);
    }
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
      // allSettled: 일부 실패 시에도 성공분은 즉시 반영. (이전 Promise.all은
      // 한 건만 실패해도 catch로 빠져 — 서버에선 지워진 항목이 화면에 남고,
      // 재시도하면 그 id들이 404라 전체가 또 실패한 것처럼 보였다.)
      const results = await Promise.allSettled(projectIds.map((id) => deleteChordProject(id)));
      const okIds = projectIds.filter((_, i) => results[i].status === 'fulfilled');
      const failed = projectIds.length - okIds.length;
      okIds.forEach((id) => { void deleteOmrSourceImage(id); clearCachedAnalysis(id); });
      if (okIds.length > 0) {
        const okSet = new Set(okIds);
        setProjects((prev) => prev.filter((p) => !okSet.has(p.publicId)));
      }
      if (failed > 0) {
        setProjectError(`${failed}개 항목 삭제 실패 (${okIds.length}개는 삭제됨)`);
        void reloadProjects(); // 서버 상태와 재동기화
      } else {
        exitSelect();
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
      <PageBody onDragOver={onPageDragOver} onDragLeave={onPageDragLeave} onDrop={onPageDrop}>
        {pageDragOver && <PageDropOverlay>여기에 놓으면 새 프로젝트로 추가됩니다</PageDropOverlay>}
        <Header>
          <Title>내 코드 차트</Title>
          <HeaderActions>
            {!selectMode && (
              <PillBtn type="button" onClick={() => setCreateFolderOpen(true)}>새 폴더</PillBtn>
            )}
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
            <NewCard type="button" onClick={openCreateModal}>
              <PlusIcon />
              <NewLabel>신규</NewLabel>
            </NewCard>
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
                if (selectMode) { toggleSelect(file.id); return; }
                if (file.kind !== 'sheet') return;
                // OMR 처리 중(또는 업로드 중 placeholder)인 카드는 아직 코드
                // 데이터가 없으므로 분석 페이지로 이동하지 않는다.
                if (file.omrStatus === 'PENDING' || file.omrStatus === 'PROCESSING') return;
                if (file.id.startsWith(UPLOADING_ID_PREFIX)) return;
                navigate(`/mychord?project=${encodeURIComponent(file.id)}`);
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
                  {!selectMode
                    && file.omrStatus !== 'PENDING' && file.omrStatus !== 'PROCESSING' && (
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
                  <>
                    <CardTitleRow>
                      <CardTitle title={file.title} style={{ paddingRight: 0 }}>{file.title}</CardTitle>
                      <KeyChip>{formatProjectKey(file.keySignature)}</KeyChip>
                      <TimeChip>{displayTimeSig(file.timeSignature)}</TimeChip>
                    </CardTitleRow>
                    <MetaRow>
                      <DateText>{formatListDate(file.date)}</DateText>
                    </MetaRow>
                  </>
                ) : (
                  <>
                    <CardTitle title={file.title}>{file.title}</CardTitle>
                    <MetaRow>
                      <Badge $tone={file.kind === 'video' ? 'youtube' : 'folder'}>
                        {file.kind === 'video' ? 'YouTube'
                          : file.kind === 'image' ? '이미지'
                          : '파일'}
                      </Badge>
                      <DateText>{file.date}</DateText>
                    </MetaRow>
                  </>
                )}
              </CardMeta>
              <Kebab aria-label="더보기" onClick={openKebab(file.id)}>
                <KebabDot /><KebabDot /><KebabDot />
              </Kebab>
              {kebabMenuId === file.id && (
                <KebabMenu ref={kebabMenuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                  <KebabMenuItem type="button" onClick={() => openEdit(file.id, file.title, file.keySignature ?? 'C_MAJOR')}>
                    <KebabMenuIcon><RenameIcon /></KebabMenuIcon>
                    <span>정보 변경</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" onClick={() => { setKebabMenuId(null); alert('이동: 추후 구현'); }}>
                    <KebabMenuIcon><MoveIcon /></KebabMenuIcon>
                    <span>이동</span>
                  </KebabMenuItem>
                  <KebabMenuItem type="button" $danger onClick={() => { setKebabMenuId(null); setDeleteTarget({ id: file.id, title: file.title }); }}>
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
            <ListNewRow type="button" onClick={openCreateModal}>
              <ListThumb $tone="new"><PlusIcon /></ListThumb>
              <ListMain>
                <ListTitle>신규</ListTitle>
                <ListSubtitle>새 프로젝트 생성</ListSubtitle>
              </ListMain>
            </ListNewRow>
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
                if (selectMode) { toggleSelect(file.id); return; }
                if (file.kind !== 'sheet') return;
                // OMR 처리 중(또는 업로드 중 placeholder)인 카드는 아직 코드
                // 데이터가 없으므로 분석 페이지로 이동하지 않는다.
                if (file.omrStatus === 'PENDING' || file.omrStatus === 'PROCESSING') return;
                if (file.id.startsWith(UPLOADING_ID_PREFIX)) return;
                navigate(`/mychord?project=${encodeURIComponent(file.id)}`);
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
                <KeyPicker value={newProjectKey} onChange={(k) => setNewProjectKey(k as ChordProjectKey)} />
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

        {editTarget && (
          <ModalBackdrop onClick={() => !editSaving && setEditTarget(null)}>
            <ModalCard onClick={(e) => e.stopPropagation()}>
              <ModalTitle>정보 변경</ModalTitle>
              <ModalField>
                <ModalLabel>제목</ModalLabel>
                <ModalInput
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditTarget(null); }}
                />
              </ModalField>
              <ModalField>
                <ModalLabel>조성</ModalLabel>
                <KeyPicker value={editKey} onChange={setEditKey} />
              </ModalField>
              <ModalHint>박자는 생성 후 변경할 수 없습니다.</ModalHint>
              <ModalActions>
                <ModalBtn $variant="ghost" type="button" onClick={() => setEditTarget(null)} disabled={editSaving}>취소</ModalBtn>
                <ModalBtn $variant="primary" type="button" onClick={() => void confirmEdit()} disabled={editSaving || !editTitle.trim()}>
                  {editSaving ? '저장 중...' : '저장'}
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
                  if (e.key === 'Enter') { if (isComposingEvent(e)) return; addFolder(folderName); setCreateFolderOpen(false); }
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

        <ProjectCreateModal
          open={onboardOpen}
          defaultType="chord"
          initialFile={onboardFile}
          creating={onboardCreating}
          error={onboardError}
          onManualEntry={() => { setOnboardOpen(false); navigate('/mychord?empty=1&edit=1'); }}
          onClose={() => setOnboardOpen(false)}
          onCreate={handleOnboardCreate}
        />

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

        <ConfirmDeleteModal
          open={!!deleteTarget}
          title="코드 차트 삭제"
          body="이 코드 차트를 삭제하시겠습니까?"
          onConfirm={async () => {
            if (!deleteTarget) return;
            await deleteItem(deleteTarget.id, 'file');
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />

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



const PageDropOverlay = styled.div`
  position: absolute;
  inset: 10px;
  z-index: 50;
  border: 2px dashed #B8860B;
  border-radius: 14px;
  background: rgba(253, 246, 231, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #7a5b00;
  pointer-events: none;
`;






/* Sort dropdown — anchored to the sort icon button. */




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

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const NewCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
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
  transition: border-color 0.15s, color 0.15s, background 0.15s, box-shadow 0.15s;
  /* Same cream tint as the other cards' hover bg so the column reads as
   * one consistent affordance. */
  &:hover {
    border-color: rgba(0, 0, 0, 0.3);
    color: #1a1a1a;
    background: ${CARD_HOVER_BG};
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
  }
`;
// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const NewLabel = styled.div`
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
`;

/* Larger, bolder "신규" dropdown — matches the design mock (big rows,
 * generous padding, ~24 px icons). Anchored under the NewCard. */
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

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
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

/* 제목 + 키칩 + 박자칩을 한 줄에. 제목이 flex:1 로 남는 폭을 전부 먹고(길면
 * ellipsis), 칩들은 flex-shrink:0 이라 절대 안 잘린다 → "제목은 최대한 길게,
 * Am·4/4 는 항상 보이게". */
// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const CardTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  /* 케밥(⋮)은 우측 하단이라 이 줄과 안 겹친다 → 우측 여백을 최소화해
   * 제목이 카드 끝까지 길어지고 Am·4/4 가 오른쪽 끝에 거의 닿게. */
  padding-right: 2px;

  & > ${CardTitle} {
    flex: 1;
    min-width: 0;
  }
`;

/* Neutral grey pill showing the chord chart's key (e.g. "C", "Cm"). Sits
 * to the right of the file title with a slight rounding — not a full pill,
 * just softened corners so it reads as a tag rather than a button. */

/* 박자(4/4) 칩 — 키 칩 바로 오른쪽. 키=노랑 / 박자=파랑으로 색을 갈라
 * "조성 vs 박자"가 한눈에 구분되도록. */

/* OMR 진행 막대 — 썸네일 가운데 "N% 처리 중" 아래 0~100 채움 바. */
const ProgressTrack = styled.div`
  width: 70%;
  max-width: 132px;
  height: 5px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.1);
  overflow: hidden;
`;
const ProgressFill = styled.div`
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2b8aef, #4aa3ff);
  transition: width 0.45s ease;
`;

/* 박자표 방어 — OMR/백엔드가 "30" 같은 깨진 값을 timeSignature 로 주는 경우가
 * 있어, "N/M" 형식이 아니면 기본 "4/4"로 폴백한다. (임시방편 — 근본 해결은
 * 백엔드의 OMR time_signature → timeSignature 매핑 수정) */
function displayTimeSig(ts: string | undefined): string {
  return ts && /^\d+\/\d+$/.test(ts) ? ts : '4/4';
}

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
    return `${file.omrProgress ?? 0}% 처리 중`;
  }
  if (status === 'FAILED') {
    return file.omrFailureReason ? `OMR 실패 · ${file.omrFailureReason}` : 'OMR 실패';
  }
  return `${file.timeSignature ?? '4/4'} · ${formatListDate(file.date)}`;
}


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
  /* 미리보기 썸네일에서만 곡 제목(SheetTitle h1)을 크게 — 카드에서 곡명이
   * 한눈에 읽히도록. 전체화면 LeadSheet 는 이 스케일러를 안 거치므로 영향 없음. */
  & h1 {
    font-size: 4rem !important;
  }
`;

/* 처리 중(OMR 진행 중) 카드 가운데에서 도는 로딩 스피너. */
const Spinner = styled.div`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid rgba(0, 0, 0, 0.12);
  border-top-color: rgba(0, 0, 0, 0.45);
  animation: spin 0.8s linear infinite;
  @keyframes spin {
    to { transform: rotate(360deg); }
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
  const [previewScale, setPreviewScale] = useState({ scale: 0.13, offsetY: 0 });
  const [data, setData] = useState<LeadSheetData | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');
  // Lazy-load gate: the expensive per-card analysis fetch (GET /analysis +
  // possibly POST /analyze) is deferred until the card scrolls near the
  // viewport, so opening a grid of 100 charts doesn't fire 100 analysis
  // requests at once. Mirrors MySheetProjectsPage's SheetPreview.
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
    // COMPLETED — defer the (expensive) analysis fetch until the card is on
    // screen. Until then it sits in 'loading' ("불러오는 중…"); the effect
    // re-runs when `shouldRender` flips true and fetches then.
    if (!shouldRender) {
      setPreviewState('loading');
      setData(null);
      return;
    }
    // Version-keyed cache hit → render instantly, ZERO backend calls. The
    // project's updatedAt is the version; a match means the analysis can't
    // have changed, so no revalidation is needed.
    const cached = getFreshCachedSheet(project.publicId, project.updatedAt);
    if (cached) {
      setData(cached);
      setPreviewState(cached.systems.length > 0 ? 'ready' : 'empty');
      return;
    }

    let cancelled = false;
    setPreviewState('loading');

    /* GET /analysis surfaces CHORD_PROJECT_005 when no analysis has run yet
     * for this project — common right after OMR completes, since the
     * backend doesn't auto-analyze. Treat that one code as a soft miss:
     * POST /analyze once, then retry GET /analysis. Any other error (auth,
     * 5xx, network) falls straight through to empty. */
    const isMissingAnalysisError = (e: unknown): boolean => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes('CHORD_PROJECT_005') || msg.includes('분석 결과가 없습니다');
    };

    const fetchAnalysisWithRecovery = async () => {
      try {
        const analysis = await getChordProjectAnalysis(project.publicId);
        return analysis;
      } catch (e) {
        if (!isMissingAnalysisError(e)) throw e;
        /* Self-heal — analyze runs synchronously on the server and returns
         * the result, so we don't even need a second GET in the happy
         * path. Fall back to GET on the off-chance /analyze returns a
         * subset shape vs /analysis. */
        try {
          return await analyzeOnce(project.publicId);
        } catch (analyzeErr) {
          /* Analyze itself failed — surface empty preview, no more
           * recovery attempts (don't loop). */
          throw analyzeErr;
        }
      }
    };

    fetchAnalysisWithRecovery()
      .then((analysis) => {
        if (cancelled) return;
        const sheet = analysisToLeadSheet(analysis, project);
        setCachedAnalysis(project.publicId, project.updatedAt, sheet);
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
  }, [project, shouldRender]);

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
        /* 가로 폭에 맞춰 "균등" 스케일(가로·세로 동일 배율)로 키운다 — 예전엔
         * 세로를 따로 늘려(scaleY) 썸네일 높이를 억지로 채우다 보니 코드 글자가
         * 길쭉하게 왜곡됐다. 균등 배율이라 짧은 차트는 세로가 남는데, 그 여백을
         * 위아래로 나눠(offsetY) 세로 가운데 정렬한다. */
        const scale = cw / NOMINAL_PREVIEW_WIDTH;
        const scaledHeight = naturalHeight * scale;
        const offsetY = Math.max(0, (ch - scaledHeight) / 2);
        setPreviewScale({ scale, offsetY });
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
          style={{ transform: `translateY(${previewScale.offsetY}px) scale(${previewScale.scale})` }}
        >
          <LeadSheet data={data} analysisFilters={PREVIEW_FILTERS} />
        </SheetThumbScaler>
      ) : (
        <ProjectPreviewState>
          {previewState === 'loading' ? <Spinner /> : <ChordGridIcon />}
          <span>
            {previewState === 'failed'
              // OMR genuinely failed — surface the backend's reason so the user
              // knows WHY (not just a bare "실패").
              ? (project?.omrFailureReason
                  ? `OMR 실패 · ${project.omrFailureReason}`
                  : 'OMR 실패')
              : previewState === 'empty'
                ? '코드 등록 필요'
                // previewState==='loading' splits two very different cases:
                //  - OMR still running  → "N% 처리 중"
                //  - OMR done, we're just fetching the analysis to draw the
                //    chart → "불러오는 중…". Showing "처리 중" here was the bug:
                //    completed charts (omrProgress=100) all read "100% 처리 중".
                : (project?.omrStatus === 'PENDING' || project?.omrStatus === 'PROCESSING')
                  ? `${project?.omrProgress ?? 0}% 처리 중`
                  : '불러오는 중…'}
          </span>
          {(project?.omrStatus === 'PENDING' || project?.omrStatus === 'PROCESSING') && (
            <ProgressTrack>
              <ProgressFill style={{ width: `${Math.min(100, Math.max(0, project?.omrProgress ?? 0))}%` }} />
            </ProgressTrack>
          )}
        </ProjectPreviewState>
      )}
    </SheetThumbWrap>
  );
}


/* Checkbox overlay shown in the top-left of every card in select mode. */
// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
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


/* ── modals (folder + youtube) ───────────────────────────────────────── */

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modalHigh};
  background: rgba(20, 20, 20, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalCard = styled.div`
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.24);
  padding: 22px 22px 18px;
  font-family: inherit;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalTitle = styled.h2`
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 700;
  color: #1a1a1a;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
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


const ModalHint = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.48);
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
`;

// 페이지별 의도적 디자인 차이 — 상대 페이지와 통합 금지 (§8 R9, sharedStyles.ts 헤더 참조)
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


/* "신규" row sits at the top of the list view; wrapper anchors the NewMenu
 * popover absolutely (mirrors NewCardWrap in grid mode). */
const ListNewRowWrap = styled.div`
  position: relative;
`;

/* Small leading thumbnail. $tone picks a default background tint for folder
 * / sheet / "new"; for plain files the inline `style.background` (gradient)
 * takes over via attribute precedence. */

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
function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

