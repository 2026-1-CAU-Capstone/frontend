/**
 * RecentChatsList — chat history items rendered inside the sidebar.
 *
 * - Fetches from GET /v1/chat (paginated, most-recent first).
 * - Refreshes when api/chat#notifyChatListChanged is fired (after a new
 *   message creates a chat, or after a delete).
 * - Click → api/chat#setActiveChat(publicId) so RightChatPanel loads it.
 * - Renders only in `expanded` sidebar mode (collapsed rail is too narrow
 *   for a usable list — the chat icon at the top still gets you to a new
 *   chat there).
 * - Hover surfaces a kebab (⋮) on the right; clicking opens a 5-action
 *   dropdown (별표 제거 / 이름 변경 / 프로젝트 변경 / 프로젝트에서 제거 / 삭제).
 *   Only 삭제 is wired up — it opens the confirm modal; other actions
 *   are placeholder no-ops for now.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import {
  listChats,
  deleteChat,
  onChatListChange,
  notifyChatListChanged,
  onActiveChatChange,
  setActiveChat,
  getActiveChatId,
  getCachedChatList,
  setCachedChatList,
  clearCachedChatList,
  onPendingChatChange,
  getPendingChat,
  setPendingChat,
  type ChatSummary,
  type PendingChatInfo,
} from '../../api/chat';
import { getCachedUser, onAuthReset } from '../../api/auth';
import { listChordProjects } from '../../api/chordProjects';
import { ConfirmDeleteModal } from '../common/ConfirmDeleteModal';
import {
  getChatChartMeta,
  removeChatChartMeta,
  listChatChartMeta,
  onChatChartMetaChange,
  type ChatChartKind,
} from '../../lib/chatChartMeta';

/* Sizes & paddings mirror NavBtn (expanded mode) so list rows visually flow
 * out of the nav cluster above. Constants kept inline to avoid sprinkling
 * magic numbers across the file. */
/* songTitle values that raw (non-chart) entry points send — the home chat
 * sends "Jazzify"; chord/sheet pages fall back to "Jazzify AI" only when their
 * sheet hasn't loaded. A chat whose backend songTitle is NONE of these is a
 * real chart chat (so it stays badged even if the local tag was lost). */
const PLACEHOLDER_SONG_TITLES = new Set(['Jazzify', 'Jazzify AI']);

/* Append `?chat=<id>` (or `&chat=`) so the destination chart page restores that
 * exact conversation. A query param is used (not router state) because it
 * survives HashRouter quirks and a page refresh. */
function appendChatParam(route: string, chatId: string): string {
  const sep = route.includes('?') ? '&' : '?';
  return `${route}${sep}chat=${encodeURIComponent(chatId)}`;
}

const ROW_HEIGHT = 38;     // = NavBtn expanded height
const ROW_PAD_X = 10;      // = NavBtn expanded horizontal padding
const LABEL_INDENT = ROW_PAD_X; // text starts where NavBtn icons start (left-aligned with icons above)

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  /* Natural height — the whole "새 채팅 → 최근 채팅" region scrolls together in
   * IconSidebar's ScrollArea, so this list must NOT be its own scroll box
   * (that would nest scrollbars and let flexbox squash the rows). */
`;

const SectionLabel = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: ${({ theme }) => theme.colors.textSecondary};
  /* 위 패딩은 구분선과의 간격 — 12px 이면 선에서 너무 떠 보여 8px 로 좁혔다. */
  padding: 8px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
`;

/* Row wrapper — title button on the left, kebab button revealed on hover
 * to the right. `position:relative` anchors the absolutely-positioned
 * dropdown menu below. */
const Row = styled.div<{ $active?: boolean; $menuOpen?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  height: ${ROW_HEIGHT}px;
  /* Keep full height instead of letting flexbox squash rows to cram the whole
   * list into the available space — without this, many chats shrink each row
   * below ROW_HEIGHT (so height tweaks look like no-ops) and the list never
   * overflows, so Wrap's overflow-y:auto never produces a scrollbar. With it,
   * rows stay full-size and the list scrolls down to the admin block. */
  flex-shrink: 0;
  border-radius: 10px;
  background: ${({ $active, $menuOpen }) =>
    $menuOpen ? 'rgba(0, 0, 0, 0.06)' :
    $active ? 'rgba(0, 0, 0, 0.06)' :
    'transparent'};
  transition: background 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
  &:hover .row-kebab,
  &.menu-open .row-kebab { opacity: 1; pointer-events: auto; }
`;

const RowLabel = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 36px 0 ${LABEL_INDENT}px;   /* right padding leaves room for kebab */
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: ${({ $active }) => ($active ? '#1a1a1a' : '#2a2a2a')};
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

/* 곡 이름 왼쪽의 출처 배지 — 코드 차트에서 시작한 채팅은 **노란색**,
 * 악보 차트에서 시작한 채팅은 **초록색**. 아이콘은 사이드바의 같은 메뉴와 동일. */
const ChartBadge = styled.span<{ $kind: ChatChartKind }>`
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: #fff;
  background: ${({ $kind, theme }) => ($kind === 'chord' ? theme.colors.gold : theme.colors.tonic)};
`;
const LabelText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/* 차트 배지 아이콘 — 사이드바의 "내 코드 차트"·"내 악보 차트" 와 **같은 PNG**를
 * 쓴다. 종전엔 비슷하게 그린 별도 SVG 라 같은 대상을 가리키는데도 모양이 미묘하게
 * 달랐다. IconSidebar 의 PngIcon 과 같은 방식(마스크 + currentColor)이라 배지의
 * 흰색을 그대로 받는다. */
const SIDEBAR_ICON = (name: string) => `${import.meta.env.BASE_URL}icons/sidebar/${name}.png`;
const BadgeIcon = styled.span<{ $src: string; $size: number }>`
  display: inline-block;
  flex-shrink: 0;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  background-color: currentColor;
  -webkit-mask: url(${({ $src }) => $src}) center / contain no-repeat;
  mask: url(${({ $src }) => $src}) center / contain no-repeat;
`;
const ChordChartGlyph = () => <BadgeIcon $src={SIDEBAR_ICON('mychordchart')} $size={13} />;
const SheetChartGlyph = () => <BadgeIcon $src={SIDEBAR_ICON('myscorechart')} $size={13} />;

/* Optimistic placeholder shown at the top of the list while a brand-new chat
 * is being created on the backend — blank label + spinner until the GET lands. */
const spin = keyframes`to { transform: rotate(360deg); }`;
const PendingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px 0 ${LABEL_INDENT}px;
`;
const SkeletonBar = styled.span`
  flex: 1;
  min-width: 0;
  height: 9px;
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.activeFill};
`;
const Spinner = styled.span`
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.gold};
  animation: ${spin} 0.7s linear infinite;
`;

const RowKebab = styled.button`
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textPrimary};
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s, background 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.activeFill}; }
`;
const KebabDots = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);

/* Dropdown menu (matches the design mock from the user — 5 items with
 * an outline icon on the left and the 삭제 item in red, separated by a
 * thin divider). */
const Menu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 4px;
  min-width: 200px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16);
  padding: 8px 6px;
  z-index: 100;
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: rowMenuIn 0.1s ease both;
  @keyframes rowMenuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  color: ${({ $danger }) => ($danger ? '#c0392b' : '#1a1a1a')};
  transition: background 0.1s;
  &:hover { background: ${({ $danger }) => ($danger ? 'rgba(192, 57, 43, 0.08)' : 'rgba(0, 0, 0, 0.04)')}; }
`;
const MenuIco = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  color: currentColor;
  flex-shrink: 0;
`;
const MenuDivider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.activeFill};
  margin: 6px 4px;
`;

/* Icons for the dropdown — outline SVGs at 18px to match the design. */
const StarFilledIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2.5l2.95 6.12 6.55.95-4.75 4.65 1.13 6.58L12 17.77l-5.88 3.03 1.13-6.58L2.5 9.57l6.55-.95z" />
  </svg>
);
const PencilIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </svg>
);
const FolderMoveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M8 13h8" />
    <path d="M13 10l3 3-3 3" />
  </svg>
);
const FolderRemoveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M9 13l6 0" />
    <path d="M11 11l-2 2 2 2" />
    <path d="M13 11l2 2-2 2" />
  </svg>
);
const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);


const Empty = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 6px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
  opacity: 0.75;
`;

const ErrorRow = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.danger};
  padding: 6px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
  word-break: break-word;
`;

/* Sidebar search input is now in ChatSearchModal (opened from IconSidebar
 * "검색" NavBtn). The styled-components used to live here. */

/* "더 보기" button at the tail of the list. Stays visible while the
 * backend reports more pages exist; clicking it appends the next page. */
const LoadMoreBtn = styled.button`
  margin: 8px ${ROW_PAD_X}px 4px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.hover};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
  &:disabled { opacity: 0.5; cursor: default; }
`;

interface Props {
  /** Only renders in expanded sidebar mode. Collapsed → returns null. */
  expanded: boolean;
  /** Logged-in or not — when false, returns null (chats are per-user). */
  loggedIn: boolean;
}

const PAGE_SIZE = 30;

export function RecentChatsList({ expanded, loggedIn }: Props): React.ReactElement | null {
  const navigate = useNavigate();
  /* 활성(회색) 표시는 그 채팅이 **현재 페이지의 내용**일 때만 — 홈 채팅('/')과
   * 채팅 패널이 있는 차트 페이지들. 솔로 DB·카피하기 같은 메뉴 페이지로 가면
   * activeChat 저장값이 남아 있어도 강조하지 않는다(활성 표시는 화면에 딱 1개,
   * hover 는 별개). */
  const { pathname } = useLocation();
  const onChatRoute = pathname === '/'
    || pathname.startsWith('/chord')
    || pathname.startsWith('/mychord')
    || pathname.startsWith('/note');
  /* Seed from the localStorage cache so a refresh paints the list instantly
   * instead of flashing the empty loading state. The network fetch below
   * reconciles it (stale-while-revalidate). */
  const [items, setItems] = useState<ChatSummary[]>(() => getCachedChatList() ?? []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() => getCachedChatList() != null);

  /* Pagination state — `page` is the NEXT page to fetch, `hasMore`
   * reflects the server's `last` flag. loadMore appends; refresh resets. */
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  /* Per-row kebab dropdown — only one open at a time. Stored as the
   * chat publicId so click-outside can compare against the current row. */
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Confirm-delete modal target. `null` = closed. */
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);

  /* Sentinel ref for IntersectionObserver-based infinite scroll. The
   * sidebar's ScrollArea is the scroll container; once this sentinel
   * comes into view we trigger loadMore() if more pages exist. */
  const sentinelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    /* Don't gate on `loggedIn` alone: bootstrapAuth() flips it true only after
     * the /auth/me round-trip, which would serialize the chat fetch behind it.
     * A cached user means a token is already in localStorage, so authFetch can
     * fire now (and silently refresh on 401) — fetching in parallel with auth. */
    if (!loggedIn && !getCachedUser()) return;
    try {
      const p = await listChats({ page: 0, size: PAGE_SIZE });
      const content = p.content ?? [];
      setItems(content);
      setCachedChatList(content);
      setPage(1);
      setHasMore(!p.last);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '채팅 목록을 불러오지 못했습니다.');
    } finally {
      setLoaded(true);
    }
  }, [loggedIn]);

  const loadMore = useCallback(async () => {
    if (!loggedIn || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const p = await listChats({ page, size: PAGE_SIZE });
      setItems((prev) => {
        const merged = [...prev];
        const seen = new Set(merged.map((c) => c.publicId));
        for (const c of p.content ?? []) {
          if (!seen.has(c.publicId)) merged.push(c);
        }
        return merged;
      });
      setPage((n) => n + 1);
      setHasMore(!p.last);
    } catch (e) {
      setError(e instanceof Error ? e.message : '더 많은 채팅을 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  }, [loggedIn, loadingMore, hasMore, page]);

  // Initial fetch + refresh on global notifications.
  useEffect(() => {
    /* Genuine logged-out state = not logged in AND no cached user (the latter
     * is cleared on explicit logout / failed refresh). Wipe the cache so the
     * next account never sees the previous user's chats. */
    if (!loggedIn && !getCachedUser()) {
      setItems([]);
      setLoaded(false);
      setPage(0);
      setHasMore(true);
      clearCachedChatList();
      return;
    }
    void refresh();
    const unsub = onChatListChange(refresh);
    return () => { unsub(); };
  }, [loggedIn, refresh]);

  /* Account switch / logout: auth.ts has already wiped the localStorage caches
   * (clearUserScopedCaches). Drop our in-memory list too and refetch for the
   * (possibly new) user — covers "switch account without logging out", where
   * the loggedIn prop above doesn't change so its effect wouldn't re-run. */
  useEffect(() => onAuthReset(() => {
    setItems([]);
    setLoaded(false);
    setPage(0);
    setHasMore(true);
    void refresh();
  }), [refresh]);

  /* ── Optimistic placeholder for a brand-new chat ───────────────────────
   * RightChatPanel calls setPendingChat() the instant the user sends the first
   * message. We show a spinner row, then poll listChats() until a NEW chat id
   * appears (the backend creates it lazily) — only THEN swap the placeholder
   * for the real row. Bounded so a failed creation can't spin forever. */
  const [pending, setPending] = useState<PendingChatInfo | null>(() => getPendingChat());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => onPendingChatChange(() => setPending(getPendingChat())), []);

  /* Bump on any local chart-meta change so the merged list below recomputes. */
  const [metaVersion, setMetaVersion] = useState(0);
  useEffect(() => onChatChartMetaChange(() => setMetaVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!pending) return;
    if (!loggedIn && !getCachedUser()) { setPendingChat(null); return; }
    let cancelled = false;
    let tries = 0;
    const baseline = new Set(itemsRef.current.map((c) => c.publicId));
    const tick = async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const p = await listChats({ page: 0, size: PAGE_SIZE });
        if (cancelled) return;
        const content = p.content ?? [];
        setItems(content);
        setCachedChatList(content);
        setPage(1);
        setHasMore(!p.last);
        if (content.some((c) => !baseline.has(c.publicId))) {
          setPendingChat(null); // new chat is listed → drop the placeholder
          return;
        }
      } catch {
        /* keep polling */
      }
      if (tries >= 10) { setPendingChat(null); return; } // ~6s cap
      window.setTimeout(tick, 600);
    };
    void tick();
    return () => { cancelled = true; };
  }, [pending, loggedIn]);

  /* Auto-load next page when the sentinel scrolls into view. Filter-active
   * mode disables this so typing doesn't grab the whole table by accident
   * (the user can still click 더 보기). */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: '120px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  // Track which chat is currently open in the right panel for highlighting.
  useEffect(() => {
    const unsub = onActiveChatChange((id) => setActiveId(id));
    return () => { unsub(); };
  }, []);

  // Close kebab menu on outside click / Escape.
  useEffect(() => {
    if (menuId === null) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuId(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  /* Open a chat row. Chord/sheet-chart chats reopen their ORIGINATING chart
   * with the conversation restored (`restoreChat` tells that page to keep this
   * chat rather than starting fresh). Route comes from the local tag; if that's
   * gone, a chord chat is matched back to its project by song title so the row
   * still lands on the right chart. Plain chats open the home panel. */
  const handleRowOpen = useCallback(async (
    publicId: string,
    route: string | undefined,
    kind: ChatChartKind | undefined,
    songName: string | null,
    projectPublicId: string | undefined,
  ) => {
    setActiveChat(publicId);
    // PREFERRED: a chord-project chat carries its projectPublicId from the
    // backend → reopen the chord chart + AI chat screen directly. This replaces
    // the old song-title round-trip guess below.
    if (projectPublicId && kind === 'chord') {
      navigate(appendChatParam(`/mychord?project=${encodeURIComponent(projectPublicId)}`, publicId));
      return;
    }
    // Local origin tag (exact captured route; covers sheet + legacy chats).
    // Only trust the captured route for CHART chats. A plain global/direct chat
    // must never follow a stale chart route left in local chartMeta — otherwise
    // clicking it opens the code chart ("jazzify 창") instead of the chat.
    if (kind && route) {
      navigate(appendChatParam(route, publicId));
      return;
    }
    // LEGACY fallback for chats saved before projectPublicId existed: match a
    // chord chat back to its project by song title.
    if (kind === 'chord' && songName) {
      try {
        const page = await listChordProjects({ size: 100, sort: 'updatedAt,desc' });
        const proj = page.content?.find((p) => p.title === songName);
        if (proj) {
          navigate(appendChatParam(`/mychord?project=${encodeURIComponent(proj.publicId)}`, publicId));
          return;
        }
      } catch { /* fall through */ }
    }
    // 최종 폴백 — 차트 채팅인데 복원 정보(projectPublicId·로컬 route·프로젝트
    // 매칭)가 전부 없는 경우. 대표 사례: 내장 데모 차트(All of Me Analyzed)에서
    // 시작한 채팅 — 백엔드 프로젝트가 없고, 로컬 chartMeta는 로그인 시마다
    // 지워진다(auth.ts USER_SCOPED_CACHE_KEYS). 예전엔 홈 단독 채팅으로
    // 떨어졌지만, 코드차트 채팅은 "차트 + 옆 채팅" 레이아웃이 의도이므로
    // 기본 차트 화면으로 보낸다 (sheet도 동일하게 악보 화면으로).
    if (kind === 'chord') {
      navigate(appendChatParam('/mychord', publicId));
      return;
    }
    if (kind === 'sheet') {
      navigate(appendChatParam('/note', publicId));
      return;
    }
    navigate('/');
  }, [navigate]);

  // Busy/dim state is owned by ConfirmDeleteModal; this just runs the delete
  // and closes the modal (on success or failure — errors surface in ErrorRow).
  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await deleteChat(target.publicId);
      removeChatChartMeta(target.publicId); // drop the local chart-origin tag
      // Optimistically drop the row, clear the right panel if it was open,
      // and broadcast so any other list listeners reconcile with the server.
      setItems((prev) => prev.filter((c) => c.publicId !== target.publicId));
      if (getActiveChatId() === target.publicId) setActiveChat(null);
      notifyChatListChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '대화 삭제에 실패했습니다.');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  /* Backend list + locally-mirrored chord/sheet chats. The mirror guarantees a
   * chart chat shows the instant its id is known (and keeps showing it) even if
   * the backend's chat list is slow to include it — or omits chart-context
   * chats. Dedupe by publicId; the backend row wins when both exist. */
  const mergedItems = useMemo<ChatSummary[]>(() => {
    const byId = new Map(items.map((c) => [c.publicId, c]));
    for (const e of listChatChartMeta()) {
      if (byId.has(e.publicId)) continue;
      const iso = new Date(e.updatedAt).toISOString();
      byId.set(e.publicId, {
        publicId: e.publicId,
        type: 'direct',
        title: e.songTitle,
        songTitle: e.songTitle,
        category: e.kind,
        createdAt: iso,
        updatedAt: iso,
      });
    }
    return Array.from(byId.values());
    // metaVersion forces recompute when the local mirror changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, metaVersion]);

  /* Clear the pending placeholder the instant the new chat shows in the merged
   * list (chord/sheet appear immediately via the mirror; general chats once the
   * backend list/poll includes them). */
  useEffect(() => {
    if (!pending) return;
    const activeId = getActiveChatId();
    if (activeId && mergedItems.some((c) => c.publicId === activeId)) {
      setPendingChat(null);
    }
  }, [pending, mergedItems]);

  /* 최신 수정순 한 줄 목록. 예전엔 오늘/어제/지난 7일… 날짜 구간으로 묶었는데,
   * 구간 머리글이 목록보다 시선을 끌고 짧은 목록에선 머리글이 항목보다 많아지는
   * 일까지 있어 없앴다(2026-08-01). 제목 검색은 ChatSearchModal 담당. */
  const sortedItems = useMemo(
    () => [...mergedItems].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)),
    [mergedItems],
  );

  if (!expanded || !loggedIn) return null;

  const openKebab = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuId((cur) => (cur === id ? null : id));
  };

  return (
    <Wrap>
      <SectionLabel>최근 채팅</SectionLabel>
      {/* Inline search input removed — moved to ChatSearchModal (opened
       *  from IconSidebar's "검색" NavBtn). */}
      {error && <ErrorRow>{error}</ErrorRow>}
      {pending && (
        <PendingRow aria-label="새 채팅을 만드는 중">
          {pending.kind && (
            <ChartBadge $kind={pending.kind} aria-hidden>
              {pending.kind === 'chord' ? <ChordChartGlyph /> : <SheetChartGlyph />}
            </ChartBadge>
          )}
          <SkeletonBar />
          <Spinner aria-hidden />
        </PendingRow>
      )}
      {!error && !pending && loaded && mergedItems.length === 0 && (
        <Empty>아직 채팅이 없습니다.</Empty>
      )}
      {sortedItems.map((c) => {
        const isMenuOpen = menuId === c.publicId;
        // A chord/sheet-chart chat = STARTED from a chart. Reliable signal is
        // the local mirror (kind); but that can be lost (cleared site data), so
        // we ALSO treat a backend `songTitle` that is a REAL song (not a raw/
        // placeholder title) as a chart chat. Raw home chats send "Jazzify" →
        // excluded → they keep the user's own question. Kind has no backend
        // signal once the mirror is gone, so it defaults to the chord icon.
        const meta = getChatChartMeta(c.publicId);
        const backendSong = c.songTitle && !PLACEHOLDER_SONG_TITLES.has(c.songTitle)
          ? c.songTitle
          : null;
        const songName = meta?.songTitle || backendSong || null;
        const chartKind: ChatChartKind | undefined =
          meta?.kind
          ?? (c.category === 'chord' || c.category === 'sheet' ? c.category : undefined)
          ?? (songName ? 'chord' : undefined);
        const rowLabel = chartKind && songName
          ? songName
          : (c.title || '제목 없음');
        return (
          <Row
            key={c.publicId}
            $active={onChatRoute && c.publicId === activeId}
            $menuOpen={isMenuOpen}
            className={isMenuOpen ? 'menu-open' : ''}
          >
            <RowLabel
              $active={onChatRoute && c.publicId === activeId}
              title={rowLabel}
              onClick={() => void handleRowOpen(c.publicId, meta?.route, chartKind, songName, c.projectPublicId ?? undefined)}
            >
              {chartKind && (
                <ChartBadge $kind={chartKind} aria-hidden>
                  {chartKind === 'chord' ? <ChordChartGlyph /> : <SheetChartGlyph />}
                </ChartBadge>
              )}
              <LabelText>{rowLabel}</LabelText>
            </RowLabel>
            <RowKebab
              className="row-kebab"
              aria-label="더보기"
              onClick={openKebab(c.publicId)}
            >
              <KebabDots />
            </RowKebab>
            {isMenuOpen && (
              <Menu ref={menuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                <MenuItem type="button" onClick={() => setMenuId(null)}>
                  <MenuIco><StarFilledIcon /></MenuIco>
                  <span>별표 제거</span>
                </MenuItem>
                <MenuItem type="button" onClick={() => setMenuId(null)}>
                  <MenuIco><PencilIcon /></MenuIco>
                  <span>이름 변경</span>
                </MenuItem>
                <MenuItem type="button" onClick={() => setMenuId(null)}>
                  <MenuIco><FolderMoveIcon /></MenuIco>
                  <span>프로젝트 변경</span>
                </MenuItem>
                <MenuItem type="button" onClick={() => setMenuId(null)}>
                  <MenuIco><FolderRemoveIcon /></MenuIco>
                  <span>프로젝트에서 제거</span>
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  type="button"
                  $danger
                  onClick={() => { setMenuId(null); setDeleteTarget(c); }}
                >
                  <MenuIco><TrashIcon /></MenuIco>
                  <span>삭제</span>
                </MenuItem>
              </Menu>
            )}
          </Row>
        );
      })}

      {/* Infinite-scroll sentinel — when it scrolls into view the
       *  IntersectionObserver above triggers loadMore(). Hidden in
       *  search mode (the filter is client-side, so loading more
       *  rows without scrolling is the user's call). */}
      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      {/* Visible fallback in case IntersectionObserver doesn't fire
       *  (very small ScrollArea, search active, etc.). */}
      {hasMore && (
        <LoadMoreBtn type="button" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </LoadMoreBtn>
      )}

      <ConfirmDeleteModal
        open={!!deleteTarget}
        title="대화 삭제"
        body="이 대화를 삭제하시겠습니까?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Wrap>
  );
}
