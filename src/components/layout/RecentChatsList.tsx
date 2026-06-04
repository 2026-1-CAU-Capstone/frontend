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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  listChats,
  onChatListChange,
  onActiveChatChange,
  setActiveChat,
  type ChatSummary,
} from '../../api/chat';

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
  /* Sits between the divider and the bottom UserMenu — limited height +
   * scrollable so a long list doesn't push the avatar off-screen. */
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.18) transparent;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.28); }
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

/* ── confirm-delete modal ───────────────────────────────────────────── */

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
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
  padding: 22px 24px 18px;
  width: 100%;
  max-width: 420px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const ModalTitle = styled.h2`
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 800;
  color: #1a1a1a;
  letter-spacing: -0.01em;
`;
const ModalBody = styled.p`
  margin: 0 0 18px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.55);
`;
const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
const ModalBtn = styled.button<{ $variant?: 'ghost' | 'danger' }>`
  border: 1px solid ${({ $variant }) => ($variant === 'danger' ? 'transparent' : 'rgba(0, 0, 0, 0.12)')};
  border-radius: 10px;
  padding: 9px 18px;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
  background: ${({ $variant }) => ($variant === 'danger' ? '#d44a3a' : '#fff')};
  color: ${({ $variant }) => ($variant === 'danger' ? '#fff' : '#1a1a1a')};
  transition: background 0.12s, opacity 0.12s;
  &:hover { opacity: 0.92; }
`;

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

interface Props {
  /** Only renders in expanded sidebar mode. Collapsed → returns null. */
  expanded: boolean;
  /** Logged-in or not — when false, returns null (chats are per-user). */
  loggedIn: boolean;
}

export function RecentChatsList({ expanded, loggedIn }: Props): React.ReactElement | null {
  const navigate = useNavigate();
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  /* Per-row kebab dropdown — only one open at a time. Stored as the
   * chat publicId so click-outside can compare against the current row. */
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Confirm-delete modal target. `null` = closed. */
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);

  const refresh = useCallback(async () => {
    if (!loggedIn) return;
    try {
      const page = await listChats({ page: 0, size: 30 });
      setItems(page.content ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '채팅 목록을 불러오지 못했습니다.');
    } finally {
      setLoaded(true);
    }
  }, [loggedIn]);

  // Initial fetch + refresh on global notifications.
  useEffect(() => {
    if (!loggedIn) {
      setItems([]);
      setLoaded(false);
      return;
    }
    void refresh();
    const unsub = onChatListChange(refresh);
    return () => { unsub(); };
  }, [loggedIn, refresh]);

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

  if (!expanded || !loggedIn) return null;

  const openKebab = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuId((cur) => (cur === id ? null : id));
  };

  return (
    <Wrap>
      <SectionLabel>최근 채팅</SectionLabel>
      {error && <ErrorRow>{error}</ErrorRow>}
      {!error && loaded && items.length === 0 && (
        <Empty>아직 채팅이 없습니다.</Empty>
      )}
      {items.map((c) => {
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

      {deleteTarget && (
        <ModalBackdrop onClick={() => setDeleteTarget(null)}>
          <ModalCard onClick={(e) => e.stopPropagation()}>
            <ModalTitle>대화 삭제</ModalTitle>
            <ModalBody>이 대화를 삭제하시겠습니까?</ModalBody>
            <ModalActions>
              <ModalBtn $variant="ghost" type="button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </ModalBtn>
              <ModalBtn $variant="danger" type="button" onClick={() => setDeleteTarget(null)}>
                삭제
              </ModalBtn>
            </ModalActions>
          </ModalCard>
        </ModalBackdrop>
      )}
    </Wrap>
  );
}
