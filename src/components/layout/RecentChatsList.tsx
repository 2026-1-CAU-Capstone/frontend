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
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  listChats,
  deleteChat,
  onChatListChange,
  notifyChatListChanged,
  onActiveChatChange,
  setActiveChat,
  getActiveChatId,
  type ChatSummary,
} from '../../api/chat';
import { ConfirmDeleteModal } from '../common/ConfirmDeleteModal';

/* Sizes & paddings mirror NavBtn (expanded mode) so list rows visually flow
 * out of the nav cluster above. Constants kept inline to avoid sprinkling
 * magic numbers across the file. */
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
  padding: 12px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
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
  &:hover { background: rgba(0, 0, 0, 0.05); }
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
  &:hover { color: #1a1a1a; }
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
  color: #4a4a4a;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s, background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.08); }
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
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
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
  background: rgba(0, 0, 0, 0.08);
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
  color: #c0392b;
  padding: 6px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
  word-break: break-word;
`;

/* Sidebar search input is now in ChatSearchModal (opened from IconSidebar
 * "검색" NavBtn). The styled-components used to live here. */

/* Date-bucket sub-header — smaller and softer than the top SectionLabel
 * so the bucket reads as a sub-grouping, not a peer section. */
const BucketLabel = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.7;
  padding: 10px ${ROW_PAD_X}px 4px ${LABEL_INDENT}px;
`;

/* "더 보기" button at the tail of the list. Stays visible while the
 * backend reports more pages exist; clicking it appends the next page. */
const LoadMoreBtn = styled.button`
  margin: 8px ${ROW_PAD_X}px 4px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.04);
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

/* Date-bucket categories — ChatGPT/Claude-style. The chat's `updatedAt`
 * decides the bucket (so a chat that was just replied to bubbles back to
 * "오늘" instead of staying in its creation bucket). Older-than-30-day
 * chats fall into a "YYYY년 M월" bucket so any number of past months stay
 * neatly separated. */
function bucketLabel(updatedAt: string): string {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return '과거';
  const now = Date.now();
  const diffDay = (now - t) / (1000 * 60 * 60 * 24);
  if (diffDay < 1) return '오늘';
  if (diffDay < 2) return '어제';
  if (diffDay < 7) return '지난 7일';
  if (diffDay < 30) return '지난 30일';
  const d = new Date(t);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

const BUCKET_ORDER = ['오늘', '어제', '지난 7일', '지난 30일'];
function bucketSortKey(label: string): number {
  const i = BUCKET_ORDER.indexOf(label);
  if (i >= 0) return i;
  /* YYYY년 M월 buckets sort by negated year*12+month so newer months come
   * first (smaller key = earlier in the list). */
  const m = label.match(/^(\d{4})년 (\d{1,2})월$/);
  if (m) return BUCKET_ORDER.length + (9999 - (parseInt(m[1], 10) * 12 + parseInt(m[2], 10)));
  return Number.MAX_SAFE_INTEGER;
}

export function RecentChatsList({ expanded, loggedIn }: Props): React.ReactElement | null {
  const navigate = useNavigate();
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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
    if (!loggedIn) return;
    try {
      const p = await listChats({ page: 0, size: PAGE_SIZE });
      setItems(p.content ?? []);
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
    if (!loggedIn) {
      setItems([]);
      setLoaded(false);
      setPage(0);
      setHasMore(true);
      return;
    }
    void refresh();
    const unsub = onChatListChange(refresh);
    return () => { unsub(); };
  }, [loggedIn, refresh]);

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

  // Busy/dim state is owned by ConfirmDeleteModal; this just runs the delete
  // and closes the modal (on success or failure — errors surface in ErrorRow).
  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await deleteChat(target.publicId);
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

  /* Bucket the visible items by updatedAt date. Order: bucket priority
   * (BUCKET_ORDER) then most-recent first within each bucket. Title
   * filtering is now handled by ChatSearchModal — the sidebar list
   * shows every loaded chat. */
  const groupedItems = useMemo(() => {
    const groups = new Map<string, ChatSummary[]>();
    for (const c of items) {
      const k = bucketLabel(c.updatedAt);
      const arr = groups.get(k);
      if (arr) arr.push(c);
      else groups.set(k, [c]);
    }
    return Array.from(groups.entries())
      .map(([label, list]) => ({
        label,
        list: [...list].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)),
      }))
      .sort((a, b) => bucketSortKey(a.label) - bucketSortKey(b.label));
  }, [items]);

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
      {!error && loaded && items.length === 0 && (
        <Empty>아직 채팅이 없습니다.</Empty>
      )}
      {groupedItems.map((group) => (
        <div key={group.label}>
          <BucketLabel>{group.label}</BucketLabel>
          {group.list.map((c) => {
        const isMenuOpen = menuId === c.publicId;
        return (
          <Row
            key={c.publicId}
            $active={c.publicId === activeId}
            $menuOpen={isMenuOpen}
            className={isMenuOpen ? 'menu-open' : ''}
          >
            <RowLabel
              $active={c.publicId === activeId}
              title={c.title}
              onClick={() => {
                /* Update active-chat pub-sub BEFORE navigating so the chat
                 * panel's listener fires with the new id during mount. */
                setActiveChat(c.publicId);
                navigate('/');
              }}
            >
              {c.title || '제목 없음'}
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
        </div>
      ))}

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
