import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import styled, { keyframes } from 'styled-components';

/* Past-conversations modal — Claude/ChatGPT-style list.
 *
 * Mounted by HomePage when the user clicks "채팅" in the QuickNav (only when
 * logged in). Reads from props.conversations — the host is expected to wire
 * this to a persistent backend or localStorage store.
 *
 * For the initial design pass we accept conversations as a prop array so the
 * modal stays a dumb view; the host can swap in real data without touching
 * styles. Empty state has a clear CTA to start a new chat. */

export interface ChatConversation {
  /** Stable id used as React key + selection target. */
  id: string;
  /** Display title — first user message or AI-summarized topic. */
  title: string;
  /** Last activity timestamp (ms epoch). Used for the relative "n hours ago". */
  updatedAt: number;
  /** Optional secondary label after the timestamp (e.g. project / folder). */
  badge?: string;
}

interface Props {
  open: boolean;
  conversations: ChatConversation[];
  onClose: () => void;
  /** Fired when the user clicks a row. Host should load the conversation
   *  into the active chat panel and close the modal. */
  onSelect: (id: string) => void;
  /** Fired when "새 채팅" is clicked. Host should reset the active chat
   *  panel and close the modal. */
  onNewChat: () => void;
}

export function ChatHistoryModal({
  open,
  conversations,
  onClose,
  onSelect,
  onNewChat,
}: Props) {
  const [query, setQuery] = useState('');
  const [multiSelect, setMultiSelect] = useState(false);

  /* Reset transient UI state every time the modal opens. */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMultiSelect(false);
  }, [open]);

  /* Esc to close. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) || (c.badge ?? '').toLowerCase().includes(q),
    );
  }, [conversations, query]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <Header>
          <HeaderTitle>채팅</HeaderTitle>
          <HeaderActions>
            <GhostBtn
              type="button"
              onClick={() => setMultiSelect((v) => !v)}
              aria-pressed={multiSelect}
            >
              {multiSelect ? '취소' : '대화 선택'}
            </GhostBtn>
            <PrimaryBtn type="button" onClick={() => { onNewChat(); onClose(); }}>
              새 채팅
            </PrimaryBtn>
            <CloseBtn type="button" onClick={onClose} aria-label="닫기">
              <CloseIcon />
            </CloseBtn>
          </HeaderActions>
        </Header>

        <SearchWrap>
          <SearchIconSlot><SearchIcon /></SearchIconSlot>
          <SearchInput
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="대화 검색..."
            autoFocus
          />
        </SearchWrap>

        <List>
          {filtered.length === 0 ? (
            <EmptyState>
              {conversations.length === 0
                ? '아직 저장된 대화가 없습니다.'
                : '검색 결과가 없습니다.'}
            </EmptyState>
          ) : (
            filtered.map((c) => (
              <Row key={c.id} onClick={() => { onSelect(c.id); onClose(); }}>
                <RowTitle>{c.title}</RowTitle>
                <RowMeta>{formatRelative(c.updatedAt)}</RowMeta>
                {c.badge && <RowBadge>{c.badge}</RowBadge>}
              </Row>
            ))
          )}
        </List>
      </Card>
    </Backdrop>
  );
}

/* ── helpers ────────────────────────────────────────────── */

function formatRelative(ts: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 14) return 'last week';
  return `${Math.floor(day / 7)} weeks ago`;
}

/* ── icons ──────────────────────────────────────────────── */

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
    <line x1="16.2" y1="16.2" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* ── animations + styles ────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modal};
  background: rgba(20, 20, 20, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  animation: ${fadeIn} 0.15s ease both;
`;

const Card = styled.div`
  width: 100%;
  max-width: 780px;
  max-height: min(720px, 90vh);
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 22px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
  font-family: ${({ theme }) => theme.fonts.ui};
  padding: 28px 28px 12px;
  display: flex;
  flex-direction: column;
  animation: ${popIn} 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 600px) {
    padding: 20px 18px 6px;
    border-radius: 18px;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
`;

const HeaderTitle = styled.h2`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.015em;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const GhostBtn = styled.button`
  height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
  &[aria-pressed='true'] { background: ${({ theme }) => theme.colors.inkSurface}; color: ${({ theme }) => theme.colors.onInk}; border-color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const PrimaryBtn = styled.button`
  height: 34px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.12s, transform 0.08s;
  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.98); }
`;

const CloseBtn = styled.button`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const SearchWrap = styled.div`
  position: relative;
  margin-bottom: 8px;
`;

const SearchIconSlot = styled.span`
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: ${({ theme }) => theme.colors.textSecondary};
  display: inline-flex;
`;

const SearchInput = styled.input`
  width: 100%;
  height: 44px;
  padding: 0 14px 0 40px;
  border-radius: 12px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  font-family: inherit;
  font-size: 14.5px;
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  transition: border-color 0.12s;
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; }
  &:focus { border-color: rgba(63, 117, 245, 0.7); }
`;

const List = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 4px -8px 0;
  padding: 0 8px;
`;

const Row = styled.button`
  display: flex;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  padding: 14px 8px;
  border: none;
  background: transparent;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.1s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
  &:last-child { border-bottom: none; }
`;

const RowTitle = styled.span`
  font-size: 14.5px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
`;

const RowMeta = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
`;

const RowBadge = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
`;

const EmptyState = styled.div`
  padding: 60px 16px;
  text-align: center;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
