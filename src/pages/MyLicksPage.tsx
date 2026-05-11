import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { LickCard } from '../components/notesheet/LickCard';
import { loadLicks, invalidateLicksCache, type LickEntry } from '../data/lickData';
import { deleteLick } from '../api/licks';

/* ─── styled ───────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};

  ${mq.mobile} {
    padding: 8px 12px;
    gap: 8px;
  }
`;

const BackBtn = styled.button`
  font-size: 0.82rem;
  padding: 4px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover { background: #f0f0f0; }
`;

const Title = styled.span`
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Count = styled.span`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ErrorBanner = styled.div`
  padding: 8px 16px;
  background: #fdecea;
  color: #b3261e;
  font-size: 0.85rem;
  border-bottom: 1px solid #f3c7c1;
`;

const ListArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  ${mq.mobile} {
    padding: 8px;
    gap: 8px;
  }
`;

const EmptyMsg = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
  opacity: 0.5;
`;

const LoadingMsg = styled(EmptyMsg)`
  opacity: 0.7;
`;

/* ─── visibility wrapper ─────────────────────────────────────────────── */

function VisibleLickCard({ lick, width, displayId, onDelete, onEdit, onClick }: {
  lick: LickEntry; width: number; displayId: number;
  onDelete: () => void;
  onEdit?: () => void;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <LickCard lick={lick} width={width} visible={visible} compact displayId={displayId} onDelete={onDelete} onEdit={onEdit} onClick={onClick} />
    </div>
  );
}

/* ─── component ────────────────────────────────────────────────────────── */

export default function MyLicksPage() {
  const navigate = useNavigate();
  const [licks, setLicks] = useState<LickEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLicks = useCallback(() => {
    setLoading(true);
    setError(null);
    loadLicks()
      .then((entries) => {
        setLicks(entries);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load licks from backend:', err);
        setError(err instanceof Error ? err.message : '릭을 불러오지 못했습니다.');
        setLicks([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchLicks();
  }, [fetchLicks]);

  const handleDelete = useCallback(async (lick: LickEntry) => {
    if (typeof lick.id !== 'string') {
      setError(`삭제 불가: 백엔드 publicId 형식이 아닙니다 (${lick.id}).`);
      return;
    }
    const ok = window.confirm(`"${lick.performer} — ${lick.title}" 릭을 삭제할까요?`);
    if (!ok) return;
    try {
      await deleteLick(lick.id);
      invalidateLicksCache();
      // optimistically remove from list, then refresh from server
      setLicks((prev) => prev.filter((l) => l.id !== lick.id));
      fetchLicks();
    } catch (err) {
      console.error('Delete failed:', err);
      setError(err instanceof Error ? err.message : '삭제 실패');
      setTimeout(() => setError(null), 4000);
    }
  }, [fetchLicks]);

  /* edit (backend only) — JSON tool로 이동, editingLick state 전달.
   * LicksPage의 handleEditLick과 동일 패턴. */
  const handleEdit = useCallback((lick: LickEntry) => {
    navigate('/lick-input', { state: { editingLick: lick } });
  }, [navigate]);

  /* width tracking */
  const listRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(800);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setCardWidth(w - 40);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Page>
      <Header>
        <BackBtn onClick={() => navigate('/lick-input')}>&larr; Lick Tool</BackBtn>
        <Title>My Licks</Title>
        <Count>{loading ? '...' : `${licks.length} lick${licks.length !== 1 ? 's' : ''}`}</Count>
      </Header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <ListArea ref={listRef}>
        {loading && <LoadingMsg>Loading…</LoadingMsg>}
        {!loading && licks.length === 0 && !error && (
          <EmptyMsg>아직 등록된 릭이 없습니다. Lick JSON Tool에서 추가해주세요.</EmptyMsg>
        )}
        {licks.map((lick, i) => (
          <VisibleLickCard
            key={String(lick.id)}
            lick={lick}
            width={cardWidth}
            /* 백엔드는 createdAt desc로 보내므로 최상단(i=0)이 가장 최근.
             * 번호는 LicksPage와 동일하게 가장 오래된 것이 #1, 최신이 #N. */
            displayId={licks.length - i}
            onDelete={() => handleDelete(lick)}
            onEdit={typeof lick.id === 'string' ? () => handleEdit(lick) : undefined}
            onClick={() => navigate(`/lick-practice/${lick.id}`)}
          />
        ))}
      </ListArea>
    </Page>
  );
}
