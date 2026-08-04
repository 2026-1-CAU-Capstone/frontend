/**
 * ChatSearchModal — full-overlay chat search opened from the sidebar's
 * "검색" NavBtn. Loads the user's chat list (first page only — most
 * recent 100), debounces a client-side title-contains filter, and lets
 * the user jump straight into a hit. Replaces the inline search input
 * previously embedded in RecentChatsList.
 *
 * Pattern matches Claude / ChatGPT "Search chats" modal:
 *   - Cmd+K shortcut wired by the caller (sidebar) is the typical entry,
 *     but this modal also opens via the explicit sidebar button.
 *   - Backdrop click + Escape close the modal.
 *   - Up/Down arrow navigates results; Enter activates the highlighted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isComposingEvent } from '../../lib/ime';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { listChats, setActiveChat, type ChatSummary } from '../../api/chat';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChatSearchModal({ open, onClose }: Props): React.ReactElement | null {
  const navigate = useNavigate();
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Highlighted index — Up/Down moves it; Enter activates the
   * corresponding result. Reset whenever the filtered list changes. */
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch a wider window of chats once the modal opens. The sidebar list
  // shows ~30 most recent; search should reach further so the user can
  // find older chats without paginating manually.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const page = await listChats({ page: 0, size: 100 });
        if (cancelled) return;
        setItems(page.content ?? []);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '채팅을 불러오지 못했습니다.');
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Autofocus the search input on open.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Close on Escape (handled here so the input keeps focus while the
  // modal is open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => (c.title || '').toLowerCase().includes(q));
  }, [items, query]);

  // Clamp highlighted index when filter changes.
  useEffect(() => {
    setActiveIdx((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  const openChat = useCallback((id: string) => {
    setActiveChat(id);
    navigate('/');
    onClose();
  }, [navigate, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (isComposingEvent(e)) return; // 한글 조합 확정 Enter — 검색 유지
      e.preventDefault();
      const hit = filtered[activeIdx];
      if (hit) openChat(hit.publicId);
    }
  };

  // Scroll the highlighted row into view when navigating with arrows.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <SearchHeader>
          <SearchIcon />
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="채팅 검색"
            aria-label="채팅 검색"
          />
          <CloseHint>Esc</CloseHint>
        </SearchHeader>
        <Divider />
        <ResultList ref={listRef}>
          {!loaded && <Hint>불러오는 중…</Hint>}
          {loaded && error && <ErrorMsg>{error}</ErrorMsg>}
          {loaded && !error && filtered.length === 0 && (
            <Hint>{query ? `"${query}" 에 대한 결과가 없습니다.` : '아직 채팅이 없습니다.'}</Hint>
          )}
          {filtered.map((c, i) => (
            <ResultRow
              key={c.publicId}
              data-idx={i}
              $active={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => openChat(c.publicId)}
            >
              <ResultTitle>{c.title || '제목 없음'}</ResultTitle>
              <ResultMeta>{new Date(c.updatedAt).toLocaleDateString('ko-KR')}</ResultMeta>
            </ResultRow>
          ))}
        </ResultList>
      </Card>
    </Backdrop>
  );
}

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <line x1="20" y1="20" x2="16.5" y2="16.5" />
  </svg>
);

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  /* Above MobileChatFab's fullscreen overlay (1200) — same value made the
   * Cmd+K modal render UNDER the open mobile chat while still grabbing
   * Escape. Search must win over any page overlay. */
  z-index: ${({ theme }) => theme.zIndex.popover};
  background: rgba(20, 20, 20, 0.32);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 14vh 24px 24px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 560px;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 14px;
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: searchIn 0.12s ease both;
  @keyframes searchIn {
    from { opacity: 0; transform: translateY(-8px) scale(0.985); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

const SearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SearchInput = styled.input`
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const CloseHint = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.textSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  padding: 2px 6px;
`;

const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.activeFill};
`;

const ResultList = styled.div`
  max-height: min(480px, 56vh);
  overflow-y: auto;
  padding: 6px;
`;

const ResultRow = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  cursor: pointer;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.05)' : 'transparent')};
  transition: background 0.08s;
`;

const ResultTitle = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ResultMeta = styled.div`
  flex-shrink: 0;
  font-size: 11.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Hint = styled.div`
  padding: 18px 14px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  opacity: 0.8;
`;

const ErrorMsg = styled.div`
  padding: 14px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
`;
