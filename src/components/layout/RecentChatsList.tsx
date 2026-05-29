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
 */

import { useCallback, useEffect, useState } from 'react';
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

/* Section header — slightly larger than before, aligned with the same left
 * indent the NavBtn labels use so the column reads as one continuous list. */
const SectionLabel = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 12px ${ROW_PAD_X}px 6px ${LABEL_INDENT}px;
`;

/* Each chat row mirrors NavBtn (expanded) dimensions/typography. We
 * indent the text with padding-left so it lines up with NavBtn LABELS
 * (which sit right of an icon), making the column visually continuous. */
const Item = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  width: 100%;
  height: ${ROW_HEIGHT}px;
  padding: 0 ${ROW_PAD_X}px 0 ${LABEL_INDENT}px;
  border: none;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  border-radius: 10px;
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  /* Match NavBtn color scheme (active = a touch darker than idle). */
  color: ${({ $active }) => ($active ? '#1a1a1a' : '#2a2a2a')};
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s, color 0.12s;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #1a1a1a;
  }
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

  if (!expanded || !loggedIn) return null;

  return (
    <Wrap>
      <SectionLabel>최근 채팅</SectionLabel>
      {error && <ErrorRow>{error}</ErrorRow>}
      {!error && loaded && items.length === 0 && (
        <Empty>아직 채팅이 없습니다.</Empty>
      )}
      {items.map((c) => (
        <Item
          key={c.publicId}
          $active={c.publicId === activeId}
          title={c.title}
          onClick={() => {
            /* Update the active-chat pub-sub BEFORE navigating so the chat
             * panel's listener fires with the new id during its mount, not
             * after a no-op tick. Also navigate so the chat view actually
             * comes into focus (clicking from /chord, /my-charts, etc.
             * shouldn't leave the user on that page). */
            setActiveChat(c.publicId);
            navigate('/');
          }}
        >
          {c.title || '제목 없음'}
        </Item>
      ))}
    </Wrap>
  );
}
